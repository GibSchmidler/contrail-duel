# Contrail Duel

Browser-based 3D **1v1 jet dogfights**, played entirely on the keyboard. It has guns, IR heat-seeking missiles and flares, a semi-realistic fly-by-wire flight model, online matchmaking, and a practice AI.

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
| X | Fire IR missile (needs a lock) |
| C | Flares |
| T | Padlock camera, which keeps the bandit in view |
| G (hold) | Look back |
| V | Chase / cockpit view |
| Esc · H | Pause · help |

## How it works

- **Flight model** (`public/js/flight.js`): a G-command fly-by-wire law with an AoA limiter (10 G / ‑3 G, corner speed about 320 kts at 3,000 m). Lift, induced drag, transonic wave drag, thrust lapse with altitude, and gravity are all physical, so energy management matters. Roll rate falls off at low speed and high AoA. Sustained G fills a pilot G-tolerance meter that leads to blackout.
- **Guns:** 20 mm cannon firing 100 rounds/s, 510 rounds per round. The HUD's lead-computing pipper solves the real ballistic intercept, so if you put the gun cross on the pipper, you hit.
- **Missiles:** 4 IR missiles using proportional navigation, a 3 s motor burn, drag, a G-limit and a seeker gimbal limit. Lock range depends on target aspect and afterburner. Each flare pop gets one chance to seduce the seeker. Beaming, flares, cutting the afterburner, and making the missile bleed energy all defeat it.
- **Netcode:** each client simulates its own jet and sends its state 30 times a second. The remote jet is extrapolated forward by measured latency, with smooth error correction. Hits are detected by the shooter ("favor the shooter"). The room host is authoritative for score and round flow.
- **AI** (`public/js/ai.js`): flies the same flight model through the same control inputs a human uses. Skill changes reaction time, aim and how hard it pulls. It defends against missiles (beam + flares), avoids terrain and manages overshoots.
