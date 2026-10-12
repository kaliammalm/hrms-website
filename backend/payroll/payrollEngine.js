/* ==========================================================================
   Payroll engine (India): pure functions, no database.
   Used by payrollRoutes.js and by the tests in scripts/test-payroll-engine.js.

   Monthly salary structure:
     Earnings      Basic, HRA, Conveyance, Special allowance (balancing), Other allowance
     Employee      PF 12% of PF wage, ESI 0.75% of ESI wage, Professional Tax, TDS (manual), other (manual)
     Employer      EPS 8.33% (on PF wage up to the ceiling), EPF 12% − EPS, EDLI 0.5%, PF admin 0.5%, ESI 3.25%

   Statutory values come from pay_settings (per company) so they can be changed without code:
     PF wage ceiling     ₹15,000 → ₹25,000 from 17-Sep-2026 (dated list, prorated in the change month)
     ESI                 gross ≤ ₹21,000; 0.75% / 3.25%; employee share waived if average daily wage ≤ ₹176;
                         once covered, covered until the end of the contribution period (Apr–Sep, Oct–Mar)
     Professional Tax    slabs per state; Tamil Nadu is half-yearly (Apr–Sep, Oct–Mar)
   Rounding: PF / EPS / EDLI / admin to the nearest rupee, ESI up to the next rupee (ESIC rule),
             earnings to the nearest rupee.
   ========================================================================== */

const DEFAULT_SETTINGS = {
  pf_enabled: 1,
  pf_ee_rate: 12,
  pf_er_rate: 12,
  eps_rate: 8.33,
  edli_rate: 0.5,
  pf_admin_rate: 0.5,
  // Dated PF wage ceilings. The change month is prorated by calendar days.
  pf_ceilings: [{ from: '2014-09-01', amount: 15000 }, { from: '2026-09-17', amount: 25000 }],
  pf_in_ctc: 1,                 // employer PF is part of CTC (Zoho / Keka default)
  esi_enabled: 1,
  esi_ee_rate: 0.75,
  esi_er_rate: 3.25,
  esi_ceiling: 21000,
  esi_daily_exempt: 176,
  pt_enabled: 1,
  pt_state: 'TN',
  pt_mode: 'HALF_YEARLY_LUMP',  // HALF_YEARLY_LUMP (deducted in the months below) | HALF_YEARLY_SPREAD (1/6 each month)
  pt_months: [9, 3],
  basic_pct: 50,                // % of monthly CTC (labour-code friendly: basic ≥ 50% of wages)
  hra_pct: 50,                  // % of basic (50% metro, 40% non-metro)
  conveyance: 0,                // fixed monthly conveyance allowance
};

const r0 = (n) => Math.round(Number(n) || 0);
const up = (n) => Math.ceil((Number(n) || 0) - 1e-9);
const num = (v, d = 0) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const clamp0 = (n) => Math.max(0, n);

function parseSettings(row) {
  const s = { ...DEFAULT_SETTINGS };
  if (!row) return s;
  Object.keys(DEFAULT_SETTINGS).forEach((k) => {
    if (row[k] === undefined || row[k] === null || row[k] === '') return;
    if (k === 'pf_ceilings' || k === 'pt_months') {
      try { s[k] = typeof row[k] === 'string' ? JSON.parse(row[k]) : row[k]; } catch (e) { /* keep default */ }
    } else if (typeof DEFAULT_SETTINGS[k] === 'number') s[k] = Number(row[k]);
    else s[k] = row[k];
  });
  return s;
}

