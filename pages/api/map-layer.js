// pages/api/map-layer.js
import ee from '@google/earthengine';
import baliGeoJSON from '../../public/data/bali_kabkota.json';

const ALLOWED_TYPES = new Set(['lst', 'ndvi']);
const ALLOWED_MODES = new Set(['history', 'prediksi']);
const ALLOWED_REDUCERS = new Set(['Median', 'Mean', 'Max', 'Mosaic']);
const ALLOWED_GAP_FILL = new Set(['none', 'spatial']);
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MIN_ALLOWED_DATE = new Date('2013-01-01T00:00:00.000Z');
const REQUEST_TIMEOUT_MS = 120_000; // 2 menit — GEE bisa memakan 30-120 detik untuk wilayah besar
const TIMEOUT_ERROR_TAG = 'GEE_TIMEOUT';
const MAX_QUERY_SIZE_BYTES = 2048;

let geeAuthPromise = null;

const REGION_NAMES = new Set(
  (baliGeoJSON?.features || [])
    .map((f) => f?.properties?.nm_kabkota)
    .filter(Boolean)
    .map((n) => String(n).toUpperCase())
);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeErrorLog(message, extra = {}) {
  try {
    console.error(message, extra);
  } catch {
    console.error(message);
  }
}

function validateDateString(value, fieldName) {
  if (!value || !DATE_REGEX.test(value)) {
    throw new Error(`Format ${fieldName} harus YYYY-MM-DD.`);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${fieldName} tidak valid.`);
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (d < MIN_ALLOWED_DATE || d > today) {
    throw new Error(`${fieldName} di luar rentang yang diizinkan.`);
  }
  return d;
}

function getTotalQuerySize(queryObj) {
  return Object.entries(queryObj || {}).reduce((acc, [k, v]) => {
    const keyLen = String(k || '').length;
    const valLen = Array.isArray(v)
      ? v.map((x) => String(x || '').length).reduce((a, b) => a + b, 0)
      : String(v || '').length;
    return acc + keyLen + valLen;
  }, 0);
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        const err = new Error('Proses GEE melebihi batas waktu. GEE sedang memproses di server — coba lagi dalam beberapa detik.');
        err.code = TIMEOUT_ERROR_TAG;
        reject(err);
      }, timeoutMs);
    }),
  ]);
}

const authenticate = async () => {
  if (geeAuthPromise) return geeAuthPromise;

  geeAuthPromise = new Promise((resolve, reject) => {
    if (!process.env.GEE_PRIVATE_KEY || !process.env.GEE_CLIENT_EMAIL) {
      reject(new Error('Credential GEE tidak ditemukan.'));
      return;
    }

    const privateKey = process.env.GEE_PRIVATE_KEY.replace(/\\n/g, '\n');

    ee.data.authenticateViaPrivateKey(
      { private_key: privateKey, client_email: process.env.GEE_CLIENT_EMAIL },
      () => ee.initialize(null, null, resolve, reject),
      (error) => reject(error)
    );
  }).catch((err) => {
    geeAuthPromise = null;
    throw err;
  });

  return geeAuthPromise;
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Gunakan GET.' });
  }

  try {
    const querySize = getTotalQuerySize(req.query);
    if (querySize > MAX_QUERY_SIZE_BYTES) {
      return res.status(400).json({ error: 'Ukuran query terlalu besar (maks 2KB).' });
    }

    const {
      type,
      start_date,
      end_date,
      region_name,
      cloud_cover,
      reducer,
      vis_min,
      vis_max,
      threshold,
      mode,
      target_year,
      gap_fill,
    } = req.query;

    const normalizedType = String(type || 'lst').toLowerCase();
    const normalizedMode = String(mode || 'history').toLowerCase();
    const normalizedReducer = String(reducer || 'Median');
    const normalizedGapFill = String(gap_fill || 'none').toLowerCase();
    const normalizedRegion = String(region_name || 'ALL');

    if (!ALLOWED_TYPES.has(normalizedType)) {
      return res.status(400).json({ error: 'Parameter type tidak valid.' });
    }
    if (!ALLOWED_MODES.has(normalizedMode)) {
      return res.status(400).json({ error: 'Parameter mode tidak valid.' });
    }
    if (!ALLOWED_REDUCERS.has(normalizedReducer)) {
      return res.status(400).json({ error: 'Parameter reducer tidak valid.' });
    }
    if (!ALLOWED_GAP_FILL.has(normalizedGapFill)) {
      return res.status(400).json({ error: 'Parameter gap_fill tidak valid.' });
    }

    if (normalizedRegion.length > 100) {
      return res.status(400).json({ error: 'region_name terlalu panjang.' });
    }

    if (normalizedRegion !== 'ALL' && !REGION_NAMES.has(normalizedRegion.toUpperCase())) {
      return res.status(400).json({ error: 'region_name tidak dikenali.' });
    }

    const startDateInput = String(start_date || '2024-01-01');
    const endDateInput = String(end_date || '2024-12-31');

    const startDateObj = validateDateString(startDateInput, 'start_date');
    const endDateObj = validateDateString(endDateInput, 'end_date');

    if (startDateObj >= endDateObj) {
      return res.status(400).json({ error: 'start_date harus lebih kecil dari end_date.' });
    }

    const nowYear = new Date().getFullYear();
    const parsedCloud = Number.parseInt(String(cloud_cover ?? '20'), 10);
    const cloudThreshold = Number.isNaN(parsedCloud) ? 20 : clamp(parsedCloud, 0, 100);

    const parsedTargetYear = Number.parseInt(String(target_year ?? `${nowYear + 5}`), 10);
    const clampedTargetYear = Number.isNaN(parsedTargetYear)
      ? nowYear + 5
      : clamp(parsedTargetYear, nowYear + 1, nowYear + 50);

    const defaultVisMin = normalizedType === 'ndvi' ? -1 : 20;
    const defaultVisMax = normalizedType === 'ndvi' ? 1 : 45;
    const visMinBounds = normalizedType === 'ndvi' ? [-1, 1] : [-50, 80];
    const visMaxBounds = normalizedType === 'ndvi' ? [-1, 1] : [-50, 80];

    const parsedVisMin = Number.parseFloat(String(vis_min ?? `${defaultVisMin}`));
    const parsedVisMax = Number.parseFloat(String(vis_max ?? `${defaultVisMax}`));

    const visMin = Number.isNaN(parsedVisMin)
      ? defaultVisMin
      : clamp(parsedVisMin, visMinBounds[0], visMinBounds[1]);

    const visMax = Number.isNaN(parsedVisMax)
      ? defaultVisMax
      : clamp(parsedVisMax, visMaxBounds[0], visMaxBounds[1]);

    if (visMin >= visMax) {
      return res.status(400).json({ error: 'vis_min harus lebih kecil dari vis_max.' });
    }

    const defaultThreshold = normalizedType === 'ndvi' ? 0.5 : 30.0;
    const parsedThreshold = Number.parseFloat(String(threshold ?? `${defaultThreshold}`));
    const thresholdVal = Number.isNaN(parsedThreshold) ? defaultThreshold : parsedThreshold;

    await authenticate();

    let geometry;

    if (normalizedRegion === 'ALL') {
      const baliProvince = ee.FeatureCollection('FAO/GAUL/2015/level1').filter(
        ee.Filter.eq('ADM1_NAME', 'Bali')
      );
      geometry = baliProvince.geometry();
    } else {
      const feature = baliGeoJSON.features.find(
        (f) => String(f?.properties?.nm_kabkota || '').toUpperCase() === normalizedRegion.toUpperCase()
      );
      if (feature) geometry = ee.Geometry(feature.geometry);
    }

    if (!geometry) {
      geometry = ee.Geometry.Rectangle([114.4, -8.9, 115.7, -8.0]);
    }

    let collection = ee
      .ImageCollection('LANDSAT/LC08/C02/T1_L2')
      .filterBounds(geometry)
      .filterDate(startDateInput, endDateInput)
      .filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold));

    const maskClouds = (image) => {
      const qa = image.select('QA_PIXEL');
      const mask = qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 4).eq(0));
      return image.updateMask(mask);
    };

    collection = collection.map(maskClouds);

    const dualCollection = collection.map((img) => {
      const optical = img.select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5']).multiply(0.0000275).add(-0.2);
      const ndvi = optical.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
      const lst = img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15).rename('LST_Celsius');
      return img.addBands([ndvi, lst]).copyProperties(img, ['system:time_start']);
    });

    const mainBand = normalizedType === 'ndvi' ? 'NDVI' : 'LST_Celsius';
    const palette =
      normalizedType === 'ndvi'
        ? ['red', 'yellow', 'green']
        : ['040274', '2c7bb6', 'abd9e9', 'ffffbf', 'fdae61', 'd7191c', '7a0403'];

    let finalImage;
    let baselineStats = ee.Dictionary({});

    if (normalizedMode === 'prediksi') {
      const collectionWithTime = dualCollection.map((img) => {
        const date = img.date();
        const year = date.get('year');
        const fraction = date.getFraction('year');
        const fractionalYear = year.add(fraction);
        return img.addBands(ee.Image.constant(fractionalYear).rename('time').toFloat());
      });

      const trend = collectionWithTime.select(['time', mainBand]).reduce(ee.Reducer.linearFit());

      finalImage = trend.select('scale').multiply(clampedTargetYear).add(trend.select('offset')).rename(mainBand);

      const baselineMeanImage = dualCollection.select(mainBand).mean().clip(geometry);
      baselineStats = baselineMeanImage.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry,
        scale: 200,
        bestEffort: true,
        maxPixels: 1e9,
      });
    } else {
      if (normalizedReducer === 'Mean') finalImage = dualCollection.mean();
      else if (normalizedReducer === 'Max') finalImage = dualCollection.max();
      else if (normalizedReducer === 'Mosaic') finalImage = dualCollection.mosaic();
      else finalImage = dualCollection.median();
    }

    if (!finalImage) {
      return res.status(404).json({ error: 'Tidak ada data citra pada rentang waktu/wilayah tersebut.' });
    }

    if (normalizedGapFill === 'spatial' && normalizedMode !== 'prediksi') {
      const gapFillRadius = 2;
      const filledImage = finalImage.focal_mean({
        radius: gapFillRadius,
        kernelType: 'square',
        units: 'pixels',
        iterations: 2,
      });
      finalImage = finalImage.unmask(filledImage);
    }

    finalImage = finalImage.clip(geometry);

    const aggregateStats = finalImage.select(mainBand).reduceRegion({
      reducer: ee.Reducer.mean().combine({ reducer2: ee.Reducer.minMax(), sharedInputs: true }),
      geometry,
      scale: 200,
      bestEffort: true,
      maxPixels: 1e9,
    });

    const mask = finalImage.select(mainBand).gt(thresholdVal);
    const impactStats = mask.multiply(ee.Image.pixelArea()).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry,
      scale: 200,
      maxPixels: 1e9,
      bestEffort: true,
    });

    // Agregasi tahunan: 1 titik per tahun agar tren tidak terpotong oleh limit citra
    const startYear = startDateObj.getUTCFullYear();
    const endYear = endDateObj.getUTCFullYear();
    const years = ee.List.sequence(startYear, endYear);

    const timeSeriesList = ee.FeatureCollection(
      years.map((year) => {
        const yearStart = ee.Date.fromYMD(year, 1, 1);
        const yearEnd = ee.Date.fromYMD(ee.Number(year).add(1), 1, 1);
        const yearCollection = dualCollection.filterDate(yearStart, yearEnd);
        const yearMean = yearCollection.mean();
        const yearValue = yearMean.reduceRegion({
          reducer: ee.Reducer.mean(),
          geometry,
          scale: 500,
          bestEffort: true,
        }).get(mainBand);
        return ee.Feature(null, {
          date_millis: yearStart.millis(),
          value: yearValue,
        });
      })
    );

    const samplePoints = finalImage.select(['NDVI', 'LST_Celsius']).sample({
      region: geometry,
      scale: 200,
      numPixels: 150,
      geometries: false,
    });

    const visParams = { min: visMin, max: visMax, palette };

    const geeExecution = Promise.all([
      // getMap: resolve(null) jika gagal agar tidak membatalkan seluruh Promise.all
      new Promise((resolve) =>
        finalImage.select(mainBand).getMap(visParams, (map, err) => {
          if (err) {
            safeErrorLog('getMap error (non-fatal):', { message: err?.message });
            resolve(null);
          } else {
            resolve(map);
          }
        })
      ),
      new Promise((resolve) => aggregateStats.evaluate((val) => resolve(val || {}))),
      new Promise((resolve) => timeSeriesList.evaluate((val) => resolve(val || { features: [] }))),
      new Promise((resolve) => {
        finalImage.select(mainBand).getDownloadURL(
          {
            name: `${normalizedType.toUpperCase()}_${normalizedRegion === 'ALL' ? 'BALI' : normalizedRegion}`,
            scale: 500,
            crs: 'EPSG:4326',
            region: geometry,
          },
          (url, err) => resolve(err ? null : url)
        );
      }),
      new Promise((resolve) => impactStats.evaluate((val) => resolve(val || {}))),
      new Promise((resolve) => {
        if (normalizedMode === 'prediksi') return resolve({ features: [] });
        samplePoints.evaluate((val) => resolve(val || { features: [] }));
      }),
      new Promise((resolve) => baselineStats.evaluate((val) => resolve(val || {}))),
    ]);

    const [mapId, statsRaw, chartRaw, downloadUrl, impactRaw, scatterRaw, baselineRaw] = await withTimeout(
      geeExecution,
      REQUEST_TIMEOUT_MS
    );

    // Jika getMap gagal (null), kembalikan error yang informatif
    if (!mapId) {
      return res.status(422).json({
        error: 'Tidak ada piksel valid pada rentang waktu/wilayah tersebut. Coba perluas rentang tanggal atau naikkan batas tutupan awan.',
      });
    }

    const sortedChartData = (chartRaw.features || [])
      .map((f) => {
        const d = new Date(f.properties.date_millis);
        return { date: d.toISOString().split('T')[0], value: f.properties.value };
      })
      .filter((d) => d.value !== null)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const scatterData = (scatterRaw.features || [])
      .map((f) => ({ ndvi: f.properties.NDVI, lst: f.properties.LST_Celsius }))
      .filter((d) => d.ndvi !== null && d.lst !== null);

    const areaHa = (impactRaw[mainBand] || 0) / 10000;

    return res.status(200).json({
      map: mapId,
      stats: {
        mean: statsRaw[`${mainBand}_mean`] || 0,
        min: statsRaw[`${mainBand}_min`] || 0,
        max: statsRaw[`${mainBand}_max`] || 0,
        baseline_mean: baselineRaw[mainBand] !== undefined ? baselineRaw[mainBand] : 0,
        unit: normalizedType === 'ndvi' ? 'Index' : '°C',
        region: normalizedRegion === 'ALL' ? 'SELURUH BALI' : normalizedRegion,
        threshold: thresholdVal,
        impact_area_ha: areaHa,
        is_prediction: normalizedMode === 'prediksi',
        target_year: clampedTargetYear,
      },
      chart: sortedChartData,
      scatter: scatterData,
      downloadUrl,
    });
  } catch (error) {
    safeErrorLog('GEE Error (sanitized response):', {
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });

    // Bedakan timeout dari error internal lainnya
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
