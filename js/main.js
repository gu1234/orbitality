// Orbitality: app controller (menu, briefing, flight, results) and the main loop.

import { World, WARPS } from './game/world.js';
import { LEVELS, SANDBOX } from './game/levels.js';
import { progress, starsFor } from './game/progress.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Input } from './ui/input.js';
import { Music } from './audio/music.js';
import { fmtDist, fmtSpeed, fmtDv, fmtDur, fmtClock, fmtWarp } from './ui/format.js';
import { TUTORIAL, GLOSSARY, apsisNames, beginStep, evaluate, completeStep, snapshot, restore } from './game/tutorial.js';
import { drawTutorialOverlay } from './render/tutorial-overlay.js';
import { Coach } from './ui/coach.js';
import { Planner } from './game/planner.js';
import { PlannerPanel } from './ui/planner-panel.js';
import { drawPlannerOverlay } from './render/planner-overlay.js';
import { initTooltips } from './ui/tooltip.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const UNLOCK_ALL = params.has('all');

const DEMO = {
  id: 'demo',
  title: '',
  startWarp: 100,
  setup(w) {
    w.body('moon').setAngleAt(35, 0);
    w.placeShip('earth', { pe: 700, ap: 9000, argPe: 205, nu: -40 });
    w.placeTarget('earth', { alt: 2600, angle: 150 });
  },
};

const canvas = $('view');
const renderer = new Renderer(canvas);
const cam = new Camera();
const music = new Music();
const coach = new Coach();
const planner = new Planner();
const plannerPanel = new PlannerPanel(planner, $('flight'), { approve: approvePlan, cancel: cancelPlan, close: togglePlanner });

const app = {
  mode: 'menu', // menu | brief | flying | paused | result | grad
  level: null,
  tut: null, // Flight School progress while it runs: { i, ctx, met, snap }
  world: null,
  hoverDir: null,
  tipIndex: 0,
  tipHidden: false,
  ghost: null,
  ghostAlpha: 0,
  logSeen: 0,
  endTimer: 0,
  hudAt: 0,
  burnShownUntil: 0,
  lastBurnDv: 0,
  lastBurnDir: null,
  fuelWarned: false,
  realDt: 0,
};

// ------------------------------------------------------------------ setup

function resize() {
  const before = Math.min(cam.w, cam.h);
  renderer.resize();
  cam.setSize(renderer.w, renderer.h);
  // keep roughly the same region in view when the screen rotates or resizes
  if (before > 1) cam.scale = cam.clampScale(cam.scale * (Math.min(cam.w, cam.h) / before));
}
window.addEventListener('resize', resize);
// iOS Safari ignores user-scalable=no; stop pinch-zooming the page itself
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
window.addEventListener('orientationchange', () => setTimeout(resize, 100));
resize();

function setMode(mode) {
  app.mode = mode;
  $('menu').classList.toggle('hidden', mode !== 'menu');
  $('flight').classList.toggle('hidden', mode === 'menu');
  $('brief').classList.toggle('hidden', mode !== 'brief');
  $('pause').classList.toggle('hidden', mode !== 'paused');
  $('result').classList.toggle('hidden', mode !== 'result');
  $('grad').classList.toggle('hidden', mode !== 'grad');
  closeWarpMenu();
  if (mode !== 'flying') input.releaseAllBurns();
}

// ------------------------------------------------------------------ menu

function unlocked(i) {
  if (UNLOCK_ALL || i === 0) return true;
  return progress.completed(LEVELS[i - 1].id);
}

function starText(n) {
  return [0, 1, 2].map((i) => (i < n ? '★' : '<span class="off">★</span>')).join('');
}

function renderMenu() {
  const list = $('level-list');
  list.innerHTML = '';
  LEVELS.forEach((l, i) => {
    const li = document.createElement('li');
    const open = unlocked(i);
    const st = progress.stars(l.id);
    if (st) li.classList.add('done');
    const b = document.createElement('button');
    b.disabled = !open;
    b.innerHTML = `
      <span class="num">${i + 1}</span>
      <span><span class="name">${l.title}</span><span class="concept">${l.concept}${l.fuel ? ' <span class="fuel-tag">with limited fuel</span>' : ''}</span></span>
      <span class="meta">${open ? (st ? starText(st) : '') : '<span class="lock">Locked</span>'}</span>`;
    b.addEventListener('click', () => startLevel(l));
    li.appendChild(b);
    list.appendChild(li);
  });
  const schooled = progress.completed(TUTORIAL.id);
  const meta = $('school-meta');
  meta.textContent = schooled ? '✓ Done' : progress.completed(LEVELS[0].id) ? '' : 'Start here';
  meta.classList.toggle('done', schooled);
  $('btn-reset').classList.toggle('hidden', !progress.any());
}

