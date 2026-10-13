/* ==========================================================================
   Employee Management (Zoho People style directory)
     toolbar: search · department · designation · status · table / grid · + Add employee
     click a person → profile slide-over (Personal · Job · Statutory · Bank)
   Access: MD / Admin (group), company CEO (own company) can add and edit; HR views.
   ========================================================================== */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Plus, LayoutGrid, List, Users, Mail, Phone, Pencil, ArrowUpDown, X, TriangleAlert, RefreshCw, Eye } from 'lucide-react';
import { PageHeader, Avatar, StatusPill, EmptyState } from '../ui';
import EmployeeDrawer from './EmployeeDrawer';
import AddEmployeeModal from './AddEmployeeModal';
import { empFetch, normalizeEmployee, toForm, completeness, formatDate, STATUS_TONE } from './employeeModel';
import '../styles/employees.css';

const VIEW_KEY = 'hrms_emp_view';
const readView = () => {
  try { const v = localStorage.getItem(VIEW_KEY); if (v === 'grid' || v === 'table') return v; } catch (e) { /* storage blocked */ }
  return typeof window !== 'undefined' && window.innerWidth < 720 ? 'grid' : 'table';
};
const ENTITY = { 1: 'rrd', 2: 'fractio', 3: 'varnam' };
const STATUSES = ['All', 'Active', 'Exiting', 'Exited'];

/* Matches the header's company selector (by id, then by name / email domain as before) */
function companyMatcher(selectedName, companies) {
  const sel = String(selectedName || '').trim().toLowerCase();
  if (!sel || sel === 'all companies') return () => true;
  const c = (companies || []).find((x) => String(x.name).toLowerCase() === sel);
  return (e) => {
    if (c && e.companyId !== null && e.companyId !== undefined && e.companyId !== '') return Number(e.companyId) === Number(c.id);
    const n = e.companyName.toLowerCase(); const mail = e.email.toLowerCase();
    if (sel.includes('ram reddy')) return n.includes('ram reddy') || mail.endsWith('ramreddydevelopers.com');
    if (sel.includes('fractio')) return n.includes('fractio') || mail.endsWith('fractio.co.in');
    return !!n && (n.includes(sel) || sel.includes(n));
  };
}

