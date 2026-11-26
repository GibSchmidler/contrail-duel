// Ground units and ships: SAM batteries, anti-aircraft guns, vehicles, buildings, warships and
// aircraft carriers. Each one is also a "pseudo-aircraft" for the sensor and weapon code: it has
// a position, axes, a radar and a side, so SAM missiles, the RWR and the datalink just work.
import * as THREE from 'three';
import { WEAPONS, GUNS, flyout, launchZone } from './arsenal.js';
import { groundHeight, lineOfSight, visRange } from './world.js';
import { detectRange, inNotch } from './sensors.js';
import { computeLeadDir, airDensity } from './flight.js';

export const UNIT_CATS = { sam: 'Air defence: missiles', aaa: 'Air defence: guns', target: 'Ground targets', ship: 'Ships' };
// Unit guns (rate in rounds/s; sigma: dispersion in radians).
export const UNIT_GUNS = {
  phalanx: { name: 'M61 (Phalanx)', rate: 75, spinUp: 0.2, muzzle: 1100, sigma: 0.006, dragK: 2.9e-4, damage: 5 },
  zsu23:   { name: '4× 23 mm', rate: 56, spinUp: 0, muzzle: 970, sigma: 0.007, dragK: 3.0e-4, damage: 7 },
  gsh30k:  { name: '2× 30 mm', rate: 60, spinUp: 0, muzzle: 960, sigma: 0.006, dragK: 2.2e-4, damage: 11 },
  pgz25:   { name: '4× 25 mm', rate: 50, spinUp: 0, muzzle: 1050, sigma: 0.007, dragK: 2.6e-4, damage: 8 },
  kdn35:   { name: '2× 35 mm', rate: 18, spinUp: 0, muzzle: 1175, sigma: 0.005, dragK: 2.0e-4, damage: 18 },
  ak630:   { name: 'AK-630 30 mm', rate: 70, spinUp: 0.2, muzzle: 900, sigma: 0.007, dragK: 2.2e-4, damage: 10 },
};
const PI = Math.PI;

// A SAM battery (radar + several launchers) is one unit spread over ~50 m.
const SITE = (o) => ({ cat: 'sam', hp: 150, armor: 0.6, r: 48, h: 9, mesh: 'site', ammo: 8, interval: 5, inFlight: 2, acq: 2.5, minAgl: 40, reload: 90, ...o });
const SHORAD = (o) => ({ cat: 'sam', hp: 80, armor: 0.55, r: 8, h: 5, ammo: 8, interval: 3, inFlight: 2, acq: 1.2, minAgl: 12, reload: 90, ...o });
const MANPADS = (o) => ({ cat: 'sam', hp: 30, armor: 0, r: 6, h: 3, mesh: 'manpads', ammo: 4, interval: 6, inFlight: 1, acq: 2, maxAlt: 3500, reload: 70, ...o });
const AAA = (o) => ({ cat: 'aaa', hp: 70, armor: 0.5, r: 6, h: 4, mesh: 'spaag', acq: 1, gunRange: 2500, ...o });
const SHIP = (o) => ({ cat: 'ship', hp: 900, armor: 0.92, h: 34, acq: 1.5, minAgl: 8, ammo: 16, interval: 3, inFlight: 3, reload: 120, ship: true, ...o });

