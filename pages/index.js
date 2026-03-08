import { useState, useEffect } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import {
  Leaf, ThermometerSun, Activity, Menu, Download,
  ChevronDown, AlertTriangle, ScatterChart as ScatterIcon,
  TrendingUp, History
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter
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

const MapLegend = ({ type, min, max }) => {
  const gradient = type === 'ndvi'
    ? 'linear-gradient(to right, #ef4444, #facc15, #22c55e)'
    : 'linear-gradient(to right, #1e1b4b, #38bdf8, #fef08a, #ef4444, #7f1d1d)';

  return (
    <div className="absolute bottom-6 right-6 z-[1000] bg-white/90 backdrop-blur-md p-4 rounded-xl shadow-lg border border-slate-200/50 w-72">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-slate-600 tracking-wider uppercase">
          {type === 'ndvi' ? 'NDVI' : 'Suhu Permukaan'}
        </span>
        <span className="px-2 py-0.5 text-[10px] bg-slate-100 rounded text-slate-500 font-medium">L8/9</span>
      </div>
      <div className="w-full h-2.5 mb-2 rounded-full" style={{ background: gradient }}></div>
      <div className="flex justify-between text-xs font-medium text-slate-600">
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

  const [startDate, setStartDate] = useState(tenYearsAgo);
  const [endDate, setEndDate] = useState(today);
  const [region, setRegion] = useState('SELURUH BALI');
  const [layerType, setLayerType] = useState('lst');
  const [selectedGeoJson, setSelectedGeoJson] = useState(baliData);

  const [cloudCover, setCloudCover] = useState(30);
  const [debouncedCloudCover, setDebouncedCloudCover] = useState(30);

  const [reducer, setReducer] = useState('Median');
  const [visMin, setVisMin] = useState(20);
  const [visMax, setVisMax] = useState(45);
  const [threshold, setThreshold] = useState(30);

  const [mapUrl, setMapUrl] = useState(null);
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [scatterData, setScatterData] = useState([]);
  const [tiffUrl, setTiffUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  const [analysisMode, setAnalysisMode] = useState('history');
  const [chartMode, setChartMode] = useState('trend');

  const currentYear = new Date().getFullYear();
  const [targetYear, setTargetYear] = useState(currentYear + 5);

  const regions = ['SELURUH BALI', ...baliData.features.map(f => f.properties.nm_kabkota).sort()];
  const predictionOffsets = [1, 3, 5, 10];

  // Batas minimum data Landsat 8 (1 Januari 2013)
  const landsatMinDate = new Date('2013-01-01');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCloudCover(cloudCover);
    }, 500);
    return () => clearTimeout(timer);
  }, [cloudCover]);

  const resetData = () => {
    setMapUrl(null);
    setStats(null);
    setChartData([]);
    setScatterData([]);
    setTiffUrl(null);
  };

  const handleSwitchMode = (mode) => {
    if (mode !== analysisMode) {
      setAnalysisMode(mode);
      resetData();
      if (mode === 'prediksi') setChartMode('trend');
    }
  };

  const handleRegionChange = (e) => {
    const newRegion = e.target.value;
    setRegion(newRegion);
    if (newRegion === 'SELURUH BALI') setSelectedGeoJson(baliData);
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

    const loadingMsg = analysisMode === 'history'
      ? 'Memproses data historis...'
      : 'Menghitung pemodelan linear...';

    const toastId = toast.loading(loadingMsg);

    try {
      const regionParam = region === 'SELURUH BALI' ? 'ALL' : region;
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
        target_year: targetYear
      });

      const res = await fetch(`/api/map-layer?${params}`);
      if (!res.ok) throw new Error("Gagal mengambil data Satelit");

      const data = await res.json();
      setMapUrl(data.map.urlFormat);
      setStats(data.stats);
      setChartData(data.chart);
      setScatterData(data.scatter);
      if (data.downloadUrl) setTiffUrl(data.downloadUrl);

      toast.success('Pemrosesan Selesai', { id: toastId });

    } catch (error) {
      console.error(error);
      toast.error('Gagal memproses data.', { id: toastId });
    }
    setLoading(false);
  };

  const handleProcess = (e) => {
    if (e) e.preventDefault();
    fetchData();
  };

  const renderChartData = () => {
    if (stats?.is_prediction && chartData.length > 0) {
      return [...chartData, { date: `${stats.target_year}-01-01`, value: stats.mean, isPred: true }];
    }
    return chartData;
  };

  const renderKPIs = () => {
    if (!stats) return null;

    if (stats.is_prediction) {
      const delta = stats.mean - stats.baseline_mean;
      const isWorse = layerType === 'lst' ? delta > 0 : delta < 0;

      return (
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="flex flex-col p-4 bg-white border border-slate-100 rounded-xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)]">
            <span className="text-xs text-slate-500 font-bold mb-1.5 uppercase tracking-wide">Proyeksi {stats.target_year}</span>
            <span className="text-2xl font-bold text-slate-800 leading-none">
              {stats.mean.toFixed(2)} <span className="text-xs font-normal text-slate-500">{stats.unit}</span>
            </span>
          </div>
          <div className="flex flex-col p-4 bg-white border border-slate-100 rounded-xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)]">
            <span className="text-xs text-slate-500 font-bold mb-1.5 uppercase tracking-wide">Delta (Selisih)</span>
            <span className={`text-2xl font-bold leading-none ${isWorse ? 'text-rose-500' : 'text-emerald-500'}`}>
              {delta > 0 ? '+' : ''}{delta.toFixed(2)} <span className="text-xs font-normal opacity-70">{stats.unit}</span>
            </span>
          </div>
          <div className="col-span-2 flex flex-col p-4 bg-white border border-slate-100 rounded-xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)]">
            <span className="text-xs text-slate-500 font-bold mb-1.5 uppercase tracking-wide flex items-center gap-1.5"><AlertTriangle size={14} /> Wilayah Terdampak ({'>'} {stats.threshold})</span>
            <span className="text-2xl font-bold text-slate-800 leading-none">
              {stats.impact_area_ha ? stats.impact_area_ha.toLocaleString('id-ID', { maximumFractionDigits: 1 }) : 0} <span className="text-xs font-normal text-slate-500">Hektar</span>
            </span>
          </div>
        </div>
      );
    } else {
      return (
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="flex flex-col p-4 bg-white border border-slate-100 rounded-xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)]">
            <span className="text-xs text-slate-500 font-bold mb-1.5 uppercase tracking-wide">Rata-rata {layerType}</span>
            <span className="text-2xl font-bold text-slate-800 leading-none">
              {stats.mean.toFixed(2)} <span className="text-xs font-normal text-slate-500">{stats.unit}</span>
            </span>
          </div>
          <div className="flex flex-col p-4 bg-white border border-slate-100 rounded-xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)]">
            <span className="text-xs text-slate-500 font-bold mb-1.5 uppercase tracking-wide">Maksimum</span>
            <span className="text-2xl font-bold text-slate-800 leading-none">
              {stats.max.toFixed(2)} <span className="text-xs font-normal text-slate-500">{stats.unit}</span>
            </span>
          </div>
          <div className="col-span-2 flex flex-col p-4 bg-white border border-slate-100 rounded-xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)]">
            <span className="text-xs text-slate-500 font-bold mb-1.5 uppercase tracking-wide flex items-center gap-1.5"><AlertTriangle size={14} /> Wilayah Terdampak ({'>'} {stats.threshold})</span>
            <span className="text-2xl font-bold text-slate-800 leading-none">
              {stats.impact_area_ha ? stats.impact_area_ha.toLocaleString('id-ID', { maximumFractionDigits: 1 }) : 0} <span className="text-xs font-normal text-slate-500">Hektar</span>
            </span>
          </div>
        </div>
      );
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden font-sans bg-slate-50 text-slate-800 selection:bg-slate-200">
      <Head><title>Spatio-Temporal Analysis</title></Head>
      <Toaster position="top-center" />

      <nav className="flex items-center justify-between px-6 bg-white border-b h-16 border-slate-200 z-50">
        <div className="flex items-center gap-3">
          <Activity size={20} className="text-slate-800" />
          <h1 className="text-base font-bold tracking-tight text-slate-800">Spatio-Temporal Analysis Engine</h1>
        </div>
        <button type="button" onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-2 rounded-md hover:bg-slate-100 transition-colors cursor-pointer">
          <Menu size={20} className="text-slate-600" />
        </button>
      </nav>

      <main className="relative flex flex-1 overflow-hidden">
        <aside className={`flex flex-col bg-white transition-all duration-300 border-r border-slate-200 ${isSidebarOpen ? 'w-[420px]' : 'w-0 border-none overflow-hidden'}`}>
          <div className="flex flex-col flex-1 p-6 overflow-y-auto">

            {/* Mode Analisis */}
            <div className="flex bg-slate-100 p-1.5 rounded-lg mb-6">
              <button onClick={() => handleSwitchMode('history')} className={`flex-1 py-2 text-sm font-semibold rounded-md flex items-center justify-center gap-2 transition-all cursor-pointer ${analysisMode === 'history' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                <History size={16} /> Historis
              </button>
              <button onClick={() => handleSwitchMode('prediksi')} className={`flex-1 py-2 text-sm font-semibold rounded-md flex items-center justify-center gap-2 transition-all cursor-pointer ${analysisMode === 'prediksi' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                <TrendingUp size={16} /> Prediksi
              </button>
            </div>

            <div className="space-y-6">
              {/* Konfigurasi Dasar */}
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block">1. Skenario Pemodelan</label>

                {analysisMode === 'prediksi' && (
                  <div className="mb-4">
                    <span className="text-sm font-medium text-slate-600 mb-2 block">Target Masa Depan</span>
                    <div className="flex bg-slate-50 border border-slate-100 p-1.5 rounded-lg">
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
                  <span className="text-sm font-medium text-slate-600 mb-2 block">
                    {analysisMode === 'prediksi' ? 'Data Historis (Baseline Pembelajaran)' : 'Rentang Tanggal Analisis'}
                  </span>
                  <div className="flex items-center gap-2">
                    <DatePicker
                      selected={startDate}
                      onChange={setStartDate}
                      minDate={landsatMinDate}
                      maxDate={new Date()}
                      showMonthDropdown
                      showYearDropdown
                      dropdownMode="select"
                      className="w-full px-3 py-2 text-sm font-medium bg-slate-50 border rounded-lg border-slate-200 outline-none focus:border-slate-400 cursor-pointer text-center"
                      dateFormat="dd/MM/yyyy"
                    />
                    <span className="text-slate-400">-</span>
                    <DatePicker
                      selected={endDate}
                      onChange={setEndDate}
                      minDate={startDate}
                      maxDate={new Date()}
                      showMonthDropdown
                      showYearDropdown
                      dropdownMode="select"
                      className="w-full px-3 py-2 text-sm font-medium bg-slate-50 border rounded-lg border-slate-200 outline-none focus:border-slate-400 cursor-pointer text-center"
                      dateFormat="dd/MM/yyyy"
                    />
                  </div>
                </div>

                <div className="mb-2">
                  <span className="text-sm font-medium text-slate-600 mb-2 block">Area Tinjauan</span>
                  <div className="relative">
                    <select value={region} onChange={handleRegionChange} className="w-full px-3 py-2.5 text-sm font-semibold bg-slate-50 border rounded-lg border-slate-200 outline-none focus:border-slate-400 appearance-none cursor-pointer">
                      {regions.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-3 text-slate-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Parameter Lingkungan */}
              <div className="pt-4 border-t border-slate-100">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block">2. Parameter Lingkungan</label>

                <div className="flex gap-2 mb-4">
                  {['lst', 'ndvi'].map((type) => (
                    <button key={type} type="button" onClick={() => handleTypeChange(type)} className={`flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${layerType === type ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                      {type === 'lst' ? <ThermometerSun size={16} /> : <Leaf size={16} />}
                      {type === 'lst' ? 'Suhu (LST)' : 'Vegetasi'}
                    </button>
                  ))}
                </div>

                <div className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-lg">
                  <div className="flex justify-between text-xs font-medium mb-2">
                    <span className="text-slate-500">Filter Tutupan Awan</span>
                    <span className="text-slate-700 font-bold">{cloudCover}% Maks</span>
                  </div>
                  <input type="range" min="0" max="100" value={cloudCover} onChange={(e) => setCloudCover(e.target.value)} className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-600" />
                </div>

                <div className="px-4 py-3 mt-3 bg-slate-50 border border-slate-100 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><AlertTriangle size={14} /> Ambang Batas Dampak</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" step="0.1" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-full px-3 py-1.5 text-sm font-medium border border-slate-200 rounded-md outline-none focus:border-slate-400 bg-white text-slate-700" />
                    <span className="text-xs font-medium text-slate-500 whitespace-nowrap">{layerType === 'lst' ? 'Derajat (°C)' : 'Index'}</span>
                  </div>
                </div>
              </div>

              <button type="button" onClick={handleProcess} disabled={loading} className="w-full py-3 mt-2 text-sm font-bold text-white transition-all rounded-lg bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 flex justify-center items-center gap-2 cursor-pointer active:scale-[0.98]">
                {loading ? <span className="animate-spin">⟳</span> : <Activity size={18} />}
                {analysisMode === 'prediksi' ? 'Jalankan Simulasi' : 'Proses Data'}
              </button>
            </div>

            {/* HASIL / OUTPUT */}
            {stats && (
              <div className="mt-8 pt-6 border-t border-slate-100 animate-in fade-in duration-500">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block">Ringkasan Analitik</label>

                {renderKPIs()}

                <div className="flex items-center gap-2 mt-6 mb-3 bg-slate-100 p-1.5 rounded-lg">
                  <button onClick={() => setChartMode('trend')} className={`flex-1 text-xs py-2 px-3 rounded-md font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${chartMode === 'trend' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <TrendingUp size={16} /> Tren Waktu
                  </button>
                  <button onClick={() => setChartMode('scatter')} disabled={analysisMode === 'prediksi'} className={`flex-1 text-xs py-2 px-3 rounded-md font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${chartMode === 'scatter' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed'}`} title={analysisMode === 'prediksi' ? "Korelasi scatter tidak tersedia di mode prediksi" : ""}>
                    <ScatterIcon size={16} /> Korelasi
                  </button>
                </div>

                <div className="h-56 w-full relative">
                  <ResponsiveContainer>
                    {chartMode === 'trend' ? (
                      <LineChart data={renderChartData()} margin={{ top: 10, right: 10, bottom: 5, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                        <XAxis dataKey="date" hide />
                        <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                        <Tooltip
                          contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                          labelFormatter={(label) => stats?.is_prediction && label.startsWith(stats.target_year) ? `Tahun ${stats.target_year} (Proyeksi)` : label}
                        />
                        <Line type="monotone" dataKey="value" stroke="#334155" strokeWidth={2} dot={false} />

                        {stats?.is_prediction && (
                          <Line type="monotone" dataKey="value" stroke="#f43f5e" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 4, fill: "#f43f5e", strokeWidth: 0 }} activeDot={{ r: 6 }} />
                        )}
                      </LineChart>
                    ) : (
                      <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                        <XAxis
                          type="number" dataKey="ndvi" name="NDVI"
                          domain={[-1, 1]} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false}
                          label={{ value: 'NDVI (Vegetasi)', position: 'insideBottom', offset: -5, fontSize: 11, fill: '#64748b' }}
                        />
                        <YAxis
                          type="number" dataKey="lst" name="LST" unit="°C"
                          domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false}
                          label={{ value: 'LST (°C)', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }}
                        />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }} />
                        <Scatter name="Sampel Korelasi" data={scatterData} fill="#334155" opacity={0.6} line={false} shape="circle" />
                      </ScatterChart>
                    )}
                  </ResponsiveContainer>
                </div>

                <div className="flex justify-end gap-2 mt-3">
                  {tiffUrl && (
                    <a href={tiffUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold bg-slate-100 text-slate-600 px-3 py-2 rounded-md flex items-center gap-1.5 hover:bg-slate-200 transition-colors no-underline">
                      <Download size={14} /> GeoTIFF
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>

        <div className="relative flex-1 bg-slate-100">
          <MapWithNoSSR mapUrl={mapUrl} selectedGeoJson={selectedGeoJson} />
          {stats && <MapLegend type={layerType} min={parseFloat(visMin)} max={parseFloat(visMax)} />}
        </div>
      </main>
    </div>
  );
}