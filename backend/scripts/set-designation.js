#!/usr/bin/env node
/* ==========================================================================
   Correct one employee's designation (and optionally department / company).

   Usage (from the backend folder):
     node scripts/set-designation.js                       # preview the built-in fix below
     node scripts/set-designation.js --apply               # apply it
     node scripts/set-designation.js --code FTO-004 --role "Performance Marketing Executive" [--department Marketing] [--company 2] --apply

   The designation is stored in users.role, which also drives access rights when it contains
   MD, CEO, HR or ADMIN — so those words are refused here (use the Edit screen as the group MD).
   Uses the same DB_* environment variables as the server.
   ========================================================================== */
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? String(args[i + 1] || '').trim() : ''; };

// Built-in correction: Gowtham Sethupathi A (FTO-004)
const FIX = {
  code: arg('--code') || 'FTO-004',
  role: arg('--role') || 'Performance Marketing Executive',
  department: arg('--department'),
  company: arg('--company') ? Number(arg('--company')) : null,
};

try { require('dotenv').config(); } catch (e) { /* optional */ }

async function connect() {
  if (process.env.HRMS_TEST_SQLITE) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.HRMS_TEST_SQLITE);
    return { kind: 'sqlite', q: async (sql, p = []) => (/^\s*select/i.test(sql) ? db.prepare(sql).all(...p) : db.prepare(sql).run(...p)), close: async () => db.close() };
  }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || 'hrms@2026',
    database: process.env.DB_NAME || 'hrms',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined, dateStrings: true,
  });
  return { kind: 'mysql', q: async (sql, p = []) => (await conn.query(sql, p))[0], close: async () => conn.end() };
}

(async () => {
  if (['MD', 'CEO', 'HR', 'ADMIN'].some((w) => FIX.role.toUpperCase().includes(w))) {
    console.error(`✖ "${FIX.role}" contains an access-role word (MD/CEO/HR/ADMIN). Not changed.`); process.exit(1);
  }
  const db = await connect();
  const rows = await db.q('SELECT id, emp_code, name, role, department, company_id FROM users WHERE UPPER(emp_code) = ?', [FIX.code.toUpperCase()]);
  if (!rows.length) { console.error(`✖ No employee with code ${FIX.code}`); await db.close(); process.exit(1); }
  const u = rows[0];
  const next = { role: FIX.role, department: FIX.department || u.department, company_id: FIX.company || u.company_id };
  console.log(`\n${APPLY ? 'APPLY' : 'PREVIEW'} [${db.kind}]  ${u.emp_code}  ${u.name}`);
  console.log(`  designation: ${u.role || '—'}  ->  ${next.role}`);
  console.log(`  department:  ${u.department || '—'}  ->  ${next.department || '—'}`);
  console.log(`  company:     ${u.company_id ?? '—'}  ->  ${next.company_id ?? '—'}`);
  if (!APPLY) { console.log('\nPreview only. Re-run with --apply.\n'); return db.close(); }
  await db.q('UPDATE users SET role = ?, department = ?, company_id = ? WHERE id = ?', [next.role, next.department || null, next.company_id, u.id]);
  console.log('\n✔ Updated. Refresh the portal.\n');
  await db.close();
})().catch((e) => { console.error('✖', e.message); process.exit(1); });
