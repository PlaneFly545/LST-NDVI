// pages/api/map-layer.js
// Thin API handler — all heavy logic lives in the service layer under /lib.
import { authenticate, withTimeout, TIMEOUT_ERROR_TAG } from '../../lib/gee/auth';
import { buildCacheKey, getCached, setCache } from '../../lib/gee/cache';
import { parseQueryParams, safeErrorLog } from '../../lib/validators/queryParams';
import { resolveGeometry, buildDualCollection, buildFinalImage, runGeeEvaluation } from '../../lib/gee/compute';

const REQUEST_TIMEOUT_MS = 120_000; // 2 menit

/**
 * Ambil bagian satu wilayah dari payload yang memuat semua wilayah.
 *
 * Payload di cache selalu berisi seluruh kabupaten/kota; yang dikirim ke klien
 * hanya potongan wilayah yang diminta. Karena itu berpindah wilayah tidak
 * memerlukan komputasi GEE baru — cukup memilih ulang dari entri cache yang sama.
 *
 * @param {object} payload
 * @param {string} region  'ALL' atau nama kabupaten (huruf besar)
 * @returns {object}
 */
function selectRegion(payload, region) {
  const key = region === 'ALL' ? 'ALL' : region.toUpperCase();

  return {
    map: payload.map,
    stats: payload.statsByRegion?.[key] || payload.statsByRegion?.ALL || null,
    chart: payload.chartByRegion?.[key] || [],
    scatter: payload.scatterByRegion?.[key] || [],
    seasonal: payload.seasonalByRegion?.[key] || [],
    // Daftar citra sumber tidak dipecah per wilayah — koleksinya disaring dengan
    // geometri seluruh Bali, jadi tahun dan tanggalnya sama untuk semua wilayah.
    scenes: payload.scenesByYear || [],
  };
}

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

    // Stopwatch dimulai setelah validasi — request yang ditolak (400)
    // tidak dihitung sebagai waktu pemrosesan.
    // performance.now() dipakai (bukan Date.now()) karena cache hit bisa
    // selesai di bawah 1 ms, yang akan membulat jadi 0 pada resolusi milidetik.
    const startedAt = performance.now();
    const elapsedMs = () => Math.round((performance.now() - startedAt) * 10) / 10;

    const {
      normalizedType, normalizedMode, normalizedReducer, normalizedGapFill,
      normalizedRegion, startDateInput, endDateInput,
      baselineStartYear, baselineEndYear,
      seriesStartYear, seriesEndYear, hasFullYear,
      cloudThreshold, clampedTargetYear, visMin, visMax, thresholdVal,
    } = params;

    // ── 2. Cache check ───────────────────────────────────────────────────────
    // region sengaja TIDAK ikut dalam kunci: satu komputasi menghasilkan
    // statistik seluruh kabupaten sekaligus, jadi pindah wilayah selalu HIT.
    // vis_min/vis_max/threshold tetap ikut karena benar-benar mengubah keluaran
    // (palet ubinan peta dan ambang luas area terdampak).
    const cacheKey = buildCacheKey({
      type: normalizedType, mode: normalizedMode, reducer: normalizedReducer,
      gap_fill: normalizedGapFill,
      start_date: startDateInput, end_date: endDateInput,
      cloud_cover: cloudThreshold, target_year: clampedTargetYear,
      vis_min: visMin, vis_max: visMax, threshold: thresholdVal,
    });

    const cached = getCached(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json({
        ...selectRegion(cached, normalizedRegion),
        processing_time_ms: elapsedMs(),
      });
    }
    res.setHeader('X-Cache', 'MISS');

    // ── 3. GEE auth (singleton) ──────────────────────────────────────────────
    await authenticate();

    // ── 4. Build GEE objects ─────────────────────────────────────────────────
    // Citra selalu dibangun untuk seluruh Bali, tidak dipotong per kabupaten.
    const geometry = resolveGeometry('ALL');

    const dualCollection = buildDualCollection(
      geometry, startDateInput, endDateInput, cloudThreshold
    );

    const mainBand = normalizedType === 'ndvi' ? 'NDVI' : 'LST_Celsius';
    const palette  = normalizedType === 'ndvi'
      ? ['red', 'yellow', 'green']
      : ['040274', '2c7bb6', 'abd9e9', 'ffffbf', 'fdae61', 'd7191c', '7a0403'];

    // Deret tahunan dan komposit rata-rata tahunan hanya memakai tahun kalender
    // penuh — lihat resolveFullYearRange() di validator.
    const startYear = baselineStartYear;
    const endYear   = baselineEndYear;

    const { finalImage, baselineImage } = buildFinalImage({
      dualCollection,
      mode: normalizedMode,
      reducer: normalizedReducer,
      gapFill: normalizedGapFill,
      mainBand,
      geometry,
      targetYear: clampedTargetYear,
      startYear,
      endYear,
    });

    if (!finalImage) {
      return res.status(404).json({ error: 'Tidak ada data citra pada rentang waktu/wilayah tersebut.' });
    }

    // ── 5. Parallel GEE evaluation ───────────────────────────────────────────
    const visParams = { min: visMin, max: visMax, palette };

    const fullPayload = await withTimeout(
      runGeeEvaluation({
        finalImage, baselineImage, mainBand, geometry, visParams, thresholdVal,
        dualCollection, startYear, endYear,
        seriesStartYear, seriesEndYear, hasFullYear,
        startDateInput, endDateInput,
        mode: normalizedMode, normalizedType,
        targetYear: clampedTargetYear,
      }),
      REQUEST_TIMEOUT_MS
    );

    // runGeeEvaluation returns null when getMap fails (no valid pixels)
    if (!fullPayload) {
      return res.status(422).json({
        error: 'Tidak ada piksel valid pada rentang waktu/wilayah tersebut. Coba perluas rentang tanggal atau naikkan batas tutupan awan.',
      });
    }

    // ── 6. Cache & respond ───────────────────────────────────────────────────
    // Yang disimpan adalah payload lengkap semua wilayah; yang dikirim hanya
    // potongan wilayah yang diminta. processing_time_ms sengaja tidak ikut
    // di-cache supaya cache HIT melaporkan durasi lookup-nya sendiri.
    setCache(cacheKey, fullPayload);
    return res.status(200).json({
      ...selectRegion(fullPayload, normalizedRegion),
      processing_time_ms: elapsedMs(),
    });

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
