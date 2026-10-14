/* ==========================================================================
   RazorpayX Payouts adapter (https://razorpay.com/docs/api/x/)

   Contact → Fund account (bank_account) → Payout. Money leaves the RazorpayX
   business account (current account or RazorpayX Lite) named by
   RAZORPAYX_ACCOUNT_NUMBER, not the employer's other bank accounts.

   Rules this adapter follows (RazorpayX docs):
     - X-Payout-Idempotency on every payout (mandatory since 15 Mar 2025), 4–36 chars.
       A retry must reuse the same key AND the same body; Razorpay then returns the
       existing payout instead of paying twice. So a timeout is retried with the same key.
     - amount in paise, purpose 'salary', narration ≤ 30 chars [A-Za-z0-9 ], reference_id ≤ 40.
     - Live mode only works from allow-listed server IPs (Dashboard → Settings → Developer controls).
     - Status changes arrive by webhook (X-Razorpay-Signature = HMAC-SHA256 of the raw body).
   ========================================================================== */
const crypto = require('crypto');

class ProviderError extends Error {
  /** retryable = outcome unknown (network, timeout, 5xx): retry with the SAME idempotency key */
  constructor(message, { retryable = false, code = null, httpStatus = null, raw = null } = {}) {
    super(message);
    this.retryable = retryable;
    this.code = code;
    this.httpStatus = httpStatus;
    this.raw = raw;
  }
}

module.exports = function razorpayx(env) {
  const keyId = env.RAZORPAYX_KEY_ID || '';
  const keySecret = env.RAZORPAYX_KEY_SECRET || '';
  const accountNumber = env.RAZORPAYX_ACCOUNT_NUMBER || '';
  const webhookSecret = env.RAZORPAYX_WEBHOOK_SECRET || '';
  const base = env.RAZORPAYX_BASE_URL || 'https://api.razorpay.com/v1';
  const configured = Boolean(keyId && keySecret && accountNumber);
  const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  async function call(method, path, body, headers = {}) {
    if (!configured) throw new ProviderError('RazorpayX is not configured (RAZORPAYX_KEY_ID, RAZORPAYX_KEY_SECRET, RAZORPAYX_ACCOUNT_NUMBER).');
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: { Authorization: auth, 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new ProviderError(`RazorpayX could not be reached (${e.name === 'TimeoutError' ? 'timeout' : 'network'}).`, { retryable: true });
    }
    const data = await res.json().catch(() => ({}));
    if (res.status >= 500 || res.status === 429) {
      throw new ProviderError(data?.error?.description || `RazorpayX error ${res.status}`, { retryable: true, httpStatus: res.status, raw: data });
    }
    if (!res.ok) {
      const msg = res.status === 401 ? 'RazorpayX rejected the API keys.'
        : res.status === 403 || /ip/i.test(data?.error?.description || '') ? `RazorpayX refused the request: ${data?.error?.description || 'forbidden'} (is this server's IP allow-listed?)`
          : data?.error?.description || `RazorpayX error ${res.status}`;
      throw new ProviderError(msg, { code: data?.error?.code || null, httpStatus: res.status, raw: data });
    }
    return data;
  }

  const mapPayout = (p) => ({
    id: p.id,
    status: p.status, // queued | pending | rejected | processing | processed | cancelled | reversed | failed | scheduled
    utr: p.utr || null,
    referenceId: p.reference_id || null,
    amount: p.amount,
    mode: p.mode,
    fees: p.fees ?? null,
    tax: p.tax ?? null,
    reason: p.status_details?.reason || null,
    description: p.status_details?.description || p.failure_reason || null,
    source: p.status_details?.source || null,
  });

  return {
    name: 'razorpayx',
    label: 'RazorpayX',
    configured,
    live: keyId.startsWith('rzp_live_'),
    webhookConfigured: Boolean(webhookSecret),

    /** Creates (or reuses) a contact + bank fund account for the employee. */
    async ensureBeneficiary({ userId, empCode, name, email, phone, holder, account, ifsc, existingContactId }) {
      const contactId = existingContactId || (await call('POST', '/contacts', {
        name: String(name).slice(0, 50),
        email: email || undefined,
        contact: phone ? String(phone).replace(/\D/g, '').slice(-10) : undefined,
        type: 'employee',
        reference_id: `EMP-${userId}`.slice(0, 40),
        notes: { emp_code: String(empCode || ''), hrms_user_id: String(userId) },
      })).id;
      const fa = await call('POST', '/fund_accounts', {
        contact_id: contactId,
        account_type: 'bank_account',
        bank_account: { name: String(holder || name).slice(0, 120), ifsc, account_number: String(account) },
      });
      return { contactId, fundAccountId: fa.id };
    },

    /** Penny-drop validation (₹1 by default). Result may be pending: check again later. */
    async validateAccount({ fundAccountId }) {
      const v = await call('POST', '/fund_accounts/validations', {
        account_number: accountNumber,
        fund_account: { id: fundAccountId },
        amount: 100,
        currency: 'INR',
      });
      return { id: v.id, status: v.status, accountStatus: v.results?.account_status || null, registeredName: v.results?.registered_name || null };
    },
    async getValidation(id) {
      const v = await call('GET', `/fund_accounts/validations/${encodeURIComponent(id)}`);
      return { id: v.id, status: v.status, accountStatus: v.results?.account_status || null, registeredName: v.results?.registered_name || null };
    },

    async createPayout({ fundAccountId, amountPaise, mode, referenceId, narration, idempotencyKey, notes }) {
      const p = await call('POST', '/payouts', {
        account_number: accountNumber,
        fund_account_id: fundAccountId,
        amount: amountPaise,
        currency: 'INR',
        mode,
        purpose: 'salary',
        queue_if_low_balance: true,
        reference_id: referenceId,
        narration,
        notes,
      }, { 'X-Payout-Idempotency': idempotencyKey });
      return mapPayout(p);
    },
    async getPayout(id) { return mapPayout(await call('GET', `/payouts/${encodeURIComponent(id)}`)); },

    async getBalance() { return null; }, // shown in the RazorpayX Dashboard; low-balance payouts are queued, not failed

    verifyWebhook(rawBody, signature) {
      if (!webhookSecret || !rawBody || typeof signature !== 'string') return false;
      const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      if (signature.length !== expected.length || !/^[0-9a-f]+$/i.test(signature)) return false;
      return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature.toLowerCase(), 'hex'));
    },

    /** → { kind: 'payout', payout } | { kind: 'validation', validation } | { kind: 'other' } */
    parseWebhook(body) {
      const ev = String(body?.event || '');
      if (ev.startsWith('payout.') && body?.payload?.payout?.entity) return { kind: 'payout', event: ev, payout: mapPayout(body.payload.payout.entity) };
      if (ev.startsWith('fund_account.validation')) {
        const v = body?.payload?.['fund_account.validation']?.entity || body?.payload?.fund_account_validation?.entity || body?.payload?.validation?.entity;
        if (v) return { kind: 'validation', event: ev, validation: { id: v.id, status: v.status, accountStatus: v.results?.account_status || null, registeredName: v.results?.registered_name || null } };
      }
      return { kind: 'other', event: ev };
    },
  };
};
module.exports.ProviderError = ProviderError;
