#!/usr/bin/env node
/* ==========================================================================
   Checks the `leaves` table and adds anything the leave feature needs.
   Nothing is deleted or changed in existing rows.

   Usage (from the backend folder):
     node scripts/fix-leaves-table.js           # report only, changes nothing
     node scripts/fix-leaves-table.js --apply   # create the table / add missing columns
   ========================================================================== */
const APPLY = process.argv.includes('--apply');

// Column -> MySQL definition used when it is missing
const NEEDED = {
  employee_id: 'INT NOT NULL',
  company_id: 'INT NULL',
  from_date: 'DATE NULL',
  to_date: 'DATE NULL',
  leave_type: "VARCHAR(100) NULL DEFAULT 'Casual Leave'",
  reason: 'TEXT NULL',
  status: "VARCHAR(20) NOT NULL DEFAULT 'Pending'",
  created_at: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP',
};
// Equivalent names an older table may already use
const ALTERNATIVES = { from_date: ['start_date'], to_date: ['end_date'], leave_type: ['type'] };

async function connect() {
  if (process.env.HRMS_TEST_SQLITE) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.HRMS_TEST_SQLITE);
    return {
      kind: 'sqlite',
      columns: async () => db.prepare('PRAGMA table_info(leaves)').all().map(c => c.name),
      q: async (sql, p = []) => (/^\s*select/i.test(sql) ? db.prepare(sql).all(...p) : db.prepare(sql).run(...p)),
      exec: async (sql) => db.exec(sql.replace(/ AUTO_INCREMENT PRIMARY KEY/, ' PRIMARY KEY').replace(/INT NOT NULL AUTO_INCREMENT/, 'INTEGER')),
      close: async () => db.close(),
    };
  }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'hrms@2026', database: process.env.DB_NAME || 'hrms', dateStrings: true,
  });
  return {
    kind: 'mysql',
    columns: async () => {
      try { return (await conn.query('SHOW COLUMNS FROM leaves'))[0].map(r => r.Field); } catch (e) { if (e.code === 'ER_NO_SUCH_TABLE') return null; throw e; }
    },
    q: async (sql, p = []) => (await conn.query(sql, p))[0],
    exec: async (sql) => conn.query(sql),
    close: async () => conn.end(),
  };
}

(async () => {
  const db = await connect();
  console.log(`\nLeaves table check — ${APPLY ? 'APPLY' : 'REPORT ONLY (no changes)'}  [${db.kind}]\n`);
  const cols = await db.columns();

  if (!cols || cols.length === 0) {
    console.log('✖ The leaves table does not exist — every leave request would fail to save.');
    if (APPLY) {
      await db.exec(`CREATE TABLE leaves (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, ${Object.entries(NEEDED).map(([c, d]) => `${c} ${d}`).join(', ')})`);
      console.log('✔ Created the leaves table.\n');
    } else console.log('  Re-run with --apply to create it.\n');
    return db.close();
  }

  console.log(`Columns found: ${cols.join(', ')}\n`);
  const missing = Object.keys(NEEDED).filter(c => !cols.includes(c) && !(ALTERNATIVES[c] || []).some(a => cols.includes(a)));
  Object.keys(NEEDED).forEach(c => {
    const alt = (ALTERNATIVES[c] || []).find(a => cols.includes(a));
    console.log(`  ${cols.includes(c) ? '✔' : alt ? '✔' : '✖'} ${c}${!cols.includes(c) && alt ? ` (uses ${alt})` : ''}`);
  });

  const total = Number((await db.q('SELECT COUNT(*) AS n FROM leaves'))[0].n);
  const statusCol = cols.includes('status');
  const byStatus = statusCol ? await db.q('SELECT COALESCE(status, \'(empty)\') AS s, COUNT(*) AS n FROM leaves GROUP BY status') : [];
  const orphan = cols.includes('employee_id')
    ? Number((await db.q('SELECT COUNT(*) AS n FROM leaves l LEFT JOIN users u ON u.id = l.employee_id WHERE u.id IS NULL'))[0].n) : 0;
  console.log(`\nStored leave requests: ${total}${byStatus.length ? '  (' + byStatus.map(r => `${r.s} ${r.n}`).join(', ') + ')' : ''}`);
  if (orphan) console.log(`  ${orphan} request(s) belong to employees that no longer exist (they are not shown to anyone).`);

  if (!missing.length) {
    console.log('\n✔ The table has everything the leave feature needs.\n');
    return db.close();
  }
  if (!APPLY) {
    console.log(`\nMissing: ${missing.join(', ')}. Re-run with --apply to add them.\n`);
    return db.close();
  }
  for (const c of missing) {
    await db.exec(`ALTER TABLE leaves ADD COLUMN ${c} ${db.kind === 'sqlite' ? NEEDED[c].replace(/ DEFAULT CURRENT_TIMESTAMP/, '').replace(/NOT NULL /, '') : NEEDED[c]}`);
    console.log(`  + added ${c}`);
  }
  console.log('\n✔ Done. Restart the backend so it picks up the new columns.\n');
  await db.close();
})().catch((e) => { console.error('✖ Check failed:', e.message); process.exit(1); });
