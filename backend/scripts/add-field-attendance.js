#!/usr/bin/env node
/* ==========================================================================
   Field attendance & multi-site geofencing: database migration.

   Creates (only if missing, nothing is dropped):
     sites            Shared Office (50 m) + 5 Ram Reddy Developers project sites (200 m)
     site_visits      one row per entry/exit at a project site, with dwell seconds
     location_pings   raw GPS points from field staff phones (kept 90 days)
     adhoc_visits     client meetings and other off-site visits (GPS, reason, photo)
     adhoc_photos     photo bytes when no S3/R2 bucket is configured
     notifications    stored alerts: site entry/exit, ad-hoc visit, flagged visit
   Adds columns:
     users.attendance_mode   OFFICE (default) | FIELD
     attendance.check_in_at, check_out_at, mode, site_id, accuracy_m, check_out_lat, check_out_lng
   Seeds the 6 sites from "Attendance System Setup Data" (25 Sep 2026) and switches
   the 7 field employees to FIELD mode.

   Usage (from the backend folder; uses the same DB_* variables as the server):
     node scripts/add-field-attendance.js            # preview, changes nothing
     node scripts/add-field-attendance.js --apply
   Options:
     --map=RRD-008=22    force an employee code to a users.id when it cannot be found automatically
     --add-emp-code      if users has no emp_code column, add it and copy the codes into it
                         (the rest of the HRMS reads users.emp_code: directory, reports, payslips)

   Employees are found by their code in whichever column exists (emp_code, employee_code,
   employee_id, emp_id, emp_no, employee_no, staff_id, code, biometric_id), then by name.
   ========================================================================== */
const APPLY = process.argv.includes('--apply');
const ADD_EMP_CODE = process.argv.includes('--add-emp-code');
// --map=RRD-008=22 → { 'RRD-008': 22 }
const FORCED = Object.fromEntries(process.argv
  .map((a) => a.match(/^--map=([A-Za-z0-9-]+)=(\d+)$/)).filter(Boolean).map((m) => [m[1].toUpperCase(), Number(m[2])]));
try { require('dotenv').config(); } catch (e) { /* optional */ }

// From the setup PDF. Shared Office is used by all three companies (company_id NULL).
const SITES = [
  { code: 'SHARED-OFFICE', name: 'Shared Office', type: 'OFFICE', company: null, label: 'Chennai', lat: 12.917487, lng: 80.255264, radius: 50 },
  { code: 'BAYFRONT', name: 'Bayfront', type: 'PROJECT', company: 1, label: 'Muthukadu, ECR', lat: 12.830352, lng: 80.246049, radius: 200 },
  { code: 'BAY-ROYALE', name: 'Bay Royale', type: 'PROJECT', company: 1, label: 'Muthukadu, ECR', lat: 12.830893, lng: 80.244272, radius: 200 },
  { code: 'BANYAN-BAY', name: 'Banyan Bay', type: 'PROJECT', company: 1, label: 'ECR, Chennai', lat: 12.8360817, lng: 80.246666, radius: 200 },
  { code: 'AZURE-BAY', name: 'Azure Bay', type: 'PROJECT', company: 1, label: 'ECR, Chennai', lat: 12.711832, lng: 80.220923, radius: 200 },
  { code: 'ARANYA-FARMS', name: 'Aranya Farms', type: 'PROJECT', company: 1, label: 'South ECR, near Mahabalipuram', lat: 12.5488213, lng: 80.1313545, radius: 200 },
];

// The 7 field / multi-site employees (office OR any project site)
// `names` = other spellings used for the name fallback
const FIELD_STAFF = [
  { code: 'FTO-007', name: 'R Praveen Thomso', names: ['Praveen Thomso', 'Praveen'] },
  { code: 'FTO-009', name: 'S Eshwar', names: ['Eshwar'] },
  { code: 'RRD-001', name: 'S Saravanan', names: ['Saravanan'] },
  { code: 'RRD-002', name: 'Manikandan', names: [] },
  { code: 'RRD-007', name: 'Suman Kumar', names: ['Suman'] },
  { code: 'RRD-006', name: 'Venkatachalam', names: ['Venkatachalapathy', 'Venkat'] },
  { code: 'RRD-008', name: 'Sabapathi (Harish)', names: ['Sabapathi', 'Harish'] },
];

