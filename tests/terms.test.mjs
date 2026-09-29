// Glossary: term matching in the game's text, and the card animations.

import test from 'node:test';
import assert from 'node:assert/strict';
import { TERMS, termById, findTerms, termFor } from '../js/game/terms.js';
import { termAnim, ANIM_IDS } from '../js/render/term-anims.js';
import { GLOSSARY, TUTORIAL } from '../js/game/tutorial.js';
import { LEVELS } from '../js/game/levels.js';

const ids = (text, seen) => findTerms(text, seen).map((m) => m.id);

test('terms are well formed', () => {
  assert.equal(new Set(TERMS.map((t) => t.id)).size, TERMS.length, 'unique ids');
  for (const t of TERMS) {
    assert.ok(t.name && t.short && t.body.length, `${t.id} has text`);
    assert.ok(ANIM_IDS.includes(t.anim), `${t.id} has animation ${t.anim}`);
    for (const r of t.related) assert.ok(termById(r), `${t.id} relates to ${r}`);
  }
});

test('terms are found in running text', () => {
  assert.deepEqual(ids('Burn prograde at Ap until Pe meets it.'), ['prograde', 'apoapsis', 'periapsis']);
  assert.deepEqual(ids('Speed up with time warp, then warp again.'), ['warp'], 'longest match, first mention only');
  assert.deepEqual(ids('the Moon\'s sphere of influence (SOI)'), ['soi']);
  assert.deepEqual(ids('when the target is about 25° ahead of you'), ['phase-angle']);
  assert.deepEqual(ids('the Moon is roughly 110–120° ahead'), ['phase-angle']);
  assert.deepEqual(ids('Match'), ['relative-velocity'], 'the Match button');
  assert.deepEqual(findTerms('Warp to').map((m) => m.end), [7], 'the Warp to button, linked whole');
  assert.deepEqual(ids('Match your Ap to the target\'s Ap'), ['apoapsis'], 'but not match as a verb');
  assert.deepEqual(ids('Apollo lands'), [], 'whole words only');
  assert.deepEqual(ids('That is an orbit. Your orbit rises.'), ['orbit'], 'orbit as a noun phrase only');
  assert.deepEqual(ids('Δv budgets and the rocket equation'), ['delta-v', 'rocket-equation']);
});

test('a shared set links each term once across blocks', () => {
  const seen = new Set();
  assert.deepEqual(ids('Burn prograde.', seen), ['prograde']);
  assert.deepEqual(ids('Prograde again, then retrograde.', seen), ['retrograde']);
});

test('HUD labels and the Flight School glossary name terms', () => {
  assert.equal(termFor('Apoapsis'), 'apoapsis');
  assert.equal(termFor('Apogee'), 'perigee');
  assert.equal(termFor('Aphelion'), 'perihelion');
  assert.equal(termFor('Δv left'), 'delta-v');
  assert.equal(termFor('Closest'), 'closest');
  assert.equal(termFor('Moon Pe'), 'periapsis');
  assert.equal(termFor('Status'), null);
  for (const [name] of GLOSSARY) assert.ok(termFor(name), `glossary entry ${name}`);
});

test('the concepts the levels and Flight School teach are linked', () => {
  const found = new Set();
  const scan = (html) => { for (const id of ids(html.replace(/<[^>]+>/g, ''))) found.add(id); };
  for (const l of LEVELS) [l.concept, l.brief, l.lesson, ...l.hints].forEach(scan);
  for (const s of TUTORIAL.steps) [s.text, s.goal].forEach(scan);
  for (const id of ['prograde', 'retrograde', 'radial', 'apoapsis', 'periapsis', 'perigee', 'perihelion', 'hohmann',
    'soi', 'encounter', 'capture', 'oberth', 'rocket-equation', 'delta-v', 'phase-angle', 'phasing', 'closest',
    'relative-velocity', 'geo', 'transfer-window', 'bi-elliptic', 'escape', 'hyperbola', 'ellipse', 'period', 'warp', 'orbit']) {
    assert.ok(found.has(id), `${id} appears in the game text`);
  }
});

/** A 2D context that only checks every coordinate it is given is finite. */
function checkingContext() {
  const bad = [];
  const numbers = (name) => (...args) => {
    if (args.some((v) => typeof v === 'number' && !Number.isFinite(v))) bad.push(`${name}(${args.join(', ')})`);
  };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (['moveTo', 'lineTo', 'arc', 'ellipse', 'fillRect', 'strokeRect', 'fillText'].includes(k)) return numbers(k);
      return k in t ? t[k] : () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, bad };
}

test('every animation plays through with finite coordinates and captions', () => {
  for (const id of ANIM_IDS) {
    const a = termAnim(id);
    assert.ok(a.dur > 2 && a.dur < 20, `${id} lasts ${a.dur.toFixed(1)} s`);
    assert.ok(a.still >= 0 && a.still <= a.dur, `${id} still frame is inside the loop`);
    const { ctx, bad } = checkingContext();
    for (let t = 0; t <= a.dur; t += 1 / 20) {
      const cap = a.draw(ctx, t);
      assert.ok(typeof cap === 'string' && cap.length > 10, `${id} caption at ${t.toFixed(2)} s`);
    }
    assert.deepEqual(bad.slice(0, 3), [], `${id} draws finite coordinates`);
  }
});
