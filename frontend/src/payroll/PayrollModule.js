/* ==========================================================================
   Payroll (MD / group access / CEO / HR): pay runs, salary structures, settings.
     Pay runs           create a month → review every employee (LOP, bonus, TDS, other) → approve →
                        bank transfer file → mark paid; payslip PDFs for one or all employees
     Salary structures  CTC-based (Keka / Zoho style) or manual, with live statutory preview
     Settings           PF / ESI / PT rules, structure defaults, company and bank details
   Backend: /api/pay/* (backend/payroll/payrollRoutes.js)
   ========================================================================== */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wallet, Plus, RefreshCw, CircleCheck, RotateCcw, Download, FileText, Landmark, Trash, TriangleAlert, ArrowLeft,
  Pencil, X, Settings as SettingsIcon, Users, CirclePause, Info,
} from 'lucide-react';
import { PageHeader, Panel, KpiStrip, Kpi, EmptyState, StatusPill, Field } from '../ui';
import { payFetch, inr, periodLabel, currentPeriod, shiftPeriod, saveBlob, downloadFromApi } from './payrollApi';
import '../styles/payroll.css';

const COMPANIES = [{ id: 1, name: 'Ram Reddy Developers' }, { id: 2, name: 'Fractio Hospitality' }, { id: 3, name: 'Stories by Varnam' }];
const STATUS_TONE = { DRAFT: 'warning', APPROVED: 'info', PAID: 'success' };
const STATUS_LABEL = { DRAFT: 'Draft', APPROVED: 'Approved', PAID: 'Paid' };

