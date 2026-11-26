import * as THREE from 'three';
import { Aircraft, computeLeadDir, airDensity, damageZone, repair, GEAR_VMAX, FLAP_VMAX, ZONE_NAMES } from './flight.js';
import { World, groundHeight, ARENA_RADIUS, visRange, lineOfSight, MAP_KEY } from './world.js';
import { buildJet, addNoseArt } from './models.js';
import { Effects } from './effects.js';
import { Combat } from './weapons.js';
import { updateRadar, updateIrLock, updateIrst, scanContacts, datalinkPicture, assessThreatsMulti, canSee, radialSpeed, inNotch } from './sensors.js';
import { WEAPONS, GUNS, RADARS, firstOf, countOf, nextStation, flyout, launchZone, agKinds, countKey, AG_LABEL } from './arsenal.js';
import { Unit, UnitView, packUnits, applyUnits, UNITS, threatRing } from './ground.js';
import { impactPoint, stationOf, scanGround, pickGround, releaseCheck, updateAgLock } from './strike.js';
import { surfaceFn, tryLand, land, deckStep, deckStatus } from './carrier.js';
import { Mission, Race, defaultLabel } from './mission.js';
import { Lesson, LESSONS } from './training.js';
import { Recorder, drawAar, drawBrief } from './recorder.js';
import { Profile, renderProfile, MEDAL_BY_ID } from './profile.js';
import { sanitizeArt } from './noseart.js';
import { JETS, COUNTRIES, JETS_OF, jetOf, DEFAULT_JET } from './aircraft.js';
import { Wrecks } from './wreck.js';
import { Input } from './input.js';
import { AIPilot } from './ai.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Net, RemotePlane, packState } from './net.js';
import { PRESETS, sanitize, spawnPoints, resolveJet, summary, encodeScenario, decodeScenario, SIDE_COLORS, countSeats, jetSpecLabel, MAX_PER_SIDE, aiConfig, aiLabel } from './scenario.js';
import { Builder, mapImage } from './builder.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------- settings + saved scenarios ----------------
const settings = Object.assign({ name: 'Viper', invert: false, sound: true, coach: true, jet: DEFAULT_JET, loadout: 'air', scenario: 'duel-bvr' }, (() => {
  try { return JSON.parse(localStorage.getItem('contrail-settings') || '{}'); } catch { return {}; }
})());
if (!JETS[settings.jet]) settings.jet = DEFAULT_JET;
if (!JETS[settings.jet].loadouts[settings.loadout]) settings.loadout = JETS[settings.jet].loadoutKeys[0];
function myChoice() { return { jet: settings.jet, loadout: settings.loadout, art: sanitizeArt(settings.art) }; }
function saveSettings() { try { localStorage.setItem('contrail-settings', JSON.stringify(settings)); } catch {} }

const userScenarios = (() => { try { return (JSON.parse(localStorage.getItem('contrail-scenarios') || '[]') || []).map(sanitize); } catch { return []; } })();
function saveUserScenarios() { try { localStorage.setItem('contrail-scenarios', JSON.stringify(userScenarios)); } catch {} }
const allScenarios = () => [...PRESETS, ...userScenarios];
const findScenario = (id) => allScenarios().find((s) => s.id === id) || null;
function storeScenario(s) {
  s = sanitize(s);
  if (PRESETS.some((p) => p.id === s.id)) s.id = 'u' + Math.random().toString(36).slice(2, 8);
  const i = userScenarios.findIndex((u) => u.id === s.id);
  if (i >= 0) userScenarios[i] = s; else userScenarios.push(s);
  saveUserScenarios();
  return s;
}

// ---------------- engine setup ----------------
const canvas = $('game');
// Without WebGL (blocked or unsupported) the game still runs, just without a 3D view.
let noWebGL = false;
const renderer = (() => {
  try { return new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch (err) { noWebGL = true; let pr = 1; return { setPixelRatio(p) { pr = p; }, getPixelRatio: () => pr, setSize() {}, render() {} }; }
})();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.5, 200000);
camera.position.set(0, 3200, 9000);
const world = new World(scene);
const effects = new Effects(scene);
const unitView = new UnitView(scene, effects);
const audio = new Audio();
const hud = new Hud($('hud'));
const input = new Input();
const net = new Net();

let W = 1, H = 1;
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  hud.resize(W, H, Math.min(window.devicePixelRatio, 2));
  effects.setViewport(H * renderer.getPixelRatio(), camera.fov);
}
window.addEventListener('resize', resize);
resize();

// ---------------- game state ----------------
// Every aircraft is an "entity": a slot in the scenario with a plane, a model and a controller.
// local = simulated on this client (my jet, or AI jets when I'm the host / in practice).
const G = {
  mode: null,          // 'ai' | 'online'
  phase: 'menu',       // countdown | fight | roundEnd | matchEnd
  phaseT: 0,
  role: 'host', myId: 0, hostId: 0, room: null, lobby: null,
  scn: null, ents: [], byId: {}, mine: null, sides: [[], []],
  rw: [0, 0], round: 0, roundT: 0,
  paused: false, camMode: 'chase', padlock: false, camQuat: new THREE.Quaternion(), look: { yaw: 0, pitch: 0, my: 0, mp: 0, wing: null, wingT: 0, wasWing: false, back: 0 },
  sendT: 0, aiSendT: 0, phaseSendT: 0, time: 0,
  netId: Math.random().toString(36).slice(2, 7),
  msg: '', msgT: 0, attract: 0, dlz: null, dlzT: 0, threat: null,
  death: null, camFocus: new THREE.Vector3(), slowT: 0, timeScale: 1, shake: 0,
  spectate: null, specQuat: new THREE.Quaternion(), feed: [], tgtT: 0, tgtManualT: 0, pullUp: false, freeCam: false,
  units: [], ground: new Map(), groundT: 0, marked: new Set(), mission: null, race: null, surface: groundHeight,
  spawnSeq: 300, radioMenu: false, unitSendT: 0, wakeT: 0, wake: [false, false],
};
const myPlane = () => (G.mine ? G.mine.plane : null);
const isAuthority = () => G.mode === 'ai' || (G.mode === 'online' && G.role === 'host');
const hot = () => G.phase === 'fight' || G.phase === 'roundEnd';
const resolveSlot = (sl) => { const x = G.byId[sl]; return x ? (x.unit ? x : x.plane) : null; };
// "SA-10" for a ground unit, "Viper 2 · F-16C" for an aircraft
const whoName = (k) => (k ? (k.unit ? `${k.name} (${k.fullName})` : `${k.name} · ${jetOf(k.plane.type).name}`) : '');
function flash(text, t = 1.6) { G.msg = text; G.msgT = t; }
function feed(text, color) { G.feed.unshift({ text, color, t: 7 }); if (G.feed.length > 6) G.feed.pop(); }

// ---------------- jet models ----------------
function ensureModel(e) {
  const type = e.plane.type;
  if (e.model && e.model.type === type) return e.model;
  if (e.model) { scene.remove(e.model.group); e.model.dispose(); }
  const j = buildJet(type);
  if (e.art) addNoseArt(j, type, sanitizeArt(e.art));
  const tip = j.model.wing.pts.reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a));
  j.tip = [tip[0] + 0.1, j.model.wing.y || 0, tip[1]];
  j.group.visible = false;
  scene.add(j.group);
  e.model = j;
  return j;
}

// ---------------- combat hooks ----------------
const combat = new Combat(scene, effects, audio, {
  onDamage(target, dmg, kind, shooter, pos, zone) {
    const P = myPlane();
    if (P && shooter === P && target !== P) {
      hud.hitT = 0.15; audio.hit();
      if (G.stats && hot()) { if (kind === 'gun') G.stats.gunHits++; else if (kind === 'msl') G.stats.mslHits++; else G.stats.agHits++; }
    }
    if (!hot()) return;
    const te = target.ent;
    if (!te) return;
    const by = shooter && shooter.ent ? shooter.ent.id : -1;
    if (te.local) applyDamage(te, dmg, kind, by, zone);
    else net.send({ t: 'hit', to: te.unit ? G.hostId : te.member != null ? te.member : G.hostId, sl: te.id, d: dmg, k: kind, by, z: zone || null });
  },
  // bombs, rockets and A/G missiles: blast damage to every enemy unit nearby
  onBlast(pos, w, owner, direct) {
    if (!hot() || !owner) return;
    for (const u of G.units) {
      if (!u.alive || u.side === owner.side) continue;
      const d = Math.max(0, Math.hypot(pos.x - u.pos.x, pos.z - u.pos.z) - u.r * 0.7) + Math.max(0, pos.y - (u.base + u.h)) * 0.5;
      let dmg = u === direct ? w.dmg : d < w.blast ? w.dmg * (1 - d / w.blast) : 0;
      if (dmg <= 0) continue;
      if (u.D.hard && w.dmg < 300) dmg *= 0.35;           // bunkers shrug off small warheads
      dmg *= 1 - (u.armor || 0) * 0.35;
      this.onDamage(u, dmg, w.cls === 'rkt' ? 'rkt' : 'bomb', owner, pos);
    }
  },
  onMissileGone(m, exploded, pos) {
    if (G.mode === 'online' && m.owner && m.owner.ent && m.owner.ent.local) net.send({ t: 'mx', id: m.id, p: pos ? [pos.x, pos.y, pos.z] : null });
  },
});

function applyDamage(e, dmg, kind, by = -1, zone = null) {
  if (e.unit) { damageUnit(e, dmg, kind, by); return; }
  const pl = e.plane;
  if (!pl.alive) return;
  pl.hp -= dmg;
  if (zone && pl.dmg) {
    const before = pl.dmg[zone];
    damageZone(pl, zone, dmg);
    if (e === G.mine && before < 1 && pl.dmg[zone] >= 1) flash(`${ZONE_NAMES[zone]} DESTROYED`, 2.4);
    else if (e === G.mine && before < 0.5 && pl.dmg[zone] >= 0.5) flash(`${ZONE_NAMES[zone]} DAMAGED`, 1.6);
  }
  if (by >= 0 && by !== e.id) e.lastHit = { by, t: G.time, kind };
  if (e === G.mine) {
    profile.hit();
    hud.damageT = Math.min(0.5, hud.damageT + (kind === 'msl' ? 0.5 : 0.12)); audio.damage(kind);
    G.shake = Math.max(G.shake, kind === 'msl' ? 1.6 : 0.25);
  }
  if (pl.hp <= 0) killPlane(e, kind);
}

// ---------------- deaths ----------------
const wrecks = new Wrecks(scene, effects, audio, {
  shake: (pos, power) => shakeAt(pos, power),
  boom: (pos, big) => { audio.explosion(pos, big); shakeAt(pos, big ? 0.8 : 0.3); },
  splash: (pos, big) => audio.splash(pos, big),
  eject: (pos) => audio.eject(pos),
  chute: (pos) => {
    audio.chute(pos);
    const D = G.death;
    if (D && D.handle.pilot && D.handle.pilot.pos === pos) flash('GOOD CHUTE — you ejected safely', 3);
    else { const P = myPlane(); if (P && P.alive && pos.distanceTo(P.pos) < visRange()) flash('GOOD CHUTE — a pilot ejected', 2); }
  },
});
function shakeAt(pos, power) {
  const d = camera.position.distanceTo(pos);
  const k = Math.max(0, 1 - d / 2500);
  G.shake = Math.max(G.shake, power * 3 * k * k);
}

const WEAPON_WORD = { gun: 'guns', msl: 'missile', crash: 'crashed', bounds: 'left the area', bomb: 'bomb', rkt: 'rockets' };
function killPlane(e, cause, seed = (Math.random() * 2147483647) | 0, killerId) {
  const pl = e.plane;
  if (!pl.alive) return;
  pl.hp = 0; pl.alive = false; pl.firing = false;
  if (killerId == null) killerId = e.lastHit && G.time - e.lastHit.t < 25 ? e.lastHit.by : -1;
  const killer = killerId >= 0 ? G.byId[killerId] : null;
  const handle = wrecks.spawn({ type: pl.type, pos: pl.pos.clone(), vel: pl.vel.clone(), quat: pl.quat.clone(), cause, seed });
  e.handle = handle;
  audio.explosion(pl.pos, true);
  shakeAt(pl.pos, cause === 'msl' ? 1.3 : 0.7);
  if (G.mode === 'ai' && (e === G.mine || camera.position.distanceTo(pl.pos) < 3500)) G.slowT = 2.4;
  e.deaths++;
  if (killer && killer.side !== e.side) killer.kills++;
  // kill feed
  const vic = `${e.name} (${jetOf(pl.type).name.split(' ')[0]})`;
  if (killer && killer !== e) feed(`${killer.name} ▸ ${vic} · ${WEAPON_WORD[cause] || cause}`, SIDE_COLORS[killer.side]);
  else feed(`${vic} ${cause === 'crash' ? 'crashed' : cause === 'bounds' ? 'was lost' : 'went down'}`, SIDE_COLORS[e.side]);
  if (e === G.mine) {
    G.death = { handle, ang: Math.atan2(-pl.vel.z, -pl.vel.x) + 0.7, t: 0, killer: killer && killer !== e ? killer : null, cause, at: pl.pos.clone() };
    G.camFocus.copy(pl.pos);
    const by = killer && killer !== e ? `by ${whoName(killer)}` : G.crashWhy || '';
    G.crashWhy = null;
    hud.showBanner(cause === 'crash' ? 'CRASHED' : cause === 'bounds' ? 'LOST' : `SHOT DOWN — ${WEAPON_WORD[cause] || cause}`, by, '#ff6a5a', 3.5);
  } else if (killer && killer === G.mine) {
    hud.showBanner('SPLASH ONE', `${e.name} · ${jetOf(pl.type).name} destroyed`, '#9dffb8', 3);
  }
  if (e.local && G.mode === 'online') {
    const r = (v) => [v.x, v.y, v.z].map((x) => Math.round(x * 100) / 100);
    net.send({ t: 'dead', sl: e.id, c: cause, p: r(pl.pos), v: r(pl.vel), q: [pl.quat.x, pl.quat.y, pl.quat.z, pl.quat.w], sd: seed, by: killerId });
  }
  pl.landed = null;
  if (G.mission && isAuthority()) G.mission.onKill(e, killer);
  if (e.local && G.scn.rules.respawn && G.scn.mode !== 'race') e.respawnT = G.scn.rules.respawnT;
  if (hooksOut.kill) hooksOut.kill(e, killer, cause);
}
// Other modules (profile, recorder) listen to game events through these.
const hooksOut = {};
const rec = new Recorder();
const profile = new Profile();
profile.onMedal = (m) => { feed(`MEDAL: ${m.ic} ${m.name}`, '#ffd23f'); if (!(hud.banner && hud.banner.t > 0)) hud.showBanner('MEDAL EARNED', `${m.ic} ${m.name} — ${m.desc}`, '#ffd23f', 3); audio.beep(1760, 0.2, 0.12); };
hooksOut.kill = (e, killer, cause) => {
  const kp = killer ? (killer.unit ? killer.pos : killer.plane.pos) : null;
  rec.event('kill', { victim: e.id, killer: killer ? killer.id : -1, cause, at: [e.plane.pos.x, e.plane.pos.z, e.plane.pos.y], from: kp ? [kp.x, kp.z, kp.y] : null });
  if (!G.mine || G.mode == null) return;
  if (killer === G.mine && e.side !== G.mine.side) profile.kill(cause);
  if (e === G.mine) profile.died();
};
hooksOut.unitDead = (u, killer) => {
  rec.event('unit', { unit: G.units.indexOf(u), killer: killer ? killer.id : -1, at: [u.pos.x, u.pos.z, u.base + Math.min(u.h, 20) * 0.5] });
  if (killer && killer === G.mine && u.side !== G.mine.side) profile.groundKill(u.D);
};
hooksOut.trap = (wire) => profile.trap(wire);
hooksOut.lesson = (L) => profile.lesson(L.key);
hooksOut.raceFinish = (st) => { if (profile.race(G.scn.id, st.final)) { G.bestTime = fmtTime(st.final); flash('NEW BEST TIME!', 3); } };

// ---------------- ground units ----------------
function damageUnit(u, dmg, kind, by) {
  if (!u.alive || !hot()) return;
  u.hp -= dmg;
  if (by >= 0) u.lastBy = by;
  if (u.hp <= 0) destroyUnit(u, by);
}
function destroyUnit(u, by, remote) {
  if (!u.alive) return;
  u.deadPending = false;
  u.alive = false; u.hp = 0; u.firing = false; u.lockTgt = null; u.radar.stt = false;
  const killer = by >= 0 ? G.byId[by] : null;
  const top = u.pos.clone().setY(u.base + Math.min(u.h, 20) * 0.5);
  effects.explosion(top, u.vel, true);
  if (u.D.big || u.D.ship) effects.fireball(top, u.vel, u.D.ship ? 1.6 : 1.2);
  audio.explosion(top, true); shakeAt(top, 1.2);
  if (killer && killer.side !== u.side) killer.groundKills = (killer.groundKills || 0) + 1;
  feed(killer ? `${killer.name} ▸ ${u.name} destroyed` : `${u.name} destroyed`, SIDE_COLORS[killer ? killer.side : 1 - u.side]);
  if (killer && killer === G.mine) hud.showBanner(u.D.ship ? 'SHIP SUNK' : 'TARGET DESTROYED', u.fullName, '#9dffb8', 2.5);
  if (G.mission && isAuthority()) G.mission.onUnitDead(u, killer);
  if (G.mode === 'online' && G.role === 'host' && !remote) net.send({ t: 'udead', id: u.id, by });
  if (hooksOut.unitDead) hooksOut.unitDead(u, killer);
}

// Waves and reinforcements: new AI flights joining mid-round. The host builds them and tells
// everyone; ids from 300 up so they never collide with scenario seats (0-15) or units (100+).
function spawnGroup(w) {
  const roster = [];
  const hdg = w.hdg != null ? w.hdg : (Math.atan2(G.scn.sides[1 - w.side].x - w.x, -(G.scn.sides[1 - w.side].z - w.z)) * 180) / Math.PI;
  const tmp = sanitize({ sides: [{ ...w, hdg, slots: w.slots }, { slots: [{}] }] });
  const sp = spawnPoints(tmp, groundHeight)[0];
  let lead = null;
  w.slots.forEach((q, i) => {
    const type = resolveJet(q.jet === 'choice' ? 'random' : q.jet, lead, null); if (i === 0) lead = type;
    const loadout = pickLoadout(type, q.loadout, null);
    roster.push({ id: G.spawnSeq++, side: w.side, idx: i, name: `${w.name} ${i + 1}`, type, loadout, skill: q.skill, aic: aiConfig(q), member: null, human: false, spawned: true, route: q.route || null, p: [sp[i].pos.x, sp[i].pos.y, sp[i].pos.z], q: [sp[i].quat.x, sp[i].quat.y, sp[i].quat.z, sp[i].quat.w], sp: sp[i].speed });
  });
  if (G.mode === 'online') net.send({ t: 'spawn', r: roster, rd: G.round });
  return roster.map(addSpawned);
}
function addSpawned(r) {
  const e = makeEnt(r);
  G.ents.push(e); G.byId[e.id] = e; G.sides[e.side].push(e);
  const pl = e.plane, pos = new THREE.Vector3(...r.p), quat = new THREE.Quaternion(...r.q);
  if (e.local) { pl.reset(pos, quat, r.sp, e.loadout); if (e.ai) e.ai.reset(); }
  else { pl.alive = true; pl.pos.copy(pos); pl.prevPos.copy(pos); pl.quat.copy(quat); pl.vel.set(0, 0, -r.sp).applyQuaternion(quat); }
  pl.contacts = new Map();
  return e;
}

