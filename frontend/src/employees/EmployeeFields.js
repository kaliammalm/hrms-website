/* ==========================================================================
   Form inputs for one employee field (shared by Add Employee and the profile drawer).
   ========================================================================== */
import React from 'react';
import { FIELD_BY_KEY } from './employeeModel';

/** Reporting-manager options: group leadership first, then the company's people */
export function ManagerSelect({ id, value, onChange, managers, excludeId, disabled, invalid }) {
  const list = (managers || []).filter((m) => String(m.id) !== String(excludeId || ''));
  const leaders = list.filter((m) => m.isGroupLeader);
  const staff = list.filter((m) => !m.isGroupLeader);
  const label = (m) => `${m.name}${m.role ? ` · ${m.role}` : ''}${m.empCode ? ` (${m.empCode})` : ''}`;
  return (
    <select id={id} className="hr-select" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-invalid={invalid || undefined}>
      <option value="">{list.length ? 'Not assigned' : 'Choose the company first'}</option>
      {leaders.length > 0 && (
        <optgroup label="Group leadership">
          {leaders.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}
        </optgroup>
      )}
      {staff.length > 0 && (
        <optgroup label="Company">
          {staff.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}
        </optgroup>
      )}
      {/* keep a current manager visible even if they are no longer in the list */}
      {value && !list.some((m) => String(m.id) === String(value)) && <option value={value}>Current manager (#{value})</option>}
    </select>
  );
}

/**
 * One labelled input. `ctx` carries lists (designations, departments, managers) and the
 * id prefix, so the same field can appear in two forms on the page without id clashes.
 */
export function EmployeeField({ k, value, onChange, onBlur, error, ctx = {}, disabled, hintOverride, autoFocus }) {
  const f = FIELD_BY_KEY[k];
  const id = `${ctx.idPrefix || 'emp'}-${k}`;
  const set = (v) => onChange(k, v);
  const common = {
    id,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error || f.hint || hintOverride ? `${id}-help` : undefined,
    onBlur: onBlur ? () => onBlur(k) : undefined,
    autoFocus,
  };
  let input;
  if (f.type === 'select') {
    input = (
      <select className="hr-select" value={value || ''} onChange={(e) => set(e.target.value)} {...common}>
        <option value="">Select</option>
        {f.options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    );
  } else if (f.type === 'manager') {
    input = <ManagerSelect id={id} value={value} onChange={set} managers={ctx.managers} excludeId={ctx.selfId} disabled={disabled} invalid={!!error} />;
  } else if (f.type === 'textarea') {
    input = <textarea className="hr-textarea em-textarea" rows={2} value={value || ''} onChange={(e) => set(e.target.value)} {...common} />;
  } else {
    const listId = f.type === 'combo' ? `${id}-list` : undefined;
    input = (
      <>
        <input
          className={`hr-input${f.upper ? ' em-upper' : ''}`}
          type={f.type === 'combo' ? 'text' : (f.type || 'text')}
          inputMode={f.inputMode || (f.type === 'tel' ? 'tel' : undefined)}
          autoComplete={f.autoComplete || 'off'}
          placeholder={f.placeholder}
          list={listId}
          value={value || ''}
          onChange={(e) => set(e.target.value)}
          {...common}
        />
        {listId && (
          <datalist id={listId}>
            {(ctx[f.list] || []).map((o) => <option key={o} value={o} />)}
          </datalist>
        )}
      </>
    );
  }
  const help = error || hintOverride || f.hint;
  return (
    <div className={`hr-field em-field${f.wide ? ' is-wide' : ''}${error ? ' has-error' : ''}`}>
      <label className="hr-label" htmlFor={id}>{f.label}{f.required && <span className="em-req" aria-hidden="true"> *</span>}</label>
      {input}
      {help && <span id={`${id}-help`} className={error ? 'em-error' : 'hr-hint'} role={error ? 'alert' : undefined}>{help}</span>}
    </div>
  );
}
