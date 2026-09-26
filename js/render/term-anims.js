// Animated diagrams for the glossary cards (js/ui/terms.js). Each animation draws one
// frame on a 360×200 canvas for a time t in seconds and returns a caption for it.
// Orbits use real two-body motion (Kepler's equation, scaled down), so ships really
// do slow down at apoapsis and speed up at periapsis, and burns really change the orbit.
// No DOM here: the tests draw every frame onto a stub context.

export const W = 360;
export const H = 200;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const C = {
  bg: '#0a172a',
  chalk: '#ebe6d8',
  dim: 'rgba(235, 230, 216, 0.62)',
  faint: 'rgba(235, 230, 216, 0.24)',
  ship: '#ffb547',
  target: '#ff5fa2',
  ok: '#9be3b4',
  warn: '#ff6a3d',
  term: '#8fd0ff',
  earth: '#3f7fdc',
  atmo: '#6fb6ff',
  moon: '#b9b6b0',
  sun: '#ffcf5a',
  mars: '#c8603f',
};
const FONT = '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const wrapPi = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

// ---------------------------------------------------------------- two-body motion

/** A conic around a focus: periapsis radius rp, eccentricity e, periapsis direction w
 *  (radians, counterclockwise from +x), dir +1 counterclockwise / -1 clockwise. */
class Orbit {
  constructor(rp, e, w, dir, mu) {
    if (Math.abs(e - 1) < 1e-6) e = 1 + 1e-6; // no parabolas
    Object.assign(this, { rp, e, w, dir, mu });
    this.p = rp * (1 + e);
    this.a = rp / (1 - e); // negative for a hyperbola
    this.n = Math.sqrt(mu / Math.abs(this.a) ** 3);
    this.T = e < 1 ? TAU / this.n : Infinity;
    this.ra = e < 1 ? this.a * (1 + e) : Infinity;
  }

  static circle(r, angle, dir, mu) { return new Orbit(r, 0, angle, dir, mu); }

  /** Ellipse with apsides rp and ra; w points at the periapsis. */
  static apsides(rp, ra, w, dir, mu) { return new Orbit(rp, (ra - rp) / (ra + rp), w, dir, mu); }

  nuAt(M) {
    const e = this.e;
    if (e < 1) {
      M = wrapPi(M);
      let E = e > 0.8 ? Math.PI * Math.sign(M || 1) : M + e * Math.sin(M);
      for (let i = 0; i < 30; i++) {
        const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        E -= d;
        if (Math.abs(d) < 1e-12) break;
      }
      return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    }
    let Hh = Math.asinh(M / e);
    for (let i = 0; i < 50; i++) {
      const d = (e * Math.sinh(Hh) - Hh - M) / (e * Math.cosh(Hh) - 1);
      Hh -= d;
      if (Math.abs(d) < 1e-12) break;
    }
    return 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(Hh / 2));
  }

  MAt(nu) {
    const e = this.e;
    if (e < 1) {
      const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
      return E - e * Math.sin(E);
    }
    const Hh = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    return e * Math.sinh(Hh) - Hh;
  }

  r(nu) { return this.p / (1 + this.e * Math.cos(nu)); }

  /** Position and velocity relative to the focus at true anomaly nu. */
  at(nu) {
    const r = this.r(nu);
    const th = this.w + this.dir * nu;
    const c = Math.cos(th), s = Math.sin(th);
    const k = Math.sqrt(this.mu / this.p);
    const vr = k * this.e * Math.sin(nu);
    const vt = k * (1 + this.e * Math.cos(nu));
    return { x: r * c, y: r * s, vx: vr * c - this.dir * vt * s, vy: vr * s + this.dir * vt * c, r, nu, th };
  }

  /** Largest |nu| drawn for an open orbit that should stay within rMax. */
  nuLimit(rMax) {
    if (this.e < 1) return Math.PI;
    const inf = Math.acos(-1 / this.e) - 0.02;
    const c = (this.p / rMax - 1) / this.e; // r(nu) = rMax
    return c >= 1 ? 0 : c <= -1 ? inf : Math.min(inf, Math.acos(c));
  }
}

/** Orbit and mean anomaly from a position and velocity relative to the focus. */
function fromState(x, y, vx, vy, mu) {
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const h = x * vy - y * vx;
  const dir = h >= 0 ? 1 : -1;
  const rv = x * vx + y * vy;
  const ex = ((v2 - mu / r) * x - rv * vx) / mu;
  const ey = ((v2 - mu / r) * y - rv * vy) / mu;
  const e = Math.hypot(ex, ey);
  const p = (h * h) / mu;
  let w, nu;
  if (e < 1e-7) { w = Math.atan2(y, x); nu = 0; } else {
    w = Math.atan2(ey, ex);
    nu = wrapPi(dir * (Math.atan2(y, x) - w));
  }
  const o = new Orbit(p / (1 + e), e, w, dir, mu);
  return { o, M: o.MAt(nu) };
}

/** Circular motion of a body on rails: a focus that moves. */
function railFocus(cx, cy, R, th0, omega) {
  return (t) => {
    const th = th0 + omega * t;
    return { x: cx + R * Math.cos(th), y: cy + R * Math.sin(th), vx: -R * omega * Math.sin(th), vy: R * omega * Math.cos(th) };
  };
}

const fixed = (x, y) => () => ({ x, y, vx: 0, vy: 0 });

/**
 * A ship's path as a list of Kepler legs, built ahead of time from coasts and burns.
 * Times are simulation seconds; a Clock maps them to the animation's real time.
 */
class Path {
  constructor(o, M, focus, t = 0) {
    this.legs = [{ t0: t, o, M0: M, focus }];
    this.burns = [];
    this.t = t;
  }

  get leg() { return this.legs[this.legs.length - 1]; }

  legAt(t) {
    const L = this.legs;
    let i = L.length - 1;
    while (i > 0 && L[i].t0 > t) i--;
    return L[i];
  }

  state(t) {
    const L = this.legAt(t);
    const q = L.o.at(L.o.nuAt(L.M0 + L.o.n * (t - L.t0)));
    const f = L.focus(t);
    return { x: f.x + q.x, y: f.y + q.y, vx: f.vx + q.vx, vy: f.vy + q.vy, rel: q, f, leg: L };
  }

  coast(dt) { this.t += dt; return this; }

  /** Coast on to the next periapsis ('pe') or apoapsis ('ap'). */
  coastTo(which) {
    const L = this.leg;
    const M = L.M0 + L.o.n * (this.t - L.t0);
    const goal = which === 'ap' ? Math.PI : 0;
    let dM = ((goal - M) % TAU + TAU) % TAU;
    if (dM < 1e-9) dM = 0;
    this.t += dM / L.o.n;
    return this;
  }

  /** Coast until test(state, t) holds (checked every `step`), then home in on the moment. */
  coastUntil(test, max, step = 1 / 120) {
    const a = this.t;
    for (let t = a + step; t <= a + max; t += step) {
      if (test(this.state(t), t)) {
        let lo = t - step, hi = t;
        for (let i = 0; i < 30; i++) {
          const mid = (lo + hi) / 2;
          if (test(this.state(mid), mid)) hi = mid; else lo = mid;
        }
        this.t = hi;
        return true;
      }
    }
    this.t = a + max;
    return false;
  }

  /** Start a new leg from the current state (optionally around a new focus). */
  restart(dvx = 0, dvy = 0, focus = this.leg.focus, mu = this.leg.o.mu) {
    const s = this.state(this.t);
    const f = focus(this.t);
    const { o, M } = fromState(s.x - f.x, s.y - f.y, s.vx - f.vx + dvx, s.vy - f.vy + dvy, mu);
    this.legs.push({ t0: this.t, o, M0: M, focus });
    return this;
  }

  /** Burn `dv` in a direction relative to the current orbit, spread over `dur` seconds. */
  burn(kind, dv, dur = 0.12, steps = 10) {
    this.burns.push({ t0: this.t, t1: this.t + dur, kind });
    for (let i = 0; i < steps; i++) {
      const s = this.state(this.t);
      const q = s.rel;
      const v = Math.hypot(q.vx, q.vy), r = Math.hypot(q.x, q.y);
      let ux, uy;
      if (kind === 'prograde' || kind === 'retrograde') { ux = q.vx / v; uy = q.vy / v; }
      else { ux = q.x / r; uy = q.y / r; }
      if (kind === 'retrograde' || kind === 'radialIn') { ux = -ux; uy = -uy; }
      this.restart(ux * dv / steps, uy * dv / steps);
      this.t += dur / steps;
    }
    return this;
  }

  burnAt(t) { return this.burns.find((b) => t >= b.t0 && t <= b.t1) || null; }

  /** Positions from t0 to t1, for trails. */
  trail(t0, t1, step = 1 / 30) {
    const pts = [];
    for (let t = t0; t < t1; t += step) pts.push(this.state(t));
    pts.push(this.state(Math.max(t0, t1)));
    return pts;
  }
}

/** Maps the animation's real time to simulation time: runs at some rate, or holds still. */
class Clock {
  constructor() { this.segs = []; this.total = 0; this.sim = 0; }

  run(simDur, rate = 1) {
    if (simDur <= 0) return this;
    const real = simDur / rate;
    this.segs.push({ r0: this.total, s0: this.sim, rate });
    this.total += real;
    this.sim += simDur;
    return this;
  }

  /** Run to simulation time `simT`. */
  to(simT, rate = 1) { return this.run(simT - this.sim, rate); }

  hold(real) {
    this.segs.push({ r0: this.total, s0: this.sim, rate: 0 });
    this.total += real;
    return this;
  }

  /** Real time at which simulation time `sim` is first reached. */
  realAt(sim) {
    const S = this.segs;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      const r1 = i + 1 < S.length ? S[i + 1].r0 : this.total;
      if (s.rate > 0 && sim <= s.s0 + (r1 - s.r0) * s.rate) return s.r0 + Math.max(0, sim - s.s0) / s.rate;
    }
    return this.total;
  }

  at(t) {
    const S = this.segs;
    let i = S.length - 1;
    while (i > 0 && S[i].r0 > t) i--;
    const s = S[i];
    return s ? s.s0 + (t - s.r0) * s.rate : 0;
  }
}

/** A clock that plays a path to simulation time `end`, slowing down for its burns. */
function clockFor(path, end, { rate = 1, burnRate = 0.3, start = 0, hold = 1.4, lead = 0 } = {}) {
  const c = new Clock();
  c.sim = start;
  if (lead) c.hold(lead);
  for (const b of [...path.burns].sort((x, y) => x.t0 - y.t0)) {
    if (b.t0 >= end) break;
    c.to(b.t0, rate);
    c.to(Math.min(b.t1, end), burnRate);
  }
  c.to(end, rate);
  if (hold) c.hold(hold);
  return c;
}

