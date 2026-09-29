// Game world: bodies on rails, the player's ship, the target, burns, time warp,
// catch/crash detection and cached trajectory predictions.

import { createSystem } from '../physics/bodies.js';
import { kepler, elements, stateFromOrbit, timeToApoapsis, timeToPeriapsis } from '../physics/kepler.js';
import { advance, absoluteState } from '../physics/propagate.js';
import { predict, closestApproach } from '../physics/predict.js';

const DEG = Math.PI / 180;
const G0 = 9.80665e-3; // km/s^2
const ISP = 340; // s
const VE = ISP * G0; // exhaust velocity km/s
const DRY_MASS = 1000; // kg
const START_ACCEL = 0.012; // km/s^2 (12 m/s^2) at the start of a burn

export const WARPS = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1e6, 5e6, 1e7];

// Burn feel: the Δv rate ramps up the longer a burn button is held.
const RATE0 = 6; // m/s per real second when a burn starts
const RATE_DOUBLING = 0.45; // real seconds per doubling of the rate
const RATE_MAX = 900; // m/s per real second
const RATE_FINE = 1.5; // m/s per real second in fine mode
const MAX_BURN_WARP = 200;
const BURN_SUBSTEP = 0.5; // s of game time

export const BURN_DIRS = ['prograde', 'retrograde', 'radialIn', 'radialOut', 'toward', 'match'];

/** Build a relative state for an orbit description around `body`. */
export function orbitState(body, o) {
  const mu = body.gm;
  const R = body.radius;
  const dir = o.dir ?? 1;
  let rp, ra;
  if (o.alt !== undefined) { rp = ra = R + o.alt; }
  else { rp = R + o.pe; ra = R + o.ap; }
  const argPe = (o.argPe ?? 0) * DEG;
  // `angle` is the polar angle of the craft; convert to true anomaly.
  let nu;
  if (o.nu !== undefined) nu = o.nu * DEG;
  else nu = dir * ((o.angle ?? 0) * DEG - argPe);
  return stateFromOrbit(mu, rp, ra, argPe, nu, dir);
}

export class World {
  constructor(level) {
    this.sys = createSystem();
    this.level = level;
    this.t = 0;
    this.status = 'flying'; // 'flying' | 'caught' | 'crashed'
    this.statusInfo = null;
    this.ship = null;
    this.target = null;
    this.catchDist = level.catchDist ?? 10;
    this.catchSpeed = (level.catchSpeed ?? 20) / 1000;
    this.warpIndex = WARPS.indexOf(level.startWarp ?? 50);
    if (this.warpIndex < 0) this.warpIndex = 4;
    this.warpTarget = null; // { t, label }
    this.burn = { dir: null, hold: 0, fine: false, dv: 0, rate: 0, warp: 1, lock: null };
    this.lastBurn = null; // { dir, dv, endedAt (real s) }
    this.log = [];
    this.realTime = 0;
    this.prediction = null;
    this.predAt = -1;
    this.predDirty = true;
    this.approach = null;
    this.approachAt = -1;
    this.trail = [];
    this.preBurnOrbit = null;
    level.setup(this);
    if (this.target) this.target.period = elements(this.target.s0.x, this.target.s0.y, this.target.s0.vx, this.target.s0.vy, this.target.body.gm).period;
  }

  body(id) { return this.sys.byId[id]; }

  // ---- level setup helpers ------------------------------------------------

  placeShip(bodyId, orbit, fuelDv = null) {
    const body = this.body(bodyId);
    const st = orbitState(body, orbit);
    const unlimited = fuelDv === null || fuelDv === undefined;
    const fuel = unlimited ? 0 : DRY_MASS * (Math.exp(fuelDv / 1000 / VE) - 1);
    this.ship = {
      body, ...st,
      unlimited,
      dry: DRY_MASS,
      fuel,
      fuel0: fuel,
      thrust: START_ACCEL * (DRY_MASS + fuel), // kg km/s^2
      dvUsed: 0, // m/s
    };
  }

  placeTarget(bodyId, orbit) {
    const body = this.body(bodyId);
    const s0 = orbitState(body, orbit);
    this.target = { body, s0, t0: this.t, period: Infinity, name: orbit.name || 'Target' };
  }

  // ---- queries -------------------------------------------------------------

  shipElements() {
    const s = this.ship;
    return elements(s.x, s.y, s.vx, s.vy, s.body.gm);
  }