function showMenu() {
  endTutorial();
  app.level = DEMO;
  app.world = new World(DEMO);
  app.logSeen = 0;
  cam.setFocus({ kind: 'body', id: 'earth' });
  const span = 26000;
  const s = Math.min(renderer.w, renderer.h) / span;
  cam.anim = null;
  cam.scale = s;
  // on wide screens keep Earth to the right of the menu column
  cam.offX = renderer.w > 760 ? -(renderer.w * 0.2) / s : 0;
  cam.offY = renderer.w > 760 ? 0 : -(renderer.h * 0.12) / s;
  renderMenu();
  setMode('menu');
}

// ------------------------------------------------------------------ levels

function startLevel(level) {
  endTutorial();
  app.level = level;
  app.world = new World(level);
  app.logSeen = 0;
  app.ghost = null;
  app.ghostAlpha = 0;
  app.endTimer = 0;
  app.fuelWarned = false;
  app.tipIndex = 0;
  app.tipHidden = false; // every level starts with its hints showing
  app.burnShownUntil = 0;
  renderer.effects = [];
  const w = app.world;
  cam.setFocus({ kind: 'body', id: level.view?.focus || w.ship.body.id });
  w.refreshPrediction(true);
  $('hud-level').textContent = level.title;
  $('target-panel').classList.toggle('hidden', !w.target);
  $('target-actions').classList.toggle('hidden', !w.target);
  renderTip();
  showBrief();
  updateHud(true);
  frameLevel();
}

/** Initial view: the level's region of interest inside the free screen area. */
function frameLevel() {
  const w = app.world;
  const l = w.level; // a Flight School step can bring its own scene
  const b = w.body(l.view?.focus || w.ship.body.id);
  const p = b.absPos(w.t);
  cam.fitPoints(w, [{ x: p.x, y: p.y, r: (l.view?.span || 20000) / 2 }], { rect: freeRect(), pad: 0.03, instant: true });
}

/** The largest screen rectangle not covered by HUD panels and controls. */
function freeRect() {
  const W = renderer.w, H = renderer.h;
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el || el.classList.contains('hidden')) return null;
    const r = el.getBoundingClientRect();
    return r.width ? r : null;
  };
  const top = box('.topbar'), tel = box('#telemetry'), tgt = box('#target-panel');
  const tip = box('#tip'), pad = box('#pad'), right = box('.right-controls'), tools = box('.view-tools');
  // Flight School's coach: top right on wide screens, above the controls on narrow ones
  const coachBox = box('#coach');
  const low = coachBox && coachBox.top + coachBox.bottom > H ? coachBox : null;
  const high = coachBox && !low ? coachBox : null;
  const band = {
    x0: 0,
    y0: Math.max(top?.bottom ?? 0, tel?.bottom ?? 0, tgt?.bottom ?? 0, high?.bottom ?? 0),
    x1: W,
    y1: Math.min(tip?.top ?? H, low?.top ?? H, pad?.top ?? H, right?.top ?? H, tools?.top ?? H),
  };
  const cx0 = Math.max(tel?.right ?? 0, pad?.right ?? 0);
  const cx1 = Math.min(tgt?.left ?? W, high?.left ?? W, right?.left ?? W, tools?.left ?? W);
  const over = (r) => r && r.left < cx1 && r.right > cx0;
  const col = {
    x0: cx0,
    y0: top?.bottom ?? 0,
    x1: cx1,
    y1: Math.min(over(tip) ? tip.top : H, over(low) ? low.top : H),
  };
  const score = (r) => Math.min(r.x1 - r.x0, r.y1 - r.y0);
  const best = score(band) >= score(col) ? band : col;
  return score(best) > 120 ? best : { x0: 0, y0: 0, x1: W, y1: H };
}

function showBrief() {
  const l = app.level;
  $('brief-concept').textContent = l.concept;
  $('brief-title').textContent = l.title;
  $('brief-text').innerHTML = l.brief;
  let budget = '';
  if (l.fuel) budget = `Fuel for <b>${fmtDv(l.fuel)}</b> of Δv. Finish under <b>${fmtDv(l.par)}</b> for three stars.`;
  else if (l.par) budget = `Unlimited fuel. Finish under <b>${fmtDv(l.par)}</b> of Δv for three stars.`;
  $('brief-budget').innerHTML = budget;
  const hl = $('brief-hint-list');
  hl.innerHTML = l.hints.map((h) => `<li>${h}</li>`).join('');
  $('brief-hints').open = false;
  $('brief-legend').classList.toggle('hidden', !app.world.target);
  $('brief-start').textContent = app.world.t > 0 ? 'Resume' : 'Start';
  setMode('brief');
  setTimeout(() => $('brief-start').focus({ preventScroll: true }), 50);
}

function nextLevel() {
  const i = LEVELS.indexOf(app.level);
  if (i >= 0 && i + 1 < LEVELS.length) startLevel(LEVELS[i + 1]);
  else showMenu();
}

// ------------------------------------------------------------------ results