/** Gravitational parameter that gives a circular orbit of radius r the period T. */
const muFor = (r, T) => (4 * Math.PI * Math.PI * r ** 3) / (T * T);

// ---------------------------------------------------------------- drawing

// a fixed scatter of faint stars behind every diagram
const STARS = (() => {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 46 }, () => [rnd() * W, rnd() * H, 0.4 + rnd() * 0.8, 0.15 + rnd() * 0.35]);
})();

/** Drawing helpers in diagram coordinates: x right, y up, 360×200. */
class Sketch {
  constructor(ctx) { this.ctx = ctx; }

  clear() {
    const c = this.ctx;
    c.fillStyle = C.bg;
    c.fillRect(0, 0, W, H);
    for (const [x, y, r, a] of STARS) {
      c.globalAlpha = a;
      c.fillStyle = C.chalk;
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;
  }

  stroke(color, width = 1.2, dash = null, alpha = 1) {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.setLineDash(dash || []);
    c.globalAlpha = alpha;
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 1;
  }

  body(x, y, r, kind = 'earth') {
    const c = this.ctx;
    const Y = H - y;
    const col = C[kind] || kind;
    if (kind === 'sun') {
      const g = c.createRadialGradient(x, Y, r * 0.3, x, Y, r * 3);
      g.addColorStop(0, 'rgba(255, 207, 90, 0.5)');
      g.addColorStop(1, 'rgba(255, 207, 90, 0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, Y, r * 3, 0, TAU);
      c.fill();
    }
    const g = c.createRadialGradient(x - r * 0.35, Y - r * 0.35, r * 0.1, x, Y, r);
    g.addColorStop(0, shade(col, 1.25));
    g.addColorStop(1, shade(col, kind === 'sun' ? 0.9 : 0.45));
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, Y, r, 0, TAU);
    c.fill();
    if (kind === 'earth') {
      c.beginPath();
      c.arc(x, Y, r + 1.2, 0, TAU);
      this.stroke(C.atmo, 1.2, null, 0.5);
    }
  }

  /** An orbit around focus f; `from`/`to` limit the true anomaly drawn. */
  conic(o, f, color, { width = 1.2, dash = null, alpha = 1, rMax = 420, from, to } = {}) {
    const c = this.ctx;
    const lim = o.nuLimit(rMax);
    const n0 = from ?? -lim, n1 = to ?? lim;
    const n = 160;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const nu = n0 + ((n1 - n0) * i) / n;
      const r = o.r(nu), th = o.w + o.dir * nu;
      const X = f.x + r * Math.cos(th), Y = H - (f.y + r * Math.sin(th));
      if (i) c.lineTo(X, Y); else c.moveTo(X, Y);
    }
    this.stroke(color, width, dash, alpha);
  }

  circle(x, y, r, color, { width = 1, dash = null, alpha = 1, fill = null } = {}) {
    const c = this.ctx;
    c.beginPath();
    c.arc(x, H - y, r, 0, TAU);
    if (fill) { c.globalAlpha = alpha; c.fillStyle = fill; c.fill(); c.globalAlpha = 1; }
    if (color) this.stroke(color, width, dash, alpha);
  }

  dot(x, y, r, color, alpha = 1) { this.circle(x, y, r, null, { fill: color, alpha }); }

