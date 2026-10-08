import React from 'react';
import { Plus, Briefcase } from 'lucide-react';
import { PageHeader, Panel, EmptyState } from './ui';

function RecruitmentTab() {
  return (
    <div>
      <PageHeader
        title="Recruitment"
        subtitle="Open roles and the candidates applying for them."
        actions={<button type="button" className="hr-btn hr-btn-primary"><Plus size={16} /> Post a job</button>}
      />
      <Panel flush title="Open roles">
        <EmptyState
          icon={<Briefcase size={20} />}
          title="No open roles"
          text="Roles you post will appear here with their applicants."
        />
      </Panel>
    </div>
  );
}

export default RecruitmentTab;
