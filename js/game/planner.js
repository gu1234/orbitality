// Burn planner: dial in a burn (prograde and radial Δv, now or at the next
// apoapsis or periapsis, plus an optional wait) with time paused, see the orbit
// it gives, then approve it and let the ship fly it. The preview simulates the same finite burn the
// ship will fly (centred on the node, thrust following the velocity frame), so
// the orbit you approve is the orbit you get.

import { kepler, timeToApoapsis, timeToPeriapsis } from '../physics/kepler.js';
import { advance } from '../physics/propagate.js';
import { predict } from '../physics/predict.js';
import { VE } from './world.js';

// Holding a button while planning adds Δv with the same ramp as a held burn.
const RATE0 = 6; // m/s per real second
const RATE_DOUBLING = 0.45; // real seconds per doubling
const RATE_MAX = 900;
const RATE_FINE = 1.5;
const TAP = 1; // m/s added by a single tap (0.1 in fine mode)

// An approved burn is flown over about this many real seconds.
const EXEC_TIME = 1.5;
const EXEC_RATE_MIN = 3; // m/s per real second
const EXEC_RATE_MAX = 2400;
const SUBSTEP = 0.5; // s of game time, as in World.update

// The wait before the burn is counted in orbits of the current orbit, so the same
// control works in low orbit (90 min) and around the Sun (a year). On a path with
// no period (escape, or leaving the SOI) it counts hours instead.
const WAIT_TAP = 0.01; // units added by a single tap (a tenth of that in fine mode)
const WAIT_RATE0 = 0.1; // units per real second when a hold starts
const WAIT_RATE_MAX = 2000;
const WAIT_RATE_FINE = 0.02;
const WAIT_HOUR = 3600;
const WAIT_MAX = 3 * 365.25 * 86400; // s: longer than any launch window takes to come round

/** Unit thrust vector for `pro` m/s prograde plus `rad` m/s radial out, in the state's frame. */
export function planVector(s, pro, rad) {
  const v = Math.hypot(s.vx, s.vy);
  if (v === 0) return null;
  const ux = s.vx / v, uy = s.vy / v;
  // radial: perpendicular to velocity, pointing away from the body (as World.burnVector)
  let px = uy, py = -ux;
  if (px * s.x + py * s.y < 0) { px = -px; py = -py; }
  const x = pro * ux + rad * px, y = pro * uy + rad * py;
  const m = Math.hypot(x, y);
  return m ? { x: x / m, y: y / m } : null;
}

/** Δv rate (m/s per real second) that flies a `dv` m/s burn in about EXEC_TIME. */
export function execRate(dv) {
  return Math.min(EXEC_RATE_MAX, Math.max(EXEC_RATE_MIN, dv / EXEC_TIME));
}

/**
 * Fly a planned burn on a copy of the ship, the way World.update would: start
 * half the burn time before `nodeT` (never before now), then alternate
 * half-kicks and coasts. Returns { state, t, startT, dur, dv (m/s applied), crash }.
 */
export function simulateBurn(world, pro, rad, nodeT) {
  const ship = world.ship;
  const s = { body: ship.body, x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy };
  const target = Math.hypot(pro, rad) / 1000; // km/s
  const rate = execRate(target * 1000) / 1000; // km/s per real second
  let fuel = ship.fuel;
  // World.update: warp = rate/accel (at least 1) at full throttle, else throttle = rate/accel
  const accel = () => Math.min(ship.thrust / (ship.dry + fuel), rate);
  const left = () => (ship.unlimited ? Infinity : VE * Math.log((ship.dry + fuel) / ship.dry));
  const dvGoal = Math.min(target, left());
  // burn time, with the ship getting lighter as it burns
  let dur;
  if (ship.unlimited || rate < ship.thrust / (ship.dry + fuel)) dur = dvGoal / accel();
  else dur = ((ship.dry + fuel) * VE * (1 - Math.exp(-dvGoal / VE))) / ship.thrust;

  let t = world.t;
  const startT = Math.max(t, nodeT - dur / 2);
  const out = { state: s, t, startT, dur, dv: 0, crash: false };
  if (startT > t) {
    const r = advance(s, t, startT - t);
    t += r.dt;
    if (r.event?.type === 'impact') return { ...out, t, crash: true };
  }
  let done = 0;
  let lock = null;
  const kick = (h) => {
    const d = Math.min(accel() * h, dvGoal - done);
    if (d <= 0) return;
    // as World.applyThrust: near zero speed hold the direction, so braking carries through and reverses
    const u = lock || planVector(s, pro, rad);
    if (!u) return;
    if (!lock && Math.hypot(s.vx, s.vy) < Math.max(0.02, 3 * accel() * h)) lock = u;
    s.vx += u.x * d;
    s.vy += u.y * d;
    if (!ship.unlimited) fuel = Math.max(0, (ship.dry + fuel) / Math.exp(d / VE) - ship.dry);
    done += d;
  };
  for (let guard = 0; done < dvGoal - 1e-9 && guard < 100000; guard++) {
    kick(SUBSTEP / 2);
    const r = advance(s, t, SUBSTEP);
    t += r.dt;
    if (r.event?.type === 'impact') return { ...out, t, dv: done * 1000, crash: true };
    kick(SUBSTEP / 2);
  }
  return { ...out, t, dv: done * 1000 };
}