  line(x1, y1, x2, y2, color, { width = 1.2, dash = null, alpha = 1 } = {}) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x1, H - y1);
    c.lineTo(x2, H - y2);
    this.stroke(color, width, dash, alpha);
  }

  /** Arc around (cx, cy) from angle a0 to a1 (radians, counterclockwise). */
  arc(cx, cy, r, a0, a1, color, opts = {}) {
    const c = this.ctx;
    c.beginPath();
    c.arc(cx, H - cy, r, -a0, -a1, a1 > a0);
    this.stroke(color, opts.width || 1.4, opts.dash, opts.alpha ?? 1);
  }

  poly(pts, color, opts = {}) {
    if (pts.length < 2) return;
    const c = this.ctx;
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, H - p.y) : c.moveTo(p.x, H - p.y)));
    this.stroke(color, opts.width || 1.2, opts.dash, opts.alpha ?? 1);
  }

  arrow(x, y, dx, dy, color, { width = 2, head = 6, label = null, alpha = 1 } = {}) {
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const c = this.ctx;
    const ux = dx / len, uy = dy / len;
    const tx = x + dx, ty = y + dy;
    this.line(x, y, tx - ux * head * 0.6, ty - uy * head * 0.6, color, { width, alpha });
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(tx, H - ty);
    c.lineTo(tx - ux * head - uy * head * 0.55, H - (ty - uy * head + ux * head * 0.55));
    c.lineTo(tx - ux * head + uy * head * 0.55, H - (ty - uy * head - ux * head * 0.55));
    c.closePath();
    c.fill();
    c.globalAlpha = 1;
    if (label) this.text(label, tx + ux * 8, ty + uy * 8, { color, align: ux > 0.35 ? 'left' : ux < -0.35 ? 'right' : 'center', alpha });
  }

  /** The ship: an arrowhead pointing along its velocity. */
  ship(s, color = C.ship, { size = 5, alpha = 1, hollow = false } = {}) {
    const v = Math.hypot(s.vx, s.vy) || 1;
    const ux = s.vx / v, uy = s.vy / v;
    const c = this.ctx;
    const X = s.x, Y = H - s.y;
    // in canvas coordinates y points down
    const fx = ux, fy = -uy;
    c.beginPath();
    c.moveTo(X + fx * size * 1.5, Y + fy * size * 1.5);
    c.lineTo(X - fx * size - fy * size, Y - fy * size + fx * size);
    c.lineTo(X - fx * size * 0.4, Y - fy * size * 0.4);
    c.lineTo(X - fx * size + fy * size, Y - fy * size - fx * size);
    c.closePath();
    c.globalAlpha = alpha;
    if (hollow) {
      c.strokeStyle = color;
      c.lineWidth = 1.2;
      c.setLineDash([2, 2]);
      c.stroke();
      c.setLineDash([]);
    } else {
      c.shadowColor = color;
      c.shadowBlur = 6;
      c.fillStyle = color;
      c.fill();
      c.shadowBlur = 0;
    }
    c.globalAlpha = 1;
  }

  /** Engine flame behind a ship thrusting along (ux, uy). */
  flame(s, ux, uy, k = 1) {
    const c = this.ctx;
    const flick = 0.75 + 0.25 * Math.sin(performanceNow() * 0.05);
    const len = (9 + 5 * flick) * k;
    c.beginPath();
    c.moveTo(s.x - uy * 3, H - (s.y + ux * 3));
    c.lineTo(s.x - ux * len, H - (s.y - uy * len));
    c.lineTo(s.x + uy * 3, H - (s.y - ux * 3));
    c.closePath();
    c.fillStyle = '#ffd98a';
    c.globalAlpha = 0.85;
    c.fill();
    c.globalAlpha = 1;
  }

  /** Expanding ring, k from 0 to 1. */
  ring(x, y, k, color = C.ship) {
    if (k <= 0 || k >= 1) return;
    this.circle(x, y, 3 + 14 * k, color, { width: 1.6, alpha: 1 - k });
  }

  text(s, x, y, { color = C.chalk, size = 12, align = 'left', base = 'middle', weight = 500, alpha = 1 } = {}) {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${FONT}`;
    c.textAlign = align;
    c.textBaseline = base;
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.fillText(s, x, H - y);
    c.globalAlpha = 1;
  }

  /** A labelled point on an orbit: dot, and the label pushed outward from the focus. */
  apsis(x, y, fx, fy, label, color, { pulse = 0, alpha = 1 } = {}) {
    this.dot(x, y, 2.6, color, alpha);
    if (pulse > 0) this.circle(x, y, 3 + 9 * pulse, color, { width: 1.4, alpha: (1 - pulse) * alpha });
    const d = Math.hypot(x - fx, y - fy) || 1;
    const ux = (x - fx) / d, uy = (y - fy) / d;
    this.text(label, x + ux * 12, y + uy * 12, { color, align: ux > 0.4 ? 'left' : ux < -0.4 ? 'right' : 'center', size: 12, weight: 600, alpha });
  }

  /** A top-left readout of lines [text, color]. */
  panel(lines, x = 10, y = H - 14) {
    lines.forEach(([s, color], i) => this.text(s, x, y - i * 14, { color: color || C.dim, size: 12 }));
  }
}

let nowFn = () => 0;
const performanceNow = () => nowFn();
/** Lets the page supply a wall clock for flickering flames (the tests leave it at 0). */
export function setWallClock(fn) { nowFn = fn; }

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(clamp(v * k, 0, 255));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

const unit = (x, y) => { const d = Math.hypot(x, y) || 1; return [x / d, y / d]; };

/** Ship with its flame while a burn is on. */
function shipWithBurn(g, path, t, color = C.ship) {
  const s = path.state(t);
  const b = path.burnAt(t);
  if (b) {
    const q = s.rel;
    let [ux, uy] = b.kind === 'prograde' || b.kind === 'retrograde' ? unit(q.vx, q.vy) : unit(q.x, q.y);
    if (b.kind === 'retrograde' || b.kind === 'radialIn') { ux = -ux; uy = -uy; }
    g.flame(s, ux, uy);
  }
  g.ship(s, color);
  return s;
}

/** Arrow along a burn direction, drawn from the ship. */
function burnArrow(g, s, kind, color, label, len = 26, alpha = 1) {
  const q = s.rel;
  let [ux, uy] = kind === 'prograde' || kind === 'retrograde' ? unit(q.vx, q.vy) : unit(q.x, q.y);
  if (kind === 'retrograde' || kind === 'radialIn') { ux = -ux; uy = -uy; }
  g.arrow(s.x + ux * 8, s.y + uy * 8, ux * len, uy * len, color, { width: 1.8, label, alpha });
}

function apsisPoints(o, f) {
  const pe = o.at(0);
  const ap = o.e < 1 ? o.at(Math.PI) : null;
  return { pe: { x: f.x + pe.x, y: f.y + pe.y }, ap: ap && { x: f.x + ap.x, y: f.y + ap.y } };
}

const pulseAt = (t, period = 1.4) => (t % period) / period;

// ---------------------------------------------------------------- scenes
// Each scene: build() once, returning { dur, still, draw(g, t) -> caption }.

const SCENES = {};

/** Newton's cannon: faster and faster throws until the ground curves away as fast as it falls. */
SCENES.orbit = () => {
  const E = { x: 180, y: 92 }, R = 58, r0 = 64;
  const mu = muFor(r0, 3.4);
  const vc = Math.sqrt(mu / r0);
  const f = fixed(E.x, E.y);
  const shots = [];
  let t0 = 0.3;
  for (const k of [0.5, 0.7, 0.85, 1]) {
    const { o, M } = fromState(0, r0, k * vc, 0, mu);
    const p = new Path(o, M, f);
    let d;
    if (k < 1) {
      p.coastUntil((s) => Math.hypot(s.rel.x, s.rel.y) < R + 1, 5);
      d = p.t;
    } else d = o.T * 1.5;
    shots.push({ p, t0, d, k });
    t0 += d + 0.5;
  }
  const dur = t0 + 0.6;
  return {
    dur,
    still: dur - 1,
    draw(g, t) {
      g.clear();
      g.body(E.x, E.y, R, 'earth');
      // hill and cannon on top
      const c = g.ctx;
      c.beginPath();
      c.moveTo(E.x - 12, H - (E.y + R - 1.5));
      c.lineTo(E.x, H - (E.y + r0 - 2.5));
      c.lineTo(E.x + 12, H - (E.y + R - 1.5));
      c.fillStyle = '#5b7a55';
      c.fill();
      g.line(E.x - 1, E.y + r0 - 2, E.x + 6, E.y + r0 - 1, C.chalk, { width: 3 });
      let cap = 'Throw something sideways and it falls to the ground.';
      shots.forEach((s, i) => {
        if (t < s.t0) return;
        const tt = Math.min(t - s.t0, s.d);
        const pts = s.p.trail(0, tt);
        const live = t - s.t0 <= s.d || s.k === 1;
        g.poly(pts, C.ship, { alpha: live ? 0.9 : 0.35, width: 1.4 });
        const end = pts[pts.length - 1];
        if (s.k < 1 && t - s.t0 > s.d) g.dot(end.x, end.y, 2, C.warn, 0.8);
        else g.dot(end.x, end.y, 3, C.ship);
        if (i === 1 || i === 2) cap = 'Faster, and it lands further away: the ground curves away beneath it.';
        if (i === 3) cap = 'Fast enough, and the ground curves away as fast as it falls. It never lands: that is an orbit.';
      });
      return cap;
    },
  };
};

/** Prograde: burn along your motion and the far side of the orbit rises. */
SCENES.prograde = () => {
  const F = { x: 132, y: 100 }, r0 = 40, ra = 118;
  const mu = muFor(r0, 2.6);
  const f = fixed(F.x, F.y);
  const o0 = Orbit.circle(r0, 180 * DEG, 1, mu);
  const p = new Path(o0, (-150 * DEG), f); // start 150° before the burn point
  p.coast(o0.T * 150 / 360);
  const tb = p.t;
  const vp = Math.sqrt(mu * 2 * ra / (r0 * (r0 + ra)));
  p.burn('prograde', vp - Math.sqrt(mu / r0), 0.12, 12);
  const tEnd = p.t + p.leg.o.T + 0.2;
  const clock = clockFor(p, tEnd, { burnRate: 0.22 });
  return {
    dur: clock.total,
    still: clock.total - 0.5,
    draw(g, T) {
      const t = clock.at(T);
      g.clear();
      g.body(F.x, F.y, 14, 'earth');
      const after = t > tb;
      const L = p.legAt(t);
      g.conic(o0, F, C.chalk, { alpha: after ? 0.25 : 0.55, dash: after ? [3, 4] : null });
      if (after) {
        g.conic(L.o, F, C.ship, { width: 1.5 });
        const k = seg(t, tb, tb + 1.2);
        const ap = apsisPoints(L.o, F).ap;
        if (ap) g.apsis(ap.x, ap.y, F.x, F.y, 'Ap', C.ship, { pulse: pulseAt(t), alpha: k });
        g.ring(F.x - r0, F.y, seg(t, tb, tb + 0.8));
      }
      const s = shipWithBurn(g, p, t);
      burnArrow(g, s, 'prograde', C.term, 'prograde', 24, after && t > tb + 0.6 ? 0.45 : 1);
      if (t < tb - 0.05) return 'Prograde is the way you are moving.';
      if (t < tb + 0.9) return 'Burn prograde and you speed up…';
      return '…so you swing out wider, and the far side of your orbit rises.';
    },
  };
};

/** Retrograde: slow down, drop the far side, and get round sooner than a ship that did not. */
SCENES.retrograde = () => {
  const F = { x: 180, y: 100 }, r0 = 82, rp = 36;
  const mu = muFor(r0, 5);
  const f = fixed(F.x, F.y);
  const o0 = Orbit.circle(r0, 90 * DEG, 1, mu);
  const start = -70 * DEG;
  const p = new Path(o0, start, f);
  const ghost = new Path(o0, start, f);
  p.coast(o0.T * 70 / 360);
  const tb = p.t;
  const va = Math.sqrt(mu * 2 * rp / (r0 * (r0 + rp)));
  p.burn('retrograde', Math.sqrt(mu / r0) - va, 0.12, 12);
  const tEnd = p.t + p.leg.o.T;
  const clock = clockFor(p, tEnd, { burnRate: 0.22, hold: 2 });
  return {
    dur: clock.total,
    still: clock.total - 0.3,
    draw(g, T) {
      const t = clock.at(T);
      g.clear();
      g.body(F.x, F.y, 14, 'earth');
      const after = t > tb;
      g.conic(o0, F, C.chalk, { alpha: after ? 0.3 : 0.55, dash: after ? [3, 4] : null });
      if (after) {
        const o = p.legAt(t).o;
        g.conic(o, F, C.ship, { width: 1.5 });
        const pe = apsisPoints(o, F).pe;
        g.apsis(pe.x, pe.y, F.x, F.y, 'Pe', C.ship, { pulse: pulseAt(t), alpha: seg(t, tb, tb + 1) });
        g.ship(ghost.state(t), C.chalk, { alpha: 0.45 });
      }
      const s = shipWithBurn(g, p, t);
      if (!after || t < tb + 0.8) burnArrow(g, s, 'retrograde', C.term, 'retrograde', 24);
      if (t < tb - 0.05) return 'Retrograde points back, against your motion.';
      if (t < tb + 0.6) return 'Burn retrograde: you slow down and the far side of the orbit drops.';
      if (t < tEnd - 0.05) return 'The lower orbit is shorter and faster. The faint ship stayed in the old orbit…';
      return '…and you are back first. You slowed down, yet you got round sooner.';
    },
  };
};

/** Radial out swings the orbit round; radial in swings it back. */
SCENES.radial = () => {
  const F = { x: 180, y: 100 }, r0 = 60;
  const mu = muFor(r0, 4);
  const f = fixed(F.x, F.y);
  const o0 = Orbit.circle(r0, 90 * DEG, 1, mu);
  const p = new Path(o0, -80 * DEG, f);
  p.coast(o0.T * 80 / 360);
  const tb1 = p.t;
  const dv = 0.3 * Math.sqrt(mu / r0);
  p.burn('radialOut', dv, 0.1, 10);
  const o1 = p.leg.o;
  p.coast(o1.T - 0.1);
  const tb2 = p.t;
  p.burn('radialIn', dv, 0.1, 10);
  const tEnd = p.t + o0.T * 0.3;
  const clock = clockFor(p, tEnd, { burnRate: 0.15 });
  return {
    dur: clock.total,
    still: clock.realAt(tb1 + o1.T * 0.4),
    draw(g, T) {
      const t = clock.at(T);
      g.clear();
      g.body(F.x, F.y, 14, 'earth');
      const L = p.legAt(t);
      const swung = t > tb1 && t < tb2 + 0.05;
      g.conic(o0, F, C.chalk, { alpha: swung ? 0.3 : 0.55, dash: swung ? [3, 4] : null });
      if (swung) {
        g.conic(L.o, F, C.ship, { width: 1.5 });
        const a = apsisPoints(L.o, F);
        const k = seg(t, tb1, tb1 + 1);
        g.apsis(a.ap.x, a.ap.y, F.x, F.y, 'Ap', C.ship, { alpha: k });
        g.apsis(a.pe.x, a.pe.y, F.x, F.y, 'Pe', C.ship, { alpha: k });
      }
      const s = shipWithBurn(g, p, t);
      if (t < tb1 + 0.6) burnArrow(g, s, 'radialOut', C.term, 'radial out', 22);
      else if (t > tb2 - 0.5 && t < tb2 + 0.6) burnArrow(g, s, 'radialIn', C.term, 'radial in', 16);
      if (t < tb1) return 'Radial out points straight away from Earth.';
      if (t < tb1 + 1.5) return 'A radial out burn swings the orbit round: higher ahead of you, lower behind.';
      if (t < tb2 - 0.5) return 'The orbit is about the same size. Only its direction changed.';
      if (t < tb2 + 0.6) return 'Back at the same spot, radial in undoes it.';
      return 'A round orbit again. Radial burns aim; they do not climb.';
    },
  };
};

/** Apoapsis and periapsis on an ellipse, with real speeds for the body chosen. */
function apsidesScene({ body, peName, apName, hl, rp = 34, ra = 118, realRp, realMu, radius = 0, orbits }) {
  return () => {
    const a = (rp + ra) / 2;
    const F = { x: 180 + (a - rp), y: 100 };
    const mu = muFor(a, 6.5);
    const o = Orbit.apsides(rp, ra, 0, 1, mu);
    const p = new Path(o, 0, fixed(F.x, F.y));
    const k = realRp / rp; // km per diagram unit
    const aR = a * k;
    const speed = (r) => Math.sqrt(realMu * (2 / (r * k) - 1 / aR));
    const dur = o.T;
    const ap = apsisPoints(o, F);
    return {
      dur,
      still: dur * 0.46,
      draw(g, t) {
        g.clear();
        if (orbits) {
          g.circle(F.x, F.y, rp, C.earth, { dash: [2, 4], alpha: 0.6 });
          g.circle(F.x, F.y, ra, C.mars, { dash: [2, 4], alpha: 0.6 });
          g.text("Earth's orbit", F.x, F.y - rp + 10, { color: C.atmo, size: 11, align: 'center', alpha: 0.8 });
          g.text("Mars's orbit", F.x + ra * 0.72 + 4, F.y + ra * 0.72 + 4, { color: C.mars, size: 11, alpha: 0.9 });
        }
        g.body(F.x, F.y, body === 'sun' ? 10 : 14, body);
        g.conic(o, F, C.ship, { width: 1.5 });
        const pulse = pulseAt(t);
        g.apsis(ap.pe.x, ap.pe.y, F.x, F.y, peName, hl === 'ap' ? C.dim : C.ship, { pulse: hl !== 'ap' ? pulse : 0 });
        g.apsis(ap.ap.x, ap.ap.y, F.x, F.y, apName, hl === 'pe' ? C.dim : C.ship, { pulse: hl !== 'pe' ? pulse : 0 });
        const s = p.state(t);
        const r = Math.hypot(s.rel.x, s.rel.y);
        const v = speed(r);
        const vMax = speed(rp);
        const [ux, uy] = unit(s.vx, s.vy);
        g.arrow(s.x, s.y, ux * 34 * v / vMax, uy * 34 * v / vMax, C.term, { width: 1.6, head: 5 });
        g.ship(s);
        g.panel([
          [`Speed ${v.toFixed(v < 10 ? 2 : 1)} km/s`, C.term],
          [body === 'sun' ? `${Math.round((r * k) / 1e6)} million km from the Sun` : `Height ${Math.round(r * k - radius).toLocaleString('en-US')} km`, C.dim],
        ]);
        const nu = wrapPi(s.rel.nu);
        if (Math.abs(nu) < 40 * DEG) return `${peName}: the lowest point. You are moving fastest here.`;
        if (Math.abs(nu) > 140 * DEG) return `${apName}: the highest point. You are moving slowest here.`;
        return nu > 0 ? 'Climbing away: gravity slows you down.' : 'Falling back in: speeding up again.';
      },
    };
  };
}

const EARTH_ORBIT = { body: 'earth', realRp: 6771, realMu: 398600, radius: 6371 };
SCENES['apsides-ap'] = apsidesScene({ ...EARTH_ORBIT, peName: 'Pe', apName: 'Ap', hl: 'ap' });
SCENES['apsides-pe'] = apsidesScene({ ...EARTH_ORBIT, peName: 'Pe', apName: 'Ap', hl: 'pe' });
SCENES['apsides-earth'] = apsidesScene({ ...EARTH_ORBIT, peName: 'Perigee', apName: 'Apogee' });
SCENES['apsides-moon'] = apsidesScene({ body: 'moon', peName: 'Perilune', apName: 'Apolune', realRp: 1837, realMu: 4902.8, radius: 1737.4 });
SCENES['apsides-sun'] = apsidesScene({ body: 'sun', peName: 'Perihelion', apName: 'Aphelion', rp: 60, ra: 91.4, realRp: 149.6e6, realMu: 1.32712e11, orbits: true });

/** Orbital period: the low ship laps three times while the high one goes round once. */
SCENES.period = () => {
  const F = { x: 180, y: 100 }, r1 = 38, r2 = 81;
  const mu = muFor(r1, 2.3);
  const f = fixed(F.x, F.y);
  const o1 = Orbit.circle(r1, 90 * DEG, 1, mu), o2 = Orbit.circle(r2, 90 * DEG, 1, mu);
  const p1 = new Path(o1, 0, f), p2 = new Path(o2, 0, f);
  const dur = o2.T + 1.4;
  return {
    dur,
    still: o2.T * 0.62,
    draw(g, T) {
      const t = Math.min(T, o2.T);
      g.clear();
      g.body(F.x, F.y, 12, 'earth');
      g.conic(o1, F, C.ship, { alpha: 0.55 });
      g.conic(o2, F, C.target, { alpha: 0.55 });
      g.line(F.x, F.y + 13, F.x, F.y + r2 + 8, C.chalk, { dash: [2, 3], alpha: 0.4 });
      // each ship's progress round its current lap
      const k1 = (t / o1.T) % 1, k2 = t / o2.T;
      if (k1 > 0.01) g.arc(F.x, F.y, r1 + 5, 90 * DEG, 90 * DEG + k1 * TAU, C.ship, { width: 2, alpha: 0.6 });
      if (k2 > 0.01) g.arc(F.x, F.y, r2 + 5, 90 * DEG, 90 * DEG + Math.min(k2, 0.999) * TAU, C.target, { width: 2, alpha: 0.6 });
      g.ship(p1.state(t), C.ship);
      g.ship(p2.state(t), C.target);
      const laps1 = Math.floor(t / o1.T + 1e-6), laps2 = Math.floor(t / o2.T + 1e-6);
      g.panel([
        ['400 km up: 92 min a lap', C.ship],
        [`   laps done: ${laps1}`, C.ship],
        ['8,000 km up: 4 h 46 min a lap', C.target],
        [`   laps done: ${laps2}`, C.target],
      ]);
      if (laps2 >= 1) return 'One high lap took as long as three low ones. Lower orbits have shorter periods.';
      return 'The period is the time one lap takes.';
    },
  };
};

/** Circularize: at apoapsis, burn prograde until the periapsis comes up to meet it. */
SCENES.circularize = () => {
  const rp = 30, ra = 84;
  const F = { x: 180 + ((rp + ra) / 2 - rp) - 6, y: 100 };
  const mu = muFor(ra, 5);
  const f = fixed(F.x, F.y);
  const o0 = Orbit.apsides(rp, ra, 0, 1, mu);
  const p = new Path(o0, -40 * DEG, f);
  p.coastTo('ap');
  const tb = p.t;
  const va = Math.sqrt(mu * 2 * rp / (ra * (rp + ra)));
  p.burn('prograde', Math.sqrt(mu / ra) - va, 0.3, 24);
  const tEnd = p.t + p.leg.o.T * 0.55;
  const clock = clockFor(p, tEnd, { burnRate: 0.14, hold: 1.4 });
  return {
    dur: clock.total,
    still: clock.total - 0.5,
    draw(g, T) {
      const t = clock.at(T);
      g.clear();
      g.body(F.x, F.y, 13, 'earth');
      g.circle(F.x, F.y, ra, C.ok, { dash: [3, 4], alpha: 0.45 });
      const o = p.legAt(t).o;
      g.conic(o, F, C.ship, { width: 1.5 });
      const a = apsisPoints(o, F);
      if (o.e > 0.012) {
        g.apsis(a.pe.x, a.pe.y, F.x, F.y, 'Pe', C.ship, { pulse: t > tb ? pulseAt(t, 0.7) : 0 });
        g.apsis(a.ap.x, a.ap.y, F.x, F.y, 'Ap', C.ship);
      }
      const s = shipWithBurn(g, p, t);
      if (t < tb) return 'Coast up to apoapsis, where the ellipse touches the circle you want.';
      if (t < tb + 0.3) return 'Burn prograde at Ap. The periapsis on the far side rises…';
      return '…until Pe meets Ap. The orbit is round: you have circularized.';
    },
  };
};

/** Two ships on circles, a transfer from the inner to the outer one, timed by the phase angle. */
function transferScene({ r1, r2, T1, central, wait = 0, inner = 'ship', outer = 'ship', arc = false, captions, months = false }) {
  return () => {
    const F = { x: 180, y: 100 };
    const mu = muFor(r1, T1);
    const f = fixed(F.x, F.y);
    const oIn = Orbit.circle(r1, 0, 1, mu);
    const oOut = Orbit.circle(r2, 0, 1, mu);
    const w1 = TAU / oIn.T, w2 = TAU / oOut.T;
    const at = (r1 + r2) / 2;
    const tTr = Math.PI * Math.sqrt(at ** 3 / mu);
    const lead = Math.PI - w2 * tTr; // phase angle needed at the burn
    // the burn happens at angle 180° (left); the ship waits `wait` seconds before it
    const t0 = wait;
    const thShip0 = Math.PI - w1 * t0;
    const p = new Path(oIn, wrapPi(thShip0), f);
    p.coast(t0);
    const tb1 = p.t;
    const vc1 = Math.sqrt(mu / r1), vp = Math.sqrt(mu * 2 * r2 / (r1 * (r1 + r2)));
    p.burn('prograde', vp - vc1, 0.05, 5);
    p.coastTo('ap');
    const tb2 = p.t;
    const vc2 = Math.sqrt(mu / r2), va = Math.sqrt(mu * 2 * r1 / (r2 * (r1 + r2)));
    p.burn('prograde', vc2 - va, 0.05, 5);
    const tEnd = p.t + oOut.T * 0.12;
    // the outer object is `lead` ahead when the ship burns
    const thOut = (t) => Math.PI + lead + w2 * (t - tb1);
    const thIn = (t) => Math.PI + w1 * (t - tb1); // the inner body (the planet the ship leaves)
    const clock = clockFor(p, tEnd, { burnRate: 0.35, hold: 1.6, lead: 0.3 });
    // without motion: the phase angle just before the burn, or the ship halfway across
    const out = { dur: clock.total, still: arc ? clock.realAt(tb1 - 0.01) : clock.realAt((tb1 + tb2) / 2) };
    out.draw = (g, T) => {
      const t = clock.at(T);
      g.clear();
      g.circle(F.x, F.y, r1, inner === 'ship' ? C.chalk : C.earth, { dash: [2, 4], alpha: 0.5 });
      g.circle(F.x, F.y, r2, outer === 'ship' ? C.target : C.mars, { dash: [2, 4], alpha: 0.5 });
      g.body(F.x, F.y, central === 'sun' ? 9 : 12, central);
      const L = p.legAt(t);
      const s = p.state(t);
      const on = t > tb1 && t < tb2 + 0.05;
      if (on) g.conic(L.o, F, C.ship, { width: 1.4, from: 0, to: Math.PI });
      if (inner !== 'ship') {
        const th = thIn(t);
        g.body(F.x + r1 * Math.cos(th), F.y + r1 * Math.sin(th), 5, inner);
      }
      const tho = thOut(t);
      const ox = F.x + r2 * Math.cos(tho), oy = F.y + r2 * Math.sin(tho);
      if (outer === 'ship') g.ship({ x: ox, y: oy, vx: -Math.sin(tho), vy: Math.cos(tho) }, C.target);
      else g.body(ox, oy, 6, outer);
      // phase angle between the ship and the target
      const ths = Math.atan2(s.y - F.y, s.x - F.x);
      const ph = wrapPi(tho - ths);
      if (arc && t <= tb1 + 0.02) {
        const hot = Math.abs(ph - lead) < 2 * DEG;
        const col = hot ? C.ok : C.term;
        const ra = (r1 + r2) / 2;
        g.arc(F.x, F.y, ra, ths, ths + ph, col, { width: 2 });
        g.line(F.x, F.y, s.x, s.y, col, { alpha: 0.5, dash: [2, 2] });
        g.line(F.x, F.y, ox, oy, col, { alpha: 0.5, dash: [2, 2] });
        const mid = ths + ph / 2;
        g.text(`${Math.round(ph / DEG)}°`, F.x + (ra + 13) * Math.cos(mid), F.y + (ra + 13) * Math.sin(mid), { color: col, size: 13, weight: 600, align: 'center' });
      }
      g.ring(F.x - r1, F.y, (t - tb1) / 0.7);
      g.ring(F.x + r2, F.y, (t - tb2) / 0.7);
      if (inner === 'ship' || t > tb1) shipWithBurn(g, p, t);
      const lines = [[`Needed: ${Math.round(lead / DEG)}° ahead`, C.ok]];
      if (months) lines.push([`Month ${Math.max(0, (Math.min(t, tb2) - tb1) / oIn.T * 12).toFixed(1)} of the trip`, C.dim]);
      if (arc) g.panel(lines);
      else if (months) g.panel(lines.slice(1));
      if (t < tb1 - 0.02) return captions[0];
      if (t < tb1 + 0.3) return captions[1];
      if (t < tb2 - 0.02) return captions[2];
      if (t < tb2 + 0.3) return captions[3];
      return captions[4];
    };
    return out;
  };
}

SCENES.hohmann = transferScene({
  r1: 32, r2: 84, T1: 2.2, central: 'earth', wait: 0.6,
  captions: [
    'Start in the low orbit. The target circles higher up.',
    'Burn 1: prograde, to stretch your orbit out to the target\'s.',
    'Coast half an orbit along the transfer ellipse.',
    'Burn 2 at apoapsis: prograde again, to circularize.',
    'Two burns, half an orbit apart, and the target is right there.',
  ],
});

SCENES['phase-angle'] = transferScene({
  r1: 32, r2: 84, T1: 2.2, central: 'earth', wait: 2.6, arc: true,
  captions: [
    'The phase angle is how far ahead the target is. You lap it, so the angle keeps changing.',
    'It has reached the angle this transfer needs. Burn now.',
    'The target moves on while you fly…',
    '…and reaches the meeting point just as you do.',
    'Burn at the right phase angle and the target is waiting when you arrive.',
  ],
});

SCENES.window = transferScene({
  r1: 50, r2: 76.2, T1: 3.2, central: 'sun', wait: 2.4, arc: true, inner: 'earth', outer: 'mars', months: true,
  captions: [
    'Earth laps Mars every 26 months, so the angle between them keeps changing.',
    'Mars is 44° ahead of Earth: the window is open. Leave now.',
    'Mars moves on during the eight-and-a-half-month trip…',
    '…and gets to the far end of the transfer just as you do.',
    'Leave in the window and Mars is waiting when you arrive.',
  ],
});

/** Ellipse: a circle stretched, with the planet at a focus rather than the centre. */
SCENES.ellipse = () => {
  const F = { x: 214, y: 100 }, a = 72;
  const mu = muFor(a, 3);
  const dur = 9;
  return {
    dur,
    still: dur * 0.5,
    draw(g, t) {
      const e = 0.78 * (0.5 - 0.5 * Math.cos((TAU * t) / dur));
      const o = new Orbit(a * (1 - e), Math.max(e, 1e-4), 0, 1, mu);
      g.clear();
      g.conic(o, F, C.ship, { width: 1.6 });
      g.body(F.x, F.y, 9, 'earth');
      const cx = F.x - a * e;
      g.line(cx - 4, F.y, cx + 4, F.y, C.chalk, { alpha: 0.6 });
      g.line(cx, F.y - 4, cx, F.y + 4, C.chalk, { alpha: 0.6 });
      if (e > 0.12) {
        g.circle(F.x - 2 * a * e, F.y, 2.5, C.chalk, { alpha: 0.6 });
        g.text('other focus', F.x - 2 * a * e, F.y - 15, { color: C.dim, size: 11, align: 'center' });
        g.text('centre', cx, F.y + 11, { color: C.dim, size: 11, align: 'center' });
      }
      const ap = apsisPoints(o, F);
      g.apsis(ap.pe.x, ap.pe.y, F.x, F.y, 'Pe', C.ship);
      g.apsis(ap.ap.x, ap.ap.y, F.x, F.y, 'Ap', C.ship);
      const M = o.n * t * 1.4;
      const q = o.at(o.nuAt(M));
      g.ship({ x: F.x + q.x, y: F.y + q.y, vx: q.vx, vy: q.vy });
      g.panel([[`Eccentricity ${e.toFixed(2)}`, C.term], [e < 0.05 ? 'a circle' : e < 0.5 ? 'a gentle ellipse' : 'a long, thin ellipse', C.dim]]);
      return e < 0.05
        ? 'A circle is an ellipse with eccentricity 0.'
        : 'Stretch it and it becomes an ellipse. The planet sits at one focus, not in the middle.';
    },
  };
};

/** Time warp: the clock runs faster; the orbit does not change. */
SCENES.warp = () => {
  const F = { x: 236, y: 100 }, r = 62;
  const P = 5520; // seconds per lap at 400 km
  const steps = [[1, 1.4], [10, 1.4], [100, 1.8], [1000, 5.52], [1, 1.2]];
  const dur = steps.reduce((s, [, d]) => s + d, 0);
  const gameT = (t) => {
    let g = 0;
    for (const [w, d] of steps) {
      if (t <= d) return g + w * t;
      g += w * d;
      t -= d;
    }
    return g;
  };
  const warpAt = (t) => {
    for (const [w, d] of steps) { if (t <= d) return w; t -= d; }
    return 1;
  };
  return {
    dur,
    still: 1.4 + 1.4 + 1.8 + 2.4,
    draw(g, t) {
      g.clear();
      g.body(F.x, F.y, 18, 'earth');
      g.circle(F.x, F.y, r, C.ship, { alpha: 0.6, width: 1.4 });
      const w = warpAt(t);
      const gt = gameT(t);
      const th = Math.PI / 2 + (TAU * gt) / P;
      if (w >= 100) {
        const span = Math.min(TAU * 0.9, (TAU * w * 0.12) / P * 6);
        g.arc(F.x, F.y, r, th - span, th, C.ship, { width: 2.5, alpha: 0.35 });
      }
      g.ship({ x: F.x + r * Math.cos(th), y: F.y + r * Math.sin(th), vx: -Math.sin(th), vy: Math.cos(th) });
      const hh = Math.floor(gt / 3600), mm = Math.floor((gt % 3600) / 60), ss = Math.floor(gt % 60);
      g.text(`${w.toLocaleString('en-US')}×`, 70, 118, { color: C.ship, size: 34, weight: 700, align: 'center' });
      g.text('time warp', 70, 94, { color: C.dim, size: 12, align: 'center' });
      g.text(`${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, 70, 70, { color: C.chalk, size: 18, weight: 600, align: 'center' });
      g.text('mission clock', 70, 52, { color: C.dim, size: 12, align: 'center' });
      if (w === 1) return 'At 1× one lap of Earth takes 92 minutes of real time.';
      return `At ${w.toLocaleString('en-US')}×, ${w.toLocaleString('en-US')} seconds pass every second. The orbit stays exactly the same.`;
    },
  };
};

