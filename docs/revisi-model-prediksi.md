# Rencana Revisi — Model Prediksi LST & NDVI

> **Status**: Draf kerja pasca-sidang (lulus dengan perbaikan)
> **Dibuat**: 6 Agustus 2026
> **Ruang lingkup**: `lib/gee/compute.js`, `lib/validators/queryParams.js`, `pages/index.js`, `pages/metodologi.js` + naskah BAB II/III/IV

---

## 1. Catatan penguji

| # | Kritik | Sifat |
|---|---|---|
| **K1** | Regresi linear ditolak karena nilai per tahun tidak linear, sehingga model tidak dapat menggambarkan nilai sebenarnya | Validitas metode |
| **K2** | Prediktor terlalu sedikit (hanya NDVI dan LST) sehingga hubungan regresi tidak dapat ditunjukkan | Kekayaan model |
| **K3** | Definisi baseline tidak jelas — akumulasi, perwakilan, atau apa. Target "+5 tahun" dihitung dari mana. Nilai proyeksi mewakili tanggal atau tahun. Banyak label tidak spesifik padahal menyangkut data | Kejelasan definisi data |

**Batasan tetap**: fitur prediksi **wajib dipertahankan** — ia yang membedakan aplikasi ini dari mode historis biasa. Revisi harus memperbaiki model, bukan menghapus fiturnya.

---

## 2. Hasil verifikasi kode (kondisi saat ini)

Semua temuan di bawah sudah dicek langsung ke sumbernya.

| Yang ditampilkan ke pengguna | Yang sebenarnya dihitung | Lokasi | Masalah |
|---|---|---|---|
| Tombol **"+5 Thn"** | `currentYear + offset` — dihitung dari tahun kalender berjalan, **bukan** dari akhir baseline | `pages/index.js:902` | Kalau baseline berakhir 2020, "+5 tahun" sesungguhnya ekstrapolasi 11 tahun. Tidak ada informasi ini di UI. |
| **"Proyeksi 2031"** | `scale × 2031 + offset`; karena *x* = tahun pecahan, `2031` berarti **t = 2031,0 = 1 Januari 2031** | `lib/gee/compute.js:88` | Nilai pada satu **titik waktu**, bukan nilai yang mewakili tahun 2031. Label menjanjikan tahun, angka memberi tanggal. |
| **"Data Historis (Baseline)"** | `dualCollection.mean()` — rata-rata **seluruh rentang tanggal** (bisa 10 tahun) | `lib/gee/compute.js:90-97` | Tidak pernah disebut mewakili tahun berapa. Inilah pertanyaan K3. |
| **"Delta (Selisih)"** | `proyeksi(1 Jan 2031) − rata-rata 10 tahun` | `pages/index.js:618` | **Membandingkan dua besaran tidak setara**: satu titik waktu dikurangi satu rata-rata multi-tahun. Paling sulit dibela. |
| Titik grafik tahunan | Rata-rata satu tahun penuh, tapi diplot pada **1 Januari** | `lib/gee/compute.js:170,176` | Rata-rata tahunan seharusnya diplot pada centroid tahun (1 Juli). |
| Peta proyeksi | Semua piksel diberi warna, termasuk piksel yang hanya punya 2–3 observasi | `lib/gee/compute.js:87` | Slope dari 2 observasi tidak berarti, tapi tampil sama meyakinkannya. |

### Temuan tambahan — pengondisian numerik

Variabel bebas saat ini adalah tahun absolut (`2019,45`). Artinya β₀ adalah nilai pada **tahun 0**, ekstrapolasi 2000+ tahun ke belakang. Matriks desainnya berkondisi buruk dan intercept-nya tidak punya makna fisik.

**Perbaikan**: pusatkan waktu ke epoch referensi, `t = tahun_pecahan − 2013`. β₀ jadi bermakna (nilai pada awal 2013) dan estimasi lebih stabil.

### Kesimpulan atas K3

Jawaban jujur terhadap pertanyaan "baseline itu akumulasi, perwakilan, atau bagaimana" adalah: **saat ini tidak terdefinisi**. Baseline adalah rata-rata periode, proyeksi adalah nilai sesaat, dan keduanya dibandingkan seolah setara.

---

## 3. Definisi baku yang dikunci

Semua istilah di bawah harus konsisten antara UI, API, halaman metodologi, dan naskah.

