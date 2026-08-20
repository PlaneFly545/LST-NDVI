// pages/index.js
import { useState, useEffect, useRef, useCallback } from 'react';
import TourOverlay, { TourTriggerButton } from '../components/TourOverlay';
import Head from 'next/head';
import Script from 'next/script';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { shift } from '@floating-ui/react';
import {
  Leaf, ThermometerSun, Activity, Menu, Download, FileDown,
  ChevronDown, AlertTriangle, ScatterChart as ScatterIcon,
  TrendingUp, History, Info, BookOpen,
  PanelLeftOpen, PanelLeftClose, MapPin, X, ClipboardList,
  Satellite, BarChart3, BellRing
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ReferenceLine
} from 'recharts';
import { Toaster, toast } from 'sonner';
import { saveAs } from 'file-saver';
import baliData from '../public/data/bali_kabkota.json';
import { resolveFullYearRange } from '../lib/validators/queryParams';

const MapWithNoSSR = dynamic(() => import('../components/Map'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-slate-50">
      <div className="w-10 h-10 mb-4 border-4 rounded-full border-slate-200 border-t-slate-800 animate-spin"></div>
      <p className="text-sm font-medium">Menghubungkan ke Satelit...</p>
    </div>
  )
});

// Batas Rentang Visualisasi per jenis layer. Harus berada DI DALAM batas server
// (lib/validators/queryParams.js: NDVI -1..1, LST -50..80). Kalau input dibiarkan
// melebihi batas server, server meng-clamp diam-diam dan legenda peta akan
// menampilkan skala yang tidak dipakai GEE.
//
// NDVI -1..1 mengikuti sifat rumusnya. LST dipersempit ke 0..70 °C — rentang
// suhu permukaan yang wajar untuk wilayah tropis.
const LAYER_BOUNDS = {
  ndvi: { min: -1,  max: 1,  defMin: -1, defMax: 1  },
  lst:  { min: 0,   max: 70, defMin: 20, defMax: 45 },
};

// Satu sumber nama layer untuk seluruh antarmuka. Sebelumnya LST muncul dalam
// tiga bentuk berbeda (legenda "Suhu Permukaan", kartu "LST", tombol "LST"),
// sehingga pembaca tidak yakin ketiganya merujuk hal yang sama.
// NDVI sengaja tanpa satuan — indeks rasio memang tidak bersatuan.
const LAYER_LABEL = {
  ndvi: { short: 'NDVI', full: 'Indeks Vegetasi (NDVI)', unit: '',   axis: 'Indeks Vegetasi (NDVI)' },
  lst:  { short: 'LST',  full: 'Suhu Permukaan (LST)',   unit: '°C', axis: 'Suhu Permukaan (°C)' },
};

/** Tempelkan satuan bila ada, tanpa meninggalkan spasi menggantung. */
const withUnit = (value, unit) => (unit ? `${value} ${unit}` : `${value}`);

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const MONTH_NAME = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/**
 * 'YYYY-MM-DD' → '12 Jun 2019'.
 *
 * String dipotong langsung, bukan dibungkus new Date(). Tanggal ini datang dari
 * ee.Date.format() dalam UTC; melewatkannya ke Date lalu membacanya dengan
 * getDate() akan digeser ke zona waktu lokal dan bisa mundur satu hari.
 */
const formatSceneDate = (iso) => {
  const [year, month, day] = String(iso).split('-');
  const name = MONTH_ABBR[Number(month) - 1];
  return name ? `${Number(day)} ${name} ${year}` : String(iso);
};

// Wadah portal kalender. react-datepicker membuat sendiri elemen ber-id ini di
// <body> saat kalender pertama kali dibuka, jadi tidak perlu dirender manual.
// Penataan lapisannya ada di .react-datepicker-popper (styles/globals.css).
const DATEPICKER_PORTAL_ID = 'datepicker-portal';

// Middleware bawaan react-datepicker hanya flip, offset, dan arrow — tidak ada
// satu pun yang menggeser kalender ke samping saat ia keluar layar. Padahal
// kalender jauh lebih lebar daripada input tanggal yang sempit, jadi julurnya
// bisa melewati tepi jendela dan terpotong di situ.
const DATEPICKER_POPPER_FIX = {
  // Sejajarkan tepi kiri kalender ke tepi kiri input. Default floating-ui
  // menengahkan kalender terhadap input, sehingga input paling kiri panel
  // mendorong kalender keluar tepi kiri jendela.
  popperPlacement: 'bottom-start',
  // Jaring pengaman untuk sisanya: jendela sempit, panel mode overlay di layar
  // kecil, dan input kanan yang dekat tepi kanan jendela.
  popperModifiers: [shift({ padding: 8 })],
  // position: fixed, bukan absolute. Blok penampung elemen fixed adalah viewport,
  // jadi overflow milik leluhur mana pun tidak bisa memotongnya — termasuk kotak
  // scroll panel kontrol. Ini menutup kemungkinan kalender masih terpotong
  // seandainya portal tidak sepenuhnya bekerja, dan sekalian membuat shift
  // mengukur terhadap viewport, bukan terhadap kotak yang lebih sempit.
  popperProps: { strategy: 'fixed' },
};

// Titik grafik sekarang bertahun ({ year, value }). Snapshot yang dibuat sebelum
// perubahan ini menyimpan tanggal ({ date: 'YYYY-MM-DD' }); dikonversi di sini
// supaya berkas snapshot lama tetap tampil sampai diregenerasi.
const normalizeChartPoints = (points) =>
  (points || [])
    .map((p) => (p?.year !== undefined ? p : { ...p, year: Number(String(p?.date || '').slice(0, 4)) }))
    .filter((p) => Number.isFinite(p.year));

/** Batasi angka ke rentang [lo, hi]; kembalikan fallback bila bukan angka. */
const clampNum = (raw, lo, hi, fallback) => {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, lo), hi);
};

// Rentang tanggal yang dipilih pengguna tidak selalu sama dengan tahun yang
// benar-benar diagregasi, karena hanya tahun kalender penuh yang dihitung.
// Keterangan ini sengaja hanya dirender saat keduanya memang berbeda: pengguna
// yang sudah memilih 1 Januari–31 Desember tidak melihat teks tambahan apa pun.
const FullYearNote = ({ years }) => {
  if (!years) return null;

  // Periode yang tidak memuat satu pun tahun penuh tetap boleh dianalisis, tapi
  // tidak punya rentang tahun untuk disebut — yang bisa dikatakan hanya bahwa
  // tahunnya tercakup sebagian.
  if (years.partial) {
    return (
      <span className="text-[11px] text-amber-600 mt-1.5 block">
        Belum memuat tahun kalender penuh · tahun sebagian akan ditandai di grafik
      </span>
    );
  }

  return (
    <span className="text-[11px] text-slate-400 mt-1.5 block">
      Dianalisis {years.startYear}–{years.endYear} · tahun kalender penuh
    </span>
  );
};

// Alasannya dipisah ke tooltip supaya baris keterangan di atas tetap sependek
// mungkin. Pola hover-nya sama dengan penjelasan Pemrosesan Awan, tapi terbuka
// ke bawah: kontrol ini duduk di bagian atas panel, jadi tooltip yang terbuka
// ke atas terpotong tepi layar.
const FullYearInfo = () => (
  <div className="group relative cursor-help flex items-center">
    <Info size={13} className="text-slate-300 hover:text-slate-500 transition-colors" />
    <div className="absolute left-0 top-full mt-2 hidden group-hover:block w-64 p-3 bg-slate-800 text-white text-[11px] rounded-xl shadow-xl z-50 text-left leading-relaxed border border-slate-700">
      <span className="block font-semibold text-slate-200 mb-1">Mengikuti standar WMO</span>
      <span className="text-slate-400 block">
        Periode acuan iklim WMO dibatasi tahun kalender penuh 1 Januari–31 Desember.
        Tahun yang tercakup sebagian dibuang karena musimnya tidak lengkap.
      </span>
    </div>
  </div>
);

const MapLegend = ({ type, min, max, isPrediction, targetYear }) => {
  const gradient = type === 'ndvi'
    ? 'linear-gradient(to right, #ef4444, #facc15, #22c55e)'
    : 'linear-gradient(to right, #1e1b4b, #38bdf8, #fef08a, #ef4444, #7f1d1d)';

  const label = LAYER_LABEL[type] || LAYER_LABEL.lst;

  return (
    <div className="absolute bottom-4 right-4 md:bottom-6 md:right-6 z-[2000] bg-white/90 backdrop-blur-md p-2.5 md:p-3.5 rounded-xl shadow-lg border border-slate-200/50 w-[70vw] max-w-[200px] md:max-w-none md:w-64">
      <div className="flex items-center justify-between mb-1.5 md:mb-2.5">
        <span className="text-[10px] md:text-xs font-semibold text-slate-600 truncate mr-2">
          {label.full}
        </span>
        <span className="px-1.5 md:px-2 py-0.5 text-[9px] md:text-[10px] bg-slate-100 rounded text-slate-500 whitespace-nowrap">Landsat 8/9</span>
      </div>

      {/* Tanpa penanda ini, peta prediksi terlihat identik dengan peta historis. */}
      <div className="text-[9px] md:text-[10px] text-slate-400 mb-1.5 md:mb-2 truncate">
        {isPrediction
          ? `Prediksi ${targetYear} (rata-rata tahunan)`
          : 'Data historis (komposit periode terpilih)'}
      </div>

      <div className="w-full h-1.5 md:h-2 mb-1.5 md:mb-2 rounded-full" style={{ background: gradient }}></div>
      <div className="flex justify-between text-[10px] md:text-[11px] text-slate-500">
        <span>{withUnit(min, label.unit)}</span>
        <span>{withUnit(((min + max) / 2).toFixed(1), label.unit)}</span>
        <span>{withUnit(max, label.unit)}</span>
      </div>
    </div>
  );
};