// Back into the fight after being shot down (score / survival rules): on a friendly carrier's
// catapult if there is one, otherwise at the side's start.
function respawnEnt(e) {
  const pl = e.plane;
  const sp = e.spawned ? null : spawnPoints(G.scn, groundHeight)[e.side][e.idx];
  const s = G.scn.sides[e.side];
  const pos = sp ? sp.pos : new THREE.Vector3(s.x, s.alt, s.z), quat = sp ? sp.quat : G.sides[e.side][0].plane.quat.clone();
  pl.setType(e.type);
  pl.reset(pos, quat, sp ? sp.speed : s.spd, e.loadout);
  pl.contacts = new Map(); pl.tgt = null; pl.lockTgt = null; pl.wantStt = false; pl.podN = {};
  const cv = G.units.find((u) => u.D.deck && u.alive && u.side === e.side);
  if (cv) { land(pl, cv, { trap: false, along: 0, across: 0 }); pl.landed.phase = 'ready'; pl.landed.along = cv.D.deck.len / 2 - 105; pl.landed.across = -cv.D.deck.wid * 0.12; deckStep(pl, 0, null, false); }
  e.handle = null; e.respawnT = 0;
  if (e.ai) e.ai.reset();
  if (e === G.mine) { G.death = null; G.spectate = null; input.reset(); G.camQuat.copy(pl.quat); hud.showBanner('BACK IN THE FIGHT', cv ? `On the ${cv.name}'s catapult` : '', '#9dffb8', 2); }
}

// ---------------- rounds ----------------
function sendPhase() {
  if (G.mode !== 'online' || G.role !== 'host') return;
  net.send({ t: 'phase', ph: G.phase, pt: G.phaseT, rw: G.rw, r: G.round, rt: G.roundT, k: G.ents.map((e) => [e.id, e.kills, e.deaths, e.groundKills || 0]), ms: G.mission ? G.mission.pack() : null });
}
function setPhase(ph, t = 0) {
  G.phase = ph; G.phaseT = t;
  if (ph === 'fight') { hud.showBanner('FIGHT!', '', '#9dffb8', 1.4); audio.beep(1320, 0.45, 0.14); }
  if (ph === 'matchEnd') showEnd();
}

function startRound(r) {
  G.round = r;
  combat.clear(); effects.clear(); wrecks.clear();
  G.death = null; G.slowT = 0; G.shake = 0; G.spectate = null; G.roundT = 0;
  // reinforcements from the last round leave; ground units are rebuilt
  for (const e of G.ents) if (e.spawned && e.model) { scene.remove(e.model.group); e.model.dispose(); }
  G.ents = G.ents.filter((e) => !e.spawned);
  G.sides = [G.ents.filter((e) => e.side === 0), G.ents.filter((e) => e.side === 1)];
  for (const k of Object.keys(G.byId)) if (+k >= 300) delete G.byId[k];
  for (const u of G.units) u.reset();
  if (G.mission) G.mission.reset();
  if (G.race) G.race.reset();
  const sp = spawnPoints(G.scn, groundHeight);
  G.radioMenu = false; G.ccip = null; G.ground = new Map();
  G.lesson = G.scn.mode === 'training' && LESSONS[G.scn.lesson] ? new Lesson(G.scn.lesson) : null;
  G.replay = null; G.freeCam = false;
  { const b = profile.best(G.scn.id); G.bestTime = b ? fmtTime(b) : null; }
  for (const e of G.ents) {
    e.respawnT = 0; e.racePrev = null;
    const s = sp[e.side][e.idx], pl = e.plane;
    e.lastHit = null; e.handle = null; pl.contacts = new Map();
    if (e.local) {
      pl.setType(e.type);
      pl.reset(s.pos, s.quat, s.speed, e.loadout);
      pl.wantStt = false; pl.tgt = null; pl.lockTgt = null; pl.podN = {}; pl.agt = null;
      if (e.ai) { e.ai.command = null; e.ai.holdFire = false; e.ai.reset(); }
    } else {
      pl.hardReset(); pl.alive = true; pl.hp = 100;
      pl.pos.copy(s.pos); pl.prevPos.copy(s.pos); pl.quat.copy(s.quat);
      pl.vel.set(0, 0, -s.speed).applyQuaternion(s.quat);
      pl.fwd.set(0, 0, -1).applyQuaternion(pl.quat); pl.up.set(0, 1, 0).applyQuaternion(pl.quat); pl.right.set(1, 0, 0).applyQuaternion(pl.quat);
      pl.lockTgt = null;
    }
  }
  G.threat = null; G.dlz = null;
  input.reset();
  const P = myPlane();
  if (P) G.camQuat.copy(P.quat);
  setPhase('countdown', 3);
  // one recording for the whole match, so the debrief, replay and kill cams cover every round
  if (r === 1 || rec.scn !== G.scn || !rec.frames.length) rec.start(G.scn, G.ents, G.units, G.mine); else rec.newRound(r, G.ents);
  hud.showBanner(`ROUND ${r}`, G.scn.name, '#ffffff', 2);
}

// The loadout a slot asks for, or the closest thing this jet has (an A/G mission asking for SEAD
// gets a strike load on a jet without ARMs; an air mission asking for BVR gets the heavy load).
const AG_FALLBACK = { sead: ['sead', 'strike', 'bombs', 'cas'], strike: ['strike', 'bombs', 'cas', 'sead'], cas: ['cas', 'bombs', 'strike'], bombs: ['bombs', 'strike', 'cas'], antiship: ['antiship', 'strike', 'bombs'] };
function pickLoadout(type, want, choice) {
  const L = JETS[type].loadouts;
  if (want === 'bvr' && !L.bvr && L.heavy) want = 'heavy';
  if (want && L[want]) return want;
  if (want && AG_FALLBACK[want]) { const f = AG_FALLBACK[want].find((k) => L[k]); if (f) return f; }
  if (choice && L[choice]) return choice;
  return JETS[type].loadoutKeys[0];
}

// Turn a scenario + who sits where into a concrete roster (host / practice only; the roster
// is sent to everyone so random picks are the same on every screen).
function buildRoster(scn, seats, choices, names) {
  const roster = [];
  scn.sides.forEach((sd, k) => {
    let lead = null;
    sd.slots.forEach((q, i) => {
      const id = k * MAX_PER_SIDE + i;
      const member = q.pilot === 'human' && seats[id] != null ? seats[id] : null;
      const human = member != null;
      const ch = human ? choices[member] || {} : {};
      const type = resolveJet(q.jet, lead, ch.jet);
      if (i === 0) lead = type;
      // time trials: only the human racers fly
      if (scn.mode === 'race' && !human) return;
      const loadout = pickLoadout(type, q.loadout, human && ch.jet === type ? ch.loadout : null);
      roster.push({ id, side: k, idx: i, name: human ? names[member] || 'Pilot' : `${sd.name} ${i + 1}`, type, loadout, skill: q.skill, aic: aiConfig(q), member, human, route: q.route || null, art: human ? (choices[member] || {}).art || null : null });
    });
  });
  return roster;
}

const missionApi = {
  ents: () => G.ents, units: () => G.units, spawn: (w) => spawnGroup(w),
  say: (text, color = '#ffe08a') => { feed(text, color); if (G.mode === 'online' && G.role === 'host') net.send({ t: 'feed', text, c: color }); },
  banner: (text, sub = '', color = '#ffffff', dur = 3) => { hud.showBanner(text, sub, color, dur); if (G.mode === 'online' && G.role === 'host') net.send({ t: 'banner', text, sub, c: color, d: dur }); },
  wake: () => { for (const u of G.units) u.awake = true; },
};

// Time-trial gates (rings) and map markers drawn in the world.
const gateView = {
  group: null, rings: [],
  clear() { if (this.group) scene.remove(this.group); this.group = null; this.rings = []; },
  build(scn) {
    this.clear();
    if (!scn.gates.length) return;
    this.group = new THREE.Group();
    const n = scn.gates.length;
    scn.gates.forEach((g, i) => {
      const [x, y, z, r] = g;
      const nx = scn.gates[(i + 1) % n], pv = scn.gates[(i - 1 + n) % n];
      const dir = new THREE.Vector3(nx[0] - pv[0], 0, nx[2] - pv[2]);
      if (i === 0 && n > 1) dir.set(nx[0] - x, 0, nx[2] - z);
      if (i === n - 1 && scn.laps === 1 && n > 1) dir.set(x - pv[0], 0, z - pv[2]);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(2, r * 0.035), 8, 40), new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, opacity: 0.85, fog: false }));
      ring.position.set(x, y, z);
      ring.lookAt(x + dir.x, y, z + dir.z);
      this.group.add(ring); this.rings.push(ring);
    });
    scene.add(this.group);
  },
  update(next, finished) {
    this.rings.forEach((r, i) => {
      const on = !finished && i === next, done = finished || i < next;
      r.material.color.setHex(on ? 0x40ff70 : done ? 0x707070 : 0xffb030);
      r.material.opacity = done ? 0.25 : on ? 1 : 0.7;
      r.scale.setScalar(on ? 1 + 0.03 * Math.sin(G.time * 6) : 1);
    });
  },
};
const MARK_COL = { wp: 0x7fe8ff, target: 0xff6a5a, danger: 0xffb030, info: 0xffffff, home: 0x9dffb8 };
const markerView = {
  group: null,
  clear() { if (this.group) scene.remove(this.group); this.group = null; },
  build(scn) {
    this.clear();
    if (!scn.markers.length) return;
    this.group = new THREE.Group();
    for (const m of scn.markers) {
      const g = groundHeight(m.x, m.z);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 1600, 6, 1, true), new THREE.MeshBasicMaterial({ color: MARK_COL[m.icon] || 0xffffff, transparent: true, opacity: 0.18, depthWrite: false, fog: false }));
      beam.position.set(m.x, g + 800, m.z);
      this.group.add(beam);
    }
    scene.add(this.group);
  },
};

function makeEnt(r) {
  const local = r.human ? r.member === G.myId : isAuthority();
  const plane = local ? new Aircraft(r.name, r.type) : new RemotePlane(r.name);
  if (!local) { plane.setType(r.type); plane.gunAcc = 0; }
  const e = { ...r, local, plane, ai: null, model: null, kills: 0, deaths: 0, groundKills: 0, lastHit: null, handle: null, respawnT: 0, aiIn: { pitch: 0, roll: 0, yaw: 0, throttle: 1, airbrake: false, gear: false, flaps: 0 }, aiOut: null };
  plane.ent = e; plane.side = r.side; plane.netId = G.netId + r.id;
  if (local && !r.human) e.ai = new AIPilot(plane, r.aic || r.skill);
  return e;
}

function startMatch(scn, roster, mode) {
  teardownMatch();
  G.mode = mode;
  G.scn = sanitize(scn);
  world.setMap(G.scn.map);
  G.mapImg = mapImage(MAP_KEY, 640);   // terrain under the tactical map (built once per map, then cached)
  world.setEnv(G.scn.time, G.scn.weather);
  G.ents = roster.map(makeEnt);
  G.byId = {};
  for (const e of G.ents) G.byId[e.id] = e;
  G.sides = [G.ents.filter((e) => e.side === 0), G.ents.filter((e) => e.side === 1)];
  // ground units and ships (same ids on every screen; the host simulates them)
  G.units = G.scn.units.map((u, i) => { const x = new Unit(u, 100 + i); x.local = isAuthority(); x.netId = G.netId + 'u' + i; return x; });
  G.stats = { rounds: 0, gunHits: 0, msl: 0, mslHits: 0, ag: 0, agHits: 0, traps: 0, perfectTraps: 0, airKills: 0, groundKills: 0, deaths: 0, flight: 0 };
  for (const u of G.units) G.byId[u.id] = u;
  combat.units = G.units;
  unitView.clear(); unitView.sync(G.units);
  G.surface = surfaceFn(G.units);
  G.marked = new Set();
  for (const o of G.scn.objectives) for (const i of o.units) if (G.units[i]) G.marked.add(G.units[i].id);
  G.mission = new Mission(G.scn, missionApi);
  G.race = G.scn.mode === 'race' || (G.scn.gates.length && G.scn.mode === 'training') ? new Race(G.scn) : null;
  gateView.build(G.scn); markerView.build(G.scn); G.markPos = null;
  G.spawnSeq = 300;
  G.mine = G.ents.find((e) => e.human && e.member === G.myId) || null;
  G.rw = [0, 0]; G.round = 0; G.feed = []; G.paused = false; G.profiled = false;
  if (G.mine) profile.missionStart();
  enterGame();
  if (isAuthority()) { startRound(1); sendPhase(); }
  else { G.phase = 'countdown'; G.phaseT = 3; }
}

function teardownMatch() {
  combat.clear(); wrecks.clear(); effects.clear();
  unitView.clear(); G.units = []; combat.units = []; G.mission = null; G.race = null; G.surface = groundHeight;
  G.replay = null; G.freeCam = false; G.lesson = null; $('replayBar').classList.remove('show');
  gateView.clear(); markerView.clear();
  for (const e of G.ents) if (e.model) { scene.remove(e.model.group); e.model.dispose(); }
  G.ents = []; G.byId = {}; G.mine = null; G.sides = [[], []];
  G.death = null; G.slowT = 0; G.spectate = null;
}

function startPractice(scn, skipBrief) {
  scn = sanitize(scn);
  if (!skipBrief && (scn.briefing || scn.mode !== 'battle')) { showBriefing(scn, () => startPractice(scn, true)); return; }
  G.myId = 0; G.role = 'host'; G.hostId = 0;
  // I take the first human seat (Blue first); every other seat is flown by the AI
  const seats = {};
  outer: for (let k = 0; k < 2; k++) for (let i = 0; i < scn.sides[k].slots.length; i++) {
    if (scn.sides[k].slots[i].pilot === 'human') { seats[k * MAX_PER_SIDE + i] = 0; break outer; }
  }
  const roster = buildRoster(scn, seats, { 0: myChoice() }, { 0: settings.name });
  G.lastPractice = scn;
  startMatch(scn, roster, 'ai');
  if (!G.mine) flash('No human seat in this scenario: spectating. Press N to switch aircraft.', 5);
}

function enterGame() {
  input.invertPitch = settings.invert;
  showScreen(null);
  audio.enabled = settings.sound;
}

function quitToMenu(reason) {
  if (G.mode === 'online') net.send({ t: 'leave' });
  teardownMatch();
  G.mode = null; G.phase = 'menu'; G.paused = false; G.room = null; G.lobby = null;
  showScreen('menu');
  if (reason) toast(reason);
}

// ---------------- online: rooms, lobby, match ----------------
net.on('welcome', (m) => { G.myId = m.id; });
net.on('error', (m) => { toast(m.msg || 'Error'); if (G.phase === 'menu') showScreen('menu'); });
net.on('room', (m) => {
  const wasHost = G.role === 'host';
  G.room = m; G.hostId = m.host; G.role = m.host === G.myId ? 'host' : 'guest';
  if (G.role === 'guest') {
    net.send({ t: 'choice', to: G.hostId, ...myChoice() });
    if (G.phase === 'menu') { if (m.quick) setLobby('Opponent found, starting…', false); else renderLobby(); }
    return;
  }
  // host: keep seats in sync with who is in the room
  if (!G.lobby || !wasHost) G.lobby = { scn: sanitize(findScenario(settings.scenario) || PRESETS[0]), seats: {}, choices: {}, started: false };
  if (m.quick) G.lobby.scn = quickScenario();
  G.lobby.choices[G.myId] = myChoice();
  reseat();
  if (G.mode === 'online') {
    // someone left mid-match: the host's AI takes over their jet
    const present = new Set(m.members.map((x) => x.id));
    for (const e of G.ents) if (e.human && !present.has(e.member)) handOverToAI(e);
  }
  broadcastLobby();
  if (G.phase === 'menu') { if (m.quick) setLobby(m.members.length < 2 ? 'Searching for an opponent…' : 'Opponent found, starting…', true); else renderLobby(); }
  maybeQuickStart();
});
// quick match: the 1v1 BVR duel with a human seat on each side
function quickScenario() {
  const s = sanitize(PRESETS[0]);
  s.sides[1].slots[0] = { pilot: 'human', jet: 'choice', skill: 'pilot', loadout: '' };
  return s;
}
net.on('choice', (m) => {
  if (G.role !== 'host' || !G.lobby) return;
  const jet = JETS[m.jet] ? m.jet : DEFAULT_JET;
  G.lobby.choices[m.from] = { jet, loadout: JETS[jet].loadouts[m.loadout] ? m.loadout : JETS[jet].loadoutKeys[0], art: sanitizeArt(m.art) };
  broadcastLobby();
  if (G.phase === 'menu' && !G.room.quick) renderLobby();
  maybeQuickStart();
});
net.on('seat', (m) => {
  if (G.role !== 'host' || !G.lobby || G.lobby.started) return;
  sit(m.from, m.slot);
});
net.on('lobby', (m) => {
  if (G.role !== 'guest') return;
  G.lobby = { scn: sanitize(m.scn), seats: m.seats || {}, choices: m.choices || {}, started: !!m.started };
  if ((G.phase === 'menu' || G.phase === 'matchEnd') && !m.started && !(G.room && G.room.quick)) renderLobby();
});
net.on('start', (m) => {
  if (G.role !== 'guest') return;
  G.lobby = G.lobby || { seats: {}, choices: {} };
  G.lobby.started = true;
  startMatch(m.scn, m.roster, 'online');
  if (G.scn.briefing) showBriefing(G.scn, null);
});
net.on('phase', (m) => {
  if (G.mode !== 'online' || G.role !== 'guest') return;
  G.rw = m.rw; G.roundT = m.rt || 0;
  const score = () => {
    if (m.k) for (const kd of m.k) { const e = G.byId[kd[0]]; if (e && !e.unit) { e.kills = kd[1]; e.deaths = kd[2]; e.groundKills = kd[3] || 0; } }
    if (m.ms && G.mission) G.mission.unpack(m.ms);
  };
  if (m.r !== G.round) { startRound(m.r); score(); G.phaseT = m.pt; if (m.ph !== 'countdown') setPhase(m.ph, m.pt); return; }
  score();
  if (m.ph !== G.phase) setPhase(m.ph, m.pt);
  else G.phaseT = m.pt;
});
function onState(m, now) {
  const e = G.byId[m.sl];
  if (!e || e.local || m.r !== G.round) return;
  e.plane.applyState(m, now, net.oneWay);
  e.plane.lockTgt = m.rt >= 0 ? resolveSlot(m.rt) : null;
  combat.syncRemoteMissiles(m.m || [], now, m.sl, resolveSlot);
}
net.on('s', (m) => { if (G.mode === 'online') onState(m, performance.now()); });
net.on('S', (m) => { if (G.mode !== 'online') return; const now = performance.now(); for (const x of m.l) { x.r = m.r; onState(x, now); } });
net.on('hit', (m) => {
  if (G.mode !== 'online' || !hot()) return;
  const e = G.byId[m.sl];
  if (e && e.local) applyDamage(e, m.d, m.k, m.by, m.z || null);
});
// ground units: the host streams their state; guests mirror it
net.on('U', (m) => {
  if (G.mode !== 'online' || G.role !== 'guest' || m.r !== G.round) return;
  const now = performance.now();
  applyUnits(G.units, m.u, resolveSlot);
  for (const u of G.units) if (u.deadPending) destroyUnit(u, u.lastBy ?? -1, true);
  if (m.m) for (const x of m.m) { const u = G.byId[x[0]]; if (u && u.unit) combat.syncRemoteMissiles(x[1], now, u.id, resolveSlot); }
});
net.on('udead', (m) => {
  if (G.mode !== 'online' || G.role !== 'guest') return;
  const u = G.byId[m.id];
  if (u && u.unit && u.alive) destroyUnit(u, m.by, true);
});
net.on('spawn', (m) => {
  if (G.mode !== 'online' || G.role !== 'guest' || m.rd !== G.round) return;
  for (const r of m.r) if (!G.byId[r.id]) addSpawned(r);
});
net.on('banner', (m) => { if (G.mode === 'online' && G.role === 'guest') hud.showBanner(String(m.text).slice(0, 60), String(m.sub || '').slice(0, 80), m.c, m.d); });
// wingman orders from a guest flight lead: the host flies the AI, so it carries them out
net.on('cmd', (m) => {
  if (G.mode !== 'online' || G.role !== 'host') return;
  const lead = G.byId[m.sl];
  if (lead && !lead.unit && lead.member === m.from) issueCommand(lead, m.c, m.tg);
});
net.on('respawn', (m) => {
  if (G.mode !== 'online') return;
  const e = G.byId[m.sl];
  if (!e || e.local || e.unit) return;
  e.plane.alive = true; e.plane.hp = 100; e.handle = null;
  if (m.p) { e.plane.pos.set(...m.p); e.plane.prevPos.copy(e.plane.pos); }
});
net.on('dead', (m) => {
  if (G.mode !== 'online') return;
  const e = G.byId[m.sl];
  if (!e || e.local) return;
  const pl = e.plane;
  if (m.p) pl.pos.set(m.p[0], m.p[1], m.p[2]);
  if (m.v) pl.vel.set(m.v[0], m.v[1], m.v[2]);
  if (m.q) pl.quat.set(m.q[0], m.q[1], m.q[2], m.q[3]);
  if (pl.alive) killPlane(e, m.c, m.sd, m.by); // same seed: every screen sees the same break-up
});
net.on('fl', (m) => {
  const e = G.byId[m.sl];
  if (G.mode !== 'online' || !e || e.local) return;
  for (const f of m.f) combat.addFlare(new THREE.Vector3(f[0], f[1], f[2]), new THREE.Vector3(f[3], f[4], f[5]), 'r' + m.id, e.plane);
});
net.on('ch', (m) => {
  const e = G.byId[m.sl];
  if (G.mode !== 'online' || !e || e.local) return;
  for (const c of m.c) combat.addChaff(new THREE.Vector3(c[0], c[1], c[2]), new THREE.Vector3(c[3], c[4], c[5]), 'r' + m.id, e.plane);
});
net.on('feed', (m) => { if (G.mode === 'online' && G.role === 'guest') feed(String(m.text).slice(0, 80), m.c); });
net.on('mx', (m) => combat.removeRemoteMissile(m.id, m.p ? new THREE.Vector3(...m.p) : null));
net.on('toLobby', () => { if (G.role === 'guest') { teardownMatch(); G.mode = null; G.phase = 'menu'; renderLobby(); } });
net.on('peerLeft', (m) => { if (G.mode === 'online') { for (const e of G.ents) if (e.human && e.member === m.id) { feed(`${e.name} left`, '#cccccc'); if (G.role !== 'host') { e.member = null; e.human = false; } } } });
net.on('hostLeft', () => quitToMenu('The host left, so the room closed.'));
net.on('disconnected', () => { if (G.mode === 'online' || G.room) quitToMenu('Disconnected from server.'); });