// Columns that may hold the employee code, in order of preference
const CODE_COLUMNS = ['emp_code', 'employee_code', 'employee_id', 'emp_id', 'emp_no', 'employee_no', 'empid', 'staff_id', 'code', 'biometric_id'];
const normCode = (v) => String(v ?? '').toUpperCase().replace(/[\s_]/g, '').replace(/^([A-Z]+)(\d)/, '$1-$2');
const words = (v) => String(v || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean);
const LOOKS_LIKE_CODE = /^[A-Z]{2,5}-\d{1,5}$/;

/**
 * Finds one field employee in the users rows.
 * Returns { row, how } or { row: null, how, candidates }.
 */
function findEmployee(f, users, codeCols) {
  if (FORCED[f.code]) {
    const row = users.find((u) => Number(u.id) === FORCED[f.code]);
    return row ? { row, how: `--map id ${row.id}` } : { row: null, how: `--map id ${FORCED[f.code]} does not exist` };
  }
  for (const col of codeCols) {
    const hits = users.filter((u) => normCode(u[col]) === f.code);
    if (hits.length === 1) return { row: hits[0], how: `${col} = ${hits[0][col]}` };
    if (hits.length > 1) return { row: null, how: `${hits.length} users share ${col} ${f.code}`, candidates: hits };
  }
  // Name: exact (ignoring case, punctuation and initials in brackets), then all words of a spelling
  const spellings = [f.name, ...(f.names || [])].map(words).filter((w) => w.length);
  const fullKey = (u) => words(u.name).join(' ');
  for (const sp of spellings) {
    const hits = users.filter((u) => fullKey(u) === sp.join(' '));
    if (hits.length === 1) return { row: hits[0], how: `name "${hits[0].name}"` };
  }
  for (const sp of spellings) {
    const long = sp.filter((w) => w.length > 1);
    if (!long.length) continue;
    const hits = users.filter((u) => { const uw = words(u.name); return long.every((w) => uw.includes(w)); });
    if (hits.length === 1) return { row: hits[0], how: `name "${hits[0].name}" (partial match, please confirm)` };
    if (hits.length > 1) return { row: null, how: `name "${sp.join(' ')}" matches ${hits.length} users`, candidates: hits };
  }
  return { row: null, how: 'no code or name match' };
}

