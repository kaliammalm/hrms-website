/* ==========================================================================
   Add Employee (Zoho People style): company → basic info → job & role → bank & statutory.
   POST /api/employees  → { employee, emp_code, temporaryPassword, notSaved }
   ========================================================================== */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, UserPlus, Copy, Check, CircleCheck, TriangleAlert, Building2, User, Briefcase, Landmark, RefreshCw } from 'lucide-react';
import { EmployeeField } from './EmployeeFields';
import {
  empFetch, FIELDS, DEFAULT_DEPARTMENTS, isPrivilegedDesignation, validate, toPayload, lookupIfsc, VALIDATORS,
} from './employeeModel';

const GROUPS = [
  { id: 'basic', label: 'Basic info', icon: User, note: 'Name, sign-in email and mobile' },
  { id: 'job', label: 'Job & role', icon: Briefcase, note: 'Designation, department, manager' },
  { id: 'money', label: 'Bank & statutory', icon: Landmark, note: 'Needed for payroll; can be added later' },
];
const keysOf = (g) => FIELDS.filter((f) => f.add === g).map((f) => f.key);
const ALL_KEYS = FIELDS.filter((f) => f.add).map((f) => f.key);
const EMPTY = Object.fromEntries(ALL_KEYS.map((k) => [k, '']));
const START = { ...EMPTY, employment_type: 'Full-time', attendance_mode: 'OFFICE' };
const MISSING_LABEL = { employment_type: 'Employment type', reporting_manager_id: 'Reporting manager', uan: 'UAN', pf_number: 'PF number', exit_date: 'Exit date', attendance_mode: 'Attendance' };

