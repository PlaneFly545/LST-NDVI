/**
 * scripts/generate-snapshot.js
 *
 * Jalankan saat dev server sudah berjalan:
 *   node scripts/generate-snapshot.js          → monitoring_snapshot.json
 *   node scripts/generate-snapshot.js --demo   → demo_snapshot.json (backward compatible)
 *
 * Script ini memanggil API lokal /api/map-layer dengan parameter default,
 * lalu menyimpan hasilnya ke public/data/ sebagai snapshot.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Deteksi mode ──
const isDemo = process.argv.includes('--demo');
const outputFile = isDemo ? 'demo_snapshot.json' : 'monitoring_snapshot.json';
const outputPath = path.join(__dirname, '..', 'public', 'data', outputFile);

// ── Parameter default untuk snapshot ──
const now = new Date();
const tenYearsAgo = new Date();
tenYearsAgo.setFullYear(now.getFullYear() - 10);

const params = new URLSearchParams({
  mode: 'history',
  type: 'ndvi',
  region_name: 'ALL',
  start_date: tenYearsAgo.toISOString().split('T')[0],
  end_date: now.toISOString().split('T')[0],
  cloud_cover: 30,
  reducer: 'Median',
  vis_min: -1,
  vis_max: 1,
  threshold: 0.5,
  gap_fill: 'none',
});

const url = `http://localhost:3000/api/map-layer?${params}`;

console.log(`\n📡 Generating ${isDemo ? 'DEMO' : 'MONITORING'} snapshot...`);
console.log(`   Target: ${outputFile}`);
console.log(`   URL: ${url}\n`);

const options = {
  hostname: 'localhost',
  port: 3000,
  path: `/api/map-layer?${params}`,
  method: 'GET',
  headers: {
    'User-Agent': 'SnapshotGenerator/1.0',
    'Accept': 'application/json',
  },
};

http.get(options, (res) => {
  let raw = '';

  res.on('data', (chunk) => { raw += chunk; });

  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error(`❌ Error: HTTP ${res.statusCode}`);
      console.error(raw);
      process.exit(1);
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error('❌ Gagal parse JSON response:', e.message);
      process.exit(1);
    }

    const snapshot = {
      _note: `Auto-generated ${isDemo ? 'demo' : 'monitoring'} snapshot. Jalankan ulang scripts/generate-snapshot.js untuk refresh.`,
      _generated_at: new Date().toISOString(),
      _params: Object.fromEntries(params),
      map: data.map,
      stats: data.stats,
      chart: data.chart,
      scatter: data.scatter,
      downloadUrl: data.downloadUrl || null,
    };

    fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), 'utf-8');

    console.log(`✅ Snapshot berhasil disimpan ke:`);
    console.log(`   ${outputPath}\n`);
    console.log(`   Region : ${snapshot.stats?.region}`);
    console.log(`   Mean   : ${snapshot.stats?.mean?.toFixed(2)} ${snapshot.stats?.unit}`);
    console.log(`   Chart  : ${snapshot.chart?.length} titik data`);
    console.log(`   MapUrl : ${snapshot.map?.urlFormat?.substring(0, 60)}...`);
    console.log(`\n🌐 Tile URL berlaku ~24 jam. Refresh berkala untuk menjaga ketersediaan.\n`);
  });

}).on('error', (err) => {
  console.error('❌ Gagal menghubungi server:', err.message);
  console.error('   Pastikan dev server sudah berjalan: npm run dev');
  process.exit(1);
});