function finish() {
  if (app.tut) { tutorialCrash(); return; }
  const w = app.world;
  const l = app.level;
  const caught = w.status === 'caught';
  const stars = caught ? starsFor(l, w.ship.dvUsed) : 0;
  if (caught) progress.record(l.id, stars);
  $('result-stars').innerHTML = caught ? starText(stars) : '';
  if (caught) {
    $('result-title').textContent = 'Caught';
    $('result-sub').textContent = `Δv used: ${fmtDv(w.ship.dvUsed)} (three stars under ${fmtDv(l.par)}). Mission time: ${fmtDur(w.t)}.`;
    $('result-lesson').textContent = l.lesson;
  } else {
    const body = w.statusInfo?.body?.name || 'the surface';
    $('result-title').textContent = `You hit ${body}`;
    $('result-sub').textContent = 'Your periapsis was below the surface. When a red X appears on the orbit line, burn to lift the low point before you get there.';
    $('result-lesson').textContent = '';
  }
  const i = LEVELS.indexOf(l);
  const hasNext = caught && i >= 0 && i + 1 < LEVELS.length;
  $('result-next').classList.toggle('hidden', !hasNext);
  $('result-retry').classList.toggle('primary', !hasNext);
  setMode('result');
}

// ------------------------------------------------------------------ tips

function renderTip() {
  const hints = app.level?.hints || [];
  const tip = $('tip');
  tip.classList.toggle('hidden', app.tipHidden || !hints.length);
  if (!hints.length) return;
  app.tipIndex = (app.tipIndex + hints.length) % hints.length;
  $('tip-text').innerHTML = hints[app.tipIndex];
  $('tip-pager').classList.toggle('hidden', hints.length < 2);
  $('tip-count').textContent = `${app.tipIndex + 1}/${hints.length}`;
}

function toggleTip() {
  if (app.tut) { coach.toggle(); return; }
  app.tipHidden = !app.tipHidden;
  renderTip();
}

// ------------------------------------------------------------------ flight school

const tutStep = () => (app.tut ? TUTORIAL.steps[app.tut.i] : null);

function startTutorial() {
  endTutorial();
  app.level = TUTORIAL;
  app.tut = { i: 0, ctx: null, met: false, snap: null };
  app.fuelWarned = false;
  $('hud-level').textContent = TUTORIAL.title;
  $('target-panel').classList.add('hidden');
  $('target-actions').classList.add('hidden');
  $('flight').classList.add('tutorial');
  $('pause-brief').classList.add('hidden');
  $('pause-restart').textContent = 'Restart step';
  renderTip();
  setMode('flying');
  enterStep(0);
}

function enterStep(i) {
  const tut = app.tut;
  const step = TUTORIAL.steps[i];
  if (step.level) {
    app.world = new World(step.level);
    app.logSeen = 0;
    app.ghost = null;
    app.ghostAlpha = 0;
    app.endTimer = 0;
    app.burnShownUntil = 0;
    renderer.effects = [];
    cam.setFocus({ kind: 'body', id: step.level.view.focus });
  }
  const w = app.world;
  tut.i = i;
  tut.snap = snapshot(w);
  tut.ctx = beginStep(step, w);
  tut.met = false;
  coach.show(step, i, TUTORIAL.steps.length);
  w.refreshPrediction(true);
  updateHud(true);
  if (step.level) frameLevel(); // after the coach is laid out, so the view avoids it
}

/** Every frame while flying: check the step's goal and refresh the coach's readouts. */
function tutorialTick() {
  const tut = app.tut;
  const w = app.world;
  if (w.status !== 'flying') return;
  const step = TUTORIAL.steps[tut.i];
  const ev = evaluate(step, w, tut.ctx);
  if (!tut.met && ev.met) {
    tut.met = true;
    coach.met(completeStep(step, w, tut.ctx));
    if (step.reframe) frame();
  }
  coach.update({ progress: ev.progress, note: tut.met ? null : ev.note });
}

function nextStep() {
  const tut = app.tut;
  if (!tut?.met) return;
  if (tut.i + 1 < TUTORIAL.steps.length) enterStep(tut.i + 1);
  else graduate();
}

/** Rewind the ship to where it was when the current step began. */
function restartStep() {
  const tut = app.tut;
  const w = app.world;
  const step = TUTORIAL.steps[tut.i];
  restore(w, tut.snap);
  app.ghost = null;
  app.ghostAlpha = 0;
  app.endTimer = 0;
  renderer.effects = [];
  tut.ctx = beginStep(step, w);
  tut.met = false;
  coach.show(step, tut.i, TUTORIAL.steps.length);
  updateHud(true);
  setMode('flying');
}

function tutorialCrash() {
  const body = app.world.statusInfo?.body?.name || 'the surface';
  toast(`You hit ${body}. Back to the start of this step.`, true, 3200);
  restartStep();
}

