// components/Map.js
import { useEffect } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
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

const Map = ({ mapUrl, selectedGeoJson }) => {
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