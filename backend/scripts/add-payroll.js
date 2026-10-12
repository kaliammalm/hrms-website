#!/usr/bin/env node
/* ==========================================================================
   Payroll module: database migration (MySQL; safe to re-run, nothing is dropped).

   Creates
     pay_settings      statutory settings per company (PF, ESI, PT, structure %, bank debit account)
     pt_slabs          professional tax slabs per state (Tamil Nadu / Chennai seeded)
     pay_structures    salary structure per employee, dated (effective_from)
     pay_runs          one payroll run per company per month: DRAFT → APPROVED → PAID
     pay_run_items     one payslip per employee per run (all figures frozen at approval)
   Adds to users
     uan, pf_number, esi_number, account_holder_name, bank_branch, exit_date
   Seeds
     pay_settings for every company, TN professional tax slabs, and a salary structure for every
     employee who has salary figures in users (monthly_salary → Basic, hra → HRA, allowances → Special).

   Usage (backend folder; same DB_* variables as the server):
     node scripts/add-payroll.js            # preview
     node scripts/add-payroll.js --apply
   ========================================================================== */
const APPLY = process.argv.includes('--apply');
try { require('dotenv').config(); } catch (e) { /* optional */ }

const TABLES = {
  pay_settings: `CREATE TABLE pay_settings (
    company_id INT NOT NULL PRIMARY KEY,
    pf_enabled TINYINT(1) NOT NULL DEFAULT 1,
    pf_ee_rate DECIMAL(5,2) NOT NULL DEFAULT 12.00,
    pf_er_rate DECIMAL(5,2) NOT NULL DEFAULT 12.00,
    eps_rate DECIMAL(5,2) NOT NULL DEFAULT 8.33,
    edli_rate DECIMAL(5,2) NOT NULL DEFAULT 0.50,
    pf_admin_rate DECIMAL(5,2) NOT NULL DEFAULT 0.50,
    pf_ceilings VARCHAR(400) NOT NULL DEFAULT '[{"from":"2014-09-01","amount":15000},{"from":"2026-09-17","amount":25000}]',
    pf_in_ctc TINYINT(1) NOT NULL DEFAULT 1,
    esi_enabled TINYINT(1) NOT NULL DEFAULT 1,
    esi_ee_rate DECIMAL(5,2) NOT NULL DEFAULT 0.75,
    esi_er_rate DECIMAL(5,2) NOT NULL DEFAULT 3.25,
    esi_ceiling INT NOT NULL DEFAULT 21000,
    esi_daily_exempt INT NOT NULL DEFAULT 176,
    pt_enabled TINYINT(1) NOT NULL DEFAULT 1,
    pt_state VARCHAR(10) NOT NULL DEFAULT 'TN',
    pt_mode VARCHAR(20) NOT NULL DEFAULT 'HALF_YEARLY_LUMP',
    pt_months VARCHAR(40) NOT NULL DEFAULT '[9,3]',
    basic_pct DECIMAL(5,2) NOT NULL DEFAULT 50.00,
    hra_pct DECIMAL(5,2) NOT NULL DEFAULT 50.00,
    conveyance INT NOT NULL DEFAULT 0,
    legal_name VARCHAR(160) NULL,
    address VARCHAR(400) NULL,
    pan VARCHAR(10) NULL,
    tan VARCHAR(10) NULL,
    pf_code VARCHAR(40) NULL,
    esi_code VARCHAR(40) NULL,
    debit_account VARCHAR(30) NULL,
    debit_ifsc VARCHAR(11) NULL,
    debit_bank VARCHAR(60) NULL,
    bank_format VARCHAR(20) NOT NULL DEFAULT 'GENERIC',
    payslip_note VARCHAR(300) NULL,
    updated_by INT NULL,
    updated_at DATETIME NULL
  )`,
  pt_slabs: `CREATE TABLE pt_slabs (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    state VARCHAR(10) NOT NULL,              -- TN, KA, MH ...
    basis VARCHAR(12) NOT NULL,              -- HALF_YEARLY | MONTHLY (income period the slab applies to)
    min_income INT NOT NULL,
    max_income INT NULL,                     -- NULL = no upper limit
    amount INT NOT NULL,                     -- tax for that period
    effective_from DATE NOT NULL,
    note VARCHAR(160) NULL,
    KEY idx_pt_state (state, effective_from)
  )`,
  pay_structures: `CREATE TABLE pay_structures (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    effective_from DATE NOT NULL,
    annual_ctc DECIMAL(12,2) NULL,
    basic DECIMAL(12,2) NOT NULL DEFAULT 0,  -- monthly amounts
    hra DECIMAL(12,2) NOT NULL DEFAULT 0,
    conveyance DECIMAL(12,2) NOT NULL DEFAULT 0,
    special DECIMAL(12,2) NOT NULL DEFAULT 0,
    other_allowance DECIMAL(12,2) NOT NULL DEFAULT 0,
    pf_enabled TINYINT(1) NOT NULL DEFAULT 1,
    pf_restricted TINYINT(1) NOT NULL DEFAULT 1, -- 1 = PF on wages up to the ceiling, 0 = on full basic
    esi_override TINYINT(1) NULL,            -- NULL = automatic, 1 = always, 0 = never
    notes VARCHAR(300) NULL,
    created_by INT NULL,
    created_at DATETIME NULL,
    KEY idx_struct_user (user_id, effective_from)
  )`,
  pay_runs: `CREATE TABLE pay_runs (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    period CHAR(7) NOT NULL,                 -- YYYY-MM
    status VARCHAR(10) NOT NULL DEFAULT 'DRAFT', -- DRAFT | APPROVED | PAID
    employees INT NOT NULL DEFAULT 0,
    total_gross DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_deductions DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_net DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_employer_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
    created_by INT NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    paid_at DATE NULL,
    payment_ref VARCHAR(80) NULL,
    UNIQUE KEY uniq_run (company_id, period)
  )`,
  pay_run_items: `CREATE TABLE pay_run_items (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id INT NOT NULL,
    user_id INT NOT NULL,
    on_hold TINYINT(1) NOT NULL DEFAULT 0,
    -- snapshot of the employee at calculation time (the payslip never changes afterwards)
    emp_code VARCHAR(30) NULL,
    emp_name VARCHAR(120) NULL,
    designation VARCHAR(120) NULL,
    department VARCHAR(120) NULL,
    joining_date VARCHAR(20) NULL,
    pan VARCHAR(10) NULL,
    uan VARCHAR(20) NULL,
    pf_number VARCHAR(40) NULL,
    esi_number VARCHAR(30) NULL,
    bank_name VARCHAR(80) NULL,
    account_holder VARCHAR(120) NULL,
    account_number VARCHAR(30) NULL,
    ifsc VARCHAR(11) NULL,
    -- days
    days_in_month TINYINT NOT NULL,
    lop_days DECIMAL(4,1) NOT NULL DEFAULT 0,
    paid_days DECIMAL(4,1) NOT NULL DEFAULT 0,
    -- manual inputs
    bonus DECIMAL(12,2) NOT NULL DEFAULT 0,
    tds DECIMAL(12,2) NOT NULL DEFAULT 0,
    other_deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
    pt_override DECIMAL(12,2) NULL,          -- set when professional tax is entered by hand
    -- earnings
    basic DECIMAL(12,2) NOT NULL DEFAULT 0,
    hra DECIMAL(12,2) NOT NULL DEFAULT 0,
    conveyance DECIMAL(12,2) NOT NULL DEFAULT 0,
    special DECIMAL(12,2) NOT NULL DEFAULT 0,
    other_allowance DECIMAL(12,2) NOT NULL DEFAULT 0,
    gross DECIMAL(12,2) NOT NULL DEFAULT 0,
    -- employee deductions
    pf_ee DECIMAL(12,2) NOT NULL DEFAULT 0,
    esi_ee DECIMAL(12,2) NOT NULL DEFAULT 0,
    pt DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
    net_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
    -- employer contributions
    eps_er DECIMAL(12,2) NOT NULL DEFAULT 0,
    epf_er DECIMAL(12,2) NOT NULL DEFAULT 0,
    edli_er DECIMAL(12,2) NOT NULL DEFAULT 0,
    pf_admin DECIMAL(12,2) NOT NULL DEFAULT 0,
    esi_er DECIMAL(12,2) NOT NULL DEFAULT 0,
    employer_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    pf_wage DECIMAL(12,2) NOT NULL DEFAULT 0,
    esi_wage DECIMAL(12,2) NOT NULL DEFAULT 0,
    warnings VARCHAR(600) NULL,
    UNIQUE KEY uniq_item (run_id, user_id),
    KEY idx_item_user (user_id)
  )`,
};
const USER_COLUMNS = {
  uan: 'VARCHAR(20) NULL',
  pf_number: 'VARCHAR(40) NULL',
  esi_number: 'VARCHAR(30) NULL',
  account_holder_name: 'VARCHAR(120) NULL',
  bank_branch: 'VARCHAR(120) NULL',
  exit_date: 'DATE NULL',
};
// Greater Chennai Corporation, half-yearly (revised from the 2nd half of FY 2024-25,
// circular R.D.(HQ).C.No.PT/SPL/2024 dated 20-Jan-2025). Other TN local bodies differ: edit in pt_slabs.
const TN_SLABS = [
  [0, 21000, 0], [21001, 30000, 180], [30001, 45000, 425], [45001, 60000, 930], [60001, 75000, 1025], [75001, null, 1250],
];

