// Campaign: "Fault Lines", eight missions of a near-future war seen from one NATO squadron.
// Progress, named wingmen (who can be lost for good), jet unlocks, story choices and mission
// grades are saved in this browser. Each mission is built as an ordinary scenario, so it runs
// on the same mission engine as everything else.
import { JETS } from './aircraft.js';
import { slot, aiDefault } from './scenario.js';

const KEY = 'contrail-campaign';
export const CAMPAIGN_JETS = ['f16c', 'fa18e', 'f15c', 'f22a'];

// The squadron. The first three are the original wingmen; replacements arrive as pilots are lost.
export const PILOTS = {
  cutter: { name: 'Cutter', skill: 'ace', per: 'wingman', bio: 'The oldest captain in the wing. Careful, quiet, never loses a wingman.' },
  ruby: { name: 'Ruby', skill: 'pilot', per: 'aggressive', bio: 'Youngest pilot in the squadron. First in the ready room, first to the merge.' },
  moss: { name: 'Moss', skill: 'pilot', per: 'balanced', bio: 'Former weapons-school instructor. Steady, methodical, dry sense of humour.' },
  hollis: { name: 'Hollis', skill: 'rookie', per: 'wingman', bio: 'Replacement pilot, straight out of training.', spare: true },
  banks: { name: 'Banks', skill: 'rookie', per: 'balanced', bio: 'Replacement pilot from a tanker squadron, re-trained in a hurry.', spare: true },
  ortiz: { name: 'Ortiz', skill: 'pilot', per: 'aggressive', bio: 'Replacement pilot, transferred in from an aggressor squadron.', spare: true },
};
const ORDER = ['cutter', 'ruby', 'moss', 'hollis', 'banks', 'ortiz'];

// ---------------- scenario helpers ----------------
const side = (name, x, z, slots, o = {}) => ({ name, x, z, alt: o.alt ?? 4000, spd: o.spd ?? 240, hdg: o.hdg ?? null, form: o.form || 'line', spacing: o.spacing ?? 1400, slots });
const A = (jet, skill = 'pilot', loadout = '', per = 'balanced', o = {}) => slot('ai', jet, skill, loadout, { ...aiDefault(skill, per), ...o });
const msg = (when, text, o = {}) => ({ when, do: 'message', text, ...o });
// role: 'air' (flies your jet, covers you), 'strike' (A/G loadout, attacks the targets), 'sead'
const ROLE_TEXT = { air: 'flies cover with air-to-air missiles', bombs: 'carries bombs', strike: 'carries bombs', sead: 'carries anti-radiation missiles', cas: 'carries rockets and Mavericks' };
const listOf = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
// "Cutter carries bombs; Ruby flies cover with air-to-air missiles."
export function flightText(wing, roles) {
  const s = wing.map((w, i) => `${w.name} ${ROLE_TEXT[roles[i]] || 'flies with you'}`).join('; ');
  return s ? s[0].toUpperCase() + s.slice(1) + '.' : 'You fly alone.';
}
export const fillText = (t, cs, wing, roles) => t.replace(/\{cs\}/g, cs).replace(/\{names\}/g, listOf(wing.map((w) => w.name))).replace(/\{flight\}/g, flightText(wing, roles));
function wingSlots(ctx) {
  const roles = ctx.roles;
  return roles.map((role, i) => {
    const w = ctx.wing[i];
    if (!w) return null;
    let jet = ctx.jet, lo = role === 'air' ? 'air' : role;
    if (role !== 'air' && !Object.values(JETS[jet].loadouts).some((L) => L.ag)) jet = ctx.unlocked.includes('fa18e') ? 'fa18e' : 'f16c';
    const q = A(jet, w.skill, lo, w.per, { ord: role === 'air' ? (roles.indexOf('air') === i ? 'escort' : 'engage') : 'strike' });
    q.name = w.name;
    return q;
  }).filter(Boolean);
}
const human = (ctx) => ({ ...slot('human', ctx.jet, 'pilot', ctx.loadout), name: ctx.name });
let CTX = null;
const scn = (id, name, o, blue, red) => ({ v: 1, id: 'cmp-' + id, name, desc: '', rounds: 1, map: o.map, time: o.time || 'day', weather: o.weather || 'scattered', timeLimit: o.timeLimit ?? 20, mode: 'battle', sides: [blue, red], rules: { win: 'objectives', ...(o.rules || {}) }, briefing: CTX ? fillText(o.briefing, CTX.name, CTX.wing, CTX.roles) : o.briefing, units: o.units || [], objectives: o.objectives || [], waves: o.waves || [], triggers: o.triggers || [], markers: o.markers || [] });

