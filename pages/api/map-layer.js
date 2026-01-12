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

    const { 
      type, start_date, end_date, region_name, 
      cloud_cover, reducer, vis_min, vis_max, threshold 
    } = req.query;

    const startDate = start_date || '2024-01-01';
    const endDate = end_date || '2024-12-31';
    const cloudThreshold = parseInt(cloud_cover) || 20; 
    const reducerMethod = reducer || 'Median'; 
    const visMin = parseFloat(vis_min) || (type === 'ndvi' ? -1 : 20);
    const visMax = parseFloat(vis_max) || (type === 'ndvi' ? 1 : 45);
    const thresholdVal = parseFloat(threshold) || (type === 'ndvi' ? 0.5 : 30.0);

    // 1. Setup Geometri
    let geometry;
    if (region_name && region_name !== 'ALL') {
      const feature = baliGeoJSON.features.find(f => 
        f.properties.nm_kabkota.toUpperCase() === region_name.toUpperCase()
      );
      if (feature) geometry = ee.Geometry(feature.geometry);
    }
    if (!geometry) geometry = ee.Geometry.Rectangle([114.4, -8.9, 115.7, -8.0]);

    // 2. Engine Landsat 8/9 (Base Collection)
    let collection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
      .filterBounds(geometry)
      .filterDate(startDate, endDate)
      .filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold));

    // 3. HITUNG DUAL BAND (LST & NDVI SEKALIGUS)
    // Kita butuh keduanya untuk Scatter Plot, apapun yang dipilih user untuk Peta
    const dualCollection = collection.map(img => {
      // a. Hitung NDVI
      const optical = img.select(['SR_B2','SR_B3','SR_B4','SR_B5'])
        .multiply(0.0000275).add(-0.2);
      const ndvi = optical.normalizedDifference(['SR_B5','SR_B4']).rename('NDVI');
      
      // b. Hitung LST
      const lst = img.select('ST_B10')
        .multiply(0.00341802).add(149.0).subtract(273.15)
        .rename('LST_Celsius');
      
      return img.addBands([ndvi, lst]).copyProperties(img, ['system:time_start']);
    });

    // Tentukan Band Utama untuk Visualisasi Peta
    const mainBand = type === 'ndvi' ? 'NDVI' : 'LST_Celsius';
    const palette = type === 'ndvi' 
      ? ['red', 'yellow', 'green'] 
      : ['040274','2c7bb6','abd9e9','ffffbf','fdae61','d7191c','7a0403'];

    // 4. Time Series Data (Hanya untuk Band Utama)
    const timeSeriesList = dualCollection.map(img => {
      const date = img.date().format('YYYY-MM-DD');
      const stats = img.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 100, 
        maxPixels: 1e9,
        bestEffort: true
      });
      return ee.Feature(null, { 'date': date, 'value': stats.get(mainBand) });
    });

    // 5. Composite Reducer
    let finalImage;
    if (reducerMethod === 'Mean') finalImage = dualCollection.mean();
    else if (reducerMethod === 'Max') finalImage = dualCollection.max();
    else if (reducerMethod === 'Mosaic') finalImage = dualCollection.mosaic();
    else finalImage = dualCollection.median();

    finalImage = finalImage.clip(geometry);

    // 6. Hitung Statistik Area & Impact
    const aggregateStats = finalImage.select(mainBand).reduceRegion({
      reducer: ee.Reducer.mean().combine({
        reducer2: ee.Reducer.minMax(),
        sharedInputs: true
      }),
      geometry: geometry,
      scale: 100,
      bestEffort: true,
      maxPixels: 1e9
    });

    const mask = finalImage.select(mainBand).gt(thresholdVal);
    const impactStats = mask.multiply(ee.Image.pixelArea()).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: geometry,
      scale: 100,
      maxPixels: 1e9,
      bestEffort: true
    });

    // --- FITUR BARU: SAMPLING UNTUK SCATTER PLOT ---
    // Mengambil 300 titik acak yang memiliki nilai LST dan NDVI
    const samplePoints = finalImage.select(['NDVI', 'LST_Celsius']).sample({
      region: geometry,
      scale: 100, // Resolusi sampling
      numPixels: 300, // Ambil 300 titik saja agar ringan
      geometries: false // Tidak butuh koordinat, cuma butuh nilai
    });
    // ----------------------------------------------

    // 7. Parallel Processing
    const visParams = { min: visMin, max: visMax, palette: palette };

    const [mapId, statsRaw, chartRaw, downloadUrl, impactRaw, scatterRaw] = await Promise.all([
      new Promise((resolve, reject) => finalImage.select(mainBand).getMap(visParams, (map, err) => err ? reject(err) : resolve(map))),
      new Promise((resolve, reject) => aggregateStats.evaluate((val, err) => err ? reject(err) : resolve(val))),
      new Promise((resolve, reject) => timeSeriesList.evaluate((val, err) => err ? reject(err) : resolve(val))),
      new Promise((resolve) => {
        finalImage.select(mainBand).getDownloadURL({
          name: `${type.toUpperCase()}_${region_name}_${startDate}`,
          scale: 100,
          crs: 'EPSG:4326',
          region: geometry
        }, (url, err) => resolve(err ? null : url));
      }),
      new Promise((resolve, reject) => impactStats.evaluate((val, err) => err ? reject(err) : resolve(val))),
      // New: Evaluasi Scatter Plot
      new Promise((resolve, reject) => samplePoints.evaluate((val, err) => err ? reject(err) : resolve(val)))
    ]);

    // 8. Response Formatting
    const sortedChartData = chartRaw.features
      .map(f => ({ date: f.properties.date, value: f.properties.value }))
      .filter(d => d.value !== null)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Format Scatter Data
    const scatterData = scatterRaw.features.map(f => ({
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
        unit: type === 'ndvi' ? 'Index' : '°C',
        region: region_name,
        threshold: thresholdVal,
        impact_area_ha: areaHa
      },
      chart: sortedChartData,
      scatter: scatterData, // Data Korelasi dikirim ke frontend
      downloadUrl: downloadUrl
    });

  } catch (error) {
    console.error("GEE Error:", error);
    res.status(500).json({ error: error.message });
  }
}