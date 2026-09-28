// Launch cinematic: a short side-on flight from the pad to orbit, played before
// the early levels. The rocket lifts off at dusk, punches through the clouds,
// climbs out of Earth's shadow into sunlight, drops its first stage and fairing,
// and releases your craft. Then the camera pulls back and rolls to north-up
// until the frame matches the game's own opening view (same starfield, same
// Earth artwork, same ship marker), and the game fades in underneath.
//
// World units are km with Earth at the origin, like the game. The camera keeps
// the vehicle at a screen anchor, with "up" along any world direction and a
// zoom that follows altitude, so one continuous camera covers the pad (metres)
// and the orbit view (thousands of km). The vehicle itself is drawn as an icon
// whose size is set separately, as the game does with its ship marker.

const R_E = 6371;
const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const SHIP = [255, 181, 71];
const CHALK = [235, 230, 216];
const FIELD = [15, 31, 54];

// Cinematic timeline, in seconds.
const EV = {
  ignite: 0.55,
  liftoff: 1.0,
  maxq: 2.55,
  meco: 3.25,
  sep: 3.45,
  s2: 3.75,
  fairing: 4.5,
  seco: 6.0,
  deploy: 6.3,
  pull: 6.45, // the camera starts to pull back to the game's view
  handoff: 8.45, // the frame now matches the game: fade across to it
};
const FADE = 0.65;
const SKIP_FADE = 0.45;
const ASCENT_ARC = 14; // degrees around Earth that the powered climb covers

const STAGES = [
  { at: 0, title: 'Terminal count', sub: 'All systems go' },
  { at: EV.ignite, title: 'Ignition', sub: 'Engines to full thrust' },
  { at: EV.liftoff, title: 'Liftoff', sub: 'Clearing the tower', tick: 'Liftoff' },
  { at: EV.maxq, title: 'Max Q', sub: 'Peak aerodynamic stress', tick: 'Max Q' },
  { at: EV.meco, title: 'Stage separation', sub: 'First stage cutoff', tick: 'Staging' },
  { at: EV.s2, title: 'Second stage', sub: 'Upper stage ignition' },
  { at: EV.fairing, title: 'Fairing separation', sub: 'Above the atmosphere', tick: 'Fairing' },
  { at: EV.seco, title: 'Engine cutoff', sub: 'Orbital speed reached' },
  { at: EV.deploy, title: 'In orbit', sub: '', tick: 'Orbit' },
];

