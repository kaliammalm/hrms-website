import React, { useEffect } from 'react';
import { Plus, Check, X, CalendarDays, AlertCircle } from 'lucide-react';
import { PageHeader, Panel, StatusPill, Avatar, TableEmpty, Modal, Field } from './ui';

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
        title={isMD ? 'Leave approvals' : 'Leave requests'}
        subtitle={isMD ? 'Review and decide on leave requests from across the group.' : 'Apply for leave and track the status of your requests.'}
        actions={canApplyLeave && (
          <button type="button" className="hr-btn hr-btn-primary" onClick={openForm}>
            <Plus size={16} /> Apply for leave
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
                  <TableEmpty colSpan={5} icon={<CalendarDays size={20} />} title="Loading your leave requests" text="Fetching your requests from the server…" />
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
                    title="No leave requests yet"
                    text="When you apply for leave, your requests and their approval status show up here."
                  />
                ) : (
                  myLeaves.map(l => (
                    <tr key={l.id || l._id}>
                      <td className="is-strong">{l.type || l.leave_type || 'Casual Leave (CL)'}</td>
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
                        <td className="is-strong" style={{ whiteSpace: 'nowrap' }}>{l.type || l.leave_type || 'Casual Leave (CL)'}</td>
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
        <Modal title="Apply for leave" subtitle="Your manager will be notified once you submit.">
          <form onSubmit={handleApplyLeave}>
            <div className="hr-modal-body">
              {leaveFormError && (
                <div className="hr-form-alert is-error" role="alert" style={{ marginBottom: 0 }}>
                  <AlertCircle size={16} /> <div>{leaveFormError}</div>
                </div>
              )}
              <Field label="Leave type">
                <select className="hr-select" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
                  <option value="Casual Leave (CL)">Casual Leave (CL)</option>
                  <option value="Sick Leave">Sick Leave</option>
                  <option value="Emergency Leave">Emergency Leave</option>
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
                <textarea className="hr-textarea" rows="3" required placeholder="Briefly explain why you need this leave" value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} />
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
