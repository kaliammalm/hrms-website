#!/usr/bin/env node
/* Adds the optional employee profile columns the portal can edit (if they are missing):
   Aadhaar, ESI, gender, blood group, emergency contact name/phone, reporting manager,
   and for Employee Management v2: reporting manager link, employment type, attendance mode,
   exit date, UAN, PF number, account holder name, bank branch.
   Safe to run more than once (also safe after add-payroll.js / add-field-attendance.js).
   For Aiven / live: set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME=hrms, DB_SSL=true first.
   Usage (from the backend folder):
     node scripts/add-profile-columns.js            # preview
     node scripts/add-profile-columns.js --apply    # add missing columns            */
const APPLY = process.argv.includes('--apply');
try { require('dotenv').config(); } catch (e) { /* optional */ }
const COLUMNS = [
  ['aadhar_number', 'VARCHAR(20) NULL'],
  ['esi_number', 'VARCHAR(30) NULL'],
  ['gender', 'VARCHAR(20) NULL'],
  ['blood_group', 'VARCHAR(10) NULL'],
  ['emergency_contact_name', 'VARCHAR(120) NULL'],
  ['emergency_contact_phone', 'VARCHAR(30) NULL'],
  ['reporting_manager', 'VARCHAR(120) NULL'],
  ['reporting_manager_id', 'INT NULL'],
  ['employment_type', 'VARCHAR(30) NULL'],
  ['attendance_mode', "VARCHAR(10) NOT NULL DEFAULT 'OFFICE'"],
  ['exit_date', 'DATE NULL'],
  ['uan', 'VARCHAR(20) NULL'],
  ['pf_number', 'VARCHAR(40) NULL'],
  ['account_holder_name', 'VARCHAR(120) NULL'],
  ['bank_branch', 'VARCHAR(120) NULL'],
];
(async () => {
  let q, existing, close;
  if (process.env.HRMS_TEST_SQLITE) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.HRMS_TEST_SQLITE);
    existing = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    q = async (sql) => db.exec(sql.replace(/VARCHAR\(\d+\)/, 'TEXT').replace(/\bINT\b/, 'INTEGER')); close = async () => db.close();
  } else {
    const mysql = require('mysql2/promise');
    const host = process.env.DB_HOST || 'localhost';
    console.log(`\nDatabase: ${process.env.DB_NAME || 'hrms'} on ${host}:${process.env.DB_PORT || 3306}${['localhost', '127.0.0.1'].includes(host) ? '   <-- LOCAL database' : ''}`);
    const conn = await mysql.createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || 'hrms@2026', database: process.env.DB_NAME || 'hrms',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
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