// ---------------------------------------------------------------- helpers

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const ease = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };
const lerp = (a, b, k) => a + (b - a) * k;
const mixc = (c1, c2, k) => [lerp(c1[0], c2[0], k), lerp(c1[1], c2[1], k), lerp(c1[2], c2[2], k)];
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a < 0 ? 0 : a > 1 ? 1 : a})`;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth monotone curve through [x, y] keys (Fritsch–Carlson), flat at both ends. */
function curve(keys) {
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
const wobble = (t, s = 0) => Math.sin(t * 13.1 + s) * 0.5 + Math.sin(t * 29.7 + s * 2.3) * 0.3 + Math.sin(t * 57.3 + s * 4.1) * 0.2;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** A soft puff built from a few overlapping blobs, so smoke billows rather than looking like discs. */
function puffSprite(col, seed = 1, lumps = 7) {
  const c = makeCanvas(96, 96), x = c.getContext('2d');
  const r = rng(seed);
  for (let i = 0; i < lumps; i++) {
    const a = r() * TWO_PI, d = i === 0 ? 0 : 12 + r() * 14;
    const cx = 48 + Math.cos(a) * d, cy = 48 + Math.sin(a) * d * 0.8;
    const rad = i === 0 ? 34 : 14 + r() * 12;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const shade = mixc(col, [col[0] * 0.75, col[1] * 0.75, col[2] * 0.8], r() * 0.8);
    g.addColorStop(0, rgba(shade, i === 0 ? 0.8 : 0.55));
    g.addColorStop(0.5, rgba(shade, i === 0 ? 0.45 : 0.3));
    g.addColorStop(1, rgba(shade, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, 96, 96);
  }
  return c;
}

/** A flat-bottomed cumulus built from soft blobs, lit from above (dusk) or below (engine glow). */
function cloudSprite(seed, body, lit, fromBelow) {
  const W = 384, H = 160, c = makeCanvas(W, H), x = c.getContext('2d');
  const r = rng(seed);
  for (let i = 0; i < 26; i++) {
    const cx = W * (0.12 + r() * 0.76);
    const edge = 1 - Math.abs(cx / W - 0.5) * 2;
    const rad = H * (0.12 + r() * 0.2) * (0.5 + edge * 0.7);
    const cy = H * 0.72 - rad * (0.2 + r() * 0.6) * edge;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, rgba(body, 0.95));
    g.addColorStop(0.6, rgba(body, 0.55));
    g.addColorStop(1, rgba(body, 0));
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, rad, 0, TWO_PI); x.fill();
  }
  x.globalCompositeOperation = 'source-atop';
  const g = fromBelow ? x.createLinearGradient(0, H, 0, 0) : x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgba(lit, 0.9));
  g.addColorStop(0.55, rgba(lit, 0.15));
  g.addColorStop(1, rgba(lit, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  return c;
}

/** A soft elliptical glow (no hard edges): centre (x, y), half-width w, half-length l, colour stops [at, rgb, alpha]. */
function softEllipse(ctx, x, y, w, l, stops) {
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
const upAngle = (v) => Math.atan2(v.x, -v.y);

// ---------------------------------------------------------------- flight profile

const P = {
  alt: curve([[EV.liftoff, 0], [1.3, 0.01], [1.65, 0.085], [1.95, 0.6], [2.2, 2.6], [2.4, 6.5], [2.8, 17], [EV.meco, 62], [EV.s2, 88], [EV.fairing, 135], [5.3, 265], [EV.seco, 392], [EV.deploy, 400]]),
  speed: curve([[EV.liftoff, 0], [1.65, 0.05], [2.2, 0.3], [2.8, 0.9], [EV.meco, 2.2], [EV.s2, 2.15], [EV.fairing, 3.1], [EV.seco, 7.67], [20, 7.67]]),
  pitch: curve([[1.7, 0], [2.4, 5], [2.8, 15], [EV.meco, 36], [EV.fairing, 62], [EV.seco, 83], [EV.deploy, 88], [6.8, 90]]),
  size: curve([[2.0, 1], [EV.meco, 0.82], [5.0, 0.68], [EV.seco, 0.66], [EV.deploy + 0.25, 0.95]]),
  shake: curve([[0.5, 0], [0.62, 2.6], [1.4, 3.2], [2.0, 1.1], [EV.maxq, 2.2], [2.9, 1], [EV.meco, 0.5], [EV.meco + 0.05, 0]]),
  // distance from the vehicle down to the ground, in screen heights, by log10(altitude km):
  // the ground drops away, the clouds rush past, then the horizon settles back into view
  ground: curve([[-1.3, 1.1], [-0.5, 1.6], [0.3, 2.2], [0.8, 2.0], [1.2, 1.2], [1.6, 0.62], [2.0, 0.36], [2.6, 0.24], [3, 0.22]]),
};

// ---------------------------------------------------------------- the cinematic

export class LaunchCinematic {
  /** root: the #launch element; renderer: the game's renderer (for its starfield and planet art). */
  constructor(root, renderer) {
    this.root = root;
    this.renderer = renderer;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'launch-canvas';
    this.ctx = this.canvas.getContext('2d');
    root.append(this.canvas);
    this.buildHud();
    this.playing = false;
    this.fading = false;
    this.opaque = false; // true while the launch fully covers the game
    this.raf = 0;
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.sprites = null;
    this.f = null;
    this.onPointer = (e) => { e.preventDefault(); this.skip(); };
    this.onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // swallow the key so it neither pauses the game nor lands on the briefing behind us
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) this.skip();
    };
    root.addEventListener('pointerdown', this.onPointer);
  }

  static wanted() {
    return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  buildHud() {
    const el = (tag, cls, parent, text) => {
      const e = document.createElement(tag);
      e.className = cls;
      if (text) e.textContent = text;
      parent.append(e);
      return e;
    };
    const hud = el('div', 'launch-hud', this.root);
    const head = el('div', 'lh-head', hud);
    this.elClock = el('div', 'lh-clock', head);
    this.elTitle = el('div', 'lh-title', head);
    this.elSub = el('div', 'lh-sub', head);
    const tel = el('div', 'lh-tel', hud);
    const row = (label) => {
      const r = el('div', 'lh-row', tel);
      el('span', 'lh-label', r, label);
      return el('span', 'lh-value', r);
    };
    this.elAlt = row('Altitude');
    this.elSpeed = row('Speed');
    const line = el('div', 'lh-line', hud);
    const track = el('div', 'lh-track', line);
    this.elFill = el('div', 'lh-fill', track);
    this.ticks = STAGES.filter((s) => s.tick).map((s) => {
      const t = el('div', 'lh-tick', track);
      t.style.left = `${(s.at / EV.deploy) * 100}%`;
      el('span', '', t, s.tick);
      return { at: s.at, el: t };
    });
    el('div', 'lh-skip', hud, 'Tap to skip');
    this.hud = hud;
    this.shown = {};
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Plays the launch into the level's opening view. `world` and `cam` are the
   * game's; the camera is read live, so the last frame lands on its framing.
   * Resolves once the launch has finished or been skipped and faded away.
   */
  play({ world, cam }) {
    this.stop();
    this.setup(world, cam);
    this.show();
    window.addEventListener('keydown', this.onKey, true);
    this.playing = true;
    this.opaque = true;
    return new Promise((resolve) => {
      this.done = resolve;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        this.advance(dt);
        this.draw();
        if (this.t >= EV.handoff && !this.fading) this.fadeOut(FADE);
        if (this.playing) this.raf = requestAnimationFrame(tick);
      };
      this.draw();
      this.raf = requestAnimationFrame(tick);
    });
  }

  show() {
    const root = this.root;
    root.style.transition = 'none';
    root.style.opacity = '1';
    root.classList.remove('hidden');
    this.hud.classList.remove('out');
    this.shown = {};
  }

  /** Fades out from wherever the launch is and resolves play(). */
  skip() {
    if (this.playing && !this.fading) this.fadeOut(SKIP_FADE);
  }

  fadeOut(sec) {
    this.fading = true;
    this.opaque = false; // the game draws underneath from here on
    window.removeEventListener('keydown', this.onKey, true);
    this.root.style.transition = `opacity ${sec}s ease`;
    this.root.style.opacity = '0';
    this.fadeTimer = setTimeout(() => this.finish(), sec * 1000);
  }

  /** Hides at once; used when the player leaves before the launch is over. */
  stop() {
    if (this.playing) this.finish();
    else this.root.classList.add('hidden');
  }

  finish() {
    clearTimeout(this.fadeTimer);
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    this.root.classList.add('hidden');
    this.playing = false;
    this.fading = false;
    this.opaque = false;
    const done = this.done;
    this.done = null;
    done?.();
  }

  /** Test hook: show the frame at time t without playing. */
  seek(t, { world, cam }) {
    this.stop();
    this.setup(world, cam);
    this.show();
    while (this.t < t - 1e-9) this.advance(Math.min(1 / 60, t - this.t));
    this.draw();
  }

  // ---------------------------------------------------------------- setup

  setup(world, cam) {
    this.world = world;
    this.cam = cam;
    this.earth = world.body('earth');
    const e = this.earth.absPos(world.t);
    const s = world.shipAbs();
    const rx = s.x - e.x, ry = s.y - e.y;
    this.dir = rx * world.ship.vy - ry * world.ship.vx >= 0 ? 1 : -1; // counter-clockwise orbits are +1
    this.orbitR = Math.hypot(rx, ry);
    this.orbitAlt = this.orbitR - R_E;
    this.thetaEnd = Math.atan2(ry, rx);
    const sl = Math.hypot(e.x, e.y) || 1;
    this.sun = { x: -e.x / sl, y: -e.y / sl }; // unit vector from Earth toward the Sun
    // Launch at dusk: from just past the terminator, flying away from the Sun toward
    // where the level's orbit starts. Fall back to a plain 60° climb if that doesn't fit.
    const sunAng = Math.atan2(this.sun.y, this.sun.x);
    let site = sunAng + this.dir * 93 * DEG;
    let span = ((((this.thetaEnd - site) * this.dir) % TWO_PI) + TWO_PI) % TWO_PI;
    if (span < 30 * DEG || span > 150 * DEG) { span = 60 * DEG; site = this.thetaEnd - this.dir * span; }
    this.siteAng = site;
    this.siteCos = Math.cos(site);
    this.siteSin = Math.sin(site);
    const arcTotal = span / DEG;
    const period = TWO_PI * Math.sqrt(this.orbitR ** 3 / this.earth.gm);
    const coast = ((arcTotal - ASCENT_ARC) / 360) * period;
    this.clock = curve([[EV.liftoff, 0], [EV.maxq, 70], [EV.meco, 150], [EV.sep, 153], [EV.s2, 160], [EV.fairing, 210], [EV.seco, 505], [EV.deploy, 520], [EV.handoff, 520 + coast]]);
    this.arc = curve([[1.65, 0], [2.1, 0.0003], [2.4, 0.002], [2.8, 0.018], [EV.meco, 0.2], [EV.fairing, 1.0], [5.3, 4.5], [EV.seco, 12.8], [EV.deploy, ASCENT_ARC], [EV.handoff, arcTotal]]);
    this.orbitV = Math.sqrt(this.earth.gm / this.orbitR);
    this.subs = { [EV.deploy]: `${Math.round(this.orbitAlt)} km up at ${this.orbitV.toFixed(1)} km/s` };
    this.t = 0;
    this.parts = [];
    this.trail = [];
    this.trailClock = 0;
    this.columnB = undefined;
    this.rand = rng(11);
    this.syncSize();
    if (!this.sprites) this.makeSprites();
    this.f = this.frame(0);
  }

  makeSprites() {
    this.sprites = {
      smoke: [1, 2, 3].map((k) => puffSprite([128, 138, 165], k)),
      warm: puffSprite([255, 150, 70], 9, 1),
      white: puffSprite([240, 244, 250], 7, 1),
      clouds: [0, 1, 2].map((i) => cloudSprite(31 + i * 7, [70, 86, 122], [255, 170, 150], false)),
      cloudsWarm: [0, 1, 2].map((i) => cloudSprite(31 + i * 7, [255, 140, 60], [255, 200, 120], true)),
    };
    const r = rng(5);
    this.clouds = [];
    for (let i = 0; i < 14; i++) this.clouds.push({ a: -2.5 + r() * 6, b: 2.2 + r() * 2.2, w: 0.8 + r() * 1.6, k: i % 3, front: r() < 0.3 });
    this.clouds.push({ a: 0.35, b: 3.3, w: 1.9, k: 1, front: true }); // the one we fly through
    for (let i = 0; i < 6; i++) this.clouds.push({ a: -6 + r() * 14, b: 8.5 + r() * 2, w: 3 + r() * 4, k: i % 3, thin: true });
  }

  /** Match the game canvas exactly, so the shared starfield and planet art line up. */
  syncSize() {
    const r = this.renderer;
    const w = r.w, h = r.h, dpr = r.dpr;
    if (w === this.W && h === this.H && dpr === this.dpr) return;
    this.W = w;
    this.H = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  // ---------------------------------------------------------------- state

  /** Everything about the flight and the camera at time t. */
  frame(t) {
    const W = this.W, H = this.H;
    const f = { t };
    f.h = P.alt(t);
    f.theta = this.siteAng + this.dir * this.arc(t) * DEG;
    f.pitch = P.pitch(t) * DEG;
    f.L0 = Math.min(0.5 * H, 0.72 * W);
    f.m = f.L0 / 0.07; // px per km at the pad (the rocket is 70 m tall)
    f.L = f.L0 * P.size(t);

    // vehicle position and local frame in the world
    const c = Math.cos(f.theta), s = Math.sin(f.theta);
    f.U = { x: c, y: s }; // local up
    f.T = { x: -s * this.dir, y: c * this.dir }; // direction of travel
    f.pos = { x: (R_E + f.h) * c, y: (R_E + f.h) * s };
    const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
    f.axisW = { x: f.U.x * cp + f.T.x * sp, y: f.U.y * cp + f.T.y * sp };

    // zoom: pad scale near the ground, then pulling back so the horizon settles in view
    const E = H * P.ground(Math.log10(Math.max(f.h, 0.02)));
    const near = f.h * f.m;
    const d = f.h > 0 ? 1 / Math.cbrt(1 / near ** 3 + 1 / E ** 3) : 0;
    let scale = f.h > 1e-4 ? d / f.h : f.m;
    let phi = f.theta; // world direction that points up on screen

    // screen anchor for the vehicle point (the base of the stack)
    const axisTrack = this.dirToScreen(f.axisW, Math.PI / 2 - phi);
    const com = { x: W * 0.56, y: H * 0.47 };
    const lead = lerp(0.42, 0.86, smooth((t - EV.seco) / 0.6)); // how far up the stack the camera centres
    const target = { x: com.x - axisTrack.x * lead * f.L, y: com.y - axisTrack.y * lead * f.L };
    const pad = { x: W * 0.5, y: H * 0.84 };
    const rise0 = Math.max(40, pad.y - H * 0.62);
    const follow = 1 - Math.exp(-near / rise0); // locked off at first, then tracking
    let ax = lerp(pad.x, target.x, follow), ay = lerp(pad.y, target.y, follow);

    // pull back and roll into the game's own framing
    f.k = ease((t - EV.pull) / (EV.handoff - EV.pull));
    if (f.k > 0) {
      const g = this.gameView();
      phi = f.theta + f.k * wrap(Math.PI / 2 - this.thetaEnd);
      scale = Math.exp(lerp(Math.log(scale), Math.log(g.scale), f.k));
      ax = lerp(ax, g.ship.x, f.k);
      ay = lerp(ay, g.ship.y, f.k);
    }
    const shake = P.shake(t);
    f.anchor = { x: ax + shake * wobble(t, 1), y: ay + shake * wobble(t, 7) };
    f.scale = scale;
    f.psi = Math.PI / 2 - phi; // rotation taking world directions to screen orientation
    f.cos = Math.cos(f.psi);
    f.sin = Math.sin(f.psi);
    f.axis = this.dirToScreen(f.axisW, f.psi);
    f.up = this.dirToScreen(f.U, f.psi);
    f.sunS = this.dirToScreen(this.sun, f.psi);

    // light: how high the Sun is here, and whether we are out of Earth's shadow yet
    f.sunEl = Math.asin(Math.max(-1, Math.min(1, f.U.x * this.sun.x + f.U.y * this.sun.y)));
    f.sunlit = this.sunlitAt(f.h, f.sunEl);
    f.air = Math.exp(-f.h / 7); // how much atmosphere is around us
    f.vac = 1 - Math.exp(-f.h / 18); // how far the exhaust plume has ballooned
    return f;
  }

  sunlitAt(h, el) {
    if (el >= 0) return 1;
    const need = R_E * (1 / Math.cos(el) - 1); // height at which the Sun clears the horizon
    return smooth((h - need) / 12 + 0.5);
  }

  /** The game camera's view of Earth and the ship right now. */
  gameView() {
    const cam = this.cam, w = this.world;
    const s = w.shipAbs();
    return { scale: cam.scale, ship: { x: cam.sx(s.x), y: cam.sy(s.y) } };
  }

  dirToScreen(v, psi) {
    const c = Math.cos(psi), s = Math.sin(psi);
    return { x: v.x * c - v.y * s, y: -(v.x * s + v.y * c) };
  }

  /** World km to screen px. */
  toScreen(f, x, y) {
    const dx = x - f.pos.x, dy = y - f.pos.y;
    return { x: f.anchor.x + (dx * f.cos - dy * f.sin) * f.scale, y: f.anchor.y - (dx * f.sin + dy * f.cos) * f.scale };
  }

  /** Screen px back to world km. */
  toWorld(f, px, py) {
    const rx = (px - f.anchor.x) / f.scale, ry = -(py - f.anchor.y) / f.scale;
    return { x: f.pos.x + rx * f.cos + ry * f.sin, y: f.pos.y - rx * f.sin + ry * f.cos };
  }

  /** Screen position of a point near the pad: `a` km downrange, `b` km up. */
  padPoint(f, a, b) {
    const c = this.siteCos, s = this.siteSin;
    return this.toScreen(f, (R_E + b) * c - s * this.dir * a, (R_E + b) * s + c * this.dir * a);
  }

  /** The pad frame (km downrange, km up) of a world point. */
  toPad(w) {
    const c = this.siteCos, s = this.siteSin;
    const dx = w.x - R_E * c, dy = w.y - R_E * s;
    return { a: (dx * -s + dy * c) * this.dir, b: Math.hypot(w.x, w.y) - R_E };
  }

  // ---------------------------------------------------------------- simulation

  advance(dt) {
    this.t += dt;
    const t = this.t;
    this.syncSize();
    const f = this.frame(t);
    this.f = f;
    const r = this.rand;
    let column = 0;
    for (const p of this.parts) if (p.column) column++;
    const full = this.parts.length - column >= 380;

    // before ignition: cold vapour venting off the upper stage and drifting down
    if (t < EV.ignite + 0.3 && !full && r() < 0.6) {
      this.parts.push({ a: 0.001 + r() * 0.003, b: 0.05 + r() * 0.012, va: 0.004 + r() * 0.004, vb: -0.002 - r() * 0.003, r: 0.0015 + r() * 0.002, gr: 0.004, life: 0, max: 1.6 + r(), alpha: 0.35, kind: 'white' });
    }
    // ignition: exhaust thrown sideways out of the flame trench, steam round the mount
    const firing1 = t > EV.ignite && t < EV.meco;
    if (firing1 && t < 2.1 && !full) {
      const n = t < EV.liftoff + 0.5 ? 8 : 3;
      for (let i = 0; i < n; i++) {
        const side = r() < 0.5 ? -1 : 1;
        this.parts.push(r() < 0.75
          ? { a: side * (0.04 + r() * 0.01), b: 0.002 + r() * 0.004, va: side * (0.05 + r() * 0.1), vb: 0.003 + r() * 0.01, r: 0.005 + r() * 0.006, gr: 0.016 + r() * 0.01, life: 0, max: 3 + r() * 1.8, alpha: 0.5, kind: 'smoke' }
          : { a: (r() - 0.5) * 0.02, b: 0.001, va: (r() - 0.5) * 0.03, vb: 0.015 + r() * 0.02, r: 0.004 + r() * 0.005, gr: 0.012, life: 0, max: 2.4 + r(), alpha: 0.28, kind: 'white' });
      }
    }
    // the climb: a column of smoke left hanging in the air behind the engines
    // (spaced by distance climbed, so the column reaches all the way up to the engines)
    const rr0 = 0.01 + f.h * 0.006;
    if (firing1 && t > EV.liftoff && f.h < 30 && column < 400) {
      const nz = this.nozzleScreen(f);
      const p = this.toPad(this.toWorld(f, nz.x, nz.y));
      if (this.columnB === undefined || Math.abs(p.b - this.columnB) > rr0 * 0.9) {
        this.columnB = p.b;
        for (let i = 0; i < 2; i++) {
          const rr = rr0 * (0.7 + r() * 0.6);
          this.parts.push({ a: p.a + (r() - 0.5) * rr, b: p.b - r() * rr, va: (r() - 0.5) * 0.01, vb: -0.01 * r(), r: rr, gr: 0.012 + f.h * 0.005, life: 0, max: 2.4 + r() * 1.2, alpha: 0.75 * f.air + 0.1, kind: 'smoke', column: true });
        }
      }
    }
    for (const p of this.parts) {
      if (p.v === undefined) p.v = (r() * 3) | 0;
      p.life += dt;
      p.a += p.va * dt;
      p.b += p.vb * dt;
      p.va *= 1 - 1.3 * dt;
      p.vb = p.vb * (1 - 0.8 * dt) + (p.kind === 'smoke' ? 0.004 * dt : 0);
      p.r += p.gr * dt;
      if (p.b < 0.001) p.b = 0.001;
    }
    this.parts = this.parts.filter((p) => p.life < p.max);

    // a high exhaust trail that catches the sunlight above Earth's shadow
    this.trailClock -= dt;
    const burning = (t > EV.liftoff && t < EV.meco) || (t > EV.s2 && t < EV.seco);
    if (burning && f.h > 8 && this.trailClock <= 0) {
      this.trailClock = 0.03;
      const nz = this.nozzleScreen(f);
      const w = this.toWorld(f, nz.x, nz.y);
      const ang = Math.atan2(w.y, w.x);
      const h = Math.hypot(w.x, w.y) - R_E;
      const el = Math.asin(Math.max(-1, Math.min(1, Math.cos(ang) * this.sun.x + Math.sin(ang) * this.sun.y)));
      this.trail.push({ x: w.x, y: w.y, born: t, lit: this.sunlitAt(h, el), h });
    }
  }

  nozzleScreen(f) {
    const u = f.L / 104;
    const y = this.t < EV.sep ? 2 : -53; // first stage engines, then the upper stage bell
    return { x: f.anchor.x - f.axis.x * y * u, y: f.anchor.y - f.axis.y * y * u };
  }

  // ---------------------------------------------------------------- drawing

  draw() {
    const f = this.f;
    const ctx = this.ctx;
    const { W, H, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.renderer.backdrop.draw(ctx, W, H, dpr, performance.now() / 1000);
    this.drawEarth(f);
    this.drawSky(f);
    if (f.h < 1.2) this.drawPad(f);
    this.drawClouds(f, false);
    this.drawTrail(f);
    this.drawSmoke(f);
    if (f.h < 1.2) this.drawTower(f);
    this.drawDebris(f);
    this.drawVehicle(f);
    this.drawClouds(f, true);
    this.drawOrbit(f);
    this.drawPayloadFree(f);
    this.drawGrade(f);
    this.updateHud(f);
  }

  /** Earth as the game draws it (textured and lit), turned with the camera, plus a thin limb of air. */
  drawEarth(f) {
    const ctx = this.ctx, { W, H } = this;
    const R = R_E * f.scale;
    if (R > 90000) return; // still near the ground: the pad scene covers this
    const e = this.toScreen(f, 0, 0);
    const cx = W / 2, cy = H / 2;
    // draw it unrotated at the pre-image of e, in a canvas turned about the screen centre
    const rot = -f.psi;
    const c = Math.cos(f.psi), s = Math.sin(f.psi);
    const qx = cx + (e.x - cx) * c - (e.y - cy) * s;
    const qy = cy + (e.x - cx) * s + (e.y - cy) * c;
    ctx.save();
    // the game's glow is sized for the zoomed-out map; up close keep only a sliver of it
    const allow = lerp(Math.max(1, 3 * f.scale), R * 0.1, smooth((f.k - 0.2) / 0.6));
    ctx.beginPath();
    ctx.arc(e.x, e.y, R + allow, 0, TWO_PI);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.translate(-cx, -cy);
    const drawn = this.renderer.planets.draw(ctx, this.earth, qx, qy, R, this.world.t, this.dpr);
    ctx.restore();
    if (!drawn) {
      ctx.fillStyle = '#10284a';
      ctx.beginPath(); ctx.arc(e.x, e.y, R, 0, TWO_PI); ctx.fill();
    }
    // up close, the game's limb haze (sized for the map) would be hundreds of km deep: pull it back in
    const damp = 0.7 * (1 - smooth((f.k - 0.1) / 0.5));
    if (damp > 0.01 && R > 3000) {
      const inner = Math.max(0, R - 0.08 * R);
      const g = ctx.createRadialGradient(e.x, e.y, inner, e.x, e.y, R);
      g.addColorStop(0, 'rgba(6,12,24,0)');
      g.addColorStop(0.9, `rgba(6,12,24,${damp * 0.8})`);
      g.addColorStop(1, `rgba(6,12,24,${damp * 0.3})`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(e.x, e.y, R, 0, TWO_PI); ctx.fill();
    }
    // a crisp band of air along the limb, blue by day and burning orange at the terminator
    const fade = 1 - smooth(f.k / 0.8);
    if (fade <= 0.01 || !ctx.createConicGradient) return;
    const g = ctx.createConicGradient(Math.atan2(f.sunS.y, f.sunS.x), e.x, e.y);
    const stops = [[0, [150, 200, 255], 1], [0.2, [140, 190, 255], 0.7], [0.245, [255, 150, 90], 1], [0.3, [110, 120, 200], 0.2], [0.5, [40, 70, 140], 0.06], [0.7, [110, 120, 200], 0.2], [0.755, [255, 150, 90], 1], [0.8, [140, 190, 255], 0.7], [1, [150, 200, 255], 1]];
    for (const [at, col, a] of stops) g.addColorStop(at, rgba(col, a));
    ctx.save();
    ctx.fillStyle = g;
    ctx.globalCompositeOperation = 'lighter';
    // layered shells: a bright thin skin of air and a fainter haze above it
    for (const [km, a] of [[2, 0.35], [6, 0.12], [15, 0.05]]) {
      ctx.globalAlpha = a * fade;
      ctx.beginPath();
      ctx.arc(e.x, e.y, R + Math.max(1, km * f.scale), 0, TWO_PI);
      ctx.arc(e.x, e.y, R, 0, TWO_PI, true);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The sky around us while there is air: dusk blue, with an afterglow toward the hidden Sun. */
  drawSky(f) {
    const ctx = this.ctx, { W, H } = this;
    const dens = Math.exp(-f.h / 9);
    if (dens < 0.01) return;
    const el = f.sunEl / DEG;
    const day = smooth((el + 2) / 12), night = smooth((-el - 6) / 10);
    const pick = (dayC, duskC, nightC) => mixc(mixc(duskC, dayC, day), nightC, night);
    const horizon = pick([170, 200, 230], [92, 116, 160], [20, 32, 56]);
    const mid = pick([95, 145, 210], [44, 70, 122], [14, 26, 46]);
    const zenith = pick([50, 100, 180], [20, 38, 72], [10, 20, 38]);
    // graded upward from the horizon: the ground below us, but never lower than the bottom of the screen
    const g0 = this.toScreen(f, f.U.x * R_E, f.U.y * R_E);
    const dg = Math.hypot(g0.x - f.anchor.x, g0.y - f.anchor.y);
    const db = f.up.y < -0.2 ? (H - f.anchor.y) / -f.up.y : dg;
    const dd = Math.min(dg, db * 1.02);
    const o = { x: f.anchor.x - f.up.x * dd, y: f.anchor.y - f.up.y * dd };
    const span = H * 1.4;
    const g = ctx.createLinearGradient(o.x, o.y, o.x + f.up.x * span, o.y + f.up.y * span);
    g.addColorStop(0, rgba(horizon, dens));
    g.addColorStop(0.35, rgba(mid, dens * 0.97));
    g.addColorStop(1, rgba(zenith, dens * 0.82));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // afterglow: the Sun is just below the horizon, off to one side
    const glow = Math.max(0, 1 - Math.abs(el + 2) / 12) * dens;
    if (glow > 0.01) {
      const right = { x: -f.up.y, y: f.up.x };
      const side = f.sunS.x * right.x + f.sunS.y * right.y > 0 ? 1 : -1;
      const hx = o.x + side * right.x * W * 0.7, hy = o.y + side * right.y * W * 0.7;
      const rad = Math.max(W, H) * 1.15;
      const a = ctx.createRadialGradient(hx, hy, 0, hx, hy, rad);
      a.addColorStop(0, rgba([255, 178, 110], 0.85 * glow));
      a.addColorStop(0.3, rgba([232, 118, 120], 0.42 * glow));
      a.addColorStop(0.65, rgba([120, 90, 160], 0.14 * glow));
      a.addColorStop(1, rgba([60, 60, 120], 0));
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /** Transform so that drawing in metres at the pad (x right, y down, 0 at deck level) lands on screen. */
  padTransform(f) {
    const ctx = this.ctx;
    const o = this.padPoint(f, 0, 0);
    const k = f.scale / 1000;
    ctx.translate(o.x, o.y);
    ctx.rotate(upAngle(f.up));
    ctx.scale(k, k);
    return k;
  }

  /** Ground, the far shoreline and the floodlights around the pad. */
  drawPad(f) {
    const ctx = this.ctx, { W, H } = this;
    const fade = 1 - smooth((f.h - 0.6) / 0.5);
    if (fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = fade;
    // far horizon: sinks more slowly than the ground beneath us (parallax)
    const o = this.padPoint(f, 0, 0);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(upAngle(f.up));
    ctx.translate(0, -f.h * f.m * 0.65);
    const ps = f.L0 / 70; // px per metre at the pad
    const far = [[-1.9, 0], [-1.6, -8], [-1.1, -6], [-0.9, -12], [-0.55, -10], [-0.3, -14], [0.3, -9], [0.7, -13], [1.1, -8], [1.6, -11], [1.9, 0]];
    ctx.fillStyle = '#0a1426';
    ctx.beginPath();
    ctx.moveTo(-W * 2, 0);
    for (const [x, y] of far) ctx.lineTo(x * W, y * ps * 0.6);
    ctx.lineTo(W * 2, 0);
    ctx.lineTo(W * 2, H * 3);
    ctx.lineTo(-W * 2, H * 3);
    ctx.fill();
    // an assembly building and a string of sodium lights along the shore
    ctx.fillStyle = '#0c182c';
    ctx.fillRect(-0.62 * W, -34 * ps, 22 * ps, 34 * ps);
    for (let i = 0; i < 26; i++) {
      const x = (-1.3 + i * 0.1 + Math.sin(i * 7.3) * 0.03) * W;
      ctx.fillStyle = i % 5 === 0 ? 'rgba(255,214,160,0.9)' : 'rgba(255,181,71,0.7)';
      ctx.fillRect(x, -2 * ps - (i % 3) * ps, 1.6, 1.6);
    }
    if (Math.sin(this.t * 6) > 0.2) {
      ctx.fillStyle = '#ff4d3d';
      ctx.fillRect(-0.62 * W + 10 * ps, -35 * ps, 2.2, 2.2);
    }
    ctx.restore();

    // the near ground and the pad deck, in metres
    ctx.save();
    this.padTransform(f);
    const g = ctx.createLinearGradient(0, 0, 0, 120);
    g.addColorStop(0, '#111d31');
    g.addColorStop(1, '#070e1b');
    ctx.fillStyle = g;
    ctx.fillRect(-2000, 10, 4000, 4000);
    ctx.fillStyle = '#1b2638';
    ctx.beginPath();
    ctx.moveTo(-70, 10); ctx.lineTo(-38, 0); ctx.lineTo(38, 0); ctx.lineTo(70, 10); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#05080f'; // flame trench exits
    ctx.fillRect(-46, 3, 8, 6);
    ctx.fillRect(38, 3, 8, 6);
    ctx.fillStyle = '#2a3446'; // launch mount
    ctx.fillRect(-7, -2, 14, 2);
    ctx.fillStyle = 'rgba(190,205,235,0.35)';
    ctx.fillRect(-38, 0, 76, 0.6);
    ctx.restore();

    // floodlights raking up at the rocket
    const beams = 1 - smooth((f.h - 0.03) / 0.25);
    if (beams > 0) {
      ctx.save();
      this.padTransform(f);
      ctx.globalCompositeOperation = 'lighter';
      for (const [x, tx] of [[-150, -3], [-95, 2], [95, -2], [160, 4]]) {
        ctx.save();
        ctx.translate(x, 10);
        ctx.rotate(Math.atan2(-45, tx - x));
        const len = 260;
        const bg = ctx.createLinearGradient(0, 0, len, 0);
        bg.addColorStop(0, `rgba(200,220,255,${0.075 * beams})`);
        bg.addColorStop(1, 'rgba(200,220,255,0)');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(0, -1); ctx.lineTo(len, -11); ctx.lineTo(len, 11); ctx.lineTo(0, 1);
        ctx.fill();
        ctx.fillStyle = 'rgba(230,240,255,0.9)';
        ctx.beginPath(); ctx.arc(0, 0, 0.6, 0, TWO_PI); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /** Service tower and lightning masts, drawn over the smoke billowing behind them. */
  drawTower(f) {
    const ctx = this.ctx;
    const fade = 1 - smooth((f.h - 0.6) / 0.5);
    if (fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = fade;
    const k = this.padTransform(f);
    const px = 1 / k; // one screen pixel, in metres
    const lit = 1 - smooth((f.h - 0.05) / 0.3);
    ctx.strokeStyle = '#0b1322';
    ctx.lineWidth = 1.4 * px;
    ctx.beginPath();
    ctx.moveTo(-80, 10); ctx.lineTo(-80, -125);
    ctx.moveTo(62, 10); ctx.lineTo(62, -125);
    ctx.stroke();
    // tower: a dark lattice with its edges caught by the floodlights
    const x0 = -22, x1 = -12, top = -86;
    ctx.fillStyle = 'rgba(12,20,34,0.92)';
    ctx.fillRect(x0, top, x1 - x0, -top + 0.5);
    ctx.strokeStyle = rgba([150, 170, 205], 0.3 + 0.35 * lit);
    ctx.lineWidth = Math.max(0.35, 0.9 * px);
    ctx.beginPath();
    for (let y = 0; y > top; y -= 6) {
      ctx.moveTo(x0, y); ctx.lineTo(x1, y - 6);
      ctx.moveTo(x1, y); ctx.lineTo(x0, y - 6);
      ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    }
    ctx.moveTo(x0, 0); ctx.lineTo(x0, top);
    ctx.moveTo(x1, 0); ctx.lineTo(x1, top);
    ctx.stroke();
    ctx.fillStyle = '#0b1322';
    ctx.fillRect(-18.4, top - 14, 2.8, 14);
    // the crew access arm swings clear before ignition
    ctx.save();
    ctx.translate(x1, -64);
    ctx.rotate(-smooth(this.t / 0.5) * 1.25);
    ctx.fillStyle = '#1a2436';
    ctx.fillRect(0, -1.6, 10, 3.2);
    ctx.restore();
    if (Math.sin(this.t * 5) > 0) {
      ctx.fillStyle = '#ff4d3d';
      for (const [x, y] of [[-80, -126], [62, -126], [-17, top - 15]]) ctx.fillRect(x - 1.2 * px, y - 1.2 * px, 2.4 * px, 2.4 * px);
    }
    ctx.restore();
  }

  drawClouds(f, front) {
    const ctx = this.ctx, { W, H } = this;
    if (f.h > 16) return;
    const glow = this.glowPower(f);
    const nz = this.nozzleScreen(f);
    const gone = 1 - smooth((f.h - 11) / 5);
    for (const c of this.clouds) {
      if (!!c.front !== front) continue;
      const p = this.padPoint(f, c.a, c.b);
      const w = c.w * f.scale, h = w * (c.thin ? 0.18 : 0.42);
      if (w < 4 || p.x + w < 0 || p.x - w > W || p.y + h < -h || p.y - h > H + h) continue;
      const alpha = (c.thin ? 0.35 : 0.9) * gone;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(upAngle(f.up));
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.sprites.clouds[c.k], -w / 2, -h * 0.72, w, h);
      // undersides lit by the engines as we pass
      const warm = glow * Math.exp((-Math.hypot(nz.x - p.x, nz.y - p.y) / Math.max(w, 1)) * 1.6) * (c.thin ? 0.3 : 1);
      if (warm > 0.02) {
        ctx.globalAlpha = Math.min(1, warm) * alpha;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(this.sprites.cloudsWarm[c.k], -w / 2, -h * 0.72, w, h);
      }
      ctx.restore();
    }
  }

  drawTrail(f) {
    const ctx = this.ctx;
    const fade = 1 - smooth(f.k / 0.6);
    if (this.trail.length < 2 || fade <= 0) return;
    const pts = this.trail.map((b) => ({ ...this.toScreen(f, b.x, b.y), b }));
    const burning = (this.t > EV.liftoff && this.t < EV.meco) || (this.t > EV.s2 && this.t < EV.seco);
    if (burning) { const nz = this.nozzleScreen(f); pts.push({ ...nz, b: this.trail[this.trail.length - 1] }); }
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    const CH = 6;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < pts.length - 1; i += CH) {
        const b = pts[Math.min(i + CH, pts.length - 1)].b;
        const age = this.t - b.born;
        const life = 1 - smooth((age - 1.5) / 2.5);
        if (life <= 0) continue;
        const col = mixc([90, 110, 150], [255, 214, 190], b.lit);
        ctx.strokeStyle = rgba(col, (pass === 0 ? 0.06 + 0.1 * b.lit : 0.18 + 0.45 * b.lit) * life * fade);
        ctx.lineWidth = pass === 0 ? 5 + b.h * 0.02 : 1.4;
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        for (let j = i + 1; j <= Math.min(i + CH, pts.length - 1); j++) ctx.lineTo(pts[j].x, pts[j].y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawSmoke(f) {
    const ctx = this.ctx, { W, H } = this;
    if (!this.parts.length) return;
    const glow = this.glowPower(f);
    const nz = this.nozzleScreen(f);
    const reach = f.L0 * 0.9;
    const floods = 1 - smooth((f.h - 0.05) / 0.4);
    for (const p of this.parts) {
      const s = this.padPoint(f, p.a, p.b);
      const r = p.r * f.scale;
      if (r < 0.6 || s.x + r < 0 || s.x - r > W || s.y + r < 0 || s.y - r > H) continue;
      const k = p.life / p.max;
      const a = p.alpha * (1 - k) * Math.min(1, p.life * 6);
      ctx.globalAlpha = a * (p.column ? 0.9 : 0.55 + 0.45 * floods);
      ctx.drawImage(p.kind === 'white' ? this.sprites.white : this.sprites.smoke[p.v ?? 0], s.x - r, s.y - r, 2 * r, 2 * r);
      const warm = glow * Math.exp(-Math.hypot(s.x - nz.x, s.y - nz.y) / (p.column ? reach * 1.6 : reach));
      if (warm > 0.03) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, warm * a * 0.9);
        ctx.drawImage(this.sprites.warm, s.x - r, s.y - r, 2 * r, 2 * r);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.globalAlpha = 1;
  }

  /** How strongly the first stage engines light up their surroundings. */
  glowPower(f) {
    const t = this.t;
    if (t < EV.ignite || t > EV.meco + 0.1) return 0;
    return smooth((t - EV.ignite) / 0.25) * (1 - smooth((t - EV.meco) / 0.1)) * (0.35 + 0.65 * f.air);
  }

  // ---------------------------------------------------------------- the vehicle

  /** Put the stack's base at `anchor`, pointing along `axis`, in rocket units (the stack is 105 tall). */
  vehicleTransform(f, u, anchor = f.anchor, axis = f.axis) {
    const ctx = this.ctx;
    ctx.translate(anchor.x, anchor.y);
    ctx.rotate(upAngle(axis));
    ctx.scale(u, u);
  }

  /** Light on the vehicle right now: floodlights at the pad, then only the engines, then the Sun. */
  lighting(f) {
    const right = { x: -f.axis.y, y: f.axis.x };
    const sunSide = f.sunS.x * right.x + f.sunS.y * right.y;
    const pad = 1 - smooth((f.h - 0.05) / 0.4);
    const sunCol = mixc([255, 170, 110], [255, 240, 220], smooth((f.h - 60) / 200));
    return {
      ambient: mixc(mixc([38, 46, 70], [92, 102, 136], Math.exp(-f.h / 12)), [66, 78, 106], pad),
      key: pad > f.sunlit ? { dir: -0.35, col: [205, 220, 250], i: pad * 1.05 } : { dir: sunSide, col: sunCol, i: f.sunlit * 1.15 },
      warm: this.glowPower(f),
    };
  }

  /** Fill a cylinder-like part: shading across it from the key light, and engine glow from below. */
  shade(path, half, y0, y1, albedo, L) {
    const ctx = this.ctx;
    ctx.save();
    path();
    ctx.clip();
    const g = ctx.createLinearGradient(-half, 0, half, 0);
    for (let i = 0; i <= 6; i++) {
      const x = -1 + i / 3;
      const nz = Math.sqrt(Math.max(0, 1 - x * x));
      const lam = Math.max(0, x * L.key.dir * 0.9 + nz * 0.55);
      const spec = Math.max(0, x * L.key.dir * 0.8 + nz * 0.6) ** 12 * 0.5;
      g.addColorStop(i / 6, rgba([0, 1, 2].map((j) => (albedo[j] / 255) * (L.ambient[j] + L.key.col[j] * L.key.i * lam) + 255 * spec * L.key.i), 1));
    }
    ctx.fillStyle = g;
    ctx.fillRect(-half - 1, y0 - 1, 2 * half + 2, y1 - y0 + 2);
    if (L.warm > 0.02) {
      const w = ctx.createLinearGradient(0, 4, 0, -60);
      w.addColorStop(0, `rgba(255,150,70,${0.6 * L.warm})`);
      w.addColorStop(1, 'rgba(255,150,70,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = w;
      ctx.fillRect(-half - 1, y0 - 1, 2 * half + 2, y1 - y0 + 2);
    }
    ctx.restore();
  }

  drawVehicle(f) {
    const t = this.t;
    if (t >= EV.deploy) return;
    const ctx = this.ctx;
    const L = this.lighting(f);
    ctx.save();
    this.vehicleTransform(f, f.L / 104);
    if (t < EV.meco + 0.12) this.plume1(f);
    if (t > EV.s2 - 0.05 && t < EV.seco + 0.15) this.plume2(f);
    if (t < EV.sep) this.stage1(L);
    this.stage2(L, t > EV.sep);
    if (t < EV.fairing) this.fairing(L);
    else this.payload(L, 0, 0);
    if (t > EV.maxq - 0.25 && t < EV.maxq + 0.35) this.vaporCone(f);
    ctx.restore();
  }

  /** First stage plume: tight and bright with shock diamonds at sea level, blooming wide in thin air. */
  plume1(f) {
    const ctx = this.ctx, t = this.t;
    const on = smooth((t - EV.ignite) / 0.18) * (1 - smooth((t - EV.meco) / 0.1));
    if (on <= 0) return;
    const fl = 1 + wobble(t * 3, 2) * 0.06;
    const vac = f.vac, air = f.air;
    const y0 = 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // a big soft glow round the engines
    const gr = (42 + 50 * vac) * on;
    const glow = ctx.createRadialGradient(0, y0 + 8, 0, 0, y0 + 8, gr);
    glow.addColorStop(0, `rgba(255,190,110,${0.55 * on * (0.4 + 0.6 * air)})`);
    glow.addColorStop(0.4, `rgba(255,130,60,${0.2 * on * (0.3 + 0.7 * air)})`);
    glow.addColorStop(1, 'rgba(255,110,40,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-gr, y0 + 8 - gr, 2 * gr, 2 * gr);
    // ignition flash, green from the igniter fluid
    if (t < EV.ignite + 0.12) {
      const k = 1 - (t - EV.ignite) / 0.12;
      const gg = ctx.createRadialGradient(0, y0 + 4, 0, 0, y0 + 4, 26);
      gg.addColorStop(0, `rgba(140,255,170,${0.8 * k})`);
      gg.addColorStop(1, 'rgba(140,255,170,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(-26, y0 - 22, 52, 52);
    }
    // outer plume: a tight flame at sea level that balloons in thin air and glows pale once sunlit
    const len = (34 + 56 * vac) * on * fl;
    const spread = 5 + 26 * vac;
    const lit = f.sunlit * vac;
    const hue = mixc([255, 130, 55], [205, 222, 255], lit);
    const a0 = (0.55 - 0.25 * vac + 0.15 * lit) * on;
    softEllipse(ctx, 0, y0 + len * 0.42, spread, len * 0.58, [[0, hue, a0], [0.45, hue, a0 * 0.45], [1, hue, 0]]);
    softEllipse(ctx, 0, y0 + len * 0.16, 4 + spread * 0.35, len * 0.24, [[0, [255, 210, 140], 0.7 * on], [1, [255, 150, 70], 0]]);
    // hot core
    const clen = (15 + 5 * wobble(t * 4, 5)) * on * (1 - 0.4 * vac);
    const core = ctx.createLinearGradient(0, y0, 0, y0 + clen);
    core.addColorStop(0, `rgba(255,255,245,${0.95 * on})`);
    core.addColorStop(0.5, `rgba(255,230,160,${0.8 * on})`);
    core.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.moveTo(-4.2, y0);
    ctx.quadraticCurveTo(-3.8, y0 + clen * 0.6, 0, y0 + clen);
    ctx.quadraticCurveTo(3.8, y0 + clen * 0.6, 4.2, y0);
    ctx.fill();
    // shock diamonds, only in thick air
    const dia = air * on;
    if (dia > 0.05) {
      for (let i = 0; i < 4; i++) {
        const y = y0 + 4.5 + i * 4.6;
        const s = 2.6 - i * 0.45;
        ctx.fillStyle = `rgba(255,250,235,${(0.75 - i * 0.15) * dia})`;
        ctx.beginPath();
        ctx.moveTo(0, y - s * 1.2); ctx.lineTo(s * 0.7, y); ctx.lineTo(0, y + s * 1.2); ctx.lineTo(-s * 0.7, y);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Upper stage plume: a vacuum bell's wide, faint cone that glows once the Sun is on it. */
  plume2(f) {
    const ctx = this.ctx, t = this.t;
    const on = smooth((t - EV.s2) / 0.25) * (1 - smooth((t - EV.seco) / 0.15));
    if (on <= 0) return;
    const y0 = -53;
    const fl = 1 + wobble(t * 2.5, 9) * 0.05;
    const lit = f.sunlit;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (t < EV.s2 + 0.15) {
      const k = 1 - (t - EV.s2) / 0.15;
      const gg = ctx.createRadialGradient(0, y0 + 3, 0, 0, y0 + 3, 30);
      gg.addColorStop(0, `rgba(255,240,210,${0.9 * k})`);
      gg.addColorStop(1, 'rgba(255,200,150,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(-30, y0 - 27, 60, 60);
    }
    const len = 90 * on * fl;
    const spread = 30 + 14 * lit;
    const hue = mixc([255, 150, 120], [190, 212, 255], lit);
    softEllipse(ctx, 0, y0 + len * 0.45, spread, len * 0.55, [[0, hue, (0.16 + 0.12 * lit) * on], [0.5, hue, (0.06 + 0.06 * lit) * on], [1, hue, 0]]);
    softEllipse(ctx, 0, y0 + len * 0.14, 6 + spread * 0.25, len * 0.2, [[0, mixc([255, 200, 150], [240, 245, 255], lit), 0.55 * on], [1, hue, 0]]);
    // sunlit exhaust spreading into a faint luminous bell around the stage
    if (lit > 0.05) softEllipse(ctx, 0, y0 + len * 0.2, spread * 1.7, len * 0.75, [[0, [190, 215, 255], 0.09 * lit * on], [1, [190, 215, 255], 0]]);
    const core = ctx.createLinearGradient(0, y0, 0, y0 + 20);
    core.addColorStop(0, `rgba(255,250,240,${0.95 * on})`);
    core.addColorStop(1, 'rgba(200,210,255,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.moveTo(-3, y0);
    ctx.quadraticCurveTo(-2.5, y0 + 12, 0, y0 + 20);
    ctx.quadraticCurveTo(2.5, y0 + 12, 3, y0);
    ctx.fill();
    ctx.restore();
  }

  /** Condensation collar round the body as it goes through the sound barrier. */
  vaporCone(f) {
    const ctx = this.ctx, t = this.t;
    const k = Math.sin(clamp01((t - EV.maxq + 0.25) / 0.6) * Math.PI) * f.air ** 0.3;
    if (k <= 0.02) return;
    for (let i = 0; i < 2; i++) {
      const top = -58 + i * 16, flare = 7 + i * 3 + wobble(t * 3, i) * 0.8, len = 16 + i * 4;
      const g = ctx.createLinearGradient(0, top, 0, top + len);
      g.addColorStop(0, `rgba(235,240,250,${(0.5 - i * 0.15) * k})`);
      g.addColorStop(1, 'rgba(235,240,250,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-3.6, top);
      ctx.quadraticCurveTo(-flare * 0.8, top + len * 0.3, -flare, top + len);
      ctx.lineTo(flare, top + len);
      ctx.quadraticCurveTo(flare * 0.8, top + len * 0.3, 3.6, top);
      ctx.fill();
    }
  }

  stage1(L, loose = false) {
    const ctx = this.ctx;
    // engines in profile, below the thrust section
    ctx.fillStyle = '#20252f';
    for (const x of [-2.6, 0, 2.6]) {
      ctx.beginPath();
      ctx.moveTo(x - 0.8, -1.5); ctx.lineTo(x + 0.8, -1.5); ctx.lineTo(x + 1.25, 2); ctx.lineTo(x - 1.25, 2);
      ctx.fill();
    }
    this.shade(() => { ctx.beginPath(); ctx.rect(-3.4, -60, 6.8, 58.5); }, 3.4, -60, -1.5, CHALK, L);
    // thrust section band and folded landing legs
    ctx.fillStyle = 'rgba(20,26,38,0.85)';
    ctx.fillRect(-3.4, -4.5, 6.8, 3);
    ctx.fillRect(-3.4, -20, 1, 15.5);
    ctx.fillRect(2.4, -20, 1, 15.5);
    // the game's orbit mark
    ctx.strokeStyle = rgba(SHIP, 0.95);
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.ellipse(0, -36, 2.2, 1.1, -0.5, 0, TWO_PI);
    ctx.stroke();
    ctx.fillStyle = 'rgba(40,70,130,0.9)';
    ctx.beginPath(); ctx.arc(0, -36, 0.7, 0, TWO_PI); ctx.fill();
    // grid fins, folded until the stage is on its own
    ctx.fillStyle = '#2a3140';
    const out = loose ? 1.6 : 0.4;
    ctx.fillRect(-3.4 - out, -57, out, 2.2);
    ctx.fillRect(3.4, -57, out, 2.2);
    this.shade(() => { ctx.beginPath(); ctx.rect(-3.4, -67, 6.8, 7.2); }, 3.4, -67, -60, [60, 64, 74], L);
  }

  stage2(L, exposed) {
    const ctx = this.ctx, t = this.t;
    if (exposed) {
      // the vacuum bell glows while it fires and cools afterward
      const heat = t > EV.s2 ? smooth((t - EV.s2) / 0.8) * (1 - smooth((t - EV.seco - 0.2) / 1.6)) : 0;
      const g = ctx.createLinearGradient(0, -66, 0, -53);
      g.addColorStop(0, '#2a2f38');
      g.addColorStop(0.35, rgba(mixc([52, 56, 66], [255, 120, 50], heat * 0.6)));
      g.addColorStop(1, rgba(mixc([60, 62, 70], [255, 200, 120], heat)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-1, -67); ctx.lineTo(1, -67); ctx.lineTo(3.4, -53); ctx.lineTo(-3.4, -53);
      ctx.fill();
    }
    this.shade(() => { ctx.beginPath(); ctx.rect(-3.4, -86, 6.8, 19); }, 3.4, -86, -67, CHALK, L);
    ctx.fillStyle = 'rgba(20,26,38,0.7)';
    ctx.fillRect(-3.4, -79.5, 6.8, 0.8);
  }

  /** The payload fairing: both halves, or just one (-1 left, 1 right) when it falls away. */
  fairing(L, side = 0) {
    const ctx = this.ctx;
    const half = (s) => {
      ctx.beginPath();
      ctx.moveTo(0, -86);
      ctx.lineTo(s * 3.4, -86);
      ctx.lineTo(s * 4.4, -88.5);
      ctx.lineTo(s * 4.4, -95);
      ctx.bezierCurveTo(s * 4.4, -100, s * 2.6, -104, 0, -105);
      ctx.closePath();
    };
    for (const s of side ? [side] : [-1, 1]) this.shade(() => half(s), 4.4, -105, -86, CHALK, L);
    if (!side) {
      ctx.strokeStyle = 'rgba(20,26,38,0.45)';
      ctx.lineWidth = 0.25;
      ctx.beginPath(); ctx.moveTo(0, -86); ctx.lineTo(0, -105); ctx.stroke();
    }
  }

  /** Your craft: an amber body with folded (or unfolding) solar wings, sitting at y -87..-99. */
  payload(L, open, beacon) {
    const ctx = this.ctx;
    if (open > 0) {
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const k = clamp01(open * 3 - i);
          if (k <= 0) continue;
          const x = s * (3 + i * 4.2);
          const x0 = s > 0 ? x : x - 4 * k;
          ctx.fillStyle = rgba(mixc([40, 60, 110], [120, 150, 220], L.key.i * 0.6), 0.95);
          ctx.fillRect(x0, -94, 4 * k, 5);
          ctx.strokeStyle = 'rgba(200,215,255,0.35)';
          ctx.lineWidth = 0.2;
          ctx.strokeRect(x0, -94, 4 * k, 5);
        }
      }
    }
    this.shade(() => {
      ctx.beginPath();
      ctx.moveTo(-2.6, -87); ctx.lineTo(2.6, -87); ctx.lineTo(2.6, -95); ctx.lineTo(1.2, -99); ctx.lineTo(-1.2, -99); ctx.lineTo(-2.6, -95);
      ctx.closePath();
    }, 2.6, -99, -87, SHIP, L);
    if (beacon > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, -99.5, 0, 0, -99.5, 3);
      g.addColorStop(0, `rgba(255,220,160,${beacon})`);
      g.addColorStop(1, 'rgba(255,181,71,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-3, -102.5, 6, 6);
      ctx.restore();
    }
  }

  /** Spent hardware drifting away behind the vehicle from where it let go. */
  drawDebris(f) {
    const ctx = this.ctx, t = this.t;
    const u = f.L / 104;
    const L = this.lighting(f);
    const right = { x: -f.axis.y, y: f.axis.x };
    const piece = (since, pivotY, draw, { back, side = 0, spin = 0, fade = 2.6 }) => {
      const s = t - since;
      if (s < 0) return;
      const a = 1 - smooth((s - fade * 0.55) / (fade * 0.45));
      if (a <= 0) return;
      const along = back(s), across = side * s * 5;
      const at = { x: f.anchor.x + (-f.axis.x * along + right.x * across) * u, y: f.anchor.y + (-f.axis.y * along + right.y * across) * u };
      ctx.save();
      ctx.globalAlpha = a;
      this.vehicleTransform(f, u, at);
      ctx.translate(0, pivotY);
      ctx.rotate(spin * (s * s * 0.5 + s * 0.3));
      ctx.translate(0, -pivotY);
      draw(s);
      ctx.restore();
    };
    // first stage: nudged back, then falling away as it starts to flip
    piece(EV.sep, -32, (s) => {
      this.stage1(L, s > 0.4);
      if (s > 0.25 && s < 1.6 && Math.sin(s * 30) > -0.2) { // cold-gas thrusters turning it around
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(this.sprites.white, 3, -66, 5, 5);
        ctx.drawImage(this.sprites.white, -8, -66, 5, 5);
        ctx.globalCompositeOperation = 'source-over';
      }
    }, { back: (s) => 2 + s * 10 + s * s * 16, spin: -0.55 });
    // separation puffs at the joint
    if (t > EV.sep && t < EV.sep + 0.6) {
      const s = (t - EV.sep) / 0.6;
      ctx.save();
      this.vehicleTransform(f, u);
      ctx.globalAlpha = (1 - s) * 0.8;
      for (const x of [-1, 1]) {
        const r = 3 + s * 10;
        ctx.drawImage(this.sprites.white, x * (4 + s * 9) - r, -64 + s * 6 - r, 2 * r, 2 * r);
      }
      ctx.restore();
    }
    // fairing halves hinge open and tumble away, with a flicker of the separation charges
    for (const sd of [-1, 1]) piece(EV.fairing, -86, () => this.fairing(L, sd), { back: (s) => s * 6 + s * s * 16, side: sd * 1.6, spin: sd * 1.1, fade: 1.8 });
    if (t > EV.fairing && t < EV.fairing + 0.25) {
      ctx.save();
      this.vehicleTransform(f, u);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - (t - EV.fairing) / 0.25;
      for (let i = 0; i < 5; i++) ctx.drawImage(this.sprites.white, -2, -104 + i * 4, 4, 4);
      ctx.restore();
    }
    // the spent upper stage backs away from your craft
    piece(EV.deploy, -76, () => this.stage2(L, true), { back: (s) => 3 + s * 7 + s * s * 5, spin: 0.35, fade: 2.2 });
  }

  /** After separation: your craft on its own, then shrinking into the game's ship marker. */
  drawPayloadFree(f) {
    const t = this.t;
    if (t < EV.deploy) return;
    const ctx = this.ctx;
    const u = f.L / 104;
    const L = this.lighting(f);
    const s = t - EV.deploy;
    const k = f.k;
    // turn from the stack's axis to face prograde, the way the game's marker points
    const pro = this.dirToScreen(f.T, f.psi);
    const turn = smooth(s / 0.6);
    const nose = { x: lerp(f.axis.x, pro.x, turn), y: lerp(f.axis.y, pro.y, turn) };
    const nl = Math.hypot(nose.x, nose.y) || 1;
    nose.x /= nl; nose.y /= nl;
    // it rode 93 units up the stack; that offset closes as the camera settles on it
    const off = (93 + s * 5) * u * (1 - smooth(k / 0.55));
    const at = { x: f.anchor.x + f.axis.x * off, y: f.anchor.y + f.axis.y * off };
    const craft = 1 - smooth((k - 0.35) / 0.35);
    const lit = { ...L, ambient: [150, 138, 118], key: L.key.i > 0.4 ? L.key : { dir: -0.4, col: [120, 130, 160], i: 0.8 } };
    if (craft > 0) {
      ctx.save();
      ctx.globalAlpha = craft;
      this.vehicleTransform(f, u * lerp(1, 1.8, smooth(s / 0.5)) * lerp(1, 0.25, smooth(k / 0.55)), at, nose);
      ctx.translate(0, 93);
      this.payload(lit, smooth((s - 0.2) / 0.8), Math.max(0, Math.sin(t * 7)) ** 6);
      ctx.restore();
    }
    // the game's own ship marker takes over
    const mk = smooth((k - 0.45) / 0.4);
    if (mk > 0) {
      ctx.save();
      ctx.globalAlpha = mk;
      ctx.fillStyle = rgba(FIELD, 0.6);
      ctx.beginPath(); ctx.arc(at.x, at.y, 16, 0, TWO_PI); ctx.fill();
      ctx.strokeStyle = rgba(SHIP, 0.55);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(at.x, at.y, 16, 0, TWO_PI); ctx.stroke();
      ctx.translate(at.x, at.y);
      ctx.rotate(Math.atan2(nose.y, nose.x));
      ctx.beginPath();
      ctx.moveTo(13, 0); ctx.lineTo(-8, -8); ctx.lineTo(-3.5, 0); ctx.lineTo(-8, 8);
      ctx.closePath();
      ctx.fillStyle = rgba(SHIP);
      ctx.strokeStyle = rgba(FIELD);
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /** The orbit you're now on, traced out behind you as the camera pulls back. */
  drawOrbit(f) {
    const k = f.k;
    if (k <= 0.05) return;
    const ctx = this.ctx;
    const e = this.toScreen(f, 0, 0);
    const a0 = Math.atan2(f.anchor.y - e.y, f.anchor.x - e.x);
    const sweep = TWO_PI * smooth((k - 0.1) / 0.75);
    // canvas angles run clockwise, so a counter-clockwise orbit trails at increasing angles
    ctx.save();
    ctx.strokeStyle = rgba(SHIP, 0.95 * smooth((k - 0.05) / 0.3));
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, this.orbitR * f.scale, a0, a0 + this.dir * sweep, this.dir < 0);
    ctx.stroke();
    ctx.restore();
  }

  /** A gentle vignette that lifts as the game's view takes over. */
  drawGrade(f) {
    const ctx = this.ctx, { W, H } = this;
    const a = 0.45 * (1 - f.k);
    if (a <= 0.01) return;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, 'rgba(4,8,16,0)');
    g.addColorStop(1, `rgba(4,8,16,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------- heads-up text

  updateHud(f) {
    const t = this.t;
    const set = (key, el, text) => { if (this.shown[key] !== text) { this.shown[key] = text; el.textContent = text; } };
    let clock = t < EV.liftoff ? (t - EV.liftoff) * 6 : this.clock(t);
    const sign = clock < 0 ? '−' : '+';
    clock = Math.abs(clock);
    const hh = Math.floor(clock / 3600), mm = Math.floor((clock % 3600) / 60), ss = Math.floor(clock % 60);
    set('clock', this.elClock, `T${sign} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);
    const stage = STAGES.filter((s) => t >= s.at).pop();
    if (this.shown.stage !== stage) {
      this.shown.stage = stage;
      this.elTitle.textContent = stage.title;
      this.elSub.textContent = this.subs[stage.at] ?? stage.sub;
      for (const el of [this.elTitle, this.elSub]) {
        el.classList.remove('lh-in');
        void el.offsetWidth; // restart the entrance animation
        el.classList.add('lh-in');
      }
    }
    const alt = t < EV.deploy ? f.h : this.orbitAlt;
    set('alt', this.elAlt, alt < 1 ? `${Math.round(alt * 1000)} m` : `${Math.round(alt)} km`);
    const v = t < EV.deploy ? P.speed(t) : this.orbitV;
    set('speed', this.elSpeed, v < 1 ? `${Math.round(v * 1000)} m/s` : `${v.toFixed(2)} km/s`);
    const pct = `${Math.min(100, (t / EV.deploy) * 100).toFixed(1)}%`;
    if (this.shown.pct !== pct) { this.shown.pct = pct; this.elFill.style.width = pct; }
    const current = stage.at === EV.s2 ? EV.meco : stage.at;
    for (const tk of this.ticks) {
      const done = t >= tk.at, now = current === tk.at;
      if (tk.done !== done) { tk.done = done; tk.el.classList.toggle('done', done); }
      if (tk.now !== now) { tk.now = now; tk.el.classList.toggle('now', now); }
    }
    const out = f.k > 0.3;
    if (this.shown.out !== out) { this.shown.out = out; this.hud.classList.toggle('out', out); }
  }
}
