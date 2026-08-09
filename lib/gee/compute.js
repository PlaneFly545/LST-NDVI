// lib/gee/compute.js
// GEE computation logic: geometry resolution, image processing, and parallel evaluation.
import ee from '@google/earthengine';
import baliGeoJSON from '../../public/data/bali_kabkota.json';

// Epoch pemusatan waktu untuk regresi harmonik. Tahun pertama Landsat 8 dipakai
// sebagai titik nol supaya nilai t kecil (0..12) dan matriks desainnya tidak
// ill-conditioned — regresi dengan t berupa tahun mentah (2013..2025) membuat
// suku konstanta dan suku tren nyaris kolinear.
const HARMONIC_EPOCH = 2013;

// Urutan ini mengikat: linearRegression membaca band X sesuai posisinya, jadi
// nama di sini harus sejajar dengan urutan band yang disusun addHarmonicTerms().
const HARMONIC_TERMS = ['constant', 't', 'cos1', 'sin1', 'cos2', 'sin2'];

// Prediktor spasial LST: konstanta, NDVI, NDBI, elevasi.
const LST_PREDICTORS = ['constant', 'NDVI', 'NDBI', 'elevation'];

// Bulan 1–12 untuk profil musiman. Sengaja larik JavaScript biasa, bukan
// ee.List: nilai sin/cos model harmonik adalah konstanta yang bisa dihitung di
// sisi klien, jadi membungkusnya sebagai objek server hanya menambah beban.
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

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

/** Nama wilayah (huruf besar) sesuai urutannya di GeoJSON. */
export const REGION_LIST = (baliGeoJSON?.features || [])
  .map((f) => String(f?.properties?.nm_kabkota || '').toUpperCase())
  .filter(Boolean);

/**
 * FeatureCollection berisi seluruh kabupaten/kota plus satu fitur 'ALL'
 * untuk provinsi. Dipakai reduceRegions supaya statistik semua wilayah
 * dihitung dalam satu panggilan — inilah yang membuat perpindahan wilayah
 * di UI tidak lagi memanggil GEE sama sekali.
 *
 * region_id dipakai untuk menandai titik sampel scatter, karena hasil
 * sample() tidak membawa informasi poligon.
 *
 * @returns {ee.FeatureCollection}
 */
export function buildRegionsCollection() {
  const kabupaten = baliGeoJSON.features
    .filter((f) => f?.properties?.nm_kabkota)
    .map((f, idx) =>
      ee.Feature(ee.Geometry(f.geometry), {
        region: String(f.properties.nm_kabkota).toUpperCase(),
        region_id: idx + 1,
      })
    );

  // Geometri 'ALL' sengaja tetap memakai FAO GAUL (sama seperti resolveGeometry)
  // supaya angka "Seluruh Bali" identik dengan sebelum perubahan ini.
  const provinsi = ee.Feature(resolveGeometry('ALL'), { region: 'ALL', region_id: 0 });

  return ee.FeatureCollection([provinsi, ...kabupaten]);
}

/**
 * Build a cloud-masked ImageCollection (NDVI + NDBI + LST_Celsius)
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
    const optical = img
      .select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6'])
      .multiply(0.0000275)
      .add(-0.2);
    const ndvi = optical.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
    // NDBI = (SWIR1 − NIR) / (SWIR1 + NIR); indeks keterbangunan, dipakai
    // sebagai prediktor LST di samping NDVI.
    const ndbi = optical.normalizedDifference(['SR_B6', 'SR_B5']).rename('NDBI');
    const lst = img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15).rename('LST_Celsius');
    return img.addBands([ndvi, ndbi, lst]).copyProperties(img, ['system:time_start']);
  });
}

/**
 * Komposit rata-rata tahunan: dihitung per tahun dulu, baru dirata-ratakan
 * antar tahun sehingga setiap tahun berbobot sama.
 *
 * Ini berbeda dengan collection.mean() yang merata-ratakan seluruh scene —
 * di sana tahun dengan banyak citra bebas awan ikut berbobot lebih besar,
 * dan itulah yang membuat angka baseline lama sulit ditafsirkan.
 *
 * @param {ee.ImageCollection} collection
 * @param {number} startYear
 * @param {number} endYear
 * @returns {ee.Image}
 */
