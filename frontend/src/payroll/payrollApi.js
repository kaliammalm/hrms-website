/* ==========================================================================
   Payroll module: API calls, money formatting and file saving.
   Backend: backend/payroll/payrollRoutes.js
   ========================================================================== */
import { API_BASE } from '../config';
import { fieldFetch } from '../field/fieldApi';

/** JSON request with readable errors (same behaviour as the field screens) */
export const payFetch = (path, opts) => fieldFetch(path, opts);

export const inr = (n, { decimals = 0, symbol = true } = {}) => {
  const v = Number(n) || 0;
  const s = v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return symbol ? `₹${s}` : s;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodLabel = (p) => (p ? `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}` : '');
export const currentPeriod = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
export const shiftPeriod = (p, n) => {
  const d = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/**
 * Saves a file in the browser, or inside the Android app (Capacitor) through the share sheet.
 * Uses the Capacitor Filesystem / Share plugins only when the app has them installed.
 */
export async function saveBlob(blob, filename) {
  const name = String(filename || 'download').replace(/[\\/:*?"<>|]+/g, '_');
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  const fs = cap?.Plugins?.Filesystem;
  const share = cap?.Plugins?.Share;
  if (cap?.isNativePlatform?.() && fs && share) {
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const written = await fs.writeFile({ path: name, data, directory: 'CACHE', recursive: true });
    await share.share({ title: name, url: written.uri, dialogTitle: 'Save or share' });
    return;
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
}

/** Downloads a file the API sends (bank CSV), keeping the server's file name */
export async function downloadFromApi(path, fallbackName) {
  const res = await fetch(`${API_BASE}/api${path}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Download failed (${res.status}).`);
  }
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="?([^";]+)"?/i);
  await saveBlob(await res.blob(), m ? m[1] : fallbackName);
  return { excluded: Number(res.headers.get('X-Excluded-Count') || 0) };
}
