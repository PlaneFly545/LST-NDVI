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
      cloud_cover, reducer, vis_min, vis_max, threshold,
      mode 
    } = req.query;

    let geometry;
    let startDate = start_date || '2024-01-01';
    let endDate = end_date || '2024-12-31';
    let cloudThreshold = parseInt(cloud_cover) || 20; 
    let reducerMethod = reducer || 'Median'; 
    
    const visMin = parseFloat(vis_min) || (type === 'ndvi' ? -1 : 20);
    const visMax = parseFloat(vis_max) || (type === 'ndvi' ? 1 : 45);
    const thresholdVal = parseFloat(threshold) || (type === 'ndvi' ? 0.5 : 30.0);

    // 1. SETUP GEOMETRI
    if (region_name && region_name !== 'ALL') {
      const feature = baliGeoJSON.features.find(f => 
        f.properties.nm_kabkota.toUpperCase() === region_name.toUpperCase()
      );
      if (feature) geometry = ee.Geometry(feature.geometry);
    }
    if (!geometry) geometry = ee.Geometry.Rectangle([114.4, -8.9, 115.7, -8.0]);

    // 2. LOGIKA MODE REALTIME
    if (mode === 'realtime') {
      const end = new Date();
      const start = new Date();
      start.setMonth(end.getMonth() - 6); 
      startDate = start.toISOString().split('T')[0];
      endDate = end.toISOString().split('T')[0];
      
      if (req.query.cloud_cover) {
         cloudThreshold = parseInt(req.query.cloud_cover);
      } else {
         cloudThreshold = 30;
      }
    }

    // 3. FILTER KOLEKSI
    let collection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
      .filterBounds(geometry)
      .filterDate(startDate, endDate)
      .filter(ee.Filter.lt('CLOUD_COVER', mode === 'realtime' ? 80 : cloudThreshold));

    // 4. MASKING (Membolongi Awan)
    const maskClouds = (image) => {
      const qa = image.select('QA_PIXEL');
      const mask = qa.bitwiseAnd(1 << 3).eq(0)
        .and(qa.bitwiseAnd(1 << 4).eq(0));
      return image.updateMask(mask);
    };

    // 5. SCORING (Khusus Realtime)
    if (mode === 'realtime') {
      const scoreRegionCloud = (image) => {
        const qa = image.select('QA_PIXEL');
        const cloudParams = qa.bitwiseAnd(1 << 3).neq(0)
          .or(qa.bitwiseAnd(1 << 4).neq(0));
        
        const cloudScore = cloudParams.reduceRegion({
          reducer: ee.Reducer.mean(),
          geometry: geometry,
          scale: 500,
          maxPixels: 1e9,
          bestEffort: true
        });
        const pct = ee.Number(cloudScore.get('QA_PIXEL')).multiply(100);
        return image.set('roi_cloud_pct', pct);
      };

      collection = collection.map(scoreRegionCloud);
      collection = collection.filter(ee.Filter.lte('roi_cloud_pct', cloudThreshold));
    }

    collection = collection.map(maskClouds);

    // 6. HITUNG BANDS
    const dualCollection = collection.map(img => {
      const optical = img.select(['SR_B2','SR_B3','SR_B4','SR_B5'])
        .multiply(0.0000275).add(-0.2);
      const ndvi = optical.normalizedDifference(['SR_B5','SR_B4']).rename('NDVI');
      const lst = img.select('ST_B10')
        .multiply(0.00341802).add(149.0).subtract(273.15)
        .rename('LST_Celsius');
      return img.addBands([ndvi, lst]).copyProperties(img, ['system:time_start', 'roi_cloud_pct']);
    });

    const mainBand = type === 'ndvi' ? 'NDVI' : 'LST_Celsius';
    const palette = type === 'ndvi' 
      ? ['red', 'yellow', 'green'] 
      : ['040274','2c7bb6','abd9e9','ffffbf','fdae61','d7191c','7a0403'];

    // 7. COMPOSITE STRATEGY (HYBRID LOGIC: LST BEDA DENGAN NDVI)
    let finalImage;
    let metadataImage; // Untuk mengambil tanggal

    if (mode === 'realtime') {
      if (type === 'ndvi') {
        // --- STRATEGI NDVI: TEMPORAL MOSAIC (Tambal Sulam Waktu) ---
        // Karena vegetasi lambat berubah, aman pakai data minggu lalu untuk menambal bolong.
        finalImage = dualCollection.sort('system:time_start', true).mosaic();
        
        // Metadata ambil dari citra terbaru yg tersedia
        metadataImage = dualCollection.sort('system:time_start', false).first();
      } else {
        // --- STRATEGI LST: SINGLE SCENE + SPATIAL FILL (Tambal Sulam Tetangga) ---
        // Suhu tidak boleh dicampur antar hari (bikin bintik).
        // Jadi kita ambil 1 citra terbaru saja.
        finalImage = dualCollection.sort('system:time_start', false).first();
        metadataImage = finalImage;

        // TEKNIK SPATIAL FILLING:
        // Jika ada bolong (awan), isi dengan rata-rata pixel tetangga (radius 3 pixel).
        // .unmask() akan mengisi nilai masked (bolong) dengan nilai dari image parameter.
        if (finalImage) {
           const filled = finalImage.focal_mean(3, 'square', 'pixels', 1); // Smoothing filler
           finalImage = finalImage.unmask(filled); // Tambal bolong dengan filler
        }
      }
    } else {
      // Mode Historis (Agregat)
      if (reducerMethod === 'Mean') finalImage = dualCollection.mean();
      else if (reducerMethod === 'Max') finalImage = dualCollection.max();
      else if (reducerMethod === 'Mosaic') finalImage = dualCollection.mosaic();
      else finalImage = dualCollection.median();
    }

    // Safety check jika collection kosong total (misal karena slider terlalu rendah)
    if (!finalImage) {
        throw new Error("No data found"); // Akan ditangkap catch dan jadi toast error di frontend
    }

    finalImage = finalImage.clip(geometry);

    // 8. STATS & OUTPUT
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

    const samplePoints = finalImage.select(['NDVI', 'LST_Celsius']).sample({
      region: geometry, scale: 200, numPixels: 150, geometries: false
    });

    const visParams = { min: visMin, max: visMax, palette: palette };

    const [mapId, statsRaw, chartRaw, downloadUrl, impactRaw, scatterRaw, dateMillis, cloudScoreVal] = await Promise.all([
      new Promise((resolve, reject) => finalImage.select(mainBand).getMap(visParams, (map, err) => err ? reject(err) : resolve(map))),
      new Promise((resolve) => aggregateStats.evaluate((val, err) => resolve(val || {}))),
      new Promise((resolve) => timeSeriesList.evaluate((val, err) => resolve(val || {features:[]}))),
      new Promise((resolve) => {
         finalImage.select(mainBand).getDownloadURL({
          name: `${type.toUpperCase()}_${region_name}`, scale: 500, crs: 'EPSG:4326', region: geometry
        }, (url, err) => resolve(err ? null : url));
      }),
      new Promise((resolve) => impactStats.evaluate((val, err) => resolve(val || {}))),
      new Promise((resolve) => samplePoints.evaluate((val, err) => resolve(val || {features:[]}))),
      
      // Ambil Metadata Tanggal
      new Promise((resolve) => {
        if (mode === 'realtime' && metadataImage) {
           metadataImage.get('system:time_start').evaluate((val, err) => resolve(val));
        } else resolve(null);
      }),
      // Ambil Metadata Cloud Score
      new Promise((resolve) => {
        if (mode === 'realtime' && metadataImage) {
          metadataImage.get('roi_cloud_pct').evaluate((val, err) => resolve(val));
        } else resolve(null);
      })
    ]);

    // Format Output Chart
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

    // LABEL TANGGAL FIX (YYYY-MM-DD)
    let dateLabel = null;
    if (dateMillis) {
      const d = new Date(dateMillis);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      if (mode === 'realtime') {
        const qualityText = cloudScoreVal !== null ? ` (Awan: ${parseFloat(cloudScoreVal).toFixed(1)}%)` : '';
        // Beri info jika ini LST hasil smoothing
        const typeInfo = type === 'lst' ? ' [Spatial Filled]' : '';
        dateLabel = `${dateStr}${qualityText}${typeInfo}`;
      } else {
        dateLabel = dateStr;
      }
    }

    res.status(200).json({
      map: mapId,
      stats: {
        mean: statsRaw[`${mainBand}_mean`] || 0,
        min: statsRaw[`${mainBand}_min`] || 0,
        max: statsRaw[`${mainBand}_max`] || 0,
        unit: type === 'ndvi' ? 'Index' : '°C',
        region: region_name,
        threshold: thresholdVal,
        impact_area_ha: areaHa,
        image_date: dateLabel 
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