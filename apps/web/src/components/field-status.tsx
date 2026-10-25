"use client";

import { useEffect, useState } from "react";

export function FieldStatus() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;
  return (
    <p className="mb-3 rounded-md border border-line bg-card px-3 py-2 text-sm" role="status">
      You're offline. Photos and location points stay on this phone and send when the signal comes back.
    </p>
  );
}
