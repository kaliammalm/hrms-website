/* ==========================================================================
   Backend address — the single place every API call gets it from.
   Set REACT_APP_API_URL (no trailing slash, no /api):
     • local development:  frontend/.env               REACT_APP_API_URL=http://localhost:5000
     • Vercel:             Project → Settings → Environment Variables
                           REACT_APP_API_URL=https://hrms-backend-v3.onrender.com
   Create React App reads it at build/start time, so restart `npm start` or redeploy after changing it.
   ========================================================================== */
export const API_BASE = String(process.env.REACT_APP_API_URL || '').trim().replace(/\/+$/, '');

if (!API_BASE) {
  // eslint-disable-next-line no-console
  console.error('REACT_APP_API_URL is not set. Add it to frontend/.env (local) or the Vercel environment variables, then restart/redeploy.');
}

/** Full URL for an API path, e.g. apiUrl('/api/employees') */
export const apiUrl = (path) => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
