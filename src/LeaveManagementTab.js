import React, { useEffect } from 'react';
import { Plus, Check, X, CalendarDays, AlertCircle, Briefcase, House } from 'lucide-react';
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
  setLeaveFormError
}) {

  const normalizedRole = (userRole || '').toUpperCase();
  // MD view: the group-wide list is loaded (and re-loaded per selected company) by MDDashboard.
  // Everyone else: "My requests" comes from GET /api/leaves?mine=1, also loaded by MDDashboard,
  // so it survives a page refresh. Re-check whenever this page is opened.
  useEffect(() => {
    if (normalizedRole !== 'MD' && onRetryLeaves) onRetryLeaves();
  }, [normalizedRole]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const canApplyLeave = !isMD;

  // Visual-only counts for the header
  const rowsInView = (isMD ? allLeaves : myLeaves) || [];
  const pendingCount = rowsInView.filter(l => !l.status || l.status === 'Pending').length;

  return (
    <div>
      <PageHeader
        title={isMD ? 'Leave approvals' : 'Leave & attendance requests'}
        subtitle={isMD ? 'Review and decide on leave, On-Duty and Work From Home requests from across the group.' : 'Apply for leave, On-Duty (OD) or Work From Home (WFH) and track the status of your requests.'}
        actions={canApplyLeave && (
          <button type="button" className="hr-btn hr-btn-primary" onClick={openForm}>
            <Plus size={16} /> New request
          </button>
        )}
      />

      <Panel
        flush
        title={isMD ? 'Team requests' : 'My requests'}
        actions={rowsInView.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <StatusPill tone="neutral" dot={false}>{rowsInView.length} total</StatusPill>
            {pendingCount > 0 && <StatusPill tone="warning">{pendingCount} pending</StatusPill>}
          </div>
        )}
      >
        <div className="hr-table-wrap">
          {!isMD ? (
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
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Company</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th className="is-actions">Decision</th>
                </tr>
              </thead>
              <tbody>
                {!allLeaves || allLeaves.length === 0 ? (
                  <TableEmpty
                    colSpan={8}
                    icon={<CalendarDays size={20} />}
                    title="No leave requests to review"
                    text="New requests from your teams will appear here."
                  />
                ) : (
                  allLeaves.map(l => {
                    const empName = l.employee_name || l.employeeName || `Emp #${l.employee_id}`;
                    const compName = l.companyName || l.company_name || 'Fractio Hospitality';
                    return (
                      <tr key={l.id || l._id}>
                        <td>
                          <div className="hr-cell-person" style={{ minWidth: 170 }}>
                            <Avatar name={empName} size={30} />
                            <span className="hr-cell-person-name">{empName}</span>
                          </div>
                        </td>
                        <td className="is-muted" style={{ whiteSpace: 'nowrap' }}>{compName}</td>
                        <td className="is-strong" style={{ whiteSpace: 'nowrap' }}><TypeCell type={l.type || l.leave_type} /></td>
                        <td className="num">{formatDate(l.start_date || l.from_date || l.fromDate || l.from)}</td>
                        <td className="num">{formatDate(l.end_date || l.to_date || l.toDate || l.to)}</td>
                        <td className="is-muted"><div className="hr-truncate" style={{ maxWidth: 160 }} title={l.reason || ''}>{l.reason || '-'}</div></td>
                        <td><StatusPill status={l.status || 'Pending'} /></td>
                        <td className="is-actions">
                          <div className="hr-row-actions">
                            <button type="button" className="hr-btn hr-btn-success-soft hr-btn-sm hr-btn-icon" title="Approve" aria-label={`Approve leave for ${empName}`} onClick={() => handleLeaveAction(l.id || l._id, 'Approved')}>
                              <Check size={15} />
                            </button>
                            <button type="button" className="hr-btn hr-btn-danger-soft hr-btn-sm hr-btn-icon" title="Reject" aria-label={`Reject leave for ${empName}`} onClick={() => handleLeaveAction(l.id || l._id, 'Rejected')}>
                              <X size={15} />
                            </button>
                          </div>
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
