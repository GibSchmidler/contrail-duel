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
      { text: `Slow to about 140 kt (260 km/h): throttle back with F and use the airbrake (B).`, hint: 'Flaps only come down below ~260 kt; above that they blow back up.', done: (c) => c.speed * KT < 150 },
      { text: 'Fly the glideslope: keep the carrier cue on the HUD centred (HIGH/LOW, LEFT/RIGHT) and fly onto the back of the deck. Do not flare: let it hit and catch a wire!', hint: 'Sink no faster than 8 m/s, keep the wings level and stay under 200 kt. Missed the wires? Full power (R) to go around.', done: (c) => c.landed && c.landed !== 'roll' },
      { text: 'TRAP! Taxiing to the catapult: the crew rearms, refuels and repairs the jet.', done: (c) => c.landed === 'ready' },
      { text: 'Throttle to full power (R) to launch off the catapult, then raise the gear (J) and flaps (K).', done: (c) => !c.landed && !c.gear && c.alt > 150 },
    ],
  },
};

export class Lesson {
  constructor(key) {
    this.key = key; this.L = LESSONS[key];
    this.i = 0; this.t = 0; this.acc = 0; this.total = 0;
    this.defeated = 0; this.prevThreats = 0; this.hitT = 0; this.prevHp = 100;
    this.doneFlash = 0; this.finished = false;
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
    const S = this.step;
    if (!S || !c.alive) return false;
    if (S.done(c, this)) {
      this.i++; this.t = 0; this.acc = 0; this.doneFlash = 2.2;
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
