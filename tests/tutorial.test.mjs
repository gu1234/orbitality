// Flight School: fly every step the way a player would (holding burn buttons
// through World.update, with a human reaction delay) and check each goal is met.

import test from 'node:test';
import assert from 'node:assert/strict';
import { World, WARPS } from '../js/game/world.js';
import { TUTORIAL, beginStep, evaluate, completeStep, snapshot, restore, burnedSince, apsisNames } from '../js/game/tutorial.js';

const DT = 1 / 60;
const REACT = 0.2; // s between seeing the number and letting go
const step = (id) => TUTORIAL.steps.find((s) => s.id === id);

function apsisAlts(w) {
  const el = w.shipElements();
  const R = w.ship.body.radius;
  return { el, pe: el.rp - R, ap: el.e < 1 ? el.ra - R : Infinity };
}

/** Hold a burn until `until(w)` is true, then keep holding for the reaction delay. Returns seconds held. */
function hold(w, dir, until, { react = REACT, max = 20 } = {}) {
  assert.ok(w.startBurn(dir), `can burn ${dir}`);
  let t = 0;
  while (t < max && w.status === 'flying' && !until(w)) { w.update(DT); t += DT; }
  for (let r = 0; r < react && w.status === 'flying'; r += DT) { w.update(DT); t += DT; }
  w.stopBurn();
  w.update(DT);
  return t;
}

function warpTo(w, id) {
  const o = w.warpOptions().find((x) => x.id === id);
  assert.ok(o, `warp option ${id} offered`);
  w.warpTo(o.t, o.label);
  for (let i = 0; i < 20000 && w.warpTarget; i++) w.update(DT);
  assert.equal(w.warpTarget, null, 'warp finished');
}

/** Enter a step on the current world (or its own), as the game does. */
function enter(state, id) {
  const s = step(id);
  if (s.level) state.w = new World(s.level);
  state.ctx = beginStep(s, state.w);
  state.step = s;
  assert.equal(evaluate(s, state.w, state.ctx).met, false, `${id} is not already met`);
  return state.w;
}

function assertMet(state) {
  const ev = evaluate(state.step, state.w, state.ctx);
  assert.ok(ev.met, `${state.step.id} met (note: ${ev.note})`);
  const html = completeStep(state.step, state.w, state.ctx);
  assert.ok(typeof html === 'string' && html.length > 20, `${state.step.id} has a done text`);
  return html;
}

test('flight school: every step can be completed like a player would', () => {
  const st = {};
  let w;

  // 1. time warp
  w = enter(st, 'orbit');
  assert.equal(w.ship.body.id, 'earth');
  w.setWarpIndex(WARPS.indexOf(100));
  assert.equal(evaluate(st.step, w, st.ctx).met, false);
  w.setWarpIndex(WARPS.indexOf(500));
  assertMet(st);

  // 2. prograde: one hold of a few seconds raises Ap past 2,000 km
  w = enter(st, 'prograde');
  assert.equal(w.warp, 50);
  const held = hold(w, 'prograde', (w) => apsisAlts(w).ap > 2100);
  assert.ok(held < 5, `prograde hold took ${held.toFixed(1)} s`);
  assertMet(st);

  // 3. warp to apoapsis
  w = enter(st, 'apsides');
  warpTo(w, 'ap');
  assert.ok(Math.PI - Math.abs(w.shipElements().nu) < 0.02, 'the warp lands on apoapsis');
  const speeds = assertMet(st);
  assert.match(speeds, /slowest at apoapsis/);
  assert.equal(w.warp, 1, 'time slows to 1x at apoapsis');

  // 4. circularize: release late, then correct the overshoot with the other button
  w = enter(st, 'circularize');
  let holds = 0;
  for (let dir = 'prograde'; holds < 6 && !evaluate(st.step, w, st.ctx).met; holds++) {
    const e0 = w.shipElements().e;
    hold(w, dir, (w) => w.shipElements().e < 0.01 || w.shipElements().e > e0 + 0.02);
    dir = dir === 'prograde' ? 'retrograde' : 'prograde';
  }
  assert.ok(holds <= 3, `circularized in ${holds} holds`);
  assertMet(st);
  assert.ok(apsisAlts(w).pe > 1000, 'still well above the ground');

  // 5. retrograde: Pe below 1,000 km, and the period gets shorter
  w = enter(st, 'retrograde');
  const p0 = w.shipElements().period;
  hold(w, 'retrograde', (w) => apsisAlts(w).pe < 900);
  assert.ok(apsisAlts(w).pe > 0, 'did not overshoot into the ground');
  assert.ok(w.shipElements().period < p0, 'period shrank');
  assert.match(assertMet(st), /down from/);

  // 6. radial: about 100 m/s of radial burning
  w = enter(st, 'radial');
  const argPe0 = w.shipElements().argPe;
  hold(w, 'radialOut', (w) => burnedSince(w, st.ctx, ['radialOut']) >= 100);
  assertMet(st);
  assert.notEqual(w.shipElements().argPe, argPe0, 'the orbit swung');

  // 7. perihelion and aphelion around the Sun
  w = enter(st, 'helio');
  assert.equal(w.ship.body.id, 'sun');
  assert.deepEqual(apsisNames(w.ship.body), { pe: 'Perihelion', ap: 'Aphelion' });
  warpTo(w, 'ap');
  assert.equal(w.ship.body.id, 'sun');
  assert.match(assertMet(st), /took/);
});

