import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Gift, Award, Send, Check, Heart, Sparkles, CalendarClock } from 'lucide-react';
import { API_BASE } from './config';
import { getCompanyBrand, CompanyLogo } from './brand';
import './styles/celebrations.css';

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/* Ready-made wishes; {first} = first name, {years} = "3rd" etc., {company} = company name */
const TEMPLATES = {
  birthday: [
    { key: 'warm', label: 'Warm', text: 'Happy Birthday, {first}! Wishing you a wonderful year ahead filled with good health, happiness and success. Have a lovely day!' },
    { key: 'formal', label: 'Formal', text: 'Dear {first}, warm birthday wishes from all of us at {company}. May the year ahead bring you joy, good health and continued success.' },
    { key: 'cheerful', label: 'Cheerful', text: 'Happy Birthday, {first}! 🎉 Hope today is full of laughter, cake and everything you love. Enjoy your special day!' },
  ],
  anniversary: [
    { key: 'warm', label: 'Warm', text: 'Happy {years} work anniversary, {first}! Thank you for your dedication and everything you bring to the team. Here\'s to many more years together.' },
    { key: 'formal', label: 'Formal', text: 'Congratulations on completing {yearsCount} with {company}, {first}. Your commitment and contribution are truly appreciated.' },
    { key: 'cheerful', label: 'Cheerful', text: 'Cheers to {yearsCount} of great work, {first}! 🎉 It\'s a pleasure working with you. Happy work anniversary!' },
  ],
};

const fill = (text, vars) => text
  .replace(/\{first\}/g, vars.first)
  .replace(/\{company\}/g, vars.company)
  .replace(/\{yearsCount\}/g, vars.yearsCount)
  .replace(/\{years\}/g, vars.years);

