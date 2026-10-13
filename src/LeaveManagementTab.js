import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Check, X, CalendarDays, AlertCircle, Briefcase, House, RefreshCw, RotateCcw } from 'lucide-react';
import { PageHeader, Panel, StatusPill, Avatar, TableEmpty, Modal, Field } from './ui';

// Request types. On-Duty and Work From Home use the same approval flow as leave,
// but count as working days (not leave) in reports and dashboards.
const REQUEST_GROUPS = [
  { label: 'Leave', options: ['Casual Leave (CL)', 'Sick Leave', 'Emergency Leave'] },
  { label: 'Working away from the office', options: ['On Duty (OD)', 'Work From Home (WFH)'] },
];
const requestKind = (type) => {
  const t = String(type || '').toUpperCase();
  if (/\bWFH\b|WORK\s*FROM\s*HOME/.test(t)) return 'wfh';
  if (/\bOD\b|ON[\s-]*DUTY/.test(t)) return 'od';
  return 'leave';
};
const REASON_HINT = {
  leave: 'Briefly explain why you need this leave',
  od: 'Where you will be working and the purpose (e.g. client meeting at site, bank visit)',
  wfh: 'Why you need to work from home and what you will be working on',
};

function TypeCell({ type }) {
  const label = type || 'Casual Leave (CL)';
  const kind = requestKind(label);
  if (kind === 'leave') return <span>{label}</span>;
  return (
    <span className={`hr-req-type is-${kind}`}>
      {kind === 'wfh' ? <House size={13} /> : <Briefcase size={13} />} {label}
    </span>
  );
}