test('flight school: the solar orbit is not captured by any planet', () => {
  const w = new World(step('helio').level);
  const el = w.shipElements();
  // the ship starts at perihelion, at Earth's distance, going the planets' way
  assert.ok(Math.abs(el.rp - w.body('earth').a) < 1000);
  assert.ok(Math.abs(el.ra - w.body('mars').a) < 1000);
  const pred = w.refreshPrediction(true);
  assert.equal(pred.length, 1, 'no SOI change in the prediction');
  assert.equal(pred[0].end, 'horizon');
  w.coast(el.period * 1.5);
  assert.equal(w.ship.body.id, 'sun', 'still orbiting the Sun after 1.5 laps');
});

test('flight school: notes steer a player who goes off track', () => {
  const st = {};
  let w = enter(st, 'orbit');
  w = enter(st, 'prograde');
  // far too much prograde: escape, and the note says so
  hold(w, 'prograde', (w) => w.shipElements().e >= 1, { react: 0 });
  const ev = evaluate(st.step, w, st.ctx);
  assert.equal(ev.met, false);
  assert.match(ev.note, /Retrograde/);
});

/** Let time run without touching anything, checking the step every frame. Returns the first frame's evaluation that met it, or null. */
function idle(w, st, seconds) {
  const notes = new Set();
  for (let t = 0; t < seconds; t += DT) {
    w.update(DT);
    const ev = evaluate(st.step, w, st.ctx);
    if (ev.note) notes.add(ev.note);
    if (ev.met) return { met: true, notes };
  }
  return { met: false, notes };
}

test('flight school: coasting past apoapsis does not count as warping to it', () => {
  const st = {};
  let w = enter(st, 'orbit');
  w = enter(st, 'prograde');
  hold(w, 'prograde', (w) => apsisAlts(w).ap > 2100);
  w = enter(st, 'apsides');
  // at the step's 50x warp the ship drifts through apoapsis on its own within about a minute
  const period = w.shipElements().period;
  const r = idle(w, st, (period / 50) * 1.2);
  assert.equal(r.met, false, 'passing Ap on its own must not complete the step');
  assert.ok([...r.notes].some((n) => /Warp to/.test(n)), 'a note points to Warp to as Ap goes by');
  // stopping a warp-to part way does not count either
  const o = w.warpOptions().find((x) => x.id === 'ap');
  w.warpTo(o.t, o.label);
  for (let i = 0; i < 20; i++) w.update(DT);
  w.setWarpIndex(0);
  w.update(DT);
  assert.equal(evaluate(st.step, w, st.ctx).met, false, 'a cancelled warp-to does not count');
  warpTo(w, 'ap');
  assertMet(st);
});

test('flight school: drifting to aphelion at high warp does not count either', () => {
  const st = {};
  const w = enter(st, 'helio');
  const r = idle(w, st, (w.shipElements().period / w.warp) * 0.7);
  assert.equal(r.met, false, 'passing aphelion on its own must not complete the step');
  // the game labels the Sun's warp-to option "Aphelion"
  const o = w.warpOptions().find((x) => x.id === 'ap');
  w.warpTo(o.t, apsisNames(w.ship.body).ap);
  for (let i = 0; i < 20000 && w.warpTarget; i++) w.update(DT);
  assertMet(st);
});

test('flight school: a crash rewinds to the start of the step', () => {
  const st = {};
  let w = enter(st, 'orbit');
  w = enter(st, 'radial');
  const snap = snapshot(w);
  hold(w, 'radialIn', (w) => apsisAlts(w).pe < -2000, { react: 0 });
  assert.match(evaluate(st.step, w, st.ctx).note, /hits Earth/);
  w.coast(w.shipElements().period);
  assert.equal(w.status, 'crashed');
  restore(w, snap);
  st.ctx = beginStep(st.step, w);
  assert.equal(w.status, 'flying');
  assert.equal(w.t, snap.t);
  assert.ok(Math.abs(apsisAlts(w).pe - 400) < 1, 'back in the starting orbit');
  assert.equal(evaluate(st.step, w, st.ctx).met, false);
});
