#!/usr/bin/env node
/* Read-only health check for the HRMS database. Changes nothing.
   Usage (from the backend folder):  node scripts/check-hrms-data.js            */
const fs = require('fs');
const path = require('path');

async function connect() {
  if (process.env.HRMS_TEST_SQLITE) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.HRMS_TEST_SQLITE);
    return { q: async (sql, p = []) => db.prepare(sql).all(...p), close: async () => db.close(),
      tables: async () => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name) };
  }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'hrms@2026', database: process.env.DB_NAME || 'hrms', dateStrings: true,
  });
  return { q: async (sql, p = []) => (await conn.query(sql, p))[0], close: async () => conn.end(),
    tables: async () => (await conn.query('SHOW TABLES'))[0].map(r => Object.values(r)[0]) };
}

(async () => {
  const db = await connect();
  const ok = (b) => (b ? '✔' : '✖');
  const tables = await db.tables();
  const backups = tables.filter(t => /^users_bak_\d+$/.test(t)).sort();

  console.log('\nHRMS data check\n');
  console.log(`• Backup tables: ${backups.length ? backups.length + ' (latest ' + backups[backups.length - 1] + ')' : 'none'}`);

  const md = (await db.q("SELECT id, email, role, company_id FROM users WHERE LOWER(email) = 'md@company.com'"))[0];
  const mdGlobal = md && String(md.role).toUpperCase() === 'MD' && (!md.company_id || Number(md.company_id) === 0);
  console.log(`${ok(mdGlobal)} MD account: ${md ? `role=${md.role}, company_id=${md.company_id ?? 'NULL'}${mdGlobal ? ' (group-wide)' : ' — must be role MD with no company to see all 3 companies'}` : 'md@company.com NOT FOUND'}`);

  const perCo = await db.q("SELECT company_id, COUNT(*) AS n FROM users WHERE UPPER(COALESCE(role,'')) <> 'MD' GROUP BY company_id ORDER BY company_id");
  const count = (id) => Number((perCo.find(r => String(r.company_id) === String(id)) || {}).n || 0);
  const total = perCo.reduce((s, r) => s + Number(r.n), 0);
  console.log(`${ok(total === 19)} People on the roster (excluding the MD account): ${total}  ->  RRD ${count(1)}, Fractio ${count(2)}, Varnam ${count(3)}${perCo.some(r => ![1, 2, 3].includes(Number(r.company_id))) ? ', other/none ' + perCo.filter(r => ![1, 2, 3].includes(Number(r.company_id))).reduce((s, r) => s + Number(r.n), 0) : ''}`);

  const rosterFile = path.join(__dirname, 'official-employees.json');
  if (fs.existsSync(rosterFile)) {
    const roster = (JSON.parse(fs.readFileSync(rosterFile, 'utf8')).employees || []);
    const codes = new Set((await db.q('SELECT emp_code FROM users')).map(r => String(r.emp_code || '').toUpperCase()));
    const missing = roster.filter(e => !codes.has(String(e.emp_code).toUpperCase())).map(e => e.emp_code);
    console.log(`${ok(roster.length && !missing.length)} Roster file: ${roster.length} employees; ${missing.length ? 'missing in DB: ' + missing.join(', ') : 'all present in DB'}`);
  }
  const basker = await db.q("SELECT id FROM users WHERE UPPER(COALESCE(emp_code,'')) = 'RRD-009' OR LOWER(name) LIKE '%basker%'");
  console.log(`${ok(!basker.length)} Basker (RRD-009): ${basker.length ? 'STILL PRESENT' : 'removed'}`);

  const ceos = await db.q("SELECT name, company_id FROM users WHERE UPPER(role) = 'CEO'");
  console.log(`• CEOs: ${ceos.map(c => `${c.name} (company ${c.company_id})`).join(', ') || 'none'}`);
  const cols = (await db.q('SELECT * FROM users LIMIT 1'))[0] || {};
  if ('group_access' in cols) {
    const group = await db.q('SELECT name, role FROM users WHERE group_access = 1');
    const regular = Number((await db.q("SELECT COUNT(*) AS n FROM users WHERE UPPER(COALESCE(role,'')) <> 'MD' AND COALESCE(group_access,0) = 0"))[0].n);
    console.log(`• Regular employees (directory and headcount): ${regular}`);
    console.log(`• Group access (all companies, not counted as employees): ${group.map(g => `${g.name} (${g.role})`).join(', ') || 'nobody'}`);
  } else console.log('• Group access not set up yet: run node scripts/grant-group-access.js --apply');

  const gaps = (await db.q(`SELECT
      SUM(CASE WHEN COALESCE(monthly_salary,0) = 0 THEN 1 ELSE 0 END) AS noSalary,
      SUM(CASE WHEN bank_name IS NULL OR bank_name = '' THEN 1 ELSE 0 END) AS noBank,
      SUM(CASE WHEN email LIKE '%@pending.local' THEN 1 ELSE 0 END) AS noLogin
    FROM users WHERE UPPER(COALESCE(role,'')) <> 'MD'`))[0] || {};
  console.log(`• Not in the PDF, still to enter: salary ${Number(gaps.noSalary) || 0}, bank details ${Number(gaps.noBank) || 0}, login email ${Number(gaps.noLogin) || 0}`);
  const activity = [];
  for (const t of ['attendance', 'leaves', 'payslips', 'approvals']) {
    if (tables.includes(t)) activity.push(`${t} ${Number((await db.q(`SELECT COUNT(*) AS n FROM ${t}`))[0].n)}`);
  }
  console.log(`• Activity rows: ${activity.join(', ')}`);
  console.log('\nIf everything above is ✔ but the portal shows 0: sign out and sign in again (sessions expire after 1 day), and restart the backend so the updated routes.js is loaded.\n');
  await db.close();
})().catch((e) => { console.error('✖ Check failed:', e.message); process.exit(1); });
