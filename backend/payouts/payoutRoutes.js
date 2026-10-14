/* ==========================================================================
   Salary payouts: pay an APPROVED payroll run straight into employees' bank
   accounts (RazorpayX today; Axis Bank direct API once Axis onboards you).
   Mounted at /api in index.js. Tables: scripts/add-payouts.js.

   Flow
     1. Verify accounts   POST /pay/runs/:id/payouts/verify-accounts      (maker: MD / CEO)
                          registers each employee's bank account with the provider and runs a ₹1
                          penny-drop; the name the bank returns must match the employee.
     2. Prepare batch     POST /pay/runs/:id/payouts/batches               (maker)
                          freezes who gets how much (checksum) → PENDING_APPROVAL.
     3. Approve           POST /pay/payouts/batches/:id/approve           (checker: group MD / listed approvers)
                          { totp, confirmTotal } — authenticator code, the total typed by hand, a
                          different person from the maker, limits, and a re-check that nothing
                          (net pay, bank account) changed since step 2.
     4. Send              background worker: one transfer per employee, each with its own stored
                          idempotency key, so a retry after a timeout can never pay twice.
     5. Track             RazorpayX webhooks → processed (UTR) / failed / reversed. When every
                          employee is paid, the run becomes PAID and payslips show Paid.
     Failed / reversed employees: fix the account, then prepare a new batch for them (approved again).

   Endpoints
     GET  /pay/payouts/config
     GET  /pay/runs/:id/payouts                     readiness per employee + batches of the run
     POST /pay/runs/:id/payouts/verify-accounts     { itemIds? }
     POST /pay/payouts/beneficiaries/refresh         { runId }   re-check pending penny-drops
     POST /pay/payouts/beneficiaries/:id/override    { totp, reason }   accept a name mismatch (checker)
     POST /pay/runs/:id/payouts/batches             { itemIds? }
     GET  /pay/payouts/batches/:id                  batch, transfers, audit trail
     GET  /pay/payouts/pending                      batches waiting for my approval
     POST /pay/payouts/batches/:id/approve          { totp, confirmTotal }
     POST /pay/payouts/batches/:id/cancel           (before approval)
     POST /pay/payouts/batches/:id/reconcile        asks the provider for transfers still open
     GET  /pay/payouts/2fa   POST /pay/payouts/2fa/setup   POST /pay/payouts/2fa/enable { code }
     POST /pay/payouts/webhook                      provider → server (no login; signed)
   ========================================================================== */
const express = require('express');
const crypto = require('crypto');
const { verifyTotp, newSecret, otpauthUri, cipher } = require('./totp');

const PROVIDERS = { razorpayx: require('./providers/razorpayx'), axis: require('./providers/axis'), mock: require('./providers/mock') };
const TERMINAL = new Set(['processed', 'reversed', 'failed', 'cancelled', 'rejected']);
const FAILED = new Set(['reversed', 'failed', 'cancelled', 'rejected']);
const OPEN = ['ready', 'sending', 'unknown'];
const RANK = { ready: 0, sending: 1, unknown: 1, queued: 2, processing: 3, processed: 4, reversed: 5, failed: 5, cancelled: 5, rejected: 5 };
const MAX_ATTEMPTS = 5;
const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR', 'SHRI', 'SMT', 'KUM', 'SRI', 'M', 'S', 'MSS']);

/** 0–100: how well the bank's registered name matches the employee (initials count). */
function nameMatch(a, b) {
  const toks = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter((t) => t && !TITLES.has(t));
  const x = toks(a); const y = toks(b);
  if (!x.length || !y.length) return 0;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const pool = [...long];
  let hits = 0;
  for (const t of short) {
    let i = pool.indexOf(t);
    if (i < 0) i = pool.findIndex((p) => (t.length === 1 && p[0] === t) || (p.length === 1 && t[0] === p) || (t.length > 3 && p.length > 3 && (p.startsWith(t) || t.startsWith(p))));
    if (i >= 0) { hits += pool[i].length === 1 || t.length === 1 ? 0.5 : 1; pool.splice(i, 1); }
  }
  const fullHits = short.filter((t) => t.length > 1).length || 1;
  return Math.round(Math.min(1, hits / fullHits) * 100);
}

