import * as THREE from 'three';
import { Aircraft, computeLeadDir, airDensity } from './flight.js';
import { World, groundHeight, lineOfSight, ARENA_RADIUS } from './world.js';
import { buildJet } from './models.js';
import { Effects } from './effects.js';
import { Combat } from './weapons.js';
import { updateRadar, updateIrLock, updateIrst, assessThreats } from './sensors.js';
import { WEAPONS, GUNS, RADARS, VISUAL_RANGE, firstOf, countOf, nextStation, flyout, launchZone } from './arsenal.js';
import { JETS, COUNTRIES, JETS_OF, jetOf, DEFAULT_JET } from './aircraft.js';
import { Wrecks } from './wreck.js';
import { Input } from './input.js';
import { AIPilot, SKILLS } from './ai.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Net, RemotePlane, packState } from './net.js';

const $ = (id) => document.getElementById(id);

// ---------------- settings ----------------
const settings = Object.assign({ name: 'Viper', invert: false, rounds: 3, difficulty: 'pilot', sound: true, jet: DEFAULT_JET, loadout: 'air', aiJet: 'random', engage: 'bvr' }, (() => {
  try { return JSON.parse(localStorage.getItem('contrail-settings') || '{}'); } catch { return {}; }
})());
if (!JETS[settings.jet]) settings.jet = DEFAULT_JET;
if (!JETS[settings.jet].loadouts[settings.loadout]) settings.loadout = JETS[settings.jet].loadoutKeys[0];
function saveSettings() { try { localStorage.setItem('contrail-settings', JSON.stringify(settings)); } catch {} }

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

// Jet meshes are rebuilt when a player changes aircraft type.
const jets = { me: null, opp: null };
function jetModel(slot, type) {
  if (jets[slot] && jets[slot].type === type) return jets[slot];
  if (jets[slot]) { scene.remove(jets[slot].group); jets[slot].dispose(); }
  const j = buildJet(type);
  const tip = j.model.wing.pts.reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a));
  j.tip = [tip[0] + 0.1, j.model.wing.y || 0, tip[1]];
  j.group.visible = false;
  scene.add(j.group);
  jets[slot] = j;
  return j;
}
jetModel('me', settings.jet); jetModel('opp', DEFAULT_JET);

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
const G = {
  mode: null,          // 'ai' | 'online'
  phase: 'menu',       // countdown | fight | roundEnd | matchEnd
  phaseT: 0,
  me: new Aircraft(settings.name),
  opp: null,
  ai: null,
  role: 'host',
  scores: { me: 0, opp: 0 },
  roundsToWin: 3,
  round: 0,
  paused: false,
  camMode: 'chase',
  padlock: false,
  camQuat: new THREE.Quaternion(),
  sendT: 0,
  time: 0,
  oppName: 'BANDIT',
  netId: Math.random().toString(36).slice(2, 7),
  rematch: { me: false, opp: false },
  msg: '', msgT: 0,
  attract: 0,
  engage: 'bvr',
  threat: null,
  dlz: null, dlzT: 0,
  death: null, oppDeath: null, camFocus: new THREE.Vector3(), slowT: 0, timeScale: 1, shake: 0,
  eyes: false, aiJet: DEFAULT_JET,
};
G.me.netId = G.netId;

function flash(text, t = 1.6) { G.msg = text; G.msgT = t; }

// ---------------- combat hooks ----------------
const combat = new Combat(scene, effects, audio, {
  onDamage(target, dmg, kind, shooter) {
    if (shooter === G.me && target !== G.me) { hud.hitT = 0.15; audio.hit(); }
    if (G.phase !== 'fight' && G.phase !== 'roundEnd') return;
    if (target.isRemote) { net.send({ t: 'hit', d: dmg, k: kind }); return; }
    applyDamage(target, dmg, kind);
  },
  onMissileGone(m, exploded, pos) {
    if (G.mode === 'online' && m.owner === G.me) net.send({ t: 'mx', id: m.id, p: pos ? [pos.x, pos.y, pos.z] : null });
  },
});

function applyDamage(plane, dmg, kind) {
  if (!plane.alive) return;
  plane.hp -= dmg;
  if (plane === G.me) {
    hud.damageT = Math.min(0.5, hud.damageT + (kind === 'msl' ? 0.5 : 0.12)); audio.damage(kind);
    G.shake = Math.max(G.shake, kind === 'msl' ? 1.6 : 0.25);
  }
  if (plane.hp <= 0) killPlane(plane, kind);
}

// ---------------- deaths ----------------
const wrecks = new Wrecks(scene, effects, audio, {
  shake: (pos, power) => shakeAt(pos, power),
  boom: (pos, big) => { audio.explosion(pos, big); shakeAt(pos, big ? 0.8 : 0.3); },
  splash: (pos, big) => audio.splash(pos, big),
  eject: (pos) => audio.eject(pos),
  chute: (pos) => {
    audio.chute(pos);
    const mine = G.death && G.death.handle.pilot && G.death.handle.pilot.pos === pos;
    const theirs = G.oppDeath && G.oppDeath.handle.pilot && G.oppDeath.handle.pilot.pos === pos;
    if (mine) flash('GOOD CHUTE — you ejected safely', 3);
    else if (theirs && G.me.alive && pos.distanceTo(G.me.pos) < VISUAL_RANGE) flash('GOOD CHUTE — the bandit ejected', 2.5);
  },
});
function shakeAt(pos, power) {
  const d = camera.position.distanceTo(pos);
  const k = Math.max(0, 1 - d / 2500);
  G.shake = Math.max(G.shake, power * 3 * k * k);
}

