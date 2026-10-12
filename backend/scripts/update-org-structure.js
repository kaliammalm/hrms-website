#!/usr/bin/env node
/* ==========================================================================
   One-time org-structure update for the HRMS database.

   What it does (in this order):
     1. Backs up users, attendance, leaves, payslips, approvals into *_bak_<timestamp> tables.
     2. Keeps md@company.com as the global MD (role MD, no company -> sees all 3 companies).
     3. Removes every account that is NOT md@company.com and NOT on the official roster,
        plus Basker (RRD-009) unconditionally, together with their attendance, leave,
        payslip and approval rows.
     4. Adds/updates every official employee from official-employees.json with exact
        name, email, emp code, designation, department and company; password = password123.
     5. Assigns leadership titles: Vasumathi -> CFO (Ram Reddy Developers; group access via
        scripts/grant-group-access.js), Vinu Karthick I -> CEO of Fractio.
     6. Confirms Stories by Varnam has no employees (on hold).

   Usage (from the backend folder):
     node scripts/update-org-structure.js            # preview only, changes nothing
     node scripts/update-org-structure.js --apply    # back up, then apply in one transaction
     node scripts/update-org-structure.js --apply --strict
          same, and fields the PDF leaves blank/Pending are cleared to match it exactly

   Restore (if ever needed), in MySQL:
     DROP TABLE users; RENAME TABLE users_bak_<timestamp> TO users;   (same for other tables)
   ========================================================================== */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
// --strict: PDF fields match exactly (blank/Pending in the PDF -> cleared), except pending login emails
const STRICT = process.argv.includes('--strict');
const ROSTER_FILE = path.join(__dirname, 'official-employees.json');

const MD_EMAIL = 'md@company.com';
const DEFAULT_PASSWORD = 'password123';
const REMOVE_ALWAYS = [{ emp_code: 'RRD-009', nameLike: 'basker' }];
const CEOS = [
  { name: 'Vinu Karthick I', companyId: 2 },
];
// Fixed titles that are not access roles (group access is granted separately)
const TITLES = [
  { name: 'Vasumathi', role: 'CFO', companyId: 1 },
];
const COMPANY_IDS = { RRD: 1, FRACTIO: 2, VARNAM: 3 };
const PRIVILEGED = ['MD', 'CEO', 'HR', 'ADMIN']; // the backend grants rights when role *contains* these
const RELATED_TABLES = ['attendance', 'leaves', 'payslips', 'approvals'];
// Extra columns the roster may carry (all optional; blank/"Pending" never overwrites)
const TEXT_FIELDS = ['address', 'pan_number', 'bank_name', 'account_number', 'ifsc_code', 'biometric_id', 'attendance_type'];
const MONEY_FIELDS = ['monthly_salary', 'hra', 'allowances', 'deductions'];

// ---------------------------------------------------------------------------
// DB adapter: MySQL (same settings as index.js, overridable via env).
// HRMS_TEST_SQLITE=<file> switches to node:sqlite for offline testing.
// ---------------------------------------------------------------------------
async function connect() {
  if (process.env.HRMS_TEST_SQLITE) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.HRMS_TEST_SQLITE);
    return {
      kind: 'sqlite',
      async q(sql, params = []) {
        const stmt = db.prepare(sql);
        if (/^\s*(select|pragma)/i.test(sql)) return stmt.all(...params);
        const r = stmt.run(...params);
        return { affectedRows: r.changes, insertId: Number(r.lastInsertRowid) };
      },
      async begin() { db.exec('BEGIN'); },
      async commit() { db.exec('COMMIT'); },
      async rollback() { db.exec('ROLLBACK'); },
      async tableExists(t) { return (await this.q("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t])).length > 0; },
      async tables() { return (await this.q("SELECT name FROM sqlite_master WHERE type='table'")).map(r => r.name); },
      async columns(t) { return (await this.q(`PRAGMA table_info(${t})`)).map(c => c.name); },
      async notNullColumns(t) { return (await this.q(`PRAGMA table_info(${t})`)).filter(c => c.notnull).map(c => c.name); },
      async close() { db.close(); },
    };
  }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'hrms@2026',
    database: process.env.DB_NAME || 'hrms',
    dateStrings: true,
  });
  return {
    kind: 'mysql',
    async q(sql, params = []) { const [rows] = await conn.query(sql, params); return rows; },
    async begin() { await conn.beginTransaction(); },
    async commit() { await conn.commit(); },
    async rollback() { await conn.rollback(); },
    async tableExists(t) { return (await this.q('SHOW TABLES LIKE ?', [t])).length > 0; },
    async tables() { return (await this.q('SHOW TABLES')).map(r => Object.values(r)[0]); },
    async columns(t) { return (await this.q(`SHOW COLUMNS FROM \`${t}\``)).map(c => c.Field); },
    async notNullColumns(t) { return (await this.q(`SHOW COLUMNS FROM \`${t}\``)).filter(c => c.Null === 'NO').map(c => c.Field); },
    async close() { await conn.end(); },
  };
}

