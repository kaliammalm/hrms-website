import React, { useEffect, useState } from 'react';
import { Gift, Award } from 'lucide-react';
import { Panel, EmptyState } from './ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Birthdays & work anniversaries for the current month, shown from the 1st of the month.
 * Data comes from /api/celebrations, which the backend scopes by role
 * (group-wide MD, or the viewer's own company) and which returns names and dates only.
 * `companyId` lets the group MD narrow to one company ('all' or empty = whole group).
 */
export default function Celebrations({ companyId }) {
  const [data, setData] = useState({ events: [], month: new Date().getMonth() + 1, today: new Date().getDate() });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setFailed(false);
      try {
        const token = localStorage.getItem('token');
        const qs = companyId && companyId !== 'all' ? `?companyId=${encodeURIComponent(companyId)}` : '';
        const res = await fetch(`https://hrms-backend-v3.onrender.com/api/celebrations${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.ok && Array.isArray(body.events)) setData(body);
        else { setData((d) => ({ ...d, events: [] })); setFailed(true); }
      } catch (e) {
        if (alive) { setData((d) => ({ ...d, events: [] })); setFailed(true); }
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => { alive = false; };
  }, [companyId]);

  const monthName = MONTHS_LONG[(data.month || 1) - 1];
  const monthShort = MONTHS[(data.month || 1) - 1];
  const events = data.events || [];

  return (
    <Panel
      flush
      className="hr-section-gap hr-fill"
      icon={<Gift size={18} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
      title={`Celebrations in ${monthName}`}
      subtitle="Birthdays and work anniversaries this month"
      actions={!loading && events.length > 0 ? <span className="hr-count">{events.length} this month</span> : null}
    >
      <div className="hr-fill-body">
        {loading ? (
          <EmptyState title="Loading celebrations" text="Checking birthdays and joining dates…" />
        ) : failed ? (
          <EmptyState icon={<Gift size={20} />} title="Celebrations unavailable" text="They couldn't be loaded right now. Refresh the page to try again." />
        ) : events.length === 0 ? (
          <EmptyState
            icon={<Gift size={20} />}
            title={`No birthdays or anniversaries in ${monthName}`}
            text="Birthdays appear here from the 1st of the month once a date of birth is added to an employee's profile."
          />
        ) : (
          <div className="hr-celebrations">
            {events.map((item) => {
              const isBirthday = item.type === 'Birthday';
              const isToday = item.day === data.today;
              const isPast = item.day < data.today;
              const accent = isBirthday ? '#b4366b' : 'var(--primary)';
              return (
                <div key={item.id} className={`hr-list-row hr-celebration${isPast ? ' is-past' : ''}${isToday ? ' is-today' : ''}`}>
                  <div className="hr-date-tile">
                    <div className="hr-date-tile-m" style={{ background: accent }}>{monthShort}</div>
                    <div className="hr-date-tile-d">{item.day}</div>
                  </div>
                  <div className="hr-list-main">
                    <div className="hr-list-title">{item.name}</div>
                    <div className="hr-list-sub">
                      {item.companyName}
                      {!isBirthday && item.years ? ` · ${item.years} ${item.years === 1 ? 'year' : 'years'}` : ''}
                    </div>
                  </div>
                  {isToday ? (
                    <span className="hr-pill no-dot" style={{ background: accent, color: '#fff' }}>
                      {isBirthday ? <Gift size={12} /> : <Award size={12} />} Today
                    </span>
                  ) : (
                    <span className="hr-pill no-dot" style={{ background: isBirthday ? '#fbe9f0' : 'var(--primary-50)', color: accent }}>
                      {isBirthday ? <Gift size={12} /> : <Award size={12} />}
                      {isBirthday ? 'Birthday' : 'Anniversary'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}
