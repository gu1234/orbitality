// Every level must be solvable by a scripted pilot within its fuel budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, SANDBOX } from '../js/game/levels.js';
import { closestApproach } from '../js/physics/predict.js';
import {
  makeWorld, burn, coastTo, probe, approachFor, search1D, phaseNow, finalApproach,
  centeredBurn, trim, elements, timeToPeriapsis, timeToApoapsis,
} from './autopilot.mjs';

const L = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
const verbose = !!process.env.VERBOSE;
const log = (...a) => verbose && console.log(...a);

function report(w, name) {
  const used = w.ship.dvUsed;
  log(`${name}: status=${w.status} dvUsed=${used.toFixed(0)} m/s par=${w.level.par} fuel=${w.level.fuel ?? '∞'} t=${(w.t / 3600).toFixed(1)} h`);
  return used;
}

function assertWon(w, name) {
  const used = report(w, name);
  assert.equal(w.status, 'caught', `${name} not caught`);
  if (w.level.fuel) assert.ok(used <= w.level.fuel + 1e-6, `${name} over budget`);
  return used;
}

/** Hohmann-style: find burn time (within one synodic sweep) + Δv giving the best intercept. */
function transferTo(w, dir, { tMax, dt, dvLo, dvHi }) {
  let best = null;
  const t0 = w.t;
  for (let tb = t0; tb <= t0 + tMax; tb += dt) {
    coastTo(w, tb);
    // total cost = departure Δv + Δv to match at arrival, heavily penalizing a miss
    const r = search1D((dv) => {
      const pred = probe(w, dir, dv);
      if (pred.some((p) => p.end === 'impact')) return 1e12;
      const ca = approachFor(w, pred);
      return ca ? dv + ca.relSpeed * 1000 + Math.max(0, ca.dist - 2) * 50 : 1e12;
    }, dvLo, dvHi, 20);
    if (!best || r.v < best.v) best = { t: tb, dv: r.x, v: r.v };
  }
  return best;
}

test('level list sanity', () => {
  assert.ok(LEVELS.length >= 10);
  for (const l of [...LEVELS, SANDBOX]) {
    const w = makeWorld(l);
    assert.ok(w.ship, l.id);
    const el = w.shipElements();
    assert.ok(el.rp > w.ship.body.radius, `${l.id} ship starts above surface`);
    if (w.target) {
      const tel = elements(w.target.s0.x, w.target.s0.y, w.target.s0.vx, w.target.s0.vy, w.target.body.gm);
      assert.ok(tel.rp > w.target.body.radius, `${l.id} target above surface`);
      assert.ok(tel.ra < w.target.body.soi, `${l.id} target stays in SOI`);
    }
  }
});

test('catch-up: retrograde phasing', () => {
  const w = makeWorld(L['catch-up']);
  phaseNow(w, 150);
  assert.ok(finalApproach(w));
  assert.ok(assertWon(w, 'catch-up') <= w.level.par);
});

test('hold-back: prograde phasing', () => {
  const w = makeWorld(L['hold-back']);
  phaseNow(w, 150);
  assert.ok(finalApproach(w));
  assert.ok(assertWon(w, 'hold-back') <= w.level.par);
});

test('climb: Hohmann up', () => {
  const w = makeWorld(L.climb);
  const plan = transferTo(w, 'prograde', { tMax: 5600, dt: 60, dvLo: 300, dvHi: 500 });
  log('climb plan', plan);
  const w2 = makeWorld(L.climb);
  centeredBurn(w2, 'prograde', plan.dv, plan.t);
  trim(w2);
  assert.ok(finalApproach(w2));
  assert.ok(assertWon(w2, 'climb') <= w2.level.par);
});

test('descend: Hohmann down', () => {
  const w = makeWorld(L.descend);
  const plan = transferTo(w, 'retrograde', { tMax: 7700, dt: 60, dvLo: 250, dvHi: 500 });
  log('descend plan', plan);
  const w2 = makeWorld(L.descend);
  centeredBurn(w2, 'retrograde', plan.dv, plan.t);
  trim(w2);
  assert.ok(finalApproach(w2));
  assert.ok(assertWon(w2, 'descend') <= w2.level.par);
});

test('ellipse: match at tangent point, then phase', () => {
  const w = makeWorld(L.ellipse);
  const plan = transferTo(w, 'prograde', { tMax: 12000, dt: 60, dvLo: 800, dvHi: 1000 });
  log('ellipse plan', plan);
  const w2 = makeWorld(L.ellipse);
  centeredBurn(w2, 'prograde', plan.dv, plan.t);
  trim(w2);
  assert.ok(finalApproach(w2));
  assert.ok(assertWon(w2, 'ellipse') <= w2.level.par);
});

test('geo: Hohmann to GEO on a budget', () => {
  const w = makeWorld(L.geo);
  const plan = transferTo(w, 'prograde', { tMax: 6000, dt: 60, dvLo: 2300, dvHi: 2500 });
  log('geo plan', plan);
  const w2 = makeWorld(L.geo);
  centeredBurn(w2, 'prograde', plan.dv, plan.t);
  trim(w2);
  assert.ok(finalApproach(w2));
  assertWon(w2, 'geo');
});

