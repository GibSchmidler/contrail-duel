import * as THREE from 'three';
import { Aircraft, computeLeadDir, airDensity } from './flight.js';
import { World, groundHeight, ARENA_RADIUS, visRange, lineOfSight } from './world.js';
import { buildJet } from './models.js';
import { Effects } from './effects.js';
import { Combat } from './weapons.js';
import { updateRadar, updateIrLock, updateIrst, scanContacts, datalinkPicture, assessThreatsMulti } from './sensors.js';
import { WEAPONS, GUNS, RADARS, firstOf, countOf, nextStation, flyout, launchZone } from './arsenal.js';
import { JETS, COUNTRIES, JETS_OF, jetOf, DEFAULT_JET } from './aircraft.js';
import { Wrecks } from './wreck.js';
import { Input } from './input.js';
import { AIPilot } from './ai.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Net, RemotePlane, packState } from './net.js';
import { PRESETS, sanitize, spawnPoints, resolveJet, summary, encodeScenario, decodeScenario, SIDE_COLORS, countSeats, jetSpecLabel, MAX_PER_SIDE } from './scenario.js';
import { Builder } from './builder.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------- settings + saved scenarios ----------------
const settings = Object.assign({ name: 'Viper', invert: false, sound: true, jet: DEFAULT_JET, loadout: 'air', scenario: 'duel-bvr' }, (() => {
  try { return JSON.parse(localStorage.getItem('contrail-settings') || '{}'); } catch { return {}; }
})());
if (!JETS[settings.jet]) settings.jet = DEFAULT_JET;
if (!JETS[settings.jet].loadouts[settings.loadout]) settings.loadout = JETS[settings.jet].loadoutKeys[0];
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.5, 200000);
camera.position.set(0, 3200, 9000);
const world = new World(scene);
const effects = new Effects(scene);
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
  paused: false, camMode: 'chase', padlock: false, camQuat: new THREE.Quaternion(),
  sendT: 0, aiSendT: 0, phaseSendT: 0, time: 0,
  netId: Math.random().toString(36).slice(2, 7),
  msg: '', msgT: 0, attract: 0, dlz: null, dlzT: 0, threat: null,
  death: null, camFocus: new THREE.Vector3(), slowT: 0, timeScale: 1, shake: 0,
  spectate: null, specQuat: new THREE.Quaternion(), feed: [], tgtT: 0, tgtManualT: 0, pullUp: false, freeCam: false,
};
const myPlane = () => (G.mine ? G.mine.plane : null);
const isAuthority = () => G.mode === 'ai' || (G.mode === 'online' && G.role === 'host');
const hot = () => G.phase === 'fight' || G.phase === 'roundEnd';
const resolveSlot = (sl) => (G.byId[sl] ? G.byId[sl].plane : null);
function flash(text, t = 1.6) { G.msg = text; G.msgT = t; }
function feed(text, color) { G.feed.unshift({ text, color, t: 7 }); if (G.feed.length > 6) G.feed.pop(); }

// ---------------- jet models ----------------
function ensureModel(e) {
  const type = e.plane.type;
  if (e.model && e.model.type === type) return e.model;
  if (e.model) { scene.remove(e.model.group); e.model.dispose(); }
  const j = buildJet(type);
  const tip = j.model.wing.pts.reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a));
  j.tip = [tip[0] + 0.1, j.model.wing.y || 0, tip[1]];
  j.group.visible = false;
  scene.add(j.group);
  e.model = j;
  return j;
}

// ---------------- combat hooks ----------------
const combat = new Combat(scene, effects, audio, {
  onDamage(target, dmg, kind, shooter) {
    const P = myPlane();
    if (P && shooter === P && target !== P) { hud.hitT = 0.15; audio.hit(); }
    if (!hot()) return;
    const te = target.ent;
    if (!te) return;
    const by = shooter && shooter.ent ? shooter.ent.id : -1;
    if (te.local) applyDamage(te, dmg, kind, by);
    else net.send({ t: 'hit', to: te.member != null ? te.member : G.hostId, sl: te.id, d: dmg, k: kind, by });
  },
  onMissileGone(m, exploded, pos) {
    if (G.mode === 'online' && m.owner && m.owner.ent && m.owner.ent.local) net.send({ t: 'mx', id: m.id, p: pos ? [pos.x, pos.y, pos.z] : null });
  },
});

