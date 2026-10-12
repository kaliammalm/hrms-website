/* ==========================================================================
   Field attendance & multi-site geofencing
   Mounted in index.js BEFORE routes.js, so the two attendance routes below
   replace the old ones. Until scripts/add-field-attendance.js has been run,
   those two hand over to the old code (next()) and /field/* answers 503.

   Attendance (replaces the old handlers)
     POST /attendance/mark              check in: Shared Office (50 m) or, for field staff, any site (200 m)
     PUT  /attendance/checkout/:id      check out; closes any open site / ad-hoc visit
   Sites
     GET  /field/sites                  active sites (the app needs them for distance hints)
     POST /field/sites                  add a site            (group MD / Admin)
     PUT  /field/sites/:id              edit or deactivate    (group MD / Admin)
   Field staff (users.attendance_mode = 'FIELD')
     GET  /field/status                 today: attendance, open visit, visits with dwell, ad-hoc visits
     POST /field/pings                  GPS points from the phone → automatic entry / exit detection
     POST /field/visits/enter           "I'm at the site" button (foreground fallback)
     POST /field/visits/exit            "Leaving site" button
     POST /field/adhoc                  ad-hoc visit: live GPS or manual pin, reason, live photo
     PATCH /field/adhoc/:id/end         ad-hoc visit finished
   Management (MD / group access: all; CEO / HR / Admin: own company)
     GET  /field/visits?date=&userId=   visits for one day (employees see their own)
     GET  /field/summary?from=&to=&companyId=   dwell time per employee per site
     GET  /field/adhoc?from=&to=&userId=&status=
     GET  /field/adhoc/:id/photo        photo bytes (fetch with the Bearer header, show as a blob URL)
     PATCH /field/adhoc/:id/review      { status: VERIFIED | FLAGGED, note }
     POST /field/close-day              end-of-day close (header X-Cron-Key = CRON_KEY, or management)

   Times: *_at columns are UTC 'YYYY-MM-DD HH:MM:SS'. visit_date / attendance.date are India dates.
   check_in / check_out keep their old display format (India time) so existing screens still work.
   ========================================================================== */
const express = require('express');

// ---- Tuning (see the technical plan) ----
const MAX_ACCURACY_M = 100;               // GPS fixes worse than this are stored but never decide anything
const EXIT_BUFFER_M = 50;                 // must be radius + 50 m away before an exit counts (stops GPS jitter exits)
const EXIT_CONFIRM_MS = 3 * 60 * 1000;    // ...for 3 minutes
const ENTRY_PAIR_MAX_GAP_MS = 10 * 60 * 1000; // two consecutive inside fixes, at most 10 min apart
const STALE_MS = 30 * 60 * 1000;          // automatic visit with no GPS for 30 min closes at its last inside fix
const PIN_FLAG_M = 1000;                  // manual pin this far from the phone's GPS → FLAGGED
const MAX_PHOTO_BYTES = 2.5 * 1024 * 1024;
const MAX_PINGS_PER_CALL = 50;
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

