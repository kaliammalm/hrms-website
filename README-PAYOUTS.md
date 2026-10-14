# Direct salary payouts — design, setup and go-live

Folder layout matches your project root (`src/…` = React app, `backend/…` = Express server).
If you changed `index.js`, `payrollRoutes.js`, `PayrollModule.js` or `payroll.css` since the last update, apply `CHANGES.diff`
(`git apply CHANGES.diff`) instead of copying those four files.

**Scrapped:** the subscription/billing code (`razorpay-billing.zip`) is not in this package or in your project. Delete that zip if you downloaded it.

---

## 1. How it works (step by step)

```
Payroll run APPROVED (existing flow)
   │
   ▼
① Verify accounts  (maker: MD / CEO)                       POST /api/pay/runs/:id/payouts/verify-accounts
   For each employee: RazorpayX Contact → Fund account (bank) → ₹1 penny drop
   Bank returns the account holder's name → matched with the employee (score ≥ 60)
   ├─ verified ............ payable
   ├─ name mismatch ....... approver must accept it with a reason + authenticator code
   ├─ invalid / failed .... fix the bank details in the profile
   └─ CHANGED account ..... employee is notified + 24 h safety hold before it can be paid
   │
   ▼
② Prepare batch  (maker)                                    POST /api/pay/runs/:id/payouts/batches
   Freezes who gets how much: amount = approved net pay, account fingerprint, SHA-256 checksum
   Each transfer gets its own reference (SAL{run}-{item}-{batch}) and its own idempotency key (UUID)
   Approvers get a notification → status PENDING_APPROVAL (expires after 72 h)
   │
   ▼
③ Approve  (checker: group MD or PAYOUT_APPROVER_EMAILS, NOT the maker)   POST /api/pay/payouts/batches/:id/approve
   Must type the exact total + a 6-digit authenticator code
   Server re-checks: run still approved, net pay unchanged, bank account unchanged,
   still verified, safety hold over, per-batch and per-day limits → checksum must match
   │
   ▼
④ Send  (background worker on the server)
   One RazorpayX payout per employee:  POST /v1/payouts  + header X-Payout-Idempotency
   purpose=salary, IMPS ≤ ₹5 lakh else NEFT, queue_if_low_balance=true, ~4 requests/second
   Timeout / 5xx  → "unknown": retried with the SAME key (RazorpayX returns the existing payout, never pays twice)
   4xx            → failed (RazorpayX refused it, no money moved)
   Server restart → the sweep resumes the batch within a minute (DB lock stops two servers sending)
   │
   ▼
⑤ Results  (RazorpayX webhooks → POST /api/pay/payouts/webhook)
   processed (UTR) → employee notified "Salary credited"
   failed / reversed → shown with the bank's reason; fix and prepare a new batch for just those people
   Every payable employee paid → pay run becomes PAID automatically, payslips show Paid
   A late reversal re-opens the run to APPROVED so that person can be paid again
```

## 2. Database (scripts/add-payouts.js)

| Table | Purpose | Key columns |
|---|---|---|
| `payout_beneficiaries` | Each employee bank account registered with the provider | `user_id`, `fingerprint` (keyed hash of account+IFSC), `account_last4`, `fund_account_id`, `validation_status` (none/pending/verified/name_mismatch/invalid/failed), `registered_name`, `name_match`, `override_by/reason`, `eligible_from` (safety hold) |
| `payout_batches` | One maker→checker batch | `run_id`, `status` (PENDING_APPROVAL → APPROVED → PROCESSING → COMPLETED/PARTIAL, or CANCELLED/EXPIRED), `total_paise`, `checksum`, `prepared_by`, `approved_by`, `lock_owner/lock_until` |
| `payout_items` | One transfer per employee | `run_item_id`, `amount_paise`, `mode`, `reference_id`, `idempotency_key` (unique), `status`, `provider_payout_id` (unique), `utr`, `failure_reason`, **`active_run_item` (unique)** |
| `payout_events` | Webhook event ids already handled | `event_id` (PK) |
| `payout_2fa` | Approvers' authenticator secrets, AES-256-GCM encrypted | `secret_enc`, `last_step` (a code works once) |
| `payout_audit` | Append-only log | `action`, `user_id`, `batch_id`, `details`, `ip` |

