/* ==========================================================================
   Field Visits (field staff): today's status, Arrived / Leaving buttons,
   ad-hoc visits, live location while the screen is open, and time per site.
   Also exports FieldTodayCard, a compact version for the dashboard.
   ========================================================================== */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogIn, LogOut, MapPin, MapPinned, Navigation, Clock, Route, Camera, TriangleAlert, CircleCheck, Radio, ChevronRight, RefreshCw } from 'lucide-react';
import { PageHeader, Panel, EmptyState, StatusPill } from '../ui';
import AdhocVisitModal from './AdhocVisitModal';
import { fieldFetch, fetchPhotoUrl, getPosition, nearestSite, fmtDistance, fmtDuration, fmtDay } from './fieldApi';
import '../styles/field.css';

const PING_EVERY_MS = 60 * 1000;   // send queued points once a minute
const PING_MIN_GAP_MS = 20 * 1000;  // keep at most one point per 20 s
const TRACK_KEY = 'hrms_field_tracking';

/* ---------------------------------------------------------------- data hook */
function useFieldStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      setStatus(await fieldFetch('/field/status'));
      setError('');
    } catch (e) {
      setError(e.status === 503 ? 'Field attendance is not switched on yet. Please contact HR.' : e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { status, error, loading, reload: load };
}

/* Live location while the screen is open: queues GPS points and posts them every minute */
function useLiveTracking(enabled, { onResult, onStop }) {
  const queue = useRef([]);
  const lastAt = useRef(0);
  const [last, setLast] = useState(null);
  const [problem, setProblem] = useState('');
  const cb = useRef({ onResult, onStop });
  cb.current = { onResult, onStop };

  const flush = useCallback(async () => {
    if (!queue.current.length) return;
    const pings = queue.current.splice(0, 50);
    try {
      const res = await fieldFetch('/field/pings', { method: 'POST', body: { pings } });
      cb.current.onResult?.(res);
    } catch (e) {
      if (e.status === 409 || e.status === 403) { cb.current.onStop?.(e.message); return; }
      if (e.status === 0) queue.current.unshift(...pings); // offline: keep for the next try
    }
  }, []);

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return undefined;
    setProblem('');
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const now = Date.now();
        const point = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy || 0), recordedAt: new Date(p.timestamp || now).toISOString() };
        setLast(point);
        setProblem('');
        if (now - lastAt.current < PING_MIN_GAP_MS) return;
        lastAt.current = now;
        queue.current.push(point);
        if (queue.current.length > 300) queue.current.splice(0, queue.current.length - 300);
      },
      (e) => setProblem(e.code === 1 ? 'Location permission is off.' : 'Waiting for GPS…'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
    const timer = setInterval(flush, PING_EVERY_MS);
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [enabled, flush]);

  return { last, problem, flush };
}

/* Ticking elapsed time for an open visit */
function useElapsed(fromIso) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!fromIso) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [fromIso]);
  return fromIso ? Math.max(0, Math.round((now - Date.parse(fromIso)) / 1000)) : 0;
}

/* --------------------------------------------------------------- actions hook */
function useFieldActions({ status, reload, notify }) {
  const [busy, setBusy] = useState('');
  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { notify('error', e.message); } finally { setBusy(''); }
  };
  const arrive = () => run('arrive', async () => {
    const p = await getPosition();
    const res = await fieldFetch('/field/visits/enter', { method: 'POST', body: p });
    notify('success', res.message);
    await reload();
  });
  const leave = () => run('leave', async () => {
    const p = await getPosition({ timeout: 10000 }).catch(() => ({}));
    const res = await fieldFetch('/field/visits/exit', { method: 'POST', body: p });
    notify('success', `Left ${res.visit?.siteName || 'the site'} · ${res.visit?.dwell || ''} on site`);
    await reload();
  });
  const checkOut = () => run('checkout', async () => {
    const p = await getPosition({ timeout: 10000 }).catch(() => ({}));
    const res = await fieldFetch(`/attendance/checkout/${status.attendance.id}`, { method: 'PUT', body: p });
    notify('success', `Checked out at ${res.checkOut}. Have a good evening.`);
    await reload();
  });
  return { busy, arrive, leave, checkOut };
}

