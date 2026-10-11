import React, { useState, useEffect, useCallback } from 'react';
import { 
  LayoutDashboard, 
  Building2, 
  Users, 
  CalendarCheck, 
  CalendarDays, 
  Wallet, 
  UserPlus, 
  TrendingUp, 
  CheckCircle, 
  Settings as SettingsIcon, 
  FileSpreadsheet,
} from 'lucide-react';
import Settings from './Settings';
import CompanyDashboard from './CompanyDashboard';
import Sidebar from './Sidebar';
import Header from './Header';
import DashboardTab from './DashboardTab';
import CompaniesTab from './CompaniesTab';
import EmployeesTab from './EmployeesTab';
import AttendanceTab from './AttendanceTab';
import LeaveManagementTab from './LeaveManagementTab';
import PayrollTab from './PayrollTab';
import RecruitmentTab from './RecruitmentTab';
import PerformanceTab from './PerformanceTab';
import ReportsTab from './ReportsTab';
import ApprovalsTab from './ApprovalsTab';
import Payslips from './Payslip';
import Celebrations from './Celebrations';
import FieldVisits, { FieldTodayCard } from './field/FieldVisits';
import FieldTracking from './field/FieldTracking';
import { getCompanyBrand } from './brand';
import { getEffectiveRole, getRoleLabel, canAccessMenu } from './access';
import { Panel, EmptyState, Restricted, PageHeader } from './ui';
import { API_BASE } from './config';

const COMPANIES_LIST = [
  { id: 1, name: 'Ram Reddy Developers', code: 'RRD', tag: 'INFRA', description: 'Real estate development and construction infrastructure.', color: '#2563eb', logoBg: '#eff6ff' },
  { id: 2, name: 'Fractio Hospitality', code: 'FH', tag: 'HOSPITALITY', description: 'Hospitality management, hotels, and fine dining services.', color: '#ca8a04', logoBg: '#fefce8' },
  { id: 3, name: 'Stories by Varnam', code: 'SBV', tag: 'STUDIO', description: 'Creative design studio, branding, and digital media content.', color: '#16a34a', logoBg: '#f0fdf4' }
];