  /** Target state relative to its body at time t. */
  targetState(t = this.t, out = { x: 0, y: 0, vx: 0, vy: 0 }) {
    const tg = this.target;
    return kepler(tg.s0.x, tg.s0.y, tg.s0.vx, tg.s0.vy, tg.body.gm, t - tg.t0, out);
  }

  shipAbs(out) { return absoluteState(this.ship, this.t, out); }

  targetAbs(t = this.t, out = { x: 0, y: 0, vx: 0, vy: 0 }) {
    const rel = this.targetState(t);
    return absoluteState({ body: this.target.body, ...rel }, t, out);
  }

  /** Distance (km) and relative speed (km/s) to the target, or null if unavailable. */
  targetRelative() {
    if (!this.target) return null;
    const a = this.shipAbs();
    const b = this.targetAbs();
    const dx = b.x - a.x, dy = b.y - a.y;
    const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
    const dist = Math.hypot(dx, dy);
    const relSpeed = Math.hypot(dvx, dvy);
    // closing speed: positive when approaching
    const closing = dist > 0 ? (dvx * dx + dvy * dy) / dist : 0;
    return { dist, relSpeed, closing, dx, dy, dvx, dvy };
  }

  mass() { return this.ship.dry + this.ship.fuel; }

  /** Remaining Δv in m/s (Infinity with unlimited fuel). */
  dvRemaining() {
    const s = this.ship;
    if (s.unlimited) return Infinity;
    return VE * Math.log((s.dry + s.fuel) / s.dry) * 1000;
  }

  dvTotal() {
    const s = this.ship;
    if (s.unlimited) return Infinity;
    return VE * Math.log((s.dry + s.fuel0) / s.dry) * 1000;
  }

  accel() { return this.ship.thrust / this.mass(); }

  get warp() { return WARPS[this.warpIndex]; }

  /** Keep warp gentle right next to the target so final approach stays controllable. */
  maxWarpIndex() {
    if (!this.target || this.ship.body !== this.target.body) return WARPS.length - 1;
    const rel = this.targetRelative();
    if (rel.dist < this.catchDist * 5) return WARPS.indexOf(100);
    return WARPS.length - 1;
  }

  /**
   * Largest coast step that can't skip over the catch zone (Infinity when the
   * target can't be reached within `dt`). The catch is checked after each step.
   */
  catchStep(dt) {
    if (!this.target || this.ship.body !== this.target.body) return Infinity;
    const rel = this.targetRelative();
    const v = rel.relSpeed + 0.002; // slack for relative orbital curvature
    const gap = rel.dist - this.catchDist;
    if (gap > v * dt * 1.5) return Infinity;
    if (gap <= 0) return Math.max(0.05, this.catchDist / (4 * v));
    return Math.max(0.05, (0.5 * gap) / v);
  }

  setWarpIndex(i) {
    this.warpIndex = Math.max(0, Math.min(WARPS.length - 1, i));
    this.warpTarget = null;
    // the old rate is stale until the next step; left in place, a raised warp would read as "limited"
    this.effectiveWarp = undefined;
  }

  // ---- burns ---------------------------------------------------------------

  /** Unit thrust direction in the ship's body frame, or null. */
  burnVector(dir) {
    const s = this.ship;
    const v = Math.hypot(s.vx, s.vy);
    if (dir === 'plan') {
      // an approved plan: a fixed mix of prograde and radial out
      const p = this.burn.plan;
      const f = p && this.burnVector('prograde'), r = p && this.burnVector('radialOut');
      if (!f) return null;
      const x = p.pro * f.x + p.rad * r.x, y = p.pro * f.y + p.rad * r.y;
      const m = Math.hypot(x, y);
      return m ? { x: x / m, y: y / m } : null;
    }
    if (dir === 'prograde' || dir === 'retrograde' || dir === 'radialIn' || dir === 'radialOut') {
      if (v === 0) return null;
      const ux = s.vx / v, uy = s.vy / v;
      if (dir === 'prograde') return { x: ux, y: uy };
      if (dir === 'retrograde') return { x: -ux, y: -uy };
      // radial: perpendicular to velocity, pointing away from the body for radialOut
      let px = uy, py = -ux;
      if (px * s.x + py * s.y < 0) { px = -px; py = -py; }
      return dir === 'radialOut' ? { x: px, y: py } : { x: -px, y: -py };
    }
    const rel = this.targetRelative();
    if (!rel || this.target.body !== s.body) return null;
    if (dir === 'toward') {
      if (rel.dist === 0) return null;
      return { x: rel.dx / rel.dist, y: rel.dy / rel.dist };
    }
    if (dir === 'match') {
      if (rel.relSpeed < 1e-7) return null;
      return { x: -rel.dvx / rel.relSpeed, y: -rel.dvy / rel.relSpeed };
    }
    return null;
  }

