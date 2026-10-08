/* ==========================================================================
   HRMS UI kit — purely presentational components.
   None of these fetch data, read localStorage, or make role decisions.
   They only render what they are given.
   ========================================================================== */
import React from 'react';
import { ArrowLeft, Inbox, ShieldAlert } from 'lucide-react';

const cx = (...parts) => parts.filter(Boolean).join(' ');

/* Page header: title, context line, optional back link and actions */
export function PageHeader({ title, subtitle, actions, onBack, backLabel = 'Back' }) {
  return (
    <div>
      {onBack && (
        <button type="button" className="hr-back" onClick={onBack}>
          <ArrowLeft size={15} /> {backLabel}
        </button>
      )}
      <div className="hr-page-head">
        <div>
          <h1 className="hr-page-title">{title}</h1>
          {subtitle && <p className="hr-page-sub">{subtitle}</p>}
        </div>
        {actions && <div className="hr-page-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Panel({ title, subtitle, icon, actions, children, footer, flush = false, className, style }) {
  return (
    <section className={cx('hr-panel', className)} style={style}>
      {(title || actions) && (
        <header className="hr-panel-head">
          <div>
            {title && <h2 className="hr-panel-title">{icon}{title}</h2>}
            {subtitle && <p className="hr-panel-sub">{subtitle}</p>}
          </div>
          {actions && <div className="hr-page-actions">{actions}</div>}
        </header>
      )}
      {flush ? children : <div className="hr-panel-body">{children}</div>}
      {footer && <footer className="hr-panel-foot">{footer}</footer>}
    </section>
  );
}

/* KPI strip: one panel split into cells */
export function KpiStrip({ children }) {
  return <div className="hr-kpis">{children}</div>;
}

export function Kpi({ label, value, note, icon, tone }) {
  return (
    <div className="hr-kpi">
      <div className="hr-kpi-label">{icon}{label}</div>
      <div className={cx('hr-kpi-value', tone && `is-${tone}`)}>{value}</div>
      {note && <div className="hr-kpi-note">{note}</div>}
    </div>
  );
}

export function Button({ variant = 'secondary', size, block, className, children, ...rest }) {
  return (
    <button
      type="button"
      className={cx('hr-btn', `hr-btn-${variant}`, size && `hr-btn-${size}`, block && 'hr-btn-block', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* Maps any status string to a tone. Display-only. */
export function toneForStatus(status) {
  const s = String(status || '').toLowerCase();
  if (['approved', 'paid', 'present', 'completed', 'active'].includes(s)) return 'success';
  if (['rejected', 'absent', 'failed', 'cancelled'].includes(s)) return 'danger';
  if (['checked in', 'in progress'].includes(s)) return 'info';
  if (['pending', 'on leave', 'awaiting'].includes(s)) return 'warning';
  return 'neutral';
}

export function StatusPill({ status, tone, children, dot = true }) {
  const t = tone || toneForStatus(status);
  return <span className={cx('hr-pill', `hr-pill-${t}`, !dot && 'no-dot')}>{children || status}</span>;
}

export function Avatar({ name, src, size = 36 }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="hr-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {src ? <img src={src} alt="" /> : initial}
    </span>
  );
}

export function EmptyState({ icon, title, text }) {
  return (
    <div className="hr-empty">
      <div className="hr-empty-icon">{icon || <Inbox size={20} />}</div>
      {title && <div className="hr-empty-title">{title}</div>}
      {text && <div className="hr-empty-text">{text}</div>}
    </div>
  );
}

/* Table row that spans all columns for empty/loading states */
export function TableEmpty({ colSpan, title, text, icon }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <EmptyState title={title} text={text} icon={icon} />
      </td>
    </tr>
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx('hr-field', className)}>
      {label && <span className="hr-label">{label}</span>}
      {children}
      {hint && <span className="hr-hint">{hint}</span>}
    </label>
  );
}

export function Modal({ title, subtitle, children, footer, size }) {
  return (
    <div className="hr-modal-scrim" role="dialog" aria-modal="true">
      <div className={cx('hr-modal', size === 'lg' && 'hr-modal-lg')}>
        <div className="hr-modal-head">
          <h3 className="hr-modal-title">{title}</h3>
          {subtitle && <p className="hr-modal-sub">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="hr-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Restricted({ title, text }) {
  return (
    <section className="hr-panel">
      <div className="hr-notice">
        <div className="hr-notice-icon"><ShieldAlert size={20} /></div>
        <div>
          <h2 className="hr-panel-title">{title}</h2>
          <p className="hr-panel-sub" style={{ marginTop: 4 }}>{text}</p>
        </div>
      </div>
    </section>
  );
}

/* Read-only label/value pair used on profile screens */
export function DataItem({ label, value, money }) {
  const empty = value === undefined || value === null || value === '';
  return (
    <div>
      <div className="hr-dt">{label}</div>
      <div className={cx('hr-dd', empty && 'is-empty', !empty && money && 'is-money')}>
        {empty ? 'Not specified' : value}
      </div>
    </div>
  );
}

/* Indian-grouped currency for display only */
export function formatINR(value) {
  const n = Number(value);
  if (!isFinite(n)) return `₹${value}`;
  return `₹${n.toLocaleString('en-IN')}`;
}
