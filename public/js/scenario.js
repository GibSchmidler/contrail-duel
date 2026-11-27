// Scenarios: who flies what, where everyone starts, the map, time of day, weather and rules.
// A scenario is plain JSON so it can be saved locally, shared as a code or link, and sent by the
// host to everyone in an online room.
import * as THREE from 'three';
import { JETS, JETS_OF, COUNTRIES, DEFAULT_JET } from './aircraft.js';
import { MAPS, TIMES, WEATHER, ARENA_RADIUS } from './world.js';
import { UNITS } from './ground.js';

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
  route: { name: 'Fly a route', desc: 'Follow its waypoints (draw them on the map; the route loops) and attack enemies within the commit range.' },
  strike: { name: 'Strike ground targets', desc: 'Attack enemy ground units and ships with air-to-ground weapons (give it a strike loadout), defending itself when attacked.' },
  drone: { name: 'Target drone', desc: 'Fly lazy circuits and never shoot.' },
};
export const WEAPON_RULES = { all: 'All weapons', nobvr: 'IR missiles and guns', guns: 'Guns only', hold: 'Weapons hold' };
export const PRIORITIES = { nearest: 'Nearest / easiest', threat: 'Biggest threat', humans: 'Human pilots first', weak: 'Damaged jets first' };

// ---------------- missions ----------------
export const MODES = { battle: 'Battle', survival: 'Survival (endless waves)', race: 'Time trial (gates)', training: 'Training lesson' };
export const WIN_RULES = { elim: 'Last side flying wins the round', objectives: 'Complete the objectives', score: 'First to the score limit' };
export const OBJ_KINDS = {
  destroy: 'Destroy ground targets', defend: 'Protect ground units', eliminate: 'Shoot down every enemy aircraft',
  kills: 'Score a number of air kills', reach: 'Fly into a zone', survive: 'Hold out for a time',
};
export const TRIG_WHEN = { start: 'At mission start', time: 'After a time', enter: 'An aircraft enters a zone', unitDead: 'A ground unit is destroyed', waveDead: 'A wave is wiped out', objective: 'An objective is completed', kills: 'A side reaches a kill count' };
export const TRIG_DO = { spawn: 'Send in a wave', message: 'Radio message', complete: 'Complete an objective', fail: 'Fail an objective', win: 'A side wins', radar: 'Wake up SAM radars' };
export const MARKER_ICONS = { wp: 'Waypoint', target: 'Target', danger: 'Danger area', info: 'Note', home: 'Home base' };
export const MAX_UNITS = 40, MAX_WAVES = 12, MAX_OBJ = 12, MAX_TRIG = 20, MAX_MARK = 20, MAX_GATES = 40;
export const DEFAULT_RULES = { win: 'elim', scoreLimit: 20, respawn: 0, respawnT: 8, pts: { air: 1, ground: 1, death: 0, obj: 3 } };

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
  return { v: 1, id, name, desc, map: o.map || 'islands', time: o.time || 'day', weather: o.weather || 'scattered', rounds: o.rounds ?? 3, timeLimit: o.timeLimit ?? 0, sides: [blue, red], ...o.extra };
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

  // ---------------- missions ----------------
  scn('sead', 'Strike: Iron Hand', 'Suppress a Russian SAM network and destroy the fuel depot and command post behind it.', {
    rounds: 1, timeLimit: 25, weather: 'scattered',
    extra: {
      mode: 'battle', rules: { win: 'objectives' },
      briefing: 'A fuel depot and command post sit at the north end of the big island, defended by an SA-10 long-range battery on the ridge, an SA-11, an SA-15 and short-range guns and MANPADS around the target, cued by an early-warning radar to the east.\n\nYou carry anti-radiation missiles (press 3 for air-to-ground). Fire them at radars that are transmitting (amber on the HUD and RWR); the crews may switch off when they see an ARM coming. Your wingman carries bombs and will go for the target once you call it in (M then 4). Two Flankers are on alert and will scramble when you cross the coast.\n\nStay low behind the hills to hide from the SAM radars.',
      units: [
        { key: 's300', side: 1, x: 2000, z: -12000 }, { key: 'buk', side: 1, x: -1000, z: -16000 }, { key: 'tor', side: 1, x: 300, z: -17200 },
        { key: 'shilka', side: 1, x: -600, z: -18400 }, { key: 'ewr', side: 1, x: 6000, z: -10000 },
        { key: 'depot', side: 1, x: 0, z: -18000, name: 'Fuel depot' }, { key: 'hq', side: 1, x: 900, z: -18600, name: 'Command post' }, { key: 'igla', side: 1, x: -1500, z: -17500 },
      ],
      objectives: [
        { side: 0, kind: 'destroy', units: [5, 6], label: 'Destroy the fuel depot and command post' },
        { side: 0, kind: 'destroy', units: [0], label: 'Take out the SA-10 battery', optional: true },
      ],
      waves: [{ id: 1, name: 'Flanker alert', side: 1, x: 9000, z: -27000, alt: 5000, when: 'trigger', slots: [A('su35s', 'pilot', 'air', 'aggressive'), A('su35s', 'pilot', 'air', 'wingman')] }],
      triggers: [
        { when: 'enter', side: 0, x: 0, z: -12000, r: 9000, do: 'spawn', target: 1 },
        { when: 'enter', side: 0, x: 0, z: -12000, r: 9000, do: 'message', text: 'AWACS: two Flankers scrambling from the north!' },
        { when: 'unitDead', unit: 4, do: 'message', text: 'EWR is down: their SAMs are on their own now.' },
      ],
      markers: [{ x: 300, z: -18200, label: 'TARGET', icon: 'target' }, { x: 2000, z: -12000, label: 'SA-10', icon: 'danger' }, { x: 0, z: 24000, label: 'HOME', icon: 'home' }],
    },
  }, side('Blue', 0, 24000, [slot('human', 'choice', 'pilot', 'sead'), A('lead', 'pilot', 'bombs', 'wingman', { ord: 'strike' })], { alt: 4000, spacing: 1500 }),
     side('Red', 0, -24000, [A('mig29s', 'rookie', 'air', 'balanced', { ord: 'cap', commit: 20 })], { alt: 4000 })),
  scn('carrier', 'Survival: defend the carrier', 'Endless waves of fighters and anti-ship strikers attack your carrier group. Land on deck (gear J, flaps K) to rearm and repair; get shot down and you launch again from the catapult.', {
    rounds: 1, weather: 'scattered',
    extra: {
      mode: 'survival', rules: { win: 'elim', respawn: 1, respawnT: 6 },
      survival: { start: 2, grow: 1, max: 0, country: 'random', defend: 0, strike: 0.4, gap: 25 },
      briefing: 'Your carrier and its destroyer escort are under attack. Each wave is bigger than the last, and some attackers carry anti-ship missiles: shoot them down before they launch.\n\nThe ships defend themselves with SAMs and close-in guns, but they cannot hold out alone. When you run low on missiles, come back to the carrier: line up behind it, lower the gear (J) and flaps (K), slow to about 140 kt and fly onto the back of the deck to catch a wire. The crew rearms, refuels and repairs you, then throttle up to full power to launch.\n\nThe mission ends when the carrier is sunk. How many waves can you survive?',
      units: [{ key: 'cvn', side: 0, x: -16000, z: 2000, hdg: 0, name: 'CVN Resolute' }, { key: 'ddg', side: 0, x: -13800, z: 3200, hdg: 0, name: 'DDG Vigilant' }],
      markers: [{ x: -16000, z: 2000, label: 'CARRIER', icon: 'home' }],
    },
  }, side('Blue', -16000, 8000, [H(), A('lead', 'pilot', 'air', 'wingman'), A('lead', 'pilot', 'air', 'wingman')], { alt: 2500, spd: 220, hdg: 0, spacing: 1200 }), side('Red', 0, -24000, [])),
  scn('canyon-run', 'Time trial: canyon run', 'Race through 28 gates down the desert canyons. Stay below 250 m above the ground or the clock adds a penalty.', {
    rounds: 1, timeLimit: 10, map: 'desert', weather: 'clear',
    extra: {
      mode: 'race', laps: 1, ceiling: 250,
      gates: [[-20000, 440, 8800, 110], [-19200, 409, 8000, 110], [-17800, 250, 8800, 110], [-16200, 166, 8800, 110], [-14800, 155, 8200, 110], [-13200, 382, 7600, 110], [-11600, 222, 7400, 110], [-10200, 200, 6800, 110], [-8800, 280, 6000, 110], [-7600, 221, 4800, 110], [-7400, 164, 3200, 110], [-7400, 156, 1600, 110], [-7600, 220, 0, 110], [-7000, 200, -1400, 110], [-6600, 201, -3000, 110], [-5400, 207, -4200, 110], [-4800, 175, -5600, 110], [-5000, 172, -7200, 110], [-5200, 186, -8800, 110], [-5200, 177, -10400, 110], [-5400, 204, -12000, 110], [-4800, 324, -13600, 110], [-3400, 410, -14400, 110], [-2400, 200, -15600, 110], [-1200, 440, -16800, 110], [0, 440, -18000, 110], [1200, 440, -19200, 110], [2400, 441, -20400, 110]],
      briefing: 'Fly through every gate in order: the next gate is green, and an arrow points to it when it is off screen. The clock starts at the first gate. Flying more than 250 m above the ground for over a second adds a time penalty.\n\nKeep the speed up but not too high to turn: around 400-450 kt works well. Your best time is saved in your pilot profile.',
    },
  }, side('Blue', -21000, 10500, [H()], { alt: 460, spd: 210, hdg: 30 }), side('Red', 0, -24000, [])),
  scn('slalom', 'Time trial: mountain slalom', 'Two laps around the island peaks through 14 gates. No altitude limit, just raw speed and energy.', {
    rounds: 1, timeLimit: 15, weather: 'clear',
    extra: {
      mode: 'race', laps: 2,
      gates: [[0, 382, -17500, 150], [4122, 1975, -12559, 150], [10555, 1869, -12417, 150], [9262, 2098, -6114, 150], [13162, 1021, -996, 150], [7427, 2609, 1923, 150], [5857, 1218, 8163, 150], [0, 1486, 5500, 150], [-5857, 420, 8163, 150], [-7427, 474, 1923, 150], [-13162, 300, -996, 150], [-9262, 1881, -6114, 150], [-10555, 635, -12417, 150], [-4122, 1147, -12559, 150]],
      briefing: 'A two-lap course around the peaks of the big island. The gates climb and dive by up to 2 km, so trade speed for height and back again. The clock starts at the first gate.',
    },
  }, side('Blue', -6000, -10000, [H()], { alt: 900, spd: 230, hdg: 38 }), side('Red', 0, -24000, [])),
  scn('convoy', 'Strike: convoy hunt', 'A supply convoy is driving west across the desert under guard. Stop it before it reaches the coast road, then deal with the fighters sent to help.', {
    rounds: 1, timeLimit: 20, map: 'desert', weather: 'clear',
    extra: {
      mode: 'battle', rules: { win: 'objectives' },
      briefing: 'Two supply convoys are moving west along the desert floor, escorted by a Shilka, a Tor and an Igla team. Bomb or rocket them before they reach the marked rally point (about 8 minutes). Bombs: press 3, roll in, put the CCIP circle on the target and release with X. Rockets: hold X.\n\nA pair of MiG-29s will come looking for you three minutes in. Your wingman carries air-to-air missiles and covers you; tell it to attack your target with M then 1.',
      units: [
        { key: 'convoy', side: 1, x: -2000, z: -16000, hdg: 270, route: [[-6000, -15000], [-10000, -14000], [-15000, -12000], [-18000, -10000]] },
        { key: 'convoy', side: 1, x: -1200, z: -16300, hdg: 270, route: [[-6000, -15000], [-10000, -14000], [-15000, -12000], [-18000, -10000]] },
        { key: 'shilka', side: 1, x: -1600, z: -16200, hdg: 270, route: [[-6000, -15000], [-10000, -14000], [-15000, -12000], [-18000, -10000]] },
        { key: 'tor', side: 1, x: -9000, z: -11000 }, { key: 'igla', side: 1, x: -12000, z: -17000 },
        { key: 'tank', side: 1, x: -15500, z: -11500 }, { key: 'truck', side: 1, x: -18200, z: -9600 },
      ],
      objectives: [
        { side: 0, kind: 'destroy', units: [0, 1], label: 'Stop both convoys' },
        { side: 1, kind: 'reach', x: -18000, z: -10000, r: 1200, label: 'Convoy reaches the rally point' },
        { side: 0, kind: 'destroy', units: [5, 6], label: 'Destroy the tanks and trucks at the rally point', optional: true },
      ],
      waves: [{ id: 1, name: 'Fulcrum flight', side: 1, x: 4000, z: -26000, alt: 4000, when: 'time', t: 180, slots: [A('mig29s', 'pilot', 'air', 'aggressive'), A('mig29s', 'rookie', 'air', 'wingman')] }],
      triggers: [{ when: 'time', t: 175, do: 'message', text: 'AWACS: two MiG-29s inbound from the north!' }],
      markers: [{ x: -2000, z: -16000, label: 'CONVOY', icon: 'target' }, { x: -18000, z: -10000, label: 'RALLY POINT', icon: 'danger' }, { x: 0, z: 20000, label: 'HOME', icon: 'home' }],
    },
  }, side('Blue', 0, 18000, [slot('human', 'choice', 'pilot', 'cas'), A('lead', 'pilot', 'air', 'wingman', { ord: 'escort' })], { alt: 3000, spacing: 1400 }), side('Red', 0, -24000, [])),
  // ---------------- training ----------------
  ...[
    ['basics', 'Training 1: flight basics', 'Pitch, roll, throttle and afterburner, G, the airbrake, gear and flaps, trim and views.',
      { units: [], markers: [{ x: 0, z: 2000, label: 'WAYPOINT', icon: 'wp' }] }, side('Blue', 0, 20000, [H()], { alt: 1500, spd: 200, hdg: 0 })],
    ['guns', 'Training 2: gunnery', 'Close in on target drones and shoot them down with the cannon.',
      {}, side('Blue', 0, 20000, [H()], { alt: 3000, spd: 220, hdg: 0 }), side('Red', 0, 13000, [A('random', 'drone'), A('random', 'drone')], { alt: 3000, spd: 180, spacing: 2500 })],
    ['missiles', 'Training 3: air-to-air missiles', 'Heat-seekers, radar missiles and a helmet-cued high off-boresight shot against drones.',
      {}, side('Blue', 0, 20000, [H()], { alt: 4000, spd: 230, hdg: 0 }), side('Red', 0, 4000, [A('random', 'drone'), A('random', 'drone'), A('random', 'drone')], { alt: 4000, spd: 200, spacing: 3000, form: 'spread' })],
    ['defence', 'Training 4: missile defence', 'Fly into an SA-11 SAM envelope and defeat its missiles with chaff, the beam and terrain.',
      { units: [{ key: 'buk', side: 1, x: -1000, z: -16000 }], markers: [{ x: -1000, z: -16000, label: 'SA-11', icon: 'danger' }] }, side('Blue', 0, 26000, [H()], { alt: 5000, spd: 240, hdg: 0 })],
    ['strike', 'Training 5: bombing', 'Select bombs, roll in on the CCIP pipper and destroy trucks and tanks.',
      { units: [{ key: 'truck', side: 1, x: -600, z: -17000 }, { key: 'tank', side: 1, x: 700, z: -17600 }], markers: [{ x: -600, z: -17000, label: 'TARGET', icon: 'target' }] }, side('Blue', 0, 4000, [slot('human', 'f16c', 'pilot', 'bombs')], { alt: 3000, spd: 220, hdg: 0 })],
    ['sead', 'Training 6: SEAD', 'Lock and kill a SAM radar with HARM anti-radiation missiles.',
      { units: [{ key: 'buk', side: 1, x: -1000, z: -16000 }, { key: 'ewr', side: 1, x: 6000, z: -10000 }], markers: [{ x: -1000, z: -16000, label: 'SA-11', icon: 'danger' }] }, side('Blue', 0, 30000, [slot('human', 'f16c', 'pilot', 'sead')], { alt: 5000, spd: 240, hdg: 0 })],
    ['carrier', 'Training 7: carrier landing', 'Gear, flaps, approach speed and the glideslope: trap on the deck, rearm and launch from the catapult.',
      { units: [{ key: 'cvn', side: 0, x: -16000, z: 2000, hdg: 0, name: 'CVN Resolute' }], markers: [{ x: -16000, z: 2000, label: 'CARRIER', icon: 'home' }] }, side('Blue', -16000, 8500, [slot('human', 'fa18e', 'pilot', 'air')], { alt: 450, spd: 115, hdg: 0 })],
    ['aadef', 'Training 8: beating radar missiles', 'An aggressor fires R-77s at you from long and short range: drag, notch, chaff and cutting the datalink. The coach on the HUD shows what each missile is doing.',
      {}, side('Blue', 0, 20000, [slot('human', 'f16c', 'pilot', 'air')], { alt: 5000, spd: 250, hdg: 0 }), side('Red', 0, -18000, [A('su35s', 'drone')], { alt: 6500, spd: 230 })],
    ['irdef', 'Training 9: beating heat-seekers', 'Short-range R-73 shots from behind and head-on: afterburner, flares and the break turn.',
      {}, side('Blue', 0, 20000, [slot('human', 'f16c', 'pilot', 'air')], { alt: 4000, spd: 230, hdg: 0 }), side('Red', 0, 10000, [A('mig29s', 'drone')], { alt: 4000, spd: 220 })],
  ].map(([lesson, name, desc, extra, blue, red]) => scn('train-' + lesson, name, desc, { rounds: 1, weather: 'clear', extra: { mode: 'training', lesson, rules: { win: 'elim', respawn: 1, respawnT: 3 }, briefing: desc, ...extra } }, blue, red || side('Red', 0, -24000, []))),
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
    rounds: Math.round(clamp(r.rounds, 1, 9, 3)), timeLimit: Math.round(clamp(r.timeLimit, 0, 60, 0)), sides: [],
    mode: pick(r.mode, MODES, 'battle'), briefing: typeof r.briefing === 'string' ? r.briefing.replace(/[<>]/g, '').slice(0, 1500) : '',
  };
  const P = (x, d = 0) => clamp(x, -ARENA_RADIUS, ARENA_RADIUS, d);
  const side01 = (x) => (x === 1 ? 1 : 0);
  const pts = (a, n, alt) => (Array.isArray(a) ? a : []).slice(0, n).filter((q) => Array.isArray(q)).map((q) => (alt ? [P(q[0]), P(q[1]), clamp(q[2], 100, 12000, 2000)] : [P(q[0]), P(q[1])]));
  out.units = (Array.isArray(r.units) ? r.units : []).slice(0, MAX_UNITS).filter((u) => u && UNITS[u.key]).map((u) => ({
    key: u.key, side: side01(u.side), x: P(u.x), z: P(u.z), hdg: clamp(u.hdg, -360, 720, 0),
    name: str(u.name, 24, ''), emcon: u.emcon === 'ambush' ? 'ambush' : 'on', ...(u.route ? { route: pts(u.route, 12) } : {}),
  }));
  const slotOf = (q) => ({
    pilot: q && q.pilot === 'human' ? 'human' : 'ai',
    jet: q && validJetSpec(q.jet) ? q.jet : 'random',
    skill: pick(q && q.skill, SKILL_LABELS, 'pilot'),
    loadout: typeof (q && q.loadout) === 'string' ? q.loadout.slice(0, 16) : '',
    ...(q && q.ai && typeof q.ai === 'object' ? { ai: aiConfig({ skill: pick(q.skill, SKILL_LABELS, 'pilot'), ai: q.ai }) } : {}),
    ...(q && Array.isArray(q.route) && q.route.length ? { route: pts(q.route, 12, true) } : {}),
    ...(q && typeof q.name === 'string' && q.name.trim() ? { name: str(q.name.trim(), 16, '') } : {}),
  });
  out.waves = (Array.isArray(r.waves) ? r.waves : []).slice(0, MAX_WAVES).map((w, i) => ({
    id: Math.round(clamp(w && w.id, 0, 999, i + 1)), name: str(w && w.name, 24, `Wave ${i + 1}`), side: side01(w && w.side),
    x: P(w && w.x), z: P(w && w.z, -20000), alt: clamp(w && w.alt, 300, 12000, 4000), spd: clamp(w && w.spd, 120, 400, 240),
    hdg: w && w.hdg != null ? clamp(w.hdg, -360, 720, 0) : null, form: pick(w && w.form, FORMATIONS, 'line'), spacing: clamp(w && w.spacing, 300, 5000, 1200),
    when: w && w.when === 'trigger' ? 'trigger' : 'time', t: clamp(w && w.t, 0, 3600, 60),
    slots: (Array.isArray(w && w.slots) ? w.slots : []).slice(0, MAX_PER_SIDE).map((q) => ({ ...slotOf(q), pilot: 'ai' })),
  })).filter((w) => w.slots.length);
  out.markers = (Array.isArray(r.markers) ? r.markers : []).slice(0, MAX_MARK).map((m) => ({ x: P(m && m.x), z: P(m && m.z), label: str(m && m.label, 24, ''), icon: pick(m && m.icon, MARKER_ICONS, 'wp') }));
  const zone = (o) => ({ x: P(o && o.x), z: P(o && o.z), r: clamp(o && o.r, 300, 15000, 2500) });
  const refs = (a, max) => (Array.isArray(a) ? a : []).map((x) => Math.round(+x)).filter((x) => x >= 0 && x < max).slice(0, MAX_UNITS);
  out.objectives = (Array.isArray(r.objectives) ? r.objectives : []).slice(0, MAX_OBJ).map((o, i) => ({
    id: Math.round(clamp(o && o.id, 0, 999, i + 1)), side: side01(o && o.side), kind: pick(o && o.kind, OBJ_KINDS, 'destroy'),
    label: str(o && o.label, 60, ''), units: refs(o && o.units, out.units.length), n: Math.round(clamp(o && o.n, 1, 99, 4)),
    t: clamp(o && o.t, 10, 3600, 300), ...zone(o), optional: !!(o && o.optional), pts: Math.round(clamp(o && o.pts, 0, 99, 3)),
  }));
  out.triggers = (Array.isArray(r.triggers) ? r.triggers : []).slice(0, MAX_TRIG).map((t, i) => ({
    id: i + 1, when: pick(t && t.when, TRIG_WHEN, 'time'), t: clamp(t && t.t, 0, 3600, 60), side: side01(t && t.side), ...zone(t),
    unit: Math.round(clamp(t && t.unit, 0, MAX_UNITS - 1, 0)), wave: Math.round(clamp(t && t.wave, 0, 999, 1)), obj: Math.round(clamp(t && t.obj, 0, 999, 1)), n: Math.round(clamp(t && t.n, 1, 99, 3)),
    do: pick(t && t.do, TRIG_DO, 'message'), text: str(t && t.text, 120, ''), target: Math.round(clamp(t && t.target, 0, 999, 1)), winSide: side01(t && t.winSide),
  }));
  const ru = r.rules && typeof r.rules === 'object' ? r.rules : {}, rp = ru.pts || {};
  out.rules = {
    win: pick(ru.win, WIN_RULES, 'elim'), scoreLimit: Math.round(clamp(ru.scoreLimit, 1, 999, 20)), respawn: ru.respawn ? 1 : 0, respawnT: clamp(ru.respawnT, 2, 60, 8),
    pts: { air: Math.round(clamp(rp.air, -9, 99, 1)), ground: Math.round(clamp(rp.ground, -9, 99, 1)), death: Math.round(clamp(rp.death, -9, 99, 0)), obj: Math.round(clamp(rp.obj, 0, 99, 3)) },
  };
  out.gates = (Array.isArray(r.gates) ? r.gates : []).slice(0, MAX_GATES).filter((g) => Array.isArray(g)).map((g) => [P(g[0]), clamp(g[1], 30, 12000, 500), P(g[2]), clamp(g[3], 40, 600, 120)]);
  out.laps = Math.round(clamp(r.laps, 1, 9, 1));
  out.ceiling = clamp(r.ceiling, 0, 3000, 0);      // time trials: metres above the gates you may fly (0 = no limit)
  const sv = r.survival && typeof r.survival === 'object' ? r.survival : {};
  out.survival = { start: Math.round(clamp(sv.start, 1, 8, 2)), grow: clamp(sv.grow, 0, 3, 1), max: Math.round(clamp(sv.max, 0, 99, 0)), country: typeof sv.country === 'string' && COUNTRIES[sv.country] ? sv.country : 'random', defend: sv.defend == null ? -1 : Math.round(clamp(sv.defend, -1, MAX_UNITS - 1, -1)), strike: clamp(sv.strike, 0, 1, 0.35), gap: clamp(sv.gap, 5, 120, 20) };
  if (typeof r.lesson === 'string') out.lesson = r.lesson.slice(0, 16);
  for (let k = 0; k < 2; k++) {
    const s = (Array.isArray(r.sides) && r.sides[k]) || {};
    const slots = (Array.isArray(s.slots) ? s.slots : []).slice(0, MAX_PER_SIDE).map(slotOf);
    // the enemy side may start empty in missions (waves, ground units, time trials)
    const canBeEmpty = k === 1 && (out.mode !== 'battle' || out.waves.some((w) => w.side === 1) || out.units.some((u) => u.side === 1));
    if (!slots.length && !canBeEmpty) slots.push(slot(k === 0 ? 'human' : 'ai', k === 0 ? 'choice' : 'random'));
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
  const extra = [];
  if (s.units && s.units.length) extra.push(`${s.units.length} ground unit${s.units.length === 1 ? '' : 's'}`);
  if (s.waves && s.waves.length) extra.push(`${s.waves.length} wave${s.waves.length === 1 ? '' : 's'}`);
  if (s.objectives && s.objectives.length) extra.push(`${s.objectives.length} objective${s.objectives.length === 1 ? '' : 's'}`);
  const head = s.mode === 'race' ? `Time trial · ${s.gates.length} gates${s.laps > 1 ? ` · ${s.laps} laps` : ''}` : s.mode === 'survival' ? 'Survival' : s.mode === 'training' ? 'Training' : `${n[0]}v${n[1]}`;
  const rule = s.mode === 'battle' ? (s.rules && s.rules.win === 'score' ? `first to ${s.rules.scoreLimit} points` : s.rules && s.rules.win === 'objectives' ? 'objectives' : `first to ${s.rounds}`) : '';
  return [head, MAPS[s.map].name, TIMES[s.time].name, WEATHER[s.weather].name, s.mode === 'battle' ? `${(d / 1000).toFixed(0)} km apart` : '', `${seats.human} human seat${seats.human === 1 ? '' : 's'}`, ...extra, rule].filter(Boolean).join(' · ');
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
