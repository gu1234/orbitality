// 2D camera: follows a focus (body, ship or target) with a pan offset, in km.
// Screen y grows downward; world y grows upward.

export const MIN_SCALE = 2e-8; // px per km (whole solar system)
export const MAX_SCALE = 400; // px per km (2.5 m per px)

export class Camera {
  constructor() {
    this.focus = { kind: 'body', id: 'earth' };
    this.offX = 0;
    this.offY = 0;
    this.scale = 0.03;
    this.cx = 0;
    this.cy = 0;
    this.w = 1;
    this.h = 1;
    this.anim = null;
  }

  setSize(w, h) {
    this.w = w;
    this.h = h;
  }

  /** Absolute position of the current focus at world time. */
  focusPos(world) {
    const f = this.focus;
    if (f.kind === 'ship') return world.shipAbs();
    if (f.kind === 'target' && world.target) return world.targetAbs();
    const b = world.body(f.id) || world.ship.body;
    return b.absPos(world.t);
  }

  focusLabel(world) {
    const f = this.focus;
    if (f.kind === 'ship') return 'Ship';
    if (f.kind === 'target') return world.target ? world.target.name : 'Target';
    return (world.body(f.id) || world.ship.body).name;
  }

  setFocus(focus, keepOffset = false) {
    this.focus = focus;
    if (!keepOffset) {
      this.offX = 0;
      this.offY = 0;
    }
  }

  update(world, realDt) {
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + realDt / a.dur);
      const k = a.t < 1 ? 1 - Math.pow(1 - a.t, 3) : 1;
      this.scale = Math.exp(Math.log(a.s0) + (Math.log(a.s1) - Math.log(a.s0)) * k);
      this.offX = a.x0 + (a.x1 - a.x0) * k;
      this.offY = a.y0 + (a.y1 - a.y0) * k;
      if (a.t >= 1) this.anim = null;
    }
    const p = this.focusPos(world);
    this.cx = p.x + this.offX;
    this.cy = p.y + this.offY;
  }

  sx(x) { return this.w / 2 + (x - this.cx) * this.scale; }
  sy(y) { return this.h / 2 - (y - this.cy) * this.scale; }

  /** Screen -> absolute world coordinates. */
  toWorld(px, py) {
    return { x: this.cx + (px - this.w / 2) / this.scale, y: this.cy - (py - this.h / 2) / this.scale };
  }

  clampScale(s) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  }

  /** Zoom by factor keeping the world point under (px, py) fixed. */
  zoomAt(factor, px, py) {
    this.anim = null;
    const before = this.toWorld(px, py);
    this.scale = this.clampScale(this.scale * factor);
    const after = this.toWorld(px, py);
    this.offX += before.x - after.x;
    this.offY += before.y - after.y;
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  pan(dx, dy) {
    this.anim = null;
    this.offX -= dx / this.scale;
    this.offY += dy / this.scale;
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }

  /** Smoothly move to a scale and offset. */
  animateTo(scale, offX = 0, offY = 0, dur = 0.5) {
    this.anim = { t: 0, dur, s0: this.scale, s1: this.clampScale(scale), x0: this.offX, x1: offX, y0: this.offY, y1: offY };
  }

  /**
   * Fit absolute points (each with an optional radius) into a screen rectangle
   * { x0, y0, x1, y1 } (defaults to the whole screen), keeping the current focus.
   */
  fitPoints(world, pts, { rect = null, pad = 0.1, dur = 0.5, instant = false } = {}) {
    if (!pts.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      const r = p.r || 0;
      x0 = Math.min(x0, p.x - r); x1 = Math.max(x1, p.x + r);
      y0 = Math.min(y0, p.y - r); y1 = Math.max(y1, p.y + r);
    }
    const R = rect || { x0: 0, y0: 0, x1: this.w, y1: this.h };
    const rw = (R.x1 - R.x0) * (1 - 2 * pad);
    const rh = (R.y1 - R.y0) * (1 - 2 * pad);
    const s = this.clampScale(Math.min(rw / Math.max(x1 - x0, 1e-3), rh / Math.max(y1 - y0, 1e-3)));
    const f = this.focusPos(world);
    // world centre of the points must land on the rect centre
    const fx = (R.x0 + R.x1) / 2, fy = (R.y0 + R.y1) / 2;
    const ox = (x0 + x1) / 2 - f.x - (fx - this.w / 2) / s;
    const oy = (y0 + y1) / 2 - f.y + (fy - this.h / 2) / s;
    if (instant) {
      this.anim = null;
      this.scale = s;
      this.offX = ox;
      this.offY = oy;
    } else {
      this.animateTo(s, ox, oy, dur);
    }
  }
}
