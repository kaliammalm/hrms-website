/* ==========================================================================
   Role-based access for the UI.
   The backend is the real gatekeeper (it checks every request); this file only
   decides what each person is shown, so screens never offer something the
   server will refuse.

   Group access: users with group_access = true (the MD account, Vasumathi) are
   treated as the group MD across all companies. Their own job title is kept for display.
   ========================================================================== */

/** Role used for every access decision in the UI ('MD', 'CEO', 'HR', 'ADMIN' or a staff title). */
export function getEffectiveRole(user) {
  if (user?.group_access) return 'MD';
  return user?.role ? String(user.role).trim().toUpperCase() : 'EMPLOYEE';
}

/** Text shown under the user's name, e.g. "CEO · Group MD access". */
export function getRoleLabel(user) {
  const base = user?.role ? String(user.role).trim() : 'Employee';
  if (user?.group_access && base.toUpperCase() !== 'MD') return `${base} · Group MD access`;
  return base.toUpperCase() === 'MD' ? 'MD' : base;
}

const STAFF_MENUS = ['Dashboard', 'Field Visits', 'My Attendance', 'Leave Requests', 'Payslips', 'Settings'];
const MENU_ACCESS = {
  MD: '*',
  ADMIN: '*',
  CEO: ['Dashboard', 'Employees', 'Attendance', 'My Attendance', 'Field Tracking', 'Leave Requests', 'Payroll', 'Payslips',
    'Recruitment', 'Performance', 'Reports', 'Approvals', 'Settings'],
  HR: ['Dashboard', 'Employees', 'Attendance', 'My Attendance', 'Field Tracking', 'Leave Requests', 'Payroll', 'Payslips',
    'Performance', 'Settings'],
};

/** Whether a screen (the activeMenu key used by MDDashboard) may be shown to this role. */
export function canAccessMenu(role, menu) {
  const allowed = MENU_ACCESS[String(role || '').toUpperCase()] || STAFF_MENUS;
  return allowed === '*' || allowed.includes(menu);
}