const fmtWhen = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS_LONG[Number(m[2]) - 1].slice(0, 3)}` : '';
};

/**
 * Branded greeting card for a birthday or work anniversary.
 * Anyone who can see the celebration can open it; colleagues can pick or write a wish and send it,
 * and the person celebrating sees every wish they received.
 */
export default function CelebrationCard({ event, month, today, onClose }) {
  const occasion = event.occasion || (event.type === 'Birthday' ? 'birthday' : 'anniversary');
  const isBirthday = occasion === 'birthday';
  const brand = getCompanyBrand(event.companyId) || getCompanyBrand(event.companyName);
  const brandKey = brand?.key || 'group';
  const companyName = brand?.legalName || event.companyName || 'RRD Group';
  const years = Number(event.years || 0);
  const vars = useMemo(() => ({
    first: firstName(event.name),
    company: brand?.name || event.companyName || 'the team',
    years: years ? ordinal(years) : '',
    yearsCount: years ? `${years} ${years === 1 ? 'year' : 'years'}` : '',
  }), [event.name, event.companyName, brand, years]);
  const templates = TEMPLATES[occasion];
  const isToday = event.day === today;
  const isPast = event.day < today;
  const canSend = isToday; // wishes open only on the day itself

  const [selected, setSelected] = useState(templates[0].key);
  const [message, setMessage] = useState(() => fill(templates[0].text, vars));
  const [wishes, setWishes] = useState([]);
  const [mine, setMine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null); // { tone, text }
  const dialogRef = useRef(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${localStorage.getItem('token')}` }), []);

  const loadWishes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/celebrations/wishes?userId=${encodeURIComponent(event.userId)}&occasion=${occasion}`, { headers });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setWishes(body.wishes || []);
        setMine(body.mine || null);
        if (body.mine) { setMessage(body.mine.message); setSelected(null); }
      }
    } catch (e) { /* the card still works without the list */ }
    finally { setLoading(false); }
  }, [event.userId, occasion, headers]);

  useEffect(() => { if (event.userId) loadWishes(); else setLoading(false); }, [event.userId, loadWishes]);

  // Escape closes; focus moves into the dialog
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickTemplate = (t) => {
    setSelected(t.key);
    setMessage(fill(t.text, vars));
    setStatus(null);
  };

  const send = async () => {
    if (!canSend) return;
    if (message.trim().length < 2) { setStatus({ tone: 'error', text: 'Please write a short message.' }); return; }
    setSending(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/celebrations/wishes`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: event.userId, occasion, message: message.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setStatus({ tone: 'error', text: body.error || 'Your wish could not be sent. Please try again.' }); return; }
      setStatus({ tone: 'success', text: body.updated ? 'Your wish was updated.' : `Your wish was sent to ${vars.first}.` });
      loadWishes();
    } catch (e) {
      setStatus({ tone: 'error', text: 'The server could not be reached. Please try again.' });
    } finally {
      setSending(false);
    }
  };

  const headline = isBirthday ? 'Happy Birthday' : `Happy ${years ? `${ordinal(years)} ` : ''}Work Anniversary`;
  const dateLabel = `${event.day} ${MONTHS_LONG[(month || 1) - 1]}`;
  const when = isToday ? 'Today' : isPast ? dateLabel : `Coming up · ${dateLabel}`;

  return (
    <div className="hr-modal-scrim hr-cel-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className={`hr-cel-card brand-${brandKey}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${headline}, ${event.name}`}
        tabIndex={-1}
        ref={dialogRef}
      >
        <button type="button" className="hr-cel-close" onClick={onClose} aria-label="Close"><X size={18} /></button>

        {/* Branded greeting */}
        <div className="hr-cel-hero">
          <div className="hr-cel-confetti" aria-hidden="true">{Array.from({ length: 14 }).map((_, i) => <i key={i} />)}</div>
          <div className="hr-cel-logo">
            {brand ? <CompanyLogo company={brand.name} height={26} /> : <span className="hr-cel-group">RRD Group</span>}
          </div>
          <div className="hr-cel-avatar">{initials(event.name)}</div>
          <div className="hr-cel-kicker">
            {isBirthday ? <Gift size={14} /> : <Award size={14} />}
            <span>{when}</span>
          </div>
          <h2 className="hr-cel-headline">{headline}</h2>
          <div className="hr-cel-name">{event.isMe ? `${event.name} (you)` : event.name}</div>
          <div className="hr-cel-meta">{[event.designation, companyName].filter(Boolean).join(' · ')}</div>
          <p className="hr-cel-note">
            {isBirthday
              ? `Wishing you a joyful year ahead, from everyone at ${companyName}.`
              : `Thank you for ${years ? `${years} ${years === 1 ? 'year' : 'years'}` : 'your time'} of dedication, from everyone at ${companyName}.`}
          </p>
        </div>

        <div className="hr-cel-body">
          {/* Composer: colleagues only; active only on the day itself */}
          {!event.isMe && (
            <section className={`hr-cel-compose${canSend ? '' : ' is-locked'}`} aria-disabled={!canSend}>
              <div className="hr-cel-section-title"><Sparkles size={15} /> {mine ? 'Your wish' : `Send ${vars.first} a wish`}</div>
              {!canSend && (
                <div className="hr-cel-locked-note" role="note">
                  <CalendarClock size={16} />
                  <div>
                    {isPast
                      ? <>Wishes could be sent on {vars.first}'s special day ({dateLabel}). You can still read the wishes below.</>
                      : <>You can send wishes on their special day! Come back on <strong>{dateLabel}</strong>.</>}
                  </div>
                </div>
              )}
              <div className="hr-cel-chips" role="radiogroup" aria-label="Message style">
                {templates.map((t) => (
                  <button key={t.key} type="button" role="radio" aria-checked={selected === t.key} disabled={!canSend}
                    className={`hr-cel-chip${selected === t.key ? ' is-on' : ''}`} onClick={() => pickTemplate(t)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea
                className="hr-textarea hr-cel-text"
                rows={3}
                maxLength={600}
                value={message}
                disabled={!canSend}
                onChange={(e) => { setMessage(e.target.value); setSelected(null); setStatus(null); }}
                aria-label="Your message"
              />
              <div className="hr-cel-actions">
                {status && <span className={`hr-cel-status is-${status.tone}`}>{status.tone === 'success' && <Check size={14} />}{status.text}</span>}
                <button type="button" className="hr-btn hr-btn-primary hr-cel-send" onClick={send} disabled={sending || !canSend}
                  title={canSend ? undefined : 'You can send wishes on their special day!'}>
                  <Send size={14} /> {sending ? 'Sending…' : mine ? 'Update wish' : 'Send wishes'}
                </button>
              </div>
            </section>
          )}

          {/* Wishes received */}
          <section className="hr-cel-wall">
            <div className="hr-cel-section-title">
              <Heart size={15} /> {event.isMe ? 'Wishes from your colleagues' : 'Wishes from colleagues'}
              {wishes.length > 0 && <span className="hr-cel-count">{wishes.length}</span>}
            </div>
            {loading ? (
              <div className="hr-cel-empty">Loading wishes…</div>
            ) : wishes.length === 0 ? (
              <div className="hr-cel-empty">
                {event.isMe ? 'Wishes from your colleagues will appear here.' : `Be the first to wish ${vars.first}.`}
              </div>
            ) : (
              <ul className="hr-cel-list">
                {wishes.map((w) => (
                  <li key={w.id} className={w.isMine ? 'is-mine' : ''}>
                    <span className="hr-cel-wish-avatar">{initials(w.fromName)}</span>
                    <div>
                      <div className="hr-cel-wish-from">
                        {w.isMine ? 'You' : w.fromName}
                        <span>{[w.fromRole, fmtWhen(w.createdAt)].filter(Boolean).join(' · ')}</span>
                      </div>
                      <p>{w.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
