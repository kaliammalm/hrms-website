/* ==========================================================================
   Field Tracking (MD / CFO, CEO, HR): time per site per employee, who is on
   site now, a day-by-day drill-down and the ad-hoc visit review queue.
   GET /field/summary · /field/visits · /field/adhoc · PATCH /field/adhoc/:id/review
   ========================================================================== */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Users, MapPinned, Camera, Flag, CircleCheck, ExternalLink, ChevronRight, X, Route, RefreshCw, TriangleAlert } from 'lucide-react';
import { PageHeader, Panel, KpiStrip, Kpi, EmptyState, StatusPill } from '../ui';
import { VisitTimeline, DwellBars } from './FieldVisits';
import { fieldFetch, fetchPhotoUrl, fmtDuration, fmtDistance, fmtDay, istDate } from './fieldApi';
import '../styles/field.css';

const RANGES = [
  { key: 'today', label: 'Today', from: () => istDate(), to: () => istDate() },
  { key: 'week', label: 'Last 7 days', from: () => istDate(-6), to: () => istDate() },
  { key: 'month', label: 'This month', from: () => `${istDate().slice(0, 8)}01`, to: () => istDate() },
];
// "R Praveen Thomso" → "Praveen": skip initials
const shortName = (n) => String(n || '').split(/\s+/).find((w) => w.replace(/\W/g, '').length > 1) || n;
const ADHOC_TONE = { SUBMITTED: 'info', VERIFIED: 'success', FLAGGED: 'danger' };
const ADHOC_LABEL = { SUBMITTED: 'To review', VERIFIED: 'Verified', FLAGGED: 'Flagged' };

function Photo({ url, onOpen }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made = null;
    fetchPhotoUrl(url).then((u) => { made = u; if (alive) setSrc(u); }).catch(() => alive && setFailed(true));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [url]);
  return (
    <button type="button" className="fd-review-photo" onClick={() => src && onOpen(src)} disabled={!src} aria-label="Open photo">
      {src ? <img src={src} alt="Visit" /> : <Camera size={18} />}
      {failed && <span>No photo</span>}
    </button>
  );
}

