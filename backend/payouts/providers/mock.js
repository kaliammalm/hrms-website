/* ==========================================================================
   Simulation provider (PAYOUT_PROVIDER=mock). No money moves.
   For demos and for trying the screens before RazorpayX keys exist.
     - account numbers ending 0000 → validation "invalid"
     - account numbers ending 9999 → payout fails (beneficiary account closed)
     - account numbers ending 8888 → payout processed, then reversed
     - registered name = the holder name given (so names match), unless it ends 7777
   Payouts are "processing" when created and become final on the next
   reconcile / sweep (or immediately with PAYOUT_MOCK_INSTANT=true).
   ========================================================================== */
const crypto = require('crypto');

module.exports = function mock(env) {
  const store = { contacts: 0, payouts: new Map(), byKey: new Map(), fas: new Map(), validations: new Map() };
  const instant = String(env.PAYOUT_MOCK_INSTANT || '') === 'true';
  const id = (p) => `${p}_SIM${crypto.randomBytes(6).toString('hex')}`;
  const finalStatus = (acct) => (acct.endsWith('9999') ? 'reversed' : 'processed');
  const out = (p) => ({ ...p });
  return {
    name: 'mock',
    label: 'Simulation (no money moves)',
    configured: true,
    live: false,
    webhookConfigured: false,
    async ensureBeneficiary({ name, holder, account, ifsc, existingContactId }) {
      const contactId = existingContactId || id('cont');
      const fundAccountId = id('fa');
      store.fas.set(fundAccountId, { holder: holder || name, account: String(account), ifsc });
      return { contactId, fundAccountId };
    },
    async validateAccount({ fundAccountId }) {
      const fa = store.fas.get(fundAccountId);
      const v = {
        id: id('fav'),
        status: 'completed',
        accountStatus: fa && !fa.account.endsWith('0000') ? 'active' : 'invalid',
        registeredName: fa && fa.account.endsWith('7777') ? 'SOMEONE ELSE' : fa ? String(fa.holder).toUpperCase() : null,
      };
      store.validations.set(v.id, v);
      return v;
    },
    async getValidation(vid) { return store.validations.get(vid) || { id: vid, status: 'failed' }; },
    async createPayout({ fundAccountId, amountPaise, mode, referenceId, idempotencyKey }) {
      if (store.byKey.has(idempotencyKey)) return out(store.payouts.get(store.byKey.get(idempotencyKey)));
      const fa = store.fas.get(fundAccountId);
      const p = { id: id('pout'), status: 'processing', utr: null, referenceId, amount: amountPaise, mode, reason: null, description: null, account: fa?.account || '' };
      if (instant) Object.assign(p, { status: finalStatus(p.account), utr: p.account.endsWith('9999') ? null : `SIM${Date.now()}` });
      store.payouts.set(p.id, p);
      store.byKey.set(idempotencyKey, p.id);
      return out(p);
    },
    async getPayout(pid) {
      const p = store.payouts.get(pid);
      if (!p) return { id: pid, status: 'failed', description: 'Unknown payout (the simulation restarted)' };
      if (p.status === 'processing') {
        p.status = finalStatus(p.account);
        if (p.status === 'processed') p.utr = `SIM${Date.now()}`;
        else p.description = 'Beneficiary account closed (simulated)';
      }
      return out(p);
    },
    async getBalance() { return null; },
    verifyWebhook: () => false,
    parseWebhook: () => ({ kind: 'other' }),
  };
};