/** Δv: the same 3 km/s along your motion and sideways. */
SCENES['delta-v'] = () => {
  const v0 = 7.7, dv = 3, k = 13; // px per km/s
  const part = 5;
  const dur = part * 2;
  return {
    dur,
    still: part * 0.8,
    draw(g, t) {
      g.clear();
      const side = t >= part;
      const tt = t % part;
      const b = seg(tt, 1, 2.6);
      const S = { x: 70, y: 86 };
      const dx = side ? 0 : dv * b, dy = side ? dv * b : 0;
      const nx = v0 + dx, ny = dy;
      const sp = Math.hypot(nx, ny);
      // old velocity, the burn added at its tip, and the new velocity
      g.arrow(S.x, S.y, v0 * k, 0, C.chalk, { width: 1.6, alpha: b > 0 ? 0.45 : 1 });
      // along the motion the new velocity lies on top of the old one: draw it just above
      const lift = side ? 0 : 12;
      if (b > 0) {
        g.arrow(S.x + v0 * k, S.y, dx * k, dy * k, C.term, { width: 2.2 });
        g.arrow(S.x, S.y + lift, nx * k, ny * k, C.ship, { width: 2 });
      }
      g.ship({ x: S.x, y: S.y, vx: nx, vy: ny }, C.ship, { size: 6 });
      if (b > 0 && b < 1) g.flame({ x: S.x, y: S.y }, side ? 0 : 1, side ? 1 : 0, 1);
      g.text(`${v0.toFixed(1)} km/s before`, S.x + (v0 * k) / 2 - 10, S.y - 12, { color: C.dim, size: 12, align: 'center' });
      if (b > 0) {
        g.text(`Δv ${(dv * b).toFixed(1)} km/s`, S.x + v0 * k + (side ? 8 : dx * k / 2), S.y + (side ? dy * k / 2 : -12), { color: C.term, size: 13, weight: 600, align: side ? 'left' : 'left' });
        g.text(`${sp.toFixed(1)} km/s after`, S.x + (nx * k) / 2 - (side ? 20 : 0), S.y + lift + (ny * k) / 2 + 13, { color: C.ship, size: 13, weight: 600, align: 'center' });
      }
      g.panel([[side ? 'Burn sideways (radial)' : 'Burn along your motion (prograde)', C.dim], [`Δv spent: ${(dv * b).toFixed(1)} km/s`, C.term]]);
      if (tt < 1) return side ? 'Now the same Δv, pointed sideways.' : 'Δv is the change a burn makes to your velocity.';
      if (!side) return `Prograde: ${dv} km/s of Δv adds ${dv} km/s to your speed.`;
      return `Sideways, ${dv} km/s of Δv mostly turns you. Your speed only goes up by ${(Math.hypot(v0, dv) - v0).toFixed(1)} km/s.`;
    },
  };
};