const toSqlite = (ddl) => ddl
  .replace(/\s*--[^\n]*/g, '')
  .replace(/^\s*(UNIQUE )?KEY [^\n]*$/gm, '')
  .replace(/,(\s*)\)\s*$/, '$1)')
  .replace(/INT NOT NULL AUTO_INCREMENT PRIMARY KEY/g, 'INTEGER PRIMARY KEY')
  .replace(/TINYINT\(1\)/g, 'INTEGER');

async function connect() {
  if (process.env.HRMS_TEST_SQLITE) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.HRMS_TEST_SQLITE);
    return {
      kind: 'sqlite',
      tables: async () => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
      columns: async (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name),
      q: async (sql, p = []) => (/^\s*select/i.test(sql) ? db.prepare(sql).all(...p) : db.prepare(sql).run(...p)),
      exec: async (sql) => {
        db.exec(toSqlite(sql));
        if (/^CREATE TABLE pay_runs/.test(sql)) db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_run ON pay_runs(company_id, period)');
        if (/^CREATE TABLE pay_run_items/.test(sql)) db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_item ON pay_run_items(run_id, user_id)');
      },
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
    q: async (sql, p = []) => (await conn.query(sql, p))[0],
    exec: async (sql) => conn.query(sql),
    close: async () => conn.end(),
  };
}

