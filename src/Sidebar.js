import React from 'react';
import { LayoutDashboard, CalendarCheck, CalendarDays, FileSpreadsheet, Wallet, Settings as SettingsIcon, Users, Building2, BarChart3, UserPlus, CheckCircle } from 'lucide-react';

function Sidebar({ activeMenu, setActiveMenu, userRole, activeCompanyDashboard, mobileOpen = false, onClose, brand }) {
  const getMenuItems = (role) => {
    if (role === 'MD' || role === 'ADMIN') {
      let items = [
        { id: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'Employees', label: 'Employees Management', icon: Users },
        { id: 'Companies', label: 'All Companies', icon: Building2 },
        { id: 'Leave Approvals', label: 'Leave Approvals', icon: CalendarDays },
        { id: 'Performance', label: 'Performance', icon: BarChart3 },
        { id: 'Reports', label: 'Reports & Analytics', icon: FileSpreadsheet },
        { id: 'Payroll', label: 'Payroll & Slips', icon: Wallet },
        { id: 'Settings', label: 'Settings', icon: SettingsIcon },
      ];

      if (activeCompanyDashboard) {
        items = items.filter(item => item.id !== 'Companies');
      }

      return items;
    } else if (role === 'CEO') {
      // Mirrors the CEO menu defined in MDDashboard (company-scoped; no 'All Companies')
      return [
        { id: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'Employees', label: 'Employees Management', icon: Users },
        { id: 'Attendance', label: 'Attendance', icon: CalendarCheck },
        { id: 'Leave Requests', label: 'Leave Requests', icon: CalendarDays },
        { id: 'Payroll', label: 'Payroll & Slips', icon: Wallet },
        { id: 'Recruitment', label: 'Recruitment', icon: UserPlus },
        { id: 'Performance', label: 'Performance', icon: BarChart3 },
        { id: 'Reports', label: 'Reports & Analytics', icon: FileSpreadsheet },
        { id: 'Approvals', label: 'Approvals', icon: CheckCircle },
        { id: 'Settings', label: 'Settings', icon: SettingsIcon },
      ];
    } else if (role === 'HR') {
      return [
        { id: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'Employees', label: 'Employees', icon: Users },
        { id: 'Leave Requests', label: 'Leave Requests', icon: CalendarDays },
        { id: 'Performance', label: 'Performance', icon: BarChart3 },
        { id: 'Settings', label: 'Settings', icon: SettingsIcon },
      ];
    } else {
      return [
        { id: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'My Attendance', label: 'My Attendance', icon: CalendarCheck },
        { id: 'Leave Requests', label: 'Leave Requests', icon: CalendarDays },
        { id: 'Payslips', label: 'Payslips', icon: Wallet },
        { id: 'Settings', label: 'Settings', icon: SettingsIcon },
      ];
    }
  };

  const menuItems = getMenuItems(userRole);

  return (
    <>
      <div className={`hr-scrim${mobileOpen ? ' is-open' : ''}`} onClick={onClose} aria-hidden="true" />

      <aside className={`hr-sidebar${mobileOpen ? ' is-open' : ''}`} data-brand={brand || 'group'} aria-label="Main navigation">
        <div className="hr-brand">
          <div className="hr-brand-mark">H</div>
          <div style={{ minWidth: 0 }}>
            <div className="hr-brand-name">HRMS Portal</div>
            <div className="hr-brand-sub">Group workforce</div>
          </div>
        </div>

        <nav className="hr-nav">
          <div className="hr-nav-label">Workspace</div>
          {menuItems.map((item) => {
            const IconComponent = item.icon;
            const isActive = activeMenu === item.id || (item.id === 'Leave Approvals' && activeMenu === 'Leave Management');
            return (
              <button
                key={item.id}
                type="button"
                className={`hr-nav-item${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  setActiveMenu && setActiveMenu(item.id);
                  onClose && onClose();
                }}
              >
                <IconComponent size={18} strokeWidth={1.75} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

export default Sidebar;