export function annualMeanComposite(collection, startYear, endYear) {
  const years = ee.List.sequence(startYear, endYear);

  const yearly = ee.ImageCollection.fromImages(
    years.map((year) => {
      const yearStart = ee.Date.fromYMD(year, 1, 1);
      return collection.filterDate(yearStart, yearStart.advance(1, 'year')).mean();
    })
  );

  return yearly.mean();
}

/**
 * Cocokkan regresi harmonik per piksel untuk satu band.
 *
 * Model: y(t) = b0 + b1·t + c1·cos(2πt) + s1·sin(2πt) + c2·cos(4πt) + s2·sin(4πt)
 * dengan t = tahun pecahan − 2013.
 *
 * Suku b1 menangkap tren jangka panjang, sepasang suku pertama menangkap siklus
 * tahunan (musim hujan/kemarau), sepasang kedua menangkap komponen setengah
 * tahunan. Pemisahan inilah yang tidak bisa dilakukan regresi linear biasa —
 * di model lama, variasi musiman ikut terserap ke dalam kemiringan tren.
 *
 * @param {ee.ImageCollection} collection
 * @param {string} band
 * @returns {ee.Image}  citra koefisien dengan band sesuai HARMONIC_TERMS
 */
export function buildHarmonicFit(collection, band) {
  const withTerms = collection.map((img) => {
    const date = img.date();
    const t = ee.Number(date.get('year')).add(date.getFraction('year')).subtract(HARMONIC_EPOCH);
    const tImage = ee.Image.constant(t).toFloat();
    const angle = tImage.multiply(2 * Math.PI);
    const response = img.select(band);

    // Urutan cat() harus X dulu baru Y — linearRegression membacanya per posisi.
    // updateMask() menyamakan masker suku desain dengan masker responsnya, supaya
    // scene yang tertutup awan benar-benar gugur dari perhitungan, bukan ikut
    // masuk sebagai baris dengan Y kosong.
    return ee.Image.cat([
      ee.Image.constant(1).toFloat().rename('constant'),
      tImage.rename('t'),
      angle.cos().rename('cos1'),
      angle.sin().rename('sin1'),
      angle.multiply(2).cos().rename('cos2'),
      angle.multiply(2).sin().rename('sin2'),
      response,
    ]).updateMask(response.mask());
  });

  return withTerms
    .reduce(ee.Reducer.linearRegression({ numX: 6, numY: 1 }))
    .select('coefficients')
    .arrayProject([0])
    .arrayFlatten([HARMONIC_TERMS]);
}

/**
 * Rata-rata tahunan model harmonik untuk satu tahun, dalam bentuk tertutup.
 *
 * Seluruh suku sin/cos terintegrasi menjadi nol sepanjang satu tahun penuh,
 * sehingga rata-rata setahun hanya menyisakan bagian tren:
 *
 *   ȳ(Y) = b0 + b1 · (Y − 2013 + 0.5)
 *
 * Tambahan 0.5 menempatkannya di titik tengah tahun. Jadi keluarannya memang
 * nilai yang mewakili satu tahun, bukan nilai pada satu tanggal tertentu.
 *
 * @param {ee.Image} coefficients  keluaran buildHarmonicFit()
 * @param {number}   year
 * @param {string}   bandName
 * @returns {ee.Image}
 */
export function harmonicAnnualMean(coefficients, year, bandName) {
  const t = year - HARMONIC_EPOCH + 0.5;
  return coefficients
    .select('constant')
    .add(coefficients.select('t').multiply(t))
    .rename(bandName);
}

/**
 * Nilai model harmonik pada pertengahan satu bulan.
 *
 * Kebalikan dari harmonicAnnualMean(): di sini suku sin/cos justru yang dicari,
 * karena itulah komponen musimannya. Yang dibuang oleh rata-rata tahunan
 * (siklus tahunan dan setengah-tahunan) di sinilah wujudnya.
 *
 * t ditempatkan di tengah bulan — (bulan − 0.5)/12 — supaya nilainya mewakili
 * bulan tersebut secara keseluruhan, bukan keadaan pada tanggal 1.
 *
 * @param {ee.Image} coefficients  keluaran buildHarmonicFit()
 * @param {number}   year
 * @param {number}   month         1–12
 * @param {string}   bandName
 * @returns {ee.Image}
 */
