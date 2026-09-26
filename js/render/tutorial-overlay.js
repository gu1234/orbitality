// Flight School overlay, drawn on top of the normal frame: labelled burn
// directions at the ship and pulsing rings on the apsis markers.

import { pointAt } from '../physics/kepler.js';
import { COL } from './renderer.js';

const TWO_PI = Math.PI * 2;
const FONT = '600 15px "Barlow Condensed", "Arial Narrow", sans-serif';
const NAMES = { prograde: 'Prograde', retrograde: 'Retrograde', radialIn: 'Radial in', radialOut: 'Radial out' };
const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Draw the current step's overlay. `hoverDir` is the burn button under the mouse, if any. */
export function drawTutorialOverlay(renderer, world, cam, step, hoverDir) {
  if (!step || world.status !== 'flying') return;
  if (step.pulse && world.prediction) pulses(renderer, world, cam, step.pulse);
  if (step.vectors) vectors(renderer, world, cam, step.vectors, hoverDir);
}

function pulses(renderer, world, cam, which) {
  const p = world.prediction[0];
  if (!p || p.body !== world.ship.body) return;
  const el = p.el;
  // same conditions as the Ap/Pe markers themselves
  if (el.circular || (el.e < 1 ? el.a : el.rp) * cam.scale < 12) return;
  const ctx = renderer.ctx;
  const a = p.body.absPos(world.t);
  const k = reducedMotion?.matches ? 0.35 : (performance.now() / 1300) % 1;
  const pt = { x: 0, y: 0 };
  for (const id of which) {
    if (id === 'ap' && (el.e >= 1 || el.ra > p.body.soi)) continue;
    pointAt(el, id === 'ap' ? Math.PI : 0, pt);
    const x = cam.sx(a.x + pt.x), y = cam.sy(a.y + pt.y);
    ctx.strokeStyle = rgba(COL.ship, 0.9 * (1 - k));
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 5 + 16 * k, 0, TWO_PI);
    ctx.stroke();
  }
}

function vectors(renderer, world, cam, dirs, hoverDir) {
  const ctx = renderer.ctx;
  const p = world.shipAbs();
  const x = cam.sx(p.x), y = cam.sy(p.y);
  const r0 = 14, r1 = 52;
  for (const dir of dirs) {
    // the ship already draws a guide for the burn in progress or under the mouse
    if (world.burn.dir === dir || hoverDir === dir) continue;
    const u = world.burnVector(dir);
    if (!u) continue;
    const ux = u.x, uy = -u.y; // screen y points down
    ctx.strokeStyle = rgba(COL.ship, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + ux * r0, y + uy * r0);
    ctx.lineTo(x + ux * r1, y + uy * r1);
    ctx.stroke();
    ctx.save();
    ctx.translate(x + ux * r1, y + uy * r1);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.fillStyle = rgba(COL.ship, 0.9);
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-4, -5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const align = ux > 0.35 ? 'left' : ux < -0.35 ? 'right' : 'center';
    const lx = x + ux * (r1 + 10), ly = y + uy * (r1 + 10) + (align === 'center' ? Math.sign(uy || 1) * 5 : 0);
    renderer.label(NAMES[dir], lx, ly, COL.ship, align, FONT);
  }
}
