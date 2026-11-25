// Scenarios: who flies what, where everyone starts, the map, time of day, weather and rules.
// A scenario is plain JSON so it can be saved locally, shared as a code or link, and sent by the
// host to everyone in an online room.
import * as THREE from 'three';
import { JETS, JETS_OF, COUNTRIES, DEFAULT_JET } from './aircraft.js';
import { MAPS, TIMES, WEATHER, ARENA_RADIUS } from './world.js';

export const MAX_PER_SIDE = 8;
export const SKILL_LABELS = { drone: 'Target drone', rookie: 'Rookie', pilot: 'Veteran', ace: 'Ace' };
export const FORMATIONS = { line: 'Line abreast', echelon: 'Echelon right', trail: 'Trail', wall: 'Wall (two rows)', spread: 'Wide spread' };
export const SIDE_COLORS = ['#7fb8ff', '#ff8a7a'];

const clamp = (x, a, b, d) => (typeof x === 'number' && isFinite(x) ? Math.min(b, Math.max(a, x)) : d);
const pick = (x, obj, d) => (Object.prototype.hasOwnProperty.call(obj, x) ? x : d);
const str = (x, n, d) => (typeof x === 'string' ? x.replace(/[<>&"]/g, '').slice(0, n) || d : d);

// jet field: 'choice' (the human pilot's own pick), 'random', 'c:<country>', 'lead' (same as slot 1), or a jet key
export function validJetSpec(j) {
  if (j === 'choice' || j === 'random' || j === 'lead') return true;
  if (typeof j === 'string' && j.startsWith('c:') && COUNTRIES[j.slice(2)]) return true;
  return !!JETS[j];
}
export function jetSpecLabel(j) {
  if (j === 'choice') return "Pilot's choice";
  if (j === 'random') return 'Random';
  if (j === 'lead') return 'Same as lead';
  if (j.startsWith('c:')) return `Random ${COUNTRIES[j.slice(2)].short}`;
  return JETS[j] ? JETS[j].name : j;
}

export function slot(pilot = 'ai', jet = 'random', skill = 'pilot', loadout = '', ai) { const q = { pilot, jet, skill, loadout }; if (ai) q.ai = ai; return q; }

// ---------------- AI pilots ----------------
// Each AI has abilities (set by its experience level) and a temperament (set by its personality),
// all 0-100 and individually adjustable, plus orders that say what it should do in the fight.
export const AI_STATS = {
  reflex: { name: 'Reflexes', lo: 'slow', hi: 'instant', help: 'How quickly it reacts to what the enemy does.' },
  aware:  { name: 'Awareness', lo: 'tunnel vision', hi: 'eyes everywhere', help: 'How soon it notices threats, especially behind it, and reacts to its warning receiver.' },
  gun:    { name: 'Gunnery', lo: 'sprays', hi: 'deadeye', help: 'Aim, gun range and trigger discipline.' },
  fly:    { name: 'Flying', lo: 'timid', hi: 'on the limit', help: 'How hard it pulls, how low it dares to fly, and how well it keeps its speed.' },
  tac:    { name: 'Tactics', lo: 'clueless', hi: 'textbook', help: 'Shot timing, missile support (cranking), notching, flare and chaff timing, dragging away from missiles, using terrain.' },
  agg:    { name: 'Aggression', lo: 'cautious', hi: 'reckless', help: 'How early it shoots, how hard it presses in, and how much danger it ignores.' },
  nerve:  { name: 'Courage', lo: 'scared', hi: 'fearless', help: 'How much damage, missiles and lost wingmen it takes before it breaks off and runs home.' },
  team:   { name: 'Teamwork', lo: 'lone wolf', hi: 'loyal wingman', help: 'Flying formation, splitting targets with its flight and helping friends under attack.' },
};
export const ABILITY_KEYS = ['reflex', 'aware', 'gun', 'fly', 'tac'];
export const TEMPER_KEYS = ['agg', 'nerve', 'team'];
export const SKILL_BASE = {
  drone:  { reflex: 15, aware: 10, gun: 0, fly: 25, tac: 5 },
  rookie: { reflex: 30, aware: 30, gun: 30, fly: 40, tac: 25 },
  pilot:  { reflex: 62, aware: 62, gun: 62, fly: 72, tac: 62 },
  ace:    { reflex: 92, aware: 90, gun: 88, fly: 96, tac: 92 },
};
export const PERSONALITIES = {
  balanced: { name: 'Balanced', agg: 50, nerve: 60, team: 60, style: 'mixed', desc: 'Fights sensibly, sticks with its flight, breaks off when badly hurt.' },
  aggressive: { name: 'Aggressive', agg: 78, nerve: 75, team: 50, style: 'mixed', desc: 'Shoots early and presses the attack.' },
  reckless: { name: 'Reckless', agg: 96, nerve: 96, team: 20, style: 'wvr', desc: 'Charges in, takes head-on gun shots, ignores threats until too late, never runs.' },
  cautious: { name: 'Cautious', agg: 22, nerve: 45, team: 70, style: 'bvr', desc: 'Keeps its distance, defends early, turns away from incoming missiles.' },
  scared: { name: 'Scared', agg: 15, nerve: 8, team: 35, style: 'bvr', desc: 'Panics when locked or shot at and runs for home.' },
  sniper: { name: 'BVR sniper', agg: 50, nerve: 68, team: 60, style: 'bvr', desc: 'Long-range shots, then cranks and extends. Avoids the merge.' },
  brawler: { name: 'Dogfighter', agg: 85, nerve: 82, team: 40, style: 'wvr', desc: 'Wants the knife fight: closes fast for heat-seekers and guns.' },
  wingman: { name: 'Loyal wingman', agg: 50, nerve: 85, team: 98, style: 'mixed', desc: 'Stays on its leader, splits targets, comes to help.' },
  lone: { name: 'Lone wolf', agg: 72, nerve: 70, team: 5, style: 'mixed', desc: 'Ignores its flight and hunts on its own.' },
};
export const STYLES = { mixed: 'Any range', bvr: 'Long range (avoids the merge)', wvr: 'Close in (dogfight)' };
export const ORDERS = {
  engage: { name: 'Hunt', desc: 'Search for the enemy and attack.' },
  cap: { name: 'Patrol (CAP)', desc: "Orbit the side's start point; attack enemies that come within the commit range." },
  escort: { name: 'Escort slot 1', desc: 'Stay with the flight leader; attack only enemies near it.' },
  ambush: { name: 'Ambush', desc: 'Wait low with the radar off (invisible to warning receivers); pounce when an enemy comes within the commit range.' },
  drone: { name: 'Target drone', desc: 'Fly lazy circuits and never shoot.' },
};
export const WEAPON_RULES = { all: 'All weapons', nobvr: 'IR missiles and guns', guns: 'Guns only', hold: 'Weapons hold' };
export const PRIORITIES = { nearest: 'Nearest / easiest', threat: 'Biggest threat', humans: 'Human pilots first', weak: 'Damaged jets first' };

export function aiDefault(skill = 'pilot', per = 'balanced') {
  const B = SKILL_BASE[skill] || SKILL_BASE.pilot, Pp = PERSONALITIES[per] || PERSONALITIES.balanced;
  return { per, st: { ...B, agg: Pp.agg, nerve: Pp.nerve, team: Pp.team }, style: Pp.style, ord: skill === 'drone' ? 'drone' : 'engage', wpn: 'all', pri: 'nearest', commit: 30 };
}
// The full AI setup for a slot (slots without custom settings use their experience level).
export function aiConfig(q) {
  const d = aiDefault(q.skill);
  if (!q.ai) return d;
  const a = q.ai, st = {};
  for (const k of Object.keys(AI_STATS)) st[k] = clamp(a.st && a.st[k], 0, 100, d.st[k]);
  return {
    per: pick(a.per, PERSONALITIES, 'balanced'), st, style: pick(a.style, STYLES, d.style),
    ord: pick(a.ord, ORDERS, d.ord), wpn: pick(a.wpn, WEAPON_RULES, 'all'), pri: pick(a.pri, PRIORITIES, 'nearest'),
    commit: clamp(a.commit, 3, 80, 30),
  };
}
export function aiLabel(q) {
  const c = aiConfig(q);
  const custom = q.ai && (ABILITY_KEYS.some((k) => c.st[k] !== (SKILL_BASE[q.skill] || SKILL_BASE.pilot)[k]) || TEMPER_KEYS.some((k) => c.st[k] !== PERSONALITIES[c.per][k]));
  return `${PERSONALITIES[c.per].name}${custom ? '*' : ''} · ${ORDERS[c.ord].name}${c.wpn !== 'all' ? ' · ' + WEAPON_RULES[c.wpn] : ''}`;
}

function side(name, x, z, slots, o = {}) {
  return { name, x, z, alt: o.alt ?? 3000, spd: o.spd ?? 250, hdg: o.hdg ?? null, form: o.form || 'line', spacing: o.spacing ?? 1200, slots };
}
function scn(id, name, desc, o, blue, red) {
  return { v: 1, id, name, desc, map: o.map || 'islands', time: o.time || 'day', weather: o.weather || 'scattered', rounds: o.rounds ?? 3, timeLimit: o.timeLimit ?? 0, sides: [blue, red] };
}
const H = (jet = 'choice') => slot('human', jet);
const A = (jet = 'random', skill = 'pilot', loadout = '', per, o = {}) => slot('ai', jet, skill, loadout, per || Object.keys(o).length ? { ...aiDefault(skill, per || 'balanced'), ...o } : undefined);

export const PRESETS = [
  scn('duel-bvr', 'Duel: beyond visual range', '1v1 starting 36 km apart. Find the bandit on radar and fight it out.', {},
    side('Blue', -900, 18000, [H()]), side('Red', 900, -18000, [A('random', 'pilot')])),
  scn('duel-merge', 'Duel: merge', '1v1 starting 7 km apart, nose to nose. Straight into the dogfight.', {},
    side('Blue', -150, 3600, [H()], { spd: 210 }), side('Red', 150, -3600, [A('random', 'pilot')], { spd: 210 })),
  scn('pair-sweep', '2v2 fighter sweep', 'You and an AI wingman flying the same jet against a pair of bandits.', { weather: 'broken' },
    side('Blue', 0, 20000, [H(), A('lead', 'pilot')], { spacing: 1800 }), side('Red', 0, -20000, [A('random', 'pilot'), A('lead', 'pilot')], { spacing: 1800 })),
  scn('furball', '4v4 furball', 'Two four-ships merge at 10 km. Chaos, guns and heat-seekers.', { time: 'dusk' },
    side('Blue', 0, 5000, [H(), A('lead', 'pilot'), A('lead', 'pilot'), A('lead', 'pilot')], { spd: 220, spacing: 1000, form: 'wall' }),
    side('Red', 0, -5000, [A('random', 'pilot'), A('lead', 'pilot'), A('lead', 'pilot'), A('lead', 'pilot')], { spd: 220, spacing: 1000, form: 'wall' })),
  scn('raptors', 'Raptors vs Flankers', 'Two F-22s against six Su-35s and J-16s. Stay unseen and pick them off.', { map: 'alps', weather: 'clear' },
    side('Blue', -2000, 22000, [H('f22a'), A('f22a', 'ace')], { alt: 6000, spacing: 3000 }),
    side('Red', 2000, -22000, [A('su35s', 'pilot', '', 'aggressive'), A('su35s', 'pilot', '', 'wingman'), A('j16', 'pilot', '', 'sniper'), A('j16', 'pilot', '', 'wingman'), A('su35s', 'rookie', '', 'reckless'), A('j16', 'rookie', '', 'scared')], { alt: 5000, spacing: 2000, form: 'wall' })),
  scn('night-alps', 'Night intercept', '2v2 in the Alpine valleys by moonlight. Short visual range, so trust your sensors.', { map: 'alps', time: 'night', weather: 'clear' },
    side('Blue', 0, 18000, [H(), A('lead', 'ace')], { alt: 3600 }), side('Red', 0, -18000, [A('c:rus', 'ace'), A('lead', 'ace')], { alt: 3600 })),
  scn('canyon', 'Canyon knife fight', '1v1 merge at low level over the desert mesas. Guns and IR missiles.', { map: 'desert', weather: 'clear', time: 'day' },
    side('Blue', -150, 3600, [slot('human', 'choice', 'pilot', 'dogfight')], { alt: 1200, spd: 200 }), side('Red', 150, -3600, [A('random', 'ace', 'dogfight')], { alt: 1200, spd: 200 })),
  scn('coop', 'Co-op: 4 pilots vs 8 AI', 'Up to four humans team up against eight AI fighters. Empty seats are flown by AI.', { map: 'arctic', weather: 'overcast' },
    side('Blue', 0, 22000, [H(), H(), H(), H()], { spacing: 1500 }),
    side('Red', 0, -22000, [A('random', 'pilot', '', 'aggressive'), A('random', 'pilot', '', 'wingman'), A('random', 'pilot', '', 'cautious'), A('random', 'pilot', '', 'sniper'), A('random', 'rookie', '', 'scared'), A('random', 'rookie', '', 'reckless'), A('random', 'ace', '', 'brawler'), A('random', 'ace', '', 'lone')], { spacing: 1500, form: 'wall' })),
  scn('ambush', 'Valley ambush', 'Sweep the Alpine valleys with your wingman. Two Flankers patrol ahead; two more lurk low with their radars off.', { map: 'alps', weather: 'scattered' },
    side('Blue', 0, 22000, [H(), A('lead', 'pilot', '', 'wingman')], { alt: 4000, spacing: 1500 }),
    side('Red', 0, -14000, [A('su35s', 'pilot', '', 'balanced', { ord: 'cap', commit: 25 }), A('lead', 'pilot', '', 'wingman', { ord: 'cap', commit: 25 }),
      A('su35s', 'ace', '', 'aggressive', { ord: 'ambush', commit: 14 }), A('lead', 'pilot', '', 'brawler', { ord: 'ambush', commit: 14 })], { alt: 3500, spacing: 5000, form: 'spread' })),
  scn('teams', 'Team battle 8v8', 'Sixteen seats, eight a side. Humans take the seats; AI flies the rest.', { weather: 'scattered' },
    side('Blue', 0, 20000, Array.from({ length: 8 }, () => H()), { spacing: 1400, form: 'wall' }),
    side('Red', 0, -20000, Array.from({ length: 8 }, () => H()), { spacing: 1400, form: 'wall' })),
];

export function blankScenario() {
  const s = JSON.parse(JSON.stringify(PRESETS[2]));
  s.id = 'u' + Math.random().toString(36).slice(2, 8); s.name = 'My scenario'; s.desc = '';
  return s;
}

// Make anything (user input, a pasted code, a network message) into a valid scenario.
export function sanitize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {
    v: 1, id: str(r.id, 24, 'u' + Math.random().toString(36).slice(2, 8)), name: str(r.name, 48, 'Untitled'), desc: str(r.desc, 200, ''),
    map: pick(r.map, MAPS, 'islands'), time: pick(r.time, TIMES, 'day'), weather: pick(r.weather, WEATHER, 'scattered'),
    rounds: Math.round(clamp(r.rounds, 1, 9, 3)), timeLimit: Math.round(clamp(r.timeLimit, 0, 30, 0)), sides: [],
  };
  for (let k = 0; k < 2; k++) {
    const s = (Array.isArray(r.sides) && r.sides[k]) || {};
    const slots = (Array.isArray(s.slots) ? s.slots : []).slice(0, MAX_PER_SIDE).map((q) => ({
      pilot: q && q.pilot === 'human' ? 'human' : 'ai',
      jet: q && validJetSpec(q.jet) ? q.jet : 'random',
      skill: pick(q && q.skill, SKILL_LABELS, 'pilot'),
      loadout: typeof (q && q.loadout) === 'string' ? q.loadout.slice(0, 16) : '',
      ...(q && q.ai && typeof q.ai === 'object' ? { ai: aiConfig({ skill: pick(q.skill, SKILL_LABELS, 'pilot'), ai: q.ai }) } : {}),
    }));
    if (!slots.length) slots.push(slot(k === 0 ? 'human' : 'ai', k === 0 ? 'choice' : 'random'));
    out.sides.push({
      name: str(s.name, 16, k === 0 ? 'Blue' : 'Red'),
      x: clamp(s.x, -ARENA_RADIUS, ARENA_RADIUS, 0), z: clamp(s.z, -ARENA_RADIUS, ARENA_RADIUS, k === 0 ? 18000 : -18000),
      alt: clamp(s.alt, 300, 12000, 3000), spd: clamp(s.spd, 120, 400, 250),
      hdg: s.hdg == null ? null : clamp(s.hdg, -360, 720, 0),
      form: pick(s.form, FORMATIONS, 'line'), spacing: clamp(s.spacing, 300, 5000, 1200), slots,
    });
  }
  return out;
}

// ---- share codes: deflate + base64url when the browser can, plain base64 otherwise ----
const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = (s) => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
async function pipe(bytes, stream) { const r = new Blob([bytes]).stream().pipeThrough(stream); return new Uint8Array(await new Response(r).arrayBuffer()); }
export async function encodeScenario(s) {
  const json = new TextEncoder().encode(JSON.stringify(sanitize(s)));
  if (typeof CompressionStream !== 'undefined') {
    try { return 'z' + b64(await pipe(json, new CompressionStream('deflate-raw'))); } catch {}
  }
  return 'j' + b64(json);
}
export async function decodeScenario(code) {
  try {
    code = String(code || '').trim();
    const m = code.match(/[?&#]s=([A-Za-z0-9_-]+)/);
    if (m) code = m[1];
    let bytes = unb64(code.slice(1));
    if (code[0] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    else if (code[0] !== 'j') return null;
    return sanitize(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { return null; }
}

// ---- geometry ----
// Heading in degrees: 0 = north (-Z), 90 = east (+X). null = point at the other side.
export function sideHeading(s, k) {
  const sd = s.sides[k], o = s.sides[1 - k];
  if (sd.hdg != null) return sd.hdg;
  return (Math.atan2(o.x - sd.x, -(o.z - sd.z)) * 180) / Math.PI;
}
// Formation offsets: [right, back] in metres for each slot, lead at the front.
export function formationOffsets(form, n, sp) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (form === 'trail') out.push([0, i * sp]);
    else if (form === 'echelon') out.push([i * sp * 0.8, i * sp * 0.6]);
    else if (form === 'wall') { const row = Math.floor(i / 4), col = i % 4; out.push([(col - 1.5) * sp, row * sp * 1.4]); }
    else if (form === 'spread') out.push([(i - (n - 1) / 2) * sp * 2.2, (i % 2) * sp * 0.8]);
    else out.push([(i - (n - 1) / 2) * sp, 0]);
  }
  return out;
}
const UP = new THREE.Vector3(0, 1, 0);
// Start position, orientation and speed of every slot. groundAt(x, z) keeps them clear of terrain.
export function spawnPoints(s, groundAt) {
  const res = [[], []];
  for (let k = 0; k < 2; k++) {
    const sd = s.sides[k];
    const hdg = (sideHeading(s, k) * Math.PI) / 180;
    const fwd = new THREE.Vector3(Math.sin(hdg), 0, -Math.cos(hdg)), right = new THREE.Vector3(Math.cos(hdg), 0, Math.sin(hdg));
    const quat = new THREE.Quaternion().setFromAxisAngle(UP, -hdg);
    const offs = formationOffsets(sd.form, sd.slots.length, sd.spacing);
    offs.forEach(([r, b], i) => {
      const pos = new THREE.Vector3(sd.x, 0, sd.z).addScaledVector(right, r).addScaledVector(fwd, -b);
      const lim = ARENA_RADIUS - 800, d = Math.hypot(pos.x, pos.z);
      if (d > lim) pos.multiplyScalar(lim / d);
      pos.y = Math.max(sd.alt + (sd.form === 'wall' && i >= 4 ? 300 : 0), (groundAt ? groundAt(pos.x, pos.z) : 0) + 500);
      res[k].push({ pos, quat: quat.clone(), speed: sd.spd });
    });
  }
  return res;
}

export function countSeats(s) { let h = 0, a = 0; for (const sd of s.sides) for (const q of sd.slots) q.pilot === 'human' ? h++ : a++; return { human: h, ai: a }; }
export function summary(s) {
  const n = s.sides.map((sd) => sd.slots.length);
  const seats = countSeats(s);
  const d = Math.hypot(s.sides[0].x - s.sides[1].x, s.sides[0].z - s.sides[1].z);
  return `${n[0]}v${n[1]} · ${MAPS[s.map].name} · ${TIMES[s.time].name} · ${WEATHER[s.weather].name} · ${(d / 1000).toFixed(0)} km apart · ${seats.human} human seat${seats.human === 1 ? '' : 's'} · first to ${s.rounds}`;
}

// Resolve jet specs into concrete jets. `choiceOf(slot)` gives a human's own pick, or null.
export function resolveJet(spec, leadType, choice) {
  const all = Object.keys(JETS);
  const rnd = (list) => list[Math.floor(Math.random() * list.length)];
  if (spec === 'choice') return choice && JETS[choice] ? choice : rnd(all);
  if (spec === 'lead') return leadType || rnd(all);
  if (spec === 'random') return rnd(all);
  if (spec.startsWith('c:')) return rnd(JETS_OF(spec.slice(2)));
  return JETS[spec] ? spec : DEFAULT_JET;
}