export function harmonicMonthlyMean(coefficients, year, month, bandName) {
  const t = year - HARMONIC_EPOCH + (month - 0.5) / 12;
  const angle = 2 * Math.PI * t;

  return coefficients
    .select('constant')
    .add(coefficients.select('t').multiply(t))
    .add(coefficients.select('cos1').multiply(Math.cos(angle)))
    .add(coefficients.select('sin1').multiply(Math.sin(angle)))
    .add(coefficients.select('cos2').multiply(Math.cos(2 * angle)))
    .add(coefficients.select('sin2').multiply(Math.sin(2 * angle)))
    .rename(bandName);
}

/** Elevasi SRTM, prediktor tetap pada model LST. */
function elevationImage() {
  return ee.Image('USGS/SRTMGL1_003').select('elevation').toFloat().rename('elevation');
}

/**
 * Koefisien hubungan spasial LST = a0 + a1·NDVI + a2·NDBI + a3·elevasi,
 * dicocokkan lintas piksel dari rata-rata tahunan historis.
 *
 * Dipisahkan dari predictLstFromIndices() karena profil musiman memakai
 * koefisien yang sama untuk kedua belas bulan: hubungan spasialnya tidak
 * bergantung bulan, yang berganti hanya NDVI dan NDBI yang dimasukkan ke
 * dalamnya. Mencocokkannya ulang tiap bulan hanya memboroskan komputasi.
 *
 * @returns {ee.List}  [a0, a1, a2, a3]
 */
function fitLstCoefficients(collection, geometry, startYear, endYear, elevation) {
  const historical = annualMeanComposite(collection, startYear, endYear);

  const designStack = ee.Image.cat([
    ee.Image.constant(1).toFloat().rename('constant'),
    historical.select('NDVI'),
    historical.select('NDBI'),
    elevation,
    historical.select('LST_Celsius'),
  ]);

  const regression = designStack.reduceRegion({
    reducer: ee.Reducer.linearRegression({ numX: LST_PREDICTORS.length, numY: 1 }),
    geometry,
    scale: 200,
    bestEffort: true,
    maxPixels: 1e9,
  });

  return ee.Array(regression.get('coefficients')).project([0]).toList();
}

/** Terapkan koefisien fitLstCoefficients() pada sepasang citra NDVI/NDBI. */
function applyLstCoefficients(coefficients, ndvi, ndbi, elevation) {
  return ee.Image.constant(ee.Number(coefficients.get(0)))
    .add(ndvi.multiply(ee.Number(coefficients.get(1))))
    .add(ndbi.multiply(ee.Number(coefficients.get(2))))
    .add(elevation.multiply(ee.Number(coefficients.get(3))))
    .rename('LST_Celsius');
}

/**
 * Proyeksi indeks ternormalisasi (NDVI/NDBI) ke tahun target.
 *
 * Bagian tren model bersifat linear, jadi pada piksel dengan tren curam
 * ekstrapolasinya bisa melewati batas definisi indeks. NDVI dan NDBI secara
 * matematis terkurung di [−1, 1] — nilai di luar itu tidak punya arti fisik,
 * jadi hasilnya dipotong ke rentang sahihnya.
 *
 * @param {ee.ImageCollection} collection
 * @param {string} band
 * @param {number} year
 * @returns {ee.Image}
 */
function projectIndex(collection, band, year) {
  return harmonicAnnualMean(buildHarmonicFit(collection, band), year, band).clamp(-1, 1);
}

/**
 * Prediksi LST tahun target dari NDVI, NDBI, dan elevasi.
 *
 * NDVI dan NDBI diproyeksikan lebih dulu secara harmonik, lalu dimasukkan ke
 * hubungan spasial LST–NDVI–NDBI–elevasi yang dicocokkan dari data historis.
 * NDVI tetap menjadi penggerak utama model, bukan sekadar salah satu prediktor
 * di antara banyak variabel lingkungan.
 *
 * @param {ee.ImageCollection} collection
 * @param {ee.Geometry} geometry
 * @param {number} targetYear
 * @param {number} startYear
 * @param {number} endYear
 * @returns {ee.Image}  band tunggal 'LST_Celsius'
 */
