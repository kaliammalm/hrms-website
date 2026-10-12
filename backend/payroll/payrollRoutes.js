/* ==========================================================================
   Payroll API (mounted at /api in index.js). Needs scripts/add-payroll.js.

   Who can do what
     view   MD / group access / Admin: every company · CEO, HR: own company
     manage MD / group access / Admin: every company · CEO: own company (settings, structures, runs)
     own    every employee: their own payslips from approved / paid runs

   Settings & slabs
     GET  /pay/settings?companyId=            PUT /pay/settings { companyId, ... }
     GET  /pay/pt-slabs?state=TN
   Salary structures
     GET  /pay/structures?companyId=          employees with their current structure + statutory details
     POST /pay/structures/preview             { annualCtc, pfEnabled, pfRestricted, companyId } → monthly breakdown
     POST /pay/structures                     { userId, effectiveFrom, annualCtc? | basic, hra, conveyance, special, other_allowance, ... }
     GET  /pay/structures/:userId/history
     PUT  /pay/employees/:userId/statutory    { pan_number, uan, pf_number, esi_number, bank_name, account_holder_name, account_number, ifsc_code, bank_branch }
   Payroll runs
     GET  /pay/runs?companyId=                POST /pay/runs { companyId, period: 'YYYY-MM' }
     GET  /pay/runs/:id                       run + every employee line
     PATCH /pay/runs/:id/items/:itemId        { lopDays, bonus, tds, otherDeduction, onHold }   (DRAFT only)
     POST /pay/runs/:id/recalculate           re-reads structures / employees              (DRAFT only)
     POST /pay/runs/:id/approve               locks the run, publishes payslips, notifies employees
     POST /pay/runs/:id/reopen                APPROVED → DRAFT (not once paid)
     POST /pay/runs/:id/mark-paid             { paymentDate, reference }
     DELETE /pay/runs/:id                     DRAFT only
     GET  /pay/runs/:id/bank-file/check       which employees are in / out of the bank file and why
     GET  /pay/runs/:id/bank-file?format=GENERIC|COMPACT   CSV for the bank's bulk upload
     GET  /pay/runs/:id/payslips              every payslip of the run (bulk PDF)
   Payslips
     GET  /pay/my-payslips                    GET /pay/payslips/:itemId
   ========================================================================== */
const express = require('express');
const E = require('./payrollEngine');

