// Deep-space backdrop: a navy field with soft nebula clouds, a faint galactic
// band and layered stars, pre-rendered to an offscreen canvas on resize. Each
// frame blits that layer and adds a gentle twinkle to a few bright stars.
// Kept dim on purpose so orbits and chalk labels stay the brightest things.

const FIELD = '#0f1f36';
const DEEP = '#081326';

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// Star tints: mostly chalk-white, some blue-white, a few warm.
const TINTS = [
  [235, 230, 216], [235, 230, 216], [235, 230, 216],
  [200, 218, 255], [200, 218, 255],
  [255, 214, 170],
];

export class Backdrop {
  constructor() {
    this.layer = null;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.twinklers = [];
  }

  resize(w, h, dpr) {
    if (w === this.w && h === this.h && dpr === this.dpr && this.layer) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.paint(ctx, w, h);
    this.layer = c;
  }

  paint(ctx, w, h) {
    const rnd = rng(7);
    const diag = Math.hypot(w, h);

    // Base: field colour, a touch darker toward the corners.
    ctx.fillStyle = FIELD;
    ctx.fillRect(0, 0, w, h);
    const vig = ctx.createRadialGradient(w / 2, h / 2, diag * 0.15, w / 2, h / 2, diag * 0.62);
    vig.addColorStop(0, 'rgba(8,19,38,0)');
    vig.addColorStop(1, DEEP);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    // Galactic band: a diagonal haze built from many soft blobs along a line.
    const ang = -0.52;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const vx = -uy, vy = ux;
    const cx = w * 0.5, cy = h * 0.55;
    const bandW = Math.max(w, h) * 0.13;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 90; i++) {
      const along = (rnd() - 0.5) * diag * 1.1;
      const across = (rnd() + rnd() + rnd() - 1.5) * bandW * 0.8;
      const x = cx + ux * along + vx * across;
      const y = cy + uy * along + vy * across;
      const r = bandW * (0.35 + rnd() * 0.7);
      const warm = rnd() < 0.3;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, warm ? 'rgba(120,110,150,0.030)' : 'rgba(90,120,180,0.034)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Nebula clouds: a few large, very faint coloured washes.
    const clouds = [
      [0.18, 0.22, 0.42, '70,60,140', 0.07],
      [0.84, 0.78, 0.46, '40,110,150', 0.06],
      [0.72, 0.16, 0.30, '130,60,110', 0.045],
      [0.10, 0.86, 0.34, '50,90,160', 0.05],
    ];
    for (const [fx, fy, fr, rgb, a] of clouds) {
      const x = fx * w, y = fy * h, r = fr * diag;
      for (let k = 0; k < 5; k++) {
        const ox = x + (rnd() - 0.5) * r * 0.6;
        const oy = y + (rnd() - 0.5) * r * 0.6;
        const rr = r * (0.45 + rnd() * 0.55);
        const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, rr);
        g.addColorStop(0, `rgba(${rgb},${a})`);
        g.addColorStop(0.5, `rgba(${rgb},${a * 0.4})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(ox - rr, oy - rr, rr * 2, rr * 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // Stars: density scales with area; extra concentration in the band.
    const n = Math.round((w * h) / 1700);
    this.twinklers = [];
    for (let i = 0; i < n; i++) {
      let x, y;
      if (rnd() < 0.35) {
        const along = (rnd() - 0.5) * diag * 1.1;
        const across = (rnd() + rnd() - 1) * bandW;
        x = cx + ux * along + vx * across;
        y = cy + uy * along + vy * across;
        if (x < 0 || y < 0 || x > w || y > h) continue;
      } else {
        x = rnd() * w;
        y = rnd() * h;
      }
      const m = rnd() ** 4; // mostly faint
      const [r, g, b] = TINTS[Math.floor(rnd() * TINTS.length)];
      const a = 0.12 + 0.55 * m;
      const s = m > 0.55 ? 1.5 : m > 0.2 ? 1.1 : 0.8;
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      ctx.fillRect(x, y, s, s);
      if (m > 0.6) {
        // soft glow around the brightest ones
        const gr = 3 + m * 4;
        const gl = ctx.createRadialGradient(x + s / 2, y + s / 2, 0, x + s / 2, y + s / 2, gr);
        gl.addColorStop(0, `rgba(${r},${g},${b},${0.12 * m})`);
        gl.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = gl;
        ctx.fillRect(x - gr, y - gr, gr * 2, gr * 2);
        if (this.twinklers.length < 48) {
          this.twinklers.push({ x, y, s, r, g, b, a, ph: rnd() * Math.PI * 2, f: 0.4 + rnd() * 0.9 });
        }
      }
    }
  }

  /** Paint the backdrop; ctx is already in CSS-pixel space. */
  draw(ctx, w, h, dpr, timeSec) {
    this.resize(w, h, dpr);
    ctx.drawImage(this.layer, 0, 0, w, h);
    for (const t of this.twinklers) {
      const k = Math.sin(timeSec * t.f + t.ph);
      if (k <= 0) continue;
      ctx.fillStyle = `rgba(${t.r},${t.g},${t.b},${t.a * 0.6 * k})`;
      ctx.fillRect(t.x - 0.3, t.y - 0.3, t.s + 0.6, t.s + 0.6);
    }
  }
}