`active_run_item` holds the payslip id while a transfer is in progress or paid, and becomes NULL when it fails or is cancelled.
Because the column is UNIQUE, **the database itself refuses a second live transfer for the same payslip**, whatever the code does.

Full account numbers are not copied into the payout tables (only the last 4 digits and a keyed fingerprint).

## 3. Endpoints

| Method + path | Who | What |
|---|---|---|
| `GET /api/pay/payouts/config` | MD/CEO/HR | Provider, test/live, limits, what is not set up |
| `GET /api/pay/runs/:id/payouts` | MD/CEO/HR | Each employee: ready / needs attention / sending / paid, with reasons; batches |
| `POST /api/pay/runs/:id/payouts/verify-accounts` | Maker | Register + penny-drop up to 100 accounts |
| `POST /api/pay/payouts/beneficiaries/refresh` `{runId}` | Maker | Re-check penny drops still pending |
| `POST /api/pay/payouts/beneficiaries/:id/override` `{reason, totp}` | Approver | Accept a name mismatch |
| `POST /api/pay/runs/:id/payouts/batches` `{itemIds?}` | Maker | Prepare a batch (all ready, or chosen employees) |
| `GET /api/pay/payouts/batches/:id` | MD/CEO/HR | Batch, transfers, audit trail |
| `GET /api/pay/payouts/pending` | Approver | Batches waiting for me |
| `POST /api/pay/payouts/batches/:id/approve` `{confirmTotal, totp}` | Approver ≠ maker | Release the money |
| `POST /api/pay/payouts/batches/:id/cancel` | Maker/approver | Before approval only |
| `POST /api/pay/payouts/batches/:id/reconcile` | Maker | Ask RazorpayX about open transfers (once a minute) |
| `GET/POST /api/pay/payouts/2fa`, `/2fa/setup`, `/2fa/enable` | Maker/approver | Authenticator setup |
| `POST /api/pay/payouts/webhook` | RazorpayX | Signed status updates |

The existing payroll routes now also protect against paying twice:
- The bank file leaves out anyone already paid or in progress by direct transfer.
- **Reopen** is refused once transfers exist.
- **Mark as paid** is refused while transfers are still open.

## 4. Safety controls (summary)

| Risk | Control |
|---|---|
| Paying someone twice | Unique `active_run_item`, stored idempotency key reused on every retry, DB batch lock, bank-file exclusion |
| Lost response or timeout | Status "unknown" → retry with the same key (RazorpayX returns the existing payout) |
| Insider changes an employee's account to their own | Penny-drop name match, employee notified, 24 h hold on changed accounts, approver re-check of the account fingerprint |
| One person moving money alone | Maker-checker (`PAYOUT_DUAL_CONTROL`), authenticator code, typed total |
| Stolen login password | Release needs the authenticator code; codes are single-use; 5 wrong codes = 15 min lock |
| Payroll edited after preparing | Checksum + per-line re-check at approval |
| Big mistakes | Limits per employee / batch / day (environment variables) |
| Forged webhook | HMAC-SHA256 on the raw body, constant-time compare; amount must match; duplicates ignored; status can only move forward |
| Emergency | `PAYOUTS_ENABLED=false` stops sending immediately (the worker checks it before each transfer) |
| Who did what | `payout_audit` (prepare, approve, blocked approvals, overrides, cancels, reversals, account changes) |

## 5. Before you turn it on (blockers)

1. **Passwords are stored and compared in plain text** (`routes.js`, login query `u.password = ?`).
   - Anyone who sees the database or a backup can log in as the MD.
   - Hash them with bcrypt before live payouts. `bcryptjs` is already installed.
2. **Set a real `JWT_SECRET` on Render.** The code falls back to a public default if it is missing.
3. **Get a static outbound IP.**
   - RazorpayX live mode only accepts payout API calls from allow-listed IPs (up to 20).
   - Render's outbound IPs are shared per region and can change.
   - Use Render's dedicated outbound IPs (Pro workspace or higher), or route RazorpayX calls through a small fixed-IP server.
   - Test mode doesn't need this.
4. **Rotate the Aiven DB password** that was exposed earlier.

## 6. RazorpayX setup

1. Open RazorpayX (Razorpay → RazorpayX).
   - Use either a **RazorpayX current account**, or **RazorpayX Lite** funded from your existing bank account (e.g. Axis).
   - Before payday, top it up with the payroll total plus fees.