function predictLstFromIndices(collection, geometry, targetYear, startYear, endYear) {
  const elevation = elevationImage();

  // 1 & 2. Proyeksi NDVI dan NDBI ke tahun target.
  const ndviTarget = projectIndex(collection, 'NDVI', targetYear);
  const ndbiTarget = projectIndex(collection, 'NDBI', targetYear);

  // 3. Hubungan LST = a0 + a1·NDVI + a2·NDBI + a3·elevasi, dicocokkan lintas
  //    piksel dari rata-rata tahunan historis.
  const coefficients = fitLstCoefficients(collection, geometry, startYear, endYear, elevation);

  return applyLstCoefficients(coefficients, ndviTarget, ndbiTarget, elevation);
}

/**
 * Compute the final map image (history or prediction).
 *
 * Citra selalu dibangun untuk seluruh Bali dan tidak dipotong per kabupaten,
 * supaya satu hasil komputasi bisa dipakai ulang untuk semua wilayah.
 *
 * @param {object} options
 * @param {ee.ImageCollection} options.dualCollection
 * @param {string} options.mode        'history' | 'prediksi'
 * @param {string} options.reducer     'Median' | 'Mean' | 'Max' | 'Mosaic'
 * @param {string} options.gapFill     'none' | 'spatial'
 * @param {string} options.mainBand    'NDVI' | 'LST_Celsius'
 * @param {ee.Geometry} options.geometry  geometri Bali
 * @param {number} options.targetYear
 * @param {number} options.startYear   tahun awal baseline
 * @param {number} options.endYear     tahun akhir baseline
 * @returns {{ finalImage: ee.Image, baselineImage: ee.Image|null }}
 */
