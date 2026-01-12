// components/Map.js
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Helper untuk update layer saat props berubah
function TileLayerUpdater({ url }) {
  const map = useMap();
  // Bisa tambah logika zoom ke area tertentu di sini
  return url ? <TileLayer url={url} attribution="Google Earth Engine" /> : null;
}

const Map = ({ mapUrl }) => {
  return (
    <MapContainer 
      center={[-8.409518, 115.188919]} // Koordinat Tengah Bali
      zoom={9} 
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors'
      />
      {/* Layer Hasil Analisis GEE */}
      {mapUrl && <TileLayerUpdater url={mapUrl} />}
    </MapContainer>
  );
};

export default Map;