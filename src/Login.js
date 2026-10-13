import React, { useState } from 'react';
import { Mail, Lock, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';
import { API_BASE } from './config';

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // No backend address baked into this build (frontend/.env or .env.production missing)
    if (!API_BASE) {
      setError('This app was built without a server address. Add REACT_APP_API_URL to frontend/.env.production and rebuild.');
      setLoading(false);
      return;
    }

    try {
      // Render's free plan sleeps when idle; the first request can take up to a minute
      const controller = new AbortController();
      const slowTimer = setTimeout(() => setError('Waking up the server, this can take up to a minute…'), 6000);
      const abortTimer = setTimeout(() => controller.abort(), 90000);
      let response;
      try {
        response = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(slowTimer);
        clearTimeout(abortTimer);
        setError('');
      }

      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : {}; } catch (parseErr) { data = null; }

      if (!data) {
        // Got a web page instead of the API's JSON: wrong address, or the backend isn't deployed there
        setError(response.status === 404
          ? `The server at ${API_BASE} has no sign-in service (error 404). The backend may not be deployed correctly.`
          : `The server at ${API_BASE} sent an unexpected reply (error ${response.status}). Check that the backend is deployed and running.`);
        return;
      }

      if (response.ok) {
        const tokenValue = data.token || data.accessToken || data.jwt;
        if (tokenValue) localStorage.setItem('token', tokenValue);

        const userData = data.user || data;
        const resolvedUserId = userData.id || userData.user_id || userData.employee_id;

        localStorage.setItem('user', JSON.stringify({
          id: resolvedUserId,
          name: userData.name,
          role: userData.role,
          company_id: userData.company_id,
          attendance_type: userData.attendance_type
        }));

        onLogin(userData);
      } else {
        setError(data.error || data.message || `Sign-in failed (error ${response.status}).`);
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(err?.name === 'AbortError'
        ? `The server at ${API_BASE} did not respond in time. Please try again in a minute.`
        : `Could not reach the server at ${API_BASE}. Check your internet connection, or the server may be down.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="hr-login">
      {/* Brand side — group identity, the three entities this portal serves */}
      <aside className="hr-login-aside">
        <div className="hr-brand" style={{ padding: 0, border: 0 }}>
          <div className="hr-brand-mark">H</div>
          <div>
            <div className="hr-brand-name">RRD Group HRMS</div>
            <div className="hr-brand-sub">Group workforce portal</div>
          </div>
        </div>

        <div>
          <h1>One workforce, three businesses.</h1>
          <p className="hr-login-lede">
            Attendance, leave, payroll and people records for every group company, with each person seeing only what their role allows.
          </p>

          <div className="hr-login-entities">
            <div className="hr-login-entity">
              <span className="hr-login-entity-bar" style={{ background: 'var(--entity-rrd)' }} />
              <div>
                <div className="hr-login-entity-name">Ram Reddy Developers</div>
                <div className="hr-login-entity-sub">Infrastructure and real estate</div>
              </div>
            </div>
            <div className="hr-login-entity">
              <span className="hr-login-entity-bar" style={{ background: 'var(--entity-fh)' }} />
              <div>
                <div className="hr-login-entity-name">Fractio Hospitality</div>
                <div className="hr-login-entity-sub">Hotels and hospitality management</div>
              </div>
            </div>
            <div className="hr-login-entity">
              <span className="hr-login-entity-bar" style={{ background: 'var(--entity-sbv)' }} />
              <div>
                <div className="hr-login-entity-name">Stories by Varnam</div>
                <div className="hr-login-entity-sub">Design and media studio</div>
              </div>
            </div>
          </div>
        </div>

        <div className="hr-login-foot" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={14} /> Access is role-based and every session is token-secured.
        </div>
      </aside>

      {/* Sign-in form */}
      <main className="hr-login-main">
        <div className="hr-login-card">
          <h2>Sign in</h2>
          <p style={{ color: 'var(--muted)', marginTop: 6, marginBottom: 28 }}>
            Use your company email and password.
          </p>

          {error && (
            <div className="hr-alert" role="alert" style={{ marginBottom: 20 }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="hr-field">
              <label className="hr-label" htmlFor="login-email">Work email</label>
              <div className="hr-input-icon">
                <Mail size={16} />
                <input
                  id="login-email"
                  className="hr-input"
                  style={{ height: 44 }}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="name@company.com"
                />
              </div>
            </div>

            <div className="hr-field">
              <label className="hr-label" htmlFor="login-password">Password</label>
              <div className="hr-input-icon">
                <Lock size={16} />
                <input
                  id="login-password"
                  className="hr-input"
                  style={{ height: 44 }}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                />
              </div>
            </div>

            <button type="submit" disabled={loading} className="hr-btn hr-btn-primary hr-btn-lg hr-btn-block" style={{ marginTop: 6 }}>
              {loading ? 'Signing in…' : <>Sign in <ArrowRight size={16} /></>}
            </button>
          </form>

          <p className="hr-hint" style={{ marginTop: 24, textAlign: 'center' }}>
            Trouble signing in? Contact your HR administrator.
          </p>
        </div>
      </main>
    </div>
  );
}

export default Login;