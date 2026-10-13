/* ==========================================================================
   Employee profile: right-side slide-over with tabs
   (Personal info · Job details · Statutory info · Bank details), view and edit.
   PUT /api/employees/:id sends only the fields that changed.
   ========================================================================== */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Pencil, Mail, Phone, TriangleAlert, CircleCheck, Eye, EyeOff, Building2, CalendarDays } from 'lucide-react';
import { Avatar, StatusPill } from '../ui';
import { EmployeeField } from './EmployeeFields';
import {
  empFetch, FIELDS, SECTIONS, DEFAULT_DEPARTMENTS, isPrivilegedDesignation, toForm, validate, toPayload, changedKeys,
  completeness, formatDate, maskTail, lookupIfsc, VALIDATORS, STATUS_TONE, normalizeEmployee,
} from './employeeModel';

const display = (k, form, emp, reveal) => {
  const v = form[k];
  if (!v) return '';
  if (k === 'dob' || k === 'joining_date' || k === 'exit_date') return formatDate(v);
  if (k === 'reporting_manager_id') return emp.managerName || `Employee #${v}`;
  if (k === 'attendance_mode') return v === 'FIELD' ? 'Field (site visits)' : 'Office';
  if ((k === 'account_number' || k === 'aadhar_number') && !reveal) return maskTail(v);
  return v;
};

