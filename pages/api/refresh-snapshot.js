// pages/api/refresh-snapshot.js
// Endpoint untuk cron: regenerasi monitoring snapshot dari GEE.
// Panggil via POST dengan header x-cron-secret untuk keamanan.
import fs from 'fs';
import path from 'path';
import { authenticate, withTimeout, TIMEOUT_ERROR_TAG } from '../../lib/gee/auth';
import { buildCacheKey, getCached, setCache } from '../../lib/gee/cache';
import { resolveGeometry, buildDualCollection, buildFinalImage, runGeeEvaluation } from '../../lib/gee/compute';

const REQUEST_TIMEOUT_MS = 180_000; // 3 menit (lebih longgar untuk background job)

// Parameter default snapshot — Seluruh Bali, NDVI, Median, 10 tahun terakhir
function getDefaultParams() {
  const now = new Date();
  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(now.getFullYear() - 10);

  return {
    type: 'ndvi',
    mode: 'history',
    region_name: 'ALL',
    start_date: tenYearsAgo.toISOString().split('T')[0],
    end_date: now.toISOString().split('T')[0],
    cloud_cover: 30,
    reducer: 'Median',
    vis_min: -1,
    vis_max: 1,
    threshold: 0.5,
    gap_fill: 'none',
  };
}

export default async function handler(req, res) {
  // Hanya POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Gunakan POST.' });
  }

  // Validasi cron secret (opsional: skip di development)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const params = getDefaultParams();

    // 1. Autentikasi GEE
    await authenticate();

    // 2. Build GEE objects
    const geometry = resolveGeometry(params.region_name);
    const dualCollection = buildDualCollection(
      geometry, params.start_date, params.end_date, params.cloud_cover
    );

    const mainBand = params.type === 'ndvi' ? 'NDVI' : 'LST_Celsius';
    const palette = params.type === 'ndvi'
      ? ['red', 'yellow', 'green']
      : ['040274', '2c7bb6', 'abd9e9', 'ffffbf', 'fdae61', 'd7191c', '7a0403'];

    const { finalImage, baselineStats } = buildFinalImage(
      dualCollection, params.mode, params.reducer,
      params.gap_fill, mainBand, geometry, null
    );

    if (!finalImage) {
      return res.status(404).json({ error: 'Tidak ada data citra untuk snapshot.' });
    }

    // 3. Evaluasi GEE
    const visParams = { min: params.vis_min, max: params.vis_max, palette };

    const responsePayload = await withTimeout(
      runGeeEvaluation({
        finalImage, mainBand, geometry, visParams,
        thresholdVal: params.threshold,
        dualCollection,
        startDateObj: new Date(params.start_date),
        endDateObj: new Date(params.end_date),
        baselineStats,
        mode: params.mode,
        normalizedType: params.type,
        normalizedRegion: params.region_name,
        targetYear: null,
      }),
      REQUEST_TIMEOUT_MS
    );

    if (!responsePayload) {
      return res.status(422).json({ error: 'Tidak ada piksel valid untuk snapshot.' });
    }

    // 4. Simpan ke file
    const now = new Date();
    const nextRefresh = new Date(now);
    nextRefresh.setDate(nextRefresh.getDate() + 8); // Siklus 8 hari (sesuai revisit Landsat 8/9)

    const snapshot = {
      _note: 'Auto-generated monitoring snapshot. Diperbarui setiap 8 hari sesuai siklus Landsat.',
      _generated_at: now.toISOString(),
      _next_refresh: nextRefresh.toISOString(),
      _refresh_interval_days: 8,
      _params: params,
      map: responsePayload.map,
      stats: responsePayload.stats,
      chart: responsePayload.chart,
      scatter: responsePayload.scatter,
      downloadUrl: responsePayload.downloadUrl || null,
    };

    const outputPath = path.join(process.cwd(), 'public', 'data', 'monitoring_snapshot.json');
    fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), 'utf-8');

    return res.status(200).json({
      success: true,
      generated_at: snapshot._generated_at,
      stats_summary: {
        region: snapshot.stats?.region,
        mean: snapshot.stats?.mean?.toFixed(2),
        unit: snapshot.stats?.unit,
        chart_points: snapshot.chart?.length,
      },
    });

  } catch (error) {
    console.error('[refresh-snapshot] Error:', error?.message);

    if (error?.code === TIMEOUT_ERROR_TAG) {
      return res.status(504).json({ error: 'TIMEOUT', message: 'GEE memakan waktu lebih dari 3 menit.' });
    }

    return res.status(500).json({ error: 'Gagal regenerasi snapshot.' });
  }
}
