"use client";

import { useEffect, useRef } from "react";

type Tech = {
  id: string;
  name: string;
  last: { latitude: number; longitude: number; freshness: string; batteryPercent: number; recordedAt: Date | string } | null;
  trail: Array<{ latitude: number; longitude: number }>;
};

type JobPin = {
  visitId: string;
  customerName: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  etaMinutes: number | null;
};

export function LiveMap({ techs, jobs }: { techs: Tech[]; jobs: JobPin[] }) {
  const node = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = node.current;
    if (!host) return;
    let map: { remove: () => void } | null = null;
    let cancelled = false;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => {
      if (cancelled || !host) return;
      const L = (window as unknown as { L: LeafletNamespace }).L;
      const first = techs.find((tech) => tech.last) ?? null;
      const center = first?.last ? [first.last.latitude, first.last.longitude] : [27.6, -81.5];
      const instance = L.map(host).setView(center as [number, number], 7);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
      }).addTo(instance);
      for (const tech of techs) {
        if (tech.trail.length > 1) {
          L.polyline(tech.trail.map((point) => [point.latitude, point.longitude]), { color: "#1e4c44", weight: 3 }).addTo(instance);
        }
        if (tech.last) {
          L.circleMarker([tech.last.latitude, tech.last.longitude], {
            radius: 9,
            color: "#1e4c44",
            fillColor: "#2f6d62",
            fillOpacity: 0.95,
          })
            .bindPopup(`${tech.name} · ${tech.last.freshness} · battery ${tech.last.batteryPercent}%`)
            .addTo(instance);
        }
      }
      const pins = jobs.filter((job): job is JobPin & { latitude: number; longitude: number } => job.latitude !== null && job.longitude !== null);
      for (const job of pins) {
        const eta = job.etaMinutes ? ` · ETA ${job.etaMinutes} min` : "";
        L.circleMarker([job.latitude, job.longitude], {
          radius: 7,
          color: "#8a4b2f",
          fillColor: "#c4784a",
          fillOpacity: 0.95,
        })
          .bindPopup(`${job.customerName} · ${job.status.replaceAll("_", " ")}${eta}`)
          .addTo(instance);
      }
      const bounds = [
        ...techs.flatMap((tech) => tech.trail.map((point) => [point.latitude, point.longitude] as [number, number])),
        ...pins.map((job) => [job.latitude, job.longitude] as [number, number]),
      ];
      if (bounds.length) instance.fitBounds(bounds, { padding: [24, 24] });
      map = instance;
    };
    document.body.appendChild(script);
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [techs, jobs]);

  return <div ref={node} className="h-[32rem] w-full rounded-lg border border-line" />;
}

type LeafletNamespace = {
  map: (el: HTMLElement) => {
    setView: (center: [number, number], zoom: number) => LeafletMap;
    remove: () => void;
    fitBounds: (bounds: Array<[number, number]>, options: { padding: [number, number] }) => void;
  };
  tileLayer: (url: string, options: { attribution: string; maxZoom: number }) => { addTo: (map: LeafletMap) => void };
  polyline: (points: Array<[number, number]>, options: { color: string; weight: number }) => { addTo: (map: LeafletMap) => void };
  circleMarker: (center: [number, number], options: { radius: number; color: string; fillColor: string; fillOpacity: number }) => {
    bindPopup: (text: string) => { addTo: (map: LeafletMap) => void };
  };
};

type LeafletMap = {
  setView: (center: [number, number], zoom: number) => LeafletMap;
  remove: () => void;
  fitBounds: (bounds: Array<[number, number]>, options: { padding: [number, number] }) => void;
};
