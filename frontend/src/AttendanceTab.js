import React from 'react';
import { LogIn, LogOut, Clock } from 'lucide-react';
import { PageHeader, Panel, StatusPill, Avatar, TableEmpty } from './ui';

function AttendanceTab({ userRole, selectedCompany, handleBackToGroupOverview, attendanceRecords, handleCheckIn, handleCheckOut }) {
  const normalizedRole = (userRole || '').toUpperCase();
  
  
  const isMD = normalizedRole === 'MD';
  const canCheckIn = !isMD;


  const showEmployeeNameColumn = ['MD', 'CEO', 'HR', 'ADMIN'].includes(normalizedRole);

  // Visual-only summary derived from records already passed in
  const totalRecords = attendanceRecords ? attendanceRecords.length : 0;
  const openRecords = attendanceRecords ? attendanceRecords.filter(r => { const c = r.check_out || r.checkOut; return !(c && c !== '-'); }).length : 0;
  const colCount = (showEmployeeNameColumn ? 1 : 0) + 4 + (canCheckIn ? 1 : 0);

  return (
    <div>
      <PageHeader
        title={canCheckIn && !showEmployeeNameColumn ? 'My attendance' : 'Attendance'}
        subtitle={`Check-in and check-out log for ${selectedCompany}.`}
        onBack={isMD ? handleBackToGroupOverview : undefined}
        backLabel="Back to group overview"
        actions={canCheckIn && (
          <button type="button" className="hr-btn hr-btn-success hr-btn-lg" onClick={handleCheckIn}>
            <LogIn size={16} /> Check in now
          </button>
        )}
      />

      <Panel
        flush
        title="Attendance records"
        actions={totalRecords > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <StatusPill tone="neutral" dot={false}>{totalRecords} records</StatusPill>
            {openRecords > 0 && <StatusPill tone="info">{openRecords} still checked in</StatusPill>}
          </div>
        )}
      >
        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead>
              <tr>
                {showEmployeeNameColumn && <th>Employee</th>}
                <th>Date</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Status</th>
                {canCheckIn && <th className="is-actions">Action</th>}
              </tr>
            </thead>
            <tbody>
              {!attendanceRecords || attendanceRecords.length === 0 ? (
                <TableEmpty
                  colSpan={colCount}
                  icon={<Clock size={20} />}
                  title="No attendance records yet"
                  text={canCheckIn ? 'Use “Check in now” when you arrive. Your record will appear here.' : 'Records will appear here as employees check in.'}
                />
              ) : (
                attendanceRecords.map((record) => {
                  const checkOutVal = record.check_out || record.checkOut;
                  const hasCheckedOut = checkOutVal && checkOutVal !== '-';

                  return (
                    <tr key={record.id || record._id || record.date}>
                      {showEmployeeNameColumn && (
                        <td>
                          <div className="hr-cell-person" style={{ minWidth: 180 }}>
                            <Avatar name={record.employee_name || record.name || 'Employee'} size={30} />
                            <span className="hr-cell-person-name">{record.employee_name || record.name || 'Employee'}</span>
                          </div>
                        </td>
                      )}
                      <td className="num is-strong">{record.date ? record.date.split('T')[0] : '-'}</td>
                      <td className="num">{record.check_in || record.checkIn || '-'}</td>
                      <td className="num">{checkOutVal || '-'}</td>
                      <td>
                        <StatusPill tone={hasCheckedOut ? 'success' : 'info'}>
                          {hasCheckedOut ? 'Present' : 'Checked In'}
                        </StatusPill>
                      </td>
                      {canCheckIn && (
                        <td className="is-actions">
                          {!hasCheckedOut ? (
                            <button
                              type="button"
                              className="hr-btn hr-btn-danger-soft hr-btn-sm"
                              onClick={() => handleCheckOut(record.id || record._id)}
                            >
                              <LogOut size={14} /> Check out
                            </button>
                          ) : (
                            <span className="hr-count" style={{ color: 'var(--success)', fontWeight: 600 }}>Completed</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export default AttendanceTab;