export default function EmployeeDirectory({ user, userRole, selectedCompany, companies, onBack }) {
  const role = String(userRole || user?.role || '').trim().toUpperCase();
  const isGroupMD = role === 'MD' || role === 'ADMIN' || role === 'GLOBAL MANAGING DIRECTOR';
  const canEdit = isGroupMD || role === 'CEO';
  const selectedName = typeof selectedCompany === 'object' ? (selectedCompany?.name || '') : (selectedCompany || '');
  const groupView = !selectedName || selectedName.trim().toLowerCase() === 'all companies';

  const [list, setList] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [desig, setDesig] = useState('');
  const [status, setStatus] = useState('Active');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [view, setView] = useState(readView);
  const [sort, setSort] = useState({ by: 'name', dir: 1 });
  const [open, setOpen] = useState(null); // { id, edit }
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const rows = await empFetch('/employees');
      setList((Array.isArray(rows) ? rows : []).filter((e) => !String(e.name || '').toLowerCase().includes('basker')).map(normalizeEmployee));
    } catch (e) { setLoadError(e.message); setList([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // The old directory kept the last opened profile (with bank details) in browser storage: remove it
  useEffect(() => { try { localStorage.removeItem('active_employee_profile'); } catch (e) { /* ignore */ } }, []);

  const setViewSaved = (v) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* ignore */ } };

  const inCompany = useMemo(() => {
    const match = companyMatcher(selectedName, companies);
    return (list || []).filter(match);
  }, [list, selectedName, companies]);

  const withCompleteness = useMemo(() => inCompany.map((e) => ({ ...e, completeness: completeness(toForm(e), e.email) })), [inCompany]);
  const counts = useMemo(() => {
    const c = { All: withCompleteness.length, Active: 0, Exiting: 0, Exited: 0 };
    withCompleteness.forEach((e) => { c[e.status] = (c[e.status] || 0) + 1; });
    return c;
  }, [withCompleteness]);
  const departments = useMemo(() => [...new Set(inCompany.map((e) => e.department).filter(Boolean))].sort(), [inCompany]);
  const designations = useMemo(() => [...new Set(inCompany.map((e) => e.designation).filter(Boolean))].sort(), [inCompany]);
  const incompleteCount = withCompleteness.filter((e) => e.status !== 'Exited' && e.completeness.missing.length).length;

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digitsTerm = term.replace(/\D/g, '');
    const rows = withCompleteness.filter((e) => {
      if (status !== 'All' && e.status !== status) return false;
      if (dept && e.department !== dept) return false;
      if (desig && e.designation !== desig) return false;
      if (incompleteOnly && !e.completeness.missing.length) return false;
      if (!term) return true;
      return e.name.toLowerCase().includes(term) || e.code.toLowerCase().includes(term) || e.email.toLowerCase().includes(term)
        || (digitsTerm.length >= 4 && e.phone.replace(/\D/g, '').includes(digitsTerm));
    });
    const key = { name: (e) => e.name.toLowerCase(), code: (e) => e.code.toLowerCase(), joined: (e) => e.joiningDate || '0000', dept: (e) => (e.department || '~').toLowerCase() }[sort.by];
    return rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * sort.dir);
  }, [withCompleteness, q, dept, desig, status, incompleteOnly, sort]);

  const filtersOn = q || dept || desig || incompleteOnly || status !== 'Active';
  const clearFilters = () => { setQ(''); setDept(''); setDesig(''); setIncompleteOnly(false); setStatus('Active'); };
  const sortBy = (by) => setSort((s) => ({ by, dir: s.by === by ? -s.dir : 1 }));
  const sortIcon = (by) => <ArrowUpDown size={12} className={`em-sort${sort.by === by ? ' is-on' : ''}`} aria-hidden="true" />;
  const ariaSort = (by) => (sort.by === by ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined);

  // Company code (RRD / FH / SBV) keeps the table narrow; the full name is in the tooltip and on cards
  const shortCompany = (e) => ((companies || []).find((c) => Number(c.id) === Number(e.companyId)) || {}).code || e.companyName;
  const openEmp = list && open ? list.find((e) => e.id === open.id) : null;
  const onSaved = (saved) => setList((l) => l.map((e) => (e.id === saved.id ? saved : e)));
  const onCreated = (raw) => { if (raw) setList((l) => [normalizeEmployee(raw), ...(l || [])]); };

  const companyIdForAdd = (() => {
    if (role === 'CEO') return user?.company_id || (companies?.[0]?.id ?? '');
    const c = (companies || []).find((x) => String(x.name).toLowerCase() === selectedName.trim().toLowerCase());
    return c ? c.id : '';
  })();

  /* ------------------------------------------------------------- render */
  const header = (
    <PageHeader
      title="Employees"
      subtitle={groupView ? 'Everyone across the group' : `Everyone at ${selectedName}`}
      onBack={onBack}
      backLabel="Back to dashboard"
      actions={canEdit && <button type="button" className="hr-btn hr-btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Add employee</button>}
    />
  );

  return (
    <div className="em-page">
      {header}

      <section className="hr-panel em-panel">
        <div className="em-statusbar">
          <div className="hr-seg" role="tablist" aria-label="Employment status">
            {STATUSES.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} className={status === s ? 'is-on' : ''} onClick={() => setStatus(s)}>
                {s} <span className="hr-seg-count">{counts[s] || 0}</span>
              </button>
            ))}
          </div>
          {canEdit && incompleteCount > 0 && (
            <button type="button" className={`em-flag${incompleteOnly ? ' is-on' : ''}`} onClick={() => setIncompleteOnly(!incompleteOnly)} aria-pressed={incompleteOnly}>
              <TriangleAlert size={13} /> {incompleteCount} incomplete {incompleteCount === 1 ? 'profile' : 'profiles'}
            </button>
          )}
        </div>

        <div className="em-toolbar">
          <div className="hr-input-icon em-search">
            <Search size={15} />
            <input type="search" className="hr-input" placeholder="Search name, ID, email or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employees" />
          </div>
          <select className="hr-select em-filter" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="hr-select em-filter" value={desig} onChange={(e) => setDesig(e.target.value)} aria-label="Filter by designation">
            <option value="">All designations</option>
            {designations.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {filtersOn && <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={clearFilters}><X size={14} /> Clear</button>}
          <div className="em-toolbar-end">
            <span className="hr-count" aria-live="polite">{shown.length} of {counts.All}</span>
            <div className="hr-seg em-viewseg" role="group" aria-label="View">
              <button type="button" className={view === 'table' ? 'is-on' : ''} onClick={() => setViewSaved('table')} aria-pressed={view === 'table'} title="Table view"><List size={15} /><span className="em-hide-sm">Table</span></button>
              <button type="button" className={view === 'grid' ? 'is-on' : ''} onClick={() => setViewSaved('grid')} aria-pressed={view === 'grid'} title="Card view"><LayoutGrid size={15} /><span className="em-hide-sm">Cards</span></button>
            </div>
          </div>
        </div>

        {loadError && (
          <div className="em-loaderr">
            <EmptyState icon={<TriangleAlert size={20} />} title="Employees could not be loaded" text={loadError} />
            <div className="em-retry"><button type="button" className="hr-btn hr-btn-secondary" onClick={() => { setList(null); load(); }}><RefreshCw size={14} /> Try again</button></div>
          </div>
        )}

        {!list ? (
          view === 'grid' ? (
            <div className="em-cards">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="em-card is-skeleton" />)}</div>
          ) : (
            <div className="em-skel-rows">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="em-skel-row" />)}</div>
          )
        ) : !loadError && shown.length === 0 ? (
          <EmptyState icon={<Users size={20} />} title={counts.All ? 'No one matches these filters' : 'No employees yet'}
            text={counts.All ? 'Try another search or clear the filters.' : (canEdit ? 'Add the first employee with “Add employee”.' : 'No employees are on record for this company.')} />
        ) : view === 'table' ? (
          <div className="hr-table-wrap">
            <table className="hr-table em-table">
              <thead>
                <tr>
                  <th aria-sort={ariaSort('name')}><button type="button" className="em-th" onClick={() => sortBy('name')}>Employee {sortIcon('name')}</button></th>
                  <th aria-sort={ariaSort('code')}><button type="button" className="em-th" onClick={() => sortBy('code')}>ID {sortIcon('code')}</button></th>
                  <th>Designation</th>
                  <th aria-sort={ariaSort('dept')}><button type="button" className="em-th" onClick={() => sortBy('dept')}>Department {sortIcon('dept')}</button></th>
                  {groupView && <th>Company</th>}
                  <th className="em-col-mgr">Reports to</th>
                  <th aria-sort={ariaSort('joined')} className="em-col-joined"><button type="button" className="em-th" onClick={() => sortBy('joined')}>Joined {sortIcon('joined')}</button></th>
                  <th>Status</th>
                  <th className="is-actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="em-row" onClick={() => setOpen({ id: e.id })}>
                    <td>
                      <div className="hr-cell-person">
                        <Avatar name={e.name} src={e.photo} size={34} />
                        <div style={{ minWidth: 0 }}>
                          <button type="button" className="em-name-link" onClick={(ev) => { ev.stopPropagation(); setOpen({ id: e.id }); }}>{e.name}</button>
                          <div className="hr-cell-person-sub">{e.email || 'No email'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num em-nowrap">{e.code || '—'}</td>
                    <td>{e.designation || <span className="is-muted">—</span>}</td>
                    <td>{e.department || <span className="is-muted">Not set</span>}</td>
                    {groupView && <td className="em-nowrap" title={e.companyName}><span className={`em-dot is-${ENTITY[e.companyId] || 'none'}`} />{shortCompany(e) || '—'}</td>}
                    <td className="em-col-mgr">{e.managerName || <span className="is-muted">—</span>}</td>
                    <td className="em-nowrap em-col-joined">{e.joiningDate ? formatDate(e.joiningDate) : <span className="is-muted">—</span>}</td>
                    <td className="em-nowrap">
                      <StatusPill tone={STATUS_TONE[e.status]}>{e.status}</StatusPill>
                      {canEdit && e.completeness.missing.length > 0 && e.status !== 'Exited' && (
                        <span className="em-incomplete" title={`Missing: ${e.completeness.missing.join(', ')}`}>{e.completeness.percent}%</span>
                      )}
                    </td>
                    <td className="is-actions em-nowrap">
                      <button type="button" className="hr-btn hr-btn-soft hr-btn-sm hr-btn-icon" aria-label={`View profile of ${e.name}`} title="View profile"
                        onClick={(ev) => { ev.stopPropagation(); setOpen({ id: e.id }); }}><Eye size={14} /></button>
                      {canEdit && (
                        <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm hr-btn-icon" aria-label={`Edit ${e.name}`} title="Edit"
                          onClick={(ev) => { ev.stopPropagation(); setOpen({ id: e.id, edit: true }); }}><Pencil size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="em-cards">
            {shown.map((e) => (
              <article key={e.id} className={`em-card is-${ENTITY[e.companyId] || 'none'}`}>
                <button type="button" className="em-card-main" onClick={() => setOpen({ id: e.id })} aria-label={`View profile of ${e.name}`}>
                  <Avatar name={e.name} src={e.photo} size={52} />
                  <span className="em-card-name">{e.name}</span>
                  <span className="em-card-role">{e.designation || 'Designation not set'}</span>
                  <span className="em-card-meta">
                    {e.code && <span className="em-chip num">{e.code}</span>}
                    <StatusPill tone={STATUS_TONE[e.status]}>{e.status}</StatusPill>
                  </span>
                  <span className="em-card-facts">
                    <span>{e.department || 'No department'}</span>
                    {groupView && <span>{e.companyName}</span>}
                    {e.managerName && <span>Reports to {e.managerName}</span>}
                  </span>
                </button>
                <div className="em-card-foot">
                  {e.email ? <a href={`mailto:${e.email}`} className="hr-btn hr-btn-ghost hr-btn-sm hr-btn-icon" aria-label={`Email ${e.name}`} title={e.email}><Mail size={15} /></a> : <span />}
                  {e.phone ? <a href={`tel:${e.phone.replace(/\s+/g, '')}`} className="hr-btn hr-btn-ghost hr-btn-sm hr-btn-icon" aria-label={`Call ${e.name}`} title={e.phone}><Phone size={15} /></a> : <span />}
                  {canEdit && e.completeness.missing.length > 0 && e.status !== 'Exited' && <span className="em-incomplete" title={`Missing: ${e.completeness.missing.join(', ')}`}>{e.completeness.percent}%<span className="em-hide-sm"> complete</span></span>}
                  <span className="em-card-spacer" />
                  {canEdit && <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => setOpen({ id: e.id, edit: true })} aria-label={`Edit ${e.name}`}><Pencil size={13} /><span className="em-hide-sm">Edit</span></button>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {openEmp && (
        <EmployeeDrawer
          key={openEmp.id}
          employee={openEmp}
          canEdit={canEdit}
          isGroupMD={isGroupMD}
          startEditing={!!open.edit}
          onClose={() => setOpen(null)}
          onSaved={onSaved}
        />
      )}
      {adding && (
        <AddEmployeeModal
          companies={companies || []}
          defaultCompanyId={companyIdForAdd}
          lockCompany={role === 'CEO'}
          isGroupMD={isGroupMD}
          onClose={() => setAdding(false)}
          onCreated={onCreated}
          onViewProfile={(raw) => { setAdding(false); if (raw) setOpen({ id: raw.id }); }}
        />
      )}
    </div>
  );
}