  /** Toward/Match only make sense up close; far away they just burn fuel. */
  targetActionRange() {
    return Math.max(300, 50 * this.catchDist);
  }

  canBurn(dir) {
    if (this.status !== 'flying') return false;
    if (!this.ship.unlimited && this.ship.fuel <= 0) return false;
    if (dir === 'toward' || dir === 'match') {
      if (!this.target || this.target.body !== this.ship.body) return false;
      return this.targetRelative().dist <= this.targetActionRange();
    }
    return true;
  }

  /** Shift pressed or released mid-burn: switch to or from fine control, restarting the ramp. */
  setFine(on) {
    const b = this.burn;
    if (!b.dir || b.plan || b.fine === on) return;
    b.fine = on;
    b.hold = 0;
  }

  startBurn(dir, fine = false) {
    if (!this.canBurn(dir)) return false;
    if (this.burn.dir !== dir) {
      this.burn = { dir, hold: 0, fine, dv: 0, rate: 0, warp: 1, lock: null };
      this.preBurnOrbit = this.prediction;
    }
    this.warpTarget = null;
    return true;
  }

  /** Fly an approved plan (see game/planner.js): { pro, rad, dv (m/s), rate (m/s per real s) }. */
  startPlannedBurn(plan) {
    if (!this.canBurn('plan')) return false;
    this.burn = { dir: 'plan', hold: 0, fine: false, dv: 0, rate: 0, warp: 1, lock: null, plan };
    this.preBurnOrbit = this.prediction;
    this.warpTarget = null;
    return true;
  }

  stopBurn() {
    if (this.burn.dir) {
      this.lastBurn = { dir: this.burn.dir, dv: this.burn.dv, endedAt: this.realTime };
      this.log.push({ t: this.t, type: 'burn', dir: this.burn.dir, dv: this.burn.dv });
    }
    this.burn.dir = null;
    this.burn.lock = null;
  }

  /** Apply thrust for game-time h at the given throttle (0..1). Returns Δv applied (km/s). */
  applyThrust(dir, throttle, h, dvCap = Infinity) {
    const s = this.ship;
    let dv = throttle * this.accel() * h;
    // Once speed gets tiny (e.g. braking to a stop far from Earth), hold the burn
    // direction fixed so a held burn can carry the velocity through zero and reverse it.
    const b = this.burn;
    let u = b.dir === dir && b.lock ? b.lock : this.burnVector(dir);
    if (!u) return 0;
    if (b.dir === dir && !b.lock && dir !== 'match' && Math.hypot(s.vx, s.vy) < Math.max(0.02, 3 * dv)) {
      b.lock = u;
    }
    if (!s.unlimited) {
      // Tsiolkovsky: don't exceed what's left in the tank
      dv = Math.min(dv, this.dvRemaining() / 1000);
    }
    dv = Math.min(dv, dvCap);
    if (dv <= 0) return 0;
    s.vx += u.x * dv;
    s.vy += u.y * dv;
    if (!s.unlimited) {
      const m1 = this.mass() / Math.exp(dv / VE);
      s.fuel = Math.max(0, m1 - s.dry);
      if (s.fuel < 1e-9) s.fuel = 0;
    }
    s.dvUsed += dv * 1000;
    return dv;
  }

  // ---- warp-to --------------------------------------------------------------

  warpTo(t, label) {
    if (!(t > this.t)) return;
    this.stopBurn();
    this.warpTarget = { t, label };
  }

  // ---- simulation -----------------------------------------------------------

