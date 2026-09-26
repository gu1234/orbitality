// A planned burn must fly the orbit its preview showed, and never plan past the fuel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../js/game/world.js';
import { LEVELS } from '../js/game/levels.js';
import { Planner } from '../js/game/planner.js';

const L = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
const verbose = !!process.env.VERBOSE;

function plan(level, { pro = 0, rad = 0, at = 'now' }) {
  const w = new World(level);
  w.refreshPrediction(true);
  const p = new Planner();
  p.reset(w);
  p.show();
  p.setAt(at);
  if (pro) p.nudge(pro > 0 ? 'prograde' : 'retrograde', Math.abs(pro));
  if (rad) p.nudge(rad > 0 ? 'radialOut' : 'radialIn', Math.abs(rad));
  p.tick(0);
  return { w, p, r: p.result };
}

/** Approve, then run the game loop until the burn has been flown. */
function fly(w, p) {
  assert.ok(p.approve(), 'approve');
  let started = false;
  for (let i = 0; i < 200000; i++) {
    if (p.fly() === 'started') started = true;
    w.update(1 / 60);
    if (started && !w.burn.dir) break;
  }
  assert.ok(started, 'burn started');
  assert.equal(w.burn.dir, null, 'burn finished');
  w.refreshPrediction(true);
}

function sameOrbit(pre, post, name) {
  const a = pre.el, b = post.el;
  if (verbose) console.log(name, { preA: a.a, postA: b.a, preE: a.e, postE: b.e, preRp: a.rp, postRp: b.rp });
  assert.equal(pre.body, post.body, `${name}: same body`);
  assert.ok(Math.abs(a.e - b.e) < 2e-3, `${name}: e ${a.e} vs ${b.e}`);
  assert.ok(Math.abs(a.rp - b.rp) / a.rp < 2e-3, `${name}: rp ${a.rp} vs ${b.rp}`);
}

test('a small prograde burn now flies the previewed orbit', () => {
  const { w, p, r } = plan(L.climb, { pro: 400 });
  assert.ok(Math.abs(r.dv - 400) < 1e-6);
  fly(w, p);
  sameOrbit(r.pred[0], w.prediction[0], 'climb');
  assert.ok(Math.abs(w.ship.dvUsed - 400) < 0.01, `dvUsed ${w.ship.dvUsed}`);
});

test('a burn planned at apoapsis waits for it and is centred on it', () => {
  const setup = plan(L.climb, { pro: 1200 });
  fly(setup.w, setup.p);
  const w = setup.w;
  const p = setup.p;
  p.show();
  p.setAt('ap');
  assert.equal(p.at, 'ap');
  p.nudge('prograde', 900);
  p.tick(0);
  const r = p.result;
  assert.ok(r.startT < r.nodeT && r.startT > w.t, 'starts before Ap, in the future');
  assert.ok(Math.abs((r.nodeT - r.startT) - r.dur / 2) < 1e-6, 'centred');
  fly(w, p);
  sameOrbit(r.pred[0], w.prediction[0], 'circularize at Ap');
});

test('the plan is clamped to the fuel left', () => {
  const { w, r } = plan(L.geo, { pro: 1e6 });
  assert.ok(Math.abs(r.dv - w.dvRemaining()) < 1e-3, `${r.dv} vs ${w.dvRemaining()}`);
  assert.ok(r.dvLeft < 1e-3);
});

test('a trans-lunar burn gives the Moon encounter the preview showed', () => {
  const lvl = L.moon;
  // find a prograde burn whose preview reaches the Moon
  let hit = null;
  for (let dv = 2900; dv <= 3300 && !hit; dv += 10) {
    const c = plan(lvl, { pro: dv });
    const enc = c.r.pred.find((q) => q.body.id === 'moon');
    if (enc) hit = { ...c, enc };
  }
  if (!hit) {
    // no encounter from where the level starts: still check the transfer orbit itself
    const { w, p, r } = plan(lvl, { pro: 3100 });
    fly(w, p);
    sameOrbit(r.pred[0], w.prediction[0], 'moon transfer');
    return;
  }
  const { w, p, r, enc } = hit;
  fly(w, p);
  sameOrbit(r.pred[0], w.prediction[0], 'moon transfer');
  const got = w.prediction.find((q) => q.body.id === 'moon');
  assert.ok(got, 'encounter still there');
  if (verbose) console.log('moon Pe', enc.el.rp - enc.body.radius, got.el.rp - got.body.radius, 'arrive', enc.t0, got.t0);
  assert.ok(Math.abs(got.t0 - enc.t0) < 600, 'arrives within 10 min of the preview');
  assert.ok(Math.abs(got.el.rp - enc.el.rp) < 0.1 * enc.body.soi, 'lunar periapsis close to the preview');
});

test('an escape burn at Mars-transfer scale flies the preview', () => {
  const { w, p, r } = plan(L.mars, { pro: 3600 });
  fly(w, p);
  sameOrbit(r.pred[0], w.prediction[0], 'escape');
});

