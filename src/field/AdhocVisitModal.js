/* ==========================================================================
   Ad-hoc Visit form: where (current location or a pin), why, and a live photo.
   POST /api/field/adhoc
   ========================================================================== */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Navigation, MapPin, Camera, RefreshCw, SwitchCamera, TriangleAlert, Check } from 'lucide-react';
import PinMap from './PinMap';
import { fieldFetch, getPosition, distanceM, fmtDistance, toJpegDataUrl, fileToJpegDataUrl, nearestSite } from './fieldApi';

const REASONS = ['Client meeting', 'Vendor / supplier visit', 'Bank or government office', 'Material purchase', 'Land / site survey'];
const PIN_FLAG_M = 1000;
const MAX_ACCURACY_M = 100;

export default function AdhocVisitModal({ sites = [], onClose, onSaved }) {
  const [fix, setFix] = useState(null);           // { lat, lng, accuracy }
  const [fixError, setFixError] = useState('');
  const [locating, setLocating] = useState(false);
  const [source, setSource] = useState('CURRENT');
  const [pin, setPin] = useState(null);
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState(null);        // { dataUrl, takenAt }
  const [camera, setCamera] = useState({ open: false, error: '', facing: 'environment' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);

  const locate = useCallback(async () => {
    setLocating(true);
    setFixError('');
    try {
      const p = await getPosition();
      setFix({ lat: p.latitude, lng: p.longitude, accuracy: p.accuracy });
    } catch (e) {
      setFixError(e.message);
    } finally {
      setLocating(false);
    }
  }, []);
  useEffect(() => { locate(); }, [locate]);

  // ---- camera
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stopCamera, [stopCamera]);
  // Attach the stream once the <video> is on screen
  useEffect(() => {
    const v = videoRef.current;
    if (camera.open && v && streamRef.current && v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current;
      v.play().catch(() => {});
    }
  });

  const openCamera = async (facing = camera.facing) => {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) { fileRef.current?.click(); return; }
    setCamera({ open: true, error: '', facing });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
    } catch (e) {
      setCamera({ open: false, error: e.name === 'NotAllowedError' ? 'Camera permission is off. Allow the camera for this app, or use the phone camera below.' : 'The camera could not start. Use the phone camera below.', facing });
    }
  };
  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setPhoto({ dataUrl: toJpegDataUrl(v), takenAt: new Date().toISOString() });
    stopCamera();
    setCamera((c) => ({ ...c, open: false }));
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    // A file picked from the gallery can be old; the server flags photos older than 15 minutes
    const takenAt = f.lastModified ? new Date(f.lastModified).toISOString() : new Date().toISOString();
    try { setPhoto({ dataUrl: await fileToJpegDataUrl(f), takenAt }); } catch (err) { setCamera((c) => ({ ...c, error: err.message })); }
  };

  // ---- derived checks
  const pinDistance = fix && pin ? distanceM(fix.lat, fix.lng, pin.lat, pin.lng) : null;
  const atSite = fix && nearestSite(sites, fix.lat, fix.lng);
  const insideSite = atSite?.inside ? atSite.site : null;
  const weak = fix && fix.accuracy > MAX_ACCURACY_M;
  const problems = [];
  if (!fix) problems.push('your location');
  if (source === 'MANUAL_PIN' && !pin) problems.push('a pin on the map');
  if (reason.trim().length < 5) problems.push('the reason');
  if (!photo) problems.push('a photo');
  const canSubmit = !problems.length && !weak && !insideSite && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const body = {
        latitude: fix.lat, longitude: fix.lng, accuracy: fix.accuracy,
        locationSource: source,
        pinLatitude: source === 'MANUAL_PIN' ? pin.lat : undefined,
        pinLongitude: source === 'MANUAL_PIN' ? pin.lng : undefined,
        reason: reason.trim(), photo: photo.dataUrl, photoTakenAt: photo.takenAt,
      };
      const res = await fieldFetch('/field/adhoc', { method: 'POST', body, timeoutMs: 90000 });
      stopCamera();
      onSaved?.(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hr-modal-scrim fd-sheet-scrim" role="dialog" aria-modal="true" aria-labelledby="fd-adhoc-title">
      <div className="hr-modal hr-modal-lg fd-sheet">
        <div className="fd-sheet-head">
          <div>
            <h3 className="hr-modal-title" id="fd-adhoc-title">Ad-hoc visit</h3>
            <p className="hr-modal-sub">For client, vendor or office visits away from the project sites.</p>
          </div>
          <button type="button" className="hr-btn hr-btn-ghost hr-btn-icon" onClick={() => { stopCamera(); onClose(); }} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="hr-modal-body fd-adhoc">
          {/* 1. Where */}
          <section className="fd-step">
            <div className="fd-step-title"><span className="fd-step-no">1</span> Where are you?</div>
            <div className="fd-seg" role="radiogroup" aria-label="Location">
              <button type="button" role="radio" aria-checked={source === 'CURRENT'} className={source === 'CURRENT' ? 'is-on' : ''} onClick={() => setSource('CURRENT')}>
                <Navigation size={15} /> Current location
              </button>
              <button type="button" role="radio" aria-checked={source === 'MANUAL_PIN'} className={source === 'MANUAL_PIN' ? 'is-on' : ''} onClick={() => { setSource('MANUAL_PIN'); if (!pin && fix) setPin({ lat: fix.lat, lng: fix.lng }); }}>
                <MapPin size={15} /> Pin on map
              </button>
            </div>

            <div className={`fd-gps${fixError || weak ? ' is-bad' : fix ? ' is-good' : ''}`}>
              <span className="fd-gps-dot" aria-hidden="true" />
              <span className="fd-gps-text">
                {locating ? 'Getting your location…'
                  : fixError || (fix ? `GPS ±${fix.accuracy} m${weak ? ' — too weak, move to an open area' : ''}` : 'Location not available')}
              </span>
              <button type="button" className="hr-btn hr-btn-ghost hr-btn-sm" onClick={locate} disabled={locating}><RefreshCw size={13} /> Refresh</button>
            </div>

            {source === 'MANUAL_PIN' && (
              <>
                <PinMap me={fix && { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }} pin={pin} onPin={(lat, lng) => setPin({ lat, lng })} sites={sites} />
                <p className="fd-hint">
                  Tap the map where the visit is.
                  {pinDistance !== null && <> Pin is <strong>{fmtDistance(pinDistance)}</strong> from you.</>}
                </p>
                {pinDistance !== null && pinDistance > PIN_FLAG_M && (
                  <div className="fd-warn"><TriangleAlert size={15} /> More than 1 km from your phone's location: this visit will be flagged for review.</div>
                )}
              </>
            )}
            {insideSite && (
              <div className="fd-warn is-block"><TriangleAlert size={15} /> You are at {insideSite.name}. Use “Arrived at site” instead of an ad-hoc visit.</div>
            )}
          </section>

          {/* 2. Why */}
          <section className="fd-step">
            <div className="fd-step-title"><span className="fd-step-no">2</span> Reason</div>
            <div className="fd-chips">
              {REASONS.map((r) => (
                <button key={r} type="button" className={`fd-chip${reason.startsWith(r) ? ' is-on' : ''}`}
                  onClick={() => setReason((cur) => (cur.trim() && !REASONS.some((x) => cur.startsWith(x)) ? `${r}: ${cur}` : `${r}: `))}>{r}</button>
              ))}
            </div>
            <textarea className="hr-textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Who you are meeting and why, e.g. Client meeting: loan documents with HDFC, Guindy" aria-label="Reason for the visit" />
            <div className="fd-count">{reason.length}/500</div>
          </section>

          {/* 3. Photo */}
          <section className="fd-step">
            <div className="fd-step-title"><span className="fd-step-no">3</span> Live photo</div>
            {camera.open ? (
              <div className="fd-cam">
                <video ref={videoRef} playsInline muted autoPlay />
                <div className="fd-cam-bar">
                  <button type="button" className="fd-cam-btn" onClick={() => { stopCamera(); setCamera((c) => ({ ...c, open: false })); }} aria-label="Cancel"><X size={18} /></button>
                  <button type="button" className="fd-shutter" onClick={capture} aria-label="Take photo" />
                  <button type="button" className="fd-cam-btn" onClick={() => openCamera(camera.facing === 'environment' ? 'user' : 'environment')} aria-label="Switch camera"><SwitchCamera size={18} /></button>
                </div>
              </div>
            ) : photo ? (
              <div className="fd-photo">
                <img src={photo.dataUrl} alt="Visit" />
                <button type="button" className="hr-btn hr-btn-secondary hr-btn-sm" onClick={() => openCamera()}><Camera size={14} /> Retake</button>
              </div>
            ) : (
              <button type="button" className="fd-photo-empty" onClick={() => openCamera()}>
                <Camera size={22} />
                <span>Take a photo at the location</span>
                <small>Shop front, office sign or the meeting place</small>
              </button>
            )}
            {camera.error && <div className="fd-warn">{camera.error}</div>}
            {!camera.open && (
              <button type="button" className="fd-linkbtn" onClick={() => fileRef.current?.click()}>Use the phone camera app instead</button>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
          </section>

          {error && <div className="hr-alert" role="alert">{error}</div>}
        </div>

        <div className="hr-modal-foot fd-sheet-foot">
          {problems.length > 0 && <span className="fd-missing">Add {problems.join(', ')}</span>}
          <button type="button" className="hr-btn hr-btn-secondary" onClick={() => { stopCamera(); onClose(); }}>Cancel</button>
          <button type="button" className="hr-btn hr-btn-primary" onClick={submit} disabled={!canSubmit}>
            {saving ? 'Saving…' : <><Check size={15} /> Record visit</>}
          </button>
        </div>
      </div>
    </div>
  );
}