| Istilah | Definisi resmi | Tampil di UI sebagai |
|---|---|---|
| **Periode referensi** | Rentang tahun penuh yang dipakai memfit model | "Periode referensi: 2016–2025" |
| **Nilai tahunan** | Rata-rata seluruh observasi bebas awan dalam satu tahun kalender, diwakili pada centroid tahun (t = Y + 0,5) | Titik grafik pada 1 Juli tahun Y |
| **Nilai referensi** | Nilai tahunan pada tahun terakhir periode referensi | "Nilai tahunan 2025" |
| **Proyeksi** | Estimasi **rata-rata tahunan** pada tahun target, dari komponen tren model | "Proyeksi rata-rata tahunan 2031" |
| **Delta** | Proyeksi rata-rata tahunan (Y) − nilai tahunan tahun referensi terakhir | "Δ vs 2025" |
| **Target** | Tahun absolut, ditulis eksplisit beserta jaraknya dari akhir periode referensi | "2031 — 6 tahun setelah 2025" |
| **Horizon** | Selisih tahun target dengan akhir periode referensi | Dibatasi maks 10 tahun |

**Aturan turunan**: tombol target tidak boleh lagi memakai `currentYear`. Basisnya adalah **tahun terakhir periode referensi**.

---

## 4. Model usulan

Dua lapis yang menjawab dua kritik berbeda, dan saling melengkapi.

### 4.1 Lapis 1 — Regresi harmonik + tren (menjawab K1 dan K3)

Mengganti `ee.Reducer.linearFit()`.

```
y(t) = β₀ + β₁t + β₂cos(2πt) + β₃sin(2πt) + β₄cos(4πt) + β₅sin(4πt) + ε
```

dengan `t` = tahun pecahan dikurangi epoch 2013.

| Suku | Peran |
|---|---|
| β₀ | Nilai dasar pada epoch |
| β₁ | **Tren bersih per tahun** — inilah yang diekstrapolasi |
| β₂, β₃ | Siklus tahunan (musim hujan / kemarau) |
| β₄, β₅ | Siklus semi-tahunan (pola dua puncak) |

**Kenapa ini menjawab K1**: garis lurus tidak lagi dipaksakan pada data bermusim. Nonlinearitas dimodelkan eksplisit; yang tersisa linear hanya komponen trennya, dan itu asumsi wajar untuk rentang ~13 tahun.

**Kenapa ini sekaligus menjawab K3**: integral suku harmonik sepanjang satu tahun penuh sama dengan nol, sehingga rata-rata tahunan punya bentuk tertutup:

```
ȳ(tahun Y) = β₀ + β₁ · (Y − 2013 + 0,5)
```

Proyeksi kini punya definisi tegas — *rata-rata tahunan tahun Y*, setara persis dengan titik-titik historis di grafik. Delta menjadi perbandingan yang sah.

#### Sketsa implementasi

```js
const EPOCH = 2013;
const HARMONIC_X = ['constant', 't', 'cos1', 'sin1', 'cos2', 'sin2'];

const harmonic = dualCollection.map((img) => {
  const date = img.date();
  const t = ee.Number(date.get('year')).add(date.getFraction('year')).subtract(EPOCH);
  const tImg = ee.Image.constant(t).toFloat().rename('t');
  const w1 = tImg.multiply(2 * Math.PI);
  const w2 = tImg.multiply(4 * Math.PI);
  return ee.Image.cat([
    ee.Image.constant(1).toFloat().rename('constant'),
    tImg,
    w1.cos().rename('cos1'), w1.sin().rename('sin1'),
    w2.cos().rename('cos2'), w2.sin().rename('sin2'),
    img.select(mainBand),
  ]).copyProperties(img, ['system:time_start']);
});

const fit = harmonic
  .select(HARMONIC_X.concat([mainBand]))
  .reduce(ee.Reducer.linearRegression({ numX: 6, numY: 1 }));

const coeff = fit.select('coefficients').arrayProject([0]).arrayFlatten([HARMONIC_X]);

// Proyeksi rata-rata tahunan
const tTarget = targetYear - EPOCH + 0.5;
let projected = coeff.select('constant')
  .add(coeff.select('t').multiply(tTarget))
  .rename(mainBand);

// Kualitas fit
const rmse = fit.select('residuals').arrayFlatten([[mainBand]]).rename('rmse');
const variance = dualCollection.select(mainBand).reduce(ee.Reducer.variance());
const r2 = ee.Image(1).subtract(rmse.pow(2).divide(variance)).rename('r2');

// Topeng jumlah observasi minimum
const nObs = dualCollection.select(mainBand).reduce(ee.Reducer.count());
projected = projected.updateMask(nObs.gte(MIN_OBS));   // MIN_OBS = 20
```

> Catatan kejujuran metodologis: `r2` di atas adalah aproksimasi tanpa koreksi derajat bebas (membandingkan RMS residual dengan varians populasi). Sebutkan apa adanya di naskah, atau gunakan R² terkoreksi dengan n dan k eksplisit.