function handOverToAI(e) {
  if (e.local || G.role !== 'host') return;
  const old = e.plane;
  const pl = new Aircraft(e.name + ' (AI)', e.type);
  pl.reset(old.pos.clone(), old.quat.clone(), Math.max(150, old.vel.length()), e.loadout);
  pl.vel.copy(old.vel); pl.stores = old.stores.slice(); pl.updateStores();
  pl.alive = old.alive; pl.hp = old.hp; pl.side = e.side; pl.ent = e; pl.netId = G.netId + e.id; pl.contacts = new Map();
  e.plane = pl; e.local = true; e.human = false; e.member = null; e.name += ' (AI)';
  e.ai = new AIPilot(pl, e.aic || 'pilot');
}

function reseat() {
  const L = G.lobby, scn = L.scn, members = G.room.members.map((x) => x.id);
  for (const k of Object.keys(L.seats)) {
    const id = +k, side = Math.floor(id / MAX_PER_SIDE), i = id % MAX_PER_SIDE;
    const q = scn.sides[side] && scn.sides[side].slots[i];
    if (!q || q.pilot !== 'human' || !members.includes(L.seats[k])) delete L.seats[k];
  }
  const seated = new Set(Object.values(L.seats));
  for (const mid of members) {
    if (seated.has(mid)) continue;
    // fill the side with fewer humans first
    const humans = [0, 1].map((k) => Object.keys(L.seats).filter((s) => Math.floor(+s / MAX_PER_SIDE) === k).length);
    const order = humans[0] <= humans[1] ? [0, 1] : [1, 0];
    let done = false;
    for (const k of order) {
      scn.sides[k].slots.forEach((q, i) => {
        const id = k * MAX_PER_SIDE + i;
        if (!done && q.pilot === 'human' && L.seats[id] == null) { L.seats[id] = mid; done = true; }
      });
      if (done) break;
    }
    seated.add(mid);
  }
}
function sit(mid, slotId) {
  const L = G.lobby;
  const side = Math.floor(slotId / MAX_PER_SIDE), q = L.scn.sides[side] && L.scn.sides[side].slots[slotId % MAX_PER_SIDE];
  if (!q || q.pilot !== 'human' || (L.seats[slotId] != null && L.seats[slotId] !== mid)) return;
  for (const k of Object.keys(L.seats)) if (L.seats[k] === mid) delete L.seats[k];
  L.seats[slotId] = mid;
  broadcastLobby();
  renderLobby();
}
function broadcastLobby() {
  if (G.role !== 'host' || !G.lobby) return;
  net.send({ t: 'lobby', scn: G.lobby.scn, seats: G.lobby.seats, choices: G.lobby.choices, started: G.lobby.started });
}
function maybeQuickStart() {
  const R = G.room, L = G.lobby;
  if (G.role !== 'host' || !R || !R.quick || !L || L.started || R.members.length < 2) return;
  const other = R.members.find((x) => x.id !== G.myId);
  if (other && L.choices[other.id]) hostStart();
}
function hostStart() {
  const L = G.lobby;
  if (!L || G.role !== 'host') return;
  reseat();
  const names = {};
  for (const m of G.room.members) names[m.id] = m.name;
  names[G.myId] = settings.name;
  L.choices[G.myId] = myChoice();
  const roster = buildRoster(L.scn, L.seats, L.choices, names);
  L.started = true;
  broadcastLobby();
  net.send({ t: 'start', scn: L.scn, roster });
  startMatch(L.scn, roster, 'online');
  if (G.scn.briefing) showBriefing(G.scn, null);
}
function hostBackToLobby() {
  if (G.role !== 'host') return;
  teardownMatch();
  G.mode = null; G.phase = 'menu';
  G.lobby.started = false;
  net.send({ t: 'toLobby' });
  broadcastLobby();
  renderLobby();
}

async function online(action, code) {
  audio.start();
  readMenu();
  setLobby('Connecting…', true);
  const slow = setTimeout(() => {
    if ($('lobby').classList.contains('show') && !net.connected) setLobby('Waking up the server…<br><span class="dim">It sleeps when nobody is playing, so this can take up to a minute.</span>', true);
  }, 4000);
  try { await net.connect(settings.name); clearTimeout(slow); }
  catch { clearTimeout(slow); showScreen('menu'); toast('Could not reach the game server. Check your connection and try again.'); return; }
  if (!$('lobby').classList.contains('show')) return; // cancelled while connecting
  G.lobby = null; G.role = 'guest';
  if (action === 'quick') { net.send({ t: 'quick' }); setLobby('Searching for an opponent…', true); }
  if (action === 'create') net.send({ t: 'create' });
  if (action === 'join') net.send({ t: 'join', code });
}

// ---------------- weapons ----------------
const pack = (list) => list.map((f) => [f.pos.x, f.pos.y, f.pos.z, f.vel.x, f.vel.y, f.vel.z].map((x) => Math.round(x * 10) / 10));
function handleWeapons(e, ctl, target, dt, isLocalHuman) {
  const plane = e.plane;
  const on = hot();
  plane.missileCd -= dt; plane.flareCd -= dt; plane.chaffCd = (plane.chaffCd || 0) - dt;
  const gun = plane.gunT;
  const trigger = on && plane.alive && !plane.landed && ctl.gun && plane.gunAmmo > 0 && gun.rate > 0;
  plane.gunSpin = trigger ? Math.min(1, plane.gunSpin + dt / Math.max(0.01, gun.spinUp)) : Math.max(0, plane.gunSpin - dt / 0.5);
  plane.firing = trigger;
  if (trigger) {
    const rate = gun.rate * plane.gunSpin;
    plane.gunAcc += dt * rate;
    let n = 0;
    while (plane.gunAcc >= 1 && plane.gunAmmo > 0) {
      plane.gunAcc -= 1; plane.gunAmmo--;
      if (isLocalHuman && G.stats) G.stats.rounds++;
      combat.fireBullet(plane, true, (n++ / (dt * rate + 1)) * dt);
    }
    if (plane.gunSpin > 0.2) effects.muzzle(combat.gunMuzzle(plane), plane.vel);
  } else plane.gunAcc = 0;

  if (!on || !plane.alive) return;
  if (plane.weapon === 'ag') { if (ctl.missile && plane.missileCd <= 0) { if (plane.landed) { if (isLocalHuman) flash('ON DECK — weapons safe'); } else fireAg(e, isLocalHuman); } }
  else if (ctl.missile && plane.missileCd <= 0 && plane.landed) { if (isLocalHuman) flash('ON DECK — weapons safe'); }
  else if (ctl.missile && plane.missileCd <= 0) {
    const cls = plane.weapon;
    const key = firstOf(plane.stores, cls);
    const w = key && WEAPONS[key];
    if (!key) { if (isLocalHuman) flash(cls === 'mrm' ? 'NO RADAR MISSILES LEFT — press 1 for IR missiles' : 'NO IR MISSILES LEFT'); }
    else if (!target) { if (isLocalHuman) flash('NO TARGET'); }
    else if (cls === 'srm' && !plane.locked) { if (isLocalHuman) flash('NO LOCK — wait for the steady tone'); }
    else if (cls === 'mrm' && !plane.radar.contact) { if (isLocalHuman) flash('NO RADAR TRACK — point the nose at the target'); }
    else if (w.guidance === 'sarh' && !plane.radar.stt) { if (isLocalHuman) flash(`${w.name} IS SEMI-ACTIVE — lock the radar first (TAB)`); }
    else {
      const st = nextStation(plane.stores, cls, plane.lastSide, plane.T.fireOrder);
      plane.stores[st] = null; plane.updateStores(); plane.lastSide = st % 2;
      combat.launchMissile(plane, target, key, st);
      plane.missileCd = 0.8;
      if (isLocalHuman && G.stats) G.stats.msl++;
      if (cls === 'srm') plane.lockProgress = 0.6;
      audio.launch(isLocalHuman ? null : plane.pos);
      if (isLocalHuman) flash(w.guidance === 'sarh' ? `FOX 1 — ${w.name}: hold the lock until impact` : cls === 'mrm' ? (plane.radar.stt ? `FOX 3 — ${w.name}, keep the lock for datalink` : `FOX 3 — ${w.name}, no lock, no datalink`) : `FOX 2 — ${w.name}`, 1.8);
    }
  }
  if (ctl.flare && plane.flareCd <= 0 && plane.flares > 0) {
    const popId = combat.popFlares(plane);
    plane.flares--; plane.flareCd = 0.35;
    if (isLocalHuman) audio.flare();
    if (G.mode === 'online') net.send({ t: 'fl', sl: e.id, id: plane.netId + popId, f: pack(combat.flares.slice(-2)) });
  }
  if (ctl.chaff && plane.chaffCd <= 0 && plane.chaff > 0) {
    const popId = combat.popChaff(plane);
    plane.chaff--; plane.chaffCd = 0.3;
    if (isLocalHuman) audio.chaff();
    if (G.mode === 'online') net.send({ t: 'ch', sl: e.id, id: plane.netId + popId, c: pack(combat.chaff.slice(-1)) });
  }
}

// Bombs, rockets and A/G missiles. Brevity calls: PICKLE (bombs), RIFLE (TV/IR missile),
// MAGNUM (anti-radiation), BRUISER (anti-ship).
const AG_CALL = { bomb: 'PICKLE — bombs away', gbomb: 'PICKLE — guided bomb away', agm: 'RIFLE', arm: 'MAGNUM', ashm: 'BRUISER', rkt: 'ROCKETS' };
function fireAg(e, isLocalHuman) {
  const pl = e.plane, key = pl.agKey, w = key && WEAPONS[key];
  if (!w || !countKey(pl.stores, key)) { if (isLocalHuman) flash('NO A/G STORES LEFT'); return; }
  const known = isLocalHuman ? G.ground : new Map(pl.agt ? [[pl.agt, { how: 'eyes' }]] : []);
  const chk = releaseCheck(pl, key, pl.agt, known);
  if (!chk.ok) { if (isLocalHuman) flash(chk.why, 1.6); pl.missileCd = 0.3; return; }
  const st = stationOf(pl.stores, key, pl.lastSide, pl.T.fireOrder);
  if (st < 0) return;
  pl.lastSide = st % 2;
  if (w.cls === 'rkt') {
    // rocket pods ripple their rockets; the pod is gone once it's empty
    pl.podN = pl.podN || {};
    pl.podN[st] = (pl.podN[st] || 0) + 1;
    if (pl.podN[st] >= w.shots) { pl.stores[st] = null; pl.updateStores(); delete pl.podN[st]; }
    combat.launchMissile(pl, chk.target, key, st);
    pl.missileCd = 0.08;
    if (G.stats && isLocalHuman) G.stats.ag++;
    if (isLocalHuman && !(G.rktCallT > G.time)) { flash(AG_CALL.rkt, 0.8); G.rktCallT = G.time + 1; }
    audio.launch(isLocalHuman ? null : pl.pos);
    return;
  }
  pl.stores[st] = null; pl.updateStores();
  const m = combat.launchMissile(pl, chk.target, key, st);
  // a GPS bomb with nothing designated goes where the CCIP pipper says
  if (m && !chk.target && isLocalHuman && G.ccip) m.est.copy(G.ccip.pos);
  pl.missileCd = w.cls === 'bomb' ? 0.22 : 0.8;
  if (w.cls === 'agm') { pl.agLock = 0; pl.agLocked = false; }
  if (G.stats && isLocalHuman) G.stats.ag++;
  if (w.cls !== 'bomb' && w.cls !== 'gbomb') audio.launch(isLocalHuman ? null : pl.pos);
  if (isLocalHuman) flash(`${AG_CALL[w.cls]} — ${w.name}${chk.why ? ` (${chk.why.split(' — ')[0].toLowerCase()})` : chk.target ? ` → ${chk.target.name}` : ''}`, 1.8);
}

// Time trial: over when every human racer has finished or crashed out.
function raceResult(timeUp) {
  const racers = G.ents.filter((e) => e.human);
  if (!racers.length) return timeUp ? { win: -1, title: 'TIME UP', why: '' } : null;
  const R = G.race;
  const over = racers.every((e) => R.of(e).done || (!e.plane.alive && !(e.respawnT > 0)));
  if (!over && !timeUp) return null;
  const fin = racers.filter((e) => R.of(e).done).sort((a, b) => R.of(a).final - R.of(b).final);
  if (!fin.length) return { win: 1, title: 'DID NOT FINISH', why: timeUp ? 'Time is up' : 'Crashed out of the course' };
  const best = fin[0], st = R.of(best);
  return { win: best.side, title: racers.length > 1 ? `${best.name.toUpperCase()} WINS` : 'COURSE COMPLETE', why: `${fmtTime(st.final)}${st.pen > 0 ? ` incl. ${st.pen.toFixed(1)} s penalty` : ''}`, times: fin.map((e) => [e.name, R.of(e).final]) };
}

function carrierOf(side) { return G.units.find((u) => u.D.deck && u.alive && u.side === side) || null; }
function fmtTime(t) { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; }

// Carrier deck events for a local jet.
function deckEvent(e, ev) {
  const me = e === G.mine, pl = e.plane, cv = pl.landed ? pl.landed.u : null;
  switch (ev) {
    case 'trap':
      if (me) {
        const wire = Math.max(1, Math.min(4, Math.ceil((pl.landed.along + cv.D.deck.len / 2 - 15) / 20)));
        hud.showBanner('TRAP!', `Caught the ${['1', '2', '3', '4'][wire - 1]}-wire${wire === 3 ? ' — perfect' : ''}`, '#9dffb8', 2.5);
        audio.beep(520, 0.2, 0.16);
        if (G.stats) { G.stats.traps++; if (wire === 3) G.stats.perfectTraps = (G.stats.perfectTraps || 0) + 1; }
        if (hooksOut.trap) hooksOut.trap(wire);
      }
      break;
    case 'touch': if (me) flash('NO WIRE — BOLTER! Full power (R) to go around', 2.5); break;
    case 'stopped': if (me) flash('On deck — the crew is rearming and repairing you', 2.5); break;
    case 'rearmed':
      if (me) { flash('REARMED, REFUELLED & REPAIRED — throttle to full power (R) to launch', 3); audio.beep(880, 0.15, 0.12); }
      break;
    case 'launch':
      if (me) flash('CAT SHOT! Gear up (J)', 2);
      if (e.ai) e.ai.relaunched();
      if (me) input.gear = true;
      break;
    case 'bolter': if (me) flash('BOLTER — airborne again, come around and try again', 2.5); break;
    case 'overboard': if (me) G.crashWhy = 'Went off the end of the deck too slow'; killPlane(e, 'crash'); break;
  }
}

// ---------------- wingman radio ----------------
const RADIO = [['attack', 'Attack my target'], ['cover', 'Cover me'], ['rejoin', 'Rejoin on me'], ['ground', 'Attack ground targets'], ['rtb', 'Return to base / rearm'], ['hold', 'Weapons hold'], ['free', 'Weapons free']];
function radioMenu(me) {
  const d = input.digit();
  if (!d) return;
  G.radioMenu = false;
  const c = RADIO[d - 1];
  if (!c) return;
  const P = me.plane;
  const tg = c[0] === 'attack' ? P.tgt : c[0] === 'ground' ? P.agt : null;
  const tgId = tg && tg.ent ? tg.ent.id : -1;
  flash(`${me.name}: "${c[1]}"`, 1.5);
  if (G.mode === 'online' && G.role !== 'host') net.send({ t: 'cmd', to: G.hostId, sl: me.id, c: c[0], tg: tgId });
  else issueCommand(me, c[0], tgId);
}
function issueCommand(lead, c, tgId) {
  const tgt = tgId >= 0 ? resolveSlot(tgId) : null;
  const wing = G.ents.filter((e) => e.ai && e.side === lead.side && e.plane.alive && e !== lead);
  if (!wing.length) { if (lead === G.mine) flash('No AI wingmen on your side', 1.5); return; }
  for (const e of wing) e.ai.order(c, lead.plane, tgt);
  const nm = tgt ? (tgt.unit ? tgt.name : tgt.ent ? tgt.ent.name : 'the bandit') : null;
  const reply = {
    attack: nm ? `Copy, engaging ${nm}.` : 'Copy, engaging. (Designate a target for us first next time.)',
    cover: "Copy, I've got your six.", rejoin: 'Rejoining on you.',
    ground: nm ? `Copy, rolling in on ${nm}.` : 'Copy, hitting ground targets.',
    rtb: carrierOf(lead.side) ? 'Copy, returning to the boat.' : 'Copy, RTB.',
    hold: 'Weapons hold, copy.', free: 'Weapons free, copy.',
  }[c];
  radio(wing[0], `${reply}${wing.length > 1 ? ` (${wing.length} aircraft)` : ''}`);
}

