const express = require('express');
const jwt = require('jsonwebtoken');

module.exports = function(db, authenticate, getLocalDateTime, calculateDistance, JWT_SECRET) {
  const router = express.Router();

  // Helper function for GPS Insert
  function executeGpsInsert(userId, company_id, today, check_in, latitude, longitude, site_name, distance, res) {
    const insertGpsQuery = `
      INSERT INTO attendance (employee_id, company_id, date, check_in, status, latitude, longitude, is_auto_marked, site_name) 
      VALUES (?, ?, ?, ?, 'Checked In', ?, ?, 1, ?)
    `;
    const gpsParams = [userId, company_id, today, check_in, latitude, longitude, site_name || 'Field Site'];

    db.query(insertGpsQuery, gpsParams, (err, result) => {
      if (err) {
        console.error('GPS Attendance insert error:', err);
        return res.status(500).json({ error: 'Failed to mark site GPS attendance' });
      }
      const where = ['Work From Home', 'On-Duty', 'MD Remote'].includes(site_name) ? site_name : `${distance}m`;
      return res.status(201).json({ message: `Attendance marked successfully! (${where})`, id: result.insertId });
    });
  }

  function sendCsvResponse(res, results) {
    let csv = 'ID,Employee Code,Employee Name,Date,Check In,Check Out,Status,Site/Location\n';
    results.forEach(row => {
      csv += `${row.id},"${row.emp_code || 'N/A'}","${row.employee_name || 'N/A'}",${row.date || ''},${row.check_in || ''},${row.check_out || ''},${row.status || 'Present'},"${row.site_name || 'Office'}"\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('attendance_summary.csv');
    res.send(csv);
  }

  // ---------- POST: Login API ----------
  router.post('/auth/login', (req, res) => {
    const { email, password } = req.body;
    const query = `
      SELECT u.*, c.name as company_name 
      FROM users u 
      LEFT JOIN companies c ON u.company_id = c.id 
      WHERE u.email = ? AND u.password = ?
    `;
    db.query(query, [email, password], (err, results) => {
      if (err) {
        return res.status(500).json({ error: 'Database error during login' });
      }
      if (results.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = results[0];
      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1d' });

      res.json({
        message: 'Login successful',
        token: token,
        user: {
          id: user.id,
          emp_code: user.emp_code,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department || '',
          joining_date: user.joining_date || user.date_of_joining || '',
          dob: user.dob || user.date_of_birth || '',
          phone: user.phone,
          company_id: user.company_id,
          company_name: user.company_name,
          attendance_type: user.attendance_type,
          attendance_mode: user.attendance_mode || 'OFFICE',
          group_access: Number(user.group_access || 0) === 1
        }
      });
    });
  });

  // ---------- POST: Add New Employee API ----------
  router.post('/employees', authenticate, (req, res) => {
    const { name, email, role, department, company_id, attendance_type, biometric_id, emp_code, dob, date_of_birth, joining_date, date_of_joining, monthly_salary, hra, allowances, deductions } = req.body;
    if (!name || !email || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const birthDate = dob || date_of_birth || null;
    const joiningDate = joining_date || date_of_joining || null;

    db.query('SELECT name FROM companies WHERE id = ?', [company_id], (compErr, compResults) => {
      const companyName = compResults?.[0]?.name || 'Ram Reddy Developers';
      const defaultPassword = req.body.password || 'password123';
      
      const query = `
        INSERT INTO users (name, email, password, role, department, company_id, company_name, attendance_type, biometric_id, emp_code, dob, joining_date, monthly_salary, hra, allowances, deductions) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      db.query(query, [
        name, email, defaultPassword, role || 'EMPLOYEE', department || 'General', company_id, companyName, 
        attendance_type || 'OFFICE', biometric_id || null, emp_code || null, birthDate, joiningDate,
        monthly_salary || 0, hra || 0, allowances || 0, deductions || 0
      ], (err, result) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already exists.' });
          return res.status(500).json({ error: 'Database error while adding employee' });
        }
        res.status(201).json({ message: 'Employee added successfully!', id: result.insertId });
      });
    });
  });

  // =====================================================================
  // Employee records: permissions + profile/compensation editing
  // =====================================================================
  const PRIVILEGED_ROLES = ['MD', 'CEO', 'HR', 'ADMIN'];
  const isPrivilegedRole = (role) => PRIVILEGED_ROLES.some(r => String(role || '').toUpperCase().includes(r));

  // Who may view/manage employee records:
  //   'all'        -> group MD / ADMIN without a company
  //   <companyId>  -> MD/ADMIN/CEO/HR of that company
  //   null         -> regular staff (own record only)
  // Who may DECIDE leave / OD / WFH requests (viewing uses managementScope):
  //   group MD (incl. group access, e.g. the CFO) and Admin without a company → every company ('all')
  //   a company CEO → only their own company
  //   HR and everyone else → nobody (null)
  const approverScope = (req) => {
    const role = (req.dbUser?.role || '').toUpperCase();
    const companyId = req.dbUser?.company_id;
    const noCompany = !companyId || companyId === 0 || companyId === '0';
    if ((role.includes('MD') || role.includes('ADMIN')) && noCompany) return 'all';
    if ((role.includes('MD') || role.includes('CEO')) && !noCompany) return Number(companyId);
    return null;
  };
  // A request is decided by someone else: never by the requester, except the group MD (no one above them)
  const canDecideLeave = (scope, leave, userId) => {
    if (!scope) return false;
    const company = Number(leave.user_company_id || leave.company_id || 0);
    if (scope !== 'all' && company !== Number(scope)) return false;
    return scope === 'all' || Number(leave.employee_id) !== Number(userId);
  };

  const managementScope = (req) => {
    const role = (req.dbUser?.role || '').toUpperCase();
    const companyId = req.dbUser?.company_id;
    const noCompany = !companyId || companyId === 0 || companyId === '0';
    if ((role.includes('MD') || role.includes('ADMIN')) && noCompany) return 'all';
    if (PRIVILEGED_ROLES.some(r => role.includes(r)) && !noCompany) return Number(companyId);
    return null;
  };
  // Editing (salary, bank, core fields) is limited to the MD/ADMIN and company CEOs
  const editScope = (req) => {
    const role = (req.dbUser?.role || '').toUpperCase();
    const scope = managementScope(req);
    if (scope === 'all') return 'all';
    if (scope && (role.includes('MD') || role.includes('ADMIN') || role.includes('CEO'))) return scope;
    return null;
  };

  // Live column list so optional profile columns work as soon as they exist
  // Whether users.group_access exists (added by scripts/grant-group-access.js); re-checked on every column read
  let hasGroupAccessColumn = false;
  const getUserColumns = (cb) => {
    db.query('SHOW COLUMNS FROM users', (err, rows) => {
      if (err || !Array.isArray(rows)) return cb(new Map());
      hasGroupAccessColumn = rows.some(r => r.Field === 'group_access');
      cb(new Map(rows.map(r => [r.Field, { nullable: r.Null === 'YES' }])));
    });
  };
  getUserColumns(() => {}); // learn the columns at startup

  // Group leadership = the MD account plus anyone with group (all-company) access, e.g. the CFO.
  // They run the group, so they are not listed or counted as regular employees.
  // Usage: `WHERE ${staffOnly('u.')}` (alias with trailing dot, or '' for no alias)
  const staffOnly = (a = '') => `UPPER(COALESCE(${a}role, '')) <> 'MD'`
    + (hasGroupAccessColumn ? ` AND COALESCE(${a}group_access, 0) = 0` : '');

  // Request field -> DB column. Optional columns are skipped when the table doesn't have them.
  const EDITABLE_FIELDS = [
    { col: 'name', keys: ['name'], type: 'text', required: true },
    { col: 'email', keys: ['email'], type: 'email', required: true },
    { col: 'role', keys: ['role', 'designation'], type: 'text', required: true },
    { col: 'department', keys: ['department'], type: 'text' },
    { col: 'emp_code', keys: ['emp_code', 'empCode'], type: 'text' },
    { col: 'phone', keys: ['phone'], type: 'text' },
    { col: 'address', keys: ['address'], type: 'text' },
    { col: 'dob', keys: ['dob', 'date_of_birth'], type: 'date' },
    { col: 'joining_date', keys: ['joining_date', 'joiningDate', 'date_of_joining'], type: 'date' },
    { col: 'monthly_salary', keys: ['monthly_salary', 'basicSalary', 'basic_salary'], type: 'money' },
    { col: 'hra', keys: ['hra'], type: 'money' },
    { col: 'allowances', keys: ['allowances'], type: 'money' },
    { col: 'deductions', keys: ['deductions'], type: 'money' },
    { col: 'bank_name', keys: ['bank_name', 'bankName'], type: 'text' },
    { col: 'account_number', keys: ['account_number', 'accountNumber'], type: 'text' },
    { col: 'ifsc_code', keys: ['ifsc_code', 'ifscCode'], type: 'ifsc' },
    { col: 'pan_number', keys: ['pan_number', 'panNumber'], type: 'pan' },
    { col: 'attendance_type', keys: ['attendance_type', 'attendanceType'], type: 'text' },
    { col: 'biometric_id', keys: ['biometric_id', 'biometricId'], type: 'text' },
    { col: 'aadhar_number', keys: ['aadhar_number', 'aadharNumber'], type: 'text' },
    { col: 'esi_number', keys: ['esi_number', 'esiNumber'], type: 'text' },
    { col: 'gender', keys: ['gender'], type: 'text' },
    { col: 'blood_group', keys: ['blood_group', 'bloodGroup'], type: 'text' },
    { col: 'emergency_contact_name', keys: ['emergency_contact_name', 'emergencyContactName'], type: 'text' },
    { col: 'emergency_contact_phone', keys: ['emergency_contact_phone', 'emergencyContactPhone'], type: 'text' },
    { col: 'reporting_manager', keys: ['reporting_manager', 'reportingManager'], type: 'text' },
  ];
  const OPTIONAL_PROFILE_COLUMNS = ['aadhar_number', 'esi_number', 'gender', 'blood_group', 'emergency_contact_name', 'emergency_contact_phone', 'reporting_manager'];

  // Builds "SET col = ?" pairs from the request body. Only fields present in the body change.
  // Returns { sets, params, errors }.
  const FIELD_LABELS = { monthly_salary: 'Basic salary', hra: 'HRA', joining_date: 'Joining date', dob: 'Date of birth', name: 'Name', role: 'Designation' };
  const fieldLabel = (col) => FIELD_LABELS[col] || col.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

  const buildEmployeeUpdate = (body, columns, allowedCols) => {
    const sets = []; const params = []; const errors = [];
    for (const f of EDITABLE_FIELDS) {
      if (allowedCols && !allowedCols.includes(f.col)) continue;
      if (!columns.has(f.col)) continue;
      const key = f.keys.find(k => Object.prototype.hasOwnProperty.call(body, k));
      if (!key) continue;
      let v = body[key];
      if (v === undefined) continue;
      if (typeof v === 'string') v = v.trim();
      const empty = v === null || v === '';
      if (f.required && empty) { errors.push(`${fieldLabel(f.col)} is required`); continue; }
      if (empty) {
        v = f.type === 'money' ? 0 : (columns.get(f.col).nullable ? null : '');
      } else if (f.type === 'money') {
        const n = Number(String(v).replace(/[₹,\s]/g, ''));
        if (!Number.isFinite(n) || n < 0) { errors.push(`${fieldLabel(f.col)} must be a positive number`); continue; }
        v = n;
      } else if (f.type === 'date') {
        const s = String(v); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (!m) { errors.push(`${fieldLabel(f.col)} must be a valid date`); continue; }
        v = m[0].length >= 10 && m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      } else if (f.type === 'email') {
        v = String(v).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { errors.push('Email is not valid'); continue; }
      } else if (f.type === 'ifsc') {
        v = String(v).toUpperCase();
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v)) { errors.push('IFSC code must look like HDFC0001234'); continue; }
      } else if (f.type === 'pan') {
        v = String(v).toUpperCase();
        if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v)) { errors.push('PAN must look like ABCDE1234F'); continue; }
      }
      sets.push(`${f.col} = ?`); params.push(v);
    }
    return { sets, params, errors };
  };

  const selectEmployeeSql = (columns, where) => {
    const optional = OPTIONAL_PROFILE_COLUMNS.filter(c => columns.has(c)).map(c => `u.${c}`);
    return `
      SELECT u.id, u.emp_code, u.name, u.email, u.role, u.department,
             u.company_id, COALESCE(c.name, u.company_name, 'Unassigned') as company_name,
             u.attendance_type, u.biometric_id, u.phone, u.address, u.monthly_salary, u.hra, u.allowances, u.deductions,
             u.bank_name, u.bank_name as bankName, u.pan_number as panNumber, u.account_number as accountNumber, u.ifsc_code as ifscCode,
             u.dob, u.joining_date${optional.length ? ', ' + optional.join(', ') : ''},
             (SELECT p.status FROM payslips p WHERE p.employee_id = u.id ORDER BY p.id DESC LIMIT 1) as payslip_status
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      ${where}`;
  };
  const formatEmployeeRow = (row) => ({
    ...row,
    empCode: row.emp_code,
    companyId: row.company_id,
    companyName: row.company_name,
    attendanceType: row.attendance_type,
    biometricId: row.biometric_id,
    aadharNumber: row.aadhar_number,
    esiNumber: row.esi_number,
    bloodGroup: row.blood_group,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    reportingManager: row.reporting_manager,
    status: row.payslip_status || 'Pending',
    employmentType: 'Full-Time / Permanent',
    joiningDate: row.joining_date || '',
    workLocation: 'Office'
  });

  // Loads the target employee and checks the requester may act on it.
  // mode: 'edit' (MD/CEO), 'view' (management or self), 'self-or-edit'
  const withTargetEmployee = (req, res, mode, next) => {
    db.query('SELECT id, role, company_id, email FROM users WHERE id = ?', [req.params.id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
      const target = rows[0];
      const isSelf = String(target.id) === String(req.userId);
      const scope = mode === 'view' ? managementScope(req) : editScope(req);
      const inScope = scope === 'all' || (scope && String(scope) === String(target.company_id));
      const allowed = mode === 'edit' ? inScope : (inScope || isSelf);
      if (!allowed) return res.status(403).json({ error: mode === 'view' ? 'You do not have permission to view this employee.' : 'You do not have permission to change this employee.' });
      next(target, { isSelf, scope });
    });
  };

  // ---------- PUT: Update employee (core fields, compensation, bank, statutory) — MD / company CEO ----------
  router.put('/employees/:id', authenticate, (req, res) => {
    withTargetEmployee(req, res, 'edit', (target, { scope }) => {
      // Access roles (MD/CEO/HR/ADMIN) can only be granted or changed by the group MD
      const newRole = req.body.role ?? req.body.designation;
      if (newRole !== undefined && String(newRole).trim() !== String(target.role || '')
          && (isPrivilegedRole(newRole) || isPrivilegedRole(target.role)) && scope !== 'all') {
        return res.status(403).json({ error: 'Only the group MD can change an access role (MD, CEO, HR or Admin).' });
      }
      getUserColumns((columns) => {
        const { sets, params, errors } = buildEmployeeUpdate(req.body, columns);
        if (errors.length) return res.status(400).json({ error: errors.join('; ') });
        if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
        db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, target.id], (err) => {
          if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'That email is already used by another account.' });
            console.error('Failed to update employee details:', err);
            return res.status(500).json({ error: 'Failed to update employee details' });
          }
          db.query(selectEmployeeSql(columns, 'WHERE u.id = ?'), [target.id], (fetchErr, rows) => {
            if (!fetchErr && rows?.length) return res.json({ message: 'Employee updated successfully!', employee: formatEmployeeRow(rows[0]) });
            res.json({ message: 'Employee updated successfully!' });
          });
        });
      });
    });
  });

  // ---------- PUT: Personal details (self-service from Settings, or MD/CEO) ----------
  router.put('/employees/:id/extended-details', authenticate, (req, res) => {
    withTargetEmployee(req, res, 'self-or-edit', (target, { isSelf, scope }) => {
      const canEditAll = scope === 'all' || (scope && String(scope) === String(target.company_id));
      // Employees can only change their own personal contact details
      const allowed = canEditAll && !isSelf ? null : ['phone', 'address', 'dob', 'gender', 'blood_group', 'emergency_contact_name', 'emergency_contact_phone'];
      getUserColumns((columns) => {
        const { sets, params, errors } = buildEmployeeUpdate(req.body, columns, allowed || undefined);
        if (errors.length) return res.status(400).json({ error: errors.join('; ') });
        if (sets.length === 0) return res.json({ message: 'Nothing to update' });
        db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, target.id], (err) => {
          if (err) return res.status(500).json({ error: 'Failed to update' });
          res.json({ message: 'Updated successfully!' });
        });
      });
    });
  });

  // ---------- GET: Fetch Employees API (management: their scope; staff: own record only) ----------
  router.get('/employees', authenticate, (req, res) => {
    const scope = managementScope(req);
    // Group leadership (MD account, group-access users such as the CFO) is left out of the directory.
    // ?include=payroll keeps group-access users who draw a salary (never the MD account) for the payroll screen.
    const forPayroll = String(req.query.include || '') === 'payroll';
    getUserColumns((columns) => {
      const exclusion = forPayroll ? "UPPER(COALESCE(u.role, '')) <> 'MD'" : staffOnly('u.');
      let where = `WHERE ((${exclusion}) OR u.id = ?)`;
      const params = [scope ? -1 : req.userId];
      if (scope === 'all') {
        // group view: everyone
      } else if (scope) {
        where += ' AND u.company_id = ?'; params.push(scope);
      } else {
        where += ' AND u.id = ?'; params.push(req.userId);
      }
      db.query(selectEmployeeSql(columns, where) + ' ORDER BY u.id DESC', params, (err, results) => {
        if (err) {
          console.error('Error fetching employees:', err);
          return res.status(500).json({ error: 'Failed to fetch employees' });
        }
        res.json(results.map(formatEmployeeRow));
      });
    });
  });

  // ---------- GET: Fetch Single Employee Details API (management in scope, or self) ----------
  router.get('/employees/:id', authenticate, (req, res) => {
    withTargetEmployee(req, res, 'view', (target) => {
      getUserColumns((columns) => {
        db.query(selectEmployeeSql(columns, 'WHERE u.id = ?'), [target.id], (err, results) => {
          if (err || results.length === 0) return res.status(404).json({ error: 'Employee not found' });
          res.json(formatEmployeeRow(results[0]));
        });
      });
    });
  });

  // ---------- PUT: Update Password API (self, or MD/CEO resetting a password) ----------
  router.put('/employees/:id/password', authenticate, (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    withTargetEmployee(req, res, 'self-or-edit', (target) => {
      db.query('UPDATE users SET password = ? WHERE id = ?', [newPassword, target.id], (err, result) => {
        if (err || result.affectedRows === 0) return res.status(404).json({ error: 'Failed to update password' });
        res.json({ message: 'Password updated successfully!' });
      });
    });
  });

  // ---------- GET: Fetch Companies API ----------
  router.get('/companies', authenticate, (req, res) => {
    const userRole = (req.dbUser?.role || '').toUpperCase();
    const userCompanyId = req.dbUser?.company_id;
    let query = 'SELECT * FROM companies WHERE 1=1';
    let params = [];

    const isGlobalMD = userRole.includes('MD') && (!userCompanyId || userCompanyId === 'all' || userCompanyId === '0');
    if (!isGlobalMD && userCompanyId) {
      query += ' AND id = ?';
      params.push(userCompanyId);
    } else if (!isGlobalMD && !userCompanyId) {
      query += ' AND id = 0';
    }

    db.query(query, params, (err, results) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch companies' });
      res.json(results);
    });
  });

  // ---------- GET: Company Dashboard Stats API ----------
  router.get('/companies/:id/stats', authenticate, (req, res) => {
    const userRole = (req.dbUser?.role || '').toUpperCase();
    const userId = req.userId;
    const userCompanyId = req.dbUser?.company_id;
    const requestedCompanyId = req.params.id;

    const managementRoles = ['MD', 'CEO', 'HR', 'ADMIN'];
    const isManagement = managementRoles.some(role => userRole.includes(role));
    const targetCompId = isManagement ? requestedCompanyId : userCompanyId;

    db.query('SELECT name FROM companies WHERE id = ?', [targetCompId], (err, compRes) => {
      const companyName = compRes?.[0]?.name || 'Dashboard';

      if (!isManagement) {
        const today = getLocalDateTime();
        db.query('SELECT COUNT(*) as count FROM attendance WHERE employee_id = ? AND date = ?', [userId, today], (err2, results) => {
          if (err2) {
            return res.status(500).json({ error: 'Failed to fetch personal stats' });
          }
          const isPresent = results[0]?.count > 0;
          return res.json({
            companyName: companyName,
            isManagement: false,
            presentToday: isPresent ? 1 : 0,
            onLeave: 0,
            monthlyPayroll: 0,
            attendanceRate: isPresent ? '100%' : '0%'
          });
        });
        return;
      }

      let companyId = requestedCompanyId;
      if (userRole.includes('CEO') || userRole.includes('HR')) {
        if (String(userCompanyId) !== String(requestedCompanyId)) {
          companyId = userCompanyId;
        }
      }

      const today = getLocalDateTime();

      db.query(`SELECT SUM(CASE WHEN ${staffOnly()} THEN 1 ELSE 0 END) as totalEmployees, COALESCE(SUM(COALESCE(monthly_salary,0) + COALESCE(hra,0) + COALESCE(allowances,0) - COALESCE(deductions,0)), 0) as monthlyPayroll FROM users WHERE company_id = ? AND UPPER(COALESCE(role, '')) <> 'MD'`, [companyId], (err, empResult) => {
        if (err) {
          console.error('Error fetching employee count for stats:', err);
          return res.status(500).json({ error: 'Failed to fetch stats' });
        }

        db.query('SELECT COUNT(DISTINCT employee_id) as presentToday FROM attendance WHERE company_id = ? AND date = ?', [companyId, today], (err2, attResult) => {
          db.query(`SELECT COUNT(*) as onLeave FROM leaves l WHERE l.company_id = ? AND l.status = 'Approved' AND ? BETWEEN l.from_date AND l.to_date AND ${realLeaveSql(leaveColumnsCache)}`, [companyId, today], (err3, leaveResult) => {
            
            const totalEmployees = Number(empResult?.[0]?.totalEmployees) || 0; // SUM() comes back as a string
            const presentToday = attResult?.[0]?.presentToday || 0;
            const onLeave = leaveResult?.[0]?.onLeave || 0;
            const attendanceRate = totalEmployees > 0 ? Math.round((presentToday / totalEmployees) * 100) : 0;

            res.json({
              companyName: companyName,
              isManagement: true,
              activeEmployees: totalEmployees,
              presentToday: presentToday,
              onLeave: onLeave,
              monthlyPayroll: Number(empResult?.[0]?.monthlyPayroll) || 0,
              attendanceRate: `${attendanceRate}%`
            });
          });
        });
      });
    });
  });

  // =====================================================================
  // Leaves
  //   GET  /leaves            management: requests in their scope; everyone else: their own
  //   GET  /leaves?mine=1     always only the signed-in user's own requests ("My requests")
  //   POST /leaves            submit a request (stored with status Pending)
  //   PUT  /leaves/:id        approve / reject (management, within their scope, not their own)
  // The leaves table differs between installs (from_date vs start_date, leave_type vs type),
  // so the columns are read once and the SQL is built from what actually exists.
  // =====================================================================
  let leaveColumnsCache = null;
  const getLeaveColumns = (cb) => {
    if (leaveColumnsCache) return cb(null, leaveColumnsCache);
    db.query('SHOW COLUMNS FROM leaves', (err, rows) => {
      if (err) return cb(err);
      leaveColumnsCache = new Set((rows || []).map(r => r.Field));
      cb(null, leaveColumnsCache);
    });
  };
  const pickCol = (cols, ...names) => names.find(n => cols.has(n)) || null;

  // Request kinds stored in leaves.leave_type. On-Duty and Work From Home go through the same
  // request/approval flow as leave, but they are WORKING days: never counted as leave or absence.
  const requestKind = (type) => {
    const t = String(type || '').toUpperCase();
    if (/\bWFH\b|WORK\s*FROM\s*HOME/.test(t)) return 'wfh';
    if (/\bOD\b|ON[\s-]*DUTY/.test(t)) return 'od';
    return 'leave';
  };
  const KIND_LABEL = { leave: 'leave', od: 'On-Duty', wfh: 'Work From Home' };
  // SQL condition: the leaves row (alias l) is a real leave, not OD/WFH. Needs the type column.
  const realLeaveSql = (cols) => {
    const typeCol = cols && pickCol(cols, 'leave_type', 'type');
    if (!typeCol) return '1=1';
    const t = `UPPER(COALESCE(l.${typeCol}, ''))`;
    return `NOT (${t} LIKE '%WFH%' OR ${t} LIKE '%WORK FROM HOME%' OR ${t} LIKE '%ON DUTY%' OR ${t} LIKE '%ON-DUTY%' OR ${t} LIKE '%(OD)%' OR ${t} = 'OD')`;
  };
  const LEAVE_STATUSES = ['Pending', 'Approved', 'Rejected'];
  // Audit trail: who decided a request and when (added once, if the table does not have them yet)
  getLeaveColumns((err, cols) => {
    if (err || !cols) return;
    const add = [];
    if (!cols.has('decided_by')) add.push('ADD COLUMN decided_by INT NULL');
    if (!cols.has('decided_at')) add.push('ADD COLUMN decided_at DATETIME NULL');
    if (!add.length) return;
    db.query(`ALTER TABLE leaves ${add.join(', ')}`, (altErr) => {
      if (altErr) console.warn('Could not add leave audit columns:', altErr.message);
      leaveColumnsCache = null;
      getLeaveColumns(() => {});
    });
  });
  const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));

  const formatLeaveRow = (row) => {
    const fromDate = row.from_date || row.start_date || row.from || '';
    const toDate = row.to_date || row.end_date || row.to || '';
    const type = row.leave_type || row.type || 'Casual Leave';
    return {
      ...row,
      from_date: fromDate, to_date: toDate, leave_type: type,
      employeeId: row.employee_id,
      companyId: row.company_id || row.user_company_id || null,
      companyName: row.company_name || 'Unassigned',
      employeeName: row.employee_name || 'Employee',
      fromDate, toDate, type,
      kind: requestKind(type),
      status: row.status || 'Pending',
    };
  };

  // ---------- GET: Leaves ----------
  router.get('/leaves', authenticate, (req, res) => {
    const companyIdQuery = req.query.companyId || req.query.company_id;
    const mine = ['1', 'true', 'yes'].includes(String(req.query.mine || '').toLowerCase());
    const scope = managementScope(req);

    getLeaveColumns((colErr, cols) => {
      if (colErr) {
        console.error('Leaves table check failed:', colErr.message);
        return res.status(500).json({ error: 'The leaves table could not be read.', details: colErr.message });
      }
      const companyJoin = cols.has('company_id') ? 'LEFT JOIN companies c1 ON l.company_id = c1.id' : '';
      const deciderJoin = cols.has('decided_by') ? 'LEFT JOIN users d ON d.id = l.decided_by' : '';
      let query = `
        SELECT l.*, u.name as employee_name, u.email as employee_email, u.department as employee_department,
               u.emp_code as employee_code, u.company_id as user_company_id, u.role as employee_role,
               ${deciderJoin ? 'd.name' : 'NULL'} as decided_by_name,
               COALESCE(c2.name, ${companyJoin ? 'c1.name, ' : ''}u.company_name, 'Unassigned') as company_name
        FROM leaves l
        LEFT JOIN users u ON l.employee_id = u.id
        ${companyJoin}
        ${deciderJoin}
        LEFT JOIN companies c2 ON u.company_id = c2.id
        WHERE 1=1
      `;
      const params = [];

      if (mine || !scope) {
        // Own requests only
        query += ' AND l.employee_id = ?';
        params.push(req.userId);
      } else {
        const target = scope === 'all'
          ? (companyIdQuery && companyIdQuery !== 'all' && !Number.isNaN(Number(companyIdQuery)) ? Number(companyIdQuery) : null)
          : scope;
        if (target) {
          // The employee's current company decides who sees the request (the stored one only if the user has none)
          query += cols.has('company_id') ? ' AND COALESCE(u.company_id, l.company_id) = ?' : ' AND u.company_id = ?';
          params.push(target);
        }
      }

      query += ` ORDER BY ${cols.has('created_at') ? 'l.created_at DESC, ' : ''}l.id DESC`;

      db.query(query, params, (err, results) => {
        if (err) {
          console.error('Failed to fetch leaves:', err.message);
          return res.status(500).json({ error: 'Failed to fetch leaves', details: err.message });
        }
        const decideScope = approverScope(req);
        res.json((results || []).map((row) => ({
          ...formatLeaveRow(row),
          isMine: Number(row.employee_id) === Number(req.userId),
          canDecide: canDecideLeave(decideScope, row, req.userId),
        })));
      });
    });
  });

  // ---------- POST: Apply for leave ----------
  router.post('/leaves', authenticate, (req, res) => {
    const { from_date, to_date, start_date, end_date, from, to, reason, leave_type, type } = req.body || {};
    const finalFrom = String(from_date || start_date || from || '').slice(0, 10);
    const finalTo = String(to_date || end_date || to || '').slice(0, 10);
    const finalType = String(leave_type || type || 'Casual Leave').trim().slice(0, 100);
    const finalReason = String(reason || '').trim().slice(0, 1000);

    if (!finalFrom || !finalTo) return res.status(400).json({ error: 'Please choose both a start date and an end date.' });
    if (!isIsoDate(finalFrom) || !isIsoDate(finalTo)) return res.status(400).json({ error: 'Leave dates must be valid dates.' });
    if (finalTo < finalFrom) return res.status(400).json({ error: 'The end date cannot be before the start date.' });

    getLeaveColumns((colErr, cols) => {
      if (colErr) {
        console.error('Leaves table check failed:', colErr.message);
        return res.status(500).json({ error: 'The leaves table could not be read.', details: colErr.message });
      }
      const fromCol = pickCol(cols, 'from_date', 'start_date');
      const toCol = pickCol(cols, 'to_date', 'end_date');
      if (!cols.has('employee_id') || !fromCol || !toCol) {
        return res.status(500).json({ error: 'The leaves table is missing required columns. Run: node scripts/fix-leaves-table.js --apply' });
      }

      const fields = ['employee_id', fromCol, toCol];
      const values = [req.userId, finalFrom, finalTo];
      const typeCol = pickCol(cols, 'leave_type', 'type');
      if (typeCol) { fields.push(typeCol); values.push(finalType); }
      if (cols.has('reason')) { fields.push('reason'); values.push(finalReason); }
      if (cols.has('status')) { fields.push('status'); values.push('Pending'); }
      if (cols.has('company_id')) { fields.push('company_id'); values.push(req.dbUser?.base_company_id ?? req.dbUser?.company_id ?? null); }
      if (cols.has('created_at')) { fields.push('created_at'); values.push(new Date()); }

      db.query(`INSERT INTO leaves (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, values, (err, result) => {
        if (err) {
          console.error('Failed to save leave request:', err.message);
          return res.status(500).json({ error: 'Your leave request could not be saved.', details: err.message });
        }
        const id = result?.insertId;
        // Read the stored row back so the client shows exactly what is in the database
        db.query('SELECT * FROM leaves WHERE id = ?', [id], (readErr, rows) => {
          const leave = !readErr && rows?.[0]
            ? formatLeaveRow(rows[0])
            : formatLeaveRow({ id, employee_id: req.userId, from_date: finalFrom, to_date: finalTo, leave_type: finalType, reason: finalReason, status: 'Pending' });
          const kind = requestKind(finalType);
          res.status(201).json({ message: kind === 'leave' ? 'Leave submitted successfully!' : `${KIND_LABEL[kind]} request submitted successfully!`, id, leave });
        });
      });
    });
  });

  // ---------- PUT: Approve / reject ----------
  router.put('/leaves/:id', authenticate, (req, res) => {
    const status = LEAVE_STATUSES.find(s => s.toLowerCase() === String(req.body?.status || '').toLowerCase());
    if (!status) return res.status(400).json({ error: 'Status must be Pending, Approved or Rejected.' });
    const scope = approverScope(req);
    if (!scope) return res.status(403).json({ error: 'Leave requests are approved by the company CEO or the MD.' });

    getLeaveColumns((colErr, cols) => {
      if (colErr) return res.status(500).json({ error: 'The leaves table could not be read.' });
      const leaveCompany = cols.has('company_id') ? 'l.company_id' : 'NULL';
      db.query(`SELECT l.id, l.employee_id, u.company_id AS user_company_id, ${leaveCompany} AS company_id FROM leaves l LEFT JOIN users u ON u.id = l.employee_id WHERE l.id = ?`, [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error', details: err.message });
        if (!rows || rows.length === 0) return res.status(404).json({ error: 'Leave not found' });
        const leave = rows[0];
        if (Number(leave.employee_id) === Number(req.userId) && scope !== 'all') {
          return res.status(403).json({ error: 'You cannot approve your own request. It goes to the MD.' });
        }
        if (!canDecideLeave(scope, leave, req.userId)) {
          return res.status(403).json({ error: 'This request belongs to another company.' });
        }
        const sets = ['status = ?'];
        const vals = [status];
        if (cols.has('decided_by')) { sets.push('decided_by = ?'); vals.push(status === 'Pending' ? null : req.userId); }
        if (cols.has('decided_at')) { sets.push('decided_at = ?'); vals.push(status === 'Pending' ? null : new Date()); }
        db.query(`UPDATE leaves SET ${sets.join(', ')} WHERE id = ?`, [...vals, leave.id], (err2) => {
          if (err2) return res.status(500).json({ error: 'Failed to update leave', details: err2.message });
          res.json({ message: `Request ${status.toLowerCase()}.`, id: leave.id, status, decidedBy: status === 'Pending' ? null : (req.dbUser?.name || null) });
        });
      });
    });
  });

  // ---------- GET: Fetch Approvals API ----------
  router.get('/approvals', authenticate, (req, res) => {
    const userRole = (req.dbUser?.role || '').toUpperCase();
    let query = `
      SELECT a.*, u.name as employee_name, COALESCE(c.name, u.company_name, 'Unassigned') as company_name 
      FROM approvals a
      LEFT JOIN users u ON a.employee_id = u.id
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE a.status = 'Pending'
    `;
    let params = [];
    if (!userRole.includes('MD') && req.dbUser?.company_id) {
      query += ' AND u.company_id = ?';
      params.push(req.dbUser.company_id);
    }
    db.query(query, params, (err, results) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch approvals' });
      res.json(results);
    });
  });

  // ---------- PUT: Update Approval API ----------
  router.put('/approvals/:id', authenticate, (req, res) => {
    db.query('UPDATE approvals SET status = ? WHERE id = ?', [req.body.status, req.params.id], (err, result) => {
      if (err || result.affectedRows === 0) return res.status(404).json({ error: 'Approval not found' });
      res.json({ message: 'Approval status updated successfully!' });
    });
  });

  // ---------- POST: Mark Attendance ----------
  router.post('/attendance/mark', authenticate, (req, res) => {
    const { company_id, latitude, longitude, site_name, check_in } = req.body;
    const userId = req.userId;
    const today = getLocalDateTime();

    db.query('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [userId, today], (err, existing) => {
      if (existing.length > 0) return res.status(400).json({ error: 'Attendance already marked for today!' });

      const isMD = req.dbUser?.role?.toUpperCase()?.includes('MD');
      if (isMD) {
        return executeGpsInsert(userId, company_id, today, check_in, latitude || 0, longitude || 0, site_name || 'MD Remote', 0, res);
      }

      // An approved On-Duty or Work From Home request for today replaces the site location check
      db.query("SELECT * FROM leaves WHERE employee_id = ? AND status = 'Approved' AND ? BETWEEN from_date AND to_date", [userId, today], (odErr, approved) => {
        const remote = (approved || []).map(l => requestKind(l.leave_type || l.type)).find(k => k === 'od' || k === 'wfh');
        if (!odErr && remote) {
          const compId = company_id || req.dbUser?.base_company_id || req.dbUser?.company_id || null;
          return executeGpsInsert(userId, compId, today, check_in, latitude || 0, longitude || 0, remote === 'wfh' ? 'Work From Home' : 'On-Duty', 0, res);
        }
        checkSiteAndInsert();
      });

      function checkSiteAndInsert() {
        db.query('SELECT site_latitude, site_longitude, site_radius, name FROM companies WHERE id = ?', [company_id], (err2, compResult) => {
          if (err2 || compResult.length === 0) return res.status(400).json({ error: 'Company site details not found!' });
        
          const targetLat = compResult[0].site_latitude;
          const targetLng = compResult[0].site_longitude;
          const radius = compResult[0].site_radius || 50;
          const distance = calculateDistance(latitude, longitude, targetLat, targetLng);

          if (distance > radius) {
            return res.status(400).json({ error: `Geofencing Failed: You are ${Math.round(distance)}m away.` });
          }

          executeGpsInsert(userId, company_id, today, check_in, latitude, longitude, compResult[0].name, Math.round(distance), res);
        });
      }
    });
  });

  // ---------- GET: Fetch Attendance ----------
  router.get('/attendance', authenticate, (req, res) => {
    const userRole = (req.dbUser?.role || '').toUpperCase();
    let query = `
      SELECT a.*, u.emp_code, u.name as employee_name, u.role as employee_role 
      FROM attendance a
      LEFT JOIN users u ON a.employee_id = u.id
      WHERE 1=1
    `;
    let params = [];

    const isMD = userRole.includes('MD');
    const queryCompanyId = req.query.companyId || req.query.company_id;

    if (isMD && (!req.dbUser?.company_id || req.dbUser.company_id === 0)) {
      if (queryCompanyId && queryCompanyId !== 'all') {
        query += ' AND a.company_id = ?';
        params.push(queryCompanyId);
      }
    } else if (isMD || userRole.includes('HR')) {
      query += ' AND a.company_id = ?';
      params.push(req.dbUser?.company_id || queryCompanyId);
    } else {
      query += ' AND a.employee_id = ?';
      params.push(req.userId);
    }

    query += ' ORDER BY a.date DESC';
    db.query(query, params, (err, results) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch attendance' });
      res.json(results);
    });
  });

  // ---------- PUT: Check-Out ----------
  router.put('/attendance/checkout/:id', authenticate, (req, res) => {
    db.query("UPDATE attendance SET check_out = ?, status = 'Checked Out' WHERE id = ? AND employee_id = ?", 
      [req.body.checkOut, req.params.id, req.userId], (err, result) => {
        if (err || result.affectedRows === 0) return res.status(404).json({ error: 'Attendance not found' });
        res.json({ message: 'Checked out successfully!' });
    });
  });

  // ---------- GET: Celebrations (birthdays & work anniversaries this month) ----------
  // Visible to every signed-in user. Returns only names and dates (no other personal data).
  // Global MD: whole group or ?companyId=. Everyone else: their own company.
  router.get('/celebrations', authenticate, (req, res) => {
    const userRole = (req.dbUser?.role || '').toUpperCase();
    const userCompanyId = req.dbUser?.company_id;
    const isGlobalMD = userRole.includes('MD') && (!userCompanyId || userCompanyId === 0 || userCompanyId === '0');
    const requested = req.query.companyId || req.query.company_id;

    let scopeId = null;
    if (isGlobalMD) {
      if (requested && requested !== 'all' && !Number.isNaN(Number(requested))) scopeId = Number(requested);
    } else {
      scopeId = userCompanyId || -1; // no company -> nothing to show
    }

    const today = getLocalDateTime(); // YYYY-MM-DD in IST
    const [curYear, curMonth] = today.split('-').map(Number);

    // Accepts YYYY-MM-DD (optionally with time), DD/MM/YYYY or DD-MM-YYYY
    const parseDate = (value) => {
      if (!value) return null;
      const s = String(value).trim();
      let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) return { y: +m[1], m: +m[2], d: +m[3] };
      m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (m) return { y: +m[3], m: +m[2], d: +m[1] };
      return null;
    };

    const sql = `
      SELECT u.id, u.name, u.role, u.dob, u.joining_date, u.company_id, COALESCE(c.name, u.company_name, '') AS company_name
      FROM users u LEFT JOIN companies c ON c.id = u.company_id
      WHERE UPPER(COALESCE(u.role, '')) <> 'MD' ${scopeId ? 'AND u.company_id = ?' : ''}
    `;
    db.query(sql, scopeId ? [scopeId] : [], (err, rows) => {
      if (err) {
        console.error('Celebrations error:', err);
        return res.status(500).json({ error: 'Failed to load celebrations' });
      }
      const events = [];
      (rows || []).forEach((u) => {
        const dob = parseDate(u.dob);
        // userId / companyId let the dashboard open a branded greeting card and send wishes
        const who = { userId: u.id, name: u.name, designation: u.role || '', companyId: u.company_id, companyName: u.company_name, isMe: Number(u.id) === Number(req.userId) };
        if (dob && dob.m === curMonth) {
          events.push({ id: `b-${u.id}`, ...who, type: 'Birthday', occasion: 'birthday', day: dob.d, month: curMonth });
        }
        const joined = parseDate(u.joining_date);
        if (joined && joined.m === curMonth && joined.y < curYear) {
          events.push({ id: `a-${u.id}`, ...who, type: 'Work Anniversary', occasion: 'anniversary', day: joined.d, month: curMonth, years: curYear - joined.y });
        }
      });
      events.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
      res.json({ month: curMonth, year: curYear, today: Number(today.split('-')[2]), events });
    });
  });

  // ---------- GET: Dashboard Stats ----------
  // Global MD: whole group, or one company via ?companyId=. CEO/HR/ADMIN: their own company.
  // Everyone else: personal attendance only (unchanged).
  router.get('/dashboard/stats', authenticate, (req, res) => {
    const userRole = (req.dbUser?.role || '').toUpperCase();
    const userCompanyId = req.dbUser?.company_id;
    const today = getLocalDateTime();

    const isGlobalMD = userRole.includes('MD') && (!userCompanyId || userCompanyId === 0 || userCompanyId === '0');
    const isCompanyManagement = ['MD', 'CEO', 'HR', 'ADMIN'].some(r => userRole.includes(r));

    if (!isGlobalMD && !isCompanyManagement) {
      db.query('SELECT COUNT(*) as count FROM attendance WHERE employee_id = ? AND date = ?', [req.userId, today], (err, results) => {
        const isPresent = !err && results?.[0]?.count > 0;
        res.json({ presentToday: isPresent ? 1 : 0, attendanceRate: isPresent ? 100 : 0 });
      });
      return;
    }

    // Scope: MD may pick a company; company management is always locked to their own company
    const requested = req.query.companyId || req.query.company_id;
    let scopeId = null;
    if (isGlobalMD) {
      if (requested && requested !== 'all' && !Number.isNaN(Number(requested))) scopeId = Number(requested);
    } else {
      scopeId = userCompanyId;
    }

    // Headcount = regular employees (group leadership excluded); payroll = everyone salaried except the MD account
    const empWhere = scopeId ? `company_id = ? AND ${staffOnly()}` : staffOnly();
    const payWhere = scopeId ? "company_id = ? AND UPPER(COALESCE(role, '')) <> 'MD'" : "UPPER(COALESCE(role, '')) <> 'MD'";
    const empParams = scopeId ? [scopeId] : [];
    const sql = `
      SELECT
        (SELECT COUNT(*) FROM users WHERE ${empWhere}) AS totalEmployees,
        (SELECT COALESCE(SUM(COALESCE(monthly_salary,0) + COALESCE(hra,0) + COALESCE(allowances,0) - COALESCE(deductions,0)), 0) FROM users WHERE ${payWhere}) AS monthlyPayroll,
        (SELECT COUNT(DISTINCT a.employee_id) FROM attendance a JOIN users u ON u.id = a.employee_id WHERE a.date = ? ${scopeId ? 'AND u.company_id = ?' : ''}) AS presentToday,
        (SELECT COUNT(*) FROM leaves l JOIN users u ON u.id = l.employee_id WHERE l.status = 'Approved' AND ? BETWEEN l.from_date AND l.to_date AND ${realLeaveSql(leaveColumnsCache)} ${scopeId ? 'AND u.company_id = ?' : ''}) AS onLeave,
        (SELECT COUNT(*) FROM companies) AS totalCompanies
    `;
    const params = [...empParams, ...empParams, today, ...(scopeId ? [scopeId] : []), today, ...(scopeId ? [scopeId] : [])];

    db.query(sql, params, (err, results) => {
      if (err) {
        console.error('Dashboard stats error:', err);
        return res.status(500).json({ error: 'Failed to load dashboard stats' });
      }
      const r = results?.[0] || {};
      const total = Number(r.totalEmployees) || 0;
      const present = Number(r.presentToday) || 0;
      res.json({
        totalCompanies: Number(r.totalCompanies) || 3,
        totalEmployees: total,
        activeEmployees: total,
        presentToday: present,
        onLeave: Number(r.onLeave) || 0,
        monthlyPayroll: Number(r.monthlyPayroll) || 0,
        attendanceRate: `${total > 0 ? Math.round((present / total) * 100) : 0}%`
      });
    });
  });

  // ---------- PAYSLIPS ENDPOINTS (Dynamic Calculation & Storage) ----------
  router.get('/payslips', authenticate, (req, res) => {
    const userRole = (req.dbUser?.role || '').toUpperCase();
    const userId = req.userId;
    const companyIdQuery = req.query.companyId || req.query.company_id;

    let query = `
      SELECT p.*, u.name as employee_name, u.emp_code, COALESCE(c.name, u.company_name, 'Unassigned') as company_name 
      FROM payslips p
      LEFT JOIN users u ON p.employee_id = u.id
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE 1=1
    `;
    let params = [];

    const isManagement = userRole.includes('MD') || userRole.includes('HR') || userRole.includes('ADMIN');

    if (!isManagement) {
      query += ' AND p.employee_id = ?';
      params.push(userId);
    } else {
      if (companyIdQuery && companyIdQuery !== 'all') {
        query += ' AND p.company_id = ?';
        params.push(companyIdQuery);
      } else if (req.dbUser?.company_id && req.dbUser.company_id !== 0) {
        query += ' AND p.company_id = ?';
        params.push(req.dbUser.company_id);
      }
    }

    query += ' ORDER BY p.id DESC';
    db.query(query, params, (err, results) => {
      if (err) {
        console.error('Error fetching payslips:', err);
        return res.status(500).json({ error: 'Failed to fetch payslips' });
      }
      const formatted = results.map(row => ({
        ...row,
        month: row.month,
        company: row.company_name,
        basicSalary: Number(row.basic_salary) || 0,
        hra: Number(row.hra) || 0,
        allowances: Number(row.allowances) || 0,
        deductions: Number(row.deductions) || 0,
        netPay: Number(row.net_pay) || ((Number(row.basic_salary) || 0) + (Number(row.hra) || 0) + (Number(row.allowances) || 0) - (Number(row.deductions) || 0)),
        status: row.status || 'Paid'
      }));
      res.json(formatted);
    });
  });

  router.post('/payroll/run', authenticate, (req, res) => {
    const { company, month } = req.body;
    let currentMonth = month || new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
    currentMonth = currentMonth.replace(',', '');

    let compQuery = 'SELECT id FROM companies WHERE name = ?';
    db.query(compQuery, [company], (err, compRes) => {
      const companyId = compRes?.[0]?.id || 1;
      
      db.query('SELECT id, monthly_salary, hra, allowances, deductions FROM users WHERE company_id = ?', [companyId], (err2, users) => {
        if (err2 || users.length === 0) {
          return res.json({ message: 'Payroll run successfully!' });
        }

        users.forEach(emp => {
          const basic = Number(emp.monthly_salary) || 0;
          const hra = Number(emp.hra) || 0;
          const allowances = Number(emp.allowances) || 0;
          const deductions = Number(emp.deductions) || 0;
          const net = basic + hra + allowances - deductions;

          db.query(
            'REPLACE INTO payslips (employee_id, company_id, month, basic_salary, hra, allowances, deductions, net_pay, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "Paid")',
            [emp.id, companyId, currentMonth, basic, hra, allowances, deductions, net],
            (errInsert) => {
              if (errInsert) console.error('Error running payroll for employee:', errInsert);
            }
          );
        });
        res.json({ message: `Payroll successfully run for ${company} (${currentMonth})!` });
      });
    });
  });

  // ---------- UPDATED PROCESS PAYROLL ROUTE (Supports emp_code & id) ----------
  router.put('/payroll/process/:id', authenticate, (req, res) => {
    const empId = req.params.id;
    const { month, company_id, basic_salary, hra, allowances, deductions, net_pay } = req.body;
    let currentMonth = month || new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
    currentMonth = currentMonth.replace(',', '');

    db.query('SELECT id, company_id, monthly_salary, hra, allowances, deductions FROM users WHERE emp_code = ? OR id = ?', [empId, empId], (err, results) => {
      if (err || results.length === 0) {
        return res.status(404).json({ error: 'Employee not found with code or ID: ' + empId });
      }

      const emp = results[0];
      const actualEmployeeId = emp.id;
      const basic = basic_salary !== undefined ? Number(basic_salary) : (Number(emp.monthly_salary) || 0);
      const finalHra = hra !== undefined ? Number(hra) : (Number(emp.hra) || 0);
      const finalAllowances = allowances !== undefined ? Number(allowances) : (Number(emp.allowances) || 0);
      const finalDeductions = deductions !== undefined ? Number(deductions) : (Number(emp.deductions) || 0);
      const net = net_pay !== undefined ? Number(net_pay) : (basic + finalHra + finalAllowances - finalDeductions);
      const compId = company_id || emp.company_id;

      db.query(
        'REPLACE INTO payslips (employee_id, company_id, month, basic_salary, hra, allowances, deductions, net_pay, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "Paid")',
        [actualEmployeeId, compId, currentMonth, basic, finalHra, finalAllowances, finalDeductions, net],
        (err2, result) => {
          if (err2) {
            console.error('Failed to process payroll:', err2);
            return res.status(500).json({ error: 'Failed to process payroll: ' + err2.message });
          }
          res.json({ message: `Payroll processed successfully for ${currentMonth}!` });
        }
      );
    });
  });

  router.get('/payslips/download/:id', authenticate, (req, res) => {
    const payslipId = req.params.id;
    db.query('SELECT p.*, u.name as employee_name FROM payslips p LEFT JOIN users u ON p.employee_id = u.id WHERE p.id = ?', [payslipId], (err, results) => {
      if (err || results.length === 0) return res.status(404).json({ error: 'Payslip not found' });
      const p = results[0];
      let csv = `PAYSLIP STATEMENT\nMonth:,${p.month}\nEmployee:,${p.employee_name || 'Employee'}\nBasic Salary:,${p.basic_salary}\nHRA:,${p.hra}\nAllowances:,${p.allowances}\nDeductions:,${p.deductions}\nNet Pay:,${p.net_pay}\nStatus:,${p.status}\n`;
      res.header('Content-Type', 'text/csv');
      res.attachment(`Payslip_${p.month.replace(/\s+/g, '_')}.csv`);
      res.send(csv);
    });
  });

  // =====================================================================
  // Reports: /api/reports/:type?format=json|csv&month=YYYY-MM&companyId=
  //   attendance  -> monthly attendance summary + daily log
  //   payroll     -> payroll register (salary structure, bank details, payslip status)
  //   headcount   -> employee register, joiners and headcount by company (alias: turnover)
  // Management only (MD/ADMIN group-wide or one company; CEO/HR their own company).
  // =====================================================================
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const reportScope = (req) => {
    const scope = managementScope(req);
    if (!scope) return { allowed: false };
    if (scope === 'all') {
      const q = req.query.companyId || req.query.company_id;
      return { allowed: true, companyId: q && q !== 'all' && !Number.isNaN(Number(q)) ? Number(q) : null };
    }
    return { allowed: true, companyId: scope };
  };

  const monthRange = (monthParam) => {
    const today = getLocalDateTime();
    let [y, m] = today.split('-').map(Number);
    const mm = String(monthParam || '').match(/^(\d{4})-(\d{1,2})$/);
    if (mm && +mm[2] >= 1 && +mm[2] <= 12) { y = +mm[1]; m = +mm[2]; }
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, '0');
    return { y, m, start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay)}`, days: lastDay, label: `${MONTH_NAMES[m - 1]} ${y}`, key: `${y}-${pad(m)}` };
  };

  const csvCell = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    const s = String(v);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const sendCsv = (res, filename, columns, rows) => {
    const lines = [columns.map(c => csvCell(c.label)).join(',')];
    rows.forEach(r => lines.push(columns.map(c => csvCell(r[c.key])).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + lines.join('\r\n') + '\r\n'); // BOM so Excel reads ₹ and Tamil names correctly
  };
  const toDate = (v) => {
    if (!v) return null;
    const s = String(v); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    return d ? `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : null;
  };
  const q = (sql, params) => new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || []))));

  const buildReport = async (type, scope, period) => {
    const companyFilter = scope.companyId ? ' AND u.company_id = ?' : '';
    const cParams = scope.companyId ? [scope.companyId] : [];
    const companies = await q('SELECT id, name FROM companies', []);
    const scopeLabel = scope.companyId ? ((companies.find(c => Number(c.id) === Number(scope.companyId)) || {}).name || 'Company') : 'All group companies';
    const employees = await q(`
      SELECT u.id, u.emp_code, u.name, u.role, u.department, u.email, u.phone, u.joining_date, u.company_id,
             COALESCE(c.name, u.company_name, '') AS company,
             COALESCE(u.monthly_salary,0) AS basic, COALESCE(u.hra,0) AS hra, COALESCE(u.allowances,0) AS allowances, COALESCE(u.deductions,0) AS deductions,
             u.bank_name, u.account_number, u.ifsc_code, u.pan_number
      FROM users u LEFT JOIN companies c ON c.id = u.company_id
      WHERE ${type === 'payroll' ? "UPPER(COALESCE(u.role,'')) <> 'MD'" : staffOnly('u.')}${companyFilter}
      ORDER BY company, u.emp_code, u.name`, cParams);
    const dept = (d) => (d && String(d).toLowerCase() !== 'general' ? d : '');

    if (type === 'attendance') {
      const logs = await q(`
        SELECT a.date, a.check_in, a.check_out, a.status, a.site_name, u.id AS uid, u.emp_code, u.name
        FROM attendance a JOIN users u ON u.id = a.employee_id
        WHERE a.date BETWEEN ? AND ?${companyFilter}
        ORDER BY a.date, u.name`, [period.start, period.end, ...cParams]);
      const leaves = await q(`
        SELECT l.* FROM leaves l JOIN users u ON u.id = l.employee_id
        WHERE l.status = 'Approved' AND l.from_date <= ? AND l.to_date >= ?${companyFilter}`, [period.end, period.start, ...cParams]);
      const summary = employees.map(e => {
        const mine = logs.filter(l => l.uid === e.id);
        const days = new Set(mine.map(l => toDate(l.date)));
        let leaveDays = 0; let odDays = 0; let wfhDays = 0;
        leaves.filter(l => l.employee_id === e.id).forEach(l => {
          const from = toDate(l.from_date) < period.start ? period.start : toDate(l.from_date);
          const to = toDate(l.to_date) > period.end ? period.end : toDate(l.to_date);
          if (!(from && to && to >= from)) return;
          const n = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
          const kind = requestKind(l.leave_type || l.type);
          if (kind === 'od') odDays += n; else if (kind === 'wfh') wfhDays += n; else leaveDays += n;
        });
        return { emp_code: e.emp_code || '', name: e.name, designation: e.role || '', company: e.company,
          present: days.size, leave: leaveDays, od: odDays, wfh: wfhDays, missing_checkout: mine.filter(l => !l.check_out || l.check_out === '-').length,
          last_seen: mine.length ? toDate(mine[mine.length - 1].date) : '' };
      });
      const totalPresent = summary.reduce((s, r) => s + r.present, 0);
      return {
        type, title: 'Attendance summary', period: period.label, scopeLabel, filename: `Attendance_${period.key}`,
        highlights: [
          { label: 'Employees', value: String(employees.length) },
          { label: 'Attendance days logged', value: String(totalPresent) },
          { label: 'Approved leave days', value: String(summary.reduce((s, r) => s + r.leave, 0)) },
          { label: 'On-Duty / WFH days', value: `${summary.reduce((s, r) => s + r.od, 0)} / ${summary.reduce((s, r) => s + r.wfh, 0)}` },
          { label: 'Missing check-outs', value: String(summary.reduce((s, r) => s + r.missing_checkout, 0)) },
        ],
        sections: [
          { title: 'Summary by employee', columns: [
              { key: 'emp_code', label: 'Emp. code' }, { key: 'name', label: 'Employee' }, { key: 'designation', label: 'Designation' },
              { key: 'company', label: 'Company' }, { key: 'present', label: 'Days present', align: 'right' },
              { key: 'leave', label: 'Leave days', align: 'right' }, { key: 'od', label: 'On-Duty days', align: 'right' },
              { key: 'wfh', label: 'WFH days', align: 'right' }, { key: 'missing_checkout', label: 'No check-out', align: 'right' },
              { key: 'last_seen', label: 'Last check-in', type: 'date' }],
            rows: summary,
            totals: { emp_code: 'Total', present: totalPresent, leave: summary.reduce((s, r) => s + r.leave, 0), od: summary.reduce((s, r) => s + r.od, 0), wfh: summary.reduce((s, r) => s + r.wfh, 0), missing_checkout: summary.reduce((s, r) => s + r.missing_checkout, 0) } },
          { title: 'Daily log', csv: true, columns: [
              { key: 'date', label: 'Date', type: 'date' }, { key: 'emp_code', label: 'Emp. code' }, { key: 'name', label: 'Employee' },
              { key: 'check_in', label: 'Check-in' }, { key: 'check_out', label: 'Check-out' }, { key: 'status', label: 'Status' }, { key: 'site', label: 'Site' }],
            rows: logs.map(l => ({ date: toDate(l.date), emp_code: l.emp_code || '', name: l.name, check_in: l.check_in || '', check_out: l.check_out && l.check_out !== '-' ? l.check_out : '', status: l.check_out && l.check_out !== '-' ? 'Present' : 'Checked in', site: l.site_name || '' })) },
        ],
      };
    }

    if (type === 'payroll') {
      const slips = await q('SELECT employee_id, status FROM payslips WHERE month = ?', [period.label]);
      const rows = employees.map(e => {
        const net = Number(e.basic) + Number(e.hra) + Number(e.allowances) - Number(e.deductions);
        const slip = slips.find(s => s.employee_id === e.id);
        return { emp_code: e.emp_code || '', name: e.name, designation: e.role || '', company: e.company,
          bank: e.bank_name || '', account: e.account_number || '', ifsc: e.ifsc_code || '',
          basic: Number(e.basic), hra: Number(e.hra), allowances: Number(e.allowances), deductions: Number(e.deductions), net,
          status: slip ? (slip.status || 'Paid') : (Number(e.basic) > 0 ? 'Not processed' : 'Salary not set') };
      });
      const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
      return {
        type, title: 'Payroll register', period: period.label, scopeLabel, filename: `Payroll_${period.key}`,
        highlights: [
          { label: 'Employees', value: String(rows.length) },
          { label: 'Gross pay', value: sum('basic') + sum('hra') + sum('allowances'), money: true },
          { label: 'Deductions', value: sum('deductions'), money: true },
          { label: 'Net payable', value: sum('net'), money: true },
          { label: 'Salary not set', value: String(rows.filter(r => r.status === 'Salary not set').length) },
        ],
        sections: [{ title: 'Employee pay', csv: true, columns: [
            { key: 'emp_code', label: 'Emp. code' }, { key: 'name', label: 'Employee' }, { key: 'designation', label: 'Designation' },
            { key: 'company', label: 'Company' }, { key: 'bank', label: 'Bank' }, { key: 'account', label: 'Account no.' }, { key: 'ifsc', label: 'IFSC' },
            { key: 'basic', label: 'Basic', align: 'right', type: 'money' }, { key: 'hra', label: 'HRA', align: 'right', type: 'money' },
            { key: 'allowances', label: 'Allowances', align: 'right', type: 'money' }, { key: 'deductions', label: 'Deductions', align: 'right', type: 'money' },
            { key: 'net', label: 'Net pay', align: 'right', type: 'money' }, { key: 'status', label: 'Payslip' }],
          rows,
          totals: { emp_code: 'Total', basic: sum('basic'), hra: sum('hra'), allowances: sum('allowances'), deductions: sum('deductions'), net: sum('net') } }],
      };
    }

    if (type === 'headcount') {
      const now = getLocalDateTime();
      const yearAgo = `${Number(now.slice(0, 4)) - 1}${now.slice(4)}`;
      const rows = employees.map(e => {
        const jd = toDate(e.joining_date);
        let tenure = '';
        if (jd) {
          const months = (Number(now.slice(0, 4)) - Number(jd.slice(0, 4))) * 12 + (Number(now.slice(5, 7)) - Number(jd.slice(5, 7))) - (Number(now.slice(8, 10)) < Number(jd.slice(8, 10)) ? 1 : 0);
          tenure = months < 0 ? '' : months >= 12 ? `${Math.floor(months / 12)}y ${months % 12}m` : `${months}m`;
        }
        return { emp_code: e.emp_code || '', name: e.name, designation: e.role || '', department: dept(e.department), company: e.company,
          joining_date: jd || '', tenure, email: (e.email || '').endsWith('@pending.local') ? '' : e.email, phone: e.phone || '' };
      });
      const byCompany = {};
      rows.forEach(r => { byCompany[r.company || 'Unassigned'] = (byCompany[r.company || 'Unassigned'] || 0) + 1; });
      return {
        type, title: 'Headcount & joiners', period: `As of ${now}`, scopeLabel, filename: `Headcount_${now}`,
        highlights: [
          { label: 'Headcount', value: String(rows.length) },
          ...Object.entries(byCompany).map(([k, v]) => ({ label: k, value: String(v) })),
          { label: `Joined in ${period.label}`, value: String(rows.filter(r => r.joining_date >= period.start && r.joining_date <= period.end).length) },
          { label: 'Joined in last 12 months', value: String(rows.filter(r => r.joining_date && r.joining_date > yearAgo).length) },
        ],
        sections: [{ title: 'Employee register', csv: true, columns: [
            { key: 'emp_code', label: 'Emp. code' }, { key: 'name', label: 'Employee' }, { key: 'designation', label: 'Designation' },
            { key: 'department', label: 'Department' }, { key: 'company', label: 'Company' }, { key: 'joining_date', label: 'Joined', type: 'date' },
            { key: 'tenure', label: 'Tenure' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }],
          rows }],
      };
    }
    return null;
  };

  const REPORT_ALIASES = { attendance: 'attendance', 'attendance-csv': 'attendance', payroll: 'payroll', 'payroll-pdf': 'payroll', headcount: 'headcount', turnover: 'headcount', 'turnover-excel': 'headcount' };

  router.get('/reports/:type', authenticate, async (req, res) => {
    const type = REPORT_ALIASES[req.params.type];
    if (!type) return res.status(404).json({ error: 'Unknown report' });
    const scope = reportScope(req);
    if (!scope.allowed) return res.status(403).json({ error: 'Reports are available to management only.' });
    try {
      const period = monthRange(req.query.month);
      const report = await buildReport(type, scope, period);
      report.generatedAt = new Date().toISOString();
      report.generatedBy = req.dbUser?.role || '';
      const legacyCsv = /-(csv|pdf|excel)$/.test(req.params.type);
      if (req.query.format === 'csv' || (legacyCsv && req.query.format !== 'json')) {
        const section = report.sections.find(s => s.csv) || report.sections[0];
        const slug = scope.companyId ? `_${report.scopeLabel.replace(/[^A-Za-z0-9]+/g, '_')}` : '_All_Companies';
        return sendCsv(res, `${report.filename}${slug}.csv`, section.columns, section.rows);
      }
      res.json(report);
    } catch (err) {
      console.error('Report error:', err);
      res.status(500).json({ error: 'The report could not be generated.', details: err.message });
    }
  });

  return router;
};