function graduate() {
  progress.record(TUTORIAL.id, 1);
  $('grad-glossary').innerHTML = GLOSSARY.map(([term, def]) => `<dt>${term}</dt><dd>${def}</dd>`).join('');
  coach.hide();
  setMode('grad');
  setTimeout(() => $('grad-next').focus({ preventScroll: true }), 50);
}

/** Leave Flight School, putting back everything it changed in the flight UI. */
function endTutorial() {
  if (!app.tut) return;
  app.tut = null;
  coach.hide();
  $('flight').classList.remove('tutorial');
  $('pause-brief').classList.remove('hidden');
  $('pause-restart').textContent = 'Restart level';
  setText('t-ap-label', 'Apoapsis');
  setText('t-pe-label', 'Periapsis');
}

function toggleMusic() {
  music.toggle();
  if (app.mode === 'flying') toast(music.enabled ? 'Music on' : 'Music off', false, 1200);
}

// ------------------------------------------------------------------ toasts

let toastTimer = 0;
function toast(text, warn = false, ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('warn', warn);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ------------------------------------------------------------------ camera helpers

function focusOptions() {
  const w = app.world;
  const opts = [{ kind: 'body', id: w.ship.body.id }, { kind: 'ship' }];
  if (w.target) {
    opts.push({ kind: 'target' });
    if (w.target.body !== w.ship.body) opts.push({ kind: 'body', id: w.target.body.id });
  }
  if (w.ship.body.parent && w.ship.body.parent.parent) opts.push({ kind: 'body', id: w.ship.body.parent.id });
  opts.push({ kind: 'body', id: 'sun' });
  return opts;
}

function sameFocus(a, b) {
  return a.kind === b.kind && (a.kind !== 'body' || a.id === b.id);
}

function cycleFocus() {
  const opts = focusOptions();
  const i = opts.findIndex((o) => sameFocus(o, cam.focus));
  const next = opts[(i + 1) % opts.length];
  setFocus(next);
}

function setFocus(f) {
  const w = app.world;
  cam.setFocus(f);
  if (f.kind === 'body' && f.id === 'sun') {
    const far = w.target?.body.parent === w.body('sun') ? w.target.body.a : w.body('earth').a;
    cam.animateTo(Math.min(renderer.w, renderer.h) / (far * 2.6), 0, 0, 0.6);
  } else if (f.kind === 'body' && cam.scale * w.body(f.id).radius < 4) {
    const b = w.body(f.id);
    const span = Math.min(b.soi * 2, b.radius * 12);
    cam.animateTo(Math.min(renderer.w, renderer.h) / span, 0, 0, 0.6);
  }
  updateHud(true);
}

function frame() {
  const w = app.world;
  const pts = [];
  const s = w.shipAbs();
  pts.push({ x: s.x, y: s.y });
  if (w.target && (w.target.body === w.ship.body)) {
    const t = w.targetAbs();
    pts.push({ x: t.x, y: t.y });
    const rel = w.targetRelative();
    if (rel.dist < w.catchDist * 3) {
      pts[0].r = w.catchDist * 1.5;
    }
  } else {
    const b = w.ship.body.absPos(w.t);
    const el = w.shipElements();
    const r = el.e < 1 ? Math.min(el.ra, w.ship.body.soi) : Math.hypot(w.ship.x, w.ship.y);
    pts.push({ x: b.x, y: b.y, r: r * 1.05 });
  }
  cam.fitPoints(w, pts, { rect: freeRect(), pad: 0.08 });
}

/** Pick the nearest object near a screen point and focus it. */
function pick(px, py) {
  const w = app.world;
  const cands = [];
  const s = w.shipAbs();
  cands.push({ f: { kind: 'ship' }, x: cam.sx(s.x), y: cam.sy(s.y), r: 10 });
  if (w.target) {
    const t = w.targetAbs();
    cands.push({ f: { kind: 'target' }, x: cam.sx(t.x), y: cam.sy(t.y), r: 10 });
  }
  for (const b of w.sys.bodies) {
    const p = b.absPos(w.t);
    cands.push({ f: { kind: 'body', id: b.id }, x: cam.sx(p.x), y: cam.sy(p.y), r: Math.max(b.radius * cam.scale, b.minPx) });
  }
  let best = null;
  for (const c of cands) {
    const d = Math.hypot(c.x - px, c.y - py) - c.r;
    if (d < 26 && (!best || d < best.d)) best = { ...c, d };
  }
  if (best && !sameFocus(best.f, cam.focus)) setFocus(best.f);
}

// ------------------------------------------------------------------ warp

function warpStep(d) {
  const w = app.world;
  if (app.mode !== 'flying') return;
  const max = w.maxWarpIndex();
  const i = Math.min(max, w.warpIndex + d);
  if (d > 0 && w.warpIndex >= max && max < WARPS.length - 1) toast('Warp is limited near the target', false, 1500);
  w.setWarpIndex(i);
  updateHud(true);
}

function closeWarpMenu() {
  $('warp-menu').classList.add('hidden');
}

function openWarpMenu() {
  const w = app.world;
  const menu = $('warp-menu');
  if (!menu.classList.contains('hidden')) { closeWarpMenu(); return; }
  const opts = w.warpOptions();
  menu.innerHTML = '<h3>Warp to</h3>';
  if (w.warpTarget) {
    const b = document.createElement('button');
    b.innerHTML = '<span>Stop warping</span><span></span>';
    b.addEventListener('click', () => { w.setWarpIndex(0); closeWarpMenu(); });
    menu.appendChild(b);
  }
  if (!opts.length) {
    const p = document.createElement('div');
    p.className = 'empty';
    p.textContent = 'No upcoming events on this orbit.';
    menu.appendChild(p);
  }
  const names = tutStep()?.apsisNames ? apsisNames(w.ship.body) : null;
  for (const o of opts) {
    const b = document.createElement('button');
    const label = names && (o.id === 'pe' || o.id === 'ap') ? names[o.id] : o.label;
    b.innerHTML = `<span>${label}</span><span>in ${fmtDur(o.t - w.t)}</span>`;
    b.addEventListener('click', () => {
      w.warpTo(o.t, label);
      closeWarpMenu();
    });
    menu.appendChild(b);
  }
  menu.classList.remove('hidden');
}

// ------------------------------------------------------------------ HUD

function setText(id, text) {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

function updateHud(force = false) {
  const w = app.world;
  if (!w || app.mode === 'menu') return;
  const now = performance.now();
  if (!force && now - app.hudAt < 90) return;
  app.hudAt = now;
  const s = w.ship;
  const B = s.body;
  const el = w.shipElements();
  setText('hud-clock', fmtClock(w.t));
  setText('t-body', B.name);
  setText('t-alt', fmtDist(el.r - B.radius));
  setText('t-speed', fmtSpeed(el.speed));
  let ap;
  if (el.e >= 1) ap = 'Escaping';
  else if (el.ra > B.soi) ap = `Leaves ${B.name}`;
  else ap = fmtDist(el.ra - B.radius);
  setText('t-ap', ap);
  const names = tutStep()?.apsisNames ? apsisNames(B) : null;
  setText('t-ap-label', names ? names.ap : 'Apoapsis');
  setText('t-pe-label', names ? names.pe : 'Periapsis');
  const pe = el.rp - B.radius;
  setText('t-pe', pe < 0 ? `${fmtDist(pe)} (impact)` : fmtDist(pe));
  $('t-pe').classList.toggle('warn', pe < 0);
  setText('t-period', el.e < 1 ? fmtDur(el.period) : '—');

  const fuel = $('fuel');
  if (s.unlimited) {
    fuel.classList.add('unlimited');
    fuel.classList.remove('low');
    setText('fuel-label', 'Δv used');
    setText('fuel-value', fmtDv(s.dvUsed));
  } else {
    const left = w.dvRemaining();
    const frac = left / w.dvTotal();
    fuel.classList.remove('unlimited');
    fuel.classList.toggle('low', frac < 0.15);
    setText('fuel-label', 'Δv left');
    setText('fuel-value', fmtDv(left));
    $('fuel-fill').style.transform = `scaleX(${Math.max(0, frac)})`;
    if (left <= 0.01 && !app.fuelWarned && w.status === 'flying') {
      app.fuelWarned = true;
      toast('Out of fuel. Coast in if you can, or retry.', true, 4000);
    }
  }

  if (w.target) {
    const rel = w.targetRelative();
    setText('g-dist', fmtDist(rel.dist));
    setText('g-rel', fmtSpeed(rel.relSpeed));
    const ph = w.phaseInfo();
    if (ph && w.status === 'flying') {
      const d = Math.round(ph.deg);
      setText('g-phase-label', ph.ownBody && w.target.body === s.body ? 'Phase' : `${w.target.body.name} phase`);
      setText('g-phase', d === 0 ? '0°' : `${Math.abs(d)}° ${d > 0 ? 'ahead' : 'behind'}`);
    } else {
      setText('g-phase-label', 'Phase');
      setText('g-phase', '—');
    }
    const ca = w.approach;
    const enc = app.world.prediction?.find((p) => p.body === w.target.body && p.body !== s.body);
    if (w.status === 'caught') {
      setText('g-ca-label', 'Status');
      setText('g-ca', 'Caught');
      setText('g-ca-when', '');
    } else if (ca && ca.kind === 'target') {
      setText('g-ca-label', 'Closest');
      setText('g-ca', fmtDist(ca.dist));
      setText('g-ca-when', ca.t - w.t < 2 ? 'now' : `in ${fmtDur(ca.t - w.t)}`);
    } else if (enc) {
      setText('g-ca-label', `${enc.body.name} Pe`);
      setText('g-ca', enc.el.rp < enc.body.radius ? 'Impact' : fmtDist(enc.el.rp - enc.body.radius));
      setText('g-ca-when', `arrive in ${fmtDur(enc.t0 - w.t)}`);
    } else if (ca && ca.kind === 'body') {
      setText('g-ca-label', `Near ${ca.bodyRef.name}`);
      setText('g-ca', fmtDist(ca.dist));
      setText('g-ca-when', `in ${fmtDur(ca.t - w.t)}`);
    } else {
      setText('g-ca-label', 'Closest');
      setText('g-ca', '—');
      setText('g-ca-when', '');
    }
    $('target-panel').classList.toggle('caught', w.status === 'caught');
    const canT = w.canBurn('toward');
    for (const b of document.querySelectorAll('.burn.tgt')) b.disabled = !canT;
  }

  // warp display
  const wv = $('warp-value');
  let html;
  if (planner.open) html = 'Paused<small>planning</small>';
  else if (w.burn.dir) html = `${fmtWarp(w.burn.warp)}<small>burning</small>`;
  else if (w.warpTarget) html = `${fmtWarp(w.effectiveWarp || w.warp)}<small>to ${w.warpTarget.label.toLowerCase()}</small>`;
  else if (w.effectiveWarp !== undefined && w.effectiveWarp < w.warp) html = `${fmtWarp(w.effectiveWarp)}<small>limited</small>`;
  else html = fmtWarp(w.warp);
  if (wv.innerHTML !== html) wv.innerHTML = html;
  wv.classList.toggle('to', !!w.warpTarget);

  setText('btn-focus', cam.focusLabel(w));

  for (const b of document.querySelectorAll('.burn[data-burn]')) {
    b.classList.toggle('active', w.burn.dir === b.dataset.burn);
    if (!b.classList.contains('tgt')) b.disabled = w.status !== 'flying' || (!s.unlimited && s.fuel <= 0);
  }
}

const hasKeyboardPointer = matchMedia('(hover: hover) and (pointer: fine)');

function updateBurnReadout() {
  const w = app.world;
  const el = $('burn-readout');
  const now = performance.now();
  const names = { prograde: 'Prograde', retrograde: 'Retrograde', radialIn: 'Radial in', radialOut: 'Radial out', toward: 'Toward target', match: 'Matching velocity', plan: 'Planned burn' };
  if (w.burn.dir) {
    app.lastBurnDv = w.burn.dv;
    app.lastBurnDir = w.burn.dir;
    app.lastBurnFine = w.burn.fine;
    app.burnShownUntil = now + 1400;
    if (w.burn.fine) app.usedFine = true;
  }
  if (now < app.burnShownUntil && app.lastBurnDir) {
    // keyboard players: point out Shift until they have used it, then just confirm it
    let fine = '';
    if (hasKeyboardPointer.matches && app.lastBurnDir !== 'plan') {
      if (app.lastBurnFine) fine = '<small class="fine-hint on">Fine control</small>';
      else if (!app.usedFine) fine = '<small class="fine-hint"><kbd>Shift</kbd> for fine control</small>';
    }
    const txt = `${fmtDv(app.lastBurnDv)}<small>${names[app.lastBurnDir]}</small>${fine}`;
    if (el.innerHTML !== txt) el.innerHTML = txt;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
  // centre of the pad shows where prograde points on screen
  const s = w.ship;
  const ang = Math.atan2(s.vx, s.vy); // clockwise from screen-up
  $('pad-center').firstElementChild.style.transform = `rotate(${ang}rad)`;
}

// ------------------------------------------------------------------ events from the world

function processLog() {
  const w = app.world;
  while (app.logSeen < w.log.length) {
    const ev = w.log[app.logSeen++];
    if (app.mode !== 'flying') continue;
    if (ev.type === 'enter') {
      toast(`Entered ${ev.to}'s sphere of influence`);
      followSoi(ev.from, ev.to);
    } else if (ev.type === 'exit') {
      toast(`Left ${ev.from}'s sphere of influence`);
      followSoi(ev.from, ev.to);
    }
  }
}

function followSoi(from, to) {
  const f = cam.focus;
  if (f.kind === 'body' && f.id === from.toLowerCase()) {
    const w = app.world;
    cam.setFocus({ kind: 'body', id: to.toLowerCase() });
    const b = w.body(to.toLowerCase());
    const r = Math.hypot(w.ship.x, w.ship.y);
    cam.animateTo(Math.min(renderer.w, renderer.h) / (Math.max(r, b.radius * 3) * 2.4), 0, 0, 0.8);
  }
}

// ------------------------------------------------------------------ input wiring

const input = new Input(canvas, {
  pan: (dx, dy) => cam.pan(dx, dy),
  zoomAt: (f, x, y) => cam.zoomAt(f, x, y),
  tap: (x, y) => { closeWarpMenu(); if (app.mode === 'flying') pick(x, y); },
  doubleTap: () => { if (app.mode === 'flying') frame(); },
  hover: (dir) => { app.hoverDir = dir; },
  fine: (on) => { if (app.mode === 'flying') app.world?.setFine(on); },
  burnStart: (dir, fine) => {
    if (app.mode !== 'flying') return;
    if (planner.open) {
      // while planning, the burn buttons shape the plan instead of firing the engine
      if (!planner.press(dir, fine)) toast('Plan with the prograde, retrograde and radial buttons', false, 2000);
      return;
    }
    if (planner.armed) { cancelPlan(); toast('Planned burn cancelled', false, 1600); }
    closeWarpMenu();
    const w = app.world;
    if (!w.canBurn(dir)) {
      if (!w.ship.unlimited && w.ship.fuel <= 0) toast('Out of fuel', true, 1500);
      else if ((dir === 'toward' || dir === 'match') && w.target) {
        toast(w.target.body !== w.ship.body
          ? `Reach ${w.target.body.name}'s sphere of influence first`
          : `Get within ${fmtDist(w.targetActionRange())} of the target first`, false, 2000);
      }
      return;
    }
    if (w.burn.dir !== dir) app.ghost = w.prediction;
    w.startBurn(dir, fine);
    app.ghostAlpha = 1;
    if (app.tut) coach.acting();
  },
  burnStop: () => {
    planner.release();
    // an approved burn flies to the end on its own; letting go of a button doesn't cut it short
    if (app.world && app.world.burn.dir !== 'plan') app.world.stopBurn();
  },
  warpStep: (d) => warpStep(d),
  warpStop: () => { if (app.mode === 'flying') app.world.setWarpIndex(0); },
  cycleFocus: () => { if (app.mode === 'flying') cycleFocus(); },
  frame: () => { if (app.mode === 'flying') frame(); },
  toggleTip: () => { if (app.mode === 'flying') toggleTip(); },
  toggleMusic: () => toggleMusic(),
  escape: () => {
    if (!$('welcome').classList.contains('hidden')) closeWelcome();
    else if (app.mode === 'flying') setMode('paused');
    else if (app.mode === 'paused') setMode('flying');
    else if (app.mode === 'brief') setMode('flying');
  },
  keysActive: () => app.mode === 'flying',
});

document.querySelectorAll('.burn[data-burn]').forEach((b) => input.bindBurnButton(b));

$('btn-pause').addEventListener('click', () => setMode('paused'));
$('btn-hint').addEventListener('click', toggleTip);
$('tip-prev').addEventListener('click', () => { app.tipIndex--; renderTip(); });
$('tip-next').addEventListener('click', () => { app.tipIndex++; renderTip(); });
$('tip-close').addEventListener('click', toggleTip);
$('warp-down').addEventListener('click', () => warpStep(-1));
$('warp-up').addEventListener('click', () => warpStep(1));
$('warp-value').addEventListener('click', openWarpMenu);
$('btn-focus').addEventListener('click', cycleFocus);
$('btn-frame').addEventListener('click', frame);
$('btn-plan').addEventListener('click', togglePlanner);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyB' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || app.mode !== 'flying') return;
  e.preventDefault();
  togglePlanner();
});
$('btn-sandbox').addEventListener('click', () => startLevel(SANDBOX));
// two taps to wipe progress: the first arms the button for a few seconds
let resetTimer = 0;
function disarmReset() {
  clearTimeout(resetTimer);
  const b = $('btn-reset');
  b.classList.remove('armed');
  b.textContent = 'Reset progress';
}
$('btn-reset').addEventListener('click', () => {
  const b = $('btn-reset');
  if (!b.classList.contains('armed')) {
    b.classList.add('armed');
    b.textContent = 'Tap again to erase all stars';
    resetTimer = setTimeout(disarmReset, 4000);
    return;
  }
  disarmReset();
  progress.reset();
  renderMenu();
  showWelcome();
});

// first-launch warning: until anything is completed, every visit opens with it
function showWelcome() {
  $('welcome').classList.remove('hidden');
  $('welcome-school').focus();
}
function closeWelcome() { $('welcome').classList.add('hidden'); }
$('welcome-skip').addEventListener('click', closeWelcome);
$('welcome-school').addEventListener('click', () => { closeWelcome(); startTutorial(); });
$('brief-start').addEventListener('click', () => setMode('flying'));
$('brief-back').addEventListener('click', showMenu);
$('pause-resume').addEventListener('click', () => setMode('flying'));
$('pause-brief').addEventListener('click', showBrief);
$('pause-restart').addEventListener('click', () => (app.tut ? restartStep() : startLevel(app.level)));
$('pause-levels').addEventListener('click', showMenu);
$('result-retry').addEventListener('click', () => startLevel(app.level));
$('result-next').addEventListener('click', nextLevel);
$('result-levels').addEventListener('click', showMenu);
$('btn-school').addEventListener('click', startTutorial);
$('coach-next').addEventListener('click', nextStep);
$('coach-min').addEventListener('click', () => coach.toggle());
$('grad-levels').addEventListener('click', showMenu);
$('grad-replay').addEventListener('click', startTutorial);
$('grad-next').addEventListener('click', () => startLevel(LEVELS[0]));
for (const id of ['btn-music', 'menu-music', 'pause-music']) music.bind($(id));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && app.mode === 'flying') setMode('paused');
});
document.addEventListener('pointerdown', (e) => {
  const menu = $('warp-menu');
  if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== $('warp-value')) closeWarpMenu();
});