module.exports = function payoutRoutes(db, authenticate, options = {}) {
  const router = express.Router();
  const env = options.env || process.env;
  const providerName = String(env.PAYOUT_PROVIDER || 'razorpayx').toLowerCase();
  const provider = options.provider || (PROVIDERS[providerName] || PROVIDERS.razorpayx)(env);
  const ENABLED = String(env.PAYOUTS_ENABLED || '').toLowerCase() === 'true';
  const crypt = cipher(env.PAYOUT_ENCRYPTION_KEY);
  const rupeesEnv = (k, d) => Math.round(Number(env[k] || d) * 100);
  const LIMITS = {
    perEmployee: rupeesEnv('PAYOUT_MAX_PER_EMPLOYEE', 500000),
    perBatch: rupeesEnv('PAYOUT_MAX_PER_BATCH', 5000000),
    perDay: rupeesEnv('PAYOUT_MAX_PER_DAY', 10000000),
  };
  const DUAL = String(env.PAYOUT_DUAL_CONTROL || 'on').toLowerCase() !== 'off';
  const COOLING_HOURS = Number(env.PAYOUT_NEW_ACCOUNT_COOLING_HOURS ?? 24);
  const NAME_MATCH_MIN = Number(env.PAYOUT_NAME_MATCH_MIN || 60);
  const APPROVERS = String(env.PAYOUT_APPROVER_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const FORCE_MODE = ['NEFT', 'IMPS', 'RTGS'].includes(String(env.PAYOUT_MODE || '').toUpperCase()) ? String(env.PAYOUT_MODE).toUpperCase() : null;
  const BATCH_TTL_HOURS = 72;
  const now = options.now || (() => new Date());
  const sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const workerId = `w${process.pid}-${crypto.randomBytes(3).toString('hex')}`;

  const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
  const sqlTime = (d = now()) => d.toISOString().slice(0, 19).replace('T', ' ');
  const parseTime = (s) => (s ? new Date(String(s).replace(' ', 'T') + 'Z') : null);
  const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
  const paise = (rupees) => Math.round(num(rupees) * 100);
  const inr = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const isDup = (e) => e && (e.code === 'ER_DUP_ENTRY' || /UNIQUE constraint/i.test(e.message || ''));
  const isNoTable = (e) => e && (e.code === 'ER_NO_SUCH_TABLE' || /no such table|doesn't exist/i.test(e.message || ''));
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    if (res.headersSent) return;
    if (isNoTable(err)) return res.status(503).json({ error: 'Salary payouts are not set up on this server yet. Run: node scripts/add-payouts.js --apply' });
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(`Payout error (${req.method} ${req.originalUrl || req.url}):`, err.message);
    return res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  });

  // ---------------------------------------------------------------- access
  const roleOf = (u) => String(u?.role || '').toUpperCase();
  const noCompany = (u) => !u?.company_id || Number(u.company_id) === 0;
  const isGroup = (u) => (roleOf(u).includes('MD') || roleOf(u).includes('ADMIN')) && noCompany(u);
  const prepScope = (u) => {
    if (isGroup(u)) return 'all';
    const r = roleOf(u);
    if ((r.includes('MD') || r.includes('CEO') || r.includes('ADMIN')) && !noCompany(u)) return Number(u.company_id);
    return null;
  };
  const viewScope = (u) => {
    if (isGroup(u)) return 'all';
    if (['MD', 'CEO', 'HR', 'ADMIN'].some((x) => roleOf(u).includes(x)) && !noCompany(u)) return Number(u.company_id);
    return null;
  };
  const inScope = (scope, companyId) => scope === 'all' || (scope !== null && scope === Number(companyId));
  /** Who may release money: the listed approvers, or (no list) the group MD */
  const isApprover = (u, companyId) => {
    if (!u) return false;
    if (APPROVERS.length) return APPROVERS.includes(String(u.email || '').toLowerCase()) && (isGroup(u) || Number(u.company_id) === Number(companyId));
    return isGroup(u);
  };

  const audit = async (req, action, { companyId = null, batchId = null, details = null } = {}) => {
    const ip = String(req?.headers?.['x-forwarded-for'] || req?.ip || '').split(',')[0].trim().slice(0, 64) || null;
    await q('INSERT INTO payout_audit (at, user_id, action, company_id, batch_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [sqlTime(), req?.dbUser?.id || null, action, companyId, batchId, details ? JSON.stringify(details).slice(0, 1000) : null, ip]).catch((e) => console.error('Payout audit write failed:', e.message));
  };
  const notifyUsers = async (userIds, title, body) => {
    try {
      const cols = new Set((await q('SHOW COLUMNS FROM notifications')).map((c) => c.Field));
      for (const id of userIds) {
        const data = { recipient_id: id, type: 'PAYOUT', title, body, created_at: sqlTime(), user_id: id, message: `${title}: ${body}`, is_read: 0 };
        const keys = Object.keys(data).filter((k) => cols.has(k));
        await q(`INSERT INTO notifications (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => data[k]));
      }
    } catch (e) { /* notifications are best effort */ }
  };

  /** What still stops payouts on this server (empty = ready) */
  const setupProblems = () => {
    const p = [];
    if (!ENABLED) p.push('PAYOUTS_ENABLED is not "true" (kill switch is off).');
    if (!provider.configured) p.push(`${provider.label} is not configured.`);
    if (!crypt) p.push('PAYOUT_ENCRYPTION_KEY is missing or shorter than 32 characters.');
    if (provider.name === 'razorpayx' && !provider.webhookConfigured) p.push('RAZORPAYX_WEBHOOK_SECRET is missing (payout results would not arrive).');
    return p;
  };
  const requireReady = () => {
    const p = setupProblems();
    if (p.length) throw fail(503, `Salary payouts are switched off: ${p.join(' ')}`);
  };

  // ---------------------------------------------------------------- 2FA (authenticator app)
  const totpFails = new Map();
  async function checkTotp(user, code) {
    if (!crypt) throw fail(503, 'PAYOUT_ENCRYPTION_KEY is not set.');
    const k = String(user.id);
    const t = Date.now();
    const recent = (totpFails.get(k) || []).filter((x) => t - x < 15 * 60000);
    if (recent.length >= 5) throw fail(429, 'Too many wrong codes. Wait 15 minutes.');
    const row = (await q('SELECT * FROM payout_2fa WHERE user_id = ? AND enabled = 1', [user.id]))[0];
    if (!row) throw fail(403, 'Set up the authenticator app first (Payroll → Salary transfer → Security).');
    const step = verifyTotp(crypt.decrypt(row.secret_enc), code, { now: now().getTime(), lastStep: Number(row.last_step) });
    if (step === null) { recent.push(t); totpFails.set(k, recent); throw fail(401, 'The authenticator code is wrong or already used.'); }
    const upd = await q('UPDATE payout_2fa SET last_step = ? WHERE user_id = ? AND last_step < ?', [step, user.id, step]);
    if (!upd.affectedRows) throw fail(401, 'This code was already used. Wait for the next one.');
    totpFails.delete(k);
  }

  router.get('/pay/payouts/2fa', authenticate, wrap(async (req, res) => {
    const row = (await q('SELECT enabled FROM payout_2fa WHERE user_id = ?', [req.dbUser.id]))[0];
    res.json({ enabled: Boolean(row && Number(row.enabled)), approver: isApprover(req.dbUser, req.dbUser.company_id) });
  }));
  router.post('/pay/payouts/2fa/setup', authenticate, wrap(async (req, res) => {
    if (!crypt) throw fail(503, 'PAYOUT_ENCRYPTION_KEY is not set on the server.');
    if (prepScope(req.dbUser) === null) throw fail(403, 'Only people who prepare or release salaries need this.');
    const row = (await q('SELECT enabled FROM payout_2fa WHERE user_id = ?', [req.dbUser.id]))[0];
    if (row && Number(row.enabled)) throw fail(409, 'The authenticator is already set up. To move it to a new phone, ask the server admin to reset it.');
    const secret = newSecret();
    if (row) await q('UPDATE payout_2fa SET secret_enc = ?, created_at = ? WHERE user_id = ?', [crypt.encrypt(secret), sqlTime(), req.dbUser.id]);
    else await q('INSERT INTO payout_2fa (user_id, secret_enc, enabled, last_step, created_at) VALUES (?, ?, 0, 0, ?)', [req.dbUser.id, crypt.encrypt(secret), sqlTime()]);
    res.json({ secret, uri: otpauthUri(secret, req.dbUser.email || `user${req.dbUser.id}`) });
  }));
  router.post('/pay/payouts/2fa/enable', authenticate, wrap(async (req, res) => {
    if (!crypt) throw fail(503, 'PAYOUT_ENCRYPTION_KEY is not set on the server.');
    const row = (await q('SELECT * FROM payout_2fa WHERE user_id = ?', [req.dbUser.id]))[0];
    if (!row) throw fail(400, 'Start the setup first.');
    if (Number(row.enabled)) return res.json({ enabled: true });
    const step = verifyTotp(crypt.decrypt(row.secret_enc), req.body?.code, { now: now().getTime() });
    if (step === null) throw fail(400, 'That code does not match. Check the phone\'s time is automatic and try the next code.');
    await q('UPDATE payout_2fa SET enabled = 1, last_step = ? WHERE user_id = ?', [step, req.dbUser.id]);
    await audit(req, '2FA_ENABLED');
    res.json({ enabled: true });
  }));

  // ---------------------------------------------------------------- readiness
  const loadRun = async (id) => (await q('SELECT r.*, c.name AS company_name FROM pay_runs r LEFT JOIN companies c ON c.id = r.company_id WHERE r.id = ?', [id]))[0];
  const bankOk = (i) => /^\d{6,20}$/.test(String(i.account_number || '')) && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(i.ifsc || ''));
  const fingerprintOf = (i) => crypt.fingerprint(`${String(i.account_number)}|${String(i.ifsc)}`);
  const modeFor = (amountPaise) => FORCE_MODE || (amountPaise <= 50000000 ? 'IMPS' : 'NEFT'); // IMPS up to ₹5 lakh, else NEFT

  /** One row per employee of the run: can they be paid now, and if not, why */
  async function readiness(run) {
    const items = await q('SELECT * FROM pay_run_items WHERE run_id = ? ORDER BY emp_name', [run.id]);
    const benefs = await q('SELECT * FROM payout_beneficiaries WHERE provider = ?', [provider.name]);
    const active = await q('SELECT * FROM payout_items WHERE run_id = ? ORDER BY id', [run.id]);
    const users = new Map((await q(`SELECT id, account_number, ifsc_code FROM users WHERE id IN (${items.map(() => '?').join(',') || 'NULL'})`, items.map((i) => i.user_id))).map((u) => [Number(u.id), u]));
    const acctCount = new Map();
    items.forEach((i) => { if (bankOk(i) && !Number(i.on_hold)) { const k = `${i.account_number}|${i.ifsc}`; acctCount.set(k, (acctCount.get(k) || 0) + 1); } });
    const t = now();
    return items.map((i) => {
      const amount = paise(i.net_pay);
      const row = { itemId: i.id, userId: i.user_id, empCode: i.emp_code, name: i.emp_name, amountPaise: amount, accountLast4: String(i.account_number || '').slice(-4), ifsc: i.ifsc, reasons: [], warnings: [] };
      const history = active.filter((a) => Number(a.run_item_id) === Number(i.id));
      const live = history.find((a) => a.active_run_item !== null && a.active_run_item !== undefined);
      row.transfers = history.map((a) => ({ id: a.id, batchId: a.batch_id, status: a.status, utr: a.utr, reason: a.failure_reason }));
      if (Number(i.on_hold)) return { ...row, state: 'skipped', reasons: ['On hold in this pay run'] };
      if (!(amount > 0)) return { ...row, state: 'skipped', reasons: ['No net pay'] };
      if (live) return { ...row, state: live.status === 'processed' ? 'paid' : 'in_progress', transferStatus: live.status, utr: live.utr };
      if (!bankOk(i)) return { ...row, state: 'blocked', reasons: ['Bank account number or IFSC missing in the approved payslip'] };
      const cur = users.get(Number(i.user_id));
      if (cur && (String(cur.account_number || '') !== String(i.account_number) || String(cur.ifsc_code || '') !== String(i.ifsc))) {
        row.warnings.push('Bank details in the employee profile changed after this run was calculated. The approved (older) account is used; reopen and recalculate the run to use the new one.');
      }
      const fp = fingerprintOf(i);
      const b = benefs.find((x) => Number(x.user_id) === Number(i.user_id) && x.fingerprint === fp);
      row.beneficiary = b ? { id: b.id, status: b.validation_status, registeredName: b.registered_name, nameMatch: b.name_match, overridden: Boolean(b.override_by), eligibleFrom: b.eligible_from } : null;
      if (acctCount.get(`${i.account_number}|${i.ifsc}`) > 1) row.reasons.push('The same bank account is used by another employee in this run');
      if (amount > LIMITS.perEmployee) row.reasons.push(`Above the per-employee limit of ${inr(LIMITS.perEmployee)}`);
      if (!b || b.validation_status === 'none') row.reasons.push('Account not verified yet');
      else if (b.validation_status === 'pending') row.reasons.push('Verification in progress at the bank');
      else if (b.validation_status === 'invalid') row.reasons.push('The bank says this account is invalid or closed');
      else if (b.validation_status === 'failed') row.reasons.push(`Verification failed${b.last_error ? `: ${b.last_error}` : ''}. Try again`);
      else if (b.validation_status === 'name_mismatch') row.reasons.push(`Name at the bank "${b.registered_name || '?'}" does not match (score ${b.name_match}). An approver must confirm it`);
      else if (b.validation_status === 'verified' && b.eligible_from && parseTime(b.eligible_from) > t) {
        row.reasons.push(`New bank account: payable after ${parseTime(b.eligible_from).toISOString().slice(0, 16).replace('T', ' ')} UTC (safety hold for changed accounts)`);
      }
      return { ...row, state: row.reasons.length ? 'blocked' : 'ready', mode: modeFor(amount) };
    });
  }

  const batchOut = (b) => ({
    id: b.id, runId: b.run_id, companyId: b.company_id, status: b.status, provider: b.provider, live: Boolean(Number(b.live)),
    itemCount: num(b.item_count), totalPaise: num(b.total_paise), preparedBy: b.prepared_by, preparedByName: b.prepared_by_name || null, preparedAt: b.prepared_at,
    approvedBy: b.approved_by, approvedByName: b.approved_by_name || null, approvedAt: b.approved_at, cancelledAt: b.cancelled_at, completedAt: b.completed_at,
  });
  const batchesOf = async (runId) => q(`SELECT b.*, p.name AS prepared_by_name, a.name AS approved_by_name FROM payout_batches b
    LEFT JOIN users p ON p.id = b.prepared_by LEFT JOIN users a ON a.id = b.approved_by WHERE b.run_id = ? ORDER BY b.id DESC`, [runId]);

  router.get('/pay/payouts/config', authenticate, wrap(async (req, res) => {
    if (viewScope(req.dbUser) === null) throw fail(403, 'Not allowed.');
    res.json({
      provider: provider.name, providerLabel: provider.label, live: provider.live, enabled: setupProblems().length === 0, problems: setupProblems(),
      limits: LIMITS, dualControl: DUAL, coolingHours: COOLING_HOURS, nameMatchMin: NAME_MATCH_MIN,
    });
  }));

  router.get('/pay/runs/:id/payouts', authenticate, wrap(async (req, res) => {
    const run = await loadRun(req.params.id);
    if (!run) throw fail(404, 'Payroll run not found.');
    if (!inScope(viewScope(req.dbUser), run.company_id)) throw fail(403, 'Not allowed.');
    if (!crypt) throw fail(503, 'PAYOUT_ENCRYPTION_KEY is not set on the server.');
    const rows = await readiness(run);
    const twofa = (await q('SELECT enabled FROM payout_2fa WHERE user_id = ?', [req.dbUser.id]))[0];
    const count = (s) => rows.filter((r) => r.state === s);
    res.json({
      run: { id: run.id, status: run.status, period: run.period, companyId: run.company_id, companyName: run.company_name },
      problems: setupProblems(), provider: provider.label, live: provider.live, limits: LIMITS, dualControl: DUAL,
      canPrepare: inScope(prepScope(req.dbUser), run.company_id), canApprove: isApprover(req.dbUser, run.company_id),
      twoFactor: Boolean(twofa && Number(twofa.enabled)), userId: req.dbUser.id,
      summary: Object.fromEntries(['ready', 'blocked', 'in_progress', 'paid', 'skipped'].map((s) => [s, { count: count(s).length, paise: count(s).reduce((n, r) => n + r.amountPaise, 0) }])),
      employees: rows,
      batches: (await batchesOf(run.id)).map(batchOut),
    });
  }));

  // ---------------------------------------------------------------- account verification (penny drop)
  async function applyValidation(b, v) {
    let status = 'pending';
    let score = null;
    if (v.status === 'completed') {
      if (v.accountStatus === 'active') {
        score = nameMatch(b.holder_name, v.registeredName);
        const emp = (await q('SELECT name FROM users WHERE id = ?', [b.user_id]))[0];
        score = Math.max(score, nameMatch(emp?.name, v.registeredName));
        status = !v.registeredName ? 'verified' : score >= NAME_MATCH_MIN ? 'verified' : 'name_mismatch';
      } else status = 'invalid';
    } else if (v.status === 'failed') status = 'failed';
    const keepOverride = status === 'name_mismatch' && b.override_by;
    await q(`UPDATE payout_beneficiaries SET validation_status = ?, registered_name = ?, name_match = ?, verified_at = ?, updated_at = ?, last_error = ? WHERE id = ?`,
      [keepOverride ? 'verified' : status, v.registeredName || null, score, status === 'verified' || keepOverride ? sqlTime() : null, sqlTime(), status === 'failed' ? 'The bank did not respond' : null, b.id]);
    return status;
  }

  router.post('/pay/runs/:id/payouts/verify-accounts', authenticate, wrap(async (req, res) => {
    requireReady();
    const run = await loadRun(req.params.id);
    if (!run) throw fail(404, 'Payroll run not found.');
    if (!inScope(prepScope(req.dbUser), run.company_id)) throw fail(403, 'Only the MD or the company CEO can do this.');
    const only = Array.isArray(req.body?.itemIds) ? new Set(req.body.itemIds.map(Number)) : null;
    const rows = (await readiness(run)).filter((r) => (!only || only.has(r.itemId)) && r.state === 'blocked'
      && (!r.beneficiary || ['none', 'failed'].includes(r.beneficiary.status)) && r.reasons.every((x) => !/Bank account number/.test(x)));
    const items = new Map((await q('SELECT * FROM pay_run_items WHERE run_id = ?', [run.id])).map((i) => [Number(i.id), i]));
    const results = { started: 0, verified: 0, pending: 0, problems: [] };
    for (const r of rows.slice(0, 100)) {
      const i = items.get(r.itemId);
      const u = (await q('SELECT id, name, email, phone FROM users WHERE id = ?', [i.user_id]))[0] || {};
      const fp = fingerprintOf(i);
      let b = (await q('SELECT * FROM payout_beneficiaries WHERE provider = ? AND user_id = ? AND fingerprint = ?', [provider.name, i.user_id, fp]))[0];
      try {
        if (!b) {
          // A different, already-verified account for this person = their bank account CHANGED: hold new payouts for a while
          const earlier = await q("SELECT id FROM payout_beneficiaries WHERE provider = ? AND user_id = ? AND fingerprint <> ? AND validation_status = 'verified'", [provider.name, i.user_id, fp]);
          const eligible = earlier.length && COOLING_HOURS > 0 ? sqlTime(new Date(now().getTime() + COOLING_HOURS * 3600000)) : null;
          await q(`INSERT INTO payout_beneficiaries (user_id, provider, fingerprint, account_last4, ifsc, holder_name, validation_status, eligible_from, created_by, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'none', ?, ?, ?, ?)`,
          [i.user_id, provider.name, fp, String(i.account_number).slice(-4), i.ifsc, i.account_holder || i.emp_name, eligible, req.dbUser.id, sqlTime(), sqlTime()]);
          b = (await q('SELECT * FROM payout_beneficiaries WHERE provider = ? AND user_id = ? AND fingerprint = ?', [provider.name, i.user_id, fp]))[0];
          if (earlier.length) {
            await notifyUsers([i.user_id], 'Salary account changed', `Your salary will be paid to the account ending ${String(i.account_number).slice(-4)}. If you did not ask for this, tell HR immediately.`);
            await audit(req, 'ACCOUNT_CHANGED', { companyId: run.company_id, details: { userId: i.user_id, last4: String(i.account_number).slice(-4) } });
          }
        }
        if (!b.fund_account_id) {
          const contact = (await q('SELECT contact_id FROM payout_beneficiaries WHERE provider = ? AND user_id = ? AND contact_id IS NOT NULL LIMIT 1', [provider.name, i.user_id]))[0];
          const reg = await provider.ensureBeneficiary({ userId: i.user_id, empCode: i.emp_code, name: u.name || i.emp_name, email: u.email, phone: u.phone,
            holder: i.account_holder || i.emp_name, account: i.account_number, ifsc: i.ifsc, existingContactId: contact?.contact_id || null });
          await q('UPDATE payout_beneficiaries SET contact_id = ?, fund_account_id = ?, updated_at = ? WHERE id = ?', [reg.contactId, reg.fundAccountId, sqlTime(), b.id]);
          b.fund_account_id = reg.fundAccountId;
        }
        const v = await provider.validateAccount({ fundAccountId: b.fund_account_id });
        await q("UPDATE payout_beneficiaries SET validation_id = ?, validation_status = 'pending', updated_at = ? WHERE id = ?", [v.id, sqlTime(), b.id]);
        const st = await applyValidation(b, v);
        results.started += 1;
        if (st === 'verified') results.verified += 1;
        if (st === 'pending') results.pending += 1;
        if (['invalid', 'name_mismatch', 'failed'].includes(st)) results.problems.push({ name: i.emp_name, status: st });
      } catch (e) {
        if (b) await q("UPDATE payout_beneficiaries SET validation_status = 'failed', last_error = ?, updated_at = ? WHERE id = ?", [String(e.message).slice(0, 250), sqlTime(), b.id]);
        results.problems.push({ name: i.emp_name, status: 'error', message: e.message });
      }
      await sleep(200);
    }
    await audit(req, 'VERIFY_ACCOUNTS', { companyId: run.company_id, details: { runId: run.id, ...results, problems: results.problems.length } });
    res.json({ message: `${results.started} account(s) sent for verification: ${results.verified} verified, ${results.pending} pending, ${results.problems.length} need attention.`, ...results });
  }));

  router.post('/pay/payouts/beneficiaries/refresh', authenticate, wrap(async (req, res) => {
    requireReady();
    const run = await loadRun(req.body?.runId);
    if (!run) throw fail(404, 'Payroll run not found.');
    if (!inScope(prepScope(req.dbUser), run.company_id)) throw fail(403, 'Not allowed.');
    const pend = await q(`SELECT b.* FROM payout_beneficiaries b JOIN pay_run_items i ON i.user_id = b.user_id
      WHERE i.run_id = ? AND b.provider = ? AND b.validation_status = 'pending' AND b.validation_id IS NOT NULL`, [run.id, provider.name]);
    let updated = 0;
    for (const b of pend) { const st = await applyValidation(b, await provider.getValidation(b.validation_id)); if (st !== 'pending') updated += 1; await sleep(100); }
    res.json({ checked: pend.length, updated });
  }));

  router.post('/pay/payouts/beneficiaries/:id/override', authenticate, wrap(async (req, res) => {
    const b = (await q('SELECT b.*, u.company_id FROM payout_beneficiaries b LEFT JOIN users u ON u.id = b.user_id WHERE b.id = ?', [req.params.id]))[0];
    if (!b) throw fail(404, 'Account not found.');
    if (!isApprover(req.dbUser, b.company_id)) throw fail(403, 'Only a salary approver can accept a name mismatch.');
    if (b.validation_status !== 'name_mismatch') throw fail(409, 'This account does not need a name confirmation.');
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 5) throw fail(400, 'Write why the name is acceptable (e.g. "bank shows initials").');
    await checkTotp(req.dbUser, req.body?.totp);
    await q("UPDATE payout_beneficiaries SET validation_status = 'verified', override_by = ?, override_reason = ?, verified_at = ?, updated_at = ? WHERE id = ? AND validation_status = 'name_mismatch'",
      [req.dbUser.id, reason.slice(0, 200), sqlTime(), sqlTime(), b.id]);
    await audit(req, 'NAME_OVERRIDE', { companyId: b.company_id, details: { beneficiaryId: b.id, userId: b.user_id, registeredName: b.registered_name, reason } });
    res.json({ message: 'Account accepted.' });
  }));

  // ---------------------------------------------------------------- batches (maker → checker)
  const checksumOf = (lines) => crypto.createHash('sha256').update(lines.map((l) => `${l.runItemId}:${l.userId}:${l.amountPaise}:${l.fingerprint}`).sort().join('\n')).digest('hex');

  router.post('/pay/runs/:id/payouts/batches', authenticate, wrap(async (req, res) => {
    requireReady();
    const run = await loadRun(req.params.id);
    if (!run) throw fail(404, 'Payroll run not found.');
    if (!inScope(prepScope(req.dbUser), run.company_id)) throw fail(403, 'Only the MD or the company CEO can prepare salary transfers.');
    if (run.status !== 'APPROVED') throw fail(409, run.status === 'PAID' ? 'This run is already marked as paid.' : 'Approve the payroll run first.');
    const open = await q("SELECT id FROM payout_batches WHERE run_id = ? AND status = 'PENDING_APPROVAL'", [run.id]);
    if (open.length) throw fail(409, `Batch #${open[0].id} is already waiting for approval. Approve or cancel it first.`);
    const only = Array.isArray(req.body?.itemIds) ? new Set(req.body.itemIds.map(Number)) : null;
    const ready = (await readiness(run)).filter((r) => r.state === 'ready' && (!only || only.has(r.itemId)));
    if (!ready.length) throw fail(400, 'Nobody in this run is ready to be paid. Verify their bank accounts first.');
    const total = ready.reduce((n, r) => n + r.amountPaise, 0);
    if (total > LIMITS.perBatch) throw fail(400, `The batch total ${inr(total)} is above the limit of ${inr(LIMITS.perBatch)} (PAYOUT_MAX_PER_BATCH).`);
    const items = new Map((await q('SELECT * FROM pay_run_items WHERE run_id = ?', [run.id])).map((i) => [Number(i.id), i]));
    const lines = ready.map((r) => ({ ...r, runItemId: r.itemId, fingerprint: fingerprintOf(items.get(r.itemId)) }));
    const ins = await q(`INSERT INTO payout_batches (company_id, run_id, provider, live, status, item_count, total_paise, checksum, prepared_by, prepared_at)
                         VALUES (?, ?, ?, ?, 'PENDING_APPROVAL', ?, ?, ?, ?, ?)`,
    [run.company_id, run.id, provider.name, provider.live ? 1 : 0, lines.length, total, checksumOf(lines), req.dbUser.id, sqlTime()]);
    const batchId = ins.insertId;
    try {
      for (const l of lines) {
        await q(`INSERT INTO payout_items (batch_id, run_id, run_item_id, active_run_item, user_id, beneficiary_id, emp_name, account_last4, amount_paise, mode, reference_id, idempotency_key, status, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
        [batchId, run.id, l.runItemId, l.runItemId, l.userId, l.beneficiary.id, l.name, l.accountLast4, l.amountPaise, l.mode, `SAL${run.id}-${l.runItemId}-${batchId}`.slice(0, 40), crypto.randomUUID(), sqlTime()]);
      }
    } catch (e) {
      await q('DELETE FROM payout_items WHERE batch_id = ?', [batchId]);
      await q('DELETE FROM payout_batches WHERE id = ?', [batchId]);
      if (isDup(e)) throw fail(409, 'Someone else just prepared transfers for the same employees. Refresh and check.');
      throw e;
    }
    await audit(req, 'BATCH_PREPARED', { companyId: run.company_id, batchId, details: { runId: run.id, count: lines.length, total } });
    const approvers = APPROVERS.length
      ? await q(`SELECT id FROM users WHERE LOWER(email) IN (${APPROVERS.map(() => '?').join(',')})`, APPROVERS)
      : await q("SELECT id FROM users WHERE group_access = 1 OR (UPPER(role) = 'MD' AND (company_id IS NULL OR company_id = 0))");
    await notifyUsers(approvers.map((a) => a.id).filter((id) => id !== req.dbUser.id), 'Salary transfer waiting for approval',
      `${run.company_name} ${run.period}: ${lines.length} employees, ${inr(total)}. Open Payroll to review and approve.`);
    res.status(201).json({ message: `Batch #${batchId} prepared: ${lines.length} employees, ${inr(total)}. It now needs approval.`, batchId, total, count: lines.length });
  }));

  const loadBatch = async (id) => (await q(`SELECT b.*, r.status AS run_status, r.period, c.name AS company_name, p.name AS prepared_by_name, a.name AS approved_by_name
    FROM payout_batches b JOIN pay_runs r ON r.id = b.run_id LEFT JOIN companies c ON c.id = b.company_id
    LEFT JOIN users p ON p.id = b.prepared_by LEFT JOIN users a ON a.id = b.approved_by WHERE b.id = ?`, [id]))[0];

  router.get('/pay/payouts/batches/:id', authenticate, wrap(async (req, res) => {
    const b = await loadBatch(req.params.id);
    if (!b) throw fail(404, 'Batch not found.');
    if (!inScope(viewScope(req.dbUser), b.company_id)) throw fail(403, 'Not allowed.');
    const items = await q('SELECT * FROM payout_items WHERE batch_id = ? ORDER BY emp_name', [b.id]);
    const trail = await q('SELECT a.*, u.name AS user_name FROM payout_audit a LEFT JOIN users u ON u.id = a.user_id WHERE a.batch_id = ? ORDER BY a.id', [b.id]);
    res.json({
      batch: { ...batchOut(b), period: b.period, companyName: b.company_name, runStatus: b.run_status },
      items: items.map((i) => ({ id: i.id, runItemId: i.run_item_id, name: i.emp_name, accountLast4: i.account_last4, amountPaise: num(i.amount_paise), mode: i.mode, status: i.status, utr: i.utr, reason: i.failure_reason, reference: i.reference_id, attempts: num(i.attempts) })),
      audit: trail.map((t) => ({ at: t.at, action: t.action, by: t.user_name, details: t.details })),
      canApprove: b.status === 'PENDING_APPROVAL' && isApprover(req.dbUser, b.company_id) && (!DUAL || Number(b.prepared_by) !== Number(req.dbUser.id)),
    });
  }));

  router.get('/pay/payouts/pending', authenticate, wrap(async (req, res) => {
    const rows = await q(`SELECT b.*, r.period, c.name AS company_name, p.name AS prepared_by_name FROM payout_batches b JOIN pay_runs r ON r.id = b.run_id
      LEFT JOIN companies c ON c.id = b.company_id LEFT JOIN users p ON p.id = b.prepared_by WHERE b.status = 'PENDING_APPROVAL' ORDER BY b.id`);
    res.json({ batches: rows.filter((b) => isApprover(req.dbUser, b.company_id)).map((b) => ({ ...batchOut(b), period: b.period, companyName: b.company_name })) });
  }));

  router.post('/pay/payouts/batches/:id/approve', authenticate, wrap(async (req, res) => {
    requireReady();
    const b = await loadBatch(req.params.id);
    if (!b) throw fail(404, 'Batch not found.');
    if (!isApprover(req.dbUser, b.company_id)) throw fail(403, 'Only a salary approver can release payments.');
    if (b.status !== 'PENDING_APPROVAL') throw fail(409, `This batch is ${b.status.toLowerCase().replace('_', ' ')}.`);
    if (DUAL && Number(b.prepared_by) === Number(req.dbUser.id)) throw fail(403, 'You prepared this batch. A different approver must release it (maker-checker).');
    if (b.provider !== provider.name) throw fail(409, `This batch was prepared for ${b.provider}; the server now uses ${provider.name}. Cancel it and prepare again.`);
    if (now() - parseTime(b.prepared_at) > BATCH_TTL_HOURS * 3600000) {
      await q("UPDATE payout_batches SET status = 'EXPIRED' WHERE id = ? AND status = 'PENDING_APPROVAL'", [b.id]);
      await q('UPDATE payout_items SET active_run_item = NULL, status = \'cancelled\', updated_at = ? WHERE batch_id = ?', [sqlTime(), b.id]);
      throw fail(409, `This batch is older than ${BATCH_TTL_HOURS} hours and has expired. Prepare it again.`);
    }
    if (paise(req.body?.confirmTotal) !== num(b.total_paise)) throw fail(400, `Type the batch total exactly (${inr(num(b.total_paise))}) to confirm.`);
    await checkTotp(req.dbUser, req.body?.totp);

    // Nothing may have changed since the maker prepared it
    if (b.run_status !== 'APPROVED') throw fail(409, 'The payroll run is no longer approved. Cancel this batch.');
    const items = await q('SELECT p.*, i.net_pay, i.account_number, i.ifsc, i.on_hold, i.user_id AS run_user, bf.fingerprint, bf.validation_status, bf.eligible_from FROM payout_items p JOIN pay_run_items i ON i.id = p.run_item_id JOIN payout_beneficiaries bf ON bf.id = p.beneficiary_id WHERE p.batch_id = ?', [b.id]);
    const problems = [];
    const lines = items.map((p) => {
      if (paise(p.net_pay) !== num(p.amount_paise)) problems.push(`${p.emp_name}: net pay changed`);
      if (Number(p.on_hold)) problems.push(`${p.emp_name}: put on hold`);
      if (fingerprintOf(p) !== p.fingerprint) problems.push(`${p.emp_name}: bank account changed`);
      if (p.validation_status !== 'verified') problems.push(`${p.emp_name}: account no longer verified`);
      if (p.eligible_from && parseTime(p.eligible_from) > now()) problems.push(`${p.emp_name}: new account still on safety hold`);
      return { runItemId: p.run_item_id, userId: p.run_user, amountPaise: paise(p.net_pay), fingerprint: fingerprintOf(p) };
    });
    if (problems.length || checksumOf(lines) !== b.checksum) {
      await audit(req, 'APPROVAL_BLOCKED', { companyId: b.company_id, batchId: b.id, details: { problems: problems.slice(0, 10) } });
      throw fail(409, `The payroll changed after this batch was prepared (${problems.slice(0, 3).join('; ') || 'details differ'}). Cancel it and prepare a new one.`);
    }
    // Daily cap (IST calendar day)
    const istMidnightUtc = new Date(Math.floor((now().getTime() + 19800000) / 86400000) * 86400000 - 19800000);
    const today = await q("SELECT COALESCE(SUM(total_paise), 0) AS t FROM payout_batches WHERE approved_at >= ? AND status NOT IN ('CANCELLED', 'EXPIRED')", [sqlTime(istMidnightUtc)]);
    if (num(today[0].t) + num(b.total_paise) > LIMITS.perDay) throw fail(400, `Today's limit of ${inr(LIMITS.perDay)} would be exceeded (already released ${inr(num(today[0].t))}).`);

    const upd = await q("UPDATE payout_batches SET status = 'APPROVED', approved_by = ?, approved_at = ? WHERE id = ? AND status = 'PENDING_APPROVAL'", [req.dbUser.id, sqlTime(), b.id]);
    if (!upd.affectedRows) throw fail(409, 'This batch was just approved or cancelled by someone else.');
    await audit(req, 'BATCH_APPROVED', { companyId: b.company_id, batchId: b.id, details: { count: num(b.item_count), total: num(b.total_paise), live: Boolean(Number(b.live)) } });
    const job = processBatch(b.id).catch((e) => console.error(`Payout batch ${b.id} worker error:`, e.message));
    if (options.awaitWorker) await job;
    res.status(202).json({ message: `Approved. Sending ${num(b.item_count)} transfers (${inr(num(b.total_paise))}) now; results arrive over the next minutes.` });
  }));

  router.post('/pay/payouts/batches/:id/cancel', authenticate, wrap(async (req, res) => {
    const b = await loadBatch(req.params.id);
    if (!b) throw fail(404, 'Batch not found.');
    if (!inScope(prepScope(req.dbUser), b.company_id) && !isApprover(req.dbUser, b.company_id)) throw fail(403, 'Not allowed.');
    const upd = await q("UPDATE payout_batches SET status = 'CANCELLED', cancelled_by = ?, cancelled_at = ? WHERE id = ? AND status = 'PENDING_APPROVAL'", [req.dbUser.id, sqlTime(), b.id]);
    if (!upd.affectedRows) throw fail(409, 'Only a batch waiting for approval can be cancelled. Approved transfers are already with the bank.');
    await q("UPDATE payout_items SET status = 'cancelled', active_run_item = NULL, updated_at = ? WHERE batch_id = ?", [sqlTime(), b.id]);
    await audit(req, 'BATCH_CANCELLED', { companyId: b.company_id, batchId: b.id, details: { reason: String(req.body?.reason || '').slice(0, 200) } });
    res.json({ message: `Batch #${b.id} cancelled. Nothing was sent.` });
  }));

  // ---------------------------------------------------------------- sending (worker)
  /** Applies a provider status to a transfer, ignoring stale / out-of-order updates */
  async function applyPayout(item, p) {
    const status = { queued: 'queued', pending: 'queued', scheduled: 'queued', processing: 'processing', processed: 'processed', reversed: 'reversed', failed: 'failed', cancelled: 'cancelled', rejected: 'rejected' }[p.status] || 'processing';
    const from = item.status;
    const forward = RANK[status] > RANK[from] || (from === 'processed' && status === 'reversed');
    if (!forward && !(status === from && p.utr && !item.utr)) return false;
    const terminalFail = FAILED.has(status);
    const upd = await q(`UPDATE payout_items SET status = ?, provider_payout_id = COALESCE(provider_payout_id, ?), utr = COALESCE(?, utr), failure_reason = ?,
        processed_at = CASE WHEN ? = 'processed' THEN ? ELSE processed_at END, active_run_item = CASE WHEN ? = 1 THEN NULL ELSE active_run_item END, updated_at = ?
      WHERE id = ? AND status = ?`,
    [status, p.id || null, p.utr || null, terminalFail ? String(p.description || p.reason || status).slice(0, 250) : null, status, sqlTime(), terminalFail ? 1 : 0, sqlTime(), item.id, from]);
    if (!upd.affectedRows) return false; // someone else updated it first
    if (status === 'processed' && from !== 'processed') {
      await notifyUsers([item.user_id], 'Salary credited', `${inr(num(item.amount_paise))} has been sent to your account ending ${item.account_last4}${p.utr ? ` (UTR ${p.utr})` : ''}.`);
    }
    if (from === 'processed' && status === 'reversed') {
      const run = (await q('SELECT * FROM pay_runs WHERE id = ?', [item.run_id]))[0];
      if (run && run.status === 'PAID' && String(run.payment_ref || '').startsWith('Payout')) {
        await q("UPDATE pay_runs SET status = 'APPROVED', paid_at = NULL, updated_at = ? WHERE id = ?", [sqlTime(), run.id]);
      }
      await audit(null, 'TRANSFER_REVERSED', { companyId: run?.company_id, batchId: item.batch_id, details: { itemId: item.id, name: item.emp_name } });
    }
    return true;
  }

  async function finalizeBatch(batchId) {
    const b = (await q('SELECT * FROM payout_batches WHERE id = ?', [batchId]))[0];
    if (!b || !['APPROVED', 'PROCESSING', 'COMPLETED', 'PARTIAL'].includes(b.status)) return;
    const items = await q('SELECT status FROM payout_items WHERE batch_id = ?', [batchId]);
    const done = items.every((i) => TERMINAL.has(i.status));
    const status = !done ? 'PROCESSING' : items.every((i) => i.status === 'processed') ? 'COMPLETED' : 'PARTIAL';
    if (status !== b.status) await q('UPDATE payout_batches SET status = ?, completed_at = ? WHERE id = ?', [status, done ? sqlTime() : null, batchId]);
    // Whole run paid? → PAID, payslips Paid
    const run = (await q('SELECT * FROM pay_runs WHERE id = ?', [b.run_id]))[0];
    if (!run || run.status !== 'APPROVED') return;
    const payable = await q('SELECT id FROM pay_run_items WHERE run_id = ? AND on_hold = 0 AND net_pay > 0', [run.id]);
    const paid = new Set((await q("SELECT run_item_id FROM payout_items WHERE run_id = ? AND status = 'processed'", [run.id])).map((r) => Number(r.run_item_id)));
    if (payable.length && payable.every((p) => paid.has(Number(p.id)))) {
      const ist = new Date(now().getTime() + 19800000).toISOString().slice(0, 10);
      const ref = `Payout ${provider.label} batch ${(await q('SELECT DISTINCT batch_id FROM payout_items WHERE run_id = ? AND status = \'processed\'', [run.id])).map((r) => `#${r.batch_id}`).join(' ')}`.slice(0, 80);
      const upd = await q("UPDATE pay_runs SET status = 'PAID', paid_at = ?, payment_ref = ?, updated_at = ? WHERE id = ? AND status = 'APPROVED'", [ist, ref, sqlTime(), run.id]);
      if (upd.affectedRows) {
        const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const label = `${MONTHS[Number(run.period.slice(5, 7)) - 1]} ${run.period.slice(0, 4)}`;
        await q("UPDATE payslips SET status = 'Paid' WHERE month = ? AND company_id = ?", [label, run.company_id]).catch(() => {});
        await audit(null, 'RUN_PAID', { companyId: run.company_id, batchId, details: { runId: run.id } });
      }
    }
  }

  const narrationFor = (period, companyName) => {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(period.slice(5, 7)) - 1];
    const initials = String(companyName || '').split(/\s+/).map((w) => w[0]).join('').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return `Salary ${MON} ${period.slice(0, 4)} ${initials}`.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 30).trim();
  };

  /** Sends every open transfer of a batch. Safe to run twice: a DB lock + per-transfer idempotency keys. */
  async function processBatch(batchId) {
    const lockUntil = () => sqlTime(new Date(now().getTime() + 5 * 60000));
    const got = await q(`UPDATE payout_batches SET lock_owner = ?, lock_until = ? WHERE id = ? AND status IN ('APPROVED', 'PROCESSING') AND (lock_until IS NULL OR lock_until < ? OR lock_owner = ?)`,
      [workerId, lockUntil(), batchId, sqlTime(), workerId]);
    if (!got.affectedRows) return { skipped: true };
    try {
      const b = await loadBatch(batchId);
      await q("UPDATE payout_batches SET status = 'PROCESSING' WHERE id = ? AND status = 'APPROVED'", [batchId]);
      const narration = narrationFor(b.period, b.company_name);
      const items = await q(`SELECT p.*, bf.fund_account_id FROM payout_items p JOIN payout_beneficiaries bf ON bf.id = p.beneficiary_id
        WHERE p.batch_id = ? AND p.status IN ('ready', 'sending', 'unknown') AND p.attempts < ? ORDER BY p.id`, [batchId, MAX_ATTEMPTS]);
      for (const it of items) {
        if (!ENABLED) break; // kill switch flipped while sending
        const claim = await q("UPDATE payout_items SET status = 'sending', attempts = attempts + 1, last_attempt_at = ?, updated_at = ? WHERE id = ? AND status = ?", [sqlTime(), sqlTime(), it.id, it.status]);
        if (!claim.affectedRows) continue;
        await q('UPDATE payout_batches SET lock_until = ? WHERE id = ?', [lockUntil(), batchId]);
        const cur = { ...it, status: 'sending' };
        let p;
        try {
          p = await provider.createPayout({
            fundAccountId: it.fund_account_id, amountPaise: num(it.amount_paise), mode: it.mode, referenceId: it.reference_id, narration,
            idempotencyKey: it.idempotency_key, notes: { hrms_batch: String(batchId), hrms_run_item: String(it.run_item_id), emp: String(it.emp_name || '').slice(0, 60) },
          });
        } catch (e) {
          if (e.retryable || !e.httpStatus) {
            // Timeout / 5xx / anything unclear: the transfer MAY exist. Keep it reserved and retry with the same key.
            await q("UPDATE payout_items SET status = 'unknown', failure_reason = ?, updated_at = ? WHERE id = ? AND status = 'sending'", [`Outcome unknown, will retry with the same key: ${String(e.message).slice(0, 180)}`, sqlTime(), it.id]);
          } else {
            // The provider answered 4xx: it refused the request, so no transfer was created
            await q("UPDATE payout_items SET status = 'failed', failure_reason = ?, active_run_item = NULL, updated_at = ? WHERE id = ? AND status = 'sending'", [String(e.message).slice(0, 250), sqlTime(), it.id]);
          }
          await sleep(250);
          continue;
        }
        try {
          await applyPayout(cur, p);
        } catch (e) {
          // The transfer exists; only our bookkeeping failed. Remember its id; never mark it failed here.
          await q("UPDATE payout_items SET status = 'unknown', provider_payout_id = COALESCE(provider_payout_id, ?), updated_at = ? WHERE id = ?", [p.id || null, sqlTime(), it.id]).catch(() => {});
          console.error(`Payout item ${it.id}: saved status failed:`, e.message);
        }
        await sleep(250); // ~4 requests a second (RazorpayX asks for 5–10 TPS at most)
      }
    } finally {
      await q('UPDATE payout_batches SET lock_owner = NULL, lock_until = NULL WHERE id = ? AND lock_owner = ?', [batchId, workerId]);
      await finalizeBatch(batchId);
    }
    return { done: true };
  }

  /** Asks the provider about open transfers (manual button + slow safety net when webhooks are lost) */
  async function reconcileBatch(batchId, { olderThanMs = 0 } = {}) {
    const items = await q("SELECT * FROM payout_items WHERE batch_id = ? AND status IN ('queued', 'processing', 'unknown', 'sending') ORDER BY id", [batchId]);
    let changed = 0;
    for (const it of items) {
      if (olderThanMs && now() - parseTime(it.updated_at) < olderThanMs) continue;
      try {
        if (it.provider_payout_id) { if (await applyPayout(it, await provider.getPayout(it.provider_payout_id))) changed += 1; }
      } catch (e) { /* try again later */ }
      await sleep(150);
    }
    const resend = await q("SELECT id FROM payout_items WHERE batch_id = ? AND status IN ('unknown', 'sending') AND provider_payout_id IS NULL", [batchId]);
    if (resend.length) {
      // Same idempotency key: the provider returns the existing transfer if the first request did reach it
      await q("UPDATE payout_items SET attempts = 0, status = 'unknown' WHERE batch_id = ? AND status IN ('unknown', 'sending') AND provider_payout_id IS NULL AND (last_attempt_at IS NULL OR last_attempt_at < ?)",
        [batchId, sqlTime(new Date(now().getTime() - 120000))]);
      await processBatch(batchId);
    }
    await finalizeBatch(batchId);
    return changed;
  }

  const lastReconcile = new Map();
  router.post('/pay/payouts/batches/:id/reconcile', authenticate, wrap(async (req, res) => {
    requireReady();
    const b = await loadBatch(req.params.id);
    if (!b) throw fail(404, 'Batch not found.');
    if (!inScope(prepScope(req.dbUser), b.company_id)) throw fail(403, 'Not allowed.');
    if (Date.now() - (lastReconcile.get(b.id) || 0) < 60000) throw fail(429, 'Checked less than a minute ago. Try again shortly.');
    lastReconcile.set(b.id, Date.now());
    const changed = await reconcileBatch(b.id);
    res.json({ message: changed ? `${changed} transfer(s) updated.` : 'No changes from the bank yet.' });
  }));

  // ---------------------------------------------------------------- webhook
  router.post('/pay/payouts/webhook', wrap(async (req, res) => {
    if (!provider.verifyWebhook(req.rawBody, req.headers['x-razorpay-signature'])) return res.status(400).json({ error: 'Invalid signature' });
    const eventId = String(req.headers['x-razorpay-event-id'] || crypto.createHash('sha256').update(req.rawBody).digest('hex')).slice(0, 64);
    try {
      await q('INSERT INTO payout_events (event_id, event, received_at) VALUES (?, ?, ?)', [eventId, String(req.body?.event || '').slice(0, 40), sqlTime()]);
    } catch (e) {
      if (isDup(e)) return res.json({ ok: true, duplicate: true });
      throw e;
    }
    try {
      const ev = provider.parseWebhook(req.body);
      if (ev.kind === 'payout') {
        let item = (await q('SELECT * FROM payout_items WHERE provider_payout_id = ?', [ev.payout.id]))[0];
        if (!item && ev.payout.referenceId) item = (await q('SELECT * FROM payout_items WHERE reference_id = ? AND provider_payout_id IS NULL', [ev.payout.referenceId]))[0];
        if (!item) return res.json({ ok: true, ignored: 'not an HRMS salary transfer' });
        if (num(ev.payout.amount) && num(ev.payout.amount) !== num(item.amount_paise)) {
          await audit(null, 'WEBHOOK_AMOUNT_MISMATCH', { batchId: item.batch_id, details: { itemId: item.id, amount: ev.payout.amount } });
          return res.json({ ok: true, rejected: 'amount mismatch' });
        }
        await applyPayout(item, ev.payout);
        await finalizeBatch(item.batch_id);
      } else if (ev.kind === 'validation') {
        const b = (await q('SELECT * FROM payout_beneficiaries WHERE validation_id = ?', [ev.validation.id]))[0];
        if (b && b.validation_status === 'pending') await applyValidation(b, ev.validation);
      }
      res.json({ ok: true });
    } catch (e) {
      await q('DELETE FROM payout_events WHERE event_id = ?', [eventId]).catch(() => {}); // let the provider retry
      throw e;
    }
  }));

  // ---------------------------------------------------------------- background sweep (resume after restarts)
  async function sweep() {
    if (setupProblems().length) return;
    const batches = await q("SELECT id FROM payout_batches WHERE status IN ('APPROVED', 'PROCESSING') AND (lock_until IS NULL OR lock_until < ?)", [sqlTime()]);
    for (const b of batches) {
      await processBatch(b.id);
      await reconcileBatch(b.id, { olderThanMs: provider.name === 'mock' ? 0 : 2 * 3600000 }); // real providers: webhooks first, ask only if quiet for 2 h
    }
  }
  if (options.startWorker !== false && ENABLED) {
    const timer = setInterval(() => sweep().catch((e) => { if (!isNoTable(e)) console.error('Payout sweep:', e.message); }), 60000);
    if (timer.unref) timer.unref();
  }

  return { router, processBatch, reconcileBatch, sweep, nameMatch };
};
module.exports.nameMatch = nameMatch;