/* ---------------------------------------------------------------- dates */
const daysInMonth = (period) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const monthOf = (period) => Number(period.split('-')[1]);
const yearOf = (period) => Number(period.split('-')[0]);
/** Half-year (PT) / contribution period (ESI) containing a month: Apr–Sep or Oct–Mar */
function halfYear(period) {
  const y = yearOf(period); const m = monthOf(period);
  if (m >= 4 && m <= 9) return { start: `${y}-04`, end: `${y}-09`, key: `${y}-H1` };
  const fy = m >= 10 ? y : y - 1;
  return { start: `${fy}-10`, end: `${fy + 1}-03`, key: `${fy}-H2` };
}
const monthsBetween = (a, b) => { // inclusive list of YYYY-MM from a to b
  const out = []; let [y, m] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number);
  while (y < by || (y === by && m <= bm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
};

/** PF wage ceiling for a month; prorated by calendar days when a new ceiling starts mid-month */
function pfCeilingFor(period, ceilings) {
  const list = [...ceilings].sort((a, b) => a.from.localeCompare(b.from));
  const dim = daysInMonth(period);
  let total = 0;
  for (let d = 1; d <= dim; d += 1) {
    const day = `${period}-${String(d).padStart(2, '0')}`;
    let c = list[0].amount;
    list.forEach((x) => { if (x.from <= day) c = x.amount; });
    total += c;
  }
  return total / dim; // e.g. Sep 2026: (16×15000 + 14×25000) / 30 = 19,666.67
}

/* ---------------------------------------------------------------- structure */
/**
 * Monthly structure from annual CTC (Keka / Zoho style):
 *   Basic = basic_pct% of monthly CTC, HRA = hra_pct% of Basic, Conveyance fixed,
 *   employer PF (and ESI when gross ≤ ceiling) come out of CTC, Special allowance balances.
 * opts: { pfEnabled, pfRestricted, period } — period picks the PF ceiling (default: today)
 */
function structureFromCtc(annualCtc, settings, opts = {}) {
  const s = parseSettings(settings);
  const ctcM = num(annualCtc) / 12;
  const period = opts.period || new Date().toISOString().slice(0, 7);
  const ceiling = pfCeilingFor(period, s.pf_ceilings);
  const pfOn = s.pf_enabled && opts.pfEnabled !== false && opts.pfEnabled !== 0;
  const restricted = opts.pfRestricted !== false && opts.pfRestricted !== 0;
  const basic = r0(ctcM * s.basic_pct / 100);
  const hra = r0(basic * s.hra_pct / 100);
  const conveyance = r0(Math.min(s.conveyance, Math.max(0, ctcM - basic - hra)));
  const pfWage = pfOn ? (restricted ? Math.min(basic, ceiling) : basic) : 0;
  const erPf = s.pf_in_ctc && pfOn ? r0(pfWage * s.pf_er_rate / 100) : 0;
  let gross = ctcM - erPf;
  let erEsi = 0;
  if (s.esi_enabled && gross / (1 + s.esi_er_rate / 100) <= s.esi_ceiling) {
    gross /= (1 + s.esi_er_rate / 100);
    erEsi = up(gross * s.esi_er_rate / 100);
    gross = ctcM - erPf - erEsi;
  }
  const special = r0(gross - basic - hra - conveyance);
  const warnings = [];
  if (special < 0) warnings.push('CTC is too low for this Basic / HRA split: special allowance would be negative.');
  return {
    annualCtc: r0(num(annualCtc)), monthlyCtc: r0(ctcM),
    basic, hra, conveyance, special: Math.max(0, special), other_allowance: 0,
    gross: basic + hra + conveyance + Math.max(0, special),
    employerPf: erPf, employerEsi: erEsi, pfWage: r0(pfWage), pfCeiling: r0(ceiling), warnings,
  };
}

/* ---------------------------------------------------------------- PT */
/** slabs: [{ min_income, max_income|null, amount }] for one period basis */
function ptForIncome(income, slabs) {
  const s = (slabs || []).find((x) => income >= Number(x.min_income) && (x.max_income === null || x.max_income === undefined || x.max_income === '' || income <= Number(x.max_income)));
  return s ? Number(s.amount) : 0;
}

/**
 * Professional tax for this month.
 * history: [{ period, gross, pt }] items for the same employee in earlier months of the same half-year
 */
function professionalTax({ period, gross, settings, slabs, history = [] }) {
  const s = parseSettings(settings);
  if (!s.pt_enabled || !slabs || !slabs.length) return { pt: 0, note: null };
  const basis = slabs[0].basis || 'HALF_YEARLY';
  if (basis === 'MONTHLY') return { pt: ptForIncome(gross, slabs), note: null };
  const hy = halfYear(period);
  const months = monthsBetween(hy.start, hy.end);
  const idx = months.indexOf(period);
  const paidBefore = history.filter((h) => months.includes(h.period) && h.period < period);
  const grossSoFar = paidBefore.reduce((n, h) => n + num(h.gross), 0) + gross;
  const ptSoFar = paidBefore.reduce((n, h) => n + num(h.pt), 0);
  if (s.pt_mode === 'HALF_YEARLY_SPREAD') {
    // Project the half-year from this month's gross, deduct an equal share, true-up in the last month
    const projected = grossSoFar + gross * (months.length - 1 - idx);
    const due = ptForIncome(projected, slabs);
    if (idx === months.length - 1) return { pt: clamp0(ptForIncome(grossSoFar, slabs) - ptSoFar), note: 'Half-year true-up' };
    return { pt: clamp0(Math.round(due / months.length)), note: null };
  }
  // HALF_YEARLY_LUMP: deduct the whole half-year amount in a configured month (default Sep / Mar)
  const lumpMonths = (s.pt_months || [9, 3]).map(Number);
  if (!lumpMonths.includes(monthOf(period))) return { pt: 0, note: null };
  return { pt: clamp0(ptForIncome(grossSoFar, slabs) - ptSoFar), note: `Half-year income ₹${r0(grossSoFar).toLocaleString('en-IN')}` };
}

/* ---------------------------------------------------------------- one payslip */
/**
 * input:
 *   period 'YYYY-MM', structure { basic, hra, conveyance, special, other_allowance, pf_enabled, pf_restricted, esi_override }
 *   lopDays, bonus, tds, otherDeduction, joinDate, exitDate (YYYY-MM-DD, optional: prorates the month)
 *   esiCoveredThisPeriod: true if ESI was deducted earlier in the same contribution period
 *   ptHistory: earlier items in the same half-year [{ period, gross, pt }]
 */
function computePayslip(input, settingsRow, ptSlabs) {
  const s = parseSettings(settingsRow);
  const st = input.structure || {};
  const period = input.period;
  const dim = daysInMonth(period);
  const warnings = [];

  // Days payable: month days minus LOP, minus days before joining / after exit
  let notEmployed = 0;
  if (input.joinDate && String(input.joinDate).slice(0, 7) === period) notEmployed += Number(String(input.joinDate).slice(8, 10)) - 1;
  if (input.exitDate && String(input.exitDate).slice(0, 7) === period) notEmployed += dim - Number(String(input.exitDate).slice(8, 10));
  const lop = Math.min(Math.max(0, num(input.lopDays)), dim - notEmployed);
  const paidDays = Math.max(0, dim - notEmployed - lop);
  const factor = paidDays / dim;

  const full = {
    basic: num(st.basic), hra: num(st.hra), conveyance: num(st.conveyance), special: num(st.special), other_allowance: num(st.other_allowance),
  };
  const earn = {};
  Object.entries(full).forEach(([k, v]) => { earn[k] = r0(v * factor); });
  earn.bonus = r0(num(input.bonus));
  const gross = Object.values(earn).reduce((a, b) => a + b, 0);
  const fullGross = Object.values(full).reduce((a, b) => a + b, 0);

  // PF
  const ceiling = pfCeilingFor(period, s.pf_ceilings);
  const pfOn = !!(s.pf_enabled && num(st.pf_enabled, 1));
  const restricted = num(st.pf_restricted, 1) === 1;
  const pfBase = earn.basic; // PF wage = basic earned (bonus excluded)
  const pfWage = pfOn ? (restricted ? Math.min(pfBase, ceiling) : pfBase) : 0;
  const pfEe = pfOn ? r0(pfWage * s.pf_ee_rate / 100) : 0;
  const epsWage = pfOn ? Math.min(pfWage, ceiling) : 0; // EPS is always on wages up to the ceiling
  const eps = pfOn ? r0(epsWage * s.eps_rate / 100) : 0;
  const erPfTotal = pfOn ? r0(pfWage * s.pf_er_rate / 100) : 0;
  const epf = pfOn ? Math.max(0, erPfTotal - eps) : 0;
  const edli = pfOn ? r0(Math.min(pfWage, ceiling) * s.edli_rate / 100) : 0;
  const pfAdmin = pfOn ? r0(pfWage * s.pf_admin_rate / 100) : 0;

  // ESI: eligibility by full-month gross (not reduced by LOP), or carried over within the contribution period
  const esiWage = gross - earn.bonus; // bonus / annual payments are outside ESI wages
  const override = st.esi_override; // null = auto, 1 = always, 0 = never
  let esiApplies;
  if (override === 0 || override === '0') esiApplies = false;
  else if (override === 1 || override === '1') esiApplies = true;
  else esiApplies = !!s.esi_enabled && (fullGross <= s.esi_ceiling || !!input.esiCoveredThisPeriod);
  let esiEe = 0;
  let esiEr = 0;
  if (esiApplies && esiWage > 0) {
    esiEr = up(esiWage * s.esi_er_rate / 100);
    const avgDaily = paidDays ? esiWage / paidDays : 0;
    esiEe = avgDaily <= s.esi_daily_exempt ? 0 : up(esiWage * s.esi_ee_rate / 100);
    if (!esiEe) warnings.push(`Average daily wage ≤ ₹${s.esi_daily_exempt}: employee ESI share waived.`);
    if (fullGross > s.esi_ceiling) warnings.push('ESI continues to the end of the contribution period (was covered earlier).');
  }

  // PT (on gross earned this month)
  const ptRes = input.ptOverride !== undefined && input.ptOverride !== null && input.ptOverride !== ''
    ? { pt: r0(input.ptOverride), note: 'Entered manually' }
    : professionalTax({ period, gross, settings: s, slabs: ptSlabs, history: input.ptHistory || [] });

  const tds = r0(num(input.tds));
  const otherDeduction = r0(num(input.otherDeduction));
  const deductions = { pf: pfEe, esi: esiEe, pt: ptRes.pt, tds, other: otherDeduction };
  const totalDeductions = Object.values(deductions).reduce((a, b) => a + b, 0);
  const net = gross - totalDeductions;
  if (net < 0) warnings.push('Deductions exceed earnings for this month.');
  if (!fullGross) warnings.push('No salary structure: add one under Salary structures.');

  const employer = { eps, epf, edli, pf_admin: pfAdmin, esi: esiEr };
  return {
    period, daysInMonth: dim, lopDays: lop, notEmployedDays: notEmployed, paidDays,
    earnings: earn, gross,
    deductions, totalDeductions, net,
    employer, employerCost: gross + Object.values(employer).reduce((a, b) => a + b, 0),
    pfWage: r0(pfWage), esiWage: esiApplies ? r0(esiWage) : 0, pfCeiling: r0(ceiling),
    esiApplies, ptNote: ptRes.note, warnings,
  };
}

/* ---------------------------------------------------------------- words */
function amountInWords(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ` ${a[x % 10]}` : ''}`);
  const three = (x) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? ` ${two(x % 100)}` : ''}` : two(x));
  let x = Math.round(Math.abs(Number(n) || 0));
  if (!x) return 'Zero Rupees Only';
  const parts = [];
  const crore = Math.floor(x / 10000000); x %= 10000000;
  const lakh = Math.floor(x / 100000); x %= 100000;
  const thousand = Math.floor(x / 1000); x %= 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (x) parts.push(three(x));
  return `${parts.join(' ')} Rupees Only`;
}

module.exports = { DEFAULT_SETTINGS, parseSettings, daysInMonth, halfYear, monthsBetween, pfCeilingFor, structureFromCtc, ptForIncome, professionalTax, computePayslip, amountInWords };
