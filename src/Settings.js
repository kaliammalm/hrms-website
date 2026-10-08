import React, { useEffect, useMemo, useState } from 'react';
import { User, Shield, HelpCircle, Save, Briefcase, Phone, KeyRound, CheckCircle2, AlertCircle, Building2 } from 'lucide-react';
import { PageHeader, Field, DataItem, StatusPill } from './ui';
import { getCompanyBrand, CompanyLogo } from './brand';

const API = 'https://hrms-backend-v3.onrender.com/api';

const TABS = [
  { id: 'Profile Settings', label: 'My profile', icon: <User size={16} /> },
  { id: 'Account & Security', label: 'Sign-in & security', icon: <Shield size={16} /> },
  { id: 'Help & Support', label: 'Help', icon: <HelpCircle size={16} /> },
];

const getStoredUser = () => {
  try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch (e) { return {}; }
};

// YYYY-MM-DD for <input type="date">; accepts YYYY-MM-DD[...], DD/MM/YYYY, DD-MM-YYYY
const toInputDate = (value) => {
  if (!value) return '';
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
};

const prettyDate = (value) => {
  const iso = toInputDate(value);
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
};

function Notice({ tone, children }) {
  if (!children) return null;
  const ok = tone === 'success';
  return (
    <div className={`hr-alert${ok ? ' hr-alert-success' : ''}`} role={ok ? 'status' : 'alert'}>
      {ok ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} /> : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />}
      <span>{children}</span>
    </div>
  );
}