const MYSQL_TABLES = {
  sites: `CREATE TABLE sites (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id INT NULL,                        -- NULL = shared by all companies
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    site_type ENUM('OFFICE','PROJECT') NOT NULL,
    location_label VARCHAR(160) NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    radius_m SMALLINT UNSIGNED NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_sites_type (site_type, is_active)
  )`,
  site_visits: `CREATE TABLE site_visits (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    site_id INT NOT NULL,
    visit_date DATE NOT NULL,                   -- India date of entry
    entered_at DATETIME NOT NULL,               -- UTC
    exited_at DATETIME NULL,                    -- UTC, NULL while inside
    dwell_seconds INT UNSIGNED NULL,
    entry_lat DECIMAL(10,7) NULL,
    entry_lng DECIMAL(10,7) NULL,
    entry_accuracy_m SMALLINT UNSIGNED NULL,
    exit_lat DECIMAL(10,7) NULL,
    exit_lng DECIMAL(10,7) NULL,
    last_inside_at DATETIME NULL,               -- last GPS point inside the site
    exit_pending_since DATETIME NULL,           -- first point clearly outside
    entry_source ENUM('CHECK_IN','MANUAL','AUTO') NOT NULL,
    exit_reason ENUM('MANUAL','GEOFENCE','NEW_SITE','CHECK_OUT','STALE','END_OF_DAY') NULL,
    KEY idx_visits_open (user_id, exited_at),
    KEY idx_visits_day (visit_date, site_id),
    KEY idx_visits_user_day (user_id, visit_date)
  )`,
  location_pings: `CREATE TABLE location_pings (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    recorded_at DATETIME NOT NULL,              -- device time (UTC), ordering only
    received_at DATETIME NOT NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    accuracy_m SMALLINT UNSIGNED NULL,
    is_mock TINYINT(1) NOT NULL DEFAULT 0,
    matched_site_id INT NULL,
    KEY idx_pings_user_time (user_id, recorded_at)
  )`,
  adhoc_visits: `CREATE TABLE adhoc_visits (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    visit_date DATE NOT NULL,
    started_at DATETIME NOT NULL,
    ended_at DATETIME NULL,
    gps_lat DECIMAL(10,7) NOT NULL,
    gps_lng DECIMAL(10,7) NOT NULL,
    gps_accuracy_m SMALLINT UNSIGNED NULL,
    location_source ENUM('CURRENT','MANUAL_PIN') NOT NULL,
    pin_lat DECIMAL(10,7) NULL,
    pin_lng DECIMAL(10,7) NULL,
    pin_distance_m INT UNSIGNED NULL,
    reason VARCHAR(500) NOT NULL,
    photo_storage ENUM('DB','S3') NOT NULL,
    photo_key VARCHAR(255) NULL,
    photo_mime VARCHAR(40) NOT NULL,
    photo_taken_at DATETIME NULL,
    status ENUM('SUBMITTED','VERIFIED','FLAGGED') NOT NULL DEFAULT 'SUBMITTED',
    review_note VARCHAR(300) NULL,
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    KEY idx_adhoc_user_day (user_id, visit_date),
    KEY idx_adhoc_status (status, visit_date)
  )`,
  adhoc_photos: `CREATE TABLE adhoc_photos (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    adhoc_visit_id BIGINT NOT NULL UNIQUE,
    mime VARCHAR(40) NOT NULL,
    data MEDIUMBLOB NOT NULL
  )`,
  notifications: `CREATE TABLE notifications (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    recipient_id INT NOT NULL,
    type VARCHAR(30) NOT NULL,                  -- SITE_ENTRY, SITE_EXIT, ADHOC_VISIT, VISIT_FLAGGED
    title VARCHAR(160) NOT NULL,
    body VARCHAR(500) NULL,
    ref_table VARCHAR(30) NULL,
    ref_id BIGINT NULL,
    created_at DATETIME NOT NULL,
    read_at DATETIME NULL,
    KEY idx_notif_recipient (recipient_id, created_at)
  )`,
};

const MYSQL_COLUMNS = {
  users: { attendance_mode: "ENUM('OFFICE','FIELD') NOT NULL DEFAULT 'OFFICE'" },
  attendance: {
    check_in_at: 'DATETIME NULL',
    check_out_at: 'DATETIME NULL',
    mode: "VARCHAR(12) NULL",                   // OFFICE, SITE, ADHOC, WFH, OD, REMOTE
    site_id: 'INT NULL',
    accuracy_m: 'SMALLINT UNSIGNED NULL',
    check_out_lat: 'DECIMAL(10,7) NULL',
    check_out_lng: 'DECIMAL(10,7) NULL',
  },
};

// SQLite equivalents, used only by the automated tests (HRMS_TEST_SQLITE)
const toSqlite = (ddl) => ddl
  .replace(/\s*--[^\n]*/g, '')
  .replace(/^\s*KEY [^\n]*$/gm, '')
  .replace(/,(\s*)\)\s*$/, '$1)')
  .replace(/INT NOT NULL AUTO_INCREMENT PRIMARY KEY|BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY/g, 'INTEGER PRIMARY KEY')
  .replace(/ENUM\([^)]*\)/g, 'TEXT')
  .replace(/ ON UPDATE CURRENT_TIMESTAMP/g, '')
  .replace(/MEDIUMBLOB/g, 'BLOB')
  .replace(/UNSIGNED /g, '');

