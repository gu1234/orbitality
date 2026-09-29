// Solar system on rails: every body follows a fixed Kepler orbit around its parent,
// a circle for the planets and moons and an ellipse for the dwarf planets and
// asteroids. Orbital speeds are derived from the parent's GM so patched-conic
// hand-offs are consistent (absolute velocity is continuous across SOI boundaries).
//
// Everything is at real scale: distances, radii and GM are real values. Orbits are
// flattened into the plane of the ecliptic, so a moon whose orbit is tipped over
// with its planet (Uranus's moons, Triton, Charon) circles clockwise seen from above.

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

// Small bodies sit where they really are relative to the giant planet that shapes their
// orbits. The game's Neptune is at 290°, where the real one was at 304.88° on 1 Jan 2000,
// so the Kuiper belt objects are turned by the same amount: that keeps Pluto in its real
// 3:2 resonance, well clear of Neptune although its orbit dips inside Neptune's.
const NEP = 290 - 304.88;
const JUP = 140 - 34.4; // the same for Jupiter and the asteroid belt

// rank: 0 planets (always labelled first), 1 big moons and dwarf planets, 2 the rest
// kind: star | planet | moon | dwarf | asteroid
// e, peri (longitude of periapsis, deg): elliptical rails; phase is then the mean longitude
// dir: -1 for an orbit that runs clockwise seen from above
// note: one line shown when the player focuses the body
const DATA = [
  // name, parent, a (km), GM (km^3/s^2), radius (km), colour, phase0 (deg), min px, atmosphere colour
  { name: 'Sun', parent: null, a: 0, gm: 1.32712440018e11, radius: 695700, color: '#ffcf5a', minPx: 7, kind: 'star' },
  { name: 'Mercury', parent: 'Sun', a: 57.909e6, gm: 22032, radius: 2439.7, color: '#a6a3a0', phase: 200, minPx: 2.5, kind: 'planet' },
  { name: 'Venus', parent: 'Sun', a: 108.21e6, gm: 324859, radius: 6051.8, color: '#e5be80', phase: 310, minPx: 3, kind: 'planet' },
  { name: 'Earth', parent: 'Sun', a: 149.598e6, gm: 398600.4418, radius: 6371, color: '#3f7fdc', phase: 0, minPx: 3.5, atmo: '#6fb6ff', kind: 'planet' },
  { name: 'Moon', parent: 'Earth', a: 384400, gm: 4902.8, radius: 1737.4, color: '#b9b6b0', phase: 90, minPx: 2.5, kind: 'moon' },
  { name: 'Mars', parent: 'Sun', a: 227.939e6, gm: 42828.4, radius: 3389.5, color: '#c8603f', phase: 60, minPx: 3, atmo: '#e59a78', kind: 'planet' },
  { name: 'Jupiter', parent: 'Sun', a: 778.57e6, gm: 126686534, radius: 69911, color: '#c9b79c', phase: 140, minPx: 4.5, kind: 'planet' },
  { name: 'Saturn', parent: 'Sun', a: 1433.53e6, gm: 37931187, radius: 58232, color: '#d8c79a', phase: 250, minPx: 4, kind: 'planet' },
  { name: 'Uranus', parent: 'Sun', a: 2872.46e6, gm: 5793939, radius: 25362, color: '#acdfe6', phase: 30, minPx: 3.5, kind: 'planet' },
  { name: 'Neptune', parent: 'Sun', a: 4495.06e6, gm: 6836529, radius: 24622, color: '#5577db', phase: 290, minPx: 3.5, kind: 'planet' },

  // Mars: two captured-asteroid moons, too small to orbit
  { name: 'Phobos', parent: 'Mars', a: 9376, gm: 7.087e-4, radius: 11.1, color: '#8a7b6c', phase: 30, minPx: 1.6, kind: 'moon', rank: 2,
    note: 'Its sphere of influence lies below its own surface, so nothing can orbit it' },
  { name: 'Deimos', parent: 'Mars', a: 23463.2, gm: 9.62e-5, radius: 6.2, color: '#9c8c7a', phase: 250, minPx: 1.6, kind: 'moon', rank: 2,
    note: 'Mars\'s outer moon, only 12 km across' },

  // Jupiter: the Galilean moons, placed in their Laplace resonance (Io − 3 Europa + 2 Ganymede = 180°)
  { name: 'Io', parent: 'Jupiter', a: 421700, gm: 5959.916, radius: 1821.6, color: '#dcc561', phase: 20, minPx: 2, kind: 'moon', rank: 1,
    note: 'The most volcanic world in the Solar System' },
  { name: 'Europa', parent: 'Jupiter', a: 671034, gm: 3202.739, radius: 1560.8, color: '#d2c3a4', phase: 110, minPx: 2, kind: 'moon', rank: 1,
    note: 'An ice shell over a hidden ocean. Io, Europa and Ganymede orbit in step, 4 : 2 : 1' },
  { name: 'Ganymede', parent: 'Jupiter', a: 1070412, gm: 9887.834, radius: 2634.1, color: '#a09383', phase: 245, minPx: 2, kind: 'moon', rank: 1,
    note: 'The largest moon in the Solar System, bigger than Mercury' },
  { name: 'Callisto', parent: 'Jupiter', a: 1882709, gm: 7179.289, radius: 2410.3, color: '#71665a', phase: 330, minPx: 2, kind: 'moon', rank: 1,
    note: 'The most heavily cratered world known' },

  // Saturn
  { name: 'Mimas', parent: 'Saturn', a: 185539, gm: 2.5026, radius: 198.2, color: '#bab6af', phase: 40, minPx: 1.6, kind: 'moon', rank: 2,
    note: 'One crater covers a third of its face. Too small to orbit this close to Saturn' },
  { name: 'Enceladus', parent: 'Saturn', a: 237948, gm: 7.2027, radius: 252.1, color: '#eef2f4', phase: 150, minPx: 1.6, kind: 'moon', rank: 2,
    note: 'Geysers at its south pole feed Saturn\'s E ring' },
  { name: 'Tethys', parent: 'Saturn', a: 294619, gm: 41.2067, radius: 531.1, color: '#dcd9d2', phase: 260, minPx: 1.6, kind: 'moon', rank: 2,
    note: 'Made almost entirely of water ice' },
  { name: 'Dione', parent: 'Saturn', a: 377396, gm: 73.1146, radius: 561.4, color: '#cbc7be', phase: 10, minPx: 1.6, kind: 'moon', rank: 2,
    note: 'Shares its orbit with two tiny moons, 60° ahead and behind' },
  { name: 'Rhea', parent: 'Saturn', a: 527108, gm: 153.9426, radius: 763.8, color: '#c4bfb6', phase: 300, minPx: 1.6, kind: 'moon', rank: 2,
    note: 'Saturn\'s second-largest moon' },
  { name: 'Titan', parent: 'Saturn', a: 1221870, gm: 8978.1382, radius: 2574.7, color: '#d9a650', phase: 200, minPx: 2, atmo: '#e8b867', kind: 'moon', rank: 1,
    note: 'The only moon with a thick atmosphere, and lakes of liquid methane' },
  { name: 'Iapetus', parent: 'Saturn', a: 3560820, gm: 120.5038, radius: 734.5, color: '#8f806c', phase: 90, minPx: 1.6, kind: 'moon', rank: 2,
    note: 'One side is as dark as coal, the other as bright as snow' },

  // Uranus lies on its side and its moons orbit over its equator, so seen from above they run clockwise
  { name: 'Miranda', parent: 'Uranus', a: 129390, gm: 4.3, radius: 235.8, color: '#b8b5b0', phase: 60, minPx: 1.6, kind: 'moon', rank: 2, dir: -1,
    note: 'A patchwork world with cliffs 20 km high' },
  { name: 'Ariel', parent: 'Uranus', a: 190900, gm: 83.43, radius: 578.9, color: '#c6c2bb', phase: 170, minPx: 1.6, kind: 'moon', rank: 2, dir: -1,
    note: 'The brightest of Uranus\'s moons' },
  { name: 'Umbriel', parent: 'Uranus', a: 266000, gm: 85.09, radius: 584.7, color: '#817d77', phase: 280, minPx: 1.6, kind: 'moon', rank: 2, dir: -1,
    note: 'The darkest of Uranus\'s big moons' },
  { name: 'Titania', parent: 'Uranus', a: 435910, gm: 226.94, radius: 788.4, color: '#b5a99c', phase: 20, minPx: 1.8, kind: 'moon', rank: 2, dir: -1,
    note: 'Uranus\'s largest moon. Uranus is tipped on its side, so its moons circle clockwise here' },
  { name: 'Oberon', parent: 'Uranus', a: 583520, gm: 205.32, radius: 761.4, color: '#a39588', phase: 220, minPx: 1.8, kind: 'moon', rank: 2, dir: -1,
    note: 'The outermost of Uranus\'s big moons' },

  // Neptune
  { name: 'Triton', parent: 'Neptune', a: 354759, gm: 1427.598, radius: 1353.4, color: '#cbbab2', phase: 120, minPx: 2, kind: 'moon', rank: 1, dir: -1,
    note: 'Orbits backwards, so it is probably a captured dwarf planet' },

  // the asteroid belt
  { name: 'Ceres', parent: 'Sun', a: 413.8e6, gm: 62.6284, radius: 469.7, color: '#8e8a84', phase: 30, e: 0.0785, peri: 153.9 + JUP, minPx: 2, kind: 'dwarf', rank: 1,
    note: 'The largest body in the asteroid belt, round enough to be a dwarf planet' },
  { name: 'Vesta', parent: 'Sun', a: 353.3e6, gm: 17.288, radius: 262.7, color: '#aaa49c', phase: 120, e: 0.0887, peri: 255 + JUP, minPx: 1.6, kind: 'asteroid', rank: 2,
    note: 'The brightest asteroid, sometimes visible to the naked eye' },
  { name: 'Pallas', parent: 'Sun', a: 414.8e6, gm: 13.63, radius: 256, color: '#918d87', phase: 200, e: 0.2302, peri: 123 + JUP, minPx: 1.6, kind: 'asteroid', rank: 2,
    note: 'Its orbit is tilted 35°, flattened here into the plane of the planets' },
  { name: 'Hygiea', parent: 'Sun', a: 470.0e6, gm: 5.83, radius: 217, color: '#716d68', phase: 280, e: 0.1125, peri: 235.5 + JUP, minPx: 1.6, kind: 'asteroid', rank: 2,
    note: 'The fourth-largest asteroid, and nearly round' },

  // the Kuiper belt and beyond (J2000 mean longitudes and perihelia, turned with Neptune)
  { name: 'Pluto', parent: 'Sun', a: 5906.4e6, gm: 869.6, radius: 1188.3, color: '#d6bf9e', phase: 238.93 + NEP, e: 0.2488, peri: 224.07 + NEP, minPx: 2.2, kind: 'dwarf', rank: 1,
    note: 'Dips inside Neptune\'s orbit, but a 3:2 resonance keeps the two far apart' },
  { name: 'Charon', parent: 'Pluto', a: 19591, gm: 105.88, radius: 606, color: '#9f978f', phase: 0, minPx: 1.6, kind: 'moon', rank: 1, dir: -1,
    note: 'Half the size of Pluto. Both always keep the same face to each other' },
  { name: 'Haumea', parent: 'Sun', a: 6452e6, gm: 267.4, radius: 780, color: '#e2ded7', phase: 192.3 + NEP, e: 0.191, peri: 0.9 + NEP, minPx: 1.8, kind: 'dwarf', rank: 1,
    note: 'Spins once every 4 hours, which stretches it into an egg shape' },
  { name: 'Makemake', parent: 'Sun', a: 6796e6, gm: 206.9, radius: 715, color: '#c98e6c', phase: 154.4 + NEP, e: 0.161, peri: 14.4 + NEP, minPx: 1.8, kind: 'dwarf', rank: 1,
    note: 'A reddish dwarf planet out in the Kuiper belt' },
  { name: 'Eris', parent: 'Sun', a: 10125e6, gm: 1108, radius: 1163, color: '#e7e4dd', phase: 21.4 + NEP, e: 0.4407, peri: 187.6 + NEP, minPx: 2, kind: 'dwarf', rank: 1,
    note: 'Almost as big as Pluto. Finding it is why "dwarf planet" was defined' },
];

