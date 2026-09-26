// Flight School: a guided tutorial that teaches the words of orbital flight
// (prograde, retrograde, radial, apoapsis, periapsis, perihelion, aphelion)
// one step at a time. Each step sets a goal that is detected from the world
// state. No DOM here, so the tests can fly it the same way a player does.

import { WARPS } from './world.js';
import { wrapAngle } from '../physics/kepler.js';
import { fmtDist, fmtDur, fmtDv, fmtSpeed, fmtWarp } from '../ui/format.js';

const DEG = Math.PI / 180;

const APSIS_NAMES = {
  earth: ['Perigee', 'Apogee'],
  moon: ['Perilune', 'Apolune'],
  sun: ['Perihelion', 'Aphelion'],
};

/** Body-specific names for the low and high points of an orbit. */
export function apsisNames(body) {
  const n = APSIS_NAMES[body.id];
  return n ? { pe: n[0], ap: n[1] } : { pe: 'Periapsis', ap: 'Apoapsis' };
}

/** Apsis altitudes (km) of the ship's orbit. `ap` is Infinity if the orbit never comes back. */
function apsides(w) {
  const el = w.shipElements();
  const B = w.ship.body;
  const closed = el.e < 1 && el.ra < B.soi;
  return { el, pe: el.rp - B.radius, ap: closed ? el.ra - B.radius : Infinity, closed };
}

/** True when the ship is within `tol` of its apoapsis or periapsis. */
function near(el, which, tol = 6 * DEG) {
  if (el.e >= 1) return which === 'pe' && Math.abs(el.nu) < tol;
  return Math.abs(wrapAngle(el.nu - (which === 'ap' ? Math.PI : 0))) < tol;
}

/** Δv (m/s) spent in the given directions since the step began, including a burn in progress. */
export function burnedSince(w, ctx, dirs) {
  let dv = 0;
  for (let i = ctx.log0; i < w.log.length; i++) {
    const ev = w.log[i];
    if (ev.type === 'burn' && dirs.includes(ev.dir)) dv += ev.dv;
  }
  if (w.burn.dir && dirs.includes(w.burn.dir)) dv += w.burn.dv;
  return dv;
}

/** True once a warp-to the apoapsis (under any of its names) has landed since the step began. */
function warpedToAp(w, ctx) {
  const names = ['Apoapsis', apsisNames(w.ship.body).ap];
  for (let i = ctx.log0; i < w.log.length; i++) {
    const ev = w.log[i];
    if (ev.type === 'arrive' && names.includes(ev.label)) return true;
  }
  return false;
}

/** The goal is to use the warp menu, so reaching apoapsis by just letting time run does not count. */
function driftedPastNote(w, ctx, name) {
  const a = apsides(w);
  if (w.warpTarget || !a.closed || !near(a.el, 'ap', 15 * DEG) || warpedToAp(w, ctx)) return null;
  return `That was ${name.toLowerCase()} going by on its own. Tap the warp readout and choose <b>${name}</b> to jump to the next one and stop right on it.`;
}

const IMPACT_NOTE = 'The red <b>×</b> means your path now hits Earth. Tap <b>Prograde</b> to lift it back above the ground before you get there.';
const ESCAPE_NOTE = 'Your path no longer comes back around Earth. Open the pause menu and choose <b>Restart step</b>.';

const EARTH = {
  id: 'basics',
  title: 'Flight School',
  hints: [],
  startWarp: 10,
  view: { focus: 'earth', span: 17000 },
  setup(w) {
    w.body('moon').setAngleAt(200, 0);
    w.placeShip('earth', { alt: 400, angle: 0 });
  },
};

// Earth-to-Mars transfer orbit around the Sun. Earth is just behind the ship,
// and Mars is well away from the aphelion so nothing captures the ship.
const SUN = {
  id: 'basics-sun',
  title: 'Flight School',
  hints: [],
  revs: 1.2,
  startWarp: 1e6,
  view: { focus: 'sun', span: 5.2e8 },
  setup(w) {
    const sun = w.body('sun');
    w.body('earth').setAngleAt(177, 0);
    w.body('mars').setAngleAt(280, 0);
    w.body('moon').setAngleAt(0, 0);
    w.placeShip('sun', {
      pe: w.body('earth').a - sun.radius,
      ap: w.body('mars').a - sun.radius,
      argPe: 180,
      nu: 0,
    });
  },
};

