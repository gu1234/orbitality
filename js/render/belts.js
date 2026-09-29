// The Solar System's small bodies as a field of faint dots, each on its own Kepler
// orbit around the Sun: the main asteroid belt, the Hildas and Trojans that Jupiter
// herds, and the Kuiper belt with its plutinos and scattered disc.
//
// They are a sample for the eye, not physics: no gravity, and they can't be hit or
// focused. Each dot stands for thousands of real objects, and dots are never drawn
// bigger than a pixel or two. From afar that gives the familiar band; zoom in and the
// belt shows what it really is, almost entirely empty space (real asteroids are
// typically a million km apart).
//
// Resonant groups keep their real geometry: plutinos (like Pluto) go round twice
// while Neptune goes round three times and are never near it at perihelion; Hildas go
// round three times for Jupiter's two and trace a triangle; Trojans share Jupiter's
// orbit 60° ahead of and behind it.

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;
const AU = 149.5978707e6; // km
const YEAR = 365.25 * 86400;

/** Deterministic PRNG so every player sees the same belts. */
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// muted so the belts stay in the background: rock and ice, both close to the sky's blue-grey
const DUST = [178, 176, 168];
const ICE = [150, 170, 196];

// Kirkwood gaps: resonances with Jupiter (4:1 3:1 5:2 7:3 2:1) that Jupiter has swept clear (AU, half width)
const KIRKWOOD = [[2.065, 0.02], [2.502, 0.025], [2.825, 0.012], [2.958, 0.01], [3.279, 0.03]];

/**
 * A group of dots. Kepler dots have fixed ellipses (el = [a, b, e, cosPeri, sinPeri, n, M0]);
 * Trojan dots ride along with Jupiter (tr = [r, offset, libration amplitude, libration phase]).
 */
class Group {
  constructor(name, color, alpha, labelR) {
    this.name = name;
    this.color = color;
    this.alpha = alpha;
    this.labelR = labelR; // km from the Sun where the label goes
    this.el = [];
    this.tr = [];
    this.rIn = Infinity;
    this.rOut = 0;
    this.iters = 3;
    this.xs = null;
    this.ys = null;
  }

  addKepler(mu, a, e, peri, M0) {
    const n = Math.sqrt(mu / (a * a * a));
    this.el.push(a, a * Math.sqrt(1 - e * e), e, Math.cos(peri), Math.sin(peri), n, M0);
    this.rIn = Math.min(this.rIn, a * (1 - e));
    this.rOut = Math.max(this.rOut, a * (1 + e));
    if (e > 0.3) this.iters = 6;
  }

  addTrojan(r, offset, amp, ph) {
    this.tr.push(r, offset, amp, ph);
    this.rIn = Math.min(this.rIn, r);
    this.rOut = Math.max(this.rOut, r);
  }

  get count() { return this.el.length / 7 + this.tr.length / 4; }

