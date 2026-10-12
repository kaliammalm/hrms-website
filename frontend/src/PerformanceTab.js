import React from 'react';
import { BarChart3 } from 'lucide-react';
import { PageHeader, Panel, EmptyState } from './ui';

function PerformanceTab() {
  return (
    <div>
      <PageHeader title="Performance" subtitle="Review cycles and ratings across the team." />
      <Panel flush title="Reviews">
        <EmptyState
          icon={<BarChart3 size={20} />}
          title="No performance reviews yet"
          text="Reviews will appear here once the first review cycle is recorded."
        />
      </Panel>
    </div>
  );
}

export default PerformanceTab;
