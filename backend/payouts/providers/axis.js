/* ==========================================================================
   Axis Bank Corporate API adapter: PLACEHOLDER until Axis onboards you.

   Axis Bank's corporate payment APIs (Axis API portal, "API Banking") are not
   self-serve: the bank shares the fund-transfer, status-enquiry and balance
   specs, sandbox credentials and its public key after corporate onboarding.
   What you will receive / must set up (from Axis's published integration samples):
     - client id / secret and a corporate (customer) id
     - request + response encryption: JWE (RSA-OAEP-256 + A256GCM) inside a JWS (RS256);
       your private key in PKCS#8 format, Axis's public key to encrypt
     - usually mutual TLS and a whitelisted static server IP
   When you have the spec, implement the same five methods the RazorpayX adapter has
   (ensureBeneficiary, validateAccount/getValidation, createPayout, getPayout,
   verifyWebhook/parseWebhook) and map Axis statuses onto:
     processing | processed | failed | reversed
   Nothing else in the payout module changes: batches, approvals, 2FA, limits,
   duplicate protection and the audit log are provider-independent.

   Until then: run salaries from Axis with the existing bank upload file
   (Payroll → run → Bank file), or use RazorpayX.
   ========================================================================== */
const { ProviderError } = require('./razorpayx');

module.exports = function axis(env) {
  const notReady = async () => {
    throw new ProviderError('Axis Bank direct API is not connected yet. Use the bank upload file or RazorpayX until Axis shares its API specification.');
  };
  return {
    name: 'axis',
    label: 'Axis Bank (corporate API)',
    configured: false,
    live: true,
    webhookConfigured: false,
    ensureBeneficiary: notReady,
    validateAccount: notReady,
    getValidation: notReady,
    createPayout: notReady,
    getPayout: notReady,
    getBalance: async () => null,
    verifyWebhook: () => false,
    parseWebhook: () => ({ kind: 'other' }),
    env: { corporateId: env.AXIS_CORP_ID || null },
  };
};