function applyDamage(e, dmg, kind, by = -1) {
  const pl = e.plane;
  if (!pl.alive) return;
  pl.hp -= dmg;
  if (by >= 0 && by !== e.id) e.lastHit = { by, t: G.time, kind };
  if (e === G.mine) {
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

const WEAPON_WORD = { gun: 'guns', msl: 'missile', crash: 'crashed', bounds: 'left the area' };
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
    G.death = { handle, ang: Math.atan2(-pl.vel.z, -pl.vel.x) + 0.7, t: 0 };
    G.camFocus.copy(pl.pos);
    const by = killer && killer !== e ? `by ${killer.name} · ${jetOf(killer.plane.type).name}` : '';
    hud.showBanner(cause === 'crash' ? 'CRASHED' : cause === 'bounds' ? 'LOST' : `SHOT DOWN — ${WEAPON_WORD[cause] || cause}`, by, '#ff6a5a', 3.5);
  } else if (killer && killer === G.mine) {
    hud.showBanner('SPLASH ONE', `${e.name} · ${jetOf(pl.type).name} destroyed`, '#9dffb8', 3);
  }
  if (e.local && G.mode === 'online') {
    const r = (v) => [v.x, v.y, v.z].map((x) => Math.round(x * 100) / 100);
    net.send({ t: 'dead', sl: e.id, c: cause, p: r(pl.pos), v: r(pl.vel), q: [pl.quat.x, pl.quat.y, pl.quat.z, pl.quat.w], sd: seed, by: killerId });
  }
}

// ---------------- rounds ----------------
function sendPhase() {
  if (G.mode !== 'online' || G.role !== 'host') return;
  net.send({ t: 'phase', ph: G.phase, pt: G.phaseT, rw: G.rw, r: G.round, rt: G.roundT, k: G.ents.map((e) => [e.kills, e.deaths]) });
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
  const sp = spawnPoints(G.scn, groundHeight);
  for (const e of G.ents) {
    const s = sp[e.side][e.idx], pl = e.plane;
    e.lastHit = null; e.handle = null; pl.contacts = new Map();
    if (e.local) {
      pl.setType(e.type);
      pl.reset(s.pos, s.quat, s.speed, e.loadout);
      pl.wantStt = false; pl.tgt = null; pl.lockTgt = null;
      if (e.ai) e.ai.reset();
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
  hud.showBanner(`ROUND ${r}`, G.scn.name, '#ffffff', 2);
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
      const L = JETS[type].loadouts;
      const want = q.loadout === 'bvr' && !L.bvr && L.heavy ? 'heavy' : q.loadout;
      const loadout = want && L[want] ? want : human && ch.jet === type && L[ch.loadout] ? ch.loadout : JETS[type].loadoutKeys[0];
      roster.push({ id, side: k, idx: i, name: human ? names[member] || 'Pilot' : `${sd.name} ${i + 1}`, type, loadout, skill: q.skill, member, human });
    });
  });
  return roster;
}

function makeEnt(r) {
  const local = r.human ? r.member === G.myId : isAuthority();
  const plane = local ? new Aircraft(r.name, r.type) : new RemotePlane(r.name);
  if (!local) { plane.setType(r.type); plane.gunAcc = 0; }
  const e = { ...r, local, plane, ai: null, model: null, kills: 0, deaths: 0, lastHit: null, handle: null, aiIn: { pitch: 0, roll: 0, yaw: 0, throttle: 1, airbrake: false }, aiOut: null };
  plane.ent = e; plane.side = r.side; plane.netId = G.netId + r.id;
  if (local && !r.human) e.ai = new AIPilot(plane, r.skill);
  return e;
}

function startMatch(scn, roster, mode) {
  teardownMatch();
  G.mode = mode;
  G.scn = sanitize(scn);
  world.setMap(G.scn.map);
  world.setEnv(G.scn.time, G.scn.weather);
  G.ents = roster.map(makeEnt);
  G.byId = {};
  for (const e of G.ents) G.byId[e.id] = e;
  G.sides = [G.ents.filter((e) => e.side === 0), G.ents.filter((e) => e.side === 1)];
  G.mine = G.ents.find((e) => e.human && e.member === G.myId) || null;
  G.rw = [0, 0]; G.round = 0; G.feed = []; G.paused = false;
  enterGame();
  if (isAuthority()) { startRound(1); sendPhase(); }
  else { G.phase = 'countdown'; G.phaseT = 3; }
}

function teardownMatch() {
  combat.clear(); wrecks.clear(); effects.clear();
  for (const e of G.ents) if (e.model) { scene.remove(e.model.group); e.model.dispose(); }
  G.ents = []; G.byId = {}; G.mine = null; G.sides = [[], []];
  G.death = null; G.slowT = 0; G.spectate = null;
}

