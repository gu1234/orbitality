// The launch site at dusk, for the launch cinematic.
//
// Sky details (the Earth's shadow rising opposite the sunset, cloud streaks lit
// by the afterglow, the first stars and the Moon where the level has it), the
// far shoreline, and the pad itself: a raised hardstand with flame trench
// exits, the launch table with hold-down clamps and tail service masts, water
// deluge, floodlights, and a lattice service tower with an umbilical arm that
// lets go at liftoff. It also feeds the cold vapour, trench fire, exhaust and
// steam into the smoke system.
//
// Pad drawing is in metres in canvas orientation (x right, y down), with 0 at
// the top of the launch table where the rocket stands. The layout is designed
// with the tower on the left and mirrored so the rocket flies away from it.

import { TWO_PI, smooth, lerp, mixc, rgba, rng, makeCanvas, softEllipse } from './launch-util.js';

const GROUND = 12; // terrain, below the table top
const DECK = 4; // top of the raised pad
const TOWER = { x0: -26, x1: -12, top: -90 };
const ARM_Y = -50; // umbilical arm to the upper stage
const ROCKET_R = 2.35; // the rocket's radius in metres
const TRENCH_X = 44; // flame trench exits, either side
const STEEL = [118, 136, 176];
const ENGINE = [255, 166, 92];

function glowSprite() {
  const c = makeCanvas(64, 64), x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return c;
}