/** Rocket equation: every 2.3 km/s burns off half of what is left. */
SCENES.rocket = () => {
  const ve = 3.335; // Isp 340 s × g0
  const burnT = 7, dur = burnT + 1.8;
  const mEnd = 0.08;
  const G = { x0: 150, y0: 34, w: 190, h: 130, vMax: 8.5 };
  const gx = (v) => G.x0 + (v / G.vMax) * G.w;
  const gy = (m) => G.y0 + m * G.h;
  return {
    dur,
    still: burnT * 0.7,
    draw(g, t) {
      g.clear();
      const k = seg(t, 0, burnT);
      const m = 1 - (1 - mEnd) * k; // mass falls steadily at constant thrust
      const dv = ve * Math.log(1 / m);
      // rocket: tank fill shows the mass left
      const R = { x: 58, y: 40, w: 26, h: 110 };
      const c = g.ctx;
      c.strokeStyle = C.chalk;
      c.lineWidth = 1.2;
      c.strokeRect(R.x, H - R.y - R.h, R.w, R.h);
      c.beginPath();
      c.moveTo(R.x, H - R.y - R.h);
      c.lineTo(R.x + R.w / 2, H - R.y - R.h - 20);
      c.lineTo(R.x + R.w, H - R.y - R.h);
      c.stroke();
      const fuelH = (R.h - 16) * ((m - mEnd) / (1 - mEnd));
      c.fillStyle = C.ship;
      c.globalAlpha = 0.75;
      c.fillRect(R.x + 3, H - R.y - 13 - fuelH, R.w - 6, fuelH);
      c.globalAlpha = 1;
      if (t < burnT) g.flame({ x: R.x + R.w / 2, y: R.y }, 0, 1, 1.4);
      const acc = 1 / m;
      g.arrow(R.x + R.w + 14, R.y + R.h / 2 - 6, 0, 10 + 6 * Math.min(acc, 8), C.term, { width: 2 });
      g.text(`push ×${acc.toFixed(1)}`, R.x + R.w + 22, R.y + 20, { color: C.term, size: 12 });
      // graph: mass left against Δv gained
      g.line(G.x0, G.y0, G.x0 + G.w, G.y0, C.faint);
      g.line(G.x0, G.y0, G.x0, G.y0 + G.h, C.faint);
      g.text('mass left', G.x0 - 4, G.y0 + G.h + 8, { color: C.dim, size: 11, align: 'right' });
      g.text('Δv gained (km/s) →', G.x0 + G.w, G.y0 - 25, { color: C.dim, size: 11, align: 'right' });
      for (let i = 1; i <= 3; i++) {
        const v = ve * Math.log(2) * i;
        g.line(gx(v), G.y0, gx(v), gy(0.5 ** i), C.term, { dash: [2, 3], alpha: 0.4 });
        g.text(`${v.toFixed(1)}`, gx(v), G.y0 - 11, { color: C.dim, size: 11, align: 'center' });
        g.text(['½', '¼', '⅛'][i - 1], gx(v) + 4, gy(0.5 ** i) + 7, { color: C.term, size: 12 });
      }
      const pts = [];
      for (let v = 0; v <= G.vMax; v += 0.1) pts.push({ x: gx(v), y: gy(Math.exp(-v / ve)) });
      g.poly(pts, C.chalk, { alpha: 0.5 });
      g.dot(gx(dv), gy(m), 4, C.ship);
      g.panel([[`Mass left ${Math.round(m * 100)}%`, C.ship], [`Δv so far ${dv.toFixed(1)} km/s`, C.term]], 240, H - 14);
      if (dv < 2.3) return 'Δv = Isp·g₀·ln(m₀/m₁). The first 2.3 km/s burns off half the ship.';
      if (dv < 4.6) return 'The next 2.3 km/s burns half of what is left…';
      if (t < burnT) return '…and so on. Each half costs more fuel than you have left to give.';
      return 'The lighter the ship, the harder the same engine pushes it.';
    },
  };
};