export const UNITS = {
  // ---------------- United States ----------------
  patriot: SITE({ country: 'usa', name: 'MIM-104 Patriot battery', short: 'Patriot', rwr: 'PT', radar: { range: 40000, lpi: 0.9, notchVr: 22 }, msl: 'pac2', interval: 6, minAgl: 50 }),
  nasams: SITE({ country: 'usa', name: 'NASAMS battery', short: 'NASAMS', rwr: 'NS', radar: { range: 26000, lpi: 0.8, notchVr: 22 }, msl: 'slamraam', ammo: 6, interval: 4, minAgl: 35 }),
  avenger: MANPADS({ country: 'usa', name: 'Avenger (Stinger)', short: 'Avenger', optical: 7000, msl: 'stinger', ammo: 8, interval: 4, hp: 60, armor: 0.3, r: 7, mesh: 'avenger', acq: 1.5, maxAlt: 3800 }),
  phalanx: AAA({ country: 'usa', name: 'Phalanx C-RAM', short: 'C-RAM', rwr: 'PH', radar: { range: 6000, lpi: 1, notchVr: 8 }, gun: 'phalanx', gunRange: 2200, mesh: 'ciws', hp: 60 }),
  cvn: SHIP({ country: 'usa', name: 'Nimitz-class carrier', short: 'Carrier', rwr: 'SS', radar: { range: 22000, lpi: 1, notchVr: 20 }, msl: 'sea_sparrow', gun: 'phalanx', gunRange: 2200, hp: 2200, mesh: 'carrier', deck: { len: 330, wid: 76, y: 19, ramp: false } }),
  ddg: SHIP({ country: 'usa', name: 'Arleigh Burke destroyer', short: 'DDG', rwr: 'SPY', radar: { range: 45000, lpi: 1, notchVr: 18 }, msl: 'sm2', gun: 'phalanx', gunRange: 2200, mesh: 'warship', len: 155, wid: 20 }),
  // ---------------- Russia ----------------
  s300: SITE({ country: 'rus', name: 'S-300PMU battery (SA-10)', short: 'SA-10', rwr: '10', radar: { range: 42000, lpi: 1, notchVr: 25 }, msl: 's300', interval: 6, minAgl: 45 }),
  buk: SITE({ country: 'rus', name: 'Buk-M1 battery (SA-11)', short: 'SA-11', rwr: '11', radar: { range: 30000, lpi: 1, notchVr: 28 }, msl: 'buk', interval: 5, minAgl: 35 }),
  tor: SHORAD({ country: 'rus', name: 'Tor-M1 (SA-15)', short: 'SA-15', rwr: '15', radar: { range: 14000, lpi: 1, notchVr: 20 }, msl: 'tor', mesh: 'tor' }),
  pantsir: SHORAD({ country: 'rus', name: 'Pantsir-S1 (SA-22)', short: 'SA-22', rwr: '22', radar: { range: 18000, lpi: 1, notchVr: 20 }, msl: 'pantsir', ammo: 12, gun: 'gsh30k', gunRange: 3000, mesh: 'pantsir', minAgl: 8 }),
  igla: MANPADS({ country: 'rus', name: 'Igla team (SA-18)', short: 'SA-18', optical: 6500, msl: 'igla' }),
  shilka: AAA({ country: 'rus', name: 'ZSU-23-4 Shilka', short: 'ZSU-23', rwr: 'A', radar: { range: 9000, lpi: 1, notchVr: 10 }, gun: 'zsu23', gunRange: 2500 }),
  cv_rus: SHIP({ country: 'rus', name: 'Admiral Kuznetsov carrier', short: 'Carrier', rwr: 'SS', radar: { range: 20000, lpi: 1, notchVr: 20 }, msl: 'tor', gun: 'ak630', gunRange: 2500, hp: 2000, mesh: 'carrier', deck: { len: 305, wid: 72, y: 18, ramp: true } }),
  ffg_rus: SHIP({ country: 'rus', name: 'Admiral Gorshkov frigate', short: 'Frigate', rwr: 'FG', radar: { range: 38000, lpi: 1, notchVr: 18 }, msl: 'redut', gun: 'ak630', gunRange: 2500, mesh: 'warship', len: 135, wid: 16, hp: 700 }),
  // ---------------- China ----------------
  hq9: SITE({ country: 'chn', name: 'HQ-9 battery', short: 'HQ-9', rwr: 'H9', radar: { range: 42000, lpi: 0.9, notchVr: 24 }, msl: 'hq9', interval: 6, minAgl: 45 }),
  hq16: SITE({ country: 'chn', name: 'HQ-16 battery', short: 'HQ-16', rwr: '16', radar: { range: 30000, lpi: 1, notchVr: 26 }, msl: 'hq16', ammo: 6, interval: 5, minAgl: 35 }),
  hq7: SHORAD({ country: 'chn', name: 'HQ-7 launcher', short: 'HQ-7', rwr: 'H7', radar: { range: 14000, lpi: 1, notchVr: 22 }, msl: 'hq7', ammo: 4, mesh: 'tor' }),
  qw2: MANPADS({ country: 'chn', name: 'QW-2 team', short: 'QW-2', optical: 6500, msl: 'qw2' }),
  pgz95: AAA({ country: 'chn', name: 'PGZ-95 SPAAG', short: 'PGZ-95', rwr: 'A', radar: { range: 9000, lpi: 1, notchVr: 10 }, gun: 'pgz25', gunRange: 2500 }),
  cv_chn: SHIP({ country: 'chn', name: 'Shandong (Type 002) carrier', short: 'Carrier', rwr: 'SS', radar: { range: 20000, lpi: 1, notchVr: 20 }, msl: 'hq7', gun: 'pgz25', gunRange: 2500, hp: 2000, mesh: 'carrier', deck: { len: 315, wid: 75, y: 18, ramp: true } }),
  ddg_chn: SHIP({ country: 'chn', name: 'Type 052D destroyer', short: 'DDG', rwr: 'H9', radar: { range: 42000, lpi: 0.9, notchVr: 18 }, msl: 'hq9', gun: 'pgz25', gunRange: 2500, mesh: 'warship', len: 157, wid: 18 }),
  // ---------------- Europe ----------------
  samp: SITE({ country: 'eur', name: 'SAMP/T battery (Aster 30)', short: 'SAMP/T', rwr: 'AS', radar: { range: 40000, lpi: 0.75, notchVr: 22 }, msl: 'aster30', interval: 5, minAgl: 40 }),
  iristslm: SITE({ country: 'eur', name: 'IRIS-T SLM battery', short: 'IRIS-T', rwr: 'IR', radar: { range: 28000, lpi: 0.8, notchVr: 22 }, msl: 'iristsl', interval: 4, minAgl: 30 }),
  mistral: MANPADS({ country: 'eur', name: 'Mistral team', short: 'Mistral', optical: 7000, msl: 'mistral' }),
  gepard: AAA({ country: 'eur', name: 'Gepard SPAAG', short: 'Gepard', rwr: 'A', radar: { range: 12000, lpi: 1, notchVr: 10 }, gun: 'kdn35', gunRange: 3300 }),
  cv_eur: SHIP({ country: 'eur', name: 'Charles de Gaulle carrier', short: 'Carrier', rwr: 'SS', radar: { range: 20000, lpi: 0.8, notchVr: 20 }, msl: 'aster15', hp: 1800, mesh: 'carrier', deck: { len: 262, wid: 64, y: 17, ramp: false } }),
  ffg_eur: SHIP({ country: 'eur', name: 'Horizon-class frigate', short: 'Frigate', rwr: 'AS', radar: { range: 40000, lpi: 0.75, notchVr: 18 }, msl: 'aster30', mesh: 'warship', len: 152, wid: 20, hp: 750 }),
  // ---------------- targets (any side) ----------------
  truck: { cat: 'target', name: 'Supply trucks', short: 'Trucks', hp: 30, armor: 0, r: 9, h: 3, mesh: 'trucks' },
  convoy: { cat: 'target', name: 'Moving convoy', short: 'Convoy', hp: 30, armor: 0.1, r: 9, h: 3, mesh: 'trucks', speed: 12 },
  tank: { cat: 'target', name: 'Tank platoon', short: 'Tanks', hp: 110, armor: 0.88, r: 10, h: 3, mesh: 'tanks' },
  apc: { cat: 'target', name: 'Armoured vehicles', short: 'APCs', hp: 70, armor: 0.6, r: 9, h: 3, mesh: 'apcs' },
  bunker: { cat: 'target', name: 'Hardened bunker', short: 'Bunker', hp: 320, armor: 0.97, r: 14, h: 6, mesh: 'bunker', hard: true },
  depot: { cat: 'target', name: 'Fuel depot', short: 'Depot', hp: 160, armor: 0.3, r: 32, h: 12, mesh: 'depot', big: true },
  hq: { cat: 'target', name: 'Command post', short: 'HQ', hp: 220, armor: 0.7, r: 22, h: 14, mesh: 'hq' },
  ewr: { cat: 'target', name: 'Early-warning radar', short: 'EWR', rwr: 'EW', radar: { range: 60000, lpi: 1, notchVr: 30 }, ewr: true, hp: 90, armor: 0.3, r: 12, h: 26, mesh: 'ewr' },
  cargo: { cat: 'ship', name: 'Cargo ship', short: 'Freighter', hp: 600, armor: 0.85, h: 24, mesh: 'cargo', len: 140, wid: 22, ship: true },
};
for (const [k, d] of Object.entries(UNITS)) {
  d.key = k;
  if (d.ship) { d.len = d.len || (d.deck ? d.deck.len : 140); d.wid = d.wid || (d.deck ? d.deck.wid : 20); d.r = Math.max(d.len, d.wid) / 2; }
}
export const UNITS_OF = (country) => Object.keys(UNITS).filter((k) => UNITS[k].country === country);
export const CARRIER_OF = { usa: 'cvn', rus: 'cv_rus', chn: 'cv_chn', eur: 'cv_eur' };

