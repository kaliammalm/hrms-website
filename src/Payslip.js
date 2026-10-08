import React, { useState, useEffect, useCallback } from 'react';
import { Eye, Download, FileText, Lock } from 'lucide-react';
import { PageHeader, Panel, StatusPill, TableEmpty, Modal } from './ui';

function Payslip({ user }) {
  const currentCompany = user?.company_name || user?.company || 'your company';
  const [payslips, setPayslips] = useState([]);
  const [selectedPayslip, setSelectedPayslip] = useState(null);

  const fetchPayslips = useCallback(async () => {
    try {
      let apiPayslips = [];
      const token = localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('access_token') || '';
      
      const response = await fetch('http://localhost:5000/api/payslips', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        apiPayslips = await response.json();
      }

      const currentUserName = (user?.name || '').trim().toLowerCase();
      const currentUserId = String(user?.id || user?._id || '');

      let localPayslipsMap = new Map();

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('payroll_')) {
          try {
            const monthData = JSON.parse(localStorage.getItem(key));
            const parts = key.split('_');
            let rawMonth = parts[parts.length - 1]; 
            const company = parts.slice(1, parts.length - 1).join(' ');

            let formattedMonth = rawMonth.replace(/,/g, '').trim();
            if (formattedMonth.includes('-')) {
              const [yr, mth] = formattedMonth.split('-');
              const dateObj = new Date(parseInt(yr, 10), parseInt(mth, 10) - 1, 1);
              if (!isNaN(dateObj)) {
                formattedMonth = dateObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });
              }
            }

            if (monthData && typeof monthData === 'object') {
              Object.keys(monthData).forEach(empKey => {
                const empRecord = monthData[empKey];
                if (empRecord && (empRecord.status === 'Paid' || empRecord.status === 'paid')) {
                  const recordName = (empRecord.name || empRecord.employee_name || empRecord.empName || '').trim().toLowerCase();
                  const recordEmpId = String(empRecord.id || empRecord.empId || empKey || '');

                  const isNameMatch = currentUserName && recordName && (recordName === currentUserName || recordName.includes(currentUserName) || currentUserName.includes(recordName));
                  const isIdMatch = currentUserId && recordEmpId && (recordEmpId === currentUserId);

                  if (isNameMatch || isIdMatch) {
                    const uniqueKey = `${formattedMonth}_${company}`;
                    localPayslipsMap.set(uniqueKey, {
                      id: `${key}_${empKey}`,
                      month: formattedMonth,
                      company: company || currentCompany,
                      netPay: Number(empRecord.net ?? empRecord.netPay ?? empRecord.net_pay ?? 0),
                      status: 'Paid',
                      basicSalary: Number(empRecord.basic ?? empRecord.basicSalary ?? empRecord.basic_salary ?? 0),
                      hra: Number(empRecord.hra ?? 0),
                      allowances: Number(empRecord.allowances ?? empRecord.special_allowances ?? 0),
                      deductions: Number(empRecord.deductions ?? 0),
                      employee_name: empRecord.name || empRecord.employee_name || empRecord.empName || user?.name || ''
                    });
                  }
                }
              });
            }
          } catch (e) {
            console.error('Error parsing local payroll storage:', e);
          }
        }
      }

      const combined = [...apiPayslips, ...Array.from(localPayslipsMap.values())];
      setPayslips(combined);
    } catch (err) {
      console.error('Error fetching payslips:', err);
    }
  }, [user, currentCompany]);

  useEffect(() => {
    fetchPayslips();
  }, [fetchPayslips]);

  const handleDownloadPDF = async (payslip) => {
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('access_token') || '';
      const response = await fetch(`http://localhost:5000/api/payslips/download/${payslip.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        alert(`Downloading payslip for ${payslip.month}...`);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Payslip_${payslip.month.replace(/\s+/g, '_')}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading:', err);
      alert(`Downloading payslip for ${payslip.month}...`);
    }
  };

  return (
    <div>
      <PageHeader
        title="My payslips"
        subtitle={`Monthly salary statements from ${currentCompany}.`}
      />

      <Panel flush>
        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Company</th>
                <th className="is-num">Net pay</th>
                <th>Status</th>
                <th className="is-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payslips.length === 0 ? (
                <TableEmpty
                  colSpan={5}
                  icon={<FileText size={20} />}
                  title="No payslips yet"
                  text="Payslips appear here once HR runs payroll for the month."
                />
              ) : (
                payslips.map(item => {
                  const netPayVal = item.netPay ?? item.net_pay ?? 0;
                  return (
                    <tr key={item.id}>
                      <td className="is-strong">{item.month}</td>
                      <td className="is-muted">{item.company || currentCompany}</td>
                      <td className="is-num" style={{ color: 'var(--ink)', fontWeight: 600 }}>₹{Number(netPayVal).toLocaleString('en-IN')}</td>
                      <td><StatusPill status={item.status || 'Paid'} /></td>
                      <td className="is-actions">
                        <div className="hr-row-actions">
                          <button type="button" className="hr-btn hr-btn-soft hr-btn-sm" onClick={() => setSelectedPayslip(item)}>
                            <Eye size={13} /> View
                          </button>
                          <button type="button" className="hr-btn hr-btn-secondary hr-btn-sm" onClick={() => handleDownloadPDF(item)}>
                            <Download size={13} /> Download
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {selectedPayslip && (
        <Modal
          size="lg"
          title={`Salary slip · ${selectedPayslip.month}`}
          subtitle={selectedPayslip.company || currentCompany}
          footer={
            <>
              <button type="button" className="hr-btn hr-btn-secondary" onClick={() => setSelectedPayslip(null)}>Close</button>
              <button type="button" className="hr-btn hr-btn-primary" onClick={() => handleDownloadPDF(selectedPayslip)}>
                <Download size={15} /> Download
              </button>
            </>
          }
        >
          <div className="hr-modal-body" style={{ gap: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14, borderBottom: '1px solid var(--line)', marginBottom: 4 }}>
              <div>
                <div className="hr-dt">Employee</div>
                <div className="hr-dd">{selectedPayslip.employee_name || user?.name || '—'}</div>
              </div>
              <StatusPill tone="neutral" dot={false}><Lock size={11} /> Confidential</StatusPill>
            </div>

            <div className="hr-dt" style={{ marginTop: 14 }}>Earnings</div>
            <div className="hr-slip-row">
              <span>Basic salary</span>
              <span>₹{Number(selectedPayslip.basicSalary ?? selectedPayslip.basic_salary ?? 0).toLocaleString('en-IN')}</span>
            </div>
            <div className="hr-slip-row">
              <span>HRA</span>
              <span>₹{Number(selectedPayslip.hra ?? 0).toLocaleString('en-IN')}</span>
            </div>
            <div className="hr-slip-row">
              <span>Special allowances</span>
              <span>₹{Number(selectedPayslip.allowances ?? 0).toLocaleString('en-IN')}</span>
            </div>

            <div className="hr-dt" style={{ marginTop: 14 }}>Deductions</div>
            <div className="hr-slip-row">
              <span>Total deductions</span>
              <span style={{ color: 'var(--danger)' }}>−₹{Number(selectedPayslip.deductions ?? 0).toLocaleString('en-IN')}</span>
            </div>

            <div className="hr-slip-total">
              <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Net payable salary</span>
              <strong>₹{Number(selectedPayslip.netPay ?? selectedPayslip.net_pay ?? 0).toLocaleString('en-IN')}</strong>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default Payslip;
