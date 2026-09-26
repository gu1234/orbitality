import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kepler, elements, stateFromOrbit, timeToPeriapsis, timeToApoapsis, pointAt,
} from '../js/physics/kepler.js';
import { createSystem } from '../js/physics/bodies.js';
import { advance, absoluteState } from '../js/physics/propagate.js';
import { predict, closestApproach } from '../js/physics/predict.js';

const MU = 398600.4418;

// Reference integrator: classic RK4 on (x, y, vx, vy) with a small adaptive step.
function rk4(s, mu, dt) {
  const f = (st) => {
    const r = Math.hypot(st[0], st[1]);
    const k = -mu / (r * r * r);
    return [st[2], st[3], k * st[0], k * st[1]];
  };
  let st = [s.x, s.y, s.vx, s.vy];
  const sign = Math.sign(dt);
  const T = Math.abs(dt);
  let t = 0;
  const add = (a, b, h) => a.map((v, i) => v + h * b[i]);
  while (t < T) {
    const r = Math.hypot(st[0], st[1]);
    const v = Math.hypot(st[2], st[3]);
    const h = Math.min(T - t, 2e-4 * r / v);
    const hs = h * sign;
    const k1 = f(st);
    const k2 = f(add(st, k1, hs / 2));
    const k3 = f(add(st, k2, hs / 2));
    const k4 = f(add(st, k3, hs));
    st = st.map((v0, i) => v0 + (hs / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    t += h;
  }
  return { x: st[0], y: st[1], vx: st[2], vy: st[3] };
}

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('kepler matches RK4 across eccentricities (forward & backward)', () => {
  const cases = [
    { rp: 7000, e: 0 },
    { rp: 7000, e: 0.3 },
    { rp: 7000, e: 0.9 },
    { rp: 7000, e: 1.2 },
    { rp: 7000, e: 3 },
  ];
  for (const c of cases) {
    const p = c.rp * (1 + c.e);
    const s0 = (() => {
      // at periapsis, then move a bit so rdotv != 0
      const v = Math.sqrt(MU / p) * (1 + c.e);
      return kepler(c.rp, 0, 0, v, MU, 600);
    })();
    for (const dt of [123, 3000, -2000]) {
      const a = kepler(s0.x, s0.y, s0.vx, s0.vy, MU, dt);
      const b = rk4(s0, MU, dt);
      const r = Math.hypot(b.x, b.y);
      close(Math.hypot(a.x - b.x, a.y - b.y) / r, 0, 1e-6, `pos e=${c.e} dt=${dt}`);
      close(Math.hypot(a.vx - b.vx, a.vy - b.vy) / Math.hypot(b.vx, b.vy), 0, 1e-6, `vel e=${c.e} dt=${dt}`);
    }
  }
});

test('kepler: many revolutions and near-parabolic stay stable', () => {
  for (const e of [0, 0.5, 0.999]) {
    const rp = 7000;
    const s = stateFromOrbit(MU, rp, rp * (1 + e) / (1 - e), 0.3, 1.0, 1);
    const el = elements(s.x, s.y, s.vx, s.vy, MU);
    const after = kepler(s.x, s.y, s.vx, s.vy, MU, el.period * 100 + 50);
    const direct = kepler(s.x, s.y, s.vx, s.vy, MU, 50);
    close(Math.hypot(after.x - direct.x, after.y - direct.y), 0, 1e-3 * Math.max(1, el.a / 7000), `100 revs e=${e}`);
    const back = kepler(after.x, after.y, after.vx, after.vy, MU, -(el.period * 100 + 50));
    close(Math.hypot(back.x - s.x, back.y - s.y), 0, 1e-3 * Math.max(1, el.a / 7000), `roundtrip e=${e}`);
  }
  // parabolic-ish
  const r = 7000, v = Math.sqrt(2 * MU / r) * (1 + 1e-12);
  const a = kepler(r, 0, 0, v, MU, 5000);
  const b = rk4({ x: r, y: 0, vx: 0, vy: v }, MU, 5000);
  close(Math.hypot(a.x - b.x, a.y - b.y) / Math.hypot(b.x, b.y), 0, 1e-6, 'parabolic');
});

test('elements round-trip and Ap/Pe timing', () => {
  const s = stateFromOrbit(MU, 6771, 20000, 1.1, 2.0, -1);
  const el = elements(s.x, s.y, s.vx, s.vy, MU);
  close(el.rp, 6771, 1e-6, 'rp');
  close(el.ra, 20000, 1e-6, 'ra');
  close(el.nu, 2.0, 1e-9, 'nu');
  assert.equal(el.dir, -1);
  const tp = timeToPeriapsis(el);
  const atPe = kepler(s.x, s.y, s.vx, s.vy, MU, tp);
  close(Math.hypot(atPe.x, atPe.y), 6771, 1e-4, 'r at Pe');
  const ta = timeToApoapsis(el);
  const atAp = kepler(s.x, s.y, s.vx, s.vy, MU, ta);
  close(Math.hypot(atAp.x, atAp.y), 20000, 1e-4, 'r at Ap');
  const pt = pointAt(el, el.nu);
  close(Math.hypot(pt.x - s.x, pt.y - s.y), 0, 1e-6, 'pointAt');
});

test('bodies: rails speed matches parent gravity', () => {
  const sys = createSystem();
  const moon = sys.byId.moon;
  close(moon.speed, Math.sqrt(MU / 384400), 1e-12, 'moon speed');
  close(2 * Math.PI / moon.n / 86400, 27.45, 0.05, 'moon period days');
  close(sys.byId.earth.soi, 924000, 5000, 'earth SOI');
  close(moon.soi, 66200, 500, 'moon SOI');
});

test('advance: plain LEO orbit has no events and equals kepler', () => {
  const sys = createSystem();
  const earth = sys.byId.earth;
  const st = { body: earth, ...stateFromOrbit(MU, 6771, 6771, 0, 0, 1) };
  const ref = kepler(st.x, st.y, st.vx, st.vy, MU, 86400);
  const res = advance(st, 0, 86400);
  assert.equal(res.event, null);
  close(Math.hypot(st.x - ref.x, st.y - ref.y), 0, 1e-9, 'same as kepler');
});

test('advance: impact is detected at the surface', () => {
  const sys = createSystem();
  const earth = sys.byId.earth;
  const st = { body: earth, ...stateFromOrbit(MU, 6000, 6771, 0, Math.PI, 1) };
  const res = advance(st, 0, 1e5);
  assert.equal(res.event?.type, 'impact');
  close(Math.hypot(st.x, st.y), 6371, 0.05, 'impact radius');
});

test('advance: Moon SOI exit keeps absolute state continuous', () => {
  const sys = createSystem();
  const moon = sys.byId.moon;
  // hyperbolic escape from low lunar orbit
  const r = 1837;
  const v = Math.sqrt(2 * moon.gm / r) * 1.3;
  const st = { body: moon, x: r, y: 0, vx: 0, vy: v };
  const res = advance(st, 1000, 1e7);
  assert.equal(res.event?.type, 'exit');
  assert.equal(st.body, sys.byId.earth);
  const te = res.event.t;
  const before = absoluteState({ body: moon, ...res.event.rel }, te);
  const after = absoluteState(st, te);
  close(Math.hypot(before.x - after.x, before.y - after.y), 0, 1e-6, 'abs pos continuous');
  close(Math.hypot(before.vx - after.vx, before.vy - after.vy), 0, 1e-9, 'abs vel continuous');
  close(Math.hypot(res.event.rel.x, res.event.rel.y), moon.soi, 5, 'exit radius');
});

test('advance in many small steps agrees with one big step (sim vs prediction)', () => {
  const sys = createSystem();
  const earth = sys.byId.earth;
  const moon = sys.byId.moon;
  moon.setAngleAt(120, 0);
  // LEO + TLI-ish burn: apoapsis near the Moon
  const s0 = stateFromOrbit(MU, 6771, 395000, 0, 0, 1);
  const a = { body: earth, ...s0 };
  const b = { body: earth, ...s0 };
  const pred = predict(a, 0, { revs: 1 });
  let t = 0;
  const span = pred[0].t1 + 3600 * 5;
  while (t < span) {
    const r = advance(b, t, Math.min(97, span - t));
    t += r.dt;
  }
  // compare to prediction at the same time
  const p = pred.find((q) => t >= q.t0 && t <= q.t1) || pred[pred.length - 1];
  assert.equal(b.body, p.body, 'same SOI');
  const k = kepler(p.state0.x, p.state0.y, p.state0.vx, p.state0.vy, p.body.gm, t - p.t0);
  const err = Math.hypot(k.x - b.x, k.y - b.y);
  assert.ok(err < 1, `stepped vs predicted: ${err} km`);
});

test('predict: a LEO transfer with correct phasing encounters the Moon', () => {
  const sys = createSystem();
  const earth = sys.byId.earth;
  const moon = sys.byId.moon;
  // Hohmann-ish transfer takes ~5 days; Moon leads by ~114 deg at departure.
  moon.setAngleAt(114, 0);
  const st = { body: earth, ...stateFromOrbit(MU, 6771, 384400, 0, 0, 1) };
  const pred = predict(st, 0);
  const enc = pred.find((p) => p.body === moon);
  assert.ok(enc, `patches: ${pred.map((p) => p.body.name + ':' + p.end).join(', ')}`);
});

test('closestApproach finds the rendezvous of two co-orbital ships', () => {
  const sys = createSystem();
  const earth = sys.byId.earth;
  const target0 = stateFromOrbit(MU, 6771, 6771, 0, 0.2, 1);
  const obj = {
    body: earth,
    period: 2 * Math.PI * Math.sqrt(6771 ** 3 / MU),
    stateAt: (t, out) => kepler(target0.x, target0.y, target0.vx, target0.vy, MU, t, out),
  };
  // ship on a lower-period orbit starting behind, apoapsis at the burn point
  const ship = { body: earth, ...stateFromOrbit(MU, 6500, 6771, Math.PI, Math.PI, 1) };
  const pred = predict(ship, 0);
  const ca = closestApproach(pred, obj, 0);
  assert.ok(ca);
  // brute force check
  let best = Infinity;
  for (let t = 0; t < pred[0].t1; t += 1) {
    const s = kepler(ship.x, ship.y, ship.vx, ship.vy, MU, t);
    const o = obj.stateAt(t, {});
    best = Math.min(best, Math.hypot(s.x - o.x, s.y - o.y));
  }
  assert.ok(ca.dist <= best + 0.5, `closest ${ca.dist} vs brute ${best}`);
});
