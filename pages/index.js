import { useState, useEffect } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { 
  Map as MapIcon, Calendar, Layers, BarChart3, 
  Leaf, ThermometerSun, Activity, Menu, Download, 
  Sliders, ChevronDown, FileDown, AlertTriangle,
  ScatterChart as ScatterIcon, TrendingUp, Search, Eye, MapPin, CloudSun
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis 
} from 'recharts';
import { Toaster, toast } from 'sonner';
import { saveAs } from 'file-saver';
import baliData from '../public/data/bali_kabkota.json';

const MapWithNoSSR = dynamic(() => import('../components/Map'), { 
  ssr: false, 
  loading: () => (
    <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-slate-50">
      <div className="w-10 h-10 mb-4 border-4 rounded-full border-slate-200 border-t-bmkg-500 animate-spin"></div>
      <p className="text-sm font-medium">Menghubungkan ke Satelit...</p>
    </div>
  )
});

const MapLegend = ({ type, min, max }) => {
  const gradient = type === 'ndvi' 
    ? 'linear-gradient(to right, red, yellow, green)'
    : 'linear-gradient(to right, #040274, #abd9e9, #ffffbf, #d7191c, #7a0403)';
  
  return (
    <div className="absolute bottom-6 right-6 z-1000 bg-white/95 backdrop-blur-sm p-4 rounded-xl shadow-2xl border border-slate-200 w-72">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-slate-700 uppercase">
          {type === 'ndvi' ? 'Indeks Vegetasi (NDVI)' : 'Suhu Permukaan (LST)'}
        </span>
        <span className="px-2 py-0.5 text-[10px] bg-slate-100 rounded text-slate-500">Landsat 8/9</span>
      </div>
      <div className="w-full h-3 mb-2 rounded-full ring-1 ring-slate-200" style={{ background: gradient }}></div>
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
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(today.getFullYear() - 1);

  const [startDate, setStartDate] = useState(oneYearAgo);
  const [endDate, setEndDate] = useState(today);
  const [region, setRegion] = useState('DENPASAR');
  const [layerType, setLayerType] = useState('lst');
  
  const [selectedGeoJson, setSelectedGeoJson] = useState(null);

  const [cloudCover, setCloudCover] = useState(30); 
  const [debouncedCloudCover, setDebouncedCloudCover] = useState(30); 

  const [reducer, setReducer] = useState('Median');
  const [visMin, setVisMin] = useState(20);
  const [visMax, setVisMax] = useState(45);
  const [threshold, setThreshold] = useState(30); 
  const [showAdvanced, setShowAdvanced] = useState(false); 

  const [mapUrl, setMapUrl] = useState(null);
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [scatterData, setScatterData] = useState([]); 
  const [tiffUrl, setTiffUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  
  const [analysisMode, setAnalysisMode] = useState('realtime'); 
  const [chartMode, setChartMode] = useState('trend'); 

  const regions = baliData.features.map(f => f.properties.nm_kabkota).sort();

  // Debounce Slider
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
    }
  };

  useEffect(() => {
    if (analysisMode === 'realtime') {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisMode, layerType, region, debouncedCloudCover]); 

  const handleRegionChange = (e) => {
    const newRegion = e.target.value;
    setRegion(newRegion);
    const feature = baliData.features.find(f => f.properties.nm_kabkota === newRegion);
    if (feature) {
      setSelectedGeoJson(feature);
    }
  };
  
  useEffect(() => {
      const feature = baliData.features.find(f => f.properties.nm_kabkota === 'DENPASAR');
      if (feature) setSelectedGeoJson(feature);
  }, []);

  const handleTypeChange = (type) => {
    setLayerType(type);
    if (type === 'ndvi') {
      setVisMin(-1); setVisMax(1);
      setThreshold(0.5);
    } else {
      setVisMin(20); setVisMax(45);
      setThreshold(32);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    toast.dismiss(); 
    setTiffUrl(null);
    
    const loadingMsg = analysisMode === 'realtime' 
      ? `Mencari data terbaru (${region})...` 
      : 'Mengolah data historis...';
      
    const toastId = toast.loading(loadingMsg);
    
    try {
      const params = new URLSearchParams({
        mode: analysisMode,
        type: layerType,
        region_name: region,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        cloud_cover: debouncedCloudCover,
        reducer: reducer,
        vis_min: visMin,
        vis_max: visMax,
        threshold: threshold
      });

      const res = await fetch(`/api/map-layer?${params}`);
      if (!res.ok) throw new Error("Gagal mengambil data Satelit");
      
      const data = await res.json();
      setMapUrl(data.map.urlFormat);
      setStats(data.stats);
      setChartData(data.chart);
      setScatterData(data.scatter); 
      if (data.downloadUrl) setTiffUrl(data.downloadUrl);

      if (analysisMode === 'realtime' && !data.stats.image_date) {
        toast.warning('Data tidak ditemukan. Coba perbesar toleransi awan.', { id: toastId });
      } else {
        toast.success(analysisMode === 'realtime' ? 'Data Berhasil Dimuat' : 'Analisis Selesai!', { id: toastId });
      }

    } catch (error) {
      console.error(error);
      toast.error('Gagal memproses data.', { id: toastId });
    }
    setLoading(false);
  };

  const handleProcessHistory = (e) => {
    if (e) e.preventDefault();
    fetchData();
  };

  const handleDownloadCSV = () => {
    if (!chartData.length) return toast.error("Tidak ada data.");
    const header = "Tanggal,Nilai\n";
    const csvContent = chartData.map(r => `${r.date},${r.value}`).join("\n");
    saveAs(new Blob([header + csvContent], { type: "text/csv" }), `Landsat_${layerType}_${region}.csv`);
    toast.success("CSV berhasil diunduh");
  };

  const formatDateIndo = (date) => {
    return date.toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden font-sans bg-slate-50 text-slate-800">
      <Head><title>EcoMonitor Pro | Skripsi Dashboard</title></Head>
      <Toaster position="top-center" richColors />

      <nav className="flex items-center justify-between px-6 bg-white border-b shadow-sm h-16 border-slate-200 z-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 text-white rounded-lg bg-bmkg-700">
            <Activity size={24} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-lg font-bold leading-tight text-slate-800">EcoMonitor Pro</h1>
            <span className="text-xs text-slate-500">Spatio-Temporal Analysis Engine</span>
          </div>
        </div>
        <button type="button" onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-2 border rounded-md hover:bg-slate-50 cursor-pointer">
          <Menu size={20} className="text-slate-600" />
        </button>
      </nav>

      <main className="relative flex flex-1 overflow-hidden">
        <aside className={`flex flex-col bg-white transition-all duration-300 border-r border-slate-200 ${isSidebarOpen ? 'w-112.5' : 'w-0 border-none overflow-hidden'}`}>
          <div className="flex flex-col flex-1 p-5 overflow-y-auto gap-5">
            
            {/* MODE SWITCHER */}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2 mb-2"><Activity size={14}/> Mode Dashboard</label>
              <div className="flex bg-slate-100 p-1 rounded-lg shadow-inner">
                <button 
                  onClick={() => handleSwitchMode('realtime')}
                  className={`flex-1 py-2 text-xs font-bold rounded-md flex items-center justify-center gap-2 transition-all cursor-pointer ${analysisMode === 'realtime' ? 'bg-white text-bmkg-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Eye size={14} className={analysisMode === 'realtime' ? 'animate-pulse' : ''}/> Monitoring (NTR)
                </button>
                <button 
                  onClick={() => handleSwitchMode('history')}
                  className={`flex-1 py-2 text-xs font-bold rounded-md flex items-center justify-center gap-2 transition-all cursor-pointer ${analysisMode === 'history' ? 'bg-white text-bmkg-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Calendar size={14}/> Studi Historis
                </button>
              </div>
            </div>

            {/* PARAMETER & WILAYAH */}
            <div className="space-y-4">
               <div>
                <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2 mb-2"><Layers size={14}/> Parameter Pantauan</label>
                <div className="flex gap-2">
                  {['lst', 'ndvi'].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleTypeChange(type)}
                      className={`flex-1 p-3 rounded-lg border text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer
                        ${layerType === type ? 'bg-bmkg-50 border-bmkg-500 text-bmkg-700 ring-1 ring-bmkg-500' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                    >
                      {type === 'lst' ? <ThermometerSun size={16}/> : <Leaf size={16}/>}
                      {type === 'lst' ? 'Suhu (LST)' : 'Vegetasi'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 flex items-center gap-1"><MapPin size={10}/> Wilayah Studi</label>
                <div className="relative">
                  <select value={region} onChange={handleRegionChange} className="w-full p-2.5 text-sm bg-white border rounded-md border-slate-300 outline-none focus:border-bmkg-500 appearance-none cursor-pointer">
                    {regions.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-3 text-slate-400 pointer-events-none"/>
                </div>
              </div>
              
              {/* SLIDER TOLERANSI AWAN (MUNCUL DI KEDUA MODE SEKARANG) */}
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-slate-500 font-medium flex items-center gap-1"><CloudSun size={12}/> Toleransi Awan</span>
                  <span className="font-bold text-bmkg-700">{cloudCover}%</span>
                </div>
                <input type="range" min="0" max="100" value={cloudCover} onChange={(e) => setCloudCover(e.target.value)} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-bmkg-600"/>
              </div>
            </div>

            {/* KONTEN HISTORIS */}
            {analysisMode === 'history' && (
              <div className="animate-in fade-in duration-300 space-y-4 border-t border-slate-100 pt-4">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1">Mulai</label>
                    <DatePicker selected={startDate} onChange={setStartDate} className="w-full p-2 text-sm border rounded-md border-slate-300 outline-none focus:border-bmkg-500 cursor-pointer" dateFormat="dd/MM/yyyy"/>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1">Selesai</label>
                    <DatePicker selected={endDate} onChange={setEndDate} className="w-full p-2 text-sm border rounded-md border-slate-300 outline-none focus:border-bmkg-500 cursor-pointer" dateFormat="dd/MM/yyyy" minDate={startDate}/>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-lg bg-slate-50/50">
                  <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="w-full flex items-center justify-between p-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2"><Sliders size={14}/> Konfigurasi Lanjut</div>
                    <span className={`transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`}><ChevronDown size={14}/></span>
                  </button>
                  
                  {showAdvanced && (
                    <div className="p-4 bg-white space-y-4 border-t border-slate-200">
                      <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                        <label className="flex items-center gap-2 text-[10px] font-bold text-red-600 uppercase mb-2">
                          <AlertTriangle size={12}/> Ambang Batas
                        </label>
                        <div className="flex items-center gap-2">
                          <input type="number" step="0.1" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-full p-2 text-sm border border-red-200 rounded focus:border-red-500 outline-none"/>
                          <span className="text-xs font-medium text-red-400 whitespace-nowrap">{layerType === 'lst' ? 'Derajat' : 'Index'}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <button 
                  type="button" 
                  onClick={handleProcessHistory} 
                  disabled={loading} 
                  className="w-full py-3 text-sm font-bold text-white shadow-lg rounded-xl bg-bmkg-700 hover:bg-bmkg-800 disabled:bg-slate-300 flex justify-center items-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
                >
                  {loading ? <span className="animate-spin">⟳</span> : <Activity size={18}/>} Analisis Data Historis
                </button>
              </div>
            )}
            
            {/* Info Realtime */}
            {analysisMode === 'realtime' && (
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 flex gap-2 items-start mt-2">
                <Eye size={16} className="shrink-0 mt-0.5"/>
                <p>Menampilkan mosaik <b>data terbaru</b> yang tersedia untuk <b>{region}</b> (gap-filling aktif).</p>
              </div>
            )}

            {/* HASIL */}
            {stats && (
              <div className="mt-2 pt-6 border-t border-slate-200 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className={`mb-3 p-3 border rounded-lg flex items-center justify-between shadow-sm ${analysisMode === 'realtime' ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div>
                    <span className={`text-[10px] font-bold uppercase ${analysisMode === 'realtime' ? 'text-blue-600' : 'text-slate-500'}`}>
                      {analysisMode === 'realtime' ? 'Tanggal Data Utama' : 'Periode Analisis'}
                    </span>
                    <div className={`text-sm font-bold ${analysisMode === 'realtime' ? 'text-blue-800' : 'text-slate-700'}`}>
                      {analysisMode === 'realtime' ? (
                        stats.image_date || 'Data Tidak Ditemukan'
                      ) : (
                        `${formatDateIndo(startDate)} - ${formatDateIndo(endDate)}`
                      )}
                    </div>
                  </div>
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center ${analysisMode === 'realtime' ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-500'}`}>
                    <Calendar size={16}/>
                  </div>
                </div>

                {/* Score Card Luas Dampak */}
                <div className="mb-4 p-4 bg-linear-to-br from-red-50 to-white border border-red-100 rounded-xl shadow-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xs font-bold text-red-500 uppercase tracking-wide flex items-center gap-1">
                        <AlertTriangle size={12}/> Luas Terdampak ({'>'} {stats.threshold})
                      </h4>
                      <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-2xl font-extrabold text-slate-800">
                          {stats.impact_area_ha ? stats.impact_area_ha.toLocaleString('id-ID', {maximumFractionDigits: 1}) : 0}
                        </span>
                        <span className="text-sm font-medium text-slate-500">Hektar</span>
                      </div>
                    </div>
                    <div className="text-right">
                       <span className="text-[10px] text-slate-400 bg-white px-2 py-1 rounded border border-slate-100">
                        {stats.region}
                       </span>
                    </div>
                  </div>
                </div>

                {/* TAB GRAFIK */}
                <div className="flex items-center gap-2 mb-3 bg-slate-100 p-1 rounded-lg">
                  <button 
                    type="button"
                    onClick={() => setChartMode('trend')}
                    className={`flex-1 text-xs py-1.5 px-3 rounded-md font-medium transition-all flex items-center justify-center gap-1 ${chartMode === 'trend' ? 'bg-white text-bmkg-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <TrendingUp size={14}/> Tren Waktu
                  </button>
                  <button 
                    type="button"
                    onClick={() => setChartMode('scatter')}
                    className={`flex-1 text-xs py-1.5 px-3 rounded-md font-medium transition-all flex items-center justify-center gap-1 ${chartMode === 'scatter' ? 'bg-white text-bmkg-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <ScatterIcon size={14}/> Korelasi LST-NDVI
                  </button>
                </div>

                {/* CHART AREA */}
                <div className="h-56 w-full bg-white rounded-lg border border-slate-100 p-2 relative">
                  <ResponsiveContainer>
                    {chartMode === 'trend' ? (
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                        <XAxis dataKey="date" hide/>
                        <YAxis domain={['auto', 'auto']} tick={{fontSize: 9}} width={25}/>
                        <Tooltip contentStyle={{fontSize: '12px', borderRadius: '8px'}} itemStyle={{color: '#0f766e'}}/>
                        <Line type="monotone" dataKey="value" stroke="#0f766e" strokeWidth={2} dot={false}/>
                      </LineChart>
                    ) : (
                      <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis 
                          type="number" dataKey="ndvi" name="NDVI" 
                          domain={[-1, 1]} tick={{fontSize: 9}} 
                          label={{ value: 'NDVI (Vegetasi)', position: 'insideBottom', offset: -5, fontSize: 10, fill: '#64748b' }} 
                        />
                        <YAxis 
                          type="number" dataKey="lst" name="LST" unit="°C" 
                          domain={['auto', 'auto']} tick={{fontSize: 9}} width={30}
                          label={{ value: 'LST (°C)', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#64748b' }}
                        />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{fontSize: '12px', borderRadius: '8px'}}/>
                        <Scatter name="Sampel Korelasi" data={scatterData} fill="#0f766e" opacity={0.6} line={false} shape="circle" />
                      </ScatterChart>
                    )}
                  </ResponsiveContainer>
                </div>
                
                <div className="flex justify-end gap-2 mt-3">
                   <button type="button" onClick={handleDownloadCSV} className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded flex items-center gap-1 hover:bg-slate-200 cursor-pointer border border-slate-200">
                    <Download size={12}/> Unduh CSV
                  </button>
                  {tiffUrl && (
                    <a href={tiffUrl} target="_blank" rel="noreferrer" className="text-xs bg-bmkg-700 text-white px-3 py-1.5 rounded flex items-center gap-1 hover:bg-bmkg-800 cursor-pointer no-underline">
                      <FileDown size={12}/> Unduh GeoTIFF
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>
        
        <div className="relative flex-1 bg-slate-200">
          <MapWithNoSSR mapUrl={mapUrl} selectedGeoJson={selectedGeoJson} />
          {stats && <MapLegend type={layerType} min={parseFloat(visMin)} max={parseFloat(visMax)} />}
        </div>
      </main>
    </div>
  );
}