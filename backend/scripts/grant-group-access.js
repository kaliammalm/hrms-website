#!/usr/bin/env node
/* ==========================================================================
   Group (multi-company) MD access.

   Adds users.group_access (0/1) if missing, then grants it to:
     • the MD account (md@company.com)
     • Vasumathi — title set to CFO (company stays Ram Reddy Developers);
       the backend treats her as the group MD for all three companies.
   Group-access users are not listed or counted as regular employees.

   Usage (from the backend folder):
     node scripts/grant-group-access.js                     # preview, changes nothing
     node scripts/grant-group-access.js --apply             # add column + grant the two accounts
     node scripts/grant-group-access.js --apply --email someone@company.com    # grant one more person
     node scripts/grant-group-access.js --apply --revoke someone@company.com   # take it away

   Uses DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME / DB_SSL like the server,
   so the same command works against your local MySQL and the cloud database.
   ========================================================================== */
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argValue = (flag) => { const i = args.indexOf(flag); return i >= 0 ? String(args[i + 1] || '').trim().toLowerCase() : ''; };
const EXTRA_EMAIL = argValue('--email');
const REVOKE_EMAIL = argValue('--revoke');

try { require('dotenv').config(); } catch (e) { /* optional */ }

async function connect() {
  if (process.env.HRMS_TEST_SQLITE) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.HRMS_TEST_SQLITE);
    return {
      kind: 'sqlite',
      columns: async () => db.prepare('PRAGMA table_info(users)').all().map((c) => c.name),
      q: async (sql, p = []) => (/^\s*select/i.test(sql) ? db.prepare(sql).all(...p) : db.prepare(sql).run(...p)),
      addColumn: async () => db.exec('ALTER TABLE users ADD COLUMN group_access INTEGER NOT NULL DEFAULT 0'),
      close: async () => db.close(),
    };
  }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'hrms@2026',
    database: process.env.DB_NAME || 'hrms',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    dateStrings: true,
  });
  return {
    kind: 'mysql',
    columns: async () => (await conn.query('SHOW COLUMNS FROM users'))[0].map((r) => r.Field),
    q: async (sql, p = []) => (await conn.query(sql, p))[0],
    addColumn: async () => conn.query('ALTER TABLE users ADD COLUMN group_access TINYINT(1) NOT NULL DEFAULT 0'),
    close: async () => conn.end(),
  };
}

(async () => {
  const db = await connect();
  console.log(`\nGroup MD access — ${APPLY ? 'APPLY' : 'PREVIEW (no changes)'}  [${db.kind}]\n`);

  const hasColumn = (await db.columns()).includes('group_access');
  console.log(`${hasColumn ? '✔' : '•'} users.group_access column ${hasColumn ? 'exists' : 'will be added'}`);

  // Who gets access
  const md = await db.q("SELECT id, name, email, role, company_id FROM users WHERE LOWER(email) = 'md@company.com'");
  const vasu = await db.q("SELECT id, name, email, role, company_id FROM users WHERE LOWER(name) LIKE '%vasumathi%' ORDER BY (UPPER(role) = 'CEO') DESC, id");
  const extra = EXTRA_EMAIL ? await db.q('SELECT id, name, email, role, company_id FROM users WHERE LOWER(email) = ?', [EXTRA_EMAIL]) : [];
  const revoke = REVOKE_EMAIL ? await db.q('SELECT id, name, email, role, company_id FROM users WHERE LOWER(email) = ?', [REVOKE_EMAIL]) : [];

  if (!md.length) console.log('✖ md@company.com not found');
  if (!vasu.length) console.log('✖ No user named Vasumathi found');
  if (vasu.length > 1) console.log(`! ${vasu.length} users match "Vasumathi" — only the first (${vasu[0].email}) is granted`);
  if (EXTRA_EMAIL && !extra.length) console.log(`✖ ${EXTRA_EMAIL} not found`);
  if (REVOKE_EMAIL && !revoke.length) console.log(`✖ ${REVOKE_EMAIL} not found`);

  const grant = [md[0], vasu[0], extra[0]].filter(Boolean);
  grant.forEach((u) => console.log(`  + grant: ${u.name} <${u.email}>  role ${u.role}, company ${u.company_id ?? 'none'}`));
  const VASU_TITLE = 'CFO';
  if (vasu[0] && String(vasu[0].role).toUpperCase() !== VASU_TITLE) console.log(`  ~ title: ${vasu[0].name}  ${vasu[0].role} -> ${VASU_TITLE}`);
  revoke.forEach((u) => console.log(`  - revoke: ${u.name} <${u.email}>`));

  if (hasColumn) {
    const current = await db.q('SELECT name, email FROM users WHERE group_access = 1');
    console.log(`\nCurrently with group access: ${current.length ? current.map((u) => `${u.name} <${u.email}>`).join(', ') : 'nobody'}`);
  }

  if (!APPLY) {
    console.log('\nPreview only. Re-run with --apply to make these changes.\n');
    return db.close();
  }

  if (!hasColumn) { await db.addColumn(); console.log('\n✔ Added users.group_access'); }
  for (const u of grant) await db.q('UPDATE users SET group_access = 1 WHERE id = ?', [u.id]);
  if (vasu[0]) await db.q('UPDATE users SET role = ? WHERE id = ?', [VASU_TITLE, vasu[0].id]);
  for (const u of revoke) await db.q('UPDATE users SET group_access = 0 WHERE id = ?', [u.id]);
  const now = await db.q('SELECT name, email, role FROM users WHERE group_access = 1');
  console.log(`✔ Group access now: ${now.map((u) => `${u.name} (${u.role}) <${u.email}>`).join(', ') || 'nobody'}`);
  console.log('  Restart the backend, then those users sign out and in again (or just refresh the page).\n');
  await db.close();
})().catch((e) => { console.error('✖', e.message); process.exit(1); });
