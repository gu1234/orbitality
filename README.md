# Orbitality

A 2D, top-down orbital mechanics game for building intuition. You fly a spacecraft in orbit and try to catch another one. Early levels teach the counter-intuitive basics ("to catch up, slow down"). Later levels bring in transfers, the Moon, fuel budgets and a trip to Mars.

Works on phones (touch, portrait or landscape) and desktops (mouse and keyboard). No build step and no dependencies.

## Run it

```sh
npm start          # serves the game on http://localhost:8080
```

The server also prints a LAN address so you can open the game on your phone over the same Wi-Fi. ES modules don't load from `file://`, so the game needs to be served. Any static server works (for example `python3 -m http.server`).

Add `?all` to the URL to unlock every level while testing.

### Worktrees

```sh
npm run worktrees  # lists every git worktree on http://localhost:8070
```

The page lists this repo's worktrees, most recently changed first. A worktree's last change is its newest uncommitted edit or its last commit, whichever is later. **Play** opens that worktree's game at `/wt/<name>/`, and **All levels** opens it with `?all`. An open game reloads by itself when a file in its worktree changes, and the list updates as well. The server uses its own port because a service worker that `npm start` registered at `/` would take over the `/wt/` pages. Every worktree shares one origin, so they also share saved progress. Set `PORT` to use another port.

## Controls

| Action | Touch | Keyboard |
|---|---|---|
| Burn prograde / retrograde | hold the ▲ / ▼ pad buttons | W / S (or ↑ / ↓) |
| Burn radial in / out | hold the ◀ / ▶ pad buttons | A / D (or ← / →) |
| Burn toward target / match target velocity | hold **Toward** / **Match** | T / M |
| Fine burn | tap briefly | hold Shift |
| Plan a burn before flying it | **Plan** chip | B |
| Burn sooner / later (while planning) | hold − / + next to **Wait** | [ / ] |
| Time warp | ‹ and › around the warp readout | `,` and `.` |
| Warp to Ap / Pe / closest approach / SOI change | tap the warp readout | — |
| Zoom | pinch | mouse wheel / trackpad |
| Pan | drag | drag |
| Focus an object | tap it, or the focus chip | F |
| Frame ship + target | **Frame** chip or double-tap | Z |
| Lock the frame (camera follows ship + target) | **Lock** chip | L |
| Hints | ? button | H |
| Pause | ‖ button | Esc |
| Music on / off | ♪ button (menu, top bar or pause menu) | N |

The longer you hold a burn, the faster its Δv rate ramps up. A tap gives about 1 m/s and a long hold gives km/s. The game time scale adjusts during burns so both feel right.

### Planning a burn

Instead of burning live, you can plan a burn and approve it. Tap **Plan** (or press B) and time stops. The burn buttons now shape the plan instead of firing the engine. Prograde and retrograde add or take away along your motion, and radial in and out work the same way. Choose to burn **Now**, **At Ap** or **At Pe**. To burn later, add a **Wait**. It is counted in orbits of your current orbit, so the same buttons work in low orbit, where an orbit takes 90 minutes, and around the Sun, where it takes a year. On a path with no period, such as an escape, it counts hours. Hold − or + to change the wait faster. Below the wait, the panel shows how long until the burn and how far ahead the target will be at that moment. A dashed magenta ring on the map shows where the target will be. Compare the angle with the one the hints give, or keep adjusting the wait until the closest approach is small. A green line shows the orbit the burn gives you, with a marker where it happens. The panel lists the new Ap and Pe, any Moon encounter, your closest approach to the target, the burn time and the Δv you'll have left. A plan can never use more fuel than you have.

**Approve burn** warps to the burn and flies it. The burn is centred on the point you chose, so the orbit you get is the one the preview showed. **Cancel** drops a plan that is waiting, and so does firing the engine yourself. Opening the planner again brings the plan back for editing. Planning isn't available in Flight School, which teaches the buttons one at a time.

## What's on screen

- Planets are drawn from real imagery, seen **from above their north poles**, since the camera looks down on the Solar System. Each one spins at its real rotation rate and is half lit by the Sun. Earth has drifting clouds and city lights on its night side, the Moon always shows Earth the same face, and Saturn's rings carry the planet's shadow.