function Settings({ user, activeTab, setActiveTab }) {
  const baseUser = useMemo(() => ({ ...getStoredUser(), ...user }), [user]);
  const userId = baseUser.id || baseUser.user_id || baseUser.employee_id;
  const tab = TABS.some((t) => t.id === activeTab) ? activeTab : 'Profile Settings';

  // ---- Profile (loaded from the employee record) ------------------------
  const [profile, setProfile] = useState(baseUser);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [form, setForm] = useState({ phone: baseUser.phone || '', dob: toInputDate(baseUser.dob), address: baseUser.address || '' });
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState({ tone: '', text: '' });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!userId) { setLoadingProfile(false); return; }
      try {
        const res = await fetch(`${API}/employees/${userId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        if (res.ok) {
          const data = await res.json();
          if (!alive) return;
          setProfile((p) => ({ ...p, ...data }));
          setForm({ phone: data.phone || '', dob: toInputDate(data.dob), address: data.address || '' });
        }
      } catch (e) { /* keep values from the session */ }
      finally { if (alive) setLoadingProfile(false); }
    };
    load();
    return () => { alive = false; };
  }, [userId]);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setProfileMsg({ tone: '', text: '' });
    const phoneDigits = form.phone.replace(/\D/g, '');
    if (form.phone && (phoneDigits.length < 10 || phoneDigits.length > 13)) {
      setProfileMsg({ tone: 'error', text: 'Enter a valid phone number, for example +91 98765 43210.' });
      return;
    }
    if (form.dob && form.dob > new Date().toISOString().slice(0, 10)) {
      setProfileMsg({ tone: 'error', text: 'Date of birth can’t be in the future.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API}/employees/${userId}/extended-details`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ phone: form.phone.trim() || undefined, dob: form.dob || undefined, address: form.address.trim() || undefined }),
      });
      if (!res.ok) throw new Error('save failed');
      setProfile((p) => ({ ...p, phone: form.phone, dob: form.dob, address: form.address }));
      try { localStorage.setItem('user', JSON.stringify({ ...getStoredUser(), phone: form.phone, dob: form.dob, address: form.address })); } catch (err) { /* ignore */ }
      setProfileMsg({ tone: 'success', text: 'Personal details saved.' });
    } catch (err) {
      setProfileMsg({ tone: 'error', text: 'Your details couldn’t be saved. Check your connection and try again.' });
    } finally {
      setSaving(false);
    }
  };

  // ---- Password ----------------------------------------------------------
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState({ tone: '', text: '' });
  const loginEmail = profile.email || baseUser.email || '';
  const canSignIn = loginEmail && !loginEmail.endsWith('@pending.local');

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwMsg({ tone: '', text: '' });
    if (!pw.current || !pw.next || !pw.confirm) return setPwMsg({ tone: 'error', text: 'Fill in all three fields.' });
    if (pw.next.length < 8) return setPwMsg({ tone: 'error', text: 'Your new password must be at least 8 characters.' });
    if (pw.next === pw.current) return setPwMsg({ tone: 'error', text: 'Your new password must be different from the current one.' });
    if (pw.next.toLowerCase() === 'password123') return setPwMsg({ tone: 'error', text: 'Choose a password other than the default one.' });
    if (pw.next !== pw.confirm) return setPwMsg({ tone: 'error', text: 'The new passwords don’t match.' });

    setPwBusy(true);
    try {
      const check = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: pw.current }),
      });
      if (!check.ok) { setPwMsg({ tone: 'error', text: 'Your current password is incorrect.' }); return; }
      const res = await fetch(`${API}/employees/${userId}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ newPassword: pw.next }),
      });
      if (!res.ok) throw new Error('update failed');
      setPw({ current: '', next: '', confirm: '' });
      setPwMsg({ tone: 'success', text: 'Password updated. Use your new password next time you sign in.' });
    } catch (err) {
      setPwMsg({ tone: 'error', text: 'Your password couldn’t be updated. Try again in a moment.' });
    } finally {
      setPwBusy(false);
    }
  };

  // ---- Display values ----------------------------------------------------
  const companyName = profile.company_name || profile.companyName || baseUser.company_name || '';
  const brand = getCompanyBrand(profile.company_id || companyName);
  const designation = profile.role || baseUser.role || '';
  const department = profile.department && String(profile.department).toLowerCase() !== 'general' ? profile.department : '';
  const initials = (profile.name || 'U').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  const isMD = String(designation).toUpperCase() === 'MD';

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your profile, sign-in and where to get help." />

      <section className="hr-panel">
        <div className="hr-settings">
          <nav className="hr-settings-nav" aria-label="Settings sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`hr-settings-tab${tab === t.id ? ' is-active' : ''}`}
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setActiveTab(t.id)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </nav>

          <div className="hr-settings-body">
            {tab === 'Profile Settings' && (
              <div className="hr-settings-stack">
                {/* Identity summary */}
                <div className="hr-settings-identity">
                  <span className="hr-avatar hr-avatar-ink" style={{ width: 56, height: 56, fontSize: 20 }}>{initials}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hr-profile-name" style={{ fontSize: 18 }}>{profile.name || 'Your profile'}</div>
                    <div className="hr-profile-meta" style={{ marginTop: 6 }}>
                      {designation && <StatusPill tone="info" dot={false}>{designation}</StatusPill>}
                      {profile.emp_code && <StatusPill tone="neutral" dot={false}><span className="num">{profile.emp_code}</span></StatusPill>}
                      {loadingProfile && <span className="hr-hint">Loading latest details…</span>}
                    </div>
                  </div>
                  {brand && <CompanyLogo company={brand.name} height={30} />}
                </div>

                {/* Work details (HR-managed) */}
                <div>
                  <h3 className="hr-profile-section-title"><Briefcase size={16} /> Work details</h3>
                  <p className="hr-sub-text" style={{ marginTop: -8 }}>Managed by HR. Ask HR if anything here is wrong.</p>
                  <div className="hr-dl">
                    <DataItem label="Employee code" value={profile.emp_code} />
                    <DataItem label="Designation" value={designation} />
                    <DataItem label="Department" value={department} />
                    <DataItem label="Company" value={isMD && !companyName ? 'All group companies' : (brand?.legalName || companyName)} />
                    <DataItem label="Joining date" value={prettyDate(profile.joining_date || profile.joiningDate)} />
                    <DataItem label="Official email (sign-in)" value={canSignIn ? loginEmail : ''} />
                  </div>
                </div>

                <hr className="hr-divider" style={{ margin: 0 }} />

                {/* Personal details (self-service) */}
                <form onSubmit={handleSaveProfile} noValidate>
                  <h3 className="hr-profile-section-title"><Phone size={16} /> Personal details</h3>
                  <p className="hr-sub-text" style={{ marginTop: -8 }}>You can update these yourself. Your birthday appears on the dashboard in your birth month.</p>
                  <div className="hr-form-grid">
                    <Field label="Mobile number">
                      <input className="hr-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210"
                        value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </Field>
                    <Field label="Date of birth">
                      <input className="hr-input" type="date" max={new Date().toISOString().slice(0, 10)}
                        value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
                    </Field>
                    <Field label="Address" className="hr-span-all">
                      <textarea className="hr-textarea" rows="2" placeholder="House / street, area, city, PIN"
                        value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                    </Field>
                  </div>
                  <div className="hr-settings-actions">
                    <Notice tone={profileMsg.tone}>{profileMsg.text}</Notice>
                    <button type="submit" className="hr-btn hr-btn-primary" disabled={saving || !userId}>
                      <Save size={15} /> {saving ? 'Saving…' : 'Save personal details'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {tab === 'Account & Security' && (
              <div className="hr-settings-stack" style={{ maxWidth: 460 }}>
                <div>
                  <h3 className="hr-sub-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><KeyRound size={18} /> Change password</h3>
                  <p className="hr-sub-text">
                    {canSignIn ? <>You sign in as <strong style={{ color: 'var(--ink)' }}>{loginEmail}</strong>. If you still use the default password, change it now.</>
                      : 'Your official email hasn’t been set up yet, so you can’t change a password here. Ask HR to add your email.'}
                  </p>
                </div>
                {canSignIn && (
                  <form onSubmit={handleChangePassword} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <Field label="Current password">
                      <input className="hr-input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
                    </Field>
                    <Field label="New password" hint="At least 8 characters.">
                      <input className="hr-input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
                    </Field>
                    <Field label="Confirm new password">
                      <input className="hr-input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
                    </Field>
                    <Notice tone={pwMsg.tone}>{pwMsg.text}</Notice>
                    <div>
                      <button type="submit" className="hr-btn hr-btn-primary" disabled={pwBusy}>{pwBusy ? 'Updating…' : 'Update password'}</button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {tab === 'Help & Support' && (
              <div className="hr-settings-stack" style={{ maxWidth: 560 }}>
                <div>
                  <h3 className="hr-sub-title">Who to contact</h3>
                  <p className="hr-sub-text">Pick the topic that matches your question.</p>
                </div>
                <div className="hr-panel" style={{ boxShadow: 'none' }}>
                  <div className="hr-list">
                    <div className="hr-list-row">
                      <span className="hr-list-icon"><Briefcase size={16} /></span>
                      <div className="hr-list-main">
                        <div className="hr-list-title">Name, designation, department or joining date</div>
                        <div className="hr-list-sub">Your HR team updates official records.</div>
                      </div>
                    </div>
                    <div className="hr-list-row">
                      <span className="hr-list-icon"><Building2 size={16} /></span>
                      <div className="hr-list-main">
                        <div className="hr-list-title">Leave or attendance approvals</div>
                        <div className="hr-list-sub">
                          {brand?.ceo ? `Your manager, or ${brand.ceo} (CEO, ${brand.legalName}).` : 'Your manager or company management.'}
                        </div>
                      </div>
                    </div>
                    <div className="hr-list-row">
                      <span className="hr-list-icon"><Shield size={16} /></span>
                      <div className="hr-list-main">
                        <div className="hr-list-title">Can’t sign in or forgot your password</div>
                        <div className="hr-list-sub">Ask HR to reset your password.</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Settings;