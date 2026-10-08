import React, { useState, useEffect } from 'react';
import { ArrowLeft, Users, UserCheck, CalendarOff, Wallet, CalendarCheck, ChevronRight, PauseCircle } from 'lucide-react';
import { PageHeader, Panel, KpiStrip, Kpi, EmptyState, StatusPill, formatINR } from './ui';
import { getCompanyBrand, CompanyLogo } from './brand';
import Celebrations from './Celebrations';

export default function CompanyDashboard({ company, onBack, onViewEmployees, onViewAttendance, onViewPayroll, userRole }) {
  const [stats, setStats] = useState({
    activeEmployees: 0,
    presentToday: 0,
    onLeave: 0,
    monthlyPayroll: 0
  });
  const [loading, setLoading] = useState(true);

  const isAdminOrManagement = ['MD', 'CEO', 'HR', 'ADMIN'].includes((userRole || '').toUpperCase());
  
  const userObj = JSON.parse(localStorage.getItem('user') || '{}');
  const companyName = company?.name || userObj?.company_name || userObj?.company || 'Company';
  // Display-only branding/status
  const brand = getCompanyBrand(company);
  const isOnHold = brand?.status === 'on-hold';

  useEffect(() => {
    const fetchCompanyStats = async () => {
      if (!company || !company.id) return;
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`http://localhost:5000/api/companies/${company.id}/stats`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
          setStats(data);
        }
      } catch (err) {
        console.error('API Error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCompanyStats();
  }, [company]);

  if (!isAdminOrManagement) {
    return (
      <div className="hr-dash">
        <PageHeader
          title={`${companyName} dashboard`}
          subtitle="Today's attendance, leave and payroll figures for your company."
        />

        <KpiStrip>
          <Kpi icon={<UserCheck size={16} />} label="Present today" value={stats.presentToday || 0} tone="primary" note="Checked in today" />
          <Kpi icon={<CalendarOff size={16} />} label="On leave" value={stats.onLeave || 0} tone="warning" note="Approved leave" />
          <Kpi icon={<Wallet size={16} />} label="Monthly payroll" value={formatINR(stats.monthlyPayroll || 0)} note="Total computed salary" />
        </KpiStrip>

        <Celebrations />
      </div>
    );
  }

  return (
    <div className="hr-dash">
      {onBack && (
        <button type="button" className="hr-back" onClick={onBack}>
          <ArrowLeft size={15} /> Back to group overview
        </button>
      )}

      <section className="hr-panel" style={{ marginBottom: 24 }}>
        <div className="hr-entity-hero" style={{ '--entity': company?.color || 'var(--primary)', flexWrap: 'wrap' }}>
          {brand ? (
            <span className="hr-hero-logo"><CompanyLogo company={company} height={44} /></span>
          ) : (
            <div
              className="hr-entity-mark"
              style={{ width: 52, height: 52, fontSize: 14, background: company?.logoBg || 'var(--primary-50)', color: company?.color || 'var(--primary)' }}
            >
              {company?.code || 'RRD'}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 className="hr-page-title" style={{ fontSize: 22 }}>{brand?.legalName || companyName}</h1>
              <span className="hr-tag" style={{ background: company?.logoBg || 'var(--primary-50)', color: company?.color || 'var(--primary)' }}>
                {company?.tag || 'INFRA'}
              </span>
              {isOnHold && <StatusPill tone="warning">On hold</StatusPill>}
            </div>
            <p className="hr-page-sub">{company?.description || company?.desc || 'Real estate development and construction infrastructure.'}</p>
            {brand && (
              <p className="hr-hint" style={{ marginTop: 4 }}>
                {brand.ceo ? <>CEO: <strong style={{ color: 'var(--ink)' }}>{brand.ceo}</strong></> : 'No CEO assigned yet'}
              </p>
            )}
          </div>
        </div>
      </section>

      <KpiStrip>
        <Kpi icon={<Users size={16} />} label="Active employees" value={loading ? '–' : (Number(stats?.activeEmployees) || 0)} note="On the company roll" />
        <Kpi icon={<UserCheck size={16} />} label="Present today" value={loading ? '–' : (Number(stats?.presentToday) || 0)} tone="success" note="Checked in today" />
        <Kpi icon={<CalendarOff size={16} />} label="On leave" value={loading ? '–' : (Number(stats?.onLeave) || 0)} tone="warning" note="Approved leave" />
        <Kpi icon={<Wallet size={16} />} label="Monthly payroll" value={loading ? '–' : formatINR(Number(stats?.monthlyPayroll) || 0)} note="Total computed salary" />
      </KpiStrip>

      {isOnHold && (
        <section className="hr-panel hr-onhold" style={{ marginBottom: 20 }}>
          <div className="hr-notice" style={{ padding: '16px 20px' }}>
            <div className="hr-notice-icon" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}><PauseCircle size={20} /></div>
            <div>
              <h2 className="hr-panel-title" style={{ fontSize: 'var(--fs-md)' }}>Operations on hold</h2>
              <p className="hr-panel-sub" style={{ marginTop: 2 }}>
                {companyName} has no employees or CEO assigned yet, so every figure shows zero. Records appear here once people are added.
              </p>
            </div>
          </div>
        </section>
      )}

      <div className="hr-grid-2-1">
        <Panel title="Recent activity" flush>
          <EmptyState title="No recent activity" text={`Activity and projects for ${companyName} will appear here.`} />
        </Panel>

        <Panel title="Quick actions" subtitle="Jump into this company's records" flush>
          <div className="hr-list">
            <button type="button" className="hr-list-row" onClick={() => onViewEmployees && onViewEmployees(company?.id)}>
              <span className="hr-list-icon"><Users size={16} /></span>
              <span className="hr-list-main">
                <span className="hr-list-title" style={{ display: 'block' }}>Team overview</span>
                <span className="hr-list-sub">Employee directory and profiles</span>
              </span>
              <ChevronRight size={16} className="hr-chev" />
            </button>
            <button type="button" className="hr-list-row" onClick={() => onViewAttendance && onViewAttendance(company?.id)}>
              <span className="hr-list-icon"><CalendarCheck size={16} /></span>
              <span className="hr-list-main">
                <span className="hr-list-title" style={{ display: 'block' }}>Attendance logs</span>
                <span className="hr-list-sub">Check-ins and check-outs</span>
              </span>
              <ChevronRight size={16} className="hr-chev" />
            </button>
            <button type="button" className="hr-list-row" onClick={() => onViewPayroll && onViewPayroll(company?.id)}>
              <span className="hr-list-icon"><Wallet size={16} /></span>
              <span className="hr-list-main">
                <span className="hr-list-title" style={{ display: 'block' }}>Payroll and payslips</span>
                <span className="hr-list-sub">Run and review this month's salaries</span>
              </span>
              <ChevronRight size={16} className="hr-chev" />
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