/*
 * Step fields:
 *   level      a level to build a fresh World from (first step, or a change of scene)
 *   title, text, goal   HTML shown in the coach panel
 *   check(w, ctx)       true once the goal is met (checked every frame, then latched)
 *   progress(w, ctx)    short live readout under the goal
 *   note(w, ctx)        guidance when the player has gone off track
 *   done(w, ctx)        HTML shown once the goal is met
 *   warp               time warp set when the step starts; doneWarp: when it is met
 *   highlight          selectors of controls to pulse; vectors: burn directions drawn at the ship
 *   pulse              apsis markers to pulse ('ap', 'pe'); apsisNames: use body-specific names
 *   reframe            fit the orbit in view once the goal is met
 */
const STEPS = [
  {
    id: 'orbit',
    level: EARTH,
    title: 'You are in orbit',
    text:
      'The amber arrow is you, 400 km above Earth, and the solid line is your path. You are falling toward Earth all the time, but you are also moving sideways at 7.7 km/s, so you keep missing it. That is an orbit.',
    goal: 'Speed up time to <b>500×</b> with the <b>›</b> button next to the warp readout',
    highlight: ['#warp-up'],
    check: (w) => w.warp >= 500,
    progress: (w) => `Time warp ${fmtWarp(w.warp)}`,
    done: () =>
      'Time warp only changes how fast the clock runs. Your orbit stays exactly the same. One lap takes about 90 minutes at this height.',
  },
  {
    id: 'prograde',
    title: 'Prograde',
    text:
      '<b>Prograde</b> is the direction you are moving. The arrow at your ship points prograde, and so does the arrow in the middle of the burn pad. A prograde burn makes you faster, and a faster ship swings out wider.',
    goal: 'Hold <b>Prograde</b> until the far side of your orbit (the <b>Ap</b> label) is over 2,000 km up',
    highlight: ['.burn.pro', '#pad-center'],
    vectors: ['prograde'],
    warp: 50,
    reframe: true,
    check(w) {
      const a = apsides(w);
      return !w.burn.dir && a.closed && a.ap >= 2000 && a.ap <= 20000;
    },
    progress(w) {
      const a = apsides(w);
      return a.closed ? `Ap ${fmtDist(a.ap)}` : 'Escaping Earth';
    },
    note(w) {
      const a = apsides(w);
      if (!w.burn.dir && (!a.closed || a.ap > 20000)) {
        return 'That is a lot. Tap <b>Retrograde</b>, the opposite button, to bring Ap back under 20,000 km.';
      }
      return null;
    },
    done: () =>
      'Look where your orbit changed: not where you burned, but on the far side of Earth. A burn moves the opposite side of your orbit the most.',
  },
  {
    id: 'apsides',
    title: 'Apoapsis and periapsis',
    text:
      'Your orbit is now an ellipse. Its highest point is the <b>apoapsis</b> (Ap) and its lowest point is the <b>periapsis</b> (Pe). Around Earth they are also called <b>apogee</b> and <b>perigee</b>. The panel at the top left lists both.',
    goal: 'Tap the warp readout and choose <b>Apoapsis</b> to jump there',
    highlight: ['#warp-value', '#row-ap', '#row-pe'],
    pulse: ['ap', 'pe'],
    doneWarp: 1,
    check(w, ctx) {
      const a = apsides(w);
      return a.closed && near(a.el, 'ap') && warpedToAp(w, ctx);
    },
    note: (w, ctx) => (apsides(w).closed ? driftedPastNote(w, ctx, 'Apoapsis') : ESCAPE_NOTE),
    done(w) {
      const { el } = apsides(w);
      const h = Math.abs(el.h);
      return `You are at the top, moving at <b>${fmtSpeed(h / el.ra)}</b>. Back at periapsis you will be doing ${fmtSpeed(h / el.rp)}. Every orbit is slowest at apoapsis and fastest at periapsis.`;
    },
  },
  {
    id: 'circularize',
    title: 'Circularize',
    text:
      'The rule works both ways: burn at apoapsis and it is the <b>periapsis</b> that moves. A prograde burn here raises Pe. Raise it until it meets Ap and your orbit becomes a circle. This is called circularizing.',
    goal: 'At Ap, hold <b>Prograde</b> until Pe comes up to meet Ap',
    highlight: ['.burn.pro', '#row-pe'],
    vectors: ['prograde'],
    pulse: ['pe'],
    reframe: true,
    check(w) {
      const a = apsides(w);
      return !w.burn.dir && a.closed && a.el.e < 0.03;
    },
    progress(w) {
      const a = apsides(w);
      return a.closed ? `Pe ${fmtDist(a.pe)} · Ap ${fmtDist(a.ap)}` : 'Escaping Earth';
    },
    note(w, ctx) {
      if (w.burn.dir) return null;
      const a = apsides(w);
      if (!a.closed) return ESCAPE_NOTE;
      if (a.el.e < 0.03) return null;
      // once burning has begun, the nearly round orbit's apsides swing around a lot, so judge
      // position only before the first burn
      const burned = burnedSince(w, ctx, ['prograde', 'retrograde']) > 0;
      if (burned && near(a.el, 'pe', 25 * DEG)) {
        return 'You overshot. Your old apoapsis is now the periapsis, and a new Ap has appeared on the far side. Tap <b>Retrograde</b> to bring it back down.';
      }
      if (!burned && !near(a.el, 'ap', 20 * DEG)) {
        return 'You have moved away from apoapsis. Tap the warp readout and choose <b>Apoapsis</b> to get back there first.';
      }
      return null;
    },
    done(w) {
      const a = apsides(w);
      return `Two prograde burns, half an orbit apart, took you from a 400 km orbit up to ${fmtDist((a.pe + a.ap) / 2)}. That is a <b>Hohmann transfer</b>, the standard way to change orbits.`;
    },
  },
  {
    id: 'retrograde',
    title: 'Retrograde',
    text:
      '<b>Retrograde</b> is the opposite of prograde: straight back, against your motion. It slows you down and lowers the far side of your orbit. Watch how long one lap takes as you go.',
    goal: 'Hold <b>Retrograde</b> until Pe drops below <b>1,000 km</b>',
    highlight: ['.burn.retro'],
    vectors: ['retrograde'],
    warp: 50,
    reframe: true,
    start(w, ctx) { ctx.period0 = w.shipElements().period; },
    check(w) {
      const a = apsides(w);
      return !w.burn.dir && a.closed && a.pe < 1000 && a.pe > 0;
    },
    progress(w) {
      const a = apsides(w);
      return `Pe ${fmtDist(a.pe)} · one lap ${fmtDur(a.el.period)}`;
    },
    note(w) {
      const a = apsides(w);
      if (a.pe <= 0) return IMPACT_NOTE;
      return a.closed ? null : ESCAPE_NOTE;
    },
    done(w, ctx) {
      return `A lower orbit is a quicker one. A lap now takes <b>${fmtDur(w.shipElements().period)}</b>, down from ${fmtDur(ctx.period0)}. You slowed down, and now you get around Earth sooner. The first level, Catch Up, is built on this.`;
    },
  },
  {
    id: 'radial',
    title: 'Radial in and out',
    text:
      '<b>Radial out</b> points straight away from Earth and <b>radial in</b> points straight at it. They push at right angles to your motion, so they hardly change the size of your orbit. Instead they swing it around you: radial out raises the orbit ahead of you and lowers it behind you, and radial in does the reverse.',
    goal: 'Hold <b>Radial out</b> or <b>Radial in</b> for about 100 m/s and watch Pe move',
    highlight: ['.burn.rout', '.burn.rin'],
    vectors: ['radialOut', 'radialIn'],
    pulse: ['pe'],
    warp: 50,
    reframe: true,
    check(w, ctx) {
      const a = apsides(w);
      return !w.burn.dir && a.closed && a.pe > 0 && burnedSince(w, ctx, ['radialIn', 'radialOut']) >= 90;
    },
    progress: (w, ctx) => `Radial Δv ${fmtDv(burnedSince(w, ctx, ['radialIn', 'radialOut']))} of 100 m/s`,
    note(w) {
      const a = apsides(w);
      if (a.pe <= 0) return IMPACT_NOTE;
      return a.closed ? null : ESCAPE_NOTE;
    },
    done: () =>
      'Radial burns are for aiming, not for climbing. To go higher or lower, prograde and retrograde burns at Pe or Ap are far cheaper.',
  },
  {
    id: 'helio',
    level: SUN,
    title: 'Perihelion and aphelion',
    text:
      'Every orbit has a low point and a high point, whatever it goes around. Around the Sun they are the <b>perihelion</b> and <b>aphelion</b> (<i>helios</i> is Greek for Sun). You are now on the path from Earth to Mars: perihelion at Earth\'s distance from the Sun, aphelion at Mars\'s.',
    goal: 'Tap the warp readout and choose <b>Aphelion</b>',
    highlight: ['#warp-value', '#row-ap', '#row-pe'],
    pulse: ['ap', 'pe'],
    apsisNames: true,
    doneWarp: 1,
    check(w, ctx) {
      const a = apsides(w);
      return w.ship.body.id === 'sun' && a.closed && near(a.el, 'ap') && warpedToAp(w, ctx);
    },
    note: (w, ctx) => driftedPastNote(w, ctx, 'Aphelion'),
    done: (w, ctx) =>
      `The trip out took ${fmtDur(w.t - ctx.t0)}, and Mars is not here to meet you. Timing that is the job of the last level. Earth's own orbit is slightly stretched too: perihelion comes in early January, 147 million km from the Sun, and aphelion in early July at 152 million km. Northern summer happens at aphelion, so the seasons come from Earth's tilt, not its distance.`,
  },
];

