// Two-body (Kepler) mechanics in 2D.
// Units throughout the game: km, s, km/s, km^3/s^2.

const TWO_PI = Math.PI * 2;

/** Stumpff functions C(z), S(z) written into out[0], out[1]. */
function stumpff(z, out) {
  if (z > 1e-3) {
    const s = Math.sqrt(z);
    out[0] = (1 - Math.cos(s)) / z;
    out[1] = (s - Math.sin(s)) / (s * s * s);
  } else if (z < -1e-3) {
    const s = Math.sqrt(-z);
    // cosh/sinh overflow to Infinity for huge s; the solver treats that as "too far".
    out[0] = (Math.cosh(s) - 1) / -z;
    out[1] = (Math.sinh(s) - s) / (s * s * s);
  } else {
    const z2 = z * z;
    out[0] = 1 / 2 - z / 24 + z2 / 720 - (z2 * z) / 40320;
    out[1] = 1 / 6 - z / 120 + z2 / 5040 - (z2 * z) / 362880;
  }
  return out;
}

const cs = [0, 0];

/**
 * Propagate a Kepler orbit by dt using universal variables (Curtis, Alg. 3.3/3.4).
 * Works for elliptic, parabolic and hyperbolic orbits and negative dt.
 * Writes the result into `out` ({x, y, vx, vy}) and returns it.
 */
export function kepler(x, y, vx, vy, mu, dt, out = { x: 0, y: 0, vx: 0, vy: 0 }) {
  if (dt === 0) {
    out.x = x; out.y = y; out.vx = vx; out.vy = vy;
    return out;
  }
  const r0 = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const rdotv = x * vx + y * vy;
  const sqmu = Math.sqrt(mu);
  const alpha = 2 / r0 - v2 / mu; // 1/a

  // Whole revolutions of a closed orbit change nothing: fold dt into [-T/2, T/2].
  if (alpha > 0) {
    const T = TWO_PI / Math.sqrt(mu * alpha * alpha * alpha);
    if (Math.abs(dt) > T / 2) dt -= T * Math.round(dt / T);
  }

  const A = rdotv / sqmu;
  const B = 1 - alpha * r0;
  const target = sqmu * dt;

  // F(chi) = A chi^2 C + B chi^3 S + r0 chi - sqrt(mu) dt, dF/dchi = r(chi) > 0.
  // Monotonic, so a bracketed Newton (rtsafe) always converges.
  let lo, hi;
  let chi = alpha > 0 ? sqmu * dt * alpha : dt * sqmu / r0;
  if (alpha < 0) {
    // Vallado's hyperbolic initial guess
    const a = 1 / alpha;
    const sgn = dt > 0 ? 1 : -1;
    const arg = (-2 * mu * alpha * dt) / (rdotv + sgn * Math.sqrt(-mu * a) * (1 - r0 * alpha));
    const g = sgn * Math.sqrt(-a) * Math.log(arg);
    if (Number.isFinite(g) && g * sgn > 0) chi = g;
  }

  const evalF = (c) => {
    const c2 = c * c;
    stumpff(alpha * c2, cs);
    return A * c2 * cs[0] + B * c2 * c * cs[1] + r0 * c - target;
  };

  if (dt > 0) {
    lo = 0;
    hi = Math.max(chi, 1e-9);
    let guard = 0;
    while (!(evalF(hi) > 0) && guard++ < 200) {
      if (Number.isNaN(evalF(hi))) break;
      lo = hi;
      hi *= 2;
    }
  } else {
    hi = 0;
    lo = Math.min(chi, -1e-9);
    let guard = 0;
    while (!(evalF(lo) < 0) && guard++ < 200) {
      if (Number.isNaN(evalF(lo))) break;
      hi = lo;
      lo *= 2;
    }
  }
  if (!(chi > lo && chi < hi)) chi = 0.5 * (lo + hi);

  for (let i = 0; i < 100; i++) {
    const c2 = chi * chi;
    const z = alpha * c2;
    stumpff(z, cs);
    const C = cs[0], S = cs[1];
    const F = A * c2 * C + B * c2 * chi * S + r0 * chi - target;
    const dF = A * chi * (1 - z * S) + B * c2 * C + r0;
    if (F < 0) lo = chi; else hi = chi;
    let next = chi - F / dF;
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    const step = Math.abs(next - chi);
    chi = next;
    if (step <= 1e-13 * (1 + Math.abs(chi)) || hi - lo <= 1e-14 * (1 + Math.abs(chi))) break;
  }

  const c2 = chi * chi;
  const z = alpha * c2;
  stumpff(z, cs);
  const C = cs[0], S = cs[1];
  const f = 1 - (c2 / r0) * C;
  const g = dt - (c2 * chi * S) / sqmu;
  const nx = f * x + g * vx;
  const ny = f * y + g * vy;
  const r = Math.hypot(nx, ny);
  const fdot = (sqmu / (r * r0)) * (alpha * c2 * chi * S - chi);
  const gdot = 1 - (c2 / r) * C;
  out.x = nx;
  out.y = ny;
  out.vx = fdot * x + gdot * vx;
  out.vy = fdot * y + gdot * vy;
  return out;
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}