// ---------------------------------------------------------------------------
const norm = (s) => String(s || '').trim().toLowerCase();
const isPending = (v) => v === undefined || v === null || String(v).trim() === '' || norm(v) === 'pending';
// Accepts YYYY-MM-DD or DD/MM/YYYY (as in the PDF); returns YYYY-MM-DD or null
function toIsoDate(v) {
  if (isPending(v)) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const placeholderEmail = (code) => `${code.toLowerCase()}@pending.local`;
const fail = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };

function companyIdFor(value) {
  const s = norm(value);
  if (s === '1' || s === 'rrd' || s.includes('ram reddy')) return COMPANY_IDS.RRD;
  if (s === '2' || s.includes('fractio')) return COMPANY_IDS.FRACTIO;
  if (s === '3' || s.includes('varnam') || s.includes('stories')) return COMPANY_IDS.VARNAM;
  return null;
}

function loadRoster() {
  if (!fs.existsSync(ROSTER_FILE)) fail(`Roster file not found: ${ROSTER_FILE}`);
  const data = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
  const list = Array.isArray(data) ? data : data.employees;
  if (!Array.isArray(list) || list.length === 0) fail('official-employees.json has no employees yet. Fill it from the official PDF first.');

  const problems = [];
  const seenEmail = new Set();
  const seenCode = new Set();
  const roster = list.map((e, i) => {
    const rawEmail = norm(e.email);
    const emailPending = !rawEmail || rawEmail === 'pending';
    const row = {
      name: String(e.name || '').trim(),
      email: emailPending ? null : rawEmail,
      emailPending,
      emp_code: String(e.emp_code || '').trim() || null,
      designation: String(e.designation || '').trim(),
      department: String(e.department || '').trim() || null,
      company_id: companyIdFor(e.company),
      access_role: String(e.access_role || '').trim().toUpperCase() || null,
      phone: isPending(e.phone) ? null : String(e.phone).trim(),
      dob: toIsoDate(e.dob),
      joining_date: toIsoDate(e.joining_date),
      extra: {},
    };
    // Optional profile/payroll fields: only written when a real value is supplied
    for (const f of TEXT_FIELDS) if (!isPending(e[f])) row.extra[f] = String(e[f]).trim();
    for (const f of MONEY_FIELDS) {
      if (isPending(e[f])) continue;
      const n = Number(String(e[f]).replace(/[₹,\s]/g, ''));
      if (Number.isFinite(n) && n >= 0) row.extra[f] = n; else problems.push(`#${i + 1} ${e.name}: ${f} "${e[f]}" is not a number`);
    }
    row.key = row.email || `code:${(row.emp_code || '').toUpperCase()}`;
    const tag = `#${i + 1} ${row.name || '(no name)'}`;
    if (!row.name) problems.push(`${tag}: missing name`);
    if (row.emailPending && !row.emp_code) problems.push(`${tag}: email is pending, so an emp code is required`);
    if (!row.emailPending && !row.email.includes('@')) problems.push(`${tag}: invalid email "${row.email}"`);
    if (!row.company_id) problems.push(`${tag}: unknown company "${e.company}"`);
    if (row.email && seenEmail.has(row.email)) problems.push(`${tag}: duplicate email ${row.email}`);
    if (row.emp_code && seenCode.has(row.emp_code.toUpperCase())) problems.push(`${tag}: duplicate emp code ${row.emp_code}`);
    if (row.email) seenEmail.add(row.email);
    if (row.emp_code) seenCode.add(row.emp_code.toUpperCase());

    // The app stores designation in `role`, and the backend grants rights when role CONTAINS
    // MD/CEO/HR/ADMIN. Make that explicit so nobody gets privileges by accident.
    const ceo = CEOS.find(c => norm(c.name) === norm(row.name));
    const title = TITLES.find(t => norm(t.name) === norm(row.name));
    if (title) {
      row.role = title.role;
      if (row.company_id !== title.companyId) problems.push(`${tag}: listed under company ${row.company_id}, expected company ${title.companyId}`);
    } else if (ceo) {
      row.role = 'CEO';
      if (row.company_id !== ceo.companyId) problems.push(`${tag}: listed under company ${row.company_id}, but is CEO of company ${ceo.companyId}`);
    } else if (row.access_role) {
      if (!PRIVILEGED.includes(row.access_role) && row.access_role !== 'EMPLOYEE') problems.push(`${tag}: access_role must be one of ${[...PRIVILEGED, 'EMPLOYEE'].join(', ')}`);
      row.role = row.access_role === 'EMPLOYEE' ? (row.designation || 'EMPLOYEE') : row.access_role;
    } else {
      row.role = row.designation || 'EMPLOYEE';
    }
    const upper = row.role.toUpperCase();
    const accidental = PRIVILEGED.filter(p => upper.includes(p) && upper !== p);
    if (accidental.length && row.access_role !== 'EMPLOYEE') {
      problems.push(`${tag}: designation "${row.role}" contains "${accidental.join('/')}", which the backend treats as a privileged role. Set "access_role": "${accidental[0]}" if intended, or "EMPLOYEE" to keep normal rights.`);
    }
    if (row.access_role === 'EMPLOYEE' && accidental.length) row.role = 'EMPLOYEE'; // keep normal rights; designation can't be stored safely
    if (row.email === MD_EMAIL) problems.push(`${tag}: md@company.com is managed by this script; remove it from the roster`);
    if (REMOVE_ALWAYS.some(r => (row.emp_code || '').toUpperCase() === r.emp_code || norm(row.name).includes(r.nameLike))) {
      problems.push(`${tag}: Basker (RRD-009) must not be on the active roster`);
    }
    if (row.company_id === COMPANY_IDS.VARNAM) problems.push(`${tag}: Stories by Varnam is on hold and should have no employees`);
    return row;
  });

  for (const c of CEOS) {
    if (!roster.some(r => norm(r.name) === norm(c.name))) problems.push(`CEO "${c.name}" is not on the roster (needs their email and emp code from the PDF)`);
  }
  if (problems.length) fail(`Roster has ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
  return roster;
}

async function main() {
  const roster = loadRoster();
  const db = await connect();
  const cols = await db.columns('users');
  const has = (c) => cols.includes(c);
  const notNull = new Set(await db.notNullColumns('users'));

  const users = await db.q('SELECT id, name, email, emp_code, role, company_id FROM users');
  const md = users.find(u => norm(u.email) === MD_EMAIL);
  if (!md) fail(`${MD_EMAIL} was not found in users. Aborting so the MD account is never lost.`);

  const isBasker = (u) => (u.emp_code || '').toUpperCase() === 'RRD-009' || norm(u.name).includes('basker');

  // Match existing rows to roster entries: email first, then emp code
  const matched = new Map(); // roster key -> existing user
  const claimed = new Set();
  for (const r of roster) {
    const byEmail = r.email ? users.find(u => norm(u.email) === r.email) : null;
    const byCode = !byEmail && r.emp_code ? users.find(u => (u.emp_code || '').toUpperCase() === r.emp_code.toUpperCase()) : null;
    const hit = byEmail || byCode;
    if (hit && !claimed.has(hit.id) && !isBasker(hit)) { matched.set(r.key, hit); claimed.add(hit.id); }
  }
  const keepIds = new Set([md.id, ...[...matched.values()].map(u => u.id)]);
  const toDelete = users.filter(u => isBasker(u) || !keepIds.has(u.id));
  const toUpdate = roster.filter(r => matched.has(r.key));
  const toInsert = roster.filter(r => !matched.has(r.key));
  const loginFor = (r) => r.email || (matched.get(r.key) ? `${matched.get(r.key).email} (kept; PDF email pending)` : `${placeholderEmail(r.emp_code)} (placeholder; PDF email pending)`);

  // ---- Report -------------------------------------------------------------
  const line = (u) => `  [id ${u.id}] ${u.emp_code || '—'}  ${u.name}  <${u.email}>  role=${u.role}  company=${u.company_id ?? '—'}`;
  console.log(`\nHRMS org-structure update — ${APPLY ? 'APPLY' : 'PREVIEW (no changes)'}${STRICT ? ' — STRICT PDF alignment' : ''}  [${db.kind}]\n`);
  if (STRICT) console.log('Strict: department, biometric ID, and any "Pending" phone/joining date are set exactly as in the PDF (cleared).\nPending login emails are kept so those employees are not locked out.\n');
  console.log(`MD kept as global MD: ${md.email} (company set to none -> all companies)`);
  console.log(`\nRemove ${toDelete.length} account(s) + their attendance/leave/payslip/approval rows:`);
  toDelete.forEach(u => console.log(line(u) + (isBasker(u) ? '   <- Basker (RRD-009)' : '')));
  console.log(`\nUpdate ${toUpdate.length} official account(s) (password -> ${DEFAULT_PASSWORD}):`);
  toUpdate.forEach(r => console.log(`  ${r.emp_code || '—'}  ${r.name}  <${loginFor(r)}>  role=${r.role}  company=${r.company_id}`));
  console.log(`\nCreate ${toInsert.length} official account(s) (password ${DEFAULT_PASSWORD}):`);
  toInsert.forEach(r => console.log(`  ${r.emp_code || '—'}  ${r.name}  <${loginFor(r)}>  role=${r.role}  company=${r.company_id}`));
  console.log('\nCEOs:', CEOS.map(c => `${c.name} -> company ${c.companyId}`).join(', '));
  console.log('Titles:', TITLES.map(t => `${t.name} -> ${t.role} (company ${t.companyId})`).join(', '));

  if (!APPLY) {
    console.log('\nPreview only. Re-run with --apply to back up and apply these changes.\n');
    await db.close();
    return;
  }

  // ---- Backup (DDL runs outside the transaction) --------------------------
  const existingTables = new Set(await db.tables());
  let stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  while ([...existingTables].some(t => t.endsWith(`_bak_${stamp}`))) stamp = String(Number(stamp) + 1);
  const backedUp = [];
  for (const t of ['users', ...RELATED_TABLES]) {
    if (await db.tableExists(t)) {
      await db.q(`CREATE TABLE ${t}_bak_${stamp} AS SELECT * FROM ${t}`);
      backedUp.push(`${t}_bak_${stamp}`);
    }
  }
  console.log(`\nBackups created: ${backedUp.join(', ')}`);

  // ---- Apply in one transaction -------------------------------------------
  const companies = await db.q('SELECT id, name FROM companies');
  const companyName = (id) => (companies.find(c => Number(c.id) === Number(id)) || {}).name || null;

  await db.begin();
  try {
    const delIds = toDelete.map(u => u.id);
    if (delIds.length) {
      const marks = delIds.map(() => '?').join(',');
      for (const t of RELATED_TABLES) {
        if (await db.tableExists(t)) await db.q(`DELETE FROM ${t} WHERE employee_id IN (${marks})`, delIds);
      }
      await db.q(`DELETE FROM users WHERE id IN (${marks})`, delIds);
    }

    for (const r of roster) {
      const existing = matched.get(r.key);
      const fields = { name: r.name, password: DEFAULT_PASSWORD, role: r.role, company_id: r.company_id, emp_code: r.emp_code };
      if (r.email) fields.email = r.email;
      else if (!existing) fields.email = placeholderEmail(r.emp_code);
      if (r.department) fields.department = r.department;
      else if (STRICT || !existing) fields.department = null; // PDF: department to be filled by HR
      if (has('company_name')) fields.company_name = companyName(r.company_id);
      if (has('phone') && (r.phone || STRICT)) fields.phone = r.phone || null;
      if (has('dob') && r.dob) fields.dob = r.dob;
      if (has('joining_date') && (r.joining_date || STRICT)) fields.joining_date = r.joining_date || null;
      if (STRICT && has('biometric_id') && !r.extra.biometric_id) fields.biometric_id = null; // PDF: blank
      for (const [k, v] of Object.entries(r.extra)) if (has(k)) fields[k] = v;

      // Columns that don't accept NULL get an empty value instead, so the run never aborts
      for (const k of Object.keys(fields)) if (fields[k] === null && notNull.has(k)) fields[k] = ['joining_date', 'dob'].includes(k) ? undefined : '';
      for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
      const keys = Object.keys(fields);
      if (existing) {
        await db.q(`UPDATE users SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => fields[k]), existing.id]);
      } else {
        if (has('attendance_type')) fields.attendance_type = 'OFFICE';
        const k2 = Object.keys(fields);
        await db.q(`INSERT INTO users (${k2.join(', ')}) VALUES (${k2.map(() => '?').join(', ')})`, k2.map(k => fields[k]));
      }
    }

    // Global MD: no company -> backend treats as group-wide MD
    await db.q(`UPDATE users SET role = 'MD', company_id = NULL${has('company_name') ? ', company_name = NULL' : ''} WHERE id = ?`, [md.id]);

    const varnam = await db.q('SELECT COUNT(*) AS n FROM users WHERE company_id = ?', [COMPANY_IDS.VARNAM]);
    if (Number(varnam[0].n) !== 0) throw new Error(`Stories by Varnam still has ${varnam[0].n} user(s); expected 0.`);

    await db.commit();
  } catch (err) {
    await db.rollback();
    await db.close();
    fail(`Rolled back, nothing changed (backups kept). Reason: ${err.message}`);
  }

  const summary = await db.q('SELECT company_id, COUNT(*) AS n FROM users GROUP BY company_id ORDER BY company_id');
  console.log('\n✔ Done. Users per company:', summary.map(s => `${s.company_id ?? 'none (MD)'}: ${s.n}`).join(', '));
  const gaps = await db.q(`SELECT
      SUM(CASE WHEN COALESCE(monthly_salary,0) = 0 THEN 1 ELSE 0 END) AS noSalary,
      SUM(CASE WHEN bank_name IS NULL OR bank_name = '' THEN 1 ELSE 0 END) AS noBank,
      SUM(CASE WHEN email LIKE '%@pending.local' THEN 1 ELSE 0 END) AS noLogin
    FROM users WHERE UPPER(COALESCE(role,'')) <> 'MD'`);
  const g = gaps[0] || {};
  console.log(`  All official accounts now sign in with: ${DEFAULT_PASSWORD}`);
  console.log(`  Still missing (not in the PDF): salary for ${Number(g.noSalary) || 0}, bank details for ${Number(g.noBank) || 0}, login email for ${Number(g.noLogin) || 0} employee(s).\n`);
  await db.close();
}

main().catch((err) => fail(err.message));
