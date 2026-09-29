// Exhaust smoke, steam, fire and cold vapour for the launch cinematic.
//
// Particles live in pad metres (x to the right of "up" on screen, y up) and are
// drawn under one pad transform. Billows are pre-rendered twice with the same
// lumpy silhouette: once in a cool, top-lit palette and once in a warm palette
// lit from below. Each particle blends the warm copy over the cool one by how
// close it is to the flame, so the cloud glows from inside without washing out
// to white. Only real fire is drawn additively.

import { TWO_PI, rng, rgba, makeCanvas } from './launch-util.js';

const COOL = { hi: [198, 205, 222], mid: [132, 142, 168], lo: [86, 96, 124] };
const WARM = { hi: [255, 240, 208], mid: [255, 172, 98], lo: [178, 86, 48] };
const STEAM = { hi: [248, 250, 255], mid: [214, 221, 236], lo: [160, 170, 194] };
const VARIANTS = 5;
const MAX_PARTS = 950;

/**
 * A cauliflower billow: a cluster of shaded lumps with a defined but soft edge.
 * `light` is the direction the light comes from, in sprite units.
 */
function billowSprite(seed, pal, light) {
  const S = 128, c = makeCanvas(S, S), x = c.getContext('2d');
  const r = rng(seed);
  const lumps = [];
  for (let i = 0; i < 20; i++) {
    const a = r() * TWO_PI, d = Math.sqrt(r()) * S * 0.27;
    const rr = S * (0.1 + r() * 0.1) * (1.25 - d / (S * 0.4));
    lumps.push({ x: S / 2 + Math.cos(a) * d, y: S / 2 + Math.sin(a) * d * 0.9, r: rr });
  }
  lumps.push({ x: S / 2, y: S / 2, r: S * 0.24 });
  // lumps facing the light are drawn last, so they sit on top
  lumps.sort((p, q) => (q.x * light.x + q.y * light.y) - (p.x * light.x + p.y * light.y));
  for (const l of lumps) {
    const g = x.createRadialGradient(l.x + light.x * l.r * 0.45, l.y + light.y * l.r * 0.5, l.r * 0.05, l.x, l.y, l.r);
    g.addColorStop(0, rgba(pal.hi, 1));
    g.addColorStop(0.5, rgba(pal.mid, 1));
    g.addColorStop(0.76, rgba(pal.lo, 0.8));
    g.addColorStop(1, rgba(pal.lo, 0));
    x.fillStyle = g;
    x.beginPath(); x.arc(l.x, l.y, l.r, 0, TWO_PI); x.fill();
  }
  // soften the outline of the whole cluster
  x.globalCompositeOperation = 'destination-in';
  const m = x.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.5);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = m;
  x.fillRect(0, 0, S, S);
  return c;
}

/** A streak of cold vapour: several thin soft strands, long along x. */
function wispSprite(seed) {
  const W = 128, H = 48, c = makeCanvas(W, H), x = c.getContext('2d');
  const r = rng(seed);
  for (let i = 0; i < 5; i++) {
    const cx = W * (0.35 + r() * 0.3), cy = H * (0.4 + r() * 0.2);
    const rx = W * (0.22 + r() * 0.2), ry = H * (0.22 + r() * 0.16);
    x.save();
    x.translate(cx, cy);
    x.scale(rx / ry, 1);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, ry);
    g.addColorStop(0, `rgba(240,246,255,${0.3 + r() * 0.2})`);
    g.addColorStop(1, 'rgba(240,246,255,0)');
    x.fillStyle = g;
    x.fillRect(-ry, -ry, 2 * ry, 2 * ry);
    x.restore();
  }
  return c;
}

function fireSprite() {
  const c = makeCanvas(64, 64), x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,250,230,1)');
  g.addColorStop(0.25, 'rgba(255,208,120,0.9)');
  g.addColorStop(0.6, 'rgba(255,120,40,0.32)');
  g.addColorStop(1, 'rgba(255,80,20,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return c;
}

const KIND = {
  // drag (1/s), buoyancy (m/s², upward), growth slowdown, sprite stretch along velocity
  smoke: { drag: 1.1, buoy: 8, slow: 0.5 },
  steam: { drag: 1.4, buoy: 10, slow: 0.6 },
  vapor: { drag: 0.7, buoy: -4, slow: 0.25 },
  fire: { drag: 2.2, buoy: 4, slow: 0 },
};

export class Smoke {
  constructor() {
    const top = { x: -0.35, y: -0.45 }, below = { x: 0.15, y: 0.5 };
    this.cool = [], this.warm = [], this.steam = [];
    for (let i = 0; i < VARIANTS; i++) {
      this.cool.push(billowSprite(101 + i * 17, COOL, top));
      this.warm.push(billowSprite(101 + i * 17, WARM, below));
      this.steam.push(billowSprite(101 + i * 17, STEAM, top));
    }
    this.wisps = [3, 4, 5].map(wispSprite);
    this.fire = fireSprite();
    this.rand = rng(23);
    this.parts = [];
  }

