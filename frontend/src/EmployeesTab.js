import React from 'react';
import { ArrowLeft } from 'lucide-react';
import EmployeeDirectory from './employees/EmployeeDirectory';

/* Employee Management: directory, profile drawer and Add Employee (see src/employees/) */
function EmployeesTab({ userRole, handleBackToGroupOverview, user, selectedCompany, companies }) {
  return (
    <div className="hr-emp-tab">
      {handleBackToGroupOverview && (
        <button type="button" className="hr-back" onClick={handleBackToGroupOverview}>
          <ArrowLeft size={15} /> Back to group overview
        </button>
      )}
      <EmployeeDirectory user={user} userRole={userRole} selectedCompany={selectedCompany} companies={companies} />
    </div>
  );
}

export default EmployeesTab;