export const TUTORIAL = {
  id: 'basics',
  title: 'Flight School',
  concept: 'Prograde, retrograde, apoapsis, periapsis, perihelion and aphelion',
  tutorial: true,
  hints: [],
  lesson: '',
  view: EARTH.view,
  steps: STEPS,
};

/** Everything Flight School covered, for the closing card. */
export const GLOSSARY = [
  ['Prograde', 'Along your direction of motion. Raises the far side of your orbit.'],
  ['Retrograde', 'Against your direction of motion. Lowers the far side of your orbit.'],
  ['Radial in / out', 'Toward or away from the body you orbit. Swings your orbit around you.'],
  ['Periapsis (Pe)', 'The lowest point of an orbit, where you move fastest.'],
  ['Apoapsis (Ap)', 'The highest point of an orbit, where you move slowest.'],
  ['Perigee / apogee', 'Periapsis and apoapsis around Earth.'],
  ['Perilune / apolune', 'Periapsis and apoapsis around the Moon.'],
  ['Perihelion / aphelion', 'Periapsis and apoapsis around the Sun.'],
  ['Period', 'The time one lap takes. Lower orbits have shorter periods.'],
  ['Circularize', 'Burn at Ap or Pe until the two are equal and the orbit is round.'],
];

/** Start a step on world `w`. Returns the step's context. */
export function beginStep(step, w) {
  const ctx = { t0: w.t, log0: w.log.length };
  if (step.warp) w.setWarpIndex(WARPS.indexOf(step.warp));
  step.start?.(w, ctx);
  return ctx;
}