/** Earth, the Moon moving on its orbit, and a ship whose path crosses the Moon's SOI. */
function moonScene(soiFocus) {
  return () => {
    const E = { x: 180, y: 100 }, Rm = 92, soi = 26, r0 = 16;
    const muE = muFor(r0, 1.6);
    const muM = muE * 0.012; // the real Moon/Earth ratio
    const wm = Math.sqrt(muE / Rm ** 3);
    const fE = fixed(E.x, E.y);
    const ra = Rm - 1;
    const tTr = Math.PI * Math.sqrt(((r0 + ra) / 2) ** 3 / muE);
    const vc = Math.sqrt(muE / r0), vp = Math.sqrt(muE * 2 * ra / (r0 * (r0 + ra)));
    const wait = 0.7, thB = 200 * DEG; // burn point; the ship arrives on the opposite side
    const dist = (s, m) => Math.hypot(s.x - m.x, s.y - m.y);
    // fly the transfer with the Moon arriving `off` seconds after the ship
    const fly = (off) => {
      const fM = railFocus(E.x, E.y, Rm, thB + Math.PI - wm * (wait + tTr + off), wm);
      const p = new Path(Orbit.circle(r0, thB, 1, muE), -wait * Math.sqrt(muE / r0 ** 3), fE);
      p.coast(wait).burn('prograde', vp - vc, 0.03, 3);
      if (!p.coastUntil((s, t) => dist(s, fM(t)) < soi, tTr * 1.6)) return null;
      const tIn = p.t;
      p.restart(0, 0, fM, muM);
      return { p, fM, tIn, rpM: p.leg.o.rp };
    };
    // aim for a pass a few Moon radii from its centre
    let pick = null;
    for (let off = -0.3; off <= 0.3; off += 0.01) {
      const b = fly(off);
      if (b && (!pick || Math.abs(b.rpM - 9) < Math.abs(pick.rpM - 9))) pick = b;
    }
    const { p, fM, tIn } = pick;
    p.coastUntil((s, t) => dist(s, fM(t)) > soi, 6);
    const tOut = p.t;
    p.restart(0, 0, fE, muE);
    const tEnd = tOut + 1.4;
    const tb = p.burns[0].t0;
    const clock = clockFor(p, tEnd, { burnRate: 0.5, hold: 1 });
    return {
      dur: clock.total,
      still: clock.realAt((tIn + tOut) / 2),
      draw(g, T) {
        const t = clock.at(T);
        g.clear();
        g.circle(E.x, E.y, Rm, C.moon, { dash: [2, 4], alpha: 0.35 });
        g.body(E.x, E.y, 10, 'earth');
        const m = fM(t);
        const inside = t >= tIn && t < tOut;
        g.circle(m.x, m.y, soi, inside ? C.ok : C.term, { dash: [3, 3], width: inside ? 1.6 : 1.1, alpha: inside ? 0.95 : 0.7 });
        g.text('Moon\'s SOI', m.x, m.y - soi - 8, { color: inside ? C.ok : C.term, size: 11, align: 'center' });
        g.body(m.x, m.y, 5, 'moon');
        g.poly(p.trail(Math.max(0, tb - 0.2), t, 1 / 60), C.ship, { alpha: 0.8, width: 1.3 });
        const L = p.legAt(t);
        if (t < tIn) g.conic(L.o, E, C.ship, { alpha: 0.25, dash: [2, 3] });
        else if (inside) g.conic(L.o, m, C.ok, { alpha: 0.6, rMax: soi, dash: [2, 3] });
        shipWithBurn(g, p, t);
        g.panel([['Orbiting', C.dim], [inside ? 'the Moon' : 'Earth', inside ? C.ok : C.chalk]]);
        if (soiFocus) {
          if (t < tIn - 0.05) return 'Outside the dashed circle, Earth\'s gravity is the one that counts.';
          if (inside) return 'Inside it you orbit the Moon, and your path bends around the Moon instead.';
          return 'Out again, and back to orbiting Earth.';
        }
        if (t < tb + 0.2) return 'Burn when the Moon is well ahead of you. It keeps moving while you fly.';
        if (t < tIn - 0.05) return 'You aim at where the Moon will be, not where it is now.';
        if (inside) return 'Encounter: you are inside the Moon\'s sphere of influence.';
        return 'Without a braking burn, the Moon flings you back out.';
      },
    };
  };
}

SCENES.encounter = moonScene(false);
SCENES.soi = moonScene(true);

/** Arriving at the Moon on a hyperbola, with (capture) or without (flyby) a braking burn. */
function arrivalScene(brake) {
  return () => {
    const M = { x: 200, y: 96 }, rp = 26, e = 1.5, soi = 96;
    const mu = muFor(40, 3.2);
    const f = fixed(M.x, M.y);
    const o = new Orbit(rp, e, -60 * DEG, 1, mu);
    // start where the incoming leg crosses r = 150
    const nu0 = -Math.acos((o.p / 150 - 1) / e);
    const p = new Path(o, o.MAt(nu0), f);
    p.coastTo('pe');
    const tb = p.t;
    let tEnd;
    if (brake) {
      const eNew = 0.35;
      const vHyp = Math.sqrt(mu * (1 + e) / rp), vEll = Math.sqrt(mu * (1 + eNew) / rp);
      p.burn('retrograde', vHyp - vEll, 0.18, 14);
      tEnd = p.t + p.leg.o.T * 1.1;
    } else {
      p.coastUntil((s) => Math.hypot(s.rel.x, s.rel.y) > 160, 20);
      tEnd = p.t;
    }
    const clock = clockFor(p, tEnd, { burnRate: 0.18, hold: 1.2 });
    return {
      dur: clock.total,
      still: brake ? clock.total - 0.4 : clock.at(0) + tb + 0.3,
      draw(g, T) {
        const t = clock.at(T);
        g.clear();
        g.circle(M.x, M.y, soi, C.term, { dash: [3, 3], alpha: 0.45 });
        g.body(M.x, M.y, 14, 'moon');
        const L = p.legAt(t);
        const closed = L.o.e < 1;
        if (!closed) g.conic(o, M, C.ship, { alpha: t > tb && brake ? 0.25 : 0.7, dash: [3, 3], rMax: 190 });
        if (brake && t > tb) g.conic(L.o, M, closed ? C.ok : C.ship, { width: 1.5, rMax: 190 });
        const pe = apsisPoints(o, M).pe;
        g.apsis(pe.x, pe.y, M.x, M.y, 'Pe', C.ship, { pulse: t < tb ? pulseAt(t) : 0 });
        g.poly(p.trail(Math.max(0, t - 2.5), t, 1 / 60), C.ship, { alpha: 0.35, width: 2 });
        const s = shipWithBurn(g, p, t);
        if (brake && t > tb - 0.4 && t < tb + 0.5) burnArrow(g, s, 'retrograde', C.term, 'retrograde', 20);
        g.panel([[`Eccentricity ${L.o.e.toFixed(2)}`, C.term], [closed ? 'closed: an ellipse' : 'open: a hyperbola', closed ? C.ok : C.dim]]);
        if (!brake) {
          if (t < tb) return 'Arriving from far away, you are too fast to stay: the path is a hyperbola.';
          return 'It swings round the Moon once and heads back out, never to return.';
        }
        if (t < tb - 0.05) return 'You arrive on a hyperbola, too fast to stay.';
        if (t < tb + 0.3) return 'Burn retrograde at periapsis, where you are fastest…';
        return '…and the path closes into an ellipse. Captured.';
      },
    };
  };
}

