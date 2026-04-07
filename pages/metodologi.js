// pages/metodologi.js
import Head from 'next/head';
import Link from 'next/link';
import {
  Activity, ArrowLeft, Satellite, Thermometer, Leaf,
  TrendingUp, Database, AlertTriangle, BookOpen, FlaskConical,
  ChevronRight, MapPin, BarChart3, Info
} from 'lucide-react';

// --- Data konten metodologi ---
const sections = [
  {
    id: 'overview',
    icon: Satellite,
    title: 'Gambaran Umum Sistem',
    color: 'slate',
    content: `Spatio-Temporal Analysis Engine ini adalah platform analisis geospasial berbasis web yang memanfaatkan citra satelit Landsat 8/9 Collection 2 Level 2 (C2L2) untuk memantau dua variabel lingkungan kritis di wilayah Bali: Land Surface Temperature (LST) dan Normalized Difference Vegetation Index (NDVI). Data diproses secara on-the-fly melalui Google Earth Engine (GEE), sehingga tidak memerlukan penyimpanan dataset raster lokal.`,
    subsections: []
  },
  {
    id: 'data-source',
    icon: Database,
    title: 'Sumber Data',
    color: 'blue',
    content: null,
    subsections: [
      {
        title: 'Satelit & Koleksi',
        body: 'Landsat 8/9 Collection 2 Tier 1 Level 2 (LANDSAT/LC08/C02/T1_L2). Koleksi ini merupakan produk Surface Reflectance yang telah menjalani koreksi atmosferik menggunakan LaSRC (Land Surface Reflectance Code) dan masking awan menggunakan CFMask.'
      },
      {
        title: 'Resolusi Spasial',
        body: '30 meter/piksel untuk band optik (SR_B2–SR_B5) dan band termal (ST_B10). Analisis dilakukan dengan reduksi ke 200–500 m menggunakan ee.Reducer untuk efisiensi komputasi.'
      },
      {
        title: 'Cakupan Temporal',
        body: 'Sejak 2013-01-01 (ketersediaan Landsat 8) hingga hari ini. Landsat 9 (diluncurkan 2021) memiliki karakteristik yang kompatibel sehingga koleksi dapat digabungkan.'
      },
      {
        title: 'Masking Awan',
        body: 'Menggunakan bit QA_PIXEL: Bit 3 (Cloud Shadow) dan Bit 4 (Cloud) difilter menggunakan operasi bitwiseAnd. Threshold tutupan awan (cloud_cover) dapat dikonfigurasi oleh pengguna (0–100%).'
      }
    ]
  },
  {
    id: 'ndvi',
    icon: Leaf,
    title: 'Formula NDVI',
    color: 'green',
    content: 'NDVI (Normalized Difference Vegetation Index) mengukur kerapatan vegetasi berbasis perbedaan reflektansi pada band Near-Infrared (NIR) dan Red.',
    formula: 'NDVI = (NIR − Red) / (NIR + Red)',
    formulaSub: 'NIR = SR_B5 × 0.0000275 − 0.2    |    Red = SR_B4 × 0.0000275 − 0.2',
    subsections: [
      {
        title: 'Interpretasi Nilai',
        body: 'Nilai NDVI berkisar antara −1 hingga +1. Nilai mendekati +1 mengindikasikan vegetasi lebat dan sehat. Nilai mendekati 0 mengindikasikan lahan terbuka atau tanah. Nilai negatif biasanya menandakan perairan atau awan.'
      },
      {
        title: 'Faktor Skala Landsat C2L2',
        body: 'Band Surface Reflectance pada Landsat C2L2 memiliki faktor skala 0.0000275 dan offset −0.2. Konversi ini wajib dilakukan sebelum kalkulasi indeks spektral agar nilainya berada dalam rentang fisik 0–1.'
      }
    ]
  },
  {
    id: 'lst',
    icon: Thermometer,
    title: 'Formula LST',
    color: 'red',
    content: 'LST (Land Surface Temperature) diturunkan dari band termal Landsat (ST_B10) yang menggunakan algoritma Single-Channel (SC) berbasis Look-Up Table dari USGS.',
    formula: 'LST (°C) = ST_B10 × 0.00341802 + 149.0 − 273.15',
    formulaSub: 'Konversi: Digital Number → Kelvin → Celsius',
    subsections: [
      {
        title: 'Band Termal (ST_B10)',
        body: 'Band 10 Landsat 8/9 merupakan sensor Thermal Infrared Sensor (TIRS) dengan panjang gelombang 10.6–11.19 μm. Koleksi C2L2 sudah menambahkan koreksi emissivitas berbasis ASTER GED sehingga output langsung berupa suhu permukaan (bukan kecerahan termal).'
      },
      {
        title: 'Akurasi',
        body: 'Produk ST C2L2 memiliki RMSE ~2°C dibandingkan data in-situ. Akurasi berkurang di atas permukaan air dan di kawasan dengan tutupan awan tipis yang lolos masking.'
      }
    ]
  },
  {
    id: 'prediction',
    icon: TrendingUp,
    title: 'Model Prediksi Linear',
    color: 'violet',
    content: 'Mode prediksi menggunakan regresi linear temporal (OLS) yang diimplementasikan melalui ee.Reducer.linearFit() di Google Earth Engine.',
    formula: 'Value(t) = scale × t + offset',
    formulaSub: 'scale: koefisien tren per tahun    |    offset: intercept regresi',
    subsections: [
      {
        title: 'Implementasi GEE',
        body: 'Setiap piksel dalam koleksi ditambahkan band "time" (fractional year). ee.Reducer.linearFit() mengestimasi koefisien scale dan offset per piksel secara paralel. Proyeksi dihitung dengan mengsubstitusikan target_year ke dalam persamaan.'
      },
      {
        title: 'Keterbatasan Model',
        body: 'Model mengasumsikan tren bersifat linear dan stasioner. Model tidak memperhitungkan: (1) variabilitas iklim jangka pendek (El Niño/La Niña), (2) perubahan tata guna lahan mendadak, (3) bias citra akibat musim hujan dengan tutupan awan tinggi yang tidak terfilter sempurna.'
      },
      {
        title: 'Interpretasi Proyeksi',
        body: 'Proyeksi bersifat kondisional — berlaku hanya jika pola historis terus berlanjut. Semakin panjang rentang historis (≥10 tahun), semakin representatif koefisien regresi.'
      }
    ]
  },
  {
    id: 'gap-fill',
    icon: FlaskConical,
    title: 'Gap Filling & Komposit',
    color: 'amber',
    content: null,
    subsections: [
      {
        title: 'Komposit Temporal (Bawaan)',
        body: 'Reduksi statistik (Median, Mean, Max, Mosaic) pada kumpulan semua citra dalam rentang tanggal. Pendekatan ini mempertahankan nilai observasi asli yang bebas awan. Median dipilih sebagai default karena lebih tahan terhadap outlier dibanding Mean.'
      },
      {
        title: 'Interpolasi Spasial (Focal Mean)',
        body: 'Menambal piksel yang termasking awan menggunakan rata-rata piksel tetangga dengan kernel persegi 2×2, 2 iterasi. Berguna di kawasan dengan frekuensi awan tinggi, namun dapat memperhalus batas spasial yang tajam.'
      }
    ]
  },
  {
    id: 'limitations',
    icon: AlertTriangle,
    title: 'Keterbatasan & Catatan',
    color: 'orange',
    content: null,
    subsections: [
      {
        title: 'Resolusi Temporal',
        body: 'Landsat memiliki revisit time 16 hari. Di Bali dengan curah hujan tinggi, citra bebas awan dalam periode tertentu bisa sangat terbatas, menghasilkan komposit dari sedikit citra saja.'
      },
      {
        title: 'Agregasi Tahunan',
        body: 'Grafik time-series menggunakan rata-rata tahunan (bukan bulanan) untuk menghindari ketidakseimbangan akibat perbedaan jumlah citra per bulan. Ini mengurangi variansi musiman yang mungkin relevan secara ekologis.'
      },
      {
        title: 'Area Scatter',
        body: 'Scatter plot korelasi LST–NDVI menggunakan 150 sampel piksel acak. Hasilnya bersifat representatif, bukan sensus penuh piksel. Untuk analisis statistik formal, gunakan data CSV yang diekspor.'
      },
      {
        title: 'GEE Quota',
        body: 'GEE memiliki batas komputasi per Service Account. Request dengan wilayah sangat besar (Seluruh Bali) dan rentang tanggal panjang (>5 tahun) dapat memakan waktu 30–120 detik. Cache in-memory 24 jam diterapkan untuk menghindari komputasi berulang dengan parameter identik.'
      }
    ]
  }
];