**Penjagaan tambahan yang wajib ada:**

- `MIN_OBS = 20` — piksel dengan observasi lebih sedikit ditopeng, tidak diwarnai
- Horizon maksimum **10 tahun** (turun dari 50)
- Periode referensi minimum **8 tahun penuh** saat mode prediksi aktif

### 4.2 Lapis 2 — Regresi berganda penjelas (menjawab K2)

```
LST = γ₀ + γ₁·NDVI + γ₂·NDBI + γ₃·MNDWI + γ₄·elevasi + ε
```

Saat ini `lib/gee/compute.js:57` hanya mengambil `SR_B2`–`SR_B5`. Menambahkan `SR_B6` (SWIR-1) langsung membuka tiga prediktor baru:

| Indeks | Rumus (Landsat 8) | Menangkap |
|---|---|---|
| **NDBI** | (B6 − B5) / (B6 + B5) | Kerapatan lahan terbangun |
| **MNDWI** | (B3 − B6) / (B3 + B6) | Badan air / kelembapan permukaan |
| **Elevasi** | `USGS/SRTMGL1_003` | Gradien suhu adiabatik |

```js
const reg = ee.Image.cat([
  ee.Image.constant(1).rename('constant'),
  ndviComposite, ndbiComposite, mndwiComposite, elevation,
  lstComposite,                       // variabel terikat, harus terakhir
]).reduceRegion({
  reducer: ee.Reducer.linearRegression({ numX: 5, numY: 1 }),
  geometry, scale: 200, bestEffort: true, maxPixels: 1e9,
});
```

Keluarannya koefisien regional + residual → dilaporkan sebagai tabel di BAB IV: koefisien, arah pengaruh, R². Inilah "hubungan regresi" yang penguji anggap belum bisa ditunjukkan.

### 4.3 Jalur proyeksi ganda — validasi silang gratis

```
Jalur A (langsung):    tren harmonik LST                → LST(2031)
Jalur B (via prediktor): tren harmonik NDVI/NDBI/MNDWI  → Lapis 2 → LST(2031)
```

Dua estimasi independen untuk besaran yang sama. Konvergen → bukti kuat. Divergen → bahan diskusi jujur tentang keterbatasan. Keduanya layak masuk BAB IV.

> **Jebakan yang harus disadari**: model penjelas spasial tidak otomatis jadi model prediksi temporal. Memproyeksikan LST lewat NDBI menuntut NDBI masa depan — masalahnya berpindah, bukan hilang. Sebutkan ini eksplisit di bagian keterbatasan, jangan tunggu ditanya.

---

## 5. Validasi — uji tahan-data

Ini yang menutup pertanyaan "seberapa akurat".

| Aspek | Rancangan |
|---|---|
| Data latih | 2013 – 2022 |
| Data uji | 2023, 2024, 2025 (tidak pernah dilihat model) |
| Prosedur | Fit Lapis 1 pada data latih → proyeksikan rata-rata tahunan 2023–2025 → bandingkan dengan rata-rata tahunan observasi |
| Metrik | RMSE, MAE, bias (rerata galat bertanda) |
| Rincian | Per kabupaten/kota (9 wilayah) × 2 variabel (LST, NDVI) |
| Pembanding | Model linear lama pada data yang sama — menunjukkan perbaikan secara kuantitatif |

Tabel perbandingan lama-vs-baru inilah pembenaran paling kuat atas keputusan mengganti model.

---

## 6. Perubahan per berkas

| Berkas | Perubahan |
|---|---|
| `lib/gee/compute.js` | Tambah `SR_B6` di baris 57; hitung NDBI & MNDWI; ganti cabang prediksi (80–97) dengan regresi harmonik; tambah topeng `MIN_OBS`; keluarkan R² & RMSE; ubah `date_millis` grafik ke 1 Juli; tambah fungsi regresi berganda |
| `lib/validators/queryParams.js` | Horizon 50 → 10 tahun; validasi periode referensi ≥ 8 tahun saat `mode=prediksi`; basis target year = tahun akhir baseline, bukan `nowYear` |
| `pages/api/map-layer.js` | Teruskan medan baru (`r2`, `rmse`, `n_obs`, koefisien) ke payload; kunci cache ikut berubah |
| `pages/index.js` | Tombol target berbasis akhir baseline; semua label sesuai §3; delta setara; kartu R²/RMSE; titik grafik di 1 Juli; aktifkan kembali scatter di mode prediksi dengan garis regresi Lapis 2 |
| `pages/metodologi.js` | Tulis ulang blok `prediction` (baris 84–105): rumus harmonik, definisi baseline, keterbatasan yang diperbarui |
| `scripts/` | Skrip baru untuk uji tahan-data yang mengeluarkan tabel RMSE/MAE |

