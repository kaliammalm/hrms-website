# Field attendance & multi-site geofencing — setup

## Files
| File | What changed |
|---|---|
| `backend/scripts/add-field-attendance.js` | **New.** Migration: 6 tables, 8 columns, 6 sites, 7 field staff |
| `backend/fieldRoutes.js` | **New.** All controllers (check-in/out, sites, pings, visits, dwell summary, ad-hoc, close-day) |
| `backend/index.js` | Mounts `fieldRoutes` before `routes.js`; JSON body limit 4 MB (photos) |
| `backend/extraRoutes.js` | Header bell also shows stored alerts (ad-hoc, flagged, reviewed) |
| `backend/routes.js` | Login also returns `attendance_mode` (so the app knows who is field staff) |
| `frontend/src/field/FieldVisits.js` | **New.** Field staff screen: Arrived / Leaving, ad-hoc, auto-detection switch, today's timeline, time per site; plus the dashboard card |
| `frontend/src/field/AdhocVisitModal.js` | **New.** Ad-hoc form: current location or map pin, reason, live camera photo |
| `frontend/src/field/PinMap.js` | **New.** Small OpenStreetMap pin picker (no extra npm package) |
| `frontend/src/field/FieldTracking.js` | **New.** Management report: on site now, time per employee / site, day drill-down, ad-hoc review |
| `frontend/src/field/fieldApi.js` | **New.** API, GPS and photo helpers |
| `frontend/src/styles/field.css` | **New.** Styles for the screens above |
| `frontend/src/MDDashboard.js` | Only MD skips the location check (CEOs now send GPS); sends GPS accuracy; mounts the new screens |
| `frontend/src/Sidebar.js`, `access.js` | Menu: "Field Visits" for field staff, "Field Tracking" for MD / CEO / HR |
| `frontend/scripts/android-permissions.js` | Adds the CAMERA permission for the live photo |

## Run order
```bash
cd backend
node scripts/add-field-attendance.js           # 1. preview – changes nothing
node scripts/add-field-attendance.js --apply   # 2. apply on your local MySQL
node index.js                                   # 3. test locally
```
On Aiven (production), run the same two commands with the Aiven values set (PowerShell):
```powershell
$env:DB_HOST="<aiven host>"; $env:DB_PORT="<port>"; $env:DB_USER="avnadmin"; $env:DB_PASSWORD="<password>"; $env:DB_NAME="defaultdb"; $env:DB_SSL="true"
node scripts/add-field-attendance.js
node scripts/add-field-attendance.js --apply
```
Then push `backend/` to the `hrms-backend` repo → Render redeploys.

Safe to re-run: it only creates what is missing and updates sites by code.
Until the migration runs, the server keeps using the old check-in code.

## Phone app (after the backend is live)
```powershell
cd frontend
node scripts/android-permissions.js   # adds CAMERA (safe to re-run)
npm run android:build
npm run android:open                  # Build → Build APK(s)
```
Field staff must sign out and in once (or just reopen the app) so the "Field Visits" menu appears.
First use asks for Location and Camera permission: both must be allowed.

## Optional Render environment variables
| Variable | Purpose |
|---|---|
| `CRON_KEY` | Secret for `POST /api/field/close-day` (call it at 23:55 IST from cron-job.org with header `X-Cron-Key`). Optional: visits also close automatically next time anyone opens field data. |
| `FIELD_SITE_ALERTS=true` | Bell alert to MD / CEO on every site entry and exit (off by default: noisy) |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT` | Store ad-hoc photos in S3 / Cloudflare R2 instead of the database (also `npm i @aws-sdk/client-s3`) |

## Rules
- Office staff: Shared Office only (50 m). Field staff (7): office or any of the 5 sites (200 m).
- MD / group access: no location check. Approved OD / WFH: no location check. CEOs: normal check.
- GPS worse than ±100 m or a mock-location app → rejected.
- Bayfront / Bay Royale overlap → nearest site centre wins; an open visit keeps its site until 250 m away.
- Automatic entry: 2 good GPS points in a row inside a site. Exit: 3 minutes beyond radius + 50 m, timed from the first outside point.
- No GPS for 30 min on an automatic visit → closed at the last point. Anything still open → closed at 23:59:59.
- Ad-hoc: live GPS required; manual pin > 1 km from GPS, or photo older than 15 min → FLAGGED for review.

## Before go-live
- Venkatachalam and Sabapathi need real login emails (Sabapathi is `rrd-008@pending.local`).
- Automatic site detection works while the Field Visits screen is open (switch on that screen). With the app closed it needs a background-location plugin (phase 2); until then staff tap "Arrived at site" / "Leaving site".
- The map uses OpenStreetMap tiles (free, attribution shown). Fine for a small team; for heavy use switch to a paid tile provider.
