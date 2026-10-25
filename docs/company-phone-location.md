# Company-phone location

Company-owned phones can report where a technician is during tracking hours. Tracking is disclosed. There is no covert mode. It starts only after the technician acknowledges a written notice.

**Company policy point for counsel review. This is not legal advice.**

The notice in the product uses that label. Alan should have counsel review the wording before it is treated as company policy.

## What the office sees

`/map` is a Leaflet map with OpenStreetMap tiles. It does not need a paid map key. Each active technician shows a last position and a freshness label (live under 5 minutes, recent under 30, otherwise stale), today's breadcrumb, and battery from the last point. Today's jobs are pins. An en-route visit shows a straight-line ETA.

## What the phone does today

The installable web app reports location only while the screen is in use and the page is visible. The screen says that. It is the interim until the native companion is installed on the company phone.

The companion in `companion/` is a real Expo app scaffold. It is not submitted to an app store, and it is not part of the pnpm workspace, so the web app's lockfile does not install Expo.

## Ingestion

Each phone uses a device token (`adeldev_…`), separate from a user API token. `POST /api/v1/locations` accepts a batch of up to 100 points. Each point has a timestamp, latitude, longitude, accuracy in meters, and battery percent. The device must acknowledge the notice first (`notice_required` until it does).

Points outside tracking hours are skipped and not stored. Points older than the retention window are not stored. On each ingest, points older than the retention setting are deleted.

## Defaults

| Setting | Default |
| --- | --- |
| Tracking hours | 07:00–18:00 America/New_York, end exclusive |
| Retention | 14 days |
| Geofence radius | 150 meters |
| ETA | Straight-line distance at 30 mph. Not a routing API. |
| Missing-report reminder | On |
| Reminder grace | 120 seconds |

Office and admin change the hours, retention, reminder switch, and grace in Settings.

## Arrive and depart

When a stored point is inside 150 meters of one of that technician's visits for the day, the visit is marked arrived. If it was scheduled or en route, it becomes on site. When they leave that radius after an arrival, a departure is recorded. Departure does not complete the visit.

## Missing-report reminder

After a geofence departure, the server waits the grace period (default 2 minutes) so a GPS jitter does not send the note. If the technician re-enters that visit's geofence during the wait, the pending reminder is canceled.

When the wait ends, that visit is checked. If notes or photos are missing, and the visit is not completed or canceled, that technician gets one in-app notification: "You left <Client>. Add what you did and photos?" It links to that visit. The reminded flag is stored so it does not send again. Other visits are not mentioned.

If both notes and photos are already there, nothing is sent. Push is recorded as unavailable until a push provider exists. The same server rule applies to foreground web reporting and to the companion's background tracking.

## iOS companion

The companion asks for Always location, significant-change updates, and region monitoring around the day's sites. `UIBackgroundModes` includes `location`. Significant-change and region events are the battery-conscious path. Continuous GPS is not left on all day.

Apple delivers background location only when the permission is Always, Location Services are on, and the app has not been force-quit in some iOS versions. A significant-change wake is coarse (cell/Wi-Fi), so a 150 meter geofence can be late. Region monitoring is the sharper arrive/depart signal and is limited to a small number of regions.

Battery: significant-change and a handful of regions stay modest. A foreground-service style continuous watch would drain the phone and is not what this scaffold starts.

## Android companion

The companion uses a foreground service with a persistent notification while tracking is on, `ACCESS_BACKGROUND_LOCATION`, and a request to ignore battery optimizations. Android 10+ will not deliver background fixes without the background permission and the foreground service. Aggressive OEM battery savers can still delay alarms unless the exemption is granted and locked by MDM.

Battery: a foreground service that takes fixes on a few-minute interval, plus geofences, is the practical compromise. A one-second GPS watch is not used.

## MDM

Pre-grant and lock the permissions so a technician is not walked through the system prompts, and so the permission cannot be turned off on a company phone.

- Apple: Apple Business Manager, supervised devices, and a configuration profile (or an MDM restriction) that allows Always location for this app and prevents the user from revoking it.
- Android: Android Enterprise fully managed devices. Grant `ACCESS_FINE_LOCATION` and `ACCESS_BACKGROUND_LOCATION`, allow the foreground service, and set the battery-optimization exemption to ignored. Lock those so the work profile user cannot revoke them.

The companion is built for that managed-device case. It is not a personal-phone tracker.