- **Amber** is you. The solid line is your predicted path. Dashed lines are later legs after a sphere-of-influence change.
- **Magenta** is the target and its orbit.
- **Ap / Pe** markers label the high and low points of your orbit. A red **×** means the orbit hits the surface.
- **Closest approach** puts ghost markers where you and the target will be at the moment you pass closest, with the distance and time.
- **Phase arc** shows how far ahead of you the target (or the Moon or Mars) is. The hints tell you what angle to wait for.
- The faint grid is centred on the body you orbit: that's your frame of reference.

## Flight School

A guided tutorial at the top of the menu, marked "Start here" for new players. It teaches the words of orbital flight in seven short steps. Each step names a goal that the game detects as you fly, then explains what just happened:

1. **You are in orbit**: what the map shows, and time warp.
2. **Prograde**: burn along your motion and watch the far side of the orbit rise.
3. **Apoapsis and periapsis**: the high and low points (apogee and perigee around Earth). Warp to Ap and compare your speed there with your speed at Pe.
4. **Circularize**: burn prograde at Ap until Pe meets it. Together with step 2 that is a Hohmann transfer.
5. **Retrograde**: lower Pe and see the orbital period get shorter.
6. **Radial in and out**: swing the orbit around you without changing its size.
7. **Perihelion and aphelion**: the same points around the Sun, on an Earth-to-Mars transfer orbit.

The coach panel shows a live readout for each goal and a note when you go off track, for example "you overshot" or "your path hits Earth". The controls and map markers it mentions pulse. A crash rewinds to the start of the step, and the pause menu has **Restart step**. At the end, a glossary card lists every term, including perilune and apolune for the Moon.

## Glossary

Every word of orbital flight in the game's text is a link: briefings, hints, the Flight School coach, results, the welcome card, and the names in the telemetry and target panels. Links have a dotted blue underline. Tap one and a card opens with a one-line definition, an animated diagram and a longer explanation. Terms inside a card are links too (with **Back**), and **See also** points to related ones. Time stands still while a card is open.