// a small body whose sphere of influence ends this close to (or inside) its surface can be hit but not orbited
const TINY_SOI = 1.5;

const wrapPi = (a) => a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
const tmp = { x: 0, y: 0 };

export class Body {
  constructor(d) {
    this.name = d.name;
    this.id = d.name.toLowerCase();
    this.a = d.a;
    this.gm = d.gm;
    this.radius = d.radius;
    this.color = d.color;
    this.atmo = d.atmo || null;
    this.minPx = d.minPx;
    this.phase0 = ((d.phase || 0) * Math.PI) / 180; // mean longitude at t = 0
    this.e = d.e || 0;
    this.peri = (d.peri || 0) * DEG; // longitude of periapsis
    this.dir = d.dir || 1; // +1 counter-clockwise seen from above, -1 clockwise
    this.kind = d.kind;
    this.rank = d.rank ?? 0;
    this.note = d.note || null;
    this.parent = null;
    this.children = [];
    this.soi = Infinity;
    this.tiny = false; // SOI at the surface: the ship can hit it but not orbit it
    this.n = 0; // mean motion (rad/s)
    this.speed = 0; // orbital speed around parent (km/s); the fastest, at periapsis, on an ellipse
    this.rMin = 0; // closest and furthest distance from the parent
    this.rMax = 0;
    this.orbit = null; // the rails as a conic: { a, e, p, dir, argPe, rp, ra }
    this.depth = 0;
    this._t = NaN; // time of the cached elliptic state
    this._s = { x: 0, y: 0, vx: 0, vy: 0, th: 0 };
  }