export class Planner {
  constructor() {
    this.world = null;
    this.reset(null);
  }

  /** Forget any plan (new level, restart). */
  reset(world) {
    this.world = world;
    this.open = false;
    this.armed = null; // approved and waiting: { pro, rad, dv, rate, startT, nodeT, at, wait }
    this.clear();
  }

  /** Zero the burn being planned. */
  clear() {
    this.pro = 0; // m/s along prograde (negative is retrograde)
    this.rad = 0; // m/s radial out (negative is radial in)
    this.wait = 0; // s of coasting after the chosen node before the burn
    this.hold = null;
    this.waitHold = null;
    this.capped = false;
    this.dirty = true;
    this.result = null;
    if (!this.open) this.at = 'now';
  }

  get dv() { return Math.hypot(this.pro, this.rad); }

  /** Where the burn can go: now, and the next Ap/Pe while they come before any SOI change or impact. */
  nodes() {
    const w = this.world;
    const opts = [{ id: 'now', t: w.t, ok: true }];
    const el = w.shipElements();
    const horizon = w.refreshPrediction()[0].t1;
    const closed = el.e < 1 && !el.circular;
    for (const [id, dt] of [['ap', closed ? timeToApoapsis(el) : Infinity], ['pe', closed ? timeToPeriapsis(el) : Infinity]]) {
      const t = w.t + dt;
      opts.push({ id, t, ok: Number.isFinite(dt) && t < horizon });
    }
    return opts;
  }

  /** The node the wait counts from: now, or the next Ap or Pe. */
  baseTime() {
    const n = this.nodes().find((o) => o.id === this.at);
    return n && n.ok ? n.t : this.world.t;
  }

  nodeTime() {
    return this.baseTime() + Math.min(this.wait, this.maxWait());
  }

  /** What the wait is counted in: { s, orbits } — one orbit of the current orbit, else an hour. */
  waitUnit() {
    const w = this.world;
    const el = w.shipElements();
    if (el.e < 1 && el.ra < w.ship.body.soi) return { s: el.period, orbits: true };
    return { s: WAIT_HOUR, orbits: false };
  }

  /**
   * Longest wait (s) after the base node: the path must still be in this SOI and
   * clear of the surface. An orbit that stays put can wait for years.
   */
  maxWait() {
    const w = this.world;
    const p0 = w.refreshPrediction()[0];
    const end = p0.end === 'horizon' ? w.t + WAIT_MAX : p0.t1 - 1;
    return Math.max(0, end - this.baseTime());
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    const w = this.world;
    if (!w || w.status !== 'flying') return false;
    w.stopBurn();
    this.armed = null;
    this.open = true;
    if (!this.nodes().find((o) => o.id === this.at)?.ok) this.at = 'now';
    this.dirty = true;
    return true;
  }

  close() {
    this.open = false;
    this.hold = null;
  }

  setAt(id) {
    if (!this.nodes().find((o) => o.id === id)?.ok) return;
    this.at = id;
    this.wait = Math.min(this.wait, this.maxWait());
    this.dirty = true;
  }

  // ---- the wait before the burn

  /** Start a held change to the wait (sign +1 later, -1 sooner). */
  pressWait(sign, fine) {
    this.waitHold = { sign, t: 0, fine };
    this.nudgeWait(sign * (fine ? WAIT_TAP / 10 : WAIT_TAP));
  }

  releaseWait() { this.waitHold = null; }

  /** Change the wait by `units` of waitUnit(). */
  nudgeWait(units) {
    this.setWait(this.wait + units * this.waitUnit().s);
  }

  /** Set the wait in seconds, kept between zero and maxWait(). */
  setWait(s) {
    this.wait = Math.min(this.maxWait(), Math.max(0, s));
    this.dirty = true;
  }

