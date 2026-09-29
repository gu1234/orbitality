// Shared helpers for the launch cinematic: easing, colour, seeded randomness,
// smooth keyframed curves and small canvas utilities.

export const TWO_PI = Math.PI * 2;

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
export const ease = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };
export const lerp = (a, b, k) => a + (b - a) * k;
export const mixc = (c1, c2, k) => [lerp(c1[0], c2[0], k), lerp(c1[1], c2[1], k), lerp(c1[2], c2[2], k)];
export const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a < 0 ? 0 : a > 1 ? 1 : a})`;
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth monotone curve through [x, y] keys (Fritsch–Carlson), flat at both ends. */
export function curve(keys) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** Cheap smooth noise, roughly in [-1, 1]. */
export const wobble = (t, s = 0) => Math.sin(t * 13.1 + s) * 0.5 + Math.sin(t * 29.7 + s * 2.3) * 0.3 + Math.sin(t * 57.3 + s * 4.1) * 0.2;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** A soft elliptical glow (no hard edges): centre (x, y), half-width w, half-length l, colour stops [at, rgb, alpha]. */
export function softEllipse(ctx, x, y, w, l, stops) {
  if (w <= 0 || l <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / l, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, l);
  for (const [at, col, a] of stops) g.addColorStop(at, rgba(col, a));
  ctx.fillStyle = g;
  ctx.fillRect(-l, -l, 2 * l, 2 * l);
  ctx.restore();
}

/** Rotation that turns a canvas's -y axis to point along screen vector v. */
export const upAngle = (v) => Math.atan2(v.x, -v.y);