/** Same sprite in a colour, since canvas can't tint an image on the fly. */
function tinted(img, col) {
  const c = makeCanvas(img.width, img.height), x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = rgba(col);
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

export class PadScene {
  constructor(cin, ev) {
    this.cin = cin;
    this.ev = ev;
    const g = glowSprite();
    this.glow = { white: tinted(g, [225, 235, 255]), amber: tinted(g, [255, 186, 110]), red: tinted(g, [255, 70, 55]), warm: tinted(g, ENGINE) };
    const r = rng(41);
    this.stars = Array.from({ length: 44 }, () => ({ x: r() * 2 - 1, y: 0.18 + r() * 0.82, b: 0.35 + r() * 0.65, tw: r() * 6 }));
    this.streaks = Array.from({ length: 8 }, () => ({ x: r() * 1.5 - 0.75, y: 0.06 + r() * 0.3, len: 0.2 + r() * 0.4, th: 0.006 + r() * 0.014, a: 0.35 + r() * 0.3, s: r() * 10 }));
    this.shore = Array.from({ length: 70 }, () => ({ x: r(), y: r(), c: r(), f: r() }));
    this.rand = rng(77);
  }

  reset() {
    this.rand = rng(77);
    this.burst = false;
  }

  /** Design x (tower on the left) to pad x (tower away from the direction of travel). */
  get mx() { return -this.cin.dir; }

  // ---------------------------------------------------------------- timing

  /** 0 before T-0, rising to 1 as the umbilicals and clamps let go. */
  release(dur) { return smooth((this.cin.t - this.ev.liftoff + 0.02) / dur); }

  /** How much of the engines' light still reaches the pad. */
  padGlow(f) { return this.cin.glowPower(f) * (1 - smooth((f.h * 1000 - 25) / 220)); }

  /** Flame positions that light the smoke from inside, in pad metres (y up). */
  lights(f) {
    const hm = f.h * 1000;
    const k = this.cin.glowPower(f) * (1 - smooth((hm - 15) / 120));
    if (k <= 0.01) return [];
    return [-1, 1].map((s) => ({ x: s * (TRENCH_X + 4), y: -9, power: k * 0.85, reach: 15 }));
  }

  // ---------------------------------------------------------------- emitters

  /** Emit a particle given in design coordinates (canvas orientation). */
  put(kind, x, y, vx, vy, o) {
    const m = this.mx;
    this.cin.smoke.emit({ kind, x: m * x, y: -y, vx: m * vx, vy: -vy, ...o });
  }

  /** Emit `rate` per second on average. */
  every(rate, dt, fn) {
    const n = rate * dt;
    let k = Math.floor(n);
    if (this.rand() < n - k) k++;
    for (let i = 0; i < k; i++) fn(this.rand);
  }

  update(dt, f) {
    const t = this.cin.t, ev = this.ev;
    const hm = f.h * 1000;
    if (hm > 400) return;
    const pre = t < ev.liftoff;
    // cold vapour: the rocket breathes off boil-off gas until the vents close at T-0
    if (pre) {
      // upper and first stage oxygen vents, on the side away from the tower
      this.every(70, dt, (r) => this.put('vapor', ROCKET_R + 0.3, -53 + r() * 1.2, 5 + r() * 9, -2 + r() * 3.5, { r: 0.5 + r() * 0.5, gr: 3, life: 3 + r() * 1.4, a: 0.15 + r() * 0.07, spin: (r() - 0.5) * 2 }));
      this.every(40, dt, (r) => this.put('vapor', ROCKET_R + 0.3, -28 + r() * 1.2, 4 + r() * 6, -1.5 + r() * 3, { r: 0.45 + r() * 0.4, gr: 2.6, life: 2.8 + r(), a: 0.13 + r() * 0.07 }));
      // frosted tanks shedding wisps that slide down the body
      this.every(20, dt, (r) => {
        const s = r() < 0.5 ? -1 : 1;
        const y = r() < 0.7 ? -40 + r() * 16 : -58 + r() * 6;
        this.put('vapor', s * (ROCKET_R + 0.1), y, s * (0.4 + r() * 1.2), 1.5 + r() * 2, { r: 0.4 + r() * 0.3, gr: 1.1, life: 1.8 + r(), a: 0.12 + r() * 0.08 });
      });
      // leaks at the umbilical plates, sinking to the deck as a cold fog
      this.every(8, dt, (r) => this.put('vapor', -ROCKET_R - 0.4, ARM_Y + 2 + r() * 2, -1 - r() * 3, 0.5 + r() * 1.5, { r: 0.5 + r() * 0.4, gr: 1, life: 2 + r(), a: 0.28 }));
      this.every(10, dt, (r) => {
        const s = r() < 0.5 ? -1 : 1;
        this.put('vapor', s * (4 + r() * 8), DECK - 0.4, s * (1 + r() * 2.5), 0, { r: 1.4 + r(), gr: 1.6, life: 2.5 + r(), a: 0.18, buoy: 0 });
      });
    }
    // T-0: the umbilicals pull away in a gush of vapour
    if (!pre && !this.burst) {
      this.burst = true;
      for (let i = 0; i < 64; i++) {
        const r = this.rand;
        const out = r() < 0.75 ? -1 : 1; // mostly blown back toward the tower
        this.put('vapor', -ROCKET_R - r() * 1.5, ARM_Y + r() * 4, out * (3 + r() * 13), -3 + r() * 9, { r: 1 + r() * 1.3, gr: 4.2, life: 2.4 + r() * 1.3, a: 0.4, front: r() < 0.5 });
      }
      for (const s of [-1, 1]) {
        for (let i = 0; i < 30; i++) {
          const r = this.rand;
          this.put('vapor', s * (ROCKET_R + r() * 2.5), -4 - r() * 3, s * (3 + r() * 11), -2 + r() * 5, { r: 0.9 + r() * 1, gr: 3.8, life: 2 + r(), a: 0.42, front: true });
        }
      }
    }
    // the released plate keeps shedding vapour as the arm swings away
    const rel = this.release(0.9);
    if (!pre && rel < 0.95) {
      const tipX = TOWER.x1 + (-ROCKET_R - TOWER.x1) * (1 - 0.78 * rel), tipY = ARM_Y - 2.5 * rel;
      this.every(55 * (1 - rel), dt, (r) => this.put('vapor', tipX - 0.4, tipY + r() * 3, -2 - r() * 5, 1 + r() * 4, { r: 0.6 + r() * 0.6, gr: 3, life: 1.8 + r(), a: 0.3, front: r() < 0.5 }));
    }
    const firing = t > ev.ignite && t < ev.liftoff + 2.2;
    if (!firing) return;
    const on = smooth((t - ev.ignite) / 0.2);
    const down = hm < 110 ? 1 - smooth((hm - 30) / 80) : 0; // flame still reaching the trench
    // fire and exhaust blasting out of the flame trench exits
    for (const s of [-1, 1]) {
      if (down > 0.05 && t > ev.ignite + 0.04) {
        this.every(40 * on * down, dt, (r) => this.put('fire', s * (TRENCH_X + r() * 2), 9 + r() * 2, s * (110 + r() * 70), -r() * 10, { r: 2.4 + r() * 1.8, gr: 5, life: 0.3 + r() * 0.25, a: 0.85, front: true }));
      }
      const rate = 46 * on * (t < ev.liftoff + 0.9 ? 1 : 1 - smooth((t - ev.liftoff - 0.9) / 1.1)) * (0.3 + 0.7 * down);
      this.every(rate, dt, (r) => this.put(r() < 0.72 ? 'smoke' : 'steam', s * (TRENCH_X + 1 + r() * 3), 7 + r() * 4, s * (45 + r() * 85), -(4 + r() * 12), {
        r: 4 + r() * 3.5, gr: 13 + r() * 7, life: 3.8 + r() * 2, a: 0.85, front: r() < 0.3, floor: -GROUND,
      }));
    }
    // deluge water flashing to steam round the table
    if (t < ev.liftoff + 1) {
      this.every(44 * on, dt, (r) => {
        const s = r() < 0.5 ? -1 : 1;
        this.put('steam', s * (2 + r() * 9), DECK - r() * 3, s * (4 + r() * 20), -(6 + r() * 16), { r: 2 + r() * 1.8, gr: 7, life: 2.6 + r() * 1.3, a: 0.72, front: r() < 0.45 });
      });
    }
    // once it's off the table the flame hits the deck and spreads along it
    if (t > ev.liftoff && hm < 90) {
      const k = 1 - smooth((hm - 25) / 65);
      this.every(56 * k, dt, (r) => {
        const s = r() < 0.5 ? -1 : 1;
        this.put(r() < 0.6 ? 'smoke' : 'steam', s * r() * 7, DECK - 1, s * (35 + r() * 70), -(2 + r() * 10), { r: 3 + r() * 2, gr: 11, life: 3.2 + r() * 1.5, a: 0.8, front: r() < 0.4, floor: -DECK });
      });
    }
  }

  // ---------------------------------------------------------------- sky

  /**
   * Sky details over the base gradient: `o` is the horizon point on screen,
   * `dens` how much air is still around us, `side` which way the Sun set (+1 right).
   */
  drawSky(f, o, dens, side) {
    const cin = this.cin, ctx = cin.ctx, { W, H } = cin;
    const vis = dens * (1 - smooth((f.h - 2.5) / 3));
    if (vis <= 0.01) return;
    const up = f.up, right = { x: -up.y, y: up.x };
    const at = (x, y) => ({ x: o.x + right.x * x + up.x * y, y: o.y + right.y * x + up.y * y });
    const el = f.sunEl * 57.3;
    const dusk = Math.max(0, 1 - Math.abs(el + 3) / 10);
    const dark = smooth((2 - el) / 8); // 0 in daylight, 1 once the Sun is well down
    ctx.save();
    // the Earth's shadow rising opposite the sunset, with the pink Belt of Venus above it
    if (dusk > 0.02) {
      const c = at(-side * W * 0.45, 0);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(Math.atan2(right.y, right.x));
      softEllipse(ctx, 0, 0, W * 0.95, H * 0.34, [[0, [30, 40, 78], 0.5 * dusk * vis], [0.42, [44, 50, 92], 0.34 * dusk * vis], [0.6, [196, 138, 170], 0.26 * dusk * vis], [0.85, [150, 110, 160], 0.08 * dusk * vis], [1, [150, 110, 160], 0]]);
      ctx.restore();
    }
    // a band of haze along the horizon, warmer toward the Sun
    const hz = ctx.createLinearGradient(o.x, o.y, o.x + up.x * H * 0.12, o.y + up.y * H * 0.12);
    hz.addColorStop(0, rgba([214, 196, 206], 0.26 * vis));
    hz.addColorStop(1, rgba([214, 196, 206], 0));
    ctx.fillStyle = hz;
    ctx.fillRect(0, 0, W, H);
    if (dusk > 0.02) {
      const s = at(side * W * 0.62, 0);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.atan2(right.y, right.x));
      ctx.globalCompositeOperation = 'lighter';
      softEllipse(ctx, 0, 0, W * 0.55, H * 0.05, [[0, [255, 206, 150], 0.55 * dusk * vis], [0.5, [255, 150, 100], 0.2 * dusk * vis], [1, [255, 120, 90], 0]]);
      ctx.restore();
    }
    // stars coming out, fading toward the glow
    const now = cin.t;
    for (const s of this.stars) {
      const p = at(s.x * W * 0.55, s.y * H * 0.85);
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
      const near = Math.max(0, 1 - Math.abs(s.x - side * 0.8) * 1.1);
      const a = s.b * (0.2 + 0.8 * s.y) * (1 - near * 0.85) * vis * dark * (0.75 + 0.25 * Math.sin(now * 3 + s.tw * 7));
      if (a < 0.05) continue;
      ctx.fillStyle = rgba([235, 232, 222], a);
      const z = s.b > 0.85 ? 1.6 : 1.1;
      ctx.fillRect(p.x - z / 2, p.y - z / 2, z, z);
    }
    // an evening planet low over the afterglow
    if (dusk > 0.1) {
      const p = at(side * W * 0.3, H * 0.34);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9 * vis * dusk;
      ctx.drawImage(this.glow.white, p.x - 7, p.y - 7, 14, 14);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    this.drawMoon(f, o, at, vis);
    // thin cloud streaks, their undersides caught by the afterglow
    for (const c of this.streaks) {
      const p = at(c.x * W, c.y * H);
      const warm = smooth((c.x * side + 0.25) / 0.9) * dusk;
      const len = c.len * W, th = Math.max(2, c.th * H);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(right.y, right.x));
      const body = mixc([58, 58, 98], [150, 104, 138], warm);
      softEllipse(ctx, 0, 0, len * 0.5, th, [[0, body, c.a * vis], [0.6, body, c.a * 0.5 * vis], [1, body, 0]]);
      softEllipse(ctx, len * 0.18 * Math.sin(c.s), -th * 0.6, len * 0.3, th * 0.7, [[0, body, c.a * 0.8 * vis], [1, body, 0]]);
      if (warm > 0.05) {
        ctx.globalCompositeOperation = 'lighter';
        softEllipse(ctx, 0, th * 0.45, len * 0.42, th * 0.45, [[0, [255, 170, 120], 0.55 * warm * vis], [1, [255, 140, 110], 0]]);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /** The Moon, where the level has it, lit from the Sun's side. */
  drawMoon(f, o, at, vis) {
    const cin = this.cin, ctx = cin.ctx, { W, H } = cin;
    if (!cin.moonDir) return;
    const sky = (d) => {
      const s = cin.dirToScreen(d, f.psi);
      const right = { x: -f.up.y, y: f.up.x };
      const a = Math.atan2(s.x * right.x + s.y * right.y, s.x * f.up.x + s.y * f.up.y);
      return at(Math.sin(a) * W * 0.44, Math.min(0.6, Math.cos(a) * 0.78) * H);
    };
    const U = f.U, md = cin.moonDir;
    const el = Math.asin(Math.max(-1, Math.min(1, U.x * md.x + U.y * md.y)));
    if (el < 2 / 57.3) return;
    const p = sky(md), s = sky(cin.sun);
    const R = Math.max(5, Math.min(W, H) * 0.014);
    const elong = Math.acos(Math.max(-1, Math.min(1, md.x * cin.sun.x + md.y * cin.sun.y)));
    const lit = Math.max(0.1, (1 - Math.cos(elong)) / 2);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(s.y - p.y, s.x - p.x));
    ctx.globalAlpha = vis;
    // earthshine on the dark part, then the sunlit crescent and a soft glow
    ctx.fillStyle = `rgba(70,80,108,${0.55 * smooth((2 - f.sunEl * 57.3) / 8)})`;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = '#f4ecdc';
    ctx.beginPath();
    ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2);
    const a = R * Math.abs(1 - 2 * lit);
    if (lit < 0.5) ctx.ellipse(0, 0, a, R, 0, Math.PI / 2, -Math.PI / 2, true);
    else ctx.ellipse(0, 0, a, R, 0, Math.PI / 2, (3 * Math.PI) / 2, false);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = vis * (0.25 + 0.5 * lit);
    ctx.drawImage(this.glow.white, R * 0.4 - R * 3.5, -R * 3.5, R * 7, R * 7);
    ctx.restore();
  }

  // ---------------------------------------------------------------- scenery

  fade(f) { return 1 - smooth((f.h - 0.6) / 0.5); }

  /** Far shoreline, ground, storage tanks, floodlight towers and their beams. */
  drawBack(f) {
    const cin = this.cin, ctx = cin.ctx, t = cin.t;
    const fade = this.fade(f);
    if (fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = fade;
    this.drawShore(f);

    ctx.save();
    const k = cin.padTransform(f);
    ctx.scale(this.mx, 1);
    const px = 1 / k;
    // terrain
    const g = ctx.createLinearGradient(0, GROUND, 0, GROUND + 140);
    g.addColorStop(0, '#121e33');
    g.addColorStop(1, '#060c18');
    ctx.fillStyle = g;
    ctx.fillRect(-3000, GROUND, 6000, 6000);
    // a service road with its lamps, and the pools of light under the flood towers
    ctx.fillStyle = 'rgba(120,130,150,0.08)';
    ctx.fillRect(-3000, GROUND + 7, 6000, 2.5);
    ctx.globalCompositeOperation = 'lighter';
    for (let x = -420; x <= 420; x += 42) {
      ctx.globalAlpha = fade * 0.8;
      ctx.drawImage(this.glow.amber, x - 2.2, GROUND + 5.2 - 2.2, 4.4, 4.4);
    }
    for (const x of [-168, -108, 108, 168]) {
      ctx.globalAlpha = fade * 0.5;
      ctx.drawImage(this.glow.white, x - 30, GROUND - 4, 60, 12);
    }
    const eg = this.padGlow(f);
    if (eg > 0.01) {
      ctx.globalAlpha = fade * eg * 0.7;
      ctx.drawImage(this.glow.warm, -150, GROUND - 40, 300, 70);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = fade;
    // propellant storage spheres and a water tower
    this.sphere(ctx, -152, GROUND - 10, 9, px, [226, 228, 232]);
    this.sphere(ctx, -178, GROUND - 8, 7, px, [214, 218, 226]);
    ctx.strokeStyle = 'rgba(150,165,195,0.35)';
    ctx.lineWidth = Math.max(px, 0.5);
    ctx.beginPath(); ctx.moveTo(-143, GROUND - 2); ctx.lineTo(-40, GROUND - 2); ctx.stroke();
    this.waterTower(ctx, 132, px, t);
    // flood towers with their lamp banks aimed at the rocket
    for (const x of [-168, -108, 108, 168]) this.floodTower(ctx, x, px, fade);
    ctx.restore();
    ctx.restore();
  }

  sphere(ctx, x, y, r, px, col) {
    for (const lx of [-0.6, 0.6]) {
      ctx.strokeStyle = 'rgba(20,28,44,0.9)';
      ctx.lineWidth = Math.max(px, 0.6);
      ctx.beginPath(); ctx.moveTo(x + lx * r, y + r * 0.5); ctx.lineTo(x + lx * r * 1.1, GROUND); ctx.stroke();
    }
    const g = ctx.createRadialGradient(x + r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, rgba(mixc(col, [255, 255, 255], 0.3)));
    g.addColorStop(0.5, rgba(mixc(col, [70, 80, 110], 0.55)));
    g.addColorStop(1, rgba([22, 30, 48]));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TWO_PI); ctx.fill();
  }

  waterTower(ctx, x, px, t) {
    ctx.strokeStyle = '#0d1628';
    ctx.lineWidth = Math.max(px, 0.7);
    ctx.beginPath();
    for (const lx of [-5, -1.7, 1.7, 5]) { ctx.moveTo(x + lx * 0.8, -52); ctx.lineTo(x + lx, GROUND); }
    for (const y of [-30, -8]) { ctx.moveTo(x - 4.6, y); ctx.lineTo(x + 4.6, y); }
    ctx.stroke();
    this.sphere(ctx, x, -58, 7.5, px, [190, 198, 214]);
    if (Math.sin(t * 4.2 + 1) > 0) this.lamp(ctx, 'red', x, -66, 2.2, 1);
  }

  floodTower(ctx, x, px, fade) {
    ctx.strokeStyle = '#0c1526';
    ctx.lineWidth = Math.max(1.2 * px, 0.6);
    ctx.beginPath(); ctx.moveTo(x, GROUND); ctx.lineTo(x, -22); ctx.stroke();
    ctx.fillStyle = '#16213a';
    ctx.fillRect(x - 3, -25, 6, 3);
    // beams raking up at the rocket
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(x, -23.5);
    ctx.rotate(Math.atan2(-36 + 23.5, -x * 0.98));
    const len = Math.abs(x) * 1.25;
    const bg = ctx.createLinearGradient(0, 0, len, 0);
    bg.addColorStop(0, `rgba(205,220,255,${0.085 * fade})`);
    bg.addColorStop(1, 'rgba(205,220,255,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(0, -1.2); ctx.lineTo(len, -13); ctx.lineTo(len, 13); ctx.lineTo(0, 1.2); ctx.fill();
    ctx.restore();
    for (let i = 0; i < 4; i++) this.lamp(ctx, 'white', x - 2.2 + i * 1.45, -24.2, 2.6, 0.9);
  }

  lamp(ctx, col, x, y, size, a = 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= a;
    ctx.drawImage(this.glow[col], x - size, y - size, size * 2, size * 2);
    ctx.restore();
  }

  /** The far shore: sea catching the afterglow on the Sun's side, low land and distant lights on the other. */
  drawShore(f) {
    const cin = this.cin, ctx = cin.ctx, { W, H } = cin, t = cin.t;
    const o = cin.padPoint(f, 0, 0);
    const side = cin.sunSide(f);
    const ps = f.L0 / 70; // px per metre at the pad, kept fixed for the far layer
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(Math.atan2(f.up.x, -f.up.y));
    // the far shore sinks at a third of the rate the ground below us drops away
    const p0 = cin.padStart(), drop = (o.x - p0.x) * -f.up.x + (o.y - p0.y) * -f.up.y;
    ctx.translate(0, -0.66 * Math.max(0, drop) + GROUND * ps * 0.2);
    const coast = side * W * 0.1;
    // sea: a bright line at the horizon that fades into dark water
    const sea = ctx.createLinearGradient(0, 0, 0, H * 0.14);
    sea.addColorStop(0, '#6d5a78');
    sea.addColorStop(0.08, '#2b3456');
    sea.addColorStop(1, '#0b1428');
    ctx.fillStyle = sea;
    ctx.fillRect(side > 0 ? coast : -W * 2, 0, W * 2 - Math.abs(coast), H * 3);
    ctx.globalCompositeOperation = 'lighter';
    const glint = ctx.createLinearGradient(0, 0, 0, H * 0.05);
    glint.addColorStop(0, 'rgba(255,190,140,0.5)');
    glint.addColorStop(1, 'rgba(255,160,120,0)');
    ctx.fillStyle = glint;
    ctx.fillRect(side > 0 ? coast : -W * 2, 0, W * 2 - Math.abs(coast), H * 0.05);
    // shimmer on the water
    for (let i = 0; i < 26; i++) {
      const s = this.shore[i];
      const x = coast + side * (0.03 + s.x * 0.9) * W;
      const y = 2 + s.y * s.y * H * 0.05;
      const a = 0.25 * (0.5 + 0.5 * Math.sin(t * 5 + s.f * 20)) * (1 - s.y);
      ctx.fillStyle = `rgba(255,190,140,${a})`;
      ctx.fillRect(x, y, 4 + s.c * 14, 1);
    }
    ctx.globalCompositeOperation = 'source-over';
    // land: a low tree line with the odd building
    ctx.fillStyle = '#0d182c';
    ctx.beginPath();
    const land = side > 0 ? [coast, -W * 2] : [coast, W * 2];
    ctx.moveTo(land[0], 0);
    for (let i = 0; i <= 60; i++) {
      const x = lerp(land[0], land[1], i / 60);
      const y = -(3 + 2.5 * Math.sin(i * 1.7) + 2 * Math.sin(i * 0.43 + 1)) * ps * 0.35;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(land[1], H * 3);
    ctx.lineTo(land[0], H * 3);
    ctx.fill();
    const L = -side; // the land's direction
    ctx.fillStyle = '#0f1b31';
    ctx.fillRect(L * W * 0.62 - 12 * ps, -34 * ps, 24 * ps, 34 * ps); // the assembly building
    ctx.fillRect(L * W * 0.62 + (L > 0 ? 12 : -22) * ps, -14 * ps, 10 * ps, 14 * ps);
    // a distant pad: tower, lightning masts and a few lights
    const dp = L * W * 0.95;
    ctx.fillRect(dp - 1.4 * ps, -20 * ps, 2.8 * ps, 20 * ps);
    ctx.fillRect(dp + 3.2 * ps, -14 * ps, 1.1 * ps, 14 * ps);
    ctx.strokeStyle = '#0f1b31';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(dp - 8 * ps, 0); ctx.lineTo(dp - 8 * ps, -24 * ps); ctx.moveTo(dp + 9 * ps, 0); ctx.lineTo(dp + 9 * ps, -24 * ps); ctx.stroke();
    // a radio mast
    const rm = L * W * 0.33;
    ctx.beginPath(); ctx.moveTo(rm, 0); ctx.lineTo(rm, -30 * ps); ctx.stroke();
    // lights along the shore roads and at the distant pad
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 26; i < 70; i++) {
      const s = this.shore[i];
      const x = coast + L * (0.02 + s.x * 1.3) * W;
      const y = -1 - s.y * 2.5 * ps * 0.4;
      const col = s.c < 0.7 ? this.glow.amber : this.glow.white;
      ctx.globalAlpha = 0.7;
      ctx.drawImage(col, x - 2.5, y - 2.5, 5, 5);
    }
    ctx.globalAlpha = 1;
    for (const y of [-6, -12, -18]) ctx.drawImage(this.glow.white, dp - 2.5, y * ps - 2.5, 5, 5);
    const blink = Math.sin(t * 5.5) > 0.3;
    if (blink) {
      for (const [x, y] of [[dp, -21 * ps], [rm, -31 * ps], [L * W * 0.62, -35 * ps]]) ctx.drawImage(this.glow.red, x - 3, y - 3, 6, 6);
    }
    // a lighthouse on the point, its beam sweeping round
    const lh = coast - L * W * 0.015;
    const flash = Math.max(0, Math.cos(t * 2.4)) ** 10;
    ctx.globalAlpha = 0.5 + 0.5 * flash;
    ctx.drawImage(this.glow.white, lh - 3 - flash * 6, -9 * ps - 3 - flash * 6, 6 + flash * 12, 6 + flash * 12);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0f1b31';
    ctx.fillRect(lh - 0.8 * ps, -9 * ps, 1.6 * ps, 9 * ps);
    // atmospheric haze over everything far away
    const haze = ctx.createLinearGradient(0, -40 * ps, 0, 12);
    haze.addColorStop(0, 'rgba(120,120,160,0)');
    haze.addColorStop(1, 'rgba(120,120,160,0.16)');
    ctx.fillStyle = haze;
    ctx.fillRect(-W * 2, -40 * ps, W * 4, 40 * ps + 12);
    ctx.restore();
  }

  // ---------------------------------------------------------------- the service tower

  drawTower(f) {
    const cin = this.cin, ctx = cin.ctx, t = cin.t;
    const fade = this.fade(f);
    if (fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = fade;
    const k = cin.padTransform(f);
    ctx.scale(this.mx, 1);
    const px = 1 / k;
    const fine = k > 2.2; // small members only when they'd be visible
    const eg = this.padGlow(f);
    const { x0, x1, top } = TOWER;

    // lightning masts with catenary wires from the tower's mast
    ctx.strokeStyle = 'rgba(12,20,36,0.95)';
    for (const x of [-92, 78]) this.mast(ctx, x, -132, px, fine);
    ctx.strokeStyle = 'rgba(120,135,170,0.22)';
    ctx.lineWidth = Math.max(0.7 * px, 0.12);
    ctx.beginPath();
    ctx.moveTo(-19, -124); ctx.quadraticCurveTo(-60, -110, -92, -132);
    ctx.moveTo(-19, -124); ctx.quadraticCurveTo(30, -104, 78, -132);
    ctx.moveTo(-92, -132); ctx.quadraticCurveTo(-150, -70, -210, GROUND);
    ctx.moveTo(78, -132); ctx.quadraticCurveTo(140, -70, 200, GROUND);
    ctx.stroke();

    // elevator shaft on the far side, and the see-through body of the tower
    ctx.fillStyle = '#0b1424';
    ctx.fillRect(x0 - 4, top + 6, 4, DECK - top - 6);
    ctx.fillStyle = 'rgba(8,14,27,0.55)';
    ctx.fillRect(x0, top, x1 - x0, DECK - top);
    // main columns, lit along the edges by the floodlights
    ctx.fillStyle = '#152037';
    ctx.fillRect(x0, top, 1.3, DECK - top);
    ctx.fillRect(x1 - 1.3, top, 1.3, DECK - top);
    ctx.fillRect(-19.4, top, 0.8, DECK - top);
    const edge = rgba([170, 190, 228], 0.5);
    ctx.fillStyle = edge;
    ctx.fillRect(x1 - 0.3, top, 0.3, DECK - top);
    ctx.fillRect(x0 - 4, top + 6, 0.25, DECK - top - 6);
    // levels, bracing and handrails
    const steel = rgba(STEEL, 0.85);
    ctx.strokeStyle = steel;
    ctx.lineWidth = Math.max(0.8 * px, 0.22);
    ctx.beginPath();
    let bay = 0;
    for (let y = DECK; y > top + 0.1; y -= 6, bay++) {
      const y2 = Math.max(top, y - 6);
      ctx.moveTo(x0, y2); ctx.lineTo(x1, y2);
      if (bay % 2 === 0) {
        ctx.moveTo(x0, y); ctx.lineTo(-19, y2); ctx.lineTo(x1, y);
      } else {
        ctx.moveTo(x0, y); ctx.lineTo(x1, y2);
        ctx.moveTo(x1, y); ctx.lineTo(x0, y2);
      }
      ctx.moveTo(x0 - 4, y2); ctx.lineTo(x0, y2); // shaft ties
    }
    ctx.stroke();
    if (fine) {
      ctx.strokeStyle = rgba(STEEL, 0.4);
      ctx.lineWidth = Math.max(0.55 * px, 0.1);
      ctx.beginPath();
      for (let y = DECK - 6; y > top; y -= 6) {
        ctx.moveTo(x0, y - 1.1); ctx.lineTo(x1, y - 1.1); // handrails
        for (let x = x0 + 1.75; x < x1; x += 1.75) { ctx.moveTo(x, y); ctx.lineTo(x, y - 1.1); }
      }
      // stairs zig-zagging up inside the tower
      for (let y = DECK; y > top + 6; y -= 6) {
        ctx.moveTo(x0 + 1.4, y); ctx.lineTo(x0 + 5.4, y - 3); ctx.lineTo(x0 + 1.4, y - 6);
      }
      ctx.stroke();
    }
    // the elevator car, lit, part way up
    ctx.fillStyle = 'rgba(255,214,160,0.85)';
    ctx.fillRect(x0 - 3.4, -38, 2.8, 2.4);
    // propellant lines running up the rocket side of the tower
    ctx.fillStyle = '#b8c0cf';
    ctx.fillRect(x1 + 0.3, ARM_Y + 1, 0.55, DECK - ARM_Y - 1);
    ctx.fillStyle = '#8d97aa';
    ctx.fillRect(x1 + 1.1, ARM_Y + 3, 0.45, DECK - ARM_Y - 3);
    ctx.fillStyle = 'rgba(20,28,44,0.9)';
    for (let y = DECK - 3; y > ARM_Y; y -= 6) ctx.fillRect(x1, y, 2, 0.35);
    // roof, hammerhead crane and the lightning mast
    ctx.fillStyle = '#152037';
    ctx.fillRect(x0 - 4, top - 1, x1 - x0 + 4, 1.4);
    ctx.fillRect(-19.6, top - 8, 1.2, 8);
    ctx.strokeStyle = 'rgba(16,26,44,0.95)';
    ctx.lineWidth = Math.max(0.9 * px, 0.25);
    ctx.beginPath();
    ctx.moveTo(-34, top - 8); ctx.lineTo(-1, top - 8);
    ctx.moveTo(-30, top - 9.8); ctx.lineTo(-4, top - 9.8);
    for (let x = -34; x < -2; x += 2.2) { ctx.moveTo(x, top - 8); ctx.lineTo(x + 1.1, top - 9.8); ctx.lineTo(x + 2.2, top - 8); }
    ctx.moveTo(-3, top - 8); ctx.lineTo(-3, top - 2);
    ctx.stroke();
    ctx.fillStyle = '#10192d';
    ctx.fillRect(-36, top - 10, 3.4, 3.6); // counterweight
    ctx.fillRect(-19.3, top - 34, 0.6, 26);

    // arms: the retracted crew access arm, and the umbilical arm that lets go at T-0
    ctx.fillStyle = '#1c2942';
    ctx.fillRect(x1, -62.2, 3.2, 1.6);
    const wr = ctx.createLinearGradient(x1 + 3, 0, x1 + 5.8, 0);
    wr.addColorStop(0, '#46526b');
    wr.addColorStop(1, '#7c879e');
    ctx.fillStyle = wr;
    ctx.fillRect(x1 + 3, -64.5, 2.8, 4);
    ctx.fillStyle = 'rgba(255,214,160,0.75)';
    ctx.fillRect(x1 + 3.6, -63.6, 1.4, 0.9);
    this.umbilicalArm(ctx, px, fine, t);

    // work lights on the levels and warning lights up top
    for (let y = DECK - 6, i = 0; y > top; y -= 6, i++) {
      this.lamp(ctx, i % 3 === 1 ? 'amber' : 'white', i % 2 ? x0 + 0.8 : x1 - 0.8, y - 0.8, Math.max(1.3, 5 * px), 0.85);
    }
    if (Math.sin(t * 5) > 0) for (const [x, y] of [[-19, -125], [-34, top - 10], [-1, top - 8.5], [-92, -133], [78, -133]]) this.lamp(ctx, 'red', x, y, Math.max(1.4, 5 * px));

    // the engines light the tower from below
    if (eg > 0.01) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 - 4.5, top - 12, x1 - x0 + 12, DECK - top + 12);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const w = ctx.createRadialGradient(0, DECK, 4, 0, DECK, 85);
      w.addColorStop(0, rgba(ENGINE, 0.7 * eg));
      w.addColorStop(0.4, rgba(ENGINE, 0.28 * eg));
      w.addColorStop(1, rgba(ENGINE, 0));
      ctx.fillStyle = w;
      ctx.fillRect(x0 - 4.5, top - 12, x1 - x0 + 12, DECK - top + 12);
      ctx.restore();
    }
    ctx.restore();
  }

  mast(ctx, x, top, px, fine) {
    ctx.lineWidth = Math.max(px, 0.3);
    ctx.beginPath();
    ctx.moveTo(x - 1.6, GROUND); ctx.lineTo(x - 0.3, top);
    ctx.moveTo(x + 1.6, GROUND); ctx.lineTo(x + 0.3, top);
    if (fine) {
      for (let y = GROUND; y > top + 8; y -= 8) {
        const w0 = lerp(1.6, 0.3, (GROUND - y) / (GROUND - top)), w1 = lerp(1.6, 0.3, (GROUND - y + 8) / (GROUND - top));
        ctx.moveTo(x - w0, y); ctx.lineTo(x + w1, y - 8);
      }
    }
    ctx.stroke();
  }

  /** The upper-stage umbilical arm: hoses to a plate on the rocket until T-0, then it swings away. */
  umbilicalArm(ctx, px, fine, t) {
    const rel = this.release(0.9);
    const x1 = TOWER.x1;
    const full = -ROCKET_R - x1;
    const len = full * (1 - 0.78 * rel); // swinging out of the plane, it foreshortens
    const tipX = x1 + len, tipY = ARM_Y - 2.5 * rel;
    ctx.save();
    ctx.strokeStyle = rgba(STEEL, 0.9);
    ctx.fillStyle = '#16223a';
    ctx.lineWidth = Math.max(0.8 * px, 0.2);
    ctx.beginPath();
    ctx.moveTo(x1, ARM_Y - 1.2); ctx.lineTo(tipX, tipY - 1.2);
    ctx.lineTo(tipX, tipY + 0.6); ctx.lineTo(x1, ARM_Y + 0.6); ctx.closePath();
    ctx.fill();
    if (fine) {
      for (let i = 0; i < 5; i++) {
        const a = i / 5, b = (i + 1) / 5;
        ctx.moveTo(lerp(x1, tipX, a), lerp(ARM_Y + 0.6, tipY + 0.6, a));
        ctx.lineTo(lerp(x1, tipX, b), lerp(ARM_Y - 1.2, tipY - 1.2, b));
      }
    }
    ctx.stroke();
    // the carrier plate and its hoses
    ctx.fillStyle = '#b7bfcd';
    ctx.fillRect(tipX - 0.55, tipY - 0.6, 0.55, 3.8);
    ctx.strokeStyle = '#2a3346';
    ctx.lineWidth = Math.max(1.1 * px, 0.35);
    const sway = rel > 0 ? Math.sin(t * 9) * 0.6 * (1 - rel) : 0;
    ctx.beginPath();
    for (const [dx, sag] of [[2.6, 3.4], [4.4, 4.6]]) {
      ctx.moveTo(tipX - dx, tipY + 0.6);
      ctx.quadraticCurveTo(tipX - dx * 0.5 + sway, tipY + sag, tipX - 0.4, tipY + 2.4);
    }
    ctx.stroke();
    this.lamp(ctx, 'white', lerp(x1, tipX, 0.5), ARM_Y - 1.6, Math.max(1, 4 * px), 0.7);
    ctx.restore();
  }

  // ---------------------------------------------------------------- in front of the rocket

  /** The pad mound, trench exits, launch table, hold-downs, tail service masts and deluge. */
  drawFront(f) {
    const cin = this.cin, ctx = cin.ctx, t = cin.t, ev = this.ev;
    const fade = this.fade(f);
    if (fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = fade;
    const k = cin.padTransform(f);
    ctx.scale(this.mx, 1);
    const px = 1 / k;
    const eg = this.padGlow(f);
    const trench = cin.glowPower(f) * (1 - smooth((f.h * 1000 - 20) / 110));

    // water deluge arcing onto the table
    const dl = smooth((t - ev.ignite + 0.5) / 0.3) * (1 - smooth((t - ev.liftoff - 1.3) / 0.5));
    if (dl > 0.01) {
      ctx.save();
      ctx.strokeStyle = `rgba(215,230,255,${0.26 * dl})`;
      ctx.lineWidth = Math.max(1.3 * px, 0.3);
      ctx.lineCap = 'round';
      ctx.setLineDash([0.1, 1.9]);
      ctx.lineDashOffset = -t * 26;
      ctx.beginPath();
      for (const s of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          const x0 = s * 25, x2 = s * (6 + i * 2.2), apex = 7 + (i % 3) * 3;
          ctx.moveTo(x0, DECK - 1);
          ctx.quadraticCurveTo((x0 + x2) / 2, DECK - 1 - apex * 2, x2, DECK);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // the raised pad, lit by the engines
    ctx.fillStyle = '#18233a';
    ctx.beginPath();
    ctx.moveTo(-58, GROUND); ctx.lineTo(-30, DECK); ctx.lineTo(30, DECK); ctx.lineTo(58, GROUND); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(170,185,215,0.28)';
    ctx.fillRect(-30, DECK, 60, 0.4);
    // flame trench exits, glowing while the engines fire into them
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#05080f';
      ctx.fillRect(s > 0 ? TRENCH_X - 4 : -TRENCH_X - 4, 6.5, 8, GROUND - 6.5);
      ctx.fillStyle = '#243049';
      ctx.fillRect(s > 0 ? TRENCH_X - 5 : -TRENCH_X - 5, 5.6, 10, 1);
      if (trench > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = fade * trench;
        ctx.drawImage(this.glow.warm, s * TRENCH_X - 14, 9 - 9, 28, 18);
        ctx.drawImage(this.glow.white, s * TRENCH_X - 4, 9 - 2.5, 8, 5);
        ctx.restore();
      }
    }
    if (eg > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = fade * eg * 0.75;
      ctx.drawImage(this.glow.warm, -60, DECK - 22, 120, 40);
      ctx.restore();
    }

    // launch table: a slab with an opening for the engines, on four legs
    ctx.fillStyle = '#1b2740';
    ctx.fillRect(-11, 0, 7, 1.8);
    ctx.fillRect(4, 0, 7, 1.8);
    ctx.fillRect(-10.5, 1.8, 2.6, DECK - 1.8);
    ctx.fillRect(7.9, 1.8, 2.6, DECK - 1.8);
    ctx.fillStyle = 'rgba(175,190,220,0.4)';
    ctx.fillRect(-11, 0, 7, 0.25);
    ctx.fillRect(4, 0, 7, 0.25);
    if (eg > 0.01) {
      ctx.fillStyle = rgba(ENGINE, 0.5 * eg);
      ctx.fillRect(-11, 1.3, 22, 0.5);
    }

    // hold-down clamps grip the base until T-0, then swing open
    const hold = this.release(0.22);
    ctx.fillStyle = '#2b3852';
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * 3.9, 0);
      ctx.rotate(s * hold * 0.9);
      ctx.fillRect(-0.35, -1.4, 0.7, 1.4);
      ctx.fillRect(s > 0 ? -1.3 : 0.35, -1.4, 0.95, 0.45);
      ctx.restore();
    }

    // tail service masts, with umbilicals to the base of the rocket that retract at T-0
    const tsm = this.release(0.35);
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#1a2640';
      ctx.fillRect(s > 0 ? 8.2 : -10.8, -9, 2.6, 9);
      ctx.fillStyle = '#243150';
      ctx.beginPath();
      ctx.moveTo(s * 8.2, -9); ctx.lineTo(s * 10.8, -9); ctx.lineTo(s * 10.8, -10.4 + tsm * 1.4); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(175,190,220,0.35)';
      ctx.fillRect(s > 0 ? 8.2 : -8.45, -9, 0.25, 9);
      ctx.save();
      ctx.translate(s * 8.2, -5);
      ctx.rotate(s * tsm * 1.2);
      ctx.fillStyle = '#26324c';
      const reach = 8.2 - ROCKET_R;
      ctx.fillRect(s > 0 ? -reach : 0, -0.5, reach, 1);
      ctx.fillStyle = '#b7bfcd';
      ctx.fillRect(s > 0 ? -reach : reach - 0.5, -0.9, 0.5, 1.8);
      ctx.strokeStyle = '#2a3346';
      ctx.lineWidth = Math.max(px, 0.3);
      ctx.beginPath();
      ctx.moveTo(s > 0 ? -1 : 1, 0.5); ctx.quadraticCurveTo(-s * reach * 0.5, 2.8, -s * (reach - 0.4), 0.8);
      ctx.stroke();
      ctx.restore();
      this.lamp(ctx, 'white', s * 9.5, -9.6, Math.max(1, 4 * px), 0.8);
    }
    ctx.restore();
  }
}