function setTarget(pl, t) {
  if (pl.tgt === t) return;
  pl.tgt = t;
  const R = pl.radar;
  R.contact = false; R.stt = false; R.acq = 0; R.mem = 0;
  pl.lockProgress = 0; pl.locked = false;
}

// Player target designation: automatic (nearest to the nose) unless held by a lock or picked with N.
const _tv = new THREE.Vector3();
function playerTargeting(P, picture, dt, groundMode) {
  G.tgtT -= dt; G.tgtManualT -= dt;
  const known = [...picture.keys()].filter((e) => e.alive);
  const offBore = (e) => { const c = picture.get(e); return Math.acos(Math.max(-1, Math.min(1, _tv.copy(c.pos).sub(P.pos).normalize().dot(P.fwd)))); };
  if (!groundMode && input.tapped('cycle') && known.length) {
    known.sort((a, b) => offBore(a) - offBore(b));
    const i = known.indexOf(P.tgt);
    const next = known[(i + 1) % known.length];
    setTarget(P, next); G.tgtManualT = 12;
    flash(`TARGET — ${next.ent ? next.ent.name : 'bandit'}`, 1.2);
    return;
  }
  const cur = P.tgt;
  const keep = cur && cur.alive && picture.has(cur) && (P.wantStt || P.radar.stt || G.tgtManualT > 0);
  if (keep || G.tgtT > 0) { if (cur && !cur.alive) setTarget(P, null); return; }
  G.tgtT = 0.3;
  let best = null, bs = 1e12;
  for (const e of known) {
    const c = picture.get(e);
    const sc = offBore(e) * 8000 + c.pos.distanceTo(P.pos) * 0.15 + (c.fresh ? 0 : 3000);
    if (sc < bs) { bs = sc; best = e; }
  }
  if (best || (cur && !cur.alive)) setTarget(P, best);
}

// ---------------- camera ----------------
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _off = new THREE.Vector3();
const PITCH_DOWN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.06);
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

function spectateCandidates() {
  const mySide = G.mine ? G.mine.side : null;
  const alive = G.ents.filter((e) => e.plane.alive && e !== G.mine);
  const friends = mySide == null ? alive : alive.filter((e) => e.side === mySide);
  return friends.length ? friends : alive;
}

const _lq2 = new THREE.Quaternion(), _le = new THREE.Euler();
function updateCamera(dt) {
  const P = myPlane();
  if (G.freeCam && P && P.alive && !G.replay) G.freeCam = false;
  if (G.freeCam) { freeCamUpdate(dt); return; }
  if (G.replay) { replayCamera(dt); return; }
  if (G.phase === 'menu') {
    G.attract += dt * 0.03;
    camera.position.set(Math.cos(G.attract) * 9000, 3200, Math.sin(G.attract) * 9000);
    camera.lookAt(0, 1400, 0);
    return;
  }
  if ((!P || !P.alive) && G.death && (G.death.t < 6.5 || !spectateCandidates().length)) {
    // death camera: ride along with the falling wreck, then find the parachute
    const D = G.death, h = D.handle, pl = h.pilot;
    D.t += dt;
    // kill cam: after the first moments, look at the wreck from behind whoever shot you down
    const K = D.killer, kp = K ? (K.unit ? (K.alive ? K.pos : null) : K.plane.alive ? K.plane.pos : null) : null;
    if (kp && D.t > 2.2 && D.t < 6.5) {
      const tgt = h.main ? h.main.pos : D.at;
      _off.subVectors(tgt, kp); const dist = _off.length(); _off.normalize();
      const back = K.unit ? 60 : 38;
      camera.position.copy(kp).addScaledVector(_off, -back); camera.position.y += K.unit ? 25 : 9;
      const gh = groundHeight(camera.position.x, camera.position.z) + 4;
      if (camera.position.y < gh) camera.position.y = gh;
      camera.up.set(0, 1, 0); camera.lookAt(dist > 4000 ? _wt.copy(kp).addScaledVector(_off, 4000) : tgt);
      D.kill = `KILL CAM — ${whoName(K)} · ${(dist / 1000).toFixed(1)} km`;
      return;
    }
    D.kill = null;
    const onPilot = pl && pl.state !== 'wait' && h.t > h.ejectAt + 1.1;
    const target = onPilot ? pl.pos : h.main ? h.main.pos : G.camFocus;
    G.camFocus.lerp(target, 1 - Math.exp(-dt * (onPilot ? 2.2 : 7)));
    D.ang += dt * 0.2;
    const dist = onPilot ? 26 : 34 + 34 * Math.min(1, h.t / 3.5);
    const f = G.camFocus;
    camera.position.set(f.x + Math.cos(D.ang) * dist, f.y + 6 + dist * 0.28, f.z + Math.sin(D.ang) * dist);
    const gh = groundHeight(camera.position.x, camera.position.z) + 4;
    if (camera.position.y < gh) camera.position.y = gh;
    camera.up.set(0, 1, 0);
    camera.lookAt(f);
    return;
  }
  if (!P || !P.alive) {
    // spectate: chase camera behind a teammate (N cycles)
    const cands = spectateCandidates();
    if (!G.spectate || !G.spectate.plane.alive || !cands.includes(G.spectate) || input.tapped('cycle')) {
      const i = cands.indexOf(G.spectate);
      const next = cands.length ? cands[(i + 1) % cands.length] : null;
      if (next !== G.spectate) { G.spectate = next; if (next) G.specQuat.copy(next.plane.quat); }
    }
    const S = G.spectate;
    if (!S) return;
    _q.copy(S.plane.quat).multiply(PITCH_DOWN);
    G.specQuat.slerp(_q, 1 - Math.exp(-dt * 5));
    camera.quaternion.copy(G.specQuat);
    _off.set(0, 6, 32).applyQuaternion(G.specQuat);
    camera.position.copy(S.plane.pos).add(_off);
    const gh = groundHeight(camera.position.x, camera.position.z) + 3;
    if (camera.position.y < gh) camera.position.y = gh;
    return;
  }
  const target = P.tgt && P.tgt.alive && P.contacts && (P.contacts.has(P.tgt) || P.radar.contact) ? P.tgt : null;
  const lookBack = input.held('lookBack');
  // free look: drag the mouse to look around, or hold , . / for snap views; release to snap back
  const L = G.look, m = input.mouse;
  if (input.tapped('lookWing')) {
    const fr = G.sides[G.mine.side].filter((e) => e !== G.mine && e.plane.alive).sort((a, b) => a.plane.pos.distanceTo(P.pos) - b.plane.pos.distanceTo(P.pos));
    const again = performance.now() - L.wingT < 2500 && L.wing && fr.includes(L.wing);
    L.wing = fr.length ? (again ? fr[(fr.indexOf(L.wing) + 1) % fr.length] : fr[0]) : null;
    flash(L.wing ? `LOOKING AT ${L.wing.name} · ${(L.wing.plane.pos.distanceTo(P.pos) / 1000).toFixed(1)} km${fr.length > 1 ? ' — tap U again for the next' : ''}` : 'NO WINGMAN TO LOOK AT', 1.4);
  }
  if (input.held('lookWing')) L.wingT = performance.now();
  const wing = input.held('lookWing') && L.wing && L.wing.plane.alive ? L.wing.plane : null;
  let ty = 0, tp = 0;
  if (m.down) { L.my = Math.max(-2.9, Math.min(2.9, L.my - m.dx * 0.004)); L.mp = Math.max(-1.1, Math.min(1.45, L.mp - m.dy * 0.004)); ty = L.my; tp = L.mp; }
  else {
    L.my = L.mp = 0;
    if (input.held('lookLeft')) { ty = 1.6; tp = 0.12; } else if (input.held('lookRight')) { ty = -1.6; tp = 0.12; }
    if (input.held('lookUp')) tp = 1.25;
  }
  const kl = m.down ? 1 : 1 - Math.exp(-dt * 10);
  L.yaw += (ty - L.yaw) * kl; L.pitch += (tp - L.pitch) * kl;
  const looking = Math.abs(L.yaw) > 0.002 || Math.abs(L.pitch) > 0.002;
  if (wing) { _m4.lookAt(P.pos, wing.pos, P.up); _q.setFromRotationMatrix(_m4); }
  else if (G.padlock && target) { _m4.lookAt(P.pos, target.pos, P.up); _q.setFromRotationMatrix(_m4); }
  else if (lookBack) _q.copy(P.quat).multiply(FLIP);
  else {
    _q.copy(P.quat);
    if (looking) _q.multiply(_lq2.setFromEuler(_le.set(L.pitch, L.yaw, 0, 'YXZ')));
    if (G.camMode === 'chase') _q.multiply(PITCH_DOWN);
  }
  if (L.wasWing && !wing) L.back = 0.35;   // ease back from the wingman instead of jumping
  L.wasWing = !!wing; L.back = Math.max(0, L.back - dt);
  const k = G.camMode === 'cockpit' && !G.padlock && !lookBack && !wing && L.back <= 0 ? 1 : 1 - Math.exp(-dt * (G.padlock || wing ? 7 : 9));
  G.camQuat.slerp(_q, k);
  camera.quaternion.copy(G.camQuat);
  if (G.camMode === 'cockpit') camera.position.copy(P.pos).addScaledVector(P.up, 1.5).addScaledVector(P.fwd, 4.3);
  else { _off.set(0, 4.2, 21).applyQuaternion(G.camQuat); camera.position.copy(P.pos).add(_off); }
  const gh = groundHeight(camera.position.x, camera.position.z) + 2;
  if (camera.position.y < gh) camera.position.y = gh;
}

// ---------------- HUD helpers ----------------
const _pv = new THREE.Vector3();
function project(v) {
  _pv.copy(v).applyMatrix4(camera.matrixWorldInverse);
  const behind = _pv.z > -0.1;
  _pv.applyMatrix4(camera.projectionMatrix);
  return { x: (_pv.x * 0.5 + 0.5) * W, y: (-_pv.y * 0.5 + 0.5) * H, behind };
}
function camSpace(v) { return v.clone().applyMatrix4(camera.matrixWorldInverse); }

// ---------------- per-plane visual effects ----------------
const _wt = new THREE.Vector3();
function planeEffects(e, dt) {
  const plane = e.plane;
  const jet = ensureModel(e);
  jet.group.visible = plane.alive;
  if (!plane.alive) return;
  jet.group.position.copy(plane.pos);
  jet.group.quaternion.copy(plane.quat);
  jet.setThrottle(plane.eng ?? plane.throttle, G.time);
  jet.setStores(plane.stores);
  const g = plane.g ?? 1, alpha = plane.alpha ?? 0;
  if (g > 5 || alpha > 0.22) {
    const a = Math.min(0.5, (g - 4.5) * 0.08 + Math.max(0, alpha - 0.2));
    for (const s of [-1, 1]) {
      _wt.set(s * jet.tip[0], jet.tip[1], jet.tip[2]).applyQuaternion(plane.quat).add(plane.pos);
      effects.vapor(_wt, plane.vel, a);
    }
  }
  if (plane.hp < 50) {
    _wt.set(0, 0.5, jet.model.nozzles[0].z - 1.5).applyQuaternion(plane.quat).add(plane.pos);
    if (Math.random() < dt * 30) effects.damageSmoke(_wt, plane.vel, plane.hp);
  }
}

// ---------------- main loop ----------------
const PHYS_DT = 1 / 120;
let acc = 0, last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  if (!(dt >= 0)) dt = 0;
  G.time += dt;

  if (input.tapped('pause') && G.replay) stopReplay();
  else if (input.tapped('pause') && G.mode) togglePause();
  if (input.tapped('freeCam') && G.mode && (G.replay || !myPlane() || !myPlane().alive)) toggleFreeCam();
  if (input.tapped('help') && G.mode) $('help').classList.toggle('show');
  if (input.tapped('camera')) G.camMode = G.camMode === 'chase' ? 'cockpit' : 'chase';
  if (input.tapped('map') && G.mode && !G.replay) {
    const steps = [10000, 20000, 40000, 80000, 0], cur = settings.mapRange === 0 ? 0 : settings.mapRange || 40000;
    settings.mapRange = steps[(steps.indexOf(cur) + 1) % steps.length]; saveSettings();
    flash(settings.mapRange ? `MAP ${settings.mapRange / 1000} KM` : 'MAP OFF', 1);
  }
  if (input.tapped('padlock')) { G.padlock = !G.padlock; flash(G.padlock ? 'PADLOCK / HELMET CUE ON' : 'PADLOCK OFF', 1); }

  const inGame = G.mode && G.phase !== 'menu';
  const simRunning = inGame && !(G.paused && G.mode === 'ai');
  const P = myPlane();
  input.enabled = !G.paused && !!P && P.alive;

  if (G.slowT > 0 && G.mode === 'ai') {
    G.slowT -= dt;
    const e = 2.4 - G.slowT;
    G.timeScale = e < 0.9 ? 0.25 : 0.25 + 0.75 * Math.min(1, (e - 0.9) / 1.5);
  } else G.timeScale = 1;
  const sdt = dt * G.timeScale;

  if (G.replay) replayStep(dt);
  else if (simRunning) step(sdt, now);

  updateCamera(dt);
  if (G.shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * G.shake; camera.position.y += (Math.random() - 0.5) * G.shake; camera.position.z += (Math.random() - 0.5) * G.shake;
    camera.rotateZ((Math.random() - 0.5) * G.shake * 0.01);
    G.shake *= Math.exp(-dt * 3.5);
  }
  world.update(camera, dt);
  effects.update(simRunning ? sdt : 0);
  wrecks.update(simRunning ? sdt : 0);
  if (inGame) unitView.update(simRunning ? sdt : 0, G.time);
  if (inGame) for (const e of G.ents) planeEffects(e, sdt);

  if (!G.noRender) { if (G.replay) { hud.draw({ active: false }, dt); updateReplayBar(); } else drawHud(dt); }
  audio.listenerPos = camera.position;
  audio.listenerQuat = camera.quaternion;
  audio.listenerVel = P && P.alive ? P.vel : null;
  if (inGame && G.phase === 'countdown') {
    const n = Math.ceil(G.phaseT);
    if (n !== G.lastBeep && n > 0 && n <= 3) audio.beep(660, 0.12, 0.12);
    G.lastBeep = n;
  } else G.lastBeep = null;
  const T = inGame && G.threat ? G.threat : null;
  // the loudest other jet: the nearest one
  let near = null, nd = 1e12;
  if (inGame) for (const e of G.ents) { if (e.plane === P || !e.plane.alive) continue; const d = e.plane.pos.distanceToSquared(camera.position); if (d < nd) { nd = d; near = e.plane; } }
  const A = P || { alive: false, eng: 0, speed: 0, g: 1, firing: false, locked: false, inCone: false, lockProgress: 0, alpha: 0, airbrake: false, gloc: 0, radar: {} };
  audio.update(dt, {
    rwr: T ? { search: T.search, lock: T.lock, launch: T.launch, active: T.active, maws: T.maws } : null,
    mrmTrack: A.weapon === 'mrm' && A.radar.stt,
    active: inGame && !G.replay && !(G.paused && G.mode === 'ai'), alive: A.alive, eng: A.eng, speed: A.speed, g: A.g,
    firing: A.firing, locked: A.locked, inCone: A.inCone, lockProgress: A.lockProgress, threatDist: T ? T.nearest : 1e9, cockpit: G.camMode === 'cockpit',
    alpha: A.alpha, airbrake: A.airbrake, gloc: A.gloc, pullUp: inGame && G.pullUp,
    opp: near,
  });

  if (!G.noRender) renderer.render(scene, camera);
  input.endFrame();
}

function sideHome(k) { const s = G.scn.sides[k]; return new THREE.Vector3(s.x * 0.6, 3000, s.z * 0.6); }
function sideStart(k) { const s = G.scn.sides[k]; return new THREE.Vector3(s.x, s.alt, s.z); }
// AI radio calls go to the kill feed (and from the host to everyone online)
function radio(e, text) {
  const line = `${e.name}: ${text}`, color = SIDE_COLORS[e.side];
  feed(line, color);
  if (G.mode === 'online' && G.role === 'host') net.send({ t: 'feed', text: line, c: color });
}

