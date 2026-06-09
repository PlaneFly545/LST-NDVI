/**
 * scripts/generate-demo-snapshot.js
 *
 * Jalankan SATU KALI saat dev server sudah berjalan:
 *   node scripts/generate-demo-snapshot.js
 *
 * Script ini memanggil API lokal dengan parameter default LST Bali,
 * lalu menyimpan hasilnya ke public/data/demo_snapshot.json
 * sehingga tour demo bisa menampilkan peta warna GEE yang asli.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Parameter default untuk snapshot demo ──
const params = new URLSearchParams({
  mode: 'history',
  type: 'lst',
  region_name: 'ALL',
  start_date: '2014-01-01',
  end_date: '2024-12-31',
  cloud_cover: 30,
  reducer: 'Median',
  vis_min: 20,
  vis_max: 45,
  threshold: 30,
  gap_fill: 'none',
});

const url = `http://localhost:3000/api/map-layer?${params}`;
const outputPath = path.join(__dirname, '..', 'public', 'data', 'demo_snapshot.json');

console.log('Menghubungi API...');
console.log(`URL: ${url}\n`);

const options = {
  hostname: 'localhost',
  port: 3000,
  path: `/api/map-layer?${params}`,
  method: 'GET',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  },
};

http.get(options, (res) => {
  let raw = '';

  res.on('data', (chunk) => { raw += chunk; });

  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error(`Error: HTTP ${res.statusCode}`);
      console.error(raw);
      process.exit(1);
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error('Gagal parse JSON response:', e.message);
      process.exit(1);
    }

    const snapshot = {
      _note: 'Auto-generated. Jalankan ulang scripts/generate-demo-snapshot.js untuk refresh tile URL (berlaku ~24 jam).',
      _generated_at: new Date().toISOString(),
      map: data.map,
      stats: data.stats,
      chart: data.chart,
      scatter: data.scatter,
      downloadUrl: data.downloadUrl || null,
    };

    fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), 'utf-8');

    console.log('Snapshot berhasil disimpan ke:');
    console.log(outputPath);
    console.log('\nRingkasan data:');
    console.log(`  Region : ${snapshot.stats?.region}`);
    console.log(`  Mean   : ${snapshot.stats?.mean?.toFixed(2)} ${snapshot.stats?.unit}`);
    console.log(`  Chart  : ${snapshot.chart?.length} titik data`);
    console.log(`  MapUrl : ${snapshot.map?.urlFormat?.substring(0, 60)}...`);
    console.log('\nSekarang refresh browser — peta LST akan muncul saat tour demo.');
  });

}).on('error', (err) => {
  console.error('Gagal menghubungi server:', err.message);
  console.error('Pastikan dev server sudah berjalan: npm run dev');
  process.exit(1);
});
