// pages/index.js
import { useState, useEffect, useRef, useCallback } from 'react';
import TourOverlay, { TourTriggerButton } from '../components/TourOverlay';
import Head from 'next/head';
import Script from 'next/script';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import {
  Leaf, ThermometerSun, Activity, Menu, Download, FileDown,
  ChevronDown, AlertTriangle, ScatterChart as ScatterIcon,
  TrendingUp, History, Square, Columns, Info, BookOpen,
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

/** Batasi angka ke rentang [lo, hi]; kembalikan fallback bila bukan angka. */
const clampNum = (raw, lo, hi, fallback) => {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, lo), hi);
};

const MapLegend = ({ type, min, max }) => {
  const gradient = type === 'ndvi'
    ? 'linear-gradient(to right, #ef4444, #facc15, #22c55e)'
    : 'linear-gradient(to right, #1e1b4b, #38bdf8, #fef08a, #ef4444, #7f1d1d)';

  return (
    <div className="absolute bottom-4 right-4 md:bottom-6 md:right-6 z-[2000] bg-white/90 backdrop-blur-md p-2.5 md:p-3.5 rounded-xl shadow-lg border border-slate-200/50 w-[70vw] max-w-[200px] md:max-w-none md:w-64">
      <div className="flex items-center justify-between mb-1.5 md:mb-2.5">
        <span className="text-[10px] md:text-xs font-semibold text-slate-600 truncate mr-2">
          {type === 'ndvi' ? 'NDVI' : 'Suhu Permukaan'}
        </span>
        <span className="px-1.5 md:px-2 py-0.5 text-[9px] md:text-[10px] bg-slate-100 rounded text-slate-500 whitespace-nowrap">Landsat 8/9</span>
      </div>
      <div className="w-full h-1.5 md:h-2 mb-1.5 md:mb-2 rounded-full" style={{ background: gradient }}></div>
      <div className="flex justify-between text-[10px] md:text-[11px] text-slate-500">
        <span>{min}</span>
        <span>{((min + max) / 2).toFixed(1)}</span>
        <span>{max}</span>
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

  const [activeSplitSide, setActiveSplitSide] = useState('left'); // 'left' | 'right'

  const [tiffUrl, setTiffUrl] = useState(null);
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

  const currentYear = new Date().getFullYear();
  const [targetYear, setTargetYear] = useState(currentYear + 5);

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
      setChartData(snapshot.chart || []);
      setScatterData(snapshot.scatter || []);
      if (snapshot.downloadUrl) setTiffUrl(snapshot.downloadUrl);
      if (snapshot._generated_at) setSnapshotDate(new Date(snapshot._generated_at));

      // Sinkronisasi parameter filter dengan data snapshot yang dimuat
      const params = snapshot._params || {};
      if (params.type) setLayerType(params.type);
      if (params.region_name) {
        setRegion(params.region_name === 'ALL' ? 'Seluruh Bali' : params.region_name);
      }
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
      setChartData(demo.chart || []);
      setScatterData(demo.scatter || []);
      if (demo.downloadUrl) setTiffUrl(demo.downloadUrl);
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

  const resetData = () => {
    setMapUrl(null);
    setMapUrlRight(null);
    setStats(null);
    setStatsRight(null);
    setChartData([]);
    setScatterData([]);
    setChartDataRight([]);
    setScatterDataRight([]);
    setTiffUrl(null);
    setActiveSplitSide('left');
  };

  const handleSwitchMode = (mode) => {
    if (mode !== analysisMode) {
      setAnalysisMode(mode);
      if (mode === 'prediksi') {
        setChartMode('trend');
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

  const fetchData = async () => {
    setLoading(true);
    toast.dismiss();
    setTiffUrl(null);
    setSnapshotLoaded(false);

    const loadingMsg = visualMode === 'split'
      ? 'Memproses dua peta historis...'
      : (analysisMode === 'history' ? 'Memproses data historis...' : 'Menghitung pemodelan linear...');

    const toastId = toast.loading(loadingMsg);

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
          const errRes = !resLeft.ok ? resLeft : resRight;
          const errData = await errRes.json().catch(() => ({}));
          if (errData.error === 'TIMEOUT') {
            toast.warning('GEE sedang memproses — coba lagi dalam beberapa detik. (GEE cache biasanya membuat request ke-2 jauh lebih cepat)', { id: toastId, duration: 8000 });
          } else {
            toast.error(errData.error || 'Gagal mengambil data Satelit.', { id: toastId });
          }
          setLoading(false);
          return;
        }

        const dataLeft = await resLeft.json();
        const dataRight = await resRight.json();

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
        setActiveSplitSide('left'); // Kembalikan fokus ke kiri setiap selesai proses

      } else {
        const params = new URLSearchParams({
          mode: analysisMode,
          type: layerType,
          region_name: regionParam,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          cloud_cover: debouncedCloudCover,
          reducer: reducer,
          vis_min: visMin,
          vis_max: visMax,
          threshold: threshold,
          target_year: targetYear,
          gap_fill: gapFill
        });

        const res = await fetch(`/api/map-layer?${params}`);

        // Cek error dengan pesan spesifik (termasuk timeout)
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          if (errData.error === 'TIMEOUT') {
            toast.warning(
              'GEE sedang memproses di server — coba lagi dalam beberapa detik. Request ke-2 biasanya jauh lebih cepat karena GEE cache.',
              { id: toastId, duration: 8000 }
            );
          } else {
            toast.error(errData.error || 'Gagal memproses data.', { id: toastId });
          }
          setLoading(false);
          return;
        }

        const data = await res.json();

        serverMs = data.processing_time_ms ?? null;
        fromCache = res.headers.get('X-Cache') === 'HIT';

        setMapUrl(data.map.urlFormat);
        setStats(data.stats);
        setChartData(data.chart);
        setScatterData(data.scatter);
        if (data.downloadUrl) setTiffUrl(data.downloadUrl);
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
      toast.error('Gagal memproses data. Periksa koneksi dan coba lagi.', { id: toastId });
    } finally {
      setLoading(false);
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
    const unit = layerType === 'lst' ? '°C' : 'Index';

    const header = 'date,value,region,layer_type,unit';
    const rows = activeChart
      .filter(d => d.value !== null && d.value !== undefined)
      .map(d => `${d.date},${Number(d.value).toFixed(4)},${regionLabel},${layerLabel},${unit}`);

    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const fileName = `LST-NDVI_${layerLabel}_${regionLabel}_${activeChart[0]?.date || ''}_${activeChart[activeChart.length-1]?.date || ''}.csv`;
    saveAs(blob, fileName);
    toast.success(`Data CSV berhasil diekspor: ${fileName}`);
  };

  // Kalkulasi Tren Regresi Linear yang dinamis menerima data apa saja (kiri atau kanan)
  const getTrendLineData = (dataArray) => {
    if (!dataArray || dataArray.length < 2) return null;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    const n = dataArray.length;

    dataArray.forEach(p => {
      sumX += p.ndvi;
      sumY += p.lst;
      sumXY += p.ndvi * p.lst;
      sumXX += p.ndvi * p.ndvi;
    });

    const denominator = (n * sumXX - sumX * sumX);
    if (denominator === 0) return null;

    const m = (n * sumXY - sumX * sumY) / denominator;
    const c = (sumY - m * sumX) / n;

    return {
      segment: [
        { x: -1, y: m * (-1) + c },
        { x: 1, y: m * 1 + c }
      ],
      slope: m
    };
  };

  // Helper untuk menyiapkan data tampilan grafik (menangani overlay prediksi jika ada)
  const getDisplayChartData = (cData, currentStats) => {
    if (currentStats?.is_prediction && cData.length > 0) {
      return [...cData, { date: `${currentStats.target_year}-01-01`, value: currentStats.mean, isPred: true }];
    }
    return cData;
  };

  // Generator Teks Interpretasi
  const renderChartSummary = (cMode, cData, sData, currentStats, tData) => {
    if (cMode === 'trend' && cData.length > 1) {
      const histData = cData.filter(d => !d.isPred);
      if (histData.length < 2) return "Data rentang waktu tidak cukup panjang untuk membentuk kesimpulan tren yang valid.";

      const first = histData[0];
      const last = histData[histData.length - 1];
      const diff = last.value - first.value;
      const paramName = layerType === 'lst' ? 'Suhu Permukaan' : 'Indeks Vegetasi';
      const trendDir = diff > 0 ? 'peningkatan' : 'penurunan';
      const sifatTrend = layerType === 'lst'
        ? (diff > 0 ? 'yang berpotensi mengindikasikan pemanasan lokal' : 'menunjukkan pendinginan wilayah')
        : (diff > 0 ? 'mengindikasikan penghijauan area' : 'mengindikasikan pengurangan tutupan lahan hijau');

      let text = `Secara historis dari ${first.date.substring(0, 4)} hingga ${last.date.substring(0, 4)}, ${paramName} mengalami tren ${trendDir} kumulatif sebesar ${Math.abs(diff).toFixed(2)} ${currentStats?.unit}, ${sifatTrend}.`;

      if (currentStats?.is_prediction) {
        const predDiff = currentStats.mean - last.value;
        const predDir = predDiff > 0 ? 'naik' : 'turun';
        text += ` Jika pola ini dipertahankan, proyeksi memprediksi nilai rata-rata akan terus bergerak ${predDir} mencapai ${currentStats.mean.toFixed(2)} ${currentStats?.unit} pada tahun ${currentStats.target_year}.`;
      }
      return text;
    }

    if (cMode === 'scatter' && sData.length > 1 && tData) {
      const { slope } = tData;
      if (slope < -1) {
        return "Terdapat Korelasi Negatif Kuat. Secara empiris terbukti bahwa titik dengan tutupan vegetasi lebat (NDVI mendekati 1) secara konsisten meredam panas, menghasilkan Suhu Permukaan (LST) yang jauh lebih dingin.";
      } else if (slope < 0) {
        return "Terdapat indikasi Korelasi Negatif. Area menunjukkan pola umum dimana semakin tinggi kerapatan hijau, semakin rendah Suhu Permukaan di sekitarnya.";
      } else if (slope > 0) {
        return "Terdeteksi Korelasi Positif. Secara teoritis ini adalah anomali (vegetasi tinggi seharusnya menurunkan suhu). Kondisi ini biasa terjadi jika ada intervensi awan ekstrem, atau kesalahan pembacaan sensor pada wilayah air.";
      }
    }
    return "Sedang mengumpulkan sampel data untuk diinterpretasikan...";
  };

  // Skeleton Loading untuk KPI Cards
  const renderKPISkeleton = () => (
    <div className="grid grid-cols-2 gap-3 mt-4">
      {[1, 2, 3].map(i => (
        <div key={i} className={`flex flex-col p-4 bg-white border border-slate-100 rounded-xl ${i === 3 ? 'col-span-2' : ''}`}>
          <div className="skeleton h-3 w-20 mb-3"></div>
          <div className="skeleton h-6 w-28"></div>
        </div>
      ))}
    </div>
  );

  const renderKPIs = () => {
    if (!stats) return null;

    const cardClass = "flex flex-col p-4 bg-white border border-slate-100 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200";

    if (stats.is_prediction) {
      const delta = stats.mean - stats.baseline_mean;
      const isWorse = layerType === 'lst' ? delta > 0 : delta < 0;
      return (
        <div className="grid grid-cols-2 gap-3 mt-4 animate-fade-in">
          <div className={cardClass}>
            <span className="text-[11px] text-slate-400 font-medium mb-1.5">Proyeksi {stats.target_year}</span>
            <span className="text-xl font-bold text-slate-800 leading-none">
              {stats.mean.toFixed(2)} <span className="text-xs font-normal text-slate-400">{stats.unit}</span>
            </span>
          </div>
          <div className={cardClass}>
            <span className="text-[11px] text-slate-400 font-medium mb-1.5">Delta (Selisih)</span>
            <span className={`text-xl font-bold leading-none ${isWorse ? 'text-rose-500' : 'text-emerald-500'}`}>
              {delta > 0 ? '+' : ''}{delta.toFixed(2)} <span className="text-xs font-normal opacity-60">{stats.unit}</span>
            </span>
          </div>
          <div className={`col-span-2 ${cardClass}`}>
            <span className="text-[11px] text-slate-400 font-medium mb-1.5 flex items-center gap-1.5"><AlertTriangle size={12} /> Wilayah terdampak (di atas {stats.threshold})</span>
            <span className="text-xl font-bold text-slate-800 leading-none">
              {stats.impact_area_ha ? stats.impact_area_ha.toLocaleString('id-ID', { maximumFractionDigits: 1 }) : 0} <span className="text-xs font-normal text-slate-400">Hektar</span>
            </span>
          </div>
        </div>
      );
    } else {
      return (
        <div className="grid grid-cols-2 gap-3 mt-4 animate-fade-in">
          <div className={cardClass}>
            <span className="text-[11px] text-slate-400 font-medium mb-1.5">Rata-rata {layerType === 'lst' ? 'LST' : 'NDVI'}</span>
            <span className="text-xl font-bold text-slate-800 leading-none">
              {stats.mean.toFixed(2)} <span className="text-xs font-normal text-slate-400">{stats.unit}</span>
            </span>
          </div>
          <div className={cardClass}>
            <span className="text-[11px] text-slate-400 font-medium mb-1.5">Maksimum</span>
            <span className="text-xl font-bold text-slate-800 leading-none">
              {stats.max.toFixed(2)} <span className="text-xs font-normal text-slate-400">{stats.unit}</span>
            </span>
          </div>
          <div className={`col-span-2 ${cardClass}`}>
            <span className="text-[11px] text-slate-400 font-medium mb-1.5 flex items-center gap-1.5"><AlertTriangle size={12} /> Wilayah terdampak (di atas {stats.threshold})</span>
            <span className="text-xl font-bold text-slate-800 leading-none">
              {stats.impact_area_ha ? stats.impact_area_ha.toLocaleString('id-ID', { maximumFractionDigits: 1 }) : 0} <span className="text-xs font-normal text-slate-400">Hektar</span>
            </span>
          </div>
        </div>
      );
    }
  };

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

    const trendData = getTrendLineData(activeSData);
    const displayChartData = getDisplayChartData(activeCData, activeStats);

    return (
      <div className="mt-6 pt-6 border-t border-slate-100">
        <div className="flex items-center justify-center mb-4 relative min-h-7">
          <span className="text-[13px] font-semibold text-slate-600">Grafik Analitik</span>
          {isSplit && (
            <div className="absolute right-0 flex bg-slate-100 p-0.5 rounded-md">
              <button type="button" onClick={() => setActiveSplitSide('left')} className={`text-[11px] px-2.5 py-1 font-medium rounded transition-all cursor-pointer ${activeSplitSide === 'left' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}>Peta 1</button>
              <button type="button" onClick={() => setActiveSplitSide('right')} className={`text-[11px] px-2.5 py-1 font-medium rounded transition-all cursor-pointer ${activeSplitSide === 'right' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}>Peta 2</button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mb-3 bg-slate-100 p-1 rounded-lg">
          <button onClick={() => setChartMode('trend')} className={`flex-1 text-xs py-2 px-3 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${chartMode === 'trend' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
            <TrendingUp size={14} /> Tren Waktu
          </button>
          <button onClick={() => setChartMode('scatter')} disabled={analysisMode === 'prediksi'} className={`flex-1 text-xs py-2 px-3 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${chartMode === 'scatter' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed'}`} title={analysisMode === 'prediksi' ? "Korelasi scatter tidak tersedia di mode prediksi" : ""}>
            <ScatterIcon size={14} /> Korelasi
          </button>
        </div>

        <div className="h-56 w-full relative">
          <ResponsiveContainer>
            {chartMode === 'trend' ? (
              <LineChart data={displayChartData} margin={{ top: 10, right: 10, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                <XAxis dataKey="date" hide />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                  labelFormatter={(label) => activeStats?.is_prediction && label.startsWith(activeStats.target_year) ? `Tahun ${activeStats.target_year} (Proyeksi)` : label}
                />
                <Line type="monotone" dataKey="value" stroke={isSplit && activeSplitSide === 'right' ? "#0f172a" : "#334155"} strokeWidth={2} dot={false} />
                {activeStats?.is_prediction && (
                  <Line type="monotone" dataKey="value" stroke="#f43f5e" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 4, fill: "#f43f5e", strokeWidth: 0 }} activeDot={{ r: 6 }} />
                )}
              </LineChart>
            ) : (
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                <XAxis type="number" dataKey="ndvi" name="NDVI" domain={[-1, 1]} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} label={{ value: 'NDVI (Vegetasi)', position: 'insideBottom', offset: -5, fontSize: 11, fill: '#64748b' }} />
                <YAxis type="number" dataKey="lst" name="LST" unit="°C" domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} label={{ value: 'LST (°C)', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }} />
                <Scatter name="Sampel Korelasi" data={activeSData} fill={isSplit && activeSplitSide === 'right' ? "#0f172a" : "#334155"} opacity={0.6} line={false} shape="circle" />

                {trendData?.segment && (
                  <ReferenceLine segment={trendData.segment} stroke="#f43f5e" strokeWidth={2} strokeDasharray="4 4" ifOverflow="hidden" />
                )}
              </ScatterChart>
            )}
          </ResponsiveContainer>
        </div>

        <div className="mt-3 p-3 bg-slate-50 border border-slate-100 rounded-lg flex items-start gap-2.5">
          <Info size={16} className="text-slate-300 shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {renderChartSummary(chartMode, activeCData, activeSData, activeStats, trendData)}
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
                      <Square size={16} /> Tunggal
                    </button>
                    <button onClick={() => handleVisualModeChange('split')} className={`flex-1 py-2 text-sm font-semibold rounded-md flex items-center justify-center gap-2 transition-all cursor-pointer ${visualMode === 'split' ? 'bg-slate-800 shadow-sm text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                      <Columns size={16} /> Komparasi (Split)
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-5">
              {/* Konfigurasi Dasar */}
              <div id="tour-scenario">
                <span className="text-[13px] font-semibold text-slate-600 mb-4 text-center block">Skenario Pemodelan</span>

                {analysisMode === 'prediksi' && (
                  <div className="mb-4">
                    <span className="text-xs font-medium text-slate-500 mb-1.5 block">Target Masa Depan</span>
                    <div className="flex bg-slate-50 border border-slate-100 p-1 rounded-lg">
                      {predictionOffsets.map((offset) => {
                        const yr = currentYear + offset;
                        return (
                          <button key={offset} onClick={() => setTargetYear(yr)} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${targetYear === yr ? 'bg-white shadow-sm border border-slate-200 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                            +{offset} Thn
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mb-4">
                  <span className="text-xs font-medium text-slate-500 mb-1.5 block">
                    {visualMode === 'split' ? 'Periode Historis Peta 1' : (analysisMode === 'prediksi' ? 'Data Historis (Baseline)' : 'Rentang Tanggal')}
                  </span>
                  <div className="flex items-center gap-2">
                    <DatePicker selected={startDate} onChange={setStartDate} minDate={landsatMinDate} maxDate={new Date()} showMonthDropdown showYearDropdown dropdownMode="select" className="datepicker-input" dateFormat="dd/MM/yyyy" />
                    <span className="text-slate-300 text-sm">—</span>
                    <DatePicker selected={endDate} onChange={setEndDate} minDate={startDate} maxDate={new Date()} showMonthDropdown showYearDropdown dropdownMode="select" className="datepicker-input" dateFormat="dd/MM/yyyy" />
                  </div>
                </div>

                {visualMode === 'split' && (
                  <div className="mb-4">
                    <span className="text-xs font-medium text-slate-500 mb-1.5 block">Periode Historis Peta 2</span>
                    <div className="flex items-center gap-2">
                      <DatePicker selected={startDateRight} onChange={setStartDateRight} minDate={landsatMinDate} maxDate={new Date()} showMonthDropdown showYearDropdown dropdownMode="select" className="datepicker-input" dateFormat="dd/MM/yyyy" />
                      <span className="text-slate-300 text-sm">—</span>
                      <DatePicker selected={endDateRight} onChange={setEndDateRight} minDate={startDateRight} maxDate={new Date()} showMonthDropdown showYearDropdown dropdownMode="select" className="datepicker-input" dateFormat="dd/MM/yyyy" />
                    </div>
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

              {/* Parameter Lingkungan */}
              <div id="tour-parameter" className="pt-4 border-t border-slate-100">
                <span className="text-[13px] font-semibold text-slate-600 mb-4 text-center block">Parameter Lingkungan</span>

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
                    Rentang {layerType === 'ndvi' ? 'NDVI' : 'suhu'} yang diizinkan: {visBounds.min} s/d {visBounds.max}
                  </p>
                </div>

                <div className="px-4 py-3 mt-3 bg-slate-50 border border-slate-100 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-slate-500 flex items-center gap-1.5"><AlertTriangle size={12} /> Ambang batas dampak</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" step="0.1" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white text-slate-600" />
                    <span className="text-xs text-slate-400 whitespace-nowrap">{layerType === 'lst' ? '°C' : 'Index'}</span>
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
                {visualMode === 'split' ? 'Proses Komparasi' : (analysisMode === 'prediksi' ? 'Jalankan Simulasi' : 'Proses Data')}
              </button>
            </div>

            {/* HASIL / OUTPUT */}
            {loading && !stats && (
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

            {!stats && !loading && (
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

            {stats && (
              <div id="tour-result-area" className="mt-8 pt-6 border-t border-slate-100 animate-fade-in">
                {visualMode === 'split' ? (
                  <>
                    <span className="text-[13px] font-semibold text-slate-600 mb-4 text-center block">Komparasi Statistik</span>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Blok Statistik Kiri */}
                      <div className="flex flex-col gap-2">
                        <div className="text-[11px] font-medium text-slate-400 bg-slate-50 p-1.5 rounded-lg text-center">Data Peta 1</div>
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
                        <div className="text-[11px] font-medium text-slate-400 bg-slate-50 p-1.5 rounded-lg text-center">Data Peta 2</div>
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
                      <span className="text-[11px] text-slate-300 mb-2 block">Perubahan (Peta 2 − Peta 1)</span>
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
                  {tiffUrl && visualMode !== 'split' && (
                    <a href={tiffUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold bg-slate-100 text-slate-600 px-3 py-2 rounded-md flex items-center gap-1.5 hover:bg-slate-200 transition-colors no-underline cursor-pointer">
                      <Download size={14} /> GeoTIFF
                    </a>
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
          <MapWithNoSSR mapUrl={mapUrl} mapUrlRight={mapUrlRight} isSplit={visualMode === 'split'} selectedGeoJson={selectedGeoJson} />
          {stats && <MapLegend type={layerType} min={parseFloat(visMin)} max={parseFloat(visMax)} />}
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