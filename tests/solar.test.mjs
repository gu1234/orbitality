// The wider Solar System: moons, dwarf planets and asteroids on real-scale rails,
// tiny moons that can be hit but not orbited, and the belts of small bodies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kepler } from '../js/physics/kepler.js';
import { createSystem } from '../js/physics/bodies.js';
import { advance, absoluteState } from '../js/physics/propagate.js';
import { predict } from '../js/physics/predict.js';
import { Belts } from '../js/render/belts.js';

const YEAR = 365.25 * 86400;
const AU = 149.5978707e6;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const wrapDeg = (d) => ((d % 360) + 540) % 360 - 180;

/** A ship state that reaches `body` (plus an offset) at time tHit with relative velocity (dvx, dvy), started dtBack earlier. */
function aimedAt(body, tHit, dtBack, off, dv) {
  const p = body.relPos(tHit), v = body.relVel(tHit);
  const end = { x: p.x + off.x, y: p.y + off.y, vx: v.x + dv.x, vy: v.y + dv.y };
  const s = kepler(end.x, end.y, end.vx, end.vy, body.parent.gm, -dtBack);
  return { body: body.parent, ...s };
}

test('solar system: the new bodies are there with real sizes', () => {
  const sys = createSystem();
  for (const id of ['io', 'europa', 'ganymede', 'callisto', 'titan', 'triton', 'charon', 'phobos', 'deimos',
    'ceres', 'vesta', 'pallas', 'hygiea', 'pluto', 'eris', 'haumea', 'makemake']) {
    assert.ok(sys.byId[id], id);
  }
  close(sys.byId.ganymede.radius / sys.byId.mercury.radius, 1.08, 0.01, 'Ganymede is bigger than Mercury');
  close(2 * Math.PI / sys.byId.io.n / 86400, 1.769, 0.005, 'Io period (days)');
  close(2 * Math.PI / sys.byId.pluto.n / YEAR, 248, 1, 'Pluto period (years)');
  close(sys.byId.pluto.rMin / AU, 29.66, 0.05, 'Pluto perihelion (AU)');
  close(sys.byId.eris.rMax / AU, 97.6, 0.3, 'Eris aphelion (AU)');
  for (const b of sys.bodies) {
    if (!b.parent) continue;
    assert.ok(b.rMax + b.soi < b.parent.soi, `${b.name} stays inside ${b.parent.name}'s SOI`);
    assert.ok(b.rMin - b.soi > b.parent.radius, `${b.name} orbits above ${b.parent.name}'s surface`);
  }
});

test('solar system: the planets and the Moon keep their circular rails', () => {
  const sys = createSystem();
  for (const id of ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    const b = sys.byId[id];
    assert.equal(b.e, 0, id);
    const t = 1.7e8;
    const th = b.phase0 + b.n * t;
    const p = b.relPos(t), v = b.relVel(t);
    close(Math.hypot(p.x - b.a * Math.cos(th), p.y - b.a * Math.sin(th)), 0, 1e-6, `${id} position`);
    close(Math.hypot(v.x + b.speed * Math.sin(th), v.y - b.speed * Math.cos(th)), 0, 1e-12, `${id} velocity`);
  }
});

test('elliptical rails: velocity is the rate of change of position, and speed follows vis-viva', () => {
  const sys = createSystem();
  for (const id of ['pluto', 'eris', 'pallas', 'ceres']) {
    const b = sys.byId[id];
    for (const t of [-3e9, 0, 1.234e8, 4e9]) {
      const h = 20;
      const p1 = b.relPos(t - h), p2 = b.relPos(t + h), v = b.relVel(t);
      const dvx = (p2.x - p1.x) / (2 * h), dvy = (p2.y - p1.y) / (2 * h);
      close(Math.hypot(dvx - v.x, dvy - v.y), 0, 1e-6, `${id} velocity at ${t}`);
      const r = Math.hypot(b.relPos(t).x, b.relPos(t).y);
      assert.ok(r >= b.rMin - 1 && r <= b.rMax + 1, `${id} between perihelion and aphelion`);
      close(Math.hypot(v.x, v.y) ** 2, b.parent.gm * (2 / r - 1 / b.a), 1e-9, `${id} vis-viva`);
    }
  }
});