test('patience: slow phasing on 160 m/s', () => {
  const w = makeWorld(L.patience);
  const r = search1D((dv) => {
    const pred = probe(w, 'retrograde', dv);
    if (pred.some((p) => p.end === 'impact')) return 1e12;
    const ca = approachFor(w, pred);
    return ca ? ca.dist + dv * 0.5 : 1e12;
  }, 20, 80, 120);
  log('patience plan', r);
  burn(w, 'retrograde', r.x);
  assert.ok(finalApproach(w));
  assertWon(w, 'patience');
});

/** Find a departure burn that gives an encounter with `body` with periapsis altitude near peAlt. */
function planEncounter(w, body, { tMax, dt, dvLo, dvHi, peAlt, dir = 'prograde' }) {
  let best = null;
  const t0 = w.t;
  const score = (pred) => {
    const enc = pred.find((p) => p.body === body);
    if (!enc) return 1e12;
    if (enc.end === 'impact') return 1e9;
    return Math.abs(enc.el.rp - body.radius - peAlt);
  };
  for (let tb = t0; tb <= t0 + tMax; tb += dt) {
    coastTo(w, tb);
    for (let dv = dvLo; dv <= dvHi; dv += (dvHi - dvLo) / 40) {
      const s = score(probe(w, dir, dv, { revs: 1 }));
      if (!best || s < best.v) best = { t: tb, dv, v: s };
    }
  }
  return best;
}

function bodyObj(body) {
  return {
    body: body.parent,
    period: (2 * Math.PI) / body.n,
    stateAt: (t, out) => {
      const p = body.relPos(t), v = body.relVel(t);
      out.x = p.x; out.y = p.y; out.vx = v.x; out.vy = v.y;
      return out;
    },
  };
}

/** Small correction burn now to set periapsis at `body` near peAlt. */
function correct(w, bodyId, peAlt) {
  const body = w.body(bodyId);
  const score = (pred) => {
    const enc = pred.find((p) => p.body === body);
    if (!enc) {
      const ca = closestApproach(pred, bodyObj(body), w.t);
      return ca ? 1e6 + ca.dist : 1e12;
    }
    if (enc.end === 'impact') return 1e5 + (body.radius - enc.el.rp);
    return Math.abs(enc.el.rp - body.radius - peAlt);
  };
  let best = { dir: null, dv: 0, v: score(probe(w, 'prograde', 0, { revs: 1 })) };
  for (const dir of ['prograde', 'retrograde', 'radialIn', 'radialOut']) {
    const r = search1D((dv) => score(probe(w, dir, dv, { revs: 1 })) + dv * 0.3, 0, 80, 80);
    if (r.v < best.v + best.dv * 0.3) best = { dir, dv: r.x, v: r.v };
  }
  if (best.dir) burn(w, best.dir, best.dv);
  return best;
}

/** Arrive at `body`, capture into a low circular orbit, then phase & catch. */
function captureAndCatch(w, bodyId) {
  const body = w.body(bodyId);
  // go to periapsis inside the body's SOI
  let guard = 0;
  while (w.ship.body !== body && guard++ < 10) {
    w.refreshPrediction(true);
    const p0 = w.prediction[0];
    if (p0.end !== 'enter') break;
    coastTo(w, p0.t1 + 1);
  }
  assert.equal(w.ship.body, body, 'reached SOI');
  const el = w.shipElements();
  coastTo(w, w.t + timeToPeriapsis(el) - 60);
  // capture: brake to circular (retrograde until Ap drops to roughly Pe)
  const e2 = w.shipElements();
  const vc = Math.sqrt(body.gm / e2.r);
  burn(w, 'retrograde', (e2.speed - vc) * 1000);
  const e3 = w.shipElements();
  log(`captured around ${body.name}: Pe ${(e3.rp - body.radius).toFixed(0)} Ap ${(e3.ra - body.radius).toFixed(0)} dir ${e3.dir}, target dir ${elements(w.target.s0.x, w.target.s0.y, w.target.s0.vx, w.target.s0.vy, body.gm).dir} dv ${w.ship.dvUsed.toFixed(0)}`);
  // get to the target: a transfer if altitudes differ, else simple phasing
  const tr = Math.hypot(w.target.s0.x, w.target.s0.y);
  if (Math.abs(e3.a - tr) > 20) {
    const dir = tr > e3.a ? 'prograde' : 'retrograde';
    const T = e3.period;
    const hi = Math.abs(Math.sqrt(body.gm / e3.a) - Math.sqrt(body.gm * (2 / e3.a - 2 / (e3.a + tr)))) * 1000 * 2 + 20;
    const plan = transferTo(w, dir, { tMax: T * 1.5, dt: T / 90, dvLo: 0, dvHi: hi });
    log('post-capture transfer', plan);
    centeredBurn(w, dir, plan.dv, plan.t);
  } else {
    phaseNow(w, 150);
  }
  trim(w);
  return e3;
}

