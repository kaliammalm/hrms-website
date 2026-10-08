import React, { useState, useEffect } from 'react';

function LeaveRequests({ user, selectedCompany, selectedCompanyId }) {
  const userRole = (user?.role || '').toUpperCase();

  // MD thavira matra ella roles-kum Apply Leave button visible aagum
  const canApplyLeave = userRole !== 'MD';

  // State management for leaves and form inputs
  const [leaves, setLeaves] = useState([]);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [leaveType, setLeaveType] = useState('Casual Leave (CL)');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Get token from localStorage
  const token = localStorage.getItem('token');

  // Fetch Leaves Function
  const fetchLeaves = async () => {
    try {
      let url = 'http://localhost:5000/api/leaves';
      
      if (userRole !== 'MD' && userRole !== 'ADMIN') {
        const compIdQuery = selectedCompanyId || user?.company_id || '';
        if (compIdQuery) {
          url = `http://localhost:5000/api/leaves?companyId=${compIdQuery}`;
        }
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (response.ok) {
        setLeaves(Array.isArray(data) ? data : []);
      } else {
        console.error('Failed to fetch leaves:', data.error);
      }
    } catch (err) {
      console.error('Error fetching leaves:', err);
    }
  };

  useEffect(() => {
    fetchLeaves();
  }, [selectedCompanyId, userRole]);

  // Handle Leave Form Submit
  const handleApplyLeave = async (e) => {
    e.preventDefault();

    if (!fromDate || !toDate || !reason) {
      alert('Ella fields-um fill pannunga!');
      return;
    }

    try {
      setSubmitting(true);
      const response = await fetch('http://localhost:5000/api/leaves', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          company_id: selectedCompanyId || user?.company_id,
          from_date: fromDate,
          to_date: toDate,
          start_date: fromDate,
          end_date: toDate,
          leave_type: leaveType,
          type: leaveType,
          reason: reason
        })
      });

      const data = await response.json();

      if (response.ok) {
        alert('Leave application submitted successfully!');
        setShowApplyModal(false);
        // Reset Form Fields
        setFromDate('');
        setToDate('');
        setReason('');
        setLeaveType('Casual Leave (CL)');
        fetchLeaves();
      } else {
        alert(data.error || 'Failed to submit leave application.');
      }
    } catch (err) {
      console.error('Error applying leave:', err);
      alert('Network error while submitting leave.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Header Info Banner */}
      <div style={{ background: '#fff', padding: '16px 20px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#1e293b', fontWeight: 'bold' }}>Leave Requests</h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
            Portal View for <strong style={{ color: '#3b82f6' }}>{userRole === 'MD' || userRole === 'ADMIN' ? 'All Companies (MD View)' : selectedCompany}</strong>
          </p>
        </div>
        <div style={{ background: '#f1f5f9', padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', color: '#334155' }}>
          Role: {userRole}
        </div>
      </div>

      {/* Leave Requests Table Card */}
      <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '15px', color: '#1e293b', fontWeight: 'bold' }}>
            Leave Applications List
          </h3>
          
          {/* MD thavira matra ellarukum Apply Leave Button */}
          {canApplyLeave && (
            <button 
              onClick={() => setShowApplyModal(true)}
              style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
            >
              + Apply Leave
            </button>
          )}
        </div>

        {/* Dynamic Table Rendering */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', fontSize: '12px', color: '#64748b' }}>
                <th style={{ padding: '12px 8px' }}>Employee Name</th>
                <th style={{ padding: '12px 8px' }}>Company</th>
                <th style={{ padding: '12px 8px' }}>Leave Type</th>
                <th style={{ padding: '12px 8px' }}>From</th>
                <th style={{ padding: '12px 8px' }}>To</th>
                <th style={{ padding: '12px 8px' }}>Reason</th>
                <th style={{ padding: '12px 8px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {leaves.length > 0 ? (
                leaves.map((leave, index) => {
                  const displayName = leave.employee_name || leave.employeeName || leave.name || (leave.employee_id ? `Employee #${leave.employee_id}` : 'Unknown Employee');
                  const displayCompany = leave.company_name || leave.companyName || selectedCompany || 'Fractio Hospitality';
                  const displayType = leave.leaveType || leave.type || leave.leave_type || 'Casual Leave (CL)';
                  const displayFrom = leave.fromDate || leave.from || leave.from_date || leave.start_date || '-';
                  const displayTo = leave.toDate || leave.to || leave.to_date || leave.end_date || '-';
                  const displayReason = leave.reason || 'N/A';
                  const displayStatus = leave.status || 'Pending';

                  return (
                    <tr key={leave.id || index} style={{ borderBottom: '1px solid #f1f5f9', fontSize: '13px', color: '#334155' }}>
                      <td style={{ padding: '12px 8px', fontWeight: '600' }}>{displayName}</td>
                      <td style={{ padding: '12px 8px' }}>{displayCompany}</td>
                      <td style={{ padding: '12px 8px' }}>{displayType}</td>
                      <td style={{ padding: '12px 8px' }}>{displayFrom}</td>
                      <td style={{ padding: '12px 8px' }}>{displayTo}</td>
                      <td style={{ padding: '12px 8px', color: '#64748b' }}>{displayReason}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <span style={{ 
                          padding: '4px 8px', 
                          borderRadius: '4px', 
                          fontSize: '11px', 
                          fontWeight: '600',
                          background: displayStatus === 'Approved' ? '#dcfce7' : displayStatus === 'Rejected' ? '#fee2e2' : '#fef9c3',
                          color: displayStatus === 'Approved' ? '#166534' : displayStatus === 'Rejected' ? '#991b1b' : '#854d0e'
                        }}>
                          {displayStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>
                    No leave requests found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Apply Leave Modal Form View */}
      {showApplyModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', width: '450px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#1e293b', fontWeight: 'bold' }}>📝 New Leave Application</h3>
            <form onSubmit={handleApplyLeave}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>Leave Type</label>
                <select 
                  value={leaveType} 
                  onChange={(e) => setLeaveType(e.target.value)} 
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px', outline: 'none' }}
                >
                  <option value="Casual Leave (CL)">Casual Leave (CL)</option>
                  <option value="Sick Leave">Sick Leave</option>
                  <option value="Emergency Leave">Emergency Leave</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>From Date</label>
                  <input type="date" required value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>To Date</label>
                  <input type="date" required value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>

              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>Reason</label>
                <textarea 
                  rows="3" 
                  required 
                  placeholder="Leave apply panna kaaranam eluthunga..." 
                  value={reason} 
                  onChange={(e) => setReason(e.target.value)} 
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px', outline: 'none', resize: 'none', boxSizing: 'border-box' }} 
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" onClick={() => setShowApplyModal(false)} style={{ background: '#e2e8f0', color: '#334155', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>Cancel</button>
                <button type="submit" disabled={submitting} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default LeaveRequests;