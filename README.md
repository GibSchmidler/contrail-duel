# Contrail Duel

Browser-based 3D **modern air combat**, from 1v1 duels to 8v8 battles, played entirely on the keyboard. There are **13 fighters from four nations**: the USA, Russia, China and Europe. Each has its own flight performance, radar, IRST, stealth, jamming, gun and missiles. The flight model is semi-realistic fly-by-wire, terrain blocks sensors, and shot-down jets break up with the pilot ejecting. It has four maps with time of day and weather, a mission builder, online rooms for up to 8 players, and AI that fills any empty seat.

There's more than air-to-air. You can strike ground targets with bombs, rockets, Mavericks and HARMs against each nation's SAM and AAA sites. You can land on carriers to rearm. The game also has survival waves, time trials, nine training lessons, replays with a kill cam and an after-action map, and a pilot profile with medals and your own nose art.

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

## Modes and missions

- **Battle:** the classic fight. Win rounds by being the last side flying, by completing objectives, or by reaching a score limit (points for air kills, ground kills, objectives, and a penalty for being shot down). Respawns are optional.
- **Strike missions:** *Iron Hand* (SEAD against a Russian SAM network, with Flankers scrambling when you cross the coast) and *Convoy hunt* (stop two moving convoys before they reach the rally point).
- **Survival:** *Defend the carrier*. Endless, growing waves of fighters and anti-ship strikers attack your carrier group. Land on the deck to rearm and repair, and relaunch from the catapult.
- **Time trials:** *Canyon run* (28 gates down the desert canyons under a 250 m ceiling) and *Mountain slalom* (two laps round the island peaks). Your best times are saved.
- **Training:** nine guided lessons with step-by-step prompts: flight basics, gunnery, air-to-air missiles (including a helmet-cued off-boresight shot), missile defence against a live SAM, bombing, SEAD, carrier landing, and two air-to-air missile defence lessons. In those, a scripted aggressor fires on cue: R-77s from long and short range (drag, notch, chaff in the notch, cutting the datalink, a salvo), then R-73s from behind and head-on (afterburner, flares, the break turn).
- **Missile defence coach:** when a missile is guiding on you, a HUD box names it and shows its range, time to impact, clock position and your aspect. It says which radar you have to beat (the launcher's before pitbull, the missile's own after), shows live notch status (your closing speed against the limit, and whether you're below it), and gives the best defence for the moment. BEAM markers on the heading tape show where to turn. It's on by default (toggle it in the main menu) and always on in training.

Missions open with a **briefing** (text, objectives and a map of the known threats). It's also on the pause menu. After a match, the **debrief** shows everyone's kills, **assists**, ground kills, **damage** and deaths, your accuracy, your **career totals**, any medals earned, and an **after-action map**: every track, missile shot and kill, which you can scrub or play back. **Watch 3D replay** plays the whole match, every round, from any jet's view, riding along with any missile, or from a free camera. **Kill cam** replays each kill from behind the shooter, and **Missile cam** rides the missile that scored it from launch to impact, looking at its target.

## Campaign: Fault Lines

**Campaign: Fault Lines** on the main menu is an eight-mission single-player story of a near-future war, flown with Lance Squadron, a NATO composite squadron. A Russian move in the Arctic opens the war; it spreads to a Russian expeditionary base in the desert, a Chinese grab for a Pacific island chain, and the mountains of NATO's eastern flank, before ending where it began. Each mission opens with the story, then the usual briefing and map.

- **Wingmen with names.** Cutter, Ruby and Moss fly with you, each with their own personality. A wingman who is shot down is gone for the rest of the campaign (wounded if they ejected, killed if not), and a replacement pilot takes the seat. The story and briefings name whoever is actually flying.
- **New aircraft as you go:** you start in the F-16C and earn the F/A-18E, the F-15C and the F-22A.
- **Two decisions** change the missions that follow and the ending: whether to cover the carrier or raid the J-16 airfield first, and whether to cover a downed pilot's rescue or press on to the final target.
- **Grades** from S to C for each mission: optional objectives, damage taken, your kills and time all add up; losing wingmen costs points. Fly a finished mission again from the list to improve its grade; replays never change your squadron.
- If you are shot down the mission fails, and you retry it. Progress is saved in your browser.

## Scenarios

Pick a built-in mission on the main menu (duels, 2v2, 4v4 furball, Raptors vs Flankers, night intercept, canyon knife fight, 4-player co-op against 8 AI, 8v8 team battle, the strike, survival and time-trial missions, and the training lessons) or open the **Scenario builder**. The **Setup & aircraft** tab holds the basics:

- **Environment:** map (Islands, Alpine, Desert Canyons, Arctic Fjords), time of day (dawn, day, dusk, moonlit night) and weather (clear to overcast, or haze). Night and haze shorten visual range; overcast puts a cloud deck overhead.
- **Rules:** rounds to win and an optional round time limit (the side with more jets left wins when time runs out).
- **Sides:** up to 8 aircraft each. Drag each side's start point and heading on the map; set altitude, speed, formation and spacing.
- **Slots:** each is a human seat or AI, with a fixed jet, a random jet (from any or one country), "same as slot 1", or the pilot's own choice; a loadout; and the AI skill.
- **AI pilots (⚙ on each slot):**
  - **Personality** preset: balanced, aggressive, reckless, cautious, scared, BVR sniper, dogfighter, loyal wingman or lone wolf.
  - **Sliders (0-100):** reflexes, awareness, gunnery, flying, tactics, aggression, courage and teamwork. Experience sets the abilities; personality sets the temperament; every slider can be fine-tuned.
  - **Orders:** hunt; patrol (orbit the start point, commit inside a range); escort slot 1; ambush (wait low with the radar off, invisible to warning receivers); fly a route (draw the waypoints on the map); strike ground targets; or target drone.
  - **Rules:** weapons (all, IR and guns, guns only, hold), target priority (nearest, biggest threat, humans first, damaged first) and preferred range.

The other tabs build missions. Everything with a position can be placed and dragged on the map, and right-clicked to delete:

- **Mode & scoring:** battle, survival, time trial or training. Set the win condition, the score limit, the points per air kill, ground kill, objective and death, and respawns. For survival, set the wave size and growth, the enemy nation, the share of anti-ship strikers, and the unit to defend.
- **Ground & ships:** up to 40 units. These are each nation's SAM batteries (Patriot, NASAMS, S-300, Buk, HQ-9, HQ-16, SAMP/T, IRIS-T SLM), short-range SAMs, MANPADS teams, AAA guns, carriers and warships, plus trucks, convoys, tanks, APCs, bunkers, fuel depots, command posts and early-warning radars. Units can be radar-silent until cued, and vehicles and ships can drive a route.
- **Waves:** reinforcement flights that arrive after a time or when a trigger sends them in.
- **Objectives:** destroy or protect ground units, shoot down every enemy aircraft, reach a kill count, fly into a zone, or hold out for a time. Each one can be optional and has its own points.
- **Triggers:** when something happens (a time, an aircraft entering a zone, a unit or wave destroyed, an objective done, a kill count), send in a wave, play a radio message, complete or fail an objective, end the mission, or wake up silent SAM radars.
- **Markers:** labelled waypoints, targets, danger areas and home base, shown as beams in the world and on the HUD.
- **Gates:** time-trial gates, laps and an altitude ceiling.
- **Briefing:** the text shown before the mission.
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
| 3 | Select air-to-ground weapons; press again to cycle (bombs, guided bombs, rockets, Maverick, HARM, anti-ship) |
| X (with A/G) | Release / fire. Hold for rocket ripples. N cycles ground targets |
| J · K | Landing gear · flaps (up / half / full) |
| Y | Approach auto-throttle (gear down; any throttle input turns it off) |
| [ · ] · \ | Trim nose down · up · reset |
| B | Speedbrake on / off |
| M, then 1-7 | Radio your wingmen: attack my target, cover me, rejoin, attack ground targets, return to base (rearm on the carrier), hold fire, weapons free |
| G (hold) | Look back |
| Mouse drag | Free look; let go to snap back |
| U (hold) | Look at your nearest wingman (tap again within 2 s for the next) |
| , · . · / (hold) | Snap view left · right · up (also numpad 4 · 6 · 8) |
| V | Chase / cockpit view |
| O | Tactical map range: 10 · 20 · 40 · 80 km · off |
| P | Free camera when spectating or watching a replay (WASD, R/F up/down, drag the mouse to look, wheel for speed) |
| Esc · H | Pause · help |

The **tactical map** (bottom right, like an F-16's HSD or a Hornet's SA page) is heading-up with your jet in the middle. It only shows what your jet knows: your own radar, IRST and visual tracks (green squares, amber circles, white), datalink tracks from wingmen and AWACS (amber triangles), wingmen (cyan), your missiles in flight, incoming missiles the warner sees (M), radar warnings as bearing ticks on the rim (an RWR gives direction, not range), threat rings for SAM and AAA sites you know about (solid red while their radar is up, dashed when silent), mission waypoints and targets (pinned to the rim when off the map), your radar's coverage, and the terrain and coastlines underneath, turned to match your heading. A stealthy jet your radar can't see won't be on it.

When a missile is coming at you, the map **zooms in automatically** (the range reads AUTO) and shows where it is coming from, as far as your jet can know. A **launch warning** on the RWR, from a jet holding a lock on you, gives a red line toward the shooter and a hollow **?** circle: where a typical medium-range missile fired from there would be by now. It's only an estimate, since the jet doesn't know which missile it is. An **active seeker** on the RWR gives a bearing with no range (**M** on the rim). A **missile warner** (MAWS, which sees burning motors within about 5.5 km) gives its real position and track as a red arrowhead, carried forward for a few seconds after the motor burns out. Dashed **BEAM** lines show the two headings at 90° to the most urgent missile. Turn until one points straight up (your nose) and the map says **ON BEAM**, the start of a notch.

**On a phone or tablet** (hold it sideways) the game switches to touch controls. Your left thumb is a floating stick anywhere on the left half (pull down for nose up, sideways to roll). On the right are a throttle lever (top band = afterburner) and buttons for FIRE, GUN, WPN (cycle IR / radar missile / air-to-ground), LOCK, TGT, flares and chaff. Drag empty screen on the right to look around. Small buttons top left: pause, view, map range, wingman radio (a tappable list), gear, flaps, speedbrake and look-back. When you're shot down you get NEXT JET and FREE CAM, and the stick flies the free camera. On Android it goes full screen on the first touch. On iPhone, *Add to Home Screen* hides the browser bars.

In a replay: Space pauses, Q / E skip 10 s, R / F change speed, N follows the next jet, M follows a missile (the next one in flight, or skips ahead to the next launch), Esc returns to the debrief.

## Pilot profile

**Pilot profile, medals & nose art** on the main menu shows your callsign and career: sorties, wins, air and ground kills, assists, damage dealt (and your best match), kill/death ratio, missile, bomb and gun accuracy, carrier traps, best survival wave, best time-trial times, flight time and training progress. There are 22 medals and achievements, from *First blood* and *Ace in a day* to *Iron Hand*, *OK 3-wire*, *Untouchable* and *Graduate*. They pop up in the kill feed when you earn them. Pick a **nose art** design (shark mouth, flames, lightning bolt, checkerboard, star, skull, ace of spades, tiger stripes, kill marks), a colour and a name. It's painted on both sides of your jet's nose, and other pilots see it online. Everything is saved in your browser. Damage is counted in hit points (a fighter has 100), only against the enemy, and only what the target actually had left. You get an assist when you did at least 10 damage to an enemy jet in the minute before someone else on your side brought it down.

## How it works

- **Flight model** (`public/js/flight.js`): a G-command fly-by-wire law with an AoA limiter (10 G / ‑3 G, corner speed about 320 kts at 3,000 m). Lift, induced drag, transonic wave drag, thrust lapse with altitude, and gravity are all physical, so energy management matters. Roll rate falls off at low speed and high AoA. Sustained G fills a pilot G-tolerance meter that leads to blackout.
- **Weapons and sensors** (`public/js/arsenal.js`, `sensors.js`, `weapons.js`). Values are scaled from public figures to fit a 60 km arena.
  - **Guns:** M61A1, GSh-30-1, GSh-23, BK-27 and 30M791, each with its own rate of fire, spin-up, muzzle velocity, dispersion, drag and hit damage. The lead pipper solves the intercept including drag.
  - **IR missiles** (AIM-9M/9X, R-73/R-74M, PL-10, IRIS-T, MICA IR): proportional navigation with real motor burn and drag. Off-boresight lock needs a helmet sight, a radar lock or an IRST cue. Each has its own flare rejection.
  - **Active radar missiles** (AIM-120C/D, R-77/R-77-1/R-77M, PL-12, PL-15, MICA EM, Meteor): boost-sustain motors, loft, datalink while the shooter holds a lock, and an active seeker near the target. The Meteor's ramjet thrust depends on air density and speed.
  - **Semi-active R-27ER:** needs the shooter's radar lock all the way to impact.
  - **Radar:** each jet has its own radar range, gimbal, lock time, ECCM, LPI and notch width. Detection range scales with the target's RCS to the fourth-root power, so stealth jets are seen far later. Enemy jamming shortens it further. RCS depends on aspect: stealth jets are tiny nose-on and much bigger side-on or from the tail (an F-22 is seen about 5 km nose-on by an Su-35, but about 9.5 km side-on). Opening the weapon bays to fire raises it for 1.6 s. Low-band early-warning radars see stealth jets much farther but can't guide missiles.
  - **Eyes:** visual spotting range depends on the target's size and the angle you see it from (bigger in planform during a turn), and is longer when it's in afterburner. There's a blind spot behind and below. Haze and night shorten it.
  - **IRST:** passive heat detection, aspect- and afterburner-dependent, giving bearing only. It can cue IR missiles without setting off the target's RWR.
  - **Terrain masking:** radar, IRST, seekers, eyes, RWR and MAWS all need a clear line of sight over the terrain.
  - **Flying low:** every sensor also needs to be above the other's horizon (4.12 km × (√h1 + √h2), heights in metres). A SAM mast at about 12–23 m loses a jet at 15 m beyond about 30–36 km. Ground radars lose low jets gradually in the ground return: full range from 2.5× their low-altitude floor (40 m for big SAMs, 12 m for short-range SAMs, 8 m for ships), down to 15% near the floor, and always within 3 km. A fighter's look-down penalty is full against a jet under 300 m above the ground and eases to 40% of that as the target climbs. The Doppler notch works whenever there's ground behind you: below the radar, or under 250 m where the beam grazes the ground. **Multipath:** radar-guided missiles coming in at a shallow angle at a jet under 70 m over land or 120 m over water see its reflection too, wander in elevation, and can hit the surface. In tests over open sea, hits fell from 8 of 8 at 100 m to about 3 of 8 at 15–40 m.
  - **RWR:** shows search and lock from the opponent's radar, datalink launch, and active missiles. LPI radars are heard at shorter range.
  - **MAWS:** fitted to some jets only. It detects burning rocket motors within about 5 km.
  - **Countermeasures:** flares seduce IR seekers; chaff works against radar mainly when the target is beaming.
  - **HUD:** the dynamic launch zone (Rmax, no-escape, Rmin) comes from a fly-out of the selected missile.
- **Ground war** (`public/js/ground.js`, `strike.js`): ground units carry real-world-style radars, missiles and guns, so the RWR, missiles, bullets and datalink treat them like aircraft. SAM sites have their own search radar, track time, minimum altitude, salvo size and reload. An early-warning radar can cue radar-silent batteries, and crews may shut their radar off when a HARM is coming. Bombs fall ballistically; the HUD **CCIP** pipper solves the impact point from the release kinematics. Laser/GPS bombs glide to their target. Mavericks lock a target. HARMs home on emitting radars and keep flying to the last known spot if the radar goes quiet. Damage spreads from the blast, with armour and hardened targets.
- **Damage zones** (`public/js/flight.js`): hits land on the engine, left or right wing, tail, cockpit or fuel tanks. A damaged engine loses thrust or catches fire, a damaged wing rolls and loses lift, a shot-up tail weakens pitch and yaw, and a holed tank leaks fuel. The HUD shows a damage diagram.
- **Carrier ops** (`public/js/carrier.js`): fly onto the back of a friendly carrier's deck with the gear down, wings level and below about 200 kt. Normal touchdowns sink at 3 to 4 m/s. Up to 8 m/s is fine; between 8 and 11 m/s is a hard landing that still traps but damages the jet and costs you the grade; harder than that collapses the gear. The hook catches one of four wires, or you bolter and go around. The crew taxis you to the catapult, then rearms, refuels and repairs the jet; full power launches you. The AI flies the same pattern and glideslope.
  - *Landing aids*, modelled on the real ones. With the gear and flaps down the fly-by-wire switches to a powered-approach mode: full stick asks for only about ±1 G around your flight path and roll is slower, so corrections stay small. The HUD shows an AOA indexer (green chevron = slow, amber donut = on speed at about 125 kt, red chevron = fast), ICLS needles for glideslope (3.5°) and lineup, and inside 1.9 km the ball against the green datum lights.
  - *Auto-throttle* (Y, or automatic on touch screens once the gear is down) holds on-speed angle of attack, like the real approach power compensator, so you only fly the glideslope with the stick.
  - *The LSO* talks you down from 1.6 km ("Roger ball", "Power", "You're high", "Come left", "Wave off!") and grades every trap OK, FAIR or NO GRADE with the faults on the pass; the 3-wire is the target.
- **Missions** (`public/js/mission.js`): objectives, triggers, waves, survival and race timing run on the host and are mirrored to every player.
- **Recorder** (`public/js/recorder.js`): samples every jet, missile and ground unit 5 times a second, plus each kill. It drives the 3D replay, the kill cam and the after-action map.
- **Deaths** (`public/js/wreck.js`): a missile hit tears the jet into tumbling pieces (wings, tail, nose, fuselage, fragments) with fire and smoke. A gun kill leaves a burning jet spiralling in, which may blow apart. The pilot usually ejects: the canopy goes, the seat fires, then the chute opens. Wreckage hits the ground in a fireball and leaves a smoke column, or splashes into the sea. The breakup is seeded, so both online players see the same one. The death camera follows the wreck, then the **kill cam** looks at it from behind whoever shot you down, then the parachute. Practice adds a moment of slow motion.
- **Terrain and sky** (`public/js/world.js`): procedural height maps per map, textured by height, slope and noise (grass, forest, rock, sand, snow). Water is a shader with moving normal maps, sky reflection, sun glint, turquoise shallows, surf and whitecaps. Sun, sky, fog and clouds follow the time of day and weather.
- **Loadouts:** each player picks a jet and one of its loadouts (a scenario can fix them). Stores add weight and drag, but weapons in internal bays don't.
- **Situational awareness:** every jet builds a contact picture from its radar, IRST and eyes, and shares radar/IRST tracks with its side over datalink. The RWR hears every enemy radar at once. The HUD shows all known contacts; the target is the one nearest your nose, and `N` cycles.
- **Netcode** (`server.js`, `public/js/main.js`): rooms of up to 8. Each player's client simulates their own jet and sends its state 30 times a second; the host simulates every AI jet and sends them in one batch 20 times a second. Remote jets are extrapolated forward by measured latency, with smooth error correction. Hits are detected by the shooter ("favor the shooter") and sent to whoever controls the jet hit. The host is authoritative for the roster, score and round flow.
- **AI** (`public/js/ai.js`): flies the same flight model through the same control inputs a human uses. Its stats map to reaction delay, threat-notice delay, rear awareness, aim, pull and low-level confidence, energy management, shot ranges, missile support (cranking), dragging away from long shots, counter-shots, countermeasure timing and target sorting. A morale model builds fear from hits, missiles, locks, being outnumbered and losing wingmen (scaled by courage); past breaking point the pilot runs for home, low through the terrain if it's tactically trained, and may rejoin once things calm down. Out of weapons, it heads home. Skill changes reaction time, aim and how hard it pulls. It only knows what its radar, IRST, RWR, missile warning, eyes and its side's datalink tell it, picks targets by range and angle, keeps clear of its wingmen and won't shoot through them. It takes AMRAAM shots inside its launch zone and supports them with a lock, notches and chaffs radar missiles, beams and flares IR missiles, avoids terrain and manages overshoots.