/** Live state of a step: whether its goal is met, plus the progress readout and any note. */
export function evaluate(step, w, ctx) {
  return {
    met: !!step.check(w, ctx),
    progress: step.progress ? step.progress(w, ctx) : null,
    note: step.note ? step.note(w, ctx) : null,
  };
}

/** Called once when a step's goal is met. Returns the HTML to show. */
export function completeStep(step, w, ctx) {
  if (step.doneWarp) w.setWarpIndex(WARPS.indexOf(step.doneWarp));
  return step.done(w, ctx);
}

/** Enough state to rewind the ship to the start of a step (bodies are on rails, so time covers them). */
export function snapshot(w) {
  const s = w.ship;
  return {
    t: w.t,
    warpIndex: w.warpIndex,
    ship: { body: s.body, x: s.x, y: s.y, vx: s.vx, vy: s.vy, fuel: s.fuel, dvUsed: s.dvUsed },
  };
}

export function restore(w, snap) {
  w.stopBurn();
  w.t = snap.t;
  Object.assign(w.ship, snap.ship);
  w.status = 'flying';
  w.statusInfo = null;
  w.warpTarget = null;
  w.setWarpIndex(snap.warpIndex);
  w.trail = [];
  w.predDirty = true;
  w.refreshPrediction(true);
}
