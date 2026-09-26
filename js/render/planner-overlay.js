// Burn planner overlay, drawn on top of the normal frame: the orbit the planned
// burn gives (green), a node marker where it happens, the new Ap/Pe and the
// closest approach it leads to, and where the target will be when the burn
// happens. Stays up, fainter, while the ship warps to it.

import { pointAt } from '../physics/kepler.js';
import { fmtDist, fmtDur } from '../ui/format.js';
import { planVector } from '../game/planner.js';

const PLAN = '#9be3b4';
const WARN = '#ff6a3d';
const CHALK = '#ebe6d8';
const TARGET = '#ff5fa2';

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function drawPlannerOverlay(r, world, cam, planner) {
  const armed = planner.armed;
  const res = planner.open ? planner.result : armed?.result;
  if (!res || world.status !== 'flying') return;
  const ctx = r.ctx;
  const t = world.t;
  const alpha = planner.open ? 1 : 0.55;
  const cur = world.ship.body;
  const a0 = cur.absPos(t);
  const bx = cam.sx(a0.x), by = cam.sy(a0.y);

  // --- planned path
  const pred = res.pred;
  if (pred) {
    pred.forEach((p, i) => {
      const a = r.anchor(world, p, t);
      const [n0, n1] = r.patchRange(p);
      ctx.strokeStyle = rgba(PLAN, (i === 0 ? 0.95 : 0.65) * alpha);
      ctx.lineWidth = i === 0 ? 2.2 : 1.6;
      ctx.setLineDash(i === 0 ? [] : [7, 5]);
      r.conic(p.el, n0, n1, a.x, a.y, cam);
      ctx.setLineDash([]);
      if (i === 0) r.chevrons(p.el, a, cam, rgba(PLAN, alpha), n0, n1);
      if (p.end === 'impact') {
        const e = p.endRel;
        const x = cam.sx(a.x + e.x), y = cam.sy(a.y + e.y);
        ctx.strokeStyle = WARN;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6);
        ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6);
        ctx.stroke();
      }
    });

    // new Ap / Pe of the orbit right after the burn: dots only, since they'd sit on the
    // current orbit's Ap/Pe labels; the panel spells out the numbers
    const p = pred[0];
    const el = p.el;
    if (planner.open && !el.circular && el.a * cam.scale > 12) {
      const a = r.anchor(world, p, t);
      const pt = { x: 0, y: 0 };
      const dot = (nu, col) => {
        pointAt(el, nu, pt);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cam.sx(a.x + pt.x), cam.sy(a.y + pt.y), 3.5, 0, Math.PI * 2);
        ctx.fill();
      };
      dot(0, el.rp < p.body.radius ? WARN : PLAN);
      if (el.e < 1 && el.ra < p.body.soi) dot(Math.PI, PLAN);
    }
  }

  // --- where the burn happens
  const n = res.node;
  const x = cam.sx(a0.x + n.x), y = cam.sy(a0.y + n.y);
  const src = armed || planner;
  const u = planVector(n, src.pro, src.rad);
  if (u) {
    const L = 40;
    const ex = x + u.x * L, ey = y - u.y * L;
    ctx.strokeStyle = rgba(PLAN, alpha);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = rgba(PLAN, alpha);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(Math.atan2(-u.y, u.x));
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  r.diamond(x, y, 6, rgba(CHALK, 0.1 * alpha), rgba(PLAN, alpha));
  // label hangs below the node, clear of the Ap/Pe label that points outward from the same spot
  if (res.nodeT - t > 1) r.marker(x, y, x, y - 1, [[`Burn in ${fmtDur(res.nodeT - t)}`, rgba(PLAN, alpha)]], PLAN, { dot: false, len: 22 });

  // --- where the target will be at the burn, so the phase angle can be judged by eye
  const tg = world.target;
  if (planner.open && tg && res.nodeT - t > 1) {
    let p = null;
    if (tg.body === cur) {
      const st = world.targetState(res.nodeT);
      p = { x: a0.x + st.x, y: a0.y + st.y };
    } else if (tg.body.parent === cur) {
      const rel = tg.body.relPos(res.nodeT);
      p = { x: a0.x + rel.x, y: a0.y + rel.y };
    } else if (cur.parent && tg.body.parent === cur.parent) {
      p = tg.body.absPos(res.nodeT);
    }
    if (p) {
      const gx = cam.sx(p.x), gy = cam.sy(p.y);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = rgba(TARGET, 0.85);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(gx, gy, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      const name = tg.body === cur ? 'Target' : tg.body.name;
      r.marker(gx, gy, gx, gy + 1, [[`${name} at burn`, rgba(TARGET, 0.9)]], TARGET, { dot: false, len: 18 });
    }
  }

  // --- closest approach the plan leads to
  const ca = planner.open ? res.approach : null;
  if (ca && ca.kind === 'target') {
    const a = r.anchor(world, ca.patch, t);
    const sx = cam.sx(a.x + ca.ship.x), sy = cam.sy(a.y + ca.ship.y);
    const tx = cam.sx(a.x + ca.obj.x), ty = cam.sy(a.y + ca.obj.y);
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = rgba(PLAN, 0.8);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = PLAN;
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = TARGET;
    ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.stroke();
    r.marker(sx, sy, tx, ty, [[`Planned closest ${fmtDist(ca.dist)}`, PLAN]], PLAN, { dot: false });
  }
}
