// Training lessons: step-by-step prompts on the HUD, each step finished by doing the thing it asks.
// The lesson scenarios themselves (map, targets, start points) are presets with mode 'training'.
// Each step's done(c, L) gets a snapshot of the player's jet (see lessonContext in main.js);
// L.hold(cond, s) is true once cond has held for s seconds.
const KT = 1.944;
const kills = (n) => (c) => c.kills >= n;
const dead = (i) => (c) => !!c.units[i] && !c.units[i].alive;

export const LESSONS = {
  basics: {
    name: 'Flight basics',
    steps: [
      { text: 'Pitch with W/S (S pulls the nose up) and roll with A/D. Climb above 3,000 m.', done: (c) => c.alt > 3000 },
      { text: 'Roll into a 60° bank turn and hold it for 5 seconds.', hint: 'The bank scale is at the top of the HUD; pull gently (S) to keep the nose up in the turn.', done: (c, L) => L.hold(Math.abs(c.bank) > 0.95, 5) },
      { text: 'Hold R to push the throttle past 100% into afterburner.', hint: 'The throttle is shown bottom left. Afterburner gives far more thrust but burns fuel fast.', done: (c) => c.throttle > 1.02 },
      { text: 'Pull hard (hold S) to 6 G or more.', hint: 'You turn tightest at corner speed (the blue caret on the speed tape). Above 7.5 G the G-STRESS bar fills.', done: (c) => c.g >= 6 },
      { text: 'Slow down below 500 km/h: throttle back with F and hold B for the airbrake.', done: (c) => c.speed < 139 },
      { text: 'Lower the gear (J) and flaps (K) and fly level below 330 km/h for 5 seconds without stalling.', hint: 'Flaps add lift at low speed. Use the trim keys [ and ] to hold the nose without pulling the stick.', done: (c, L) => L.hold(c.gear && c.flaps > 0 && c.speed < 92 && Math.abs(c.vy) < 15, 5) },
      { text: 'Raise the gear (J) and flaps (K), throttle up and fly to the waypoint marked on the HUD.', done: (c) => !c.gear && c.markDist < 2000 },
      { text: 'Press V to switch between cockpit and chase view, and hold G to look behind you.', done: (c, L) => L.t > 6 },
    ],
  },
  guns: {
    name: 'Gunnery',
    steps: [
      { text: 'A target drone is circling ahead. Press N until it is boxed on the HUD, then fly toward it.', hint: 'When it is off screen, an arrow at the edge of the HUD points to it.', done: (c) => c.tgtDist < 5000 },
      { text: 'Get behind it and close to within 1,000 m. The range is shown next to the target box.', hint: 'Use the throttle to match its speed; do not overshoot.', done: (c) => c.tgtDist < 1000 },
      { text: 'Put the gun cross on the lead pipper and fire short bursts with Space.', hint: 'The pipper shows where the bullets will be when they reach the target. Pull lead, then squeeze.', done: kills(1) },
      { text: 'Good kill! A second drone is turning harder. Shoot it down with the gun too.', done: kills(2) },
    ],
  },
  missiles: {
    name: 'Air-to-air missiles',
    steps: [
      { text: 'Press 1 for heat-seeking (IR) missiles. Point your nose at a drone until the seeker locks (a steady tone and a diamond).', done: (c) => c.weapon === 'srm' && c.locked },
      { text: 'Fire with X: FOX 2!', hint: 'IR missiles are fire-and-forget. Fire again if the first one misses.', done: kills(1) },
      { text: 'Press 2 for radar missiles and lock the next drone with Tab (single-target track).', hint: 'The radar fan at the bottom shows what the radar sees. Locking sets off the target’s warning receiver.', done: (c) => c.weapon === 'mrm' && c.stt },
      { text: 'Fire inside the launch zone (the bracket on the right of the HUD) and keep the lock until impact.', done: kills(2) },
      { text: 'Helmet sight: press T for the padlock view and look at the last drone. With a helmet sight the IR seeker follows your eyes up to ~90° off the nose. Press 1, wait for the lock and fire.', hint: 'Not every jet has a helmet sight; the F-16C, F/A-18E, Su-35 and most modern fighters do.', done: kills(3) },
    ],
  },
  defence: {
    name: 'Missile defence',
    steps: [
      { text: 'An SA-11 SAM site guards the marked area. Fly toward it at medium altitude and watch the warning receiver (RWR, bottom left).', hint: 'Each threat shows as a code on the RWR: "11" is the SA-11. A ring around it means it has locked you.', done: (c) => c.markDist < 30000 },
      { text: 'When it launches you will hear the missile warning. Drop chaff (Z) and turn to put the missile on your wing (beam it).', hint: 'Radar missiles struggle with a target flying across their beam (the notch). Chaff helps break the lock.', done: (c) => c.defeated >= 1 },
      { text: 'Defeated! Survive two more missiles. Diving low behind hills also breaks the radar’s line of sight.', hint: 'Flares (C) are for heat-seekers, chaff (Z) for radar missiles.', done: (c) => c.defeated >= 3 },
      { text: 'Now get out: fly more than 35 km from the site, or drop below 150 m behind terrain.', done: (c) => c.threats === 0 && (c.markDist > 35000 || c.agl < 150) },
    ],
  },
  strike: {
    name: 'Bombs and rockets',
    steps: [
      { text: 'Press 3 to select air-to-ground weapons. Press 3 again to cycle until bombs are selected.', done: (c) => c.weapon === 'ag' && c.agCls === 'bomb' },
      { text: 'Fly toward the trucks marked TARGET. Ground targets show as diamonds; N cycles between them.', done: (c) => c.markDist < 9000 },
      { text: 'Roll in and dive 20-30° at the target. The CCIP circle shows where the bombs will land: put it on the trucks and press X.', hint: 'Release above about 600 m and pull out right away. Fragments from your own bombs can hit you if you drop too low.', done: (c) => c.stats.ag >= 1 },
      { text: 'Destroy the trucks. Make another pass if you missed.', done: dead(0) },
      { text: 'Now the tanks. They are armoured, so it takes a direct hit: use the rest of your bombs, or strafe them with the gun (Space).', done: dead(1) },
    ],
  },
  sead: {
    name: 'SEAD: killing radars',
    steps: [
      { text: 'Press 3 and cycle until the HARM anti-radiation missile is selected.', hint: 'Anti-radiation missiles home on the target’s own radar signal.', done: (c) => c.weapon === 'ag' && c.agCls === 'arm' },
      { text: 'Fly toward the SA-11 until the HARM locks its radar (LOCK box on the HUD). Transmitting radars show amber.', done: (c) => c.agLocked },
      { text: 'Fire with X: MAGNUM! Then turn away. The crew may switch the radar off when they see an ARM coming.', done: (c) => c.stats.ag >= 1 },
      { text: 'Destroy the SA-11 site. Fire again if the missile went dumb when the radar switched off.', done: dead(0) },
      { text: 'Finish the early-warning radar to blind the rest of the network.', done: dead(1) },
    ],
  },
  carrier: {
    name: 'Carrier landing',
    steps: [
      { text: 'The carrier is ahead. Lower the gear (J) and flaps (K).', done: (c) => c.gear && c.flaps > 0 },
      { text: `Slow to approach speed: throttle back (F) until the AOA indexer left of centre shows the amber donut (about 125 kt). Then press Y for auto-throttle: it holds on-speed for you.`, hint: 'Upper green chevron = slow, add power. Lower red chevron = fast, pull power. Flaps only come down below ~260 kt.', done: (c) => c.speed * KT < 150 },
      { text: 'Fly the glideslope: keep the needles crossed in the middle and the ball level with the green datum lights, and listen to the LSO. Small stick inputs only. Do not flare: fly it onto the deck and catch a wire!', hint: 'Ball high = you are high, ball low = low. Wings level at the ramp. Bolter or wave-off? Full power (R) and come around again.', done: (c) => c.landed && c.landed !== 'roll' },
      { text: 'TRAP! Taxiing to the catapult: the crew rearms, refuels and repairs the jet.', done: (c) => c.landed === 'ready' },
      { text: 'Throttle to full power (R) to launch off the catapult, then raise the gear (J) and flaps (K).', done: (c) => !c.landed && !c.gear && c.alt > 150 },
    ],
  },
};

