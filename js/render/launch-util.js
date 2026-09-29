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

// ---------------------------------------------------------------- noise and soft volumes

/** Smooth value noise on a hashed lattice, in [0, 1]. */
export function valueNoise(seed) {
  const r = rng(seed);
  const perm = new Uint8Array(512), vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const a = vals[perm[X + perm[Y]]], b = vals[perm[X + 1 + perm[Y]]];
    const c = vals[perm[X + perm[Y + 1]]], d = vals[perm[X + 1 + perm[Y + 1]]];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Octaves of noise summed, in about [0, 1]. `billow` folds each octave for puffy, rolling detail. */
export function fbm(noise, x, y, octaves = 5, billow = false) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    let n = noise(x * f + i * 17.3, y * f + i * 31.7);
    if (billow) n = Math.abs(n * 2 - 1);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/**
 * Soft, noisy volumes (smoke, vapour, cloud), rendered once from a density field
 * and lit several ways. `shape(u, v)` gives the base density for u, v in -1..1;
 * noise warps its outline and breaks it into rolling detail. Each look is
 * { hi, lo, light: { x, y }, ambient }: light shines from `light` (screen
 * directions, y down) and is absorbed by the density it passes through, so the
 * far side of a puff falls into its own shadow. Returns one canvas per look,
 * all sharing the same silhouette so they can be blended over each other.
 */
export function volumeSprites({ w, h, seed, shape, looks, detail = [3, 3], warp = 0.35, billow = true, absorb = 0.55 }) {
  const noise = valueNoise(seed);
  const dens = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const v = ((j + 0.5) / h) * 2 - 1;
    for (let i = 0; i < w; i++) {
      const u = ((i + 0.5) / w) * 2 - 1;
      const wu = u + warp * (fbm(noise, u * 1.7 + 5.2, v * 1.7 + 1.3, 3) - 0.5) * 2;
      const wv = v + warp * (fbm(noise, u * 1.7 + 9.7, v * 1.7 + 4.1, 3) - 0.5) * 2;
      const body = shape(wu, wv);
      if (body <= 0) continue;
      const n = fbm(noise, u * detail[0] + 2.1, v * detail[1] + 7.9, 5, billow);
      const d = body * (0.25 + 1.5 * n) - 0.1;
      dens[j * w + i] = d <= 0 ? 0 : d >= 1 ? 1 : d;
    }
  }
  const step = Math.max(w, h) / 30;
  return looks.map((look) => {
    const c = makeCanvas(w, h), x = c.getContext('2d');
    const img = x.createImageData(w, h), px = img.data;
    const ll = Math.hypot(look.light.x, look.light.y) || 1;
    const lx = (look.light.x / ll) * step, ly = (look.light.y / ll) * step;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i, d = dens[k];
        if (d <= 0.002) continue;
        // march toward the light, adding up the smoke in the way
        let sum = 0;
        for (let s = 1; s <= 7; s++) {
          const si = Math.round(i + lx * s), sj = Math.round(j + ly * s);
          if (si < 0 || sj < 0 || si >= w || sj >= h) break;
          sum += dens[sj * w + si];
        }
        const lit = look.ambient + (1 - look.ambient) * Math.exp(-sum * absorb);
        const o = k * 4;
        px[o] = look.lo[0] + (look.hi[0] - look.lo[0]) * lit;
        px[o + 1] = look.lo[1] + (look.hi[1] - look.lo[1]) * lit;
        px[o + 2] = look.lo[2] + (look.hi[2] - look.lo[2]) * lit;
        px[o + 3] = 255 * Math.pow(d, 0.8);
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  });
}