---

## 7. Tahapan kerja

- [ ] **Tahap 1 — Fondasi & definisi.** Agregasi tahunan, perbaikan seluruh label sesuai §3, delta setara, titik grafik di centroid tahun. *Menuntaskan K3 sepenuhnya.*
- [ ] **Tahap 2 — Ganti model.** Regresi harmonik, waktu terpusat, R² & RMSE, topeng `MIN_OBS`, horizon 10 tahun, syarat baseline 8 tahun. *Menuntaskan K1.*
- [ ] **Tahap 3 — Perkaya prediktor.** `SR_B6`, NDBI, MNDWI, elevasi, regresi berganda, jalur proyeksi kedua. *Menuntaskan K2.*
- [ ] **Tahap 4 — Bukti.** Uji tahan-data, tabel perbandingan model lama vs baru per kabupaten.

**Kalau waktu sempit**: Tahap 1 + 2 + 4 sudah cukup untuk bertahan. Tahap 3 dapat masuk sebagian (indeks tambahan sebagai layer analisis) dengan regresi berganda penuh dipindah ke saran pengembangan.

---

## 8. Dampak ke naskah

| Bagian | Tindakan |
|---|---|
| Intisari | Ganti "model prediksi regresi linear" → "model tren harmonik dengan proyeksi kondisional" |
| BAB II | Persamaan 2.6 diganti: dari `linearFit` menjadi regresi harmonik. Tambah persamaan regresi berganda dan definisi metrik (R², RMSE, MAE) |
| BAB III | Tambah subbab definisi operasional (§3 dokumen ini) dan rancangan uji tahan-data |
| BAB IV | Tabel koefisien regresi berganda, tabel validasi per kabupaten, perbandingan model lama vs baru |
| BAB V | Keterbatasan diperbarui: horizon 10 tahun, asumsi tren linear pada komponen tren, ketergantungan proyeksi prediktor |

---

## 9. Dokumen lain yang ikut terdampak

| Berkas | Alasan |
|---|---|
| `docs/peta-baris-compute.md` | Seluruh nomor baris bergeser. Bagian D (cabang prediksi 80–97) dan tabel Persamaan 2.6 harus ditulis ulang |
| `docs/cheatsheet-sidang.md` | §3 (persamaan → baris) dan §5 (tahun prediksi maks 50) jadi usang |
| `pages/metodologi.js` | Halaman metodologi dalam aplikasi harus sinkron dengan naskah — penguji bisa membukanya saat sidang |
| `README.md` | Deskripsi fitur prediksi |
| `docs/test-cache-ratelimiter-2026-06-24.md` | Tidak terdampak — pengujian mode `history` |
| `implementation_plan.md` | Tidak terdampak — fokus security hardening |

---

## 10. Antisipasi pertanyaan lanjutan

| Pertanyaan | Jawaban |
|---|---|
| "Kenapa harmonik, bukan ARIMA atau LSTM?" | Harmonik berjalan **per piksel di sisi server GEE** — puluhan juta regresi paralel dalam hitungan detik. ARIMA/LSTM menuntut deret waktu lengkap per piksel yang ditarik ke klien; tidak layak untuk aplikasi web interaktif. Selain itu deret Landsat tidak berjarak seragam, yang menyulitkan ARIMA. |
| "Kenapa tidak Random Forest?" | Model berbasis pohon **tidak dapat berekstrapolasi** — di luar rentang tahun latih, prediksinya jadi konstan. Fatal untuk proyeksi masa depan. |
| "Kenapa horizon hanya 10 tahun?" | Rekaman Landsat 8 baru ~13 tahun. Kaidah lazim: horizon ekstrapolasi tidak melebihi ~75% panjang rekaman. |
| "Kenapa masih ada asumsi linear?" | Yang linear hanya komponen tren jangka panjang, setelah musiman dipisahkan. Ini asumsi baku dalam analisis tren penginderaan jauh dan diuji lewat R² serta uji tahan-data. |
| "Bagaimana kalau R² tetap rendah?" | Laporkan apa adanya per wilayah dan tampilkan di UI. Nilai rendah bermakna: tren di wilayah itu tidak dapat diandalkan, dan sistem menyatakannya secara terbuka alih-alih menyembunyikannya. |
| "Apakah ini prediksi atau proyeksi?" | **Proyeksi kondisional** — berlaku jika pola historis berlanjut. Istilah "prediksi" tidak dipakai lagi di UI maupun naskah. |
