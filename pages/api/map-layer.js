// pages/api/map-layer.js
// Thin API handler — all heavy logic lives in the service layer under /lib.
import { authenticate, withTimeout, TIMEOUT_ERROR_TAG } from '../../lib/gee/auth';
import { buildCacheKey, getCached, setCache } from '../../lib/gee/cache';
import { parseQueryParams, safeErrorLog } from '../../lib/validators/queryParams';
import { resolveGeometry, buildDualCollection, buildFinalImage, runGeeEvaluation } from '../../lib/gee/compute';

const REQUEST_TIMEOUT_MS = 120_000; // 2 menit

export default async function handler(req, res) {
  // ── Method guard ─────────────────────────────────────────────────────────
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Gunakan GET.' });
  }

  try {
    // ── 1. Validate & parse params ──────────────────────────────────────────
    const params = parseQueryParams(req.query);
    if (params.error) {
      return res.status(params.status).json({ error: params.error });
    }

    const {
      normalizedType, normalizedMode, normalizedReducer, normalizedGapFill,
      normalizedRegion, startDateInput, endDateInput, startDateObj, endDateObj,
      cloudThreshold, clampedTargetYear, visMin, visMax, thresholdVal,
    } = params;

    // ── 2. Cache check ───────────────────────────────────────────────────────
    const cacheKey = buildCacheKey({
      type: normalizedType, mode: normalizedMode, reducer: normalizedReducer,
      gap_fill: normalizedGapFill, region: normalizedRegion,
      start_date: startDateInput, end_date: endDateInput,
      cloud_cover: cloudThreshold, target_year: clampedTargetYear,
      vis_min: visMin, vis_max: visMax, threshold: thresholdVal,
    });

    const cached = getCached(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }
    res.setHeader('X-Cache', 'MISS');

    // ── 3. GEE auth (singleton) ──────────────────────────────────────────────
    await authenticate();

    // ── 4. Build GEE objects ─────────────────────────────────────────────────
    const geometry = resolveGeometry(normalizedRegion);

    const dualCollection = buildDualCollection(
      geometry, startDateInput, endDateInput, cloudThreshold
    );

    const mainBand = normalizedType === 'ndvi' ? 'NDVI' : 'LST_Celsius';
    const palette  = normalizedType === 'ndvi'
      ? ['red', 'yellow', 'green']
      : ['040274', '2c7bb6', 'abd9e9', 'ffffbf', 'fdae61', 'd7191c', '7a0403'];

    const { finalImage, baselineStats } = buildFinalImage(
      dualCollection, normalizedMode, normalizedReducer,
      normalizedGapFill, mainBand, geometry, clampedTargetYear
    );

    if (!finalImage) {
      return res.status(404).json({ error: 'Tidak ada data citra pada rentang waktu/wilayah tersebut.' });
    }

    // ── 5. Parallel GEE evaluation ───────────────────────────────────────────
    const visParams = { min: visMin, max: visMax, palette };

    const responsePayload = await withTimeout(
      runGeeEvaluation({
        finalImage, mainBand, geometry, visParams, thresholdVal,
        dualCollection, startDateObj, endDateObj, baselineStats,
        mode: normalizedMode, normalizedType, normalizedRegion,
        targetYear: clampedTargetYear,
      }),
      REQUEST_TIMEOUT_MS
    );

    // runGeeEvaluation returns null when getMap fails (no valid pixels)
    if (!responsePayload) {
      return res.status(422).json({
        error: 'Tidak ada piksel valid pada rentang waktu/wilayah tersebut. Coba perluas rentang tanggal atau naikkan batas tutupan awan.',
      });
    }

    // ── 6. Cache & respond ───────────────────────────────────────────────────
    setCache(cacheKey, responsePayload);
    return res.status(200).json(responsePayload);

  } catch (error) {
    safeErrorLog('GEE Error (sanitized response):', {
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });

    if (error?.code === TIMEOUT_ERROR_TAG) {
      return res.status(504).json({
        error: 'TIMEOUT',
        message:
          'Proses GEE memakan waktu lebih dari 2 menit. GEE mungkin sedang memproses di server — silakan coba lagi dalam beberapa detik (biasanya request kedua jauh lebih cepat karena GEE cache).',
      });
    }

    return res.status(500).json({
      error: 'Terjadi kesalahan internal saat memproses permintaan.',
    });
  }
}