function moonRun(level) {
  const w = makeWorld(level);
  const plan = planEncounter(w, w.body('moon'), { tMax: 5600, dt: 30, dvLo: 3050, dvHi: 3200, peAlt: 100 });
  log(level.id, 'TLI plan', plan);
  const w2 = makeWorld(level);
  const moon = w2.body('moon');
  centeredBurn(w2, 'prograde', plan.dv, plan.t);
  // mid-course corrections: soon after the burn and ~1 day out
  coastTo(w2, w2.t + 3600);
  log('mcc1', correct(w2, 'moon', 100));
  coastTo(w2, w2.t + 86400);
  log('mcc2', correct(w2, 'moon', 100));
  const el = captureAndCatch(w2, 'moon');
  // the target orbits in the same direction as the natural capture
  assert.equal(el.dir, elements(w2.target.s0.x, w2.target.s0.y, w2.target.s0.vx, w2.target.s0.vy, moon.gm).dir, 'capture direction matches target');
  assert.ok(finalApproach(w2));
  return w2;
}

test('moon: transfer, capture, catch', () => {
  const w = moonRun(L.moon);
  assert.ok(assertWon(w, 'moon') <= w.level.par);
});

test('moon-budget: within 4.45 km/s', () => {
  const w = moonRun(L['moon-budget']);
  assertWon(w, 'moon-budget');
});

test('wrong-way: reverse far out', () => {
  const w = makeWorld(L['wrong-way']);
  // raise apoapsis to ~700,000 km without meeting the Moon
  let plan = null;
  for (let tb = 0; tb < 5600 && !plan; tb += 300) {
    coastTo(w, tb);
    const pred = probe(w, 'prograde', 3130, { revs: 1 });
    if (pred[0].end === 'horizon' || pred[0].end === 'exit') {
      if (pred[0].end === 'horizon') plan = { t: tb };
    }
  }
  assert.ok(plan, 'found a Moon-free departure');
  const w2 = makeWorld(L['wrong-way']);
  const earth = w2.body('earth');
  coastTo(w2, plan.t);
  burn(w2, 'prograde', 3130);
  const el = w2.shipElements();
  log('wrong-way Ap', el.ra.toFixed(0));
  coastTo(w2, w2.t + timeToApoapsis(el) - 10);
  const v = w2.shipElements().speed * 1000;
  burn(w2, 'retrograde', 2 * v);
  const el2 = w2.shipElements();
  assert.equal(el2.dir, -1, 'reversed');
  assert.equal(w2.ship.body, earth);
  // coast down; the periapsis is roughly where the target orbits
  coastTo(w2, w2.t + timeToPeriapsis(el2) - 30);
  const e3 = w2.shipElements();
  burn(w2, 'retrograde', (e3.speed - Math.sqrt(earth.gm / e3.r)) * 1000);
  phaseNow(w2, 150);
  assert.ok(finalApproach(w2));
  assertWon(w2, 'wrong-way');
});

test('mars: window, escape, capture, catch', { timeout: 600000 }, () => {
  const level = L.mars;
  const w = makeWorld(level);
  // Scan ~20 days of departure opportunities, once per LEO orbit (coarse), then refine.
  let best = null;
  const T = w.shipElements().period;
  for (let day = 0; day < 20; day += 1) {
    for (let k = 0; k < 1; k++) {
      // burn point ~150° before Earth's heliocentric velocity direction
      const tDay = day * 86400;
      const earth = w.body('earth');
      const velAng = earth.angle(tDay) + Math.PI / 2;
      const w2 = makeWorld(level);
      const mars = w2.body('mars');
      coastTo(w2, tDay);
      const ang = Math.atan2(w2.ship.y, w2.ship.x);
      const want = velAng - (150.6 * Math.PI) / 180;
      let d = (want - ang) % (2 * Math.PI);
      if (d < 0) d += 2 * Math.PI;
      const tb = tDay + (d / (2 * Math.PI)) * T;
      for (let off = -300; off <= 300; off += 60) {
        coastTo(w2, tb + off);
        for (let dv = 3500; dv <= 3700; dv += 10) {
          const pred = probe(w2, 'prograde', dv, { revs: 1 });
          const enc = pred.find((p) => p.body === mars);
          let s;
          if (enc) s = enc.end === 'impact' ? 1e6 : Math.abs(enc.el.rp - mars.radius - 300);
          else s = 1e12;
          if (!best || s < best.v) best = { t: tb + off, dv, v: s };
        }
      }
    }
  }
  log('mars plan', best);
  assert.ok(best && best.v < 1e12, 'found a Mars encounter');
  const w3 = makeWorld(level);
  centeredBurn(w3, 'prograde', best.dv, best.t);
  // course corrections: once we are clear of Earth and again halfway
  coastTo(w3, w3.t + 5 * 86400);
  log('mcc1', correct(w3, 'mars', 300));
  coastTo(w3, w3.t + 100 * 86400);
  log('mcc2', correct(w3, 'mars', 300));
  captureAndCatch(w3, 'mars');
  assert.ok(finalApproach(w3));
  assertWon(w3, 'mars');
});
