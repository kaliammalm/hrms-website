/* ==========================================================================
   Salary transfer (inside an approved pay run): pay employees' bank accounts
   directly through the payout provider (RazorpayX).
     1. Verify bank accounts (₹1 penny drop + name check)
     2. Prepare transfer (maker: MD / CEO)
     3. Approve with the typed total + authenticator code (a different approver)
     4. Watch each transfer: Sending → Paid (UTR) / Failed → retry in a new batch
   Backend: backend/payouts/payoutRoutes.js (the server enforces every rule here).
   ========================================================================== */
import React, { useCallback, useEffect, useState } from 'react';
import { Send, ShieldCheck, RefreshCw, BadgeCheck, TriangleAlert, CircleCheck, Clock, X, KeyRound, Banknote } from 'lucide-react';
import { Panel, StatusPill, Field } from '../ui';
import { payFetch } from './payrollApi';

const rs = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const STATE = {
  ready: { label: 'Ready', tone: 'info' },
  blocked: { label: 'Needs attention', tone: 'warning' },
  in_progress: { label: 'Sending', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  skipped: { label: 'Not paid', tone: 'neutral' },
};
const TRANSFER = { ready: 'Waiting', sending: 'Sending', unknown: 'Checking', queued: 'Queued at bank', processing: 'With bank', processed: 'Paid', failed: 'Failed', reversed: 'Returned', cancelled: 'Cancelled', rejected: 'Rejected' };
const BATCH = { PENDING_APPROVAL: ['Waiting for approval', 'warning'], APPROVED: ['Sending', 'info'], PROCESSING: ['Sending', 'info'], COMPLETED: ['All paid', 'success'], PARTIAL: ['Some failed', 'danger'], CANCELLED: ['Cancelled', 'neutral'], EXPIRED: ['Expired', 'neutral'] };

function TwoFactorSetup({ notify, onDone }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async () => { setBusy(true); try { setSetup(await payFetch('/pay/payouts/2fa/setup', { method: 'POST' })); } catch (e) { notify('error', e.message); } finally { setBusy(false); } };
  const enable = async () => { setBusy(true); try { await payFetch('/pay/payouts/2fa/enable', { method: 'POST', body: { code } }); notify('success', 'Authenticator set up. You will need a code from it to release salaries.'); onDone(); } catch (e) { notify('error', e.message); } finally { setBusy(false); } };
  return (
    <div className="st-2fa">
      <KeyRound size={18} />
      <div className="st-2fa-body">
        <strong>Protect salary payments with an authenticator app</strong>
        {!setup ? (
          <>
            <p>Releasing salaries and accepting bank-name mismatches need a 6-digit code from Google Authenticator or Microsoft Authenticator on your phone.</p>
            <button type="button" className="hr-btn hr-btn-secondary hr-btn-sm" onClick={start} disabled={busy}>Set up now</button>
          </>
        ) : (
          <>
            <p>In the app tap <b>+</b> → <b>Enter a setup key</b>, name it "RRD HRMS Payouts", and type this key (time-based):</p>
            <code className="st-key">{setup.secret.match(/.{1,4}/g).join(' ')}</code>
            <div className="st-inline">
              <input className="hr-input st-code" inputMode="numeric" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Code from the app" />
              <button type="button" className="hr-btn hr-btn-primary hr-btn-sm" onClick={enable} disabled={busy || code.length !== 6}>Confirm</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ApproveBox({ batch, notify, onDone }) {
  const [total, setTotal] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setBusy(true);
    try {
      const r = await payFetch(`/pay/payouts/batches/${batch.id}/approve`, { method: 'POST', body: { confirmTotal: total.replace(/[₹,\s]/g, ''), totp: code }, timeoutMs: 120000 });
      notify('success', r.message); onDone();
    } catch (e) { notify('error', e.message); setCode(''); } finally { setBusy(false); }
  };
  return (
    <div className="st-approve">
      <Field label={`Type the total to confirm (${rs(batch.totalPaise)})`}>
        <input className="hr-input" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="e.g. 82187" autoComplete="off" />
      </Field>
      <Field label="Authenticator code">
        <input className="hr-input st-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="6 digits" autoComplete="one-time-code" />
      </Field>
      <button type="button" className="hr-btn hr-btn-primary" onClick={approve} disabled={busy || !total || code.length !== 6}>
        <ShieldCheck size={15} /> {busy ? 'Releasing…' : `Approve & pay ${rs(batch.totalPaise)}`}
      </button>
    </div>
  );
}

function NameOverride({ row, notify, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const send = async () => {
    try { await payFetch(`/pay/payouts/beneficiaries/${row.beneficiary.id}/override`, { method: 'POST', body: { reason, totp: code } }); notify('success', `Account of ${row.name} accepted.`); onDone(); } catch (e) { notify('error', e.message); }
  };
  if (!open) return <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => setOpen(true)}>Accept name</button>;
  return (
    <div className="st-override">
      <input className="hr-input" placeholder="Why is this name OK?" value={reason} onChange={(e) => setReason(e.target.value)} />
      <input className="hr-input st-code" inputMode="numeric" maxLength={6} placeholder="Code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      <button type="button" className="hr-btn hr-btn-primary hr-btn-sm" onClick={send} disabled={reason.trim().length < 5 || code.length !== 6}>Accept</button>
      <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm hr-btn-icon" onClick={() => setOpen(false)} aria-label="Close"><X size={14} /></button>
    </div>
  );
}

export default function SalaryTransfer({ runId, notify, onRunChanged }) {
  const [data, setData] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try { setData(await payFetch(`/pay/runs/${runId}/payouts`)); } catch (e) {
      if (e.status === 403 || e.status === 404) setHidden(true); // older server or no access
      else setData({ error: e.message });
    }
  }, [runId]);
  useEffect(() => { load(); }, [load]);
  const sending = (data?.batches || []).some((b) => ['APPROVED', 'PROCESSING'].includes(b.status));
  useEffect(() => {
    if (!sending) return undefined;
    const t = setInterval(() => { load(); onRunChanged?.(); }, 15000);
    return () => clearInterval(t);
  }, [sending, load, onRunChanged]);

  if (hidden) return null;
  if (!data) return <Panel title="Salary transfer" icon={<Banknote size={16} />}><div className="py-loading">Checking bank accounts…</div></Panel>;
  if (data.error) return <Panel title="Salary transfer" icon={<Banknote size={16} />}><div className="st-problem"><TriangleAlert size={15} /> {data.error}</div></Panel>;

  const act = async (key, fn) => { setBusy(key); try { await fn(); } catch (e) { notify('error', e.message); } finally { setBusy(''); await load(); onRunChanged?.(); } };
  const verify = () => act('verify', async () => { const r = await payFetch(`/pay/runs/${runId}/payouts/verify-accounts`, { method: 'POST', timeoutMs: 180000 }); notify(r.problems?.length ? 'info' : 'success', r.message); });
  const refresh = () => act('refresh', async () => { const r = await payFetch('/pay/payouts/beneficiaries/refresh', { method: 'POST', body: { runId } }); notify('info', `${r.updated} of ${r.checked} pending checks finished.`); });
  const prepare = () => act('prepare', async () => { const r = await payFetch(`/pay/runs/${runId}/payouts/batches`, { method: 'POST' }); notify('success', r.message); });
  const cancel = (id) => act('cancel', async () => { const r = await payFetch(`/pay/payouts/batches/${id}/cancel`, { method: 'POST' }); notify('info', r.message); });
  const reconcile = (id) => act('rec', async () => { const r = await payFetch(`/pay/payouts/batches/${id}/reconcile`, { method: 'POST', timeoutMs: 120000 }); notify('info', r.message); });

  const s = data.summary;
  const pending = data.batches.find((b) => b.status === 'PENDING_APPROVAL');
  const unverified = data.employees.some((e) => e.state === 'blocked' && (!e.beneficiary || ['none', 'failed'].includes(e.beneficiary.status)) && !/Bank account number/.test(e.reasons[0] || ''));
  const verifying = data.employees.some((e) => e.beneficiary?.status === 'pending');
  const off = data.problems.length > 0;
  const myBatch = Boolean(pending && data.dualControl && Number(pending.preparedBy) === Number(data.userId));

  return (
    <Panel
      title="Salary transfer"
      subtitle={`Pay straight into employees' bank accounts via ${data.provider}`}
      icon={<Banknote size={16} />}
      actions={!data.live && !off ? <StatusPill tone="warning">Test mode</StatusPill> : null}
      className="st-panel"
    >
      {off ? (
        <div className="st-problem">
          <TriangleAlert size={15} />
          <div>Direct transfer is switched off on the server. Use the bank transfer file meanwhile.<ul>{data.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
        </div>
      ) : (
        <>
          {(data.canPrepare || data.canApprove) && !data.twoFactor && <TwoFactorSetup notify={notify} onDone={load} />}

          <div className="st-summary">
            {[['ready', 'Ready to pay'], ['blocked', 'Needs attention'], ['in_progress', 'Sending'], ['paid', 'Paid']].map(([k, label]) => (
              <div key={k} className={`st-stat is-${k}`}><span>{label}</span><strong>{s[k].count}</strong><em>{rs(s[k].paise)}</em></div>
            ))}
          </div>

          {data.canPrepare && data.run.status === 'APPROVED' && (
            <div className="py-actions">
              {unverified && <button type="button" className="hr-btn hr-btn-secondary" onClick={verify} disabled={!!busy}><BadgeCheck size={15} /> {busy === 'verify' ? 'Verifying…' : 'Verify bank accounts'}</button>}
              {verifying && <button type="button" className="hr-btn hr-btn-ghost" onClick={refresh} disabled={!!busy}><RefreshCw size={15} /> Check verification</button>}
              {!pending && <button type="button" className="hr-btn hr-btn-primary" onClick={prepare} disabled={!!busy || !s.ready.count}><Send size={15} /> {s.ready.count ? `Prepare transfer · ${s.ready.count} · ${rs(s.ready.paise)}` : 'Prepare transfer'}</button>}
            </div>
          )}
          {data.run.status === 'APPROVED' && <p className="py-hint">Each new account gets a ₹1 test credit and the name at the bank is matched with the employee. After you prepare, an approver releases it with the typed total and an authenticator code.</p>}

          {pending && (
            <div className="st-batch is-pending">
              <div className="st-batch-head">
                <Clock size={16} />
                <div><strong>Batch #{pending.id} waiting for approval</strong><span>{pending.itemCount} employees · {rs(pending.totalPaise)} · prepared by {pending.preparedByName || 'someone'}</span></div>
                {(data.canPrepare || data.canApprove) && <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => cancel(pending.id)} disabled={!!busy}>Cancel</button>}
              </div>
              {data.canApprove && data.twoFactor && !myBatch && <ApproveBox batch={pending} notify={notify} onDone={() => { load(); onRunChanged?.(); }} />}
              {myBatch && <p className="py-hint">You prepared this batch, so a different approver must release it.</p>}
              {data.canApprove && !data.twoFactor && !myBatch && <p className="py-hint">Set up the authenticator above to approve.</p>}
              {!data.canApprove && <p className="py-hint">The group MD (or a listed approver) approves it from this screen.</p>}
            </div>
          )}

          {data.batches.filter((b) => b.status !== 'PENDING_APPROVAL').slice(0, 4).map((b) => (
            <div key={b.id} className="st-batch">
              <div className="st-batch-head">
                {['COMPLETED'].includes(b.status) ? <CircleCheck size={16} /> : b.status === 'PARTIAL' ? <TriangleAlert size={16} /> : <Send size={16} />}
                <div><strong>Batch #{b.id}</strong><span>{b.itemCount} employees · {rs(b.totalPaise)}{b.approvedByName ? ` · approved by ${b.approvedByName}` : ''}</span></div>
                <StatusPill tone={(BATCH[b.status] || [])[1] || 'neutral'}>{(BATCH[b.status] || [b.status])[0]}</StatusPill>
                {['APPROVED', 'PROCESSING'].includes(b.status) && data.canPrepare && <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => reconcile(b.id)} disabled={!!busy}><RefreshCw size={14} /> Check with bank</button>}
              </div>
            </div>
          ))}
        </>
      )}

      <div className="hr-table-wrap st-table">
        <table className="hr-table">
          <thead><tr><th>Employee</th><th>Account</th><th className="is-num">Net pay</th><th>Status</th><th>Details</th></tr></thead>
          <tbody>
            {data.employees.filter((e) => e.state !== 'skipped' || e.amountPaise > 0).map((e) => {
              const last = e.transfers[e.transfers.length - 1];
              return (
                <tr key={e.itemId}>
                  <td><div className="py-emp"><span className="st-name">{e.name}</span><span className="py-emp-sub">{e.empCode}</span></div></td>
                  <td className="st-acct">{e.accountLast4 ? `••${e.accountLast4}` : '—'}<span>{e.ifsc || ''}</span></td>
                  <td className="is-num">{rs(e.amountPaise)}</td>
                  <td><StatusPill tone={STATE[e.state].tone}>{e.state === 'in_progress' ? TRANSFER[e.transferStatus] || 'Sending' : STATE[e.state].label}</StatusPill></td>
                  <td className="st-why">
                    {e.state === 'paid' && e.utr && <span>UTR {e.utr}</span>}
                    {e.reasons.map((r) => <span key={r}>{r}</span>)}
                    {e.state === 'ready' && e.beneficiary?.registeredName && <span className="st-ok"><BadgeCheck size={13} /> {e.beneficiary.registeredName}{e.beneficiary.overridden ? ' (accepted)' : ''}</span>}
                    {last && ['failed', 'reversed'].includes(last.status) && e.state !== 'paid' && <span className="st-bad">Last attempt {TRANSFER[last.status].toLowerCase()}: {last.reason || 'no reason given'}</span>}
                    {e.warnings.map((w) => <span key={w} className="st-warn">{w}</span>)}
                    {e.beneficiary?.status === 'name_mismatch' && data.canApprove && data.twoFactor && <NameOverride row={e} notify={notify} onDone={load} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