// ---------------- the missions ----------------
// story: shown on the campaign screen before the briefing; debrief: after a pass.
// role: the loadout the mission is built around; roles: what each wingman carries; prefer: who flies.
export const MISSIONS = [
  {
    id: 'tripwire', act: 'Act 1 · The North', title: 'Tripwire', role: 'air', roles: ['air'], prefer: ['cutter'], par: 8,
    story: 'Northern Norway. Three weeks into your posting with Lance Squadron, the most exciting thing you have done is escort a lost Cessna back to Tromsø.\n\nThat changed at 04:10. A Russian battle group sailed from the Kola Peninsula with its transponders off, and its fighters have been edging closer to Norwegian airspace all night. Lance is the NATO composite squadron on quick-reaction alert up here: a handful of American pilots flying whatever airframes the alliance can spare.\n\nYou and Cutter have the alert jets. Cutter has flown more intercepts than anyone in the wing and has never lost a wingman. The horn goes: a Norwegian P-8 patrol plane is being shadowed by two MiG-29s, and the MiGs have just locked it up.',
    debrief: 'The P-8 made it home with a hole in its tail. Moscow calls it a NATO provocation; Brussels calls it an attack. By evening, Norwegian radars count over forty Russian aircraft along the border.\n\nLt Col Hayes pins your gun-camera footage to the briefing-room wall and says only: "Get some sleep. It starts properly tomorrow."',
    build: (ctx) => scn('tripwire', 'Tripwire', {
      map: 'arctic', time: 'day', weather: 'scattered', timeLimit: 15, rules: { win: 'elim' },
      briefing: 'Two MiG-29s have locked a Norwegian P-8 patrol aircraft north of the fjords. Rules of engagement: you are weapons free on any Russian fighter showing hostile intent, and these two have.\n\nExpect company. The Kola airfields have Su-35s on alert, and Sentinel (the AWACS) will call them when they launch.\n\nYou fly the F-16C with AMRAAMs and Sidewinders, with {names} on your wing: M opens the radio to give orders. Shoot down every Russian fighter, and don\'t get shot down yourself: in the campaign, losing your jet ends the mission.',
      waves: [{ id: 1, name: 'Flanker pair', side: 1, x: 10000, z: -27000, alt: 7000, when: 'time', t: 150, slots: [A('su35s', 'pilot', 'air', 'aggressive'), A('su35s', 'rookie', 'air', 'wingman')] }],
      triggers: [
        msg('start', 'SENTINEL: Lance, two MiG-29s just locked the P-8. You are weapons free.'),
        msg('time', 'SENTINEL: Two more fast movers launching from the north. Flankers.', { t: 140 }),
      ],
      markers: [{ x: 0, z: 26000, label: 'HOME', icon: 'home' }],
    }, side('Lance', 0, 24000, [human(ctx), ...wingSlots(ctx)], { alt: 5000, spd: 250 }),
       side('Russia', 0, -12000, [A('mig29s', 'rookie', 'air', 'aggressive'), A('mig29s', 'rookie', 'air', 'wingman')], { alt: 6000, spd: 230 })),
  },
  {
    id: 'kjosen', act: 'Act 1 · The North', title: 'Cold Landing', role: 'cas', roles: ['bombs', 'air'], prefer: ['cutter', 'ruby'], par: 12, unlock: 'fa18e',
    story: 'Nobody slept. At 02:00, Russian paratroopers dropped onto the airstrip at the head of Kjosen fjord, the only runway between the border and the coast road. Whoever holds it holds the north.\n\nThey brought short-range air defences with them, and Norwegian intelligence says an SA-10 long-range SAM battery is being trucked in to cover the strip. Once its radar is up, the whole fjord becomes a no-fly zone.\n\nRuby joins the squadron\'s combat roster today. The youngest pilot in Lance asked Hayes twice for a combat slot, and finally got one. {flight} You lead the attack.',
    debrief: 'The paratroopers surrendered to a Norwegian ranger company by noon. The runway at Kjosen is cratered but back in NATO hands.\n\nThe war, though, is spreading. A US carrier group is being rushed east, and Lance is cross-trained onto its Super Hornets for carrier operations.\n\nNEW AIRCRAFT: F/A-18E Super Hornet.',
    build: (ctx) => scn('kjosen', 'Cold Landing', {
      map: 'arctic', time: 'dawn', weather: 'overcast', timeLimit: 20,
      briefing: 'Russian paratroopers hold the airstrip at the head of the fjord: armoured vehicles, a command post and a fuel dump, covered by an SA-15, a Shilka and Igla teams.\n\nAn SA-10 battery is setting up on the ridge west of the strip. Intelligence expects its radar to come up about five minutes into the mission; after that, stay low behind the mountains. Killing the SA-10 is optional, but it makes everyone\'s life easier.\n\nYou carry Mavericks and rockets (3 selects air-to-ground). {flight} Two MiG-29s are expected to come looking for you.',
      units: [
        { key: 'apc', side: 1, x: -3000, z: -18000, name: 'Para vehicles' }, { key: 'apc', side: 1, x: -2200, z: -17400, name: 'Para vehicles' },
        { key: 'hq', side: 1, x: -2600, z: -18600, name: 'Para command post' }, { key: 'depot', side: 1, x: -1600, z: -18200, name: 'Fuel dump' },
        { key: 'tor', side: 1, x: -400, z: -18600 }, { key: 'shilka', side: 1, x: -3800, z: -17800 }, { key: 'igla', side: 1, x: -1200, z: -19200 },
        { key: 's300', side: 1, x: -6000, z: -19000, emcon: 'ambush' },
      ],
      objectives: [
        { side: 0, kind: 'destroy', units: [0, 1, 2], label: 'Destroy the paratroopers\' vehicles and command post' },
        { side: 0, kind: 'destroy', units: [3], label: 'Burn the fuel dump', optional: true },
        { side: 0, kind: 'destroy', units: [7], label: 'Kill the SA-10 battery', optional: true },
      ],
      waves: [{ id: 1, name: 'Fulcrum pair', side: 1, x: 8000, z: -28000, alt: 5000, when: 'time', t: 220, slots: [A('mig29s', 'pilot', 'air', 'aggressive'), A('mig29s', 'rookie', 'air', 'wingman')] }],
      triggers: [
        msg('start', 'SENTINEL: Lance, the airstrip is at the head of the fjord. SA-10 still dark. Go.'),
        { when: 'time', t: 300, do: 'radar' },
        msg('time', 'SENTINEL: SA-10 search radar is UP on the west ridge. Get low!', { t: 300 }),
        msg('time', 'SENTINEL: Two MiG-29s inbound from the north.', { t: 215 }),
      ],
      markers: [{ x: -2400, z: -18000, label: 'AIRSTRIP', icon: 'target' }, { x: -6000, z: -19000, label: 'SA-10 (setting up)', icon: 'danger' }, { x: 0, z: 22000, label: 'HOME', icon: 'home' }],
    }, side('Lance', 0, 20000, [human(ctx), ...wingSlots(ctx)], { alt: 3000, spd: 230 }), side('Russia', 0, -26000, [])),
  },
  {
    id: 'longreach', act: 'Act 2 · The Southern Flank', title: 'Long Reach', role: 'sead', roles: ['sead', 'bombs'], prefer: ['moss', 'cutter'], par: 14,
    story: 'Two weeks later, the war is not where anyone expected it.\n\nThe north has gone quiet, both sides dug in. But a Russian expeditionary air wing, flown into a desert base on the far side of the eastern Mediterranean, has started launching cruise-missile strikes on the allied airbase down the coast. Hayes calls it "the other door". Lance is sent south to close it.\n\nMoss flies with you this time: a former weapons-school instructor who has spent ten years teaching pilots how to kill SAM sites, and is finally going to do it for real.',
    debrief: 'The base\'s SAM umbrella is gone and its fuel is burning. The cruise-missile strikes stop, for now.\n\nBut the reply comes fast. Within hours, Russian fighters start massing at the next airfield over, and Sentinel counts more than a dozen.',
    build: (ctx) => scn('longreach', 'Long Reach', {
      map: 'desert', time: 'day', weather: 'clear', timeLimit: 22,
      briefing: 'The Russian base sits on the flat desert floor west of the mesas. It is covered by an SA-11 and an SA-15, with a Pantsir and a Shilka close in and an early-warning radar to the north feeding them targets.\n\nYou carry HARMs: fire them at radars that are transmitting (amber on the RWR and HUD). {flight} Tell your wingmen to attack with M.\n\nThe mesas to the east give you cover: fly low through them to get close before the radars see you. MiG-29s are on alert and will scramble when you get close.',
      units: [
        { key: 'buk', side: 1, x: -13000, z: -15000 }, { key: 'tor', side: 1, x: -11200, z: -13400 },
        { key: 'pantsir', side: 1, x: -12400, z: -12600 }, { key: 'shilka', side: 1, x: -11800, z: -14600 },
        { key: 'ewr', side: 1, x: -16000, z: -21000 },
        { key: 'depot', side: 1, x: -12000, z: -14000, name: 'Fuel depot' }, { key: 'hq', side: 1, x: -12800, z: -13600, name: 'Base headquarters' },
      ],
      objectives: [
        { side: 0, kind: 'destroy', units: [0, 1], label: 'Kill the SA-11 and SA-15' },
        { side: 0, kind: 'destroy', units: [5, 6], label: 'Destroy the fuel depot and headquarters' },
        { side: 0, kind: 'destroy', units: [4], label: 'Destroy the early-warning radar', optional: true },
      ],
      waves: [{ id: 1, name: 'Fulcrum alert', side: 1, x: -20000, z: -27000, alt: 4000, when: 'trigger', slots: [A('mig29s', 'pilot', 'air', 'aggressive'), A('mig29s', 'pilot', 'air', 'wingman')] }],
      triggers: [
        { when: 'enter', side: 0, x: -12000, z: -14000, r: 16000, do: 'spawn', target: 1 },
        msg('enter', 'SENTINEL: Two MiG-29s scrambling from the base. Heads up, Lance.', { side: 0, x: -12000, z: -14000, r: 16000 }),
        msg('unitDead', 'MOSS: Early-warning radar is down. They\'re blind out to the north.', { unit: 4 }),
      ],
      markers: [{ x: -12200, z: -13800, label: 'BASE', icon: 'target' }, { x: -13000, z: -15000, label: 'SA-11', icon: 'danger' }, { x: 2000, z: 22000, label: 'HOME', icon: 'home' }],
    }, side('Lance', 2000, 22000, [human(ctx), ...wingSlots(ctx)], { alt: 4000, spd: 240 }), side('Russia', 0, -28000, [])),
  },
  {
    id: 'sandstorm', act: 'Act 2 · The Southern Flank', title: 'Sandstorm', role: 'air', roles: ['air', 'air', 'air'], prefer: ['cutter', 'ruby', 'moss'], par: 12, unlock: 'f15c',
    story: 'At dusk the Russian wing comes for the allied airbase in force: Su-35s carrying guided bombs, escorted by more Su-35s, with MiG-29s behind them.\n\nThe base has a single Patriot battery and four hours of fuel left in its tanks. Everything Lance has is in the air: you, {names}. Four jets against everything they can send.\n\nHayes keeps the briefing short. "Nothing gets through."',
    debrief: 'The airbase is still standing. The Russian wing lost more aircraft in twenty minutes than in the rest of the war so far, and its commander has been recalled to Moscow.\n\nLance gets F-15Cs from a squadron rotating home: pure air-superiority fighters with the biggest radar in the inventory.\n\nNEW AIRCRAFT: F-15C Eagle.\n\nThen, at 03:00, the news everyone has been dreading arrives from the other side of the world.',
    build: (ctx) => scn('sandstorm', 'Sandstorm', {
      map: 'desert', time: 'dusk', weather: 'broken', timeLimit: 18,
      briefing: 'Four Su-35s are inbound from the north-west: two carrying guided bombs for the airbase, two escorting them. A second pair of strikers follows three minutes behind.\n\nThe airbase has a Patriot battery, but it cannot stop them alone. Kill the strikers first (the ones heading for the base), then the escorts. If the headquarters or fuel farm is destroyed, the mission fails.\n\nYou have the whole squadron: {names}. Use M to tell them who to attack.',
      units: [
        { key: 'patriot', side: 0, x: 1500, z: 13000 }, { key: 'hq', side: 0, x: 0, z: 14000, name: 'Airbase HQ' }, { key: 'depot', side: 0, x: -1200, z: 14600, name: 'Fuel farm' },
      ],
      objectives: [
        { side: 0, kind: 'defend', units: [1, 2], label: 'Protect the airbase HQ and fuel farm' },
        { side: 0, kind: 'eliminate', label: 'Shoot down every attacking aircraft' },
      ],
      waves: [{ id: 1, name: 'Second strike', side: 1, x: -18000, z: -26000, alt: 3000, when: 'time', t: 180, slots: [A('su35s', 'pilot', 'strike', 'balanced', { ord: 'strike' }), A('su35s', 'pilot', 'strike', 'wingman', { ord: 'strike' })] }],
      triggers: [
        msg('start', 'SENTINEL: Four Flankers inbound, two of them heavy with bombs. Nothing gets through.'),
        msg('time', 'SENTINEL: Second strike package, two more bombers, bearing north-west.', { t: 175 }),
      ],
      markers: [{ x: 0, z: 14000, label: 'AIRBASE', icon: 'home' }],
    }, side('Lance', 0, 8000, [human(ctx), ...wingSlots(ctx)], { alt: 5000, spd: 240, hdg: -30, form: 'wall' }),
       side('Russia', -12000, -22000, [A('su35s', 'pilot', 'air', 'aggressive'), A('su35s', 'pilot', 'air', 'sniper'), A('su35s', 'pilot', 'strike', 'balanced', { ord: 'strike' }), A('su35s', 'rookie', 'strike', 'wingman', { ord: 'strike' })], { alt: 5000, spd: 240, form: 'wall' })),
    choice: {
      prompt: 'Chinese forces have landed on the Kestrel Islands, a NATO partner\'s territory in the western Pacific, betting that the alliance is too busy with Russia to answer. A US carrier group, CVN Resolute, is racing west to contest the islands. Lance is flown out to join it. Hayes gets two requests for the squadron and can only grant one.',
      options: [
        { id: 'carrier', label: 'Cover the carrier', desc: 'Fly combat air patrol over the Resolute on its run in. J-16 anti-ship regiments are waiting for it. If the carrier comes through intact, it will be there to rearm you over the islands.' },
        { id: 'airfield', label: 'Hit the airfield first', desc: 'Raid the J-16 base on the islands at night, before the bombers take off. If it works, there will be far fewer Chinese fighters over the islands later, but the carrier will have to stay back out of range.' },
      ],
    },
  },
  {
    id: 'picket', act: 'Act 3 · The Pacific', title: 'Picket Line', role: 'air', roles: ['air', 'air'], prefer: ['cutter', 'ruby'], par: 14, when: (c) => c.sandstorm !== 'airfield',
    story: 'The Resolute is three hundred miles from the islands, and the Chinese know exactly where it is.\n\nThree raids are expected over the next few hours: J-16s carrying YJ-83 anti-ship missiles, with J-10s and long-range J-16 escorts. Every missile that gets off the rails is one the carrier\'s defences have to stop.\n\nYou are flying from the deck for the first time. Cutter said only: "Trap with the gear down. It\'s considered good form."',
    debrief: 'The Resolute came through with a scorched flight deck and every aircraft on it intact. The carrier group is in position off the Kestrel Islands.\n\nThe next job is to open a hole in the Chinese air defences, and the carrier will be there to rearm you while you do it.',
    build: (ctx) => scn('picket', 'Picket Line', {
      map: 'islands', time: 'day', weather: 'scattered', timeLimit: 20,
      briefing: 'Three raids of J-16 anti-ship bombers are coming for CVN Resolute, about three minutes apart, each with an escort. Kill the bombers before they launch: once their missiles are in the air, the carrier and its destroyer have to shoot them down themselves.\n\nYou can land on the carrier between raids to rearm and repair: gear (J), flaps (K), about 140 kt, and fly onto the back of the deck.\n\nIf the carrier is sunk, the mission fails.',
      units: [{ key: 'cvn', side: 0, x: -16000, z: 2000, hdg: 0, name: 'CVN Resolute' }, { key: 'ddg', side: 0, x: -13800, z: 3200, hdg: 0, name: 'DDG Vigilant' }],
      objectives: [
        { side: 0, kind: 'defend', units: [0], label: 'Protect CVN Resolute' },
        { side: 0, kind: 'eliminate', label: 'Shoot down all three raids' },
        { side: 0, kind: 'defend', units: [1], label: 'Protect DDG Vigilant', optional: true },
      ],
      waves: [
        { id: 1, name: 'Raid 1', side: 1, x: 6000, z: -24000, alt: 3000, when: 'time', t: 15, slots: [A('j16', 'rookie', 'antiship', 'balanced', { ord: 'strike' }), A('j16', 'rookie', 'antiship', 'wingman', { ord: 'strike' }), A('j10c', 'pilot', 'air', 'aggressive')] },
        { id: 2, name: 'Raid 2', side: 1, x: 22000, z: -14000, alt: 2500, when: 'time', t: 200, slots: [A('j16', 'pilot', 'antiship', 'balanced', { ord: 'strike' }), A('j16', 'pilot', 'antiship', 'wingman', { ord: 'strike' }), A('j16', 'pilot', 'air', 'sniper')] },
        { id: 3, name: 'Raid 3', side: 1, x: -2000, z: -27000, alt: 6000, when: 'time', t: 390, slots: [A('j16', 'pilot', 'antiship', 'balanced', { ord: 'strike' }), A('j16', 'pilot', 'antiship', 'wingman', { ord: 'strike' }), A('j10c', 'pilot', 'air', 'aggressive'), A('j10c', 'rookie', 'air', 'wingman')] },
      ],
      triggers: [
        msg('time', 'SENTINEL: Raid 2 coming in low from the north-east!', { t: 195 }),
        msg('time', 'SENTINEL: Raid 3, four aircraft, high and fast from the north.', { t: 385 }),
      ],
      markers: [{ x: -16000, z: 2000, label: 'RESOLUTE', icon: 'home' }],
    }, side('Lance', -14000, -4000, [human(ctx), ...wingSlots(ctx)], { alt: 4000, spd: 240, hdg: 0 }), side('China', 0, -26000, [])),
  },
  {
    id: 'firststrike', act: 'Act 3 · The Pacific', title: 'First Strike', role: 'strike', roles: ['air', 'strike'], prefer: ['ruby', 'cutter'], par: 14, when: (c) => c.sandstorm === 'airfield',
    story: 'The J-16 regiment that threatens the Resolute is parked on a captured airfield at the north end of the main Kestrel island, under a brand-new HQ-16 battery.\n\nHayes chose the gamble: hit the base at night, before the bombers can launch, while the carrier hangs back out of range. If it works, the anti-ship threat is gone. If it doesn\'t, there is nothing between the J-16s and the Resolute.\n\nThe moon is up. Visual range is short. Trust your sensors.',
    debrief: 'The airfield\'s fuel farm burned until dawn, and the J-16 regiment is grounded for days. The Resolute moves in without a shot fired at it.\n\nWith the bombers out of the fight, the next job is the air-defence umbrella over the islands themselves. The carrier is still too far back to rearm you over the target.',
    build: (ctx) => scn('firststrike', 'First Strike', {
      map: 'islands', time: 'night', weather: 'clear', timeLimit: 22,
      briefing: 'The captured airfield is at the north end of the big island: the fuel farm, the operations centre and two hardened aircraft shelters. It is defended by an HQ-16 battery, an HQ-7, a PGZ-95 gun system and QW-2 teams, with an early-warning radar on the east coast.\n\nDestroy the fuel farm and the operations centre. The shelters are optional but worth the bombs. Two J-10s are on night alert and will scramble when you cross the coast; more J-16s will follow.\n\nThe HQ-16 cannot see you below the ridgelines: come in low.',
      units: [
        { key: 'hq16', side: 1, x: 2000, z: -12000 }, { key: 'hq7', side: 1, x: 300, z: -17200 }, { key: 'pgz95', side: 1, x: -600, z: -18400 },
        { key: 'qw2', side: 1, x: -600, z: -17600 }, { key: 'ewr', side: 1, x: 6000, z: -10000 },
        { key: 'depot', side: 1, x: 0, z: -18000, name: 'Fuel farm' }, { key: 'hq', side: 1, x: 900, z: -18600, name: 'Operations centre' },
        { key: 'bunker', side: 1, x: -900, z: -18900, name: 'Aircraft shelter' }, { key: 'bunker', side: 1, x: 1400, z: -17600, name: 'Aircraft shelter' },
      ],
      objectives: [
        { side: 0, kind: 'destroy', units: [5, 6], label: 'Destroy the fuel farm and operations centre' },
        { side: 0, kind: 'destroy', units: [7, 8], label: 'Destroy the aircraft shelters', optional: true },
        { side: 0, kind: 'destroy', units: [0], label: 'Kill the HQ-16 battery', optional: true },
      ],
      waves: [
        { id: 1, name: 'Night alert', side: 1, x: 9000, z: -27000, alt: 4000, when: 'trigger', slots: [A('j10c', 'pilot', 'air', 'aggressive'), A('j10c', 'pilot', 'air', 'wingman')] },
        { id: 2, name: 'J-16 flight', side: 1, x: -12000, z: -28000, alt: 6000, when: 'time', t: 330, slots: [A('j16', 'pilot', 'air', 'sniper'), A('j16', 'rookie', 'air', 'wingman')] },
      ],
      triggers: [
        { when: 'enter', side: 0, x: 0, z: -12000, r: 9000, do: 'spawn', target: 1 },
        msg('enter', 'SENTINEL: Two J-10s scrambling from the airfield!', { side: 0, x: 0, z: -12000, r: 9000 }),
        msg('time', 'SENTINEL: Two J-16s lifting off from the south island.', { t: 325 }),
      ],
      markers: [{ x: 300, z: -18200, label: 'AIRFIELD', icon: 'target' }, { x: 2000, z: -12000, label: 'HQ-16', icon: 'danger' }, { x: 0, z: 24000, label: 'HOME', icon: 'home' }],
    }, side('Lance', 0, 24000, [human(ctx), ...wingSlots(ctx)], { alt: 3000, spd: 240 }), side('China', 0, -28000, [])),
  },
  {
    id: 'shieldwall', act: 'Act 3 · The Pacific', title: 'Shield Wall', role: 'sead', roles: ['air', 'sead', 'strike'], prefer: ['cutter', 'moss', 'ruby'], par: 15, unlock: 'f22a',
    story: 'The Kestrel Islands sit under an HQ-9 umbrella: a long-range SAM battery on the central ridge, fed by an early-warning radar, that can reach out over a hundred kilometres. Nothing NATO flies can get near the islands while it stands.\n\nWorse, Sentinel has picked up faint, intermittent contacts near the battery: J-20 stealth fighters, hunting anything that comes close.\n\nThe whole squadron goes in. Hayes shakes every hand on the way to the jets, which Hayes has never done before.',
    debrief: 'The HQ-9 is gone and the umbrella over the Kestrel Islands has a hole in it big enough for the whole Pacific Fleet. Chinese forces on the islands are cut off; within two days, they begin negotiating a withdrawal.\n\nFor its part in the Pacific, Lance is given the most capable fighter in the alliance.\n\nNEW AIRCRAFT: F-22A Raptor.\n\nAnd it will need it. Russia, watching its partner fail, has moved again: this time through the mountains on NATO\'s eastern flank.',
    build: (ctx) => {
      const carrier = ctx.choices.sandstorm !== 'airfield';
      const units = [
        { key: 'hq9', side: 1, x: 2000, z: -12000 }, { key: 'ewr', side: 1, x: 6000, z: -10000 },
        { key: 'hq16', side: 1, x: -1000, z: -16000 }, { key: 'hq7', side: 1, x: 2600, z: -11200 }, { key: 'pgz95', side: 1, x: 1200, z: -12600 },
      ];
      if (carrier) units.push({ key: 'cvn', side: 0, x: -16000, z: 2000, hdg: 0, name: 'CVN Resolute' });
      const waves = [{ id: 1, name: 'Hunters', side: 1, x: 14000, z: -24000, alt: 7000, when: 'time', t: 220, slots: [A('j16', 'pilot', 'air', 'sniper'), A('j16', 'pilot', 'air', 'wingman')] }];
      if (carrier) waves.push({ id: 2, name: 'Late raid', side: 1, x: -8000, z: -28000, alt: 5000, when: 'time', t: 380, slots: [A('j16', 'pilot', 'air', 'aggressive'), A('j10c', 'pilot', 'air', 'wingman')] });
      return scn('shieldwall', 'Shield Wall', {
        map: 'islands', time: 'dusk', weather: 'scattered', timeLimit: 24,
        briefing: `The HQ-9 battery sits on the central ridge of the big island, fed by an early-warning radar on the east coast and backed by an HQ-16, an HQ-7 and PGZ-95 guns. Destroy the HQ-9 and the early-warning radar.\n\nTwo J-20 stealth fighters are patrolling over the battery. They are very hard to see on radar until they are close: watch the RWR and your IRST. ${carrier ? 'J-16 hunters will join later.' : 'Thanks to the airfield raid, only one flight of J-16s is left to send against you.'}\n\n${carrier ? 'CVN Resolute is south-west of the islands: land on it to rearm and repair.' : 'The carrier is too far back to help: make every weapon count.'} {flight} Tell them to attack with M.`,
        units, waves,
        objectives: [
          { side: 0, kind: 'destroy', units: [0, 1], label: 'Destroy the HQ-9 battery and early-warning radar' },
          { side: 0, kind: 'destroy', units: [2], label: 'Kill the HQ-16', optional: true },
        ],
        triggers: [
          msg('start', 'SENTINEL: Faint contacts near the HQ-9. Probably J-20s. Watch yourselves, Lance.'),
          msg('unitDead', 'MOSS: HQ-9 radar is off the air. That\'s the big one.', { unit: 0 }),
          msg('time', 'SENTINEL: J-16 pair coming up from the north-east.', { t: 215 }),
        ],
        markers: [{ x: 2000, z: -12000, label: 'HQ-9', icon: 'target' }, { x: 6000, z: -10000, label: 'EWR', icon: 'target' }, ...(carrier ? [{ x: -16000, z: 2000, label: 'RESOLUTE', icon: 'home' }] : [{ x: 0, z: 24000, label: 'HOME', icon: 'home' }])],
      }, side('Lance', carrier ? -12000 : 0, carrier ? 8000 : 24000, [human(ctx), ...wingSlots(ctx)], { alt: 3500, spd: 240 }),
         side('China', 3000, -16000, [A('j20a', 'ace', 'air', 'sniper', { ord: 'cap', commit: 30 }), A('j20a', 'pilot', 'air', 'wingman', { ord: 'cap', commit: 30 })], { alt: 8000, spd: 230, spacing: 3000 }));
    },
  },
  {
    id: 'highpass', act: 'Act 4 · The Mountains', title: 'High Pass', role: 'strike', roles: ['air', 'strike'], prefer: ['ruby', 'moss'], par: 14,
    story: 'Russian armour is pushing through a mountain pass on NATO\'s eastern flank, aiming to cut the only road south. The valleys are narrow, the peaks are high, and an SA-10 sits on the summit above the pass, seeing everything that flies above the ridgelines.\n\nAbove it all, two Su-57s fly combat air patrol.\n\nThe only way in is low: down in the valleys, below the peaks, where the SA-10 can\'t see you and the Su-57s have to look down into the ground clutter. A Swedish Gripen flight, Viking, is working the next valley over.',
    debrief: 'The armour column is burning in the pass, and the road south is still open.\n\nBut Viking 3 is down. The Gripen pilot ejected over the ridge, and a rescue helicopter is ready to go in at first light. It will need fighter cover over the mountains for hours, and Lance is the only squadron close enough.\n\nAt the same time, Hayes has orders to prepare the final strike on Kjosen, where it all began.',
    build: (ctx) => scn('highpass', 'High Pass', {
      map: 'alps', time: 'day', weather: 'broken', timeLimit: 22,
      briefing: 'An armoured column (tanks, infantry vehicles and a supply convoy) is moving through the valley south-west of the big lake. It is covered by a Pantsir, a Tor and Igla teams in the valley, and by an SA-10 on the summit to the west that will see you above about 1,000 m.\n\nTwo Su-57 stealth fighters patrol high above the pass. You start above the peaks: drop into the valleys around the big lake on the way in. Down in the terrain, the SA-10 can\'t see you and the Su-57s struggle to.\n\nDestroy the tanks and the infantry vehicles. {flight}',
      units: [
        { key: 'tank', side: 1, x: -4000, z: -15000, name: 'Tank column' }, { key: 'tank', side: 1, x: -3200, z: -14400, name: 'Tank column' },
        { key: 'apc', side: 1, x: -4600, z: -15600, name: 'Infantry vehicles' }, { key: 'convoy', side: 1, x: -2400, z: -16000, hdg: 270, route: [[-4000, -16000], [-6000, -15000], [-6000, -13000]], name: 'Supply convoy' },
        { key: 'pantsir', side: 1, x: -3000, z: -13600 }, { key: 'tor', side: 1, x: -5600, z: -16400 }, { key: 'igla', side: 1, x: -2000, z: -14600 },
        { key: 's300', side: 1, x: -14000, z: -20000 },
      ],
      objectives: [
        { side: 0, kind: 'destroy', units: [0, 1, 2], label: 'Destroy the tanks and infantry vehicles' },
        { side: 0, kind: 'destroy', units: [3], label: 'Destroy the supply convoy', optional: true },
        { side: 0, kind: 'destroy', units: [4], label: 'Kill the Pantsir', optional: true },
      ],
      waves: [{ id: 1, name: 'Flanker pair', side: 1, x: 18000, z: -26000, alt: 6000, when: 'time', t: 260, slots: [A('su35s', 'pilot', 'air', 'aggressive'), A('su35s', 'pilot', 'air', 'wingman')] }],
      triggers: [
        msg('start', 'SENTINEL: Two Su-57s orbiting high over the pass. Stay in the valleys, Lance.'),
        msg('time', 'VIKING 1: Mayday, Viking 3 is hit! ... Good chute. Viking 3 is down on the ridge.', { t: 140 }),
        msg('time', 'SENTINEL: Two Flankers coming in from the east.', { t: 255 }),
      ],
      markers: [{ x: -4000, z: -15000, label: 'COLUMN', icon: 'target' }, { x: -14000, z: -20000, label: 'SA-10', icon: 'danger' }, { x: 6000, z: 24000, label: 'HOME', icon: 'home' }],
    }, side('Lance', 4000, 18000, [human(ctx), ...wingSlots(ctx)], { alt: 3300, spd: 230 }),
       side('Russia', -4000, -6000, [A('su57', 'ace', 'air', 'sniper', { ord: 'cap', commit: 22 }), A('su57', 'pilot', 'air', 'wingman', { ord: 'cap', commit: 22 })], { alt: 9000, spd: 230, spacing: 3000 })),
    choice: {
      prompt: 'Viking 3 is alive on the ridge, and a rescue helicopter is ready. Hayes has a choice to make, and asks what you think.',
      options: [
        { id: 'rescue', label: 'Cover the rescue', desc: 'Lance spends the next morning flying cover over the mountains until Viking 3 is home. The Swedish squadron will not forget it, but the Russians get another day to dig in at Kjosen.' },
        { id: 'press', label: 'Press on to Kjosen', desc: 'Leave the rescue to others and spend the day hitting the radar network around Kjosen. The final strike will be easier, but the helicopter goes in without fighter cover.' },
      ],
    },
  },
  {
    id: 'lastlight', act: 'Act 4 · Home', title: 'Last Light', role: 'sead', roles: ['air', 'sead', 'strike'], prefer: ['cutter', 'moss', 'ruby'], par: 16,
    story: 'Back to where it began.\n\nWhile the alliance was fighting in the desert, the Pacific and the mountains, Russia quietly retook the airstrip at Kjosen. It is now the most heavily defended place in the north: an SA-10 on the ridge, an SA-11, a Tor and a Pantsir around the strip, and Su-57s and Su-35s flying from it.\n\nIf Kjosen falls, the Russian position in the north collapses, and the negotiators in Geneva will have something to talk about. If it doesn\'t, the war goes into the winter.\n\nThe last light of the Arctic day lasts about twenty minutes. Lance takes off into it.',
    debrief: '',
    build: (ctx) => {
      const press = ctx.choices.highpass === 'press', rescue = ctx.choices.highpass === 'rescue';
      const units = [
        { key: 's300', side: 1, x: -6000, z: -19000, name: 'SA-10 battery' }, { key: 'hq', side: 1, x: -2600, z: -18600, name: 'Airstrip HQ' },
        { key: 'pantsir', side: 1, x: -1000, z: -18000 }, { key: 'tor', side: 1, x: -3800, z: -17800 }, { key: 'apc', side: 1, x: -2200, z: -17400, name: 'Garrison vehicles' },
        { key: 'depot', side: 1, x: -1600, z: -18200, name: 'Fuel dump' },
      ];
      if (!press) units.push({ key: 'buk', side: 1, x: 2000, z: -13000 }, { key: 'ewr', side: 1, x: -8000, z: -12000 });
      const blue = [human(ctx), ...wingSlots(ctx)];
      if (rescue) blue.push({ ...A('gripen', 'pilot', 'air', 'wingman', { ord: 'engage' }), name: 'Viking 1' }, { ...A('gripen', 'pilot', 'air', 'wingman', { ord: 'engage' }), name: 'Viking 2' });
      return scn('lastlight', 'Last Light', {
        map: 'arctic', time: 'dusk', weather: 'overcast', timeLimit: 25,
        briefing: `Kjosen airstrip, at the head of the fjord. The SA-10 battery on the west ridge covers everything above the mountains for 40 km. ${press ? 'Thanks to yesterday\'s raids, its SA-11 and early-warning radar are gone.' : 'An SA-11 to the south-east and an early-warning radar feed it targets.'} A Pantsir and a Tor guard the strip itself.\n\nTwo Su-57s and two Su-35s fly from the strip, and more will come.\n\nDestroy the SA-10 and the airstrip headquarters. ${rescue ? 'Viking 1 and 2, the Gripens whose pilot you helped rescue, fly with you today.' : ''} {flight}`,
        units,
        objectives: [
          { side: 0, kind: 'destroy', units: [0, 1], label: 'Destroy the SA-10 and the airstrip HQ' },
          { side: 0, kind: 'destroy', units: [2], label: 'Kill the Pantsir', optional: true },
          { side: 0, kind: 'destroy', units: [5], label: 'Burn the fuel dump', optional: true },
        ],
        waves: [{ id: 1, name: 'Flanker reserve', side: 1, x: 12000, z: -28000, alt: 6000, when: 'time', t: 260, slots: [A('su35s', 'pilot', 'air', 'aggressive'), A('su35s', 'pilot', 'air', 'wingman')] }],
        triggers: [
          msg('start', rescue ? 'VIKING 1: Viking flight with you, Lance. We owe you one.' : 'SENTINEL: Lance, the strip is at the head of the fjord. Last light in twenty minutes.'),
          msg('unitDead', 'SENTINEL: SA-10 is down! The north is open!', { unit: 0 }),
          msg('time', 'SENTINEL: Two more Flankers launching from Kola.', { t: 255 }),
        ],
        markers: [{ x: -2400, z: -18000, label: 'KJOSEN', icon: 'target' }, { x: -6000, z: -19000, label: 'SA-10', icon: 'danger' }, { x: 0, z: 22000, label: 'HOME', icon: 'home' }],
      }, side('Lance', 0, 21000, blue, { alt: 3000, spd: 240, form: 'wall' }),
         side('Russia', -2000, -14000, [A('su57', 'ace', 'air', 'sniper', { ord: 'cap', commit: 28 }), A('su57', 'pilot', 'air', 'wingman', { ord: 'cap', commit: 28 }), A('su35s', 'pilot', 'air', 'aggressive'), A('su35s', 'pilot', 'air', 'balanced')], { alt: 6000, spd: 230, spacing: 2500 }));
    },
  },
];
const BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));

