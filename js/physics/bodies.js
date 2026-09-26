// Solar system on rails: every body moves on a circular orbit around its parent.
// Orbital speeds are derived from the parent's GM so patched-conic hand-offs are
// consistent (absolute velocity is continuous across SOI boundaries).

const TWO_PI = Math.PI * 2;

const DATA = [
  // name, parent, a (km), GM (km^3/s^2), radius (km), colour, phase0 (deg), min px, atmosphere colour
  { name: 'Sun', parent: null, a: 0, gm: 1.32712440018e11, radius: 695700, color: '#ffcf5a', minPx: 7 },
  { name: 'Mercury', parent: 'Sun', a: 57.909e6, gm: 22032, radius: 2439.7, color: '#a6a3a0', phase: 200, minPx: 2.5 },
  { name: 'Venus', parent: 'Sun', a: 108.21e6, gm: 324859, radius: 6051.8, color: '#e5be80', phase: 310, minPx: 3 },
  { name: 'Earth', parent: 'Sun', a: 149.598e6, gm: 398600.4418, radius: 6371, color: '#3f7fdc', phase: 0, minPx: 3.5, atmo: '#6fb6ff' },
  { name: 'Moon', parent: 'Earth', a: 384400, gm: 4902.8, radius: 1737.4, color: '#b9b6b0', phase: 90, minPx: 2.5 },
  { name: 'Mars', parent: 'Sun', a: 227.939e6, gm: 42828.4, radius: 3389.5, color: '#c8603f', phase: 60, minPx: 3, atmo: '#e59a78' },
  { name: 'Jupiter', parent: 'Sun', a: 778.57e6, gm: 126686534, radius: 69911, color: '#c9b79c', phase: 140, minPx: 4.5 },
  { name: 'Saturn', parent: 'Sun', a: 1433.53e6, gm: 37931187, radius: 58232, color: '#d8c79a', phase: 250, minPx: 4 },
  { name: 'Uranus', parent: 'Sun', a: 2872.46e6, gm: 5793939, radius: 25362, color: '#acdfe6', phase: 30, minPx: 3.5 },
  { name: 'Neptune', parent: 'Sun', a: 4495.06e6, gm: 6836529, radius: 24622, color: '#5577db', phase: 290, minPx: 3.5 },
];

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
    this.phase0 = ((d.phase || 0) * Math.PI) / 180;
    this.parent = null;
    this.children = [];
    this.soi = Infinity;
    this.n = 0; // mean motion (rad/s)
    this.speed = 0; // orbital speed around parent (km/s)
    this.depth = 0;
  }

  /** Angle of the body around its parent at time t. */
  angle(t) {
    return this.phase0 + this.n * t;
  }

  /** Position relative to parent at time t. */
  relPos(t, out = { x: 0, y: 0 }) {
    if (!this.parent) { out.x = 0; out.y = 0; return out; }
    const th = this.angle(t);
    out.x = this.a * Math.cos(th);
    out.y = this.a * Math.sin(th);
    return out;
  }

  /** Velocity relative to parent at time t. */
  relVel(t, out = { x: 0, y: 0 }) {
    if (!this.parent) { out.x = 0; out.y = 0; return out; }
    const th = this.angle(t);
    out.x = -this.speed * Math.sin(th);
    out.y = this.speed * Math.cos(th);
    return out;
  }

  /** Absolute (heliocentric) position at time t. */
  absPos(t, out = { x: 0, y: 0 }) {
    let x = 0, y = 0;
    for (let b = this; b.parent; b = b.parent) {
      const th = b.angle(t);
      x += b.a * Math.cos(th);
      y += b.a * Math.sin(th);
    }
    out.x = x; out.y = y;
    return out;
  }

  /** Absolute (heliocentric) velocity at time t. */
  absVel(t, out = { x: 0, y: 0 }) {
    let x = 0, y = 0;
    for (let b = this; b.parent; b = b.parent) {
      const th = b.angle(t);
      x -= b.speed * Math.sin(th);
      y += b.speed * Math.cos(th);
    }
    out.x = x; out.y = y;
    return out;
  }

  /** True if `other` is this body or one of its ancestors. */
  isWithin(other) {
    for (let b = this; b; b = b.parent) if (b === other) return true;
    return false;
  }

  /** Set the phase so the body sits at angle `deg` (degrees) around its parent at time t. */
  setAngleAt(deg, t) {
    this.phase0 = (deg * Math.PI) / 180 - this.n * t;
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
      b.n = Math.sqrt(p.gm / (b.a * b.a * b.a));
      b.speed = b.n * b.a;
      b.soi = b.a * Math.pow(b.gm / p.gm, 0.4);
    }
  });
  return { bodies, byId, root: byId.sun };
}

export { TWO_PI };
