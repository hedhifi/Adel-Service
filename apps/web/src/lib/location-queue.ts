export type QueuedFix = {
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  batteryPercent: number;
};

export function enqueueFix(queue: QueuedFix[], fix: QueuedFix, max = 200) {
  return [...queue, fix].slice(-max);
}

export function takeFixes(queue: QueuedFix[], limit = 100) {
  return { batch: queue.slice(0, limit), rest: queue.slice(limit) };
}

export function readLocationQueue(raw: string | null): QueuedFix[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is QueuedFix => {
      if (!item || typeof item !== "object") return false;
      const point = item as Partial<QueuedFix>;
      return typeof point.recordedAt === "string" && typeof point.latitude === "number" && typeof point.longitude === "number";
    });
  } catch {
    return [];
  }
}