  reset() {
    this.parts = [];
    this.rand = rng(23);
  }

  count(pred) {
    let n = 0;
    for (const p of this.parts) if (pred(p)) n++;
    return n;
  }

  /** Add a particle: position and velocity in pad metres, radius r and growth gr in metres. */
  emit(p) {
    if (this.parts.length >= MAX_PARTS) return;
    const k = KIND[p.kind] || KIND.smoke;
    const r = this.rand;
    this.parts.push({
      vx: 0, vy: 0, gr: 0, a: 0.8, front: false,
      drag: k.drag, buoy: k.buoy, slow: k.slow,
      rot: (r() - 0.5) * 0.8, spin: (r() - 0.5) * 0.6, v: (r() * VARIANTS) | 0, seed: r() * 100,
      ...p,
      age: 0,
    });
  }

  update(dt) {
    for (const p of this.parts) {
      p.age += dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.buoy * Math.exp(-p.age / 2.5) * dt;
      // a little turbulence so neighbouring puffs don't move in lockstep
      p.vx += Math.sin(p.age * 1.9 + p.seed) * 3 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += (p.gr * dt) / (1 + p.age * p.slow);
      p.rot += p.spin * dt;
      if (p.floor !== undefined && p.y - p.r * 0.35 < p.floor) {
        p.y = p.floor + p.r * 0.35; // smoke rolling along the ground spreads out
        p.vx *= 1 + 0.6 * dt;
      }
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
  }

  /**
   * Draw one layer ('back' or 'front') under the current pad transform.
   * `lights` are flame positions in pad metres, { x, y, power, reach }.
   */
  draw(ctx, layer, lights) {
    if (!this.parts.length) return;
    const m = ctx.getTransform();
    const scale = Math.hypot(m.a, m.b); // device px per metre
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const fires = [];
    const front = layer === 'front';
    for (const p of this.parts) {
      if (p.front !== front) continue;
      if (p.kind === 'fire') { fires.push(p); continue; }
      const k = p.age / p.life;
      const a = p.a * Math.min(1, p.age * 5) * (1 - k * k);
      if (a < 0.01) continue;
      const sx = m.a * p.x - m.c * p.y + m.e, sy = m.b * p.x - m.d * p.y + m.f;
      const rad = p.r * scale * (p.kind === 'vapor' ? 1.6 : 1);
      if (sx + rad < 0 || sx - rad > cw || sy + rad < 0 || sy - rad > ch || rad < 0.5) continue;
      let warm = 0;
      for (const l of lights) {
        const dd = Math.hypot(p.x - l.x, p.y - l.y);
        warm += l.power * Math.exp(-dd / l.reach);
      }
      warm = Math.min(1, warm);
      if (p.kind === 'vapor') {
        // stretched along the way it drifts
        const ang = Math.atan2(-p.vy, p.vx);
        const sp = Math.hypot(p.vx, p.vy);
        this.place(ctx, m, p.x, p.y, ang);
        const rw = p.r * (1.4 + Math.min(0.9, sp / 10)), rh = p.r * 0.75;
        ctx.globalAlpha = a;
        ctx.drawImage(this.wisps[p.v % 3], -rw, -rh, 2 * rw, 2 * rh);
        continue;
      }
      this.place(ctx, m, p.x, p.y, p.rot);
      const img = p.kind === 'steam' ? this.steam[p.v] : this.cool[p.v];
      ctx.globalAlpha = a;
      ctx.drawImage(img, -p.r, -p.r, 2 * p.r, 2 * p.r);
      if (warm > 0.03) {
        ctx.globalAlpha = a * warm * 0.92;
        ctx.drawImage(this.warm[p.v], -p.r, -p.r, 2 * p.r, 2 * p.r);
      }
    }
    if (fires.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (const p of fires) {
        const k = p.age / p.life;
        ctx.globalAlpha = p.a * (1 - k) * (1 - k);
        this.place(ctx, m, p.x, p.y, 0);
        const rw = p.r * 1.6, rh = p.r;
        const ang = Math.atan2(-p.vy, p.vx);
        ctx.rotate(ang);
        ctx.drawImage(this.fire, -rw, -rh, 2 * rw, 2 * rh);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.setTransform(m);
    ctx.globalAlpha = 1;
  }

  /** Point the context at pad position (x, y) with a rotation, on top of the pad transform m. */
  place(ctx, m, x, y, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    ctx.setTransform(m.a * c + m.c * s, m.b * c + m.d * s, -m.a * s + m.c * c, -m.b * s + m.d * c, m.a * x - m.c * y + m.e, m.b * x - m.d * y + m.f);
  }
}
