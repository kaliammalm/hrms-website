#!/usr/bin/env node
/* ==========================================================================
   Pre-deployment clean start: removes ALL activity data created during testing.
   Employee accounts (users) and companies are kept.

   Cleared: attendance logs, leave requests, payslips/payments, approvals, and any
   performance / recruitment / notification tables if your database has them.

   Usage (from the backend folder):
     node scripts/reset-test-data.js                      # preview counts, changes nothing
     node scripts/reset-test-data.js --apply              # back up, then clear
     node scripts/reset-test-data.js --apply --drop-backups
          also deletes older *_bak_* backup tables (they contain test data too)
     node scripts/reset-test-data.js --apply --clear-salaries
          also resets salary/HRA/allowances/deductions to 0 (only if those were test values)
   ========================================================================== */
const APPLY = process.argv.includes('--apply');
const DROP_BACKUPS = process.argv.includes('--drop-backups');
const CLEAR_SALARIES = process.argv.includes('--clear-salaries');

// Activity tables that only ever hold transactional / test data
const ACTIVITY_TABLES = [
  'attendance', 'leaves', 'payslips', 'approvals',
  'performance', 'performance_reviews', 'reviews',
  'job_openings', 'jobs', 'candidates', 'applicants',
  'notifications', 'expenses', 'payroll', 'payroll_runs',
];

async function connect() {
  if (process.env.HRMS_TEST_SQLITE) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.HRMS_TEST_SQLITE);
    return {
      kind: 'sqlite',
      q: async (sql, p = []) => (/^\s*select/i.test(sql) ? db.prepare(sql).all(...p) : db.prepare(sql).run(...p)),
      exec: async (sql) => db.exec(sql),
      tables: async () => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name),
      begin: async () => db.exec('BEGIN'), commit: async () => db.exec('COMMIT'), rollback: async () => db.exec('ROLLBACK'),
      resetIds: async () => {}, close: async () => db.close(),
    };
  }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'hrms@2026', database: process.env.DB_NAME || 'hrms', dateStrings: true,
  });
  return {
    kind: 'mysql',
    q: async (sql, p = []) => (await conn.query(sql, p))[0],
    exec: async (sql) => conn.query(sql),
    tables: async () => (await conn.query('SHOW TABLES'))[0].map(r => Object.values(r)[0]),
    begin: async () => conn.beginTransaction(), commit: async () => conn.commit(), rollback: async () => conn.rollback(),
    resetIds: async (t) => conn.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`),
    close: async () => conn.end(),
  };
}

(async () => {
  const db = await connect();
  const all = await db.tables();
  const present = ACTIVITY_TABLES.filter(t => all.includes(t));
  const oldBackups = all.filter(t => /_bak_\d+$/.test(t));

  console.log(`\nHRMS test-data reset — ${APPLY ? 'APPLY' : 'PREVIEW (no changes)'}  [${db.kind}]\n`);
  const counts = {};
  for (const t of present) {
    counts[t] = Number((await db.q(`SELECT COUNT(*) AS n FROM ${t}`))[0].n);
    console.log(`  ${t.padEnd(22)} ${String(counts[t]).padStart(6)} row(s) to delete`);
  }
  if (CLEAR_SALARIES) console.log('  users                  salary, HRA, allowances, deductions -> 0');
  const users = Number((await db.q('SELECT COUNT(*) AS n FROM users'))[0].n);
  console.log(`\n  Kept: users (${users} accounts), companies.`);
  if (oldBackups.length) console.log(`  Backup tables from earlier runs: ${oldBackups.join(', ')}${DROP_BACKUPS ? '  -> will be dropped' : '  (kept; add --drop-backups to remove)'}`);

  if (!APPLY) {
    console.log('\nPreview only. Re-run with --apply to back up and clear these tables.\n');
    return db.close();
  }

  // Backups first (DDL runs outside the transaction)
  const existingTables = new Set(await db.tables());
  let stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  while ([...existingTables].some(t => t.endsWith(`_bak_${stamp}`))) stamp = String(Number(stamp) + 1);
  const made = [];
  for (const t of present) {
    if (counts[t] > 0) { await db.exec(`CREATE TABLE ${t}_bak_${stamp} AS SELECT * FROM ${t}`); made.push(`${t}_bak_${stamp}`); }
  }
  if (CLEAR_SALARIES) { await db.exec(`CREATE TABLE users_bak_${stamp}s AS SELECT * FROM users`); made.push(`users_bak_${stamp}s`); }
  if (made.length) console.log(`\nBackups created: ${made.join(', ')}`);

  await db.begin();
  try {
    for (const t of present) await db.q(`DELETE FROM ${t}`);
    if (CLEAR_SALARIES) await db.q('UPDATE users SET monthly_salary = 0, hra = 0, allowances = 0, deductions = 0');
    await db.commit();
  } catch (err) {
    await db.rollback();
    console.error(`\n✖ Rolled back, nothing deleted (backups kept). Reason: ${err.message}\n`);
    await db.close();
    process.exit(1);
  }

  for (const t of present) { try { await db.resetIds(t); } catch (e) { /* not critical */ } }
  if (DROP_BACKUPS) for (const t of oldBackups) await db.exec(`DROP TABLE ${t}`);

  console.log(`\n✔ Clean start: ${present.join(', ')} are now empty.${DROP_BACKUPS && oldBackups.length ? ` Dropped ${oldBackups.length} old backup table(s).` : ''}`);
  console.log('  Also: every browser clears test payroll it stored locally the first time it opens the updated portal.\n');
  await db.close();
})().catch((e) => { console.error('✖', e.message); process.exit(1); });