function MDDashboard({ user, onLogout }) {
  // 'MD' for anyone with group access (MD account, Vasumathi); otherwise their own role
  const userRole = getEffectiveRole(user);
  const userCompanyId = user?.company_id || user?.companyId || 3;
  const employeeId = user?.id || 1;

  const isAuthorizedForEmployees = ['CEO', 'HR', 'ADMIN', 'MD'].includes(userRole);
  // Field / multi-site staff (set by the field attendance migration)
  const isFieldUser = String(user?.attendance_mode || '').toUpperCase() === 'FIELD' && !isAuthorizedForEmployees;

  const getCompanyNameById = (id) => {
    switch (Number(id)) {
      case 1: return 'Ram Reddy Developers';
      case 2: return 'Fractio Hospitality';
      case 3: return 'Stories by Varnam';
      default: return 'Stories by Varnam';
    }
  };

  const [selectedCompany, setSelectedCompany] = useState(() => {
    const savedCompany = localStorage.getItem('hrms_selected_company');
    if (userRole === 'CEO') return getCompanyNameById(userCompanyId);
    if (savedCompany && savedCompany !== 'All Companies') return savedCompany;
    if (userRole === 'MD') return 'All Companies';
    return getCompanyNameById(userCompanyId);
  });

  const selectedCompanyName = typeof selectedCompany === 'object' ? selectedCompany?.name : selectedCompany;

  // FIXED: Prevent regular employees from getting stuck on cached admin menus like Payroll/Payslips
  const [activeMenu, setActiveMenu] = useState(() => {
    const savedMenu = localStorage.getItem('hrms_active_menu');
    
    if (['EMPLOYEE', 'SITE_ENGINEER', 'SALES EXECUTIVE', 'ACCOUNTANT'].includes(userRole)) {
      return 'Dashboard';
    }

    if (savedMenu === 'Payslips' && ['MD', 'CEO', 'HR', 'ADMIN'].includes(userRole)) {
      return 'Dashboard';
    }
    if (savedMenu === 'Employees Management' || savedMenu === 'Employees') {
      return isAuthorizedForEmployees ? 'Employees' : 'Dashboard';
    }
    return savedMenu || 'Dashboard';
  });

  useEffect(() => {
    if (!isAuthorizedForEmployees && (activeMenu === 'Employees Management' || activeMenu === 'Employees')) {
      setActiveMenu('Dashboard');
      localStorage.setItem('hrms_active_menu', 'Dashboard');
    }
  }, [isAuthorizedForEmployees, activeMenu]);

  const [activeSettingsTab, setActiveSettingsTab] = useState(() => localStorage.getItem('hrms_active_settings_tab') || 'Profile Settings');

  useEffect(() => {
    localStorage.setItem('hrms_active_settings_tab', activeSettingsTab);
  }, [activeSettingsTab]);

  const [activeCompanyDashboard, setActiveCompanyDashboard] = useState(() => {
    const savedCompany = localStorage.getItem('hrms_selected_company');
    if (savedCompany && savedCompany !== 'All Companies') {
      return COMPANIES_LIST.find(c => c.name === savedCompany) || null;
    }
    return null;
  });

  const [previousCompanyContext, setPreviousCompanyContext] = useState(null);
  // UI-only: tablet/mobile navigation drawer
  const [navOpen, setNavOpen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveType, setLeaveType] = useState('Casual Leave (CL)');
  const [leaveFrom, setLeaveFrom] = useState('');
  const [leaveTo, setLeaveTo] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [myLeaves, setMyLeaves] = useState([]);
  const [leavesLoading, setLeavesLoading] = useState(true);
  const [leavesError, setLeavesError] = useState('');
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveFormError, setLeaveFormError] = useState('');
  const [allLeaves, setAllLeaves] = useState([]);

  const [stats, setStats] = useState({
    totalCompanies: 3,
    totalEmployees: 0,
    newJoiners: 0,
    onLeave: 0,
    presentToday: 0,
    attendanceRate: '0%'
  });

  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const companies = userRole === 'CEO' 
    ? COMPANIES_LIST.filter(c => c.id === Number(userCompanyId)) 
    : COMPANIES_LIST;

  useEffect(() => {
    if (userRole === 'CEO') {
      setSelectedCompany(getCompanyNameById(userCompanyId));
    }
  }, [userRole, userCompanyId]);

  useEffect(() => {
    if (selectedCompanyName) {
      localStorage.setItem('hrms_selected_company', selectedCompanyName);
    }
  }, [selectedCompanyName]);

  const handleHeaderCompanyChange = (companyName) => {
    if (userRole === 'CEO') return;
    setSelectedCompany(companyName);

    if (companyName === 'All Companies') {
      setActiveCompanyDashboard(null);
    } else {
      const foundComp = COMPANIES_LIST.find(c => c.name === companyName);
      if (foundComp) setActiveCompanyDashboard(foundComp);
    }
  };

  const handleMenuChange = (menu) => {
    let mappedMenu = menu;
    if (menu === 'Employees Management') mappedMenu = 'Employees';
    if (menu === 'Leave Approvals') mappedMenu = 'Leave Management';
    if (menu === 'Reports & Analytics') mappedMenu = 'Reports';
    if (menu === 'Payroll & Slips') mappedMenu = 'Payroll';

    if (mappedMenu === 'Employees' && !isAuthorizedForEmployees) {
      alert('Access Denied: You do not have permission to view Employees Directory.');
      return;
    }

    if (userRole === 'CEO' && mappedMenu === 'Companies') {
      mappedMenu = 'Dashboard';
    }
    
    localStorage.setItem('hrms_active_menu', mappedMenu);
    setSelectedEmployeeId(null); 
    setActiveMenu(mappedMenu);
  };

  const handleBackToGroupOverview = () => {
    setSelectedEmployeeId(null);
    if (previousCompanyContext) {
      setActiveCompanyDashboard(previousCompanyContext);
      setSelectedCompany(previousCompanyContext.name);
      localStorage.setItem('hrms_selected_company', previousCompanyContext.name);
      setActiveMenu('Dashboard');
      setPreviousCompanyContext(null);
    } else {
      setActiveMenu('Dashboard');
      setActiveCompanyDashboard(null);
      setSelectedCompany('All Companies');
      localStorage.setItem('hrms_selected_company', 'All Companies');
    }
  };

  const getSelectedCompanyId = useCallback(() => {
    const found = COMPANIES_LIST.find(c => c.name === selectedCompanyName);
    return found ? found.id : (userRole === 'CEO' ? userCompanyId : 'all');
  }, [selectedCompanyName, userRole, userCompanyId]);

  useEffect(() => {
    let isMounted = true;
    const fetchAttendanceAndLeaves = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      const compIdParam = selectedCompanyName === 'All Companies' ? 'all' : getSelectedCompanyId();

      try {
        const attRes = await fetch(`${API_BASE}/api/attendance?companyId=${compIdParam}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const attData = await attRes.json();
        if (isMounted && Array.isArray(attData)) {
          setAttendanceRecords(attData);
        }

        if (['HR', 'MD', 'CEO', 'ADMIN'].includes(userRole)) {
          const leaveRes = await fetch(`${API_BASE}/api/leaves?companyId=${compIdParam}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const leaveData = await leaveRes.json();
          if (isMounted && Array.isArray(leaveData)) {
            setAllLeaves(leaveData);
          }
        }
      } catch (err) {
        console.log('Attendance/Leaves fetch error:', err);
      }
    };

    fetchAttendanceAndLeaves();

    return () => {
      isMounted = false;
    };
  }, [selectedCompanyName, userRole, getSelectedCompanyId]);

  useEffect(() => {
    let isMounted = true;
    const fetchStats = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      const compIdParam = selectedCompanyName === 'All Companies' ? '' : getSelectedCompanyId();
      const statsUrl = compIdParam ? `${API_BASE}/api/dashboard/stats?companyId=${compIdParam}` : `${API_BASE}/api/dashboard/stats`;

      try {
        const res = await fetch(statsUrl, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (isMounted && data) {
          setStats({
            totalCompanies: data.totalCompanies || 3,
            totalEmployees: data.totalEmployees || 0,
            newJoiners: data.newJoiners || 0,
            onLeave: data.onLeave || 0,
            presentToday: data.presentToday || 0,
            monthlyPayroll: data.monthlyPayroll || 0,
            attendanceRate: data.attendanceRate || '0%'
          });
        }
      } catch (err) {
        console.log('Stats fetch error:', err);
      }
    };

    fetchStats();

    return () => {
      isMounted = false;
    };
  }, [selectedCompanyName, getSelectedCompanyId]);

  const sendAttendanceRequest = async (companyId, role, latitude, longitude, accuracy = null) => {
    try {
      const token = localStorage.getItem('token');
      if (!token || token === "undefined" || token === "null") {
        alert("⚠️ Error: Token missing in browser! Please logout and log back in.");
        return;
      }
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

      const response = await fetch(`${API_BASE}/api/attendance/mark`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ company_id: companyId, latitude, longitude, accuracy, check_in: timeStr, site_name: 'Project Site' })
      });

      const data = await response.json();
      if (!response.ok) {
        alert(data.error || data.message || 'Geofencing Failed: You are outside the allowed site radius!');
      } else {
        alert(data.message || 'Attendance marked successfully!');
        window.location.reload();
      }
    } catch (err) {
      console.error('API Error:', err);
      alert('Server connection failed while marking attendance.');
    }
  };

  const handleCheckIn = async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const alreadyCheckedIn = attendanceRecords.some(r => {
      const recordDate = r.date ? r.date.split('T')[0] : '';
      return recordDate === todayStr && (r.employee_id === employeeId || r.employeeId === employeeId);
    });

    if (alreadyCheckedIn) {
      alert('Already checked in for today!');
      return;
    }

    // Only the MD (and group-access leadership, who sign in as MD) skip the location check; CEOs check in at a site
    if (userRole === 'MD') {
      await sendAttendanceRequest(userCompanyId, userRole, null, null);
      return;
    }

    // Approved On-Duty / Work From Home today: no site location needed (the server checks the approval)
    const localToday = new Date().toLocaleDateString('en-CA');
    const remoteToday = (myLeaves || []).some((l) => {
      const t = String(l.leave_type || l.type || '').toUpperCase();
      const isRemote = /\bWFH\b|WORK\s*FROM\s*HOME|\bOD\b|ON[\s-]*DUTY/.test(t);
      const from = String(l.from_date || l.fromDate || '').slice(0, 10);
      const to = String(l.to_date || l.toDate || '').slice(0, 10);
      return isRemote && l.status === 'Approved' && from <= localToday && localToday <= to;
    });
    if (remoteToday) {
      await sendAttendanceRequest(userCompanyId, userRole, null, null);
      return;
    }

    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        await sendAttendanceRequest(userCompanyId, userRole, position.coords.latitude, position.coords.longitude, position.coords.accuracy);
      },
      () => { alert('GPS Error: Please enable location permission in your browser to check-in.'); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const handleCheckOut = (id) => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const token = localStorage.getItem('token');

    fetch(`${API_BASE}/api/attendance/checkout/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ checkOut: timeStr })
    })
      .then(res => res.json())
      .then(() => {
        setAttendanceRecords(attendanceRecords.map(rec => (rec.id === id || rec._id === id) ? { ...rec, checkOut: timeStr, check_out: timeStr, status: 'Checked Out' } : rec));
      })
      .catch(err => console.log(err));
  };

  // The signed-in user's own leave requests, always read back from the database
  const loadMyLeaves = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLeavesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/leaves?mine=1`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data)) {
        setMyLeaves(data);
        setLeavesError('');
      } else {
        setLeavesError((data && data.error) || 'Your leave requests could not be loaded.');
      }
    } catch (err) {
      setLeavesError('The server could not be reached, so your leave requests could not be loaded.');
    } finally {
      setLeavesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userRole !== 'MD') loadMyLeaves();
    else setLeavesLoading(false);
  }, [userRole, loadMyLeaves]);

  const handleApplyLeave = async (e) => {
    e.preventDefault();
    if (leaveSubmitting) return;
    if (leaveFrom && leaveTo && leaveTo < leaveFrom) {
      setLeaveFormError('The end date cannot be before the start date.');
      return;
    }
    const token = localStorage.getItem('token');
    setLeaveSubmitting(true);
    setLeaveFormError('');
    try {
      const res = await fetch(`${API_BASE}/api/leaves`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ leave_type: leaveType, from_date: leaveFrom, to_date: leaveTo, reason: leaveReason })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Nothing was stored: keep the form open with the reason instead of showing a fake entry
        setLeaveFormError(`${data.error || `Your request could not be saved (error ${res.status}).`}${data.details ? ` (${data.details})` : ''}`);
        return;
      }
      if (data.leave) setMyLeaves(prev => [data.leave, ...prev.filter(l => l.id !== data.leave.id)]);
      setShowLeaveModal(false);
      setLeaveFrom(''); setLeaveTo(''); setLeaveReason('');
      loadMyLeaves(); // re-sync with the database
    } catch (err) {
      setLeaveFormError('The server could not be reached, so your request was not saved. Please try again.');
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const handleLeaveAction = async (leaveId, newStatus) => {
    const token = localStorage.getItem('token');
    const previous = allLeaves;
    setAllLeaves(list => list.map(l => l.id === leaveId ? { ...l, status: newStatus } : l));
    try {
      const res = await fetch(`${API_BASE}/api/leaves/${leaveId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAllLeaves(previous);
        alert(data.error || 'The decision could not be saved. Please try again.');
      }
    } catch (err) {
      setAllLeaves(previous);
      alert('The server could not be reached, so the decision was not saved.');
    }
  };

  const getMenuItems = () => {
    if (['EMPLOYEE', 'SITE_ENGINEER', 'SALES EXECUTIVE', 'ACCOUNTANT'].includes(userRole)) {
      return [
        { name: 'Dashboard', icon: <LayoutDashboard size={18} /> },
        { name: 'My Attendance', icon: <CalendarCheck size={18} /> },
        { name: 'Leave Requests', icon: <CalendarDays size={18} /> },
        { name: 'Payslips', icon: <Wallet size={18} /> },
        { name: 'Settings', icon: <SettingsIcon size={18} /> }
      ];
    } else if (userRole === 'HR') {
      return [
        { name: 'Dashboard', icon: <LayoutDashboard size={18} /> },
        { name: 'Employees Management', icon: <Users size={18} /> },
        { name: 'Attendance', icon: <CalendarCheck size={18} /> },
        { name: 'Leave Approvals', icon: <CalendarDays size={18} /> },
        { name: 'Payroll & Slips', icon: <Wallet size={18} /> },
        { name: 'Settings', icon: <SettingsIcon size={18} /> }
      ];
    } else if (userRole === 'CEO') {
      return [
        { name: 'Dashboard', icon: <LayoutDashboard size={18} /> },
        { name: 'Employees Management', icon: <Users size={18} /> },
        { name: 'Attendance', icon: <CalendarCheck size={18} /> },
        { name: 'Leave Approvals', icon: <CalendarDays size={18} /> },
        { name: 'Payroll & Slips', icon: <Wallet size={18} /> },
        { name: 'Recruitment', icon: <UserPlus size={18} /> },
        { name: 'Performance', icon: <TrendingUp size={18} /> },
        { name: 'Reports & Analytics', icon: <FileSpreadsheet size={18} /> },
        { name: 'Approvals', icon: <CheckCircle size={18} /> },
        { name: 'Settings', icon: <SettingsIcon size={18} /> }
      ];
    } else {
      return [
        { name: 'Dashboard', icon: <LayoutDashboard size={18} /> },
        { name: 'Companies', icon: <Building2 size={18} /> },
        { name: 'Employees Management', icon: <Users size={18} /> },
        { name: 'Attendance', icon: <CalendarCheck size={18} /> },
        { name: 'Leave Approvals', icon: <CalendarDays size={18} /> },
        { name: 'Payroll & Slips', icon: <Wallet size={18} /> },
        { name: 'Recruitment', icon: <UserPlus size={18} /> },
        { name: 'Performance', icon: <TrendingUp size={18} /> },
        { name: 'Reports & Analytics', icon: <FileSpreadsheet size={18} /> },
        { name: 'Approvals', icon: <CheckCircle size={18} /> },
        { name: 'Settings', icon: <SettingsIcon size={18} /> }
      ];
    }
  };

  const menuItems = getMenuItems();

  const renderMainContent = () => {
    // Route guard: every screen is checked against the role's allowed screens (see access.js),
    // so a saved menu, an old link or a notification can never open a screen the role may not use.
    if (!canAccessMenu(userRole, activeMenu)) {
      return (
        <div>
          <Restricted
            title="Access restricted"
            text="This section isn't available for your role. Contact your administrator if you need access."
          />
          <button type="button" className="hr-btn hr-btn-secondary" style={{ marginTop: 12 }} onClick={() => handleMenuChange('Dashboard')}>
            Go to dashboard
          </button>
        </div>
      );
    }

    if (activeMenu === 'Dashboard' && activeCompanyDashboard) {
      return (
        <CompanyDashboard
          company={activeCompanyDashboard}
          userRole={userRole}
          onBack={() => {
            setActiveCompanyDashboard(null);
            setPreviousCompanyContext(null);
            setSelectedCompany('All Companies');
            localStorage.setItem('hrms_selected_company', 'All Companies');
          }}
          onViewEmployees={() => {
            if (!isAuthorizedForEmployees) return;
            setPreviousCompanyContext(activeCompanyDashboard);
            setSelectedCompany(activeCompanyDashboard.name);
            localStorage.setItem('hrms_selected_company', activeCompanyDashboard.name);
            setActiveCompanyDashboard(null);
            handleMenuChange('Employees');
          }}
          onViewAttendance={() => {
            setPreviousCompanyContext(activeCompanyDashboard);
            setSelectedCompany(activeCompanyDashboard.name);
            localStorage.setItem('hrms_selected_company', activeCompanyDashboard.name);
            setActiveCompanyDashboard(null);
            handleMenuChange('Attendance');
          }}
          onViewPayroll={() => {
            setPreviousCompanyContext(activeCompanyDashboard);
            setSelectedCompany(activeCompanyDashboard.name);
            localStorage.setItem('hrms_selected_company', activeCompanyDashboard.name);
            setActiveCompanyDashboard(null);
            handleMenuChange('Payroll');
          }}
        />
      );
    }

    switch (activeMenu) {
      case 'Dashboard':
        return (
          <div className="hr-dash">
            {isFieldUser && <FieldTodayCard onOpen={() => handleMenuChange('Field Visits')} />}
            <DashboardTab
              userRole={userRole}
              stats={stats}
              selectedCompany={selectedCompanyName}
              setSelectedCompany={userRole === 'CEO' ? () => {} : handleHeaderCompanyChange}
              companies={companies}
              setActiveCompanyDashboard={setActiveCompanyDashboard}
              user={user}
            />
            <Celebrations companyId={selectedCompanyName === 'All Companies' ? 'all' : getSelectedCompanyId()} />
          </div>
        );

      case 'Companies':
        if (userRole === 'CEO') return null;
        return (
          <CompaniesTab
            companies={companies}
            setSelectedCompany={handleHeaderCompanyChange}
            setActiveCompanyDashboard={setActiveCompanyDashboard}
            setActiveMenu={handleMenuChange}
          />
        );

      case 'Employees':
        if (!isAuthorizedForEmployees) {
          return (
            <Restricted
              title="Access denied"
              text="You do not have permission to view the employee directory."
            />
          );
        }
        return (
          <EmployeesTab
            userRole={userRole}
            handleBackToGroupOverview={handleBackToGroupOverview}
            user={user}
            selectedCompany={selectedCompanyName}
            companies={companies}
            selectedEmployeeId={selectedEmployeeId}
            setSelectedEmployeeId={setSelectedEmployeeId}
            backButtonText={previousCompanyContext ? "Back to Group Overview" : "Back to Group Overview"}
          />
        );

      case 'Field Visits':
        return <FieldVisits user={user} />;

      case 'Field Tracking':
        return (
          <FieldTracking
            companyId={selectedCompanyName === 'All Companies' ? 'all' : getSelectedCompanyId()}
            selectedCompany={selectedCompanyName}
            userRole={userRole}
          />
        );

      case 'My Attendance':
      case 'Attendance':
        return (
          <AttendanceTab
            userRole={userRole}
            selectedCompany={selectedCompanyName}
            handleBackToGroupOverview={handleBackToGroupOverview}
            attendanceRecords={attendanceRecords}
            handleCheckIn={handleCheckIn}
            handleCheckOut={handleCheckOut}
            backButtonText={previousCompanyContext ? "Back to Group Overview" : "Back to Group Overview"}
          />
        );

      case 'Leave Requests':
      case 'Leave Management':
        return (
          <LeaveManagementTab
            userRole={userRole}
            myLeaves={myLeaves}
            setMyLeaves={setMyLeaves}
            leavesLoading={leavesLoading}
            leavesError={leavesError}
            onRetryLeaves={loadMyLeaves}
            leaveSubmitting={leaveSubmitting}
            leaveFormError={leaveFormError}
            setLeaveFormError={setLeaveFormError}
            allLeaves={allLeaves}
            setAllLeaves={setAllLeaves}
            showLeaveModal={showLeaveModal}
            setShowLeaveModal={setShowLeaveModal}
            leaveType={leaveType}
            setLeaveType={setLeaveType}
            leaveFrom={leaveFrom}
            setLeaveFrom={setLeaveFrom}
            leaveTo={leaveTo}
            setLeaveTo={setLeaveTo}
            leaveReason={leaveReason}
            setLeaveReason={setLeaveReason}
            handleApplyLeave={handleApplyLeave}
            handleLeaveAction={handleLeaveAction}
          />
        );

      case 'Payroll':
        return (
          <PayrollTab 
            selectedCompany={selectedCompanyName} 
            onBack={() => {
              if (previousCompanyContext) {
                setActiveCompanyDashboard(previousCompanyContext);
                setSelectedCompany(previousCompanyContext.name);
                localStorage.setItem('hrms_selected_company', previousCompanyContext.name);
                setActiveMenu('Dashboard');
                setPreviousCompanyContext(null);
              } else {
                handleMenuChange('Dashboard');
              }
            }} 
          />
        );

      case 'Payslips':
        return (
          <Payslips 
            user={user} 
            onHeadBack={() => handleMenuChange('Dashboard')} 
          />
        );

      case 'Recruitment':
        return <RecruitmentTab />;

      case 'Performance':
        return <PerformanceTab />;

      case 'Reports':
        return <ReportsTab companyId={selectedCompanyName === 'All Companies' ? 'all' : getSelectedCompanyId()} selectedCompany={selectedCompanyName} />;

      case 'Approvals':
        return <ApprovalsTab />;

      case 'Settings':
        return (
          <Settings 
            user={user} 
            activeTab={activeSettingsTab} 
            setActiveTab={setActiveSettingsTab} 
          />
        );

      default:
        return (
          <div>
            <PageHeader title={activeMenu} subtitle="This module is being set up." />
            <Panel flush>
              <EmptyState title="Coming soon" text={`The ${activeMenu} module isn't available yet.`} />
            </Panel>
          </div>
        );
    }
  };

  // Visual-only: sidebar theme follows the company in view.
  // MD on "All Companies" keeps the neutral group theme; everyone else uses their own company.
  const sidebarBrand = userRole === 'MD'
    ? getCompanyBrand(selectedCompanyName)?.key
    : getCompanyBrand(user?.company_id || user?.company_name || selectedCompanyName)?.key;

  // Visual-only: entity ribbon colour(s) for the company in view
  const ribbonEntity = COMPANIES_LIST.find(c => c.name === selectedCompanyName);
  const ribbonColors = ribbonEntity ? [ribbonEntity.color] : companies.map(c => c.color);

  return (
    <div className="hr-shell">
      <Sidebar
        userRole={userRole}
        menuItems={menuItems}
        activeMenu={activeMenu}
        setActiveMenu={handleMenuChange}
        setActiveCompanyDashboard={setActiveCompanyDashboard}
        mobileOpen={navOpen}
        brand={sidebarBrand}
        fieldUser={isFieldUser}
        onClose={() => setNavOpen(false)}
      />

      <div className="hr-main">
        <div className="hr-topwrap">
        <Header
          selectedCompany={selectedCompanyName}
          setSelectedCompany={userRole === 'CEO' ? () => {} : handleHeaderCompanyChange}
          companies={companies}
          user={user}
          userRole={userRole}
          roleLabel={getRoleLabel(user)}
          onLogout={onLogout}
          setActiveMenu={handleMenuChange}
          setActiveTab={setActiveSettingsTab}
          onToggleSidebar={() => setNavOpen(true)}
        />
        <div className="hr-ribbon" aria-hidden="true">
          {ribbonColors.map((color, i) => <span key={i} style={{ background: color }} />)}
        </div>
        </div>

        <main className="hr-content">
          {renderMainContent()}
        </main>
      </div>
    </div>
  );
}

export default MDDashboard;