// ---------------------------------------------------------------- meshes
const CAMO = { usa: 0x8b7d55, rus: 0x56603e, chn: 0x5d6650, eur: 0x585f44, none: 0x6c6a58 };
const _mats = new Map();
function mat(hex, o = {}) {
  const k = hex + JSON.stringify(o);
  if (!_mats.has(k)) _mats.set(k, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0.1, flatShading: true, ...o }));
  return _mats.get(k);
}
const BURNT = new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 1, metalness: 0, flatShading: true });
function box(g, w, h, d, x, y, z, m, ry = 0) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y + h / 2, z); b.rotation.y = ry; g.add(b); return b; }
function cyl(g, r, h, x, y, z, m, seg = 10, rx = 0) { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); c.position.set(x, y + (rx ? 0 : h / 2), z); c.rotation.x = rx; g.add(c); return c; }
function truck(g, x, z, ry, cm, len = 9) {
  const t = new THREE.Group(); t.position.set(x, 0, z); t.rotation.y = ry; g.add(t);
  box(t, 2.6, 1.1, len, 0, 0.5, 0, mat(0x222222));
  box(t, 2.6, 2.0, 2.2, 0, 1.0, -len / 2 + 1.1, cm);
  return t;
}
function launcher(g, x, z, ry, cm, tubes = 4, tilt = 0.6) {
  const t = truck(g, x, z, ry, cm, 10);
  const rack = new THREE.Group(); rack.position.set(0, 2.2, 1.5); rack.rotation.x = tilt; t.add(rack);
  for (let i = 0; i < tubes; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 7, 8), cm); c.position.set((i % 2 - 0.5) * 0.9, 3.4, Math.floor(i / 2) * 0.9 - 0.45); rack.add(c); }
  return t;
}
function radarPanel(g, x, z, cm, y = 3.2, w = 3.6, h = 2.6) {
  const t = truck(g, x, z, 0, cm, 9);
  const mast = new THREE.Group(); mast.position.set(0, y, 1); t.add(mast);
  const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), mat(0xd8d8cc)); p.position.y = h / 2 + 0.4; p.rotation.x = -0.25; mast.add(p);
  return mast;
}
function tracked(g, x, z, ry, cm, len = 7, wid = 3.4) {
  const t = new THREE.Group(); t.position.set(x, 0, z); t.rotation.y = ry; g.add(t);
  box(t, wid, 0.9, len, 0, 0.1, 0, mat(0x1e1e1c));
  box(t, wid * 0.9, 1.2, len * 0.95, 0, 0.9, 0, cm);
  return t;
}
function hull(g, len, wid, draft, freeboard, m) {
  const sh = new THREE.Shape();
  sh.moveTo(-wid / 2, len / 2); sh.lineTo(wid / 2, len / 2); sh.lineTo(wid / 2, -len * 0.22); sh.quadraticCurveTo(wid * 0.45, -len * 0.45, 0, -len / 2); sh.quadraticCurveTo(-wid * 0.45, -len * 0.45, -wid / 2, -len * 0.22); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: draft + freeboard, bevelEnabled: false });
  geo.rotateX(-PI / 2); geo.translate(0, -draft, 0);
  const mesh = new THREE.Mesh(geo, m); g.add(mesh); return mesh;
}
function deckTexture(len, wid) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 512;
  const c = cv.getContext('2d');
  c.fillStyle = '#4a4d52'; c.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; c.fillRect(Math.random() * 128, Math.random() * 512, 6, 3); }
  c.strokeStyle = '#e8e8e0'; c.lineWidth = 2;
  // centre line + landing area edges (axial: the game's approach is straight down the deck)
  c.setLineDash([14, 10]); c.beginPath(); c.moveTo(64, 30); c.lineTo(64, 500); c.stroke(); c.setLineDash([]);
  c.strokeStyle = '#f0d040'; c.beginPath(); c.moveTo(30, 260); c.lineTo(30, 505); c.moveTo(98, 260); c.lineTo(98, 505); c.stroke();
  // arrestor wires
  c.strokeStyle = '#c8c8c0'; c.lineWidth = 1.5;
  for (const y of [420, 438, 456, 474]) { c.beginPath(); c.moveTo(26, y); c.lineTo(102, y); c.stroke(); }
  // catapult tracks at the bow
  c.strokeStyle = '#2a2c30'; c.lineWidth = 3;
  for (const x of [48, 80]) { c.beginPath(); c.moveTo(x, 10); c.lineTo(x, 140); c.stroke(); }
  c.fillStyle = '#e8e8e0'; c.font = 'bold 34px Arial'; c.textAlign = 'center'; c.fillText(String(60 + Math.floor(Math.random() * 20)), 64, 230);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildUnitMesh(D, country) {
  const g = new THREE.Group();
  const cm = mat(CAMO[country || D.country || 'none'] || CAMO.none);
  const spin = [];
  let turret = null;
  const grey = mat(0x8c939b), dark = mat(0x5a5f66);
  switch (D.mesh) {
    case 'site': {
      spin.push(radarPanel(g, 0, 0, cm));
      for (let i = 0; i < 4; i++) { const a = (i / 4) * PI * 2 + 0.4; launcher(g, Math.cos(a) * 34, Math.sin(a) * 34, -a + PI / 2, cm); }
      truck(g, -14, 22, 0.4, cm, 8); box(g, 6, 2.5, 4, 14, 0, -20, cm);
      break;
    }
    case 'tor': { const t = tracked(g, 0, 0, 0, cm); box(t, 2.6, 2.2, 3.2, 0, 2.1, 0.6, cm); const m = new THREE.Group(); m.position.set(0, 4.4, -0.6); t.add(m); const d = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.3), mat(0xcfcfc4)); d.position.y = 0.9; m.add(d); spin.push(m); turret = t; break; }
    case 'pantsir': {
      const t = truck(g, 0, 0, 0, cm, 10);
      const tu = new THREE.Group(); tu.position.set(0, 2.4, 1.5); t.add(tu);
      box(tu, 2.4, 1.6, 2.4, 0, 0, 0, cm);
      for (const s of [-1, 1]) { for (let i = 0; i < 3; i++) cyl(tu, 0.2, 3.5, s * 1.6, 1.2 + i * 0.45, 0.6, cm, 6, PI / 2); cyl(tu, 0.08, 3, s * 0.9, 0.9, -1.8, mat(0x222222), 6, PI / 2); }
      const d = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 0.25), mat(0xcfcfc4)); d.position.set(0, 2.4, 0); tu.add(d);
      turret = tu; break;
    }
    case 'avenger': { const t = truck(g, 0, 0, 0, cm, 5); const tu = new THREE.Group(); tu.position.set(0, 2.1, 0.6); t.add(tu); box(tu, 1.2, 1.1, 1.2, 0, 0, 0, cm); for (const s of [-1, 1]) box(tu, 0.5, 0.6, 1.6, s * 0.95, 0.4, 0, cm); turret = tu; break; }
    case 'manpads': { box(g, 7, 1.4, 5, 0, 0, 0, mat(0x4a5236)); for (const x of [-1.5, 1.5]) cyl(g, 0.35, 1.8, x, 0, 3.2, mat(0x3a4030), 6); break; }
    case 'ciws': { box(g, 3, 1.2, 3, 0, 0, 0, dark); const tu = new THREE.Group(); tu.position.y = 1.2; g.add(tu); cyl(tu, 1.0, 2.0, 0, 1.0, 0, mat(0xe0e0dc), 10); cyl(tu, 0.9, 1.6, 0, 1.8, 0, mat(0xe8e8e4), 10); cyl(tu, 0.18, 2.6, 0, 1.2, -1.6, mat(0x333333), 6, PI / 2); turret = tu; break; }
    case 'spaag': {
      const t = tracked(g, 0, 0, 0, cm);
      const tu = new THREE.Group(); tu.position.set(0, 2.1, 0.4); t.add(tu);
      box(tu, 2.8, 1.1, 3.0, 0, 0, 0, cm);
      for (const s of [-1, 1]) cyl(tu, 0.1, 3.6, s * 0.8, 0.6, -2.2, mat(0x222222), 6, PI / 2);
      const m = new THREE.Group(); m.position.set(0, 1.4, 1.0); tu.add(m); const d = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.2), mat(0xcfcfc4)); d.position.y = 0.5; m.add(d); spin.push(m);
      turret = tu; break;
    }
    case 'trucks': for (let i = 0; i < 4; i++) truck(g, (i % 2) * 4 - 2, i * 12 - 18, 0, cm, 8); break;
    case 'tanks': for (let i = 0; i < 3; i++) { const t = tracked(g, (i - 1) * 7, (i % 2) * 6, 0, cm, 7.5, 3.6); box(t, 2.4, 0.9, 3, 0, 2.0, 0.4, cm); cyl(t, 0.12, 4.5, 0, 2.45, -3, mat(0x2a2a28), 6, PI / 2); } break;
    case 'apcs': for (let i = 0; i < 3; i++) { const t = truck(g, (i - 1) * 6, (i % 2) * 7, 0, cm, 7); box(t, 2.6, 1.0, 6.4, 0, 1.4, 0.2, cm); } break;
    case 'bunker': { const c = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 20, 14, 1, false, 0, PI), mat(0x8e8a80)); c.rotation.z = PI / 2; c.rotation.y = PI / 2; c.position.y = 0; g.add(c); box(g, 4, 2.6, 2, 0, 0, -10.2, mat(0x2a2a2a)); break; }
    case 'depot': { for (let i = 0; i < 5; i++) { const a = i * 1.26; cyl(g, 6, 9, Math.cos(a) * 16, 0, Math.sin(a) * 16, mat(0xb9b9ae), 14); } box(g, 10, 4, 6, 0, 0, 0, cm); break; }
    case 'hq': { box(g, 22, 8, 14, 0, 0, 0, mat(0x9a948a)); box(g, 10, 5, 8, -14, 0, 10, cm); cyl(g, 0.25, 22, 6, 8, 2, mat(0x444444), 5); break; }
    case 'ewr': {
      for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const l = cyl(g, 0.25, 20, x, 0, z, mat(0x777777), 4); l.rotation.z = x * 0.03; }
      const m = new THREE.Group(); m.position.y = 20; g.add(m); const a = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 0.6), mat(0xd8d8cc)); a.position.y = 2.5; m.add(a); spin.push(m);
      box(g, 6, 3, 4, 8, 0, 6, cm);
      break;
    }
    case 'carrier': {
      const dk = D.deck, L = dk.len, Wd = dk.wid;
      hull(g, L * 0.96, Wd * 0.55, 9, dk.y - 2, grey);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(Wd, 2, L), [dark, dark, new THREE.MeshStandardMaterial({ map: deckTexture(L, Wd), roughness: 0.9 }), dark, dark, dark]);
      deck.position.set(0, dk.y - 1, 0); g.add(deck);
      if (dk.ramp) { const r = new THREE.Mesh(new THREE.BoxGeometry(Wd * 0.55, 2, 40), dark); r.position.set(0, dk.y + 3, -L / 2 + 16); r.rotation.x = 0.22; g.add(r); }
      const isl = new THREE.Group(); isl.position.set(Wd * 0.38, dk.y, L * 0.05); g.add(isl);
      box(isl, 9, 14, 30, 0, 0, 0, grey); box(isl, 7, 7, 16, 0, 14, -2, grey); cyl(isl, 0.5, 14, 0, 21, -2, mat(0x666666), 5);
      const m = new THREE.Group(); m.position.set(0, 34, -2); isl.add(m); const a = new THREE.Mesh(new THREE.BoxGeometry(6, 2.5, 0.4), mat(0xcfd2d6)); a.position.y = 1.3; m.add(a); spin.push(m);
      break;
    }
    case 'warship': {
      hull(g, D.len, D.wid, 6, 9, grey);
      box(g, D.wid * 0.6, 9, D.len * 0.22, 0, 9, -D.len * 0.05, grey);
      box(g, D.wid * 0.45, 7, D.len * 0.14, 0, 9, D.len * 0.2, grey);
      cyl(g, 0.6, 16, 0, 18, -D.len * 0.05, mat(0x666666), 5);
      box(g, 4, 2.5, 6, 0, 9, -D.len * 0.32, dark); cyl(g, 0.3, 7, 0, 10.5, -D.len * 0.36, dark, 6, PI / 2);
      const m = new THREE.Group(); m.position.set(0, 34, -D.len * 0.05); g.add(m); const a = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 0.4), mat(0xcfd2d6)); a.position.y = 1; m.add(a); spin.push(m);
      break;
    }
    case 'cargo': {
      hull(g, D.len, D.wid, 7, 8, mat(0x6b3a30));
      for (let i = 0; i < 6; i++) box(g, D.wid * 0.85, 5, 12, 0, 8, -D.len * 0.35 + i * 15, mat([0xb04030, 0x3060a0, 0xd0a030, 0x40804a][i % 4]));
      box(g, D.wid * 0.8, 12, 12, 0, 8, D.len * 0.4, mat(0xe8e8e0));
      break;
    }
    default: box(g, 6, 3, 6, 0, 0, 0, cm);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.userData.orig = o.material; } });
  g.userData.spin = spin; g.userData.turret = turret;
  return g;
}