export default function AddEmployeeModal({ companies, defaultCompanyId, lockCompany, isGroupMD, onClose, onCreated, onViewProfile }) {
  const [companyId, setCompanyId] = useState(defaultCompanyId ? String(defaultCompanyId) : '');
  const [values, setValues] = useState(START);
  const [errors, setErrors] = useState({});
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState('');
  const [code, setCode] = useState('');
  const [codeAuto, setCodeAuto] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(null); // { employee, emp_code, temporaryPassword, notSaved }
  const [copied, setCopied] = useState('');
  const [active, setActive] = useState('basic');
  const bodyRef = useRef(null);

  // Company-specific lookups: next employee ID, reporting managers, known departments / designations
  const loadMeta = useCallback(async (cid) => {
    setMeta(null); setMetaError('');
    if (!cid) return;
    try {
      const m = await empFetch(`/employees/meta?companyId=${cid}`);
      setMeta(m);
      setCode((c) => (codeAuto || !c ? (m.nextCode || '') : c));
    } catch (e) { setMetaError(e.message); }
  }, [codeAuto]);
  useEffect(() => { loadMeta(companyId); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manager list belongs to a company: clear a manager from another company
  useEffect(() => {
    if (!meta || !values.reporting_manager_id) return;
    if (!meta.managers.some((m) => String(m.id) === String(values.reporting_manager_id))) setValues((v) => ({ ...v, reporting_manager_id: '' }));
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes, body does not scroll behind the dialog
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, saving]);

  const ctx = useMemo(() => ({
    idPrefix: 'add',
    managers: meta?.managers || [],
    departments: [...new Set([...(meta?.departments || []), ...DEFAULT_DEPARTMENTS])].sort(),
    designations: (meta?.designations || []).filter((d) => isGroupMD || !isPrivilegedDesignation(d)),
  }), [meta, isGroupMD]);

  const change = (k, v) => {
    setValues((s) => ({ ...s, [k]: v }));
    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };
  const blur = async (k) => {
    const v = String(values[k] || '').trim();
    if (v) { const e = validate(values, [k]); setErrors((s) => ({ ...s, ...e })); }
    if (k === 'ifsc_code' && v && !VALIDATORS.ifsc(v)) {
      const hit = await lookupIfsc(v);
      if (hit) setValues((s) => ({ ...s, bank_name: hit.bank || s.bank_name })); // the IFSC decides the bank
    }
  };

  const groupStatus = (g) => {
    const keys = keysOf(g);
    if (keys.some((k) => errors[k])) return 'error';
    const req = keys.filter((k) => FIELDS.find((f) => f.key === k).required);
    return req.length && req.every((k) => String(values[k] || '').trim()) ? 'done' : (g === 'money' && keys.some((k) => values[k]) ? 'done' : '');
  };
  const goTo = (g) => {
    setActive(g);
    const el = bodyRef.current?.querySelector(`[data-group="${g}"]`);
    if (el) bodyRef.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
  };
  // Highlight the section in view while scrolling
  const onScroll = () => {
    const box = bodyRef.current;
    if (!box) return;
    let cur = 'basic';
    box.querySelectorAll('[data-group]').forEach((el) => { if (el.offsetTop - box.scrollTop < 120) cur = el.dataset.group; });
    if (cur !== active) setActive(cur);
  };

  const roleWarning = isPrivilegedDesignation(values.role)
    ? (isGroupMD ? 'This designation gives management access (employee records, approvals) for the company.' : 'Only the group MD can create MD, CEO, HR or Admin accounts.')
    : '';

  const submit = async (another) => {
    setFormError('');
    const errs = validate(values, ALL_KEYS);
    if (!companyId) errs.company = 'Choose the company';
    if (!codeAuto && code && VALIDATORS.empCode(code)) errs.emp_code = VALIDATORS.empCode(code);
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = ['company', ...ALL_KEYS, 'emp_code'].find((k) => errs[k]);
      const g = FIELDS.find((f) => f.key === first)?.add || 'basic';
      goTo(g);
      setTimeout(() => document.getElementById(first === 'company' ? 'add-company' : first === 'emp_code' ? 'add-emp-code' : `add-${first}`)?.focus(), 250);
      return;
    }
    setSaving(true);
    try {
      const body = { ...toPayload(values, ALL_KEYS), first_name: values.first_name.trim(), last_name: values.last_name.trim(), company_id: Number(companyId) };
      if (!codeAuto && code.trim()) body.emp_code = code.trim().toUpperCase();
      Object.keys(body).forEach((k) => { if (body[k] === '' || body[k] === null) delete body[k]; });
      const res = await empFetch('/employees', { method: 'POST', body });
      onCreated(res.employee);
      if (another) {
        setValues({ ...START, employment_type: values.employment_type, department: values.department, reporting_manager_id: values.reporting_manager_id, attendance_mode: values.attendance_mode });
        setErrors({});
        setCodeAuto(true);
        setDone({ ...res, inline: true });
        loadMeta(companyId);
        bodyRef.current?.scrollTo({ top: 0 });
        setTimeout(() => document.getElementById('add-first_name')?.focus(), 50);
      } else {
        setDone(res);
      }
    } catch (e) {
      setFormError(e.message);
      bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } finally { setSaving(false); }
  };

  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1600); } catch (e) { /* clipboard blocked */ }
  };

  const companyName = (companies.find((c) => String(c.id) === String(companyId)) || {}).name || '';
  const missing = (meta?.missingColumns || []).map((c) => MISSING_LABEL[c] || c);

  /* ------------------------------------------------------------ success */
  if (done && !done.inline) {
    const e = done.employee || {};
    return (
      <div className="hr-modal-scrim em-scrim" role="dialog" aria-modal="true" aria-labelledby="em-done-title">
        <div className="hr-modal em-done">
          <div className="em-done-icon"><CircleCheck size={28} /></div>
          <h3 id="em-done-title" className="em-done-title">{e.name || 'Employee'} added</h3>
          <p className="em-done-sub">{e.role || e.designation} · {e.company_name || companyName}</p>
          <dl className="em-cred">
            <div><dt>Employee ID</dt><dd className="num">{done.emp_code}</dd></div>
            <div><dt>Sign-in email</dt><dd>{e.email}</dd></div>
            <div>
              <dt>Temporary password</dt>
              <dd className="em-cred-pass"><code>{done.temporaryPassword}</code>
                <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => copy(`Email: ${e.email}\nPassword: ${done.temporaryPassword}`, 'cred')}>
                  {copied === 'cred' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy sign-in details</>}
                </button>
              </dd>
            </div>
          </dl>
          <p className="em-done-note">Share the password privately. It is shown only once; ask the employee to change it after the first sign-in.</p>
          {done.notSaved?.length > 0 && (
            <div className="em-alert is-warning"><TriangleAlert size={16} /><span>Not saved yet: {done.notSaved.join(', ')}. Run <code>scripts/add-profile-columns.js --apply</code> on the database, then fill them in from the profile.</span></div>
          )}
          <div className="em-done-actions">
            <button type="button" className="hr-btn hr-btn-secondary" onClick={() => { setDone(null); setValues(START); setErrors({}); setCodeAuto(true); loadMeta(companyId); }}>Add another</button>
            <button type="button" className="hr-btn hr-btn-secondary" onClick={() => onViewProfile(done.employee)}>View profile</button>
            <button type="button" className="hr-btn hr-btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------ form */
  const fieldsOf = (g) => keysOf(g).map((k) => (
    <EmployeeField key={k} k={k} value={values[k]} onChange={change} onBlur={blur} error={errors[k]} ctx={ctx}
      hintOverride={k === 'role' && roleWarning ? roleWarning : undefined} />
  ));

  return (
    <div className="hr-modal-scrim em-scrim" role="dialog" aria-modal="true" aria-labelledby="em-add-title" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="em-add">
        <header className="em-add-head">
          <div className="em-add-head-icon"><UserPlus size={18} /></div>
          <div>
            <h2 id="em-add-title" className="em-add-title">Add employee</h2>
            <p className="em-add-sub">{companyName ? `New joiner at ${companyName}` : 'Choose the company, then fill in the details'}</p>
          </div>
          <button type="button" className="hr-btn hr-btn-ghost hr-btn-icon em-close" onClick={onClose} aria-label="Close" disabled={saving}><X size={18} /></button>
        </header>

        <div className="em-add-main">
          <nav className="em-add-nav" aria-label="Form sections">
            {GROUPS.map((g) => {
              const st = groupStatus(g.id);
              const Icon = g.icon;
              return (
                <button key={g.id} type="button" className={`em-add-step${active === g.id ? ' is-on' : ''}${st ? ` is-${st}` : ''}`} onClick={() => goTo(g.id)}>
                  <span className="em-add-step-mark">{st === 'done' ? <Check size={13} /> : <Icon size={14} />}</span>
                  <span className="em-add-step-text"><strong>{g.label}</strong><small>{g.note}</small></span>
                </button>
              );
            })}
          </nav>

          <div className="em-add-body" ref={bodyRef} onScroll={onScroll}>
            {formError && <div className="em-alert is-error" role="alert"><TriangleAlert size={16} /><span>{formError}</span></div>}
            {done?.inline && (
              <div className="em-alert is-success" role="status">
                <CircleCheck size={16} />
                <span>{done.employee?.name} added as <strong>{done.emp_code}</strong>. Temporary password: <code>{done.temporaryPassword}</code></span>
                <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => copy(`Email: ${done.employee?.email}\nPassword: ${done.temporaryPassword}`, 'inline')}>{copied === 'inline' ? 'Copied' : 'Copy'}</button>
              </div>
            )}
            {missing.length > 0 && (
              <div className="em-alert is-warning"><TriangleAlert size={16} /><span>The database is missing columns for: {missing.join(', ')}. Those fields will not be saved until <code>scripts/add-profile-columns.js --apply</code> is run.</span></div>
            )}

            <section className="em-group" data-group="basic" aria-labelledby="g-basic">
              <h3 id="g-basic" className="em-group-title">Basic info</h3>
              <div className="em-grid">
                <div className={`hr-field em-field${errors.company ? ' has-error' : ''}`}>
                  <label className="hr-label" htmlFor="add-company">Company<span className="em-req" aria-hidden="true"> *</span></label>
                  <div className="hr-input-icon">
                    <Building2 size={15} />
                    <select id="add-company" className="hr-select em-select-icon" value={companyId} disabled={lockCompany || saving}
                      onChange={(e) => { setCompanyId(e.target.value); setErrors((s) => { const n = { ...s }; delete n.company; return n; }); }}>
                      <option value="">Select company</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  {errors.company && <span className="em-error" role="alert">{errors.company}</span>}
                </div>
                <div className={`hr-field em-field${errors.emp_code ? ' has-error' : ''}`}>
                  <label className="hr-label" htmlFor="add-emp-code">Employee ID</label>
                  <div className="em-code">
                    <input id="add-emp-code" className="hr-input num em-upper" value={codeAuto ? (meta?.nextCode || '') : code} readOnly={codeAuto}
                      placeholder={companyId ? (metaError ? 'Unavailable' : 'Generating…') : 'Choose the company'}
                      onChange={(e) => setCode(e.target.value)} aria-describedby="add-emp-code-help" />
                    <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => { if (codeAuto) setCode(meta?.nextCode || ''); setCodeAuto(!codeAuto); }} disabled={!companyId}>
                      {codeAuto ? 'Edit' : <><RefreshCw size={13} /> Auto</>}
                    </button>
                  </div>
                  <span id="add-emp-code-help" className={errors.emp_code ? 'em-error' : 'hr-hint'}>{errors.emp_code || (codeAuto ? 'Next free ID for this company, confirmed when you save' : 'Must be unique across the group')}</span>
                </div>
                {keysOf('basic').map((k, i) => (
                  <EmployeeField key={k} k={k} value={values[k]} onChange={change} onBlur={blur} error={errors[k]} ctx={ctx} autoFocus={i === 0 && !!defaultCompanyId} />
                ))}
              </div>
              {metaError && <div className="em-alert is-error"><TriangleAlert size={16} /><span>{metaError}</span></div>}
            </section>

            <section className="em-group" data-group="job" aria-labelledby="g-job">
              <h3 id="g-job" className="em-group-title">Job & role</h3>
              <div className="em-grid">{fieldsOf('job')}</div>
            </section>

            <section className="em-group" data-group="money" aria-labelledby="g-money">
              <h3 id="g-money" className="em-group-title">Bank & statutory</h3>
              <p className="em-group-note">Payroll uses these for PF, ESI and the bank transfer file. Leave blank if not available yet.</p>
              <div className="em-grid">{fieldsOf('money')}</div>
            </section>
          </div>
        </div>

        <footer className="em-add-foot">
          <span className="em-add-foot-note"><span className="em-req">*</span> Required</span>
          <button type="button" className="hr-btn hr-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="hr-btn hr-btn-secondary em-hide-sm" onClick={() => submit(true)} disabled={saving}>Save & add another</button>
          <button type="button" className="hr-btn hr-btn-primary" onClick={() => submit(false)} disabled={saving}>{saving ? 'Saving…' : 'Save employee'}</button>
        </footer>
      </div>
    </div>
  );
}
