import React from 'react';
import { ArrowLeft, Users, UserCheck, CalendarOff, Wallet, CalendarCheck, ChevronRight } from 'lucide-react';
import { PageHeader, Panel, KpiStrip, Kpi, EmptyState, formatINR, StatusPill } from './ui';
import { getCompanyBrand, CompanyLogo } from './brand';

function DashboardTab({ userRole, stats, selectedCompany, setSelectedCompany, companies, setActiveCompanyDashboard, user }) {
  const upperRole = (userRole || '').toUpperCase();
  const isMD = upperRole.includes('MD');
  
  // Role check for Total Employees card: Sales Executive-kku hide aaganum, MD/CEO/Admin/HR paarkalam
  const isSalesExecutive = upperRole.includes('SALES') || upperRole.includes('EXECUTIVE');
  const canSeeTotalEmployees = !isSalesExecutive && ['MD', 'CEO', 'HR', 'ADMIN', 'MANAGEMENT'].some(role => upperRole.includes(role));

  const getDisplayCompany = () => {
    if (isMD) {
      if (selectedCompany === 'All Companies') return 'Executive Group Overview';
      return `${selectedCompany} Dashboard`;
    }
    const comp = user?.company_name || user?.companyName || user?.company;
    if (comp) return `${comp} Dashboard`;
    return `${selectedCompany && selectedCompany !== 'All Companies' ? selectedCompany : 'Dashboard'} Dashboard`;
  };

  const totalEmployees = stats?.totalEmployees ?? stats?.activeEmployees ?? stats?.count ?? 0;
  const presentToday = stats?.presentToday ?? stats?.present ?? 0;
  const onLeave = stats?.onLeave ?? stats?.leaveCount ?? 0;
  const monthlyPayroll = stats?.monthlyPayroll ?? stats?.payroll ?? stats?.totalPayroll ?? 0;

  // Visual-only lookups
  const entity = (companies || []).find((c) => c.name === selectedCompany);
  const isEntityView = selectedCompany !== 'All Companies' && isMD;
  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="hr-dash-top">
      {isEntityView ? (
        <>
          <button
            type="button"
            className="hr-back"
            onClick={() => {
              setSelectedCompany('All Companies');
              if (setActiveCompanyDashboard) setActiveCompanyDashboard(null);
            }}
          >
            <ArrowLeft size={15} /> Back to group overview
          </button>
          <section className="hr-panel" style={{ marginBottom: 24 }}>
            <div className="hr-entity-hero" style={{ '--entity': entity?.color }}>
              {getCompanyBrand(selectedCompany) ? (
                <span className="hr-hero-logo"><CompanyLogo company={selectedCompany} height={40} /></span>
              ) : (
                <div className="hr-entity-mark" style={{ background: entity?.logoBg || 'var(--warning-bg)', color: entity?.color || 'var(--warning)', width: 48, height: 48 }}>
                  {entity?.code || selectedCompany.substring(0, 2).toUpperCase()}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h1 className="hr-page-title" style={{ fontSize: 22 }}>{selectedCompany}</h1>
                  <span className="hr-tag" style={{ background: entity?.logoBg || 'var(--warning-bg)', color: entity?.color || 'var(--warning)' }}>
                    {entity?.tag || 'Entity'}
                  </span>
                </div>
                <p className="hr-page-sub">{entity?.description || 'Company workforce overview.'}</p>
              </div>
            </div>
          </section>
        </>
      ) : (
        <PageHeader
          title={isMD && selectedCompany === 'All Companies' ? 'Group overview' : getDisplayCompany()}
          subtitle={`${todayLabel}. Live attendance, leave and payroll figures.`}
        />
      )}

      {/* KPI strip */}
      <KpiStrip>
        {/* Total Employees / Active Employees - Hidden for Sales Executive, visible to MD/Admin/HR */}
        {canSeeTotalEmployees && (
          <Kpi
            icon={<Users size={16} />}
            label={selectedCompany !== 'All Companies' ? 'Active employees' : 'Total employees'}
            value={totalEmployees}
            note="Active workforce"
          />
        )}
        <Kpi icon={<UserCheck size={16} />} label="Present today" value={presentToday} tone="primary" note="Checked in today" />
        <Kpi icon={<CalendarOff size={16} />} label="On leave" value={onLeave} tone="warning" note="Approved leave" />
        {/* Company payroll totals are for management only */}
        {canSeeTotalEmployees && (
          <Kpi icon={<Wallet size={16} />} label="Monthly payroll" value={formatINR(monthlyPayroll)} note="Total computed salary" />
        )}
      </KpiStrip>

      {isEntityView ? (
        <div className="hr-grid-2-1">
          <Panel title="Recent activity" flush>
            <EmptyState title="No recent activity" text={`Activity and projects for ${selectedCompany} will appear here.`} />
          </Panel>

          <Panel title="Quick actions" flush>
            <div className="hr-list">
              <button type="button" className="hr-list-row">
                <span className="hr-list-icon"><Users size={16} /></span>
                <span className="hr-list-main"><span className="hr-list-title">Team overview</span></span>
                <ChevronRight size={16} className="hr-chev" />
              </button>
              <button type="button" className="hr-list-row">
                <span className="hr-list-icon"><CalendarCheck size={16} /></span>
                <span className="hr-list-main"><span className="hr-list-title">Attendance logs</span></span>
                <ChevronRight size={16} className="hr-chev" />
              </button>
              <button type="button" className="hr-list-row">
                <span className="hr-list-icon"><Wallet size={16} /></span>
                <span className="hr-list-main"><span className="hr-list-title">Payroll and payslips</span></span>
                <ChevronRight size={16} className="hr-chev" />
              </button>
            </div>
          </Panel>
        </div>
      ) : (
        isMD && companies && companies.length > 0 && (
          <div className="hr-dash-entities">
            <h2 className="hr-section-title">Group companies</h2>
            <div className="hr-entities">
              {companies.map((comp) => (
                <article key={comp.id || comp.name} className="hr-entity">
                  <div className="hr-entity-bar" style={{ background: comp.color || 'var(--primary)' }} />
                  <div className="hr-entity-body">
                    <div className="hr-entity-logo">
                      {getCompanyBrand(comp) ? (
                        <CompanyLogo company={comp} height={30} />
                      ) : (
                        <div className="hr-entity-mark" style={{ background: comp.logoBg || 'var(--primary-50)', color: comp.color || 'var(--primary)' }}>
                          {comp.code || 'N/A'}
                        </div>
                      )}
                      {getCompanyBrand(comp)?.status === 'on-hold' && <StatusPill tone="warning">On hold</StatusPill>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <h3 className="hr-entity-name">{getCompanyBrand(comp)?.legalName || comp.name}</h3>
                      <span className="hr-entity-code">{comp.tag || 'Entity'}</span>
                    </div>
                    <p className="hr-entity-desc" style={{ marginTop: 4 }}>{comp.description || ''}</p>
                  </div>
                  <div className="hr-entity-foot">
                    <span className="hr-count">
                      {getCompanyBrand(comp)
                        ? (getCompanyBrand(comp).ceo ? <>CEO: <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{getCompanyBrand(comp).ceo}</strong></> : 'No CEO assigned yet')
                        : `Code ${comp.code || 'N/A'}`}
                    </span>
                    <button
                      type="button"
                      className="hr-btn hr-btn-soft hr-btn-sm"
                      onClick={() => {
                        setSelectedCompany(comp.name);
                        if (setActiveCompanyDashboard) setActiveCompanyDashboard(comp);
                      }}
                    >
                      Open dashboard <ChevronRight size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

export default DashboardTab;
