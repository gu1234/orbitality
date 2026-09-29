// Trajectory prediction (patched conics) and closest-approach search.

import { kepler, elements } from './kepler.js';
import { advance } from './propagate.js';

const YEAR = 365.25 * 86400;

/**
 * Predict the future path of a flight state as a list of conic patches.
 * Each patch: { body, t0, t1, state0, el, end, closed, hit }
 *   end: 'horizon' | 'impact' | 'exit' | 'enter'
 *   closed: the patch covers at least one full revolution (draw the whole ellipse)
 */
export function predict(state, t0, { revs = 3, maxPatches = 5, maxTime = 4 * YEAR } = {}) {
  const patches = [];
  const s = { body: state.body, x: state.x, y: state.y, vx: state.vx, vy: state.vy };
  let t = t0;
  for (let i = 0; i < maxPatches; i++) {
    const el = elements(s.x, s.y, s.vx, s.vy, s.body.gm);
    const state0 = { x: s.x, y: s.y, vx: s.vx, vy: s.vy };
    const remaining = t0 + maxTime - t;
    if (remaining <= 0) break;
    const span = el.e < 1 ? Math.min(el.period * revs, remaining) : remaining;
    const body = s.body;
    const res = advance(s, t, span);
    const patch = {
      body,
      t0: t,
      t1: t + res.dt,
      state0,
      el,
      end: res.event ? res.event.type : 'horizon',
      endRel: res.event ? res.event.rel : { x: s.x, y: s.y, vx: s.vx, vy: s.vy },
      closed: el.e < 1 && res.dt >= el.period,
      next: res.event ? res.event.to : null,
      hit: res.event ? res.event.hit : null,
    };
    patches.push(patch);
    t += res.dt;
    if (!res.event || res.event.type === 'impact') break;
  }
  return patches;
}

const tmpS = { x: 0, y: 0, vx: 0, vy: 0 };

/** Relative state of the ship within `patch` at time t. */
export function patchStateAt(patch, t, out = { x: 0, y: 0, vx: 0, vy: 0 }) {
  const s = patch.state0;
  return kepler(s.x, s.y, s.vx, s.vy, patch.body.gm, t - patch.t0, out);
}

/**
 * Closest approach between the predicted path and an object orbiting `obj.body`.
 * obj: { body, period, stateAt(t, out) -> {x,y,vx,vy} relative to obj.body }
 * Only patches in obj.body's frame are searched.
 * Returns null or { t, dist, relSpeed, ship: {x,y,vx,vy}, obj: {x,y,vx,vy}, patch }
 */
export function closestApproach(patches, obj, tFrom) {
  const cand = [];
  const os = { x: 0, y: 0, vx: 0, vy: 0 };
  const distAt = (p, t) => {
    patchStateAt(p, t, tmpS);
    obj.stateAt(t, os);
    return Math.hypot(tmpS.x - os.x, tmpS.y - os.y);
  };

  for (const p of patches) {
    if (p.body !== obj.body) continue;
    const ta = Math.max(tFrom, p.t0);
    const tb = p.t1;
    if (tb <= ta) continue;
    const span = tb - ta;
    let step = span / 60;
    if (p.el.e < 1) step = Math.min(step, p.el.period / 120);
    if (obj.period && Number.isFinite(obj.period)) step = Math.min(step, obj.period / 60);
    const n = Math.min(1500, Math.max(8, Math.ceil(span / step)));
    step = span / n;
    let d0 = distAt(p, ta);
    let d1 = distAt(p, ta + step);
    if (d0 <= d1) cand.push({ p, a: ta, b: ta + step, d: d0 });
    for (let i = 2; i <= n; i++) {
      const d2 = distAt(p, ta + i * step);
      if (d1 <= d0 && d1 <= d2) cand.push({ p, a: ta + (i - 2) * step, b: ta + i * step, d: d1 });
      d0 = d1;
      d1 = d2;
    }
    if (d1 < d0) cand.push({ p, a: tb - step, b: tb, d: d1 });
  }
  if (!cand.length) return null;

  cand.sort((u, v) => u.d - v.d);
  let best = null;
  const G = (Math.sqrt(5) - 1) / 2;
  for (const c of cand.slice(0, 5)) {
    let a = c.a, b = c.b;
    let x1 = b - G * (b - a), x2 = a + G * (b - a);
    let f1 = distAt(c.p, x1), f2 = distAt(c.p, x2);
    for (let i = 0; i < 60 && b - a > 1e-3; i++) {
      if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - G * (b - a); f1 = distAt(c.p, x1); }
      else { a = x1; x1 = x2; f1 = f2; x2 = a + G * (b - a); f2 = distAt(c.p, x2); }
    }
    const tm = 0.5 * (a + b);
    const d = distAt(c.p, tm);
    if (!best || d < best.dist) best = { t: tm, dist: d, patch: c.p };
  }
  const ship = patchStateAt(best.patch, best.t);
  const o = obj.stateAt(best.t, { x: 0, y: 0, vx: 0, vy: 0 });
  best.ship = ship;
  best.obj = o;
  best.relSpeed = Math.hypot(ship.vx - o.vx, ship.vy - o.vy);
  return best;
}

/** First SOI entry into `body` along the prediction: { patch, t } or null. */
export function findEncounter(patches, body) {
  for (const p of patches) if (p.body === body) return p;
  return null;
}
