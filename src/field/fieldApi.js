/* ==========================================================================
   Field attendance: API calls, GPS and photo helpers shared by the field screens.
   Backend: backend/fieldRoutes.js (see FIELD_ATTENDANCE.md).
   ========================================================================== */
import { API_BASE } from '../config';

const authHeaders = (extra = {}) => ({ Authorization: `Bearer ${localStorage.getItem('token')}`, ...extra });

/** JSON request; throws an Error carrying the server's message (and .status / .body). */
export async function fieldFetch(path, { method = 'GET', body, timeoutMs = 45000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: authHeaders(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError'
      ? 'The server is taking too long. It may be waking up; please try again in a minute.'
      : 'The server could not be reached. Check your internet connection.');
    err.status = 0;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Request failed (${res.status}).`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/** Photo of an ad-hoc visit as an object URL (the endpoint needs the Bearer header, so <img src> cannot load it directly). */
export async function fetchPhotoUrl(photoUrl) {
  const res = await fetch(`${API_BASE}${photoUrl}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Photo unavailable');
  return URL.createObjectURL(await res.blob());
}

/** One GPS fix. Resolves { latitude, longitude, accuracy, at } or rejects with a readable message. */
export function getPosition({ timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This device cannot share its location.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy || 0), at: p.timestamp || Date.now() }),
      (e) => reject(new Error(e.code === 1
        ? 'Location permission is off. Allow location for this app in your phone settings, then try again.'
        : e.code === 3 ? 'Could not get a GPS fix in time. Step outside or near a window and try again.'
          : 'Your location could not be read. Turn on location (GPS) and try again.')),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}

/** Distance in metres (haversine). */
export function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6371e3;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export const fmtDistance = (m) => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`);

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return m ? `${m}m` : `${s % 60}s`;
}

/** Nearest site to a point: { site, distance, inside } */
export function nearestSite(sites, lat, lng) {
  let best = null;
  (sites || []).forEach((s) => {
    const d = distanceM(lat, lng, s.latitude, s.longitude);
    if (!best || d < best.distance) best = { site: s, distance: d, inside: d <= s.radius };
  });
  return best;
}

/** India date (YYYY-MM-DD) n days from today */
export function istDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

export const fmtDay = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
};

/**
 * Shrinks a photo (canvas, video frame or image file) to a JPEG data URL, longest side ≤ 1280 px.
 * Typical result 150–400 KB, well under the server's 2.5 MB limit.
 */
export function toJpegDataUrl(source, maxSide = 1280, quality = 0.8) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function fileToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { try { resolve(toJpegDataUrl(img)); } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); } };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a photo.')); };
    img.src = url;
  });
}
