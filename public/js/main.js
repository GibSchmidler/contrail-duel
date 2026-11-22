import * as THREE from 'three';
import { Aircraft, computeLeadDir } from './flight.js';
import { World, groundHeight, ARENA_RADIUS } from './world.js';
import { buildJet } from './models.js';
import { Effects } from './effects.js';
import { Combat, updateLock, GUN_RATE, SEEKER_CONE } from './weapons.js';
import { Input } from './input.js';
import { AIPilot, SKILLS } from './ai.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Net, RemotePlane, packState } from './net.js';

const $ = (id) => document.getElementById(id);

// ---------------- settings ----------------
const settings = Object.assign({ name: 'Viper', invert: false, rounds: 3, difficulty: 'pilot', sound: true }, (() => {
  try { return JSON.parse(localStorage.getItem('contrail-settings') || '{}'); } catch { return {}; }
})());
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

const myJet = buildJet({ body: 0x8f9cab, accent: 0x2f6fd0 });
const oppJet = buildJet({ body: 0x9c968c, accent: 0xc8372d });
scene.add(myJet.group, oppJet.group);
oppJet.group.visible = false;

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
  deathPos: null,
  time: 0,
  oppName: 'BANDIT',
  netId: Math.random().toString(36).slice(2, 7),
  rematch: { me: false, opp: false },
  msg: '', msgT: 0,
  attract: 0,
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
  if (plane === G.me) hud.damageT = Math.min(0.5, hud.damageT + (kind === 'msl' ? 0.5 : 0.12));
  if (plane.hp <= 0) killPlane(plane, kind);
}

function killPlane(plane, cause) {
  if (!plane.alive) return;
  plane.hp = 0; plane.alive = false; plane.firing = false;
  effects.explosion(plane.pos, plane.vel, true);
  audio.explosion(plane.pos, true);
  if (plane === G.me) {
    G.deathPos = plane.pos.clone();
    hud.showBanner(cause === 'crash' ? 'CRASHED' : cause === 'bounds' ? 'LOST' : 'SHOT DOWN', '', '#ff6a5a', 3);
    if (G.mode === 'online') net.send({ t: 'dead', c: cause, p: [plane.pos.x, plane.pos.y, plane.pos.z] });
    registerDeath('me');
  } else {
    hud.showBanner(cause === 'crash' ? 'BANDIT CRASHED' : 'SPLASH ONE', `${G.oppName} destroyed`, '#9dffb8', 3);
    registerDeath('opp');
  }
}

const isAuthority = () => G.mode === 'ai' || (G.mode === 'online' && G.role === 'host');

function registerDeath(who) {
  if (!isAuthority()) return;
  if (G.phase !== 'fight' && G.phase !== 'roundEnd') return;
  if (who === 'me') G.scores.opp++; else G.scores.me++;
  if (G.phase === 'fight') setPhase('roundEnd', 3.5);
  sendPhase();
}

function sendPhase() {
  if (G.mode !== 'online' || G.role !== 'host') return;
  net.send({ t: 'phase', ph: G.phase, pt: G.phaseT, sc: [G.scores.me, G.scores.opp], r: G.round, tw: G.roundsToWin });
}

function setPhase(ph, t = 0) {
  G.phase = ph; G.phaseT = t;
  if (ph === 'fight') { hud.showBanner('FIGHT!', '', '#9dffb8', 1.4); }
  if (ph === 'matchEnd') showEnd();
}

// ---------------- spawning / rounds ----------------
const SPAWN = [
  { pos: new THREE.Vector3(-150, 3000, 3600), quat: new THREE.Quaternion() },
  { pos: new THREE.Vector3(150, 3000, -3600), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) },
];

function startRound() {
  G.round++;
  combat.clear();
  effects.clear();
  const mySide = G.mode === 'online' && G.role === 'guest' ? 1 : 0;
  G.me.reset(SPAWN[mySide].pos, SPAWN[mySide].quat, 240);
  if (G.mode === 'ai') {
    G.opp.reset(SPAWN[1 - mySide].pos, SPAWN[1 - mySide].quat, 240);
    G.ai.reset();
  } else if (G.opp) {
    G.opp.hardReset(); G.opp.alive = true; G.opp.hp = 100;
    G.opp.pos.copy(SPAWN[1 - mySide].pos); G.opp.prevPos.copy(G.opp.pos); G.opp.quat.copy(SPAWN[1 - mySide].quat);
  }
  input.reset();
  G.camQuat.copy(G.me.quat);
  G.deathPos = null;
  setPhase('countdown', 3);
  hud.showBanner(`ROUND ${G.round}`, '', '#ffffff', 2);
}

function startPractice() {
  G.mode = 'ai';
  G.opp = new Aircraft(SKILLS[settings.difficulty].label);
  G.oppName = SKILLS[settings.difficulty].label.toUpperCase();
  G.ai = new AIPilot(G.opp, settings.difficulty);
  G.scores = { me: 0, opp: 0 }; G.round = 0; G.roundsToWin = settings.rounds;
  G.paused = false;
  enterGame();
  startRound();
}

