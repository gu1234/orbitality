// Launch cinematic: a short side-on animation of the rocket climbing to orbit,
// with stage separation and fairing jettison, played before the early levels.
// It draws on its own full-screen canvas above the game and can be skipped.

const T = {
  ignite: 0.3,
  liftoff: 0.7,
  meco: 3.0, // stage 1 engine cutoff and separation
  s2: 3.45, // stage 2 ignition
  fairing: 4.3,
  seco: 6.3, // stage 2 engine cutoff
  deploy: 6.65, // payload separation
  end: 7.7,
};
const FADE = 0.7;
const SHIP = '#ffb547';

const CAPTIONS = [
  [T.liftoff, 'Liftoff'],
  [T.meco, 'Stage 1 separation'],
  [T.s2, 'Stage 2 ignition'],
  [T.fairing, 'Fairing separation'],
  [T.seco, 'Engine cutoff'],
  [T.deploy, 'In orbit'],
];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, k) => a + (b - a) * k;
const mix = (c1, c2, k) => `rgb(${c1.map((v, i) => Math.round(lerp(v, c2[i], k))).join(',')})`;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mission clock, altitude and speed shown on the telemetry line (loosely realistic). */
function telemetry(t, altKm) {
  const m = Math.max(0, t - T.liftoff) * 80; // mission seconds
  const k = Math.min(1, m / 480);
  return { m, alt: altKm * k ** 1.5, v: 7.67 * Math.min(1, m / 510) ** 1.2 };
}

