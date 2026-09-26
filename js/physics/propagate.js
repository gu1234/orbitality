// Event-aware coasting under patched conics. The simulation and the trajectory
// predictor both go through `advance`, so the flown path matches the drawn one.
//
// A flight state is { body, x, y, vx, vy } with position/velocity relative to body.

import { kepler, elements } from './kepler.js';

const MIN_STEP = 0.01; // s
const MAX_ITERS = 20000;
const BISECT_TOL = 1e-3; // s

const tp = { x: 0, y: 0 };
const tv = { x: 0, y: 0 };
const probe = { x: 0, y: 0, vx: 0, vy: 0 };

function childDistance(c, st, t) {
  c.relPos(t, tp);
  return Math.hypot(st.x - tp.x, st.y - tp.y) - c.soi;
}

/**
 * Coast `s` (mutated in place) from time t for up to dt seconds, stopping at the
 * first event. SOI transitions are applied to `s` before returning.
 * Returns { dt: time actually advanced, event: null | { type, t, from, to, rel } }
 *   type: 'impact' | 'exit' | 'enter'; rel is the state in the old frame at the event.
 */
export function advance(s, t, dt) {
  if (dt <= 0) return { dt: 0, event: null };
  const body = s.body;
  const mu = body.gm;
  const el = elements(s.x, s.y, s.vx, s.vy, mu);
  const open = el.e >= 1;
  const canExit = body.parent !== null && (open || el.ra > body.soi);
  const canImpact = el.rp < body.radius;
  const rMin = el.rp;
  const rMax = open ? Infinity : el.ra;
  let kids = null;
  for (const c of body.children) {
    if (rMax >= c.a - c.soi && rMin <= c.a + c.soi) (kids || (kids = [])).push(c);
  }

  if (!canExit && !canImpact && !kids) {
    kepler(s.x, s.y, s.vx, s.vy, mu, dt, s);
    return { dt, event: null };
  }

  const nxt = { x: 0, y: 0, vx: 0, vy: 0 };
  let done = 0;
  let iters = 0;
  while (done < dt) {
    const tNow = t + done;
    const r = Math.hypot(s.x, s.y);
    const v = Math.hypot(s.vx, s.vy);
    let h = dt - done;
    if (++iters < MAX_ITERS) {
      if (canExit) h = Math.min(h, Math.max(MIN_STEP, (0.5 * (body.soi - r)) / v));
      if (canImpact) h = Math.min(h, Math.max(MIN_STEP, (0.5 * (r - body.radius)) / v));
      if (kids) {
        for (const c of kids) {
          const d = childDistance(c, s, tNow);
          h = Math.min(h, Math.max(MIN_STEP, (0.5 * d) / (v + c.speed)));
        }
      }
    }
    kepler(s.x, s.y, s.vx, s.vy, mu, h, nxt);
    const t1 = tNow + h;

    // Which events fired during this step? Find the earliest by bisection.
    let best = null;
    let bestT = Infinity;
    const consider = (type, other, test) => {
      if (!test(nxt, t1)) return;
      let a = 0, b = h;
      while (b - a > BISECT_TOL) {
        const m = 0.5 * (a + b);
        kepler(s.x, s.y, s.vx, s.vy, mu, m, probe);
        if (test(probe, tNow + m)) b = m; else a = m;
      }
      if (b < bestT) { bestT = b; best = { type, other }; }
    };
    if (canImpact) consider('impact', null, (st) => Math.hypot(st.x, st.y) < body.radius);
    if (canExit) consider('exit', body.parent, (st) => Math.hypot(st.x, st.y) > body.soi);
    if (kids) for (const c of kids) consider('enter', c, (st, tt) => childDistance(c, st, tt) < 0);

    if (best) {
      // Land on the "event happened" side of the boundary so we never ping-pong.
      kepler(s.x, s.y, s.vx, s.vy, mu, bestT, s);
      const te = tNow + bestT;
      const rel = { x: s.x, y: s.y, vx: s.vx, vy: s.vy };
      const event = { type: best.type, t: te, from: body, to: body, rel };
      if (best.type === 'exit') {
        body.relPos(te, tp);
        body.relVel(te, tv);
        s.x += tp.x; s.y += tp.y; s.vx += tv.x; s.vy += tv.y;
        s.body = body.parent;
        event.to = body.parent;
      } else if (best.type === 'enter') {
        const c = best.other;
        c.relPos(te, tp);
        c.relVel(te, tv);
        s.x -= tp.x; s.y -= tp.y; s.vx -= tv.x; s.vy -= tv.y;
        s.body = c;
        event.to = c;
      }
      return { dt: done + bestT, event };
    }

    s.x = nxt.x; s.y = nxt.y; s.vx = nxt.vx; s.vy = nxt.vy;
    done += h;
  }
  return { dt, event: null };
}

/** Absolute (heliocentric) position/velocity of a flight state at time t. */
export function absoluteState(s, t, out = { x: 0, y: 0, vx: 0, vy: 0 }) {
  s.body.absPos(t, tp);
  s.body.absVel(t, tv);
  out.x = s.x + tp.x;
  out.y = s.y + tp.y;
  out.vx = s.vx + tv.x;
  out.vy = s.vy + tv.y;
  return out;
}
