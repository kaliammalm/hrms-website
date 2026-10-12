# Payroll module — setup and rules

## Files
| File | What it is |
|---|---|
| `backend/payroll/payrollEngine.js` | Statutory calculations (no database): CTC → structure, PF / EPS / EDLI, ESI, professional tax, LOP, amount in words |
| `backend/payroll/payrollRoutes.js` | All `/api/pay/*` APIs: settings, structures, runs, approval, bank file, payslips |
| `backend/payroll/schema.sql` | MySQL DDL (reference). Use the script below instead: it also seeds data |
| `backend/scripts/add-payroll.js` | Migration: creates the 5 tables, adds 6 employee columns, seeds settings, TN PT slabs and structures |
| `backend/scripts/test-payroll-engine.js` | 22 checks against hand-worked figures: `node scripts/test-payroll-engine.js` |
| `backend/index.js` | Mounts the payroll routes |
| `backend/extraRoutes.js` | "Payslip ready" alerts in the bell open Payslips |
| `frontend/src/payroll/PayrollModule.js` | Payroll screen: Pay runs · Salary structures · Settings |
| `frontend/src/payroll/MyPayslips.js` | Employees' Payslips screen (view + PDF) |
| `frontend/src/payroll/payslipPdf.js` | Payslip PDF (one employee or the whole run) |
| `frontend/src/payroll/payrollApi.js`, `styles/payroll.css` | Helpers and styles |
| `frontend/src/MDDashboard.js` | "Payroll & Slips" and "Payslips" now open the new screens |

## Run order
```powershell
cd backend
node scripts/test-payroll-engine.js       # optional: should end "All payroll engine checks passed"
node scripts/add-payroll.js               # preview
node scripts/add-payroll.js --apply       # local, then again with the Aiven DB_* values (DB_NAME=hrms)
```
Push backend → Render, frontend → Vercel. Then, as MD: Payroll → Settings (company PAN / TAN / PF / ESI codes, debit account) → Salary structures → Pay runs.

## Monthly flow
1. **Create pay run** for the month → every employee is calculated. Anyone without a salary structure starts **on hold**.
2. Enter **LOP days, bonus, TDS, other deductions** per employee (half days allowed). Each line recalculates.
3. **Approve & publish payslips** → figures are frozen, employees see their payslip and get a bell alert.
4. **Bank transfer file** → shows who is left out (missing account / IFSC, on hold) → download CSV → upload in the bank's bulk payment screen.
5. **Mark as paid** with the date and bank reference. A paid run can no longer be changed.
An approved (not paid) run can be **reopened** to correct it.

## Statutory rules (editable per company in Settings)
| Item | Default | Source |
|---|---|---|
| PF | 12% employee, 12% employer (EPS 8.33% + EPF 3.67%), EDLI 0.5%, admin 0.5% | EPFO |
| PF wage ceiling | ₹15,000; **₹25,000 from 17 Sep 2026** (September 2026 prorated by days: ₹19,667) | EPFO wage ceiling revision, Sep 2026 |
| PF wage | Basic earned; limited to the ceiling unless "full basic" is chosen per employee. EPS always on wages up to the ceiling | |
| ESI | 0.75% employee, 3.25% employer, gross ≤ ₹21,000; employee share waived if average daily wage ≤ ₹176; once covered, covered to the end of the contribution period (Apr–Sep, Oct–Mar); rounded up to the next rupee | ESIC |
| Professional tax (TN) | Half-yearly slabs (Chennai): ≤21,000 nil · ≤30,000 ₹180 · ≤45,000 ₹425 · ≤60,000 ₹930 · ≤75,000 ₹1,025 · above ₹1,250. Deducted in September and March by default, or spread monthly | Greater Chennai Corporation revision, from H2 FY 2024-25 |
| CTC split | Basic 50% of monthly CTC, HRA 50% of Basic, employer PF (and ESI) inside CTC, special allowance balances | Keka / Zoho convention |

## Known limits (next steps)
- **TDS** is entered by hand each month. Automatic income-tax projection (old / new regime, investment declarations) is the next module.
- **LOP** is entered by hand. Attendance-based suggestions can be added once check-in adoption is complete.
- **First half-year after go-live:** PT counts only months run in this system. Use the PT override on the line for the September / March run if earlier months were paid elsewhere.
- **Bank file**: a standard bulk-NEFT CSV and a 4-column CSV. Banks' corporate portals differ; share your bank's sample file to add an exact preset.
- PF ECR and ESI return files are not generated yet (the figures are all stored per employee: `pf_wage`, `eps_er`, `epf_er`, `esi_wage`, …).
- Statutory figures change: review Settings when EPFO / ESIC / the corporation revise them.
