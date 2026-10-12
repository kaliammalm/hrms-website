/* ==========================================================================
   My payslips (every employee): published payslips with view and PDF download.
   ========================================================================== */
import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Download, X, TriangleAlert, Wallet } from 'lucide-react';
import { PageHeader, Panel, EmptyState, StatusPill } from '../ui';
import { payFetch, inr, saveBlob } from './payrollApi';
import { PayslipView } from './PayrollModule';
import '../styles/payroll.css';

export default function MyPayslips({ user }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(async () => {
    try { setList((await payFetch('/pay/my-payslips')).payslips); setError(''); } catch (e) { setError(e.status === 503 ? 'Payslips will appear here once payroll is set up.' : e.message); setList([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const fetchSlip = async (id) => (await payFetch(`/pay/payslips/${id}`)).payslip;
  const view = async (id) => { setBusy(id); try { setOpen(await fetchSlip(id)); } catch (e) { setError(e.message); } finally { setBusy(null); } };
  const download = async (id, p0) => {
    setBusy(id);
    try {
      const p = p0 || await fetchSlip(id);
      const { buildPayslipsPdf, payslipFileName } = await import('./payslipPdf');
      const doc = await buildPayslipsPdf([p]);
      await saveBlob(doc.output('blob'), payslipFileName(p));
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const latest = list && list[0];

  return (
    <div className="py-page">
      <PageHeader title="Payslips" subtitle={`${user?.name || ''} · monthly salary slips`} />
      {error && <div className="py-notice is-error" role="alert"><TriangleAlert size={16} /><span>{error}</span></div>}
      {latest && (
        <div className="py-latest">
          <div>
            <div className="py-label">Latest · {latest.periodLabel}</div>
            <div className="py-latest-net">{inr(latest.net)}</div>
            <div className="py-latest-sub">Gross {inr(latest.gross)} · deductions {inr(latest.deductions)}</div>
          </div>
          <div className="py-latest-actions">
            <button type="button" className="hr-btn hr-btn-secondary" onClick={() => view(latest.id)} disabled={busy === latest.id}><FileText size={15} /> View</button>
            <button type="button" className="hr-btn hr-btn-primary" onClick={() => download(latest.id)} disabled={busy === latest.id}><Download size={15} /> Download PDF</button>
          </div>
        </div>
      )}
      <Panel title="All payslips" icon={<Wallet size={16} />} flush>
        {!list ? <div className="py-loading">Loading…</div> : !list.length ? (
          <EmptyState icon={<FileText size={20} />} title="No payslips yet" text="Your payslip appears here as soon as the month's payroll is approved." />
        ) : (
          <ul className="py-mylist">
            {list.map((p) => (
              <li key={p.id}>
                <div className="py-mylist-main">
                  <strong>{p.periodLabel}</strong>
                  <span>{p.company} · <StatusPill tone={p.status === 'PAID' ? 'success' : 'info'} dot={false}>{p.status === 'PAID' ? 'Paid' : 'Approved'}</StatusPill></span>
                </div>
                <div className="py-mylist-net">{inr(p.net)}</div>
                <div className="py-mylist-actions">
                  <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => view(p.id)} disabled={busy === p.id}>View</button>
                  <button type="button" className="hr-btn hr-btn-soft hr-btn-sm" onClick={() => download(p.id)} disabled={busy === p.id} aria-label={`Download payslip for ${p.periodLabel}`}><Download size={14} /> PDF</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {open && (
        <div className="hr-modal-scrim" role="dialog" aria-modal="true" aria-label="Payslip" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div className="hr-modal hr-modal-lg py-slip-modal">
            <div className="py-modal-head">
              <div><h3 className="hr-modal-title">Payslip · {open.periodLabel}</h3><p className="hr-modal-sub">{open.company.name}</p></div>
              <button type="button" className="hr-btn hr-btn-ghost hr-btn-icon" onClick={() => setOpen(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <PayslipView p={open} />
            <div className="hr-modal-foot">
              <button type="button" className="hr-btn hr-btn-secondary" onClick={() => setOpen(null)}>Close</button>
              <button type="button" className="hr-btn hr-btn-primary" onClick={() => download(open.id, open)}><Download size={15} /> Download PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
