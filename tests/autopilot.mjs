// A scripted "player" used to prove that every level is solvable within its
// fuel budget, using the same World API the game uses.

import { World } from '../js/game/world.js';
import { elements, kepler, timeToPeriapsis, timeToApoapsis } from '../js/physics/kepler.js';
import { predict, closestApproach } from '../js/physics/predict.js';

export function makeWorld(level) {
  return new World(level);
}

/** Finite burn of dvMs (m/s) in a burn direction, using real engine physics. */
export function burn(w, dir, dvMs) {
  if (dvMs <= 0) return 0;
  w.startBurn(dir);
  let done = 0;
  let guard = 0;
  while (done < dvMs - 1e-6 && w.status === 'flying' && guard++ < 1e6) {
    if (!w.canBurn(dir)) break;
    const h = 0.5;
    const full = w.accel() * h * 1000;
    const thr = Math.min(1, (dvMs - done) / full);
    let cap = Infinity;
    if (dir === 'match') {
      const rel = w.targetRelative();
      if (rel.relSpeed < 1e-4) break;
      cap = rel.relSpeed / 2;
    }
    const a = w.applyThrust(dir, thr, h / 2, cap) * 1000;
    w.coast(h);
    if (dir === 'match') cap = w.targetRelative().relSpeed;
    const b = w.applyThrust(dir, thr, h / 2, cap) * 1000;
    done += a + b;
    if (a + b === 0) break;
  }
  w.stopBurn();
  w.predDirty = true;
  w.checkCatch();
  return done;
}

/** Start a finite burn so that it is centred on time t (like centring on a node). */
export function centeredBurn(w, dir, dvMs, t) {
  const dur = dvMs / 1000 / w.accel();
  coastTo(w, t - dur / 2);
  return burn(w, dir, dvMs);
}

/** Small correction toward the target: try each direction and a few sizes. */
export function trim(w, sizes = [0.1, 0.3, 1, 3, 10]) {
  const score = (dir, dv) => {
    const pred = probe(w, dir, dv);
    if (pred.some((p) => p.end === 'impact')) return 1e12;
    const ca = approachFor(w, pred);
    return ca ? ca.dist + dv * 0.2 : 1e12;
  };
  let best = { dir: null, dv: 0, v: score('prograde', 0) };
  for (const dir of ['prograde', 'retrograde', 'radialIn', 'radialOut']) {
    for (const dv of sizes) {
      const v = score(dir, dv);
      if (v < best.v) best = { dir, dv, v };
    }
  }
  if (best.dir) burn(w, best.dir, best.dv);
  return best;
}

export function coastTo(w, t) {
  if (t > w.t) w.coast(t - w.t);
  w.predDirty = true;
}

/** What the prediction would look like after an instantaneous burn (no mutation). */
export function probe(w, dir, dvMs, extra = {}) {
  const s = w.ship;
  const st = { body: s.body, x: s.x, y: s.y, vx: s.vx, vy: s.vy };
  const saved = { body: s.body, x: s.x, y: s.y, vx: s.vx, vy: s.vy };
  if (dvMs) {
    const u = w.burnVector(dir);
    st.vx += (u.x * dvMs) / 1000;
    st.vy += (u.y * dvMs) / 1000;
  }
  const pred = predict(st, w.t, { revs: extra.revs ?? w.level.revs ?? 5 });
  Object.assign(s, saved);
  return pred;
}

export function targetObj(w) {
  return { body: w.target.body, period: w.target.period, stateAt: (t, out) => w.targetState(t, out) };
}

export function approachFor(w, pred) {
  if (!pred.some((p) => p.body === w.target.body)) return null;
  return closestApproach(pred, targetObj(w), w.t);
}

/** Grid + golden search over Δv in [lo, hi] (m/s) minimizing f(dv). */
export function search1D(f, lo, hi, n = 60) {
  let best = { x: lo, v: f(lo) };
  const step = (hi - lo) / n;
  for (let i = 1; i <= n; i++) {
    const x = lo + i * step;
    const v = f(x);
    if (v < best.v) best = { x, v };
  }
  let a = Math.max(lo, best.x - step), b = Math.min(hi, best.x + step);
  const G = (Math.sqrt(5) - 1) / 2;
  let x1 = b - G * (b - a), x2 = a + G * (b - a);
  let f1 = f(x1), f2 = f(x2);
  for (let i = 0; i < 40; i++) {
    if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - G * (b - a); f1 = f(x1); }
    else { a = x1; x1 = x2; f1 = f2; x2 = a + G * (b - a); f2 = f(x2); }
  }
  const x = 0.5 * (a + b);
  const v = f(x);
  return v < best.v ? { x, v } : best;
}

/** Phase with the target by a tangential burn now (searching ±range m/s). */
export function phaseNow(w, range = 150, revs = w.level.revs ?? 5) {
  const f = (dv) => {
    const dir = dv >= 0 ? 'prograde' : 'retrograde';
    const pred = probe(w, dir, Math.abs(dv), { revs });
    if (pred.some((p) => p.end === 'impact')) return 1e12;
    const ca = approachFor(w, pred);
    return ca ? ca.dist + Math.abs(dv) * 0.02 : 1e12;
  };
  const r = search1D(f, -range, range, 120);
  burn(w, r.x >= 0 ? 'prograde' : 'retrograde', Math.abs(r.x));
  return r;
}

/** Coast to the closest approach, match velocity, nudge toward, repeat. */
export function finalApproach(w, maxIter = 40) {
  for (let i = 0; i < maxIter && w.status === 'flying'; i++) {
    w.refreshPrediction(true);
    const ca = w.approach;
    if (ca && ca.kind === 'target' && ca.t > w.t + 2 && ca.dist < 2000) {
      coastTo(w, ca.t - 1);
    }
    w.checkCatch();
    if (w.status !== 'flying') break;
    burn(w, 'match', 5000);
    let rel = w.targetRelative();
    if (w.status !== 'flying') break;
    if (rel.dist <= w.catchDist) { w.checkCatch(); if (w.status !== 'flying') break; }
    // head toward the target at a sensible speed
    const closing = Math.min(0.2, Math.max(0.004, rel.dist / 600)) * 1000; // m/s
    burn(w, 'toward', closing);
    let prev = Infinity;
    for (let k = 0; k < 4000 && w.status === 'flying'; k++) {
      w.coast(1);
      w.checkCatch();
      rel = w.targetRelative();
      if (rel.dist > prev) break;
      prev = rel.dist;
    }
  }
  return w.status === 'caught';
}

export { elements, kepler, timeToPeriapsis, timeToApoapsis };