function startPractice(scn) {
  G.myId = 0; G.role = 'host'; G.hostId = 0;
  scn = sanitize(scn);
  // I take the first human seat (Blue first); every other seat is flown by the AI
  const seats = {};
  outer: for (let k = 0; k < 2; k++) for (let i = 0; i < scn.sides[k].slots.length; i++) {
    if (scn.sides[k].slots[i].pilot === 'human') { seats[k * MAX_PER_SIDE + i] = 0; break outer; }
  }
  const roster = buildRoster(scn, seats, { 0: { jet: settings.jet, loadout: settings.loadout } }, { 0: settings.name });
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
    net.send({ t: 'choice', to: G.hostId, jet: settings.jet, loadout: settings.loadout });
    if (G.phase === 'menu') { if (m.quick) setLobby('Opponent found, starting…', false); else renderLobby(); }
    return;
  }
  // host: keep seats in sync with who is in the room
  if (!G.lobby || !wasHost) G.lobby = { scn: sanitize(findScenario(settings.scenario) || PRESETS[0]), seats: {}, choices: {}, started: false };
  if (m.quick) G.lobby.scn = quickScenario();
  G.lobby.choices[G.myId] = { jet: settings.jet, loadout: settings.loadout };
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
  G.lobby.choices[m.from] = { jet, loadout: JETS[jet].loadouts[m.loadout] ? m.loadout : JETS[jet].loadoutKeys[0] };
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
});
net.on('phase', (m) => {
  if (G.mode !== 'online' || G.role !== 'guest') return;
  G.rw = m.rw; G.roundT = m.rt || 0;
  if (m.k) m.k.forEach((kd, i) => { const e = G.ents[i]; if (e) { e.kills = kd[0]; e.deaths = kd[1]; } });
  if (m.r !== G.round) { startRound(m.r); G.phaseT = m.pt; if (m.ph !== 'countdown') setPhase(m.ph, m.pt); return; }
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
  if (e && e.local) applyDamage(e, m.d, m.k, m.by);
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
  e.ai = new AIPilot(pl, 'pilot');
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
  L.choices[G.myId] = { jet: settings.jet, loadout: settings.loadout };
  const roster = buildRoster(L.scn, L.seats, L.choices, names);
  L.started = true;
  broadcastLobby();
  net.send({ t: 'start', scn: L.scn, roster });
  startMatch(L.scn, roster, 'online');
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
  const trigger = on && plane.alive && ctl.gun && plane.gunAmmo > 0 && gun.rate > 0;
  plane.gunSpin = trigger ? Math.min(1, plane.gunSpin + dt / Math.max(0.01, gun.spinUp)) : Math.max(0, plane.gunSpin - dt / 0.5);
  plane.firing = trigger;
  if (trigger) {
    const rate = gun.rate * plane.gunSpin;
    plane.gunAcc += dt * rate;
    let n = 0;
    while (plane.gunAcc >= 1 && plane.gunAmmo > 0) {
      plane.gunAcc -= 1; plane.gunAmmo--;
      combat.fireBullet(plane, true, (n++ / (dt * rate + 1)) * dt);
    }
    if (plane.gunSpin > 0.2) effects.muzzle(combat.gunMuzzle(plane), plane.vel);
  } else plane.gunAcc = 0;

  if (!on || !plane.alive) return;
  if (ctl.missile && plane.missileCd <= 0) {
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

function setTarget(pl, t) {
  if (pl.tgt === t) return;
  pl.tgt = t;
  const R = pl.radar;
  R.contact = false; R.stt = false; R.acq = 0; R.mem = 0;
  pl.lockProgress = 0; pl.locked = false;
}

// Player target designation: automatic (nearest to the nose) unless held by a lock or picked with N.
const _tv = new THREE.Vector3();
function playerTargeting(P, picture, dt) {
  G.tgtT -= dt; G.tgtManualT -= dt;
  const known = [...picture.keys()].filter((e) => e.alive);
  const offBore = (e) => { const c = picture.get(e); return Math.acos(Math.max(-1, Math.min(1, _tv.copy(c.pos).sub(P.pos).normalize().dot(P.fwd)))); };
  if (input.tapped('cycle') && known.length) {
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

function updateCamera(dt) {
  if (G.freeCam) return;
  const P = myPlane();
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
  if (G.padlock && target) { _m4.lookAt(P.pos, target.pos, P.up); _q.setFromRotationMatrix(_m4); }
  else if (lookBack) _q.copy(P.quat).multiply(FLIP);
  else { _q.copy(P.quat); if (G.camMode === 'chase') _q.multiply(PITCH_DOWN); }
  const k = G.camMode === 'cockpit' && !G.padlock && !lookBack ? 1 : 1 - Math.exp(-dt * (G.padlock ? 7 : 9));
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
  G.time += dt;

  if (input.tapped('pause') && G.mode) togglePause();
  if (input.tapped('help') && G.mode) $('help').classList.toggle('show');
  if (input.tapped('camera')) G.camMode = G.camMode === 'chase' ? 'cockpit' : 'chase';
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

  if (simRunning) step(sdt, now);

  updateCamera(dt);
  if (G.shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * G.shake; camera.position.y += (Math.random() - 0.5) * G.shake; camera.position.z += (Math.random() - 0.5) * G.shake;
    camera.rotateZ((Math.random() - 0.5) * G.shake * 0.01);
    G.shake *= Math.exp(-dt * 3.5);
  }
  world.update(camera, dt);
  effects.update(simRunning ? sdt : 0);
  wrecks.update(simRunning ? sdt : 0);
  if (inGame) for (const e of G.ents) planeEffects(e, sdt);

  drawHud(dt);
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
    active: inGame && !(G.paused && G.mode === 'ai'), alive: A.alive, eng: A.eng, speed: A.speed, g: A.g,
    firing: A.firing, locked: A.locked, inCone: A.inCone, lockProgress: A.lockProgress, threatDist: T ? T.nearest : 1e9, cockpit: G.camMode === 'cockpit',
    alpha: A.alpha, airbrake: A.airbrake, gloc: A.gloc, pullUp: inGame && G.pullUp,
    opp: near,
  });

  renderer.render(scene, camera);
  input.endFrame();
}

function sideHome(k) { const s = G.scn.sides[k]; return new THREE.Vector3(s.x * 0.6, 3000, s.z * 0.6); }

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
      const alive = [0, 1].map((k) => G.sides[k].filter((e) => e.plane.alive).length);
      const timeUp = G.scn.timeLimit > 0 && G.roundT >= G.scn.timeLimit * 60;
      if (alive[0] === 0 || alive[1] === 0 || timeUp) {
        let win = -1;
        if (alive[0] > 0 && alive[1] === 0) win = 0; else if (alive[1] > 0 && alive[0] === 0) win = 1;
        else if (timeUp && alive[0] !== alive[1]) win = alive[0] > alive[1] ? 0 : 1;
        if (win >= 0) G.rw[win]++;
        const sd = G.scn.sides;
        hud.showBanner(win < 0 ? 'ROUND DRAWN' : `${sd[win].name.toUpperCase()} WINS THE ROUND`, timeUp ? 'Time is up' : '', win < 0 ? '#ffffff' : SIDE_COLORS[win], 3);
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
    setTarget(pl, e.ai.pickTarget(enemies, picture));
    const threat = assessThreatsMulti(pl, enemies, enemyMsl[e.side]);
    const out = e.ai.update(dt, pl.tgt, combat, threat, { friends, home: sideHome(1 - e.side), picture });
    e.aiOut = out;
    const a = e.aiIn;
    a.pitch = out.pitch; a.roll = out.roll; a.yaw = out.yaw; a.throttle = out.throttle; a.airbrake = out.airbrake;
  }

  // ---- physics ----
  acc += dt;
  while (acc >= PHYS_DT) {
    acc -= PHYS_DT;
    for (const e of G.ents) {
      if (!e.local || !e.plane.alive) continue;
      if (e.plane.step(PHYS_DT, e === me ? pin : e.aiIn, groundHeight) === 'crash') killPlane(e, 'crash');
    }
  }
  for (const e of G.ents) { if (e.local) e.plane.updateAxes(); else e.plane.update(now, dt); }

  // ---- arena boundary (local jets) ----
  for (const e of G.ents) {
    const pl = e.plane;
    if (!e.local || !pl.alive) continue;
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
    if (P.alive && !G.paused) {
      playerTargeting(P, picture, dt);
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
    handleWeapons(me, { gun: input.held('gun'), missile: input.tapped('missile'), flare: input.held('flare'), chaff: input.held('chaff') }, P.tgt, dt, true);
    G.threat = assessThreatsMulti(P, enemies, enemyMsl[me.side]);
    // launch zone for the selected missile against the designated target
    G.dlzT -= dt;
    if (G.dlzT <= 0) {
      G.dlzT = 0.25;
      const key = firstOf(P.stores, P.weapon), O = P.tgt;
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
    updateRadar(pl, tgt, dt, out.wantStt, combat.chaff);
    pl.lockTgt = pl.radar.stt ? tgt : null;
    updateIrst(pl, tgt, dt);
    const aiEyes = tgt && tgt.alive && pl.pos.distanceTo(tgt.pos) < visRange() && pl.T.hmd;
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
  }
}

const DEAD = { alive: false, hp: 0 };
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
    countdownMsg: sepKm <= 10 ? 'WEAPONS SAFE — MERGE INBOUND' : `WEAPONS SAFE — ENEMY ABOUT ${sepKm} KM AHEAD, FIND THEM ON RADAR`,
    msg: G.msgT > 0 ? G.msg : '', ping: G.mode === 'online' ? net.rtt : null,
    project, camSpace, camPos: camera.position,
  };
  if (!P || !P.alive) {
    const S = G.spectate;
    const deathCam = G.death && G.death.t < 6.5 && P;
    hud.draw({ ...base, plane: P || DEAD, radar: {}, lock: {}, spectate: !deathCam && S ? `SPECTATING ${S.name} · ${jetOf(S.plane.type).name}   (N: next)` : null }, dt);
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
    const k = { pos, dist, kind, name: e.ent ? e.ent.name : 'BANDIT', hp: e.hp, tgt: isT, visual };
    contacts.push(k);
    if (isT) tgtInfo = k;
  }
  for (const e of G.sides[me.side]) {
    if (e === me || !e.plane.alive) continue;
    contacts.push({ pos: e.plane.pos, dist: e.plane.pos.distanceTo(P.pos), kind: 'friend', name: e.name });
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
  const myMrm = [];
  for (const m of combat.missiles) {
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
    threat: T, threats: T.list, threatDist: T.nearest, dlz: G.dlz, myMrm,
    agl, pullUp, bounds: P.outOfBounds > 0 ? 10 - P.outOfBounds : 0, hint,
  }, dt);
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
  showScreen(G.paused ? 'pause' : null);
}
function showEnd() {
  const sd = G.scn.sides;
  const win = G.rw[0] === G.rw[1] ? -1 : G.rw[0] > G.rw[1] ? 0 : 1;
  const mySide = G.mine ? G.mine.side : null;
  const t = $('endTitle');
  if (mySide == null) { t.textContent = win < 0 ? 'DRAW' : `${sd[win].name.toUpperCase()} WINS`; t.className = ''; }
  else { t.textContent = win === mySide ? 'VICTORY' : win < 0 ? 'DRAW' : 'DEFEAT'; t.className = win === mySide ? 'win' : 'lose'; }
  $('endScore').textContent = `${sd[0].name} ${G.rw[0]} – ${G.rw[1]} ${sd[1].name}`;
  const rows = G.ents.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map((e) =>
    `<tr style="color:${SIDE_COLORS[e.side]}"><td>${esc(e.name)}${e === G.mine ? ' (you)' : ''}</td><td>${esc(jetOf(e.type).name)}</td><td>${e.kills}</td><td>${e.deaths}</td></tr>`).join('');
  $('endStats').innerHTML = `<table class="stats"><tr><th>Pilot</th><th>Aircraft</th><th>Kills</th><th>Deaths</th></tr>${rows}</table>`;
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
  for (const s of PRESETS) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; g1.appendChild(o); }
  sel.appendChild(g1);
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
  if (G.role === 'host' && G.lobby) { G.lobby.choices[G.myId] = { jet: settings.jet, loadout: settings.loadout }; broadcastLobby(); renderLobby(); }
  else net.send({ t: 'choice', to: G.hostId, jet: settings.jet, loadout: settings.loadout });
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
  $('callsign').value = settings.name;
  $('invert').checked = settings.invert;
  $('sound').checked = settings.sound;
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
  $('btnQuit').onclick = () => quitToMenu();
  $('btnHelpClose').onclick = () => $('help').classList.remove('show');
  $('btnMenuHelp').onclick = () => $('help').classList.add('show');
  $('btnRematch').onclick = () => {
    if (G.mode === 'ai') { startPractice(G.lastPractice || PRESETS[0]); return; }
    if (G.role === 'host') hostBackToLobby();
  };
  $('btnEndMenu').onclick = () => quitToMenu();
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
window.__game = { G, combat, camera, audio, wrecks, world, renderer, scene, startPractice, PRESETS, builder };
