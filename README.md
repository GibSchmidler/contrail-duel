# Contrail Duel

Browser-based 3D **modern air combat**, from 1v1 duels to 8v8 battles, played entirely on the keyboard. There are **13 fighters from four nations**: the USA, Russia, China and Europe. Each has its own flight performance, radar, IRST, stealth, jamming, gun and missiles. The flight model is semi-realistic fly-by-wire, terrain blocks sensors, and shot-down jets break up with the pilot ejecting. It has four maps with time of day and weather, a scenario builder, online rooms for up to 8 players, and AI that fills any empty seat.

## Aircraft

| Nation | Jets |
| --- | --- |
| United States | F-16C Block 50, F-15C Eagle, F/A-18E Super Hornet, F-22A Raptor (stealth) |
| Russia | MiG-29S, Su-35S, Su-57 (reduced signature) |
| China | J-10C, J-16, J-20A (stealth, no gun) |
| Europe | Eurofighter Typhoon, Dassault Rafale C, Saab Gripen E |

Each jet's data is in `public/js/aircraft.js`, and its 3D model and paint scheme in `public/js/models_jets.js`. Nothing is balanced on purpose. The US has the best sensors and missiles, while Russia and China trail in missiles and stealth maturity.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000.

## Playing online

Both players must open the page **from the same server**:

- **Same network (LAN):** run the server on one machine. The other player opens `http://<that machine's IP>:3000`.
- **Over the internet:** deploy this folder to any Node host that supports WebSockets (Render, Railway, Fly.io, a VPS, …). The start command is `npm start`, and the server honours the `PORT` environment variable. HTTPS/WSS is detected automatically.

Then use **Quick 1v1 match** (pairs the next two people searching), or **Host a room** and give up to 7 friends the 4-letter code. In a room, the host picks or edits the scenario, players choose their seats and jets, and the AI flies every seat nobody takes. If a player leaves mid-match, the AI takes over their jet.

## Scenarios

Pick a built-in mission on the main menu (duels, 2v2, 4v4 furball, Raptors vs Flankers, night intercept, canyon knife fight, 4-player co-op against 8 AI, 8v8 team battle) or open the **Scenario builder**:

- **Environment:** map (Islands, Alpine, Desert Canyons, Arctic Fjords), time of day (dawn, day, dusk, moonlit night) and weather (clear to overcast, or haze). Night and haze shorten visual range; overcast puts a cloud deck overhead.
- **Rules:** rounds to win and an optional round time limit (the side with more jets left wins when time runs out).
- **Sides:** up to 8 aircraft each. Drag each side's start point and heading on the map; set altitude, speed, formation and spacing.
- **Slots:** each is a human seat or AI, with a fixed jet, a random jet (from any or one country), "same as slot 1", or the pilot's own choice; a loadout; and the AI skill.
- **AI pilots (⚙ on each slot):**
  - **Personality** preset: balanced, aggressive, reckless, cautious, scared, BVR sniper, dogfighter, loyal wingman or lone wolf.
  - **Sliders (0-100):** reflexes, awareness, gunnery, flying, tactics, aggression, courage and teamwork. Experience sets the abilities; personality sets the temperament; every slider can be fine-tuned.
  - **Orders:** hunt; patrol (orbit the start point, commit inside a range); escort slot 1; ambush (wait low with the radar off, invisible to warning receivers); or target drone.
  - **Rules:** weapons (all, IR and guns, guns only, hold), target priority (nearest, biggest threat, humans first, damaged first) and preferred range.
- **Sharing:** scenarios are saved in your browser. **Copy link** gives a URL that opens the scenario for anyone; **Copy code** gives a code to paste into the builder.

## Controls

| Key | Action |
| --- | --- |
| W / S (or ↑ / ↓) | Pitch. S pulls the nose up by default; you can invert it in the menu |
| A / D (or ← / →) | Roll |
| Q / E | Rudder, for fine nose aim |
| Shift (hold) | Precision aiming, with reduced control rates |
| R / F | Throttle. Above 100% is afterburner |
| B (hold) | Airbrake |
| Space | Cannon |
| 1 · 2 | Select IR missile · radar missile |
| N | Next target (next jet when spectating) |
| Tab or L | Radar lock (single-target track) on / off |
| X | Fire selected missile |
| C · Z | Flares · Chaff |
| T | Padlock view. On jets with a helmet sight, it also cues the IR missile seeker far off the nose |
| G (hold) | Look back |
| V | Chase / cockpit view |
| Esc · H | Pause · help |

## How it works

