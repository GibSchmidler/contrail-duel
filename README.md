# Contrail Duel

Browser-based 3D **1v1 jet dogfights**, played entirely on the keyboard. It has an M61 cannon, AIM-9M/9X Sidewinders and AIM-120 AMRAAMs, fire-control radar, a radar warning receiver, missile approach warning, flares and chaff. The flight model is semi-realistic fly-by-wire, with online matchmaking and a practice AI.

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

Then use **Quick match** (pairs the next two people searching), or **Create private room** and give your friend the 4-letter code.

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
| 1 · 2 | Select Sidewinder (IR) · AMRAAM (radar) |
| Tab or L | Radar lock (single-target track) on / off |
| X | Fire selected missile |
| C · Z | Flares · Chaff |
| T | Padlock / helmet cue, which keeps the bandit in view and lets the AIM-9X lock far off the nose |
| G (hold) | Look back |
| V | Chase / cockpit view |
| Esc · H | Pause · help |

## How it works

- **Flight model** (`public/js/flight.js`): a G-command fly-by-wire law with an AoA limiter (10 G / ‑3 G, corner speed about 320 kts at 3,000 m). Lift, induced drag, transonic wave drag, thrust lapse with altitude, and gravity are all physical, so energy management matters. Roll rate falls off at low speed and high AoA. Sustained G fills a pilot G-tolerance meter that leads to blackout.
- **Weapons and sensors** (`public/js/arsenal.js`, `sensors.js`, `weapons.js`). Values are scaled from public figures to fit a 60 km arena.
  - **Gun:** M61A1, 511 rounds at 100/s, with barrel spin-up, about 8 mil dispersion and bullet drag. The lead pipper solves the intercept including drag.
  - **AIM-9M / AIM-9X:** infrared, using proportional navigation with real motor burn, drag and induced drag. The 9X adds high off-boresight lock (helmet cue or radar slave), thrust vectoring and much better flare rejection.
  - **AIM-120C:** boost-sustain motor, lofts on long shots, datalink updates while the shooter holds a radar lock (inertial otherwise), and its own active seeker at about 9 km.
  - **Radar:** ±60°, about 40 km detection, with a pulse-Doppler clutter notch (a beaming target below you disappears) and memory on lost tracks.
  - **RWR:** shows search and lock from the opponent's radar, datalink launch, and active missiles.
  - **MAWS:** detects only burning rocket motors within about 5 km.
  - **Countermeasures:** flares seduce IR seekers; chaff works against radar mainly when the target is beaming.
  - **HUD:** the dynamic launch zone (Rmax, no-escape, Rmin) comes from a fly-out of the selected missile.
- **Loadouts and start:** each player picks a loadout, and stores add weight and drag. The host picks a BVR start (36 km) or a merge start (7 km).
- **Netcode:** each client simulates its own jet and sends its state 30 times a second. The remote jet is extrapolated forward by measured latency, with smooth error correction. Hits are detected by the shooter ("favor the shooter"). The room host is authoritative for score and round flow.
- **AI** (`public/js/ai.js`): flies the same flight model through the same control inputs a human uses. Skill changes reaction time, aim and how hard it pulls. It only knows what its radar, RWR, missile warning and eyes tell it. It takes AMRAAM shots inside its launch zone and supports them with a lock, notches and chaffs radar missiles, beams and flares IR missiles, avoids terrain and manages overshoots.