test('elliptical and retrograde rails: setAngleAt puts the body at that angle', () => {
  const sys = createSystem();
  for (const id of ['pluto', 'eris', 'triton', 'titania', 'moon']) {
    const b = sys.byId[id];
    for (const deg of [0, 77, 181, 300]) {
      b.setAngleAt(deg, 5e7);
      const p = b.relPos(5e7);
      close(wrapDeg((Math.atan2(p.y, p.x) * 180) / Math.PI - deg), 0, 1e-7, `${id} at ${deg}°`);
    }
  }
});

test('orbits tipped over with their planet run clockwise seen from above', () => {
  const sys = createSystem();
  for (const id of ['triton', 'charon', 'miranda', 'ariel', 'umbriel', 'titania', 'oberon', 'io', 'titan', 'pluto']) {
    const b = sys.byId[id];
    const p = b.relPos(1e6), v = b.relVel(1e6);
    const h = p.x * v.y - p.y * v.x;
    assert.equal(Math.sign(h), b.dir, id);
    assert.equal(b.dir, ['io', 'titan', 'pluto'].includes(id) ? 1 : -1, id);
  }
});

test('Pluto crosses Neptune\'s orbit but the 3:2 resonance keeps them far apart', () => {
  const sys = createSystem();
  const P = sys.byId.pluto, N = sys.byId.neptune;
  assert.ok(P.rMin < N.a, 'perihelion inside Neptune\'s orbit');
  let min = Infinity;
  for (let t = -1000 * YEAR; t < 1000 * YEAR; t += 0.25 * YEAR) {
    const a = P.relPos(t), b = N.relPos(t);
    min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
  }
  assert.ok(min > 15 * AU, `closest ${(min / AU).toFixed(1)} AU`); // really about 17 AU
});

test('no two bodies\' spheres of influence ever overlap', () => {
  const sys = createSystem();
  for (const P of sys.bodies) {
    const kids = P.children;
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const A = kids[i], B = kids[j];
        if (A.rMax + A.soi < B.rMin - B.soi || B.rMax + B.soi < A.rMin - A.soi) continue;
        const Tmin = 2 * Math.PI / Math.max(A.n, B.n);
        const span = P.parent ? 50 * 2 * Math.PI / Math.min(A.n, B.n) : 300 * YEAR;
        for (let t = -span; t < span; t += Tmin / 200) {
          const a = A.relPos(t), b = B.relPos(t);
          assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > A.soi + B.soi, `${A.name} and ${B.name} at ${t}`);
        }
      }
    }
  }
});

test('tiny moons: Phobos can be hit but not orbited', () => {
  const sys = createSystem();
  const phobos = sys.byId.phobos;
  assert.ok(phobos.tiny && sys.byId.deimos.tiny && sys.byId.mimas.tiny);
  assert.ok(!sys.byId.io.tiny && !sys.byId.enceladus.tiny && !sys.byId.moon.tiny);
  const tHit = 20000;
  const st = aimedAt(phobos, tHit, 3000, { x: 0, y: 0 }, { x: 0.25, y: 0.1 });
  const pred = predict(st, tHit - 3000);
  assert.equal(pred[0].end, 'impact');
  assert.equal(pred[0].hit, phobos);
  const res = advance(st, tHit - 3000, 5000);
  assert.equal(res.event?.type, 'impact');
  assert.equal(res.event.hit, phobos);
  assert.equal(st.body, sys.byId.mars, 'still in Mars\'s frame');
  const p = phobos.relPos(tHit - 3000 + res.dt);
  close(Math.hypot(st.x - p.x, st.y - p.y), phobos.radius, 0.05, 'stops at Phobos\'s surface');
  // a surface impact still names the frame's body
  const low = { body: sys.byId.mars, x: 3000, y: 0, vx: 0, vy: 1 };
  assert.equal(advance(low, 0, 1e5).event.hit, sys.byId.mars);
});

test('a flyby of Io enters its sphere of influence with the absolute state continuous', () => {
  const sys = createSystem();
  const io = sys.byId.io;
  const tHit = 3e5;
  const st = aimedAt(io, tHit, 86400, { x: 2500, y: 0 }, { x: -1.5, y: 4 });
  const res = advance(st, tHit - 86400, 2 * 86400);
  assert.equal(res.event?.type, 'enter');
  assert.equal(st.body, io);
  const te = res.event.t;
  const before = absoluteState({ body: sys.byId.jupiter, ...res.event.rel }, te);
  const after = absoluteState(st, te);
  close(Math.hypot(before.x - after.x, before.y - after.y), 0, 1e-5, 'abs pos continuous');
  close(Math.hypot(before.vx - after.vx, before.vy - after.vy), 0, 1e-9, 'abs vel continuous');
});