function useNotice() {
  const [notice, setNotice] = useState(null);
  const timer = useRef(null);
  const notify = useCallback((tone, text) => {
    clearTimeout(timer.current);
    setNotice({ tone, text });
    timer.current = setTimeout(() => setNotice(null), tone === 'error' ? 9000 : 5000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [notice, notify];
}

/* ------------------------------------------------------------- hero (shared) */
function FieldHero({ status, actions, gps, onAdhoc, compact, onOpen }) {
  const open = status.openVisit;
  const att = status.attendance;
  const elapsed = useElapsed(open?.enteredAt);
  const [confirmOut, setConfirmOut] = useState(false);
  useEffect(() => { if (!confirmOut) return undefined; const t = setTimeout(() => setConfirmOut(false), 4000); return () => clearTimeout(t); }, [confirmOut]);

  const near = gps && nearestSite(status.sites, gps.latitude, gps.longitude);
  const checkedOut = att?.checkedOut;
  const lastAdhoc = !open && status.adhoc?.length ? status.adhoc[status.adhoc.length - 1] : null;
  const onAdhocNow = lastAdhoc && !lastAdhoc.endedTime;

  let state;
  if (checkedOut) state = { tone: 'done', label: 'Day complete', title: `Checked out at ${att.checkOut}`, sub: `Checked in at ${att.checkIn}` };
  else if (open) state = { tone: 'on', label: 'On site', title: open.siteName, sub: `Since ${open.enteredTime} · ${elapsed < 60 ? 'just now' : fmtDuration(elapsed)}` };
  else if (onAdhocNow) state = { tone: 'adhoc', label: 'Ad-hoc visit', title: lastAdhoc.reason.split(':')[0], sub: `Since ${lastAdhoc.startedTime}` };
  else if (att) state = { tone: 'move', label: 'On the move', title: 'Not at a site', sub: `Checked in at ${att.checkIn}${att.site ? ` · ${att.site}` : ''}` };
  else state = { tone: 'idle', label: 'Not checked in', title: 'Start your day', sub: 'Tap “Arrived at site” when you reach the office or a project site.' };

  return (
    <section className={`fd-hero is-${state.tone}${compact ? ' is-compact' : ''}`}>
      <div className="fd-hero-top">
        <span className="fd-hero-label"><span className="fd-pulse" aria-hidden="true" />{state.label}</span>
        {compact && onOpen && <button type="button" className="fd-hero-link" onClick={onOpen}>Field visits <ChevronRight size={14} /></button>}
      </div>
      <div className="fd-hero-title">{state.title}</div>
      <div className="fd-hero-sub">{state.sub}</div>

      {!checkedOut && near && (
        <div className="fd-hero-near">
          <Navigation size={13} />
          {near.inside ? <>You are at <strong>{near.site.name}</strong> ({fmtDistance(near.distance)} from centre)</>
            : <>Nearest: <strong>{near.site.name}</strong>, {fmtDistance(near.distance)} away</>}
          {gps.accuracy ? <span className="fd-hero-acc">GPS ±{gps.accuracy} m</span> : null}
        </div>
      )}

      {!checkedOut && (
        <div className="fd-hero-actions">
          {open ? (
            <button type="button" className="fd-act is-leave" onClick={actions.leave} disabled={!!actions.busy}>
              <LogOut size={20} /><span>{actions.busy === 'leave' ? 'Saving…' : 'Leaving site'}</span>
            </button>
          ) : (
            <button type="button" className="fd-act is-arrive" onClick={actions.arrive} disabled={!!actions.busy}>
              <LogIn size={20} /><span>{actions.busy === 'arrive' ? 'Checking location…' : 'Arrived at site'}</span>
            </button>
          )}
          <button type="button" className="fd-act is-adhoc" onClick={onAdhoc} disabled={!!actions.busy}>
            <Camera size={20} /><span>Ad-hoc visit</span>
          </button>
        </div>
      )}
      {!checkedOut && att && !compact && (
        <button type="button" className={`fd-checkout${confirmOut ? ' is-confirm' : ''}`} disabled={!!actions.busy}
          onClick={() => (confirmOut ? (setConfirmOut(false), actions.checkOut()) : setConfirmOut(true))}>
          {actions.busy === 'checkout' ? 'Checking out…' : confirmOut ? 'Tap again to check out for the day' : 'Check out for the day'}
        </button>
      )}
    </section>
  );
}

function Notice({ notice }) {
  if (!notice) return null;
  return (
    <div className={`fd-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      {notice.tone === 'error' ? <TriangleAlert size={16} /> : <CircleCheck size={16} />}
      <span>{notice.text}</span>
    </div>
  );
}

/* ---------------------------------------------------------- timeline & bars */
function AdhocPhoto({ url }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    let made = null;
    fetchPhotoUrl(url).then((u) => { made = u; if (alive) setSrc(u); }).catch(() => {});
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [url]);
  return <span className="fd-thumb">{src ? <img src={src} alt="Visit" /> : <Camera size={16} />}</span>;
}

const SOURCE_LABEL = { AUTO: 'Auto', MANUAL: 'Button', CHECK_IN: 'Check-in' };
const EXIT_LABEL = { GEOFENCE: 'left area', NEW_SITE: 'moved on', MANUAL: 'button', CHECK_OUT: 'checked out', STALE: 'GPS lost', END_OF_DAY: 'end of day' };
const ADHOC_TONE = { SUBMITTED: 'info', VERIFIED: 'success', FLAGGED: 'danger' };
const ADHOC_LABEL = { SUBMITTED: 'Submitted', VERIFIED: 'Verified', FLAGGED: 'Flagged' };

export function VisitTimeline({ visits = [], adhoc = [], showPhotos = true }) {
  const items = [
    ...visits.map((v) => ({ kind: 'site', at: v.enteredAt, v })),
    ...adhoc.map((a) => ({ kind: 'adhoc', at: a.startedAt, a })),
  ].sort((x, y) => String(x.at).localeCompare(String(y.at)));
  if (!items.length) return <EmptyState icon={<Route size={20} />} title="No visits yet" text="Site visits and ad-hoc visits will appear here as the day goes on." />;
  return (
    <ol className="fd-timeline">
      {items.map((it) => (it.kind === 'site' ? (
        <li key={`v${it.v.id}`} className={`fd-tl is-site${it.v.open ? ' is-open' : ''}${it.v.siteType === 'OFFICE' ? ' is-office' : ''}`}>
          <span className="fd-tl-dot" aria-hidden="true"><MapPinned size={14} /></span>
          <div className="fd-tl-main">
            <div className="fd-tl-title">{it.v.siteName}</div>
            <div className="fd-tl-meta">
              {it.v.enteredTime} – {it.v.open ? 'now' : it.v.exitedTime}
              <span className="fd-tl-tag">{SOURCE_LABEL[it.v.entrySource] || it.v.entrySource}{it.v.exitReason ? ` · ${EXIT_LABEL[it.v.exitReason] || it.v.exitReason}` : ''}</span>
            </div>
          </div>
          <div className="fd-tl-dur">{it.v.dwell}</div>
        </li>
      ) : (
        <li key={`a${it.a.id}`} className="fd-tl is-adhoc">
          <span className="fd-tl-dot" aria-hidden="true"><Camera size={14} /></span>
          <div className="fd-tl-main">
            <div className="fd-tl-title">{it.a.reason}</div>
            <div className="fd-tl-meta">
              {it.a.startedTime}{it.a.endedTime ? ` – ${it.a.endedTime}` : ''}
              <span className="fd-tl-tag">{it.a.locationSource === 'MANUAL_PIN' ? `Pinned${it.a.pin ? ` · ${fmtDistance(it.a.pin.distanceFromGps)} from GPS` : ''}` : 'Current location'}</span>
            </div>
            <StatusPill tone={ADHOC_TONE[it.a.status]}>{ADHOC_LABEL[it.a.status] || it.a.status}</StatusPill>
          </div>
          {showPhotos && <AdhocPhoto url={it.a.photoUrl} />}
        </li>
      )))}
    </ol>
  );
}

export function DwellBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  if (!rows.length) return <EmptyState icon={<Clock size={20} />} title="No time on site yet" text="Time spent at each site is added up here." />;
  return (
    <ul className="fd-bars">
      {rows.map((r) => (
        <li key={r.site}>
          <div className="fd-bar-head"><span>{r.site}</span><strong>{r.dwell || fmtDuration(r.seconds)}</strong></div>
          <div className="fd-bar-track"><span style={{ width: `${Math.max(2, (r.seconds / max) * 100)}%` }} /></div>
          {r.note && <div className="fd-bar-note">{r.note}</div>}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------- screen */
export default function FieldVisits({ user }) {
  const { status, error, loading, reload } = useFieldStatus();
  const [notice, notify] = useNotice();
  const actions = useFieldActions({ status, reload, notify });
  const [adhocOpen, setAdhocOpen] = useState(false);
  const [tracking, setTracking] = useState(() => { try { return localStorage.getItem(TRACK_KEY) === '1'; } catch (e) { return false; } });

  const live = useLiveTracking(!!(tracking && status?.mode === 'FIELD' && !status?.attendance?.checkedOut), {
    onResult: (res) => {
      const e = (res.events || []).filter((x) => x.type !== 'check_in');
      if (e.length) {
        const last = e[e.length - 1];
        notify('success', last.type === 'entry' ? `Arrived at ${last.site} (${last.at})` : `Left ${last.site} (${last.at})`);
        reload();
      } else if ((res.events || []).length) reload();
    },
    onStop: (msg) => { setTracking(false); notify('info', msg); },
  });
  const toggleTracking = () => {
    const next = !tracking;
    setTracking(next);
    try { localStorage.setItem(TRACK_KEY, next ? '1' : '0'); } catch (e) { /* not essential */ }
  };

  const [gps, setGps] = useState(null);
  useEffect(() => { if (live.last) setGps(live.last); }, [live.last]);
  useEffect(() => { // one fix on open for the "nearest site" line
    if (!status || status.mode !== 'FIELD' || status.attendance?.checkedOut) return;
    getPosition({ timeout: 15000 }).then(setGps).catch(() => {});
  }, [status]);

  const dwellRows = useMemo(() => (status?.dwellBySite || []).slice().sort((a, b) => b.seconds - a.seconds), [status]);
  const totalSeconds = dwellRows.reduce((n, r) => n + r.seconds, 0);

  if (loading) return <div><PageHeader title="Field visits" /><Panel><div className="fd-loading">Loading today…</div></Panel></div>;
  if (error) {
    return (
      <div>
        <PageHeader title="Field visits" />
        <Panel><EmptyState icon={<TriangleAlert size={20} />} title="Could not load field visits" text={error} />
          <div style={{ textAlign: 'center', paddingBottom: 16 }}><button type="button" className="hr-btn hr-btn-secondary" onClick={reload}><RefreshCw size={14} /> Try again</button></div>
        </Panel>
      </div>
    );
  }
  if (status.mode !== 'FIELD') {
    return (
      <div>
        <PageHeader title="Field visits" />
        <Panel><EmptyState icon={<MapPin size={20} />} title="Field visits are for field staff" text="Your attendance is at the office. Use My Attendance to check in." /></Panel>
      </div>
    );
  }

  return (
    <div className="fd-page">
      <PageHeader title="Field visits" subtitle={`Today, ${fmtDay(status.date)} · ${user?.name || ''}`} />
      <Notice notice={notice} />
      <FieldHero status={status} actions={actions} gps={gps} onAdhoc={() => setAdhocOpen(true)} />

      {!status.attendance?.checkedOut && (
        <div className={`fd-track${tracking ? ' is-on' : ''}`}>
          <Radio size={16} />
          <div className="fd-track-text">
            <strong>Automatic site detection</strong>
            <span>
              {tracking
                ? (live.problem || (live.last ? `Active · last GPS ±${live.last.accuracy} m` : 'Starting…')) + ' · works while this screen is open'
                : 'Records arrivals and departures for you while this screen is open.'}
            </span>
          </div>
          <button type="button" role="switch" aria-checked={tracking} className="fd-switch" onClick={toggleTracking} aria-label="Automatic site detection"><span /></button>
        </div>
      )}

      <div className="fd-grid">
        <Panel title="Today" subtitle={`${status.visits.length} site ${status.visits.length === 1 ? 'visit' : 'visits'} · ${status.adhoc.length} ad-hoc`} icon={<Route size={16} />} flush>
          <VisitTimeline visits={status.visits} adhoc={status.adhoc} />
        </Panel>
        <Panel title="Time per site" subtitle={totalSeconds ? `${fmtDuration(totalSeconds)} on site today` : 'Today'} icon={<Clock size={16} />}>
          <DwellBars rows={dwellRows} />
        </Panel>
      </div>

      {adhocOpen && (
        <AdhocVisitModal
          sites={status.sites}
          onClose={() => setAdhocOpen(false)}
          onSaved={(res) => { setAdhocOpen(false); notify(res.visit?.status === 'FLAGGED' ? 'info' : 'success', res.visit?.status === 'FLAGGED' ? `${res.message} It was flagged for review: ${(res.flags || []).join('; ')}.` : res.message); reload(); }}
        />
      )}
    </div>
  );
}

/** Compact card for the dashboard of field staff */
export function FieldTodayCard({ onOpen }) {
  const { status, loading, error, reload } = useFieldStatus();
  const [notice, notify] = useNotice();
  const actions = useFieldActions({ status, reload, notify });
  const [adhocOpen, setAdhocOpen] = useState(false);
  if (loading || error || !status || status.mode !== 'FIELD') return null;
  return (
    <div className="fd-dash">
      <Notice notice={notice} />
      <FieldHero status={status} actions={actions} gps={null} compact onOpen={onOpen} onAdhoc={() => setAdhocOpen(true)} />
      {adhocOpen && (
        <AdhocVisitModal sites={status.sites} onClose={() => setAdhocOpen(false)}
          onSaved={(res) => { setAdhocOpen(false); notify('success', res.message); reload(); }} />
      )}
    </div>
  );
}