export function buildFinalImage({
  dualCollection,
  mode,
  reducer,
  gapFill,
  mainBand,
  geometry,
  targetYear,
  startYear,
  endYear,
}) {
  let finalImage;
  let baselineImage = null;

  if (mode === 'prediksi') {
    if (mainBand === 'NDVI') {
      // NDVI adalah subjek analisis: diproyeksikan langsung, tidak diturunkan
      // dari variabel lain.
      finalImage = projectIndex(dualCollection, 'NDVI', targetYear);
    } else {
      finalImage = predictLstFromIndices(dualCollection, geometry, targetYear, startYear, endYear);
    }

    // Pembanding di kartu Delta: rata-rata tahunan sepanjang periode baseline.
    baselineImage = annualMeanComposite(dualCollection, startYear, endYear).select(mainBand);
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

  return { finalImage: finalImage.clip(geometry), baselineImage };
}

/**
 * Ubah FeatureCollection hasil reduceRegions menjadi objek biasa
 * beringkas nama wilayah.
 *
 * @param {object} featureCollection  hasil evaluate()
 * @param {string} property           nama properti yang diambil
 * @returns {Record<string, number|null>}
 */
function indexByRegion(featureCollection, property) {
  const out = {};
  for (const feature of featureCollection?.features || []) {
    const props = feature?.properties || {};
    if (props.region) out[props.region] = props[property] ?? null;
  }
  return out;
}

/**
 * Run all GEE evaluate() calls in parallel and return structured results.
 *
 * Seluruh statistik dihitung untuk semua wilayah sekaligus, sehingga satu entri
 * cache melayani "Seluruh Bali" maupun kabupaten mana pun.
 *
 * @param {object} options
 * @returns {Promise<object|null>}  payload per wilayah, atau null bila getMap gagal
 */
export async function runGeeEvaluation({
  finalImage,
  baselineImage,
  mainBand,
  geometry,
  visParams,
  thresholdVal,
  dualCollection,
  startYear,
  endYear,
  mode,
  normalizedType,
  targetYear,
}) {
  function safeErrorLog(msg, extra = {}) {
    try { console.error(msg, extra); } catch { console.error(msg); }
  }

  const regions = buildRegionsCollection();
  const mainImage = finalImage.select(mainBand);

  // ── Computed GEE Objects ──────────────────────────────────────────────────
  const aggregateStats = mainImage.reduceRegions({
    collection: regions,
    reducer: ee.Reducer.mean().combine({ reducer2: ee.Reducer.minMax(), sharedInputs: true }),
    scale: 200,
  });

  const impactStats = mainImage
    .gt(thresholdVal)
    .multiply(ee.Image.pixelArea())
    .reduceRegions({ collection: regions, reducer: ee.Reducer.sum(), scale: 200 });

  const baselineStats = baselineImage
    ? baselineImage.reduceRegions({ collection: regions, reducer: ee.Reducer.mean(), scale: 200 })
    : ee.FeatureCollection([]);

  const years = ee.List.sequence(startYear, endYear);

  // Satu reduceRegions per tahun (bukan per tahun per wilayah), lalu diratakan
  // jadi satu koleksi berisi tahun × wilayah.
  const timeSeriesList = ee.FeatureCollection(
    years.map((year) => {
      const yearStart = ee.Date.fromYMD(year, 1, 1);
      const yearMean = dualCollection
        .select(mainBand)
        .filterDate(yearStart, yearStart.advance(1, 'year'))
        .mean();

      return yearMean
        .reduceRegions({ collection: regions, reducer: ee.Reducer.mean(), scale: 500 })
        .map((f) => f.set('year', year));
    })
  ).flatten();

  // Catatan citra sumber per tahun: berapa scene dan tanggal perekamannya.
  // Tanpa ini pembaca tidak bisa membedakan titik tahunan yang disusun dari 3
  // scene dan yang disusun dari 30 — padahal keandalannya jauh berbeda.
  //
  // Tidak dipisah per wilayah: dualCollection disaring memakai geometri seluruh
  // Bali (lihat pemanggilan buildDualCollection di api/map-layer), jadi daftar
  // scene-nya sama untuk semua kabupaten.
  const sceneIndex = ee.FeatureCollection(
    years.map((year) => {
      const yearStart = ee.Date.fromYMD(year, 1, 1);
      const yearly = dualCollection.filterDate(yearStart, yearStart.advance(1, 'year'));

      return ee.Feature(null, {
        year,
        scene_count: yearly.size(),
        // system:time_start ikut terbawa karena buildDualCollection menyalinnya
        // kembali lewat copyProperties() setelah band NDVI/NDBI/LST ditambahkan.
        scene_dates: yearly
          .aggregate_array('system:time_start')
          .map((t) => ee.Date(t).format('YYYY-MM-dd')),
      });
    })
  );

  // ── Profil musiman: 12 titik, satu per bulan ─────────────────────────────
  // Rata-rata tahunan meratakan musim hujan dan kemarau menjadi satu angka,
  // padahal di daerah tropis selisih keduanya besar. Bagian ini memunculkan
  // kembali selisih itu tanpa mengubah deret tahunan.
  //
  // Rentangnya dikunci ke tahun kalender penuh supaya tiap bulan diwakili oleh
  // jumlah tahun yang sama — kalau memakai rentang mentah, bulan di ujung
  // periode akan terhitung dari lebih sedikit tahun daripada bulan lainnya.
  const fullYearCollection = dualCollection.filterDate(
    ee.Date.fromYMD(startYear, 1, 1),
    ee.Date.fromYMD(endYear + 1, 1, 1)
  );

  const seasonalImages = (() => {
    // Historis: kelompokkan ulang citra yang ada. Januari = rata-rata seluruh
    // citra Januari sepanjang periode, dan seterusnya.
    if (mode !== 'prediksi') {
      return MONTHS.map((month) =>
        fullYearCollection
          .select(mainBand)
          .filter(ee.Filter.calendarRange(month, month, 'month'))
          .mean()
      );
    }

    // Prediksi: tidak perlu model baru. Koefisien harmonik yang sama dengan
    // peta prediksi dipakai ulang, hanya suku sin/cos-nya kali ini tidak
    // dibuang. Pencocokannya dilakukan sekali di luar perulangan bulan.
    const ndviCoefficients = buildHarmonicFit(fullYearCollection, 'NDVI');

    if (mainBand === 'NDVI') {
      return MONTHS.map((month) =>
        harmonicMonthlyMean(ndviCoefficients, targetYear, month, 'NDVI').clamp(-1, 1)
      );
    }

    const ndbiCoefficients = buildHarmonicFit(fullYearCollection, 'NDBI');
    const elevation = elevationImage();
    const lstCoefficients = fitLstCoefficients(
      fullYearCollection, geometry, startYear, endYear, elevation
    );

    return MONTHS.map((month) =>
      applyLstCoefficients(
        lstCoefficients,
        harmonicMonthlyMean(ndviCoefficients, targetYear, month, 'NDVI').clamp(-1, 1),
        harmonicMonthlyMean(ndbiCoefficients, targetYear, month, 'NDBI').clamp(-1, 1),
        elevation
      )
    );
  })();

  // Skala 500 m mengikuti deret tahunan, bukan 200 m seperti kartu statistik —
  // keduanya hanya perlu nilai rata-rata wilayah, dan skala yang lebih kasar
  // membuat dua belas reduksi ini tetap terjangkau.
  //
  // Citranya tidak di-rename di sini: semuanya sudah berband tunggal bernama
  // mainBand. Memaksa rename justru berbahaya — bulan yang sama sekali tidak
  // punya citra menghasilkan mean() tanpa band, dan rename() akan menggagalkan
  // seluruh permintaan alih-alih membiarkan bulan itu kosong.
  const seasonalSeries = ee.FeatureCollection(
    seasonalImages.map((image, idx) =>
      image
        .reduceRegions({ collection: regions, reducer: ee.Reducer.mean(), scale: 500 })
        .map((f) => f.set('month', idx + 1))
    )
  ).flatten();

  // Titik sampel scatter membawa region_id supaya bisa disaring per wilayah
  // tanpa memanggil GEE lagi.
  const regionIdImage = regions
    .filter(ee.Filter.neq('region', 'ALL'))
    .reduceToImage({ properties: ['region_id'], reducer: ee.Reducer.first() })
    .rename('region_id');

  const samplePoints = finalImage
    .select(['NDVI', 'LST_Celsius'])
    .addBands(regionIdImage)
    .sample({ region: geometry, scale: 200, numPixels: 2500, geometries: false });

  // ── Parallel evaluate() ───────────────────────────────────────────────────
  const [mapId, statsRaw, chartRaw, impactRaw, scatterRaw, baselineRaw, sceneRaw, seasonalRaw] =
    await Promise.all([
      // getMap — non-fatal: resolve null on error
      new Promise((resolve) =>
        mainImage.getMap(visParams, (map, err) => {
          if (err) { safeErrorLog('getMap error (non-fatal):', { message: err?.message }); resolve(null); }
          else resolve(map);
        })
      ),
      new Promise((resolve) => aggregateStats.evaluate((val) => resolve(val || { features: [] }))),
      new Promise((resolve) => timeSeriesList.evaluate((val) => resolve(val || { features: [] }))),
      new Promise((resolve) => impactStats.evaluate((val) => resolve(val || { features: [] }))),
      new Promise((resolve) => {
        if (mode === 'prediksi') return resolve({ features: [] });
        samplePoints.evaluate((val) => resolve(val || { features: [] }));
      }),
      new Promise((resolve) => baselineStats.evaluate((val) => resolve(val || { features: [] }))),
      new Promise((resolve) => sceneIndex.evaluate((val) => resolve(val || { features: [] }))),
      new Promise((resolve) => seasonalSeries.evaluate((val) => resolve(val || { features: [] }))),
    ]);

  // ── Shape payload ─────────────────────────────────────────────────────────
  if (!mapId) return null; // caller handles 422

  const meanByRegion     = indexByRegion(statsRaw, 'mean');
  const minByRegion      = indexByRegion(statsRaw, 'min');
  const maxByRegion      = indexByRegion(statsRaw, 'max');
  const impactByRegion   = indexByRegion(impactRaw, 'sum');
  const baselineByRegion = indexByRegion(baselineRaw, 'mean');

  const statsByRegion = {};
  for (const name of ['ALL', ...REGION_LIST]) {
    statsByRegion[name] = {
      mean: meanByRegion[name] ?? 0,
      min: minByRegion[name] ?? 0,
      max: maxByRegion[name] ?? 0,
      baseline_mean: baselineByRegion[name] ?? 0,
      unit: normalizedType === 'ndvi' ? '' : '°C',
      region: name === 'ALL' ? 'SELURUH BALI' : name,
      threshold: thresholdVal,
      impact_area_ha: (impactByRegion[name] || 0) / 10000,
      is_prediction: mode === 'prediksi',
      target_year: targetYear,
      baseline_start_year: startYear,
      baseline_end_year: endYear,
    };
  }

  // Deret waktu dikelompokkan per wilayah, diurutkan menaik per tahun.
  const chartByRegion = {};
  for (const feature of chartRaw.features || []) {
    const props = feature?.properties || {};
    if (!props.region || props.mean === null || props.mean === undefined) continue;
    if (!chartByRegion[props.region]) chartByRegion[props.region] = [];
    chartByRegion[props.region].push({ year: props.year, value: props.mean });
  }
  for (const name of Object.keys(chartByRegion)) {
    chartByRegion[name].sort((a, b) => a.year - b.year);
  }

  // Titik scatter dipetakan balik dari region_id ke nama wilayah.
  const nameById = new Map(REGION_LIST.map((name, idx) => [idx + 1, name]));
  const scatterByRegion = { ALL: [] };
  for (const feature of scatterRaw.features || []) {
    const props = feature?.properties || {};
    if (props.NDVI === null || props.NDVI === undefined) continue;
    if (props.LST_Celsius === null || props.LST_Celsius === undefined) continue;

    const point = { ndvi: props.NDVI, lst: props.LST_Celsius };
    scatterByRegion.ALL.push(point);

    const name = nameById.get(props.region_id);
    if (!name) continue;
    if (!scatterByRegion[name]) scatterByRegion[name] = [];
    scatterByRegion[name].push(point);
  }

  // Daftar citra per tahun, diurutkan menaik.
  const scenesByYear = (sceneRaw.features || [])
    .map((feature) => feature?.properties || {})
    .filter((props) => props.year !== null && props.year !== undefined)
    .map((props) => {
      // aggregate_array tidak menjamin urutan, dan satu tanggal bisa muncul
      // lebih dari sekali bila wilayah tercakup lebih dari satu jalur rekaman
      // Landsat. Tanggal kembar digabung sambil membawa jumlahnya, supaya total
      // yang ditampilkan tetap sama dengan scene_count.
      const tally = new Map();
      for (const date of props.scene_dates || []) {
        tally.set(date, (tally.get(date) || 0) + 1);
      }

      return {
        year: props.year,
        count: props.scene_count ?? 0,
        dates: [...tally.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([date, n]) => ({ date, n })),
      };
    })
    .sort((a, b) => a.year - b.year);

  // Jumlah citra per bulan diturunkan dari scenesByYear, bukan dari panggilan
  // GEE tersendiri: keduanya bersumber dari rentang tahun kalender penuh yang
  // sama, jadi menjumlahkan tanggalnya menurut bulan memberi angka yang sama
  // persis tanpa biaya tambahan.
  const sceneCountByMonth = new Array(12).fill(0);
  for (const item of scenesByYear) {
    for (const { date, n } of item.dates) {
      const month = Number(String(date).slice(5, 7));
      if (month >= 1 && month <= 12) sceneCountByMonth[month - 1] += n;
    }
  }

  // Profil musiman per wilayah, diurutkan Januari–Desember.
  const seasonalByRegion = {};
  for (const feature of seasonalRaw.features || []) {
    const props = feature?.properties || {};
    if (!props.region || props.mean === null || props.mean === undefined) continue;
    if (!seasonalByRegion[props.region]) seasonalByRegion[props.region] = [];

    seasonalByRegion[props.region].push({
      month: props.month,
      value: props.mean,
      // Di mode prediksi angka ini tidak berlaku: nilainya keluaran model untuk
      // tahun yang citranya belum ada, bukan rata-rata sekumpulan citra.
      count: mode === 'prediksi' ? null : sceneCountByMonth[props.month - 1] ?? 0,
    });
  }
  for (const name of Object.keys(seasonalByRegion)) {
    seasonalByRegion[name].sort((a, b) => a.month - b.month);
  }

  return {
    // getMap() ikut mengembalikan properti `image` berisi seluruh graf komputasi
    // GEE — sekitar 1,2 MB dan tidak dipakai sama sekali di sisi klien. Karena
    // payload ini disimpan di cache (maks 200 entri), membawanya serta berarti
    // ratusan megabyte memori proses yang terbuang percuma.
    map: { mapid: mapId.mapid, token: mapId.token, urlFormat: mapId.urlFormat },
    statsByRegion,
    chartByRegion,
    scatterByRegion,
    scenesByYear,
    seasonalByRegion,
  };
}
