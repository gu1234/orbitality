// Glossary: every term in the game's text that a newcomer might not know.
// js/ui/terms.js links these words wherever they appear and opens a card with the
// definition and an animation (js/render/term-anims.js). No DOM here, so the tests
// can check the matching.
//
// Term fields:
//   id, name      key and card title
//   match         patterns that find the term in running text (each is tried per text node,
//                 so ^ and $ mean "the whole bold word", as in <b>Match</b>)
//   short         one-line definition, shown under the title and in the index
//   body          paragraphs of HTML; other terms in them are linked too
//   anim          animation id in js/render/term-anims.js
//   related       ids for the "See also" row

export const TERMS = [
  {
    id: 'orbit',
    name: 'Orbit',
    match: [/(?<=\b(?:in|an|into) )orbit\b/i, /\borbital mechanics\b/i],
    short: 'Falling around a planet so fast sideways that you keep missing it.',
    body: [
      'Throw a ball sideways and it curves down to the ground. Throw it faster and it lands further away, because the ground curves away beneath it. Throw it fast enough and the ground curves away as fast as the ball falls, so it never lands. That is an orbit.',
      'Just above Earth\'s air that takes about 7.7 km/s. You are falling toward Earth the whole time, which is why everything on board floats. Orbital mechanics is the study of these paths, and most of it follows from this one idea.',
    ],
    anim: 'orbit',
    related: ['period', 'ellipse', 'prograde'],
  },
  {
    id: 'prograde',
    name: 'Prograde',
    match: [/\bprograde\b/i],
    short: 'The direction you are moving. A prograde burn speeds you up.',
    body: [
      'Pointing prograde means pointing along your motion. A prograde burn makes you faster, and a faster ship swings out wider, so the far side of your orbit rises. The side where you burned stays where it is, because you are already there.',
      'It is the main tool for climbing: burn prograde at periapsis to raise the apoapsis, or at apoapsis to raise the periapsis.',
    ],
    anim: 'prograde',
    related: ['retrograde', 'apoapsis', 'hohmann', 'delta-v'],
  },
  {
    id: 'retrograde',
    name: 'Retrograde',
    match: [/\bretrograde\b/i],
    short: 'Against your motion. A retrograde burn slows you down.',
    body: [
      'Retrograde points straight back along your path. A retrograde burn slows you, so the far side of your orbit drops. A lower orbit is shorter and you move faster along it, so you get around sooner.',
      'That is why you slow down to catch something ahead of you in the same orbit. In the animation the faint ship stays in the old orbit and falls behind.',
    ],
    anim: 'retrograde',
    related: ['prograde', 'period', 'phasing', 'periapsis'],
  },
  {
    id: 'radial',
    name: 'Radial in and out',
    match: [/\bradial(?: in| out)?(?: and out| or in| or out)?\b/i],
    short: 'Straight toward (in) or away from (out) the body you orbit.',
    body: [
      'Radial burns push at right angles to your motion, so they hardly change your speed or the size of your orbit. Instead they swing the orbit around you. Radial out raises the orbit ahead of you and lowers it behind you, and radial in does the reverse.',
      'Use them for aiming, for example to fine-tune where you meet the Moon. To climb or descend, prograde and retrograde burns are far cheaper.',
    ],
    anim: 'radial',
    related: ['prograde', 'apoapsis', 'delta-v'],
  },
  {
    id: 'apoapsis',
    name: 'Apoapsis (Ap)',
    match: [/\bapoapsis\b/i, /\bapoapses\b/i, /\bAp\b/],
    short: 'The highest point of an orbit, where you move slowest.',
    body: [
      'Every closed orbit has a high point and a low point, on opposite sides of the body you orbit. The high point is the apoapsis, or Ap for short. You slow down as you climb toward it and speed up again as you fall away from it.',
      'A burn at apoapsis moves the opposite point, the periapsis, the most. Around particular bodies it has its own name: apogee around Earth, apolune around the Moon and aphelion around the Sun.',
    ],
    anim: 'apsides-ap',
    related: ['periapsis', 'perigee', 'circularize', 'ellipse'],
  },
  {
    id: 'periapsis',
    name: 'Periapsis (Pe)',
    match: [/\bperiapsis\b/i, /\bperiapses\b/i, /\bPe\b/],
    short: 'The lowest point of an orbit, where you move fastest.',
    body: [
      'The periapsis, or Pe, is the closest your orbit comes to the body it goes around. You are fastest there, having fallen all the way in from apoapsis.',
      'If the periapsis is below the surface, the orbit hits the ground, and the game marks that with a red ×. Burns at periapsis get the most out of your fuel (the Oberth effect), so departure and capture burns happen there.',
    ],
    anim: 'apsides-pe',
    related: ['apoapsis', 'perigee', 'oberth', 'capture'],
  },
  {
    id: 'perigee',
    name: 'Perigee and apogee',
    match: [/\bperigee\b/i, /\bapogee\b/i],
    short: 'Periapsis and apoapsis for an orbit around Earth.',
    body: [
      '<i>Gee</i> comes from the Greek for Earth, as in geography. Perigee is the lowest point of an orbit around Earth and apogee the highest. They are the same thing as periapsis and apoapsis, named for the body.',
    ],
    anim: 'apsides-earth',
    related: ['periapsis', 'apoapsis', 'perilune', 'perihelion'],
  },
  {
    id: 'perilune',
    name: 'Perilune and apolune',
    match: [/\bperilune\b/i, /\bapolune\b/i],
    short: 'Periapsis and apoapsis for an orbit around the Moon.',
    body: [
      '<i>Luna</i> is Latin for Moon. Perilune is your lowest point over the Moon and apolune your highest. The Moon has no air to slow you, so a perilune of a few tens of kilometres is fine as long as it stays above the ground.',
    ],
    anim: 'apsides-moon',
    related: ['periapsis', 'apoapsis', 'perigee', 'capture'],
  },
  {
    id: 'perihelion',
    name: 'Perihelion and aphelion',
    match: [/\bperihelion\b/i, /\baphelion\b/i],
    short: 'Periapsis and apoapsis for an orbit around the Sun.',
    body: [
      '<i>Helios</i> is Greek for Sun. On the trip from Earth to Mars, perihelion is at Earth\'s distance from the Sun and aphelion at Mars\'s.',
      'Earth\'s own orbit is slightly stretched too. It passes perihelion in early January, 147 million km from the Sun, and aphelion in early July at 152 million km.',
    ],
    anim: 'apsides-sun',
    related: ['periapsis', 'apoapsis', 'transfer-window', 'hohmann'],
  },
  {
    id: 'period',
    name: 'Orbital period',
    match: [/\b(?:orbital )?periods?\b/i],
    short: 'The time one lap of an orbit takes.',
    body: [
      'Lower orbits have shorter periods. At 400 km up a lap takes about 92 minutes, at 8,000 km about 4 h 45 min, and the Moon takes 27 days. Two things add up: a higher orbit is longer, and you move more slowly along it.',
      'This is why phasing works. Change your period a little, and you gain or lose on anything in the old orbit every lap.',
    ],
    anim: 'period',
    related: ['phasing', 'retrograde', 'geo'],
  },
  {
    id: 'circularize',
    name: 'Circularize',
    match: [/\bcirculari[sz](?:e|es|ed|ing|ation)\b/i],
    short: 'Burn at Ap or Pe until the two are equal and the orbit is round.',
    body: [
      'After a transfer, your orbit touches the one you want at just one point. At apoapsis, burn prograde: the periapsis on the far side rises until it meets the apoapsis and the orbit becomes a circle. Coming down, you circularize at periapsis with a retrograde burn instead.',
      'Watch for overshooting. Burn too long and your old apoapsis becomes the new periapsis.',
    ],
    anim: 'circularize',
    related: ['hohmann', 'apoapsis', 'periapsis'],
  },
  {
    id: 'hohmann',
    name: 'Hohmann transfer',
    match: [/\bHohmann(?: transfers?)?\b/i],
    short: 'The cheapest way between two circular orbits: two burns, half an orbit apart.',
    body: [
      'Burn prograde to stretch your orbit into an ellipse that just touches the higher orbit. Coast half a lap to its apoapsis, then burn prograde again to circularize. Going down works the same way with retrograde burns.',
      'Walter Hohmann worked it out in 1925. The target has to be in the right place when you arrive, and that is what the phase angle is for.',
    ],
    anim: 'hohmann',
    related: ['phase-angle', 'circularize', 'transfer-window', 'bi-elliptic'],
  },
  {
    id: 'ellipse',
    name: 'Ellipse',
    match: [/\bellip(?:se|ses|tical)\b/i, /\beccentricity\b/i],
    short: 'A stretched circle, and the shape of every closed orbit.',
    body: [
      'An orbit that is not a perfect circle is an ellipse. The body you orbit sits at one of its two focus points, not in the middle, so one end of the orbit comes closer than the other. Those ends are the periapsis and the apoapsis.',
      'How stretched it is is called its eccentricity: 0 is a circle, and close to 1 is a long, thin ellipse. At 1 and above the orbit no longer closes.',
    ],
    anim: 'ellipse',
    related: ['apoapsis', 'periapsis', 'hyperbola', 'orbit'],
  },
  {
    id: 'warp',
    name: 'Time warp',
    match: [/\btime warp\b/i, /^Warp to$/, /\bwarp\b/i],
    short: 'Speeding up the clock so long coasts take seconds.',
    body: [
      'Orbits are slow. A lap of Earth takes 90 minutes and the trip to the Moon five days. Time warp runs the clock faster so you can skip the waiting. It does not change your orbit at all, only how fast time passes.',
      '<b>Warp to</b> jumps straight to your next apoapsis, periapsis or closest approach. Warp slows down by itself during burns and near the target.',
    ],
    anim: 'warp',
    related: ['period', 'closest'],
  },
  {
    id: 'delta-v',
    name: 'Δv (delta-v)',
    match: [/Δv\b/, /\bdelta-v\b/i],
    short: 'How much a burn changes your velocity. The currency of spaceflight.',
    body: [
      '<i>Δ</i> (delta) means change, and <i>v</i> is velocity. Every burn adds some Δv, measured in m/s, to your velocity. Along your motion it changes your speed. Sideways it mostly changes your direction.',
      'Fuel is counted the same way: a tank holds a fixed amount of Δv, set by the rocket equation. Missions are planned as Δv budgets. Reaching low Earth orbit takes about 9.4 km/s, and going on to geostationary orbit about 3.9 km/s more.',
    ],
    anim: 'delta-v',
    related: ['rocket-equation', 'prograde', 'radial'],
  },
  {
    id: 'rocket-equation',
    name: 'Rocket equation',
    match: [/\brocket equation\b/i, /\bIsp\b/],
    short: 'How much Δv a tank of fuel buys: Δv = Isp·g₀·ln(m₀/m₁).',
    body: [
      'm₀ is the ship\'s mass full of fuel and m₁ its mass when the fuel is gone. Isp, the specific impulse, says how efficient the engine is (340 s in this game), and g₀ is 9.81 m/s². Multiplied together they give the exhaust speed, about 3.3 km/s here.',
      'The logarithm is the catch. With this engine, every 2.3 km/s burns off half of whatever the ship still weighs. A tank for 4.6 km/s is three quarters fuel, and one for 9.2 km/s is 94% fuel. As the fuel burns off, the ship gets lighter and the same engine pushes it harder.',
    ],
    anim: 'rocket',
    related: ['delta-v'],
  },
  {
    id: 'soi',
    name: 'Sphere of influence (SOI)',
    match: [/\bspheres? of influence\b/i, /\bSOI\b/],
    short: 'The region around a body where its gravity is the one that counts.',
    body: [
      'Near the Moon the Moon\'s pull wins, and further out Earth\'s does. The game, like Kerbal Space Program, draws a boundary between them. Inside the dashed circle you orbit the Moon, and outside it you orbit Earth. Crossing it switches which body your orbit is measured around.',
      'The Moon\'s SOI reaches about 66,000 km from its centre. Earth\'s reaches about 925,000 km, and beyond that you orbit the Sun.',
    ],
    anim: 'soi',
    related: ['encounter', 'capture', 'escape'],
  },
  {
    id: 'phase-angle',
    name: 'Phase angle',
    match: [/\bphase angle\b/i, /\bphase arc\b/i, /\b\d+(?:–\d+)?° (?:ahead|behind)\b/],
    short: 'How far ahead of you the target is, measured around the body you orbit.',
    body: [
      'It is the angle, seen from the centre of the body you orbit, between you and the target. The game draws it as an arc and lists it in the target panel.',
      'A transfer takes time, and the target keeps moving while you fly. So you wait until it is the right angle ahead, then burn, and it reaches the meeting point just as you do. The lower orbit keeps lapping the higher one, so the angle changes while you wait.',
    ],
    anim: 'phase-angle',
    related: ['hohmann', 'transfer-window', 'phasing'],
  },
  {
    id: 'phasing',
    name: 'Phasing',
    match: [/\bphasing\b/i, /\bphase with\b/i],
    short: 'Changing your period slightly so you gain on (or drop back from) a target in the same orbit.',
    body: [
      'To catch something ahead of you, drop into a slightly lower, quicker orbit and let each lap close the gap. To let something catch you, go slightly higher. When the gap is gone, burn back into the original orbit.',
      'A bigger change catches up in fewer laps but costs more Δv. Real crews spend a day or two phasing before they dock with the International Space Station.',
    ],
    anim: 'phasing',
    related: ['period', 'retrograde', 'closest'],
  },
  {
    id: 'closest',
    name: 'Closest approach',
    match: [/\bclosest[- ]approach(?:es)?\b/i, /^Closest$/],
    short: 'The nearest you and the target will get on your current paths.',
    body: [
      'The game looks ahead along both orbits and finds the moment you pass closest. Ghost markers show where you and the target will be then, joined by a dashed line with the distance.',
      'Shorten that line with small burns, warp to the moment, then match velocity. You never chase the target directly: you set up the meeting and let the orbits bring you together.',
    ],
    anim: 'closest',
    related: ['relative-velocity', 'phasing', 'warp'],
  },
  {
    id: 'relative-velocity',
    name: 'Relative velocity',
    match: [/\brel(?:ative|\.) (?:speed|velocity)\b/i, /\bmatch(?:ing)? (?:the target(?:'|’)s )?velocity\b/i, /^Match$/],
    short: 'How fast you and the target are moving apart or together.',
    body: [
      'Everything in orbit moves at kilometres per second, but when you meet a target what counts is the difference between your velocity and its velocity. At the closest approach you may still be passing at hundreds of m/s.',
      'Holding <b>Match</b> burns against that difference until it is zero, so the two of you drift along together. To catch the target you need to be close to it and slow relative to it.',
    ],
    anim: 'match',
    related: ['closest', 'delta-v'],
  },
  {
    id: 'encounter',
    name: 'Encounter',
    match: [/\bencounters?\b/i],
    short: 'When your path enters another body\'s sphere of influence.',
    body: [
      'Aim a transfer so that your path crosses the Moon\'s sphere of influence just as the Moon gets there, and the game shows a Moon encounter: a new leg of your path, drawn around the Moon, with its own periapsis.',
      'You do not aim at the Moon but at where it will be when you arrive. The Moon moves about 13° a day, and the trip takes about five days.',
    ],
    anim: 'encounter',
    related: ['soi', 'capture', 'phase-angle'],
  },
  {
    id: 'capture',
    name: 'Capture',
    match: [/\bcaptur(?:e|es|ed|ing)\b/i],
    short: 'Braking into a closed orbit around a body you arrive at.',
    body: [
      'You arrive at the Moon or Mars too fast to stay, on a hyperbola that would carry you back out again. A retrograde burn at periapsis slows you enough for the path to close into an ellipse, and you have been captured.',
      'Brake at the lowest safe periapsis, where you move fastest. Thanks to the Oberth effect, each m/s does the most there.',
    ],
    anim: 'capture',
    related: ['hyperbola', 'oberth', 'soi'],
  },
  {
    id: 'escape',
    name: 'Escape',
    match: [/\bescape velocity\b/i, /\bescap(?:e|es|ed|ing)\b/i],
    short: 'Going fast enough that your orbit never comes back.',
    body: [
      'Each prograde burn stretches your orbit further. Past a certain speed, the escape velocity, the orbit stops closing. It opens into a hyperbola, and you leave the body for good and carry on around whatever it orbits.',
      'From low Earth orbit that takes about 3.2 km/s on top of your 7.7 km/s. Heading for Mars takes a little more, so you still have speed to spare once you are out.',
    ],
    anim: 'escape',
    related: ['hyperbola', 'soi', 'transfer-window'],
  },
  {
    id: 'hyperbola',
    name: 'Hyperbola',
    match: [/\bhyperbol(?:a|as|ic)\b/i],
    short: 'An open path that swings past a body once and never comes back.',
    body: [
      'Go faster than escape velocity and your path is not an ellipse but a hyperbola. It bends around the body once and heads off in an almost straight line.',
      'When you arrive at the Moon or another planet you are always on one, until you brake to capture.',
    ],
    anim: 'flyby',
    related: ['escape', 'capture', 'ellipse'],
  },
  {
    id: 'oberth',
    name: 'Oberth effect',
    match: [/\bOberth(?: effect)?\b/i],
    short: 'A burn does the most where you move fastest, deep in a gravity well.',
    body: [
      'The energy a burn adds is roughly your speed times its Δv, so the same burn is worth more when you are moving fast. You move fastest at periapsis, low in a gravity well, so that is where departure and capture burns go.',
      'In the animation both ships burn the same Δv. The one that burns at periapsis ends up on a much bigger orbit.',
    ],
    anim: 'oberth',
    related: ['gravity-well', 'periapsis', 'capture'],
  },
  {
    id: 'gravity-well',
    name: 'Gravity well',
    match: [/\bgravity wells?\b/i],
    short: 'The dip around a body that you fall into. Deeper in, you move faster.',
    body: [
      'Picture gravity as a funnel. Far out, near the rim, you move slowly. Close in, deep in the funnel, you move fast. An elliptical orbit rolls down toward periapsis and back up toward apoapsis, trading height for speed and back again.',
      'Climbing out of the well costs Δv, which is why escaping Earth takes so much of it.',
    ],
    anim: 'well',
    related: ['oberth', 'periapsis', 'escape'],
  },
  {
    id: 'geo',
    name: 'Geostationary orbit (GEO)',
    match: [/\bgeostationary(?: orbit)?\b/i, /\bGEO\b/],
    short: 'An orbit 35,786 km up where a lap takes a day, so a satellite hangs over one spot.',
    body: [
      'Earth turns once a day, and 35,786 km above the equator an orbit takes the same time. A satellite there stays over the same place on the ground, which is why satellite dishes can point at a fixed spot in the sky.',
      'Lower satellites lap faster than Earth turns, so they cross the sky. From low orbit, getting to GEO takes a Hohmann transfer of about 3.9 km/s.',
    ],
    anim: 'geo',
    related: ['period', 'hohmann'],
  },
  {
    id: 'transfer-window',
    name: 'Transfer window',
    match: [/\btransfer windows?\b/i, /\bwindows?\b/i],
    short: 'The time when the planets are lined up right for a transfer.',
    body: [
      'A Hohmann transfer to Mars takes about eight and a half months, and Mars moves on while you fly. So you leave when Mars is about 44° ahead of Earth, and it reaches the far end of your transfer when you do.',
      'Earth laps Mars only once every 26 months, so that is how often the window comes round. Miss it and you wait two years.',
    ],
    anim: 'window',
    related: ['hohmann', 'phase-angle', 'escape'],
  },
  {
    id: 'bi-elliptic',
    name: 'Bi-elliptic transfer',
    match: [/\bbi-elliptic(?: transfers?)?\b/i],
    short: 'A three-burn transfer that goes far out first, where burns are cheap.',
    body: [
      'Burn to a very high apoapsis, change your orbit up there where you move slowly, then fall back to where you want to be. For big changes, such as reversing your direction, that costs less than doing everything close in.',
      'Turning around in low orbit would cost over 15 km/s. In the animation the ship turns around at a distant apoapsis for under 3 km/s and comes back orbiting the other way.',
    ],
    anim: 'bielliptic',
    related: ['hohmann', 'apoapsis', 'delta-v'],
  },
];

const BY_ID = new Map(TERMS.map((t) => [t.id, t]));

export function termById(id) {
  return BY_ID.get(id) || null;
}

// every pattern, as a global regex, with the term it belongs to
const PATTERNS = TERMS.flatMap((t) => t.match.map((re) => ({
  id: t.id,
  re: new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'),
})));

/**
 * Terms in a piece of plain text: [{ start, end, id }] in order, without overlaps.
 * Longer matches win. Only the first mention of each term is returned, and ids
 * already in `seen` are skipped; the ids returned are added to `seen`.
 */
export function findTerms(text, seen = new Set()) {
  const all = [];
  for (const { id, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0]) { re.lastIndex++; continue; }
      all.push({ start: m.index, end: m.index + m[0].length, id });
    }
  }
  all.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out = [];
  let reach = 0;
  for (const c of all) {
    if (c.start < reach) continue; // overlaps a longer or earlier match
    reach = c.end;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** The term a short label names ("Apogee", "Δv left"), or null. */
export function termFor(label) {
  return findTerms(label)[0]?.id || null;
}