function step(dt, now) {
  G.phaseT -= dt;
  if (G.msgT > 0) G.msgT -= dt;
  for (const f of G.feed) f.t -= dt;
  while (G.feed.length && G.feed[G.feed.length - 1].t <= 0) G.feed.pop();
  if (G.phase === 'fight') G.roundT += dt;

  // ---- round flow (host / practice) ----
  if (isAuthority()) {
    G.phaseSendT -= dt;
    if (G.phaseSendT <= 0) { G.phaseSendT = 1; sendPhase(); }
    if (G.phase === 'countdown' && G.phaseT <= 0) { setPhase('fight'); sendPhase(); }
    else if (G.phase === 'fight') {
      G.mission.update(dt);
      const alive = [0, 1].map((k) => G.sides[k].filter((e) => e.plane.alive || e.respawnT > 0).length);
      const timeUp = G.scn.timeLimit > 0 && G.roundT >= G.scn.timeLimit * 60;
      const res = G.race ? raceResult(timeUp) : G.scn.mode === 'training' ? (G.lesson && G.lesson.finished && G.lesson.doneFlash <= 0.2 ? { win: 0, why: 'Lesson complete', lesson: true } : null) : G.mission.check(alive, timeUp);
      if (res) {
        const win = res.win;
        if (win >= 0) G.rw[win]++;
        const sd = G.scn.sides;
        const title = G.race ? res.title : res.lesson ? 'LESSON COMPLETE' : G.scn.mode === 'survival' ? (win === 0 ? 'SURVIVED!' : 'MISSION FAILED') : win < 0 ? 'ROUND DRAWN' : `${sd[win].name.toUpperCase()} WINS THE ROUND`;
        hud.showBanner(title, res.why || (timeUp ? 'Time is up' : ''), win < 0 ? '#ffffff' : SIDE_COLORS[win], 3.5);
        if (G.mode === 'online') net.send({ t: 'banner', text: title, sub: res.why || '', c: win < 0 ? '#ffffff' : SIDE_COLORS[win], d: 3.5 });
        G.lastResult = res;
        if (hooksOut.roundEnd) hooksOut.roundEnd(res);
        setPhase('roundEnd', 7.5); sendPhase();
      }
    } else if (G.phase === 'roundEnd' && G.phaseT <= 0) {
      if (Math.max(...G.rw) >= G.scn.rounds) { setPhase('matchEnd'); sendPhase(); }
      else { startRound(G.round + 1); sendPhase(); }
      return;
    }
  }

  const P = myPlane(), me = G.mine;
  const sidePlanes = [G.sides[0].map((e) => e.plane), G.sides[1].map((e) => e.plane)];
  const all = G.ents.map((e) => e.plane);
  const enemyMsl = [combat.enemyMissiles(0), combat.enemyMissiles(1)];
  // ground units: what each side can attack, and the radars each side's RWR can hear
  const enemyUnits = [G.units.filter((u) => u.side === 1 && u.alive), G.units.filter((u) => u.side === 0 && u.alive)];
  const emitters = [[...sidePlanes[1], ...enemyUnits[0].filter((u) => u.radarT)], [...sidePlanes[0], ...enemyUnits[1].filter((u) => u.radarT)]];

  // ---- ground units and ships (host / practice) ----
  if (isAuthority() && G.units.length) {
    G.wakeT -= dt;
    if (G.wakeT <= 0) {
      // early-warning radars cue their side's ambush SAM sites
      G.wakeT = 1;
      for (const k of [0, 1]) G.wake[k] = G.units.some((u) => u.alive && u.D.ewr && u.side === k && u.radarMode > 0 && sidePlanes[1 - k].some((p) => p.alive && u.canSee(p.pos)));
    }
    for (const u of G.units) {
      if (!hot()) { u.prevPos.copy(u.pos); continue; }
      u.update(dt, { enemies: sidePlanes[1 - u.side], combat, wake: G.wake[u.side], say: (t) => missionApi.say(t, SIDE_COLORS[u.side]), onLaunch: (x, m) => { audio.launch(x.pos); } });
    }
  } else if (G.units.length) {
    // guests: tracers from AAA and ship guns are visual only (the host detects the hits)
    for (const u of G.units) {
      if (!u.alive || !u.firing || !u.gunT) continue;
      if (u.lockTgt) { u.fwd.copy(u.lockTgt.pos).sub(u.pos).normalize(); u.right.crossVectors(u.fwd, _tv.set(0, 1, 0)).normalize(); u.up.crossVectors(u.right, u.fwd); }
      u.gunAcc = (u.gunAcc || 0) + dt * u.gunT.rate;
      while (u.gunAcc >= 1) { u.gunAcc -= 1; combat.fireBullet(u, false); }
    }
  }

  // ---- back into the fight (respawn rules) ----
  for (const e of G.ents) {
    if (!e.local || e.plane.alive || !(e.respawnT > 0)) continue;
    e.respawnT -= dt;
    if (e.respawnT <= 0 && hot()) {
      respawnEnt(e);
      if (G.mode === 'online') { const p = e.plane.pos; net.send({ t: 'respawn', sl: e.id, p: [p.x, p.y, p.z] }); }
    }
  }

  // ---- decisions ----
  const pin = input.flight(dt);
  for (const e of G.ents) {
    if (!e.local) continue;
    e.plane.prevPos.copy(e.plane.pos);
    if (!e.ai) continue;
    const pl = e.plane, enemies = sidePlanes[1 - e.side], friends = sidePlanes[e.side];
    if (!pl.alive) continue;
    scanContacts(pl, enemies, dt);
    const picture = datalinkPicture(pl, friends);
    const lead = G.sides[e.side].find((x) => x.plane.alive);
    const ctx = { friends, enemies, picture, home: sideHome(1 - e.side), base: sideStart(e.side), anchor: sideStart(e.side), lead: lead && lead.plane, idx: e.idx, say: (t) => radio(e, t),
      route: e.route, ground: enemyUnits[e.side], priority: G.marked, carrier: carrierOf(e.side) };
    setTarget(pl, e.ai.pickTarget(enemies, picture, ctx));
    const threat = assessThreatsMulti(pl, emitters[e.side], enemyMsl[e.side]);
    const out = e.ai.update(dt, pl.tgt, combat, threat, ctx);
    e.aiOut = out;
    const a = e.aiIn;
    a.pitch = out.pitch; a.roll = out.roll; a.yaw = out.yaw; a.throttle = out.throttle; a.airbrake = out.airbrake; a.gear = out.gear; a.flaps = out.flaps;
  }

  // ---- physics ----
  acc += dt;
  while (acc >= PHYS_DT) {
    acc -= PHYS_DT;
    for (const e of G.ents) {
      if (!e.local || !e.plane.alive) continue;
      const pl = e.plane, inp = e === me ? pin : e.aiIn;
      if (pl.landed) { const ev = deckStep(pl, PHYS_DT, inp, !!e.ai); if (ev) deckEvent(e, ev); continue; }
      if (pl.step(PHYS_DT, inp, G.surface) === 'crash') {
        const cv = G.units.find((u) => u.D.deck && u.alive && u.onDeck(pl.pos) && pl.pos.y > u.base + u.D.deck.y - 6);
        if (cv) {
          const r = tryLand(pl, cv);
          if (r.ok) { land(pl, cv, r); deckEvent(e, r.trap ? 'trap' : 'touch'); continue; }
          if (e === me) G.crashWhy = r.why;
        }
        killPlane(e, 'crash');
        continue;
      }
      // AI on short final: its trap is assisted
      if (e.ai && e.aiOut && e.aiOut.land) {
        const cv = carrierOf(e.side);
        if (cv && cv.onDeck(pl.pos)) {
          const q = cv.toDeck(pl.pos), D = cv.D.deck;
          land(pl, cv, { trap: true, along: Math.max(q.along, -D.len / 2 + 30), across: Math.max(-8, Math.min(8, q.across)) });
          deckEvent(e, 'trap');
        }
      }
    }
  }
  for (const e of G.ents) { if (e.local) e.plane.updateAxes(); else e.plane.update(now, dt); }

  // ---- time trial gates ----
  if (G.race && hot()) {
    for (const e of G.ents) {
      if (!e.human) continue;
      const pl = e.plane;
      e.racePrev = e.racePrev || pl.pos.clone();
      const ev = G.race.update(e, dt, e.racePrev);
      e.racePrev.copy(pl.pos);
      if (!ev || e !== me) continue;
      const st = G.race.of(e);
      if (ev === 'finish') { hud.showBanner('FINISHED', `${fmtTime(st.final)}${st.pen > 0 ? ` (incl. ${st.pen.toFixed(1)} s penalty)` : ''}`, '#9dffb8', 4); audio.beep(1320, 0.4, 0.15); if (hooksOut.raceFinish) hooksOut.raceFinish(st); }
      else { audio.beep(ev === 'lap' ? 1100 : 990, 0.12, 0.12); flash(ev === 'lap' ? `LAP ${st.lap}/${G.scn.laps} · ${fmtTime(st.t + st.pen)}` : `GATE ${st.next}/${G.race.gates.length} · ${fmtTime(st.t + st.pen)}`, 1.2); }
    }
    const P0 = myPlane();
    if (P0) { const st = G.race.of(G.mine); gateView.update(st.next, st.done); }
  }

  // ---- gear overspeed: the gear doors blow off the flaps / gear get sucked up ----
  if (P && P.alive && !P.landed && P.gear && P.speed > GEAR_VMAX + 15) { input.gear = false; flash('GEAR UP — overspeed', 1.5); }

  // ---- arena boundary (local jets) ----
  for (const e of G.ents) {
    const pl = e.plane;
    if (!e.local || !pl.alive) continue;
    if (pl.landed) { pl.outOfBounds = 0; continue; }
    if (Math.hypot(pl.pos.x, pl.pos.z) > ARENA_RADIUS || pl.pos.y > 16000) {
      pl.outOfBounds += dt;
      if (pl.outOfBounds > 10) applyDamage(e, 25 * dt, 'bounds');
    } else pl.outOfBounds = 0;
  }

  // ---- my sensors + weapons ----
  let picture = new Map();
  if (P) {
    const enemies = sidePlanes[1 - me.side], friends = sidePlanes[me.side];
    // friendly jets' radars feed my datalink picture (remote friends too: their sensors are simulated here)
    for (const f of friends) if (f !== P && !(f.ent && f.ent.ai)) scanContacts(f, enemies, dt);
    scanContacts(P, enemies, dt);
    picture = datalinkPicture(P, friends);
    if (input.tapped('radio') && P.alive && !G.paused) { G.radioMenu = !G.radioMenu; if (G.radioMenu) audio.beep(1500, 0.05, 0.08); }
    else if (P.alive && !G.paused && G.radioMenu) radioMenu(me);
    else if (P.alive && !G.paused) {
      playerTargeting(P, picture, dt, P.weapon === 'ag');
      if (input.tapped('selAg')) {
        const kinds = agKinds(P.stores);
        if (!kinds.length) flash(JETS[P.type].loadouts.strike || JETS[P.type].loadouts.cas ? 'NO A/G STORES — pick a strike loadout in the hangar' : 'NO A/G STORES', 1.6);
        else {
          const i = P.weapon === 'ag' ? kinds.indexOf(P.agKey) : -1;
          P.weapon = 'ag'; P.agKey = kinds[(i + 1) % kinds.length]; P.agLock = 0; P.agLocked = false;
          const w = WEAPONS[P.agKey];
          flash(`${AG_LABEL[w.cls] || 'A/G'} — ${w.name} ×${countKey(P.stores, P.agKey)}${kinds.length > 1 ? '  (3: next store)' : ''}`, 1.6);
        }
      }
      if (input.tapped('selSrm')) { P.weapon = 'srm'; flash(countOf(P.stores, 'srm') ? `SRM — ${WEAPONS[firstOf(P.stores, 'srm')].name}` : 'SRM — none left', 1.2); }
      if (input.tapped('selMrm')) {
        if (countOf(P.stores, 'mrm')) { P.weapon = 'mrm'; flash(`MRM — ${WEAPONS[firstOf(P.stores, 'mrm')].name}`, 1.2); }
        else flash('NO RADAR MISSILES LOADED', 1.2);
      }
      if (input.tapped('radarLock')) {
        P.wantStt = !P.wantStt;
        flash(P.wantStt ? (P.tgt ? `RADAR LOCKING ${P.tgt.ent ? P.tgt.ent.name : ''}…` : 'RADAR LOCK — no target yet') : 'RADAR LOCK OFF', 1.2);
      }
    }
    const hadStt = P.radar.stt;
    updateRadar(P, P.tgt, dt, P.wantStt, combat.chaff);
    if (hadStt && !P.radar.stt && P.radar.lostMsg > 0) flash(P.radar.notched ? 'LOCK BROKEN — target in the notch' : P.radar.masked ? 'LOCK BROKEN — target behind terrain' : 'LOCK BROKEN', 1.6);
    if (P.radar.lostMsg > 0) P.radar.lostMsg -= dt;
    P.lockTgt = P.radar.stt ? P.tgt : null;
    updateIrst(P, P.tgt, dt);
    const tc = P.tgt && picture.get(P.tgt);
    const eyes = !!(tc && tc.eyes);
    const srmKey = P.weapon === 'srm' ? firstOf(P.stores, 'srm') : null;
    updateIrLock(P, P.tgt, dt, srmKey, (G.padlock && eyes && P.T.hmd) || P.radar.stt || P.irst.fresh);
    // air-to-ground: what I know is down there, the designated target and the seeker
    if (P.weapon === 'ag' && (!P.agKey || !countKey(P.stores, P.agKey))) {
      const kinds = agKinds(P.stores);
      if (kinds.length) P.agKey = kinds[0]; else { P.weapon = countOf(P.stores, 'srm') ? 'srm' : 'mrm'; P.agKey = null; flash('A/G STORES EXPENDED', 1.5); }
    }
    G.groundT -= dt;
    if (G.groundT <= 0) { G.groundT = 0.5; G.ground = scanGround(P, G.units, G.marked); }
    if (P.weapon === 'ag' && P.alive) {
      const w = WEAPONS[P.agKey];
      const ok = w.cls === 'ashm' ? (u) => u.D.ship : w.cls === 'arm' ? (u) => !!u.radarT : null;
      const cyc = input.tapped('cycle') && !G.radioMenu;
      P.agt = pickGround(P, G.ground, P.agt, cyc, ok);
      if (cyc) flash(P.agt ? `GROUND TARGET — ${P.agt.name} (${P.agt.fullName})` : 'NO GROUND TARGETS KNOWN', 1.4);
      updateAgLock(P, P.agKey, P.agt, dt);
      G.ccip = w.cls === 'bomb' || w.cls === 'rkt' || w.cls === 'gbomb' ? impactPoint(P, P.agKey, G.ccipV || (G.ccipV = new THREE.Vector3())) : null;
    } else { P.agLock = 0; P.agLocked = false; G.ccip = null; }
    handleWeapons(me, { gun: input.held('gun'), missile: input.tapped('missile') || (P.weapon === 'ag' && WEAPONS[P.agKey] && WEAPONS[P.agKey].cls === 'rkt' && input.held('missile')), flare: input.held('flare'), chaff: input.held('chaff') }, P.tgt, dt, true);
    G.threat = assessThreatsMulti(P, emitters[me.side], enemyMsl[me.side]);
    // launch zone for the selected missile against the designated target
    G.dlzT -= dt;
    if (G.dlzT <= 0) {
      G.dlzT = 0.25;
      const key = P.weapon === 'ag' ? null : firstOf(P.stores, P.weapon), O = P.tgt;
      if (key && O && O.alive && P.alive) {
        const rel = _tv.copy(O.pos).sub(P.pos), d = rel.length();
        const closing = -rel.dot(O.vel) / Math.max(d, 1);
        G.dlz = { key, ...launchZone(flyout(key, P.speed, airDensity(P.pos.y)), closing, O.vel.length()) };
      } else G.dlz = null;
    }
  }
  G.picture = picture;

  // ---- AI sensors + weapons ----
  for (const e of G.ents) {
    if (!e.ai || !e.aiOut) continue;
    const pl = e.plane, out = e.aiOut, tgt = pl.tgt;
    pl.weapon = out.weapon;
    if (out.weapon === 'ag') { pl.agKey = out.agKey; pl.agt = out.agTgt; pl.agLocked = true; }
    updateRadar(pl, tgt, dt, out.wantStt, combat.chaff);
    pl.lockTgt = pl.radar.stt ? tgt : null;
    updateIrst(pl, tgt, dt);
    const aiEyes = tgt && tgt.alive && canSee(pl, tgt) && pl.T.hmd;
    updateIrLock(pl, tgt, dt, pl.weapon === 'srm' ? firstOf(pl.stores, 'srm') : null, pl.radar.stt || pl.irst.fresh || aiEyes);
    handleWeapons(e, out, tgt, dt, false);
  }

  // ---- remote jets: tracers are visual only, the shooter's client detects hits ----
  for (const e of G.ents) {
    const O = e.plane;
    if (e.local || !O.alive || !O.firing || !O.gunT || O.gunT.rate <= 0) continue;
    O.gunAcc += dt * O.gunT.rate;
    while (O.gunAcc >= 1) { O.gunAcc -= 1; combat.fireBullet(O, false); }
    effects.muzzle(combat.gunMuzzle(O), O.vel);
  }

  combat.update(dt, all, now, G.mode === 'online' ? net.oneWay : 0);

  // ---- flight recorder, career flight time ----
  if (G.phase === 'fight' || G.phase === 'roundEnd') rec.update(dt, G.ents, G.units, combat.enemyMissiles(-1));
  if (G.phase === 'fight' && P && P.alive && G.stats) G.stats.flight += dt;
  if (G.mission && G.mission.sv && G.mine && G.mission.sv.wave > (G.waveSeen || 0)) { G.waveSeen = G.mission.sv.wave; if (G.waveSeen > 1) profile.wave(G.waveSeen - 1); }

  // ---- training lesson ----
  if (G.lesson && G.phase === 'fight' && me && P) lessonDriver(dt, me);
  if (G.lesson && G.phase === 'fight' && me && P) {
    if (G.lesson.update(dt, lessonContext(me, enemyMsl[me.side]))) {
      audio.beep(1560, 0.12, 0.12); setTimeout(() => audio.beep(2080, 0.16, 0.12), 120);
      if (G.lesson.finished) { hud.showBanner('LESSON COMPLETE', LESSONS[G.lesson.key].name, '#9dffb8', 4); if (hooksOut.lesson) hooksOut.lesson(G.lesson); }
    }
  }

  // ---- network send ----
  if (G.mode === 'online') {
    const missilesOf = (pl) => {
      const ms = [];
      for (const m of combat.missiles) if (m.owner === pl) ms.push([m.id, ...[m.pos.x, m.pos.y, m.pos.z, m.vel.x, m.vel.y, m.vel.z].map((x) => Math.round(x * 10) / 10), m.w.code, Combat.flags(m), m.target && m.target.ent ? m.target.ent.id : -1]);
      return ms;
    };
    G.sendT -= dt;
    if (G.sendT <= 0 && me && me.local) {
      G.sendT = 1 / 30;
      net.send(packState(P, { sl: me.id, r: G.round, rt: P.lockTgt && P.lockTgt.ent ? P.lockTgt.ent.id : -1, m: missilesOf(P) }));
    }
    G.aiSendT -= dt;
    if (G.aiSendT <= 0 && G.role === 'host') {
      G.aiSendT = 1 / 20;
      const l = [];
      for (const e of G.ents) {
        if (!e.local || e === me) continue;
        const pl = e.plane;
        const st = packState(pl, { sl: e.id, rt: pl.lockTgt && pl.lockTgt.ent ? pl.lockTgt.ent.id : -1, m: missilesOf(pl) });
        delete st.t;
        l.push(st);
      }
      if (l.length) net.send({ t: 'S', r: G.round, l });
    }
    G.unitSendT -= dt;
    if (G.unitSendT <= 0 && G.role === 'host' && G.units.length) {
      G.unitSendT = 0.2;
      const ms = [];
      for (const u of G.units) { const x = missilesOf(u); if (x.length || u.hadMsl) ms.push([u.id, x]); u.hadMsl = x.length > 0; }
      net.send({ t: 'U', r: G.round, u: packUnits(G.units), m: ms });
    }
  }
}

const DEAD = { alive: false, hp: 0 };

// Scripted launches for the missile-defence lessons: place the red aggressor relative to the
// student, give its radar a few seconds to lock, fire (a salvo 2.5 s apart), then wait until
// every missile is gone before setting up the next shot.
const _lq = new THREE.Matrix4(), _lup = new THREE.Vector3(0, 1, 0);
function lessonDriver(dt, me) {
  const L = G.lesson, S = L.step, F = S && S.fire, P = me.plane;
  const agE = G.ents.find((e) => e.side !== me.side && e.ai);
  if (!agE) return;
  const A = agE.plane;
  A.lessonTgt = F && P.alive ? P : null;
  if (!F || !P.alive || !A.alive) return;
  const live = combat.missiles.some((m) => m.owner === A && !m.lost && !m.decoy);
  L.fireT -= dt;
  if (L.fs === 'wait') {
    if (live) { L.fireT = Math.max(L.fireT, 2.5); return; }
    if (L.fireT > 0) return;
    // set up the shot (the instructor patches up and restocks the student between shots)
    if (P.hp < 100) { repair(P); feed('Instructor: damage repaired.', '#9dffb8'); }
    P.chaff = Math.max(P.chaff, P.T.chaff); P.flares = Math.max(P.flares, P.T.flares);
    const hf = Math.hypot(P.fwd.x, P.fwd.z) || 1, s = F.from === 'behind' ? -1 : 1;
    const pos = new THREE.Vector3(P.pos.x + (P.fwd.x / hf) * F.range * s, 0, P.pos.z + (P.fwd.z / hf) * F.range * s);
    pos.y = Math.max(P.pos.y + (F.dAlt || 0), groundHeight(pos.x, pos.z) + 600);
    const q = new THREE.Quaternion().setFromRotationMatrix(_lq.lookAt(pos, P.pos, _lup));
    A.reset(pos, q, 230, agE.loadout); A.contacts = new Map(); A.lessonTgt = P;
    if (agE.ai) agE.ai.reset();
    L.fs = 'aim'; L.fireT = F.aim ?? 5; L.left = F.salvo || 1;
    radio(agE, F.from === 'behind' ? 'Tally, sliding in at your six.' : `Contact, ${Math.round(F.range / 1000)} km, hot.`);
  } else if (L.fs === 'aim') {
    if (L.fireT > 0) return;
    L.fs = 'fire'; L.fireT = 0;
  }
  if (L.fs === 'fire' && L.fireT <= 0) {
    combat.launchMissile(A, P, F.key, 0);
    audio.launch(A.pos);
    radio(agE, WEAPONS[F.key].guidance === 'ir' ? 'Fox 2!' : 'Fox 3!');
    L.left--; L.fireT = 2.5;
    if (L.left <= 0) { L.fs = 'wait'; L.fireT = 4; }
  }
}

