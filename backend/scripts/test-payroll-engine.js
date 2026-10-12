#!/usr/bin/env node
/* Checks the payroll engine against hand-worked figures. Run: node scripts/test-payroll-engine.js */
const E = require('../payroll/payrollEngine');
const TN = [
  { min_income: 0, max_income: 21000, amount: 0, basis: 'HALF_YEARLY' },
  { min_income: 21001, max_income: 30000, amount: 180, basis: 'HALF_YEARLY' },
  { min_income: 30001, max_income: 45000, amount: 425, basis: 'HALF_YEARLY' },
  { min_income: 45001, max_income: 60000, amount: 930, basis: 'HALF_YEARLY' },
  { min_income: 60001, max_income: 75000, amount: 1025, basis: 'HALF_YEARLY' },
  { min_income: 75001, max_income: null, amount: 1250, basis: 'HALF_YEARLY' },
];
let fail = 0;
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail += 1; console.log(`${ok ? '✔' : '✖'} ${label}: ${JSON.stringify(got)}${ok ? '' : `  (expected ${JSON.stringify(want)})`}`); };

// PF ceilings
eq('ceiling Aug 2026', Math.round(E.pfCeilingFor('2026-08', E.DEFAULT_SETTINGS.pf_ceilings)), 15000);
eq('ceiling Sep 2026 prorated (16×15k + 14×25k)/30', Math.round(E.pfCeilingFor('2026-09', E.DEFAULT_SETTINGS.pf_ceilings)), 19667);
eq('ceiling Oct 2026', Math.round(E.pfCeilingFor('2026-10', E.DEFAULT_SETTINGS.pf_ceilings)), 25000);

// Half years
eq('half-year of 2026-10', E.halfYear('2026-10'), { start: '2026-10', end: '2027-03', key: '2026-H2' });
eq('half-year of 2027-02', E.halfYear('2027-02').key, '2026-H2');

// CTC 6,00,000: monthly 50,000; basic 25,000; HRA 12,500; ER PF 12% of 25,000 = 3,000; special = 50,000 − 3,000 − 37,500 = 9,500
const s6 = E.structureFromCtc(600000, {}, { period: '2026-10' });
eq('6L CTC structure', [s6.basic, s6.hra, s6.special, s6.employerPf, s6.employerEsi, s6.gross], [25000, 12500, 9500, 3000, 0, 47000]);
// CTC 2,40,000: monthly 20,000; basic 10,000; HRA 5,000; ER PF 1,200; gross = (20,000 − 1,200)/1.0325 = 18,208.23 → ER ESI ⌈591.77⌉ = 592; special = 20,000 − 1,200 − 592 − 15,000 = 3,208
const s24 = E.structureFromCtc(240000, {}, { period: '2026-10' });
eq('2.4L CTC structure (ESI)', [s24.basic, s24.hra, s24.special, s24.employerPf, s24.employerEsi, s24.gross], [10000, 5000, 3208, 1200, 592, 18208]);

// Payslip: 6L CTC, Oct 2026, no LOP, restricted PF: PF wage = min(25,000, 25,000) = 25,000 → EE 3,000; EPS 8.33% = 2,083; EPF 917; EDLI 125
const p1 = E.computePayslip({ period: '2026-10', structure: { ...s6, pf_enabled: 1, pf_restricted: 1 } }, {}, TN);
eq('Oct gross / PF / EPS / EPF / EDLI', [p1.gross, p1.deductions.pf, p1.employer.eps, p1.employer.epf, p1.employer.edli], [47000, 3000, 2083, 917, 125]);
eq('Oct PT (lump months Sep/Mar → none in Oct)', p1.deductions.pt, 0);
eq('Oct net', p1.net, 44000);

// Higher basic, restricted: basic 40,000 → PF wage capped 25,000
const p2 = E.computePayslip({ period: '2026-10', structure: { basic: 40000, hra: 20000, special: 10000, pf_enabled: 1, pf_restricted: 1 } }, {}, TN);
eq('basic 40k restricted PF', [p2.pfWage, p2.deductions.pf, p2.employer.eps], [25000, 3000, 2083]);
const p2b = E.computePayslip({ period: '2026-10', structure: { basic: 40000, hra: 20000, special: 10000, pf_enabled: 1, pf_restricted: 0 } }, {}, TN);
eq('basic 40k actual-wage PF (EPS still capped)', [p2b.pfWage, p2b.deductions.pf, p2b.employer.eps, p2b.employer.epf], [40000, 4800, 2083, 2717]);

