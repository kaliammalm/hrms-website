import React, { useState, useEffect } from 'react';

function CEODashboard({ user, onLogout }) {
  const companyName = user?.companyName || user?.company_name || 'Ram Reddy Developers';
  const companyId = user?.companyId || user?.company_id || 1;

  const [stats, setStats] = useState({
    totalEmployees: 0,
    newJoiners: 0,
    onLeave: 0,
    presentToday: 0,
    attendanceRate: '0%'
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardStats = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`http://localhost:5000/api/dashboard/stats?companyId=${companyId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          setStats({
            totalEmployees: data.totalEmployees || 0,
            newJoiners: data.newJoiners || 0,
            onLeave: data.onLeave || 0,
            presentToday: data.presentToday || 0,
            attendanceRate: data.attendanceRate || '0%'
          });
        }
      } catch (error) {
        console.error('Failed to fetch CEO dashboard stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardStats();
  }, [companyId]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
      
      {/* Sidebar - CEO Specific */}
      <div style={{ width: '250px', background: '#0b132b', color: '#fff', display: 'flex', flexDirection: 'column', paddingBottom: '20px' }}>
        <div style={{ padding: '22px 20px', fontSize: '18px', fontWeight: 'bold', borderBottom: '1px solid #1c2541' }}>
          <div style={{ fontSize: '16px', fontWeight: '800' }}>{companyName}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'normal' }}>CEO Portal</div>
        </div>

        <div style={{ padding: '12px 20px', background: '#1d2a4a', color: '#fff', margin: '10px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', borderLeft: '4px solid #3b82f6' }}>📊 Dashboard</div>
        <div style={{ padding: '12px 20px', color: '#94a3b8', fontSize: '13px', cursor: 'pointer' }}>👥 Employees</div>
        <div style={{ padding: '12px 20px', color: '#94a3b8', fontSize: '13px', cursor: 'pointer' }}>📅 Attendance</div>
        <div style={{ padding: '12px 20px', color: '#94a3b8', fontSize: '13px', cursor: 'pointer' }}>🏖️ Leave Management</div>
        <div style={{ padding: '12px 20px', color: '#94a3b8', fontSize: '13px', cursor: 'pointer' }}>💰 Payroll Approval</div>
        <div style={{ padding: '12px 20px', color: '#94a3b8', fontSize: '13px', cursor: 'pointer' }}>⭐ Performance</div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowX: 'hidden' }}>
        
        {/* Top Navbar */}
        <div style={{ background: '#fff', padding: '12px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#1e293b' }}>
            🏢 {companyName} - Executive Dashboard
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ background: '#3b82f6', color: '#fff', width: '34px', height: '34px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '12px' }}>CEO</div>
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#1e293b' }}>{user?.name || 'Mr. CEO'}</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Chief Executive Officer</div>
              </div>
            </div>
            <button onClick={onLogout} style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>Logout</button>
          </div>
        </div>

        {/* Dashboard Body */}
        <div style={{ padding: '25px 30px', overflowY: 'auto' }}>
          <div style={{ marginBottom: '22px' }}>
            <h1 style={{ fontSize: '22px', color: '#1e293b', margin: '0 0 4px 0', fontWeight: 'bold' }}>Welcome, {user?.name || 'CEO'}! 👋</h1>
            <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>Here is the performance and metrics summary exclusively managed for {companyName}.</p>
          </div>

          {/* Metrics Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '15px', marginBottom: '24px' }}>
            <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>Total Employees</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e293b', marginTop: '10px' }}>{loading ? '...' : stats.totalEmployees}</div>
            </div>
            <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>New Joiners</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e293b', marginTop: '10px' }}>{loading ? '...' : stats.newJoiners}</div>
            </div>
            <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>On Leave Today</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e293b', marginTop: '10px' }}>{loading ? '...' : stats.onLeave}</div>
            </div>
            <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>Present Today</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e293b', marginTop: '10px' }}>{loading ? '...' : stats.presentToday}</div>
            </div>
            <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>Attendance Rate</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e293b', marginTop: '10px' }}>{loading ? '...' : stats.attendanceRate}</div>
            </div>
          </div>

          <div style={{ background: '#fff', padding: '25px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#1e293b', fontSize: '16px' }}>Company Activity & Approvals</h3>
            <p style={{ color: '#64748b', fontSize: '13px' }}>Manage pending employee leave requests, payroll clearance, and view local department reports here for {companyName}.</p>
          </div>

        </div>
      </div>
    </div>
  );
}

export default CEODashboard;