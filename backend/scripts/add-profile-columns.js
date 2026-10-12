#!/usr/bin/env node
/* Adds the optional employee profile columns the portal can edit (if they are missing):
   Aadhaar, ESI, gender, blood group, emergency contact name/phone, reporting manager.
   Safe to run more than once. Usage (from the backend folder):
     node scripts/add-profile-columns.js            # preview
     node scripts/add-profile-columns.js --apply    # add missing columns            */
const APPLY = process.argv.includes('--apply');
const COLUMNS = [
  ['aadhar_number', 'VARCHAR(20) NULL'],
  ['esi_number', 'VARCHAR(30) NULL'],
  ['gender', 'VARCHAR(20) NULL'],
  ['blood_group', 'VARCHAR(10) NULL'],
  ['emergency_contact_name', 'VARCHAR(120) NULL'],
  ['emergency_contact_phone', 'VARCHAR(30) NULL'],
  ['reporting_manager', 'VARCHAR(120) NULL'],
];
(async () => {
  let q, existing, close;
  if (process.env.HRMS_TEST_SQLITE) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.HRMS_TEST_SQLITE);
    existing = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    q = async (sql) => db.exec(sql.replace(/VARCHAR\(\d+\)/, 'TEXT')); close = async () => db.close();
  } else {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || 'hrms@2026', database: process.env.DB_NAME || 'hrms' });
    existing = (await conn.query('SHOW COLUMNS FROM users'))[0].map(c => c.Field);
    q = async (sql) => conn.query(sql); close = async () => conn.end();
  }
  const missing = COLUMNS.filter(([c]) => !existing.includes(c));
  if (!missing.length) { console.log('\n✔ All profile columns already exist. Nothing to do.\n'); return close(); }
  console.log(`\n${APPLY ? 'Adding' : 'Would add'}: ${missing.map(([c]) => c).join(', ')}`);
  if (APPLY) {
    for (const [c, def] of missing) await q(`ALTER TABLE users ADD COLUMN ${c} ${def}`);
    console.log('✔ Done. These fields can now be edited and saved in Employees Management.\n');
  } else console.log('Preview only. Re-run with --apply.\n');
  await close();
})().catch((e) => { console.error('✖', e.message); process.exit(1); });
