// pages/api/map-layer.js
import ee from '@google/earthengine';
import baliGeoJSON from '../../public/data/bali_kabkota.json';

const authenticate = () => {
  return new Promise((resolve, reject) => {
    if (!process.env.GEE_PRIVATE_KEY || !process.env.GEE_CLIENT_EMAIL) {
      return reject("Credential GEE tidak ditemukan.");
    }
    const privateKey = process.env.GEE_PRIVATE_KEY.replace(/\\n/g, '\n');
    ee.data.authenticateViaPrivateKey(
      { private_key: privateKey, client_email: process.env.GEE_CLIENT_EMAIL },
      () => ee.initialize(null, null, resolve, reject),
      (error) => reject(error)
    );
  });
};

export default async function handler(req, res) {
  try {
    await authenticate();

    // BARU: Menambahkan penangkapan parameter gap_fill dari request query
    const {
      type, start_date, end_date, region_name,
      cloud_cover, reducer, vis_min, vis_max, threshold,
      mode, target_year, gap_fill
    } = req.query;

    let geometry;
    let startDate = start_date || '2024-01-01';
    let endDate = end_date || '2024-12-31';
    let cloudThreshold = parseInt(cloud_cover) || 20;
    let reducerMethod = reducer || 'Median';

    const visMin = parseFloat(vis_min) || (type === 'ndvi' ? -1 : 20);
    const visMax = parseFloat(vis_max) || (type === 'ndvi' ? 1 : 45);
    const thresholdVal = parseFloat(threshold) || (type === 'ndvi' ? 0.5 : 30.0);

    // 1. SETUP GEOMETRI (Menggunakan FAO GAUL bawaan GEE untuk ADM1)
    if (region_name === 'ALL') {
      const baliProvince = ee.FeatureCollection("FAO/GAUL/2015/level1")
        .filter(ee.Filter.eq('ADM1_NAME', 'Bali'));
      geometry = baliProvince.geometry();
    } else if (region_name) {
      const feature = baliGeoJSON.features.find(f =>
        f.properties.nm_kabkota.toUpperCase() === region_name.toUpperCase()
      );
      if (feature) geometry = ee.Geometry(feature.geometry);
    }

    if (!geometry) geometry = ee.Geometry.Rectangle([114.4, -8.9, 115.7, -8.0]);

    // 2. FILTER KOLEKSI
    let collection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
      .filterBounds(geometry)
      .filterDate(startDate, endDate)
      .filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold));

    // 3. MASKING AWAN
    const maskClouds = (image) => {
      const qa = image.select('QA_PIXEL');
      const mask = qa.bitwiseAnd(1 << 3).eq(0)
        .and(qa.bitwiseAnd(1 << 4).eq(0));
      return image.updateMask(mask);
    };
    collection = collection.map(maskClouds);

    // 4. HITUNG BANDS
    const dualCollection = collection.map(img => {
      const optical = img.select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5'])
        .multiply(0.0000275).add(-0.2);
      const ndvi = optical.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
      const lst = img.select('ST_B10')
        .multiply(0.00341802).add(149.0).subtract(273.15)
        .rename('LST_Celsius');
      return img.addBands([ndvi, lst]).copyProperties(img, ['system:time_start']);
    });

    const mainBand = type === 'ndvi' ? 'NDVI' : 'LST_Celsius';
    const palette = type === 'ndvi'
      ? ['red', 'yellow', 'green']
      : ['040274', '2c7bb6', 'abd9e9', 'ffffbf', 'fdae61', 'd7191c', '7a0403'];

    // 5. COMPOSITE STRATEGY
    let finalImage;
    let baselineStats = ee.Dictionary({}); // Untuk menampung rata-rata masa lalu

    if (mode === 'prediksi') {
      const targetYearNum = parseFloat(target_year) || new Date().getFullYear() + 5;

      const collectionWithTime = dualCollection.map(img => {
        const date = img.date();
        const year = date.get('year');
        const fraction = date.getFraction('year');
        const fractionalYear = year.add(fraction);
        return img.addBands(ee.Image.constant(fractionalYear).rename('time').toFloat());
      });

      const trend = collectionWithTime.select(['time', mainBand]).reduce(ee.Reducer.linearFit());

      finalImage = trend.select('scale').multiply(targetYearNum)
        .add(trend.select('offset'))
        .rename(mainBand);

      // Hitung mean baseline untuk komparasi delta
      const baselineMeanImage = dualCollection.select(mainBand).mean().clip(geometry);
      baselineStats = baselineMeanImage.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry, scale: 200, bestEffort: true, maxPixels: 1e9
      });
    } else {
      if (reducerMethod === 'Mean') finalImage = dualCollection.mean();
      else if (reducerMethod === 'Max') finalImage = dualCollection.max();
      else if (reducerMethod === 'Mosaic') finalImage = dualCollection.mosaic();
      else finalImage = dualCollection.median();
    }

    if (!finalImage) {
      throw new Error("Tidak ada data citra pada rentang waktu/wilayah tersebut.");
    }

    // BARU: Implementasi Gap Filling menggunakan Interpolasi Spasial (Focal Mean)
    // Berlaku hanya jika user memilih metode 'spatial' dan BUKAN dalam mode prediksi
    if (gap_fill === 'spatial' && mode !== 'prediksi') {
      const gapFillRadius = 2;
      const filledImage = finalImage.focal_mean({
        radius: gapFillRadius,
        kernelType: 'square',
        units: 'pixels',
        iterations: 2
      });
      finalImage = finalImage.unmask(filledImage);
    }

    finalImage = finalImage.clip(geometry);

    // 6. STATS & OUTPUT
    const aggregateStats = finalImage.select(mainBand).reduceRegion({
      reducer: ee.Reducer.mean().combine({ reducer2: ee.Reducer.minMax(), sharedInputs: true }),
      geometry: geometry, scale: 200, bestEffort: true, maxPixels: 1e9
    });

    const mask = finalImage.select(mainBand).gt(thresholdVal);
    const impactStats = mask.multiply(ee.Image.pixelArea()).reduceRegion({
      reducer: ee.Reducer.sum(), geometry: geometry, scale: 200, maxPixels: 1e9, bestEffort: true
    });

    const timeSeriesList = dualCollection.limit(50).map(img => {
      return ee.Feature(null, {
        'date_millis': img.date().millis(),
        'value': img.reduceRegion({
          reducer: ee.Reducer.mean(), geometry: geometry, scale: 500, bestEffort: true
        }).get(mainBand)
      });
    });

    const samplePoints = finalImage.select(['NDVI', 'LST_Celsius'] || []).sample({
      region: geometry, scale: 200, numPixels: 150, geometries: false
    });

    const visParams = { min: visMin, max: visMax, palette: palette };

    const [mapId, statsRaw, chartRaw, downloadUrl, impactRaw, scatterRaw, baselineRaw] = await Promise.all([
      new Promise((resolve, reject) => finalImage.select(mainBand).getMap(visParams, (map, err) => err ? reject(err) : resolve(map))),
      new Promise((resolve) => aggregateStats.evaluate((val, err) => resolve(val || {}))),
      new Promise((resolve) => timeSeriesList.evaluate((val, err) => resolve(val || { features: [] }))),
      new Promise((resolve) => {
        finalImage.select(mainBand).getDownloadURL({
          name: `${type.toUpperCase()}_${region_name === 'ALL' ? 'BALI' : region_name}`, scale: 500, crs: 'EPSG:4326', region: geometry
        }, (url, err) => resolve(err ? null : url));
      }),
      new Promise((resolve) => impactStats.evaluate((val, err) => resolve(val || {}))),
      new Promise((resolve) => {
        if (mode === 'prediksi') return resolve({ features: [] });
        samplePoints.evaluate((val, err) => resolve(val || { features: [] }));
      }),
      new Promise((resolve) => baselineStats.evaluate((val, err) => resolve(val || {})))
    ]);

    const sortedChartData = (chartRaw.features || [])
      .map(f => {
        const d = new Date(f.properties.date_millis);
        return {
          date: d.toISOString().split('T')[0],
          value: f.properties.value
        };
      })
      .filter(d => d.value !== null)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const scatterData = (scatterRaw.features || []).map(f => ({
      ndvi: f.properties.NDVI,
      lst: f.properties.LST_Celsius
    })).filter(d => d.ndvi !== null && d.lst !== null);

    const areaHa = (impactRaw[mainBand] || 0) / 10000;

    res.status(200).json({
      map: mapId,
      stats: {
        mean: statsRaw[`${mainBand}_mean`] || 0,
        min: statsRaw[`${mainBand}_min`] || 0,
        max: statsRaw[`${mainBand}_max`] || 0,
        baseline_mean: baselineRaw[mainBand] !== undefined ? baselineRaw[mainBand] : 0,
        unit: type === 'ndvi' ? 'Index' : '°C',
        region: region_name === 'ALL' ? 'SELURUH BALI' : region_name,
        threshold: thresholdVal,
        impact_area_ha: areaHa,
        is_prediction: mode === 'prediksi',
        target_year: target_year
      },
      chart: sortedChartData,
      scatter: scatterData,
      downloadUrl: downloadUrl
    });

  } catch (error) {
    console.error("GEE Error:", error);
    res.status(500).json({ error: error.message });
  }
}