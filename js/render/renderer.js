// Canvas renderer: bodies, orbits, predicted trajectories, markers and ships.

import { elements, pointAt, kepler } from '../physics/kepler.js';
import { fmtDist, fmtDur } from '../ui/format.js';
import { PlanetArt } from './planets.js';
import { Backdrop } from './backdrop.js';

const COL = {
  field: '#0f1f36',
  chalk: '#ebe6d8',
  ship: '#ffb547',
  target: '#ff5fa2',
  warn: '#ff6a3d',
  ok: '#9be3b4',
};
const TWO_PI = Math.PI * 2;
const LABEL_FONT = '500 13px "Barlow Condensed", "Arial Narrow", sans-serif';
const LABEL_FONT_BIG = '600 15px "Barlow Condensed", "Arial Narrow", sans-serif';
const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Liang–Barsky: clip segment to rect; returns [t0, t1] or null. */
function clipT(x0, y0, x1, y1, xmin, ymin, xmax, ymax) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return [t0, t1];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 1;
    this.h = 1;
    this.effects = [];
    this.planets = new PlanetArt();
    this.backdrop = new Backdrop();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  addEffect(e) { this.effects.push({ age: 0, ...e }); }

  // ---------------------------------------------------------------- drawing helpers

  /** Stroke an arc of a conic (relative to an absolute anchor) with adaptive subdivision. */
  conic(el, nu0, nu1, ax, ay, cam, baseN = 180) {
    const ctx = this.ctx;
    const s = cam.scale;
    const ox = this.w / 2 + (ax - cam.cx) * s;
    const oy = this.h / 2 - (ay - cam.cy) * s;
    const m = 40;
    const xmin = -m, ymin = -m, xmax = this.w + m, ymax = this.h + m;
    const pt = { x: 0, y: 0 };
    const proj = (nu) => {
      pointAt(el, nu, pt);
      return [ox + pt.x * s, oy - pt.y * s];
    };
    let penUp = true;
    const seg = (na, A, nb, B, depth) => {
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const pad = len * 0.3 + 2;
      if (Math.max(A[0], B[0]) + pad < xmin || Math.min(A[0], B[0]) - pad > xmax
        || Math.max(A[1], B[1]) + pad < ymin || Math.min(A[1], B[1]) - pad > ymax) {
        penUp = true;
        return;
      }
      if (depth < 14 && len > 1.5) {
        const nm = 0.5 * (na + nb);
        const M = proj(nm);
        const dev = Math.hypot(M[0] - 0.5 * (A[0] + B[0]), M[1] - 0.5 * (A[1] + B[1]));
        if (dev > 0.3) {
          seg(na, A, nm, M, depth + 1);
          seg(nm, M, nb, B, depth + 1);
          return;
        }
      }
      const c = clipT(A[0], A[1], B[0], B[1], xmin, ymin, xmax, ymax);
      if (!c) { penUp = true; return; }
      const x0 = A[0] + (B[0] - A[0]) * c[0], y0 = A[1] + (B[1] - A[1]) * c[0];
      const x1 = A[0] + (B[0] - A[0]) * c[1], y1 = A[1] + (B[1] - A[1]) * c[1];
      if (penUp || c[0] > 0) ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      penUp = c[1] < 1;
    };
    const span = nu1 - nu0;
    const n = Math.max(6, Math.ceil((baseN * Math.abs(span)) / TWO_PI));
    ctx.beginPath();
    let prevNu = nu0;
    let prev = proj(nu0);
    for (let i = 1; i <= n; i++) {
      const nu = nu0 + (span * i) / n;
      const P = proj(nu);
      seg(prevNu, prev, nu, P, 0);
      prevNu = nu;
      prev = P;
    }
    ctx.stroke();
  }

  /** Circle that may be enormous on screen (planet orbits at high zoom). */
  circle(cx, cy, r, cam) {
    const ctx = this.ctx;
    const x = this.w / 2 + (cx - cam.cx) * cam.scale;
    const y = this.h / 2 - (cy - cam.cy) * cam.scale;
    const R = r * cam.scale;
    const diag = Math.hypot(this.w, this.h);
    const d = Math.hypot(x - this.w / 2, y - this.h / 2);
    if (d - R > diag || R - d > diag) return false; // entirely off-screen or view inside
    ctx.beginPath();
    if (R < 20000) {
      ctx.arc(x, y, R, 0, TWO_PI);
    } else {
      // draw only the arc near the viewport as a polyline
      const th = Math.atan2(-(this.h / 2 - y), this.w / 2 - x);
      const half = Math.min(Math.PI, (1.5 * diag) / R);
      const N = 64;
      for (let i = 0; i <= N; i++) {
        const a = th - half + (2 * half * i) / N;
        const px = x + R * Math.cos(a), py = y - R * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    return true;
  }

  label(text, x, y, color = COL.chalk, align = 'left', font = LABEL_FONT) {
    const ctx = this.ctx;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(15,31,54,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /** Marker dot with a leader line pointing away from `from` and a label. */
  marker(x, y, fromX, fromY, lines, color, { dot = true, len = 18 } = {}) {
    const ctx = this.ctx;
    if (x < -50 || y < -50 || x > this.w + 50 || y > this.h + 50) return;
    let dx = x - fromX, dy = y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    if (dot) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, TWO_PI);
      ctx.fill();
    }
    // keep labels on screen: flip the leader away from the nearest edge
    ctx.font = LABEL_FONT_BIG;
    const tw = Math.max(...lines.map((ln) => ctx.measureText(Array.isArray(ln) ? ln[0] : ln).width)) + 8;
    if (dx >= 0 && x + dx * len + tw > this.w - 4) dx = -Math.abs(dx) || -1;
    else if (dx < 0 && x + dx * len - tw < 4) dx = Math.abs(dx) || 1;
    const n = lines.length;
    if (y + dy * len - n * 8 < 4) dy = Math.abs(dy);
    else if (y + dy * len + n * 8 > this.h - 4) dy = -Math.abs(dy);
    const lx = x + dx * len, ly = y + dy * len;
    ctx.strokeStyle = rgba(COL.chalk, 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + dx * 5, y + dy * 5);
    ctx.lineTo(lx, ly);
    ctx.stroke();
    const right = dx >= 0;
    const tx = lx + (right ? 4 : -4);
    lines.forEach((ln, i) => {
      const [text, col, font] = Array.isArray(ln) ? ln : [ln, COL.chalk];
      this.label(text, tx, ly + (i - (n - 1) / 2) * 15, col, right ? 'left' : 'right', font);
    });
  }

  // ---------------------------------------------------------------- frame

  draw(world, cam, ui) {
    const ctx = this.ctx;
    this.minimal = !!ui.minimal;
    this.apsisNames = ui.apsisNames || null; // body => { pe, ap } to spell out Pe/Ap labels
    const { w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.backdrop.draw(ctx, w, h, this.dpr, performance.now() / 1000);

    const t = world.t;
    const ship = world.ship;
    const cur = ship.body;
    this.grid(cur.absPos(t), cam);

    // --- body orbits and SOIs
    ctx.lineWidth = 1;
    for (const b of world.sys.bodies) {
      if (!b.parent) continue;
      const pp = b.parent.absPos(t);
      const rpx = b.a * cam.scale;
      if (rpx > 18) {
        ctx.strokeStyle = rgba(COL.chalk, b.parent.parent ? 0.2 : 0.14);
        this.circle(pp.x, pp.y, b.a, cam);
      }
      const spx = b.soi * cam.scale;
      const relevant = b === cur || b.parent === cur || (world.target && b === world.target.body);
      if (relevant && spx > 24) {
        const bp = b.absPos(t);
        ctx.strokeStyle = rgba(COL.chalk, 0.16);
        ctx.setLineDash([3, 6]);
        this.circle(bp.x, bp.y, b.soi, cam);
        ctx.setLineDash([]);
      }
    }

    const pred = ui.prediction;

    // --- pre-burn orbit ghost
    if (ui.ghost && ui.ghostAlpha > 0.01) {
      const p = ui.ghost[0];
      if (p) {
        const a = this.anchor(world, p, t);
        ctx.strokeStyle = rgba(COL.chalk, 0.45 * ui.ghostAlpha);
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 6]);
        const [n0, n1] = this.patchRange(p);
        this.conic(p.el, n0, n1, a.x, a.y, cam);
        ctx.setLineDash([]);
      }
    }

    // --- target orbit
    if (world.target) {
      const tg = world.target;
      const ts = world.targetState(t);
      const el = elements(ts.x, ts.y, ts.vx, ts.vy, tg.body.gm);
      const a = tg.body.absPos(t);
      ctx.strokeStyle = rgba(COL.target, world.status === 'caught' ? 0.4 : 0.8);
      ctx.lineWidth = 1.6;
      this.conic(el, el.nu, el.nu + TWO_PI, a.x, a.y, cam, 240);
      this.chevrons(el, a, cam, COL.target);
    }

    // --- trail
    if (world.trail.length > 1 && world.status !== 'caught') {
      const a = cur.absPos(t);
      const tr = world.trail;
      for (let i = 1; i < tr.length; i++) {
        const p0 = tr[i - 1], p1 = tr[i];
        if (p0.body !== cur || p1.body !== cur) continue;
        ctx.strokeStyle = rgba(COL.ship, 0.28 * (i / tr.length));
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cam.sx(a.x + p0.x), cam.sy(a.y + p0.y));
        ctx.lineTo(cam.sx(a.x + p1.x), cam.sy(a.y + p1.y));
        ctx.stroke();
      }
    }

    // --- predicted trajectory
    if (pred && world.status === 'flying') this.prediction(world, pred, cam);

    // --- bodies
    for (const b of world.sys.bodies) this.body(world, b, cam);

    // --- encounter ghosts & markers on the prediction
    if (pred && world.status === 'flying' && !ui.minimal) this.predictionMarkers(world, pred, cam);

    // --- closest approach
    if (world.approach && world.status === 'flying' && !ui.minimal) this.approach(world, world.approach, cam);

    // --- phase angle
    if (world.target && world.status === 'flying' && !ui.minimal) this.phase(world, cam);

    // --- target
    if (world.target) this.targetIcon(world, cam, ui);

    // --- ship
    this.shipIcon(world, cam, ui);

    // --- effects
    this.drawEffects(world, cam, ui.realDt || 0);
  }

  grid(center, cam) {
    const ctx = this.ctx;
    const raw = 90 / cam.scale;
    const p10 = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((k) => k * p10).find((v) => v >= raw);
    this.gridStep = step;
    const px = step * cam.scale;
    const ox = cam.sx(center.x), oy = cam.sy(center.y);
    const x0 = ox - Math.ceil(ox / px) * px;
    const y0 = oy - Math.ceil(oy / px) * px;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(158,190,230,0.055)';
    ctx.beginPath();
    for (let x = x0; x <= this.w; x += px) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, this.h); }
    for (let y = y0; y <= this.h; y += px) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(this.w, Math.round(y) + 0.5); }
    ctx.stroke();
    // axes through the reference body
    ctx.strokeStyle = 'rgba(158,190,230,0.1)';
    ctx.beginPath();
    if (ox > -1 && ox < this.w + 1) { ctx.moveTo(Math.round(ox) + 0.5, 0); ctx.lineTo(Math.round(ox) + 0.5, this.h); }
    if (oy > -1 && oy < this.h + 1) { ctx.moveTo(0, Math.round(oy) + 0.5); ctx.lineTo(this.w, Math.round(oy) + 0.5); }
    ctx.stroke();
  }

  /**
   * Where a patch's reference body is drawn. The ship's current body and its
   * ancestors are drawn where they are now; any other body is placed where it
   * will be at the patch start, relative to its parent's anchor. (So a future
   * Moon encounter appears around a ghost Moon next to today's Earth.)
   */
  anchor(world, patch, t) {
    return this.anchorBody(world, patch.body, t, patch.t0);
  }

  anchorBody(world, body, t, t0) {
    if (!body.parent || world.ship.body.isWithin(body)) return body.absPos(t);
    const p = this.anchorBody(world, body.parent, t, t0);
    const r = body.relPos(t0);
    return { x: p.x + r.x, y: p.y + r.y };
  }

  patchRange(p) {
    if (p._range) return p._range;
    const n0 = p.el.nu;
    let n1;
    if (p.closed) n1 = n0 + TWO_PI;
    else {
      const e1 = elements(p.endRel.x, p.endRel.y, p.endRel.vx, p.endRel.vy, p.body.gm);
      n1 = e1.nu;
      if (p.el.e < 1) {
        let d = (n1 - n0) % TWO_PI;
        if (d < 0) d += TWO_PI;
        n1 = n0 + d;
      }
    }
    p._range = [n0, n1];
    return p._range;
  }

  prediction(world, pred, cam) {
    const ctx = this.ctx;
    const t = world.t;
    const cur = world.ship.body;
    // zoomed in on a moon/planet: show the way out as a tail in its own frame
    const local = cur.parent && cur.soi * cam.scale > 0.25 * Math.min(this.w, this.h);
    this.drawnPatches = pred.length;
    pred.forEach((p, i) => {
      if (i >= this.drawnPatches) return;
      if (i > 0 && local && cur.isWithin(p.body) && p.body !== cur) {
        this.localTail(world, p, cam);
        this.drawnPatches = i; // nothing beyond the way out is drawn up close
        return;
      }
      const a = this.anchor(world, p, t);
      const [n0, n1] = this.patchRange(p);
      ctx.strokeStyle = rgba(COL.ship, i === 0 ? 0.95 : 0.6);
      ctx.lineWidth = i === 0 ? 2 : 1.6;
      if (i > 0) ctx.setLineDash([7, 5]);
      this.conic(p.el, n0, n1, a.x, a.y, cam);
      ctx.setLineDash([]);
      if (i === 0) this.chevrons(p.el, a, cam, COL.ship, n0, n1);
      if (p.end === 'impact') {
        const e = p.endRel;
        const x = cam.sx(a.x + e.x), y = cam.sy(a.y + e.y);
        ctx.strokeStyle = COL.warn;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6);
        ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6);
        ctx.stroke();
        const b = cam.sx(a.x), c = cam.sy(a.y);
        this.marker(x, y, b, c, [[`Impact in ${fmtDur(p.t1 - t)}`, COL.warn]], COL.warn, { dot: false });
      }
    });
  }

  /** A parent-frame patch re-expressed relative to the current body, drawn until it is well clear. */
  localTail(world, p, cam) {
    const ctx = this.ctx;
    const cur = world.ship.body;
    const a = cur.absPos(world.t);
    const st = { x: 0, y: 0, vx: 0, vy: 0 };
    const off = { x: 0, y: 0 };
    const s0 = p.state0;
    const v = Math.hypot(s0.vx, s0.vy) || 1;
    const dt = (cur.soi / v) * 0.05;
    ctx.strokeStyle = rgba(COL.ship, 0.6);
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    for (let k = 0; k <= 160; k++) {
      const tt = p.t0 + k * dt;
      if (tt > p.t1) break;
      kepler(s0.x, s0.y, s0.vx, s0.vy, p.body.gm, tt - p.t0, st);
      // position relative to the current body at the same instant
      let x = st.x, y = st.y;
      for (let b = cur; b && b !== p.body; b = b.parent) {
        b.relPos(tt, off);
        x -= off.x; y -= off.y;
      }
      const sx = cam.sx(a.x + x), sy = cam.sy(a.y + y);
      if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      if (Math.hypot(x, y) > cur.soi * 4) break;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Small direction-of-motion chevrons along an orbit. */
  chevrons(el, a, cam, color, n0 = el.nu, n1 = el.nu + TWO_PI) {
    const ctx = this.ctx;
    const r = (el.e < 1 ? el.a : el.rp) * cam.scale;
    if (r < 40) return;
    const count = el.e < 1 ? 4 : 2;
    const pt = { x: 0, y: 0 }, pt2 = { x: 0, y: 0 };
    ctx.fillStyle = color;
    for (let i = 1; i <= count; i++) {
      const nu = n0 + ((n1 - n0) * (i - 0.5)) / count;
      pointAt(el, nu, pt);
      pointAt(el, nu + 0.001, pt2);
      const x = cam.sx(a.x + pt.x), y = cam.sy(a.y + pt.y);
      if (x < -20 || y < -20 || x > this.w + 20 || y > this.h + 20) continue;
      const ang = Math.atan2(-(pt2.y - pt.y), pt2.x - pt.x);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(-3, -4);
      ctx.lineTo(-1, 0);
      ctx.lineTo(-3, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  predictionMarkers(world, pred, cam) {
    const t = world.t;
    const pt = { x: 0, y: 0 };
    pred.forEach((p, i) => {
      if (i >= (this.drawnPatches ?? pred.length)) return;
      const a = this.anchor(world, p, t);
      const bx = cam.sx(a.x), by = cam.sy(a.y);
      const R = p.body.radius;
      const [n0, n1] = this.patchRange(p);
      const within = (nu) => {
        if (p.closed) return true;
        let d = (nu - n0) % TWO_PI;
        if (d < 0) d += TWO_PI;
        return n0 + d <= n1;
      };
      const el = p.el;
      const rpx = (el.e < 1 ? el.a : el.rp) * cam.scale;
      // encounter ghost of the body at patch start
      if (i > 0 && !world.ship.body.isWithin(p.body)) {
        const r = Math.max(R * cam.scale, p.body.minPx);
        this.ctx.strokeStyle = rgba(COL.chalk, 0.7);
        this.ctx.lineWidth = 1.2;
        this.ctx.beginPath();
        this.ctx.arc(bx, by, r, 0, TWO_PI);
        this.ctx.stroke();
        const caHere = world.approach && world.approach.kind === 'target' && world.approach.patch === p;
        if (!caHere && (i === 1 || p.body !== pred[i - 1].body)) {
          this.marker(bx, by, bx - 1, by + 1, [[`${p.body.name} encounter`, COL.chalk, LABEL_FONT_BIG], [`in ${fmtDur(p.t0 - t)}`, rgba(COL.chalk, 0.7)]], COL.chalk, { dot: false, len: Math.max(r + 10, 22) });
        }
      }
      if (rpx < 12) return;
      if (!el.circular) {
        const showAp = el.e < 1 && (i === 0 || p.body !== world.ship.body) && within(Math.PI) && el.ra < p.body.soi;
        // spelled-out names go above the distance so the label stays narrow
        const names = this.apsisNames?.(p.body);
        const apsis = (name, short, alt, col) => (names
          ? [[name, col, LABEL_FONT_BIG], [fmtDist(alt), rgba(COL.chalk, 0.7)]]
          : [[`${short} ${fmtDist(alt)}`, col]]);
        if (within(0)) {
          pointAt(el, 0, pt);
          const x = cam.sx(a.x + pt.x), y = cam.sy(a.y + pt.y);
          const alt = el.rp - R;
          const col = alt < 0 ? COL.warn : COL.chalk;
          this.marker(x, y, bx, by, apsis(names?.pe, 'Pe', alt, col), COL.ship);
        }
        if (showAp) {
          pointAt(el, Math.PI, pt);
          const x = cam.sx(a.x + pt.x), y = cam.sy(a.y + pt.y);
          this.marker(x, y, bx, by, apsis(names?.ap, 'Ap', el.ra - R, COL.chalk), COL.ship);
        }
      }
    });
  }

  approach(world, ca, cam) {
    const ctx = this.ctx;
    const t = world.t;
    const a = this.anchor(world, ca.patch, t);
    const sx = cam.sx(a.x + ca.ship.x), sy = cam.sy(a.y + ca.ship.y);
    const tx = cam.sx(a.x + ca.obj.x), ty = cam.sy(a.y + ca.obj.y);
    const isTarget = ca.kind === 'target';
    if (!isTarget && ca.dist > ca.bodyRef.soi * 3) return; // far off: the HUD has the number
    if (ca.t - t < 2) return; // closest is right now: the ships themselves show it
    const col = isTarget ? COL.target : COL.chalk;
    // ghost target / body
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = col;
    if (isTarget) {
      this.diamond(tx, ty, 6, null, col);
    } else {
      const B = ca.bodyRef;
      const r = Math.max(B.radius * cam.scale, B.minPx);
      ctx.beginPath(); ctx.arc(tx, ty, r, 0, TWO_PI); ctx.stroke();
      const soi = B.soi * cam.scale;
      if (soi > 8) {
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = rgba(COL.chalk, 0.35);
        ctx.beginPath(); ctx.arc(tx, ty, soi, 0, TWO_PI); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // ghost ship
    ctx.strokeStyle = COL.ship;
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, TWO_PI); ctx.stroke();
    // connector
    const d = Math.hypot(tx - sx, ty - sy);
    if (d > 3) {
      ctx.strokeStyle = rgba(COL.chalk, 0.8);
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
    }
    const bx = cam.sx(a.x), by = cam.sy(a.y);
    const title = isTarget ? `Closest ${fmtDist(ca.dist)}` : `${ca.bodyRef.name} ${fmtDist(ca.dist)}`;
    const good = isTarget && ca.dist <= world.catchDist;
    this.marker((sx + tx) / 2, (sy + ty) / 2, bx, by, [[title, good ? COL.ok : COL.chalk, LABEL_FONT_BIG], [`in ${fmtDur(ca.t - t)}`, rgba(COL.chalk, 0.7)]], COL.chalk, { dot: false, len: 26 });
  }

  /** Dashed arc from the ship to the target (or its body) around the common centre. */
  phase(world, cam) {
    const ph = world.phaseInfo();
    if (!ph) return;
    const ctx = this.ctx;
    const c = ph.center.absPos(world.t);
    const cx = cam.sx(c.x), cy = cam.sy(c.y);
    // distances of both ends from the centre (km)
    const rs = ph.ownBody ? Math.hypot(world.ship.x, world.ship.y) : world.ship.body.a;
    let rt;
    if (world.target.body === world.ship.body) { const ts = world.targetState(); rt = Math.hypot(ts.x, ts.y); }
    else rt = world.target.body.a;
    const bodyR = Math.max(ph.center.radius * cam.scale, ph.center.minPx);
    // just outside both orbits when that fits, otherwise inside them
    let rad = Math.max(rs, rt) * cam.scale * 1.1;
    if (rad > 0.48 * Math.min(this.w, this.h)) rad = Math.min(rs, rt) * cam.scale * 0.5;
    rad = Math.max(rad, bodyR + 14);
    if (rad < 24 || rad > Math.hypot(this.w, this.h)) return;
    // screen angles are mirrored in y
    const s0 = -ph.a0;
    const sweep = (-ph.deg * Math.PI) / 180 * ph.dir;
    ctx.strokeStyle = rgba(COL.chalk, 0.55);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(s0) * rad * 1.15, cy + Math.sin(s0) * rad * 1.15);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(s0 + sweep) * rad * 1.15, cy + Math.sin(s0 + sweep) * rad * 1.15);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = rgba(COL.chalk, 0.8);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, s0, s0 + sweep, sweep < 0);
    ctx.stroke();
    const mid = s0 + sweep / 2;
    const d = Math.round(Math.abs(ph.deg));
    this.label(`${d}°`, cx + Math.cos(mid) * (rad + 14), cy + Math.sin(mid) * (rad + 14), rgba(COL.chalk, 0.9), 'center', LABEL_FONT_BIG);
  }

  body(world, b, cam) {
    const ctx = this.ctx;
    const p = b.absPos(world.t);
    const x = cam.sx(p.x), y = cam.sy(p.y);
    const rTrue = b.radius * cam.scale;
    const r = Math.max(rTrue, b.minPx);
    // a moon that collapses onto its planet at this zoom is not drawn
    if (b.parent && b.parent.parent && b.a * cam.scale < Math.max(b.parent.radius * cam.scale, b.parent.minPx) + 4) return;
    const cull = r * (b.id === 'saturn' ? 2.5 : b.parent ? 1.1 : 4);
    if (x + cull < -40 || y + cull < -40 || x - cull > this.w + 40 || y - cull > this.h + 40) return;
    if (!b.parent) {
      // the Sun's glow, then its disc
      const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 4);
      g.addColorStop(0, 'rgba(255,200,110,0.5)');
      g.addColorStop(0.3, 'rgba(255,170,80,0.14)');
      g.addColorStop(1, 'rgba(255,160,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 4, 0, TWO_PI); ctx.fill();
    }
    if (rTrue >= 2.5 && this.planets.draw(ctx, b, x, y, rTrue, world.t, this.dpr)) {
      // textured, lit disc
    } else if (!b.parent) {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TWO_PI); ctx.fill();
    } else {
      // lit from the Sun (at the origin)
      const L = Math.hypot(p.x, p.y) || 1;
      const lx = -p.x / L, ly = p.y / L; // screen-space direction to the Sun
      if (b.atmo && r > 5) {
        const halo = r + Math.min(r * 0.05, 14);
        const g = ctx.createRadialGradient(x, y, r, x, y, halo);
        g.addColorStop(0, rgba(b.atmo, 0.35));
        g.addColorStop(1, rgba(b.atmo, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, halo, 0, TWO_PI); ctx.fill();
      }
      // big discs are kept darker so the orbit lines around them stay readable
      const big = Math.min(1, Math.max(0, (r - 30) / 150));
      const g = ctx.createRadialGradient(x + lx * r * 0.45, y + ly * r * 0.45, r * 0.1, x, y, r * 1.02);
      g.addColorStop(0, this.shade(b.color, 1.2 - 0.35 * big));
      g.addColorStop(0.55, this.shade(b.color, 1 - 0.3 * big));
      g.addColorStop(1, this.shade(b.color, 0.3 - 0.1 * big));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TWO_PI); ctx.fill();
    }
    if (rTrue < 14 && r < 14 && !this.minimal) {
      this.label(b.name, x + r + 5, y - r - 4, rgba(COL.chalk, 0.75));
    }
  }

  shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  diamond(x, y, r, fill, stroke) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  targetIcon(world, cam, ui) {
    const ctx = this.ctx;
    const p = world.targetAbs();
    const x = cam.sx(p.x), y = cam.sy(p.y);
    const ring = world.catchDist * cam.scale;
    if (ring > 5 && world.status === 'flying') {
      ctx.strokeStyle = rgba(COL.target, 0.55);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(x, y, ring, 0, TWO_PI); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.lineWidth = 2;
    this.diamond(x, y, 7, COL.target, COL.field);
    if (ui.showNames) this.label(world.target.name, x + 11, y + 12, rgba(COL.target, 0.95));
  }

  shipIcon(world, cam, ui) {
    const ctx = this.ctx;
    if (world.status === 'crashed') return;
    const s = world.ship;
    const p = world.shipAbs();
    const x = cam.sx(p.x), y = cam.sy(p.y);
    const burnDir = world.burn.dir;
    const showDir = burnDir || ui.hoverDir;
    let hx = s.vx, hy = s.vy;
    let u = null;
    if (showDir && world.canBurn(showDir)) u = world.burnVector(showDir);
    if (burnDir && u) { hx = u.x; hy = u.y; }
    const ang = Math.atan2(-hy, hx);

    // "this is you": a dark backing disc lifts the ship off its own orbit line,
    // and a sonar ring keeps rolling out of it
    if (ui.showNames) {
      ctx.fillStyle = rgba(COL.field, 0.6);
      ctx.beginPath(); ctx.arc(x, y, 16, 0, TWO_PI); ctx.fill();
      ctx.strokeStyle = rgba(COL.ship, 0.55);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 16, 0, TWO_PI); ctx.stroke();
      if (!reducedMotion?.matches) {
        const k = (performance.now() / 1600) % 1;
        ctx.strokeStyle = rgba(COL.ship, 0.7 * (1 - k));
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 16 + 22 * k, 0, TWO_PI); ctx.stroke();
      }
    }

    // thrust direction guide
    if (u) {
      const L = 46;
      const ex = x + u.x * L, ey = y - u.y * L;
      const col = burnDir === 'toward' || burnDir === 'match' || showDir === 'toward' || showDir === 'match' ? COL.target : COL.ship;
      ctx.strokeStyle = rgba(col, burnDir ? 0.95 : 0.6);
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x + u.x * 12, y - u.y * 12); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.setLineDash([]);
      const a2 = Math.atan2(-u.y, u.x);
      ctx.fillStyle = rgba(col, burnDir ? 0.95 : 0.6);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(a2);
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (burnDir && u) {
      const flick = 0.75 + 0.25 * Math.sin(performance.now() / 30) + 0.1 * Math.random();
      const len = 10 + 9 * flick * Math.min(1, world.burn.rate / 60 + 0.4);
      const g = ctx.createLinearGradient(-6, 0, -6 - len, 0);
      g.addColorStop(0, 'rgba(255,240,200,0.95)');
      g.addColorStop(0.5, 'rgba(255,181,71,0.8)');
      g.addColorStop(1, 'rgba(255,106,61,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-5, -3.5);
      ctx.lineTo(-6 - len, 0);
      ctx.lineTo(-5, 3.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-3.5, 0);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fillStyle = COL.ship;
    ctx.strokeStyle = COL.field;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // name tag on the outside of the orbit, clear of a target sharing the orbit line
    if (ui.showNames) {
      const r = Math.hypot(s.x, s.y) || 1;
      this.label('You', x + (s.x / r) * 34, y - (s.y / r) * 34, COL.ship, 'center', LABEL_FONT_BIG);
    }
  }

  drawEffects(world, cam, dt) {
    const ctx = this.ctx;
    this.effects = this.effects.filter((e) => (e.age += dt) < e.life);
    for (const e of this.effects) {
      const k = e.age / e.life;
      let p;
      if (e.follow === 'target' && world.target) p = world.targetAbs();
      else if (e.follow === 'ship') p = world.shipAbs();
      else p = e.pos;
      const x = cam.sx(p.x), y = cam.sy(p.y);
      ctx.strokeStyle = rgba(e.color, (1 - k) * 0.9);
      ctx.lineWidth = 2;
      for (let i = 0; i < (e.rings || 1); i++) {
        const kk = Math.max(0, k - i * 0.15);
        if (kk <= 0) continue;
        ctx.beginPath();
        ctx.arc(x, y, 8 + kk * e.size, 0, TWO_PI);
        ctx.stroke();
      }
    }
  }
}

export { COL };