(async () => {
  const db = await connect();
  console.log(`\nPayroll migration — ${APPLY ? 'APPLY' : 'PREVIEW (no changes)'}  [${db.kind}]\n`);
  const existing = new Set(await db.tables());
  const newTables = Object.keys(TABLES).filter((t) => !existing.has(t));
  console.log(`Tables to create: ${newTables.length ? newTables.join(', ') : 'none (all exist)'}`);
  const userCols = new Set(await db.columns('users'));
  const addCols = Object.keys(USER_COLUMNS).filter((c) => !userCols.has(c));
  console.log(`users columns to add: ${addCols.length ? addCols.join(', ') : 'none'}`);
  const companies = await db.q('SELECT id, name FROM companies');
  console.log(`Companies: ${companies.map((c) => `${c.id} ${c.name}`).join(', ')}`);
  const salaried = await db.q('SELECT id, name, monthly_salary, hra, allowances, joining_date FROM users WHERE COALESCE(monthly_salary, 0) > 0');
  console.log(`Employees with salary figures in users: ${salaried.length} (a structure is created for each one that has none)`);
  if (!APPLY) { console.log('\nPreview only. Re-run with --apply.\n'); return db.close(); }

  for (const t of newTables) { await db.exec(TABLES[t]); console.log(`  + table ${t}`); }
  for (const c of addCols) { await db.exec(`ALTER TABLE users ADD COLUMN ${c} ${USER_COLUMNS[c]}`); console.log(`  + column users.${c}`); }

  const haveSettings = new Set((await db.q('SELECT company_id FROM pay_settings')).map((r) => Number(r.company_id)));
  for (const c of companies) {
    if (haveSettings.has(Number(c.id))) continue;
    await db.q('INSERT INTO pay_settings (company_id, legal_name) VALUES (?, ?)', [c.id, c.name]);
    console.log(`  + settings for ${c.name}`);
  }
  const tnCount = Number((await db.q("SELECT COUNT(*) AS n FROM pt_slabs WHERE state = 'TN'"))[0].n);
  if (!tnCount) {
    for (const [min, max, amount] of TN_SLABS) {
      await db.q("INSERT INTO pt_slabs (state, basis, min_income, max_income, amount, effective_from, note) VALUES ('TN', 'HALF_YEARLY', ?, ?, ?, '2024-10-01', 'Greater Chennai Corporation')", [min, max, amount]);
    }
    console.log('  + Tamil Nadu (Chennai) professional tax slabs');
  }
  const withStructure = new Set((await db.q('SELECT DISTINCT user_id FROM pay_structures')).map((r) => Number(r.user_id)));
  let seeded = 0;
  for (const u of salaried) {
    if (withStructure.has(Number(u.id))) continue;
    const from = /^\d{4}-\d{2}-\d{2}/.test(String(u.joining_date || '')) ? String(u.joining_date).slice(0, 10) : '2025-04-01';
    await db.q(`INSERT INTO pay_structures (user_id, effective_from, basic, hra, special, notes, created_at)
      VALUES (?, ?, ?, ?, ?, 'Copied from the employee profile', ?)`,
    [u.id, from, Number(u.monthly_salary) || 0, Number(u.hra) || 0, Number(u.allowances) || 0, new Date().toISOString().slice(0, 19).replace('T', ' ')]);
    seeded += 1;
  }
  console.log(`  ✔ ${seeded} salary structures created from employee profiles`);
  console.log('\nDone. Restart the backend.\n');
  await db.close();
})().catch((e) => { console.error('✖', e.message); process.exit(1); });
