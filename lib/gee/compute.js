// lib/gee/compute.js
// GEE computation logic: geometry resolution, image processing, and parallel evaluation.
import ee from '@google/earthengine';
import baliGeoJSON from '../../public/data/bali_kabkota.json';

/**
 * Resolve a geometry from region name.
 * Returns an ee.Geometry for the given kabupaten/kota, or the
 * bounding box of Bali Province if region === 'ALL'.
 *
 * @param {string} normalizedRegion  'ALL' or uppercase kabupaten name
 * @returns {ee.Geometry}
 */
export function resolveGeometry(normalizedRegion) {
  if (normalizedRegion === 'ALL') {
    const baliProvince = ee.FeatureCollection('FAO/GAUL/2015/level1').filter(
      ee.Filter.eq('ADM1_NAME', 'Bali')
    );
    return baliProvince.geometry();
  }

  const feature = baliGeoJSON.features.find(
    (f) => String(f?.properties?.nm_kabkota || '').toUpperCase() === normalizedRegion.toUpperCase()
  );

  // Fallback ke bounding box Bali jika fitur tidak ditemukan
  return feature
    ? ee.Geometry(feature.geometry)
    : ee.Geometry.Rectangle([114.4, -8.9, 115.7, -8.0]);
}

/**
 * Build a cloud-masked, dual-band (NDVI + LST_Celsius) ImageCollection
 * from Landsat 8/9 C2L2.
 *
 * @param {ee.Geometry} geometry
 * @param {string} startDateStr  'YYYY-MM-DD'
 * @param {string} endDateStr    'YYYY-MM-DD'
 * @param {number} cloudThreshold  0–100
 * @returns {ee.ImageCollection}
 */
export function buildDualCollection(geometry, startDateStr, endDateStr, cloudThreshold) {
  const maskClouds = (image) => {
    const qa = image.select('QA_PIXEL');
    const mask = qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 4).eq(0));
    return image.updateMask(mask);
  };

  const raw = ee
    .ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterBounds(geometry)
    .filterDate(startDateStr, endDateStr)
    .filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold))
    .map(maskClouds);

  return raw.map((img) => {
    const optical = img.select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5']).multiply(0.0000275).add(-0.2);
    const ndvi = optical.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
    const lst = img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15).rename('LST_Celsius');
    return img.addBands([ndvi, lst]).copyProperties(img, ['system:time_start']);
  });
}

/**
 * Compute the final map image (history or prediction).
 *
 * @param {ee.ImageCollection} dualCollection
 * @param {string} mode         'history' | 'prediksi'
 * @param {string} reducer      'Median' | 'Mean' | 'Max' | 'Mosaic'
 * @param {string} gapFill      'none' | 'spatial'
 * @param {string} mainBand     'NDVI' | 'LST_Celsius'
 * @param {ee.Geometry} geometry
 * @param {number} targetYear
 * @returns {{ finalImage: ee.Image, baselineStats: ee.Dictionary }}
 */
export function buildFinalImage(dualCollection, mode, reducer, gapFill, mainBand, geometry, targetYear) {
  let finalImage;
  let baselineStats = ee.Dictionary({});

  if (mode === 'prediksi') {
    const collectionWithTime = dualCollection.map((img) => {
      const date = img.date();
      const fractionalYear = date.get('year').add(date.getFraction('year'));
      return img.addBands(ee.Image.constant(fractionalYear).rename('time').toFloat());
    });

    const trend = collectionWithTime.select(['time', mainBand]).reduce(ee.Reducer.linearFit());
    finalImage = trend.select('scale').multiply(targetYear).add(trend.select('offset')).rename(mainBand);

    const baselineMeanImage = dualCollection.select(mainBand).mean().clip(geometry);
    baselineStats = baselineMeanImage.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry,
      scale: 200,
      bestEffort: true,
      maxPixels: 1e9,
    });
  } else {
    if (reducer === 'Mean') finalImage = dualCollection.mean();
    else if (reducer === 'Max') finalImage = dualCollection.max();
    else if (reducer === 'Mosaic') finalImage = dualCollection.mosaic();
    else finalImage = dualCollection.median();

    // Spatial gap filling (focal mean, hanya di mode history)
    if (gapFill === 'spatial') {
      const filled = finalImage.focal_mean({ radius: 2, kernelType: 'square', units: 'pixels', iterations: 2 });
      finalImage = finalImage.unmask(filled);
    }
  }

  return { finalImage: finalImage.clip(geometry), baselineStats };
}