function useNotice() {
  const [notice, setNotice] = useState(null);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(null), notice.tone === 'error' ? 9000 : 5000); return () => clearTimeout(t); }, [notice]);
  return [notice, (tone, text) => setNotice({ tone, text })];
}
function Notice({ notice }) {
  if (!notice) return null;
  return <div className={`py-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.tone === 'error' ? <TriangleAlert size={16} /> : <CircleCheck size={16} />}<span>{notice.text}</span></div>;
}

async function downloadPayslips(path, name) {
  const { buildPayslipsPdf } = await import('./payslipPdf');
  const data = await payFetch(path);
  const list = data.payslips || (data.payslip ? [data.payslip] : []);
  if (!list.length) throw new Error('There are no payslips to download.');
  const doc = await buildPayslipsPdf(list);
  await saveBlob(doc.output('blob'), name || `Payslips_${list[0].period}.pdf`);
  return list.length;
}

/* ======================================================================= RUNS */
function RunsList({ companyId, onOpen, notify }) {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState(shiftPeriod(currentPeriod(), 0));
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await payFetch(`/pay/runs?companyId=${companyId}`)); } catch (e) { notify('error', e.message); setData({ runs: [] }); }
  }, [companyId, notify]);
  useEffect(() => { setData(null); load(); }, [load]);
  const create = async () => {
    setBusy(true);
    try {
      const res = await payFetch('/pay/runs', { method: 'POST', body: { companyId, period }, timeoutMs: 90000 });
      notify('success', res.message);
      onOpen(res.run.id);
    } catch (e) {
      if (e.body?.runId) onOpen(e.body.runId); else notify('error', e.message);
    } finally { setBusy(false); }
  };
  const options = [-2, -1, 0, 1].map((n) => shiftPeriod(currentPeriod(), n));
  return (
    <>
      {data?.canManage && (
        <div className="py-newrun">
          <div>
            <div className="py-newrun-title">Run payroll</div>
            <div className="py-newrun-sub">Calculates every employee from their salary structure, LOP and statutory rules. Nothing is paid until you approve.</div>
          </div>
          <div className="py-newrun-form">
            <select className="hr-select" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Payroll month">
              {options.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
            </select>
            <button type="button" className="hr-btn hr-btn-primary" onClick={create} disabled={busy}><Plus size={15} /> {busy ? 'Calculating…' : 'Create pay run'}</button>
          </div>
        </div>
      )}
      <Panel title="Pay runs" icon={<Wallet size={16} />} flush actions={<button type="button" className="hr-btn hr-btn-ghost hr-btn-sm hr-btn-icon" onClick={load} aria-label="Refresh"><RefreshCw size={14} /></button>}>
        {!data ? <div className="py-loading">Loading…</div> : !data.runs.length ? (
          <EmptyState icon={<Wallet size={20} />} title="No pay runs yet" text="Create the first pay run above. Add salary structures first so everyone is paid correctly." />
        ) : (
          <div className="hr-table-wrap">
            <table className="hr-table">
              <thead><tr><th>Month</th><th>Status</th><th className="is-num">Employees</th><th className="is-num">Gross</th><th className="is-num">Deductions</th><th className="is-num">Net pay</th><th className="is-num">Employer cost</th><th /></tr></thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} className="py-row-link" onClick={() => onOpen(r.id)}>
                    <td className="is-strong">{r.periodLabel}</td>
                    <td><StatusPill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill></td>
                    <td className="is-num">{r.employees}</td>
                    <td className="is-num">{inr(r.totalGross)}</td>
                    <td className="is-num">{inr(r.totalDeductions)}</td>
                    <td className="is-num is-strong">{inr(r.totalNet)}</td>
                    <td className="is-num is-muted">{inr(r.totalEmployerCost)}</td>
                    <td className="is-actions"><button type="button" className="hr-btn hr-btn-ghost hr-btn-sm">Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function MoneyInput({ value, onCommit, disabled, label, max }) {
  const [v, setV] = useState(String(value ?? ''));
  useEffect(() => { setV(String(value ?? '')); }, [value]);
  const commit = () => { const n = v === '' ? 0 : Number(v); if (Number.isNaN(n) || n < 0 || (max !== undefined && n > max)) { setV(String(value ?? '')); return; } if (n !== Number(value || 0)) onCommit(n); };
  return (
    <input className="py-cell-input" inputMode="decimal" value={v} disabled={disabled} aria-label={label}
      onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

function PayslipModal({ itemId, onClose, notify }) {
  const [p, setP] = useState(null);
  useEffect(() => { payFetch(`/pay/payslips/${itemId}`).then((d) => setP(d.payslip)).catch((e) => { notify('error', e.message); onClose(); }); }, [itemId, notify, onClose]);
  const download = async () => {
    try { const { buildPayslipsPdf, payslipFileName } = await import('./payslipPdf'); const doc = await buildPayslipsPdf([p]); await saveBlob(doc.output('blob'), payslipFileName(p)); } catch (e) { notify('error', e.message); }
  };
  return (
    <div className="hr-modal-scrim" role="dialog" aria-modal="true" aria-label="Payslip" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hr-modal hr-modal-lg py-slip-modal">
        <div className="py-modal-head">
          <div><h3 className="hr-modal-title">{p ? `${p.employee.name} · ${p.periodLabel}` : 'Payslip'}</h3><p className="hr-modal-sub">{p ? `${p.employee.designation || ''}${p.employee.empCode ? ` · ${p.employee.empCode}` : ''}` : 'Loading…'}</p></div>
          <button type="button" className="hr-btn hr-btn-ghost hr-btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {p && <PayslipView p={p} />}
        <div className="hr-modal-foot">
          <button type="button" className="hr-btn hr-btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="hr-btn hr-btn-primary" onClick={download} disabled={!p}><Download size={15} /> Download PDF</button>
        </div>
      </div>
    </div>
  );
}

export function PayslipView({ p }) {
  return (
    <div className="py-slip">
      <div className="py-slip-net">
        <div><div className="py-label">Net pay</div><div className="py-slip-amount">{inr(p.net, { decimals: 2 })}</div><div className="py-slip-words">{p.netInWords}</div></div>
        <div className="py-slip-days"><span>Paid days <strong>{p.days.paid}</strong></span><span>LOP <strong>{p.days.lop}</strong></span></div>
      </div>
      <div className="py-slip-cols">
        <div>
          <div className="py-slip-head"><span>Earnings</span><span>Amount</span></div>
          {p.earnings.map((e) => <div key={e.label} className="py-slip-line"><span>{e.label}</span><span>{inr(e.amount)}</span></div>)}
          <div className="py-slip-line is-total"><span>Gross earnings</span><span>{inr(p.gross)}</span></div>
        </div>
        <div>
          <div className="py-slip-head"><span>Deductions</span><span>Amount</span></div>
          {p.deductions.length ? p.deductions.map((d) => <div key={d.label} className="py-slip-line"><span>{d.label}</span><span>{inr(d.amount)}</span></div>)
            : <div className="py-slip-line is-muted"><span>No deductions</span><span>—</span></div>}
          <div className="py-slip-line is-total"><span>Total deductions</span><span>{inr(p.totalDeductions)}</span></div>
        </div>
      </div>
      <div className="py-slip-meta">
        <span>Employer PF {inr(p.employer.eps + p.employer.epf)}</span>
        {p.employer.esi ? <span>Employer ESI {inr(p.employer.esi)}</span> : null}
        <span>YTD gross {inr(p.ytd.gross)}</span>
        {p.employee.uan && <span>UAN {p.employee.uan}</span>}
      </div>
    </div>
  );
}

function RunDetail({ runId, onBack, notify }) {
  const [data, setData] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [busy, setBusy] = useState('');
  const [slip, setSlip] = useState(null);
  const [bank, setBank] = useState(null);
  const [paid, setPaid] = useState({ open: false, date: new Date().toISOString().slice(0, 10), ref: '' });
  const [filter, setFilter] = useState('');
  const load = useCallback(async () => {
    try { setData(await payFetch(`/pay/runs/${runId}`)); } catch (e) { notify('error', e.message); }
  }, [runId, notify]);
  useEffect(() => { load(); }, [load]);

  const run = data?.run;
  const draft = run?.status === 'DRAFT';
  const can = data?.canManage;
  const editable = draft && can;

  const patch = async (item, body) => {
    setSavingId(item.id);
    try {
      const res = await payFetch(`/pay/runs/${runId}/items/${item.id}`, { method: 'PATCH', body });
      setData((d) => ({ ...d, run: res.run, items: d.items.map((i) => (i.id === item.id ? res.item : i)) }));
    } catch (e) { notify('error', e.message); } finally { setSavingId(null); }
  };
  const act = async (key, fn) => { setBusy(key); try { await fn(); } catch (e) { notify('error', e.message); } finally { setBusy(''); } };
  const approve = () => act('approve', async () => { const r = await payFetch(`/pay/runs/${runId}/approve`, { method: 'POST', timeoutMs: 90000 }); notify('success', r.message); await load(); });
  const reopen = () => act('reopen', async () => { const r = await payFetch(`/pay/runs/${runId}/reopen`, { method: 'POST' }); notify('info', r.message); await load(); });
  const recalc = () => act('recalc', async () => { const r = await payFetch(`/pay/runs/${runId}/recalculate`, { method: 'POST', timeoutMs: 90000 }); notify('success', r.message); await load(); });
  const remove = () => act('delete', async () => { const r = await payFetch(`/pay/runs/${runId}`, { method: 'DELETE' }); notify('success', r.message); onBack(); });
  const markPaid = () => act('paid', async () => { const r = await payFetch(`/pay/runs/${runId}/mark-paid`, { method: 'POST', body: { paymentDate: paid.date, reference: paid.ref } }); notify('success', r.message); setPaid((x) => ({ ...x, open: false })); await load(); });
  const checkBank = () => act('bank', async () => setBank(await payFetch(`/pay/runs/${runId}/bank-file/check`)));
  const downloadBank = (format) => act('bankdl', async () => { await downloadFromApi(`/pay/runs/${runId}/bank-file?format=${format}`, `Salary_${run.period}.csv`); notify('success', 'Bank file downloaded. Upload it in your bank\'s bulk payment screen.'); });
  const allSlips = () => act('slips', async () => { const n = await downloadPayslips(`/pay/runs/${runId}/payslips`, `Payslips_${run.companyName.replace(/\s+/g, '_')}_${run.period}.pdf`); notify('success', `${n} payslips downloaded as one PDF.`); });

  // Employees being paid first, held lines (e.g. no salary yet) at the bottom
  const items = useMemo(() => (data?.items || [])
    .filter((i) => !filter || `${i.name} ${i.empCode}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((x, y) => Number(x.onHold) - Number(y.onHold) || String(x.name).localeCompare(String(y.name))), [data, filter]);
  const held = (data?.items || []).filter((i) => i.onHold).length;
  const warned = (data?.items || []).filter((i) => !i.onHold && i.warnings.length).length;

  if (!data) return <Panel><div className="py-loading">Loading pay run…</div></Panel>;
  const steps = ['DRAFT', 'APPROVED', 'PAID'];
  const at = steps.indexOf(run.status);

  return (
    <div className="py-run">
      <button type="button" className="hr-back" onClick={onBack}><ArrowLeft size={15} /> All pay runs</button>
      <div className="py-run-head">
        <div>
          <h2 className="py-run-title">{run.periodLabel} <StatusPill tone={STATUS_TONE[run.status]}>{STATUS_LABEL[run.status]}</StatusPill></h2>
          <div className="py-run-sub">{run.companyName} · PF wage ceiling {inr(data.settings.pfCeiling)} · ESI up to {inr(data.settings.esiCeiling)} · PT {data.settings.ptState}</div>
        </div>
        <ol className="py-steps" aria-label="Progress">
          {steps.map((s, i) => <li key={s} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}><span>{i + 1}</span>{STATUS_LABEL[s]}</li>)}
        </ol>
      </div>

      <KpiStrip>
        <Kpi label="Employees paid" value={run.employees} note={held ? `${held} on hold` : 'Nobody on hold'} icon={<Users size={14} />} />
        <Kpi label="Gross pay" value={inr(run.totalGross)} icon={<Wallet size={14} />} />
        <Kpi label="Deductions" value={inr(run.totalDeductions)} note="PF, ESI, PT, TDS, other" />
        <Kpi label="Net pay (bank transfer)" value={inr(run.totalNet)} tone="success" />
        <Kpi label="Employer cost" value={inr(run.totalEmployerCost)} note="Gross + employer PF / ESI" />
      </KpiStrip>

      {can && (
        <div className="py-actions">
          {draft && <>
            <button type="button" className="hr-btn hr-btn-primary" onClick={approve} disabled={!!busy}><CircleCheck size={15} /> {busy === 'approve' ? 'Approving…' : 'Approve & publish payslips'}</button>
            <button type="button" className="hr-btn hr-btn-secondary" onClick={recalc} disabled={!!busy}><RefreshCw size={15} /> Recalculate</button>
            <button type="button" className="hr-btn hr-btn-ghost py-danger" onClick={remove} disabled={!!busy}><Trash size={15} /> Delete draft</button>
          </>}
          {!draft && <>
            <button type="button" className="hr-btn hr-btn-primary" onClick={checkBank} disabled={!!busy}><Landmark size={15} /> Bank transfer file</button>
            <button type="button" className="hr-btn hr-btn-secondary" onClick={allSlips} disabled={!!busy}><FileText size={15} /> {busy === 'slips' ? 'Preparing PDF…' : 'All payslips (PDF)'}</button>
            {run.status === 'APPROVED' && <button type="button" className="hr-btn hr-btn-secondary" onClick={() => setPaid((x) => ({ ...x, open: !x.open }))} disabled={!!busy}><CircleCheck size={15} /> Mark as paid</button>}
            {run.status === 'APPROVED' && <button type="button" className="hr-btn hr-btn-ghost" onClick={reopen} disabled={!!busy}><RotateCcw size={15} /> Reopen</button>}
          </>}
        </div>
      )}
      {!can && !draft && (
        <div className="py-actions"><button type="button" className="hr-btn hr-btn-secondary" onClick={allSlips} disabled={!!busy}><FileText size={15} /> All payslips (PDF)</button></div>
      )}
      {run.status === 'PAID' && <div className="py-paid-note"><CircleCheck size={15} /> Paid on {run.paidAt}{run.paymentRef ? ` · reference ${run.paymentRef}` : ''}</div>}

      {paid.open && (
        <div className="py-inline-form">
          <Field label="Payment date"><input type="date" className="hr-input" value={paid.date} onChange={(e) => setPaid((x) => ({ ...x, date: e.target.value }))} /></Field>
          <Field label="Bank reference (optional)"><input className="hr-input" value={paid.ref} maxLength={80} onChange={(e) => setPaid((x) => ({ ...x, ref: e.target.value }))} placeholder="Batch / UTR number" /></Field>
          <button type="button" className="hr-btn hr-btn-primary" onClick={markPaid} disabled={busy === 'paid'}>Confirm paid</button>
        </div>
      )}

      {bank && (
        <Panel title="Bank transfer file" subtitle={`${bank.included} employees · ${inr(bank.total)} from account ${bank.debitAccount || 'not set (Settings)'}`} icon={<Landmark size={16} />}
          actions={<button type="button" className="hr-btn hr-btn-ghost hr-btn-icon hr-btn-sm" onClick={() => setBank(null)} aria-label="Close"><X size={15} /></button>}>
          <div className="py-bank">
            <div className="py-bank-dl">
              <button type="button" className="hr-btn hr-btn-primary" onClick={() => downloadBank('GENERIC')} disabled={!bank.included || busy === 'bankdl'}><Download size={15} /> Standard bulk NEFT (CSV)</button>
              <button type="button" className="hr-btn hr-btn-secondary" onClick={() => downloadBank('COMPACT')} disabled={!bank.included || busy === 'bankdl'}><Download size={15} /> 4-column (account, IFSC, name, amount)</button>
            </div>
            <p className="py-hint"><Info size={13} /> Same-bank accounts are marked IFT (internal transfer), others NEFT. If your bank's portal needs a different column order, send us its sample file and we will add it as a preset.</p>
            {bank.excluded.length > 0 && (
              <div className="py-excluded">
                <div className="py-excluded-title"><TriangleAlert size={14} /> Not in the file ({bank.excluded.length})</div>
                <ul>{bank.excluded.map((x) => <li key={x.itemId}><strong>{x.name}</strong> — {x.reasons.join(', ')}{x.amount ? ` (${inr(x.amount)})` : ''}</li>)}</ul>
              </div>
            )}
          </div>
        </Panel>
      )}

      <Panel
        title="Employees"
        subtitle={editable ? 'Edit LOP days, bonus, TDS or other deductions; the line recalculates as you leave the cell.' : 'Figures are locked. Reopen the run to change them.'}
        icon={<Users size={16} />}
        actions={<input className="hr-input py-search" placeholder="Search name or ID" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search employees" />}
        flush
      >
        {warned > 0 && <div className="py-warnbar"><TriangleAlert size={14} /> {warned} {warned === 1 ? 'line needs' : 'lines need'} a look: hover the ⚠ for details.</div>}
        <div className="hr-table-wrap">
          <table className="hr-table py-grid">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="is-num">Paid days</th>
                <th className="is-num">LOP</th>
                <th className="is-num">Gross</th>
                <th className="is-num">Bonus</th>
                <th className="is-num">PF</th>
                <th className="is-num">ESI</th>
                <th className="is-num">PT</th>
                <th className="is-num">TDS</th>
                <th className="is-num">Other</th>
                <th className="is-num">Net pay</th>
                <th className="is-actions">{editable ? 'Hold' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={`${i.onHold ? 'is-held' : ''}${savingId === i.id ? ' is-saving' : ''}`}>
                  <td>
                    <div className="py-emp">
                      <button type="button" className="py-emp-name" onClick={() => !draft && !i.onHold && setSlip(i.id)} disabled={draft || i.onHold} title={draft ? 'Payslips are available after approval' : 'View payslip'}>{i.name}</button>
                      <span className="py-emp-sub">{[i.empCode, i.designation].filter(Boolean).join(' · ')}</span>
                      {i.warnings.length > 0 && <span className="py-warn" title={i.warnings.join('\n')} aria-label={i.warnings.join('. ')}><TriangleAlert size={13} /></span>}
                      {i.onHold && <span className="py-held-tag"><CirclePause size={12} /> On hold</span>}
                    </div>
                  </td>
                  <td className="is-num">{i.paidDays}/{i.daysInMonth}</td>
                  <td className="is-num">{editable && !i.onHold ? <MoneyInput value={i.lopDays} max={i.daysInMonth} onCommit={(v) => patch(i, { lopDays: v })} label={`LOP days for ${i.name}`} /> : i.lopDays}</td>
                  <td className="is-num">{inr(i.gross)}</td>
                  <td className="is-num">{editable && !i.onHold ? <MoneyInput value={i.earnings.bonus} onCommit={(v) => patch(i, { bonus: v })} label={`Bonus for ${i.name}`} /> : inr(i.earnings.bonus)}</td>
                  <td className="is-num">{inr(i.deductions.pf)}</td>
                  <td className="is-num">{inr(i.deductions.esi)}</td>
                  <td className="is-num">{inr(i.deductions.pt)}</td>
                  <td className="is-num">{editable && !i.onHold ? <MoneyInput value={i.deductions.tds} onCommit={(v) => patch(i, { tds: v })} label={`TDS for ${i.name}`} /> : inr(i.deductions.tds)}</td>
                  <td className="is-num">{editable && !i.onHold ? <MoneyInput value={i.deductions.other} onCommit={(v) => patch(i, { otherDeduction: v })} label={`Other deductions for ${i.name}`} /> : inr(i.deductions.other)}</td>
                  <td className="is-num is-strong">{inr(i.net)}</td>
                  <td className="is-actions">
                    {editable && <input type="checkbox" className="py-check" checked={i.onHold} onChange={(e) => patch(i, { onHold: e.target.checked })} aria-label={`Hold pay for ${i.name}`} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {slip && <PayslipModal itemId={slip} onClose={() => setSlip(null)} notify={notify} />}
    </div>
  );
}

/* ================================================================ STRUCTURES */
const COMP = [['basic', 'Basic'], ['hra', 'House rent allowance'], ['conveyance', 'Conveyance'], ['special', 'Special allowance'], ['other_allowance', 'Other allowance']];

function StructureEditor({ emp, companyId, onClose, onSaved, notify }) {
  const s = emp.structure;
  const [mode, setMode] = useState(s?.annualCtc ? 'CTC' : (s ? 'MANUAL' : 'CTC'));
  const [ctc, setCtc] = useState(s?.annualCtc ? String(s.annualCtc) : '');
  const [manual, setManual] = useState(() => Object.fromEntries(COMP.map(([k]) => [k, s ? String(s[k] || '') : ''])));
  const [pfEnabled, setPfEnabled] = useState(s ? s.pfEnabled : true);
  const [pfRestricted, setPfRestricted] = useState(s ? s.pfRestricted : true);
  const [esi, setEsi] = useState(s?.esiOverride === null || s?.esiOverride === undefined ? '' : String(s.esiOverride));
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 8) + '01');
  const [stat, setStat] = useState({ ...emp.statutory });
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  // Live preview (debounced)
  useEffect(() => {
    const body = { companyId, pfEnabled, pfRestricted, esiOverride: esi === '' ? null : Number(esi), period: from.slice(0, 7) };
    if (mode === 'CTC') { if (!(Number(ctc) > 0)) { setPreview(null); return undefined; } body.annualCtc = Number(ctc); } else Object.entries(manual).forEach(([k, v]) => { body[k] = Number(v) || 0; });
    const t = setTimeout(() => { payFetch('/pay/structures/preview', { method: 'POST', body }).then(setPreview).catch((e) => setErr(e.message)); }, 350);
    return () => clearTimeout(t);
  }, [mode, ctc, manual, pfEnabled, pfRestricted, esi, from, companyId]);

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const body = { userId: emp.userId, effectiveFrom: from, mode, pfEnabled, pfRestricted, esiOverride: esi === '' ? null : Number(esi) };
      if (mode === 'CTC') body.annualCtc = Number(ctc); else Object.entries(manual).forEach(([k, v]) => { body[k] = Number(v) || 0; });
      await payFetch('/pay/structures', { method: 'POST', body });
      const changed = Object.keys(stat).filter((k) => (stat[k] || '') !== (emp.statutory[k] || ''));
      if (changed.length) await payFetch(`/pay/employees/${emp.userId}/statutory`, { method: 'PUT', body: Object.fromEntries(changed.map((k) => [k, stat[k]])) });
      notify('success', `Salary saved for ${emp.name}.`);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const m = preview?.month;
  return (
    <div className="hr-modal-scrim" role="dialog" aria-modal="true" aria-label={`Salary for ${emp.name}`}>
      <div className="hr-modal py-editor">
        <div className="py-modal-head">
          <div><h3 className="hr-modal-title">Salary · {emp.name}</h3><p className="hr-modal-sub">{[emp.empCode, emp.designation].filter(Boolean).join(' · ')}</p></div>
          <button type="button" className="hr-btn hr-btn-ghost hr-btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="py-editor-body">
          <section>
            <div className="py-seg" role="radiogroup" aria-label="Structure type">
              <button type="button" role="radio" aria-checked={mode === 'CTC'} className={mode === 'CTC' ? 'is-on' : ''} onClick={() => setMode('CTC')}>From annual CTC</button>
              <button type="button" role="radio" aria-checked={mode === 'MANUAL'} className={mode === 'MANUAL' ? 'is-on' : ''} onClick={() => setMode('MANUAL')}>Enter components</button>
            </div>
            {mode === 'CTC' ? (
              <Field label="Annual CTC (₹)" hint="Basic, HRA, employer PF / ESI and special allowance are worked out from the company settings.">
                <input className="hr-input" inputMode="numeric" value={ctc} onChange={(e) => setCtc(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 600000" autoFocus />
              </Field>
            ) : (
              <div className="py-grid2">
                {COMP.map(([k, label]) => (
                  <Field key={k} label={`${label} (₹ / month)`}>
                    <input className="hr-input" inputMode="numeric" value={manual[k]} onChange={(e) => setManual((x) => ({ ...x, [k]: e.target.value.replace(/[^\d.]/g, '') }))} />
                  </Field>
                ))}
              </div>
            )}
            <div className="py-grid2">
              <Field label="Effective from"><input type="date" className="hr-input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="ESI">
                <select className="hr-select" value={esi} onChange={(e) => setEsi(e.target.value)}>
                  <option value="">Automatic (gross up to the ESI limit)</option><option value="1">Always deduct</option><option value="0">Never deduct</option>
                </select>
              </Field>
            </div>
            <label className="py-toggle"><input type="checkbox" checked={pfEnabled} onChange={(e) => setPfEnabled(e.target.checked)} /> Provident fund applies</label>
            {pfEnabled && <label className="py-toggle"><input type="checkbox" checked={pfRestricted} onChange={(e) => setPfRestricted(e.target.checked)} /> Limit PF to the statutory wage ceiling (unticked: 12% of full basic)</label>}
          </section>

          <section className="py-preview" aria-live="polite">
            <div className="py-label">Monthly preview {preview?.period ? `· ${periodLabel(preview.period)}` : ''}</div>
            {!m ? <div className="py-preview-empty">{mode === 'CTC' ? 'Enter the annual CTC to see the breakdown.' : 'Enter the components.'}</div> : (
              <>
                {COMP.map(([k, label]) => (preview.structure[k] ? <div key={k} className="py-slip-line"><span>{label}</span><span>{inr(preview.structure[k])}</span></div> : null))}
                <div className="py-slip-line is-total"><span>Gross</span><span>{inr(m.gross)}</span></div>
                <div className="py-slip-line"><span>Employee PF</span><span>− {inr(m.deductions.pf)}</span></div>
                {m.deductions.esi ? <div className="py-slip-line"><span>Employee ESI</span><span>− {inr(m.deductions.esi)}</span></div> : null}
                <div className="py-slip-line is-total is-net"><span>Take-home (before PT / TDS)</span><span>{inr(m.gross - m.deductions.pf - m.deductions.esi)}</span></div>
                <div className="py-preview-er">Employer: PF {inr(m.employer.eps + m.employer.epf)}{m.employer.esi ? ` · ESI ${inr(m.employer.esi)}` : ''} · cost {inr(m.employerCost)}/month</div>
                {(preview.structure.warnings || []).map((w) => <div key={w} className="py-warn-line"><TriangleAlert size={13} /> {w}</div>)}
              </>
            )}
          </section>

          <section className="py-stat">
            <div className="py-label">Statutory & bank details</div>
            <div className="py-grid3">
              {[['pan_number', 'PAN'], ['uan', 'UAN'], ['pf_number', 'PF number'], ['esi_number', 'ESI number'], ['bank_name', 'Bank name'], ['account_holder_name', 'Account holder'], ['account_number', 'Account number'], ['ifsc_code', 'IFSC'], ['bank_branch', 'Branch']].map(([k, label]) => (
                <Field key={k} label={label}><input className="hr-input" value={stat[k] || ''} onChange={(e) => setStat((x) => ({ ...x, [k]: e.target.value }))} /></Field>
              ))}
            </div>
          </section>
          {err && <div className="hr-alert" role="alert">{err}</div>}
        </div>
        <div className="hr-modal-foot">
          <button type="button" className="hr-btn hr-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="hr-btn hr-btn-primary" onClick={save} disabled={saving || (mode === 'CTC' ? !(Number(ctc) > 0) : !(Number(manual.basic) > 0))}>{saving ? 'Saving…' : 'Save salary'}</button>
        </div>
      </div>
    </div>
  );
}

function StructuresView({ companyId, notify }) {
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const load = useCallback(async () => { try { setData(await payFetch(`/pay/structures?companyId=${companyId}`)); } catch (e) { notify('error', e.message); setData({ employees: [] }); } }, [companyId, notify]);
  useEffect(() => { setData(null); load(); }, [load]);
  const rows = (data?.employees || []).filter((e) => !q || `${e.name} ${e.empCode}`.toLowerCase().includes(q.toLowerCase()));
  const missingSalary = (data?.employees || []).filter((e) => e.missing.includes('salary')).length;
  return (
    <Panel title="Salary structures" subtitle={missingSalary ? `${missingSalary} without a salary: they are held out of pay runs until added.` : 'Everyone has a salary structure.'} icon={<Users size={16} />} flush
      actions={<input className="hr-input py-search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employees" />}>
      {!data ? <div className="py-loading">Loading…</div> : (
        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead><tr><th>Employee</th><th>Effective from</th><th className="is-num">Annual CTC</th><th className="is-num">Monthly gross</th><th>PF / ESI</th><th>Missing</th><th className="is-actions" /></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.userId}>
                  <td><div className="py-emp"><span className="py-emp-name is-text">{e.name}</span><span className="py-emp-sub">{[e.empCode, e.designation].filter(Boolean).join(' · ')}</span></div></td>
                  <td className="num">{e.structure?.effectiveFrom || '—'}</td>
                  <td className="is-num">{e.structure?.annualCtc ? inr(e.structure.annualCtc) : '—'}</td>
                  <td className="is-num is-strong">{e.structure ? inr(e.structure.gross) : '—'}</td>
                  <td className="is-muted">{e.structure ? `${e.structure.pfEnabled ? (e.structure.pfRestricted ? 'PF (ceiling)' : 'PF (full basic)') : 'No PF'} · ${e.structure.esiOverride === null ? 'ESI auto' : e.structure.esiOverride ? 'ESI always' : 'No ESI'}` : '—'}</td>
                  <td>{e.missing.length ? <div className="py-tags">{e.missing.map((m) => <span key={m} className={`py-tag${m === 'salary' ? ' is-bad' : ''}`}>{m}</span>)}</div> : <span className="py-ok">Complete</span>}</td>
                  <td className="is-actions">{data.canEdit && <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => setEdit(e)}><Pencil size={13} /> {e.structure ? 'Revise' : 'Add salary'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <StructureEditor emp={edit} companyId={companyId} notify={notify} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </Panel>
  );
}

/* ================================================================== SETTINGS */
function SettingsView({ companyId, notify }) {
  const [s, setS] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [slabs, setSlabs] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setS(null);
    payFetch(`/pay/settings?companyId=${companyId}`).then((d) => { setS(d.settings); setCanEdit(d.canEdit); return payFetch(`/pay/pt-slabs?state=${d.settings.pt_state || 'TN'}`); })
      .then((d) => d && setSlabs(d.slabs)).catch((e) => notify('error', e.message));
  }, [companyId, notify]);
  if (!s) return <Panel><div className="py-loading">Loading settings…</div></Panel>;
  const set = (k) => (e) => setS((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value }));
  const save = async () => {
    setSaving(true);
    try {
      const keys = ['legal_name', 'address', 'pan', 'tan', 'pf_code', 'esi_code', 'basic_pct', 'hra_pct', 'conveyance', 'pf_enabled', 'pf_ee_rate', 'pf_er_rate', 'eps_rate', 'edli_rate', 'pf_admin_rate', 'pf_in_ctc', 'pf_ceilings',
        'esi_enabled', 'esi_ee_rate', 'esi_er_rate', 'esi_ceiling', 'esi_daily_exempt', 'pt_enabled', 'pt_state', 'pt_mode', 'pt_months', 'debit_account', 'debit_ifsc', 'debit_bank', 'bank_format', 'payslip_note'];
      const body = { companyId, ...Object.fromEntries(keys.map((k) => [k, s[k]])) };
      const res = await payFetch('/pay/settings', { method: 'PUT', body });
      setS(res.settings);
      notify('success', res.message);
    } catch (e) { notify('error', e.message); } finally { setSaving(false); }
  };
  const inp = (k, label, props = {}) => <Field label={label}><input className="hr-input" value={s[k] ?? ''} onChange={set(k)} disabled={!canEdit} {...props} /></Field>;
  const chk = (k, label) => <label className="py-toggle"><input type="checkbox" checked={!!Number(s[k])} onChange={set(k)} disabled={!canEdit} /> {label}</label>;
  return (
    <div className="py-settings">
      <Panel title="Company on payslips" icon={<SettingsIcon size={16} />}>
        <div className="py-grid3">{inp('legal_name', 'Legal name')}{inp('pan', 'Company PAN')}{inp('tan', 'TAN')}{inp('pf_code', 'PF establishment code')}{inp('esi_code', 'ESI employer code')}</div>
        <Field label="Registered address"><textarea className="hr-textarea" rows={2} value={s.address || ''} onChange={set('address')} disabled={!canEdit} /></Field>
        {inp('payslip_note', 'Payslip footer note', { placeholder: 'This is a computer-generated payslip and does not require a signature.' })}
      </Panel>
      <Panel title="Salary structure defaults" subtitle="Used when a salary is entered as annual CTC.">
        <div className="py-grid3">{inp('basic_pct', 'Basic (% of monthly CTC)', { inputMode: 'decimal' })}{inp('hra_pct', 'HRA (% of basic)', { inputMode: 'decimal' })}{inp('conveyance', 'Conveyance (₹ / month)', { inputMode: 'numeric' })}</div>
      </Panel>
      <Panel title="Provident fund" subtitle={`This month's PF wage ceiling: ${inr(s.pfCeilingThisMonth)}`}>
        {chk('pf_enabled', 'PF applies in this company')}{chk('pf_in_ctc', 'Employer PF is part of CTC')}
        <div className="py-grid3">{inp('pf_ee_rate', 'Employee PF %')}{inp('pf_er_rate', 'Employer PF % (EPS + EPF)')}{inp('eps_rate', 'EPS (pension) %')}{inp('edli_rate', 'EDLI %')}{inp('pf_admin_rate', 'Admin charges %')}</div>
        <div className="py-label">Wage ceiling history</div>
        <table className="hr-table py-mini"><thead><tr><th>From</th><th className="is-num">Ceiling</th></tr></thead>
          <tbody>{(s.pf_ceilings || []).map((c) => <tr key={c.from}><td>{c.from}</td><td className="is-num">{inr(c.amount)}</td></tr>)}</tbody></table>
        <p className="py-hint"><Info size={13} /> ₹25,000 from 17 Sep 2026; September 2026 is prorated by days.</p>
      </Panel>
      <Panel title="ESI">
        {chk('esi_enabled', 'ESI applies in this company')}
        <div className="py-grid3">{inp('esi_ee_rate', 'Employee ESI %')}{inp('esi_er_rate', 'Employer ESI %')}{inp('esi_ceiling', 'Gross wage limit (₹ / month)')}{inp('esi_daily_exempt', 'Employee share waived up to (₹ / day)')}</div>
      </Panel>
      <Panel title="Professional tax">
        {chk('pt_enabled', 'Deduct professional tax')}
        <div className="py-grid3">
          {inp('pt_state', 'State code')}
          <Field label="How it is deducted">
            <select className="hr-select" value={s.pt_mode} onChange={set('pt_mode')} disabled={!canEdit}>
              <option value="HALF_YEARLY_LUMP">Half-yearly, in the months below</option>
              <option value="HALF_YEARLY_SPREAD">Spread monthly (1/6), trued up at half-year end</option>
            </select>
          </Field>
          <Field label="Deduction months (lump)"><input className="hr-input" value={(s.pt_months || []).join(', ')} disabled={!canEdit}
            onChange={(e) => setS((x) => ({ ...x, pt_months: e.target.value.split(/[,\s]+/).map(Number).filter((n) => n >= 1 && n <= 12) }))} /></Field>
        </div>
        <table className="hr-table py-mini"><thead><tr><th>Half-yearly income</th><th className="is-num">Tax</th></tr></thead>
          <tbody>{slabs.map((x) => <tr key={x.id}><td>{inr(x.min_income)} {x.max_income ? `– ${inr(x.max_income)}` : 'and above'}</td><td className="is-num">{inr(x.amount)}</td></tr>)}</tbody></table>
      </Panel>
      <Panel title="Salary payments" subtitle="Used for the bank transfer file.">
        <div className="py-grid3">{inp('debit_bank', 'Bank')}{inp('debit_account', 'Debit account number', { inputMode: 'numeric' })}{inp('debit_ifsc', 'IFSC')}
          <Field label="Default file format"><select className="hr-select" value={s.bank_format} onChange={set('bank_format')} disabled={!canEdit}><option value="GENERIC">Standard bulk NEFT</option><option value="COMPACT">4-column</option></select></Field>
        </div>
      </Panel>
      {canEdit && <div className="py-save"><button type="button" className="hr-btn hr-btn-primary hr-btn-lg" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></div>}
    </div>
  );
}

/* ==================================================================== MODULE */
export default function PayrollModule({ companyId: headerCompanyId, selectedCompany, userRole }) {
  const groupView = !headerCompanyId || headerCompanyId === 'all';
  const [companyId, setCompanyId] = useState(groupView ? 1 : Number(headerCompanyId));
  useEffect(() => { if (!groupView) setCompanyId(Number(headerCompanyId)); }, [headerCompanyId, groupView]);
  const [tab, setTab] = useState('runs');
  const [runId, setRunId] = useState(null);
  const [notice, notify] = useNotice();
  const company = COMPANIES.find((c) => c.id === companyId);
  return (
    <div className="py-page">
      <PageHeader
        title="Payroll"
        subtitle={`${company ? company.name : selectedCompany} · salary, statutory deductions, bank transfer and payslips`}
        actions={groupView && userRole === 'MD' ? (
          <select className="hr-select py-company" value={companyId} onChange={(e) => { setCompanyId(Number(e.target.value)); setRunId(null); }} aria-label="Company">
            {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : null}
      />
      <Notice notice={notice} />
      {!runId && (
        <div className="py-tabs" role="tablist">
          {[['runs', 'Pay runs'], ['structures', 'Salary structures'], ['settings', 'Settings']].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      )}
      {runId ? <RunDetail runId={runId} onBack={() => setRunId(null)} notify={notify} />
        : tab === 'runs' ? <RunsList companyId={companyId} onOpen={setRunId} notify={notify} />
          : tab === 'structures' ? <StructuresView companyId={companyId} notify={notify} />
            : <SettingsView companyId={companyId} notify={notify} />}
    </div>
  );
}

export { downloadPayslips };
