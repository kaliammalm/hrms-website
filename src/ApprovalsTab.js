import React, { useState, useEffect } from 'react';
import { Check, X, CheckCircle2 } from 'lucide-react';
import { PageHeader, Panel, EmptyState, Avatar, StatusPill } from './ui';

function ApprovalsTab() {
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchApprovals = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('https://hrms-backend-v3.onrender.com/api/approvals', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok && Array.isArray(data)) {
          setApprovals(data);
        } else {
          setApprovals([]);
        }
      } catch (err) {
        console.error('Error fetching approvals:', err);
        setApprovals([]);
      } finally {
        setLoading(false);
      }
    };
    fetchApprovals();
  }, []);

  const handleAction = async (id, action) => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`https://hrms-backend-v3.onrender.com/api/approvals/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: action })
      });
      setApprovals(prev => prev.filter(item => item.id !== id));
    } catch (err) {
      console.error('Error updating approval status:', err);
      setApprovals(prev => prev.filter(item => item.id !== id));
    }
  };

  return (
    <div>
      <PageHeader title="Approvals" subtitle="Expense and other requests waiting for your decision." />
      <Panel
        flush
        title="Pending requests"
        actions={!loading && approvals.length > 0 ? <span className="hr-count">{approvals.length} waiting</span> : null}
      >
        {loading ? (
          <EmptyState title="Loading approvals" text="Fetching pending requests…" />
        ) : approvals.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={20} />} title="You're all caught up" text="There are no requests waiting for approval." />
        ) : (
          <div className="hr-table-wrap">
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Requested by</th>
                  <th>Company</th>
                  <th>Request type</th>
                  <th>Details</th>
                  <th className="is-actions">Decision</th>
                </tr>
              </thead>
              <tbody>
                {approvals.map((item) => (
                  <tr key={item.id || item._id}>
                    <td>
                      <div className="hr-cell-person" style={{ minWidth: 180 }}>
                        <Avatar name={item.employee_name} size={30} />
                        <span className="hr-cell-person-name">{item.employee_name}</span>
                      </div>
                    </td>
                    <td><StatusPill tone="neutral" dot={false}>{item.company_name || 'Ram Reddy Developers'}</StatusPill></td>
                    <td className="is-strong">{item.request_type}</td>
                    <td className="is-muted">{item.details}</td>
                    <td className="is-actions">
                      <div className="hr-row-actions">
                        <button type="button" className="hr-btn hr-btn-success-soft hr-btn-sm" onClick={() => handleAction(item.id || item._id, 'Approved')}>
                          <Check size={14} /> Approve
                        </button>
                        <button type="button" className="hr-btn hr-btn-danger-soft hr-btn-sm" onClick={() => handleAction(item.id || item._id, 'Rejected')}>
                          <X size={14} /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

export default ApprovalsTab;