// ---------------------------------------------------------------- simulation
const _rel = new THREE.Vector3(), _aim = new THREE.Vector3(), _sp = new THREE.Vector3(), _t = new THREE.Vector3();
const _fo = new Map();
function fo(key, rho) { const k = key + ':' + Math.round(rho * 10); if (!_fo.has(k)) _fo.set(k, flyout(key, 30, rho)); return _fo.get(k); }

export class Unit {
  // spec: { key, x, z, hdg (deg), side, name, country, emcon ('on' | 'ambush'), route: [[x, z], ...] }
  constructor(spec, id) {
    const D = UNITS[spec.key] || UNITS.truck;
    this.D = D; this.key = D.key; this.id = id; this.unit = true;
    this.side = spec.side | 0; this.country = spec.country || D.country || null;
    this.name = spec.name || D.short; this.fullName = D.name;
    this.hdgR = ((spec.hdg || 0) * PI) / 180;
    this.pos = new THREE.Vector3(spec.x, 0, spec.z);
    this.pos.y = D.ship ? 0 : groundHeight(spec.x, spec.z);
    this.base = this.pos.y;
    this.prevPos = this.pos.clone(); this.vel = new THREE.Vector3();
    this.home = this.pos.clone();
    this.fwd = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0); this.right = new THREE.Vector3();
    this.setHeading(this.hdgR);
    this.r = D.r; this.h = D.h; this.armor = D.armor || 0;
    if (D.ship) this.box = [D.len, D.wid];
    this.maxHp = D.hp; this.hp = D.hp; this.alive = true;
    this.radar = { contact: false, stt: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), acq: 0, mem: 0 };
    this.radarT = D.radar ? { name: D.name, range: D.radar.range, gimbal: PI, lpi: D.radar.lpi, ccm: 0.2, notchVr: D.radar.notchVr, lookDown: 1, stt: D.acq } : null;
    this.T = { rwr: D.rwr || 'SAM', stations: [[0, D.h + 1, 0, 'body']], gunPos: [0, Math.min(D.h, 6) + 1.5, 0], size: 1, rcs: 50, irSig: 3 };
    this.gunT = D.gun ? UNIT_GUNS[D.gun] : null;
    this.quatless = true;
    this.emcon = spec.emcon === 'ambush' ? 'ambush' : 'on';
    this.route = Array.isArray(spec.route) && spec.route.length ? spec.route : null; this.routeI = 0;
    // vehicles given a route drive it at road speed (ships always can)
    this.speed0 = D.speed || (this.route && !D.ship && !D.hard && !D.big && D.cat !== 'ship' ? 11 : 0);
    this.speed = this.speed0;
    this.reset();
    this.kills = 0; this.deaths = 0; this.ent = this; this.local = true;
  }
  reset() {
    const D = this.D;
    if (this.hdg0 == null) this.hdg0 = this.hdgR;
    this.setHeading(this.hdg0); this.speed = this.speed0; this.arrived = false;
    this.pos.copy(this.home); this.prevPos.copy(this.pos); this.vel.set(0, 0, 0); this.routeI = 0;
    if (!D.ship) this.base = this.pos.y;
    this.hp = this.maxHp; this.alive = true;
    this.ammo = D.ammo || 0; this.cd = 2 + Math.random() * 3; this.reloadT = 0;
    this.tgt = null; this.lockTgt = null; this.acqT = 0; this.offT = 0; this.awake = this.emcon !== 'ambush';
    this.radar.contact = this.radar.stt = false;
    this.flying = []; this.firing = false; this.gunAcc = 0; this.burstT = 0; this.gunSpin = 1;
    this.armSeen = new Set(); this.scanT = 0; this.aimYaw = this.hdgR; this.deadT = 0;
  }
  setHeading(a) {
    this.hdgR = a;
    this.fwd.set(Math.sin(a), 0, -Math.cos(a)); this.right.set(Math.cos(a), 0, Math.sin(a)); this.up.set(0, 1, 0);
  }
  get radarMode() { return this.alive && this.radarT && this.offT <= 0 && this.awake ? (this.radar.stt ? 2 : 1) : 0; }
  get speedMs() { return this.vel.length(); }
  // where the radar/optics sit (a little above the vehicle)
  sensorPos(out = _sp) { return out.copy(this.pos).setY(this.base + Math.min(this.h, 20) + 3); }

  canSee(p) {
    const D = this.D, sp = this.sensorPos();
    if (!p.alive || p.landed) return false;
    const d = p.pos.distanceTo(sp);
    const agl = p.pos.y - groundHeight(p.pos.x, p.pos.z);
    if (D.radar && this.radarMode > 0) {
      if (d > detectRange(D.radar.range, p, 0.2, sp, !!D.ewr)) return false;
      if (agl < (D.minAgl || 30) && d > 3000) return false;              // ground clutter hides very low flyers
      if (inNotch(sp, p, D.radar.notchVr)) return false;
      return lineOfSight(sp, p.pos, 5);
    }
    if (D.optical) {
      if (d > Math.min(D.optical, visRange() * 1.05) || p.pos.y > (D.maxAlt || 4000) + this.base) return false;
      return lineOfSight(sp, p.pos, 3);
    }
    return false;
  }

  // ctx: { enemies: [aircraft], combat, dt, wake (bool: an EWR on my side sees someone), say(text) }
  update(dt, ctx) {
    if (!this.alive) { this.deadT += dt; return; }
    const D = this.D;
    this.prevPos.copy(this.pos);
    if (this.route && this.speed > 0) this.drive(dt);
    if (this.offT > 0) { this.offT -= dt; if (this.offT <= 0 && ctx.say) ctx.say(`${this.name} radar back on`); }
    this.cd -= dt;
    if (D.ammo && this.ammo <= 0) { this.reloadT += dt; if (this.reloadT > D.reload) { this.ammo = D.ammo; this.reloadT = 0; } }
    this.flying = this.flying.filter((m) => ctx.combat.missiles.includes(m));
    if (!D.radar && !D.optical) return;
    // anti-radiation missile inbound: a smart crew switches the radar off
    if (D.radar && this.offT <= 0) {
      for (const m of ctx.combat.missiles) {
        if (m.target !== this || m.w.guidance !== 'arm' || this.armSeen.has(m)) continue;
        if (m.pos.distanceTo(this.pos) > 11000) continue;
        this.armSeen.add(m);
        if (Math.random() < (D.ship ? 0.2 : 0.55)) { this.offT = 22 + Math.random() * 10; this.radar.stt = false; this.lockTgt = null; this.tgt = null; if (ctx.say) ctx.say(`${this.name}: ARM inbound, radar off!`); }
      }
    }
    if (!this.awake) {
      // ambush: radar stays dark until an EWR or the crew's eyes report someone close
      if (ctx.wake || ctx.enemies.some((p) => p.alive && p.pos.distanceTo(this.pos) < Math.min(9000, (D.radar ? D.radar.range : 8000) * 0.45) && lineOfSight(this.sensorPos(), p.pos, 5))) { this.awake = true; this.cd = Math.max(this.cd, 1.5); }
      if (!this.awake) return;
    }
    // search: a few times a second, pick the closest aircraft I can see
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.4;
      let best = null, bd = 1e12;
      for (const p of ctx.enemies) {
        if (!this.canSee(p)) continue;
        const d = p.pos.distanceTo(this.pos) * (p === this.tgt ? 0.8 : 1);
        if (d < bd) { bd = d; best = p; }
      }
      if (best !== this.tgt) { this.tgt = best; this.acqT = 0; this.radar.stt = false; }
    }
    const T = this.tgt;
    if (!T || !T.alive) { this.tgt = null; this.radar.contact = this.radar.stt = false; this.lockTgt = null; this.firing = false; return; }
    if (!this.canSee(T)) { this.radar.stt = false; this.lockTgt = null; this.firing = false; this.acqT = Math.max(0, this.acqT - dt * 2); return; }
    this.acqT += dt;
    const R = this.radar;
    R.contact = true; R.pos.copy(T.pos); R.vel.copy(T.vel);
    R.stt = this.acqT > D.acq && !!D.radar;
    this.lockTgt = R.stt ? T : null;
    const ready = this.acqT > D.acq;
    const sp = this.sensorPos(_t);
    const dist = T.pos.distanceTo(sp);
    // turret / launcher points at the target
    _rel.copy(T.pos).sub(this.pos);
    this.aimYaw = Math.atan2(_rel.x, -_rel.z);
    // ---- missiles ----
    if (D.msl && ready && this.ammo > 0 && this.cd <= 0 && this.flying.length < D.inFlight) {
      const w = WEAPONS[D.msl];
      const closing = -_rel.copy(T.pos).sub(sp).normalize().dot(T.vel);
      const lz = launchZone(fo(D.msl, airDensity(sp.y)), closing, T.vel.length());
      const maxR = w.guidance === 'ir' ? Math.min(lz.rMax, w.seeker * 0.95) : lz.rMax;
      if (dist < maxR * 0.85 && dist > w.rMin) {
        // vertical / steep launch toward the target
        _aim.copy(T.pos).sub(sp).normalize();
        this.fwd.copy(_aim).multiplyScalar(0.5).add(_t.set(0, 1, 0)).normalize();
        this.right.crossVectors(this.fwd, _t.set(0, 1, 0)).normalize();
        if (this.right.lengthSq() < 0.1) this.right.set(1, 0, 0);
        this.up.crossVectors(this.right, this.fwd).normalize();
        const m = ctx.combat.launchMissile(this, T, D.msl, 0);
        this.setHeading(this.hdgR);
        if (m) { this.flying.push(m); this.ammo--; this.cd = D.interval * (0.8 + Math.random() * 0.4); if (ctx.onLaunch) ctx.onLaunch(this, m); }
      }
    }
    // ---- guns ----
    this.firing = false;
    if (this.gunT && dist < D.gunRange && (R.stt || dist < 2000)) {
      this.burstT = (this.burstT + dt) % 3.6;
      if (this.burstT < 2.4) {
        const muz = _t.copy(this.pos).setY(this.base + this.T.gunPos[1]);
        computeLeadDir(muz, this.vel, T.pos, T.vel, _aim, this.gunT);
        this.fwd.copy(_aim);
        this.right.crossVectors(this.fwd, this.up.set(0, 1, 0)).normalize();
        this.up.crossVectors(this.right, this.fwd).normalize();
        this.firing = true;
        this.gunAcc += dt * this.gunT.rate;
        while (this.gunAcc >= 1) { this.gunAcc -= 1; ctx.combat.fireBullet(this, true); }
        if (ctx.onGun) ctx.onGun(this);
        this.setHeading(this.hdgR);
      } else this.gunAcc = 0;
    }
  }

  // follow the route at road speed, hugging the terrain
  drive(dt) {
    const wp = this.route[this.routeI % this.route.length];
    _rel.set(wp[0] - this.pos.x, 0, wp[1] - this.pos.z);
    const d = _rel.length();
    if (d < 25) {
      // vehicles stop at the end of their route; ships keep sailing it round
      if (!this.D.ship && this.routeI >= this.route.length - 1) { this.speed = 0; this.vel.set(0, 0, 0); this.arrived = true; return; }
      this.routeI = (this.routeI + 1) % this.route.length; return;
    }
    _rel.divideScalar(d);
    const a = Math.atan2(_rel.x, -_rel.z);
    let da = a - this.hdgR; while (da > PI) da -= 2 * PI; while (da < -PI) da += 2 * PI;
    this.setHeading(this.hdgR + Math.max(-0.4 * dt, Math.min(0.4 * dt, da)));
    const sp = this.D.ship ? this.speed : this.speed * (Math.abs(da) > 0.6 ? 0.4 : 1);
    this.vel.copy(this.fwd).multiplyScalar(sp);
    this.pos.addScaledVector(this.vel, dt);
    if (!this.D.ship) { this.pos.y = groundHeight(this.pos.x, this.pos.z); this.base = this.pos.y; }
  }

  // carrier deck geometry: world <-> deck coordinates (along: + toward the bow, across: + to starboard)
  toDeck(p, out = {}) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, c = Math.cos(this.hdgR), s = Math.sin(this.hdgR);
    out.along = dx * s - dz * c; out.across = dx * c + dz * s; out.y = p.y - (this.base + this.D.deck.y);
    return out;
  }
  fromDeck(along, across, out = new THREE.Vector3(), up = 0) {
    const c = Math.cos(this.hdgR), s = Math.sin(this.hdgR);
    return out.set(this.pos.x + along * s + across * c, this.base + this.D.deck.y + up, this.pos.z - along * c + across * s);
  }
  onDeck(p) {
    if (!this.D.deck || !this.alive) return false;
    const q = this.toDeck(p);
    return Math.abs(q.along) < this.D.deck.len / 2 && Math.abs(q.across) < this.D.deck.wid / 2;
  }
}

