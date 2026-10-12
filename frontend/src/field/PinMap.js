/* ==========================================================================
   PinMap: a small, dependency-free map for dropping a pin.
   OpenStreetMap tiles in a draggable view; tap to place the pin, +/- to zoom,
   the target button re-centres on you. Shows your GPS position with its
   accuracy circle and, optionally, the company sites with their radius.
   ========================================================================== */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, Minus, LocateFixed, MapPin } from 'lucide-react';

const TILE = 256;
const MIN_Z = 11;
const MAX_Z = 19;
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

const project = (lat, lng, z) => {
  const scale = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
};
const unproject = (x, y, z) => {
  const scale = TILE * 2 ** z;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng };
};
const metresPerPx = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

export default function PinMap({ me, pin, onPin, sites = [], height = 260, initialZoom = 16 }) {
  const boxRef = useRef(null);
  const drag = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(initialZoom);
  const [center, setCenter] = useState(() => (pin || me ? { lat: (pin || me).lat, lng: (pin || me).lng } : { lat: 12.9175, lng: 80.2553 }));
  const [tileErrors, setTileErrors] = useState(0);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Follow the first GPS fix if the map opened before it arrived
  const centred = useRef(!!(pin || me));
  useEffect(() => {
    if (!centred.current && me) { centred.current = true; setCenter({ lat: me.lat, lng: me.lng }); }
  }, [me]);

  const c = project(center.lat, center.lng, zoom);
  const left = c.x - size.w / 2;
  const top = c.y - size.h / 2;
  const toScreen = (lat, lng) => { const p = project(lat, lng, zoom); return { x: p.x - left, y: p.y - top }; };

  const tiles = [];
  if (size.w && size.h) {
    const n = 2 ** zoom;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + size.w) / TILE); tx += 1) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + size.h) / TILE); ty += 1) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;
        tiles.push(<img key={`${zoom}-${tx}-${ty}`} className="fd-map-tile" alt="" draggable={false} src={TILE_URL(zoom, wx, ty)}
          style={{ left: tx * TILE - left, top: ty * TILE - top }} onError={() => setTileErrors((e) => e + 1)} />);
      }
    }
  }

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: { ...c }, moved: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    setCenter(unproject(d.start.x - dx, d.start.y - dy, zoom));
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !onPin) return;
    const r = boxRef.current.getBoundingClientRect();
    const p = unproject(left + (e.clientX - r.left), top + (e.clientY - r.top), zoom);
    onPin(Number(p.lat.toFixed(7)), Number(p.lng.toFixed(7)));
  };

  const zoomBy = useCallback((dz) => setZoom((z) => Math.max(MIN_Z, Math.min(MAX_Z, z + dz))), []);
  const mpp = metresPerPx(center.lat, zoom);
  const meXY = me && toScreen(me.lat, me.lng);
  const pinXY = pin && toScreen(pin.lat, pin.lng);

  return (
    <div className="fd-map" style={{ height }}>
      <div
        ref={boxRef}
        className={`fd-map-view${tileErrors > 2 ? ' is-offline' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; }}
        role="application"
        aria-label="Map. Tap to place the pin, drag to move."
      >
        {tiles}
        {sites.map((s) => {
          const p = toScreen(s.latitude, s.longitude);
          const r = s.radius / mpp;
          return (
            <div key={s.id} className={`fd-map-site is-${String(s.type || '').toLowerCase()}`} style={{ left: p.x - r, top: p.y - r, width: r * 2, height: r * 2 }}>
              {r > 14 && <span>{s.name}</span>}
            </div>
          );
        })}
        {meXY && (
          <>
            {me.accuracy > 0 && <div className="fd-map-acc" style={{ left: meXY.x - me.accuracy / mpp, top: meXY.y - me.accuracy / mpp, width: (2 * me.accuracy) / mpp, height: (2 * me.accuracy) / mpp }} />}
            <div className="fd-map-me" style={{ left: meXY.x, top: meXY.y }} title="You are here" />
          </>
        )}
        {pinXY && <div className="fd-map-pin" style={{ left: pinXY.x, top: pinXY.y }}><MapPin size={34} strokeWidth={2.2} /></div>}
      </div>

      <div className="fd-map-ctrls">
        <button type="button" onClick={() => zoomBy(1)} aria-label="Zoom in" disabled={zoom >= MAX_Z}><Plus size={16} /></button>
        <button type="button" onClick={() => zoomBy(-1)} aria-label="Zoom out" disabled={zoom <= MIN_Z}><Minus size={16} /></button>
        {me && <button type="button" onClick={() => setCenter({ lat: me.lat, lng: me.lng })} aria-label="Centre on my location"><LocateFixed size={16} /></button>}
      </div>
      {tileErrors > 2 && <div className="fd-map-note">Map images could not load. You can still tap to place the pin.</div>}
      <a className="fd-map-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
    </div>
  );
}