// What a training lesson's steps look at.
function lessonContext(me, msl) {
  const P = me.plane, tgt = P.tgt;
  const mk = G.scn.markers[0];
  const agW = P.weapon === 'ag' && P.agKey ? WEAPONS[P.agKey] : null;
  return {
    alive: P.alive, hp: P.hp, alt: P.pos.y, agl: P.pos.y - groundHeight(P.pos.x, P.pos.z), vy: P.vel.y, speed: P.speed, g: P.g,
    bank: Math.asin(Math.max(-1, Math.min(1, P.right.y))), throttle: P.throttle, airbrake: P.airbrake, gear: P.gear, flaps: P.flaps,
    weapon: P.weapon, agCls: agW ? agW.cls : null, agLocked: !!P.agLocked, locked: !!P.locked, stt: !!P.radar.stt,
    tgtDist: tgt && tgt.alive ? tgt.pos.distanceTo(P.pos) : 1e9, markDist: mk ? Math.hypot(P.pos.x - mk.x, P.pos.z - mk.z) : 1e9,
    landed: P.landed ? P.landed.phase : null, kills: me.kills, gk: me.groundKills || 0, units: G.units, stats: G.stats,
    threats: msl.filter((m) => m.target === P && m.phase !== 'none').length, padlock: !!G.padlock, chaff: P.chaff, flares: P.flares,
  };
}
function drawHud(dt) {
  const inGame = G.mode && G.phase !== 'menu';
  if (!inGame) { hud.draw({ active: false }, dt); return; }
  const P = myPlane(), me = G.mine;
  const teams = G.scn.sides.map((sd, k) => ({ name: sd.name.toUpperCase(), color: SIDE_COLORS[k], won: G.rw[k], alive: G.sides[k].filter((e) => e.plane.alive).length, total: G.sides[k].length }));
  const sepKm = Math.round(Math.hypot(G.scn.sides[0].x - G.scn.sides[1].x, G.scn.sides[0].z - G.scn.sides[1].z) / 1000);
  const base = {
    active: true, teams, feed: G.feed, roundsToWin: G.scn.rounds,
    timeLeft: G.scn.timeLimit > 0 ? Math.max(0, G.scn.timeLimit * 60 - G.roundT) : null,
    countdown: G.phase === 'countdown' ? G.phaseT : 0,
    lesson: G.lesson ? G.lesson.hud() : null,
    countdownMsg: G.lesson ? `TRAINING — ${LESSONS[G.lesson.key].name.toUpperCase()}` : G.scn.mode === 'training' ? 'FREE FLIGHT' : G.race ? `TIME TRIAL — fly through the ${G.race.gates.length} gates in order${G.scn.ceiling ? `, stay below ${G.scn.ceiling} m above the ground` : ''}` : G.scn.mode === 'survival' ? 'SURVIVAL — hold out against wave after wave. Land on the carrier to rearm.' : sepKm <= 10 ? 'WEAPONS SAFE — MERGE INBOUND' : `WEAPONS SAFE — ENEMY ABOUT ${sepKm} KM AHEAD, FIND THEM ON RADAR`,
    msg: G.msgT > 0 ? G.msg : '', ping: G.mode === 'online' ? net.rtt : null,
    project, camSpace, camPos: camera.position,
    ...missionHud(me),
  };
  if (!P || !P.alive) {
    const S = G.spectate;
    const deathCam = G.death && G.death.t < 6.5 && P;
    hud.draw({ ...base, plane: P || DEAD, radar: {}, lock: {}, spectate: deathCam && G.death.kill ? G.death.kill : G.freeCam ? 'FREE CAMERA — WASD move, R/F up/down, drag the mouse or arrows to look, wheel = speed, P to exit' : !deathCam && S ? `SPECTATING ${S.name} · ${jetOf(S.plane.type).name}   (N: next · P: free camera)` : null }, dt);
    return;
  }
  const R = P.radar;
  const picture = G.picture || new Map();
  const contacts = [];
  let tgtInfo = null, leadPoint = null, closure = null;
  for (const [e, c] of picture) {
    if (!e.alive) continue;
    const isT = e === P.tgt;
    const visual = !!c.eyes;
    const pos = visual ? e.pos : isT && R.contact ? R.pos : c.pos;
    const dist = pos.distanceTo(P.pos);
    let kind = visual ? 'eyes' : c.radar ? 'trk' : c.irst ? 'irst' : c.dl ? 'dl' : 'mem';
    if (isT && R.contact) kind = R.stt ? 'stt' : R.mem < 1.95 ? 'mem' : 'trk';
    const k = { pos, vel: visual ? e.vel : isT && R.contact ? R.vel : c.vel, dist, kind, name: e.ent ? e.ent.name : 'BANDIT', hp: e.hp, tgt: isT, visual };
    contacts.push(k);
    if (isT) tgtInfo = k;
  }
  for (const e of G.sides[me.side]) {
    if (e === me || !e.plane.alive) continue;
    contacts.push({ pos: e.plane.pos, vel: e.plane.vel, dist: e.plane.pos.distanceTo(P.pos), kind: 'friend', name: e.name });
  }
  const O = P.tgt;
  if (O && O.alive && tgtInfo) {
    const rel = _tv.copy(O.pos).sub(P.pos);
    closure = -rel.dot(O.vel.clone().sub(P.vel)) / Math.max(rel.length(), 1);
    if (tgtInfo.visual && tgtInfo.dist < 2500 && rel.dot(P.fwd) > 0 && P.gunT.rate > 0 && P.gunAmmo > 0) {
      const dir = computeLeadDir(P.pos, P.vel, O.pos, O.vel, new THREE.Vector3(), P.gunT);
      leadPoint = P.pos.clone().addScaledVector(dir, tgtInfo.dist);
    }
  }
  // radar scope: own-radar tracks, datalink tracks, friendlies
  const blips = [];
  for (const [e, c] of picture) {
    if (!e.alive) continue;
    const isT = e === P.tgt;
    if (isT && R.contact) blips.push({ pos: R.pos, vel: R.vel, stt: R.stt, fresh: R.mem > 1.95, tgt: true });
    else if (c.radar || (c.mem > 0 && !c.dl && !c.irst && !c.eyes)) blips.push({ pos: c.pos, vel: c.vel, fresh: !!c.radar, tgt: isT });
    else if (c.dl) blips.push({ pos: c.pos, vel: c.vel, dl: true, fresh: true, tgt: isT });
  }
  for (const e of G.sides[me.side]) if (e !== me && e.plane.alive) blips.push({ pos: e.plane.pos, friend: true, fresh: true });
  const gunDist = tgtInfo && (R.stt || tgtInfo.dist < 2500) ? Math.min(1500, Math.max(300, tgtInfo.dist)) : 1000;
  const gunPoint = P.pos.clone().addScaledVector(P.fwd, gunDist);
  const fpmPoint = P.pos.clone().addScaledVector(P.vel.clone().normalize(), 1000);
  const T = G.threat || { list: [], nearest: 1e9, emitters: [] };
  const gh = groundHeight(P.pos.x, P.pos.z);
  const agl = P.pos.y - gh;
  const pullUp = P.vel.y < -5 && agl / -P.vel.y < 6;
  G.pullUp = pullUp && P.alive;
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const srmKey = firstOf(P.stores, 'srm');
  const cone = srmKey && P.weapon === 'srm' ? WEAPONS[srmKey].lockCone : 0;
  const seekerPx = cone ? (Math.tan(cone) / tanHalf) * (H / 2) : 0;
  const myMrm = [], myMsl = [];
  for (const m of combat.missiles) {
    if (m.owner === P && m.pos) myMsl.push(m.pos);
    if (m.owner !== P || (m.w.guidance !== 'radar' && m.w.guidance !== 'sarh')) continue;
    let status;
    if (m.w.guidance === 'sarh') status = m.lost || m.decoy || !P.radar.stt ? 'LOST' : 'ILL';
    else if (m.lost || m.decoy) status = 'LOST';
    else if (m.phase === 'active') status = 'ACT';
    else { const d = m.pos.distanceTo(m.est) - m.w.pitbull; status = (m.phase === 'dl' ? 'DL ' : 'INS ') + Math.max(0, Math.round(d / Math.max(400, m.vel.length() + 250))); }
    myMrm.push(status);
  }
  let hint = null;
  if (G.phase === 'countdown' && G.round === 1) hint = 'W/S pitch · A/D roll · Q/E rudder · R/F throttle · SPACE gun · 1/2 IR / radar missile · N next target · TAB lock · X fire · C/Z flares/chaff · H help';
  hud.draw({
    ...base, plane: P, myName: (settings.name || 'YOU').toUpperCase(),
    radar: R, padlock: G.padlock, irst: P.irst, contacts, tgt: tgtInfo, blips, oppDist: tgtInfo ? tgtInfo.dist : 0,
    gunPoint, fpmPoint, leadPoint, closure,
    lock: { inCone: P.inCone, progress: P.lockProgress, locked: P.locked }, seekerPx,
    threat: T, threats: T.list, threatDist: T.nearest, dlz: G.dlz, myMrm, myMsl, mapImg: G.mapImg, map: settings.mapRange === 0 ? 0 : settings.mapRange || 40000,
    agl, pullUp, bounds: P.outOfBounds > 0 ? 10 - P.outOfBounds : 0, hint,
    ...strikeHud(P, me, fpmPoint),
    coach: (settings.coach !== false || G.scn.mode === 'training') && me ? missileCoach(P, combat.enemyMissiles(me.side)) : null,
  }, dt);
}

// HUD data for missions: objectives, score, waves, time trial, respawn countdown.
function missionHud(me) {
  const M = G.mission, side = me ? me.side : 0, out = {};
  if (!M) return out;
  if (M.obj.length) out.obj = M.obj.filter((o) => o.side === side).map((o) => ({ label: o.label || defaultLabel(o, G.units), state: o.state, prog: o.prog, optional: o.optional }));
  if (M.sv) out.missionScore = `WAVE ${M.sv.wave}${G.scn.survival.max ? '/' + G.scn.survival.max : ''}${M.sv.breakT > 0 && M.sv.cleared === M.sv.wave && !M.isSurvivalOver() ? ` · next wave in ${Math.ceil(M.sv.breakT)} s` : ''}`;
  else if (G.scn.rules.win === 'score') out.missionScore = `SCORE ${M.score[0]} – ${M.score[1]}  (first to ${G.scn.rules.scoreLimit})`;
  if (me && !me.plane.alive && me.respawnT > 0) out.respawn = me.respawnT;
  if (G.race && me) {
    const st = G.race.of(me), g = G.race.gates[st.next], P = me.plane;
    out.race = { time: fmtTime(st.done ? st.final : st.t + st.pen), next: st.next, gates: G.race.gates.length, lap: st.lap, laps: G.scn.laps, pen: st.pen, high: st.high, ceiling: G.scn.ceiling, done: st.done, gate: g ? g.pos : null, dist: g ? g.pos.distanceTo(P.pos) : 0, best: G.bestTime || null };
  }
  return out;
}

// Missile defence coach: for the most urgent missile guiding on you, what kind it is, where it is,
// and live feedback on the defence that works against it (drag, notch, chaff, flares, terrain).
const _cr = new THREE.Vector3(), _cl = new THREE.Vector3();
function missileCoach(P, msl) {
  let best = null, bt = 1e9;
  for (const m of msl) {
    if (m.target !== P || !m.pos || (m.phase === 'none' && !(m.remote && m.guidance === 'ir'))) continue;
    _cr.subVectors(P.pos, m.pos); const d = _cr.length();
    const vc = -(_cl.subVectors(P.vel, m.vel).dot(_cr) / Math.max(d, 1));
    const tti = d / Math.max(vc, m.burning ? 450 : 60);   // a fresh launch has not sped up yet
    if (tti < bt) { bt = tti; best = { m, d, vc, tti }; }
  }
  if (!best) return null;
  const { m, d, tti } = best, src = m.src || m;
  const g = m.guidance || (src.w && src.w.guidance) || 'radar';
  const name = src.w ? src.w.name : m.key ? WEAPONS[m.key].name : 'Missile';
  const active = m.phase === 'active';
  // which radar has to lose you: the missile's own seeker once it is active, otherwise the launcher's
  const launcher = m.owner && m.owner.alive ? m.owner : null;
  const useMissile = g === 'ir' || active || !launcher;
  const sensor = useMissile ? m.pos : launcher.sensorPos ? launcher.sensorPos(new THREE.Vector3()) : launcher.pos;
  const notchVr = useMissile ? 28 : (launcher.radarT && launcher.radarT.notchVr) || 28;
  const vr = radialSpeed(sensor, P), below = P.pos.y < sensor.y - 60;
  const notched = g !== 'ir' && below && Math.abs(vr) < notchVr;
  // where the missile is, clock-code style
  _cr.subVectors(m.pos, P.pos);
  const hf = Math.hypot(P.fwd.x, P.fwd.z) || 1, fx = P.fwd.x / hf, fz = P.fwd.z / hf;
  const ang = Math.atan2(_cr.x * -fz + _cr.z * fx, _cr.x * fx + _cr.z * fz);
  const clock = ((Math.round((ang * 180) / Math.PI / 30) % 12) + 12) % 12 || 12;
  const el = _cr.y / Math.max(d, 1), level = el > 0.25 ? 'high' : el < -0.25 ? 'low' : 'level';
  // aspect: 0° = flying straight away from it (cold), 90° = beaming, 180° = flying into it (hot)
  _cl.subVectors(P.pos, sensor).setY(0).normalize();
  const vh = _cr.set(P.vel.x, 0, P.vel.z).normalize();
  const aspect = (Math.acos(Math.max(-1, Math.min(1, vh.dot(_cl)))) * 180) / Math.PI;
  const beam = [Math.atan2(-_cl.z, -_cl.x), Math.atan2(_cl.z, _cl.x)].map((a) => (((a * 180) / Math.PI) + 360) % 360);
  // a local missile tells us whether its seeker has lost you
  const coasting = active && src.mem != null && src.mem < 1.49;
  let title, tip;
  const beaten = !m.burning && best.vc < -5 && d > 3000;
  if (beaten) {
    title = `${name} FALLING BEHIND`;
    tip = 'Its motor has burnt out and it is losing ground: it cannot catch you. Keep running until it drops out of the sky.';
  } else if (g === 'ir') {
    title = `HEAT-SEEKER — ${name}`;
    tip = d < 3500 ? 'FLARES NOW (C), out of afterburner, break hard across its path.' : 'Throttle back out of afterburner, put it on your wing, and get ready to flare and break.';
  } else if (g === 'sarh') {
    title = `SEMI-ACTIVE — ${name}`;
    tip = notched ? 'In the launcher\u2019s notch: hold it until the missile goes dumb.' : 'It rides the launcher\u2019s radar: beam the LAUNCHER and stay below it, drop chaff, or hide behind terrain.';
  } else if (d < 2500) {
    title = `LAST DITCH — ${name}`;
    tip = 'Chaff (Z) now and break hard across its path!';
  } else if (active) {
    title = coasting ? `${name} LOST YOU` : `PITBULL — ${name} active`;
    tip = coasting ? (notched ? 'Its seeker has lost you in the notch. HOLD THE BEAM a few more seconds until it gives up.' : 'Its seeker lost you: turn away and change altitude before it finds you again.') : notched ? 'IN THE NOTCH — hold the beam and pop chaff (Z).' : 'NOTCH IT: put the missile at your 3 or 9 o\u2019clock (BEAM marker) and stay below it, then chaff.';
  } else if (m.phase === 'inertial') {
    title = `${name} — flying blind`;
    tip = 'No datalink: it flies to where you were. Turn hard and change altitude so it goes active on empty sky.';
  } else if (tti > 22 || d > 22000) {
    title = `DRAG — ${name} far out`;
    tip = 'Turn cold (missile at your 6), full afterburner and dive: make it run out of energy. Or notch the launcher to cut its datalink.';
  } else {
    title = `DATALINK — ${name}`;
    tip = notched ? 'In the launcher\u2019s notch: its datalink has lost you. Hold it.' : d < 14000 ? 'Beam now (BEAM marker) and get below it: that breaks the launcher\u2019s lock and sets up the notch for when the missile goes active.' : 'The launcher is guiding it: beam the LAUNCHER and stay below it to break the lock, or turn cold and drag.';
  }
  return {
    title, tip, notched, coasting: coasting || beaten, ir: g === 'ir',
    line: `${(d / 1000).toFixed(1)} km · ${Math.max(0, tti).toFixed(0)} s · ${clock} o'clock ${level} · aspect ${Math.round(aspect)}° ${aspect < 50 ? '(cold)' : aspect > 130 ? '(HOT)' : '(beam)'}`,
    notch: g === 'ir' ? null : { vr: Math.round(Math.abs(vr)), need: notchVr, below, of: useMissile ? 'missile' : 'launcher' },
    beam: g === 'ir' ? null : beam,
  };
}

// HUD data for ground attack, aircraft systems and carrier recovery.
const _gp = new THREE.Vector3();
function strikeHud(P, me, fpmPoint) {
  const out = {};
  const gnd = [];
  for (const [u, k] of G.ground) {
    if (!u.alive) continue;
    const isT = P.weapon === 'ag' && u === P.agt;
    const cls = P.agKey && WEAPONS[P.agKey] ? WEAPONS[P.agKey].cls : null;
    gnd.push({ pos: u.pos.clone().setY(u.base + Math.min(u.h, 30) * 0.6), name: u.name, code: u.T && u.T.rwr, emit: u.radarMode > 0, ring: threatRing(u.D), tgt: isT, lock: isT && (cls === 'agm' || cls === 'ashm') ? P.agLock || 0 : null, how: k.how, dist: u.pos.distanceTo(P.pos) });
  }
  for (const u of G.units) {
    if (!u.alive || u.side !== me.side || !u.D.ship) continue;
    const d = u.pos.distanceTo(P.pos);
    if (d < 40000) gnd.push({ pos: u.pos.clone().setY(u.base + 20), name: u.name, friend: true, dist: d });
  }
  out.gnd = gnd;
  const kinds = agKinds(P.stores);
  const key = P.weapon === 'ag' && P.agKey ? P.agKey : kinds[0];
  if (key || P.weapon === 'ag') {
    const w = WEAPONS[key];
    let n = key ? countKey(P.stores, key) : 0;
    if (w && w.cls === 'rkt') { n = n * w.shots; for (const [st, used] of Object.entries(P.podN || {})) if (P.stores[st] === key) n -= used; }
    out.ag = { cls: w ? AG_LABEL[w.cls] || 'A/G' : 'A/G', name: w ? w.short || w.name : '—', n, kinds: kinds.length };
  }
  if (G.ccip && P.weapon === 'ag') {
    out.ccip = G.ccip; out.fpm = fpmPoint;
    const T = P.agt;
    out.ccipHot = !!(T && T.alive && Math.hypot(G.ccip.pos.x - T.pos.x, G.ccip.pos.z - T.pos.z) < T.r + WEAPONS[P.agKey].blast * 0.6);
  }
  out.sys = { flaps: P.flaps, gear: P.gear, trim: input.trim, brake: P.airbrake, dmg: P.dmg, fire: P.fireT > 0, gearOver: P.gear && !P.landed && P.speed > GEAR_VMAX, flapsOver: input.flaps > 0 && P.flaps === 0 && P.speed > FLAP_VMAX };
  out.deck = deckStatus(P);
  if (G.radioMenu) out.radio = RADIO.map((r) => r[1]);
  // carrier approach cues
  const cv = carrierOf(me.side);
  if (cv && !P.landed) {
    const q = cv.toDeck(P.pos), D = cv.D.deck;
    const behind = -D.len / 2 + 55 - q.along;
    const dist = Math.hypot(q.along, q.across);
    const lined = (P.fwd.x * Math.sin(cv.hdgR) - P.fwd.z * Math.cos(cv.hdgR)) > 0.8;
    if ((P.gear || dist < 6000) && behind > -40 && behind < 12000 && lined) {
      const ideal = Math.tan(0.061) * Math.max(0, behind);
      const dh = q.y - ideal;
      const line = Math.abs(q.across) < 12 ? 'ON CENTERLINE' : q.across > 0 ? 'COME LEFT' : 'COME RIGHT';
      const slope = dh > 18 ? 'HIGH' : dh < -18 ? 'LOW' : 'ON GLIDESLOPE';
      const kt = Math.round(P.speed * 1.944);
      out.carrierCue = { name: cv.name, dist, line: `${line}`, slope: `${slope} · ${kt} kt${kt > 175 ? ' FAST' : kt < 120 ? ' SLOW' : ''}`, gear: P.gear, ok: line === 'ON CENTERLINE' && slope === 'ON GLIDESLOPE' && P.gear };
    }
  }
  // briefing markers
  if (G.scn.markers.length) {
    G.markPos = G.markPos || G.scn.markers.map((m) => new THREE.Vector3(m.x, groundHeight(m.x, m.z) + 60, m.z));
    out.marks = G.scn.markers.map((m, i) => ({ pos: G.markPos[i], label: m.label, icon: m.icon, dist: G.markPos[i].distanceTo(P.pos) }));
  }
  return out;
}