/* ---- Tables that already existed with a different layout --------------------------------
   Nothing is renamed or dropped: the columns this feature needs are added next to the old
   ones, and filled from the old ones (e.g. sites.code from sites.site_code). */
// Column list of one of our CREATE TABLE statements: [{ name, def }]
const ddlColumns = (ddl) => ddl.split('\n').slice(1)
  .map((l) => l.replace(/--.*$/, '').trim().replace(/,$/, ''))
  .filter((l) => l && !/^(KEY|UNIQUE KEY|PRIMARY KEY|\))/i.test(l))
  .map((l) => { const [name, ...rest] = l.split(/\s+/); return { name, def: rest.join(' ') }; })
  .filter((c) => c.name !== 'id');
// Same column, safe to add to a table that already has rows
const relaxDef = (def) => def.replace(/\bNOT NULL\b/i, 'NULL').replace(/\s+UNIQUE\b/i, '').replace(/\s+ON UPDATE CURRENT_TIMESTAMP/i, '');
// Old column names an existing sites table may use for each of our columns
const SITE_ALIASES = {
  code: ['site_code', 'sitecode', 'short_code'],
  name: ['site_name', 'sitename', 'title', 'label'],
  site_type: ['type', 'category', 'kind'],
  latitude: ['lat', 'site_latitude', 'site_lat'],
  longitude: ['lng', 'lon', 'long', 'site_longitude', 'site_lng'],
  radius_m: ['radius', 'site_radius', 'geofence_radius', 'radius_meters', 'radius_in_m'],
  location_label: ['location', 'address', 'city', 'area'],
  is_active: ['active', 'enabled', 'status'],
  company_id: ['companyid', 'company'],
};
const truthy = (v) => v === 1 || v === true || /^(1|true|yes|y|active|enabled)$/i.test(String(v ?? '').trim());
const fillerFor = (col) => {
  if (/int|decimal|float|double|bit|bool|real/.test(col.type)) return 0;
  if (/^date$/.test(col.type)) return new Date().toISOString().slice(0, 10);
  if (/datetime|timestamp/.test(col.type)) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  const en = col.type.match(/^enum\('([^']*)'/);
  return en ? en[1] : '';
};

async function connect() {
  if (process.env.HRMS_TEST_SQLITE) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.HRMS_TEST_SQLITE);
    return {
      kind: 'sqlite',
      tables: async () => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
      columns: async (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name),
      columnInfo: async (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => ({ name: c.name, rawType: c.type || 'TEXT', type: String(c.type || '').toLowerCase(), required: !!c.notnull && c.dflt_value === null && !c.pk })),
      q: async (sql, p = []) => (/^\s*select/i.test(sql) ? db.prepare(sql).all(...p) : db.prepare(sql).run(...p)),
      exec: async (sql) => db.exec(toSqlite(sql)),
      close: async () => db.close(),
    };
  }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || 'hrms@2026',
    database: process.env.DB_NAME || 'hrms',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined, dateStrings: true,
  });
  return {
    kind: 'mysql',
    tables: async () => (await conn.query('SHOW TABLES'))[0].map((r) => Object.values(r)[0]),
    columns: async (t) => (await conn.query(`SHOW COLUMNS FROM \`${t}\``))[0].map((r) => r.Field),
    columnInfo: async (t) => (await conn.query(`SHOW COLUMNS FROM \`${t}\``))[0].map((r) => ({
      name: r.Field, rawType: r.Type, type: String(r.Type).toLowerCase(), required: r.Null === 'NO' && r.Default === null && !/auto_increment/i.test(r.Extra) && r.Key !== 'PRI',
    })),
    q: async (sql, p = []) => (await conn.query(sql, p))[0],
    exec: async (sql) => conn.query(sql),
    close: async () => conn.end(),
  };
}