const DEATH_TEXT = { crash: 'CRASHED', bounds: 'LOST', gun: 'SHOT DOWN — guns', msl: 'SHOT DOWN — missile' };
function killPlane(plane, cause, seed = (Math.random() * 2147483647) | 0) {
  if (!plane.alive) return;
  plane.hp = 0; plane.alive = false; plane.firing = false;
  const handle = wrecks.spawn({ type: plane.type, pos: plane.pos.clone(), vel: plane.vel.clone(), quat: plane.quat.clone(), cause, seed });
  audio.explosion(plane.pos, true);
  shakeAt(plane.pos, cause === 'msl' ? 1.3 : 0.7);
  // a moment of slow motion when it happens up close (practice only: online time can't bend)
  if (G.mode === 'ai' && (plane === G.me || camera.position.distanceTo(plane.pos) < 3500)) G.slowT = 2.4;
  if (plane === G.me) {
    G.death = { handle, ang: Math.atan2(-plane.vel.z, -plane.vel.x) + 0.7 };
    G.camFocus.copy(plane.pos);
    hud.showBanner(DEATH_TEXT[cause] || 'SHOT DOWN', '', '#ff6a5a', 3.5);
    if (G.mode === 'online') {
      const r = (v) => [v.x, v.y, v.z].map((x) => Math.round(x * 100) / 100);
      net.send({ t: 'dead', c: cause, p: r(plane.pos), v: r(plane.vel), q: [plane.quat.x, plane.quat.y, plane.quat.z, plane.quat.w], sd: seed });
    }
    registerDeath('me');
  } else {
    G.oppDeath = { handle };
    hud.showBanner(cause === 'crash' ? 'BANDIT CRASHED' : 'SPLASH ONE', `${G.oppName} ${jetOf(plane.type).name} destroyed`, '#9dffb8', 3.5);
    registerDeath('opp');
  }
}

const isAuthority = () => G.mode === 'ai' || (G.mode === 'online' && G.role === 'host');

function registerDeath(who) {
  if (!isAuthority()) return;
  if (G.phase !== 'fight' && G.phase !== 'roundEnd') return;
  if (who === 'me') G.scores.opp++; else G.scores.me++;
  if (G.phase === 'fight') setPhase('roundEnd', 7.5); // time to watch the wreck go down
  sendPhase();
}

function sendPhase() {
  if (G.mode !== 'online' || G.role !== 'host') return;
  net.send({ t: 'phase', ph: G.phase, pt: G.phaseT, sc: [G.scores.me, G.scores.opp], r: G.round, tw: G.roundsToWin, en: G.engage });
}

function setPhase(ph, t = 0) {
  G.phase = ph; G.phaseT = t;
  if (ph === 'fight') { hud.showBanner('FIGHT!', '', '#9dffb8', 1.4); audio.beep(1320, 0.45, 0.14); }
  if (ph === 'matchEnd') showEnd();
}

// ---------------- spawning / rounds ----------------
// Merge: 7 km apart, inside visual range. BVR: 36 km apart, radar and AMRAAM range.
const SPAWN_QUAT = [new THREE.Quaternion(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)];
function spawnPos(side) {
  const half = G.engage === 'merge' ? 3600 : 18000, off = G.engage === 'merge' ? 150 : 900;
  return side === 0 ? new THREE.Vector3(-off, 3000, half) : new THREE.Vector3(off, 3000, -half);
}

function startRound() {
  G.round++;
  combat.clear();
  effects.clear();
  wrecks.clear();
  G.death = null; G.oppDeath = null; G.slowT = 0; G.shake = 0;
  const mySide = G.mode === 'online' && G.role === 'guest' ? 1 : 0;
  const spd = G.engage === 'merge' ? 210 : 250;
  G.me.setType(settings.jet);
  G.me.reset(spawnPos(mySide), SPAWN_QUAT[mySide], spd, settings.loadout);
  G.me.wantStt = false;
  if (G.mode === 'ai') {
    G.opp.setType(G.aiJet);
    G.opp.reset(spawnPos(1 - mySide), SPAWN_QUAT[1 - mySide], spd, JETS[G.aiJet].loadoutKeys[0]);
    G.opp.wantStt = false;
    G.ai.reset();
  } else if (G.opp) {
    G.opp.hardReset(); G.opp.alive = true; G.opp.hp = 100;
    G.opp.pos.copy(spawnPos(1 - mySide)); G.opp.prevPos.copy(G.opp.pos); G.opp.quat.copy(SPAWN_QUAT[1 - mySide]);
  }
  G.threat = null; G.dlz = null;
  input.reset();
  G.camQuat.copy(G.me.quat);
  setPhase('countdown', 3);
  hud.showBanner(`ROUND ${G.round}`, '', '#ffffff', 2);
}