test('an encounter with Pluto on its ellipse enters its SOI with the absolute state continuous', () => {
  const sys = createSystem();
  const pluto = sys.byId.pluto;
  const tHit = 2e8;
  const st = aimedAt(pluto, tHit, 60 * 86400, { x: 1e6, y: 0 }, { x: -1, y: 12 });
  const res = advance(st, tHit - 60 * 86400, 120 * 86400);
  assert.equal(res.event?.type, 'enter');
  assert.equal(st.body, pluto);
  const te = res.event.t;
  const before = absoluteState({ body: sys.root, ...res.event.rel }, te);
  const after = absoluteState(st, te);
  close(Math.hypot(before.x - after.x, before.y - after.y), 0, 1e-3, 'abs pos continuous');
  close(Math.hypot(before.vx - after.vx, before.vy - after.vy), 0, 1e-9, 'abs vel continuous');
});

test('moons disappear into their planet when zoomed out; planets never do', () => {
  const sys = createSystem();
  const whole = 5e-9, near = 1e-3;
  for (const id of ['moon', 'io', 'titan', 'charon', 'ceres']) {
    assert.ok(sys.byId[id].collapsed(whole), `${id} hidden at system zoom`);
  }
  assert.ok(!sys.byId.pluto.collapsed(whole) && !sys.byId.eris.collapsed(whole), 'the Kuiper belt\'s dwarf planets show up');
  assert.ok(!sys.byId.io.collapsed(near), 'Io shows up close to Jupiter');
  for (const b of sys.bodies) if (b.kind === 'planet') assert.ok(!b.collapsed(whole), b.name);
});

test('belts: a deterministic sample with its real resonant structure', () => {
  const sys = createSystem();
  const groups = new Belts().groups(sys);
  const byName = Object.fromEntries(groups.map((g) => [g.name, g]));
  assert.deepEqual(groups.map((g) => g.name), ['Asteroid belt', 'Hildas', 'Trojans', 'Kuiper belt']);
  const again = new Belts().groups(createSystem());
  assert.deepEqual(again[0].el.slice(0, 14), groups[0].el.slice(0, 14), 'same dots every time');

  const J = sys.byId.jupiter, N = sys.byId.neptune;
  const main = byName['Asteroid belt'];
  main.positions(0, J.angle(0));
  for (let i = 0; i < main.xs.length; i++) {
    const r = Math.hypot(main.xs[i], main.ys[i]) / AU;
    assert.ok(r > 1.35 && r < 4.4, `asteroid at ${r} AU`);
  }

  // Trojans stay near 60° ahead of and behind Jupiter
  const tro = byName.Trojans;
  for (const t of [0, 40 * YEAR]) {
    tro.positions(t, J.angle(t));
    const lam = (J.angle(t) * 180) / Math.PI;
    for (let i = 0; i < tro.xs.length; i++) {
      const d = Math.abs(wrapDeg((Math.atan2(tro.ys[i], tro.xs[i]) * 180) / Math.PI - lam));
      assert.ok(d > 15 && d < 110, `Trojan ${d}° from Jupiter`);
    }
  }

  // plutinos (a at the 3:2 with Neptune) never come near Neptune
  const kb = byName['Kuiper belt'];
  const aP = N.a * Math.pow(1.5, 2 / 3);
  const plutinos = [];
  for (let i = 0; i < kb.el.length; i += 7) if (Math.abs(kb.el[i] - aP) < 1) plutinos.push(i / 7);
  assert.equal(plutinos.length, 450);
  let min = Infinity;
  for (let t = 0; t < 400 * YEAR; t += YEAR) {
    kb.positions(t, J.angle(t));
    const n = N.relPos(t);
    for (const k of plutinos) min = Math.min(min, Math.hypot(kb.xs[k] - n.x, kb.ys[k] - n.y));
  }
  assert.ok(min > 5 * AU, `a plutino came within ${(min / AU).toFixed(1)} AU of Neptune`);
});