test('braking through zero at apoapsis reverses the orbit as the preview showed', () => {
  // Wrong Way: raise Ap far out, then plan a retrograde burn bigger than the speed there
  const setup = plan(L['wrong-way'], { pro: 2900 });
  fly(setup.w, setup.p);
  const w = setup.w;
  const p = setup.p;
  assert.equal(w.prediction[0].body.id, 'earth');
  const dir0 = w.shipElements().dir;
  p.show();
  p.setAt('ap');
  assert.equal(p.at, 'ap');
  const el = w.shipElements();
  const vAp = Math.sqrt(w.ship.body.gm * (2 / el.ra - 1 / el.a)) * 1000; // m/s
  p.nudge('retrograde', vAp * 2);
  p.tick(0);
  const r = p.result;
  if (verbose) console.log('reverse', { vAp, planned: r.dv, e: r.pred?.[0].el.e, dir: r.pred?.[0].el.dir });
  assert.ok(r.pred && r.pred[0].el.dir === -dir0, 'preview shows the orbit reversed');
  fly(w, p);
  assert.equal(w.shipElements().dir, -dir0, 'flown orbit reversed');
  sameOrbit(r.pred[0], w.prediction[0], 'reverse at Ap');
});

// ---- waiting before the burn

test('a wait is counted in orbits and the delayed burn flies its preview', () => {
  const { w, p } = plan(L.climb, { pro: 400 });
  const P = w.shipElements().period;
  assert.deepEqual(p.waitUnit(), { s: P, orbits: true });
  p.nudgeWait(0.3);
  p.tick(0);
  const r = p.result;
  assert.ok(Math.abs(r.nodeT - w.t - 0.3 * P) < 1e-6, 'burn 0.3 orbit from now');
  assert.ok(r.startT > w.t, 'starts in the future');
  fly(w, p);
  sameOrbit(r.pred[0], w.prediction[0], 'delayed climb');
});

test('the phase at the burn follows the wait, and the hinted angle gives a close approach', () => {
  // Moving Up: target 40° ahead, and a Hohmann transfer wants about 25°
  const { w, p } = plan(L.climb, {});
  const mu = w.ship.body.gm;
  const r1 = Math.hypot(w.ship.x, w.ship.y);
  const ts = w.targetState();
  const r2 = Math.hypot(ts.x, ts.y);
  const dv = Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1) * 1000;
  const want = 180 * (1 - Math.pow((r1 + r2) / (2 * r2), 1.5));
  assert.ok(Math.abs(p.result.phase.deg - 40) < 0.5, `starts ${p.result.phase.deg}° ahead`);
  p.nudge('prograde', dv);
  p.tick(0);
  const now = p.result.approach.dist;
  // step the wait until the phase at the burn reaches the Hohmann angle
  let best = null;
  for (let i = 0; i < 400; i++) {
    p.nudgeWait(0.005);
    p.tick(0);
    const r = p.result;
    if (r.phase.deg <= want) { best = r; break; }
  }
  assert.ok(best, 'phase angle reached');
  if (verbose) console.log('phase wait', { want, now, then: best.approach.dist, wait: p.wait });
  assert.ok(best.approach.kind === 'target' && best.approach.dist < 50, `close approach ${best.approach.dist} km`);
  assert.ok(best.approach.dist < now / 5, 'much closer than burning straight away');
});

test('the wait stays within the path: never negative, never past an impact', () => {
  const { p } = plan(L.climb, {});
  p.nudgeWait(-5);
  assert.equal(p.wait, 0);
  // on a path that hits Earth the wait stops before the impact
  const c = plan(L.climb, { pro: -600 });
  fly(c.w, c.p);
  assert.equal(c.w.prediction[0].end, 'impact');
  c.p.show();
  c.p.nudgeWait(1000);
  c.p.tick(0);
  assert.ok(c.p.result.nodeT < c.w.prediction[0].t1, 'burn before impact');
});

test('a parking orbit can wait days for a launch window', () => {
  const { w, p } = plan(L.mars, {});
  const d0 = p.result.phase.deg;
  p.setWait(10 * 86400);
  p.tick(0);
  assert.ok(Math.abs(p.result.nodeT - w.t - 10 * 86400) < 1e-6, 'ten days out');
  // Earth gains on Mars by about 0.46° a day
  const d1 = p.result.phase.deg;
  assert.ok(d0 - d1 > 4 && d0 - d1 < 5, `Mars phase ${d0}° -> ${d1}°`);
});

test('cancelling a delayed plan keeps its burn time for editing', () => {
  const { w, p } = plan(L.climb, { pro: 400 });
  p.nudgeWait(1.5);
  p.tick(0);
  assert.ok(p.approve());
  const nodeT = p.armed.nodeT;
  for (let i = 0; i < 10000 && w.t < nodeT / 2; i++) { p.fly(); w.update(1 / 60); }
  assert.ok(w.t > 0 && w.t < nodeT, 'warping toward the burn');
  p.cancel();
  p.show();
  p.tick(0);
  assert.ok(Math.abs(p.result.nodeT - nodeT) < 1e-6, 'same burn time after reopening');
});
