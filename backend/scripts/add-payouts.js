#!/usr/bin/env node
/* ==========================================================================
   Salary payouts: database migration (MySQL; safe to re-run, nothing is dropped).
   Needs the payroll tables (scripts/add-payroll.js) first.

   Creates
     payout_beneficiaries   one row per employee bank account registered with the provider
                            (contact + fund account ids, penny-drop result, name match)
     payout_batches         one transfer batch per approved pay run (maker → checker → sent)
     payout_items           one transfer per employee, with its idempotency key and bank status
     payout_events          webhook events already handled (duplicates are ignored)
     payout_2fa             authenticator-app secrets of the people who release salaries (encrypted)
     payout_audit           append-only log: who prepared, approved, cancelled, retried what

   Usage (backend folder; same DB_* variables as the server):
     node scripts/add-payouts.js            # preview
     node scripts/add-payouts.js --apply
   ========================================================================== */
const APPLY = process.argv.includes('--apply');
try { require('dotenv').config(); } catch (e) { /* optional */ }

const TABLES = {
  payout_beneficiaries: `CREATE TABLE payout_beneficiaries (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    provider VARCHAR(20) NOT NULL,
    fingerprint VARCHAR(40) NOT NULL,
    account_last4 VARCHAR(4) NOT NULL,
    ifsc VARCHAR(11) NOT NULL,
    holder_name VARCHAR(120) NOT NULL,
    contact_id VARCHAR(40) NULL,
    fund_account_id VARCHAR(40) NULL,
    validation_id VARCHAR(40) NULL,
    validation_status VARCHAR(12) NOT NULL DEFAULT 'none',
    registered_name VARCHAR(160) NULL,
    name_match INT NULL,
    override_by INT NULL,
    override_reason VARCHAR(200) NULL,
    verified_at DATETIME NULL,
    eligible_from DATETIME NULL,
    last_error VARCHAR(255) NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uniq_benef (provider, user_id, fingerprint),
    KEY idx_benef_fa (fund_account_id)
  )`,
  payout_batches: `CREATE TABLE payout_batches (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    run_id INT NOT NULL,
    provider VARCHAR(20) NOT NULL,
    live TINYINT(1) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL',
    item_count INT NOT NULL DEFAULT 0,
    total_paise BIGINT NOT NULL DEFAULT 0,
    checksum VARCHAR(64) NOT NULL,
    prepared_by INT NOT NULL,
    prepared_at DATETIME NOT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    cancelled_by INT NULL,
    cancelled_at DATETIME NULL,
    completed_at DATETIME NULL,
    lock_owner VARCHAR(40) NULL,
    lock_until DATETIME NULL,
    note VARCHAR(255) NULL,
    KEY idx_batch_run (run_id)
  )`,
  payout_items: `CREATE TABLE payout_items (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    run_id INT NOT NULL,
    run_item_id INT NOT NULL,
    active_run_item INT NULL,
    user_id INT NOT NULL,
    beneficiary_id INT NOT NULL,
    emp_name VARCHAR(120) NULL,
    account_last4 VARCHAR(4) NULL,
    amount_paise BIGINT NOT NULL,
    mode VARCHAR(6) NOT NULL,
    reference_id VARCHAR(40) NOT NULL,
    idempotency_key VARCHAR(36) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'ready',
    provider_payout_id VARCHAR(40) NULL,
    utr VARCHAR(40) NULL,
    failure_reason VARCHAR(255) NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_attempt_at DATETIME NULL,
    processed_at DATETIME NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uniq_idem (idempotency_key),
    UNIQUE KEY uniq_active_item (active_run_item),
    UNIQUE KEY uniq_provider_payout (provider_payout_id),
    KEY idx_pi_batch (batch_id)
  )`,
  payout_events: `CREATE TABLE payout_events (
    event_id VARCHAR(64) NOT NULL PRIMARY KEY,
    event VARCHAR(40) NOT NULL,
    received_at DATETIME NOT NULL
  )`,
  payout_2fa: `CREATE TABLE payout_2fa (
    user_id INT NOT NULL PRIMARY KEY,
    secret_enc VARCHAR(255) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    last_step BIGINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL
  )`,
  payout_audit: `CREATE TABLE payout_audit (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    at DATETIME NOT NULL,
    user_id INT NULL,
    action VARCHAR(40) NOT NULL,
    company_id INT NULL,
    batch_id INT NULL,
    details VARCHAR(1000) NULL,
    ip VARCHAR(64) NULL,
    KEY idx_audit_batch (batch_id)
  )`,
};

const toSqlite = (ddl) => ddl
  .replace(/^\s*(UNIQUE )?KEY [^\n]*$/gm, '')
  .replace(/,(\s*)\)\s*$/, '$1)')
  .replace(/INT NOT NULL AUTO_INCREMENT PRIMARY KEY/g, 'INTEGER PRIMARY KEY')
  .replace(/TINYINT\(1\)/g, 'INTEGER');
const indexesFor = (name, ddl) => [...ddl.matchAll(/^\s*(UNIQUE )?KEY (\w+) \(([^)]+)\)/gm)]
  .map((m) => `CREATE ${m[1] ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${m[2]} ON ${name}(${m[3]})`);

async function connect() {
  if (process.env.HRMS_TEST_SQLITE) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.HRMS_TEST_SQLITE);
    return {
      kind: 'sqlite',
      tables: async () => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
      exec: async (sql, name) => { db.exec(toSqlite(sql)); indexesFor(name, sql).forEach((i) => db.exec(i)); },
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
    exec: async (sql) => conn.query(sql),
    close: async () => conn.end(),
  };
}

(async () => {
  const db = await connect();
  console.log(`\nSalary payouts migration — ${APPLY ? 'APPLY' : 'PREVIEW (no changes)'}  [${db.kind}]`);
  if (db.kind === 'mysql') {
    const host = process.env.DB_HOST || 'localhost';
    console.log(`Database: ${process.env.DB_NAME || 'hrms'} on ${host}:${process.env.DB_PORT || 3306}${host === 'localhost' || host === '127.0.0.1' ? '   <-- LOCAL database. For the live site set DB_HOST etc. to the Aiven values first.' : ''}`);
  }
  const existing = new Set(await db.tables());
  if (!existing.has('pay_runs')) { console.log('\nPayroll tables are missing. Run scripts/add-payroll.js --apply first.\n'); return db.close(); }
  const newTables = Object.keys(TABLES).filter((t) => !existing.has(t));
  console.log(`Tables to create: ${newTables.length ? newTables.join(', ') : 'none (all exist)'}`);
  if (!APPLY) { console.log('\nPreview only. Re-run with --apply.\n'); return db.close(); }
  for (const t of newTables) { await db.exec(TABLES[t], t); console.log(`  + table ${t}`); }
  console.log('\nDone.\n');
  await db.close();
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
