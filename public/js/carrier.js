// Carrier operations: deck landing (arrestor wire trap or bolter), rearming and repairs on deck,
// and catapult / ski-jump launches. A jet on deck isn't flown by the flight model; it rides the
// deck in deck coordinates (along: + toward the bow, across: + to starboard).
import * as THREE from 'three';
import { groundHeight } from './world.js';
import { repair } from './flight.js';

export const REARM_TIME = 12;            // s on deck to refuel, rearm and patch up the jet
const GEAR_H = 2.4;                      // height of the jet's reference point above the deck
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3();

// Solid surface for crash checks: terrain, plus ship decks and superstructures.
export function surfaceFn(units) {
  const ships = units.filter((u) => u.D.ship);
  if (!ships.length) return groundHeight;
  const tmp = {};
  return (x, z) => {
    let h = groundHeight(x, z);
    for (const u of ships) {
      if (Math.abs(x - u.pos.x) > u.r + 5 || Math.abs(z - u.pos.z) > u.r + 5) continue;
      _p.set(x, 0, z);
      const dx = x - u.pos.x, dz = z - u.pos.z, c = Math.cos(u.hdgR), s = Math.sin(u.hdgR);
      tmp.along = dx * s - dz * c; tmp.across = dx * c + dz * s;
      const L = u.D.len, W = u.D.wid;
      if (Math.abs(tmp.along) > L / 2 || Math.abs(tmp.across) > W / 2) continue;
      const sink = u.alive ? 0 : 6;
      let top;
      if (u.D.deck) {
        top = u.base + u.D.deck.y - sink;
        // the island on the starboard side
        if (tmp.across > W * 0.3 && Math.abs(tmp.along - L * 0.05) < 16) top = u.base + u.D.deck.y + 34;
      } else top = u.base + (Math.abs(tmp.along) < L * 0.2 ? 22 : 12) - sink;
      if (top > h) h = top;
    }
    return h;
  };
}

// Which friendly carrier deck (if any) is under this jet.
export function deckUnder(pl, units) {
  for (const u of units) if (u.D.deck && u.alive && u.side === pl.side && u.onDeck(pl.pos)) return u;
  return null;
}

// The jet just touched a deck: is it a landing or a crash?
export function tryLand(pl, u) {
  if (!u || u.side !== pl.side) return { ok: false, why: 'crash' };
  const D = u.D.deck;
  const q = u.toDeck(pl.pos);
  const fwdAlong = pl.fwd.x * Math.sin(u.hdgR) - pl.fwd.z * Math.cos(u.hdgR);
  const bank = Math.asin(Math.max(-1, Math.min(1, pl.right.y)));
  if (!pl.gear) return { ok: false, why: 'Belly landing — the gear was up (J)' };
  // naval gear is built for about 7-8 m/s; harder than that it survives but gets bent, and past ~11 m/s it collapses
  const sink = -pl.vel.y;
  if (sink > 11) return { ok: false, why: `Hit the deck too hard (${sink.toFixed(1)} m/s sink): the gear collapsed` };
  if (Math.abs(bank) > 0.35) return { ok: false, why: 'Wing struck the deck' };
  if (fwdAlong < 0.9) return { ok: false, why: 'Not lined up with the deck' };
  if (pl.speed > 105) return { ok: false, why: 'Far too fast to land' };
  // wires sit across the aft part of the deck
  const wire = q.along > -D.len / 2 + 15 && q.along < -D.len / 2 + 95;
  return { ok: true, trap: wire, along: q.along, across: q.across, hard: sink > 8 ? sink : 0 };
}

export function land(pl, u, res) {
  pl.landed = { u, phase: res.trap ? 'trap' : 'roll', along: res.along, across: res.across, speed: Math.max(20, pl.speed), t: 0, v0: Math.max(20, pl.speed) };
  pl.vel.set(0, 0, 0);
  pl.gloc = 0; pl.blackedOut = false;
}

