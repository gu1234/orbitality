// Level definitions. Each level sets up the world and teaches one idea.
// Angles are degrees, altitudes km above the surface, fuel/par in m/s.

export const LEVELS = [
  {
    id: 'catch-up',
    title: 'Catch Up',
    concept: 'Slow down to speed up',
    brief:
      'The target is in your orbit, a little ahead of you. Thrusting toward it would lift your orbit and you would fall behind. In orbit, lower is faster.',
    hints: [
      'Tap <b>Retrograde</b> briefly. Your orbit dips on the far side of Earth, and a lower orbit takes less time to go around.',
      'Watch the dashed <b>closest approach</b> line. Adjust with small taps until it is short, ideally under 10 km.',
      'Tap the warp readout and choose <b>Closest approach</b>. Tap <b>Frame</b> to zoom in on both ships, then hold <b>Match</b> to cancel your relative speed.',
    ],
    lesson:
      'You slowed down and ended up moving faster around Earth. A retrograde burn lowers the far side of the orbit, which shortens the period, so you gain on anything in the old orbit. This is how real crews phase with the ISS.',
    catchDist: 25,
    catchSpeed: 25,
    par: 220,
    startWarp: 50,
    view: { focus: 'earth', span: 17000 },
    setup(w) {
      w.body('moon').setAngleAt(200, 0);
      w.placeShip('earth', { alt: 400, angle: 0 });
      w.placeTarget('earth', { alt: 400, angle: 12 });
    },
  },
  {
    id: 'hold-back',
    title: 'Let It Come to You',
    concept: 'Speed up to slow down',
    brief:
      'This time the target is behind you in the same orbit. Braking would drop you into a faster orbit and pull you further ahead.',
    hints: [
      'Burn <b>Prograde</b>. Your orbit rises on the far side and its period gets longer.',
      'The target, still in the lower and faster orbit, catches up with you.',
      'When the closest approach is small, warp to it and <b>Match</b> velocity.',
    ],
    lesson:
      'A higher orbit is a slower orbit. Adding speed raised your orbit, lengthened your period and let the target catch up. Orbital speed and orbital "quickness" are not the same thing.',
    catchDist: 25,
    catchSpeed: 25,
    par: 220,
    startWarp: 50,
    view: { focus: 'earth', span: 17000 },
    setup(w) {
      w.body('moon').setAngleAt(200, 0);
      w.placeShip('earth', { alt: 400, angle: 0 });
      w.placeTarget('earth', { alt: 400, angle: -12 });
    },
  },
  {
    id: 'climb',
    title: 'Moving Up',
    concept: 'The Hohmann transfer',
    brief:
      'The target circles 2,000 km up. The cheapest way there is a Hohmann transfer: one prograde burn to raise the far side of your orbit, and a second burn when you get there.',
    hints: [
      'A prograde burn here raises the <b>opposite</b> side of your orbit. Raise your apoapsis (Ap) to the target\'s altitude.',
      'Timing matters. Burn when the target is about <b>25° ahead</b> of you, so it arrives just as you do. Check the closest-approach marker.',
      'At apoapsis, burn prograde again (or hold <b>Match</b>) to settle into the target\'s orbit.',
    ],
    lesson:
      'Two burns, half an orbit apart. The first stretches your orbit into an ellipse that touches the target\'s orbit. The second circularizes at the top. Launch timing (the phase angle) decides whether the target is waiting when you get there.',
    catchDist: 15,
    catchSpeed: 20,
    par: 900,
    startWarp: 100,
    view: { focus: 'earth', span: 21000 },
    setup(w) {
      w.body('moon').setAngleAt(250, 0);
      w.placeShip('earth', { alt: 400, angle: 0 });
      w.placeTarget('earth', { alt: 2000, angle: 40 });
    },
  },
  {
    id: 'descend',
    title: 'Coming Down',
    concept: 'Transfers work in reverse',
    brief: 'You are in a high orbit and the target is in low orbit. A transfer down works the same way as a transfer up, just in reverse.',
    hints: [
      'Burn <b>Retrograde</b> to lower the far side of your orbit to the target\'s altitude.',
      'The target orbits faster than you, so it gains on you while you wait. It should be about <b>30° behind</b> you when you burn.',
      'At periapsis, burn retrograde again or use <b>Match</b>.',
    ],
    lesson:
      'Going down costs about as much as going up. You have to remove the speed that kept you high. Low orbits are faster, so the target overtook you while you waited for the window.',
    catchDist: 15,
    catchSpeed: 20,
    par: 900,
    startWarp: 100,
    view: { focus: 'earth', span: 21000 },
    setup(w) {
      w.body('moon').setAngleAt(250, 0);
      w.placeShip('earth', { alt: 2000, angle: 0 });
      w.placeTarget('earth', { alt: 400, angle: -60 });
    },
  },
  {
    id: 'ellipse',
    title: 'Egg-Shaped',
    concept: 'Burn where orbits touch',
    brief:
      'The target\'s orbit is an ellipse whose low point just grazes your circular orbit. The two orbits touch at a single point.',
    hints: [
      'Where the orbits touch, you are moving in the same direction as the target\'s orbit, only slower. One <b>Prograde</b> burn there puts you on its ellipse.',
      'Match your Ap to the target\'s Ap and your orbits become the same.',
      'Then time it. Change your period slightly at periapsis until the closest approach shrinks.',
    ],
    lesson:
      'The cheapest place to switch between orbits is where they touch and point the same way. Every burn changes the opposite side of the orbit most, so "burn at periapsis to raise apoapsis" is the rule you will use most.',
    catchDist: 15,
    catchSpeed: 20,
    par: 1200,
    startWarp: 100,
    view: { focus: 'earth', span: 30000 },
    setup(w) {
      w.body('moon').setAngleAt(250, 0);
      w.placeShip('earth', { alt: 400, angle: -90 });
      w.placeTarget('earth', { pe: 400, ap: 5000, argPe: 0, nu: -78 });
    },
  },
  {
    id: 'moon',
    title: 'Fly Me to the Moon',
    concept: 'Encounters and capture',
    brief:
      'The target orbits the Moon. Leave Earth, fall into the Moon\'s sphere of influence (SOI), then brake so the Moon captures you.',
    hints: [
      'The Moon takes about 5 days to reach. Burn <b>Prograde</b> when the Moon is roughly <b>110–120° ahead</b> of you. Raise Ap until the path touches the Moon\'s SOI and a Moon encounter appears.',
      'Aim for a Moon periapsis of a few hundred km. Nudge with small radial or prograde burns midway.',
      'At the Moon periapsis, burn <b>Retrograde</b> to get captured. Then phase with the target as in the first levels.',
    ],
    lesson:
      'You never flew "at" the Moon. You aimed at where it would be in five days. Inside its sphere of influence you moved on a hyperbola around it, and one braking burn at periapsis turned that into a closed orbit.',
    revs: 12,
    catchDist: 15,
    catchSpeed: 20,
    par: 5000,
    startWarp: 100,
    view: { focus: 'earth', span: 900000 },
    setup(w) {
      w.body('moon').setAngleAt(160, 0);
      w.placeShip('earth', { alt: 400, angle: 0 });
      w.placeTarget('moon', { alt: 100, angle: 30, dir: 1 });
    },
  },
  {
    id: 'geo',
    title: 'Fuel Matters',
    concept: 'Δv budgets and the rocket equation',
    brief:
      'From now on your fuel is limited. The target is in geostationary orbit, 35,786 km up. A clean Hohmann transfer needs about 3.9 km/s, and you have only a little more than that.',
    hints: [
      'Waste is costly. Burn only prograde and retrograde, and only at periapsis or apoapsis.',
      'The transfer takes about 5 hours. The target should be about <b>100° ahead</b> when you burn.',
      'As fuel burns off the ship gets lighter and accelerates faster. That is the rocket equation at work.',
    ],
    lesson:
      'Δv is the currency of spaceflight. Your tank held a fixed amount, set by the rocket equation (Δv = Isp·g₀·ln(m₀/m₁)). Radial burns and badly timed burns spend it without getting you anywhere.',
    fuel: 4400,
    catchDist: 15,
    catchSpeed: 20,
    par: 4100,
    startWarp: 100,
    view: { focus: 'earth', span: 100000 },
    setup(w) {
      w.body('moon').setAngleAt(250, 0);
      w.placeShip('earth', { alt: 400, angle: 0 }, this.fuel);
      w.placeTarget('earth', { alt: 35786, angle: 140, name: 'GEO sat' });
    },
  },
  {
    id: 'patience',
    title: 'Patience',
    concept: 'Trade time for fuel',
    brief:
      'The target is a third of an orbit ahead of you and you have only 160 m/s of Δv. Catching it in a single orbit would need a very low orbit, low enough to hit Earth.',
    hints: [
      'A tiny retrograde burn gains a little on every lap, and those gains add up.',
      'Try about <b>60 m/s</b> retrograde and let the closest approach tick down over 10+ orbits. Warp speeds this up.',
      'Save roughly half of your fuel for matching velocity at the end.',
    ],
    lesson:
      'Phasing is a trade between time and fuel. A small period difference applied over many orbits closes any gap. Real missions often spend days phasing to save propellant.',
    fuel: 160,
    revs: 16,
    catchDist: 15,
    catchSpeed: 15,
    par: 150,
    startWarp: 500,
    view: { focus: 'earth', span: 17000 },
    setup(w) {
      w.body('moon').setAngleAt(250, 0);
      w.placeShip('earth', { alt: 400, angle: 0 }, this.fuel);
      w.placeTarget('earth', { alt: 400, angle: 120 });
    },
  },
  {
    id: 'moon-budget',
    title: 'Moon on a Budget',
    concept: 'Efficient transfers',
    brief:
      'The Moon again, now on a tight budget. Make one clean transfer burn, capture efficiently at periapsis and keep your corrections small.',
    hints: [
      'Do the whole transfer burn at once, prograde, when the Moon is about <b>115° ahead</b>.',
      'Fix the aim early. Small corrections far from the Moon go a long way.',
      'Capture at the lowest safe periapsis. The deeper in the Moon\'s gravity you brake, the more each m/s does (the Oberth effect).',
    ],
    lesson:
      'Burning deep in a gravity well, where you move fastest, gives the most change in orbital energy per m/s. That is the Oberth effect, and it is why departure and capture burns happen at periapsis.',
    fuel: 4500,
    revs: 12,
    catchDist: 15,
    catchSpeed: 20,
    par: 4200,
    startWarp: 100,
    view: { focus: 'earth', span: 900000 },
    setup(w) {
      w.body('moon').setAngleAt(100, 0);
      w.placeShip('earth', { alt: 400, angle: 0 }, this.fuel);
      w.placeTarget('moon', { alt: 100, angle: 200, dir: 1 });
    },
  },
  {
    id: 'wrong-way',
    title: 'Wrong Way',
    concept: 'Change velocity where you are slow',
    brief:
      'The target orbits Earth in the opposite direction. Reversing in low orbit would cost over 15 km/s, and you have 7.2 km/s.',
    hints: [
      'Far from Earth, near apoapsis, you move very slowly, so turning around there is cheap.',
      'Raise your apoapsis far out, beyond the Moon\'s orbit (watch out for the Moon itself). At apoapsis, burn to reverse direction.',
      'Fall back down, then brake into the target\'s orbit going the other way.',
    ],
    lesson:
      'Your speed is lowest at apoapsis, so turning your velocity around there costs little. This is the idea behind bi-elliptic transfers, and why large orbit changes are sometimes cheaper when done far out.',
    fuel: 7200,
    catchDist: 15,
    catchSpeed: 20,
    par: 6900,
    startWarp: 100,
    view: { focus: 'earth', span: 17000 },
    setup(w) {
      w.body('moon').setAngleAt(-150, 0);
      w.placeShip('earth', { alt: 400, angle: 0 }, this.fuel);
      w.placeTarget('earth', { alt: 400, angle: 90, dir: -1 });
    },
  },
  {
    id: 'mars',
    title: 'Red Planet',
    concept: 'Interplanetary transfer windows',
    brief:
      'The final challenge: a ship in low Mars orbit. Escape Earth, cross the Solar System on a Hohmann transfer around the Sun, and get captured at Mars.',
    hints: [
      'Mars must be about <b>44° ahead</b> of Earth when you leave. That happens only every 26 months, and the window opens in a few days.',
      'Escape from low orbit on the side of Earth that faces away from the Sun, so you leave moving in Earth\'s direction of travel. Burn prograde about 3.6 km/s and watch the closest-approach-to-Mars marker.',
      'Correct your course halfway, then brake at Mars periapsis with a retrograde burn.',
    ],
    lesson:
      'You combined everything: escape, a Sun-centred Hohmann transfer timed by the planets\' alignment, and capture at Mars. Real Mars missions launch on exactly this schedule.',
    fuel: 7600,
    revs: 12,
    catchDist: 20,
    catchSpeed: 25,
    par: 7000,
    startWarp: 1000,
    view: { focus: 'earth', span: 30000 },
    setup(w) {
      w.body('earth').setAngleAt(0, 0);
      w.body('mars').setAngleAt(47.5, 0);
      w.body('moon').setAngleAt(120, 0);
      w.placeShip('earth', { alt: 400, angle: 0 }, this.fuel);
      w.placeTarget('mars', { alt: 300, angle: 0, dir: 1 });
    },
  },
];

export const SANDBOX = {
  id: 'sandbox',
  title: 'Sandbox',
  concept: 'Free flight',
  brief: 'No target and no fuel limit. Fly anywhere you like: the Moon, escape Earth, visit other planets.',
  hints: [
    'Prograde raises the opposite side of your orbit. Retrograde lowers it.',
    'Radial burns rotate your orbit around you.',
    'Use high warp to watch the planets move.',
  ],
  lesson: '',
  startWarp: 50,
  view: { focus: 'earth', span: 17000 },
  setup(w) {
    w.body('moon').setAngleAt(120, 0);
    w.placeShip('earth', { alt: 400, angle: 0 });
  },
};

export function levelById(id) {
  if (id === SANDBOX.id) return SANDBOX;
  return LEVELS.find((l) => l.id === id) || null;
}
