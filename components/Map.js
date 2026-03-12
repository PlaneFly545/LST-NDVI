import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet'; // Import Leaflet untuk akses geoJSON utils

// Helper: Update layer gambar dari GEE
function TileLayerUpdater({ url }) {
  const map = useMap();
  return url ? <TileLayer url={url} attribution="Google Earth Engine" /> : null;
}

// Helper: Auto-Focus kamera ke wilayah terpilih
function MapFocus({ geoJson }) {
  const map = useMap();

  useEffect(() => {
    if (geoJson) {
      // Buat layer Leaflet dari GeoJSON untuk hitung batas (bounds)
      const layer = L.geoJSON(geoJson);
      const bounds = layer.getBounds();

      // Terbang ke area tersebut dengan animasi halus
      if (bounds.isValid()) {
        map.flyToBounds(bounds, {
          padding: [50, 50],
          duration: 1.5 // Durasi animasi terbang (detik)
        });
      }
    }
  }, [geoJson, map]);

  return null;
}

// Helper: Sinkronisasi kamera antara dua peta untuk Split Screen
function SyncCenter({ viewState, setViewState }) {
  const map = useMapEvents({
    move: () => {
      setViewState({ center: map.getCenter(), zoom: map.getZoom() });
    }
  });

  useEffect(() => {
    if (viewState) {
      const currentCenter = map.getCenter();
      const currentZoom = map.getZoom();
      // Mencegah infinite loop sinkronisasi
      if (currentCenter.distanceTo(viewState.center) > 5 || currentZoom !== viewState.zoom) {
        map.setView(viewState.center, viewState.zoom, { animate: false });
      }
    }
  }, [viewState, map]);

  return null;
}

const Map = ({ mapUrl, mapUrlRight, isSplit, selectedGeoJson }) => {
  const [viewState, setViewState] = useState({ center: [-8.409518, 115.188919], zoom: 9 });

  // State untuk Draggable Split Screen
  const [splitPos, setSplitPos] = useState(50); // Persentase lebar pembatas (0 - 100)
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);

  // Logika Drag & Drop Pembatas
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let newPos = ((e.clientX - rect.left) / rect.width) * 100;

      // Batasi agar tidak bablas keluar layar (minimal 5%, maksimal 95%)
      if (newPos < 5) newPos = 5;
      if (newPos > 95) newPos = 95;

      setSplitPos(newPos);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  if (isSplit) {
    return (
      <div
        ref={containerRef}
        className={`flex w-full h-full relative bg-slate-100 ${isDragging ? 'cursor-col-resize select-none' : ''}`}
      >
        {/* Peta Kiri */}
        <div style={{ width: `${splitPos}%` }} className="h-full relative z-10 border-r-[3px] border-slate-800">
          <MapContainer center={viewState.center} zoom={viewState.zoom} style={{ height: "100%", width: "100%" }} zoomControl={false}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />
            {selectedGeoJson && <MapFocus geoJson={selectedGeoJson} />}
            {mapUrl && <TileLayerUpdater url={mapUrl} />}
            <SyncCenter viewState={viewState} setViewState={setViewState} />
          </MapContainer>
          <div className="absolute top-4 left-4 z-[1000] bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-md text-xs font-bold text-slate-800 shadow-sm border border-slate-200 uppercase tracking-wider">
            Periode Kiri
          </div>
        </div>

        {/* Peta Kanan */}
        <div style={{ width: `${100 - splitPos}%` }} className="h-full relative">
          <MapContainer center={viewState.center} zoom={viewState.zoom} style={{ height: "100%", width: "100%" }} zoomControl={true}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />
            {selectedGeoJson && <MapFocus geoJson={selectedGeoJson} />}
            {mapUrlRight && <TileLayerUpdater url={mapUrlRight} />}
            <SyncCenter viewState={viewState} setViewState={setViewState} />
          </MapContainer>
          <div className="absolute top-4 right-4 z-[1000] bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-md text-xs font-bold text-slate-800 shadow-sm border border-slate-200 uppercase tracking-wider">
            Periode Kanan
          </div>
        </div>

        {/* Ornamen Pembatas Tengah (Draggable Handle) */}
        <div
          className="absolute top-1/2 -translate-y-1/2 z-[2000] w-8 h-12 bg-slate-800 rounded shadow-lg flex items-center justify-center cursor-col-resize hover:bg-slate-700 transition-colors"
          style={{ left: `calc(${splitPos}% - 16px)` }} // 16px adalah setengah dari w-8 (32px)
          onMouseDown={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
        >
          <div className="flex gap-0.5 pointer-events-none">
            <div className="w-0.5 h-5 bg-slate-300 rounded-full"></div>
            <div className="w-0.5 h-5 bg-slate-300 rounded-full"></div>
            <div className="w-0.5 h-5 bg-slate-300 rounded-full"></div>
          </div>
        </div>

        {/* Overlay tak terlihat saat drag agar interaksi mouse tidak tersangkut di dalam peta iframe */}
        {isDragging && <div className="absolute inset-0 z-[1500] cursor-col-resize"></div>}
      </div>
    );
  }

  // Render Peta Tunggal Default
  return (
    <MapContainer
      center={[-8.409518, 115.188919]} // Default Bali
      zoom={9}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors'
      />

      {/* Logic Auto Focus */}
      {selectedGeoJson && <MapFocus geoJson={selectedGeoJson} />}

      {/* Layer GEE */}
      {mapUrl && <TileLayerUpdater url={mapUrl} />}
    </MapContainer>
  );
};

export default Map;