SCENES.capture = arrivalScene(true);
SCENES.flyby = arrivalScene(false);

/** Escape: each prograde burn at periapsis stretches the orbit, until it opens. */
SCENES.escape = () => {
  const F = { x: 96, y: 100 }, r0 = 26;
  const mu = muFor(r0, 1.8);
  const f = fixed(F.x, F.y);
  const vAt = (e) => Math.sqrt(mu * (1 + e) / r0);
  const oCirc = Orbit.circle(r0, 180 * DEG, 1, mu);
  const p = new Path(oCirc, -120 * DEG, f);
  p.coastTo('pe');
  const tb1 = p.t;
  p.burn('prograde', vAt(0.5) - vAt(0), 0.06, 6);
  const oEll = p.leg.o;
  p.coastTo('pe');
  const tb2 = p.t;
  p.burn('prograde', vAt(1.35) - vAt(0.5), 0.06, 6);
  p.coastUntil((s) => s.x > W + 20 || Math.hypot(s.rel.x, s.rel.y) > 330, 20);
  const tEnd = p.t;
  const clock = clockFor(p, tEnd, { burnRate: 0.2, hold: 1.2 });
  return {
    dur: clock.total,
    still: clock.total - 1.6,
    draw(g, T) {
      const t = clock.at(T);
      g.clear();
      g.body(F.x, F.y, 12, 'earth');
      const L = p.legAt(t);
      if (t > tb1 + 0.06) g.conic(oCirc, F, C.chalk, { alpha: 0.22, dash: [2, 4] });
      if (t > tb2 + 0.06) g.conic(oEll, F, C.chalk, { alpha: 0.22, dash: [2, 4] });
      g.conic(L.o, F, L.o.e < 1 ? C.ship : C.warn, { width: 1.5, rMax: 420 });
      shipWithBurn(g, p, t);
      g.panel([[`Eccentricity ${L.o.e.toFixed(2)}`, C.term], [L.o.e < 1 ? 'closed: you come back' : 'open: escaping', L.o.e < 1 ? C.dim : C.warn]]);
      if (t < tb1) return 'In orbit, falling round and round.';
      if (t < tb2) return 'A prograde burn at periapsis stretches the orbit out.';
      return 'Past escape velocity the orbit opens into a hyperbola. You are not coming back.';
    },
  };
};

/** Oberth effect: the same Δv at periapsis and at apoapsis. */
SCENES.oberth = () => {
  const rp = 24, ra = 90;
  const F = { x: 210, y: 100 };
  const mu = muFor((rp + ra) / 2, 4.4);
  const f = fixed(F.x, F.y);
  const o0 = Orbit.apsides(rp, ra, 0, 1, mu);
  // half an orbit apart, so A reaches periapsis just as B reaches apoapsis
  const A = new Path(o0, -0.9, f), B = new Path(o0, Math.PI - 0.9, f);
  const vp = Math.sqrt(mu * 2 * ra / (rp * (rp + ra)));
  const dv = 0.04 * vp;
  A.coastTo('pe'); B.coastTo('ap');
  const ta = A.t, tbB = B.t;
  A.burn('prograde', dv, 0.02, 2);
  B.burn('prograde', dv, 0.02, 2);
  const energy = (s) => (s.rel.vx ** 2 + s.rel.vy ** 2) / 2 - mu / Math.hypot(s.rel.x, s.rel.y);
  const e0 = energy(A.state(ta - 0.001));
  const gainA = energy(A.state(A.t + 0.01)) - e0, gainB = energy(B.state(B.t + 0.01)) - e0;
  const tEnd = Math.max(A.t, B.t) + 5;
  const burnT = Math.min(ta, tbB);
  const clock = new Clock().run(burnT).run(0.05, 0.08).to(tEnd).hold(1.2);
  return {
    dur: clock.total,
    still: clock.total - 0.4,
    draw(g, T) {
      const t = clock.at(T);
      g.clear();
      g.body(F.x, F.y, 12, 'earth');
      const after = t > burnT + 0.02;
      g.conic(o0, F, C.chalk, { alpha: after ? 0.3 : 0.6, dash: after ? [3, 4] : null });
      if (after) {
        g.conic(A.legAt(t).o, F, C.ship, { width: 1.5, rMax: 400 });
        g.conic(B.legAt(t).o, F, C.target, { width: 1.5 });
      }
      g.ring(F.x + rp, F.y, (t - burnT) / 0.8);
      g.ring(F.x - ra, F.y, (t - burnT) / 0.8, C.target);
      shipWithBurn(g, A, t, C.ship);
      shipWithBurn(g, B, t, C.target);
      const k = seg(t, burnT, burnT + 0.8);
      const bar = (y, gain, col, label) => {
        g.text(label, 10, y, { color: col, size: 12 });
        const c = g.ctx;
        c.fillStyle = col;
        c.globalAlpha = 0.8;
        c.fillRect(96, H - y - 4, (gain / gainA) * 90 * k, 8);
        c.globalAlpha = 1;
      };
      g.text('Orbital energy gained', 10, H - 14, { color: C.dim, size: 12 });
      bar(H - 30, gainA, C.ship, 'burn at Pe');
      bar(H - 46, gainB, C.target, 'burn at Ap');
      if (!after) return 'Two ships on the same orbit, about to burn the same Δv: one at Pe, one at Ap.';
      return `Same Δv, but the burn at periapsis, where the ship is fast, gains ${(gainA / gainB).toFixed(1)}× the energy.`;
    },
  };
};

/** Gravity well: a funnel seen at an angle, with a ship rolling round it on an ellipse. */
SCENES.well = () => {
  const cx = 180, rim = 162, rp = 24, ra = 150, k = 1500, tilt = 0.3;
  const depth = (r) => k / r - k / 170;
  const mu = muFor((rp + ra) / 2, 5.2);
  const o = Orbit.apsides(rp, ra, 0, 1, mu);
  const p = new Path(o, Math.PI, fixed(0, 0));
  const proj = (x, y) => ({ x: cx + x, y: rim + y * tilt - depth(Math.max(14, Math.hypot(x, y))) });
  return {
    dur: o.T,
    still: o.T * 0.45,
    draw(g, t) {
      g.clear();
      for (const r of [16, 22, 30, 42, 60, 85, 120, 165]) {
        const c = g.ctx;
        c.beginPath();
        c.ellipse(cx, H - (rim - depth(r)), r, r * tilt, 0, 0, TAU);
        g.stroke(C.term, 1, null, 0.12 + 0.25 * (16 / r));
      }
      // funnel outline
      const side = [];
      for (let r = 14; r <= 168; r += 2) side.push({ x: cx + r, y: rim - depth(r) });
      g.poly(side, C.term, { alpha: 0.5 });
      g.poly(side.map((q) => ({ x: 2 * cx - q.x, y: q.y })), C.term, { alpha: 0.5 });
      g.body(cx, rim - depth(14) + 4, 11, 'earth');
      // the orbit drawn on the funnel
      const pts = [];
      for (let i = 0; i <= 120; i++) { const q = o.at((i / 120) * TAU - Math.PI); pts.push(proj(q.x, q.y)); }
      g.poly(pts, C.ship, { alpha: 0.5 });
      const s = p.state(t);
      const q = proj(s.rel.x, s.rel.y);
      const v = Math.hypot(s.rel.vx, s.rel.vy);
      const vMax = Math.sqrt(mu * 2 * ra / (rp * (rp + ra)));
      g.dot(q.x, q.y, 3 + 2 * (v / vMax), C.ship);
      g.panel([['Speed', C.dim], [`${'▮'.repeat(Math.max(1, Math.round((v / vMax) * 10)))}`, C.term]]);
      const r = Math.hypot(s.rel.x, s.rel.y);
      const falling = s.rel.x * s.rel.vx + s.rel.y * s.rel.vy < 0;
      if (r < 50) return 'Deep in the well, at periapsis, you move fastest.';
      return falling ? 'Rolling down into the well, you speed up.' : 'Climbing back up the side, you slow down.';
    },
  };
};

/** Geostationary: a lap takes a day, so the satellite stays over one spot. */
SCENES.geo = () => {
  const F = { x: 180, y: 100 }, R = 26, rGeo = 84, rLow = 50;
  const day = 6;
  const tLow = day * (rLow / rGeo) ** 1.5;
  const dur = day * 2;
  return {
    dur,
    still: day * 0.3,
    draw(g, t) {
      g.clear();
      g.circle(F.x, F.y, rGeo, C.ship, { alpha: 0.5 });
      g.circle(F.x, F.y, rLow, C.target, { alpha: 0.35, dash: [2, 4] });
      g.body(F.x, F.y, R, 'earth');
      const th = Math.PI / 2 + (TAU * t) / day;
      // a spot on the ground turning with Earth
      const gx = F.x + R * Math.cos(th), gy = F.y + R * Math.sin(th);
      g.dot(gx, gy, 3, C.ok);
      const sx = F.x + rGeo * Math.cos(th), sy = F.y + rGeo * Math.sin(th);
      g.line(gx, gy, sx, sy, C.ok, { dash: [2, 3], alpha: 0.8 });
      g.ship({ x: sx, y: sy, vx: -Math.sin(th), vy: Math.cos(th) });
      const tl = Math.PI / 2 + (TAU * t) / tLow;
      g.ship({ x: F.x + rLow * Math.cos(tl), y: F.y + rLow * Math.sin(tl), vx: -Math.sin(tl), vy: Math.cos(tl) }, C.target, { size: 4 });
      const hours = ((t / day) * 24) % 24;
      g.panel([[`${Math.floor(t / day) + 1 > 1 ? 'Day 2' : 'Day 1'}, ${String(Math.floor(hours)).padStart(2, '0')}:00`, C.chalk], ['GEO: one lap a day', C.ship], ['lower: laps faster', C.target]]);
      return 'Earth and the GEO satellite both turn once a day, so it hangs over the same spot. The lower one drifts ahead.';
    },
  };
};

