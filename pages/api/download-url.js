// pages/api/download-url.js
// Membuat URL unduhan GeoTIFF untuk satu wilayah, dipanggil saat tombol unduh ditekan.
//
// Dipisahkan dari /api/map-layer karena getDownloadURL terikat pada geometri
// wilayah, sementara payload map-layer sengaja dibuat lintas wilayah agar bisa
// dipakai ulang dari cache. Memisahkannya juga memperpendek jalur kritis
// permintaan utama — satu panggilan evaluate() lebih sedikit.
import { authenticate, withTimeout, TIMEOUT_ERROR_TAG } from '../../lib/gee/auth';
import { parseQueryParams, safeErrorLog } from '../../lib/validators/queryParams';
import { resolveGeometry, buildDualCollection, buildFinalImage } from '../../lib/gee/compute';

const REQUEST_TIMEOUT_MS = 120_000; // 2 menit

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Gunakan GET.' });
  }

  try {
    const params = parseQueryParams(req.query);
    if (params.error) {
      return res.status(params.status).json({ error: params.error });
    }

    const {
      normalizedType, normalizedMode, normalizedReducer, normalizedGapFill,
      normalizedRegion, startDateInput, endDateInput, startDateObj, endDateObj,
      cloudThreshold, clampedTargetYear,
    } = params;

    await authenticate();

    // Model dicocokkan atas seluruh Bali (sama seperti peta), lalu ekspornya
    // dibatasi ke wilayah terpilih — supaya angka di berkas unduhan identik
    // dengan yang tampil di layar.
    const baliGeometry   = resolveGeometry('ALL');
    const regionGeometry = resolveGeometry(normalizedRegion);

    const dualCollection = buildDualCollection(
      baliGeometry, startDateInput, endDateInput, cloudThreshold
    );

    const mainBand = normalizedType === 'ndvi' ? 'NDVI' : 'LST_Celsius';

    const { finalImage } = buildFinalImage({
      dualCollection,
      mode: normalizedMode,
      reducer: normalizedReducer,
      gapFill: normalizedGapFill,
      mainBand,
      geometry: baliGeometry,
      targetYear: clampedTargetYear,
      startYear: startDateObj.getUTCFullYear(),
      endYear: endDateObj.getUTCFullYear(),
    });

    const name = `${normalizedType.toUpperCase()}_${normalizedRegion === 'ALL' ? 'BALI' : normalizedRegion}`;

    const downloadUrl = await withTimeout(
      new Promise((resolve) => {
        finalImage.select(mainBand).getDownloadURL(
          { name, scale: 500, crs: 'EPSG:4326', region: regionGeometry },
          (url, err) => resolve(err ? null : url)
        );
      }),
      REQUEST_TIMEOUT_MS
    );

    if (!downloadUrl) {
      return res.status(422).json({ error: 'Gagal menyiapkan berkas unduhan untuk wilayah ini.' });
    }

    return res.status(200).json({ downloadUrl });

  } catch (error) {
    safeErrorLog('GEE download URL error (sanitized response):', {
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });

    if (error?.code === TIMEOUT_ERROR_TAG) {
      return res.status(504).json({ error: 'TIMEOUT', message: 'Proses GEE memakan waktu lebih dari 2 menit.' });
    }

    return res.status(500).json({ error: 'Terjadi kesalahan internal saat menyiapkan unduhan.' });
  }
}