// Air-to-air missile defence: a scripted aggressor (the lesson's red drone) is placed relative to
// you and fires on cue. fire: { key, range (m), from: 'front'|'behind', dAlt (m above you), salvo }.
const R77 = (range, o = {}) => ({ key: 'r77', range, from: 'front', dAlt: 1500, ...o });
const R73 = (range, o = {}) => ({ key: 'r73', range, from: 'behind', dAlt: 0, aim: 4, ...o });
const def = (n) => (c) => c.defeated >= n;
Object.assign(LESSONS, {
  aadef: {
    name: 'Beating radar missiles',
    steps: [
      { text: 'An Su-35 about 34 km ahead is about to fire a long-range R-77 at you. DRAG it: turn until the missile is at your 6 o’clock, full afterburner (R) and dive. Make it run out of energy.', hint: 'The coach box low on the HUD says what the missile is doing. A long shot burns its motor in seconds, then coasts and slows: a target running away makes it fly much farther.', fire: R77(34000), done: def(1) },
      { text: 'Now from 15 km: too close to outrun. When the coach says PITBULL, NOTCH: turn to a BEAM marker on the heading tape so the missile is at your 3 or 9 o’clock, and stay below it.', hint: 'The NOTCH line turns green when your closing speed on the missile is low enough and you are below it. Hold the beam until the missile goes dumb. Turning too early lets it correct.', fire: R77(15000), done: def(2) },
      { text: 'Again, and this time pop chaff (Z) two or three times once you are in the notch.', hint: 'Chaff barely works unless you are beaming: a Doppler radar ignores chaff that is not moving like you. In the notch it is very effective.', fire: R77(14000), done: (c) => c.defeated >= 3 && c.chaffUsed >= 2 },
      { text: 'Cut the datalink. Before it goes active, the R-77 is steered by the Su-35’s radar. Beam the LAUNCHER (BEAM markers) and get below it: when its lock breaks, the missile flies to where you were.', hint: 'Watch the coach: "flying blind" means the datalink is cut. Then turn and change altitude so the missile goes active on empty sky.', fire: R77(30000), done: def(4) },
      { text: 'Final exam: two R-77s from 24 km. Drag first, then notch and chaff as they go active.', hint: 'Each missile is a separate problem; the coach shows whichever will reach you first.', fire: R77(24000, { salvo: 2 }), done: def(6) },
    ],
  },
  irdef: {
    name: 'Beating heat-seekers',
    steps: [
      { text: 'A MiG-29 is sliding in about 3 km behind you with R-73 heat-seekers. Throttle back out of afterburner, and the moment it launches pop flares (C) and break hard across the missile’s path.', hint: 'Hold G to look behind, or drag the mouse to look around. The afterburner plume is a beacon for an IR seeker, and you cannot notch a heat-seeker.', fire: R73(2800), done: def(1) },
      { text: 'Two more. Time the flares to the launch, a few at a time, and turn hard so it has to overshoot.', hint: 'Flares work best early, before the seeker settles on you, and when it sees you side-on.', fire: R73(2600), done: def(3) },
      { text: 'Head-on: it is coming at you from 6 km ahead. Flares, then turn hard to put it on your beam so it has to pull lead.', fire: R73(6000, { from: 'front' }), done: def(4) },
    ],
  },
});

