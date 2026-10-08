import React, { useState, useEffect, useRef } from 'react';
import { Menu, LogOut, ChevronDown, User, Shield, HelpCircle } from 'lucide-react';
import { getCompanyBrand, CompanyLogo } from './brand';

function Header({ selectedCompany, setSelectedCompany, companies = [], user, userRole, onLogout, setActiveMenu, setActiveTab, companyName, onToggleSidebar }) {
  const isMD = userRole && userRole.toUpperCase() === 'MD';

  const getEmployeeCompany = () => {
    if (companyName) return companyName;
    if (user?.company_name) return user.company_name;
    if (user?.companyName) return user.companyName;
    if (user?.company) return user.company;
    if (user?.company_title) return user.company_title;
    
    try {
      const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
      if (storedUser?.company_name) return storedUser.company_name;
      if (storedUser?.companyName) return storedUser.companyName;
      if (storedUser?.company) return storedUser.company;
    } catch (e) {}

    if (selectedCompany && selectedCompany !== 'All Companies') {
      return selectedCompany;
    }

    return 'My Company';
  };

  const employeeCompanyName = getEmployeeCompany();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handlePointer = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const displayName = user?.name || 'User';
  const displayEmail = user?.email || user?.official_email || '';
  const avatarSrc = user?.profile_image || user?.avatar || user?.photo || '';
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'U';

  const canSeeSecurityTab = true; // every user can change their own password

  const openSettingsTab = (tab) => {
    if (setActiveMenu) setActiveMenu('Settings');
    if (setActiveTab) setActiveTab(tab);
    setMenuOpen(false);
  };

  const renderAvatar = (size) => (
    <span 
      className="hr-avatar hr-avatar-ink" 
      style={{ 
        width: `${size}px !important`, 
        height: `${size}px !important`, 
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        fontSize: `${Math.round(size * 0.38)}px`,
        borderRadius: '50%',
        overflow: 'hidden',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      {avatarSrc ? <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </span>
  );

  return (
    <header className="hr-topbar">
      <div className="hr-topbar-left">
        {onToggleSidebar && (
          <button type="button" className="hr-icon-btn hr-menu-btn" onClick={onToggleSidebar} aria-label="Open navigation">
            <Menu size={18} />
          </button>
        )}

        <div className="hr-context">
          {isMD && getCompanyBrand(selectedCompany) && (
            <span className="hr-context-logo"><CompanyLogo company={selectedCompany} height={22} compact /></span>
          )}
          {isMD ? (
            <select
              aria-label="Select company"
              value={selectedCompany || 'All Companies'}
              onChange={(e) => {
                const val = e.target.value;
                if (setSelectedCompany) {
                  setSelectedCompany(val);
                  localStorage.setItem('hrms_selected_company', val);
                }
              }}
            >
              <option value="All Companies">All companies (group view)</option>
              {companies.map((comp, idx) => {
                const compName = typeof comp === 'string' ? comp : (comp.name || comp.company_name);
                return (
                  <option key={idx} value={compName}>
                    {compName}
                  </option>
                );
              })}
            </select>
          ) : (
            getCompanyBrand(employeeCompanyName) ? (
              <span className="hr-context-brand" title={employeeCompanyName}>
                <CompanyLogo company={employeeCompanyName} height={26} />
                <span className="sr-only">{employeeCompanyName}</span>
              </span>
            ) : (
              <span className="hr-context-value">{employeeCompanyName}</span>
            )
          )}
        </div>
      </div>

      <div className="hr-topbar-right">
        <div className="hr-profile" ref={menuRef}>
          <button
            type="button"
            className={`hr-user${menuOpen ? ' is-open' : ''}`}
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls="hr-profile-menu"
          >
            {renderAvatar(34)}
            <span className="hr-user-meta">
              <span className="hr-user-name">{displayName}</span>
              <span className="hr-user-role">{userRole}</span>
            </span>
            <ChevronDown size={15} className="hr-user-chev hr-hide-sm" />
          </button>

          {menuOpen && (
            <div id="hr-profile-menu" className="hr-popover" role="menu" aria-label="Account">
              <div 
                className="hr-popover-head" 
                style={{ 
                  display: 'flex !important', 
                  flexDirection: 'column !important', 
                  alignItems: 'center !important', 
                  textAlign: 'center !important', 
                  padding: '20px 16px !important', 
                  gap: '10px !important' 
                }}
              >
                {renderAvatar(56)}
                <div style={{ minWidth: 0, width: '100%' }}>
                  <div className="hr-popover-name" title={displayName} style={{ fontWeight: '600', fontSize: '15px' }}>{displayName}</div>
                  {displayEmail && <div className="hr-popover-email" title={displayEmail} style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '2px' }}>{displayEmail}</div>}
                  <div style={{ marginTop: '8px' }}>
                    <span className="hr-role-badge">{userRole}</span>
                  </div>
                </div>
              </div>

              <div className="hr-popover-section">
                <button type="button" role="menuitem" className="hr-popover-item" onClick={() => openSettingsTab('Profile Settings')}>
                  <User size={16} /> Profile settings
                </button>
                {canSeeSecurityTab && (
                  <button type="button" role="menuitem" className="hr-popover-item" onClick={() => openSettingsTab('Account & Security')}>
                    <Shield size={16} /> Sign-in & security
                  </button>
                )}
                <button type="button" role="menuitem" className="hr-popover-item" onClick={() => openSettingsTab('Help & Support')}>
                  <HelpCircle size={16} /> Help & support
                </button>
              </div>

              <div className="hr-popover-section">
                <button
                  type="button"
                  role="menuitem"
                  className="hr-popover-item is-danger"
                  onClick={() => {
                    setMenuOpen(false);
                    if (onLogout) onLogout();
                  }}
                >
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;