  // ---- shaping the burn with the burn buttons

  press(dir, fine) {
    if (!['prograde', 'retrograde', 'radialIn', 'radialOut'].includes(dir)) return false;
    this.hold = { dir, t: 0, fine };
    this.nudge(dir, fine ? TAP / 10 : TAP);
    return true;
  }

  release() { this.hold = null; this.waitHold = null; }

  nudge(dir, amt) {
    if (dir === 'prograde') this.pro += amt;
    else if (dir === 'retrograde') this.pro -= amt;
    else if (dir === 'radialOut') this.rad += amt;
    else if (dir === 'radialIn') this.rad -= amt;
    // never plan more than the tank holds
    const max = this.world.dvRemaining();
    const dv = this.dv;
    this.capped = dv > max;
    if (this.capped) {
      this.pro *= max / dv;
      this.rad *= max / dv;
    }
    this.dirty = true;
  }

  /** Every frame while planning: grow a held adjustment and refresh the preview. */
  tick(realDt) {
    const h = this.hold;
    if (h) {
      h.t += realDt;
      const rate = h.fine ? RATE_FINE : Math.min(RATE_MAX, RATE0 * Math.pow(2, h.t / RATE_DOUBLING));
      this.nudge(h.dir, rate * realDt);
    }
    const wh = this.waitHold;
    if (wh) {
      wh.t += realDt;
      const rate = wh.fine ? WAIT_RATE_FINE : Math.min(WAIT_RATE_MAX, WAIT_RATE0 * Math.pow(2, wh.t / RATE_DOUBLING));
      this.nudgeWait(wh.sign * rate * realDt);
    }
    if (this.dirty) this.compute();
  }

  /** Simulate the planned burn and predict the orbit after it. */
  compute() {
    const w = this.world;
    this.dirty = false;
    const nodeT = this.nodeTime();
    const node = kepler(w.ship.x, w.ship.y, w.ship.vx, w.ship.vy, w.ship.body.gm, nodeT - w.t);
    // where the target is at the burn, to compare with the angle the hints give
    const phase = w.phaseInfo(nodeT, { body: w.ship.body, ...node });
    if (this.dv < 0.05) {
      this.result = { empty: true, nodeT, node, phase };
      return this.result;
    }
    const sim = simulateBurn(w, this.pro, this.rad, nodeT);
    const pred = sim.crash ? null : predict(sim.state, sim.t, { revs: w.level.revs ?? 5, maxPatches: 3 });
    let approach = null;
    if (pred) {
      // World.computeApproach reads the world's own prediction; lend it the planned one
      const own = w.prediction;
      w.prediction = pred;
      try { approach = w.computeApproach(); } finally { w.prediction = own; }
    }
    this.result = { ...sim, nodeT, node, phase, pred, approach, dvLeft: w.dvRemaining() - sim.dv };
    return this.result;
  }

  // ---- approving and flying it

  /** Lock in the plan. The caller warps to it; `fly` starts it on arrival. */
  approve() {
    const r = this.open && !this.dirty ? this.result : this.compute();
    if (!r || r.empty || r.dv < 0.05) return false;
    this.armed = { pro: this.pro, rad: this.rad, dv: r.dv, rate: execRate(r.dv), startT: r.startT, nodeT: r.nodeT, at: this.at, wait: this.wait, result: r };
    this.close();
    return true;
  }

  /** Drop an approved plan. Its burn time is kept as a wait, so reopening the planner brings it back. */
  cancel() {
    const a = this.armed;
    this.armed = null;
    if (!a || !this.world) return;
    if (!this.nodes().find((o) => o.id === this.at)?.ok) this.at = 'now';
    if (a.wait > 0) this.setWait(a.nodeT - this.baseTime());
    this.dirty = true;
  }

  /**
   * Every frame while flying: take the ship to an approved burn and start it.
   * Returns 'started' when the burn begins, 'dropped' if it can no longer happen.
   */
  fly() {
    const a = this.armed;
    const w = this.world;
    if (!a) return null;
    if (w.status !== 'flying') { this.armed = null; return 'dropped'; }
    if (w.t >= a.startT - 1e-3) {
      this.armed = null;
      this.clear();
      return w.startPlannedBurn({ pro: a.pro, rad: a.rad, dv: a.dv, rate: a.rate }) ? 'started' : 'dropped';
    }
    if (w.warpTarget?.t !== a.startT) w.warpTo(a.startT, 'Burn');
    return null;
  }
}
