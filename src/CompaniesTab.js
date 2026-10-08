import React from 'react';
import { ChevronRight } from 'lucide-react';
import { PageHeader, Panel, StatusPill } from './ui';
import { getCompanyBrand, CompanyLogo } from './brand';

function CompaniesTab({ companies, setSelectedCompany, setActiveCompanyDashboard, setActiveMenu }) {
  return (
    <div>
      <PageHeader title="Group companies" subtitle="Every legal entity in the group. Open one to see its workforce dashboard." />
      <Panel flush>
        <div className="hr-list">
          {companies.map((comp) => (
            <div key={comp.id} className="hr-list-row" style={{ padding: '16px 20px', flexWrap: 'wrap' }}>
              <div style={{ width: 132, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {getCompanyBrand(comp) ? <CompanyLogo company={comp} height={32} /> : (
                  <div className="hr-entity-mark" style={{ background: comp.logoBg, color: comp.color }}>{comp.code}</div>
                )}
              </div>
              <div className="hr-list-main" style={{ minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="hr-list-title" style={{ fontSize: 'var(--fs-md)' }}>{getCompanyBrand(comp)?.legalName || comp.name}</span>
                  <span className="hr-tag" style={{ background: comp.logoBg, color: comp.color }}>{comp.tag}</span>
                  {getCompanyBrand(comp)?.status === 'on-hold' && <StatusPill tone="warning">On hold</StatusPill>}
                </div>
                <div className="hr-list-sub" style={{ fontSize: 'var(--fs-sm)', marginTop: 2 }}>{comp.description}</div>
                {getCompanyBrand(comp) && (
                  <div className="hr-list-sub" style={{ marginTop: 2 }}>{getCompanyBrand(comp).ceo ? `CEO: ${getCompanyBrand(comp).ceo}` : 'No CEO assigned yet'}</div>
                )}
              </div>
              <button
                type="button"
                className="hr-btn hr-btn-secondary hr-btn-sm"
                onClick={() => { setSelectedCompany(comp.name); setActiveCompanyDashboard(comp); setActiveMenu('Dashboard'); }}
              >
                Open dashboard <ChevronRight size={14} />
              </button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export default CompaniesTab;