// ------------------------------------------------------------------ burn planner

/** Open or close the planner. Opening it pauses time and takes back any approved plan for editing. */
function togglePlanner() {
  const w = app.world;
  if (app.mode !== 'flying' || app.tut) return;
  if (w.burn.dir === 'plan') return; // an approved burn is firing; let it finish
  if (planner.world !== w) planner.reset(w);
  if (planner.open) { planner.close(); return; }
  if (planner.armed) cancelPlan();
  input.releaseAllBurns();
  closeWarpMenu();
  if (planner.show()) planner.tick(0);
}

function approvePlan() {
  if (!planner.approve()) return;
  if (planner.fly() === 'started') planStarted();
}

function cancelPlan() {
  const w = app.world;
  planner.cancel();
  if (w.warpTarget?.label === 'Burn') w.setWarpIndex(w.warpIndex);
}

function planStarted() {
  app.ghost = app.world.prediction;
  app.ghostAlpha = 1;
}

/** Every frame while flying: shape the plan, or take the ship to an approved one. */
function tickPlanner(dt) {
  if (planner.world !== app.world) planner.reset(app.world);
  if (planner.open) planner.tick(dt);
  else if (planner.fly() === 'started') planStarted();
}

function syncPlannerUi() {
  const flight = $('flight');
  flight.classList.toggle('planning', planner.open);
  flight.classList.toggle('plan-armed', !!planner.armed);
  const chip = $('btn-plan');
  chip.classList.toggle('hidden', !!app.tut); // Flight School counts burns by button
  chip.classList.toggle('on', planner.open);
  chip.setAttribute('aria-pressed', String(planner.open));
  plannerPanel.render();
}