  /** Mean longitude at time t (the actual angle on a circular orbit). */
  meanLon(t) {
    return this.phase0 + this.dir * this.n * t;
  }

  /** Angle of the body around its parent at time t. */
  angle(t) {
    return this.e ? this.solve(t).th : this.meanLon(t);
  }

  /** State on elliptical rails at time t (Kepler's equation), cached for the last t asked. */
  solve(t) {
    const s = this._s;
    if (t === this._t) return s;
    const e = this.e;
    const M = wrapPi(this.dir * (this.meanLon(t) - this.peri));
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 30; i++) {
      const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= d;
      if (Math.abs(d) < 1e-13) break;
    }
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    const r = this.a * (1 - e * Math.cos(E));
    const th = this.peri + this.dir * nu;
    const k = Math.sqrt(this.parent.gm / this.orbit.p);
    const vr = k * e * Math.sin(nu), vt = k * (1 + e * Math.cos(nu));
    const c = Math.cos(th), sn = Math.sin(th);
    s.x = r * c;
    s.y = r * sn;
    s.vx = vr * c - this.dir * vt * sn;
    s.vy = vr * sn + this.dir * vt * c;
    s.th = th;
    this._t = t;
    return s;
  }

  /** Position relative to parent at time t. */
  relPos(t, out = { x: 0, y: 0 }) {
    if (!this.parent) { out.x = 0; out.y = 0; return out; }
    if (this.e) {
      const s = this.solve(t);
      out.x = s.x; out.y = s.y;
      return out;
    }
    const th = this.meanLon(t);
    out.x = this.a * Math.cos(th);
    out.y = this.a * Math.sin(th);
    return out;
  }

  /** Velocity relative to parent at time t. */
  relVel(t, out = { x: 0, y: 0 }) {
    if (!this.parent) { out.x = 0; out.y = 0; return out; }
    if (this.e) {
      const s = this.solve(t);
      out.x = s.vx; out.y = s.vy;
      return out;
    }
    const th = this.meanLon(t);
    const v = this.dir * this.speed;
    out.x = -v * Math.sin(th);
    out.y = v * Math.cos(th);
    return out;
  }

  /** Absolute (heliocentric) position at time t. */
  absPos(t, out = { x: 0, y: 0 }) {
    let x = 0, y = 0;
    for (let b = this; b.parent; b = b.parent) {
      b.relPos(t, tmp);
      x += tmp.x;
      y += tmp.y;
    }
    out.x = x; out.y = y;
    return out;
  }

  /** Absolute (heliocentric) velocity at time t. */
  absVel(t, out = { x: 0, y: 0 }) {
    let x = 0, y = 0;
    for (let b = this; b.parent; b = b.parent) {
      b.relVel(t, tmp);
      x += tmp.x;
      y += tmp.y;
    }
    out.x = x; out.y = y;
    return out;
  }

  /** True if `other` is this body or one of its ancestors. */
  isWithin(other) {
    for (let b = this; b; b = b.parent) if (b === other) return true;
    return false;
  }

  /**
   * At this zoom (px per km), is the body lost in its parent's disc? Such bodies are
   * neither drawn nor tappable. Planets are always shown.
   */
  collapsed(scale) {
    const p = this.parent;
    if (!p || (this.kind === 'planet')) return false;
    return this.rMax * scale < Math.max(p.radius * scale, p.minPx) + 4;
  }

  /** Set the phase so the body sits at angle `deg` (degrees) around its parent at time t. */
  setAngleAt(deg, t) {
    let L = deg * DEG;
    if (this.e) {
      // true anomaly -> mean anomaly, then back to a mean longitude
      const e = this.e;
      const nu = this.dir * (L - this.peri);
      const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
      L = this.peri + this.dir * (E - e * Math.sin(E));
    }
    this.phase0 = L - this.dir * this.n * t;
    this._t = NaN;
  }

  /** "moon of Jupiter", "dwarf planet", ... */
  describe() {
    if (this.kind === 'moon') return `moon of ${this.parent.name}`;
    if (this.kind === 'dwarf') return 'dwarf planet';
    return this.kind;
  }
}

/** Build a fresh solar system (bodies carry mutable phases, so each level gets its own). */
export function createSystem() {
  const bodies = DATA.map((d) => new Body(d));
  const byId = Object.fromEntries(bodies.map((b) => [b.id, b]));
  DATA.forEach((d, i) => {
    const b = bodies[i];
    if (d.parent) {
      const p = byId[d.parent.toLowerCase()];
      b.parent = p;
      p.children.push(b);
      b.depth = p.depth + 1;
      const e = b.e;
      const pp = b.a * (1 - e * e);
      b.n = Math.sqrt(p.gm / (b.a * b.a * b.a));
      b.speed = Math.sqrt(p.gm / pp) * (1 + e);
      b.rMin = b.a * (1 - e);
      b.rMax = b.a * (1 + e);
      b.orbit = { a: b.a, e, p: pp, dir: b.dir, argPe: b.peri, rp: b.rMin, ra: b.rMax };
      b.soi = b.a * Math.pow(b.gm / p.gm, 0.4);
      if (b.soi < TINY_SOI * b.radius) {
        b.tiny = true;
        b.soi = b.radius;
      }
    }
  });
  return { bodies, byId, root: byId.sun };
}

export { TWO_PI };
