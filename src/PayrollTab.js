import React, { useState, useEffect, useCallback } from 'react';
import { Search, Wallet, Users, CheckCircle2, Clock, PlayCircle, Pencil, FileText } from 'lucide-react';
import { PageHeader, Panel, KpiStrip, Kpi, StatusPill, Avatar, TableEmpty, Modal, Field, formatINR } from './ui';

function PayrollTab({ selectedCompany, onBack }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [payrollData, setPayrollData] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState('2026-10');
  
  const [editingEmp, setEditingEmp] = useState(null);
  const [editForm, setEditForm] = useState({ basic: 0, hra: 0, allowances: 0, deductions: 0 });

  const fetchEmployees = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`https://hrms-backend-v3.onrender.com/api/employees?month=${selectedMonth}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const savedMonthData = JSON.parse(localStorage.getItem(`payroll_${selectedCompany}_${selectedMonth}`) || '{}');

      if (response.ok) {
        const data = await response.json();
        const filtered = data.filter(emp => !selectedCompany || emp.companyName === selectedCompany || emp.company_name === selectedCompany);
        
        const formatted = filtered.map(emp => {
          const empId = emp.id || emp._id;
          const savedEmp = savedMonthData[empId] || {};

          const defaultBasic = Number(emp.monthly_salary || emp.basic_salary || emp.basic || emp.salary || 0);
          
          const basicSalary = Number(savedEmp.basic !== undefined ? savedEmp.basic : defaultBasic);
          const hra = Number(savedEmp.hra !== undefined ? savedEmp.hra : (emp.hra || 0));
          const allowances = Number(savedEmp.allowances !== undefined ? savedEmp.allowances : (emp.allowances || 0));
          const deductions = Number(savedEmp.deductions !== undefined ? savedEmp.deductions : (emp.deductions || 0));
          
          const calculatedNet = basicSalary + hra + allowances - Math.abs(deductions);
          const netPay = Number(savedEmp.net !== undefined ? savedEmp.net : calculatedNet);
          const status = savedEmp.status || 'Pending';

          return {
            id: empId,
            name: emp.name,
            dept: emp.department || 'General',
            basic: basicSalary,
            hra: hra,
            allowances: allowances,
            deductions: deductions,
            net: netPay,
            status: status
          };
        });

        setPayrollData(formatted);
      }
    } catch (err) {
      console.error('Error fetching payroll employees:', err);
    }
  }, [selectedCompany, selectedMonth]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const saveMonthData = (updatedData) => {
    const dataMap = {};
    updatedData.forEach(emp => {
      dataMap[emp.id] = {
        name: emp.name, // Saved name for cross-matching
        basic: emp.basic,
        hra: emp.hra,
        allowances: emp.allowances,
        deductions: emp.deductions,
        net: emp.net,
        status: emp.status
      };
    });
    localStorage.setItem(`payroll_${selectedCompany}_${selectedMonth}`, JSON.stringify(dataMap));
  };

  const handleOpenEdit = (emp) => {
    setEditingEmp(emp);
    setEditForm({
      basic: emp.basic,
      hra: emp.hra,
      allowances: emp.allowances,
      deductions: emp.deductions
    });
  };

  const handleSaveEdit = () => {
    const basic = Number(editForm.basic) || 0;
    const hra = Number(editForm.hra) || 0;
    const allowances = Number(editForm.allowances) || 0;
    const deductions = Number(editForm.deductions) || 0;
    const net = basic + hra + allowances - Math.abs(deductions);

    const updated = payrollData.map(emp => {
      if (emp.id === editingEmp.id) {
        return { ...emp, basic, hra, allowances, deductions, net };
      }
      return emp;
    });

    setPayrollData(updated);
    saveMonthData(updated);
    setEditingEmp(null);
    alert(`Salary updated successfully for ${editingEmp.name} for ${selectedMonth}!`);
  };

  const handleRunPayroll = async () => {
    try {
      const hasValidSalary = payrollData.some(emp => emp.basic > 0);
      if (!hasValidSalary) {
        alert('Cannot run payroll. No employees have basic salary details configured!');
        return;
      }

      const updated = payrollData.map(emp => emp.basic > 0 ? { ...emp, status: 'Paid' } : emp);
      setPayrollData(updated);
      saveMonthData(updated);

      alert(`Payroll successfully run for ${selectedCompany} (${selectedMonth})!`);
    } catch (err) {
      console.error('Error running payroll:', err);
    }
  };

  const handleProcess = async (id, basicSalary) => {
    if (basicSalary <= 0) {
      alert('Cannot process payroll. Employee basic salary is not configured (₹0).');
      return;
    }

    try {
      const updated = payrollData.map(emp => emp.id === id ? { ...emp, status: 'Paid' } : emp);
      setPayrollData(updated);
      saveMonthData(updated);

      alert(`Payroll processed successfully for ${selectedMonth}!`);
    } catch (err) {
      console.error('Error processing payroll:', err);
    }
  };

  const filteredEmployees = payrollData.filter(emp => 
    emp.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    emp.dept.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Visual-only month summary derived from rows already in state
  const totalNet = payrollData.reduce((sum, e) => sum + (Number(e.net) || 0), 0);
  const paidCount = payrollData.filter(e => e.status === 'Paid').length;
  const pendingCount = payrollData.length - paidCount;
  const monthLabel = (() => {
    const [yr, mth] = String(selectedMonth).split('-');
    const d = new Date(parseInt(yr, 10), parseInt(mth, 10) - 1, 1);
    return isNaN(d) ? selectedMonth : d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  })();

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle={`Salary processing for ${selectedCompany}.`}
        onBack={onBack}
        backLabel="Back to group overview"
        actions={
          <>
            <input
              type="month"
              aria-label="Payroll month"
              className="hr-input"
              style={{ width: 170 }}
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            />
            <button type="button" className="hr-btn hr-btn-primary" onClick={handleRunPayroll}>
              <PlayCircle size={16} /> Run payroll for {monthLabel}
            </button>
          </>
        }
      />

      <KpiStrip>
        <Kpi icon={<Wallet size={16} />} label="Net payout" value={formatINR(totalNet)} note={monthLabel} />
        <Kpi icon={<Users size={16} />} label="Employees" value={payrollData.length} note="On this month's sheet" />
        <Kpi icon={<CheckCircle2 size={16} />} label="Paid" value={paidCount} tone="success" note="Processed" />
        <Kpi icon={<Clock size={16} />} label="Pending" value={pendingCount} tone="warning" note="Awaiting processing" />
      </KpiStrip>

      <Panel flush>
        <div className="hr-toolbar">
          <div className="hr-input-icon hr-search">
            <Search size={15} />
            <input
              type="text"
              className="hr-input"
              placeholder="Search employee or department"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="hr-toolbar-spacer" />
          <span className="hr-count">{filteredEmployees.length} of {payrollData.length} employees</span>
        </div>

        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="is-num">Basic</th>
                <th className="is-num">HRA</th>
                <th className="is-num">Allowances</th>
                <th className="is-num">Deductions</th>
                <th className="is-num">Net pay</th>
                <th>Status</th>
                <th className="is-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <TableEmpty
                  colSpan={8}
                  icon={<Wallet size={20} />}
                  title={`No employees on the ${monthLabel} sheet`}
                  text="Try another month, or clear the search."
                />
              ) : (
                filteredEmployees.map((emp) => (
                  <tr key={emp.id}>
                    <td>
                      <div className="hr-cell-person" style={{ minWidth: 190 }}>
                        <Avatar name={emp.name} size={30} />
                        <div>
                          <div className="hr-cell-person-name">{emp.name}</div>
                          <div className="hr-cell-person-sub">{emp.dept}</div>
                        </div>
                      </div>
                    </td>
                    <td className="is-num">{formatINR(emp.basic)}</td>
                    <td className="is-num">{formatINR(emp.hra)}</td>
                    <td className="is-num">{formatINR(emp.allowances)}</td>
                    <td className="is-num" style={{ color: emp.deductions ? 'var(--danger)' : undefined }}>
                      {emp.deductions ? `−${formatINR(emp.deductions)}` : formatINR(0)}
                    </td>
                    <td className="is-num" style={{ color: 'var(--ink)', fontWeight: 600 }}>{formatINR(emp.net)}</td>
                    <td><StatusPill status={emp.status} /></td>
                    <td className="is-actions">
                      <div className="hr-row-actions">
                        <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => handleOpenEdit(emp)}>
                          <Pencil size={13} /> Edit
                        </button>
                        {emp.status === 'Paid' ? (
                          <button
                            type="button"
                            className="hr-btn hr-btn-soft hr-btn-sm"
                            onClick={() => alert(`Viewing payslip for ${emp.name} (${selectedMonth})`)}
                          >
                            <FileText size={13} /> Payslip
                          </button>
                        ) : (
                          <button type="button" className="hr-btn hr-btn-warning-soft hr-btn-sm" onClick={() => handleProcess(emp.id, emp.basic)}>
                            <PlayCircle size={13} /> Process
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {editingEmp && (
        <Modal
          title={`Edit salary: ${editingEmp.name}`}
          subtitle={`Changes apply to ${monthLabel} only.`}
          footer={
            <>
              <button type="button" className="hr-btn hr-btn-secondary" onClick={() => setEditingEmp(null)}>Cancel</button>
              <button type="button" className="hr-btn hr-btn-primary" onClick={handleSaveEdit}>Save salary</button>
            </>
          }
        >
          <div className="hr-modal-body">
            <div className="hr-form-grid">
              <Field label="Basic salary (₹)">
                <input className="hr-input num" type="number" value={editForm.basic} onChange={(e) => setEditForm({...editForm, basic: e.target.value})} />
              </Field>
              <Field label="HRA (₹)">
                <input className="hr-input num" type="number" value={editForm.hra} onChange={(e) => setEditForm({...editForm, hra: e.target.value})} />
              </Field>
              <Field label="Allowances (₹)">
                <input className="hr-input num" type="number" value={editForm.allowances} onChange={(e) => setEditForm({...editForm, allowances: e.target.value})} />
              </Field>
              <Field label="Deductions / leave fine (₹)">
                <input className="hr-input num" type="number" value={editForm.deductions} onChange={(e) => setEditForm({...editForm, deductions: e.target.value})} />
              </Field>
            </div>
            {/* Live preview of the same formula handleSaveEdit uses — display only */}
            <div className="hr-slip-net">
              <span>Net pay after saving</span>
              <strong>{formatINR((Number(editForm.basic) || 0) + (Number(editForm.hra) || 0) + (Number(editForm.allowances) || 0) - Math.abs(Number(editForm.deductions) || 0))}</strong>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default PayrollTab;