// September 2026 transition: basic 30,000 → ceiling 19,666.67 → PF ⌊0.12 × 19,666.67⌉ = 2,360
const p3 = E.computePayslip({ period: '2026-09', structure: { basic: 30000, hra: 15000, special: 5000 } }, {}, TN);
eq('Sep 2026 prorated ceiling PF', [p3.pfWage, p3.deductions.pf], [19667, 2360]);

// ESI: gross 18,208, Oct (31 days) → EE ⌈136.56⌉ = 137, ER ⌈591.76⌉ = 592
const p4 = E.computePayslip({ period: '2026-10', structure: s24 }, {}, TN);
eq('ESI EE / ER', [p4.esiApplies, p4.deductions.esi, p4.employer.esi], [true, 137, 592]);
// LOP 6 days in Oct: factor 25/31
const p5 = E.computePayslip({ period: '2026-10', structure: s24, lopDays: 6 }, {}, TN);
eq('LOP 6 days: paid days and basic', [p5.paidDays, p5.earnings.basic], [25, 8065]);
// Daily wage exemption: gross 5,000 → 161/day ≤ 176 → EE 0, ER ⌈162.5⌉ = 163
const p6 = E.computePayslip({ period: '2026-10', structure: { basic: 3000, hra: 1500, special: 500, pf_enabled: 0 } }, {}, TN);
eq('ESI daily-wage exemption', [p6.deductions.esi, p6.employer.esi], [0, 163]);
// Gross 25,000 → no ESI unless covered earlier in the period
const p7 = E.computePayslip({ period: '2026-11', structure: { basic: 12500, hra: 6250, special: 6250 } }, {}, TN);
eq('ESI not applicable above ₹21,000', p7.esiApplies, false);
const p8 = E.computePayslip({ period: '2026-11', structure: { basic: 12500, hra: 6250, special: 6250 }, esiCoveredThisPeriod: true }, {}, TN);
eq('ESI continues inside contribution period', [p8.esiApplies, p8.deductions.esi], [true, 188]);

// PT, lump in March: Oct–Feb gross 47,000 × 5 + Mar 47,000 = 2,82,000 → ₹1,250
const hist = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02'].map((period) => ({ period, gross: 47000, pt: 0 }));
const p9 = E.computePayslip({ period: '2027-03', structure: { ...s6 }, ptHistory: hist }, {}, TN);
eq('PT lump in March (half-year 2.82L)', p9.deductions.pt, 1250);
// PT spread: 6,000 per month → half-year 36,000 → ₹425 → 71/month, true-up in March
const spread = { pt_mode: 'HALF_YEARLY_SPREAD' };
const pOct = E.computePayslip({ period: '2026-10', structure: { basic: 3000, hra: 1500, special: 1500, pf_enabled: 0 } }, spread, TN);
const h5 = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02'].map((period) => ({ period, gross: 6000, pt: 71 }));
const pMar = E.computePayslip({ period: '2027-03', structure: { basic: 3000, hra: 1500, special: 1500, pf_enabled: 0 }, ptHistory: h5 }, spread, TN);
eq('PT spread monthly / March true-up', [pOct.deductions.pt, pMar.deductions.pt, 5 * 71 + pMar.deductions.pt], [71, 70, 425]);

// Joining mid-month: joined 11 Oct → 10 days not employed
const p10 = E.computePayslip({ period: '2026-10', structure: { ...s6 }, joinDate: '2026-10-11' }, {}, TN);
eq('joined 11 Oct: paid days', p10.paidDays, 21);

eq('words', E.amountInWords(1234567), 'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Only');
console.log(fail ? `\n${fail} FAILED` : '\nAll payroll engine checks passed');
process.exit(fail ? 1 : 0);