// ---------------- replay viewer ----------------
// Plays back the flight recorder in 3D after a match: the simulation is frozen and every jet is
// posed from the recording. Space pauses, Q/E skip 10 s, R/F change speed, N follows the next jet,
// P frees the camera, Esc returns to the debrief.
const _rq = new THREE.Quaternion(), _rv = new THREE.Vector3(), _rv2 = new THREE.Vector3();
const replayMsl = [];
const _mslGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.6, 6).rotateX(Math.PI / 2), _mslMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
function startReplay(t0 = 0, follow = null, kill = null, msl = null) {
  if (!rec.frames.length) { toast('Nothing was recorded.'); return; }
  effects.clear(); wrecks.clear(); combat.clear();
  const ids = [...rec.at(t0).jets.keys()];
  const ok = (id) => id != null && G.byId[id] && !G.byId[id].unit;
  G.replay = { t: t0, last: t0, speed: 1, playing: true, follow: ok(follow) ? follow : G.mine ? G.mine.id : ids[0], kill: ok(follow) ? kill : null, end: rec.length, msl, mslLast: null, mslGone: 0 };
  G.freeCam = false; G.specQuat.copy(camera.quaternion);
  aar.playing = false;
  showScreen(null);
  $('replayBar').classList.add('show');
}
function stopReplay() {
  if (!G.replay) return;
  G.replay = null; G.freeCam = false;
  for (const m of replayMsl) m.visible = false;
  $('replayBar').classList.remove('show');
  effects.clear();
  if (G.phase === 'matchEnd') showEnd(); else showScreen(null);
}
function replaySeek(d) { const R = G.replay; if (!R) return; R.t = Math.max(0, Math.min(R.end, R.t + d)); R.last = R.t; effects.clear(); }
function replayNext() {
  const R = G.replay; if (!R) return;
  const ids = [...rec.at(R.t).jets.keys()].filter((id) => G.byId[id]).sort((a, b) => a - b);
  if (!ids.length) return;
  R.follow = ids[(ids.indexOf(R.follow) + 1) % ids.length]; R.kill = null; R.msl = null; G.freeCam = false;
}
// Follow a missile: the next one in flight (nearest to whatever you're watching first), or if
// none is flying, skip ahead to the next launch.
function replayNextMissile() {
  const R = G.replay; if (!R) return;
  let ms = rec.missilesAt(R.t);
  if (!ms.length || (ms.length === 1 && ms[0].id === R.msl)) {
    // nothing else in flight: jump to the next launch of a different missile
    const F = rec.frames, i0 = rec.index(R.t), now = new Set(ms.map((m) => m.id));
    const fresh = (f) => { for (let k = 0; k < f.m.length; k += 6) if (!now.has(f.m[k])) return true; return false; };
    let j = i0 + 1; while (j < F.length && !fresh(F[j])) j++;
    if (j >= F.length) { flash('NO MORE MISSILES IN THIS RECORDING', 1.6); return; }
    R.t = R.last = F[j].t; effects.clear(); ms = rec.missilesAt(R.t).filter((m) => !now.has(m.id));
    if (!ms.length) return;
    R.msl = null;
  }
  ms.sort((a, b) => a.pos.distanceTo(camera.position) - b.pos.distanceTo(camera.position));
  const i = ms.findIndex((m) => m.id === R.msl);
  R.msl = ms[(i + 1) % ms.length].id; R.mslLast = null; R.mslGone = 0; R.kill = null; G.freeCam = false;
  const by = rec.mi[R.msl] && rec.mi[R.msl].by;
  if (by != null && G.byId[by] && !G.byId[by].unit) R.follow = by;
}
function replayStep(dt) {
  const R = G.replay;
  if (input.tapped('gun')) R.playing = !R.playing;
  if (input.tapped('yawLeft')) replaySeek(-10);
  if (input.tapped('yawRight')) replaySeek(10);
  if (input.tapped('throttleUp')) R.speed = Math.min(8, R.speed * 2);
  if (input.tapped('throttleDown')) R.speed = Math.max(0.25, R.speed / 2);
  if (input.tapped('cycle')) replayNext();
  if (input.tapped('radio')) replayNextMissile();
  if (R.playing) R.t = Math.min(R.end, R.t + dt * R.speed);
  if (R.t >= R.end) R.playing = false;
  if (R.kill && (R.t > R.kill.t + 3 || (R.t >= R.end && (R.endT = (R.endT || 0) + dt) > 2.5))) { stopReplay(); return; }
  const st = rec.at(R.t);
  R.st = st;
  for (const e of G.ents) {
    const x = st.jets.get(e.id), pl = e.plane;
    if (!x) { pl.alive = false; continue; }
    pl.alive = true; pl.pos.copy(x.pos); pl.quat.copy(x.quat); pl.vel.copy(x.vel); pl.speed = x.vel.length();
    pl.hp = 100; pl.g = 1; pl.alpha = 0; pl.eng = 1; pl.throttle = 1;
    if (pl.updateAxes) pl.updateAxes(); else { pl.fwd && pl.fwd.set(0, 0, -1).applyQuaternion(pl.quat); pl.up && pl.up.set(0, 1, 0).applyQuaternion(pl.quat); }
  }
  G.units.forEach((u, i) => { u.alive = st.units[i] !== '0'; });
  for (let j = 0; j < st.up.length; j += 3) { const u = G.units[st.up[j]]; if (u) { u.pos.x = st.up[j + 1]; u.pos.z = st.up[j + 2]; } }
  // missiles: a body plus a smoke trail
  st.missiles.forEach((m, i) => {
    let mesh = replayMsl[i];
    if (!mesh) { mesh = replayMsl[i] = new THREE.Mesh(_mslGeo, _mslMat); scene.add(mesh); }
    mesh.visible = true; mesh.position.copy(m.pos);
    if (m.vel.lengthSq() > 1) mesh.lookAt(_rv.copy(m.pos).add(m.vel));
    if (R.playing) effects.missileTrail(m.pos, m.vel, m.burning, '', 0.5 * Math.min(1, R.speed));
  });
  for (let i = st.missiles.length; i < replayMsl.length; i++) replayMsl[i].visible = false;
  // explosions as the playhead crosses each kill
  if (R.t > R.last) for (const ev of rec.events) {
    if (ev.t <= R.last || ev.t > R.t || !ev.at) continue;
    _rv.set(ev.at[0], ev.at[2], ev.at[1]);
    effects.explosion(_rv, _rv2.set(0, 0, 0), true);
    if (ev.type === 'unit') effects.fireball(_rv, _rv2, 1.2);
    audio.explosion(_rv, true);
  }
  R.last = R.t;
}
const _rup = new THREE.Vector3(0, 1, 0), _rm4 = new THREE.Matrix4();
// missile cam: ride just behind the missile, looking at its target once the target is ahead
// (otherwise along its flight path); when it's gone, hold on the spot where it ended
function missileCamera(dt) {
  const R = G.replay, info = rec.mi[R.msl] || {};
  const m = R.st && R.st.missiles.find((x) => x.id === R.msl);
  if (!m && R.t < (info.t0 ?? 0)) { R.mslLast = null; return false; }   // not fired yet: watch the shooter
  let look;
  if (m) {
    R.mslGone = 0;
    const v = _rv.copy(m.vel);
    if (v.lengthSq() < 1) v.copy(R.mslDir || _rv2.set(0, 0, -1)); v.normalize();
    R.mslDir = (R.mslDir || new THREE.Vector3()).copy(v);
    R.mslLast = (R.mslLast || new THREE.Vector3()).copy(m.pos);
    look = _rv2.copy(m.pos).addScaledVector(v, 400);
    const T = info.tgt != null ? G.byId[info.tgt] : null;
    const tp = T ? (T.unit ? T.pos : T.plane.alive ? T.plane.pos : null) : null;
    if (tp) { _off.subVectors(tp, m.pos); const d = _off.length(); if (d > 1 && _off.dot(v) / d > 0.35) look.copy(tp); }
    camera.position.copy(m.pos).addScaledVector(v, -24); camera.position.y += 3.5;
  } else if (R.mslLast) {
    R.mslGone += dt;
    look = R.mslLast;
    if (R.mslGone > 3 && !R.kill) {
      // done: carry on watching its target, or whoever fired it
      const T = info.tgt != null ? G.byId[info.tgt] : null;
      R.follow = T && !T.unit && T.plane.alive ? info.tgt : info.by != null && G.byId[info.by] && !G.byId[info.by].unit ? info.by : R.follow;
      R.msl = null; return false;
    }
  } else return false;
  _rm4.lookAt(camera.position, look, _rup); _rq.setFromRotationMatrix(_rm4);
  G.specQuat.slerp(_rq, 1 - Math.exp(-dt * (m ? 6 : 3)));
  camera.quaternion.copy(G.specQuat); camera.up.set(0, 1, 0);
  const gh = groundHeight(camera.position.x, camera.position.z) + 3;
  if (camera.position.y < gh) camera.position.y = gh;
  return true;
}
function replayCamera(dt) {
  const R = G.replay;
  if (R.msl != null && missileCamera(dt)) return;
  const F = G.byId[R.follow];
  const pl = F && !F.unit ? F.plane : null;
  if (!pl || !pl.alive) {
    // the followed jet is gone: orbit the spot where it was last seen
    R.ang = (R.ang || 0) + dt * 0.25;
    const f = pl ? pl.pos : camera.position;
    camera.position.set(f.x + Math.cos(R.ang) * 60, f.y + 25, f.z + Math.sin(R.ang) * 60);
    camera.up.set(0, 1, 0); camera.lookAt(f);
    return;
  }
  // kill replay: frame the shooter and its victim together
  const V = R.kill ? G.byId[R.kill.victim] : null;
  if (V && V.plane.alive && R.t < R.kill.t + 0.5) {
    _rv.subVectors(V.plane.pos, pl.pos); const d = _rv.length(); _rv.normalize();
    camera.position.copy(pl.pos).addScaledVector(_rv, -42); camera.position.y += 9;
    camera.up.set(0, 1, 0); camera.lookAt(d > 3000 ? _rv2.copy(pl.pos).addScaledVector(_rv, 3000) : V.plane.pos);
  } else {
    _rq.copy(pl.quat).multiply(PITCH_DOWN);
    G.specQuat.slerp(_rq, 1 - Math.exp(-dt * 5));
    camera.quaternion.copy(G.specQuat);
    _off.set(0, 6, 32).applyQuaternion(G.specQuat);
    camera.position.copy(pl.pos).add(_off);
  }
  const gh = groundHeight(camera.position.x, camera.position.z) + 3;
  if (camera.position.y < gh) camera.position.y = gh;
}
let rpBarT = 0;
function updateReplayBar() {
  const R = G.replay;
  if (!R || (rpBarT += 1) % 6) return;
  const F = G.byId[R.follow];
  $('rpPlay').textContent = R.playing ? '⏸' : '▶';
  $('rpSpeed').textContent = `${R.speed}×`;
  if (document.activeElement !== $('rpT')) $('rpT').value = Math.round((R.t / Math.max(1, R.end)) * 1000);
  $('rpTime').textContent = `${rec.rounds > 1 ? `Round ${rec.roundAt(R.t)} · ` : ''}${fmtTime(R.t)} / ${fmtTime(R.end)}`;
  const mi = R.msl != null ? rec.mi[R.msl] : null, nm = (id) => (id != null && G.byId[id] ? G.byId[id].name : '?');
  $('rpFollow').textContent = G.freeCam ? 'Free camera (WASD, R/F, mouse drag)' : mi ? `Missile cam: ${mi.name} · ${nm(mi.by)} ▸ ${nm(mi.tgt)}` : R.kill ? `Kill cam: ${F ? F.name : ''}` : F ? `${F.name} · ${jetOf(F.plane.type).name}` : '';
}

// ---------------- free camera (spectating and replays) ----------------
const fc = { yaw: 0, pitch: 0, speed: 150 };
function toggleFreeCam() {
  G.freeCam = !G.freeCam;
  if (G.freeCam) { const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); fc.yaw = e.y; fc.pitch = e.x; flash('FREE CAMERA — P to exit', 1.6); }
}
function freeCamUpdate(dt) {
  const k = (c) => input.down.has(c), m = input.mouse;
  fc.yaw -= m.dx * 0.0035 + ((k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0)) * dt * 1.4;
  fc.pitch = Math.max(-1.5, Math.min(1.5, fc.pitch - m.dy * 0.0035 + ((k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0)) * dt * 1.1));
  if (m.wheel) fc.speed = Math.max(20, Math.min(4000, fc.speed * (m.wheel < 0 ? 1.3 : 0.77)));
  camera.up.set(0, 1, 0);
  camera.quaternion.setFromEuler(new THREE.Euler(fc.pitch, fc.yaw, 0, 'YXZ'));
  _rv.set((k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0), 0, (k('KeyS') ? 1 : 0) - (k('KeyW') ? 1 : 0)).applyQuaternion(camera.quaternion);
  _rv.y += (k('KeyR') ? 1 : 0) - (k('KeyF') ? 1 : 0);
  const sp = fc.speed * (k('ShiftLeft') || k('ShiftRight') ? 5 : 1);
  camera.position.addScaledVector(_rv, sp * dt);
  const gh = groundHeight(camera.position.x, camera.position.z) + 3;
  if (camera.position.y < gh) camera.position.y = gh;
}

// ---------------- debrief: after-action map ----------------
const aar = { t: 0, playing: false, raf: 0 };
function setupAar() {
  aar.t = rec.length; aar.playing = false; rec.view = null;
  $('aarPlay').textContent = '▶ Play';
  const has = rec.frames.length > 2;
  $('btnReplay').disabled = !has;
  const name = (id) => { const E = rec.ents[id]; return E ? esc(E.name) : '?'; };
  const kills = rec.events.map((ev, i) => [ev, i]).filter(([ev]) => ev.type === 'kill' || (ev.type === 'round' && rec.rounds > 1));
  if (rec.rounds > 1) kills.unshift([{ type: 'round', n: 1, t: 0 }, -1]);
  $('aarKills').innerHTML = kills.some(([ev]) => ev.type === 'kill') ? kills.map(([ev, i]) => ev.type === 'round' ? `<div class="dim small"><b>Round ${ev.n}</b> · ${fmtTime(ev.t)}</div>` : `<div><span>${fmtTime(ev.t)} · ${ev.killer >= 0 ? `${name(ev.killer)} ▸ ` : ''}${name(ev.victim)} <span class="dim">(${WEAPON_WORD[ev.cause] || ev.cause})</span></span>${ev.killer >= 0 && ev.killer < 100 || ev.killer >= 300 ? `<button class="mini" data-k="${i}">🎥 Kill cam</button>` : ''}${ev.cause === 'msl' && rec.killMissile(ev) != null ? `<button class="mini" data-km="${i}">🚀 Missile cam</button>` : ''}</div>`).join('') : '<span class="dim">No aircraft were lost.</span>';
  cancelAnimationFrame(aar.raf);
  let last = performance.now();
  const loop = (now) => {
    if (!$('end').classList.contains('show')) return;
    aar.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (aar.playing) {
      aar.t = Math.min(rec.length, aar.t + dt * Math.max(10, rec.length / 40));
      if (aar.t >= rec.length) { aar.playing = false; $('aarPlay').textContent = '▶ Play'; }
      drawAarNow();
    }
  };
  requestAnimationFrame(() => { drawAarNow(); aar.raf = requestAnimationFrame(loop); });
}
function drawAarNow() {
  drawAar($('aarMap'), rec, aar.t);
  $('aarT').value = Math.round((aar.t / Math.max(1, rec.length)) * 1000);
  $('aarTime').textContent = `${rec.rounds > 1 ? `Round ${rec.roundAt(aar.t)} · ` : ''}${fmtTime(aar.t)} / ${fmtTime(rec.length)}`;
}

// ---------------- briefing and profile screens ----------------
let briefNext = null;
function showBriefing(scn, onGo) {
  briefNext = onGo;
  $('brKind').textContent = scn.mode === 'training' ? 'Training lesson' : scn.mode === 'race' ? 'Time trial' : scn.mode === 'survival' ? 'Survival' : 'Mission briefing';
  $('brTitle').textContent = scn.name;
  const paras = (scn.briefing || scn.desc || '').split(/\n\s*\n|\n/).filter(Boolean);
  $('brText').innerHTML = paras.map((p) => `<p>${esc(p)}</p>`).join('');
  const objs = scn.objectives.filter((o) => o.side === 0);
  const tmpUnits = scn.units.map((u) => ({ name: u.name || UNITS[u.key].short }));
  $('brObj').innerHTML = objs.length ? `<h2>Objectives</h2><ul class="brobj">${objs.map((o) => `<li>${esc(o.label || defaultLabel(o, tmpUnits))}${o.optional ? ' <span class="dim">(optional)</span>' : ''}</li>`).join('')}</ul>` : '';
  $('brFly').textContent = onGo ? 'Fly (Enter)' : 'Back to the fight (Enter)';
  $('brBack').style.display = onGo ? '' : 'none';
  showScreen('briefing');
  requestAnimationFrame(() => drawBrief($('brMap'), scn));
}
function briefingGo() {
  const go = briefNext; briefNext = null;
  if (go) go(); else if (G.paused) togglePause(); else showScreen(null);
}
function showProfile() {
  showScreen('profile');
  renderProfile($('profilePanel'), profile, settings, {
    save: () => { saveSettings(); $('callsign').value = settings.name; sendChoice(); },
    close: () => showScreen(G.room ? 'room' : 'menu'),
    scenarioName: (id) => (findScenario(id) || { name: id }).name,
  });
}