// ------------------------------------------------------------------ main loop

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  app.realDt = dt;
  const w = app.world;

  if (app.mode === 'menu') {
    w.update(dt);
  } else if (app.mode === 'flying' || (app.mode === 'result' && w.status === 'caught')) {
    const before = w.status;
    if (app.mode === 'flying') tickPlanner(dt);
    if (!planner.open) w.update(dt); // time stands still while a burn is being planned
    processLog();
    if (before === 'flying' && w.status !== 'flying') {
      music.cue(w.status);
      if (w.status === 'caught') {
        renderer.addEffect({ follow: 'target', color: '#9be3b4', size: 60, life: 1.6, rings: 3 });
        toast('Caught!', false, 1800);
      } else {
        renderer.addEffect({ pos: w.shipAbs(), color: '#ff6a3d', size: 40, life: 1.2, rings: 2 });
      }
      app.endTimer = 1.5;
    }
    if (app.endTimer > 0 && app.mode === 'flying') {
      app.endTimer -= dt;
      if (app.endTimer <= 0) finish();
    }
    if (app.tut && app.mode === 'flying') tutorialTick();
  }

  music.update({
    world: w,
    scene: app.mode === 'menu' ? 'menu' : 'flight',
    body: w.ship.body.id,
    flying: app.mode === 'flying' && w.status === 'flying',
    burning: !!w.burn.dir,
    fast: w.warp >= 1000,
    paused: app.mode === 'paused',
  });

  if (!w.burn.dir) app.ghostAlpha = Math.max(0, app.ghostAlpha - dt / 2.5);
  w.refreshPrediction();
  cam.update(w, dt);
  renderer.draw(w, cam, {
    prediction: w.prediction,
    ghost: app.ghost,
    ghostAlpha: app.ghostAlpha,
    hoverDir: app.mode === 'flying' ? app.hoverDir : null,
    showNames: app.mode !== 'menu',
    minimal: app.mode === 'menu',
    apsisNames: tutStep()?.apsisNames ? apsisNames : null,
    realDt: dt,
  });
  if (app.tut && app.mode === 'flying') drawTutorialOverlay(renderer, w, cam, tutStep(), app.hoverDir);
  if (app.mode !== 'menu') {
    if (planner.world !== w) planner.reset(w); // new level, restart or next step
    drawPlannerOverlay(renderer, w, cam, planner);
    syncPlannerUi();
  }
  if (app.mode !== 'menu') {
    updateHud();
    updateBurnReadout();
  }
  requestAnimationFrame(loop);
}

// debug hook for automated testing
window.__game = { app, cam, renderer, music, planner, startLevel, startTutorial, nextStep, LEVELS, SANDBOX, TUTORIAL, setMode, finish };

initTooltips();
showMenu();
if (!progress.any()) showWelcome();
requestAnimationFrame(loop);