(async () => {
  const db = await connect();
  console.log(`\nField attendance migration — ${APPLY ? 'APPLY' : 'PREVIEW (no changes)'}  [${db.kind}]\n`);

  const existing = new Set(await db.tables());
  const newTables = Object.keys(MYSQL_TABLES).filter((t) => !existing.has(t));
  console.log(`Tables to create: ${newTables.length ? newTables.join(', ') : 'none (all exist)'}`);

  const addCols = [];
  for (const [table, cols] of Object.entries(MYSQL_COLUMNS)) {
    const have = new Set(await db.columns(table));
    Object.entries(cols).forEach(([c, def]) => { if (!have.has(c)) addCols.push({ table, c, def }); });
  }
  console.log(`Columns to add: ${addCols.length ? addCols.map((x) => `${x.table}.${x.c}`).join(', ') : 'none'}`);

  // Tables that existed before with another layout: add what is missing next to the old columns
  const reconcile = [];
  for (const t of Object.keys(MYSQL_TABLES).filter((x) => existing.has(x))) {
    const info = await db.columnInfo(t);
    const haveNames = new Set(info.map((c) => c.name));
    // created_at / updated_at are bookkeeping only: not added to an older table
    const missingCols = ddlColumns(MYSQL_TABLES[t]).filter((c) => !haveNames.has(c.name) && !['created_at', 'updated_at'].includes(c.name));
    const ours = new Set(ddlColumns(MYSQL_TABLES[t]).map((c) => c.name));
    const ourDefs = Object.fromEntries(ddlColumns(MYSQL_TABLES[t]).map((c) => [c.name, c.def]));
    // Required in the old table but not filled by this feature (old columns, or ours that we leave empty, e.g. company_id of the shared office)
    const legacyRequired = info.filter((c) => c.required && c.name !== 'id' && (!ours.has(c.name) || !/NOT NULL/i.test(ourDefs[c.name])));
    if (missingCols.length || legacyRequired.length) reconcile.push({ table: t, info, missingCols, legacyRequired });
  }
  reconcile.forEach((r) => {
    console.log(`Existing table "${r.table}" has a different layout:`);
    if (r.missingCols.length) {
      console.log(`  columns to add: ${r.missingCols.map((c) => {
        const from = r.table === 'sites' && (SITE_ALIASES[c.name] || []).find((a) => r.info.some((i) => i.name === a));
        return from ? `${c.name} (from ${from})` : c.name;
      }).join(', ')}`);
    }
    if (r.legacyRequired.length) {
      console.log(`  old required columns: ${r.legacyRequired.map((c) => c.name).join(', ')} (will be made optional; nothing in the HRMS writes them)`);
    }
  });

  console.log('\nSites (insert or update by code):');
  SITES.forEach((s) => console.log(`  ${s.code.padEnd(14)} ${s.name.padEnd(14)} ${s.type.padEnd(8)} ${s.lat}, ${s.lng}  r=${s.radius} m`));

  // Which users columns can hold the employee code? (The table differs between databases.)
  const userCols = await db.columns('users');
  const codeCols = CODE_COLUMNS.filter((c) => userCols.includes(c));
  const users = await db.q('SELECT * FROM users');
  // A column only counts if it actually holds codes like RRD-002 (employee_id may be a number)
  const usableCodeCols = codeCols.filter((c) => users.some((u) => LOOKS_LIKE_CODE.test(normCode(u[c]))));
  console.log(`\nEmployee code column: ${usableCodeCols.length ? usableCodeCols.join(', ') : 'none found'}`
    + `${codeCols.length > usableCodeCols.length ? ` (ignored, no codes inside: ${codeCols.filter((c) => !usableCodeCols.includes(c)).join(', ')})` : ''}`
    + `${usableCodeCols.length ? '' : ' → matching by name'}`);
  if (!userCols.includes('emp_code')) {
    console.log(`  ! users has no emp_code column. The directory, reports and payslips read it.${ADD_EMP_CODE ? ' It will be added (--add-emp-code).' : ' Re-run with --add-emp-code to add it.'}`);
  }

  console.log('');
  const staff = [];
  for (const f of FIELD_STAFF) {
    const { row, how, candidates } = findEmployee(f, users, usableCodeCols);
    staff.push({ ...f, row });
    const loginNote = row && /@pending\.local$/i.test(row.email || '') ? '  ! no login email yet: cannot use the app' : '';
    console.log(`  ${row ? '✔' : '✖'} FIELD mode: ${f.code} ${f.name.padEnd(19)} ${row ? `→ users.id ${row.id} (${how})` : `NOT FOUND: ${how}`}${loginNote}`);
    (candidates || []).slice(0, 5).forEach((c) => console.log(`        candidate: id ${c.id}, ${c.name}, ${c.email}`));
  }
  const missing = staff.filter((f) => !f.row);
  if (missing.length) {
    console.log(`\n  ${missing.length} not found. Fix the record, or point to the right user with e.g. --map=${missing[0].code}=<users.id>`);
  }

  if (!APPLY) { console.log('\nPreview only. Re-run with --apply.\n'); return db.close(); }

  for (const t of newTables) { await db.exec(MYSQL_TABLES[t]); console.log(`  + table ${t}`); }
  for (const x of addCols) {
    const def = db.kind === 'sqlite' ? x.def.replace(/ENUM\([^)]*\)/, 'TEXT').replace(/UNSIGNED /, '') : x.def;
    await db.exec(`ALTER TABLE ${x.table} ADD COLUMN ${x.c} ${def}`);
    console.log(`  + column ${x.table}.${x.c}`);
  }
  for (const r of reconcile) {
    for (const c of r.missingCols) {
      const def = relaxDef(c.def);
      await db.exec(`ALTER TABLE ${r.table} ADD COLUMN ${c.name} ${db.kind === 'sqlite' ? toSqlite(def) : def}`);
      console.log(`  + column ${r.table}.${c.name}`);
    }
  }

  // Old NOT NULL columns would block every insert from this feature: make them optional (no data changes)
  for (const r of reconcile) {
    for (const c of r.legacyRequired) {
      if (db.kind === 'sqlite') { console.log(`  ! ${r.table}.${c.name} stays required (SQLite test database)`); continue; }
      await db.exec(`ALTER TABLE \`${r.table}\` MODIFY \`${c.name}\` ${c.rawType} NULL`);
      console.log(`  ~ ${r.table}.${c.name} is now optional`);
    }
  }

  // Sites: fill our columns from the old ones, then save the 6 sites
  const siteInfo = await db.columnInfo('sites');
  const siteCols = new Set(siteInfo.map((c) => c.name));
  const aliasOf = {}; // our column -> old column present in this table
  Object.entries(SITE_ALIASES).forEach(([ours, olds]) => { const a = olds.find((o) => siteCols.has(o)); if (a) aliasOf[ours] = a; });
  const addedSiteCols = new Set((reconcile.find((r) => r.table === 'sites') || { missingCols: [] }).missingCols.map((c) => c.name));
  for (const [ours, old] of Object.entries(aliasOf)) {
    if (!addedSiteCols.has(ours)) continue;
    if (ours === 'company_id' && old !== 'companyid') continue; // "company" may hold a name, not an id
    if (ours === 'is_active') {
      for (const row of await db.q(`SELECT id, ${old} AS v FROM sites`)) await db.q('UPDATE sites SET is_active = ? WHERE id = ?', [truthy(row.v) ? 1 : 0, row.id]);
    } else if (ours === 'site_type') {
      for (const row of await db.q(`SELECT id, ${old} AS v FROM sites`)) {
        const t = String(row.v || '').toUpperCase();
        await db.q('UPDATE sites SET site_type = ? WHERE id = ?', [/OFFICE|HQ|HEAD/.test(t) ? 'OFFICE' : /SITE|PROJECT/.test(t) ? 'PROJECT' : null, row.id]);
      }
    } else {
      await db.q(`UPDATE sites SET ${ours} = ${old} WHERE ${ours} IS NULL`);
    }
    console.log(`  ✔ sites.${ours} filled from sites.${old}`);
  }

  const before = await db.q('SELECT * FROM sites');
  const lc = (v) => String(v ?? '').trim().toLowerCase();
  const matched = new Set();
  for (const s of SITES) {
    // Same site already there? by code (new or old column), then by name
    const found = before.find((r) => !matched.has(r.id) && [r.code, aliasOf.code && r[aliasOf.code]].some((v) => lc(v) === lc(s.code)))
      || before.find((r) => !matched.has(r.id) && [r.name, aliasOf.name && r[aliasOf.name]].some((v) => lc(v) === lc(s.name)));
    const companyRequired = siteInfo.some((c) => c.name === 'company_id' && c.required);
    const data = { company_id: s.company ?? (companyRequired ? 0 : null), code: s.code, name: s.name, site_type: s.type, location_label: s.label, latitude: s.lat, longitude: s.lng, radius_m: s.radius, is_active: 1 };
    // Keep the old columns in step too, in case older code reads them
    Object.entries(aliasOf).forEach(([ours, old]) => {
      if (found && (ours === 'code' || ours === 'name')) return; // an existing site keeps its old code and name
      if (ours === 'is_active') data[old] = /status/i.test(old) ? 'Active' : 1;
      else if (ours === 'site_type') data[old] = s.type;
      else if (ours !== 'company_id' || old === 'companyid') data[old] = data[ours];
    });
    if (found) {
      matched.add(found.id);
      const keys = Object.keys(data);
      await db.q(`UPDATE sites SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), found.id]);
    } else {
      siteInfo.filter((c) => c.required && c.name !== 'id' && !(c.name in data)).forEach((c) => { data[c.name] = fillerFor(c); });
      const keys = Object.keys(data);
      await db.q(`INSERT INTO sites (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => data[k]));
    }
  }
  console.log(`  ✔ ${SITES.length} sites saved (${matched.size} updated, ${SITES.length - matched.size} added)`);

  // Older rows that are not one of the 6: only kept active if they are complete
  {
    const others = before.filter((r) => !matched.has(r.id));
    for (const r of others) {
      const row = (await db.q('SELECT * FROM sites WHERE id = ?', [r.id]))[0];
      const ok = ['OFFICE', 'PROJECT'].includes(String(row.site_type || '').toUpperCase()) && Number(row.radius_m) > 0
        && Math.abs(Number(row.latitude)) > 0.0001 && Math.abs(Number(row.longitude)) > 0.0001;
      if (!ok && Number(row.is_active) === 1) {
        await db.q('UPDATE sites SET is_active = 0 WHERE id = ?', [r.id]);
        console.log(`  ! old site id ${r.id} "${row.name || row[aliasOf.name] || ''}" switched off for geofencing (missing type, radius or coordinates; edit it to use it)`);
      }
    }
  }
  for (const f of staff) if (f.row) await db.q("UPDATE users SET attendance_mode = 'FIELD' WHERE id = ?", [f.row.id]);
  console.log(`  ✔ ${staff.filter((f) => f.row).length} of ${staff.length} employees set to FIELD mode`);

  if (ADD_EMP_CODE && !userCols.includes('emp_code')) {
    await db.exec('ALTER TABLE users ADD COLUMN emp_code VARCHAR(30) NULL');
    let copied = 0;
    const src = usableCodeCols[0];
    if (src) {
      for (const u of users) {
        const code = normCode(u[src]);
        if (LOOKS_LIKE_CODE.test(code)) { await db.q('UPDATE users SET emp_code = ? WHERE id = ?', [code, u.id]); copied += 1; }
      }
    }
    for (const f of staff) if (f.row) await db.q('UPDATE users SET emp_code = ? WHERE id = ? AND emp_code IS NULL', [f.code, f.row.id]);
    console.log(`  + column users.emp_code (${copied} codes copied${src ? ` from ${src}` : ''}, field staff codes filled in)`);
  }
  console.log('\nDone. Restart the backend.\n');
  await db.close();
})().catch((e) => { console.error('✖', e.message); process.exit(1); });