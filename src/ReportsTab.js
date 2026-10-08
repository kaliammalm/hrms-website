import React, { useState } from 'react';
import { CalendarCheck, Wallet, Users, FileText, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { PageHeader } from './ui';
import { getCompanyBrand } from './brand';

const API = 'https://hrms-backend-v3.onrender.com/api/reports';

const REPORTS = [
  { type: 'attendance', title: 'Attendance summary', icon: <CalendarCheck size={18} />,
    text: 'Present days, approved leave and missing check-outs per employee, with a day-by-day log.' },
  { type: 'payroll', title: 'Payroll disbursement', icon: <Wallet size={18} />,
    text: 'Salary structure, net pay, bank account and payslip status for every employee.' },
  { type: 'headcount', title: 'Headcount & joiners', icon: <Users size={18} />,
    text: 'Employee register with department, joining date and tenure, plus joiners this month.' },
];

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Management reports. Each report is fetched from GET /api/reports/:type and
 * delivered either as a formatted PDF (rendered in the browser) or as a CSV
 * that opens directly in Excel. The backend scopes the data by role.
 */
function ReportsTab({ companyId, selectedCompany }) {
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);

  const scopeId = companyId && companyId !== 'all' ? companyId : '';
  const scopeName = selectedCompany && selectedCompany !== 'All Companies' ? selectedCompany : 'All companies';
  const brandKey = getCompanyBrand(scopeId || selectedCompany)?.key || 'group';

  const url = (type, format) =>
    `${API}/${type}?format=${format}&month=${encodeURIComponent(month)}${scopeId ? `&companyId=${encodeURIComponent(scopeId)}` : ''}`;

  const run = async (type, format) => {
    setBusy(`${type}:${format}`);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(url(type, format), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `The report could not be generated (error ${res.status}).`);
      }
      if (format === 'csv') {
        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') || '';
        const name = (cd.match(/filename="?([^";]+)"?/) || [])[1] || `${type}_${month}.csv`;
        const href = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(href);
      } else {
        const report = await res.json();
        const { downloadReportPdf } = await import('./reportPdf');
        downloadReportPdf(report, { brandKey });
      }
    } catch (e) {
      const title = REPORTS.find((r) => r.type === type)?.title || 'Report';
      setError({ type, message: e.message === 'Failed to fetch' ? 'The server could not be reached. Check that the backend is running and try again.' : e.message, title });
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <PageHeader
        title="Reports and analytics"
        subtitle={`Monthly reports for ${scopeName}. Choose a month, then download as a formatted PDF or an Excel-ready CSV.`}
        actions={(
          <label className="hr-report-month">
            <span>Report month</span>
            <input type="month" className="hr-input" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value || thisMonth())} />
          </label>
        )}
      />

      {error && (
        <div className="hr-report-error" role="alert">
          <AlertCircle size={16} />
          <div><strong>{error.title}:</strong> {error.message}</div>
          <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="hr-tiles">
        {REPORTS.map((r) => (
          <article key={r.type} className="hr-tile">
            <span className="hr-list-icon" style={{ marginBottom: 6 }}>{r.icon}</span>
            <div className="hr-tile-title">{r.title}</div>
            <div className="hr-tile-text">{r.text}</div>
            <div className="hr-tile-foot hr-report-actions">
              <button type="button" className="hr-btn hr-btn-primary hr-btn-sm" disabled={!!busy} onClick={() => run(r.type, 'json')}>
                <FileText size={14} /> {busy === `${r.type}:json` ? 'Preparing…' : 'PDF'}
              </button>
              <button type="button" className="hr-btn hr-btn-soft hr-btn-sm" disabled={!!busy} onClick={() => run(r.type, 'csv')}>
                <FileSpreadsheet size={14} /> {busy === `${r.type}:csv` ? 'Preparing…' : 'Excel (CSV)'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export default ReportsTab;