// ---------------------------------------------------------------- visuals for a set of units
export class UnitView {
  constructor(scene, effects) { this.scene = scene; this.fx = effects; this.items = new Map(); }
  clear() { for (const it of this.items.values()) this.scene.remove(it.g); this.items.clear(); }
  sync(units) {
    for (const u of units) {
      if (this.items.has(u.id)) continue;
      const g = buildUnitMesh(u.D, u.country);
      this.scene.add(g);
      this.items.set(u.id, { g, u, dead: false, smokeAcc: 0 });
    }
  }
  update(dt, time) {
    for (const it of this.items.values()) {
      const { g, u } = it;
      g.position.copy(u.pos).setY(u.base);
      g.rotation.y = -u.hdgR;
      if (u.alive) {
        for (const s of g.userData.spin) s.rotation.y += dt * (u.radarMode > 0 ? 2.2 : 0);
        if (g.userData.turret) {
          let da = (-(u.aimYaw - u.hdgR)) - g.userData.turret.rotation.y;
          while (da > PI) da -= 2 * PI; while (da < -PI) da += 2 * PI;
          g.userData.turret.rotation.y += Math.max(-dt * 1.5, Math.min(dt * 1.5, da));
        }
      }
      if (!u.alive && !it.dead) {
        it.dead = true;
        g.traverse((o) => { if (o.isMesh) o.material = BURNT; });
        if (!u.D.ship) { g.scale.y = 0.6; g.rotation.z = (Math.random() - 0.5) * 0.15; }
        it.deadAt = time;
      }
      if (u.alive && it.dead) { it.dead = false; g.scale.y = 1; g.rotation.z = 0; g.traverse((o) => { if (o.isMesh && o.userData.orig) o.material = o.userData.orig; }); }
      if (it.dead) {
        const age = time - it.deadAt, life = u.D.ship ? 240 : 110;
        if (u.D.ship) g.position.y = u.base - Math.min(age * 0.25, u.D.h * 0.6);   // settling into the water
        if (age < life) {
          it.smokeAcc += dt * (u.D.big || u.D.ship ? 14 : 6);
          while (it.smokeAcc >= 1) { it.smokeAcc--; this.fx.smokeColumn(_t.copy(u.pos).setY(u.base + (u.D.ship ? 10 : 2)), age, life); }
        }
      }
    }
  }
}

