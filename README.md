# EcoMonitor Pro : LST & NDVI Spatio-Temporal Dashboard
**Sistem Deteksi Suhu Permukaan dan Kerapatan Vegetasi Provinsi Bali**

EcoMonitor Pro adalah platform analitik geospasial berbasis web yang dirancang khusus untuk memantau dan menganalisis **Suhu Permukaan Daratan (LST - Land Surface Temperature)** serta **Indeks Vegetasi (NDVI - Normalized Difference Vegetation Index)** di Provinsi Bali.

Aplikasi ini dikembangkan untuk menyederhanakan proses pengamatan satelit yang kompleks menjadi dashboard yang interaktif dan mudah dipahami. Tujuannya adalah membantu memahami dinamika lingkungan, melihat riwayat perubahan tutupan lahan, dan mengamati dampak perluasan kawasan perkotaan terhadap suhu wilayah lokal.

## 🎯 Mengapa Aplikasi Ini Dibuat?

Perubahan iklim berskala mikro dan alih fungsi lahan merupakan isu yang sangat krusial. Sistem ini hadir untuk membantu para pengguna menjawab hal-hal berikut dengan melihat langsung data dari satelit:
- Di area mana saja terjadi peningkatan suhu permukaan paling ekstrem di Bali?
- Apakah ada hubungan yang jelas antara berkurangnya area hijau (vegetasi) dengan peningkatan suhu di lokasi tersebut?
- Seberapa luas wilayah (dalam satuan Hektar) yang memasuki kriteria kritis pada periode waktu tertentu?

## ✨ Fitur Interaktif Utama

- **Pemantauan Terkini & Pelacakan Sejarah (Time-Travel)**
  Pengguna tidak hanya dapat memantau kondisi satelit terbaru (Near-Real Time) dengan kualitas citra yang telah dibersihkan dari gangguan awan, tetapi juga dapat menarik mundur rentang waktu untuk melakukan studi komparasi historis.

- **Peta Pemetaan Presisi Tinggi**
  Sistem menyediakan peta interaktif yang mewarnai setiap titik di batas wilayah Kabupaten/Kota di Bali sesuai dengan parameter suhu (panas ke dingin) maupun tingkat kesuburan vegetasi (gersang ke hijau).

- **Analitik Data Langsung (Live Analytics)**
  Ubah pandangan dari peta ke dalam bentuk angka dan grafik empiris seketika:
  - **Grafik Tren:** Melihat pola naik-turunnya nilai NDVI atau LST sepanjang tahun.
  - **Sebaran Korelasi:** Membandingkan kecenderungan perilaku dua variabel, misalnya pembuktian bahwa area bersuhu panas minim vegetasi hijau.
  - **Perhitungan Luas:** Menerjemahkan warna satelit menjadi satuan ukur pasti untuk mengetahui total area terdampak.

- **Akses Data Ekstraksi Satelit**
  Bagi keperluan analitik lanjutan, semua angka statistik dapat langsung diunduh dalam tabel *(CSV)*, dan olahan citra referensi dapat diekspor secara utuh dan original *(GeoTIFF)*.

## 🛰️ Teknologi Ekstraksi Satelit

Untuk menghadirkan data dengan skala masif ini secara instan, EcoMonitor Pro bekerja di atas infrastruktur **Google Earth Engine (GEE)**. Mesin komputasi awan ini bertugas memindai, membersihkan, dan mengalkulasi ratusan gigabyte rekam jejak satelit **Landsat 8 dan Landsat 9** sebelum menampilkannya ke dalam antarmuka dashboard visual yang modern dan cepat.

---
*Dikembangkan secara khusus sebagai wujud penerapan visualisasi data geospasial Spatio-Temporal wilayah Provinsi Bali.*