// ---------------- UI ----------------
function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id);
  // the hangar lives on the main menu, or inside the room so guests can change jets
  const hg = $('hangar'), home = id === 'room' ? $('roomHangar') : $('hangarHome');
  if (hg.parentElement !== home) home.appendChild(hg);
  document.body.classList.toggle('in-menu', !!id);
}
function setLobby(html, cancellable) {
  $('lobbyText').innerHTML = html;
  $('lobbyCancel').style.display = cancellable ? '' : 'none';
  showScreen('lobby');
}
let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
}
function togglePause() {
  if (G.phase === 'matchEnd') return;
  G.paused = !G.paused;
  $('pauseNote').textContent = G.mode === 'online' ? 'Online match: the fight continues while this menu is open!' : 'Practice paused.';
  $('btnPauseBrief').style.display = G.scn && (G.scn.briefing || G.scn.mode !== 'battle') ? '' : 'none';
  showScreen(G.paused ? 'pause' : null);
}
function showEnd() {
  const sd = G.scn.sides;
  const win = G.rw[0] === G.rw[1] ? -1 : G.rw[0] > G.rw[1] ? 0 : 1;
  const mySide = G.mine ? G.mine.side : null;
  if (G.mine && !G.profiled) {
    G.profiled = true;
    if (G.mission && G.mission.sv) profile.wave(G.mission.sv.wave - (G.lastResult && G.lastResult.win === 0 ? 0 : 1));
    profile.matchEnd(G.stats, win < 0 ? null : win === mySide, G.mode === 'online');
  }
  const t = $('endTitle');
  if (mySide == null) { t.textContent = win < 0 ? 'DRAW' : `${sd[win].name.toUpperCase()} WINS`; t.className = ''; }
  else { t.textContent = win === mySide ? 'VICTORY' : win < 0 ? 'DRAW' : 'DEFEAT'; t.className = win === mySide ? 'win' : 'lose'; }
  $('endScore').textContent = `${sd[0].name} ${G.rw[0]} – ${G.rw[1]} ${sd[1].name}`;
  const rows = G.ents.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map((e) =>
    `<tr style="color:${SIDE_COLORS[e.side]}"><td>${esc(e.name)}${e === G.mine ? ' (you)' : ''}</td><td>${esc(jetOf(e.type).name)}</td><td>${e.kills}</td><td>${e.groundKills || 0}</td><td>${e.deaths}</td></tr>`).join('');
  $('endStats').innerHTML = `<table class="stats"><tr><th>Pilot</th><th>Aircraft</th><th>Kills</th><th>Ground</th><th>Deaths</th></tr>${rows}</table>`;
  const st = G.stats, pc = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  $('endMine').innerHTML = G.mine && st ? `<p>Your sortie: ${G.mine.kills} air kill${G.mine.kills === 1 ? '' : 's'}, ${G.mine.groundKills || 0} ground, missiles ${st.mslHits}/${st.msl} (${pc(st.mslHits, st.msl)}), gun ${pc(st.gunHits, st.rounds)} of ${st.rounds} rounds on target${st.ag ? `, A/G ${st.agHits} hits from ${st.ag} releases` : ''}${st.traps ? `, ${st.traps} trap${st.traps > 1 ? 's' : ''}` : ''}, ${fmtTime(st.flight)} in the air.</p>` : '';
  const fresh = profile.fresh.map((id) => MEDAL_BY_ID[id]).filter(Boolean);
  $('endMedals').innerHTML = fresh.length ? `<h2>Medals earned</h2><div class="medals">${fresh.map((m) => `<div class="medal on"><span class="ic">${m.ic}</span><b>${esc(m.name)}</b>${esc(m.desc)}</div>`).join('')}</div>` : '';
  setupAar();
  $('endStatus').textContent = G.mode === 'online' && G.role !== 'host' ? 'Waiting for the host…' : '';
  $('btnRematch').textContent = G.mode === 'online' ? 'Back to room' : 'Fly again';
  $('btnRematch').style.display = G.mode === 'online' && G.role !== 'host' ? 'none' : '';
  $('btnEndMenu').textContent = G.mode === 'online' ? 'Leave room' : 'Main menu';
  showScreen('end');
}

// ---- lobby (online room) ----
function renderLobby() {
  const R = G.room, L = G.lobby;
  if (!R) return;
  showScreen('room');
  const host = G.role === 'host';
  $('roomCode').textContent = R.code;
  $('roomQuick').style.display = R.quick ? '' : 'none';
  const names = {};
  for (const m of R.members) names[m.id] = m.name;
  $('roomMembers').textContent = `${R.members.length}/8 in room: ` + R.members.map((m) => m.name + (m.id === R.host ? ' (host)' : '')).join(', ');
  if (!L) { $('roomScenario').innerHTML = '<p class="dim">Waiting for the host…</p>'; $('roomSides').innerHTML = ''; return; }
  const scn = L.scn;
  const sel = $('roomScenarioSel');
  sel.style.display = host ? '' : 'none';
  $('btnRoomEdit').style.display = host ? '' : 'none';
  $('btnRoomStart').style.display = host ? '' : 'none';
  $('roomWait').style.display = host ? 'none' : '';
  if (host) fillScenarioSelect(sel, scn.id);
  $('roomScenario').innerHTML = `<b>${esc(scn.name)}</b><br><span class="dim small">${esc(summary(scn))}</span>${scn.desc ? `<p class="small">${esc(scn.desc)}</p>` : ''}`;
  const box = $('roomSides');
  box.innerHTML = '';
  scn.sides.forEach((sd, k) => {
    const col = document.createElement('div');
    col.className = 'rside';
    col.innerHTML = `<h3 style="color:${SIDE_COLORS[k]}">${esc(sd.name)}</h3>`;
    sd.slots.forEach((q, i) => {
      const id = k * MAX_PER_SIDE + i;
      const who = L.seats[id];
      const row = document.createElement('div');
      row.className = 'rslot';
      let label;
      if (q.pilot === 'human') {
        const ch = who != null && L.choices[who];
        label = who != null ? `<b>${esc(names[who] || 'Pilot')}</b> · ${esc(q.jet === 'choice' && ch ? JETS[ch.jet].name : jetSpecLabel(q.jet))}` : `<span class="dim">Open seat · ${esc(jetSpecLabel(q.jet))} (AI if empty)</span>`;
      } else label = `<span class="dim">AI ${esc(q.skill)} · ${esc(jetSpecLabel(q.jet))}</span>`;
      row.innerHTML = `<span>${i + 1}. ${label}</span>`;
      if (q.pilot === 'human' && who !== G.myId && who == null) {
        const b = document.createElement('button');
        b.textContent = 'Sit here'; b.className = 'mini';
        b.onclick = () => { if (host) sit(G.myId, id); else net.send({ t: 'seat', to: G.hostId, slot: id }); };
        row.appendChild(b);
      }
      col.appendChild(row);
    });
    box.appendChild(col);
  });
  const mine = Object.keys(L.seats).find((s) => L.seats[s] === G.myId);
  $('roomYou').textContent = mine == null ? 'You are spectating (no free human seat).' : `You fly for ${scn.sides[Math.floor(mine / MAX_PER_SIDE)].name}.`;
}
function fillScenarioSelect(sel, selected) {
  sel.innerHTML = '';
  const g1 = document.createElement('optgroup'); g1.label = 'Built-in';
  const gT = document.createElement('optgroup'); gT.label = 'Training';
  for (const s of PRESETS) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; (s.extra && s.extra.mode === 'training' || s.mode === 'training' ? gT : g1).appendChild(o); }
  sel.appendChild(g1); sel.appendChild(gT);
  const extra = userScenarios.slice();
  if (G.lobby && G.lobby.scn && !findScenario(G.lobby.scn.id) && selected === G.lobby.scn.id) extra.push(G.lobby.scn);
  if (extra.length) {
    const g2 = document.createElement('optgroup'); g2.label = 'My scenarios';
    for (const s of extra) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; g2.appendChild(o); }
    sel.appendChild(g2);
  }
  sel.value = selected;
}

// ---- main menu ----
function readMenu() {
  settings.name = ($('callsign').value || 'Viper').replace(/[^\w \-]/g, '').slice(0, 16) || 'Viper';
  settings.invert = $('invert').checked;
  settings.sound = $('sound').checked;
  settings.coach = $('coach').checked;
  settings.loadout = $('loadout').value;
  settings.scenario = $('scenarioSel').value;
  saveSettings();
}
function refreshScenarioInfo() {
  const s = findScenario(settings.scenario) || PRESETS[0];
  $('scenarioInfo').innerHTML = `${esc(summary(s))}${s.desc ? '<br>' + esc(s.desc) : ''}`;
  const seats = countSeats(s);
  $('btnPractice').textContent = seats.human ? 'Fly vs AI' : 'Watch (AI only)';
}

const COUNTRY_KEYS = Object.keys(COUNTRIES);
let hangarCountry = JETS[settings.jet].country;
function jetSpecs(T) {
  const F = T.flight, R = RADARS[T.radar], G0 = GUNS[T.gun];
  const tw = F.thrAB / ((F.mass / 0.875) * 9.81);
  const chip = (txt, on = true) => `<i class="${on ? '' : 'no'}">${txt}</i>`;
  const rcs = T.rcs < 0.01 ? 'very stealthy' : T.rcs < 0.1 ? 'stealthy' : T.rcs < 0.5 ? 'reduced RCS' : T.rcs < 3 ? 'medium RCS' : 'large RCS';
  return [
    chip(`T/W ${tw.toFixed(2)}`), chip(`${R.name} · ${Math.round(R.range / 1000)} km`),
    chip(`RCS ${T.rcs < 0.01 ? T.rcs.toFixed(4) : T.rcs} m² (${rcs})`),
    chip(T.irst ? `IRST ${Math.round(T.irst / 1000)} km` : 'IRST', !!T.irst),
    chip('Missile warning', !!T.maws), chip('Helmet sight', !!T.hmd), chip('Thrust vectoring', !!T.flight.tvc),
    chip(`Jamming ${Math.round(T.ecm * 100)}%`, T.ecm > 0),
    chip(G0.rate > 0 ? `${G0.name} · ${T.ammo} rds` : 'No gun', G0.rate > 0),
  ].join('');
}
export function loadoutText(L) {
  const n = {};
  for (const k of L.st) if (k) n[k] = (n[k] || 0) + 1;
  return Object.entries(n).map(([k, c]) => `${c}× ${WEAPONS[k].name}`).join(', ');
}
function buildHangar() {
  const tabs = $('countryTabs');
  tabs.innerHTML = '';
  for (const c of COUNTRY_KEYS) {
    const b = document.createElement('button');
    b.textContent = COUNTRIES[c].name;
    b.className = c === hangarCountry ? 'on' : '';
    b.onclick = () => { hangarCountry = c; if (JETS[settings.jet].country !== c) settings.jet = JETS_OF(c)[0]; settings.loadout = JETS[settings.jet].loadoutKeys[0]; saveSettings(); buildHangar(); sendChoice(); };
    tabs.appendChild(b);
  }
  $('countryBlurb').textContent = COUNTRIES[hangarCountry].blurb;
  const cards = $('jetCards');
  cards.innerHTML = '';
  for (const k of JETS_OF(hangarCountry)) {
    const T = JETS[k];
    const b = document.createElement('button');
    b.className = 'card' + (k === settings.jet ? ' on' : '');
    b.innerHTML = `<b>${T.name}</b><span>${T.nick}${T.stealth ? ' · <em class="stealth">stealth</em>' : ''}</span>`;
    b.onclick = () => { settings.jet = k; settings.loadout = T.loadoutKeys[0]; saveSettings(); buildHangar(); sendChoice(); };
    cards.appendChild(b);
  }
  const T = JETS[settings.jet];
  $('jetInfo').innerHTML = `${T.desc}<div class="specs">${jetSpecs(T)}</div>`;
  const sel = $('loadout');
  sel.innerHTML = '';
  for (const lk of T.loadoutKeys) {
    const o = document.createElement('option');
    o.value = lk; o.textContent = `${T.loadouts[lk].name} — ${loadoutText(T.loadouts[lk])}`;
    sel.appendChild(o);
  }
  if (!T.loadouts[settings.loadout]) settings.loadout = T.loadoutKeys[0];
  sel.value = settings.loadout;
}
function sendChoice() {
  if (!G.room) return;
  if (G.role === 'host' && G.lobby) { G.lobby.choices[G.myId] = myChoice(); broadcastLobby(); renderLobby(); }
  else net.send({ t: 'choice', to: G.hostId, ...myChoice() });
}

// ---- scenario builder ----
const builder = new Builder($('builder'), {
  save(s) { const saved = storeScenario(s); settings.scenario = saved.id; saveSettings(); fillScenarioSelect($('scenarioSel'), saved.id); refreshScenarioInfo(); return saved; },
  remove(id) { const i = userScenarios.findIndex((u) => u.id === id); if (i >= 0) { userScenarios.splice(i, 1); saveUserScenarios(); } settings.scenario = PRESETS[0].id; saveSettings(); fillScenarioSelect($('scenarioSel'), settings.scenario); refreshScenarioInfo(); },
  play(s) { audio.start(); readMenu(); startPractice(s); },
  host(s) { const saved = storeScenario(s); settings.scenario = saved.id; saveSettings(); online('create'); },
  useInRoom(s) { if (G.role === 'host' && G.lobby && !G.lobby.started) { G.lobby.scn = sanitize(s); reseat(); broadcastLobby(); renderLobby(); } },
  close() { if (G.room && G.phase === 'menu') renderLobby(); else showScreen('menu'); },
  encode: encodeScenario, decode: decodeScenario, isUser: (id) => userScenarios.some((u) => u.id === id),
});

function initMenu() {
  if (noWebGL) setTimeout(() => toast('Your browser could not start WebGL, so the 3D view is unavailable. Try enabling hardware acceleration or restarting the browser.'), 500);
  $('callsign').value = settings.name;
  $('invert').checked = settings.invert;
  $('sound').checked = settings.sound;
  $('coach').checked = settings.coach !== false;
  buildHangar();
  fillScenarioSelect($('scenarioSel'), findScenario(settings.scenario) ? settings.scenario : PRESETS[0].id);
  settings.scenario = $('scenarioSel').value;
  refreshScenarioInfo();
  $('scenarioSel').onchange = () => { readMenu(); refreshScenarioInfo(); };
  $('btnPractice').onclick = () => { audio.start(); readMenu(); startPractice(findScenario(settings.scenario) || PRESETS[0]); };
  $('btnBuilder').onclick = () => { readMenu(); builder.open(findScenario(settings.scenario) || PRESETS[0], { inRoom: false }); };
  $('btnQuick').onclick = () => online('quick');
  $('btnCreate').onclick = () => online('create');
  $('btnJoin').onclick = () => {
    const code = $('joinCode').value.trim().toUpperCase();
    if (code.length !== 4) { toast('Enter the 4-character room code.'); return; }
    online('join', code);
  };
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
  $('lobbyCancel').onclick = () => { net.send({ t: 'cancel' }); G.room = null; showScreen('menu'); };
  // room screen
  $('roomScenarioSel').onchange = () => {
    const s = findScenario($('roomScenarioSel').value);
    if (s && G.lobby) { G.lobby.scn = sanitize(s); reseat(); broadcastLobby(); renderLobby(); }
  };
  $('btnRoomEdit').onclick = () => { if (G.lobby) builder.open(G.lobby.scn, { inRoom: true }); };
  $('btnRoomStart').onclick = () => hostStart();
  $('btnRoomLeave').onclick = () => { net.send({ t: 'leave' }); G.room = null; G.lobby = null; showScreen('menu'); };
  // pause / help / end
  $('btnResume').onclick = () => togglePause();
  $('btnControls').onclick = () => $('help').classList.add('show');
  $('btnPauseBrief').onclick = () => { if (G.scn) showBriefing(G.scn, null); };
  $('btnQuit').onclick = () => quitToMenu();
  $('btnHelpClose').onclick = () => $('help').classList.remove('show');
  $('btnMenuHelp').onclick = () => $('help').classList.add('show');
  $('btnRematch').onclick = () => {
    if (G.mode === 'ai') { startPractice(G.lastPractice || PRESETS[0], true); return; }
    if (G.role === 'host') hostBackToLobby();
  };
  $('btnEndMenu').onclick = () => quitToMenu();
  $('btnReplay').onclick = () => startReplay(0, null, null);
  $('aarPlay').onclick = () => { aar.playing = !aar.playing; if (aar.playing && aar.t >= rec.length - 0.1) aar.t = 0; $('aarPlay').textContent = aar.playing ? '⏸ Pause' : '▶ Play'; };
  $('aarT').oninput = (e) => { aar.t = (+e.target.value / 1000) * rec.length; aar.playing = false; $('aarPlay').textContent = '▶ Play'; drawAarNow(); };
  $('aarKills').onclick = (e) => {
    const b = e.target.closest('button[data-k]'), bm = e.target.closest('button[data-km]');
    if (b) { const ev = rec.events[+b.dataset.k]; startReplay(Math.max(0, ev.t - 7), ev.killer, ev); }
    if (bm) {
      // from just before launch to just after impact, riding the missile
      const ev = rec.events[+bm.dataset.km], id = rec.killMissile(ev), mi = rec.mi[id] || {};
      startReplay(Math.max(0, (mi.t0 ?? ev.t - 20) - 1.5, ev.t - 45), mi.by ?? ev.killer, ev, id);
    }
  };
  $('rpMsl').onclick = () => replayNextMissile();
  $('rpPlay').onclick = () => { if (G.replay) G.replay.playing = !G.replay.playing; };
  $('rpBack').onclick = () => replaySeek(-10);
  $('rpFwd').onclick = () => replaySeek(10);
  $('rpSpeed').onclick = () => { if (G.replay) { const v = [0.25, 0.5, 1, 2, 4, 8]; G.replay.speed = v[(v.indexOf(G.replay.speed) + 1) % v.length]; } };
  $('rpT').oninput = (e) => { if (G.replay) { G.replay.t = (+e.target.value / 1000) * rec.length; G.replay.last = G.replay.t; effects.clear(); } };
  $('rpNext').onclick = () => replayNext();
  $('rpFree').onclick = () => toggleFreeCam();
  $('rpExit').onclick = () => stopReplay();
  $('btnProfile').onclick = () => { readMenu(); showProfile(); };
  $('brFly').onclick = () => briefingGo();
  $('brBack').onclick = () => { if (G.mode) { if (G.paused) togglePause(); quitToMenu(); } else showScreen('menu'); };
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter' && $('briefing').classList.contains('show')) briefingGo(); });
  for (const el of document.querySelectorAll('#menu input, #menu select')) el.addEventListener('change', readMenu);
  $('loadout').addEventListener('change', () => { readMenu(); sendChoice(); });
  showScreen('menu');
  // a shared scenario link: ?s=<code>
  const m = location.search.match(/[?&]s=([A-Za-z0-9_-]+)/);
  if (m) decodeScenario(m[1]).then((s) => {
    if (!s) { toast('That scenario link is broken.'); return; }
    s.id = 'u' + Math.random().toString(36).slice(2, 8);
    builder.open(s, { inRoom: false, imported: true });
    history.replaceState(null, '', location.pathname);
  });
}
initMenu();
requestAnimationFrame(frame);

// debugging handle
window.__game = { G, combat, camera, audio, wrecks, world, renderer, scene, startPractice, PRESETS, builder, sanitize, input, hud, unitView, missileCoach, rec, startReplay, replayNextMissile,
  // advance the game n frames of 1/60 s (for testing when the tab is in the background)
  get acc() { return acc; },
  tick(n = 60) { G.noRender = true; try { for (let i = 0; i < n; i++) frame(last + 1000 / 60); } finally { G.noRender = false; } },
};
