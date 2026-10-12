import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CalendarDays, CheckCircle2, ClipboardList, Wallet, ChevronRight, Gift } from 'lucide-react';
import { API_BASE } from './config';
import './styles/notifications.css';

const POLL_MS = 60000;
const ICONS = { leave: CalendarDays, approval: CheckCircle2, task: ClipboardList, payslip: Wallet, celebration: Gift };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmtDate = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '';
};

/* "Read" state is kept per user in this browser: the ids already seen. */
const seenKey = (userId) => `hrms_seen_notifications_${userId || 'me'}`;
const loadSeen = (userId) => {
  try { return new Set(JSON.parse(localStorage.getItem(seenKey(userId)) || '[]')); } catch (e) { return new Set(); }
};
const saveSeen = (userId, ids) => {
  try { localStorage.setItem(seenKey(userId), JSON.stringify([...ids].slice(-300))); } catch (e) { /* storage unavailable */ }
};

/**
 * Header bell: recent leave requests, approvals, pending tasks and personal updates
 * from GET /api/notifications (already scoped by role on the server).
 * onNavigate(menuLabel) opens the related screen.
 */
export default function NotificationBell({ userId, onNavigate }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState(() => loadSeen(userId));
  const [newAtOpen, setNewAtOpen] = useState(new Set());
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/notifications`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.items)) { setItems(body.items); setFailed(false); }
      else setFailed(true);
    } catch (e) {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load now, then refresh every minute while the tab is visible
  useEffect(() => {
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  useEffect(() => { setSeen(loadSeen(userId)); }, [userId]);

  const unread = items.filter((i) => !seen.has(i.id));

  const openPanel = () => {
    setNewAtOpen(new Set(unread.map((i) => i.id))); // keep "new" markers visible while open
    const next = new Set([...seen, ...items.map((i) => i.id)]);
    setSeen(next);
    saveSeen(userId, next);
    setOpen(true);
    load();
  };

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (item) => {
    setOpen(false);
    if (item.target && onNavigate) onNavigate(item.target);
  };

  const badge = unread.length > 9 ? '9+' : String(unread.length);

  return (
    <div className="hr-notif" ref={wrapRef}>
      <button
        type="button"
        className={`hr-icon-btn hr-notif-btn${open ? ' is-open' : ''}`}
        aria-label={unread.length ? `Notifications, ${unread.length} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <Bell size={18} strokeWidth={1.75} />
        {unread.length > 0 && <span className="hr-notif-badge" aria-hidden="true">{badge}</span>}
      </button>

      {open && (
        <div className="hr-popover hr-notif-panel" role="dialog" aria-label="Notifications">
          <div className="hr-notif-head">
            <span className="hr-notif-title">Notifications</span>
            {items.length > 0 && <span className="hr-notif-count">{items.length}</span>}
          </div>

          <div className="hr-notif-list">
            {loading && items.length === 0 ? (
              <div className="hr-notif-empty">Loading…</div>
            ) : failed && items.length === 0 ? (
              <div className="hr-notif-empty">Notifications couldn't be loaded. <button type="button" className="hr-notif-retry" onClick={load}>Try again</button></div>
            ) : items.length === 0 ? (
              <div className="hr-notif-empty">
                <Bell size={20} strokeWidth={1.5} />
                <div className="hr-notif-empty-title">You're all caught up</div>
                <div>Leave requests, approvals and tasks will appear here.</div>
              </div>
            ) : (
              items.map((item) => {
                const Icon = ICONS[item.type] || Bell;
                const isNew = newAtOpen.has(item.id);
                return (
                  <button key={item.id} type="button" className={`hr-notif-item tone-${item.tone || 'info'}${isNew ? ' is-new' : ''}`} onClick={() => go(item)}>
                    <span className="hr-notif-icon"><Icon size={16} strokeWidth={1.75} /></span>
                    <span className="hr-notif-body">
                      <span className="hr-notif-item-title">{item.title}</span>
                      {item.text && <span className="hr-notif-item-text">{item.text}</span>}
                      {item.date && <span className="hr-notif-item-date">{fmtDate(item.date)}</span>}
                    </span>
                    {isNew ? <span className="hr-notif-dot" aria-label="New" /> : <ChevronRight size={15} className="hr-notif-chev" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