2. Start in **Test mode** and generate API keys (Settings → Developer controls). Note your test **account number** (the RazorpayX account the money comes from, not an employee's).
3. Add a webhook:
   - URL: `https://<your-render-service>.onrender.com/api/pay/payouts/webhook`
   - Events: `payout.processed`, `payout.reversed`, `payout.failed`, `payout.rejected`, `payout.queued`, `payout.initiated`, `payout.updated`, and the fund-account validation events if listed. `payout.failed` is mandatory.
4. Set the Render environment variables (below), redeploy, and run the migration.
5. Each approver opens a pay run → Salary transfer → **Set up now** (authenticator app).
6. Test end to end with test keys. When happy, complete KYC, allow-list the static IP, then switch to the live keys and live account number.

### Environment variables (Render)

| Name | Example | Notes |
|---|---|---|
| `PAYOUTS_ENABLED` | `true` | Kill switch. Anything else = off |
| `PAYOUT_PROVIDER` | `razorpayx` | `mock` = simulation for demos (no money), `axis` = placeholder |
| `RAZORPAYX_KEY_ID` / `RAZORPAYX_KEY_SECRET` | `rzp_test_…` | Never in the React app or git |
| `RAZORPAYX_ACCOUNT_NUMBER` | `2323230000000000` | Your RazorpayX business account number |
| `RAZORPAYX_WEBHOOK_SECRET` | random 32+ chars | Same text as in the webhook settings |
| `PAYOUT_ENCRYPTION_KEY` | random 40+ chars | Encrypts authenticator secrets and keys account fingerprints. **Do not change it after go-live:** 2FA would need re-setup and accounts re-verification |
| `PAYOUT_APPROVER_EMAILS` | `md@company.com` | Optional. Default: users with group MD access |
| `PAYOUT_DUAL_CONTROL` | `on` | `off` lets one approver prepare and approve (still needs 2FA and the typed total) |
| `PAYOUT_MAX_PER_EMPLOYEE` / `_PER_BATCH` / `_PER_DAY` | `500000` / `5000000` / `10000000` | Rupees |
| `PAYOUT_NEW_ACCOUNT_COOLING_HOURS` | `24` | Hold for changed bank accounts |
| `PAYOUT_NAME_MATCH_MIN` | `60` | 0–100 |
| `PAYOUT_MODE` | (blank) | Blank = IMPS up to ₹5 lakh, else NEFT. Or force `NEFT` |

### Migration (once, against Aiven)

```bat
cd backend
set DB_HOST=… & set DB_PORT=… & set DB_USER=avnadmin & set DB_PASSWORD=… & set DB_NAME=defaultdb & set DB_SSL=true
node scripts\add-payouts.js
node scripts\add-payouts.js --apply
```

## 7. Axis Bank direct API

`backend/payouts/providers/axis.js` is a placeholder with the same five methods as the RazorpayX adapter.

Axis Bank's corporate payment APIs aren't self-serve:
- After corporate onboarding, the bank shares the fund-transfer and status specs, sandbox credentials and its public key.
- From Axis's published integration samples:
  - payloads are encrypted as JWE (RSA-OAEP-256 + A256GCM) inside a JWS (RS256), with PKCS#8 keys;
  - expect mutual TLS and a whitelisted static IP as well.

Once Axis gives you the spec, only that one file needs filling in. Batches, approvals, 2FA, limits, duplicate protection and audit work unchanged. Until then, use RazorpayX funded from Axis, or the existing Axis bulk-upload file.

## 8. Costs to expect

- RazorpayX charges per payout and per penny-drop validation (see your RazorpayX pricing).
- Fees are taken from the RazorpayX balance, not from the employee's amount.

## 9. Tested here

- 71 backend checks against a copy of your payroll database: access rules, 2FA, maker-checker, tampering detection, limits, timeouts with retries, failures, reversals, webhooks, expiry, and the run becoming PAID.
- Separately, the double-payment guards on the bank file, Reopen and Mark as paid.
- A browser walkthrough: maker verifies and prepares, MD approves with a code, all paid.

All of this used the simulation provider, so nothing has run against the real RazorpayX API yet. Do that in RazorpayX test mode first.