export default function Home() {
  const today = new Date();
  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(today.getFullYear() - 10);

  // State Visual Mode
  const [visualMode, setVisualMode] = useState('tunggal');

  const [startDate, setStartDate] = useState(tenYearsAgo);
  const [endDate, setEndDate] = useState(today);

  // State Tanggal untuk Peta Kanan (Mode Split)
  const [startDateRight, setStartDateRight] = useState(new Date('2020-01-01'));
  const [endDateRight, setEndDateRight] = useState(today);

  const [region, setRegion] = useState('Seluruh Bali');
  const [layerType, setLayerType] = useState('lst');
  const [selectedGeoJson, setSelectedGeoJson] = useState(baliData);

  const [cloudCover, setCloudCover] = useState(30);
  const [debouncedCloudCover, setDebouncedCloudCover] = useState(30);

  const [reducer, setReducer] = useState('Median');
  const [visMin, setVisMin] = useState(20);
  const [visMax, setVisMax] = useState(45);
  const [threshold, setThreshold] = useState(30);

  const [mapUrl, setMapUrl] = useState(null);
  const [mapUrlRight, setMapUrlRight] = useState(null);

  const [stats, setStats] = useState(null);
  const [statsRight, setStatsRight] = useState(null);

  // State Grafik (Dukungan untuk Split Mode)
  const [chartData, setChartData] = useState([]);
  const [scatterData, setScatterData] = useState([]);
  const [chartDataRight, setChartDataRight] = useState([]);
  const [scatterDataRight, setScatterDataRight] = useState([]);

  // Daftar citra sumber per tahun: [{ year, count, dates: [{ date, n }] }].
  // Dipakai untuk menyebut jumlah citra di tooltip tren dan merinci tanggal
  // perekamannya di bawah grafik.
  const [scenes, setScenes] = useState([]);
  const [scenesRight, setScenesRight] = useState([]);
  const [showSceneDates, setShowSceneDates] = useState(false);

  // Profil musiman: [{ month, value, count }] dengan month 1–12. Di mode
  // historis tiap titik adalah rata-rata seluruh citra bulan itu sepanjang
  // periode; di mode prediksi nilainya keluaran model dan count-nya null.
  const [seasonalData, setSeasonalData] = useState([]);
  const [seasonalDataRight, setSeasonalDataRight] = useState([]);

  const [activeSplitSide, setActiveSplitSide] = useState('left'); // 'left' | 'right'

  const [preparingTiff, setPreparingTiff] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  const [analysisMode, setAnalysisMode] = useState('history');
  const [chartMode, setChartMode] = useState('trend');

  // Modal Evaluasi UEQ
  const [showUeqModal, setShowUeqModal] = useState(false);

  // Pengingat evaluasi (lonceng) — user boleh menyembunyikannya secara permanen.
  // Pilihan disimpan di localStorage agar tidak muncul lagi setiap reload.
  const BELL_KEY = 'ecomonitor_bell_hidden';
  const [isBellHidden, setBellHidden] = useState(false);

  const handleHideBell = () => {
    setBellHidden(true);
    setShowUeqModal(false);
    if (typeof window !== 'undefined') localStorage.setItem(BELL_KEY, '1');
    toast('Pengingat evaluasi disembunyikan.', {
      description: 'Kuesioner tetap bisa dibuka lewat menu "Evaluasi UEQ".',
      duration: 5000,
    });
  };

  // Yang disimpan jaraknya (+1/+3/+5/+10), bukan tahunnya. Tahun target selalu
  // diturunkan dari akhir periode baseline, jadi menggeser periode otomatis
  // menggeser tahun target — bukan meninggalkan tahun basi dari tombol yang
  // ditekan sebelumnya.
  const [predictionOffset, setPredictionOffset] = useState(5);

  // Tahun periode diturunkan dengan aturan yang sama persis seperti server:
  // hanya tahun kalender penuh yang dihitung, dan sumbernya string tanggal yang
  // benar-benar dikirim ke API (hasil toISOString), bukan objek Date lokal.
  // Kalau dibaca dari Date lokal, label bisa meleset satu tahun dari yang
  // dipakai server karena pergeseran zona waktu.
  const toApiDate = (d) => d.toISOString().split('T')[0];
  const fullYearsOf = (from, to) => resolveFullYearRange(
    new Date(`${toApiDate(from)}T00:00:00.000Z`),
    new Date(`${toApiDate(to)}T00:00:00.000Z`)
  );

  // Tahun mentah dari tanggal yang dipilih, dipakai hanya untuk mendeteksi
  // apakah pemangkasan tahun penuh benar-benar terjadi.
  const apiYear = (d) => Number(toApiDate(d).slice(0, 4));
  const isTrimmed = (years, from, to) => (
    years ? (years.startYear !== apiYear(from) || years.endYear !== apiYear(to)) : false
  );

  const baselineYears = fullYearsOf(startDate, endDate);
  const baselineStartYear = baselineYears?.startYear ?? startDate.getFullYear();
  const baselineEndYear = baselineYears?.endYear ?? endDate.getFullYear();
  // Tiga keadaan, bukan dua: rentang pas di tahun penuh (tanpa catatan), rentang
  // terpangkas ke tahun penuh (catatan tahun mana yang dipakai), dan rentang
  // yang tidak memuat tahun penuh sama sekali (catatan bahwa tidak ada).
  const baselineNote = baselineYears
    ? (isTrimmed(baselineYears, startDate, endDate) ? baselineYears : null)
    : { partial: true };
  const targetYear = baselineEndYear + predictionOffset;

  // Label periode diisi tahunnya langsung. "Peta 1" tidak memberi tahu apa pun —
  // pembaca harus balik ke panel tanggal untuk tahu peta itu periode berapa.
  const periodeLabelKiri  = `Periode 1 · ${baselineStartYear}–${baselineEndYear}`;
  const rightYears = fullYearsOf(startDateRight, endDateRight);
  const rightNote = rightYears
    ? (isTrimmed(rightYears, startDateRight, endDateRight) ? rightYears : null)
    : { partial: true };
  const periodeLabelKanan = `Periode 2 · ${rightYears?.startYear ?? startDateRight.getFullYear()}–${rightYears?.endYear ?? endDateRight.getFullYear()}`;

  const [gapFill, setGapFill] = useState('none');

  // ── Tour State ──
  const TOUR_KEY = 'ecomonitor_tour_done';
  const [isTourActive, setIsTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0); // dipakai untuk deteksi step 'process'

  // Cek localStorage di client — tampilkan tour jika belum pernah
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (!localStorage.getItem(TOUR_KEY)) {
        setIsTourActive(true);
      }

      // Hormati pilihan user yang sudah menyembunyikan lonceng sebelumnya
      if (localStorage.getItem(BELL_KEY)) {
        setBellHidden(true);
      }

      // Override Leaflet TileLayer secara dinamis di sisi client untuk menyembunyikan label saat demo
      import('leaflet').then((L) => {
        if (!L || !L.TileLayer) return;
        if (L.TileLayer.prototype.__intercepted) return;
        L.TileLayer.prototype.__intercepted = true;
        const originalGetTileUrl = L.TileLayer.prototype.getTileUrl;
        L.TileLayer.prototype.getTileUrl = function (coords) {
          let url = originalGetTileUrl.call(this, coords);
          if (typeof window !== 'undefined' && window.__demoActive && url.includes('tile.openstreetmap.org')) {
            const z = Math.round(coords.z);
            const x = Math.round(coords.x);
            const y = Math.round(coords.y);
            return `https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/${z}/${x}/${y}.png`;
          }
          return url;
        };
      }).catch(err => console.error('Gagal memuat Leaflet intercept:', err));
    }
  }, []);

  // ── Auto-load monitoring snapshot saat halaman dibuka ──
  // Snapshot berisi data analisis pra-generate (oleh cron / script).
  // User langsung melihat peta + statistik tanpa klik apapun.
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState(null); // tanggal generate snapshot

  const loadSnapshot = async () => {
    try {
      const res = await fetch('/data/monitoring_snapshot.json');
      if (!res.ok) return;

      const snapshot = await res.json();

      // Validasi: pastikan data masih bisa dipakai
      if (!snapshot?.map?.urlFormat || (!snapshot?.stats?.mean && snapshot?.stats?.mean !== 0)) return;

      // Set semua state — peta langsung muncul!
      setMapUrl(snapshot.map.urlFormat);
      setStats(snapshot.stats);
      setChartData(normalizeChartPoints(snapshot.chart));
      setScatterData(snapshot.scatter || []);
      // Snapshot lama belum menyimpan daftar citra; tanpa kunci ini bagian
      // "Tanggal citra" cukup tidak muncul, bukan menampilkan daftar kosong.
      setScenes(snapshot.scenes || []);
      setSeasonalData(snapshot.seasonal || []);
      if (snapshot._generated_at) setSnapshotDate(new Date(snapshot._generated_at));

      // Sinkronisasi parameter filter dengan data snapshot yang dimuat
      const params = snapshot._params || {};
      if (params.type) setLayerType(params.type);
      if (params.region_name) {
        setRegion(params.region_name === 'ALL' ? 'Seluruh Bali' : params.region_name);
      }
      // Rentang tanggal ikut disalin, bukan dibiarkan di nilai awal aplikasi.
      // Label periode dan keterangan tahun kalender penuh diturunkan dari kedua
      // pemilih tanggal ini, jadi kalau tidak disalin panel kiri menjelaskan
      // periode yang berbeda dari grafik yang sedang tampil di sebelahnya.
      // new Date('YYYY-MM-DD') dibaca sebagai tengah malam UTC — sama seperti
      // landsatMinDate — sehingga toISOString() mengembalikan string yang persis
      // sama saat rentang ini dikirim lagi ke API.
      const snapshotStart = params.start_date ? new Date(params.start_date) : null;
      const snapshotEnd = params.end_date ? new Date(params.end_date) : null;
      // Tanggal cacat akan melempar RangeError di toISOString() pada render
      // berikutnya dan menjatuhkan seluruh halaman, jadi dipastikan valid dulu.
      if (snapshotStart && !Number.isNaN(snapshotStart.getTime())) setStartDate(snapshotStart);
      if (snapshotEnd && !Number.isNaN(snapshotEnd.getTime())) setEndDate(snapshotEnd);
      if (params.vis_min !== undefined) setVisMin(parseFloat(params.vis_min));
      if (params.vis_max !== undefined) setVisMax(parseFloat(params.vis_max));
      if (params.threshold !== undefined) setThreshold(parseFloat(params.threshold));
      if (params.cloud_cover !== undefined) {
        setCloudCover(parseInt(params.cloud_cover));
        setDebouncedCloudCover(parseInt(params.cloud_cover));
      }
      if (params.reducer) setReducer(params.reducer);
      if (params.gap_fill) setGapFill(params.gap_fill);

      setSnapshotLoaded(true);
    } catch {
      // Gagal load snapshot? tidak masalah, biarkan empty state normal
      console.warn('Monitoring snapshot tidak tersedia.');
    }
  };

  useEffect(() => {
    // Jangan load jika tour aktif (tour punya mekanisme demo sendiri)
    if (typeof window === 'undefined') return;
    if (!localStorage.getItem(TOUR_KEY)) return; // Tour belum selesai

    loadSnapshot();
  }, []); // hanya sekali saat mount

  const handleTourComplete = () => {
    setIsTourActive(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem(TOUR_KEY, '1');
      window.__demoActive = false;
    }
    resetData(); // Hapus data/peta placeholder seketika
    loadSnapshot(); // Auto-load real snapshot langsung setelah tour selesai!
  };

  const handleTourReopen = () => {
    setIsTourActive(true);
    setTourStep(0);
  };

  // Handler saat user klik 'Proses Data' di step tour (load demo snapshot)
  const handleDemoProcess = async () => {
    if (typeof window !== 'undefined') {
      window.__demoActive = true;
    }
    setLoading(true);
    toast.dismiss();
    const toastId = toast.loading('Memuat data...');
    try {
      const res = await fetch('/data/demo_snapshot.json');
      const demo = await res.json();
      // Gunakan overlay gambar statis lokal untuk demo agar tahan selamanya
      setMapUrl('/data/bali_lst_heatmap.png');
      setStats(demo.stats);
      setChartData(normalizeChartPoints(demo.chart));
      setScatterData(demo.scatter || []);
      toast.success('Selesai.', { id: toastId });
    } catch {
      toast.error('Gagal memuat data demo.', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const regions = ['Seluruh Bali', ...baliData.features.map(f => f.properties.nm_kabkota).sort()];
  const predictionOffsets = [1, 3, 5, 10];

  const landsatMinDate = new Date('2013-01-01');


  // Helper: title case display for region names
  const toTitleCase = (str) => str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());

  // Helper: format durasi — di bawah 1 detik tampil dalam ms, sisanya dalam detik
  const formatDuration = (ms) => {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
    if (ms >= 1000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
    // Cache hit bisa di bawah 1 ms, jadi desimal dipertahankan bila ada
    const teks = Number.isInteger(ms) ? String(ms) : ms.toFixed(1);
    return `${teks.replace('.', ',')} ms`;
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCloudCover(cloudCover);
    }, 500);
    return () => clearTimeout(timer);
  }, [cloudCover]);

  // Penanda permintaan yang sedang berlaku. Nomornya naik setiap kali
  // konfigurasi berubah; respons bernomor lama tidak boleh dipakai lagi.
  const requestIdRef = useRef(0);

  const resetData = () => {
    // Permintaan yang masih berjalan dibatalkan di sini. Tanpa ini, hasil dari
    // konfigurasi lama tetap mendarat di layar yang sudah berpindah — misalnya
    // angka prediksi muncul setelah user kembali ke mode historis, atau hasil
    // mode tunggal masuk ke tampilan perbandingan yang hanya berisi satu sisi.
    requestIdRef.current += 1;
    setLoading(false);
    toast.dismiss();

    setMapUrl(null);
    setMapUrlRight(null);
    setStats(null);
    setStatsRight(null);
    setChartData([]);
    setScatterData([]);
    setChartDataRight([]);
    setScatterDataRight([]);
    setScenes([]);
    setScenesRight([]);
    setShowSceneDates(false);
    setSeasonalData([]);
    setSeasonalDataRight([]);
    setActiveSplitSide('left');
  };

  const handleSwitchMode = (mode) => {
    if (mode !== analysisMode) {
      setAnalysisMode(mode);
      if (mode === 'prediksi') {
        setChartMode('seasonal');
        setVisualMode('tunggal');
      }
      resetData();
    }
  };

  const handleVisualModeChange = (mode) => {
    if (mode !== visualMode) {
      setVisualMode(mode);
      resetData();
    }
  };

  const handleRegionChange = (e) => {
    const newRegion = e.target.value;
    setRegion(newRegion);
    if (newRegion === 'Seluruh Bali') setSelectedGeoJson(baliData);
    else {
      const feature = baliData.features.find(f => f.properties.nm_kabkota === newRegion);
      if (feature) setSelectedGeoJson(feature);
    }
  };

  const handleTypeChange = (type) => {
    setLayerType(type);
    if (type === 'ndvi') {
      setVisMin(-1); setVisMax(1);
      setThreshold(0.5);
    } else {
      setVisMin(20); setVisMax(45);
      setThreshold(32);
    }
    resetData();
  };

  // Parameter permintaan mode tunggal. Dipakai bersama oleh proses analisis dan
  // penyiapan berkas unduhan, supaya keduanya tidak pernah menghitung citra yang
  // berbeda tanpa disadari.
  const buildSingleModeParams = () => new URLSearchParams({
    mode: analysisMode,
    type: layerType,
    region_name: region === 'Seluruh Bali' ? 'ALL' : region,
    start_date: startDate.toISOString().split('T')[0],
    end_date: endDate.toISOString().split('T')[0],
    cloud_cover: debouncedCloudCover,
    reducer: reducer,
    vis_min: visMin,
    vis_max: visMax,
    threshold: threshold,
    target_year: targetYear,
    gap_fill: gapFill,
  });

  // URL unduhan dibuat saat tombol ditekan, bukan ikut di setiap permintaan peta.
  // getDownloadURL terikat pada geometri wilayah, sementara hasil /api/map-layer
  // sengaja dibuat lintas wilayah agar bisa dipakai ulang dari cache.
  const handleDownloadGeoTIFF = async () => {
    setPreparingTiff(true);
    const toastId = toast.loading('Menyiapkan berkas GeoTIFF...');

    try {
      const res = await fetch(`/api/download-url?${buildSingleModeParams()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.downloadUrl) {
        toast.error(data.error || 'Gagal menyiapkan berkas unduhan.', { id: toastId });
        return;
      }

      window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
      toast.success('Berkas GeoTIFF siap diunduh.', { id: toastId });
    } catch {
      toast.error('Gagal menyiapkan berkas unduhan.', { id: toastId });
    } finally {
      setPreparingTiff(false);
    }
  };

  const fetchData = async () => {
    // Nomor permintaan ini. Kalau saat respons tiba nomornya sudah tidak
    // berlaku — user berpindah mode atau jenis layer di tengah proses —
    // hasilnya dibuang, bukan dipasang ke layar yang sudah berubah.
    const requestId = ++requestIdRef.current;
    const isStale = () => requestId !== requestIdRef.current;

    setLoading(true);
    toast.dismiss();
    setSnapshotLoaded(false);

    const loadingMsg = visualMode === 'split'
      ? 'Memproses dua periode historis...'
      : (analysisMode === 'history' ? 'Memproses data historis...' : 'Menghitung model prediksi...');

    const toastId = toast.loading(loadingMsg);

    // Peringatan periode tak penuh dimunculkan sebelum angkanya sempat dibaca,
    // bukan sesudah. Analisisnya sendiri tetap berjalan — yang dibatasi cuma
    // penafsirannya, dan itu tidak bisa disampaikan setelah pembaca terlanjur
    // menyimpulkan sendiri dari grafik.
    //
    // Mode split selalu dikirim sebagai historis (lihat paramsLeft/paramsRight),
    // jadi pelonggaran ini berlaku di sana juga. Prediksi tidak pernah sampai ke
    // sini tanpa tahun penuh: validator menolaknya lebih dulu.
    const modeHistoris = visualMode === 'split' || analysisMode === 'history';
    const periodeTakPenuh = visualMode === 'split'
      ? [!baselineYears && 'Periode 1', !rightYears && 'Periode 2'].filter(Boolean)
      : (baselineYears ? [] : ['Periode']);

    if (modeHistoris && periodeTakPenuh.length > 0) {
      toast.warning(
        `${periodeTakPenuh.join(' dan ')} belum memuat satu tahun kalender penuh.`,
        {
          description:
            'WMO membatasi periode acuan iklim pada tahun kalender penuh 1 Januari–31 Desember agar setiap tahun mewakili siklus musim yang sama. Analisis tetap dijalankan, tapi nilai tahunannya dihitung dari sebagian bulan saja dan tidak sebanding dengan tahun penuh.',
          duration: 10000,
        }
      );
    }

    // Waktu pemrosesan server (dari API) + status cache (dari header X-Cache)
    let serverMs = null;
    let fromCache = false;

    try {
      const regionParam = region === 'Seluruh Bali' ? 'ALL' : region;

      if (visualMode === 'split') {
        const paramsLeft = new URLSearchParams({
          mode: 'history', type: layerType, region_name: regionParam,
          start_date: startDate.toISOString().split('T')[0], end_date: endDate.toISOString().split('T')[0],
          cloud_cover: debouncedCloudCover, reducer: reducer, vis_min: visMin, vis_max: visMax, threshold: threshold,
          gap_fill: gapFill
        });

        const paramsRight = new URLSearchParams({
          mode: 'history', type: layerType, region_name: regionParam,
          start_date: startDateRight.toISOString().split('T')[0], end_date: endDateRight.toISOString().split('T')[0],
          cloud_cover: debouncedCloudCover, reducer: reducer, vis_min: visMin, vis_max: visMax, threshold: threshold,
          gap_fill: gapFill
        });

        const [resLeft, resRight] = await Promise.all([
          fetch(`/api/map-layer?${paramsLeft}`),
          fetch(`/api/map-layer?${paramsRight}`),
        ]);

        // Cek error dengan pesan spesifik (termasuk timeout)
        if (!resLeft.ok || !resRight.ok) {
          if (isStale()) return;
          const errRes = !resLeft.ok ? resLeft : resRight;
          const errData = await errRes.json().catch(() => ({}));
          if (errData.error === 'TIMEOUT') {
            toast.warning('GEE sedang memproses — coba lagi dalam beberapa detik. (GEE cache biasanya membuat request ke-2 jauh lebih cepat)', { id: toastId, duration: 8000 });
          } else {
            toast.error(errData.error || 'Gagal mengambil data Satelit.', { id: toastId });
          }
          return;
        }

        const dataLeft = await resLeft.json();
        const dataRight = await resRight.json();
        if (isStale()) return;

        // Kedua request paralel — waktu tunggu nyata ≈ yang terlama
        serverMs = Math.max(dataLeft.processing_time_ms ?? 0, dataRight.processing_time_ms ?? 0) || null;
        fromCache = resLeft.headers.get('X-Cache') === 'HIT' && resRight.headers.get('X-Cache') === 'HIT';

        setMapUrl(dataLeft.map.urlFormat);
        setMapUrlRight(dataRight.map.urlFormat);

        setStats(dataLeft.stats);
        setStatsRight(dataRight.stats);

        // Simpan data grafik untuk kedua sisi
        setChartData(dataLeft.chart || []);
        setScatterData(dataLeft.scatter || []);
        setChartDataRight(dataRight.chart || []);
        setScatterDataRight(dataRight.scatter || []);
        setScenes(dataLeft.scenes || []);
        setScenesRight(dataRight.scenes || []);
        setSeasonalData(dataLeft.seasonal || []);
        setSeasonalDataRight(dataRight.seasonal || []);
        setActiveSplitSide('left'); // Kembalikan fokus ke kiri setiap selesai proses

      } else {
        const params = buildSingleModeParams();

        const res = await fetch(`/api/map-layer?${params}`);

        // Cek error dengan pesan spesifik (termasuk timeout)
        if (!res.ok) {
          if (isStale()) return;
          const errData = await res.json().catch(() => ({}));
          if (errData.error === 'TIMEOUT') {
            toast.warning(
              'GEE sedang memproses di server — coba lagi dalam beberapa detik. Request ke-2 biasanya jauh lebih cepat karena GEE cache.',
              { id: toastId, duration: 8000 }
            );
          } else {
            toast.error(errData.error || 'Gagal memproses data.', { id: toastId });
          }
          return;
        }

        const data = await res.json();
        if (isStale()) return;

        serverMs = data.processing_time_ms ?? null;
        fromCache = res.headers.get('X-Cache') === 'HIT';

        setMapUrl(data.map.urlFormat);
        setStats(data.stats);
        setChartData(data.chart || []);
        setScatterData(data.scatter || []);
        setScenes(data.scenes || []);
        setSeasonalData(data.seasonal || []);
      }

      const durasi = formatDuration(serverMs);
      toast.success(
        durasi
          ? `Pemrosesan selesai dalam ${durasi}${fromCache ? ' (dari cache)' : ''}`
          : 'Pemrosesan Selesai',
        { id: toastId }
      );

    } catch (error) {
      console.error(error);
      if (!isStale()) toast.error('Gagal memproses data. Periksa koneksi dan coba lagi.', { id: toastId });
    } finally {
      // Hanya permintaan yang masih berlaku yang boleh mematikan indikator
      // proses. Permintaan basi yang selesai belakangan tidak boleh mengosongkan
      // layar yang sedang menunggu permintaan penggantinya.
      if (!isStale()) setLoading(false);
      else toast.dismiss(toastId);
    }
  };

  const handleProcess = (e) => {
    if (e) e.preventDefault();
    fetchData();
  };

  // Export data time-series ke CSV
  const handleExportCSV = () => {
    const activeChart = visualMode === 'split'
      ? (activeSplitSide === 'left' ? chartData : chartDataRight)
      : chartData;
    const activeStats = visualMode === 'split'
      ? (activeSplitSide === 'left' ? stats : statsRight)
      : stats;

    if (!activeChart || activeChart.length === 0) {
      toast.error('Tidak ada data time-series untuk diekspor.');
      return;
    }

    const regionLabel = activeStats?.region || region;
    const layerLabel = layerType.toUpperCase();
    // NDVI tidak bersatuan — kolom satuan dikosongkan, bukan diisi "Index".
    const unit = layerType === 'lst' ? '°C' : '';

    const header = 'tahun,rata_rata_tahunan,wilayah,layer,satuan';
    const rows = activeChart
      .filter(d => d.value !== null && d.value !== undefined)
      .map(d => `${d.year},${Number(d.value).toFixed(4)},${regionLabel},${layerLabel},${unit}`);

    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const fileName = `LST-NDVI_${layerLabel}_${regionLabel}_${activeChart[0]?.year || ''}_${activeChart[activeChart.length-1]?.year || ''}.csv`;
    saveAs(blob, fileName);
    toast.success(`Data CSV berhasil diekspor: ${fileName}`);
  };

  // Kalkulasi Tren Regresi Linear yang dinamis menerima data apa saja (kiri atau kanan)
  const getTrendLineData = (dataArray) => {
    if (!dataArray || dataArray.length < 2) return null;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
    const n = dataArray.length;

    dataArray.forEach(p => {
      sumX += p.ndvi;
      sumY += p.lst;
      sumXY += p.ndvi * p.lst;
      sumXX += p.ndvi * p.ndvi;
      sumYY += p.lst * p.lst;
    });

    const denominator = (n * sumXX - sumX * sumX);
    if (denominator === 0) return null;

    const m = (n * sumXY - sumX * sumY) / denominator;
    const c = (sumY - m * sumX) / n;

    // Kuat-lemahnya hubungan dibaca dari koefisien korelasi Pearson, bukan dari
    // kemiringan garis: kemiringan bersatuan (°C per satuan NDVI) sehingga
    // besarnya tidak bisa dipakai menilai keeratan hubungan.
    const spreadY = Math.sqrt(n * sumYY - sumY * sumY);
    const spreadX = Math.sqrt(denominator);
    const r = spreadX > 0 && spreadY > 0
      ? (n * sumXY - sumX * sumY) / (spreadX * spreadY)
      : null;

    return {
      segment: [
        { x: -1, y: m * (-1) + c },
        { x: 1, y: m * 1 + c }
      ],
      slope: m,
      r,
      n,
    };
  };

  // Helper untuk menyiapkan data tampilan grafik (menangani overlay prediksi jika ada)
  const getDisplayChartData = (cData) => {
    return cData;
  };

  // Generator Teks Interpretasi
  const renderChartSummary = (cMode, cData, sData, currentStats, tData, seasonal = []) => {
    if (cMode === 'seasonal') {
      const valid = seasonal.filter((d) => Number.isFinite(d?.value));
      if (valid.length < 2) return "Data bulanan belum cukup untuk membentuk profil musiman.";

      const tertinggi = valid.reduce((a, b) => (b.value > a.value ? b : a));
      const terendah = valid.reduce((a, b) => (b.value < a.value ? b : a));
      const paramName = layerType === 'lst' ? 'suhu permukaan' : 'indeks vegetasi';
      const unitSuffix = currentStats?.unit ? ` ${currentStats.unit}` : '';
      const amplitudo = (tertinggi.value - terendah.value).toFixed(2);

      const namaBulan = (m) => MONTH_NAME[Number(m) - 1] || `bulan ${m}`;

      if (currentStats?.is_prediction) {
        return `Untuk ${currentStats.target_year}, model memproyeksikan ${paramName} tertinggi pada ${namaBulan(tertinggi.month)} dan terendah pada ${namaBulan(terendah.month)}, dengan selisih ${amplitudo}${unitSuffix}. Pola ini berasal dari suku musiman regresi harmonik, bukan dari citra tahun tersebut.`;
      }

      // Penyebutan periode sengaja eksplisit: rentang sependek ini belum
      // memenuhi syarat "normal iklim" WMO yang menuntut 30 tahun berturut-turut,
      // jadi angkanya tidak boleh disebut normal.
      const periode = currentStats?.baseline_start_year && currentStats?.baseline_end_year
        ? `${currentStats.baseline_start_year}–${currentStats.baseline_end_year}`
        : 'periode terpilih';

      return `Rata-rata bulanan ${periode}: ${paramName} tertinggi pada ${namaBulan(tertinggi.month)} dan terendah pada ${namaBulan(terendah.month)}, dengan selisih ${amplitudo}${unitSuffix}. Angka ini rata-rata bulanan periode tersebut, bukan normal iklim.`;
    }

    if (cMode === 'trend' && cData.length > 0) {
      const histData = cData.filter(d => !d.isPred);

      // Klaim arah tren hanya boleh bersandar pada tahun kalender penuh. Tahun
      // tercakup sebagian tetap tergambar di grafik, tapi memakainya sebagai
      // ujung perhitungan berarti mengukur selisih musim dan menyebutnya
      // perubahan antar tahun. `complete` tidak ada pada data lama, dan
      // undefined di sini berarti lengkap.
      const lengkap = histData.filter((d) => d.complete !== false);

      if (lengkap.length < 2) {
        return "Periode ini belum memuat dua tahun kalender penuh, jadi arah tren belum bisa disimpulkan. Nilai per tahun tetap ditampilkan pada grafik, dengan tahun yang tidak lengkap diberi penanda.";
      }

      const first = lengkap[0];
      const last = lengkap[lengkap.length - 1];
      const diff = last.value - first.value;
      const paramName = layerType === 'lst' ? 'suhu permukaan' : 'indeks vegetasi';
      const trendDir = diff > 0 ? 'naik' : 'turun';
      const sifatTrend = layerType === 'lst'
        ? (diff > 0 ? 'yang mengindikasikan pemanasan lokal' : 'yang menunjukkan pendinginan wilayah')
        : (diff > 0 ? 'yang menunjukkan tutupan hijau bertambah' : 'yang menunjukkan tutupan hijau berkurang');

      const unitSuffix = currentStats?.unit ? ` ${currentStats.unit}` : '';

      let text = `Dari ${first.year} ke ${last.year}, rata-rata tahunan ${paramName} ${trendDir} ${Math.abs(diff).toFixed(2)}${unitSuffix}, ${sifatTrend}.`;

      return text;
    }

    if (cMode === 'scatter' && sData.length > 1 && Number.isFinite(tData?.r)) {
      // Keeratan hubungan disebut lewat koefisien korelasi beserta jumlah
      // sampelnya, supaya angkanya bisa diperiksa ulang.
      const r = tData.r;
      const kuat = Math.abs(r) >= 0.7 ? 'kuat' : Math.abs(r) >= 0.4 ? 'sedang' : 'lemah';
      const ukuran = `r = ${r.toFixed(2).replace('.', ',')}, n = ${tData.n.toLocaleString('id-ID')}`;

      if (r < 0) {
        return `Korelasi negatif ${kuat} (${ukuran}). Makin rapat vegetasi, makin rendah suhu permukaan.`;
      }
      if (r > 0) {
        return `Korelasi positif ${kuat} (${ukuran}). Arah ini berlawanan dengan dugaan umum; periksa kemungkinan sisa awan atau piksel perairan pada sampel.`;
      }
      return `Tidak ada hubungan yang terbaca (${ukuran}).`;
    }
    return "Belum ada data untuk ditafsirkan.";
  };

  // Skeleton Loading untuk KPI Cards
  const renderKPISkeleton = () => (
    // Bentuknya mengikuti kartu yang akan menggantikannya: mode historis punya
    // empat kartu (rata-rata, minimum, maksimum, luas), prediksi tiga. Kalau
    // rangkanya tidak ikut, tata letak melompat begitu data tiba.
    <div className="grid grid-cols-2 gap-3 mt-4">
      {(analysisMode === 'prediksi' ? [1, 2, 3] : [1, 2, 3, 4]).map((i, idx, arr) => (
        <div key={i} className={`flex flex-col p-4 bg-white border border-slate-100 rounded-xl ${idx === arr.length - 1 || (arr.length === 4 && idx === 0) ? 'col-span-2' : ''}`}>
          <div className="skeleton h-3 w-20 mb-3"></div>
          <div className="skeleton h-6 w-28"></div>
        </div>
      ))}
    </div>
  );

  const renderKPIs = () => {
    if (!stats) return null;

    const cardClass = "flex flex-col p-4 bg-white border border-slate-100 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200";

    const label = LAYER_LABEL[layerType] || LAYER_LABEL.lst;
    const unitTag = label.unit
      ? <span className="text-xs font-normal text-slate-400">{label.unit}</span>
      : null;

    // Satu baris konteks untuk seluruh kartu: tanpa ini angka rata-rata,
    // minimum, dan maksimum berdiri tanpa keterangan periode maupun wilayah.
    //
    // Periode tanpa satu pun tahun kalender penuh dilabeli dengan tanggalnya,
    // bukan "2026–2026". Label tahun pada data enam bulan terbaca sebagai
    // setahun utuh, dan itu keliru dengan cara yang tidak kelihatan.
    const periode = stats.has_full_year === false
      ? (stats.period_start && stats.period_end
        ? `${formatSceneDate(stats.period_start)} – ${formatSceneDate(stats.period_end)}`
        : null)
      : (stats.baseline_start_year && stats.baseline_end_year
        ? `${stats.baseline_start_year}–${stats.baseline_end_year}`
        : null);
    const konteks = [
      stats.is_prediction ? `Prediksi ${stats.target_year}` : periode,
      stats.region === 'SELURUH BALI' ? 'Seluruh Bali' : stats.region,
    ].filter(Boolean).join(' · ');

    const contextLine = (
      // Margin bawah negatif menahan mt-4 milik grid kartu; tanpa itu jarak
      // baris konteks ke kartu pertama jadi sejauh jarak antar-bagian.
      <p className="text-[11px] text-slate-400 text-center mt-1 -mb-2.5">{konteks}</p>
    );

    if (stats.is_prediction) {
      const delta = stats.mean - stats.baseline_mean;
      const isWorse = layerType === 'lst' ? delta > 0 : delta < 0;
      const baselineRange = stats.baseline_start_year && stats.baseline_end_year
        ? `${stats.baseline_start_year}–${stats.baseline_end_year}`
        : 'baseline';

      return (
        <>
        {contextLine}
        <div className="grid grid-cols-2 gap-3 mt-4 animate-fade-in">
          <div className={cardClass}>
            {/* Menyebut "rata-rata tahunan" secara eksplisit: angka ini mewakili
                satu tahun penuh, bukan nilai pada satu tanggal. */}
            <span className="text-[11px] text-slate-400 font-medium mb-1.5">Rata-rata tahunan {stats.target_year} (prediksi)</span>
            <span className="text-xl font-bold text-slate-800 leading-none">
              {stats.mean.toFixed(2)} {unitTag}
            </span>
          </div>
          <div className={cardClass}>
            <span className="text-[11px] text-slate-400 font-medium mb-1.5">Selisih vs rata-rata baseline {baselineRange}</span>
            <span className={`text-xl font-bold leading-none ${isWorse ? 'text-rose-500' : 'text-emerald-500'}`}>
              {delta > 0 ? '+' : ''}{delta.toFixed(2)} {label.unit && <span className="text-xs font-normal opacity-60">{label.unit}</span>}
            </span>
          </div>
          <div className={`col-span-2 ${cardClass}`}>
            <span className="text-[11px] text-slate-400 font-medium mb-1.5 flex items-center gap-1.5"><AlertTriangle size={12} /> Wilayah prediksi di atas {withUnit(stats.threshold, label.unit)}</span>
            <span className="text-xl font-bold text-slate-800 leading-none">
              {stats.impact_area_ha ? stats.impact_area_ha.toLocaleString('id-ID', { maximumFractionDigits: 1 }) : 0} <span className="text-xs font-normal text-slate-400">Hektar</span>
            </span>
          </div>
        </div>
        </>
      );
    } else {
      return (
        <>
        {contextLine}
        <div className="grid grid-cols-2 gap-3 mt-4 animate-fade-in">
          <div className={`col-span-2 ${cardClass}`}>
            <span className="text-[11px] text-slate-400 font-medium mb-1.5">Rata-rata {label.short}</span>
            <span className="text-xl font-bold text-slate-800 leading-none">
              {stats.mean.toFixed(2)} {unitTag}
            </span>
          </div>
          {/* Minimum dan maksimum berdampingan karena keduanya membentuk satu
              rentang nilai — dibaca sebagai sepasang, bukan dua angka lepas. */}
          <div className={cardClass}>
            <span className="text-[11px] text-slate-400 font-medium mb-1.5">Minimum {label.short}</span>
            <span className="text-xl font-bold text-slate-800 leading-none">
              {stats.min.toFixed(2)} {unitTag}
            </span>
          </div>
          <div className={cardClass}>
            <span className="text-[11px] text-slate-400 font-medium mb-1.5">Maksimum {label.short}</span>
            <span className="text-xl font-bold text-slate-800 leading-none">
              {stats.max.toFixed(2)} {unitTag}
            </span>
          </div>
          <div className={`col-span-2 ${cardClass}`}>
            <span className="text-[11px] text-slate-400 font-medium mb-1.5 flex items-center gap-1.5"><AlertTriangle size={12} /> Wilayah historis di atas {withUnit(stats.threshold, label.unit)}</span>
            <span className="text-xl font-bold text-slate-800 leading-none">
              {stats.impact_area_ha ? stats.impact_area_ha.toLocaleString('id-ID', { maximumFractionDigits: 1 }) : 0} <span className="text-xs font-normal text-slate-400">Hektar</span>
            </span>
          </div>
        </div>
        </>
      );
    }
  };

  // Hasil baru dianggap siap tampil kalau semua sisi yang dibutuhkan mode aktif
  // sudah terisi — mode perbandingan butuh dua periode, bukan satu.
  const hasResult = visualMode === 'split' ? !!(stats && statsRight) : !!stats;

  // Nama dan satuan layer aktif, dipakai label-label di panel kontrol.
  const activeLabel = LAYER_LABEL[layerType] || LAYER_LABEL.lst;

  // Vis range gradient preview
  const visGradient = layerType === 'ndvi'
    ? 'linear-gradient(to right, #ef4444, #facc15, #22c55e)'
    : 'linear-gradient(to right, #1e1b4b, #38bdf8, #fef08a, #ef4444, #7f1d1d)';

  // ── Batas input Rentang Visualisasi ──
  // Nilai user tidak pernah dikoreksi belakangan; yang dijaga adalah pintu
  // masuknya, sehingga angka di legenda selalu sama dengan yang dipakai GEE.
  const visBounds = LAYER_BOUNDS[layerType];

  // Ketikan setengah jadi ('', '-', '25.') dibiarkan apa adanya supaya user
  // tetap bisa mengetik nilai negatif dan desimal tanpa terpotong.
  const isPartialNumber = (raw) => raw === '' || raw === '-' || raw.endsWith('.');

  const handleVisInput = (setter) => (e) => {
    const raw = e.target.value;
    if (isPartialNumber(raw)) return setter(raw);
    if (Number.isNaN(parseFloat(raw))) return;
    setter(clampNum(raw, visBounds.min, visBounds.max, visBounds.min));
  };

  // Rapikan saat fokus berpindah: ketikan setengah jadi / kosong dikembalikan
  // ke nilai bawaan layer agar tidak ada nilai tak sah yang ikut terkirim.
  const handleVisBlur = (setter, fallback) => (e) =>
    setter(clampNum(e.target.value, visBounds.min, visBounds.max, fallback));

  // Komponen Helper untuk menyatukan render Grafik
  const renderChartSection = () => {
    const isSplit = visualMode === 'split';

    // Tentukan data mana yang akan dirender berdasarkan mode dan sisi aktif
    const activeCData = isSplit ? (activeSplitSide === 'left' ? chartData : chartDataRight) : chartData;
    const activeSData = isSplit ? (activeSplitSide === 'left' ? scatterData : scatterDataRight) : scatterData;
    const activeStats = isSplit ? (activeSplitSide === 'left' ? stats : statsRight) : stats;
    const activeScenes = isSplit ? (activeSplitSide === 'left' ? scenes : scenesRight) : scenes;
    const activeSeasonal = isSplit
      ? (activeSplitSide === 'left' ? seasonalData : seasonalDataRight)
      : seasonalData;

    // Nama bulan disiapkan di sini, bukan lewat tickFormatter, supaya tooltip
    // dan sumbu membaca sumber yang sama.
    const seasonalChartData = activeSeasonal.map((item) => ({
      ...item,
      label: MONTH_ABBR[Number(item.month) - 1] || String(item.month),
    }));

    // Profil musiman di mode prediksi memakai warna dan garis putus-putus yang
    // sama dengan garis prediksi di grafik tren, supaya tidak tertukar dengan
    // deret yang benar-benar berasal dari citra.
    const seasonalIsPred = Boolean(activeStats?.is_prediction);
    const seasonalColor = seasonalIsPred
      ? '#f43f5e'
      : (isSplit && activeSplitSide === 'right' ? '#0f172a' : '#334155');

    // Tahun pada sumbu X bisa datang sebagai angka maupun teks tergantung
    // sumbernya (API atau snapshot), jadi kuncinya diseragamkan ke angka.
    const sceneCountByYear = new Map(activeScenes.map((item) => [Number(item.year), item.count]));

    const trendData = getTrendLineData(activeSData);
    const displayChartData = getDisplayChartData(activeCData);

    // Tahun yang belum tercakup dua belas bulan. `complete` baru ada sejak
    // pelonggaran periode; data lama (snapshot yang belum diregenerasi) tidak
    // punya kunci itu, dan undefined di sini harus berarti "lengkap" supaya
    // grafik lama tidak mendadak penuh penanda.
    const adaTahunTakLengkap = activeCData.some((d) => d?.complete === false);

    const chartAxisLabel = (LAYER_LABEL[layerType] || LAYER_LABEL.lst).axis;
    const chartUnit = (LAYER_LABEL[layerType] || LAYER_LABEL.lst).unit;

    // Kedua grafik memakai margin, lebar sumbu, dan gaya label yang sama supaya
    // judul sumbu tidak berpindah-pindah posisi saat tab grafik ditukar.
    const chartMargin = { top: 10, right: 12, bottom: 24, left: 0 };
    const axisTick = { fontSize: 11, fill: '#64748b' };
    // Angka skala pertama sumbu X jatuh tepat di garis sumbu Y kalau tanpa
    // padding, sehingga bertumpuk dengan angka skala Y terendah di pojok.
    const axisPaddingX = { left: 12, right: 12 };
    const axisTitleX = (value) => ({
      value, position: 'insideBottom', offset: -12, fontSize: 11, fill: '#64748b',
    });
    // textAnchor 'middle' wajib: tanpa itu teks tegak ditarik dari titik tengah
    // ke atas sehingga terpotong di tepi grafik.
    const axisTitleY = (value) => ({
      value, angle: -90, position: 'insideLeft', offset: 6,
      fontSize: 11, fill: '#64748b', style: { textAnchor: 'middle' },
    });

    const renderTrendTooltip = ({ active, payload, label }) => {
      if (!active || !payload?.length) return null;

      const rows = payload.filter((row) => row.value !== null && row.value !== undefined);
      if (rows.length === 0) return null;

      const sceneCount = sceneCountByYear.get(Number(label));

      // Tahun yang tercakup sebagian tidak boleh memakai kata "tahunan": yang
      // dihitung cuma bulan-bulan yang kebetulan masuk rentang, dan di daerah
      // tropis pemilihan bulan itu sendiri sudah menggeser angkanya.
      const takLengkap = payload[0]?.payload?.complete === false;

      return (
        <div className="bg-white rounded-lg px-3 py-2 text-xs" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <p className="text-slate-500 mb-1">Tahun {label}</p>
          {rows.map((row) => (
            <p key={row.dataKey} style={{ color: row.color }}>
              {takLengkap ? 'Rata-rata sebagian tahun' : row.name}
              {' : '}{withUnit(Number(row.value).toFixed(2), chartUnit)}
            </p>
          ))}
          {sceneCount !== undefined && (
            <p className="text-slate-400 mt-1">Dari {sceneCount} citra</p>
          )}
          {takLengkap && (
            <p className="text-amber-600 mt-1">Tahun tidak lengkap — belum 12 bulan</p>
          )}
        </div>
      );
    };

    // Titik hanya digambar untuk tahun tidak lengkap. Tahun penuh tetap tanpa
    // bulatan seperti sebelumnya, jadi kehadiran bulatan itu sendiri yang
    // menjadi penandanya — tidak perlu simbol tambahan yang harus dihafal.
    // Mengembalikan <g /> kosong, bukan null: Recharts memasang key pada hasil
    // ini dan null akan memicu peringatan React.
    const renderTrendDot = (props) => {
      const { cx, cy, payload, index } = props;
      if (payload?.complete !== false || cx === null || cy === null) {
        return <g key={`dot-${index}`} />;
      }

      return (
        <circle
          key={`dot-${index}`}
          cx={cx}
          cy={cy}
          r={4}
          fill="#ffffff"
          stroke="#f59e0b"
          strokeWidth={2}
        />
      );
    };

    const renderSeasonalTooltip = ({ active, payload }) => {
      if (!active || !payload?.length) return null;

      const point = payload[0]?.payload;
      if (!point || point.value === null || point.value === undefined) return null;

      return (
        <div className="bg-white rounded-lg px-3 py-2 text-xs" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <p className="text-slate-500 mb-1">{MONTH_NAME[Number(point.month) - 1] || point.label}</p>
          <p style={{ color: payload[0].color }}>
            {payload[0].name} : {withUnit(Number(point.value).toFixed(2), chartUnit)}
          </p>
          {/* count bernilai null di mode prediksi: tahun targetnya belum punya
              citra, jadi menyebut jumlah citra di situ akan menyesatkan. */}
          {point.count !== null && point.count !== undefined && (
            <p className="text-slate-400 mt-1">Dari {point.count} citra</p>
          )}
        </div>
      );
    };

    return (
      <div className="mt-6 pt-6 border-t border-slate-100">
        <div className="flex items-center justify-center mb-4 relative min-h-7">
          <span className="text-[13px] font-semibold text-slate-600">Grafik Analitik</span>
          {isSplit && (
            <div className="absolute right-0 flex bg-slate-100 p-0.5 rounded-md">
              <button type="button" onClick={() => setActiveSplitSide('left')} className={`text-[11px] px-2.5 py-1 font-medium rounded transition-all cursor-pointer ${activeSplitSide === 'left' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}>Periode 1</button>
              <button type="button" onClick={() => setActiveSplitSide('right')} className={`text-[11px] px-2.5 py-1 font-medium rounded transition-all cursor-pointer ${activeSplitSide === 'right' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}>Periode 2</button>
            </div>
          )}
        </div>

        {analysisMode !== 'prediksi' && (
          <div className="flex items-center gap-2 mb-3 bg-slate-100 p-1 rounded-lg">
            <button onClick={() => setChartMode('trend')} className={`flex-1 text-xs py-2 px-3 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${chartMode === 'trend' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              <TrendingUp size={14} /> Tren Waktu
            </button>
            <button onClick={() => setChartMode('seasonal')} className={`flex-1 text-xs py-2 px-3 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${chartMode === 'seasonal' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              <BarChart3 size={14} /> Pola Musiman
            </button>
            <button onClick={() => setChartMode('scatter')} className={`flex-1 text-xs py-2 px-3 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${chartMode === 'scatter' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              <ScatterIcon size={14} /> Korelasi
            </button>
          </div>
        )}

        <div className="h-56 w-full relative">
          <ResponsiveContainer>
            {chartMode === 'trend' ? (
              <LineChart data={displayChartData} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                {/* Sumbu X memakai tahun, bukan tanggal: tiap titik adalah
                    rata-rata sepanjang tahun, bukan pengukuran 1 Januari. */}
                <XAxis
                  dataKey="year"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  padding={axisPaddingX}
                  label={axisTitleX('Tahun')}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  width={64}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  label={axisTitleY(chartAxisLabel)}
                />
                <Tooltip content={renderTrendTooltip} />
                {/* Garisnya tetap satu deret utuh; yang membedakan hanya titik.
                    Tahun tidak lengkap diberi bulatan kuning berlubang — cukup
                    terlihat untuk memancing hover, tanpa memutus bacaan garis
                    seperti kalau deretnya dipecah dua. */}
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Rata-rata tahunan"
                  stroke={isSplit && activeSplitSide === 'right' ? "#0f172a" : "#334155"}
                  strokeWidth={2}
                  dot={renderTrendDot}
                />
              </LineChart>
            ) : chartMode === 'seasonal' ? (
              <LineChart data={seasonalChartData} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                {/* Sumbu X adalah bulan kalender, bukan urutan waktu: Januari di
                    sini menggabungkan seluruh Januari sepanjang periode. */}
                {/* interval={0} wajib: tanpa itu Recharts membuang label yang
                    dikiranya bertabrakan, sehingga Mar, Agu, dan Nov hilang dan
                    sumbunya terbaca bolong. Ukuran huruf diperkecil dan padding
                    tepi dilepas supaya dua belas label muat tanpa dibuang. */}
                <XAxis
                  dataKey="label"
                  interval={0}
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  label={axisTitleX('Bulan')}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  width={64}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  label={axisTitleY(chartAxisLabel)}
                />
                <Tooltip content={renderSeasonalTooltip} />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={seasonalIsPred ? `Prediksi bulanan ${activeStats.target_year}` : 'Rata-rata bulanan'}
                  stroke={seasonalColor}
                  strokeWidth={2}
                  strokeDasharray={seasonalIsPred ? '5 5' : undefined}
                  dot={{ r: 3, strokeWidth: 0, fill: seasonalColor }}
                  connectNulls={false}
                />
              </LineChart>
            ) : (
              <ScatterChart margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                {/* Satuan hanya ditulis sekali di judul sumbu, tidak diulang di
                    tiap angka skala, mengikuti kaidah penulisan grafik ilmiah. */}
                <XAxis
                  type="number"
                  dataKey="ndvi"
                  name={LAYER_LABEL.ndvi.full}
                  domain={[-1, 1]}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  padding={axisPaddingX}
                  label={axisTitleX(LAYER_LABEL.ndvi.full)}
                />
                <YAxis
                  type="number"
                  dataKey="lst"
                  name={LAYER_LABEL.lst.full}
                  domain={['auto', 'auto']}
                  width={64}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  label={axisTitleY(LAYER_LABEL.lst.axis)}
                />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                  formatter={(value, name) => [
                    withUnit(Number(value).toFixed(2), name === LAYER_LABEL.lst.full ? LAYER_LABEL.lst.unit : LAYER_LABEL.ndvi.unit),
                    name,
                  ]}
                />
                <Scatter name="Sampel Korelasi" data={activeSData} fill={isSplit && activeSplitSide === 'right' ? "#0f172a" : "#334155"} opacity={0.6} line={false} shape="circle" />

                {trendData?.segment && (
                  <ReferenceLine segment={trendData.segment} stroke="#f43f5e" strokeWidth={2} strokeDasharray="4 4" ifOverflow="hidden" />
                )}
              </ScatterChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Keterangan penanda. Bulatan kuning tidak bisa menjelaskan dirinya
            sendiri, dan barisnya hanya muncul kalau memang ada tahun yang
            ditandai — supaya grafik yang seluruh tahunnya penuh tetap bersih. */}
        {chartMode === 'trend' && adaTahunTakLengkap && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="inline-block w-2 h-2 rounded-full border-2 border-amber-500 bg-white shrink-0" />
            Tahun tidak lengkap — dihitung dari sebagian bulan saja, tidak sebanding dengan tahun penuh.
          </p>
        )}

        {/* Rincian citra sumber. Hanya di tab tren, karena angka per tahun ini
            memang milik deret tahunan — scatter memakai satu komposit gabungan
            yang tidak dipecah per tahun. */}
        {chartMode === 'trend' && activeScenes.length > 0 && (
          <div className="mt-3 border border-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setShowSceneDates(!showSceneDates)}
              aria-expanded={showSceneDates}
              className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-medium text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Satellite size={13} className="text-slate-400" />
                Tanggal citra yang dipakai
              </span>
              <ChevronDown size={14} className={`transition-transform ${showSceneDates ? 'rotate-180' : ''}`} />
            </button>

            {showSceneDates && (
              <div className="px-3 pb-3 max-h-56 overflow-y-auto space-y-2.5">
                {activeScenes.map((item) => (
                  <div key={item.year}>
                    <p className="text-[11px] font-semibold text-slate-600">
                      {item.year} — {item.count} citra
                    </p>
                    <p className="text-[11px] text-slate-500 leading-relaxed break-words">
                      {item.dates?.length
                        ? item.dates
                            .map((d) => (d.n > 1 ? `${formatSceneDate(d.date)} (${d.n})` : formatSceneDate(d.date)))
                            .join(' · ')
                        : 'Tidak ada citra yang lolos penyaringan.'}
                    </p>
                  </div>
                ))}
                <p className="text-[10px] text-slate-400 pt-2 border-t border-slate-100 leading-relaxed">
                  Daftar ini adalah citra yang lolos batas tutupan awan, sebelum penutupan
                  awan per piksel. Angka dalam kurung berarti ada lebih dari satu citra pada
                  tanggal yang sama.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 p-3 bg-slate-50 border border-slate-100 rounded-lg flex items-start gap-2.5">
          <Info size={16} className="text-slate-300 shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {renderChartSummary(chartMode, activeCData, activeSData, activeStats, trendData, activeSeasonal)}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden font-sans bg-slate-50 text-slate-800 selection:bg-slate-200">
      <Head>
        <title>Spatio-Temporal Analysis Engine — LST & NDVI Bali</title>
        <meta name="description" content="Analisis spasio-temporal Land Surface Temperature (LST) dan Normalized Difference Vegetation Index (NDVI) wilayah Bali menggunakan data Landsat 8/9 via Google Earth Engine." />
      </Head>
      <Toaster position="top-center" containerStyle={{ top: 70 }} />

      {/* Global Style untuk Animasi Lonceng Bergetar */}
      <style jsx global>{`
        @keyframes ringing {
          0% { transform: rotate(0); }
          10% { transform: rotate(15deg); }
          20% { transform: rotate(-15deg); }
          30% { transform: rotate(10deg); }
          40% { transform: rotate(-10deg); }
          50% { transform: rotate(5deg); }
          60% { transform: rotate(-5deg); }
          70% { transform: rotate(0); }
          100% { transform: rotate(0); }
        }
        .animate-ringing {
          animation: ringing 2.5s ease-in-out infinite;
          transform-origin: top center;
        }
      `}</style>


      {/* === NAVBAR === */}
      <nav className="flex items-center justify-between px-4 md:px-6 bg-white border-b h-14 md:h-16 border-slate-200 z-50">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          {/* Tombol panel (mobile) — kiri, ikon menu agar mudah dikenali */}
          <button
            type="button"
            onClick={() => setSidebarOpen(!isSidebarOpen)}
            className="md:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            aria-label={isSidebarOpen ? 'Tutup panel kontrol' : 'Buka panel kontrol'}
          >
            <Menu size={22} className="text-slate-700" />
          </button>
          <Activity size={20} className="text-slate-800 shrink-0" />
          <h1 className="text-sm md:text-base font-bold tracking-tight text-slate-800 truncate">Spatio-Temporal Analysis Engine</h1>
          {/* Region badge (desktop only) */}
          {stats && (
            <span className="hidden lg:flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full uppercase tracking-wider shrink-0">
              <MapPin size={10} />
              {stats.region}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 md:gap-2">
          <Link href="/metodologi" className="hidden md:flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors no-underline">
            <BookOpen size={14} />
            Metodologi
          </Link>
          <Link href="/evaluasi" className="hidden md:flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors no-underline">
            <ClipboardList size={14} />
            Evaluasi UEQ
          </Link>
          {/* Tombol buka ulang tour */}
          <TourTriggerButton onClick={handleTourReopen} />
          <button
            type="button"
            onClick={() => setSidebarOpen(!isSidebarOpen)}
            className="hidden md:inline-flex p-2 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label={isSidebarOpen ? 'Tutup panel kontrol' : 'Buka panel kontrol'}
          >
            {isSidebarOpen ? <PanelLeftClose size={20} className="text-slate-600" /> : <PanelLeftOpen size={20} className="text-slate-600" />}
          </button>
        </div>
      </nav>

      <main className="relative flex flex-1 overflow-hidden">
        {/* Mobile sidebar backdrop */}
        {isSidebarOpen && (
          <div
            className="md:hidden fixed inset-0 z-[2500] sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside className={`
          flex flex-col bg-white transition-all duration-300 border-r border-slate-200
          ${isSidebarOpen
            ? 'fixed md:relative inset-y-0 left-0 z-[3000] md:z-auto w-[85vw] sm:w-95 md:w-105 animate-slide-in-left md:animate-none shadow-2xl md:shadow-none'
            : 'w-0 border-none overflow-hidden'
          }
        `}>
          {/* Mobile sidebar header */}
          <div className="flex md:hidden items-center justify-between px-4 py-3 border-b border-slate-200">
            <span className="text-sm font-bold text-slate-800">Panel Kontrol</span>
            <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-md hover:bg-slate-100 cursor-pointer" aria-label="Tutup panel">
              <X size={18} className="text-slate-500" />
            </button>
          </div>
          <div className="flex flex-col flex-1 p-4 md:p-6 overflow-y-auto">

            {/* Mode Analisis */}
            <div id="tour-mode-toggle">
              <div className="flex bg-slate-100 p-1.5 rounded-lg mb-4">
                <button onClick={() => handleSwitchMode('history')} className={`flex-1 py-2 text-sm font-semibold rounded-md flex items-center justify-center gap-2 transition-all cursor-pointer ${analysisMode === 'history' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                  <History size={16} /> Historis
                </button>
                <button onClick={() => handleSwitchMode('prediksi')} className={`flex-1 py-2 text-sm font-semibold rounded-md flex items-center justify-center gap-2 transition-all cursor-pointer ${analysisMode === 'prediksi' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                  <TrendingUp size={16} /> Prediksi
                </button>
              </div>

              {/* Mode Visualisasi Layar (Tampil saat Historis) */}
              {analysisMode === 'history' && (
                <div className="mb-6">
                  <div className="flex bg-slate-100 p-1.5 rounded-lg">
                    <button onClick={() => handleVisualModeChange('tunggal')} className={`flex-1 py-2 text-sm font-semibold rounded-md flex items-center justify-center gap-2 transition-all cursor-pointer ${visualMode === 'tunggal' ? 'bg-slate-800 shadow-sm text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                      Tunggal
                    </button>
                    <button onClick={() => handleVisualModeChange('split')} className={`flex-1 py-2 text-sm font-semibold rounded-md flex items-center justify-center gap-2 transition-all cursor-pointer ${visualMode === 'split' ? 'bg-slate-800 shadow-sm text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                      Perbandingan Periode
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-5">
              {/* Konfigurasi Dasar */}
              <div id="tour-scenario">
                <span className="text-[13px] font-semibold text-slate-600 mb-4 text-center block">Pengaturan Analisis</span>

                {analysisMode === 'prediksi' && (
                  <div className="mb-4">
                    <span className="text-xs font-medium text-slate-500 mb-1.5 block">
                      Target prediksi
                    </span>
                    {/* Tombolnya menyebut tahunnya, bukan jaraknya. Bentuk
                        "+5 tahun" terbaca sebagai perubahan yang terkumpul
                        selama lima tahun, padahal keluaran model adalah nilai
                        yang mewakili satu tahun target itu saja — lihat
                        harmonicAnnualMean() yang membuang seluruh suku sin/cos. */}
                    <div className="flex bg-slate-50 border border-slate-100 p-1 rounded-lg">
                      {predictionOffsets.map((offset) => (
                        <button key={offset} onClick={() => setPredictionOffset(offset)} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${predictionOffset === offset ? 'bg-white shadow-sm border border-slate-200 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                          {baselineEndYear + offset}
                        </button>
                      ))}
                    </div>
                    {/* Dua hal yang tidak bisa dibaca dari angka tahun sendirian:
                        apa yang dihitung (rata-rata setahun, bukan akumulasi
                        sejak baseline) dan dari mana tahunnya bertolak (tahun
                        kalender penuh terakhir, bukan tanggal akhir baseline). */}
                    <span className="text-[11px] text-slate-400 mt-1.5 block">
                      Rata-rata tahunan {targetYear} · baseline berakhir {baselineEndYear}
                    </span>
                  </div>
                )}

                <div className="mb-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-xs font-medium text-slate-500">
                      {visualMode === 'split' ? 'Periode 1' : (analysisMode === 'prediksi' ? 'Periode baseline' : 'Rentang Tanggal')}
                    </span>
                    {baselineNote && <FullYearInfo />}
                  </div>
                  {/* portalId wajib: panel ini kontainer scroll (overflow-y-auto),
                      dan CSS memaksa overflow-x ikut terpotong. Tanpa portal,
                      kalender yang lebih lebar dari input terpangkas tepi panel. */}
                  <div className="flex items-center gap-2">
                    <DatePicker selected={startDate} onChange={setStartDate} minDate={landsatMinDate} maxDate={new Date()} showMonthDropdown showYearDropdown dropdownMode="select" className="datepicker-input" dateFormat="dd/MM/yyyy" portalId={DATEPICKER_PORTAL_ID} {...DATEPICKER_POPPER_FIX} />
                    <span className="text-slate-300 text-sm">—</span>
                    <DatePicker selected={endDate} onChange={setEndDate} minDate={startDate} maxDate={new Date()} showMonthDropdown showYearDropdown dropdownMode="select" className="datepicker-input" dateFormat="dd/MM/yyyy" portalId={DATEPICKER_PORTAL_ID} {...DATEPICKER_POPPER_FIX} />
                  </div>
                  <FullYearNote years={baselineNote} />
                </div>

                {visualMode === 'split' && (
                  <div className="mb-4">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-xs font-medium text-slate-500">Periode 2</span>
                      {rightNote && <FullYearInfo />}
                    </div>
                    <div className="flex items-center gap-2">
                      <DatePicker selected={startDateRight} onChange={setStartDateRight} minDate={landsatMinDate} maxDate={new Date()} showMonthDropdown showYearDropdown dropdownMode="select" className="datepicker-input" dateFormat="dd/MM/yyyy" portalId={DATEPICKER_PORTAL_ID} {...DATEPICKER_POPPER_FIX} />
                      <span className="text-slate-300 text-sm">—</span>
                      <DatePicker selected={endDateRight} onChange={setEndDateRight} minDate={startDateRight} maxDate={new Date()} showMonthDropdown showYearDropdown dropdownMode="select" className="datepicker-input" dateFormat="dd/MM/yyyy" portalId={DATEPICKER_PORTAL_ID} {...DATEPICKER_POPPER_FIX} />
                    </div>
                    <FullYearNote years={rightNote} />
                  </div>
                )}

                <div className="mb-2">
                  <span className="text-xs font-medium text-slate-500 mb-1.5 block">Area Tinjauan</span>
                  <div className="relative">
                    <select value={region} onChange={handleRegionChange} className="w-full px-3 py-2 text-xs font-medium bg-white border rounded-lg border-slate-200 outline-none focus:border-slate-400 appearance-none cursor-pointer text-slate-700">
                      {regions.map(r => <option key={r} value={r}>{toTitleCase(r)}</option>)}
                    </select>
                    <ChevronDown size={12} className="absolute right-3 top-3 text-slate-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Tampilan Data */}
              <div id="tour-parameter" className="pt-4 border-t border-slate-100">
                <span className="text-[13px] font-semibold text-slate-600 mb-4 text-center block">Tampilan Data</span>

                <div className="flex gap-2 mb-4">
                  {['lst', 'ndvi'].map((type) => (
                    <button key={type} type="button" onClick={() => handleTypeChange(type)} className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all flex items-center justify-center gap-2 cursor-pointer ${layerType === type ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                      {type === 'lst' ? <ThermometerSun size={14} /> : <Leaf size={14} />}
                      {type === 'lst' ? 'Suhu (LST)' : 'Vegetasi (NDVI)'}
                    </button>
                  ))}
                </div>



                {/* Vis Range Preview */}
                <div className="px-4 py-3 mt-3 bg-slate-50 border border-slate-100 rounded-lg">
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-slate-500">Rentang Visualisasi</span>
                    <span className="text-slate-600 font-semibold">{visMin} — {visMax}</span>
                  </div>
                  <div className="w-full h-2 rounded-full mb-2" style={{ background: visGradient }}></div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" step="0.1"
                      min={visBounds.min} max={visBounds.max}
                      value={visMin}
                      onChange={handleVisInput(setVisMin)}
                      onBlur={handleVisBlur(setVisMin, visBounds.defMin)}
                      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white text-slate-600 text-center"
                      placeholder="Min"
                    />
                    <span className="text-slate-300 text-xs">—</span>
                    <input
                      type="number" step="0.1"
                      min={visBounds.min} max={visBounds.max}
                      value={visMax}
                      onChange={handleVisInput(setVisMax)}
                      onBlur={handleVisBlur(setVisMax, visBounds.defMax)}
                      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white text-slate-600 text-center"
                      placeholder="Max"
                    />
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400 text-center">
                    {layerType === 'ndvi' ? 'NDVI' : 'Suhu'} berkisar {visBounds.min} sampai {withUnit(visBounds.max, activeLabel.unit)}
                  </p>
                </div>

                <div className="px-4 py-3 mt-3 bg-slate-50 border border-slate-100 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-slate-500 flex items-center gap-1.5"><AlertTriangle size={12} /> Ambang batas {layerType === 'lst' ? 'suhu' : 'NDVI'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" step="0.1" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white text-slate-600" />
                    {/* NDVI tidak bersatuan, jadi tidak ada yang ditulis di sini. */}
                    {activeLabel.unit && (
                      <span className="text-xs text-slate-400 whitespace-nowrap">{activeLabel.unit}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Metode gap filling — hanya relevan di mode historis */}
              {analysisMode !== 'prediksi' && (
                <div className="pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-center gap-1.5 mb-4">
                    <span className="text-[13px] font-semibold text-slate-600 block">Pemrosesan Awan</span>
                    <div className="group relative cursor-help flex items-center">
                      <Info size={13} className="text-slate-300 hover:text-slate-500 transition-colors" />
                      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-72 p-3 bg-slate-800 text-white text-[11px] rounded-xl shadow-xl z-50 text-left leading-relaxed border border-slate-700">
                        <span className="block font-semibold text-slate-200 mb-1">Komposit Temporal (Bawaan)</span>
                        <span className="text-slate-400 block mb-2">Reduksi statistik berbasis waktu (median/mean) pada kumpulan citra. Mempertahankan nilai fisis asli observasi.</span>

                        <span className="block font-semibold text-slate-200 mb-1">Interpolasi Spasial (Focal Mean)</span>
                        <span className="text-slate-400 block">Menambal kekosongan piksel akibat masking awan menggunakan rata-rata piksel tetangga.</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mb-2">
                    <button type="button" onClick={() => setGapFill('none')} className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all cursor-pointer ${gapFill === 'none' ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                      Komposit Temporal
                    </button>
                    <button type="button" onClick={() => setGapFill('spatial')} className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all cursor-pointer ${gapFill === 'spatial' ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                      Interpolasi Spasial
                    </button>
                  </div>
                </div>
              )}

              <button
                id="tour-process-btn"
                type="button"
                onClick={handleProcess}
                disabled={loading}
                className="w-full py-3 mt-2 text-sm font-semibold text-white transition-all rounded-xl bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 flex justify-center items-center gap-2 cursor-pointer active:scale-[0.98]"
              >
                {loading ? <span className="animate-spin">⟳</span> : <Activity size={16} />}
                {visualMode === 'split' ? 'Proses Perbandingan' : (analysisMode === 'prediksi' ? 'Jalankan Prediksi' : 'Proses Data')}
              </button>
            </div>

            {/* HASIL / OUTPUT */}
            {loading && !hasResult && (
              <div className="mt-8 pt-6 border-t border-slate-100">
                <span className="text-[13px] font-semibold text-slate-600 mb-4 text-center block animate-pulse">Memproses...</span>
                {renderKPISkeleton()}
                {/* Chart skeleton */}
                <div className="mt-6 pt-6 border-t border-slate-100">
                  <div className="skeleton h-3 w-24 mb-4"></div>
                  <div className="skeleton h-48 w-full"></div>
                </div>
              </div>
            )}

            {!hasResult && !loading && (
              <div className="mt-8 pt-6 border-t border-slate-100">
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                    <Satellite size={28} className="text-slate-300" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-400 mb-1">Belum Ada Data</h3>
                  <p className="text-xs text-slate-400 leading-relaxed max-w-65">
                    Konfigurasi parameter di atas, lalu tekan tombol <span className="font-semibold text-slate-500">&quot;Proses Data&quot;</span> untuk memulai analisis geospasial.
                  </p>
                </div>
              </div>
            )}

            {/* Mode perbandingan menuntut kedua sisi ada. Kalau hanya satu yang
                terisi, blok di bawah membaca statsRight yang kosong dan seluruh
                halaman ikut mati — bukan sekadar salah tampil. */}
            {hasResult && (
              <div id="tour-result-area" className="mt-8 pt-6 border-t border-slate-100 animate-fade-in">
                {visualMode === 'split' ? (
                  <>
                    <span className="text-[13px] font-semibold text-slate-600 mb-4 text-center block">Statistik Perbandingan</span>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Blok Statistik Kiri */}
                      <div className="flex flex-col gap-2">
                        <div className="text-[11px] font-medium text-slate-400 bg-slate-50 p-1.5 rounded-lg text-center">{periodeLabelKiri}</div>
                        <div className="p-3 bg-white border border-slate-100 rounded-xl shadow-sm flex flex-col">
                          <span className="text-[11px] text-slate-400 mb-0.5">Rata-rata</span>
                          <span className="text-lg font-bold text-slate-800">{stats.mean.toFixed(2)} <span className="text-xs font-normal text-slate-400">{stats.unit}</span></span>
                        </div>
                        <div className="p-3 bg-white border border-slate-100 rounded-xl shadow-sm flex flex-col">
                          <span className="text-[11px] text-slate-400 mb-0.5 flex items-center gap-1"><AlertTriangle size={10} /> Area Terdampak</span>
                          <span className="text-lg font-bold text-slate-800">{stats.impact_area_ha?.toLocaleString('id-ID', { maximumFractionDigits: 1 }) || 0} <span className="text-xs font-normal text-slate-400">Ha</span></span>
                        </div>
                      </div>

                      {/* Blok Statistik Kanan */}
                      <div className="flex flex-col gap-2">
                        <div className="text-[11px] font-medium text-slate-400 bg-slate-50 p-1.5 rounded-lg text-center">{periodeLabelKanan}</div>
                        <div className="p-3 bg-white border border-slate-100 rounded-xl shadow-sm flex flex-col">
                          <span className="text-[11px] text-slate-400 mb-0.5">Rata-rata</span>
                          <span className="text-lg font-bold text-slate-800">{statsRight.mean.toFixed(2)} <span className="text-xs font-normal text-slate-400">{statsRight.unit}</span></span>
                        </div>
                        <div className="p-3 bg-white border border-slate-100 rounded-xl shadow-sm flex flex-col">
                          <span className="text-[11px] text-slate-400 mb-0.5 flex items-center gap-1"><AlertTriangle size={10} /> Area Terdampak</span>
                          <span className="text-lg font-bold text-slate-800">{statsRight.impact_area_ha?.toLocaleString('id-ID', { maximumFractionDigits: 1 }) || 0} <span className="text-xs font-normal text-slate-400">Ha</span></span>
                        </div>
                      </div>
                    </div>

                    {/* Blok Kesimpulan / Selisih */}
                    <div className="mt-3 p-4 bg-slate-800 text-white rounded-xl shadow-md relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-white opacity-5 rounded-full -translate-y-1/2 translate-x-1/2"></div>
                      <span className="text-[11px] text-slate-300 mb-2 block">Perubahan (Periode 2 − Periode 1)</span>
                      <div className="flex justify-between items-end">
                        <div>
                          <span className="text-xs text-slate-400 block mb-0.5">Selisih Rata-rata</span>
                          <span className={`text-xl font-bold leading-none ${(statsRight.mean - stats.mean) > 0 ? (layerType === 'lst' ? 'text-rose-400' : 'text-emerald-400') : (layerType === 'lst' ? 'text-emerald-400' : 'text-rose-400')}`}>
                            {(statsRight.mean - stats.mean) > 0 ? '+' : ''}{(statsRight.mean - stats.mean).toFixed(2)} <span className="text-sm font-normal opacity-70">{stats.unit}</span>
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-slate-400 block mb-0.5">Area Terdampak Baru</span>
                          <span className={`text-xl font-bold leading-none ${((statsRight.impact_area_ha || 0) - (stats.impact_area_ha || 0)) > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {((statsRight.impact_area_ha || 0) - (stats.impact_area_ha || 0)) > 0 ? '+' : ''}{((statsRight.impact_area_ha || 0) - (stats.impact_area_ha || 0)).toLocaleString('id-ID', { maximumFractionDigits: 1 })} <span className="text-sm font-normal opacity-70">Ha</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-[13px] font-semibold text-slate-600 mb-1 text-center block">Ringkasan Analitik</span>
                    {snapshotLoaded && snapshotDate && (
                      <p className="text-[10px] text-slate-400 text-center mb-4">
                        Data snapshot: {snapshotDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}, {snapshotDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB
                      </p>
                    )}
                    {renderKPIs()}
                  </>
                )}

                {/* MEMANGGIL BLOK GRAFIK (BERFUNGSI DI KEDUA MODE) */}
                {renderChartSection()}

                {/* DOWNLOAD (HANYA MUNCUL DI MODE TUNGGAL) */}
                <div className="flex justify-end gap-2 mt-4">
                  {chartData.length > 0 && visualMode !== 'split' && (
                    <button
                      type="button"
                      onClick={handleExportCSV}
                      className="text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-md flex items-center gap-1.5 hover:bg-emerald-100 transition-colors cursor-pointer"
                    >
                      <FileDown size={14} /> CSV
                    </button>
                  )}
                  {stats && visualMode !== 'split' && (
                    <button
                      type="button"
                      onClick={handleDownloadGeoTIFF}
                      disabled={preparingTiff}
                      className="text-xs font-semibold bg-slate-100 text-slate-600 px-3 py-2 rounded-md flex items-center gap-1.5 hover:bg-slate-200 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download size={14} /> {preparingTiff ? 'Menyiapkan...' : 'GeoTIFF'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Mobile link to Evaluasi */}
            <div className="md:hidden mt-6 pt-4 border-t border-slate-100">
              <Link href="/evaluasi" className="flex items-center justify-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 py-2.5 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors no-underline w-full">
                <ClipboardList size={14} />
                Evaluasi UEQ
              </Link>
            </div>
          </div>
        </aside>

        {/* === MAP AREA === */}
        <div id="tour-map-area" className="relative flex-1 bg-slate-100 flex">
          {/* clipGeoJson hanya diisi saat satu kabupaten dipilih. "Seluruh Bali"
              dibiarkan utuh supaya tampilannya sama persis seperti sebelumnya. */}
          <MapWithNoSSR
            mapUrl={mapUrl}
            mapUrlRight={mapUrlRight}
            isSplit={visualMode === 'split'}
            selectedGeoJson={selectedGeoJson}
            clipGeoJson={region === 'Seluruh Bali' ? null : selectedGeoJson}
          />
          {hasResult && (
            <MapLegend
              type={layerType}
              min={parseFloat(visMin)}
              max={parseFloat(visMax)}
              isPrediction={!!stats.is_prediction}
              targetYear={stats.target_year}
            />
          )}
        </div>

        {/* --- Tombol Lonceng Melayang (FAB) --- */}
        {/* Tombol × dan lonceng harus bersebelahan, bukan bersarang —
            <button> di dalam <button> tidak valid dan tidak bisa diklik. */}
        {!showUeqModal && !isBellHidden && (
          <div className="absolute top-4 right-4 md:top-6 md:right-6 z-[2000]">
            <button
              onClick={() => setShowUeqModal(true)}
              className="relative bg-rose-500 text-white p-3.5 md:p-4 rounded-full shadow-lg hover:bg-rose-600 hover:scale-105 transition-all flex items-center justify-center border-4 border-white/40 group"
              title="Isi Evaluasi UEQ"
            >
              <BellRing size={22} className="animate-ringing" />
              <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-300 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-400"></span>
              </span>
            </button>

            <button
              onClick={handleHideBell}
              className="absolute -top-1.5 -left-1.5 w-6 h-6 rounded-full bg-white text-slate-500 shadow-md border border-slate-200 flex items-center justify-center hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
              aria-label="Sembunyikan pengingat evaluasi"
              title="Sembunyikan pengingat ini"
            >
              <X size={13} strokeWidth={3} />
            </button>
          </div>
        )}

        {/* --- Modal Pop-up Evaluasi UEQ --- */}
        {showUeqModal && (
          <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-in-up">
              <div className="bg-gradient-to-r from-rose-500 to-rose-600 p-5 text-center relative">
                <button 
                  onClick={() => setShowUeqModal(false)}
                  className="absolute top-3 right-3 text-white/70 hover:text-white transition-colors cursor-pointer"
                  aria-label="Tutup popup"
                >
                  <X size={20} />
                </button>
                <div className="bg-white/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3">
                  <ClipboardList size={32} className="text-white" />
                </div>
                <h3 className="text-xl font-bold text-white mb-1">Bantu Kami Berkembang!</h3>
              </div>
              <div className="p-6 text-center">
                <p className="text-[13px] text-slate-600 mb-6 leading-relaxed">
                  Luangkan waktu <b className="text-rose-600">1-2 menit</b> saja untuk mengisi kuesioner Evaluasi Pengalaman Pengguna (UEQ). Masukan Anda sangat berharga untuk kelancaran penelitian skripsi ini.
                </p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowUeqModal(false)}
                    className="flex-1 py-2.5 text-sm font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                  >
                    Nanti Saja
                  </button>
                  <Link 
                    href="/evaluasi"
                    onClick={() => setShowUeqModal(false)}
                    className="flex-1 py-2.5 text-sm font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-xl shadow-md hover:shadow-lg transition-all no-underline block"
                  >
                    Isi Sekarang
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* ── Tour Overlay ── */}
      {isTourActive && (
        <TourOverlay
          onTourComplete={handleTourComplete}
          onDemoProcess={handleDemoProcess}
          onStepChange={(idx, id) => {
            setTourStep(idx);
            // Saat panduan masuk ke 'Peta Satelit', tutup panel agar peta tak
            // tertutup (khusus mobile; desktop tak terdampak). Langkah yang
            // menyorot kontrol di panel memastikan panel terbuka kembali.
            if (id === 'map') {
              if (typeof window !== 'undefined' && window.innerWidth < 768) setSidebarOpen(false);
            } else if (id !== 'welcome' && id !== 'farewell') {
              setSidebarOpen(true);
            }
          }}
        />
      )}
    </div>
  );
}