function pickAiJet() {
  if (JETS[settings.aiJet]) return settings.aiJet;
  const keys = Object.keys(JETS);
  if (settings.aiJet && settings.aiJet.startsWith('c:')) { const k = JETS_OF(settings.aiJet.slice(2)); return k[Math.floor(Math.random() * k.length)]; }
  return keys[Math.floor(Math.random() * keys.length)];
}
function startPractice() {
  G.mode = 'ai';
  G.aiJet = pickAiJet();
  G.opp = new Aircraft(SKILLS[settings.difficulty].label, G.aiJet);
  G.oppName = SKILLS[settings.difficulty].label.toUpperCase();
  G.ai = new AIPilot(G.opp, settings.difficulty);
  G.scores = { me: 0, opp: 0 }; G.round = 0; G.roundsToWin = settings.rounds;
  G.engage = settings.engage;
  G.paused = false;
  enterGame();
  startRound();
}

function startOnlineMatch() {
  G.scores = { me: 0, opp: 0 }; G.round = 0;
  G.rematch = { me: false, opp: false };
  G.roundsToWin = settings.rounds;
  G.engage = settings.engage;
  enterGame();
  startRound();
  sendPhase();
}

function enterGame() {
  G.me.name = settings.name;
  input.invertPitch = settings.invert;
  showScreen(null);
  audio.enabled = settings.sound;
}

function quitToMenu(reason) {
  if (G.mode === 'online') net.send({ t: 'leave' });
  G.mode = null; G.phase = 'menu'; G.paused = false; G.opp = null; G.ai = null;
  combat.clear(); wrecks.clear(); effects.clear();
  G.death = null; G.oppDeath = null; G.slowT = 0;
  jets.opp.group.visible = false;
  showScreen('menu');
  if (reason) toast(reason);
}

// ---------------- networking ----------------
net.on('waiting', () => setLobby('Searching for an opponent…', true));
net.on('room', (m) => setLobby(`Room code: <b class="code">${m.code}</b><br><span class="dim">Give this code to your opponent.</span>`, true));
net.on('error', (m) => { toast(m.msg || 'Error'); showScreen('menu'); });
net.on('matched', (m) => {
  G.mode = 'online';
  G.role = m.role;
  G.oppName = (m.opp || 'Opponent').toUpperCase();
  G.opp = new RemotePlane(m.opp);
  G.opp.gunAcc = 0;
  if (m.role === 'host') startOnlineMatch();
  else { enterGame(); setLobby('Matched! Waiting for host…', false); }
});
net.on('phase', (m) => {
  if (G.mode !== 'online' || G.role !== 'guest') return;
  G.scores.me = m.sc[1]; G.scores.opp = m.sc[0]; G.roundsToWin = m.tw;
  if (m.ph === 'countdown' && m.r !== G.round) {
    if (m.r === 1) { G.rematch = { me: false, opp: false }; }
    showScreen(null);
    G.round = m.r - 1;
    G.engage = m.en === 'merge' ? 'merge' : 'bvr';
    startRound();
    G.phaseT = m.pt;
    return;
  }
  if (m.ph !== G.phase) setPhase(m.ph, m.pt);
});
net.on('s', (m) => {
  if (G.mode !== 'online' || !G.opp) return;
  const now = performance.now();
  G.opp.applyState(m, now, net.oneWay);
  combat.syncRemoteMissiles(m.m || [], now);
});
net.on('hit', (m) => { if (G.mode === 'online' && (G.phase === 'fight' || G.phase === 'roundEnd')) applyDamage(G.me, m.d, m.k); });
net.on('dead', (m) => {
  if (G.mode !== 'online' || !G.opp) return;
  if (m.p) G.opp.pos.set(m.p[0], m.p[1], m.p[2]);
  if (m.v) G.opp.vel.set(m.v[0], m.v[1], m.v[2]);
  if (m.q) G.opp.quat.set(m.q[0], m.q[1], m.q[2], m.q[3]);
  if (G.opp.alive) killPlane(G.opp, m.c, m.sd); // same seed: both screens see the same break-up
});
net.on('fl', (m) => {
  if (G.mode !== 'online' || !G.opp) return;
  for (const f of m.f) combat.addFlare(new THREE.Vector3(f[0], f[1], f[2]), new THREE.Vector3(f[3], f[4], f[5]), 'r' + m.id, G.opp);
});
net.on('ch', (m) => {
  if (G.mode !== 'online' || !G.opp) return;
  for (const c of m.c) combat.addChaff(new THREE.Vector3(c[0], c[1], c[2]), new THREE.Vector3(c[3], c[4], c[5]), 'r' + m.id, G.opp);
});
net.on('mx', (m) => combat.removeRemoteMissile(m.id, m.p ? new THREE.Vector3(...m.p) : null));
net.on('rematch', () => {
  G.rematch.opp = true;
  $('endStatus').textContent = G.rematch.me ? 'Starting…' : `${G.oppName} wants a rematch!`;
  if (G.role === 'host' && G.rematch.me) startOnlineMatch();
});
net.on('peerLeft', () => { if (G.mode === 'online') quitToMenu('Your opponent left the match.'); });
net.on('disconnected', () => { if (G.mode === 'online') quitToMenu('Disconnected from server.'); else if ($('lobby').classList.contains('show')) { showScreen('menu'); toast('Disconnected from server.'); } });