function LeaveManagementTab({
  user,
  userRole,
  myLeaves,
  setMyLeaves,
  allLeaves,
  setAllLeaves,
  showLeaveModal,
  setShowLeaveModal,
  leaveType,
  setLeaveType,
  leaveFrom,
  setLeaveFrom,
  leaveTo,
  setLeaveTo,
  leaveReason,
  setLeaveReason,
  handleApplyLeave,
  handleLeaveAction,
  leavesLoading = false,
  leavesError = '',
  onRetryLeaves,
  leaveSubmitting = false,
  leaveFormError = '',
  setLeaveFormError,
  mode,                     // 'approvals' | 'mine' (MDDashboard decides from the role and menu)
  scopeLabel = '',
  showCompany = true,
  allLeavesState = { loading: false, error: '' },
  onReloadAll,
  decidingId = null,
}) {

  const normalizedRole = (userRole || '').toUpperCase();
  // MD view: the group-wide list is loaded (and re-loaded per selected company) by MDDashboard.
  // Everyone else: "My requests" comes from GET /api/leaves?mine=1, also loaded by MDDashboard,
  // so it survives a page refresh. Re-check whenever this page is opened.
  const isApprovals = mode ? mode === 'approvals' : normalizedRole === 'MD';
  useEffect(() => {
    if (isApprovals) { if (onReloadAll) onReloadAll(); }
    else if (onRetryLeaves) onRetryLeaves();
  }, [isApprovals]); // eslint-disable-line react-hooks/exhaustive-deps

  // Approvals view: Pending first; decided requests stay reviewable
  const [filter, setFilter] = useState('Pending');
  const [changing, setChanging] = useState(null); // id of a decided row being changed
  const queue = useMemo(() => (allLeaves || []).filter((l) => normalizedRole === 'MD' || !l.isMine), [allLeaves, normalizedRole]);
  const counts = useMemo(() => ({
    Pending: queue.filter((l) => (l.status || 'Pending') === 'Pending').length,
    Decided: queue.filter((l) => (l.status || 'Pending') !== 'Pending').length,
    All: queue.length,
  }), [queue]);
  const shown = queue.filter((l) => filter === 'All' || (filter === 'Pending' ? (l.status || 'Pending') === 'Pending' : (l.status || 'Pending') !== 'Pending'));

  const openForm = () => { if (setLeaveFormError) setLeaveFormError(''); setShowLeaveModal(true); };
  const closeForm = () => { if (setLeaveFormError) setLeaveFormError(''); setShowLeaveModal(false); };

  // Helper function to safely extract and format dates
  const formatDate = (dateVal) => {
    if (!dateVal) return '-';
    if (typeof dateVal === 'string') {
      return dateVal.split('T')[0];
    }
    return dateVal;
  };

  const isMD = normalizedRole === 'MD';
  const canApplyLeave = !isApprovals && !isMD;

  // Visual-only counts for the header
  const rowsInView = (isApprovals ? queue : myLeaves) || [];
  const pendingCount = rowsInView.filter(l => !l.status || l.status === 'Pending').length;
  const colCount = showCompany ? 8 : 7;
  const fmtDecided = (l) => {
    if (!l.decided_by_name) return '';
    const d = String(l.decided_at || '').slice(0, 10);
    return `by ${l.decided_by_name}${d ? ` · ${d}` : ''}`;
  };

  return (
    <div>
      <PageHeader
        title={isApprovals ? 'Leave approvals' : 'Leave & attendance requests'}
        subtitle={isApprovals
          ? (isMD
            ? `Review and decide on leave, On-Duty and Work From Home requests${scopeLabel && scopeLabel !== 'All Companies' ? ` for ${scopeLabel}` : ' from across the group'}.`
            : `Requests from ${scopeLabel || 'your company'}. Your own requests are decided by the MD.`)
          : 'Apply for leave, On-Duty (OD) or Work From Home (WFH) and track the status of your requests.'}
        actions={canApplyLeave && (
          <button type="button" className="hr-btn hr-btn-primary" onClick={openForm}>
            <Plus size={16} /> New request
          </button>
        )}
      />

      <Panel
        flush
        title={isApprovals ? 'Team requests' : 'My requests'}
        actions={isApprovals ? (
          <div className="hr-leave-filters">
            <div className="hr-seg" role="radiogroup" aria-label="Show">
              {['Pending', 'Decided', 'All'].map((f) => (
                <button key={f} type="button" role="radio" aria-checked={filter === f} className={filter === f ? 'is-on' : ''} onClick={() => setFilter(f)}>
                  {f}{counts[f] ? <span className="hr-seg-count">{counts[f]}</span> : null}
                </button>
              ))}
            </div>
            {onReloadAll && (
              <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm hr-btn-icon" onClick={onReloadAll} disabled={allLeavesState.loading} title="Refresh" aria-label="Refresh requests">
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        ) : rowsInView.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <StatusPill tone="neutral" dot={false}>{rowsInView.length} total</StatusPill>
            {pendingCount > 0 && <StatusPill tone="warning">{pendingCount} pending</StatusPill>}
          </div>
        )}
      >
        <div className="hr-table-wrap">
          {!isApprovals ? (
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Reason</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {leavesLoading && (!myLeaves || myLeaves.length === 0) ? (
                  <TableEmpty colSpan={5} icon={<CalendarDays size={20} />} title="Loading your requests" text="Fetching your requests from the server…" />
                ) : leavesError && (!myLeaves || myLeaves.length === 0) ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="hr-form-alert is-error" style={{ margin: 12 }}>
                        <AlertCircle size={16} /> <div>{leavesError}</div>
                        {onRetryLeaves && <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={onRetryLeaves}>Try again</button>}
                      </div>
                    </td>
                  </tr>
                ) : !myLeaves || myLeaves.length === 0 ? (
                  <TableEmpty
                    colSpan={5}
                    icon={<CalendarDays size={20} />}
                    title="No requests yet"
                    text="Leave, On-Duty and Work From Home requests you submit, and their approval status, show up here."
                  />
                ) : (
                  myLeaves.map(l => (
                    <tr key={l.id || l._id}>
                      <td className="is-strong"><TypeCell type={l.type || l.leave_type} /></td>
                      <td className="num">{formatDate(l.start_date || l.from_date || l.fromDate || l.from)}</td>
                      <td className="num">{formatDate(l.end_date || l.to_date || l.toDate || l.to)}</td>
                      <td><div className="hr-truncate" title={l.reason || ''}>{l.reason || '-'}</div></td>
                      <td><StatusPill status={l.status || 'Pending'} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="hr-table hr-table-cards">
              <thead>
                <tr>
                  <th>Employee</th>
                  {showCompany && <th>Company</th>}
                  <th>Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th className="is-actions">Decision</th>
                </tr>
              </thead>
              <tbody>
                {allLeavesState.error && !queue.length ? (
                  <tr>
                    <td colSpan={colCount}>
                      <div className="hr-form-alert is-error" style={{ margin: 12 }}>
                        <AlertCircle size={16} /> <div>{allLeavesState.error}</div>
                        {onReloadAll && <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={onReloadAll}>Try again</button>}
                      </div>
                    </td>
                  </tr>
                ) : allLeavesState.loading && !queue.length ? (
                  <TableEmpty colSpan={colCount} icon={<CalendarDays size={20} />} title="Loading requests" text="Fetching requests from the server…" />
                ) : shown.length === 0 ? (
                  <TableEmpty
                    colSpan={colCount}
                    icon={<CalendarDays size={20} />}
                    title={filter === 'Pending' ? 'Nothing waiting for a decision' : 'No requests here'}
                    text={filter === 'Pending' ? 'New leave, On-Duty and Work From Home requests from your teams will appear here.' : 'Decided requests appear here once you approve or reject them.'}
                  />
                ) : (
                  shown.map(l => {
                    const id = l.id || l._id;
                    const empName = l.employee_name || l.employeeName || `Emp #${l.employee_id}`;
                    const compName = l.companyName || l.company_name || 'Unassigned';
                    const status = l.status || 'Pending';
                    // Server says who may decide; older servers do not send it, so fall back to "pending"
                    const canDecide = l.canDecide !== undefined ? l.canDecide : true;
                    const showButtons = canDecide && (status === 'Pending' || changing === id);
                    const busy = decidingId === id;
                    return (
                      <tr key={id}>
                        <td>
                          <div className="hr-cell-person" style={{ minWidth: 170 }}>
                            <Avatar name={empName} size={30} />
                            <div style={{ minWidth: 0 }}>
                              <span className="hr-cell-person-name">{empName}</span>
                              {l.employee_role && <div className="hr-cell-sub">{l.employee_role}</div>}
                            </div>
                          </div>
                        </td>
                        {showCompany && <td className="is-muted" data-label="Company" style={{ whiteSpace: 'nowrap' }}>{compName}</td>}
                        <td className="is-strong" data-label="Type" style={{ whiteSpace: 'nowrap' }}><TypeCell type={l.type || l.leave_type} /></td>
                        <td className="num" data-label="From">{formatDate(l.start_date || l.from_date || l.fromDate || l.from)}</td>
                        <td className="num" data-label="To">{formatDate(l.end_date || l.to_date || l.toDate || l.to)}</td>
                        <td className="is-muted is-reason" data-label="Reason"><div className="hr-truncate" style={{ maxWidth: 200 }} title={l.reason || ''}>{l.reason || '-'}</div></td>
                        <td data-label="Status">
                          <StatusPill status={status} />
                          {status !== 'Pending' && fmtDecided(l) && <div className="hr-cell-sub">{fmtDecided(l)}</div>}
                        </td>
                        <td className="is-actions" data-label="">
                          {showButtons ? (
                            <div className="hr-row-actions">
                              <button type="button" className="hr-btn hr-btn-success-soft hr-btn-sm" disabled={busy || !!decidingId} aria-label={`Approve request from ${empName}`}
                                onClick={() => { setChanging(null); handleLeaveAction(id, 'Approved'); }}>
                                <Check size={15} /> {busy ? '…' : 'Approve'}
                              </button>
                              <button type="button" className="hr-btn hr-btn-danger-soft hr-btn-sm" disabled={busy || !!decidingId} aria-label={`Reject request from ${empName}`}
                                onClick={() => { setChanging(null); handleLeaveAction(id, 'Rejected'); }}>
                                <X size={15} /> Reject
                              </button>
                              {changing === id && <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => setChanging(null)}>Cancel</button>}
                            </div>
                          ) : canDecide ? (
                            <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => setChanging(id)} aria-label={`Change decision for ${empName}`}>
                              <RotateCcw size={13} /> Change
                            </button>
                          ) : (
                            <span className="hr-cell-sub">{status === 'Pending' ? 'Awaiting MD' : '—'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </Panel>

      {/* Leave Application Form Modal */}
      {showLeaveModal && (
        <Modal
          title={requestKind(leaveType) === 'wfh' ? 'Request Work From Home' : requestKind(leaveType) === 'od' ? 'Request On-Duty' : 'Apply for leave'}
          subtitle={requestKind(leaveType) === 'leave'
            ? 'Your manager will be notified once you submit.'
            : 'Counts as a working day, not leave. Once approved, you can check in from anywhere on those dates.'}
        >
          <form onSubmit={handleApplyLeave}>
            <div className="hr-modal-body">
              {leaveFormError && (
                <div className="hr-form-alert is-error" role="alert" style={{ marginBottom: 0 }}>
                  <AlertCircle size={16} /> <div>{leaveFormError}</div>
                </div>
              )}
              <Field label="Request type">
                <select className="hr-select" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
                  {REQUEST_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </optgroup>
                  ))}
                </select>
              </Field>

              <div className="hr-form-grid">
                <Field label="From">
                  <input className="hr-input" type="date" required value={leaveFrom} onChange={(e) => setLeaveFrom(e.target.value)} />
                </Field>
                <Field label="To">
                  <input className="hr-input" type="date" required min={leaveFrom || undefined} value={leaveTo} onChange={(e) => setLeaveTo(e.target.value)} />
                </Field>
              </div>

              <Field label="Reason">
                <textarea className="hr-textarea" rows="3" required placeholder={REASON_HINT[requestKind(leaveType)]} value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} />
              </Field>
            </div>

            <div className="hr-modal-foot">
              <button type="button" className="hr-btn hr-btn-secondary" onClick={closeForm} disabled={leaveSubmitting}>Cancel</button>
              <button type="submit" className="hr-btn hr-btn-primary" disabled={leaveSubmitting}>{leaveSubmitting ? 'Submitting…' : 'Submit request'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default LeaveManagementTab;