/** Relative velocity: drifting past the target, then Match until you fly in formation. */
SCENES.match = () => {
  const T = { x: 222, y: 104 };
  const v0 = { x: 70, y: 8 };
  const tb = 1.6, db = 1.4, dur = tb + db + 2.4;
  const stop = { x: 202, y: 88 };
  const start = { x: stop.x - v0.x * (tb + db / 2), y: stop.y - v0.y * (tb + db / 2) };
  const posAt = (t) => {
    if (t <= tb) return { x: start.x + v0.x * t, y: start.y + v0.y * t, k: 1 };
    const u = Math.min(t - tb, db);
    const k = 1 - u / db;
    const d = u - (u * u) / (2 * db);
    return { x: start.x + v0.x * (tb + d), y: start.y + v0.y * (tb + d), k };
  };
  return {
    dur,
    still: tb + db * 0.45,
    draw(g, t) {
      g.clear();
      g.text('Both orbiting Earth at 7.7 km/s →', W - 10, 20, { color: C.dim, size: 12, align: 'right' });
      g.ship({ x: T.x, y: T.y, vx: 1, vy: 0 }, C.target, { size: 7 });
      const s = posAt(t);
      const rel = { x: v0.x * s.k, y: v0.y * s.k };
      const trail = [];
      for (let u = 0; u <= t; u += 0.05) trail.push(posAt(u));
      g.poly(trail, C.ship, { dash: [2, 3], alpha: 0.5 });
      g.ship({ x: s.x, y: s.y, vx: 1, vy: 0 }, C.ship, { size: 7 });
      if (s.k > 0.02) {
        g.arrow(s.x - 10, s.y - 14, rel.x * 0.55, rel.y * 0.55, C.term, { width: 2 });
        g.text('relative velocity', s.x - 10, s.y - 27, { color: C.term, size: 12 });
      }
      const burning = t > tb && t < tb + db;
      if (burning) g.flame({ x: s.x, y: s.y }, -v0.x / 70.5, -v0.y / 70.5, 1.1);
      const ms = Math.round(70 * s.k);
      g.panel([[`Rel. speed ${ms} m/s`, C.term], [burning ? 'holding Match' : ms ? 'drifting' : 'in formation', burning ? C.ship : C.dim]]);
      if (t < tb) return 'You are both doing 7.7 km/s. What counts is the difference: your relative velocity.';
      if (burning) return 'Hold Match: the engine burns against the relative velocity…';
      return '…until it is zero. Now you drift along together.';
    },
  };
};

/** Closest approach: the game marks where you both will be when you pass nearest. */
SCENES.closest = () => {
  const F = { x: 180, y: 100 };
  const mu = muFor(70, 4);
  const f = fixed(F.x, F.y);
  const oT = Orbit.circle(70, 0, 1, mu);
  const oS = Orbit.apsides(34, 86, 200 * DEG, 1, mu);
  const S = new Path(oS, -0.6, f);
  const horizon = oS.T * 0.9;
  // pick the target's start so that the pass is close but not a hit
  let best = null;
  for (let th = 0; th < TAU; th += 2 * DEG) {
    const Tg = new Path(oT, th, f);
    let min = Infinity, at = 0;
    for (let t = 0.8; t < horizon; t += 0.02) {
      const a = S.state(t), b = Tg.state(t);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < min) { min = d; at = t; }
    }
    const score = Math.abs(min - 9) + (at < 1.6 ? 50 : 0);
    if (!best || score < best.score) best = { score, Tg, min, at };
  }
  const { Tg, at } = best;
  const dur = at + 1.6 + 1.2;
  return {
    dur,
    still: 0.4,
    draw(g, t) {
      g.clear();
      g.body(F.x, F.y, 12, 'earth');
      g.conic(oT, F, C.target, { alpha: 0.55 });
      g.conic(oS, F, C.ship, { alpha: 0.7 });
      const a = S.state(at), b = Tg.state(at);
      if (t < at + 0.2) {
        g.ship(a, C.ship, { hollow: true, alpha: 0.9 });
        g.ship(b, C.target, { hollow: true, alpha: 0.9 });
        g.line(a.x, a.y, b.x, b.y, C.chalk, { dash: [3, 2] });
        g.text('closest approach', (a.x + b.x) / 2 + 10, (a.y + b.y) / 2 + 10, { color: C.chalk, size: 12 });
      }
      g.ring(a.x, a.y, (t - at) / 0.8, C.chalk);
      g.ship(S.state(t), C.ship);
      g.ship(Tg.state(t), C.target);
      if (t < at - 0.05) return 'The game looks ahead and marks where you both will be when you pass closest.';
      return 'Right on time. Shorten that dashed line with small burns and the orbits bring you together.';
    },
  };
};

/** Phasing: a slightly lower, quicker orbit gains on the target every lap. */
SCENES.phasing = () => {
  const F = { x: 180, y: 100 }, r = 72, gap = 60 * DEG, laps = 3;
  const mu = muFor(r, 3);
  const f = fixed(F.x, F.y);
  const o0 = Orbit.circle(r, 270 * DEG, 1, mu);
  const p = new Path(o0, 0, f);
  const tgt = new Path(o0, gap, f);
  p.coast(0.5);
  const tb1 = p.t;
  // a period that closes the gap in exactly `laps` laps
  const ratio = 1 - gap / (laps * TAU);
  const a2 = r * ratio ** (2 / 3);
  const rp = 2 * a2 - r;
  const va = Math.sqrt(mu * 2 * rp / (r * (r + rp)));
  const vc = Math.sqrt(mu / r);
  p.burn('retrograde', vc - va, 0.02, 2);
  const T2 = p.leg.o.T;
  p.coast(laps * T2 - 0.02);
  const tb2 = p.t;
  p.burn('prograde', vc - va, 0.02, 2);
  const tEnd = p.t + 0.25 * o0.T;
  const clock = clockFor(p, tEnd, { rate: 1.3, burnRate: 0.06, hold: 1.4 });
  return {
    dur: clock.total,
    still: clock.realAt(tb1 + 1.5 * T2),
    draw(g, T) {
      const t = clock.at(T);
      g.clear();
      g.body(F.x, F.y, 12, 'earth');
      const L = p.legAt(t);
      const low = t > tb1 && t < tb2;
      g.conic(o0, F, C.target, { alpha: 0.5 });
      if (low) g.conic(L.o, F, C.ship, { width: 1.4 });
      const s = shipWithBurn(g, p, t);
      const q = tgt.state(t);
      g.ship(q, C.target);
      const ph = wrapPi(Math.atan2(q.y - F.y, q.x - F.x) - Math.atan2(s.y - F.y, s.x - F.x));
      if (ph > 1 * DEG) g.arc(F.x, F.y, r - 16, Math.atan2(s.y - F.y, s.x - F.x), Math.atan2(s.y - F.y, s.x - F.x) + ph, C.term, { width: 2, alpha: 0.7 });
      const lap = low ? Math.min(laps, Math.floor((t - tb1) / T2 + 1e-6)) : t >= tb2 ? laps : 0;
      g.panel([[`Gap ${Math.max(0, Math.round(ph / DEG))}°`, C.term], [`Laps ${lap} of ${laps}`, C.dim]]);
      if (t < tb1 + 0.05) return 'The target is 60° ahead in the same orbit. A small retrograde burn…';
      if (low) return '…drops you into a slightly lower, quicker orbit. Every lap you gain a little.';
      return 'Gap closed. Burn prograde to rejoin the orbit, right next to the target.';
    },
  };
};

/** Bi-elliptic reversal: climb far out, turn round where you are slow, fall back the other way. */
SCENES.bielliptic = () => {
  const F = { x: 160, y: 100 }, r0 = 22, rb = 160;
  const mu = muFor(r0, 1.3);
  const f = fixed(F.x, F.y);
  const realK = 6771 / r0;
  const realMu = 398600;
  const p = new Path(Orbit.circle(r0, 180 * DEG, 1, mu), -100 * DEG, f);
  p.coastTo('pe');
  const tb1 = p.t;
  const vc = Math.sqrt(mu / r0), vp = Math.sqrt(mu * 2 * rb / (r0 * (r0 + rb)));
  p.burn('prograde', vp - vc, 0.04, 4);
  p.coastTo('ap');
  const tb2 = p.t;
  const va = Math.sqrt(mu * 2 * r0 / (rb * (r0 + rb)));
  p.burn('retrograde', 2 * va, 0.25, 20);
  p.coastTo('pe');
  const tb3 = p.t;
  p.burn('retrograde', vp - vc, 0.04, 4);
  const tEnd = p.t + 1.2;
  const tgt = new Path(Orbit.circle(r0, 180 * DEG, -1, mu), 0.3, f);
  const clock = new Clock().hold(0.3).to(tb1).run(0.04, 0.2).to(tb2 - 1.2, 1.8).to(tb2).run(0.25, 0.25).to(tb3 - 1.2, 1.8).to(tb3).run(0.04, 0.2).to(tEnd).hold(1.2);
  const speed = (s) => Math.hypot(s.rel.vx, s.rel.vy) * Math.sqrt(realMu / (mu * realK));
  return {
    dur: clock.total,
    still: clock.realAt(tb2 + 1.2),
    draw(g, T) {
      const t = clock.at(T);
      g.clear();
      g.body(F.x, F.y, 10, 'earth');
      g.conic(Orbit.circle(r0, 0, 1, mu), F, C.target, { alpha: 0.35, dash: [2, 3] });
      const L = p.legAt(t);
      if (t > tb1 && t < tb3 + 0.05) g.conic(L.o, F, C.ship, { width: 1.3, alpha: 0.8 });
      g.ship(tgt.state(t), C.target, { size: 4 });
      const s = shipWithBurn(g, p, t);
      g.panel([[`Speed ${speed(s).toFixed(1)} km/s`, C.term], [L.o.dir > 0 ? 'orbiting anticlockwise' : 'orbiting clockwise, like the target', L.o.dir > 0 ? C.dim : C.ok]]);
      if (t < tb1) return 'The target orbits the other way. Turning round down here would cost over 15 km/s.';
      if (t < tb2 - 0.8) return 'So climb far out instead, where you barely move.';
      if (t < tb2 + 0.4) return 'At apoapsis you are slow, so turning round is cheap.';
      if (t < tb3) return 'Fall back down, now going the other way…';
      return '…and brake at periapsis into the target\'s orbit. About 8 km/s in all instead of 15.';
    },
  };
};

// ---------------------------------------------------------------- public

const built = new Map();

/** The animation with this id: { dur, still, draw(ctx, t) -> caption }. */
export function termAnim(id) {
  if (!SCENES[id]) return null;
  if (!built.has(id)) {
    const s = SCENES[id]();
    built.set(id, {
      dur: s.dur,
      still: Math.min(s.still ?? s.dur * 0.6, s.dur),
      draw(ctx, t) { return s.draw(new Sketch(ctx), t); },
    });
  }
  return built.get(id);
}

export const ANIM_IDS = Object.keys(SCENES);