module.exports = function payrollRoutes(db, authenticate) {
  const router = express.Router();
  const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(`Payroll error (${req.method} ${req.originalUrl || req.url}):`, err);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  });
  const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const num = (v, d = 0) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const periodLabel = (p) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

  // ---------------------------------------------------------------- access
  const roleOf = (u) => String(u?.role || '').toUpperCase();
  const noCompany = (u) => !u?.company_id || Number(u.company_id) === 0;
  const viewScope = (u) => {
    const r = roleOf(u);
    if ((r.includes('MD') || r.includes('ADMIN')) && noCompany(u)) return 'all';
    if (['MD', 'CEO', 'HR', 'ADMIN'].some((x) => r.includes(x)) && !noCompany(u)) return Number(u.company_id);
    return null;
  };
  const manageScope = (u) => {
    const r = roleOf(u);
    if ((r.includes('MD') || r.includes('ADMIN')) && noCompany(u)) return 'all';
    if ((r.includes('MD') || r.includes('CEO') || r.includes('ADMIN')) && !noCompany(u)) return Number(u.company_id);
    return null;
  };
  const allowed = (scope, companyId) => scope === 'all' || (scope !== null && Number(scope) === Number(companyId));
  /** Company for a request: ?companyId / body.companyId for group users, always their own company otherwise */
  const companyFor = (req, scope) => {
    const asked = Number(req.query.companyId || req.body?.companyId || 0);
    if (scope === 'all') return asked || null;
    if (asked && scope !== null && asked !== Number(scope)) return -1; // another company: refused by allowed()
    return scope;
  };

  let ready = false;
  const needSchema = wrap(async (req, res, next) => {
    if (!ready) {
      try { await q('SELECT 1 FROM pay_runs LIMIT 1'); await q('SELECT 1 FROM pay_settings LIMIT 1'); ready = true; } catch (e) { /* not migrated */ }
    }
    if (ready) return next();
    return res.status(503).json({ error: 'Payroll is not set up yet. Run: node scripts/add-payroll.js --apply' });
  });

  // ---------------------------------------------------------------- data helpers
  const settingsFor = async (companyId) => {
    const row = (await q('SELECT * FROM pay_settings WHERE company_id = ?', [companyId]))[0];
    if (row) return row;
    await q('INSERT INTO pay_settings (company_id) VALUES (?)', [companyId]).catch(() => {});
    return (await q('SELECT * FROM pay_settings WHERE company_id = ?', [companyId]))[0] || { company_id: companyId };
  };
  const slabsFor = async (state, period) => {
    const rows = await q('SELECT * FROM pt_slabs WHERE state = ? AND effective_from <= ? ORDER BY effective_from DESC, min_income', [state || 'TN', `${period}-28`]);
    if (!rows.length) return [];
    const latest = String(rows[0].effective_from).slice(0, 10);
    return rows.filter((r) => String(r.effective_from).slice(0, 10) === latest).map((r) => ({ ...r, max_income: r.max_income === null ? null : Number(r.max_income) }));
  };
  const structureFor = async (userId, period) => (await q(
    'SELECT * FROM pay_structures WHERE user_id = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1',
    [userId, `${period}-${String(E.daysInMonth(period)).padStart(2, '0')}`]))[0] || null;
  const dateOnly = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null);

  /** Employees paid by a company for a month: everyone in the company except the MD account, employed during the month */
  const employeesFor = async (companyId, period) => {
    const users = await q('SELECT * FROM users WHERE company_id = ? ORDER BY name', [companyId]);
    const start = `${period}-01`;
    const end = `${period}-${String(E.daysInMonth(period)).padStart(2, '0')}`;
    return users.filter((u) => roleOf(u) !== 'MD')
      .filter((u) => { const j = dateOnly(u.joining_date); return !j || j <= end; })
      .filter((u) => { const x = dateOnly(u.exit_date); return !x || x >= start; });
  };

  /** Figures already paid this half-year / contribution period (approved or paid runs, earlier months) */
  const historyFor = async (userId, period) => {
    const hy = E.halfYear(period);
    const rows = await q(`SELECT r.period, i.gross, i.pt, i.esi_ee, i.esi_er FROM pay_run_items i JOIN pay_runs r ON r.id = i.run_id
      WHERE i.user_id = ? AND r.status IN ('APPROVED', 'PAID') AND r.period >= ? AND r.period < ?`, [userId, hy.start, period]);
    return {
      ptHistory: rows.map((r) => ({ period: r.period, gross: num(r.gross), pt: num(r.pt) })),
      esiCovered: rows.some((r) => num(r.esi_ee) > 0 || num(r.esi_er) > 0),
    };
  };

  const snapshot = (u) => ({
    emp_code: u.emp_code || null, emp_name: u.name || null, designation: u.role || null, department: u.department || null,
    joining_date: dateOnly(u.joining_date), pan: u.pan_number || null, uan: u.uan || null, pf_number: u.pf_number || null,
    esi_number: u.esi_number || null, bank_name: u.bank_name || null, account_holder: u.account_holder_name || u.name || null,
    account_number: u.account_number ? String(u.account_number).replace(/\s/g, '') : null, ifsc: u.ifsc_code ? String(u.ifsc_code).toUpperCase().trim() : null,
  });

  /** Calculates one employee line and writes it (insert or update) */
  const calcItem = async (run, user, settings, slabs, manual = {}) => {
    const structure = await structureFor(user.id, run.period);
    const hist = await historyFor(user.id, run.period);
    const r = E.computePayslip({
      period: run.period, structure: structure || {}, lopDays: manual.lop_days, bonus: manual.bonus, tds: manual.tds, otherDeduction: manual.other_deduction, ptOverride: manual.pt_override,
      joinDate: dateOnly(user.joining_date), exitDate: dateOnly(user.exit_date), esiCoveredThisPeriod: hist.esiCovered, ptHistory: hist.ptHistory,
    }, settings, slabs);
    const row = {
      // New lines without a salary structure start on hold, so nobody gets an empty payslip by accident
      run_id: run.id, user_id: user.id, on_hold: (manual.on_hold === undefined ? !structure : manual.on_hold) ? 1 : 0, ...snapshot(user),
      pt_override: manual.pt_override === undefined || manual.pt_override === '' ? null : manual.pt_override,
      days_in_month: r.daysInMonth, lop_days: r.lopDays, paid_days: r.paidDays,
      bonus: r.earnings.bonus, tds: r.deductions.tds, other_deduction: r.deductions.other,
      basic: r.earnings.basic, hra: r.earnings.hra, conveyance: r.earnings.conveyance, special: r.earnings.special, other_allowance: r.earnings.other_allowance, gross: r.gross,
      pf_ee: r.deductions.pf, esi_ee: r.deductions.esi, pt: r.deductions.pt, total_deductions: r.totalDeductions, net_pay: r.net,
      eps_er: r.employer.eps, epf_er: r.employer.epf, edli_er: r.employer.edli, pf_admin: r.employer.pf_admin, esi_er: r.employer.esi,
      employer_cost: r.employerCost, pf_wage: r.pfWage, esi_wage: r.esiWage,
      warnings: [...r.warnings, ...(r.ptNote ? [`PT: ${r.ptNote}`] : [])].join(' | ').slice(0, 600) || null,
    };
    const existing = (await q('SELECT id FROM pay_run_items WHERE run_id = ? AND user_id = ?', [run.id, user.id]))[0];
    const keys = Object.keys(row);
    if (existing) {
      await q(`UPDATE pay_run_items SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => row[k]), existing.id]);
      return existing.id;
    }
    const ins = await q(`INSERT INTO pay_run_items (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => row[k]));
    return ins.insertId;
  };

  const refreshTotals = async (runId) => {
    const t = (await q(`SELECT COUNT(*) AS n, COALESCE(SUM(gross),0) AS g, COALESCE(SUM(total_deductions),0) AS d, COALESCE(SUM(net_pay),0) AS net,
      COALESCE(SUM(employer_cost),0) AS cost FROM pay_run_items WHERE run_id = ? AND on_hold = 0`, [runId]))[0];
    await q('UPDATE pay_runs SET employees = ?, total_gross = ?, total_deductions = ?, total_net = ?, total_employer_cost = ?, updated_at = ? WHERE id = ?',
      [num(t.n), num(t.g), num(t.d), num(t.net), num(t.cost), nowSql(), runId]);
  };

  const calcRun = async (run) => {
    const settings = await settingsFor(run.company_id);
    const slabs = await slabsFor(E.parseSettings(settings).pt_state, run.period);
    const people = await employeesFor(run.company_id, run.period);
    const keep = new Set(people.map((u) => Number(u.id)));
    const manual = Object.fromEntries((await q('SELECT * FROM pay_run_items WHERE run_id = ?', [run.id])).map((i) => [Number(i.user_id), i]));
    for (const u of people) await calcItem(run, u, settings, slabs, manual[Number(u.id)] || {});
    // People no longer in the company / not employed this month drop out of a draft
    for (const uid of Object.keys(manual)) if (!keep.has(Number(uid))) await q('DELETE FROM pay_run_items WHERE run_id = ? AND user_id = ?', [run.id, uid]);
    await refreshTotals(run.id);
  };

  const loadRun = async (req, res, { manage = false, statuses = null } = {}) => {
    const run = (await q('SELECT r.*, c.name AS company_name FROM pay_runs r LEFT JOIN companies c ON c.id = r.company_id WHERE r.id = ?', [req.params.id]))[0];
    if (!run) { res.status(404).json({ error: 'Payroll run not found.' }); return null; }
    const scope = manage ? manageScope(req.dbUser) : viewScope(req.dbUser);
    if (!allowed(scope, run.company_id)) { res.status(403).json({ error: manage ? 'Only the MD or the company CEO can change payroll.' : 'Not allowed.' }); return null; }
    if (statuses && !statuses.includes(run.status)) {
      res.status(409).json({ error: run.status === 'DRAFT' ? 'Approve the run first.'
        : run.status === 'PAID' ? 'This run is paid and can no longer be changed.'
          : 'This run is approved and can no longer be changed. Reopen it first.' });
      return null;
    }
    return run;
  };

  const runOut = (r) => ({
    id: r.id, companyId: r.company_id, companyName: r.company_name, period: r.period, periodLabel: periodLabel(r.period), status: r.status,
    employees: num(r.employees), totalGross: num(r.total_gross), totalDeductions: num(r.total_deductions), totalNet: num(r.total_net),
    totalEmployerCost: num(r.total_employer_cost), approvedAt: r.approved_at, paidAt: r.paid_at, paymentRef: r.payment_ref,
    createdAt: r.created_at, approvedByName: r.approved_by_name || null,
  });
  const itemOut = (i) => {
    const n = (k) => num(i[k]);
    return {
      id: i.id, userId: i.user_id, onHold: !!Number(i.on_hold), empCode: i.emp_code, name: i.emp_name, designation: i.designation, department: i.department,
      daysInMonth: n('days_in_month'), lopDays: n('lop_days'), paidDays: n('paid_days'),
      earnings: { basic: n('basic'), hra: n('hra'), conveyance: n('conveyance'), special: n('special'), other_allowance: n('other_allowance'), bonus: n('bonus') },
      gross: n('gross'),
      deductions: { pf: n('pf_ee'), esi: n('esi_ee'), pt: n('pt'), tds: n('tds'), other: n('other_deduction') },
      totalDeductions: n('total_deductions'), net: n('net_pay'), ptOverride: i.pt_override === null || i.pt_override === undefined ? null : n('pt_override'),
      employer: { eps: n('eps_er'), epf: n('epf_er'), edli: n('edli_er'), pf_admin: n('pf_admin'), esi: n('esi_er') },
      employerCost: n('employer_cost'), pfWage: n('pf_wage'), esiWage: n('esi_wage'),
      bank: { name: i.bank_name, holder: i.account_holder, account: i.account_number, ifsc: i.ifsc },
      warnings: i.warnings ? String(i.warnings).split(' | ').filter(Boolean) : [],
    };
  };

  // ======================================================================
  // Settings
  // ======================================================================
  const SETTING_FIELDS = {
    pf_enabled: 'bool', pf_ee_rate: 'rate', pf_er_rate: 'rate', eps_rate: 'rate', edli_rate: 'rate', pf_admin_rate: 'rate', pf_ceilings: 'ceilings', pf_in_ctc: 'bool',
    esi_enabled: 'bool', esi_ee_rate: 'rate', esi_er_rate: 'rate', esi_ceiling: 'int', esi_daily_exempt: 'int',
    pt_enabled: 'bool', pt_state: 'text10', pt_mode: 'ptmode', pt_months: 'months', basic_pct: 'pct', hra_pct: 'pct', conveyance: 'int',
    legal_name: 'text160', address: 'text400', pan: 'pan', tan: 'text10', pf_code: 'text40', esi_code: 'text40',
    debit_account: 'acct', debit_ifsc: 'ifsc', debit_bank: 'text60', bank_format: 'format', payslip_note: 'text300',
  };
  const settingsOut = (row) => {
    const p = E.parseSettings(row);
    return { ...row, ...p, pf_ceilings: p.pf_ceilings, pt_months: p.pt_months, pfCeilingThisMonth: Math.round(E.pfCeilingFor(new Date().toISOString().slice(0, 7), p.pf_ceilings)) };
  };

  router.get('/pay/settings', authenticate, needSchema, wrap(async (req, res) => {
    const scope = viewScope(req.dbUser);
    const companyId = companyFor(req, scope);
    if (!companyId || !allowed(scope, companyId)) return res.status(scope ? 400 : 403).json({ error: scope ? 'Choose a company.' : 'Not allowed.' });
    res.json({ settings: settingsOut(await settingsFor(companyId)), canEdit: allowed(manageScope(req.dbUser), companyId) });
  }));

  router.put('/pay/settings', authenticate, needSchema, wrap(async (req, res) => {
    const scope = manageScope(req.dbUser);
    const companyId = companyFor(req, scope);
    if (!companyId || !allowed(scope, companyId)) return res.status(403).json({ error: 'Only the MD or the company CEO can change payroll settings.' });
    await settingsFor(companyId);
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const errors = [];
    Object.entries(SETTING_FIELDS).forEach(([k, type]) => {
      if (b[k] === undefined) return;
      let v = b[k];
      switch (type) {
        case 'bool': v = v ? 1 : 0; break;
        case 'rate': v = Number(v); if (!(v >= 0 && v <= 100)) errors.push(k); break;
        case 'pct': v = Number(v); if (!(v > 0 && v <= 100)) errors.push(k); break;
        case 'int': v = Math.round(Number(v)); if (!(v >= 0 && v <= 10000000)) errors.push(k); break;
        case 'ptmode': if (!['HALF_YEARLY_LUMP', 'HALF_YEARLY_SPREAD'].includes(v)) errors.push(k); break;
        case 'format': if (!['GENERIC', 'COMPACT'].includes(v)) errors.push(k); break;
        case 'months': {
          const arr = Array.isArray(v) ? v.map(Number) : [];
          if (!arr.length || arr.some((m) => !(m >= 1 && m <= 12))) errors.push(k); else v = JSON.stringify(arr);
          break;
        }
        case 'ceilings': {
          const arr = Array.isArray(v) ? v : [];
          const ok = arr.length && arr.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.from) && Number(c.amount) > 0);
          if (!ok) errors.push(k); else v = JSON.stringify(arr.map((c) => ({ from: c.from, amount: Number(c.amount) })).sort((x, y) => x.from.localeCompare(y.from)));
          break;
        }
        case 'pan': v = String(v || '').toUpperCase().trim() || null; if (v && !/^[A-Z]{5}\d{4}[A-Z]$/.test(v)) errors.push('pan'); break;
        case 'ifsc': v = String(v || '').toUpperCase().trim() || null; if (v && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v)) errors.push('debit_ifsc'); break;
        case 'acct': v = String(v || '').replace(/\s/g, '') || null; if (v && !/^\d{6,20}$/.test(v)) errors.push('debit_account'); break;
        default: { const max = Number(type.replace('text', '')) || 160; v = String(v ?? '').trim().slice(0, max) || null; }
      }
      sets.push(`${k} = ?`); vals.push(v);
    });
    if (errors.length) return res.status(400).json({ error: `Please check: ${[...new Set(errors)].join(', ')}.` });
    if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
    await q(`UPDATE pay_settings SET ${sets.join(', ')}, updated_by = ?, updated_at = ? WHERE company_id = ?`, [...vals, req.dbUser.id, nowSql(), companyId]);
    res.json({ message: 'Payroll settings saved.', settings: settingsOut(await settingsFor(companyId)) });
  }));

  router.get('/pay/pt-slabs', authenticate, needSchema, wrap(async (req, res) => {
    const state = String(req.query.state || 'TN').toUpperCase().slice(0, 10);
    res.json({ state, slabs: await slabsFor(state, new Date().toISOString().slice(0, 7)) });
  }));

  // ======================================================================
  // Salary structures
  // ======================================================================
  const structOut = (s) => (s ? {
    id: s.id, effectiveFrom: dateOnly(s.effective_from), annualCtc: s.annual_ctc === null ? null : num(s.annual_ctc),
    basic: num(s.basic), hra: num(s.hra), conveyance: num(s.conveyance), special: num(s.special), other_allowance: num(s.other_allowance),
    gross: num(s.basic) + num(s.hra) + num(s.conveyance) + num(s.special) + num(s.other_allowance),
    pfEnabled: !!Number(s.pf_enabled), pfRestricted: !!Number(s.pf_restricted), esiOverride: s.esi_override === null ? null : Number(s.esi_override), notes: s.notes,
  } : null);

  router.get('/pay/structures', authenticate, needSchema, wrap(async (req, res) => {
    const scope = viewScope(req.dbUser);
    const companyId = companyFor(req, scope);
    if (!companyId || !allowed(scope, companyId)) return res.status(scope ? 400 : 403).json({ error: scope ? 'Choose a company.' : 'Not allowed.' });
    const period = new Date().toISOString().slice(0, 7);
    const settings = await settingsFor(companyId);
    const people = await employeesFor(companyId, period);
    const out = [];
    for (const u of people) {
      const s = structOut(await structureFor(u.id, '9999-12'));
      const missing = [];
      if (!s || !s.gross) missing.push('salary');
      if (!u.account_number || !u.ifsc_code) missing.push('bank');
      if (!u.pan_number) missing.push('PAN');
      if (s && s.pfEnabled && !u.uan) missing.push('UAN');
      out.push({
        userId: u.id, empCode: u.emp_code, name: u.name, designation: u.role, department: u.department, joiningDate: dateOnly(u.joining_date),
        structure: s, missing,
        statutory: { pan_number: u.pan_number || '', uan: u.uan || '', pf_number: u.pf_number || '', esi_number: u.esi_number || '', bank_name: u.bank_name || '', account_holder_name: u.account_holder_name || '', account_number: u.account_number || '', ifsc_code: u.ifsc_code || '', bank_branch: u.bank_branch || '' },
      });
    }
    res.json({ companyId, settings: settingsOut(settings), employees: out, canEdit: allowed(manageScope(req.dbUser), companyId) });
  }));

  router.post('/pay/structures/preview', authenticate, needSchema, wrap(async (req, res) => {
    const scope = viewScope(req.dbUser);
    const companyId = companyFor(req, scope);
    if (!companyId || !allowed(scope, companyId)) return res.status(403).json({ error: 'Not allowed.' });
    const b = req.body || {};
    const settings = await settingsFor(companyId);
    const period = /^\d{4}-\d{2}$/.test(String(b.period || '')) ? b.period : new Date().toISOString().slice(0, 7);
    let structure;
    if (b.annualCtc !== undefined && b.annualCtc !== null && b.annualCtc !== '') {
      if (!(Number(b.annualCtc) > 0)) return res.status(400).json({ error: 'Enter the annual CTC in rupees.' });
      structure = E.structureFromCtc(b.annualCtc, settings, { period, pfEnabled: b.pfEnabled !== false, pfRestricted: b.pfRestricted !== false });
    } else {
      structure = { basic: num(b.basic), hra: num(b.hra), conveyance: num(b.conveyance), special: num(b.special), other_allowance: num(b.other_allowance) };
    }
    const slabs = await slabsFor(E.parseSettings(settings).pt_state, period);
    const month = E.computePayslip({ period, structure: { ...structure, pf_enabled: b.pfEnabled === false ? 0 : 1, pf_restricted: b.pfRestricted === false ? 0 : 1, esi_override: b.esiOverride ?? null } }, settings, slabs);
    res.json({ structure, month, period });
  }));

  router.post('/pay/structures', authenticate, needSchema, wrap(async (req, res) => {
    const b = req.body || {};
    const user = (await q('SELECT * FROM users WHERE id = ?', [b.userId]))[0];
    if (!user) return res.status(404).json({ error: 'Employee not found.' });
    if (!allowed(manageScope(req.dbUser), user.company_id)) return res.status(403).json({ error: 'Only the MD or the company CEO can change salaries.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.effectiveFrom || ''))) return res.status(400).json({ error: 'Choose the date this salary starts from.' });
    const settings = await settingsFor(user.company_id);
    let s;
    if (b.annualCtc !== undefined && b.annualCtc !== null && b.annualCtc !== '' && b.mode !== 'MANUAL') {
      if (!(Number(b.annualCtc) > 0)) return res.status(400).json({ error: 'Enter the annual CTC in rupees.' });
      s = E.structureFromCtc(b.annualCtc, settings, { period: b.effectiveFrom.slice(0, 7), pfEnabled: b.pfEnabled !== false, pfRestricted: b.pfRestricted !== false });
      if (s.warnings.length) return res.status(400).json({ error: s.warnings[0] });
    } else {
      s = { annualCtc: b.annualCtc ? Number(b.annualCtc) : null, basic: num(b.basic), hra: num(b.hra), conveyance: num(b.conveyance), special: num(b.special), other_allowance: num(b.other_allowance) };
      if (['basic', 'hra', 'conveyance', 'special', 'other_allowance'].some((k) => s[k] < 0)) return res.status(400).json({ error: 'Amounts cannot be negative.' });
      if (!(s.basic > 0)) return res.status(400).json({ error: 'Basic pay is required.' });
    }
    const esi = b.esiOverride === null || b.esiOverride === undefined || b.esiOverride === '' ? null : (Number(b.esiOverride) ? 1 : 0);
    const ins = await q(`INSERT INTO pay_structures (user_id, effective_from, annual_ctc, basic, hra, conveyance, special, other_allowance, pf_enabled, pf_restricted, esi_override, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, b.effectiveFrom, s.annualCtc || null, s.basic, s.hra, s.conveyance, s.special, s.other_allowance, b.pfEnabled === false ? 0 : 1, b.pfRestricted === false ? 0 : 1, esi,
      String(b.notes || '').slice(0, 300) || null, req.dbUser.id, nowSql()]);
    // Keep the older screens (profile, legacy payroll) in step
    await q('UPDATE users SET monthly_salary = ?, hra = ?, allowances = ? WHERE id = ?', [s.basic, s.hra, s.conveyance + s.special + s.other_allowance, user.id]).catch(() => {});
    res.status(201).json({ message: 'Salary structure saved.', structure: structOut((await q('SELECT * FROM pay_structures WHERE id = ?', [ins.insertId]))[0]) });
  }));

  router.get('/pay/structures/:userId/history', authenticate, needSchema, wrap(async (req, res) => {
    const user = (await q('SELECT id, company_id FROM users WHERE id = ?', [req.params.userId]))[0];
    if (!user) return res.status(404).json({ error: 'Employee not found.' });
    if (!allowed(viewScope(req.dbUser), user.company_id)) return res.status(403).json({ error: 'Not allowed.' });
    const rows = await q('SELECT * FROM pay_structures WHERE user_id = ? ORDER BY effective_from DESC, id DESC', [user.id]);
    res.json({ history: rows.map(structOut) });
  }));

  router.put('/pay/employees/:userId/statutory', authenticate, needSchema, wrap(async (req, res) => {
    const user = (await q('SELECT id, company_id FROM users WHERE id = ?', [req.params.userId]))[0];
    if (!user) return res.status(404).json({ error: 'Employee not found.' });
    if (!allowed(manageScope(req.dbUser), user.company_id)) return res.status(403).json({ error: 'Only the MD or the company CEO can change these details.' });
    const b = req.body || {};
    const rules = {
      pan_number: [/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN must look like ABCDE1234F'],
      uan: [/^\d{12}$/, 'UAN must be 12 digits'],
      pf_number: [/^[A-Z0-9/]{5,40}$/, 'PF number: letters, digits and /'],
      esi_number: [/^\d{10,17}$/, 'ESI number: 10 to 17 digits'],
      account_number: [/^\d{6,20}$/, 'Account number: 6 to 20 digits'],
      ifsc_code: [/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC must be 11 characters with 0 as the 5th'],
      bank_name: [/^.{2,80}$/, 'Bank name'], account_holder_name: [/^.{2,120}$/, 'Account holder name'], bank_branch: [/^.{2,120}$/, 'Branch'],
    };
    const cols = new Set((await q('SHOW COLUMNS FROM users')).map((c) => c.Field));
    const sets = []; const vals = []; const errors = [];
    Object.entries(rules).forEach(([k, [re, msg]]) => {
      if (b[k] === undefined || !cols.has(k)) return;
      let v = String(b[k] ?? '').trim();
      if (['pan_number', 'ifsc_code', 'pf_number'].includes(k)) v = v.toUpperCase();
      if (['account_number', 'uan', 'esi_number'].includes(k)) v = v.replace(/\s/g, '');
      if (v && !re.test(v)) { errors.push(msg); return; }
      sets.push(`${k} = ?`); vals.push(v || null);
    });
    if (errors.length) return res.status(400).json({ error: `${errors.join('; ')}.` });
    if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
    await q(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...vals, user.id]);
    res.json({ message: 'Statutory and bank details saved.' });
  }));

  // ======================================================================
  // Runs
  // ======================================================================
  router.get('/pay/runs', authenticate, needSchema, wrap(async (req, res) => {
    const scope = viewScope(req.dbUser);
    if (scope === null) return res.status(403).json({ error: 'Not allowed.' });
    const companyId = companyFor(req, scope);
    const rows = await q(`SELECT r.*, c.name AS company_name, a.name AS approved_by_name FROM pay_runs r LEFT JOIN companies c ON c.id = r.company_id
      LEFT JOIN users a ON a.id = r.approved_by ${companyId ? 'WHERE r.company_id = ?' : ''} ORDER BY r.period DESC, c.name LIMIT 120`, companyId ? [companyId] : []);
    res.json({ runs: rows.map(runOut), canManage: companyId ? allowed(manageScope(req.dbUser), companyId) : manageScope(req.dbUser) === 'all' });
  }));

  router.post('/pay/runs', authenticate, needSchema, wrap(async (req, res) => {
    const scope = manageScope(req.dbUser);
    const companyId = companyFor(req, scope);
    if (!companyId || !allowed(scope, companyId)) return res.status(403).json({ error: 'Only the MD or the company CEO can run payroll.' });
    const period = String(req.body?.period || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(400).json({ error: 'Choose the payroll month.' });
    const thisMonth = new Date().toISOString().slice(0, 7);
    const next = new Date(Date.UTC(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)), 1)).toISOString().slice(0, 7);
    if (period > next) return res.status(400).json({ error: 'Payroll can be run up to next month only.' });
    const dup = (await q('SELECT id, status FROM pay_runs WHERE company_id = ? AND period = ?', [companyId, period]))[0];
    if (dup) return res.status(409).json({ error: `A payroll run for ${periodLabel(period)} already exists.`, runId: dup.id });
    const ins = await q('INSERT INTO pay_runs (company_id, period, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [companyId, period, 'DRAFT', req.dbUser.id, nowSql(), nowSql()]);
    const run = (await q('SELECT * FROM pay_runs WHERE id = ?', [ins.insertId]))[0];
    await calcRun(run);
    const full = (await q('SELECT r.*, c.name AS company_name FROM pay_runs r LEFT JOIN companies c ON c.id = r.company_id WHERE r.id = ?', [run.id]))[0];
    res.status(201).json({ message: `Payroll for ${periodLabel(period)} calculated.`, run: runOut(full) });
  }));

  router.get('/pay/runs/:id', authenticate, needSchema, wrap(async (req, res) => {
    const run = await loadRun(req, res);
    if (!run) return;
    const approver = run.approved_by ? (await q('SELECT name FROM users WHERE id = ?', [run.approved_by]))[0] : null;
    const items = await q('SELECT * FROM pay_run_items WHERE run_id = ? ORDER BY emp_name', [run.id]);
    const settings = settingsOut(await settingsFor(run.company_id));
    res.json({
      run: runOut({ ...run, approved_by_name: approver?.name }), items: items.map(itemOut),
      settings: { pfCeiling: Math.round(E.pfCeilingFor(run.period, settings.pf_ceilings)), esiCeiling: settings.esi_ceiling, ptState: settings.pt_state, ptMode: settings.pt_mode },
      canManage: allowed(manageScope(req.dbUser), run.company_id),
    });
  }));

  router.patch('/pay/runs/:id/items/:itemId', authenticate, needSchema, wrap(async (req, res) => {
    const run = await loadRun(req, res, { manage: true, statuses: ['DRAFT'] });
    if (!run) return;
    const item = (await q('SELECT * FROM pay_run_items WHERE id = ? AND run_id = ?', [req.params.itemId, run.id]))[0];
    if (!item) return res.status(404).json({ error: 'Employee line not found.' });
    const b = req.body || {};
    const manual = { lop_days: item.lop_days, bonus: item.bonus, tds: item.tds, other_deduction: item.other_deduction, on_hold: Number(item.on_hold), pt_override: item.pt_override };
    const dim = E.daysInMonth(run.period);
    if (b.lopDays !== undefined) { const v = Number(b.lopDays); if (!(v >= 0 && v <= dim) || Math.round(v * 2) !== v * 2) return res.status(400).json({ error: `LOP days must be between 0 and ${dim} (half days allowed).` }); manual.lop_days = v; }
    for (const [k, key] of [['bonus', 'bonus'], ['tds', 'tds'], ['otherDeduction', 'other_deduction']]) {
      if (b[k] !== undefined) { const v = Number(b[k]); if (!(v >= 0 && v <= 10000000)) return res.status(400).json({ error: 'Amounts must be zero or more.' }); manual[key] = v; }
    }
    if (b.onHold !== undefined) manual.on_hold = b.onHold ? 1 : 0;
    // PT override: e.g. the first half-year after go-live, when earlier months were paid outside the HRMS
    if (b.ptOverride !== undefined) {
      if (b.ptOverride === null || b.ptOverride === '') manual.pt_override = null;
      else { const v = Number(b.ptOverride); if (!(v >= 0 && v <= 2500)) return res.status(400).json({ error: 'Professional tax override must be between 0 and 2,500.' }); manual.pt_override = v; }
    }
    const user = (await q('SELECT * FROM users WHERE id = ?', [item.user_id]))[0] || { id: item.user_id, name: item.emp_name };
    const settings = await settingsFor(run.company_id);
    const slabs = await slabsFor(E.parseSettings(settings).pt_state, run.period);
    await calcItem(run, user, settings, slabs, manual);
    await refreshTotals(run.id);
    const fresh = (await q('SELECT * FROM pay_run_items WHERE id = ?', [item.id]))[0];
    const r2 = (await q('SELECT r.*, c.name AS company_name FROM pay_runs r LEFT JOIN companies c ON c.id = r.company_id WHERE r.id = ?', [run.id]))[0];
    res.json({ item: itemOut(fresh), run: runOut(r2) });
  }));

  router.post('/pay/runs/:id/recalculate', authenticate, needSchema, wrap(async (req, res) => {
    const run = await loadRun(req, res, { manage: true, statuses: ['DRAFT'] });
    if (!run) return;
    await calcRun(run);
    res.json({ message: 'Recalculated with the latest salaries and employee details.' });
  }));

  // Notifications table may have an older layout: fill what exists
  const notify = async (userIds, title, body, refId) => {
    try {
      const cols = new Set((await q('SHOW COLUMNS FROM notifications')).map((c) => c.Field));
      for (const id of userIds) {
        const data = { recipient_id: id, type: 'PAYSLIP', title, body, ref_table: 'pay_run_items', ref_id: refId, created_at: nowSql(), user_id: id, message: `${title}: ${body}`, is_read: 0 };
        const keys = Object.keys(data).filter((k) => cols.has(k));
        await q(`INSERT INTO notifications (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => data[k]));
      }
    } catch (e) { console.warn('Payslip notifications skipped:', e.message); }
  };

  router.post('/pay/runs/:id/approve', authenticate, needSchema, wrap(async (req, res) => {
    const run = await loadRun(req, res, { manage: true, statuses: ['DRAFT'] });
    if (!run) return;
    await calcRun(run); // never approve stale figures
    const items = await q('SELECT * FROM pay_run_items WHERE run_id = ?', [run.id]);
    const payable = items.filter((i) => !Number(i.on_hold));
    if (!payable.length) return res.status(400).json({ error: 'There is nobody to pay in this run.' });
    const negative = payable.filter((i) => num(i.net_pay) < 0);
    if (negative.length) return res.status(400).json({ error: `Net pay is negative for ${negative.map((i) => i.emp_name).join(', ')}. Fix the deductions or put them on hold.` });
    const noSalary = payable.filter((i) => !num(i.gross));
    if (noSalary.length) return res.status(400).json({ error: `No pay for ${noSalary.map((i) => i.emp_name).join(', ')}. Add a salary structure or put them on hold.` });
    await q("UPDATE pay_runs SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?", [req.dbUser.id, nowSql(), nowSql(), run.id]);
    // Older screens and reports read the payslips table: keep it in step (best effort)
    const label = periodLabel(run.period);
    for (const i of payable) {
      await q('DELETE FROM payslips WHERE employee_id = ? AND month = ?', [i.user_id, label]).catch(() => {});
      await q('INSERT INTO payslips (employee_id, company_id, month, basic_salary, hra, allowances, deductions, net_pay, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [i.user_id, run.company_id, label, num(i.basic), num(i.hra), num(i.conveyance) + num(i.special) + num(i.other_allowance) + num(i.bonus), num(i.total_deductions), num(i.net_pay), 'Approved'])
        .catch((e) => console.warn('Legacy payslip row skipped:', e.message));
    }
    for (const i of payable) await notify([i.user_id], `Payslip for ${label} is ready`, `Net pay ₹${num(i.net_pay).toLocaleString('en-IN')}. Open Payslips to download it.`, i.id);
    res.json({ message: `Payroll for ${label} approved. ${payable.length} payslips published.`, onHold: items.length - payable.length });
  }));

  router.post('/pay/runs/:id/reopen', authenticate, needSchema, wrap(async (req, res) => {
    const run = await loadRun(req, res, { manage: true, statuses: ['APPROVED'] });
    if (!run) return;
    await q("UPDATE pay_runs SET status = 'DRAFT', approved_by = NULL, approved_at = NULL, updated_at = ? WHERE id = ?", [nowSql(), run.id]);
    await q("UPDATE payslips SET status = 'Pending' WHERE month = ? AND company_id = ?", [periodLabel(run.period), run.company_id]).catch(() => {});
    res.json({ message: 'Run reopened. Payslips are hidden from employees until it is approved again.' });
  }));

  router.post('/pay/runs/:id/mark-paid', authenticate, needSchema, wrap(async (req, res) => {
    const run = await loadRun(req, res, { manage: true, statuses: ['APPROVED'] });
    if (!run) return;
    const date = String(req.body?.paymentDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Enter the payment date.' });
    const ref = String(req.body?.reference || '').trim().slice(0, 80) || null;
    await q("UPDATE pay_runs SET status = 'PAID', paid_at = ?, payment_ref = ?, updated_at = ? WHERE id = ?", [date, ref, nowSql(), run.id]);
    await q("UPDATE payslips SET status = 'Paid' WHERE month = ? AND company_id = ?", [periodLabel(run.period), run.company_id]).catch(() => {});
    res.json({ message: `Marked as paid on ${date}.` });
  }));

  router.delete('/pay/runs/:id', authenticate, needSchema, wrap(async (req, res) => {
    const run = await loadRun(req, res, { manage: true, statuses: ['DRAFT'] });
    if (!run) return;
    await q('DELETE FROM pay_run_items WHERE run_id = ?', [run.id]);
    await q('DELETE FROM pay_runs WHERE id = ?', [run.id]);
    res.json({ message: 'Draft run deleted.' });
  }));

  // ======================================================================
  // Bank transfer file
  // ======================================================================
  const bankCheck = async (run) => {
    const settings = await settingsFor(run.company_id);
    const items = await q('SELECT * FROM pay_run_items WHERE run_id = ? ORDER BY emp_name', [run.id]);
    const debitBankCode = String(settings.debit_ifsc || '').slice(0, 4);
    const included = []; const excluded = [];
    items.forEach((i) => {
      const why = [];
      if (Number(i.on_hold)) why.push('on hold');
      if (!(num(i.net_pay) > 0)) why.push('no net pay');
      if (!/^\d{6,20}$/.test(String(i.account_number || ''))) why.push('missing or invalid account number');
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(i.ifsc || ''))) why.push('missing or invalid IFSC');
      const row = { itemId: i.id, empCode: i.emp_code, name: i.emp_name, holder: i.account_holder || i.emp_name, account: i.account_number, ifsc: i.ifsc, amount: num(i.net_pay) };
      if (why.length) excluded.push({ ...row, reasons: why });
      else included.push({ ...row, mode: debitBankCode && String(i.ifsc).slice(0, 4) === debitBankCode ? 'IFT' : 'NEFT' });
    });
    return { settings, included, excluded, total: included.reduce((n, r) => n + r.amount, 0) };
  };

  router.get('/pay/runs/:id/bank-file/check', authenticate, needSchema, wrap(async (req, res) => {
    const run = await loadRun(req, res, { manage: true });
    if (!run) return;
    const c = await bankCheck(run);
    res.json({
      status: run.status, included: c.included.length, total: c.total, excluded: c.excluded,
      debitAccount: c.settings.debit_account ? `••••${String(c.settings.debit_account).slice(-4)}` : null, format: c.settings.bank_format || 'GENERIC',
    });
  }));

  // Spreadsheet-safe CSV cell (blocks formula injection)
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  router.get('/pay/runs/:id/bank-file', authenticate, needSchema, wrap(async (req, res) => {
    const run = await loadRun(req, res, { manage: true, statuses: ['APPROVED', 'PAID'] });
    if (!run) return;
    const c = await bankCheck(run);
    if (!c.included.length) return res.status(400).json({ error: 'No employee has complete bank details and a net pay.' });
    const format = String(req.query.format || c.settings.bank_format || 'GENERIC').toUpperCase();
    const narration = `Salary ${periodLabel(run.period)}`.slice(0, 30);
    const company = (await q('SELECT name FROM companies WHERE id = ?', [run.company_id]))[0]?.name || 'Company';
    let lines;
    if (format === 'COMPACT') {
      // Minimal 4-column layout many bank portals accept for bulk NEFT
      lines = [['Beneficiary Account Number', 'IFSC', 'Beneficiary Name', 'Amount'],
        ...c.included.map((r) => [r.account, r.ifsc, r.holder, r.amount.toFixed(2)])];
    } else {
      lines = [['Sr No', 'Payment Mode', 'Debit Account Number', 'Beneficiary Name', 'Beneficiary Account Number', 'IFSC', 'Amount', 'Value Date', 'Narration', 'Employee Code', 'Reference'],
        ...c.included.map((r, n) => [n + 1, r.mode, c.settings.debit_account || '', r.holder, r.account, r.ifsc, r.amount.toFixed(2), new Date().toISOString().slice(0, 10), narration, r.empCode || '', `PAY${run.id}-${r.itemId}`])];
    }
    const csv = `${lines.map((l) => l.map(cell).join(',')).join('\r\n')}\r\n`;
    const file = `Salary_${company.replace(/[^A-Za-z0-9]+/g, '_')}_${run.period}_${format}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('X-Excluded-Count', String(c.excluded.length));
    res.send(csv);
  }));

  // ======================================================================
  // Payslips
  // ======================================================================
  const payslipOut = async (i, run) => {
    const settings = settingsOut(await settingsFor(run.company_id));
    const company = (await q('SELECT name FROM companies WHERE id = ?', [run.company_id]))[0] || {};
    // Year to date (financial year April–March), approved or paid runs up to this month
    const fyStart = Number(run.period.slice(5, 7)) >= 4 ? `${run.period.slice(0, 4)}-04` : `${Number(run.period.slice(0, 4)) - 1}-04`;
    const ytd = (await q(`SELECT COALESCE(SUM(i.gross),0) AS gross, COALESCE(SUM(i.pf_ee),0) AS pf, COALESCE(SUM(i.esi_ee),0) AS esi, COALESCE(SUM(i.pt),0) AS pt,
      COALESCE(SUM(i.tds),0) AS tds, COALESCE(SUM(i.net_pay),0) AS net FROM pay_run_items i JOIN pay_runs r ON r.id = i.run_id
      WHERE i.user_id = ? AND r.company_id = ? AND r.status IN ('APPROVED','PAID') AND r.period >= ? AND r.period <= ? AND i.on_hold = 0`, [i.user_id, run.company_id, fyStart, run.period]))[0];
    const it = itemOut(i);
    const structure = await structureFor(i.user_id, run.period);
    const fullOf = (k) => (structure ? num(structure[k]) : null);
    const earnings = [
      ['Basic', 'basic'], ['House Rent Allowance', 'hra'], ['Conveyance Allowance', 'conveyance'], ['Special Allowance', 'special'], ['Other Allowance', 'other_allowance'],
    ].map(([label, k]) => ({ label, full: fullOf(k), amount: it.earnings[k] })).filter((e) => e.amount || e.full);
    if (it.earnings.bonus) earnings.push({ label: 'Bonus / Arrears', full: null, amount: it.earnings.bonus });
    const deductions = [
      ['Provident Fund (EPF)', 'pf'], ['ESI', 'esi'], ['Professional Tax', 'pt'], ['Income Tax (TDS)', 'tds'], ['Other Deductions', 'other'],
    ].map(([label, k]) => ({ label, amount: it.deductions[k] })).filter((d) => d.amount);
    return {
      id: i.id, runId: run.id, period: run.period, periodLabel: periodLabel(run.period), status: run.status, paidAt: run.paid_at,
      company: { id: run.company_id, name: settings.legal_name || company.name, shortName: company.name, address: settings.address, pan: settings.pan, tan: settings.tan, pfCode: settings.pf_code, esiCode: settings.esi_code, note: settings.payslip_note },
      employee: {
        name: i.emp_name, empCode: i.emp_code, designation: i.designation, department: i.department, joiningDate: i.joining_date,
        pan: i.pan, uan: i.uan, pfNumber: i.pf_number, esiNumber: i.esi_number, bankName: i.bank_name,
        account: i.account_number ? `XXXX${String(i.account_number).slice(-4)}` : null, ifsc: i.ifsc,
      },
      days: { inMonth: it.daysInMonth, paid: it.paidDays, lop: it.lopDays },
      earnings, deductions, gross: it.gross, totalDeductions: it.totalDeductions, net: it.net, netInWords: E.amountInWords(it.net),
      employer: it.employer,
      ytd: { gross: num(ytd.gross), pf: num(ytd.pf), esi: num(ytd.esi), pt: num(ytd.pt), tds: num(ytd.tds), net: num(ytd.net) },
    };
  };

  router.get('/pay/my-payslips', authenticate, needSchema, wrap(async (req, res) => {
    const rows = await q(`SELECT i.id, i.net_pay, i.gross, i.total_deductions, r.period, r.status, r.paid_at, c.name AS company_name FROM pay_run_items i
      JOIN pay_runs r ON r.id = i.run_id LEFT JOIN companies c ON c.id = r.company_id
      WHERE i.user_id = ? AND r.status IN ('APPROVED','PAID') AND i.on_hold = 0 ORDER BY r.period DESC`, [req.dbUser.id]);
    res.json({ payslips: rows.map((r) => ({ id: r.id, period: r.period, periodLabel: periodLabel(r.period), status: r.status, paidAt: r.paid_at, company: r.company_name, gross: num(r.gross), deductions: num(r.total_deductions), net: num(r.net_pay) })) });
  }));

  router.get('/pay/payslips/:itemId', authenticate, needSchema, wrap(async (req, res) => {
    const i = (await q('SELECT * FROM pay_run_items WHERE id = ?', [req.params.itemId]))[0];
    if (!i) return res.status(404).json({ error: 'Payslip not found.' });
    const run = (await q('SELECT * FROM pay_runs WHERE id = ?', [i.run_id]))[0];
    const own = Number(i.user_id) === Number(req.dbUser.id);
    if (own) {
      if (!['APPROVED', 'PAID'].includes(run.status) || Number(i.on_hold)) return res.status(404).json({ error: 'This payslip is not available yet.' });
    } else if (!allowed(viewScope(req.dbUser), run.company_id)) return res.status(403).json({ error: 'Not allowed.' });
    res.json({ payslip: await payslipOut(i, run) });
  }));

  router.get('/pay/runs/:id/payslips', authenticate, needSchema, wrap(async (req, res) => {
    const run = await loadRun(req, res);
    if (!run) return;
    const items = await q('SELECT * FROM pay_run_items WHERE run_id = ? AND on_hold = 0 ORDER BY emp_name', [run.id]);
    const out = [];
    for (const i of items) out.push(await payslipOut(i, run));
    res.json({ payslips: out });
  }));

  return router;
};