async function online(action, code) {
  audio.start();
  readMenu();
  setLobby('Connecting…', true);
  const slow = setTimeout(() => {
    if ($('lobby').classList.contains('show') && !net.connected) {
      setLobby('Waking up the server…<br><span class="dim">It sleeps when nobody is playing — this can take up to a minute.</span>', true);
    }
  }, 4000);
  try {
    await net.connect(settings.name);
    clearTimeout(slow);
  } catch (e) {
    clearTimeout(slow);
    showScreen('menu');
    toast('Could not reach the game server. Check your connection and try again.');
    return;
  }
  if (!$('lobby').classList.contains('show')) return; // cancelled while connecting
  if (action === 'quick') net.send({ t: 'quick' });
  if (action === 'create') net.send({ t: 'create' });
  if (action === 'join') net.send({ t: 'join', code });
}

// ---------------- weapons ----------------
const pack = (list) => list.map((f) => [f.pos.x, f.pos.y, f.pos.z, f.vel.x, f.vel.y, f.vel.z].map((x) => Math.round(x * 10) / 10));
// ctl: { gun, missile, flare, chaff }
function handleWeapons(plane, ctl, target, dt, isLocalHuman) {
  const hot = G.phase === 'fight' || G.phase === 'roundEnd';
  plane.missileCd -= dt; plane.flareCd -= dt; plane.chaffCd = (plane.chaffCd || 0) - dt;
  // Gatling guns (M61) spin up before reaching full rate; revolver and single-barrel guns don't
  const gun = plane.gunT;
  const trigger = hot && plane.alive && ctl.gun && plane.gunAmmo > 0;
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

  if (!hot || !plane.alive) return;
  if (ctl.missile && plane.missileCd <= 0) {
    const cls = plane.weapon;
    const key = firstOf(plane.stores, cls);
    const w = key && WEAPONS[key];
    if (!key) { if (isLocalHuman) flash(cls === 'mrm' ? 'NO RADAR MISSILES LEFT — press 1 for IR missiles' : 'NO IR MISSILES LEFT'); }
    else if (cls === 'srm' && !plane.locked) { if (isLocalHuman) flash('NO LOCK — wait for the steady tone'); }
    else if (cls === 'mrm' && !plane.radar.contact) { if (isLocalHuman) flash('NO RADAR TRACK — point the nose at the bandit'); }
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
    if (isLocalHuman) {
      audio.flare();
      if (G.mode === 'online') net.send({ t: 'fl', id: G.netId + popId, f: pack(combat.flares.slice(-2)) });
    }
  }
  if (ctl.chaff && plane.chaffCd <= 0 && plane.chaff > 0) {
    const popId = combat.popChaff(plane);
    plane.chaff--; plane.chaffCd = 0.3;
    if (isLocalHuman) {
      audio.chaff();
      if (G.mode === 'online') net.send({ t: 'ch', id: G.netId + popId, c: pack(combat.chaff.slice(-1)) });
    }
  }
}

// ---------------- camera ----------------
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _off = new THREE.Vector3();
const PITCH_DOWN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.06);
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

