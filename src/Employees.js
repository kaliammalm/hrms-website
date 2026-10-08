import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Briefcase, User, CreditCard, Camera, Edit2, Save, X, Search, Eye, Wallet, Shield, Users, AlertCircle, CheckCircle2 } from 'lucide-react';
import { PageHeader, Panel, EmptyState, TableEmpty, Avatar, StatusPill, Field, DataItem } from './ui';

function Employees({ user, selectedCompany, companies, userRole, handleBackToGroupOverview }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [pendingEdit, setPendingEdit] = useState(false);
  const editBaseline = useRef({});

  // Who may edit records: the group MD (and Admin) everywhere, a company CEO within their company.
  // The backend enforces the same rule; this only decides which controls are shown.
  const viewerRole = String(userRole || user?.role || '').trim().toUpperCase();
  const isGroupMD = viewerRole === 'MD' || viewerRole === 'ADMIN' || viewerRole === 'GLOBAL MANAGING DIRECTOR';
  const canEditRecords = isGroupMD || viewerRole === 'CEO';

  const selectedCompanyName = typeof selectedCompany === 'object' ? (selectedCompany?.name || selectedCompany?.id || '') : (selectedCompany || '');

  // Helper to normalize employee fields and map DB snake_case to frontend camelCase
  const normalizeEmployee = (emp) => {
    if (!emp) return {};
    const rawBasic = emp.basicSalary !== undefined ? emp.basicSalary : (emp.monthly_salary || emp.basic_salary || '');
    const basicNum = Number(rawBasic || 0);

    return {
      ...emp,
      basicSalary: basicNum > 0 ? basicNum : '',
      panNumber: emp.panNumber !== undefined ? emp.panNumber : (emp.pan_number || ''),
      aadharNumber: emp.aadharNumber !== undefined ? emp.aadharNumber : (emp.aadhar_number || ''),
      bankName: emp.bankName !== undefined ? emp.bankName : (emp.bank_name || ''),
      accountNumber: emp.accountNumber !== undefined ? emp.accountNumber : (emp.account_number || ''),
      ifscCode: emp.ifscCode !== undefined ? emp.ifscCode : (emp.ifsc_code || ''),
      dob: emp.dob || emp.date_of_birth || '',
      gender: emp.gender || '',
      bloodGroup: emp.bloodGroup || emp.blood_group || '',
      emergencyContactName: emp.emergencyContactName || emp.emergency_contact_name || '',
      emergencyContactPhone: emp.emergencyContactPhone || emp.emergency_contact_phone || '',
      esiNumber: emp.esiNumber || emp.esi_number || '',
      reportingManager: emp.reportingManager || emp.reporting_manager || '',
      hra: Number(emp.hra || 0),
      allowances: Number(emp.allowances || 0),
      deductions: Number(emp.deductions || 0),
      joiningDate: emp.joiningDate || emp.joining_date || '',
      address: emp.address || '',
      profile_image: emp.profile_image || emp.avatar || emp.photo || ''
    };
  };

  useEffect(() => {
    let isMounted = true;
    const fetchEmployees = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('http://localhost:5000/api/employees', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 401) {
          alert("Session expired or unauthorized. Please login again.");
          return;
        }

        const data = await response.json();
        if (isMounted && response.ok && Array.isArray(data)) {
          const cleanData = data.filter(emp => {
            const name = (emp.name || '').toLowerCase();
            if (name.includes('basker')) return false;
            return true;
          }).map(normalizeEmployee);
          setEmployees(cleanData);
        } else if (isMounted) {
          setEmployees([]);
        }
      } catch (err) {
        console.error('Error fetching employees:', err);
        if (isMounted) setEmployees([]);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchEmployees();

    return () => { isMounted = false; };
  }, []);

  const getDisplayEmployeeId = (emp) => {
    if (!emp) return 'EMP-001';
    if (emp.emp_code) return emp.emp_code;
    if (emp.employee_id) return emp.employee_id;
    if (emp.employeeCode) return emp.employeeCode;
    
    const rawId = emp.id || emp._id;
    if (!rawId) return 'EMP-001';
    const num = parseInt(rawId, 10);
    return !isNaN(num) ? `EMP-${String(num).padStart(3, '0')}` : rawId;
  };

  const getMappedEmployeeName = (emp) => {
    if (!emp) return 'Unnamed Employee';
    const email = (emp.email || '').toLowerCase();
    const code = (emp.emp_code || emp.employee_id || '').toLowerCase();
    if (email === 'gowtham@storiesbyvarnam.com' || code === 'fto-004') {
      return 'Gowtham Sethupathi A';
    }
    return emp.name || 'Unnamed Employee';
  };

  const getMappedDesignation = (emp) => {
    if (emp.role && emp.role !== 'EMPLOYEE' && emp.role.trim() !== '') return emp.role;
    if (emp.designation && emp.designation.trim() !== '') return emp.designation;
    return 'Employee';
  };

  const getMappedDepartment = (emp) => {
    if (emp.department && emp.department.trim() !== '' && emp.department.trim().toLowerCase() !== 'general') return emp.department;
    return 'Not assigned';
  };

  // YYYY-MM-DD for <input type="date">, from ISO strings or DD/MM/YYYY
  const toInputDate = (v) => {
    if (!v) return '';
    const s = String(v);
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : '';
  };

  const formatDisplayDate = (v) => {
    const d = toInputDate(v);
    if (!d) return v ? String(v) : '';
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const rupees = (n) => (Number(n) > 0 ? `₹${Number(n).toLocaleString('en-IN')}` : '');

  const PRIVILEGED = ['MD', 'CEO', 'HR', 'ADMIN'];
  const isPrivilegedRole = (r) => PRIVILEGED.some(p => String(r || '').toUpperCase().includes(p));

  // Key administrative fields that should not stay blank
  const getMissingFields = (emp) => {
    if (!emp) return [];
    const missing = [];
    if (!emp.department || emp.department.trim().toLowerCase() === 'general') missing.push('Department');
    if (!(Number(emp.basicSalary) > 0)) missing.push('Basic salary');
    if (!emp.bankName || !emp.accountNumber || !emp.ifscCode) missing.push('Bank details');
    if (!toInputDate(emp.joiningDate)) missing.push('Joining date');
    if (!emp.email || /@pending\.local$/i.test(emp.email)) missing.push('Login email');
    return missing;
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const updatedEmp = normalizeEmployee({ 
          ...selectedEmployee, 
          profile_image: reader.result,
          avatar: reader.result 
        });
        setSelectedEmployee(updatedEmp);
        setEditFormData(updatedEmp);
        setEmployees(prev => prev.map(emp => 
          ((emp.id || emp._id) === (updatedEmp.id || updatedEmp._id)) ? updatedEmp : emp
        ));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEditClick = () => {
    setSaveError('');
    setSaveNotice('');
    setIsEditing(true);
    const initial = ({
      id: selectedEmployee.id || selectedEmployee._id,
      emp_code: selectedEmployee.emp_code || selectedEmployee.employee_id || getDisplayEmployeeId(selectedEmployee),
      name: getMappedEmployeeName(selectedEmployee),
      email: selectedEmployee.email || '',
      role: getMappedDesignation(selectedEmployee),
      department: (selectedEmployee.department && selectedEmployee.department.trim().toLowerCase() !== 'general') ? selectedEmployee.department : '',
      joiningDate: toInputDate(selectedEmployee.joiningDate || selectedEmployee.joining_date),
      employmentType: selectedEmployee.employmentType || 'Full-Time / Permanent',
      manager: selectedEmployee.manager || '',
      workLocation: selectedEmployee.workLocation || '',
      phone: selectedEmployee.phone || '',
      altPhone: selectedEmployee.altPhone || '',
      dob: toInputDate(selectedEmployee.dob),
      gender: selectedEmployee.gender || '',
      bloodGroup: selectedEmployee.bloodGroup || '',
      emergencyContactName: selectedEmployee.emergencyContactName || '',
      emergencyContactPhone: selectedEmployee.emergencyContactPhone || '',
      esiNumber: selectedEmployee.esiNumber || '',
      reportingManager: selectedEmployee.reportingManager || '',
      maritalStatus: selectedEmployee.maritalStatus || '',
      panNumber: selectedEmployee.panNumber || '',
      aadharNumber: selectedEmployee.aadharNumber || selectedEmployee.aadhar_number || '',
      address: selectedEmployee.address || '',
      basicSalary: selectedEmployee.basicSalary || '',
      hra: Number(selectedEmployee.hra) > 0 ? selectedEmployee.hra : '',
      allowances: Number(selectedEmployee.allowances) > 0 ? selectedEmployee.allowances : '',
      deductions: Number(selectedEmployee.deductions) > 0 ? selectedEmployee.deductions : '',
      bankName: selectedEmployee.bankName || '',
      accountNumber: selectedEmployee.accountNumber || '',
      ifscCode: selectedEmployee.ifscCode || '',
      branch: selectedEmployee.branch || '',
      profile_image: selectedEmployee.profile_image || selectedEmployee.avatar || ''
    });
    editBaseline.current = initial;
    setEditFormData(initial);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditFormData({});
    setSaveError('');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveEmployee = async () => {
    const empId = editFormData.id || editFormData._id;
    const f = editFormData;
    const trim = (v) => (typeof v === 'string' ? v.trim() : v);
    if (!trim(f.name)) { setSaveError('Employee name is required.'); return; }
    if (!trim(f.email)) { setSaveError('Official email is required.'); return; }

    // Only the fields the backend stores, under its own column names
    const all = {
      name: trim(f.name),
      email: trim(f.email),
      department: trim(f.department) || '',
      reporting_manager: trim(f.reportingManager) || '',
      joining_date: f.joiningDate || '',
      monthly_salary: f.basicSalary === '' ? 0 : f.basicSalary,
      hra: f.hra === '' ? 0 : f.hra,
      allowances: f.allowances === '' ? 0 : f.allowances,
      deductions: f.deductions === '' ? 0 : f.deductions,
      phone: trim(f.phone) || '',
      address: trim(f.address) || '',
      dob: f.dob || '',
      gender: trim(f.gender) || '',
      blood_group: trim(f.bloodGroup) || '',
      emergency_contact_name: trim(f.emergencyContactName) || '',
      emergency_contact_phone: trim(f.emergencyContactPhone) || '',
      pan_number: trim(f.panNumber) || '',
      aadhar_number: trim(f.aadharNumber) || '',
      esi_number: trim(f.esiNumber) || '',
      bank_name: trim(f.bankName) || '',
      account_number: trim(f.accountNumber) || '',
      ifsc_code: trim(f.ifscCode) || '',
    };
    // Send only what was actually changed, so values the form can't display are never overwritten.
    // (Designation doubles as the access role, which makes this especially important for it.)
    const FORM_KEY = { reporting_manager: 'reportingManager', joining_date: 'joiningDate', monthly_salary: 'basicSalary', blood_group: 'bloodGroup',
      emergency_contact_name: 'emergencyContactName', emergency_contact_phone: 'emergencyContactPhone', pan_number: 'panNumber', aadhar_number: 'aadharNumber',
      esi_number: 'esiNumber', bank_name: 'bankName', account_number: 'accountNumber', ifsc_code: 'ifscCode' };
    const base = editBaseline.current || {};
    const payload = {};
    Object.keys(all).forEach((k) => {
      const fk = FORM_KEY[k] || k;
      if (String(trim(f[fk]) ?? '') !== String(trim(base[fk]) ?? '')) payload[k] = all[k];
    });
    if (trim(f.role) && trim(f.role) !== trim(base.role)) payload.role = trim(f.role);
    if (Object.keys(payload).length === 0) { setIsEditing(false); setSaveError(''); setSaveNotice('No changes to save.'); return; }

    setSaving(true);
    setSaveError('');
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:5000/api/employees/${empId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = Array.isArray(body.details) ? body.details.join('; ') : (body.details || '');
        setSaveError(`${body.error || `Changes could not be saved (error ${response.status}).`}${detail ? ` ${detail}` : ''}`);
        return;
      }
      const saved = body.employee || { ...selectedEmployee, ...payload };
      const finalEmp = normalizeEmployee({ ...saved, profile_image: selectedEmployee.profile_image || saved.profile_image });
      setSelectedEmployee(finalEmp);
      setEmployees(prev => prev.map(emp => ((emp.id || emp._id) === empId ? finalEmp : emp)));
      setIsEditing(false);
      setSaveNotice('Changes saved.');
    } catch (err) {
      console.error('Error updating employee:', err);
      setSaveError('The server could not be reached, so nothing was saved. Check that the backend is running and try again.');
    } finally {
      setSaving(false);
    }
  };

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const currentRole = (userRole || user?.role || '').trim().toUpperCase();
      if (currentRole === 'RESERVATIONS' || currentRole === 'EMPLOYEE') {
        const currentEmail = (user?.email || '').trim().toLowerCase();
        const empEmail = (emp.email || '').trim().toLowerCase();
        return currentEmail !== '' && empEmail === currentEmail;
      }

      const selComp = selectedCompanyName.trim().toLowerCase();
      const empCompName = (emp.company_name || emp.company || '').trim().toLowerCase();
      const empEmail = (emp.email || '').trim().toLowerCase();
      const empName = getMappedEmployeeName(emp).toLowerCase();

      const matchesCompany = (!selectedCompanyName || selComp === 'all companies') || (() => {
        if (selComp.includes('ram reddy') || selComp.includes('rrd')) {
          return empCompName.includes('ram reddy') || empCompName.includes('rrd') || empEmail.includes('ramreddydevelopers.com');
        }
        if (selComp.includes('fractio')) {
          return empCompName.includes('fractio') || empEmail.includes('fractio.co.in');
        }
        return !!empCompName && (empCompName.includes(selComp) || selComp.includes(empCompName));
      })();

      const displayId = getDisplayEmployeeId(emp).toLowerCase();
      const matchesSearch = empName.includes(searchTerm.toLowerCase()) ||
        displayId.includes(searchTerm.toLowerCase()) ||
        empEmail.includes(searchTerm.toLowerCase());

      return matchesCompany && matchesSearch;
    });
  }, [employees, userRole, user?.role, user?.email, selectedCompanyName, searchTerm]);

  // "Edit" from the directory row opens the profile straight into edit mode
  useEffect(() => {
    if (pendingEdit && selectedEmployee) {
      setPendingEdit(false);
      handleEditClick();
    }
  }, [pendingEdit, selectedEmployee]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div>
        <PageHeader title="Employee directory" subtitle="People records across your companies." />
        <Panel flush>
          <EmptyState icon={<Users size={20} />} title="Loading employees" text="Fetching the latest records from the database…" />
        </Panel>
      </div>
    );
  }

  if (selectedEmployee) {
    const employeeAvatar = selectedEmployee.profile_image || selectedEmployee.avatar || selectedEmployee.photo;
    const isMD = canEditRecords; // MD/Admin group-wide, CEO within their company
    const missingFields = getMissingFields(selectedEmployee);
    const roleLocked = !isGroupMD && isPrivilegedRole(selectedEmployee.role);
    const net = (Number(editFormData.basicSalary) || 0) + (Number(editFormData.hra) || 0) + (Number(editFormData.allowances) || 0) - Math.abs(Number(editFormData.deductions) || 0);
    const viewNet = (Number(selectedEmployee.basicSalary) || 0) + (Number(selectedEmployee.hra) || 0) + (Number(selectedEmployee.allowances) || 0) - Math.abs(Number(selectedEmployee.deductions) || 0);

    // Presentational helper: shows an input while editing, a read-only value otherwise.
    // Binds to the same editFormData[name] + handleInputChange as before.
    const renderField = (label, name, displayValue, { type = 'text', placeholder, money = false, readOnly = false, hint } = {}) => (
      <div>
        {isEditing && !readOnly ? (
          <Field label={label} hint={hint}>
            <input
              className={`hr-input${money ? ' num' : ''}`}
              type={type}
              name={name}
              value={editFormData[name] || ''}
              onChange={handleInputChange}
              placeholder={placeholder}
              min={type === 'number' ? 0 : undefined}
              step={type === 'number' ? 'any' : undefined}
            />
          </Field>
        ) : (
          <DataItem label={label} value={displayValue} money={money} />
        )}
        {isEditing && readOnly && hint && <div className="hr-hint" style={{ display: 'block', marginTop: 4 }}>{hint}</div>}
      </div>
    );

    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <button type="button" className="hr-back" style={{ margin: 0 }} onClick={() => { setSelectedEmployee(null); setIsEditing(false); setSaveError(''); setSaveNotice(''); }}>
            <ArrowLeft size={15} /> Back to directory
          </button>

          {isMD && (
            <div className="hr-page-actions">
              {!isEditing ? (
                <button type="button" className="hr-btn hr-btn-primary" onClick={handleEditClick}>
                  <Edit2 size={14} /> Edit profile and salary
                </button>
              ) : (
                <>
                  <button type="button" className="hr-btn hr-btn-secondary" onClick={handleCancelEdit} disabled={saving}>
                    <X size={14} /> Cancel
                  </button>
                  <button type="button" className="hr-btn hr-btn-success" onClick={handleSaveEmployee} disabled={saving}>
                    <Save size={14} /> {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {saveError && (
          <div className="hr-form-alert is-error" role="alert">
            <AlertCircle size={16} /> <div>{saveError}</div>
          </div>
        )}
        {!isEditing && saveNotice && (
          <div className="hr-form-alert is-success" role="status">
            <CheckCircle2 size={16} /> <div>{saveNotice}</div>
            <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => setSaveNotice('')}>Dismiss</button>
          </div>
        )}
        {canEditRecords && !isEditing && missingFields.length > 0 && (
          <div className="hr-form-alert is-warning">
            <AlertCircle size={16} />
            <div><strong>Profile incomplete.</strong> Not yet entered: {missingFields.join(', ')}.</div>
            <button type="button" className="hr-btn hr-btn-soft hr-btn-sm" onClick={handleEditClick}><Edit2 size={13} /> Fill in now</button>
          </div>
        )}

        <section className="hr-panel" style={isEditing ? { borderColor: 'var(--primary)', boxShadow: '0 0 0 3px rgba(43,80,200,.08)' } : undefined}>
          <div className="hr-profile-head">
            <div className="hr-avatar-edit">
              <span className="hr-avatar" style={{ width: 84, height: 84, fontSize: 30, border: '3px solid var(--primary-100)' }}>
                {employeeAvatar ? (
                  <img src={employeeAvatar} alt={getMappedEmployeeName(selectedEmployee)} />
                ) : (
                  <span>{getMappedEmployeeName(selectedEmployee).charAt(0).toUpperCase()}</span>
                )}
              </span>
              {(isMD || isEditing) && (
                <label htmlFor="emp-profile-upload" className="hr-avatar-upload" title="Upload employee photo">
                  <Camera size={14} />
                </label>
              )}
              <input
                id="emp-profile-upload"
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleImageUpload}
              />
            </div>

            <div style={{ flex: 1, minWidth: 220 }}>
              {isEditing ? (
                <input
                  className="hr-input"
                  style={{ fontSize: 18, fontWeight: 600, height: 42, maxWidth: 420 }}
                  type="text"
                  name="name"
                  value={editFormData.name || ''}
                  onChange={handleInputChange}
                  placeholder="Employee name"
                />
              ) : (
                <h1 className="hr-profile-name">{getMappedEmployeeName(selectedEmployee)}</h1>
              )}
              <div className="hr-profile-meta">
                <StatusPill tone="info" dot={false}>{getMappedDesignation(selectedEmployee)}</StatusPill>
                <span>{selectedEmployee.company_name || selectedEmployee.company || 'N/A'}</span>
                <StatusPill tone="neutral" dot={false}><span className="num">ID {getDisplayEmployeeId(selectedEmployee)}</span></StatusPill>
              </div>
            </div>

            {isEditing && <StatusPill tone="warning">Editing</StatusPill>}
          </div>

          <div className="hr-profile-section">
            <h3 className="hr-profile-section-title"><Briefcase size={16} /> Employment</h3>
            <div className="hr-dl">
              {renderField('Official email', 'email', selectedEmployee.email, { placeholder: 'Enter email' })}
              {renderField('Designation', 'role', getMappedDesignation(selectedEmployee), { placeholder: 'Enter designation', readOnly: roleLocked, hint: roleLocked ? 'Access roles (MD, CEO, HR, Admin) can only be changed by the group MD.' : undefined })}
              {renderField('Department', 'department', getMappedDepartment(selectedEmployee), { placeholder: 'Enter department' })}
              {renderField('Reporting manager', 'reportingManager', selectedEmployee.reportingManager, { placeholder: 'Enter reporting manager' })}
              {renderField('Joining date', 'joiningDate', formatDisplayDate(selectedEmployee.joiningDate), { type: 'date' })}
            </div>
          </div>

          <div className="hr-profile-section">
            <h3 className="hr-profile-section-title"><Wallet size={16} /> Salary and compensation</h3>
            <div className="hr-dl">
              {renderField('Basic salary (₹ / month)', 'basicSalary', rupees(selectedEmployee.basicSalary), { type: 'number', placeholder: 'e.g. 25000', money: true })}
              {renderField('HRA (₹ / month)', 'hra', rupees(selectedEmployee.hra), { type: 'number', placeholder: '0', money: true })}
              {renderField('Allowances (₹ / month)', 'allowances', rupees(selectedEmployee.allowances), { type: 'number', placeholder: '0', money: true })}
              {renderField('Deductions (₹ / month)', 'deductions', rupees(selectedEmployee.deductions), { type: 'number', placeholder: '0', money: true })}
              <DataItem label="Net monthly pay" value={(isEditing ? net : viewNet) > 0 ? `₹${(isEditing ? net : viewNet).toLocaleString('en-IN')}` : ''} money />
            </div>
          </div>

          <div className="hr-profile-section">
            <h3 className="hr-profile-section-title"><User size={16} /> Personal and contact</h3>
            <div className="hr-dl">
              {renderField('Mobile number', 'phone', selectedEmployee.phone, { placeholder: 'Enter mobile number' })}
              {renderField('Date of birth', 'dob', formatDisplayDate(selectedEmployee.dob), { type: 'date' })}
              {renderField('Gender', 'gender', selectedEmployee.gender, { placeholder: 'Enter gender' })}
              {renderField('Blood group', 'bloodGroup', selectedEmployee.bloodGroup, { placeholder: 'e.g. O+ve' })}
              {renderField('Emergency contact name', 'emergencyContactName', selectedEmployee.emergencyContactName, { placeholder: 'Enter contact name' })}
              {renderField('Emergency contact phone', 'emergencyContactPhone', selectedEmployee.emergencyContactPhone, { placeholder: 'Enter contact phone' })}
              {renderField('Address', 'address', selectedEmployee.address, { placeholder: 'Enter residential address' })}
            </div>
          </div>

          <div className="hr-profile-section">
            <h3 className="hr-profile-section-title"><Shield size={16} /> Statutory and government IDs</h3>
            <div className="hr-dl">
              {renderField('PAN number', 'panNumber', selectedEmployee.panNumber, { placeholder: 'ABCDE1234F' })}
              {renderField('Aadhaar number', 'aadharNumber', selectedEmployee.aadharNumber, { placeholder: 'Enter Aadhaar number' })}
              {renderField('ESI number', 'esiNumber', selectedEmployee.esiNumber, { placeholder: 'Enter ESI number' })}
            </div>
          </div>

          <div className="hr-profile-section">
            <h3 className="hr-profile-section-title"><CreditCard size={16} /> Bank account</h3>
            <div className="hr-dl">
              {renderField('Bank name', 'bankName', selectedEmployee.bankName, { placeholder: 'Enter bank name' })}
              {renderField('Account number', 'accountNumber', selectedEmployee.accountNumber, { placeholder: 'Enter account number' })}
              {renderField('IFSC code', 'ifscCode', selectedEmployee.ifscCode, { placeholder: 'e.g. HDFC0001234' })}
            </div>
          </div>
        </section>
      </div>
    );
  }

  // Visual-only: show a Company column when looking across the whole group
  const showCompanyCol = !selectedCompanyName || selectedCompanyName.trim().toLowerCase() === 'all companies';
  const colCount = showCompanyCol ? 6 : 5;

  return (
    <div>
      <PageHeader
        title="Employee directory"
        subtitle={showCompanyCol ? 'Everyone across the group.' : `Everyone at ${selectedCompanyName}.`}
        onBack={handleBackToGroupOverview}
        backLabel="Back to dashboard"
      />

      <Panel flush>
        <div className="hr-toolbar">
          <div className="hr-input-icon hr-search">
            <Search size={15} />
            <input
              type="text"
              className="hr-input"
              placeholder="Search by name, ID or email"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="hr-toolbar-spacer" />
          <span className="hr-count">{filteredEmployees.length} {filteredEmployees.length === 1 ? 'person' : 'people'}</span>
        </div>

        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>ID</th>
                <th>Designation</th>
                <th>Department</th>
                {showCompanyCol && <th>Company</th>}
                <th className="is-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <TableEmpty
                  colSpan={colCount}
                  icon={<Search size={20} />}
                  title="No employees match"
                  text={searchTerm ? 'Try a different name, ID or email.' : 'No employees are on record for this company view.'}
                />
              ) : (
                filteredEmployees.map((emp, index) => {
                  const empAvatar = emp.profile_image || emp.avatar || emp.photo;
                  return (
                    <tr key={emp.id || emp._id || index} style={{ cursor: 'pointer' }} onClick={() => setSelectedEmployee(emp)}>
                      <td>
                        <div className="hr-cell-person">
                          <Avatar name={getMappedEmployeeName(emp)} src={empAvatar} size={36} />
                          <div style={{ minWidth: 0 }}>
                            <div className="hr-cell-person-name">{getMappedEmployeeName(emp)}</div>
                            <div className="hr-cell-person-sub">{emp.email || 'No email'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{getDisplayEmployeeId(emp)}</td>
                      <td>{getMappedDesignation(emp)}</td>
                      <td>
                        {getMappedDepartment(emp)}
                        {canEditRecords && getMissingFields(emp).length > 0 && (
                          <span className="hr-incomplete" title={`Not yet entered: ${getMissingFields(emp).join(', ')}`}>Incomplete</span>
                        )}
                      </td>
                      {showCompanyCol && <td className="is-muted" style={{ whiteSpace: 'nowrap' }}>{emp.company_name || emp.company || '-'}</td>}
                      <td className="is-actions">
                        <button
                          type="button"
                          className="hr-btn hr-btn-soft hr-btn-sm"
                          onClick={(e) => { e.stopPropagation(); setSelectedEmployee(emp); }}
                        >
                          <Eye size={14} /> View profile
                        </button>
                        {canEditRecords && (
                          <button
                            type="button"
                            className="hr-btn hr-btn-ghost hr-btn-sm"
                            style={{ marginLeft: 6 }}
                            title="Edit profile and salary"
                            onClick={(e) => { e.stopPropagation(); setSelectedEmployee(emp); setPendingEdit(true); }}
                          >
                            <Edit2 size={14} /> Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export default Employees;