module.exports = function fieldRoutes(db, authenticate, getLocalDateTime, calculateDistance) {
  const router = express.Router();

  // ---------------------------------------------------------------- helpers
  const q = (sql, params = []) => new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(`Field attendance error (${req.method} ${req.originalUrl || req.url}):`, err);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  });

  const pad = (n) => String(n).padStart(2, '0');
  const utc = (ms = Date.now()) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  };
  const parseUtc = (s) => (s ? Date.parse(`${String(s).replace(' ', 'T').slice(0, 19)}Z`) : NaN);
  const IST_OFFSET_MS = 330 * 60 * 1000;
  const istDate = (ms = Date.now()) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
  const istClock = (ms, h12) => {
    const d = new Date(ms + IST_OFFSET_MS);
    const h = d.getUTCHours();
    const m = pad(d.getUTCMinutes());
    if (!h12) return `${pad(h)}:${m}`;
    return `${pad(h % 12 || 12)}:${m} ${h < 12 ? 'AM' : 'PM'}`;
  };
  // 23:59:59 India time on an India date, as a UTC timestamp
  const endOfIstDayMs = (date) => Date.parse(`${date}T23:59:59Z`) - IST_OFFSET_MS;
  const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));

  const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const validCoords = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  const metres = (aLat, aLng, bLat, bLng) => Math.round(calculateDistance(aLat, aLng, Number(bLat), Number(bLng)));
  const fmtDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
  const fmtDuration = (sec) => {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${pad(m)}m` : `${m}m`;
  };

  // Roles (same rules as routes.js / extraRoutes.js)
  const roleOf = (u) => String(u?.role || '').toUpperCase();
  const scopeOf = (u) => {
    const role = roleOf(u);
    const companyId = u?.company_id;
    const noCompany = !companyId || Number(companyId) === 0;
    if ((role.includes('MD') || role.includes('ADMIN')) && noCompany) return 'all';
    if (['MD', 'CEO', 'HR', 'ADMIN'].some((r) => role.includes(r)) && !noCompany) return Number(companyId);
    return null;
  };
  const canManageSites = (u) => scopeOf(u) === 'all' || roleOf(u).includes('ADMIN');
  const isFieldUser = (u) => String(u?.attendance_mode || '').toUpperCase() === 'FIELD';
  const homeCompany = (u) => u?.base_company_id ?? u?.company_id ?? null;
  const inScope = (viewer, employee) => {
    const scope = scopeOf(viewer);
    if (scope === 'all') return true;
    return scope !== null && Number(employee?.company_id) === scope;
  };

  // Has the migration been run? (checked once, then remembered)
  let schemaReady = false;
  // The employee-code column differs between databases (emp_code, employee_code, emp_id…); found once at start-up
  const CODE_COLUMNS = ['emp_code', 'employee_code', 'employee_id', 'emp_id', 'emp_no', 'employee_no', 'empid', 'staff_id', 'code', 'biometric_id'];
  let codeCol = null;
  const findCodeColumn = async () => {
    try {
      const cols = (await q('SHOW COLUMNS FROM users')).map((c) => c.Field);
      codeCol = CODE_COLUMNS.find((c) => cols.includes(c)) || null;
    } catch (e) { codeCol = null; }
  };
  /** SQL select piece that always yields an "emp_code" column, e.g. "u.`employee_id` AS emp_code" */
  const empCodeSql = (alias = 'u') => (codeCol ? `${alias}.\`${codeCol}\` AS emp_code` : 'NULL AS emp_code');
  const empCodeOf = (user) => (codeCol && user ? user[codeCol] ?? null : null);
  findCodeColumn(); // at start-up; ready() checks again

  const ready = async () => {
    if (schemaReady) return true;
    try {
      await q('SELECT id FROM sites LIMIT 1');
      await q('SELECT attendance_mode FROM users LIMIT 1');
      await findCodeColumn();
      schemaReady = true;
    } catch (e) { /* not yet */ }
    return schemaReady;
  };
  const needSchema = wrap(async (req, res, next) => {
    if (await ready()) return next();
    return res.status(503).json({ error: 'Field attendance is not set up yet. Run: node scripts/add-field-attendance.js --apply' });
  });

  // Sites, cached for a minute
  let siteCache = { at: 0, rows: [] };
  const loadSites = async (force) => {
    if (!force && Date.now() - siteCache.at < 60 * 1000) return siteCache.rows;
    const rows = await q("SELECT * FROM sites WHERE is_active = 1 AND site_type IN ('OFFICE', 'PROJECT') AND radius_m > 0 ORDER BY site_type, name");
    siteCache = { at: Date.now(), rows: rows.map((s) => ({ ...s, latitude: Number(s.latitude), longitude: Number(s.longitude), radius_m: Number(s.radius_m) })) };
    return siteCache.rows;
  };
  const siteById = async (id) => (await loadSites()).find((s) => Number(s.id) === Number(id))
    || (await q('SELECT * FROM sites WHERE id = ?', [id]))[0];

  // Office staff: their office only. Field staff: the office plus every project site.
  const allowedSites = (sites, user) => sites.filter((s) => (isFieldUser(user)
    ? true
    : s.site_type === 'OFFICE' && (s.company_id === null || s.company_id === undefined || Number(s.company_id) === 0 || Number(s.company_id) === Number(homeCompany(user)))));

  // Nearest site whose radius contains the point. Overlapping sites (Bayfront / Bay Royale are
  // ~200 m apart) go to the nearest centre; an open visit keeps its site while within radius + 50 m.
  const matchSite = (lat, lng, sites, stickySiteId) => {
    let best = null;
    let nearest = null;
    sites.forEach((s) => {
      const d = metres(lat, lng, s.latitude, s.longitude);
      if (!nearest || d < nearest.distance) nearest = { site: s, distance: d };
      if (d <= s.radius_m && (!best || d < best.distance)) best = { site: s, distance: d };
    });
    if (stickySiteId) {
      const sticky = sites.find((s) => Number(s.id) === Number(stickySiteId));
      if (sticky) {
        const d = metres(lat, lng, sticky.latitude, sticky.longitude);
        if (d <= sticky.radius_m + EXIT_BUFFER_M) return { site: sticky, distance: d, nearest };
      }
    }
    return best ? { ...best, nearest } : { site: null, distance: null, nearest };
  };

  // One request at a time per employee, so two phones / retries cannot open two visits
  const locks = new Map();
  const withUserLock = (userId, fn) => {
    const prev = locks.get(userId) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    const tail = run.catch(() => {});
    locks.set(userId, tail);
    tail.then(() => { if (locks.get(userId) === tail) locks.delete(userId); });
    return run;
  };

  const todaysAttendance = async (userId, date) => (await q(
    'SELECT * FROM attendance WHERE employee_id = ? AND date = ? ORDER BY id LIMIT 1', [userId, date]))[0];
  const isCheckedOut = (a) => !!a && (!!a.check_out || String(a.status || '').toLowerCase() === 'checked out');

  const insertAttendance = async ({ user, date, atMs, mode, site, lat, lng, accuracy, siteName }) => {
    const r = await q(`INSERT INTO attendance
        (employee_id, company_id, date, check_in, status, latitude, longitude, is_auto_marked, site_name, check_in_at, mode, site_id, accuracy_m)
        VALUES (?, ?, ?, ?, 'Checked In', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, homeCompany(user), date, istClock(atMs, true), Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null,
      mode === 'SITE' || mode === 'OFFICE' ? 1 : 0, siteName || site?.name || null, utc(atMs), mode, site?.id || null,
      Number.isFinite(accuracy) ? Math.round(accuracy) : null]);
    return r.insertId;
  };

  const openVisitOf = async (userId) => (await q(
    'SELECT * FROM site_visits WHERE user_id = ? AND exited_at IS NULL ORDER BY id DESC LIMIT 1', [userId]))[0];

  const openVisit = async ({ userId, site, atMs, lat, lng, accuracy, source }) => {
    const r = await q(`INSERT INTO site_visits
        (user_id, site_id, visit_date, entered_at, entry_lat, entry_lng, entry_accuracy_m, last_inside_at, entry_source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, site.id, istDate(atMs), utc(atMs), lat, lng, Number.isFinite(accuracy) ? Math.round(accuracy) : null, utc(atMs), source]);
    return r.insertId;
  };

  const closeVisit = async (visit, exitMs, reason, lat, lng) => {
    const entered = parseUtc(visit.entered_at);
    const at = Math.max(exitMs, entered);
    await q(`UPDATE site_visits SET exited_at = ?, dwell_seconds = ?, exit_reason = ?,
        exit_lat = COALESCE(?, exit_lat), exit_lng = COALESCE(?, exit_lng), exit_pending_since = NULL
        WHERE id = ? AND exited_at IS NULL`,
    [utc(at), Math.round((at - entered) / 1000), reason, Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null, visit.id]);
  };

  // Closes visits left open: earlier days at 23:59:59 India time; automatic visits that have had
  // no GPS for 30 min at their last inside fix (or the moment they first went outside).
  const closeLeftOpen = async (userId, { stale = true } = {}) => {
    const today = istDate();
    // (rows from an older site_visits layout have no user_id / entered_at and are ignored)
    const rows = await q(`SELECT * FROM site_visits WHERE exited_at IS NULL AND user_id IS NOT NULL AND entered_at IS NOT NULL ${userId ? 'AND user_id = ?' : ''}`, userId ? [userId] : []);
    let closed = 0;
    for (const v of rows) {
      const vDate = String(v.visit_date).slice(0, 10);
      if (vDate < today) {
        const pending = parseUtc(v.exit_pending_since);
        await closeVisit(v, Number.isFinite(pending) ? pending : endOfIstDayMs(vDate), Number.isFinite(pending) ? 'GEOFENCE' : 'END_OF_DAY');
        closed += 1;
      } else if (stale && v.entry_source === 'AUTO') {
        const last = parseUtc(v.last_inside_at) || parseUtc(v.entered_at);
        const pending = parseUtc(v.exit_pending_since);
        const lastSignal = Math.max(last, Number.isFinite(pending) ? pending : 0);
        if (Date.now() - lastSignal > STALE_MS) {
          await closeVisit(v, Number.isFinite(pending) ? pending : last, Number.isFinite(pending) ? 'GEOFENCE' : 'STALE');
          closed += 1;
        }
      }
    }
    return closed;
  };

  // Stored notifications (shown in the header bell by extraRoutes.js)
  // An older notifications table may also require user_id / message / is_read: filled in too
  let notifLegacy = null;
  const notifExtras = async () => {
    if (notifLegacy) return notifLegacy;
    const cols = await q('SHOW COLUMNS FROM notifications').catch(() => []);
    const names = new Set(cols.map((c) => c.Field));
    notifLegacy = ['user_id', 'employee_id', 'message', 'is_read'].filter((c) => names.has(c));
    return notifLegacy;
  };
  const notify = async (recipientIds, n) => {
    const ids = [...new Set(recipientIds.map(Number).filter(Boolean))];
    const now = utc();
    const extras = await notifExtras();
    const title = n.title.slice(0, 160);
    const body = n.body ? String(n.body).slice(0, 500) : null;
    for (const id of ids) {
      const data = { recipient_id: id, type: n.type, title, body, ref_table: n.refTable || null, ref_id: n.refId || null, created_at: now };
      extras.forEach((c) => { data[c] = c === 'message' ? (body ? `${title}: ${body}` : title) : c === 'is_read' ? 0 : id; });
      const keys = Object.keys(data);
      await q(`INSERT INTO notifications (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => data[k]))
        .catch((e) => console.warn('Notification skipped:', e.message));
    }
  };
  // Group leadership + the employee's own CEO
  const leadersFor = async (employee) => {
    const rows = await q(`SELECT id FROM users WHERE COALESCE(group_access, 0) = 1 OR UPPER(COALESCE(role, '')) = 'MD'
        OR (UPPER(COALESCE(role, '')) LIKE '%CEO%' AND company_id = ?)`, [homeCompany(employee) || -1]);
    return rows.map((r) => r.id).filter((id) => Number(id) !== Number(employee.id));
  };
  const SITE_EVENT_ALERTS = process.env.FIELD_SITE_ALERTS === 'true'; // entry/exit alerts are off unless asked for

  // Approved On-Duty / Work From Home today (same rule as routes.js)
  const approvedRemoteKind = async (userId, date) => {
    const rows = await q("SELECT * FROM leaves WHERE employee_id = ? AND status = 'Approved' AND ? BETWEEN from_date AND to_date", [userId, date]).catch(() => []);
    for (const l of rows) {
      const t = String(l.leave_type || l.type || '').toUpperCase();
      if (/\bWFH\b|WORK\s*FROM\s*HOME/.test(t)) return 'WFH';
      if (/\bOD\b|ON[\s-]*DUTY/.test(t)) return 'OD';
    }
    return null;
  };

  // ======================================================================
  // POST /attendance/mark  — check in
  // Body: { latitude, longitude, accuracy?, isMock? }  (company_id / check_in from the old app are ignored:
  // the company comes from the employee record and the time from the server clock)
  // ======================================================================
  router.post('/attendance/mark', authenticate, wrap(async (req, res, next) => {
    if (!(await ready())) return next(); // migration not run yet: old handler in routes.js
    const me = req.dbUser;
    await withUserLock(me.id, async () => {
      const now = Date.now();
      const today = istDate(now);
      const existing = await todaysAttendance(me.id, today);
      if (existing) return res.status(400).json({ error: 'Attendance already marked for today!', id: existing.id });

      const lat = num(req.body?.latitude);
      const lng = num(req.body?.longitude);
      const accuracy = num(req.body?.accuracy);

      // MD and group-access leadership: no location check
      if (roleOf(me).includes('MD')) {
        const id = await insertAttendance({ user: me, date: today, atMs: now, mode: 'REMOTE', lat, lng, accuracy, siteName: 'MD Remote' });
        return res.status(201).json({ message: 'Attendance marked successfully! (MD Remote)', id, mode: 'REMOTE' });
      }

      // Approved On-Duty / Work From Home replaces the location check
      const remote = await approvedRemoteKind(me.id, today);
      if (remote) {
        const label = remote === 'WFH' ? 'Work From Home' : 'On-Duty';
        const id = await insertAttendance({ user: me, date: today, atMs: now, mode: remote, lat, lng, accuracy, siteName: label });
        return res.status(201).json({ message: `Attendance marked successfully! (${label})`, id, mode: remote });
      }

      if (!validCoords(lat, lng)) {
        return res.status(400).json({ error: 'Your location could not be read. Turn on location (GPS) and try again.' });
      }
      if (req.body?.isMock === true) {
        return res.status(400).json({ error: 'A mock-location app is active on this phone. Turn it off to check in.' });
      }
      if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) {
        return res.status(400).json({ error: `GPS signal is weak (±${Math.round(accuracy)} m). Move to an open area for a few seconds and try again.` });
      }

      const sites = allowedSites(await loadSites(), me);
      // Office staff of a company with its own site saved on the companies table keep working as before
      if (!isFieldUser(me)) {
        const c = (await q('SELECT id, name, site_latitude, site_longitude, site_radius FROM companies WHERE id = ?', [homeCompany(me) || -1]).catch(() => []))[0];
        const cLat = num(c?.site_latitude);
        const cLng = num(c?.site_longitude);
        if (c && validCoords(cLat, cLng) && !sites.some((s) => metres(cLat, cLng, s.latitude, s.longitude) < 25)) {
          sites.push({ id: null, name: c.name, site_type: 'OFFICE', latitude: cLat, longitude: cLng, radius_m: Number(c.site_radius) || 50 });
        }
      }
      if (!sites.length) return res.status(400).json({ error: 'No office or site location is set up for your company. Please contact HR.' });
      const match = matchSite(lat, lng, sites);
      if (!match.site) {
        const n = match.nearest;
        const hint = isFieldUser(me) ? ' If you are at a client or vendor location, use "Ad-hoc Visit" instead.' : '';
        return res.status(400).json({
          error: `Geofencing Failed: You are ${fmtDistance(n.distance)} from ${n.site.name} (allowed: ${n.site.radius_m} m).${hint}`,
          nearestSite: { id: n.site.id, name: n.site.name, distance: n.distance, radius: n.site.radius_m },
        });
      }

      const mode = match.site.site_type === 'OFFICE' ? 'OFFICE' : 'SITE';
      const id = await insertAttendance({ user: me, date: today, atMs: now, mode, site: match.site, lat, lng, accuracy });
      let visitId = null;
      if (isFieldUser(me)) {
        await closeLeftOpen(me.id);
        visitId = await openVisit({ userId: me.id, site: match.site, atMs: now, lat, lng, accuracy, source: 'CHECK_IN' });
      }
      return res.status(201).json({
        message: `Attendance marked successfully! (${match.site.name}, ${match.distance} m)`,
        id, mode, visitId, site: { id: match.site.id, name: match.site.name, type: match.site.site_type, distance: match.distance },
      });
    });
  }));

  // ======================================================================
  // PUT /attendance/checkout/:id   Body: { latitude?, longitude? }
  // ======================================================================
  router.put('/attendance/checkout/:id', authenticate, wrap(async (req, res, next) => {
    if (!(await ready())) return next();
    const me = req.dbUser;
    await withUserLock(me.id, async () => {
      const row = (await q('SELECT * FROM attendance WHERE id = ? AND employee_id = ?', [req.params.id, me.id]))[0];
      if (!row) return res.status(404).json({ error: 'Attendance not found' });
      if (isCheckedOut(row)) return res.status(400).json({ error: 'You have already checked out for this day.' });

      const now = Date.now();
      const lat = num(req.body?.latitude);
      const lng = num(req.body?.longitude);
      const rowDate = String(row.date).slice(0, 10);
      // Checking out a forgotten earlier day: record it at that day's end, not now
      const outMs = rowDate < istDate(now) ? endOfIstDayMs(rowDate) : now;
      await q(`UPDATE attendance SET check_out = ?, check_out_at = ?, status = 'Checked Out', check_out_lat = ?, check_out_lng = ? WHERE id = ?`,
        [istClock(outMs, false), utc(outMs), validCoords(lat, lng) ? lat : null, validCoords(lat, lng) ? lng : null, row.id]);

      const open = await openVisitOf(me.id);
      if (open) await closeVisit(open, outMs, 'CHECK_OUT', lat, lng);
      await q('UPDATE adhoc_visits SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL', [utc(outMs), me.id]);
      return res.json({ message: 'Checked out successfully!', checkOut: istClock(outMs, false), closedVisit: open ? open.id : null });
    });
  }));

  // ======================================================================
  // Sites
  // ======================================================================
  const siteOut = (s) => ({
    id: s.id, code: s.code, name: s.name, type: s.site_type, companyId: s.company_id, location: s.location_label,
    latitude: Number(s.latitude), longitude: Number(s.longitude), radius: Number(s.radius_m), active: Number(s.is_active) === 1,
  });

  router.get('/field/sites', authenticate, needSchema, wrap(async (req, res) => {
    const all = req.query.all === '1' && canManageSites(req.dbUser);
    const rows = all ? await q('SELECT * FROM sites ORDER BY site_type, name') : await loadSites();
    res.json({ sites: rows.map(siteOut) });
  }));

  const readSiteBody = (b, partial) => {
    const out = {};
    const errors = [];
    if (b.name !== undefined || !partial) { out.name = String(b.name || '').trim(); if (out.name.length < 2) errors.push('name'); }
    if (b.code !== undefined || !partial) { out.code = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '-').slice(0, 30); if (out.code.length < 2) errors.push('code'); }
    if (b.type !== undefined || !partial) { out.site_type = String(b.type || '').toUpperCase(); if (!['OFFICE', 'PROJECT'].includes(out.site_type)) errors.push('type (OFFICE or PROJECT)'); }
    if (b.latitude !== undefined || b.longitude !== undefined || !partial) {
      out.latitude = num(b.latitude); out.longitude = num(b.longitude);
      if (!validCoords(out.latitude, out.longitude)) errors.push('latitude/longitude');
    }
    if (b.radius !== undefined || !partial) { out.radius_m = Math.round(num(b.radius)); if (!(out.radius_m >= 20 && out.radius_m <= 2000)) errors.push('radius (20 to 2000 m)'); }
    if (b.companyId !== undefined) out.company_id = b.companyId === null || b.companyId === '' ? null : Number(b.companyId);
    if (b.location !== undefined) out.location_label = String(b.location || '').slice(0, 160) || null;
    if (b.active !== undefined) out.is_active = b.active ? 1 : 0;
    return { out, errors };
  };

  router.post('/field/sites', authenticate, needSchema, wrap(async (req, res) => {
    if (!canManageSites(req.dbUser)) return res.status(403).json({ error: 'Only group leadership can add sites.' });
    const { out, errors } = readSiteBody(req.body || {}, false);
    if (errors.length) return res.status(400).json({ error: `Please check: ${errors.join(', ')}.` });
    if ((await q('SELECT id FROM sites WHERE code = ?', [out.code])).length) return res.status(409).json({ error: `A site with code ${out.code} already exists.` });
    const r = await q(`INSERT INTO sites (company_id, code, name, site_type, location_label, latitude, longitude, radius_m, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`, [out.company_id ?? null, out.code, out.name, out.site_type, out.location_label ?? null, out.latitude, out.longitude, out.radius_m]);
    await loadSites(true);
    res.status(201).json({ message: 'Site added.', site: siteOut((await q('SELECT * FROM sites WHERE id = ?', [r.insertId]))[0]) });
  }));

  router.put('/field/sites/:id', authenticate, needSchema, wrap(async (req, res) => {
    if (!canManageSites(req.dbUser)) return res.status(403).json({ error: 'Only group leadership can edit sites.' });
    const site = (await q('SELECT * FROM sites WHERE id = ?', [req.params.id]))[0];
    if (!site) return res.status(404).json({ error: 'Site not found.' });
    const { out, errors } = readSiteBody(req.body || {}, true);
    if (errors.length) return res.status(400).json({ error: `Please check: ${errors.join(', ')}.` });
    const keys = Object.keys(out);
    if (!keys.length) return res.status(400).json({ error: 'Nothing to change.' });
    if (out.code && (await q('SELECT id FROM sites WHERE code = ? AND id <> ?', [out.code, site.id])).length) {
      return res.status(409).json({ error: `A site with code ${out.code} already exists.` });
    }
    await q(`UPDATE sites SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => out[k]), site.id]);
    await loadSites(true);
    res.json({ message: 'Site updated.', site: siteOut((await q('SELECT * FROM sites WHERE id = ?', [site.id]))[0]) });
  }));

  // ======================================================================
  // Visits: output helpers
  // ======================================================================
  const visitOut = (v, sitesById) => {
    const entered = parseUtc(v.entered_at);
    const exited = parseUtc(v.exited_at);
    const open = !v.exited_at;
    const seconds = open ? Math.round((Date.now() - entered) / 1000) : Number(v.dwell_seconds || 0);
    const s = sitesById[v.site_id] || {};
    return {
      id: v.id, siteId: v.site_id, siteName: s.name || v.site_name || `Site ${v.site_id}`, siteType: s.site_type || v.site_type,
      date: String(v.visit_date).slice(0, 10),
      enteredAt: `${String(v.entered_at).replace(' ', 'T')}Z`, enteredTime: istClock(entered, true),
      exitedAt: open ? null : `${String(v.exited_at).replace(' ', 'T')}Z`, exitedTime: open ? null : istClock(exited, true),
      open, dwellSeconds: seconds, dwell: fmtDuration(seconds), entrySource: v.entry_source, exitReason: v.exit_reason || null,
    };
  };
  const adhocOut = (a) => ({
    id: a.id, userId: a.user_id, employeeName: a.employee_name, empCode: a.emp_code, date: String(a.visit_date).slice(0, 10),
    startedAt: `${String(a.started_at).replace(' ', 'T')}Z`, startedTime: istClock(parseUtc(a.started_at), true),
    endedTime: a.ended_at ? istClock(parseUtc(a.ended_at), true) : null,
    latitude: Number(a.gps_lat), longitude: Number(a.gps_lng), accuracy: a.gps_accuracy_m === null ? null : Number(a.gps_accuracy_m),
    locationSource: a.location_source,
    pin: a.pin_lat === null || a.pin_lat === undefined ? null : { latitude: Number(a.pin_lat), longitude: Number(a.pin_lng), distanceFromGps: Number(a.pin_distance_m) },
    reason: a.reason, status: a.status, reviewNote: a.review_note || null,
    photoUrl: `/api/field/adhoc/${a.id}/photo`,
  });
  const sitesIndex = async () => Object.fromEntries((await q('SELECT * FROM sites')).map((s) => [s.id, s]));

  // ======================================================================
  // GET /field/status — the field staff home card
  // ======================================================================
  router.get('/field/status', authenticate, needSchema, wrap(async (req, res) => {
    const me = req.dbUser;
    await closeLeftOpen(me.id);
    const today = istDate();
    const [attendance, visits, adhoc, sites, byId] = await Promise.all([
      todaysAttendance(me.id, today),
      q('SELECT * FROM site_visits WHERE user_id = ? AND visit_date = ? ORDER BY entered_at', [me.id, today]),
      q('SELECT * FROM adhoc_visits WHERE user_id = ? AND visit_date = ? ORDER BY started_at', [me.id, today]),
      loadSites(), sitesIndex(),
    ]);
    const vs = visits.map((v) => visitOut(v, byId));
    const totals = {};
    vs.forEach((v) => { totals[v.siteName] = (totals[v.siteName] || 0) + v.dwellSeconds; });
    res.json({
      mode: isFieldUser(me) ? 'FIELD' : 'OFFICE',
      date: today,
      attendance: attendance ? {
        id: attendance.id, checkIn: attendance.check_in, checkOut: attendance.check_out || null, mode: attendance.mode || null,
        site: attendance.site_name || null, checkedOut: isCheckedOut(attendance),
      } : null,
      openVisit: vs.find((v) => v.open) || null,
      visits: vs,
      dwellBySite: Object.entries(totals).map(([site, seconds]) => ({ site, seconds, dwell: fmtDuration(seconds) })),
      adhoc: adhoc.map(adhocOut),
      sites: allowedSites(sites, me).map(siteOut),
      rules: { maxAccuracy: MAX_ACCURACY_M, exitBuffer: EXIT_BUFFER_M, exitConfirmSeconds: EXIT_CONFIRM_MS / 1000, pingEverySeconds: 60 },
    });
  }));

  // ======================================================================
  // POST /field/pings — automatic entry / exit detection
  // Body: { pings: [{ latitude, longitude, accuracy, recordedAt (ISO), isMock }] }  (or one ping as the body)
  //   Entry: 2 consecutive good fixes (≤ 100 m accuracy, ≤ 10 min apart) inside the same site → visit
  //          opens at the first of the two. With no check-in yet today, this also checks the employee in.
  //   Exit:  fixes clearly outside (radius + 50 m) for 3 minutes → visit closes at the first outside fix.
  //   Moving straight into another site closes the old visit (NEW_SITE) and opens the new one.
  // ======================================================================
  router.post('/field/pings', authenticate, needSchema, wrap(async (req, res) => {
    const me = req.dbUser;
    if (!isFieldUser(me)) return res.status(403).json({ error: 'Location tracking is only for field staff.' });
    const raw = Array.isArray(req.body?.pings) ? req.body.pings : [req.body || {}];
    if (raw.length > MAX_PINGS_PER_CALL) return res.status(400).json({ error: `Send at most ${MAX_PINGS_PER_CALL} points at a time.` });

    const now = Date.now();
    const pings = raw.map((p) => {
      const lat = num(p.latitude);
      const lng = num(p.longitude);
      let t = Date.parse(p.recordedAt || '');
      // Phone clocks drift: accept the last 12 hours and up to 2 minutes ahead; otherwise use arrival time
      if (!Number.isFinite(t) || t > now + 2 * 60 * 1000 || t < now - 12 * 3600 * 1000) t = now;
      t = Math.min(t, now);
      return { lat, lng, t, accuracy: num(p.accuracy), isMock: p.isMock === true };
    }).filter((p) => validCoords(p.lat, p.lng)).sort((a, b) => a.t - b.t);
    if (!pings.length) return res.status(400).json({ error: 'No valid GPS points were sent.' });

    const result = await withUserLock(me.id, async () => {
      // Earlier days only: a phone that was offline may be uploading a backlog, so "no GPS for 30 min"
      // is judged from the gap between points below, not from the clock now.
      await closeLeftOpen(me.id, { stale: false });
      const today = istDate(now);
      let attendance = await todaysAttendance(me.id, today);
      if (isCheckedOut(attendance)) return { status: 409, body: { error: 'You have checked out for today, so location is no longer recorded.', trackingStopped: true } };

      const sites = allowedSites(await loadSites(), me);
      const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
      let open = await openVisitOf(me.id);
      // The last good fix before this batch, for the "2 consecutive fixes" entry rule
      let prev = (await q(`SELECT recorded_at, matched_site_id, accuracy_m, latitude, longitude FROM location_pings
          WHERE user_id = ? AND is_mock = 0 AND (accuracy_m IS NULL OR accuracy_m <= ?) ORDER BY recorded_at DESC, id DESC LIMIT 1`, [me.id, MAX_ACCURACY_M]))[0];
      prev = prev ? { t: parseUtc(prev.recorded_at), siteId: prev.matched_site_id, lat: Number(prev.latitude), lng: Number(prev.longitude), accuracy: num(prev.accuracy_m) } : null;
      const events = [];

      for (const p of pings) {
        const good = !p.isMock && !(Number.isFinite(p.accuracy) && p.accuracy > MAX_ACCURACY_M);
        // 0) Automatic visit with a 30-minute hole in the GPS before this point: close it at its last signal
        if (good && istDate(p.t) === today && open && open.entry_source === 'AUTO') {
          const pendingMs = parseUtc(open.exit_pending_since);
          const lastSignal = Math.max(parseUtc(open.last_inside_at) || parseUtc(open.entered_at), Number.isFinite(pendingMs) ? pendingMs : 0);
          if (p.t - lastSignal > STALE_MS) {
            const at = Number.isFinite(pendingMs) ? pendingMs : lastSignal;
            const why = Number.isFinite(pendingMs) ? 'GEOFENCE' : 'STALE'; // already seen outside → a real exit
            await closeVisit(open, at, why);
            events.push({ type: 'exit', siteId: open.site_id, site: byId[open.site_id]?.name, at: istClock(at, true), reason: why });
            open = null;
          }
        }

        const m = matchSite(p.lat, p.lng, sites, open && open.site_id);
        await q(`INSERT INTO location_pings (user_id, recorded_at, received_at, latitude, longitude, accuracy_m, is_mock, matched_site_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [me.id, utc(p.t), utc(now), p.lat, p.lng, Number.isFinite(p.accuracy) ? Math.round(p.accuracy) : null, p.isMock ? 1 : 0, m.site ? m.site.id : null]);
        if (!good) continue;
        if (istDate(p.t) !== today) { prev = { t: p.t, siteId: m.site ? m.site.id : null, lat: p.lat, lng: p.lng, accuracy: p.accuracy }; continue; }

        // 1) Inside the open visit's site (sticky radius): still there
        if (open && m.site && Number(m.site.id) === Number(open.site_id)) {
          await q('UPDATE site_visits SET last_inside_at = ?, exit_pending_since = NULL WHERE id = ?', [utc(p.t), open.id]);
          open.last_inside_at = utc(p.t); open.exit_pending_since = null;
        } else if (open) {
          // 2) Clearly outside the open visit's site: start or confirm the exit
          const pendingMs = parseUtc(open.exit_pending_since);
          if (!Number.isFinite(pendingMs)) {
            await q('UPDATE site_visits SET exit_pending_since = ?, exit_lat = ?, exit_lng = ? WHERE id = ?', [utc(p.t), p.lat, p.lng, open.id]);
            open.exit_pending_since = utc(p.t);
          } else if (p.t - pendingMs >= EXIT_CONFIRM_MS) {
            await closeVisit(open, pendingMs, 'GEOFENCE');
            events.push({ type: 'exit', siteId: open.site_id, site: byId[open.site_id]?.name, at: istClock(pendingMs, true) });
            open = null;
          }
        }

        // 3) Entry: this fix and the previous good fix are inside the same site (and it is not the open one)
        if (m.site && (!open || Number(open.site_id) !== Number(m.site.id)) && prev && Number(prev.siteId) === Number(m.site.id)
            && p.t - prev.t <= ENTRY_PAIR_MAX_GAP_MS && istDate(prev.t) === today) {
          const enterMs = prev.t;
          if (open) { // walked straight from one site into another
            const pendingMs = parseUtc(open.exit_pending_since);
            const leftAt = Number.isFinite(pendingMs) ? Math.min(pendingMs, enterMs) : enterMs;
            await closeVisit(open, leftAt, 'NEW_SITE');
            events.push({ type: 'exit', siteId: open.site_id, site: byId[open.site_id]?.name, at: istClock(leftAt, true) });
          }
          if (!attendance) {
            const mode = m.site.site_type === 'OFFICE' ? 'OFFICE' : 'SITE';
            const attId = await insertAttendance({ user: me, date: today, atMs: enterMs, mode, site: m.site, lat: prev.lat, lng: prev.lng, accuracy: prev.accuracy });
            attendance = await todaysAttendance(me.id, today);
            events.push({ type: 'check_in', attendanceId: attId, site: m.site.name, at: istClock(enterMs, true) });
          }
          const id = await openVisit({ userId: me.id, site: m.site, atMs: enterMs, lat: prev.lat, lng: prev.lng, accuracy: prev.accuracy, source: 'AUTO' });
          await q('UPDATE site_visits SET last_inside_at = ? WHERE id = ?', [utc(p.t), id]);
          open = (await q('SELECT * FROM site_visits WHERE id = ?', [id]))[0];
          events.push({ type: 'entry', siteId: m.site.id, site: m.site.name, at: istClock(enterMs, true), visitId: id });
        }
        prev = { t: p.t, siteId: m.site ? m.site.id : null, lat: p.lat, lng: p.lng, accuracy: p.accuracy };
      }

      if (SITE_EVENT_ALERTS && events.length) {
        const leaders = await leadersFor(me);
        for (const e of events.filter((x) => x.type === 'entry' || x.type === 'exit')) {
          await notify(leaders, { type: e.type === 'entry' ? 'SITE_ENTRY' : 'SITE_EXIT', title: `${me.name} ${e.type === 'entry' ? 'arrived at' : 'left'} ${e.site}`, body: `at ${e.at}`, refTable: 'site_visits', refId: e.visitId || null });
        }
      }
      const current = open ? visitOut(open, byId) : null;
      return { status: 200, body: { accepted: pings.length, events, openVisit: current, checkedIn: !!attendance } };
    });
    res.status(result.status).json(result.body);
  }));

  // ======================================================================
  // Manual entry / exit buttons (when background tracking is off)
  // ======================================================================
  router.post('/field/visits/enter', authenticate, needSchema, wrap(async (req, res) => {
    const me = req.dbUser;
    if (!isFieldUser(me)) return res.status(403).json({ error: 'Site visits are only for field staff.' });
    const lat = num(req.body?.latitude);
    const lng = num(req.body?.longitude);
    const accuracy = num(req.body?.accuracy);
    if (!validCoords(lat, lng)) return res.status(400).json({ error: 'Your location could not be read. Turn on location (GPS) and try again.' });
    if (req.body?.isMock === true) return res.status(400).json({ error: 'A mock-location app is active on this phone. Turn it off first.' });
    if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) return res.status(400).json({ error: `GPS signal is weak (±${Math.round(accuracy)} m). Try again in the open.` });

    const result = await withUserLock(me.id, async () => {
      await closeLeftOpen(me.id);
      const now = Date.now();
      const today = istDate(now);
      let attendance = await todaysAttendance(me.id, today);
      if (isCheckedOut(attendance)) return { status: 409, body: { error: 'You have already checked out for today.' } };

      const sites = allowedSites(await loadSites(), me);
      let site;
      let distance;
      if (req.body?.siteId) {
        site = sites.find((s) => Number(s.id) === Number(req.body.siteId));
        if (!site) return { status: 404, body: { error: 'Site not found.' } };
        distance = metres(lat, lng, site.latitude, site.longitude);
        if (distance > site.radius_m) return { status: 400, body: { error: `You are ${fmtDistance(distance)} from ${site.name} (allowed: ${site.radius_m} m).` } };
      } else {
        const m = matchSite(lat, lng, sites);
        if (!m.site) return { status: 400, body: { error: `You are not at any site. Nearest: ${m.nearest.site.name}, ${fmtDistance(m.nearest.distance)} away.` } };
        site = m.site; distance = m.distance;
      }

      const open = await openVisitOf(me.id);
      if (open && Number(open.site_id) === Number(site.id)) return { status: 200, body: { message: `You are already checked in at ${site.name}.`, visit: visitOut(open, { [site.id]: site }) } };
      if (open) await closeVisit(open, now, 'NEW_SITE', lat, lng);
      if (!attendance) {
        await insertAttendance({ user: me, date: today, atMs: now, mode: site.site_type === 'OFFICE' ? 'OFFICE' : 'SITE', site, lat, lng, accuracy });
        attendance = true;
      }
      const id = await openVisit({ userId: me.id, site, atMs: now, lat, lng, accuracy, source: 'MANUAL' });
      const visit = (await q('SELECT * FROM site_visits WHERE id = ?', [id]))[0];
      return { status: 201, body: { message: `Arrived at ${site.name} (${distance} m).`, visit: visitOut(visit, { [site.id]: site }) } };
    });
    res.status(result.status).json(result.body);
  }));

  router.post('/field/visits/exit', authenticate, needSchema, wrap(async (req, res) => {
    const me = req.dbUser;
    const result = await withUserLock(me.id, async () => {
      const open = await openVisitOf(me.id);
      if (!open) return { status: 404, body: { error: 'You are not checked in at any site right now.' } };
      const lat = num(req.body?.latitude);
      const lng = num(req.body?.longitude);
      await closeVisit(open, Date.now(), 'MANUAL', lat, lng);
      const closed = (await q('SELECT * FROM site_visits WHERE id = ?', [open.id]))[0];
      return { status: 200, body: { message: 'Site visit closed.', visit: visitOut(closed, await sitesIndex()) } };
    });
    res.status(result.status).json(result.body);
  }));

  // ======================================================================
  // GET /field/visits?date=YYYY-MM-DD&userId=  — one day of visits
  // ======================================================================
  const loadEmployee = async (id) => (await q(`SELECT id, name, ${empCodeSql('users')}, company_id, role, attendance_mode FROM users WHERE id = ?`, [id]))[0];

  router.get('/field/visits', authenticate, needSchema, wrap(async (req, res) => {
    const me = req.dbUser;
    const date = isIsoDate(req.query.date) ? req.query.date : istDate();
    let userIds;
    if (req.query.userId && Number(req.query.userId) !== Number(me.id)) {
      const emp = await loadEmployee(req.query.userId);
      if (!emp) return res.status(404).json({ error: 'Employee not found.' });
      if (!inScope(me, emp)) return res.status(403).json({ error: 'You can only view your own visits.' });
      userIds = [emp.id];
    } else if (!req.query.userId && scopeOf(me) !== null && req.query.all === '1') {
      const scope = scopeOf(me);
      const companyId = scope === 'all' ? (req.query.companyId && req.query.companyId !== 'all' ? Number(req.query.companyId) : null) : scope;
      userIds = (await q(`SELECT id FROM users WHERE (attendance_mode = 'FIELD' OR id IN (SELECT user_id FROM site_visits WHERE visit_date = ?)) ${companyId ? 'AND company_id = ?' : ''}`,
        companyId ? [date, companyId] : [date])).map((r) => r.id);
    } else {
      userIds = [me.id];
    }
    await closeLeftOpen();
    if (!userIds.length) return res.json({ date, visits: [], adhoc: [] });
    const marks = userIds.map(() => '?').join(',');
    const [visits, adhoc, byId] = await Promise.all([
      q(`SELECT v.*, u.name AS employee_name, ${empCodeSql()} FROM site_visits v JOIN users u ON u.id = v.user_id
          WHERE v.visit_date = ? AND v.user_id IN (${marks}) ORDER BY u.name, v.entered_at`, [date, ...userIds]),
      q(`SELECT a.*, u.name AS employee_name, ${empCodeSql()} FROM adhoc_visits a JOIN users u ON u.id = a.user_id
          WHERE a.visit_date = ? AND a.user_id IN (${marks}) ORDER BY u.name, a.started_at`, [date, ...userIds]),
      sitesIndex(),
    ]);
    res.json({
      date,
      visits: visits.map((v) => ({ ...visitOut(v, byId), userId: v.user_id, employeeName: v.employee_name, empCode: v.emp_code })),
      adhoc: adhoc.map(adhocOut),
    });
  }));

  // ======================================================================
  // GET /field/summary?from=&to=&companyId=  — dwell per employee per site (management)
  // ======================================================================
  router.get('/field/summary', authenticate, needSchema, wrap(async (req, res) => {
    const me = req.dbUser;
    const scope = scopeOf(me);
    if (scope === null) return res.status(403).json({ error: 'Only management can view the field summary.' });
    const today = istDate();
    const from = isIsoDate(req.query.from) ? req.query.from : `${today.slice(0, 8)}01`;
    const to = isIsoDate(req.query.to) ? req.query.to : today;
    if (from > to) return res.status(400).json({ error: '"from" must be on or before "to".' });
    let companyId = null;
    if (scope === 'all') { if (req.query.companyId && req.query.companyId !== 'all') companyId = Number(req.query.companyId); } else companyId = scope;

    await closeLeftOpen();
    const companySql = companyId ? 'AND u.company_id = ?' : '';
    const companyArg = companyId ? [companyId] : [];
    const [visits, adhoc, staff, byId] = await Promise.all([
      q(`SELECT v.* FROM site_visits v JOIN users u ON u.id = v.user_id WHERE v.visit_date BETWEEN ? AND ? ${companySql}`, [from, to, ...companyArg]),
      q(`SELECT a.user_id, a.status, COUNT(*) AS n FROM adhoc_visits a JOIN users u ON u.id = a.user_id
          WHERE a.visit_date BETWEEN ? AND ? ${companySql} GROUP BY a.user_id, a.status`, [from, to, ...companyArg]),
      q(`SELECT u.id, u.name, ${empCodeSql()}, u.company_id FROM users u WHERE (u.attendance_mode = 'FIELD'
          OR u.id IN (SELECT user_id FROM site_visits WHERE visit_date BETWEEN ? AND ?)) ${companySql} ORDER BY u.name`, [from, to, ...companyArg]),
      sitesIndex(),
    ]);

    const people = new Map(staff.map((u) => [u.id, { userId: u.id, name: u.name, empCode: u.emp_code, companyId: u.company_id, totalSeconds: 0, daysOnSite: new Set(), adhoc: 0, adhocFlagged: 0, sites: {} }]));
    visits.forEach((v) => {
      const p = people.get(v.user_id);
      if (!p) return;
      const sec = v.exited_at ? Number(v.dwell_seconds || 0) : Math.round((Date.now() - parseUtc(v.entered_at)) / 1000);
      const s = p.sites[v.site_id] || (p.sites[v.site_id] = { siteId: v.site_id, site: byId[v.site_id]?.name || `Site ${v.site_id}`, type: byId[v.site_id]?.site_type, visits: 0, seconds: 0, days: new Set() });
      s.visits += 1; s.seconds += sec; s.days.add(String(v.visit_date).slice(0, 10));
      p.totalSeconds += sec; p.daysOnSite.add(String(v.visit_date).slice(0, 10));
    });
    adhoc.forEach((a) => {
      const p = people.get(a.user_id);
      if (!p) return;
      p.adhoc += Number(a.n); if (a.status === 'FLAGGED') p.adhocFlagged += Number(a.n);
    });
    const siteTotals = {};
    const employees = [...people.values()].map((p) => ({
      userId: p.userId, name: p.name, empCode: p.empCode, companyId: p.companyId,
      totalSeconds: p.totalSeconds, total: fmtDuration(p.totalSeconds), daysOnSite: p.daysOnSite.size,
      adhocVisits: p.adhoc, adhocFlagged: p.adhocFlagged,
      sites: Object.values(p.sites).sort((a, b) => b.seconds - a.seconds).map((s) => {
        const t = siteTotals[s.site] || (siteTotals[s.site] = { site: s.site, type: s.type, visits: 0, seconds: 0, people: new Set() });
        t.visits += s.visits; t.seconds += s.seconds; t.people.add(p.userId);
        return { siteId: s.siteId, site: s.site, type: s.type, visits: s.visits, days: s.days.size, seconds: s.seconds, dwell: fmtDuration(s.seconds) };
      }),
    }));
    res.json({
      from, to, companyId,
      employees,
      sites: Object.values(siteTotals).sort((a, b) => b.seconds - a.seconds)
        .map((t) => ({ site: t.site, type: t.type, visits: t.visits, people: t.people.size, seconds: t.seconds, dwell: fmtDuration(t.seconds) })),
    });
  }));

  // ======================================================================
  // POST /field/close-day — closes every open visit from earlier days, and with
  // { date: 'YYYY-MM-DD' } (or after 23:00 India time) that day's too, at 23:59:59 / now.
  // Call it from a scheduler (cron-job.org etc.) at 23:55 IST with header X-Cron-Key: <CRON_KEY>.
  // Visits are also closed lazily whenever anyone opens field data, so a missed run loses nothing.
  // ======================================================================
  const cronOrManagement = (req, res, next) => {
    const key = process.env.CRON_KEY;
    if (key && req.headers['x-cron-key'] === key) { req.viaCron = true; return next(); }
    return authenticate(req, res, () => (scopeOf(req.dbUser) === 'all' || roleOf(req.dbUser).includes('ADMIN')
      ? next() : res.status(403).json({ error: 'Not allowed.' })));
  };
  router.post('/field/close-day', cronOrManagement, needSchema, wrap(async (req, res) => {
    const now = Date.now();
    const today = istDate(now);
    const lateEvening = new Date(now + IST_OFFSET_MS).getUTCHours() >= 23;
    const date = isIsoDate(req.body?.date) ? req.body.date : (lateEvening ? today : null);
    let closed = await closeLeftOpen();
    if (date) {
      const open = await q('SELECT * FROM site_visits WHERE exited_at IS NULL AND user_id IS NOT NULL AND entered_at IS NOT NULL AND visit_date <= ?', [date]);
      for (const v of open) {
        const pending = parseUtc(v.exit_pending_since);
        const at = Number.isFinite(pending) ? pending : Math.min(now, endOfIstDayMs(String(v.visit_date).slice(0, 10)));
        await closeVisit(v, at, Number.isFinite(pending) ? 'GEOFENCE' : 'END_OF_DAY');
        closed += 1;
      }
      await q('UPDATE adhoc_visits SET ended_at = ? WHERE ended_at IS NULL AND visit_date <= ?', [utc(Math.min(now, endOfIstDayMs(date))), date]);
    }
    // Delete raw GPS points older than 90 days
    const purged = await q('DELETE FROM location_pings WHERE received_at < ?', [utc(now - 90 * 24 * 3600 * 1000)]);
    res.json({ message: 'Day closed.', closedVisits: closed, date: date || null, purgedPings: purged.affectedRows || 0 });
  }));

  // ======================================================================
  // Ad-hoc visits
  // POST /field/adhoc  Body:
  //   { latitude, longitude, accuracy, isMock,               ← live GPS of the phone (always required)
  //     locationSource: 'CURRENT' | 'MANUAL_PIN', pinLatitude, pinLongitude,   ← pin when the meeting place differs
  //     reason, photo: 'data:image/jpeg;base64,…', photoTakenAt }
  // ======================================================================
  const s3 = (() => {
    const { S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
    if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
    try {
      // eslint-disable-next-line global-require, import/no-unresolved
      const sdk = require('@aws-sdk/client-s3');
      const client = new sdk.S3Client({ region: S3_REGION || 'auto', endpoint: S3_ENDPOINT || undefined, credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY } });
      return { sdk, client, bucket: S3_BUCKET };
    } catch (e) {
      console.warn('S3 settings found but @aws-sdk/client-s3 is not installed; ad-hoc photos will be stored in the database.');
      return null;
    }
  })();

  const readPhoto = (dataUrl) => {
    const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!m) return { error: 'Please take a photo (JPEG, PNG or WebP).' };
    const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
    if (buf.length < 1024) return { error: 'The photo looks empty. Please take it again.' };
    if (buf.length > MAX_PHOTO_BYTES) return { error: 'The photo is too large (max 2.5 MB). Please retake it at a lower resolution.' };
    const magicOk = (m[1] === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8)
      || (m[1] === 'image/png' && buf.slice(0, 4).toString('hex') === '89504e47')
      || (m[1] === 'image/webp' && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP');
    if (!magicOk) return { error: 'The photo file is not a valid image.' };
    return { mime: m[1], buf };
  };

  router.post('/field/adhoc', authenticate, needSchema, wrap(async (req, res) => {
    const me = req.dbUser;
    if (!isFieldUser(me)) return res.status(403).json({ error: 'Ad-hoc visits are only for field staff.' });
    const b = req.body || {};
    const lat = num(b.latitude);
    const lng = num(b.longitude);
    const accuracy = num(b.accuracy);
    const source = String(b.locationSource || 'CURRENT').toUpperCase();
    const reason = String(b.reason || '').trim();

    if (!validCoords(lat, lng)) return res.status(400).json({ error: 'Your live location could not be read. Turn on location (GPS) and try again.' });
    if (b.isMock === true) return res.status(400).json({ error: 'A mock-location app is active on this phone. Turn it off first.' });
    if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) return res.status(400).json({ error: `GPS signal is weak (±${Math.round(accuracy)} m). Try again in the open.` });
    if (!['CURRENT', 'MANUAL_PIN'].includes(source)) return res.status(400).json({ error: 'Location must be "current location" or "manual pin".' });
    if (reason.length < 5) return res.status(400).json({ error: 'Please write the reason for this visit (at least 5 characters).' });
    if (reason.length > 500) return res.status(400).json({ error: 'The reason is too long (max 500 characters).' });

    let pinLat = null;
    let pinLng = null;
    let pinDistance = null;
    if (source === 'MANUAL_PIN') {
      pinLat = num(b.pinLatitude); pinLng = num(b.pinLongitude);
      if (!validCoords(pinLat, pinLng)) return res.status(400).json({ error: 'Drop the pin on the map where the visit is.' });
      pinDistance = metres(lat, lng, pinLat, pinLng);
    }
    const photo = readPhoto(b.photo);
    if (photo.error) return res.status(400).json({ error: photo.error });

    const result = await withUserLock(me.id, async () => {
      const now = Date.now();
      const today = istDate(now);
      const attendance = await todaysAttendance(me.id, today);
      if (isCheckedOut(attendance)) return { status: 409, body: { error: 'You have already checked out for today.' } };

      // At a known site? Then it is a normal site visit, not ad-hoc.
      const here = matchSite(lat, lng, await loadSites());
      if (here.site) return { status: 400, body: { error: `You are at ${here.site.name}. Use site check-in instead of an ad-hoc visit.`, site: here.site.name } };

      const flags = [];
      if (pinDistance !== null && pinDistance > PIN_FLAG_M) flags.push(`pin is ${fmtDistance(pinDistance)} from the phone's GPS`);
      const photoMs = Date.parse(b.photoTakenAt || '');
      if (Number.isFinite(photoMs) && Math.abs(now - photoMs) > 15 * 60 * 1000) flags.push('photo was not taken in the last 15 minutes');
      const status = flags.length ? 'FLAGGED' : 'SUBMITTED';

      // Leaving a site visit (if any) and ending the previous ad-hoc visit
      const open = await openVisitOf(me.id);
      if (open) await closeVisit(open, now, 'NEW_SITE', lat, lng);
      await q('UPDATE adhoc_visits SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL', [utc(now), me.id]);

      const r = await q(`INSERT INTO adhoc_visits
          (user_id, visit_date, started_at, gps_lat, gps_lng, gps_accuracy_m, location_source, pin_lat, pin_lng, pin_distance_m,
           reason, photo_storage, photo_key, photo_mime, photo_taken_at, status, review_note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      [me.id, today, utc(now), lat, lng, Number.isFinite(accuracy) ? Math.round(accuracy) : null, source, pinLat, pinLng, pinDistance,
        reason, s3 ? 'S3' : 'DB', photo.mime, Number.isFinite(photoMs) ? utc(photoMs) : null, status, flags.length ? `Auto: ${flags.join('; ')}` : null]);
      const id = r.insertId;

      try {
        if (s3) {
          const key = `adhoc/${today.slice(0, 7)}/${me.id}-${id}.${PHOTO_TYPES[photo.mime]}`;
          await s3.client.send(new s3.sdk.PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: photo.buf, ContentType: photo.mime }));
          await q('UPDATE adhoc_visits SET photo_key = ? WHERE id = ?', [key, id]);
        } else {
          await q('INSERT INTO adhoc_photos (adhoc_visit_id, mime, data) VALUES (?, ?, ?)', [id, photo.mime, photo.buf]);
        }
      } catch (err) {
        await q('DELETE FROM adhoc_visits WHERE id = ?', [id]); // no visit without its photo
        throw err;
      }

      let attendanceCreated = false;
      if (!attendance) {
        await insertAttendance({ user: me, date: today, atMs: now, mode: 'ADHOC', lat: pinLat ?? lat, lng: pinLng ?? lng, accuracy, siteName: `Ad-hoc: ${reason.slice(0, 60)}` });
        attendanceCreated = true;
      }

      await notify(await leadersFor(me), {
        type: status === 'FLAGGED' ? 'VISIT_FLAGGED' : 'ADHOC_VISIT',
        title: `${me.name} logged an ad-hoc visit${status === 'FLAGGED' ? ' (flagged)' : ''}`,
        body: `${reason}${flags.length ? ` · ${flags.join('; ')}` : ''}`,
        refTable: 'adhoc_visits', refId: id,
      });
      const row = (await q('SELECT * FROM adhoc_visits WHERE id = ?', [id]))[0];
      return {
        status: 201,
        body: {
          message: attendanceCreated ? 'Ad-hoc visit recorded and you are checked in for today.' : 'Ad-hoc visit recorded.',
          visit: adhocOut({ ...row, employee_name: me.name, emp_code: empCodeOf(me) }), attendanceCreated, flags,
        },
      };
    });
    res.status(result.status).json(result.body);
  }));

  router.get('/field/adhoc', authenticate, needSchema, wrap(async (req, res) => {
    const me = req.dbUser;
    const scope = scopeOf(me);
    const today = istDate();
    const from = isIsoDate(req.query.from) ? req.query.from : (isIsoDate(req.query.date) ? req.query.date : `${today.slice(0, 8)}01`);
    const to = isIsoDate(req.query.to) ? req.query.to : (isIsoDate(req.query.date) ? req.query.date : today);
    const where = ['a.visit_date BETWEEN ? AND ?'];
    const args = [from, to];
    if (scope === null || req.query.mine === '1') { where.push('a.user_id = ?'); args.push(me.id); } else {
      if (scope !== 'all') { where.push('u.company_id = ?'); args.push(scope); } else if (req.query.companyId && req.query.companyId !== 'all') { where.push('u.company_id = ?'); args.push(Number(req.query.companyId)); }
      if (req.query.userId) { where.push('a.user_id = ?'); args.push(Number(req.query.userId)); }
    }
    if (['SUBMITTED', 'VERIFIED', 'FLAGGED'].includes(String(req.query.status || '').toUpperCase())) { where.push('a.status = ?'); args.push(String(req.query.status).toUpperCase()); }
    const rows = await q(`SELECT a.*, u.name AS employee_name, ${empCodeSql()} FROM adhoc_visits a JOIN users u ON u.id = a.user_id
        WHERE ${where.join(' AND ')} ORDER BY a.started_at DESC LIMIT 500`, args);
    res.json({ from, to, visits: rows.map(adhocOut) });
  }));

  const loadAdhocFor = async (req, res) => {
    const row = (await q(`SELECT a.*, u.company_id, u.name AS employee_name, ${empCodeSql()} FROM adhoc_visits a JOIN users u ON u.id = a.user_id WHERE a.id = ?`, [req.params.id]))[0];
    if (!row) { res.status(404).json({ error: 'Ad-hoc visit not found.' }); return null; }
    const own = Number(row.user_id) === Number(req.dbUser.id);
    if (!own && !inScope(req.dbUser, row)) { res.status(403).json({ error: 'Not allowed.' }); return null; }
    return { row, own };
  };

  router.get('/field/adhoc/:id/photo', authenticate, needSchema, wrap(async (req, res) => {
    const found = await loadAdhocFor(req, res);
    if (!found) return;
    const { row } = found;
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (row.photo_storage === 'S3') {
      if (!s3 || !row.photo_key) return res.status(503).json({ error: 'Photo storage is not configured on the server.' });
      const obj = await s3.client.send(new s3.sdk.GetObjectCommand({ Bucket: s3.bucket, Key: row.photo_key }));
      res.setHeader('Content-Type', row.photo_mime);
      return res.send(Buffer.from(await obj.Body.transformToByteArray()));
    }
    const p = (await q('SELECT mime, data FROM adhoc_photos WHERE adhoc_visit_id = ?', [row.id]))[0];
    if (!p) return res.status(404).json({ error: 'Photo not found.' });
    res.setHeader('Content-Type', p.mime);
    return res.send(Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data));
  }));

  router.patch('/field/adhoc/:id/end', authenticate, needSchema, wrap(async (req, res) => {
    const found = await loadAdhocFor(req, res);
    if (!found) return;
    if (!found.own) return res.status(403).json({ error: 'Only the employee can end their visit.' });
    if (found.row.ended_at) return res.status(400).json({ error: 'This visit has already ended.' });
    const now = Date.now();
    await q('UPDATE adhoc_visits SET ended_at = ? WHERE id = ?', [utc(now), found.row.id]);
    res.json({ message: 'Visit ended.', endedTime: istClock(now, true) });
  }));

  router.patch('/field/adhoc/:id/review', authenticate, needSchema, wrap(async (req, res) => {
    const found = await loadAdhocFor(req, res);
    if (!found) return;
    if (scopeOf(req.dbUser) === null || found.own) return res.status(403).json({ error: 'Only management can review visits (not their own).' });
    const status = String(req.body?.status || '').toUpperCase();
    if (!['VERIFIED', 'FLAGGED'].includes(status)) return res.status(400).json({ error: 'Status must be VERIFIED or FLAGGED.' });
    const note = String(req.body?.note || '').trim().slice(0, 300) || null;
    await q('UPDATE adhoc_visits SET status = ?, review_note = COALESCE(?, review_note), reviewed_by = ?, reviewed_at = ? WHERE id = ?',
      [status, note, req.dbUser.id, utc(), found.row.id]);
    await notify([found.row.user_id], {
      type: 'ADHOC_REVIEWED',
      title: `Your ad-hoc visit on ${String(found.row.visit_date).slice(0, 10)} was ${status === 'VERIFIED' ? 'verified' : 'flagged'}`,
      body: note, refTable: 'adhoc_visits', refId: found.row.id,
    });
    res.json({ message: `Visit ${status === 'VERIFIED' ? 'verified' : 'flagged'}.` });
  }));

  return router;
};

// Exposed for tests
module.exports.RULES = { MAX_ACCURACY_M, EXIT_BUFFER_M, EXIT_CONFIRM_MS, ENTRY_PAIR_MAX_GAP_MS, STALE_MS, PIN_FLAG_M };