// ---------------- saved progress ----------------
function blank() {
  return { v: 1, done: {}, choices: {}, pilots: {}, unlocked: ['f16c'], jet: 'f16c', loadout: {}, finished: false, started: Date.now() };
}
export class Campaign {
  constructor() { this.load(); }
  load() {
    this.d = blank();
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.v === 1) Object.assign(this.d, s); } catch {}
    for (const k of ORDER) if (!this.d.pilots[k]) this.d.pilots[k] = { status: PILOTS[k].spare ? 'reserve' : 'ok', kills: 0, sorties: 0 };
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch {} }
  reset() { try { localStorage.removeItem(KEY); } catch {} this.load(); }
  get started() { return Object.keys(this.d.done).length > 0; }
  // the story path: which missions this run of the campaign flies, given the choices so far
  path() { return MISSIONS.filter((m) => !m.when || m.when(this.d.choices)); }
  // the next mission to fly, or null when the campaign is over; a choice may be pending first
  next() { return this.path().find((m) => !this.d.done[m.id]) || null; }
  pendingChoice() {
    for (const m of this.path()) if (this.d.done[m.id] && m.choice && !this.d.choices[m.id]) return m;
    return null;
  }
  choose(mid, opt) { this.d.choices[mid] = opt; this.save(); }
  // the wingmen who fly the next mission: the squadron's available pilots, in order
  wing(n, prefer = []) {
    const out = [];
    for (const k of [...prefer, ...ORDER]) {
      const p = this.d.pilots[k];
      if (out.length >= n) break;
      if (p.status === 'ok' && !out.some((w) => w.key === k)) out.push({ key: k, ...PILOTS[k] });
    }
    // bring up replacements when the squadron is short
    for (const k of ORDER) {
      if (out.length >= n) break;
      if (this.d.pilots[k].status === 'reserve') { this.d.pilots[k].status = 'ok'; out.push({ key: k, ...PILOTS[k] }); }
    }
    return out;
  }
  // a scenario ready to fly, plus who flies in it
  build(mid, jet, loadout, name) {
    const m = BY_ID[mid];
    const wing = this.wing(m.roles.length, m.prefer);
    const ctx = { jet, loadout, name, wing, roles: m.roles.slice(0, wing.length), choices: this.d.choices, unlocked: this.d.unlocked };
    CTX = ctx;
    try { return { scn: m.build(ctx), wing }; } finally { CTX = null; }
  }
  // after a mission. r: { won, replay, optDone, optTotal, hp, time, kills, wing: [{key, kills, lost, ejected}] }
  finish(mid, r) {
    const m = BY_ID[mid];
    const g = grade(m, r);
    const out = { grade: g, news: [], unlock: null };
    if (!r.won) return out;
    const prev = this.d.done[mid];
    const best = prev && rank(prev.grade) <= rank(g.letter) ? prev.grade : g.letter;
    this.d.done[mid] = { grade: best, last: g.letter, t: Date.now() };
    if (!r.replay) {
      for (const w of r.wing) {
        const p = this.d.pilots[w.key];
        if (!p) continue;
        p.kills += w.kills; p.sorties++;
        if (w.lost) {
          p.status = w.ejected ? 'wounded' : 'kia';
          out.news.push(w.ejected ? `${PILOTS[w.key].name} ejected and was picked up, but is too badly hurt to fly again this war.` : `${PILOTS[w.key].name} was shot down. Nobody saw a parachute.`);
        }
      }
      if (m.unlock && !this.d.unlocked.includes(m.unlock)) { this.d.unlocked.push(m.unlock); out.unlock = m.unlock; }
      if (!this.next()) this.d.finished = true;
    }
    this.save();
    return out;
  }
  epilogue() {
    const c = this.d.choices, P = this.d.pilots;
    const alive = ORDER.filter((k) => !PILOTS[k].spare && P[k].status === 'ok').map((k) => PILOTS[k].name);
    const lost = ORDER.filter((k) => P[k].status === 'kia').map((k) => PILOTS[k].name);
    const hurt = ORDER.filter((k) => P[k].status === 'wounded').map((k) => PILOTS[k].name);
    const grades = this.path().map((m) => this.d.done[m.id] && this.d.done[m.id].grade).filter(Boolean);
    const avg = grades.reduce((a, gr) => a + (4 - rank(gr)), 0) / Math.max(1, grades.length);
    const list = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
    const p = [];
    p.push('The SA-10 at Kjosen burned through the Arctic night. Two days later, the Russian garrison in the north pulled back across the border, and the talks in Geneva began in earnest. The ceasefire was signed six weeks later: no victory parades, no surrender, just a line on a map that both sides agreed to stop shooting across.');
    p.push(c.sandstorm === 'airfield' ? 'In the Pacific, the night raid on the Kestrel airfield is studied at staff colleges as the gamble that worked: the J-16 regiment never flew again in the war, and the Resolute never took a hit.' : 'In the Pacific, CVN Resolute came home with a scorched flight deck and a crew who bought Lance\'s drinks for a year.');
    p.push(c.highpass === 'rescue' ? 'Viking 3 flew again by spring. Every year since, a bottle of Swedish aquavit arrives at Lance Squadron with no note.' : 'Viking 3 was captured on the ridge and released in the first prisoner exchange after the ceasefire. Hayes went to meet the plane, alone, and never said what was said.');
    if (lost.length) p.push(`Lance lost ${list(lost)}. ${lost.length > 1 ? 'Their names are' : `${lost[0]}'s name is`} on the wall of the squadron's briefing room, under the gun-camera still from the first morning.`);
    if (hurt.length) p.push(`${list(hurt)} never flew a fighter again, but ${hurt.length > 1 ? 'they' : hurt[0]} still turn${hurt.length > 1 ? '' : 's'} up at every reunion.`);
    if (alive.length === 3) p.push('All three of the original wingmen came home. Cutter retired that winter, still never having lost a wingman.');
    else if (alive.length) p.push(`${list(alive)} came home with you.`);
    p.push(avg >= 3.3 ? 'You finished the war as the most decorated pilot in the squadron.' : avg >= 2.5 ? 'You finished the war a flight lead, and a good one.' : 'You finished the war alive, which in the end is all anyone asked of you.');
    return p;
  }
}

// ---------------- grading ----------------
const LETTERS = ['S', 'A', 'B', 'C'];
const rank = (l) => Math.max(0, LETTERS.indexOf(l));
export function grade(m, r) {
  const parts = [];
  let pts = 55;
  parts.push(['Mission complete', 55]);
  const opt = r.optTotal ? Math.round((r.optDone / r.optTotal) * 20) : 20;
  parts.push([r.optTotal ? `Optional objectives ${r.optDone}/${r.optTotal}` : 'No optional objectives', opt]); pts += opt;
  const hp = Math.round(Math.max(0, Math.min(100, r.hp)) / 100 * 10);
  parts.push([`Damage taken (${Math.round(100 - r.hp)}%)`, hp]); pts += hp;
  const k = Math.min(10, r.kills * 2);
  parts.push([`Kills by you (${r.kills})`, k]); pts += k;
  const fast = r.time <= m.par * 60 ? 5 : 0;
  parts.push([`Time ${fmtT(r.time)} (par ${m.par}:00)`, fast]); pts += fast;
  const lost = r.wing.filter((w) => w.lost).length;
  if (lost) { parts.push([`Wingmen lost (${lost})`, -15 * lost]); pts -= 15 * lost; }
  const letter = pts >= 95 ? 'S' : pts >= 82 ? 'A' : pts >= 68 ? 'B' : 'C';
  return { letter, pts, parts };
}
const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ---------------- campaign screen ----------------
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const paras = (t, cs) => t.split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${esc(p).replace(/\{cs\}/g, esc(cs))}</p>`).join('');
const STATUS = { ok: 'Flying', reserve: 'In training', wounded: 'Wounded, grounded', kia: 'Killed in action' };

// hooks: { callsign, fly(mid, jet, loadout), menu(), loadoutsOf(jet) -> [[key, label]], defaultLoadout(jet, role) }
export function renderCampaign(root, C, hooks, sel = {}) {
  const d = C.d, choice = C.pendingChoice(), next = C.next();
  const path = C.path();
  const viewing = sel.mid ? MISSIONS.find((m) => m.id === sel.mid) : next;
  const jet = d.unlocked.includes(d.jet) ? d.jet : d.unlocked[0];
  let body = '';
  if (choice) {
    body = `<div class="cmpact">${esc(choice.act)} · after ${esc(choice.title)}</div><h2>A decision</h2>${paras(choice.choice.prompt, hooks.callsign)}
      <div class="cmpchoices">${choice.choice.options.map((o) => `<button data-choose="${o.id}" class="cmpopt"><b>${esc(o.label)}</b><span>${esc(o.desc)}</span></button>`).join('')}</div>`;
  } else if (!viewing) {
    body = `<div class="cmpact">Epilogue</div><h2>After the war</h2>${C.epilogue().map((p) => `<p>${esc(p)}</p>`).join('')}<p class="dim small">You can fly any mission again from the list to improve its grade.</p>`;
  } else {
    const done = d.done[viewing.id];
    const T = JETS[jet], lo = d.loadout[jet + ':' + viewing.role] || hooks.defaultLoadout(jet, viewing.role);
    const noAG = viewing.role !== 'air' && !Object.values(T.loadouts).some((L) => L.ag);
    const wing = C.wing.call({ d: JSON.parse(JSON.stringify(d)) }, viewing.roles.length, viewing.prefer);
    body = `<div class="cmpact">${esc(viewing.act)} · Mission ${path.indexOf(viewing) + 1} of ${path.length}${done ? ` · best grade <b class="grade g${done.grade}">${done.grade}</b>` : ''}</div>
      <h2>${esc(viewing.title)}</h2>${paras(fillText(viewing.story, hooks.callsign, wing, viewing.roles), hooks.callsign)}
      <h3>Your flight</h3>
      <p class="small">${esc(hooks.callsign)} (you)${wing.map((w) => ` · <b>${esc(w.name)}</b> <span class="dim">${esc(w.bio)}</span>`).join('')}</p>
      <h3>Aircraft</h3>
      <div class="cards">${d.unlocked.map((k) => `<button class="card ${k === jet ? 'on' : ''}" data-jet="${k}"><b>${esc(JETS[k].name)}</b><span>${esc(JETS[k].nick)}</span></button>`).join('')}${CAMPAIGN_JETS.filter((k) => !d.unlocked.includes(k)).map((k) => `<button class="card locked" disabled><b>${esc(JETS[k].name)}</b><span>locked</span></button>`).join('')}</div>
      <label>Loadout <select id="cmpLoadout">${hooks.loadoutsOf(jet).map(([k, l]) => `<option value="${k}" ${k === lo ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      ${noAG ? `<p class="warn small">The ${esc(T.name)} carries no ground weapons. Your wingmen will have to destroy the targets.</p>` : ''}
      <div class="brow"><button id="cmpFly" class="primary">Briefing ▸</button>${done && viewing !== next ? '<span class="dim small">Replaying a finished mission only improves its grade; it does not change your squadron.</span>' : ''}</div>`;
  }
  const missionRow = (m, i) => {
    const dn = d.done[m.id], isNext = m === next, open = dn || isNext;
    return `<li class="${m === viewing ? 'on' : ''} ${open ? '' : 'locked'}">${open ? `<button data-mid="${m.id}">` : '<span>'}<em>${i + 1}</em> ${esc(m.title)} ${dn ? `<b class="grade g${dn.grade}">${dn.grade}</b>` : isNext ? '<b class="nextm">NEXT</b>' : ''}${open ? '</button>' : '</span>'}</li>`;
  };
  const sq = ORDER.filter((k) => d.pilots[k].status !== 'reserve').map((k) => `<li class="st-${d.pilots[k].status}"><b>${esc(PILOTS[k].name)}</b> <span class="dim">${STATUS[d.pilots[k].status]} · ${d.pilots[k].kills} kill${d.pilots[k].kills === 1 ? '' : 's'}</span></li>`).join('');
  root.innerHTML = `
    <div class="cmphead"><div><h1>FAULT LINES</h1><p class="dim small">Campaign · Lance Squadron</p></div></div>
    <div class="cmpgrid">
      <section class="cmpstory">${body}</section>
      <aside>
        <h3>Missions</h3><ol class="cmplist">${path.map(missionRow).join('')}</ol>
        <h3>Squadron</h3><ul class="cmpsq">${sq}</ul>
        <div class="brow"><button id="cmpMenu" class="ghost">Main menu</button><button id="cmpReset" class="ghost danger">Restart campaign</button></div>
      </aside>
    </div>`;
  const $ = (s) => root.querySelector(s);
  root.querySelectorAll('[data-choose]').forEach((b) => (b.onclick = () => { C.choose(choice.id, b.dataset.choose); renderCampaign(root, C, hooks); }));
  root.querySelectorAll('[data-mid]').forEach((b) => (b.onclick = () => renderCampaign(root, C, hooks, { mid: b.dataset.mid === (next && next.id) ? null : b.dataset.mid })));
  root.querySelectorAll('[data-jet]').forEach((b) => (b.onclick = () => { d.jet = b.dataset.jet; C.save(); renderCampaign(root, C, hooks, sel); }));
  const ls = $('#cmpLoadout');
  if (ls && viewing) ls.onchange = () => { d.loadout[jet + ':' + viewing.role] = ls.value; C.save(); renderCampaign(root, C, hooks, sel); };
  const fly = $('#cmpFly');
  if (fly) fly.onclick = () => hooks.fly(viewing.id, jet, ls.value, !!d.done[viewing.id] && viewing !== next);
  $('#cmpMenu').onclick = () => hooks.menu();
  $('#cmpReset').onclick = () => { if (confirm('Restart the campaign from the first mission? Your grades, squadron and choices will be lost.')) { C.reset(); renderCampaign(root, C, hooks); } };
}

export function missionById(id) { return BY_ID[id] || null; }
export const STATUS_TEXT = STATUS;
