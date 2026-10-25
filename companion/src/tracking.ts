import * as Battery from "expo-battery";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

export const LOCATION_TASK = "adel-field-location";
export const REGION_TASK = "adel-field-regions";

type Point = {
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  batteryPercent: number;
};

type Pending = {
  baseUrl: string;
  deviceToken: string;
  points: Point[];
};

let pending: Pending | null = null;

async function batteryPercent() {
  const level = await Battery.getBatteryLevelAsync();
  if (level < 0) return 100;
  return Math.max(0, Math.min(100, Math.round(level * 100)));
}

export async function postPoints(baseUrl: string, deviceToken: string, points: Point[]) {
  if (!points.length) return;
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/locations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deviceToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ points }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Location ingest failed (${response.status}).`);
  }
}

async function enqueue(fixes: Array<{ timestamp: number; coords: { latitude: number; longitude: number; accuracy: number | null } }>) {
  if (!pending) return;
  const battery = await batteryPercent();
  const points = fixes
    .filter((fix) => fix.coords.accuracy != null)
    .map((fix) => ({
      recordedAt: new Date(fix.timestamp).toISOString(),
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracyMeters: fix.coords.accuracy ?? 0,
      batteryPercent: battery,
    }));
  pending.points.push(...points);
  const batch = pending.points.splice(0, 100);
  if (!batch.length) return;
  try {
    await postPoints(pending.baseUrl, pending.deviceToken, batch);
  } catch {
    pending.points.unshift(...batch);
  }
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !pending) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
  await enqueue(locations);
});

TaskManager.defineTask(REGION_TASK, async ({ data, error }) => {
  if (error || !pending) return;
  const event = data as { region?: { latitude: number; longitude: number } } | undefined;
  if (!event?.region) return;
  await enqueue([
    {
      timestamp: Date.now(),
      coords: {
        latitude: event.region.latitude,
        longitude: event.region.longitude,
        accuracy: 50,
      },
    },
  ]);
});

export async function startTracking(baseUrl: string, deviceToken: string) {
  const current = await Location.getBackgroundPermissionsAsync();
  if (current.status !== "granted") {
    const asked = await Location.requestBackgroundPermissionsAsync();
    if (asked.status !== "granted") {
      throw new Error("Always location is required on this company phone.");
    }
  }
  pending = { baseUrl, deviceToken, points: [] };
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: true,
    distanceInterval: 50,
    deferredUpdatesInterval: 60_000,
    deferredUpdatesDistance: 50,
    foregroundService: {
      notificationTitle: "Adel Field location",
      notificationBody: "Reporting during company tracking hours.",
      notificationColor: "#1e4c44",
    },
  });
}

export async function watchRegions(regions: Array<{ identifier: string; latitude: number; longitude: number; radius: number }>) {
  const started = await Location.hasStartedGeofencingAsync(REGION_TASK);
  if (started) await Location.stopGeofencingAsync(REGION_TASK);
  if (!regions.length) return;
  await Location.startGeofencingAsync(
    REGION_TASK,
    regions.map((region) => ({
      identifier: region.identifier,
      latitude: region.latitude,
      longitude: region.longitude,
      radius: region.radius,
      notifyOnEnter: true,
      notifyOnExit: true,
    })),
  );
}

export async function stopTracking() {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  const regions = await Location.hasStartedGeofencingAsync(REGION_TASK);
  if (regions) await Location.stopGeofencingAsync(REGION_TASK);
  pending = null;
}