function updateCamera(dt) {
  const P = G.me;
  if (G.phase === 'menu') {
    // attract mode: slow orbit over the terrain
    G.attract += dt * 0.03;
    camera.position.set(Math.cos(G.attract) * 9000, 3200, Math.sin(G.attract) * 9000);
    camera.lookAt(0, 1400, 0);
    return;
  }
  if (!P.alive && G.death) {
    // death camera: ride along with the falling wreck, then find the parachute
    const D = G.death, h = D.handle, pl = h.pilot;
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
  const target = G.opp && G.opp.alive && (G.eyes || P.radar.contact || P.irst.contact) ? G.opp : null;
  const lookBack = input.held('lookBack');
  // desired orientation
  if (G.padlock && target) {
    _m4.lookAt(P.pos, target.pos, P.up);
    _q.setFromRotationMatrix(_m4);
  } else if (lookBack) {
    _q.copy(P.quat).multiply(FLIP);
  } else {
    _q.copy(P.quat);
    if (G.camMode === 'chase') _q.multiply(PITCH_DOWN);
  }
  const k = G.camMode === 'cockpit' && !G.padlock && !lookBack ? 1 : 1 - Math.exp(-dt * (G.padlock ? 7 : 9));
  G.camQuat.slerp(_q, k);
  camera.quaternion.copy(G.camQuat);
  if (G.camMode === 'cockpit') {
    camera.position.copy(P.pos).addScaledVector(P.up, 1.5).addScaledVector(P.fwd, 4.3);
  } else {
    _off.set(0, 4.2, 21).applyQuaternion(G.camQuat);
    camera.position.copy(P.pos).add(_off);
  }
  // keep the camera above ground
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
function planeEffects(plane, slot, dt) {
  const jet = jetModel(slot, plane.type);
  jet.group.visible = plane.alive;
  jet.group.position.copy(plane.pos);
  jet.group.quaternion.copy(plane.quat);
  jet.setThrottle(plane.eng ?? plane.throttle, G.time);
  jet.setStores(plane.stores);
  if (!plane.alive) return;
  // wingtip vapor under high load
  const g = plane.g ?? 1;
  const alpha = plane.alpha ?? 0;
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
const aiInput = { pitch: 0, roll: 0, yaw: 0, throttle: 1, airbrake: false };

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  G.time += dt;

  // global keys
  if (input.tapped('pause') && G.mode) togglePause();
  if (input.tapped('help') && G.mode) $('help').classList.toggle('show');
  if (input.tapped('camera')) { G.camMode = G.camMode === 'chase' ? 'cockpit' : 'chase'; }
  if (input.tapped('padlock')) { G.padlock = !G.padlock; flash(G.padlock ? 'PADLOCK / HELMET CUE ON' : 'PADLOCK OFF', 1); }

  const inGame = G.mode && G.phase !== 'menu';
  const simRunning = inGame && !(G.paused && G.mode === 'ai');
  input.enabled = !G.paused && G.me.alive;

  // slow motion after a close kill (practice only): hold, then ease back to real time
  if (G.slowT > 0 && G.mode === 'ai') {
    G.slowT -= dt;
    const e = 2.4 - G.slowT;
    G.timeScale = e < 0.9 ? 0.25 : 0.25 + 0.75 * Math.min(1, (e - 0.9) / 1.5);
  } else G.timeScale = 1;
  const sdt = dt * G.timeScale;

  if (simRunning) step(sdt, now);

  updateCamera(dt);
  // camera shake from nearby explosions
  if (G.shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * G.shake; camera.position.y += (Math.random() - 0.5) * G.shake; camera.position.z += (Math.random() - 0.5) * G.shake;
    camera.rotateZ((Math.random() - 0.5) * G.shake * 0.01);
    G.shake *= Math.exp(-dt * 3.5);
  }
  world.update(camera);
  effects.update(simRunning ? sdt : 0);
  wrecks.update(simRunning ? sdt : 0);
  if (inGame) {
    planeEffects(G.me, 'me', sdt);
    if (G.opp) planeEffects(G.opp, 'opp', sdt); else jets.opp.group.visible = false;
  } else {
    jets.me.group.visible = false; jets.opp.group.visible = false;
  }

  drawHud(dt);
  audio.listenerPos = camera.position;
  audio.listenerQuat = camera.quaternion;
  const P = G.me;
  audio.listenerVel = P.alive ? P.vel : null;
  if (inGame && G.phase === 'countdown') {
    const n = Math.ceil(G.phaseT);
    if (n !== G.lastBeep && n > 0 && n <= 3) audio.beep(660, 0.12, 0.12);
    G.lastBeep = n;
  } else G.lastBeep = null;
  const T = inGame && G.threat ? G.threat : null;
  audio.update(dt, {
    rwr: T ? { search: T.search, lock: T.lock, launch: T.launch, active: T.active, maws: T.maws } : null,
    mrmTrack: P.weapon === 'mrm' && P.radar.stt,
    active: inGame && !(G.paused && G.mode === 'ai'), alive: P.alive, eng: P.eng, speed: P.speed, g: P.g,
    firing: P.firing, locked: P.locked, inCone: P.inCone, lockProgress: P.lockProgress, threatDist: T ? T.nearest : 1e9, cockpit: G.camMode === 'cockpit',
    alpha: P.alpha, airbrake: P.airbrake, gloc: P.gloc, pullUp: inGame && G.pullUp,
    opp: inGame && G.opp ? G.opp : null,
  });

  renderer.render(scene, camera);
  input.endFrame();
}

function step(dt, now) {
  const P = G.me, O = G.opp;
  // phase timers
  G.phaseT -= dt;
  if (G.msgT > 0) G.msgT -= dt;
  if (isAuthority()) {
    if (G.phase === 'countdown' && G.phaseT <= 0) { setPhase('fight'); sendPhase(); }
    else if (G.phase === 'roundEnd' && G.phaseT <= 0) {
      const { me, opp } = G.scores;
      if ((me >= G.roundsToWin || opp >= G.roundsToWin) && me !== opp) { setPhase('matchEnd'); sendPhase(); }
      else { startRound(); sendPhase(); }
      return;
    }
  }

  // ---- inputs ----
  const pin = input.flight(dt);
  P.prevPos.copy(P.pos);
  let aiOut = null;
  if (G.mode === 'ai' && O) {
    O.prevPos.copy(O.pos);
    aiOut = G.ai.update(dt, P, combat, assessThreats(O, P, combat.missilesFrom(P)));
    aiInput.pitch = aiOut.pitch; aiInput.roll = aiOut.roll; aiInput.yaw = aiOut.yaw;
    aiInput.throttle = aiOut.throttle; aiInput.airbrake = aiOut.airbrake;
  }

  // ---- physics ----
  acc += dt;
  while (acc >= PHYS_DT) {
    acc -= PHYS_DT;
    if (P.alive && P.step(PHYS_DT, pin, groundHeight) === 'crash') killPlane(P, 'crash');
    if (aiOut && O.alive && O.step(PHYS_DT, aiInput, groundHeight) === 'crash') killPlane(O, 'crash');
  }
  P.updateAxes();
  if (G.mode === 'ai' && O) O.updateAxes();
  if (G.mode === 'online' && O) O.update(now, dt);

  // ---- arena boundary ----
  if (P.alive) {
    if (Math.hypot(P.pos.x, P.pos.z) > ARENA_RADIUS || P.pos.y > 16000) {
      P.outOfBounds += dt;
      if (P.outOfBounds > 10) applyDamage(P, 25 * dt, 'bounds');
    } else P.outOfBounds = 0;
  }

  // ---- sensors, weapon selection & weapons ----
  if (P.alive && !G.paused) {
    if (input.tapped('selSrm')) { P.weapon = 'srm'; flash(countOf(P.stores, 'srm') ? `SRM — ${WEAPONS[firstOf(P.stores, 'srm')].name}` : 'SRM — none left', 1.2); }
    if (input.tapped('selMrm')) {
      if (countOf(P.stores, 'mrm')) { P.weapon = 'mrm'; flash('MRM — AIM-120C', 1.2); }
      else flash('NO AIM-120 LOADED', 1.2);
    }
    if (input.tapped('radarLock')) {
      P.wantStt = !P.wantStt;
      flash(P.wantStt ? (P.radar.contact ? 'RADAR LOCKING…' : 'RADAR LOCK — no contact yet') : 'RADAR LOCK OFF', 1.2);
    }
  }
  const hadStt = P.radar.stt;
  updateRadar(P, O, dt, P.wantStt, combat.chaff);
  if (hadStt && !P.radar.stt && P.radar.lostMsg > 0) flash(P.radar.notched ? 'LOCK BROKEN — bandit in the notch' : P.radar.masked ? 'LOCK BROKEN — bandit behind terrain' : 'LOCK BROKEN', 1.6);
  if (P.radar.lostMsg > 0) P.radar.lostMsg -= dt;
  // eyes need a clear line of sight too: a ridge hides the bandit from view
  G.eyes = !!(O && O.alive && P.alive && O.pos.distanceTo(P.pos) < VISUAL_RANGE && lineOfSight(P.pos, O.pos));
  updateIrst(P, O, dt);
  const srmKey = P.weapon === 'srm' ? firstOf(P.stores, 'srm') : null;
  // the IR seeker can be cued off-boresight by the helmet sight, or slaved to the radar or IRST
  updateIrLock(P, O, dt, srmKey, (G.padlock && G.eyes && P.T.hmd) || P.radar.stt || P.irst.fresh);
  handleWeapons(P, { gun: input.held('gun'), missile: input.tapped('missile'), flare: input.held('flare'), chaff: input.held('chaff') }, O, dt, true);
  if (aiOut) {
    O.weapon = aiOut.weapon;
    updateRadar(O, P, dt, aiOut.wantStt, combat.chaff);
    updateIrst(O, P, dt);
    const aiEyes = O.pos.distanceTo(P.pos) < VISUAL_RANGE && O.T.hmd;
    updateIrLock(O, P, dt, O.weapon === 'srm' ? firstOf(O.stores, 'srm') : null, O.radar.stt || O.irst.fresh || aiEyes);
    handleWeapons(O, aiOut, P, dt, false);
  }
  G.threat = O ? assessThreats(P, O, combat.missilesFrom(O)) : null;
  // launch zone for the selected missile, refreshed a few times a second
  G.dlzT -= dt;
  if (G.dlzT <= 0) {
    G.dlzT = 0.25;
    const key = firstOf(P.stores, P.weapon);
    if (key && O && O.alive && P.alive) {
      const rel = O.pos.clone().sub(P.pos), d = rel.length();
      const closing = -rel.dot(O.vel) / Math.max(d, 1); // target's own speed toward us
      const zone = launchZone(flyout(key, P.speed, airDensity(P.pos.y)), closing, O.vel.length());
      G.dlz = { key, ...zone };
    } else G.dlz = null;
  }
  if (G.mode === 'online' && O && O.alive && O.firing) {
    // remote tracers are visual only — the shooter's client detects hits
    O.gunAcc += dt * O.gunT.rate;
    while (O.gunAcc >= 1) { O.gunAcc -= 1; combat.fireBullet(O, false); }
    effects.muzzle(combat.gunMuzzle(O), O.vel);
  }

  const planes = O ? [P, O] : [P];
  combat.update(dt, planes, now, G.mode === 'online' ? net.oneWay : 0);

  // ---- network send ----
  if (G.mode === 'online') {
    G.sendT -= dt;
    if (G.sendT <= 0) {
      G.sendT = 1 / 30;
      const ms = [];
      for (const m of combat.missiles) if (m.owner === P) ms.push([m.id, ...[m.pos.x, m.pos.y, m.pos.z, m.vel.x, m.vel.y, m.vel.z].map((x) => Math.round(x * 10) / 10), m.w.code, Combat.flags(m)]);
      net.send(packState(P, { m: ms }));
    }
  }
}

function drawHud(dt) {
  const P = G.me, O = G.opp;
  const inGame = G.mode && G.phase !== 'menu';
  if (!inGame) { hud.draw({ active: false }, dt); return; }
  const oppAlive = O && O.alive;
  const oppDist = oppAlive ? O.pos.distanceTo(P.pos) : 0;
  const R = P.radar;
  // what the pilot actually knows: eyes inside visual range, radar track beyond it
  const visual = oppAlive && G.eyes;
  const tracked = oppAlive && R.contact;
  const gunDist = oppAlive && (R.stt || oppDist < 2500) ? Math.min(1500, Math.max(300, oppDist)) : 1000;
  const gunPoint = P.pos.clone().addScaledVector(P.fwd, gunDist);
  const vhat = P.vel.clone().normalize();
  const fpmPoint = P.pos.clone().addScaledVector(vhat, 1000);
  let leadPoint = null, closure = null;
  if (oppAlive) {
    const rel = O.pos.clone().sub(P.pos);
    closure = -rel.dot(O.vel.clone().sub(P.vel)) / Math.max(oppDist, 1);
    if (oppDist < 2500 && rel.dot(P.fwd) > 0 && P.gunT.rate > 0 && P.gunAmmo > 0) {
      const dir = computeLeadDir(P.pos, P.vel, O.pos, O.vel, new THREE.Vector3(), P.gunT);
      leadPoint = P.pos.clone().addScaledVector(dir, oppDist);
    }
  }
  const T = G.threat || { list: [], nearest: 1e9 };
  const gh = groundHeight(P.pos.x, P.pos.z);
  const agl = P.pos.y - gh;
  const pullUp = P.vel.y < -5 && agl / -P.vel.y < 6;
  G.pullUp = pullUp && P.alive;
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const srmKey = firstOf(P.stores, 'srm');
  const cone = srmKey && P.weapon === 'srm' ? WEAPONS[srmKey].lockCone : 0;
  const seekerPx = cone ? (Math.tan(cone) / tanHalf) * (H / 2) : 0;
  // my AIM-120s in flight: time until the seeker goes active, or ACTIVE
  const myMrm = [];
  for (const m of combat.missiles) {
    if (m.owner !== P || (m.w.guidance !== 'radar' && m.w.guidance !== 'sarh')) continue;
    let status;
    if (m.w.guidance === 'sarh') status = m.lost || m.decoy || !P.radar.stt ? 'LOST' : 'ILL';
    else if (m.lost || m.decoy) status = 'LOST';
    else if (m.phase === 'active') status = 'ACT';
    else {
      const d = m.pos.distanceTo(m.est) - m.w.pitbull;
      status = (m.phase === 'dl' ? 'DL ' : 'INS ') + Math.max(0, Math.round(d / Math.max(400, m.vel.length() + 250)));
    }
    myMrm.push(status);
  }
  let hint = null;
  if (G.phase === 'countdown' && G.round === 1) hint = 'W/S pitch · A/D roll · Q/E rudder · R/F throttle · SPACE gun · 1/2 select IR / radar missile · TAB radar lock · X fire · C flares · Z chaff · H help';
  hud.draw({
    active: true, plane: P, opp: oppAlive ? O : null, oppDist, oppName: G.oppName, myName: (settings.name || 'YOU').toUpperCase(),
    visual, tracked, radar: R, padlock: G.padlock, irst: P.irst,
    project, camSpace, camPos: camera.position, gunPoint, fpmPoint, leadPoint, closure,
    lock: { inCone: P.inCone, progress: P.lockProgress, locked: P.locked }, seekerPx,
    threat: T, threats: T.list, threatDist: T.nearest, dlz: G.dlz, myMrm,
    agl, pullUp, bounds: P.outOfBounds > 0 ? 10 - P.outOfBounds : 0,
    scores: G.scores, roundsToWin: G.roundsToWin, countdown: G.phase === 'countdown' ? G.phaseT : 0,
    countdownMsg: G.engage === 'merge' ? 'WEAPONS SAFE — MERGE INBOUND' : 'WEAPONS SAFE — BANDIT 36 KM AHEAD, FIND HIM ON RADAR',
    msg: G.msgT > 0 ? G.msg : '', ping: G.mode === 'online' ? net.rtt : null, hint,
  }, dt);
}

// ---------------- UI ----------------
function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id);
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
  $('pauseNote').textContent = G.mode === 'online' ? 'Online match — the fight continues while this menu is open!' : 'Practice paused.';
  showScreen(G.paused ? 'pause' : null);
}
function showEnd() {
  const won = G.scores.me > G.scores.opp;
  $('endTitle').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('endTitle').className = won ? 'win' : 'lose';
  $('endScore').textContent = `${G.scores.me} – ${G.scores.opp}  vs  ${G.oppName}`;
  $('endStatus').textContent = '';
  $('btnRematch').textContent = G.mode === 'online' ? 'Request rematch' : 'Fight again';
  showScreen('end');
}
function readMenu() {
  settings.name = ($('callsign').value || 'Viper').replace(/[^\w \-]/g, '').slice(0, 16) || 'Viper';
  settings.invert = $('invert').checked;
  settings.rounds = parseInt($('rounds').value, 10) || 3;
  settings.difficulty = $('difficulty').value;
  settings.sound = $('sound').checked;
  settings.loadout = $('loadout').value;
  settings.aiJet = $('aiJet').value;
  settings.engage = $('engage').value;
  saveSettings();
}
// ---- aircraft picker ----
const COUNTRY_KEYS = Object.keys(COUNTRIES);
let hangarCountry = JETS[settings.jet].country;
function jetSpecs(T) {
  const F = T.flight, R = RADARS[T.radar], G0 = GUNS[T.gun];
  const realMass = F.mass / 0.875;
  const tw = F.thrAB / (realMass * 9.81);
  const chip = (txt, on = true) => `<i class="${on ? '' : 'no'}">${txt}</i>`;
  const rcs = T.rcs < 0.01 ? 'very stealthy' : T.rcs < 0.1 ? 'stealthy' : T.rcs < 0.5 ? 'reduced RCS' : T.rcs < 3 ? 'medium RCS' : 'large RCS';
  return [
    chip(`T/W ${tw.toFixed(2)}`),
    chip(`${R.name} · ${Math.round(R.range / 1000)} km`),
    chip(`RCS ${T.rcs < 0.01 ? T.rcs.toFixed(4) : T.rcs} m² (${rcs})`),
    chip(T.irst ? `IRST ${Math.round(T.irst / 1000)} km` : 'IRST', !!T.irst),
    chip('Missile warning', !!T.maws),
    chip('Helmet sight', !!T.hmd),
    chip(T.flight.tvc ? 'Thrust vectoring' : 'Thrust vectoring', !!T.flight.tvc),
    chip(`Jamming ${Math.round(T.ecm * 100)}%`, T.ecm > 0),
    chip(G0.rate > 0 ? `${G0.name} · ${T.ammo} rds` : 'No gun', G0.rate > 0),
  ].join('');
}
function loadoutText(L) {
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
    b.onclick = () => { hangarCountry = c; if (JETS[settings.jet].country !== c) settings.jet = JETS_OF(c)[0]; settings.loadout = JETS[settings.jet].loadoutKeys[0]; saveSettings(); buildHangar(); };
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
    b.onclick = () => { settings.jet = k; settings.loadout = T.loadoutKeys[0]; saveSettings(); buildHangar(); };
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
  const ai = $('aiJet');
  if (!ai.options.length) {
    const add = (v, t, parent = ai) => { const o = document.createElement('option'); o.value = v; o.textContent = t; parent.appendChild(o); };
    add('random', 'Random (any nation)');
    for (const c of COUNTRY_KEYS) {
      const g = document.createElement('optgroup'); g.label = COUNTRIES[c].name; ai.appendChild(g);
      add('c:' + c, `Random ${COUNTRIES[c].short} jet`, g);
      for (const k of JETS_OF(c)) add(k, JETS[k].name, g);
    }
  }
  ai.value = settings.aiJet;
  if (ai.value !== settings.aiJet) { settings.aiJet = 'random'; ai.value = 'random'; }
}