/** Eccentricities below this are treated as circular (no Ap/Pe markers). */
export const CIRCULAR_E = 1e-5;

/**
 * Orbital elements of a 2D state around a body with gravitational parameter mu.
 * dir: +1 counter-clockwise, -1 clockwise. nu (true anomaly) is measured in the
 * direction of motion, so it always increases along the orbit.
 */
export function elements(x, y, vx, vy, mu) {
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const rdotv = x * vx + y * vy;
  const h = x * vy - y * vx;
  const dir = h >= 0 ? 1 : -1;
  const k = v2 - mu / r;
  const ex = (k * x - rdotv * vx) / mu;
  const ey = (k * y - rdotv * vy) / mu;
  const e = Math.hypot(ex, ey);
  const energy = v2 / 2 - mu / r;
  const a = energy === 0 ? Infinity : -mu / (2 * energy);
  const p = (h * h) / mu;
  const posAngle = Math.atan2(y, x);
  const argPe = e > 1e-12 ? Math.atan2(ey, ex) : posAngle;
  const nu = wrapAngle(dir * (posAngle - argPe));
  const rp = p / (1 + e);
  const ra = e < 1 ? p / (1 - e) : Infinity;
  const period = e < 1 ? TWO_PI * Math.sqrt((a * a * a) / mu) : Infinity;
  return { mu, a, e, p, h, dir, argPe, nu, rp, ra, period, r, speed: Math.sqrt(v2), energy, circular: e < CIRCULAR_E };
}

/** Radius at true anomaly nu. */
export function radiusAt(el, nu) {
  return el.p / (1 + el.e * Math.cos(nu));
}

/** Point (relative to the body) at true anomaly nu. */
export function pointAt(el, nu, out = { x: 0, y: 0 }) {
  const r = radiusAt(el, nu);
  const th = el.argPe + el.dir * nu;
  out.x = r * Math.cos(th);
  out.y = r * Math.sin(th);
  return out;
}

/** Time since periapsis for true anomaly nu (negative before periapsis). */
export function timeSincePeriapsis(el, nu) {
  const { e, mu } = el;
  if (e < 1) {
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    const M = E - e * Math.sin(E);
    return M / Math.sqrt(mu / (el.a * el.a * el.a));
  }
  if (e > 1) {
    const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    const M = e * Math.sinh(F) - F;
    const na = -el.a;
    return M / Math.sqrt(mu / (na * na * na));
  }
  // parabolic (Barker)
  const D = Math.tan(nu / 2);
  return 0.5 * Math.sqrt((el.p * el.p * el.p) / mu) * (D + (D * D * D) / 3);
}

/** Seconds until the next periapsis (Infinity if it's already behind a hyperbolic orbit). */
export function timeToPeriapsis(el) {
  const t = timeSincePeriapsis(el, el.nu);
  if (el.e < 1) {
    let dt = -t;
    if (dt <= 0) dt += el.period;
    return dt;
  }
  return t < 0 ? -t : Infinity;
}

/** Seconds until the next apoapsis (Infinity for open orbits). */
export function timeToApoapsis(el) {
  if (el.e >= 1) return Infinity;
  const t = timeSincePeriapsis(el, el.nu);
  let dt = el.period / 2 - t;
  dt %= el.period;
  if (dt <= 0) dt += el.period;
  return dt;
}

/** Circular orbit speed at radius r. */
export function circularSpeed(mu, r) {
  return Math.sqrt(mu / r);
}

/**
 * State vector {x, y, vx, vy} for an orbit given periapsis/apoapsis radii,
 * argument of periapsis, true anomaly and direction.
 */
export function stateFromOrbit(mu, rp, ra, argPe, nu, dir = 1) {
  const e = (ra - rp) / (ra + rp);
  const p = rp * (1 + e);
  const r = p / (1 + e * Math.cos(nu));
  const th = argPe + dir * nu;
  const sqmup = Math.sqrt(mu / p);
  // perifocal velocity: vr = sqrt(mu/p) e sin nu, vt = sqrt(mu/p)(1 + e cos nu)
  const vr = sqmup * e * Math.sin(nu);
  const vt = sqmup * (1 + e * Math.cos(nu));
  const c = Math.cos(th), s = Math.sin(th);
  return {
    x: r * c,
    y: r * s,
    vx: vr * c - dir * vt * s,
    vy: vr * s + dir * vt * c,
  };
}
