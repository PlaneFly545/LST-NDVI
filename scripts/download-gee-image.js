/**
 * scripts/download-gee-image.js
 *
 * Standalone script to download the exact GEE LST heatmap of Bali
 * with true transparency and perfect alignment bounds.
 *
 * Run using: node scripts/download-gee-image.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const ee = require('@google/earthengine');

// 1. Baca kredensial dari .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('.env.local tidak ditemukan.');
  process.exit(1);
}

const dotenvContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
dotenvContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.substring(1, value.length - 1);
    }
    env[match[1]] = value;
  }
});

const privateKey = (env.GEE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const clientEmail = env.GEE_CLIENT_EMAIL;

if (!privateKey || !clientEmail) {
  console.error('Kredensial GEE (GEE_PRIVATE_KEY / GEE_CLIENT_EMAIL) tidak ditemukan di .env.local');
  process.exit(1);
}

// 2. Helper untuk mengunduh gambar
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// 3. Otentikasi dan Jalankan Proses GEE
console.log('Menghubungkan ke Google Earth Engine...');
ee.data.authenticateViaPrivateKey(
  { private_key: privateKey, client_email: clientEmail },
  () => {
    ee.initialize(null, null, () => {
      console.log('Terhubung ke GEE. Memproses citra LST Bali (2014 - 2024)...');

      // Ambil geometri Bali
      const baliProvince = ee.FeatureCollection('FAO/GAUL/2015/level1').filter(
        ee.Filter.eq('ADM1_NAME', 'Bali')
      );
      const geometry = baliProvince.geometry();

      // Masker awan
      const maskClouds = (image) => {
        const qa = image.select('QA_PIXEL');
        const mask = qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 4).eq(0));
        return image.updateMask(mask);
      };

      // Buat koleksi data LST
      const dualCollection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
        .filterBounds(geometry)
        .filterDate('2014-01-01', '2024-12-31')
        .filter(ee.Filter.lt('CLOUD_COVER', 30))
        .map(maskClouds)
        .map((img) => {
          const lst = img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15).rename('LST_Celsius');
          return img.addBands([lst]);
        });

      // Median reducer & clip
      const finalImage = dualCollection.select('LST_Celsius').median().clip(geometry);

      // Parameter visualisasi asli
      const visParams = {
        min: 20,
        max: 45,
        palette: ['040274', '2c7bb6', 'abd9e9', 'ffffbf', 'fdae61', 'd7191c', '7a0403']
      };

      // Ambil URL thumbnail dengan transparansi asli dan bounds pulau Bali
      finalImage.getThumbURL(
        {
          region: geometry,
          scale: 300, // Resolusi tinggi agar tajam
          crs: 'EPSG:4326',
          format: 'png',
          min: visParams.min,
          max: visParams.max,
          palette: visParams.palette,
        },
        (url, err) => {
          if (err) {
            console.error('Gagal mengambil getThumbURL dari GEE:', err.message);
            process.exit(1);
          }

          console.log('Gambar LST transparan asli GEE didapatkan. Mengunduh...');
          const dest = path.join(__dirname, '..', 'public', 'data', 'bali_lst_heatmap.png');
          
          downloadFile(url, dest)
            .then(() => {
              console.log('\nSUKSES: Gambar LST transparan asli berhasil diunduh ke:');
              console.log(`  ${dest}`);
              process.exit(0);
            })
            .catch((downloadErr) => {
              console.error('Gagal menyimpan gambar:', downloadErr.message);
              process.exit(1);
            });
        }
      );
    }, (initErr) => {
      console.error('Gagal inisialisasi GEE:', initErr);
      process.exit(1);
    });
  },
  (authErr) => {
    console.error('Gagal otentikasi GEE via Private Key:', authErr);
    process.exit(1);
  }
);
