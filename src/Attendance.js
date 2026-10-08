import React, { useState, useEffect } from 'react';

const Attendance = () => {
  const [attendanceList, setAttendanceList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAttendanceRecords();
  }, []);

  const getLocalDateString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const fetchAttendanceRecords = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token || token === "undefined" || token === "null") {
        setLoading(false);
        return;
      }

      const response = await fetch('https://hrms-backend-v3.onrender.com/api/attendance', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (response.ok) {
        setAttendanceList(Array.isArray(data) ? data : []);
      } else {
        console.error('Failed to fetch records:', data.error);
      }
    } catch (err) {
      console.error('API fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const todayStr = getLocalDateString();
  const isTodayMarked = attendanceList.some(item => {
    const itemDate = item.date ? item.date.substring(0, 10) : '';
    return itemDate === todayStr;
  });

  const handleCheckIn = async () => {
    const userJson = localStorage.getItem('user');
    if (!userJson) {
      alert('User session not found. Please login again.');
      return;
    }

    const user = JSON.parse(userJson);
    const companyId = user.company_id;
    const role = user.role;

    let latitude = null;
    let longitude = null;

    const needsGeo = role === 'site_engineer' || role === 'SITE_ENGINEER' || user?.attendance_type === 'SITE' || role === 'EMPLOYEE';

    if (needsGeo) {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          latitude = position.coords.latitude;
          longitude = position.coords.longitude;
          await sendAttendanceRequest(companyId, latitude, longitude);
        },
        (error) => {
          alert('GPS Error: Please enable location permission in your browser.');
          console.error(error);
        },
        { enableHighAccuracy: true }
      );
    } else {
      await sendAttendanceRequest(companyId, null, null);
    }
  };

  const sendAttendanceRequest = async (companyId, latitude, longitude) => {
    try {
      const token = localStorage.getItem('token');
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

      const response = await fetch('https://hrms-backend-v3.onrender.com/api/attendance/mark', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          company_id: companyId,
          latitude: latitude,
          longitude: longitude,
          check_in: timeStr,
          site_name: 'Project Site'
        })
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || data.message || 'Attendance failed!');
      } else {
        alert(data.message || 'Attendance marked successfully!');
        fetchAttendanceRecords();
      }
    } catch (err) {
      console.error('API Error:', err);
      alert('Server connection failed');
    }
  };

  const handleCheckOut = async (attendanceId) => {
    try {
      const token = localStorage.getItem('token');
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

      const response = await fetch(`https://hrms-backend-v3.onrender.com/api/attendance/checkout/${attendanceId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          checkOut: timeStr
        })
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || 'Check-out failed!');
      } else {
        alert(data.message || 'Checked out successfully!');
        fetchAttendanceRecords();
      }
    } catch (err) {
      console.error('Check-Out API Error:', err);
      alert('Server connection failed during check-out');
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return dateString.includes('T') ? dateString.split('T')[0] : dateString.substring(0, 10);
  };

  return (
    <div className="attendance-container" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2>Attendance Records</h2>
        
        {isTodayMarked ? (
          <button 
            disabled
            style={{
              backgroundColor: '#94a3b8',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '6px',
              cursor: 'not-allowed',
              fontWeight: 'bold'
            }}
          >
            ✔ Attendance Marked for Today
          </button>
        ) : (
          <button 
            onClick={handleCheckIn}
            style={{
              backgroundColor: '#22c55e',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            🟢 Check-In Now
          </button>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
            <th style={{ padding: '12px' }}>Employee Name</th> {/* 👇 Added Name Header */}
            <th style={{ padding: '12px' }}>Date</th>
            <th style={{ padding: '12px' }}>Check-In</th>
            <th style={{ padding: '12px' }}>Check-Out</th>
            <th style={{ padding: '12px' }}>Status</th>
            <th style={{ padding: '12px' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan="6" style={{ textAlign: 'center', padding: '20px' }}>Loading records...</td>
            </tr>
          ) : attendanceList.length > 0 ? (
            attendanceList.map((item, index) => {
              const hasCheckedOut = Boolean(item.checkOut || item.check_out);
              const statusText = item.status || (hasCheckedOut ? 'Checked Out' : 'Checked In');

              return (
                <tr key={item.id || index} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '12px', fontWeight: '600', color: '#1e293b' }}>
                    {item.employeeName || item.name || 'Employee'}
                  </td> {/* 👇 Render Employee Name */}
                  <td style={{ padding: '12px' }}>{formatDate(item.date)}</td>
                  <td style={{ padding: '12px' }}>{item.checkIn || item.check_in || '-'}</td>
                  <td style={{ padding: '12px' }}>{item.checkOut || item.check_out || '-'}</td>
                  <td style={{ padding: '12px' }}>
                    <span style={{ 
                      padding: '4px 8px', 
                      borderRadius: '4px', 
                      background: hasCheckedOut ? '#dcfce7' : '#fef9c3', 
                      color: hasCheckedOut ? '#15803d' : '#854d0e', 
                      fontSize: '12px',
                      fontWeight: '600'
                    }}>
                      {statusText}
                    </span>
                  </td>
                  <td style={{ padding: '12px' }}>
                    {!hasCheckedOut ? (
                      <button
                        onClick={() => handleCheckOut(item.id)}
                        style={{
                          background: '#ef4444',
                          color: 'white',
                          border: 'none',
                          padding: '6px 12px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontWeight: '600',
                          fontSize: '12px'
                        }}
                      >
                        Check-Out
                      </button>
                    ) : (
                      <span style={{ color: '#16a34a', fontWeight: '600', fontSize: '12px' }}>Completed</span>
                    )}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan="6" style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                No attendance records found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default Attendance;