function ReviewRow({ v, onDone, canReview }) {
  const [mode, setMode] = useState(null); // 'FLAGGED' while writing a note
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [big, setBig] = useState(null);
  const decide = async (status) => {
    setBusy(true); setErr('');
    try {
      await fieldFetch(`/field/adhoc/${v.id}/review`, { method: 'PATCH', body: { status, note: note.trim() || undefined } });
      setMode(null); setNote('');
      onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const where = v.pin || { latitude: v.latitude, longitude: v.longitude };
  return (
    <li className={`fd-review is-${String(v.status).toLowerCase()}`}>
      <Photo url={v.photoUrl} onOpen={setBig} />
      <div className="fd-review-main">
        <div className="fd-review-top">
          <strong>{v.employeeName}</strong>
          <span className="fd-review-when">{fmtDay(v.date)}, {v.startedTime}{v.endedTime ? `–${v.endedTime}` : ''}</span>
          <StatusPill tone={ADHOC_TONE[v.status]}>{ADHOC_LABEL[v.status] || v.status}</StatusPill>
        </div>
        <p className="fd-review-reason">{v.reason}</p>
        <div className="fd-review-meta">
          <a href={`https://www.google.com/maps?q=${where.latitude},${where.longitude}`} target="_blank" rel="noreferrer">
            <ExternalLink size={12} /> {v.locationSource === 'MANUAL_PIN' ? 'Pinned location' : 'GPS location'}
          </a>
          {v.locationSource === 'MANUAL_PIN' && v.pin && <span className={v.pin.distanceFromGps > 1000 ? 'is-bad' : ''}>pin {fmtDistance(v.pin.distanceFromGps)} from phone</span>}
          {v.accuracy != null && <span>GPS ±{v.accuracy} m</span>}
        </div>
        {v.reviewNote && <div className="fd-review-note">{v.reviewNote}</div>}
        {canReview && v.status !== 'VERIFIED' && !mode && (
          <div className="fd-review-actions">
            <button type="button" className="hr-btn hr-btn-success-soft hr-btn-sm" onClick={() => decide('VERIFIED')} disabled={busy}><CircleCheck size={14} /> Verify</button>
            {v.status !== 'FLAGGED' && <button type="button" className="hr-btn hr-btn-danger-soft hr-btn-sm" onClick={() => setMode('FLAGGED')} disabled={busy}><Flag size={14} /> Flag</button>}
          </div>
        )}
        {mode === 'FLAGGED' && (
          <div className="fd-review-flag">
            <input className="hr-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="What needs checking? (the employee sees this)" aria-label="Note" autoFocus />
            <button type="button" className="hr-btn hr-btn-danger-soft hr-btn-sm" onClick={() => decide('FLAGGED')} disabled={busy}>Flag</button>
            <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={() => setMode(null)}>Cancel</button>
          </div>
        )}
        {err && <div className="fd-warn">{err}</div>}
      </div>
      {big && (
        <div className="hr-modal-scrim" onClick={() => setBig(null)} role="dialog" aria-modal="true" aria-label="Photo">
          <img className="fd-photo-big" src={big} alt="Visit" />
        </div>
      )}
    </li>
  );
}

function DayDrawer({ employee, date: initialDate, companyId, onClose }) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setData(null); setErr('');
    fieldFetch(`/field/visits?date=${date}&userId=${employee.userId}${companyId ? `&companyId=${companyId}` : ''}`)
      .then((d) => alive && setData(d)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [date, employee.userId, companyId]);
  const total = (data?.visits || []).reduce((n, v) => n + v.dwellSeconds, 0);
  return (
    <div className="hr-modal-scrim fd-sheet-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={`${employee.name}, visits`}>
      <div className="hr-modal hr-modal-lg fd-sheet">
        <div className="fd-sheet-head">
          <div>
            <h3 className="hr-modal-title">{employee.name}</h3>
            <p className="hr-modal-sub">{employee.empCode} · {total ? `${fmtDuration(total)} on site` : 'No site time'} on {fmtDay(date)}</p>
          </div>
          <button type="button" className="hr-btn hr-btn-ghost hr-btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="fd-drawer-bar">
          <input type="date" className="hr-input" value={date} max={istDate()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
        </div>
        <div className="fd-drawer-body">
          {err ? <EmptyState icon={<TriangleAlert size={20} />} title="Could not load" text={err} />
            : !data ? <div className="fd-loading">Loading…</div>
              : <VisitTimeline visits={data.visits} adhoc={data.adhoc} showPhotos={false} />}
        </div>
      </div>
    </div>
  );
}

export default function FieldTracking({ companyId, selectedCompany, userRole }) {
  const [range, setRange] = useState('today');
  const [custom, setCustom] = useState({ from: istDate(-6), to: istDate() });
  const [summary, setSummary] = useState(null);
  const [live, setLive] = useState([]);
  const [adhoc, setAdhoc] = useState([]);
  const [filter, setFilter] = useState('SUBMITTED');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(null);

  const span = useMemo(() => {
    const r = RANGES.find((x) => x.key === range);
    return r ? { from: r.from(), to: r.to() } : custom;
  }, [range, custom]);
  const company = companyId && companyId !== 'all' ? companyId : '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cq = company ? `&companyId=${company}` : '';
      const [s, v, a] = await Promise.all([
        fieldFetch(`/field/summary?from=${span.from}&to=${span.to}${cq}`),
        fieldFetch(`/field/visits?all=1&date=${istDate()}${cq}`),
        fieldFetch(`/field/adhoc?from=${span.from}&to=${span.to}${cq}`),
      ]);
      setSummary(s); setLive(v.visits || []); setAdhoc(a.visits || []); setError('');
    } catch (e) {
      setError(e.status === 503 ? 'Field attendance is not set up yet: run the database migration (see FIELD_ATTENDANCE.md).' : e.message);
    } finally { setLoading(false); }
  }, [span.from, span.to, company]);
  useEffect(() => { load(); }, [load]);

  const onSiteNow = live.filter((v) => v.open);
  const employees = summary?.employees || [];
  const totalSeconds = employees.reduce((n, e) => n + e.totalSeconds, 0);
  const flagged = adhoc.filter((a) => a.status === 'FLAGGED').length;
  const toReview = adhoc.filter((a) => a.status === 'SUBMITTED').length;
  const shownAdhoc = filter === 'ALL' ? adhoc : adhoc.filter((a) => a.status === filter);
  const siteRows = (summary?.sites || []).map((s) => ({ ...s, note: `${s.visits} ${s.visits === 1 ? 'visit' : 'visits'} · ${s.people} ${s.people === 1 ? 'person' : 'people'}` }));
  const scopeLabel = company ? selectedCompany : (userRole === 'MD' ? 'All companies' : selectedCompany);

  return (
    <div className="fd-page">
      <PageHeader
        title="Field tracking"
        subtitle={`${scopeLabel || ''} · ${span.from === span.to ? fmtDay(span.from) : `${fmtDay(span.from)} – ${fmtDay(span.to)}`}`}
        actions={<button type="button" className="hr-btn hr-btn-secondary" onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</button>}
      />

      <div className="fd-filters">
        <div className="fd-seg is-inline" role="radiogroup" aria-label="Period">
          {RANGES.map((r) => <button key={r.key} type="button" role="radio" aria-checked={range === r.key} className={range === r.key ? 'is-on' : ''} onClick={() => setRange(r.key)}>{r.label}</button>)}
          <button type="button" role="radio" aria-checked={range === 'custom'} className={range === 'custom' ? 'is-on' : ''} onClick={() => setRange('custom')}>Custom</button>
        </div>
        {range === 'custom' && (
          <div className="fd-dates">
            <input type="date" className="hr-input" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="From" />
            <span>to</span>
            <input type="date" className="hr-input" value={custom.to} min={custom.from} max={istDate()} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="To" />
          </div>
        )}
      </div>

      {error ? (
        <Panel><EmptyState icon={<TriangleAlert size={20} />} title="Could not load field tracking" text={error} /></Panel>
      ) : (
        <>
          <KpiStrip>
            <Kpi label="On site now" value={loading && !summary ? '…' : onSiteNow.length} note={onSiteNow.length ? onSiteNow.map((v) => `${shortName(v.employeeName)} @ ${v.siteName}`).slice(0, 3).join(', ') : 'Nobody at a site'} icon={<MapPinned size={14} />} tone={onSiteNow.length ? 'success' : undefined} />
            <Kpi label="Time on site" value={loading && !summary ? '…' : fmtDuration(totalSeconds)} note={`${employees.filter((e) => e.totalSeconds > 0).length} of ${employees.length} field staff`} icon={<Clock size={14} />} />
            <Kpi label="Ad-hoc visits" value={adhoc.length} note={toReview ? `${toReview} to review` : 'All reviewed'} icon={<Camera size={14} />} />
            <Kpi label="Flagged" value={flagged} note="Pin far from GPS, old photo or flagged by a reviewer" icon={<Flag size={14} />} tone={flagged ? 'danger' : undefined} />
          </KpiStrip>

          <div className="fd-grid">
            <Panel title="By employee" subtitle="Tap a name for the day-by-day visits" icon={<Users size={16} />} flush>
              {!employees.length ? <EmptyState icon={<Users size={20} />} title="No field staff in view" text="Field staff are set by the database migration." /> : (
                <ul className="fd-people">
                  {employees.map((e) => (
                    <li key={e.userId}>
                      <button type="button" onClick={() => setDrawer(e)}>
                        <div className="fd-people-head">
                          <span className="fd-people-name">{e.name}<small>{e.empCode}</small></span>
                          <span className="fd-people-total">{e.totalSeconds ? e.total : '—'}</span>
                          <ChevronRight size={16} className="fd-people-chev" />
                        </div>
                        <div className="fd-people-sites">
                          {e.sites.length ? e.sites.map((s) => <span key={s.siteId} className={`fd-site-chip${s.type === 'OFFICE' ? ' is-office' : ''}`}>{s.site} <strong>{s.dwell}</strong></span>)
                            : <span className="fd-people-none">No site visits in this period</span>}
                          {e.adhocVisits > 0 && <span className={`fd-site-chip is-adhoc${e.adhocFlagged ? ' is-flag' : ''}`}>Ad-hoc <strong>{e.adhocVisits}</strong>{e.adhocFlagged ? ` · ${e.adhocFlagged} flagged` : ''}</span>}
                        </div>
                        {e.daysOnSite > 0 && range !== 'today' && <div className="fd-people-foot">{e.daysOnSite} {e.daysOnSite === 1 ? 'day' : 'days'} on site</div>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Time per site" subtitle={totalSeconds ? `${fmtDuration(totalSeconds)} in total` : 'No site time in this period'} icon={<Route size={16} />}>
              <DwellBars rows={siteRows} />
            </Panel>
          </div>

          <Panel
            title="Ad-hoc visits"
            subtitle="Check the photo, reason and location, then verify or flag"
            icon={<Camera size={16} />}
            actions={(
              <div className="fd-seg is-inline is-sm" role="radiogroup" aria-label="Status">
                {[['SUBMITTED', `To review${toReview ? ` (${toReview})` : ''}`], ['FLAGGED', 'Flagged'], ['VERIFIED', 'Verified'], ['ALL', 'All']].map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={filter === k} className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </div>
            )}
            flush
          >
            {!shownAdhoc.length ? <EmptyState icon={<Camera size={20} />} title={filter === 'SUBMITTED' ? 'Nothing to review' : 'No visits'} text="Ad-hoc visits logged by field staff in this period appear here." /> : (
              <ul className="fd-reviews">
                {shownAdhoc.map((v) => <ReviewRow key={v.id} v={v} onDone={load} canReview />)}
              </ul>
            )}
          </Panel>
        </>
      )}

      {drawer && <DayDrawer employee={drawer} date={span.to} companyId={company} onClose={() => setDrawer(null)} />}
    </div>
  );
}