function startOnlineMatch() {
  G.scores = { me: 0, opp: 0 }; G.round = 0;
  G.rematch = { me: false, opp: false };
  G.roundsToWin = settings.rounds;
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
  combat.clear();
  oppJet.group.visible = false;
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
  if (G.opp.alive) killPlane(G.opp, m.c);
});
net.on('fl', (m) => {
  if (G.mode !== 'online' || !G.opp) return;
  for (const f of m.f) combat.addFlare(new THREE.Vector3(f[0], f[1], f[2]), new THREE.Vector3(f[3], f[4], f[5]), 'r' + m.id, G.opp);
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
function handleWeapons(plane, wantGun, wantMissile, wantFlare, target, dt, isLocalHuman) {
  const hot = G.phase === 'fight' || G.phase === 'roundEnd';
  plane.missileCd -= dt; plane.flareCd -= dt;
  plane.firing = hot && plane.alive && wantGun && plane.gunAmmo > 0;
  if (plane.firing) {
    plane.gunAcc += dt * GUN_RATE;
    let n = 0;
    while (plane.gunAcc >= 1 && plane.gunAmmo > 0) {
      plane.gunAcc -= 1; plane.gunAmmo--;
      combat.fireBullet(plane, true, (n++ / (dt * GUN_RATE + 1)) * dt);
    }
    effects.muzzle(plane.pos.clone().addScaledVector(plane.fwd, 7.5).addScaledVector(plane.right, -0.7).addScaledVector(plane.up, 0.35), plane.vel);
  } else plane.gunAcc = 0.99;

  if (!hot || !plane.alive) return;
  if (wantMissile) {
    if (plane.missiles <= 0) { if (isLocalHuman) flash('NO MISSILES'); }
    else if (plane.missileCd > 0) { /* rail cooldown */ }
    else if (!plane.locked) { if (isLocalHuman) flash('NO LOCK — keep the bandit in the seeker circle'); }
    else {
      combat.launchMissile(plane, target);
      plane.missiles--; plane.missileCd = 0.8; plane.lockProgress = 0.6;
      if (isLocalHuman || (G.me.pos.distanceTo(plane.pos) < 3000)) audio.launch();
    }
  }
  if (wantFlare && plane.flareCd <= 0 && plane.flares > 0) {
    const popId = combat.popFlares(plane);
    plane.flares--; plane.flareCd = 0.35;
    if (isLocalHuman) {
      audio.flare();
      if (G.mode === 'online') {
        const fl = combat.flares.slice(-2).map((f) => [f.pos.x, f.pos.y, f.pos.z, f.vel.x, f.vel.y, f.vel.z].map((x) => Math.round(x * 10) / 10));
        net.send({ t: 'fl', id: G.netId + popId, f: fl });
      }
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
  if (!P.alive && G.deathPos) {
    const t = G.time * 0.25;
    camera.position.set(G.deathPos.x + Math.cos(t) * 160, G.deathPos.y + 50, G.deathPos.z + Math.sin(t) * 160);
    camera.up.set(0, 1, 0);
    camera.lookAt(G.deathPos);
    return;
  }
  const target = G.opp && G.opp.alive ? G.opp : null;
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
function planeEffects(plane, jet, dt) {
  jet.group.position.copy(plane.pos);
  jet.group.quaternion.copy(plane.quat);
  jet.setThrottle(plane.eng ?? plane.throttle, G.time);
  jet.setMissileCount(plane.missiles);
  if (!plane.alive) return;
  // wingtip vapor under high load
  const g = plane.g ?? 1;
  const alpha = plane.alpha ?? 0;
  if (g > 5 || alpha > 0.22) {
    const a = Math.min(0.5, (g - 4.5) * 0.08 + Math.max(0, alpha - 0.2));
    for (const s of [-1, 1]) {
      _wt.set(s * 5.4, 0, 3.0).applyQuaternion(plane.quat).add(plane.pos);
      effects.vapor(_wt, plane.vel, a);
    }
  }
  if (plane.hp < 50) {
    _wt.set(0, 0.5, 6).applyQuaternion(plane.quat).add(plane.pos);
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
  if (input.tapped('padlock')) { G.padlock = !G.padlock; flash(G.padlock ? 'PADLOCK VIEW ON' : 'PADLOCK VIEW OFF', 1); }

  const inGame = G.mode && G.phase !== 'menu';
  const simRunning = inGame && !(G.paused && G.mode === 'ai');
  input.enabled = !G.paused && G.me.alive;

  if (simRunning) step(dt, now);

  updateCamera(dt);
  world.update(camera);
  effects.update(simRunning ? dt : 0);
  if (inGame) {
    planeEffects(G.me, myJet, dt);
    myJet.group.visible = G.me.alive;
    if (G.opp) { planeEffects(G.opp, oppJet, dt); oppJet.group.visible = G.opp.alive; }
  } else {
    myJet.group.visible = false; oppJet.group.visible = false;
  }

  drawHud(dt);
  audio.listenerPos = camera.position;
  const P = G.me;
  const threats = inGame ? combat.threatsTo(P) : [];
  let td = 1e9; for (const t of threats) td = Math.min(td, t.pos.distanceTo(P.pos));
  audio.update(dt, {
    active: inGame && !(G.paused && G.mode === 'ai'), alive: P.alive, eng: P.eng, speed: P.speed, g: P.g,
    firing: P.firing, locked: P.locked, inCone: P.inCone, lockProgress: P.lockProgress, threatDist: td, cockpit: G.camMode === 'cockpit',
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
    aiOut = G.ai.update(dt, P, combat);
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

  // ---- locks & weapons ----
  updateLock(P, O, dt);
  handleWeapons(P, input.held('gun'), input.tapped('missile'), input.held('flare'), O, dt, true);
  if (aiOut) {
    updateLock(O, P, dt);
    handleWeapons(O, aiOut.gun, aiOut.missile, aiOut.flare, P, dt, false);
  }
  if (G.mode === 'online' && O && O.alive && O.firing) {
    // remote tracers are visual only — the shooter's client detects hits
    O.gunAcc += dt * GUN_RATE;
    while (O.gunAcc >= 1) { O.gunAcc -= 1; combat.fireBullet(O, false); }
    effects.muzzle(O.pos.clone().addScaledVector(O.fwd, 7.5), O.vel);
  }

  const planes = O ? [P, O] : [P];
  combat.update(dt, planes, now, G.mode === 'online' ? net.oneWay : 0);

  // ---- network send ----
  if (G.mode === 'online') {
    G.sendT -= dt;
    if (G.sendT <= 0) {
      G.sendT = 1 / 30;
      const ms = [];
      for (const m of combat.missiles) if (m.owner === P) ms.push([m.id, ...[m.pos.x, m.pos.y, m.pos.z, m.vel.x, m.vel.y, m.vel.z].map((x) => Math.round(x * 10) / 10)]);
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
  const gunDist = oppAlive ? Math.min(1500, Math.max(300, oppDist)) : 1000;
  const gunPoint = P.pos.clone().addScaledVector(P.fwd, gunDist);
  const vhat = P.vel.clone().normalize();
  const fpmPoint = P.pos.clone().addScaledVector(vhat, 1000);
  let leadPoint = null, closure = null;
  if (oppAlive) {
    const rel = O.pos.clone().sub(P.pos);
    closure = -rel.dot(O.vel.clone().sub(P.vel)) / Math.max(oppDist, 1);
    if (oppDist < 2500 && rel.dot(P.fwd) > 0) {
      const dir = computeLeadDir(P.pos, P.vel, O.pos, O.vel, new THREE.Vector3());
      leadPoint = P.pos.clone().addScaledVector(dir, oppDist);
    }
  }
  const threats = combat.threatsTo(P).map((m) => ({ pos: m.pos }));
  let threatDist = 1e9; for (const t of threats) threatDist = Math.min(threatDist, t.pos.distanceTo(P.pos));
  const gh = groundHeight(P.pos.x, P.pos.z);
  const agl = P.pos.y - gh;
  const pullUp = P.vel.y < -5 && agl / -P.vel.y < 6;
  const seekerPx = (Math.tan(SEEKER_CONE) / Math.tan((camera.fov * Math.PI) / 360)) * (H / 2);
  let hint = null;
  if (G.phase === 'countdown' && G.round === 1) hint = 'W/S pitch · A/D roll · Q/E rudder · R/F throttle · SPACE gun · X missile · C flares · T padlock · V view · SHIFT fine aim · H help';
  hud.draw({
    active: true, plane: P, opp: oppAlive ? O : null, oppDist, oppName: G.oppName, myName: (settings.name || 'YOU').toUpperCase(),
    project, camSpace, camPos: camera.position, gunPoint, fpmPoint, leadPoint, closure,
    lock: { inCone: P.inCone, progress: P.lockProgress, locked: P.locked }, seekerPx,
    threats, threatDist, agl, pullUp, bounds: P.outOfBounds > 0 ? 10 - P.outOfBounds : 0,
    scores: G.scores, roundsToWin: G.roundsToWin, countdown: G.phase === 'countdown' ? G.phaseT : 0,
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
  saveSettings();
}
function initMenu() {
  $('callsign').value = settings.name;
  $('invert').checked = settings.invert;
  $('rounds').value = String(settings.rounds);
  $('difficulty').value = settings.difficulty;
  $('sound').checked = settings.sound;
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
window.__game = { G, combat, camera };
