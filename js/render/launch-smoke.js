// Exhaust smoke, steam, fire and cold vapour for the launch cinematic.
//
// Particles live in pad metres (x to the right of "up" on screen, y up) and are
// drawn under one pad transform. Puffs are soft noise volumes, rendered once
// from a density field and lit two ways with the same silhouette: cool and lit
// from the sky above, and warm and lit from the flames below. Each particle
// blends the warm copy over the cool one by how close it is to the fire, so
// the cloud glows from inside without washing out to white. Only real fire is
// drawn additively.

import { rng, makeCanvas, volumeSprites, smooth } from './launch-util.js';

const COOL = { hi: [206, 212, 228], lo: [64, 74, 102], light: { x: -0.45, y: -0.9 }, ambient: 0.22 };
const WARM = { hi: [255, 236, 196], lo: [172, 80, 40], light: { x: 0.1, y: 1 }, ambient: 0.2 };
const STEAM = { hi: [250, 252, 255], lo: [140, 150, 178], light: { x: -0.45, y: -0.9 }, ambient: 0.34 };
const VAPOR = { hi: [242, 246, 255], lo: [176, 188, 212], light: { x: -0.3, y: -1 }, ambient: 0.5 };
const VARIANTS = 6;
const MAX_PARTS = 950;
const PUFF = 1.35; // a puff's sprite reaches past its nominal radius, where the edges thin out

/** A round, rolling puff: dense in the middle, breaking up into wisps at the edge. */
const puffShape = (u, v) => 1 - smooth((Math.hypot(u, v) - 0.25) / 0.72);

/** A streak of vapour: long and thin, with smooth streaky detail rather than billows. */
const wispShape = (u, v) => 1 - smooth((Math.hypot(u, v * 1.1) - 0.2) / 0.75);

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
    this.ready = false;
    this.rand = rng(23);
    this.parts = [];
    // the sprites take a moment to render: do it when the browser is idle, well before any launch
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    idle(() => this.prepare());
  }

  /** Render the puff, vapour and fire sprites (once). */
  prepare() {
    if (this.ready) return;
    this.cool = [], this.warm = [], this.steam = [];
    for (let i = 0; i < VARIANTS; i++) {
      const [cool, warm, steam] = volumeSprites({ w: 128, h: 128, seed: 101 + i * 17, shape: puffShape, looks: [COOL, WARM, STEAM], detail: [2.6, 2.6], warp: 0.4 });
      this.cool.push(cool);
      this.warm.push(warm);
      this.steam.push(steam);
    }
    this.wisps = [3, 4, 5].map((seed) => volumeSprites({ w: 160, h: 64, seed, shape: wispShape, looks: [VAPOR], detail: [1.6, 5], warp: 0.3, billow: false, absorb: 0.3 })[0]);
    this.fire = fireSprite();
    this.ready = true;
  }

  reset() {
    this.prepare();
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
    if (!this.parts.length || !this.ready) return;
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
      const rad = p.r * scale * (p.kind === 'vapor' ? 1.8 : PUFF);
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
      this.place(ctx, m, p.x, p.y, p.rot, p.seed > 50 ? -1 : 1); // mirrored copies for variety
      const img = p.kind === 'steam' ? this.steam[p.v] : this.cool[p.v];
      const R = p.r * PUFF;
      ctx.globalAlpha = a;
      ctx.drawImage(img, -R, -R, 2 * R, 2 * R);
      if (warm > 0.03) {
        ctx.globalAlpha = a * warm * 0.92;
        ctx.drawImage(this.warm[p.v], -R, -R, 2 * R, 2 * R);
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

  /** Point the context at pad position (x, y) with a rotation (and optional mirror), on top of the pad transform m. */
  place(ctx, m, x, y, rot, flip = 1) {
    const c = Math.cos(rot), s = Math.sin(rot);
    ctx.setTransform((m.a * c + m.c * s) * flip, (m.b * c + m.d * s) * flip, -m.a * s + m.c * c, -m.b * s + m.d * c, m.a * x - m.c * y + m.e, m.b * x - m.d * y + m.f);
  }
}