- **Flight model** (`public/js/flight.js`): a G-command fly-by-wire law with an AoA limiter (10 G / ‑3 G, corner speed about 320 kts at 3,000 m). Lift, induced drag, transonic wave drag, thrust lapse with altitude, and gravity are all physical, so energy management matters. Roll rate falls off at low speed and high AoA. Sustained G fills a pilot G-tolerance meter that leads to blackout.
- **Weapons and sensors** (`public/js/arsenal.js`, `sensors.js`, `weapons.js`). Values are scaled from public figures to fit a 60 km arena.
  - **Guns:** M61A1, GSh-30-1, GSh-23, BK-27 and 30M791, each with its own rate of fire, spin-up, muzzle velocity, dispersion, drag and hit damage. The lead pipper solves the intercept including drag.
  - **IR missiles** (AIM-9M/9X, R-73/R-74M, PL-10, IRIS-T, MICA IR): proportional navigation with real motor burn and drag. Off-boresight lock needs a helmet sight, a radar lock or an IRST cue. Each has its own flare rejection.
  - **Active radar missiles** (AIM-120C/D, R-77/R-77-1/R-77M, PL-12, PL-15, MICA EM, Meteor): boost-sustain motors, loft, datalink while the shooter holds a lock, and an active seeker near the target. The Meteor's ramjet thrust depends on air density and speed.
  - **Semi-active R-27ER:** needs the shooter's radar lock all the way to impact.
  - **Radar:** each jet has its own radar range, gimbal, lock time, ECCM, LPI and notch width. Detection range scales with the target's RCS to the fourth-root power, so stealth jets are seen far later. Enemy jamming shortens it further.
  - **IRST:** passive heat detection, aspect- and afterburner-dependent, giving bearing only. It can cue IR missiles without setting off the target's RWR.
  - **Terrain masking:** radar, IRST, seekers, eyes, RWR and MAWS all need a clear line of sight over the terrain.
  - **RWR:** shows search and lock from the opponent's radar, datalink launch, and active missiles. LPI radars are heard at shorter range.
  - **MAWS:** fitted to some jets only. It detects burning rocket motors within about 5 km.
  - **Countermeasures:** flares seduce IR seekers; chaff works against radar mainly when the target is beaming.
  - **HUD:** the dynamic launch zone (Rmax, no-escape, Rmin) comes from a fly-out of the selected missile.
- **Deaths** (`public/js/wreck.js`): a missile hit tears the jet into tumbling pieces (wings, tail, nose, fuselage, fragments) with fire and smoke. A gun kill leaves a burning jet spiralling in, which may blow apart. The pilot usually ejects: the canopy goes, the seat fires, then the chute opens. Wreckage hits the ground in a fireball and leaves a smoke column, or splashes into the sea. The breakup is seeded, so both online players see the same one. The death camera follows the wreck, then the parachute. Practice adds a moment of slow motion.
- **Terrain and sky** (`public/js/world.js`): procedural height maps per map, textured by height, slope and noise (grass, forest, rock, sand, snow). Water is a shader with moving normal maps, sky reflection, sun glint, turquoise shallows, surf and whitecaps. Sun, sky, fog and clouds follow the time of day and weather.
- **Loadouts:** each player picks a jet and one of its loadouts (a scenario can fix them). Stores add weight and drag, but weapons in internal bays don't.
- **Situational awareness:** every jet builds a contact picture from its radar, IRST and eyes, and shares radar/IRST tracks with its side over datalink. The RWR hears every enemy radar at once. The HUD shows all known contacts; the target is the one nearest your nose, and `N` cycles.
- **Netcode** (`server.js`, `public/js/main.js`): rooms of up to 8. Each player's client simulates their own jet and sends its state 30 times a second; the host simulates every AI jet and sends them in one batch 20 times a second. Remote jets are extrapolated forward by measured latency, with smooth error correction. Hits are detected by the shooter ("favor the shooter") and sent to whoever controls the jet hit. The host is authoritative for the roster, score and round flow.
- **AI** (`public/js/ai.js`): flies the same flight model through the same control inputs a human uses. Its stats map to reaction delay, threat-notice delay, rear awareness, aim, pull and low-level confidence, energy management, shot ranges, missile support (cranking), dragging away from long shots, counter-shots, countermeasure timing and target sorting. A morale model builds fear from hits, missiles, locks, being outnumbered and losing wingmen (scaled by courage); past breaking point the pilot runs for home, low through the terrain if it's tactically trained, and may rejoin once things calm down. Out of weapons, it heads home. Skill changes reaction time, aim and how hard it pulls. It only knows what its radar, IRST, RWR, missile warning, eyes and its side's datalink tell it, picks targets by range and angle, keeps clear of its wingmen and won't shoot through them. It takes AMRAAM shots inside its launch zone and supports them with a lock, notches and chaffs radar missiles, beams and flares IR missiles, avoids terrain and manages overshoots.