export class Lesson {
  constructor(key) {
    this.key = key; this.L = LESSONS[key];
    this.i = 0; this.t = 0; this.acc = 0; this.total = 0;
    this.defeated = 0; this.prevThreats = 0; this.hitT = 0; this.prevHp = 100;
    this.doneFlash = 0; this.finished = false;
    this.fs = 'wait'; this.fireT = 3; this.left = 0; this.firedI = -1;   // scripted launches
  }
  hold(cond, secs) { this.acc = cond ? this.acc + this.dt : 0; return this.acc >= secs; }
  get step() { return this.L.steps[this.i] || null; }
  // returns true when a step was just completed
  update(dt, c) {
    this.doneFlash = Math.max(0, this.doneFlash - dt);
    if (this.finished) return false;
    this.dt = dt; this.t += dt; this.total += dt;
    // a missile that stops guiding on us without a hit counts as defeated
    if (c.hp < this.prevHp - 0.5 || !c.alive) this.hitT = 1.5;
    this.hitT -= dt; this.prevHp = c.hp;
    if (c.threats < this.prevThreats && this.hitT <= 0 && c.alive) this.defeated += this.prevThreats - c.threats;
    this.prevThreats = c.alive ? c.threats : 0;
    c.defeated = this.defeated;
    if (this.prevChaff != null && c.chaff < this.prevChaff) this.chaffUsed = (this.chaffUsed || 0) + this.prevChaff - c.chaff;
    this.prevChaff = c.chaff; c.chaffUsed = this.chaffUsed || 0;
    const S = this.step;
    if (!S || !c.alive) return false;
    if (S.done(c, this)) {
      this.i++; this.t = 0; this.acc = 0; this.doneFlash = 2.2; this.fs = 'wait'; this.fireT = 3; this.chaffUsed = 0;
      if (this.i >= this.L.steps.length) this.finished = true;
      return true;
    }
    return false;
  }
  hud() {
    const S = this.step;
    return { name: this.L.name, n: Math.min(this.i + 1, this.L.steps.length), of: this.L.steps.length, text: S ? S.text : 'Lesson complete!', hint: S && S.hint ? S.hint : '', done: this.doneFlash > 0 };
  }
}