const colorMap = {
  slate: { bg: 'bg-slate-50', border: 'border-slate-200', icon: 'bg-slate-800 text-white', badge: 'bg-slate-100 text-slate-500', accent: 'text-slate-700' },
  blue: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'bg-blue-600 text-white', badge: 'bg-blue-100 text-blue-600', accent: 'text-blue-700' },
  green: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'bg-emerald-600 text-white', badge: 'bg-emerald-100 text-emerald-600', accent: 'text-emerald-700' },
  red: { bg: 'bg-rose-50', border: 'border-rose-200', icon: 'bg-rose-600 text-white', badge: 'bg-rose-100 text-rose-600', accent: 'text-rose-700' },
  violet: { bg: 'bg-violet-50', border: 'border-violet-200', icon: 'bg-violet-600 text-white', badge: 'bg-violet-100 text-violet-600', accent: 'text-violet-700' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'bg-amber-500 text-white', badge: 'bg-amber-100 text-amber-600', accent: 'text-amber-700' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', icon: 'bg-orange-500 text-white', badge: 'bg-orange-100 text-orange-600', accent: 'text-orange-700' },
};

export default function Metodologi() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      <Head>
        <title>Metodologi — Spatio-Temporal Analysis Engine LST &amp; NDVI Bali</title>
        <meta
          name="description"
          content="Dokumentasi metodologi ilmiah: formula LST dan NDVI, sumber data Landsat 8/9, model prediksi linear, serta keterbatasan sistem analisis spasio-temporal Bali."
        />
      </Head>

      {/* ── NAVBAR ── */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-colors no-underline"
            >
              <ArrowLeft size={14} /> Kembali ke Peta
            </Link>
            <span className="text-slate-200">|</span>
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-slate-800" />
              <span className="text-sm font-bold text-slate-800 hidden sm:block">Dokumentasi Metodologi</span>
            </div>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
            Landsat 8/9 · GEE
          </span>
        </div>
      </nav>

      {/* ── HERO ── */}
      <header className="bg-slate-800 text-white">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-12 md:py-16">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <BookOpen size={12} /> Dokumentasi Teknis &amp; Akademis
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight mb-3 leading-tight">
            Metodologi &amp; Dasar Ilmiah
          </h1>
          <p className="text-slate-300 text-sm md:text-base leading-relaxed max-w-2xl">
            Penjelasan lengkap formula, sumber data, dan keterbatasan sistem analisis
            spasio-temporal LST &amp; NDVI Bali berbasis Google Earth Engine.
          </p>
          <div className="flex flex-wrap gap-2 mt-6">
            {['Landsat 8/9 C2L2', 'Google Earth Engine', 'OLS Regression', 'Bali Province'].map(tag => (
              <span key={tag} className="text-[11px] font-semibold text-slate-300 bg-white/10 border border-white/10 px-2.5 py-1 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ── TABLE OF CONTENTS ── */}
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
        <nav className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">Daftar Isi</p>
          <ol className="space-y-1.5">
            {sections.map((s, i) => {
              const Icon = s.icon;
              const c = colorMap[s.color];
              return (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="flex items-center gap-2.5 text-sm text-slate-600 hover:text-slate-900 no-underline group"
                  >
                    <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${c.icon} transition-transform group-hover:scale-110`}>
                      <Icon size={11} />
                    </span>
                    <span className="font-medium">{i + 1}. {s.title}</span>
                    <ChevronRight size={12} className="text-slate-300 group-hover:translate-x-0.5 transition-transform ml-auto" />
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {/* ── SECTIONS ── */}
      <main className="max-w-4xl mx-auto px-4 md:px-6 pb-16 space-y-8">
        {sections.map((section, idx) => {
          const Icon = section.icon;
          const c = colorMap[section.color];
          return (
            <article
              key={section.id}
              id={section.id}
              className={`rounded-2xl border ${c.border} ${c.bg} overflow-hidden shadow-sm scroll-mt-20`}
            >
              {/* Section header */}
              <div className={`flex items-center gap-3 px-6 py-4 border-b ${c.border} bg-white/60`}>
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${c.icon}`}>
                  <Icon size={16} />
                </div>
                <div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${c.accent}`}>{idx + 1} / {sections.length}</span>
                  <h2 className="text-base font-bold text-slate-800 leading-tight">{section.title}</h2>
                </div>
              </div>

              <div className="px-6 py-5 space-y-5">
                {section.content && (
                  <p className="text-sm text-slate-600 leading-relaxed">{section.content}</p>
                )}

                {/* Formula block */}
                {section.formula && (
                  <div className="bg-slate-800 rounded-xl p-4 font-mono">
                    <p className={`text-base font-bold ${c.accent === 'text-slate-700' ? 'text-emerald-400' : c.accent.replace('700', '300')}`}>
                      {section.formula}
                    </p>
                    {section.formulaSub && (
                      <p className="text-slate-400 text-[11px] mt-2">{section.formulaSub}</p>
                    )}
                  </div>
                )}

                {/* Subsections */}
                {section.subsections.length > 0 && (
                  <div className="space-y-3">
                    {section.subsections.map((sub) => (
                      <div key={sub.title} className="bg-white/80 border border-white rounded-xl p-4">
                        <p className={`text-xs font-bold mb-1.5 ${c.accent}`}>{sub.title}</p>
                        <p className="text-sm text-slate-600 leading-relaxed">{sub.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}

        {/* ── REFERENSI ── */}
        <article className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50">
            <div className="w-8 h-8 rounded-xl bg-slate-800 text-white flex items-center justify-center shrink-0">
              <BookOpen size={16} />
            </div>
            <h2 className="text-base font-bold text-slate-800">Referensi</h2>
          </div>
          <div className="px-6 py-5 space-y-3">
            {[
              { label: 'Landsat Collection 2 Level 2 Science Product Guide', url: 'https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/atoms/files/LSDS-1328_Landsat8-9-Collection2-L2-Science-Product-Guide-v6.pdf' },
              { label: 'Google Earth Engine API Reference', url: 'https://developers.google.com/earth-engine/apidocs' },
              { label: 'Ermida et al. (2020) — Landsat LST Retrieval', url: 'https://doi.org/10.3390/rs12091471' },
              { label: 'Rouse et al. (1974) — Monitoring Vegetation Systems (NDVI Origin Paper)', url: 'https://ntrs.nasa.gov/citations/19740022614' },
            ].map(ref => (
              <a
                key={ref.label}
                href={ref.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors no-underline group"
              >
                <ChevronRight size={14} className="text-slate-400 group-hover:text-slate-700 mt-0.5 shrink-0 transition-colors" />
                <span className="text-sm text-slate-600 group-hover:text-slate-800 transition-colors leading-relaxed">{ref.label}</span>
              </a>
            ))}
          </div>
        </article>

        {/* ── CTA balik ke peta ── */}
        <div className="text-center pt-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-slate-800 text-white text-sm font-bold rounded-xl hover:bg-slate-900 transition-colors no-underline"
          >
            <MapPin size={15} /> Kembali ke Peta Analisis
          </Link>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Activity size={12} />
            <span>Spatio-Temporal Analysis Engine · LST &amp; NDVI Bali</span>
          </div>
          <span className="text-[11px] text-slate-300">Landsat 8/9 · Google Earth Engine · Next.js</span>
        </div>
      </footer>
    </div>
  );
}