export default function EmployeeDrawer({ employee, canEdit, isGroupMD, startEditing, onClose, onSaved }) {
  const emp = employee;
  const baseline = useMemo(() => toForm(emp), [emp]);
  const [tab, setTab] = useState('personal');
  const [editing, setEditing] = useState(!!startEditing && canEdit);
  const [values, setValues] = useState(baseline);
  const [errors, setErrors] = useState({});
  const [meta, setMeta] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [reveal, setReveal] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => { setValues(baseline); setErrors({}); }, [baseline]);
  useEffect(() => { setTab('personal'); setNotice(null); setReveal(false); setEditing(!!startEditing && canEdit); }, [emp.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lookups (managers, departments) are only needed for editing
  useEffect(() => {
    if (!editing || meta) return;
    empFetch(`/employees/meta?companyId=${emp.companyId || ''}`).then(setMeta).catch((e) => setNotice({ tone: 'error', text: e.message }));
  }, [editing, meta, emp.companyId]);

  const dirty = editing && changedKeys(values, baseline).length > 0;
  const requestClose = () => { if (dirty) setConfirmClose(true); else onClose(); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) requestClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);

  const ctx = useMemo(() => ({
    idPrefix: 'drw',
    selfId: emp.id,
    managers: meta?.managers || [],
    departments: [...new Set([...(meta?.departments || []), ...DEFAULT_DEPARTMENTS])].sort(),
    designations: (meta?.designations || []).filter((d) => isGroupMD || !isPrivilegedDesignation(d)),
  }), [meta, isGroupMD, emp.id]);

  const change = (k, v) => {
    setValues((s) => ({ ...s, [k]: v }));
    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };
  const blur = async (k) => {
    const v = String(values[k] || '').trim();
    if (v) setErrors((s) => ({ ...s, ...validate(values, [k]) }));
    if (k === 'ifsc_code' && v && !VALIDATORS.ifsc(v)) {
      const hit = await lookupIfsc(v);
      if (hit) setValues((s) => ({ ...s, bank_name: hit.bank || s.bank_name, bank_branch: hit.branch || s.bank_branch })); // the IFSC decides the bank
    }
  };

  const roleLocked = !isGroupMD && isPrivilegedDesignation(baseline.role);
  const startEdit = () => { setEditing(true); setNotice(null); };
  const cancel = () => { setValues(baseline); setErrors({}); setEditing(false); setConfirmClose(false); };

  const save = async () => {
    const changed = changedKeys(values, baseline);
    if (!changed.length) { setEditing(false); setNotice({ tone: 'info', text: 'No changes to save.' }); return; }
    // Validate only what changed (old records may hold values in older formats)
    const errs = validate(values, changed.filter((k) => k !== 'last_name'));
    if (changed.includes('first_name') && !values.first_name.trim()) errs.first_name = 'First name is required';
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      setTab(FIELDS.find((f) => f.key === first)?.section || 'personal');
      setTimeout(() => document.getElementById(`drw-${first}`)?.focus(), 60);
      return;
    }
    const keys = changed.includes('first_name') || changed.includes('last_name') ? [...new Set([...changed, 'first_name', 'last_name'])] : changed;
    setSaving(true);
    try {
      const res = await empFetch(`/employees/${emp.id}`, { method: 'PUT', body: toPayload(values, keys) });
      const saved = res.employee ? normalizeEmployee(res.employee) : null;
      if (saved) onSaved(saved);
      setEditing(false);
      setConfirmClose(false);
      setNotice(res.notSaved?.length
        ? { tone: 'warning', text: `Saved, except ${res.notSaved.join(', ')}: the database needs scripts/add-profile-columns.js --apply.` }
        : { tone: 'success', text: 'Changes saved.' });
    } catch (e) {
      setNotice({ tone: 'error', text: e.message });
    } finally { setSaving(false); }
  };

  const { missing, percent } = completeness(baseline, emp.email);
  const sectionFields = FIELDS.filter((f) => f.section === tab);
  const errorTabs = new Set(Object.keys(errors).map((k) => FIELDS.find((f) => f.key === k)?.section));

  return (
    <div className="em-drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) requestClose(); }}>
      <aside className="em-drawer" role="dialog" aria-modal="true" aria-labelledby="em-drawer-name" ref={panelRef} tabIndex={-1}>
        <header className="em-drawer-head">
          <div className="em-drawer-top">
            <Avatar name={emp.name} src={emp.photo} size={56} />
            <div className="em-drawer-id">
              <h2 id="em-drawer-name" className="em-drawer-name">{emp.name}</h2>
              <div className="em-drawer-role">{emp.designation || 'Designation not set'}{emp.department ? ` · ${emp.department}` : ''}</div>
              <div className="em-drawer-chips">
                {emp.code && <span className="em-chip num">{emp.code}</span>}
                <StatusPill tone={STATUS_TONE[emp.status]}>{emp.status}</StatusPill>
                {emp.attendanceMode === 'FIELD' && <span className="em-chip">Field staff</span>}
              </div>
            </div>
            <button type="button" className="hr-btn hr-btn-ghost hr-btn-icon em-close" onClick={requestClose} aria-label="Close profile" disabled={saving}><X size={18} /></button>
          </div>
          <div className="em-drawer-facts">
            <span><Building2 size={14} /> {emp.companyName || 'No company'}</span>
            {emp.joiningDate && <span><CalendarDays size={14} /> Joined {formatDate(emp.joiningDate)}</span>}
            {emp.email && <a href={`mailto:${emp.email}`}><Mail size={14} /> {emp.email}</a>}
            {emp.phone && <a href={`tel:${emp.phone.replace(/\s+/g, '')}`}><Phone size={14} /> {emp.phone}</a>}
          </div>
          {canEdit && (
            <div className="em-complete" title={missing.length ? `Missing: ${missing.join(', ')}` : 'All key details entered'}>
              <div className="em-complete-bar"><span style={{ width: `${percent}%` }} className={percent === 100 ? 'is-full' : ''} /></div>
              <span className="em-complete-text">Profile {percent}% complete{missing.length ? ` · missing ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` +${missing.length - 3}` : ''}` : ''}</span>
            </div>
          )}
          <div className="em-tabs" role="tablist" aria-label="Profile sections">
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" role="tab" id={`em-tab-${s.id}`} aria-selected={tab === s.id} aria-controls="em-tabpanel"
                className={`${tab === s.id ? 'is-on' : ''}${errorTabs.has(s.id) ? ' has-error' : ''}`} onClick={() => setTab(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </header>

        <div className="em-drawer-body" id="em-tabpanel" role="tabpanel" aria-labelledby={`em-tab-${tab}`}>
          {notice && (
            <div className={`em-alert is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
              {notice.tone === 'success' ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}<span>{notice.text}</span>
            </div>
          )}
          {editing ? (
            <div className="em-grid">
              {tab === 'job' && (
                <div className="em-readonly is-wide">
                  <span>Employee ID <strong className="num">{emp.code || '—'}</strong></span>
                  <span>Company <strong>{emp.companyName || '—'}</strong></span>
                </div>
              )}
              {sectionFields.map((f) => (
                <EmployeeField key={f.key} k={f.key} value={values[f.key]} onChange={change} onBlur={blur} error={errors[f.key]} ctx={ctx}
                  disabled={saving || (f.key === 'role' && roleLocked)}
                  hintOverride={f.key === 'role' && roleLocked ? 'Access roles (MD, CEO, HR, Admin) can only be changed by the group MD.' : undefined} />
              ))}
            </div>
          ) : (
            <dl className="em-dl">
              {tab === 'job' && (<>
                <div><dt>Employee ID</dt><dd className="num">{emp.code || <span className="is-empty">Not set</span>}</dd></div>
                <div><dt>Company</dt><dd>{emp.companyName || <span className="is-empty">Not set</span>}</dd></div>
              </>)}
              {sectionFields.map((f) => {
                const v = f.key === 'first_name' ? emp.name : display(f.key, baseline, emp, reveal);
                if (f.key === 'last_name') return null;
                return (
                  <div key={f.key} className={f.type === 'textarea' ? 'is-wide' : ''}>
                    <dt>{f.key === 'first_name' ? 'Full name' : f.label}</dt>
                    <dd className={f.validate === 'account' || f.key === 'uan' ? 'num' : ''}>
                      {v || <span className="is-empty">Not specified</span>}
                      {f.sensitive && baseline[f.key] && canEdit && (
                        <button type="button" className="em-reveal" onClick={() => setReveal(!reveal)} aria-label={reveal ? 'Hide numbers' : 'Show numbers'}>
                          {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      )}
                    </dd>
                  </div>
                );
              })}
              {tab === 'job' && <p className="em-dl-note is-wide">Salary is managed in Payroll → Salary structures.</p>}
            </dl>
          )}
        </div>

        {canEdit && (
          <footer className="em-drawer-foot">
            {confirmClose ? (
              <>
                <span className="em-foot-msg">Discard unsaved changes?</span>
                <button type="button" className="hr-btn hr-btn-secondary" onClick={() => setConfirmClose(false)}>Keep editing</button>
                <button type="button" className="hr-btn em-btn-danger" onClick={onClose}>Discard</button>
              </>
            ) : editing ? (
              <>
                {dirty && <span className="em-foot-msg">Unsaved changes</span>}
                <button type="button" className="hr-btn hr-btn-secondary" onClick={cancel} disabled={saving}>Cancel</button>
                <button type="button" className="hr-btn hr-btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
              </>
            ) : (
              <button type="button" className="hr-btn hr-btn-primary" onClick={startEdit}><Pencil size={14} /> Edit profile</button>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}