// ---- network: the host simulates units; everyone else mirrors their state ----
export function packUnits(units) {
  return units.map((u) => [u.id, u.alive ? 1 : 0, Math.round(u.hp), u.radarMode, u.lockTgt && u.lockTgt.ent ? u.lockTgt.ent.id : -1, Math.round(u.aimYaw * 100) / 100, u.firing ? 1 : 0, Math.round(u.pos.x), Math.round(u.pos.z), Math.round(u.hdgR * 100) / 100, u.offT > 0 ? 1 : 0, u.awake ? 1 : 0]);
}
export function applyUnits(units, list, resolve) {
  const byId = new Map(units.map((u) => [u.id, u]));
  for (const [id, al, hp, rm, lt, yaw, f, x, z, h, off, awake] of list) {
    const u = byId.get(id);
    if (!u) continue;
    u.prevPos.copy(u.pos);
    if (u.speed > 0) { u.pos.x = x; u.pos.z = z; if (!u.D.ship) { u.pos.y = groundHeight(x, z); u.base = u.pos.y; } u.setHeading(h); }
    if (al) u.alive = true; else if (u.alive) u.deadPending = true;
    u.hp = hp; u.aimYaw = yaw; u.firing = !!f;
    u.offT = off ? 1 : 0; u.awake = !!awake;
    u.radar.stt = rm === 2; u.lockTgt = lt >= 0 && resolve ? resolve(lt) : null;
  }
}
