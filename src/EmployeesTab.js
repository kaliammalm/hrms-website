import React, { useState, useEffect } from 'react';
import Employees from './Employees';
import { ArrowLeft, Briefcase, User, Shield, CreditCard, Camera, Wallet } from 'lucide-react';
import { StatusPill, DataItem } from './ui';

function EmployeesTab({ userRole, handleBackToGroupOverview, user, selectedCompany, companies }) {
  const [selectedEmployee, setSelectedEmployee] = useState(() => {
    try {
      const saved = localStorage.getItem('active_employee_profile');
      return saved && saved !== 'undefined' ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  const selectedCompanyName = typeof selectedCompany === 'object' ? selectedCompany?.name : selectedCompany;

  useEffect(() => {
    try {
      if (selectedEmployee) {
        localStorage.setItem('active_employee_profile', JSON.stringify(selectedEmployee));
      } else {
        localStorage.removeItem('active_employee_profile');
      }
    } catch (e) {
      console.error('LocalStorage error:', e);
    }
  }, [selectedEmployee]);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const updatedEmp = { 
          ...selectedEmployee, 
          profilePic: reader.result,
          avatar: reader.result 
        };
        setSelectedEmployee(updatedEmp);
        localStorage.setItem('active_employee_profile', JSON.stringify(updatedEmp));
      };
      reader.readAsDataURL(file);
    }
  };

  if (selectedEmployee) {
    const avatarSrc = selectedEmployee.profilePic || selectedEmployee.avatar;
    return (
      <div>
        <button
          type="button"
          className="hr-back"
          onClick={() => {
            setSelectedEmployee(null);
            localStorage.removeItem('active_employee_profile');
          }}
        >
          <ArrowLeft size={15} /> Back to directory
        </button>

        <section className="hr-panel">
          <div className="hr-profile-head">
            <div className="hr-avatar-edit">
              <span className="hr-avatar" style={{ width: 84, height: 84, fontSize: 30, border: '3px solid var(--primary-100)' }}>
                {avatarSrc ? (
                  <img src={avatarSrc} alt={selectedEmployee.name || 'Employee'} />
                ) : (
                  <span>{selectedEmployee.name ? selectedEmployee.name.charAt(0).toUpperCase() : 'E'}</span>
                )}
              </span>
              <label htmlFor="profile-upload" className="hr-avatar-upload" title="Upload photo">
                <Camera size={14} />
              </label>
              <input id="profile-upload" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
            </div>

            <div style={{ flex: 1, minWidth: 220 }}>
              <h1 className="hr-profile-name">{selectedEmployee.name || 'Employee Name'}</h1>
              <div className="hr-profile-meta">
                <StatusPill tone="info" dot={false}>{selectedEmployee.role || selectedEmployee.designation || 'Employee'}</StatusPill>
                <span>{selectedEmployee.company_name || selectedCompanyName}</span>
                <StatusPill tone="neutral" dot={false}><span className="num">ID {selectedEmployee.emp_code || selectedEmployee.employee_id || selectedEmployee.id || '—'}</span></StatusPill>
              </div>
            </div>
          </div>

          <div className="hr-profile-section">
            <h3 className="hr-profile-section-title"><Briefcase size={16} /> Employment</h3>
            <div className="hr-dl">
              <DataItem label="Official email" value={selectedEmployee.email || ''} />
              <DataItem label="Designation" value={selectedEmployee.role || selectedEmployee.designation || ''} />
              <DataItem label="Department" value={selectedEmployee.department || ''} />
            </div>
          </div>

          <div className="hr-profile-section">
            <h3 className="hr-profile-section-title"><Wallet size={16} /> Salary and payroll</h3>
            <div className="hr-dl">
              <DataItem label="Basic salary" money value={selectedEmployee.basicSalary ? `₹${selectedEmployee.basicSalary}` : ''} />
              <DataItem label="HRA and allowances" value={selectedEmployee.hra ? `₹${selectedEmployee.hra}` : ''} />
              <DataItem label="Net salary" money value={selectedEmployee.netSalary ? `₹${selectedEmployee.netSalary}` : ''} />
            </div>
          </div>

          <div className="hr-profile-section">
            <h3 className="hr-profile-section-title"><User size={16} /> Personal and contact</h3>
            <div className="hr-dl">
              <DataItem label="Mobile number" value={selectedEmployee.phone} />
              <DataItem label="Residential address" value={selectedEmployee.address} />
            </div>
          </div>

          <div className="hr-profile-section">
            <h3 className="hr-profile-section-title"><Shield size={16} /> Statutory and government IDs</h3>
            <div className="hr-dl">
              <DataItem label="PAN number" value={selectedEmployee.panNumber} />
              <DataItem label="Aadhaar number" value="[Aadhaar Redacted]" />
            </div>
          </div>

          <div className="hr-profile-section">
            <h3 className="hr-profile-section-title"><CreditCard size={16} /> Bank account</h3>
            <div className="hr-dl">
              <DataItem label="Bank name" value={selectedEmployee.bankName} />
              <DataItem label="Account number" value={selectedEmployee.accountNumber} />
              <DataItem label="IFSC code" value={selectedEmployee.ifscCode} />
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="hr-emp-tab">
      {handleBackToGroupOverview && (
        <button type="button" className="hr-back" onClick={handleBackToGroupOverview}>
          <ArrowLeft size={15} /> Back to group overview
        </button>
      )}

      <Employees 
        user={user} 
        userRole={userRole}
        selectedCompany={selectedCompany} 
        companies={companies} 
        onViewDetails={(emp) => setSelectedEmployee(emp)}
      />
    </div>
  );
}

export default EmployeesTab;