function initMenu() {
  $('callsign').value = settings.name;
  $('invert').checked = settings.invert;
  $('rounds').value = String(settings.rounds);
  $('difficulty').value = settings.difficulty;
  $('sound').checked = settings.sound;
  buildHangar();
  $('engage').value = settings.engage;
  $('btnPractice').onclick = () => { audio.start(); readMenu(); startPractice(); };
  $('btnQuick').onclick = () => online('quick');
  $('btnCreate').onclick = () => online('create');
  $('btnJoin').onclick = () => {
    const code = $('joinCode').value.trim().toUpperCase();
    if (code.length !== 4) { toast('Enter the 4-character room code.'); return; }
    online('join', code);
  };
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
  $('lobbyCancel').onclick = () => { net.send({ t: 'cancel' }); showScreen('menu'); };
  $('btnResume').onclick = () => togglePause();
  $('btnControls').onclick = () => $('help').classList.add('show');
  $('btnQuit').onclick = () => quitToMenu();
  $('btnHelpClose').onclick = () => $('help').classList.remove('show');
  $('btnMenuHelp').onclick = () => $('help').classList.add('show');
  $('btnRematch').onclick = () => {
    if (G.mode === 'ai') { startPractice(); return; }
    G.rematch.me = true;
    net.send({ t: 'rematch' });
    $('endStatus').textContent = G.rematch.opp ? 'Starting…' : 'Waiting for opponent…';
    if (G.role === 'host' && G.rematch.opp) startOnlineMatch();
  };
  $('btnEndMenu').onclick = () => quitToMenu();
  for (const el of document.querySelectorAll('#menu input, #menu select')) el.addEventListener('change', readMenu);
  showScreen('menu');
}
initMenu();
requestAnimationFrame(frame);

// debugging handle
window.__game = { G, combat, camera, audio, wrecks, jets };
