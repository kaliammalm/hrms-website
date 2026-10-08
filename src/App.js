import React, { useState, useEffect } from 'react';
import MDDashboard from './MDDashboard';
import Login from './Login';

// One-time clean start: payroll runs made during testing were stored in the browser
// (payroll_<company>_<month>) and keep generating payslips. Clear them once per browser.
const DATA_EPOCH = '2026-10-clean-start';
try {
  if (localStorage.getItem('hrms_data_epoch') !== DATA_EPOCH) {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('payroll_') || key === 'active_employee_profile')
      .forEach((key) => localStorage.removeItem(key));
    localStorage.setItem('hrms_data_epoch', DATA_EPOCH);
  }
} catch (e) { /* storage unavailable: nothing to clean */ }

function App() {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('user');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    // Clear per-session view state so the next login (MD, CEO or staff) never inherits
    // another user's selected company, open menu or open employee profile.
    ['hrms_selected_company', 'hrms_active_menu', 'hrms_active_settings_tab', 'active_employee_profile']
      .forEach((key) => localStorage.removeItem(key));
  };

  // Session expiry: the login token lasts 1 day, but the saved user keeps the portal open.
  // When the API starts refusing the token (401), sign out once with a clear message
  // instead of showing empty tables and zero totals.
  useEffect(() => {
    if (!user) return undefined;
    const originalFetch = window.fetch;
    let handled = false;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = String(args[0] && args[0].url ? args[0].url : args[0]);
      if (response.status === 401 && url.includes('/api/') && !url.includes('/api/auth/login') && !handled) {
        handled = true;
        alert('Your session has expired. Please sign in again.');
        handleLogout();
      }
      return response;
    };
    return () => { window.fetch = originalFetch; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);


  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div>
      <MDDashboard user={user} onLogout={handleLogout} />
    </div>
  );
}

export default App;