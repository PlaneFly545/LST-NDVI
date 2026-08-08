import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents, ImageOverlay } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet'; // Import Leaflet untuk akses geoJSON utils

// Catatan: wilayah terpilih ditandai lewat auto-zoom (MapFocus) dan nama wilayah
// di panel statistik — bukan lewat garis batas atau peredup di atas peta.
// Keduanya pernah dicoba dan justru menutupi visualisasi LST/NDVI-nya.

// Helper: Update layer gambar dari GEE (TileLayer) atau ImageOverlay lokal untuk demo
function MapLayer({ url }) {
  const map = useMap();
  if (!url) return null;

  const isStaticImage = url.endsWith('.png') || url.endsWith('.webp') || url.includes('/data/') || url.includes('/images/');
  if (isStaticImage) {
    // Koordinat batas (bounds) Bali untuk overlay gambar
    const baliBounds = [
      [-8.85, 114.43], // Sudut barat daya (South-West)
      [-8.06, 115.71]  // Sudut timur laut (North-East)
    ];
    return <ImageOverlay url={url} bounds={baliBounds} opacity={0.75} attribution="EcoMonitor Demo Data" />;
  }

  return <TileLayer url={url} attribution="Google Earth Engine" />;
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
//
// PENTING: hanya satu peta yang boleh memegang MapFocus. SyncCenter menulis
// viewState pada setiap event `move`, dan efek di bawah membalasnya dengan
// setView({ animate: false }) — yang membatalkan animasi flyToBounds yang
// sedang berjalan. Kalau kedua peta sama-sama ber-MapFocus, keduanya saling
// memotong animasi di tengah jalan dan kamera bisa berhenti di tempat yang
// bukan wilayah terpilih.
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
  const [splitPos, setSplitPos] = useState(50); // Persentase pembatas (0 - 100)
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);

  // Deteksi Mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Logika Drag & Drop Pembatas
  useEffect(() => {
    const handleMove = (e) => {
      if (!isDragging || !containerRef.current) return;
      
      // Ambil kordinat client tergantung event (Mouse atau Touch)
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      const rect = containerRef.current.getBoundingClientRect();
      
      let newPos;
      if (isMobile) {
        newPos = ((clientY - rect.top) / rect.height) * 100;
      } else {
        newPos = ((clientX - rect.left) / rect.width) * 100;
      }

      // Batasi agar tidak bablas keluar layar (minimal 5%, maksimal 95%)
      if (newPos < 5) newPos = 5;
      if (newPos > 95) newPos = 95;

      setSplitPos(newPos);
    };

    const handleUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', handleUp);
      // Mencegah scrolling layer background di HP saat sliding split
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
      document.body.style.overflow = '';
    };
  }, [isDragging, isMobile]);

  if (isSplit) {
    return (
      <div
        ref={containerRef}
        className={`flex w-full h-full relative bg-slate-100 ${isMobile ? 'flex-col' : 'flex-row'} ${isDragging ? (isMobile ? 'cursor-row-resize select-none' : 'cursor-col-resize select-none') : ''}`}
      >
        {/* Peta 1 (Kiri di Desktop, Atas di Mobile) */}
        <div style={isMobile ? { height: `${splitPos}%`, width: '100%' } : { width: `${splitPos}%`, height: '100%' }} className={`relative z-10 border-slate-800 ${isMobile ? 'border-b-[3px]' : 'border-r-[3px]'}`}>
          <MapContainer center={viewState.center} zoom={viewState.zoom} style={{ height: "100%", width: "100%" }} zoomControl={false}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />
            {selectedGeoJson && <MapFocus geoJson={selectedGeoJson} />}
            {mapUrl && <MapLayer url={mapUrl} />}
            <SyncCenter viewState={viewState} setViewState={setViewState} />
          </MapContainer>
          <div className="absolute top-4 left-4 z-[1000] bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-md text-xs font-bold text-slate-800 shadow-sm border border-slate-200 uppercase tracking-wider">
            {isMobile ? 'Atas (Periode 1)' : 'Periode 1'}
          </div>
        </div>

        {/* Peta 2 (Kanan di Desktop, Bawah di Mobile) */}
        <div style={isMobile ? { height: `${100 - splitPos}%`, width: '100%' } : { width: `${100 - splitPos}%`, height: '100%' }} className="relative">
          <MapContainer center={viewState.center} zoom={viewState.zoom} style={{ height: "100%", width: "100%" }} zoomControl={true}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />
            {/* Tanpa MapFocus di sini — fokus wilayah dipegang peta kiri, dan
                peta ini mengikutinya lewat SyncCenter. */}
            {mapUrlRight && <MapLayer url={mapUrlRight} />}
            <SyncCenter viewState={viewState} setViewState={setViewState} />
          </MapContainer>
          <div className={`absolute z-[1000] bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-md text-xs font-bold text-slate-800 shadow-sm border border-slate-200 uppercase tracking-wider ${isMobile ? 'bottom-4 right-4' : 'top-4 right-4'}`}>
            {isMobile ? 'Bawah (Periode 2)' : 'Periode 2'}
          </div>
        </div>

        {/* Ornamen Pembatas Tengah (Draggable Handle) */}
        <div
          className={`absolute z-[2000] bg-slate-800 rounded shadow-lg flex items-center justify-center hover:bg-slate-700 transition-colors 
            ${isMobile 
              ? 'cursor-row-resize h-8 w-12 left-1/2 -translate-x-1/2' 
              : 'cursor-col-resize w-8 h-12 top-1/2 -translate-y-1/2'
            }`}
          style={isMobile ? { top: `calc(${splitPos}% - 16px)` } : { left: `calc(${splitPos}% - 16px)` }}
          onMouseDown={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onTouchStart={(e) => {
             // For mobile drag
             e.stopPropagation(); // prevent map panning
             setIsDragging(true);
          }}
        >
          <div className={`flex pointer-events-none ${isMobile ? 'flex-col gap-[3px]' : 'gap-0.5'}`}>
            <div className={`${isMobile ? 'w-6 h-0.5' : 'w-0.5 h-5'} bg-slate-300 rounded-full`}></div>
            <div className={`${isMobile ? 'w-6 h-0.5' : 'w-0.5 h-5'} bg-slate-300 rounded-full`}></div>
            <div className={`${isMobile ? 'w-6 h-0.5' : 'w-0.5 h-5'} bg-slate-300 rounded-full`}></div>
          </div>
        </div>

        {/* Overlay tak terlihat saat drag agar interaksi mouse tidak tersangkut di dalam peta iframe */}
        {isDragging && <div className={`absolute inset-0 z-[1500] ${isMobile ? 'cursor-row-resize' : 'cursor-col-resize'}`}></div>}
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
      {mapUrl && <MapLayer url={mapUrl} />}
    </MapContainer>
  );
};

export default Map;