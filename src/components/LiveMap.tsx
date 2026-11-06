// src/components/LiveMap.tsx
//
// Leaflet map for live locations and trip paths. Leaflet touches window at
// import time, so it is imported dynamically inside useEffect only.

import { useEffect, useRef } from "react";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  color?: string;
  label?: string;
  popupHtml?: string;
}

interface LiveMapProps {
  points: MapPoint[];
  path?: MapPoint[];
  height?: number;
  className?: string;
  zoom?: number;
}

const DEFAULT_COLOR = "#27e08a";

function markerIcon(color: string) {
  return window.L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:9999px;background:${color};border:3px solid rgba(255,255,255,.85);box-shadow:0 0 12px ${color}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

export function LiveMap({ points, path, height = 360, className = "", zoom = 13 }: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<unknown>(null);
  const layerRef = useRef<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await import("leaflet/dist/leaflet.css");
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      window.L = L;
      const map = L.map(containerRef.current, {
        center: [30.3753, 69.3451],
        zoom,
        attributionControl: true,
        zoomControl: true,
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      // force a redraw once mounted
      setTimeout(() => map.invalidateSize(), 60);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        (mapRef.current as { remove: () => void }).remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
  }, [zoom]);

  useEffect(() => {
    const L = (window as unknown as { L?: typeof import("leaflet") }).L;
    const map = mapRef.current as import("leaflet").Map | null;
    const layer = layerRef.current as import("leaflet").LayerGroup | null;
    if (!L || !map || !layer) return;

    layer.clearLayers();

    if (path && path.length > 1) {
      const latlngs = path.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(latlngs, { color: DEFAULT_COLOR, weight: 3, opacity: 0.85 }).addTo(layer);
    }

    for (const p of points) {
      const marker = L.marker([p.lat, p.lng], { icon: markerIcon(p.color ?? DEFAULT_COLOR) });
      if (p.popupHtml) marker.bindPopup(p.popupHtml);
      else if (p.label) marker.bindTooltip(p.label, { permanent: false });
      marker.addTo(layer);
    }

    if (points.length === 1) {
      const first = points[0];
      if (first) map.setView([first.lat, first.lng], Math.max(map.getZoom(), zoom), { animate: true });
    } else if (points.length > 1) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds.pad(0.25));
    }
  }, [points, path, zoom]);

  return <div ref={containerRef} className={`z-0 overflow-hidden rounded-xl border border-border ${className}`} style={{ height }} />;
}