  /** Heliocentric positions at time t into xs/ys. */
  positions(t, jupiterLon) {
    const N = this.count;
    if (!this.xs) { this.xs = new Float64Array(N); this.ys = new Float64Array(N); }
    const { xs, ys, el, tr } = this;
    let k = 0;
    for (let i = 0; i < el.length; i += 7, k++) {
      const a = el[i], b = el[i + 1], e = el[i + 2], cp = el[i + 3], sp = el[i + 4];
      let M = (el[i + 6] + el[i + 5] * t) % TWO_PI;
      let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
      for (let j = 0; j < this.iters; j++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      const px = a * (Math.cos(E) - e), py = b * Math.sin(E);
      xs[k] = px * cp - py * sp;
      ys[k] = px * sp + py * cp;
    }
    const lib = (TWO_PI * t) / (150 * YEAR); // Trojans librate about L4/L5 every ~150 years
    for (let i = 0; i < tr.length; i += 4, k++) {
      const th = jupiterLon + tr[i + 1] + tr[i + 2] * Math.sin(lib + tr[i + 3]);
      xs[k] = tr[i] * Math.cos(th);
      ys[k] = tr[i] * Math.sin(th);
    }
  }
}

/** Build the belts for a system (resonant groups are phased against its Jupiter and Neptune). */
function build(sys) {
  const rnd = mulberry32(20260929);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(TWO_PI * rnd());
  const mu = sys.root.gm;
  const J = sys.byId.jupiter, N = sys.byId.neptune;
  const lamJ = J.meanLon(0), lamN = N.meanLon(0);
  const groups = [];

  // main belt: 2.1–3.3 AU, densest near 2.7, with the Kirkwood gaps
  const main = new Group('Asteroid belt', DUST, 0.24, 2.75 * AU);
  while (main.count < 2600) {
    const a = 2.06 + 1.24 * rnd();
    if (rnd() > Math.pow(Math.sin((Math.PI * (a - 2.06)) / 1.24), 0.7)) continue;
    if (KIRKWOOD.some(([g, w]) => Math.abs(a - g) < w)) continue;
    const e = Math.min(0.33, Math.abs(0.1 + 0.07 * gauss()));
    main.addKepler(mu, a * AU, e, TWO_PI * rnd(), TWO_PI * rnd());
  }
  groups.push(main);

  // Hildas: 3:2 with Jupiter. The resonant angle 3λJ − 2λ − ϖ stays near 0, so their
  // aphelia fall 60°, 180° and 300° from Jupiter: a slowly turning triangle.
  const hildas = new Group('Hildas', DUST, 0.2, 4.45 * AU);
  const aH = J.a * Math.pow(2 / 3, 2 / 3);
  for (let i = 0; i < 350; i++) {
    const lam = TWO_PI * rnd();
    const phi = 18 * DEG * gauss();
    const peri = 3 * lamJ - 2 * lam - phi;
    hildas.addKepler(mu, aH, 0.08 + 0.17 * rnd(), peri, lam - peri);
  }
  groups.push(hildas);

  // Jupiter's Trojans, 60° ahead (L4, the bigger swarm) and behind (L5)
  const trojans = new Group('Trojans', DUST, 0.2, J.a);
  for (let i = 0; i < 600; i++) {
    const off = (i < 350 ? 60 : -60) * DEG + 9 * DEG * gauss();
    trojans.addTrojan(J.a * (1 + 0.035 * gauss()), off, 18 * DEG * rnd(), TWO_PI * rnd());
  }
  groups.push(trojans);

  // Kuiper belt: the classical belt out to the 2:1 edge at 47.7 AU...
  const kuiper = new Group('Kuiper belt', ICE, 0.26, 44 * AU);
  for (let i = 0; i < 1300; i++) {
    const a = 42 + 5.7 * rnd();
    const e = rnd() < 0.7 ? 0.08 * rnd() : 0.08 + 0.14 * rnd();
    kuiper.addKepler(mu, a * AU, e, TWO_PI * rnd(), TWO_PI * rnd());
  }
  // ...plutinos, in Pluto's 3:2 resonance with Neptune: 3λ − 2λN − ϖ stays near 180°,
  // so they reach perihelion 90° away from Neptune and never meet it...
  const aP = N.a * Math.pow(3 / 2, 2 / 3);
  for (let i = 0; i < 450; i++) {
    const lam = TWO_PI * rnd();
    const phi = Math.PI + 35 * DEG * gauss();
    const peri = 3 * lam - 2 * lamN - phi;
    kuiper.addKepler(mu, aP, 0.1 + 0.2 * rnd(), peri, lam - peri);
  }
  // ...and the scattered disc: perihelia near Neptune, aphelia far out
  for (let i = 0; i < 350; i++) {
    const q = 33 + 7 * rnd();
    const a = 50 * Math.pow(90 / 50, rnd());
    kuiper.addKepler(mu, a * AU, 1 - q / a, TWO_PI * rnd(), TWO_PI * rnd());
  }
  groups.push(kuiper);
  return groups;
}

export class Belts {
  constructor() {
    this.cache = new WeakMap(); // system -> groups
  }

  groups(sys) {
    let g = this.cache.get(sys);
    if (!g) { g = build(sys); this.cache.set(sys, g); }
    return g;
  }

  /**
   * Draw the dots under everything else. Returns labels for the groups that are in
   * a good size range on screen: [{ text, x, y }].
   */
  draw(ctx, world, cam, w, h, dpr) {
    const labels = [];
    const t = world.t;
    const s = cam.scale;
    const lamJ = world.sys.byId.jupiter.angle(t);
    const halfDiag = Math.hypot(w, h) / 2 / s;
    const dc = Math.hypot(cam.cx, cam.cy); // screen centre's distance from the Sun (km)
    const size = 1; // CSS px: a speck, never more
    const ox = w / 2 - cam.cx * s, oy = h / 2 + cam.cy * s; // the Sun on screen
    for (const g of this.groups(world.sys)) {
      if (g.rOut * s < 14) continue; // lost in the Sun's glare
      if (dc + halfDiag < g.rIn || dc - halfDiag > g.rOut) continue; // not on screen
      g.positions(t, lamJ);
      // fade in as the band grows from a smudge into a ring
      const k = Math.min(1, (g.rOut * s - 14) / 40);
      const [r, gg, b] = g.color;
      ctx.fillStyle = `rgba(${r},${gg},${b},${g.alpha * k})`;
      ctx.beginPath();
      const { xs, ys } = g;
      for (let i = 0; i < xs.length; i++) {
        const x = ox + xs[i] * s, y = oy - ys[i] * s;
        if (x < -2 || y < -2 || x > w + 2 || y > h + 2) continue;
        ctx.rect(x - size / 2, y - size / 2, size, size);
      }
      ctx.fill();

      const lr = g.labelR * s;
      if (lr < 70 || lr > 4000) continue;
      let th;
      if (g.name === 'Trojans') th = [lamJ + 60 * DEG, lamJ - 60 * DEG];
      else if (g.name === 'Hildas') th = [lamJ + 180 * DEG];
      else th = [dc > g.labelR * 0.25 ? Math.atan2(cam.cy, cam.cx) : 62 * DEG];
      for (const a of th) {
        const x = ox + g.labelR * Math.cos(a) * s, y = oy - g.labelR * Math.sin(a) * s;
        if (x > 8 && y > 14 && x < w - 60 && y < h - 14) labels.push({ text: g.name, x, y });
      }
    }
    return labels;
  }
}