export class LaunchCinematic {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.playing = false;
    this.raf = 0;
    this.done = null;
    const r = rng(7);
    this.stars = Array.from({ length: 170 }, () => ({ x: r(), y: r(), s: 0.4 + r() * 1.3, a: 0.3 + r() * 0.7 }));
    this.cloudSeed = Array.from({ length: 9 }, () => ({ x: r() * 2 - 1, alt: 0.35 + r() * 1.5, w: 0.5 + r() * 0.9, puffs: 3 + Math.floor(r() * 3) }));
    this.onResize = () => { this.resize(); if (!this.playing && !this.canvas.classList.contains('hidden')) this.draw(); };
    this.onPointer = (e) => { e.preventDefault(); this.skip(); };
    this.onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // swallow the key so it neither pauses the game nor lands on the briefing behind us
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) this.skip();
    };
    canvas.addEventListener('pointerdown', this.onPointer);
  }

  static wanted() {
    return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  /** Plays the launch; resolves when it has finished or been skipped and faded away. */
  play({ altKm = 400 } = {}) {
    this.stop();
    this.altKm = altKm;
    this.reset();
    this.resize();
    const c = this.canvas;
    c.style.transition = 'none';
    c.style.opacity = '1';
    c.classList.remove('hidden');
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey, true);
    this.playing = true;
    this.fading = false;
    return new Promise((resolve) => {
      this.done = resolve;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        this.advance(dt);
        this.draw();
        if (this.t >= T.end) this.skip();
        if (this.playing) this.raf = requestAnimationFrame(tick);
      };
      this.draw();
      this.raf = requestAnimationFrame(tick);
    });
  }

  /** Fades out and resolves the play() promise. */
  skip() {
    if (!this.playing || this.fading) return;
    this.fading = true;
    window.removeEventListener('keydown', this.onKey, true);
    const c = this.canvas;
    c.style.transition = `opacity ${FADE}s ease`;
    c.style.opacity = '0';
    this.fadeTimer = setTimeout(() => this.finish(), FADE * 1000);
  }

  /** Hides at once; used when the player leaves before the launch is over. */
  stop() {
    if (this.playing) this.finish();
  }

  finish() {
    clearTimeout(this.fadeTimer);
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    this.canvas.classList.add('hidden');
    this.playing = false;
    this.fading = false;
    const done = this.done;
    this.done = null;
    done?.();
  }

  /** Test hook: show the frame at time t without playing. */
  seek(t, { altKm = 400 } = {}) {
    this.stop();
    this.altKm = altKm;
    this.reset();
    this.resize();
    this.canvas.style.transition = 'none';
    this.canvas.style.opacity = '1';
    this.canvas.classList.remove('hidden');
    while (this.t < t) this.advance(Math.min(1 / 60, t - this.t + 1e-9));
    this.draw();
  }

  // ------------------------------------------------------------------ state

  reset() {
    this.t = 0;
    this.altPx = 0; // how far the rocket has climbed, in screen pixels at launch scale
    this.xPx = 0; // how far it has flown downrange
    this.vel = 0;
    this.parts = []; // smoke and exhaust, in world pixels (x downrange, y up from the pad)
    this.rand = rng(11);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.W = w;
    this.H = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  pitch(t) {
    // gravity turn: straight up off the pad, then tipping over toward the horizon
    return (smooth((t - 1.4) / 5.2) * 78 + smooth((t - T.deploy) / 1) * 10) * (Math.PI / 180);
  }

  /** Screen geometry at time t. */
  frameAt(t) {
    const { W, H } = this;
    const L = Math.min(0.4 * H, 0.6 * W) * lerp(1, 0.82, smooth((t - T.meco) / 3.5));
    const u = L / 104;
    const u0 = Math.min(0.4 * H, 0.6 * W) / 104;
    const padY = H * 0.8;
    const com0 = padY - 50 * u0;
    const rise = com0 - lerp(com0, H * 0.46, smooth((t - T.liftoff) / 2.2));
    const shake = t > T.ignite && t < T.meco ? (t < 1.6 ? 2.2 : t > 1.9 && t < 2.5 ? 1.4 : 0.6) : 0;
    const sx = shake ? Math.sin(t * 91) * shake : 0, sy = shake ? Math.cos(t * 77) * shake : 0;
    const drift = smooth((t - T.fairing) / 3) * W * 0.06; // ease the rocket right of centre as it levels out
    return {
      u,
      cx: W / 2 - drift + sx,
      cy: com0 - rise + sy,
      groundY: padY + this.altPx - rise + sy,
      pitch: this.pitch(t),
      space: smooth((t - 0.9) / 3.2),
    };
  }

  advance(dt) {
    this.t += dt;
    const t = this.t;
    if (t > T.liftoff) {
      const a = t < T.meco ? this.H * 0.7 : t < T.s2 ? 0 : t < T.seco ? this.H * 0.5 : 0;
      this.vel += a * dt;
      const p = this.pitch(t);
      this.altPx += this.vel * Math.cos(p) * dt;
      this.xPx += this.vel * Math.sin(p) * dt;
    }
    // smoke: a billowing cloud at the pad, then a thinning trail until the air runs out
    const f = this.frameAt(t);
    const r = this.rand;
    const firing = (t > T.ignite && t < T.meco) || (t > T.s2 && t < T.seco);
    if (firing && f.space < 0.95 && this.parts.length < 260) {
      const n = t < T.liftoff + 0.6 ? 5 : 2;
      const e = this.nozzle(f, t < T.meco ? 4 : -57);
      const wx = e.x - this.W / 2 + this.xPx, wy = f.groundY - e.y;
      for (let i = 0; i < n; i++) {
        const onPad = wy < 30 * f.u;
        const spread = onPad ? (r() - 0.5) * 2 * this.H * 0.5 : (r() - 0.5) * 20;
        this.parts.push({
          x: wx + (r() - 0.5) * 6 * f.u,
          y: Math.max(0, wy - r() * 4 * f.u),
          vx: spread,
          vy: onPad ? r() * 40 : -r() * 10,
          r: (onPad ? 7 : 4 + f.space * 2) * f.u * (0.7 + r() * 0.6),
          life: 0,
          max: onPad ? 2.6 + r() * 1.2 : 1.4 + r(),
          a: (1 - f.space) * (onPad ? 0.85 : 0.6),
        });
      }
    }
    for (const p of this.parts) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.4 * dt;
      p.r += dt * 9 * f.u;
    }
    this.parts = this.parts.filter((p) => p.life < p.max);
  }

  /** Screen position of a nozzle exit at local height y. */
  nozzle(f, y) {
    const dy = (y + 50) * f.u; // local offset from the centre of mass
    return { x: f.cx - Math.sin(f.pitch) * dy, y: f.cy + Math.cos(f.pitch) * dy };
  }

  // ------------------------------------------------------------------ drawing

  draw() {
    const { ctx, t } = this;
    const f = this.frameAt(t);
    this.drawSky(f);
    if (t < 3.3) this.drawGround(f);
    else this.drawEarth(f);
    this.drawSmoke(f, false);
    this.drawClouds(f);
    this.drawDebris(f);
    this.drawRocket(f);
    this.drawSmoke(f, true);
    this.drawText(f);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawSky(f) {
    const { ctx, W, H } = this;
    const k = f.space;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix([74, 128, 190], [5, 12, 24], k));
    g.addColorStop(0.7, mix([150, 190, 225], [10, 22, 40], k));
    g.addColorStop(1, mix([214, 214, 200], [15, 31, 54], k));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (k > 0.3) {
      const a = smooth((k - 0.3) / 0.6);
      ctx.fillStyle = '#ebe6d8';
      for (const s of this.stars) {
        const x = ((s.x * W - this.xPx * 0.004) % W + W) % W;
        ctx.globalAlpha = a * s.a;
        ctx.fillRect(x, s.y * H, s.s, s.s);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawGround(f) {
    const { ctx, W, H } = this;
    const gy = f.groundY;
    if (gy > H + 200 * f.u) return;
    const ox = W / 2 - this.xPx;
    const u = f.u;
    // distant hills, then the flat range around the pad
    ctx.fillStyle = '#4c6a74';
    ctx.beginPath();
    ctx.moveTo(0, gy);
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, gy - 10 * u - Math.sin((x - ox) * 0.011) * 4 * u - Math.sin((x - ox) * 0.031) * 2 * u);
    ctx.lineTo(W, gy);
    ctx.fill();
    const g = ctx.createLinearGradient(0, gy, 0, gy + H * 0.3);
    g.addColorStop(0, '#3b5a45');
    g.addColorStop(1, '#1d3024');
    ctx.fillStyle = g;
    ctx.fillRect(0, gy, W, Math.max(0, H - gy + 10));
    // pad and service tower
    ctx.fillStyle = '#8a8e8c';
    ctx.fillRect(ox - 22 * u, gy - 3 * u, 44 * u, 3 * u);
    const tx = ox - 17 * u, top = gy - 112 * u;
    ctx.strokeStyle = '#b44a36';
    ctx.lineWidth = Math.max(1, 0.8 * u);
    ctx.strokeRect(tx - 4 * u, top, 8 * u, gy - 3 * u - top);
    ctx.beginPath();
    for (let y = gy - 3 * u; y > top + 4 * u; y -= 8 * u) {
      ctx.moveTo(tx - 4 * u, y);
      ctx.lineTo(tx + 4 * u, y - 8 * u);
      ctx.moveTo(tx + 4 * u, y);
      ctx.lineTo(tx - 4 * u, y - 8 * u);
    }
    // access arms swing back at liftoff
    const swing = smooth((this.t - 0.1) / 0.5);
    for (const y of [top + 14 * u, top + 50 * u]) {
      ctx.moveTo(tx + 4 * u, y);
      ctx.lineTo(tx + 4 * u + (1 - swing) * 8 * u, y - swing * 6 * u);
    }
    ctx.stroke();
  }

  drawEarth(f) {
    const { ctx, W, H, t } = this;
    const k = smooth((t - 3.3) / 3.4);
    const R = Math.max(W, H) * lerp(7, 1.15, k);
    const top = H * lerp(1.02, 0.8, k);
    const cx = W / 2 + W * 0.1, cy = top + R;
    // atmosphere glow
    for (let i = 5; i >= 1; i--) {
      ctx.beginPath();
      ctx.arc(cx, cy, R + i * 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(110, 170, 255, ${0.05 * (6 - i) * 0.5})`;
      ctx.fill();
    }
    const g = ctx.createRadialGradient(cx, cy - R, R * 0.05, cx, cy, R);
    g.addColorStop(0, '#4f8fd0');
    g.addColorStop(0.2, '#2c62a0');
    g.addColorStop(1, '#10284a');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // cloud bands sliding by beneath us
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(235, 240, 245, 0.35)';
    const shift = t * W * 0.05;
    const big = Math.max(W, H);
    for (let i = 0; i < 14; i++) {
      const s = this.cloudSeed[i % this.cloudSeed.length];
      const x = ((s.x * 0.5 + 0.5) * W * 1.6 + i * W * 0.23 - shift) % (W * 1.6) - W * 0.3;
      const y = top + (0.02 + (i % 5) * 0.035) * H;
      ctx.beginPath();
      ctx.ellipse(x, y, big * 0.07 * s.w, big * 0.004 * (1 + (i % 3)), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI * 1.1, Math.PI * 1.9);
    ctx.strokeStyle = 'rgba(160, 205, 255, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  drawClouds(f) {
    const { ctx, W, H } = this;
    if (f.space > 0.9) return;
    ctx.fillStyle = `rgba(245, 246, 240, ${0.85 * (1 - f.space)})`;
    for (const c of this.cloudSeed) {
      const y = f.groundY - c.alt * H;
      if (y < -60 || y > H + 60) continue;
      const x = W / 2 + c.x * W * 0.8 - this.xPx * 0.9;
      const w = c.w * Math.min(W, H) * 0.22;
      for (let i = 0; i < c.puffs; i++) {
        ctx.beginPath();
        ctx.ellipse(x + (i - c.puffs / 2) * w * 0.35, y - (i % 2) * w * 0.08, w * 0.3, w * 0.12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawSmoke(f, front) {
    const { ctx, W } = this;
    for (let i = front ? 0 : 1; i < this.parts.length; i += 2) {
      const p = this.parts[i];
      const k = p.life / p.max;
      const x = W / 2 + p.x - this.xPx, y = f.groundY - p.y;
      ctx.globalAlpha = p.a * (1 - k) * (1 - k);
      ctx.fillStyle = k < 0.05 ? '#fbe6c4' : '#e9e6df';
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Spent stages and fairing halves falling away behind the rocket. */
  drawDebris(f) {
    const { ctx, t } = this;
    const u = f.u;
    const piece = (since, draw, { back, side = 0, spin = 0, cy }) => {
      const s = t - since;
      if (s < 0) return;
      const p0 = this.pitch(since);
      const along = back(s) * u, across = side * s * u * 8;
      const dx = -Math.sin(p0) * along + Math.cos(p0) * across;
      const dy = Math.cos(p0) * along + Math.sin(p0) * across;
      const fade = 1 - smooth((s - 1.6) / 1.2);
      if (fade <= 0) return;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(f.cx + dx, f.cy + dy + s * s * 6 * u);
      ctx.rotate(p0);
      ctx.translate(0, (50 + cy) * u); // local origin at the base of stage 1, pivot on the piece's middle
      ctx.rotate(spin * s);
      ctx.translate(0, -cy * u);
      draw(u);
      ctx.restore();
    };
    piece(T.meco, (u) => this.stage1(u), { back: (s) => 4 + s * 14 + s * s * 22, spin: -0.5, cy: -30 });
    piece(T.fairing, (u) => this.fairingHalf(u, -1), { back: (s) => s * 6 + s * s * 14, side: -1, spin: -0.9, cy: -86 });
    piece(T.fairing, (u) => this.fairingHalf(u, 1), { back: (s) => s * 6 + s * s * 14, side: 1, spin: 0.9, cy: -86 });
    piece(T.deploy, (u) => this.stage2(u), { back: (s) => s * 5 + s * s * 4, spin: 0.25, cy: -70 });
    ctx.globalAlpha = 1;
  }

  drawRocket(f) {
    const { ctx, t } = this;
    const u = f.u;
    ctx.save();
    ctx.translate(f.cx, f.cy);
    ctx.rotate(f.pitch);
    ctx.translate(0, 50 * u); // local origin at the base of stage 1
    if (t < T.meco) {
      if (t > T.ignite) this.flame(u, 4, 4.2, t < T.liftoff ? smooth((t - T.ignite) / 0.3) : 1, f.space);
      this.stage1(u);
    }
    if (t < T.deploy) {
      if (t > T.s2 && t < T.seco) this.flame(u, -57, 2.8, smooth((t - T.s2) / 0.2), 1);
      this.stage2(u);
    }
    if (t < T.fairing) {
      this.fairingHalf(u, -1);
      this.fairingHalf(u, 1);
    } else {
      this.payload(u);
    }
    ctx.restore();
  }

  flame(u, y, w, k, vac) {
    const { ctx, t } = this;
    const flick = 1 + Math.sin(t * 53) * 0.08 + Math.sin(t * 131) * 0.05;
    const len = (20 + vac * 18) * u * k * flick;
    const wide = w * u * (1 + vac * 1.6);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, y * u, 0, y * u + len);
    g.addColorStop(0, 'rgba(255, 250, 225, 0.95)');
    g.addColorStop(0.25, 'rgba(255, 190, 90, 0.8)');
    g.addColorStop(1, 'rgba(255, 110, 40, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w * u * 0.8, y * u);
    ctx.quadraticCurveTo(-wide, y * u + len * 0.4, 0, y * u + len);
    ctx.quadraticCurveTo(wide, y * u + len * 0.4, w * u * 0.8, y * u);
    ctx.fill();
    ctx.restore();
  }

  stage1(u) {
    const ctx = this.ctx;
    // fins
    ctx.fillStyle = '#39465a';
    ctx.beginPath();
    ctx.moveTo(-5 * u, -12 * u); ctx.lineTo(-10 * u, 0); ctx.lineTo(-5 * u, 0);
    ctx.moveTo(5 * u, -12 * u); ctx.lineTo(10 * u, 0); ctx.lineTo(5 * u, 0);
    ctx.fill();
    // engine bell
    ctx.fillStyle = '#5b5f66';
    ctx.beginPath();
    ctx.moveTo(-3 * u, 0); ctx.lineTo(3 * u, 0); ctx.lineTo(4.4 * u, 4 * u); ctx.lineTo(-4.4 * u, 4 * u);
    ctx.fill();
    this.body(u, -58, 0, '#eeeae0');
    ctx.fillStyle = '#39465a';
    ctx.fillRect(-5 * u, -40 * u, 10 * u, 2.5 * u);
    ctx.fillRect(-5 * u, -8 * u, 10 * u, 2 * u);
    // interstage
    ctx.fillStyle = '#2a2f38';
    ctx.fillRect(-5 * u, -62 * u, 10 * u, 4 * u);
  }

  stage2(u) {
    const ctx = this.ctx;
    ctx.fillStyle = '#5b5f66';
    ctx.beginPath();
    ctx.moveTo(-2 * u, -62 * u); ctx.lineTo(2 * u, -62 * u); ctx.lineTo(3 * u, -57 * u); ctx.lineTo(-3 * u, -57 * u);
    ctx.fill();
    this.body(u, -80, -62, '#eeeae0');
    ctx.fillStyle = '#39465a';
    ctx.fillRect(-5 * u, -70 * u, 10 * u, 1.5 * u);
  }

  fairingHalf(u, side) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(-5.5 * u, 0, 5.5 * u, 0);
    g.addColorStop(0, '#b9b5ab');
    g.addColorStop(0.45, '#f6f3ea');
    g.addColorStop(1, '#a9a59c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -80 * u);
    ctx.lineTo(side * 5.5 * u, -80 * u);
    ctx.lineTo(side * 5.5 * u, -92 * u);
    ctx.quadraticCurveTo(side * 5 * u, -101 * u, 0, -104 * u);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 50, 60, 0.5)';
    ctx.lineWidth = Math.max(0.5, 0.25 * u);
    ctx.stroke();
  }

  payload(u) {
    const ctx = this.ctx;
    const t = this.t;
    // after separation the craft glides forward a little and unfolds its panels
    const s = Math.max(0, t - T.deploy);
    const fwd = s * 4 * u;
    const open = smooth(s / 0.6);
    ctx.save();
    ctx.translate(0, -fwd);
    ctx.shadowColor = SHIP;
    ctx.shadowBlur = 6 + 10 * open;
    ctx.fillStyle = SHIP;
    ctx.beginPath();
    ctx.moveTo(-3.5 * u, -82 * u);
    ctx.lineTo(3.5 * u, -82 * u);
    ctx.lineTo(3.5 * u, -92 * u);
    ctx.lineTo(0, -97 * u);
    ctx.lineTo(-3.5 * u, -92 * u);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    if (open > 0) {
      ctx.fillStyle = '#6f93c9';
      const pw = 11 * u * open;
      ctx.fillRect(-3.5 * u - pw, -90 * u, pw, 5 * u);
      ctx.fillRect(3.5 * u, -90 * u, pw, 5 * u);
    }
    ctx.restore();
  }

  body(u, y0, y1, color) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(-5 * u, 0, 5 * u, 0);
    g.addColorStop(0, '#a8a49a');
    g.addColorStop(0.4, color);
    g.addColorStop(1, '#8f8b82');
    ctx.fillStyle = g;
    ctx.fillRect(-5 * u, y0 * u, 10 * u, (y1 - y0) * u);
  }

  drawText(f) {
    const { ctx, W, H, t } = this;
    const pad = Math.max(16, Math.min(W, H) * 0.04);
    const cap = CAPTIONS.filter(([at]) => t >= at).pop();
    ctx.textBaseline = 'alphabetic';
    const dark = f.space < 0.45 && t < T.meco; // light sky: use dark text
    const ink = dark ? 'rgba(15, 31, 54, 0.9)' : '#ebe6d8';
    const dim = dark ? 'rgba(15, 31, 54, 0.6)' : 'rgba(235, 230, 216, 0.62)';
    if (cap) {
      const a = smooth((t - cap[0]) / 0.25);
      ctx.globalAlpha = a;
      ctx.fillStyle = cap[1] === 'In orbit' ? SHIP : ink;
      const size = Math.round(Math.min(34, Math.max(22, W * 0.045)));
      ctx.font = `600 ${size}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
      ctx.textAlign = 'left';
      const label = cap[1] === 'In orbit' ? `In orbit · ${Math.round(this.altKm)} km` : cap[1];
      ctx.fillText(label.toUpperCase(), pad, pad + size);
    }
    ctx.globalAlpha = 1;
    const tm = telemetry(t, this.altKm);
    const mm = String(Math.floor(tm.m / 60)).padStart(2, '0');
    const ss = String(Math.floor(tm.m % 60)).padStart(2, '0');
    const small = Math.round(Math.min(16, Math.max(13, W * 0.022)));
    ctx.font = `500 ${small}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    ctx.fillStyle = dim;
    ctx.textAlign = 'left';
    const size = Math.round(Math.min(34, Math.max(22, W * 0.045)));
    ctx.fillText(`T+ ${mm}:${ss}   ALT ${Math.round(tm.alt)} km   ${tm.v.toFixed(1)} km/s`, pad, pad + size + small + 8);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(235, 230, 216, 0.7)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 4;
    ctx.fillText('Tap or press any key to skip', W - pad, H - pad);
    ctx.shadowBlur = 0;
  }
}