// Called every physics step for a jet on deck. inp: the pilot's controls (throttle matters).
// Returns an event string: 'stopped' | 'rearmed' | 'launch' | 'bolter' | 'overboard' | null.
export function deckStep(pl, dt, inp, auto) {
  const L = pl.landed, u = L.u, D = u.D.deck;
  L.t += dt;
  let ev = null;
  const thr = inp ? inp.throttle : 0;
  if (!u.alive) { pl.landed = null; return 'overboard'; }
  switch (L.phase) {
    case 'trap': {
      const decel = (L.v0 * L.v0) / (2 * 85);   // the wire stops the jet in ~85 m
      L.speed = Math.max(0, L.speed - decel * dt);
      if (L.speed <= 0.5) { L.phase = 'stop'; L.t = 0; ev = 'stopped'; }
      break;
    }
    case 'roll': {
      // missed the wires: full power to go around (bolter), or brake and hope
      const push = thr > 0.95 ? (pl.F.thrMil * Math.min(thr, 1) + Math.max(0, thr - 1) * 5 * (pl.F.thrAB - pl.F.thrMil)) / pl.mass : 0;
      L.speed = Math.max(0, L.speed + (push - 4 - (pl.airbrake ? 3 : 0)) * dt);
      if (L.speed < 1) { L.phase = 'stop'; L.t = 0; ev = 'stopped'; }
      break;
    }
    case 'stop':
      L.speed = 0;
      if (L.t > 1.2) {
        // taxi to the catapult while the crew works
        L.phase = 'rearm'; L.t = 0; L.along = D.len / 2 - 105; L.across = -D.wid * 0.12;
      }
      break;
    case 'rearm':
      L.speed = 0;
      if (L.t > REARM_TIME) {
        repair(pl);
        pl.setLoadout(pl.loadout);
        pl.gunAmmo = pl.T.ammo; pl.flares = pl.T.flares; pl.chaff = pl.T.chaff; pl.podN = {};
        L.phase = 'ready'; L.t = 0; ev = 'rearmed';
      }
      break;
    case 'ready':
      L.speed = 0;
      L.hold = thr >= 0.99 || auto ? (L.hold || 0) + dt : 0;
      if (L.hold > (auto ? 2.5 : 0.8)) { L.phase = 'cat'; L.t = 0; L.speed = 0; }
      break;
    case 'cat':
      L.speed += (D.ramp ? 20 : 34) * dt + Math.max(0, thr - 0.9) * 8 * dt;
      break;
  }
  L.along += L.speed * dt;
  // pose on the deck
  const hdg = u.hdgR;
  const pitch = L.phase === 'cat' && D.ramp && L.along > D.len / 2 - 40 ? 0.2 : 0.06;
  _e.set(pitch, -hdg, 0, 'YXZ'); _q.setFromEuler(_e);
  pl.quat.copy(_q); pl.updateAxes();
  u.fromDeck(L.along, L.across, pl.pos, GEAR_H + (D.ramp && L.along > D.len / 2 - 40 ? (L.along - (D.len / 2 - 40)) * 0.2 : 0));
  pl.prevPos.copy(pl.pos);
  pl.vel.copy(pl.fwd).multiplyScalar(L.speed);
  pl.speed = L.speed; pl.alpha = 0; pl.g = 1; pl.omega.set(0, 0, 0);
  pl.gear = true;
  if (L.along > D.len / 2) {
    // off the bow: airborne again (or in the water if too slow)
    const fast = L.speed > 60;
    pl.landed = null;
    pl.vel.copy(pl.fwd).multiplyScalar(L.speed).addScaledVector(pl.up, fast ? 3 : 0);
    if (L.phase === 'cat') { pl.throttle = Math.max(pl.throttle, 1); pl.eng = Math.max(pl.eng, 1); }
    return L.phase === 'cat' ? 'launch' : fast ? 'bolter' : 'overboard';
  }
  return ev;
}

// Status line for the HUD while on deck.
export function deckStatus(pl) {
  const L = pl.landed;
  if (!L) return null;
  switch (L.phase) {
    case 'trap': return 'TRAP! Caught the wire';
    case 'roll': return 'BOLTER — full power (R) to go around!';
    case 'stop': return 'On deck — taxiing to the catapult';
    case 'rearm': return `REARMING & REPAIRING ${Math.ceil(REARM_TIME - L.t)} s`;
    case 'ready': return 'READY — throttle to full military power or more (R) to launch';
    case 'cat': return 'CATAPULT LAUNCH';
  }
  return null;
}