  /** Coast for game-time dt, handling SOI changes, impacts and the catch. */
  coast(dt) {
    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-9 && this.status === 'flying' && guard++ < 400) {
      const cs = this.catchStep(remaining);
      const from = this.ship.body;
      const res = advance(this.ship, this.t, Math.min(remaining, cs));
      this.t += res.dt;
      remaining -= res.dt;
      if (res.event) this.onEvent(res.event, from);
      if (cs !== Infinity) this.checkCatch();
    }
  }

  onEvent(ev, from) {
    if (ev.type === 'impact') {
      this.status = 'crashed';
      const hit = ev.hit || from;
      this.statusInfo = { body: hit, t: this.t };
      this.stopBurn();
      this.log.push({ t: this.t, type: 'impact', body: hit.name });
    } else {
      this.log.push({ t: this.t, type: ev.type, from: ev.from.name, to: ev.to.name });
      this.trail = [];
    }
    this.predDirty = true;
  }

  update(realDt) {
    realDt = Math.min(realDt, 0.1);
    this.realTime += realDt;
    if (this.status !== 'flying') {
      // keep the world moving gently after the end so it doesn't look frozen
      this.t += realDt * (this.status === 'caught' ? 20 : 0);
      if (this.status === 'caught') this.coastTargetOnly();
      return;
    }

    const b = this.burn;
    if (b.dir) {
      b.hold += realDt;
      if (!this.canBurn(b.dir)) {
        this.stopBurn();
      } else {
        const rate = b.plan ? b.plan.rate : b.fine ? RATE_FINE : Math.min(RATE_MAX, RATE0 * Math.pow(2, b.hold / RATE_DOUBLING));
        const a = this.accel() * 1000; // m/s^2
        let w = Math.max(1, Math.min(MAX_BURN_WARP, rate / a));
        const throttle = Math.min(1, rate / (a * w));
        b.rate = rate;
        b.warp = w;
        let gameDt = realDt * w;
        const n = Math.max(1, Math.ceil(gameDt / BURN_SUBSTEP));
        const h = gameDt / n;
        for (let i = 0; i < n && this.status === 'flying' && b.dir; i++) {
          let cap = Infinity;
          if (b.dir === 'match') {
            const rel = this.targetRelative();
            cap = rel ? rel.relSpeed / 2 : 0;
            if (!rel || rel.relSpeed < 1e-4) { this.stopBurn(); break; }
          }
          if (b.plan) cap = Math.max(0, b.plan.dv - b.dv) / 1000;
          b.dv += this.applyThrust(b.dir, throttle, h / 2, cap) * 1000;
          this.coast(h);
          if (this.status !== 'flying' || !b.dir) break;
          if (b.dir === 'match') {
            const rel = this.targetRelative();
            cap = rel ? rel.relSpeed : 0;
          }
          if (b.plan) cap = Math.max(0, b.plan.dv - b.dv) / 1000;
          b.dv += this.applyThrust(b.dir, throttle, h / 2, cap) * 1000;
          if (b.plan && b.dv >= b.plan.dv - 1e-6) { this.stopBurn(); break; }
        }
        this.predDirty = true;
      }
    } else {
      let w = this.warp;
      if (this.warpTarget) {
        const remaining = this.warpTarget.t - this.t;
        if (remaining <= 1e-6) {
          this.log.push({ t: this.t, type: 'arrive', label: this.warpTarget.label });
          this.warpTarget = null;
          this.warpIndex = 0;
          w = 0;
        } else {
          w = Math.min(WARPS[WARPS.length - 1], Math.max(1, remaining / 0.6));
          w = Math.min(w, remaining / realDt);
        }
      }
      const cap = WARPS[this.maxWarpIndex()];
      if (w > cap) {
        w = cap;
        if (!this.warpTarget && this.warpIndex > this.maxWarpIndex()) this.warpIndex = this.maxWarpIndex();
      }
      this.effectiveWarp = w;
      if (w > 0) this.coast(realDt * w);
    }

    this.checkCatch();
    this.recordTrail();
  }

  coastTargetOnly() {
    // after a catch, carry the ship along with the target
    if (!this.target) return;
    const st = this.targetState(this.t);
    this.ship.body = this.target.body;
    Object.assign(this.ship, { x: st.x, y: st.y, vx: st.vx, vy: st.vy });
  }

  checkCatch() {
    if (!this.target || this.status !== 'flying') return;
    if (this.ship.body !== this.target.body) return;
    const rel = this.targetRelative();
    if (rel.dist <= this.catchDist && rel.relSpeed <= this.catchSpeed) {
      this.status = 'caught';
      this.statusInfo = { t: this.t, dist: rel.dist, relSpeed: rel.relSpeed };
      this.stopBurn();
      this.warpTarget = null;
    }
  }

  recordTrail() {
    const s = this.ship;
    const last = this.trail[this.trail.length - 1];
    const r = Math.hypot(s.x, s.y);
    if (!last || Math.hypot(s.x - last.x, s.y - last.y) > r * 0.01 || last.body !== s.body) {
      this.trail.push({ x: s.x, y: s.y, body: s.body });
      if (this.trail.length > 400) this.trail.shift();
    }
  }

  // ---- prediction -------------------------------------------------------------

  /** Refresh cached predictions when stale. Cheap to call every frame. */
  refreshPrediction(force = false) {
    const stale = force || this.predDirty || !this.prediction
      || this.realTime - this.predAt > 1.5
      || this.t > this.prediction[0].t1;
    if (stale) {
      this.prediction = predict(this.ship, this.t, { revs: this.level.revs ?? 5, maxPatches: 3 });
      this.predAt = this.realTime;
      this.predDirty = false;
      this.approachAt = -1;
    }
    if (this.realTime - this.approachAt > 0.2 || this.approachAt < 0) {
      this.approach = this.computeApproach();
      this.approachAt = this.realTime;
    }
    return this.prediction;
  }

  /**
   * Closest approach to the target (when the path reaches the target's SOI),
   * otherwise to the target's body (to help aim an encounter).
   */
  computeApproach() {
    const tg = this.target;
    if (!tg || !this.prediction) return null;
    const pred = this.prediction;
    const tNow = this.t;
    if (pred.some((p) => p.body === tg.body)) {
      const obj = {
        body: tg.body,
        period: tg.period,
        stateAt: (t, out) => this.targetState(t, out),
      };
      const ca = closestApproach(pred, obj, tNow);
      if (ca) return { kind: 'target', ...ca };
      return null;
    }
    // aim for the body that the target orbits
    const B = tg.body;
    if (!B.parent) return null;
    const obj = {
      body: B.parent,
      period: (2 * Math.PI) / B.n,
      stateAt: (t, out) => {
        const p = B.relPos(t);
        const v = B.relVel(t);
        out.x = p.x; out.y = p.y; out.vx = v.x; out.vy = v.y;
        return out;
      },
    };
    const ca = closestApproach(pred, obj, tNow);
    return ca ? { kind: 'body', bodyRef: B, ...ca } : null;
  }

  /**
   * Phase angle: how far the target (or the body it orbits) is ahead of the ship,
   * measured around a common centre in the ship's direction of motion.
   * By default for now; pass a time and the ship's state then (relative to its
   * body) to get the angle at a future moment, as the planner does.
   * Returns { center, a0, a1, deg } with angles in radians, or null.
   */
  phaseInfo(t = this.t, s = this.ship) {
    const tg = this.target;
    if (!tg) return null;
    const B = s.body;
    const el = elements(s.x, s.y, s.vx, s.vy, B.gm);
    const dir = el.dir;
    let center, a0, a1;
    // on an escape or flyby path the angle around our own body means nothing
    if (el.e >= 1 && (tg.body === B || tg.body.parent === B)) return null;
    if (tg.body === B) {
      const ts = this.targetState(t);
      center = B; a0 = Math.atan2(s.y, s.x); a1 = Math.atan2(ts.y, ts.x);
    } else if (tg.body.parent === B) {
      const p = tg.body.relPos(t);
      center = B; a0 = Math.atan2(s.y, s.x); a1 = Math.atan2(p.y, p.x);
    } else if (B.parent && tg.body.parent === B.parent) {
      center = B.parent; a0 = B.angle(t); a1 = tg.body.angle(t);
    } else {
      return null;
    }
    let d = (a1 - a0) * dir;
    d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return { center, a0, a1, dir, deg: (d * 180) / Math.PI, ownBody: center === B };
  }

  /** Upcoming events the player can warp to. */
  warpOptions() {
    const opts = [];
    const pred = this.refreshPrediction();
    const el = this.shipElements();
    const p0 = pred[0];
    const horizon = p0.t1;
    if (!el.circular) {
      const tp = timeToPeriapsis(el);
      if (Number.isFinite(tp) && this.t + tp < horizon) opts.push({ id: 'pe', label: 'Periapsis', t: this.t + tp });
      const ta = timeToApoapsis(el);
      if (Number.isFinite(ta) && this.t + ta < horizon) opts.push({ id: 'ap', label: 'Apoapsis', t: this.t + ta });
    }
    if (this.approach && this.approach.t > this.t + 1) {
      const name = this.approach.kind === 'target' ? 'Closest approach' : `Closest to ${this.approach.bodyRef.name}`;
      opts.push({ id: 'ca', label: name, t: this.approach.t - Math.min(120, Math.max(5, 0.002 * (this.approach.t - this.t))) });
    }
    if (p0.end === 'enter' || p0.end === 'exit') {
      const label = p0.end === 'enter' ? `Enter ${p0.next.name} SOI` : `Leave ${p0.body.name} SOI`;
      opts.push({ id: 'soi', label, t: p0.t1 + 1 });
    }
    opts.sort((a, b) => a.t - b.t);
    return opts;
  }
}

export { VE, DEG };
