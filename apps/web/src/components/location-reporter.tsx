"use client";

import { LOCATION_NOTICE } from "@adel/core/location-notice";
import { useEffect, useState } from "react";

const TOKEN_KEY = "adel_device_token";

export function LocationReporter() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!token || !("geolocation" in navigator)) return;
    let watch = 0;
    const send = (position: GeolocationPosition) => {
      if (document.visibilityState !== "visible") return;
      const battery = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
      void (battery.getBattery?.() ?? Promise.resolve({ level: 1 })).then(async (power) => {
        await fetch("/api/v1/locations", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            points: [
              {
                recordedAt: new Date(position.timestamp).toISOString(),
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracyMeters: position.coords.accuracy,
                batteryPercent: Math.round((power?.level ?? 1) * 100),
              },
            ],
          }),
        });
      });
    };
    const start = () => {
      if (document.visibilityState !== "visible") return;
      watch = navigator.geolocation.watchPosition(send, () => setMessage("Location permission is off. You can still work the visit."), {
        enableHighAccuracy: true,
        maximumAge: 15000,
      });
    };
    const stop = () => {
      if (watch) navigator.geolocation.clearWatch(watch);
      watch = 0;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token]);

  async function acknowledge() {
    const response = await fetch("/api/v1/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Phone browser", acknowledge: true }),
    });
    const payload = (await response.json()) as { secret?: string; message?: string };
    if (!response.ok || !payload.secret) {
      setMessage(payload.message || "Could not save the acknowledgment.");
      return;
    }
    localStorage.setItem(TOKEN_KEY, payload.secret);
    setToken(payload.secret);
    setMessage("");
  }

  if (!ready) return null;
  return (
    <section className="mb-4 space-y-2 rounded-lg border border-line bg-card p-3 text-sm">
      <p className="font-semibold">{LOCATION_NOTICE.title}</p>
      <p>{LOCATION_NOTICE.body}</p>
      <p className="text-xs font-semibold">{LOCATION_NOTICE.counselLabel}</p>
      <p className="text-xs text-muted">Location reports only while this screen is in use.</p>
      {token ? null : (
        <button className="rounded-md bg-pine px-3 py-2 text-sm font-semibold text-white" type="button" onClick={() => void acknowledge()}>
          I acknowledge this notice
        </button>
      )}
      {message ? <p className="text-xs text-muted">{message}</p> : null}
    </section>
  );
}