/**
 * Run all GEE evaluate() calls in parallel and return structured results.
 *
 * @param {ee.Image}            finalImage
 * @param {string}              mainBand
 * @param {ee.Geometry}         geometry
 * @param {object}              visParams    { min, max, palette }
 * @param {number}              thresholdVal
 * @param {ee.ImageCollection}  dualCollection
 * @param {Date}                startDateObj
 * @param {Date}                endDateObj
 * @param {ee.Dictionary}       baselineStats
 * @param {string}              mode
 * @param {string}              normalizedType
 * @param {string}              normalizedRegion
 * @param {number}              targetYear
 * @returns {Promise<object>}   Structured response payload
 */
export async function runGeeEvaluation({
  finalImage,
  mainBand,
  geometry,
  visParams,
  thresholdVal,
  dualCollection,
  startDateObj,
  endDateObj,
  baselineStats,
  mode,
  normalizedType,
  normalizedRegion,
  targetYear,
}) {
  function safeErrorLog(msg, extra = {}) {
    try { console.error(msg, extra); } catch { console.error(msg); }
  }

  // ── Computed GEE Objects ──────────────────────────────────────────────────
  const aggregateStats = finalImage.select(mainBand).reduceRegion({
    reducer: ee.Reducer.mean().combine({ reducer2: ee.Reducer.minMax(), sharedInputs: true }),
    geometry,
    scale: 200,
    bestEffort: true,
    maxPixels: 1e9,
  });

  const impactStats = finalImage.select(mainBand).gt(thresholdVal)
    .multiply(ee.Image.pixelArea())
    .reduceRegion({ reducer: ee.Reducer.sum(), geometry, scale: 200, maxPixels: 1e9, bestEffort: true });

  const startYear = startDateObj.getUTCFullYear();
  const endYear = endDateObj.getUTCFullYear();
  const years = ee.List.sequence(startYear, endYear);

  const timeSeriesList = ee.FeatureCollection(
    years.map((year) => {
      const yearStart = ee.Date.fromYMD(year, 1, 1);
      const yearEnd = ee.Date.fromYMD(ee.Number(year).add(1), 1, 1);
      const yearMean = dualCollection.filterDate(yearStart, yearEnd).mean();
      const yearValue = yearMean.reduceRegion({
        reducer: ee.Reducer.mean(), geometry, scale: 500, bestEffort: true,
      }).get(mainBand);
      return ee.Feature(null, { date_millis: yearStart.millis(), value: yearValue });
    })
  );

  const samplePoints = finalImage.select(['NDVI', 'LST_Celsius']).sample({
    region: geometry, scale: 200, numPixels: 150, geometries: false,
  });

  // ── Parallel evaluate() ───────────────────────────────────────────────────
  const [mapId, statsRaw, chartRaw, downloadUrl, impactRaw, scatterRaw, baselineRaw] =
    await Promise.all([
      // getMap — non-fatal: resolve null on error
      new Promise((resolve) =>
        finalImage.select(mainBand).getMap(visParams, (map, err) => {
          if (err) { safeErrorLog('getMap error (non-fatal):', { message: err?.message }); resolve(null); }
          else resolve(map);
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
        if (mode === 'prediksi') return resolve({ features: [] });
        samplePoints.evaluate((val) => resolve(val || { features: [] }));
      }),
      new Promise((resolve) => baselineStats.evaluate((val) => resolve(val || {}))),
    ]);

  // ── Shape payload ─────────────────────────────────────────────────────────
  if (!mapId) return null; // caller handles 422

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

  return {
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
      is_prediction: mode === 'prediksi',
      target_year: targetYear,
    },
    chart: sortedChartData,
    scatter: scatterData,
    downloadUrl,
  };
}