The animations use real two-body motion scaled down, so ships really do slow down at apoapsis, and burns really reshape the orbit. They cover the orbit itself (Newton's cannon), prograde, retrograde, radial, apsides around Earth, the Moon and the Sun, period, circularizing, ellipses, time warp, Δv, the rocket equation, Hohmann transfers, phase angle, phasing, closest approach, relative velocity, spheres of influence, encounters, capture, hyperbolas, escape, the Oberth effect, gravity wells, geostationary orbit, transfer windows and bi-elliptic transfers. With reduced motion turned on, each card shows a still frame with a play button.

The **Glossary** page (main menu or pause menu) lists every term with its full explanation, a search box, and a **Watch** button for each animation.

## Levels

The first three levels open with a short launch at dusk. On the pad the rocket vents cold vapour beside its service tower, the engines light while hold-down clamps keep it in place, and exhaust rolls out of the flame trench as the umbilicals let go. It lifts off through the clouds, climbs out of Earth's shadow into sunlight, drops its first stage and fairing, and releases your craft. The camera then pulls back into the game's map view, so the level starts where the launch left off. Tap or press any key to skip it. Retry and Restart go straight to the briefing.

1. **Catch Up**: the target is ahead in the same orbit. Burn retrograde to speed up around Earth.
2. **Let It Come to You**: the target is behind you. Burn prograde, go higher, and let it catch up.
3. **Moving Up**: Hohmann transfer to a higher orbit.
4. **Coming Down**: Hohmann transfer to a lower orbit.
5. **Egg-Shaped**: match an elliptical orbit where it touches yours.
6. **Fly Me to the Moon**: lunar transfer, SOI encounter and capture.
7. **Fuel Matters** (limited fuel): GEO on a Δv budget, with the rocket equation.
8. **Patience** (limited fuel): phase over many orbits to save fuel.
9. **Moon on a Budget** (limited fuel): an efficient lunar mission and the Oberth effect.
10. **Wrong Way** (limited fuel): catch a target orbiting the other way by reversing far from Earth.
11. **Red Planet** (limited fuel): interplanetary transfer window, escape, capture at Mars.

There is also a **Free flight sandbox** with no target and unlimited fuel.

Stars are awarded by Δv spent: under par gives three stars, and up to 1.5× par gives two. Progress is saved in the browser's local storage.

## Music

The soundtrack is ambient space music generated live in the browser with the Web Audio API. There are no audio files. Slow detuned pads play over a low drone, with sparse bell notes like stars. While you fly, a quiet arpeggio rises and falls and sweeps from side to side like an orbit. It never repeats exactly.

- The harmony follows the body you orbit: bright D Lydian around Earth, a colder E minor at the Moon, darker D Aeolian at Mars and open fifths in deep space. It crossfades a couple of seconds after you cross into a new sphere of influence.
- Burns open up the pads and add a high shimmer. The arpeggio doubles its speed at 1000× warp and above.
- Pausing muffles the music. Catching the target plays a rising chime, and crashing plays a low boom.

Browsers only allow audio after a tap or key press, so the music starts on your first interaction. The on/off choice is saved in local storage, and the music stops while the tab is hidden.

## Physics

- Real Solar System values: GM and radii, a Moon at 384,400 km, planets at their real distances. Bodies move on circular orbits, and each body's orbital speed comes from its parent's gravity.
- **Patched conics**, as in Kerbal Space Program. The ship follows a Kepler orbit around whichever body's sphere of influence it is in. Coasting is propagated analytically with universal variables, so time warp is exact at any speed.
- Sphere-of-influence changes and surface impacts are found by conservative sub-stepping plus bisection. The same routine drives both the simulation and the trajectory prediction, so the ship always follows the line you see.
- Burns are finite. Thrust is applied with kick-drift-kick sub-steps, and fuel mass follows the rocket equation (Isp 340 s).

## Project layout

```
index.html, css/style.css   UI shell and styling (css/tutorial.css for Flight School)
js/physics/                 kepler.js (two-body math), bodies.js (solar system),
                            propagate.js (event-aware coasting), predict.js (patches, closest approach)
js/game/                    world.js (ship, burns, warp, catch), levels.js, progress.js,
                            tutorial.js (Flight School steps and goal checks),
                            terms.js (glossary words and how they are found in text)
js/render/                  camera.js, renderer.js (canvas drawing), planets.js (lit, spinning planet discs),
                            tutorial-overlay.js (Flight School arrows and marker pulses),
                            term-anims.js (animated diagrams for the glossary cards)
js/audio/                   music.js (generative ambient score, Web Audio)
js/ui/                      input.js (touch/mouse/keyboard), format.js, coach.js (Flight School panel),
                            terms.js (term links, glossary cards and page; css/terms.css)
tests/                      physics tests + a scripted autopilot that proves every level is solvable
assets/planets/             top-down planet images (generated)
tools/build_planets.py      downloads the source maps and reprojects them (needs Pillow + NumPy)
tools/worktrees.mjs         worktree list and live-reloading game server (tools/worktrees.html)
server.mjs                  zero-dependency static dev server
sw.js                       service worker that makes every load run the latest deploy (below)
```

### Always the latest deploy

GitHub Pages lets browsers cache each file for 10 minutes. The game is many separate modules, and a reload reuses the ones the tab already has. So without help, a browser can keep running old code after a deploy, or mix old files with new ones. `sw.js` fixes this with no build step:

- Once the worker is running, `index.html` loads the stylesheets and `js/main.js` from a path that is new on every page load (`v/<n>/…`). No cache has seen that path, so nothing old gets reused.
- The worker maps `v/<n>/` back to the real file and asks the server for it. The request is conditional, so an unchanged file costs a short "not modified" reply.
- It keeps what comes back, so the game also loads offline.

The first visit has no worker yet and loads the files from their plain paths.

## Credits

Planet textures: [Solar System Scope](https://www.solarsystemscope.com/textures/), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). They are reprojected from equirectangular maps to a north-polar orthographic view by `tools/build_planets.py`. To rebuild them:

```sh
python3 tools/build_planets.py
```

## Tests

```sh
npm test
```

- **Physics tests** check the Kepler solver against an RK4 integrator (e = 0 to 3, forward and backward, 100 revolutions). They also check SOI hand-off continuity, impact detection, and that the simulation agrees with the prediction.
- **Level tests** fly every level with a scripted pilot through the same game API, and assert that it catches the target within the level's fuel budget.
- **Glossary tests** check that terms are found in the game's text (and only as whole words and in the right sense), that each is well formed, and that every animation plays through with finite coordinates.
- **Flight School tests** fly every tutorial step by holding burn buttons through `World.update`, with a human reaction delay. They check that each goal can be met, and that no goal is met by just letting time run (drifting past apoapsis does not count as warping to it). They also check that overshooting can be corrected, that the solar leg is never captured by a planet, and that a crash rewinds the step.
