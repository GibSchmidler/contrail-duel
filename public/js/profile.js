// Pilot profile: career statistics, medals and achievements, best time-trial times and completed
// training lessons, saved in this browser. Also renders the profile screen with the nose-art editor.
import { ART, ART_COLORS, drawArt, sanitizeArt } from './noseart.js';

const KEY = 'contrail-profile';
export const MEDALS = [
  { id: 'first', ic: '✈', name: 'First blood', desc: 'Shoot down your first enemy aircraft.' },
  { id: 'ace', ic: '★', name: 'Ace', desc: '5 air kills in your career.' },
  { id: 'dace', ic: '✪', name: 'Double ace', desc: '10 air kills in your career.' },
  { id: 'centurion', ic: '♛', name: 'Centurion', desc: '100 air kills in your career.' },
  { id: 'aceday', ic: '☀', name: 'Ace in a day', desc: '5 air kills in a single mission.' },
  { id: 'guns', ic: '⁂', name: 'Guns, guns, guns', desc: 'Shoot an aircraft down with the cannon.' },
  { id: 'marksman', ic: '◎', name: 'Marksman', desc: 'Hit with at least 75% of 4 or more missiles in one mission.' },
  { id: 'mud', ic: '▣', name: 'Mud mover', desc: '10 ground targets destroyed in your career.' },
  { id: 'ironhand', ic: '⚡', name: 'Iron Hand', desc: 'Destroy a SAM or anti-aircraft site.' },
  { id: 'ship', ic: '⚓', name: 'Ship killer', desc: 'Sink a warship or freighter.' },
  { id: 'trap', ic: '⚑', name: 'Tailhooker', desc: 'Land on an aircraft carrier.' },
  { id: 'ok3', ic: '③', name: 'OK 3-wire', desc: 'Catch the 3 wire: a perfect carrier landing.' },
  { id: 'survivor', ic: '⛨', name: 'Survivor', desc: 'Reach wave 5 in a survival mission.' },
  { id: 'wall', ic: '▦', name: 'Iron wall', desc: 'Reach wave 10 in a survival mission.' },
  { id: 'racer', ic: '⏱', name: 'Speed demon', desc: 'Finish a time trial.' },
  { id: 'student', ic: '✎', name: 'Student pilot', desc: 'Complete a training lesson.' },
  { id: 'graduate', ic: '🎓', name: 'Graduate', desc: 'Complete all nine training lessons.' },
  { id: 'victory', ic: '⚔', name: 'Mission accomplished', desc: 'Win a mission or match.' },
  { id: 'untouch', ic: '◇', name: 'Untouchable', desc: 'Win a mission with at least one kill without taking a single hit.' },
  { id: 'phoenix', ic: '♨', name: 'Phoenix', desc: 'Get shot down, respawn, and score a kill in the same mission.' },
  { id: 'online', ic: '☍', name: 'Team player', desc: 'Win an online match.' },
  { id: 'veteran', ic: '✧', name: 'Veteran', desc: 'Fly 25 sorties.' },
];
const BY_ID = Object.fromEntries(MEDALS.map((m) => [m.id, m]));
const LESSON_COUNT = 9;

function blank() {
  return { v: 1, sorties: 0, wins: 0, losses: 0, draws: 0, airKills: 0, groundKills: 0, gunKills: 0, deaths: 0, assists: 0, damage: 0, mostDamage: 0, shots: 0, hits: 0, rounds: 0, gunHits: 0,
    agShots: 0, agHits: 0, traps: 0, perfectTraps: 0, flight: 0, bestWave: 0, mostKills: 0, races: {}, lessons: {}, medals: {} };
}

export class Profile {
  constructor() {
    this.d = blank();
    try { Object.assign(this.d, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
    this.onMedal = null; this.m = null; this.fresh = [];
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch {} }
  award(id) {
    if (this.d.medals[id] || !BY_ID[id]) return;
    this.d.medals[id] = Date.now();
    this.fresh.push(id);
    this.save();
    if (this.onMedal) this.onMedal(BY_ID[id]);
  }
  // ---- events from the game ----
  missionStart() { this.m = { kills: 0, gk: 0, hit: false, died: false, shots0: 0, hits0: 0, dmg: 0 }; this.fresh = []; this.d.sorties++; if (this.d.sorties >= 25) this.award('veteran'); this.save(); }
  kill(cause) {
    const d = this.d, m = this.m || (this.m = { kills: 0, gk: 0 });
    d.airKills++; m.kills++;
    if (cause === 'gun') { d.gunKills++; this.award('guns'); }
    this.award('first');
    if (d.airKills >= 5) this.award('ace');
    if (d.airKills >= 10) this.award('dace');
    if (d.airKills >= 100) this.award('centurion');
    if (m.kills >= 5) this.award('aceday');
    if (m.died) this.award('phoenix');
    d.mostKills = Math.max(d.mostKills, m.kills);
    this.save();
  }
  groundKill(D) {
    const d = this.d;
    d.groundKills++; if (this.m) this.m.gk++;
    if (D.cat === 'sam' || D.cat === 'aaa') this.award('ironhand');
    if (D.ship) this.award('ship');
    if (d.groundKills >= 10) this.award('mud');
    this.save();
  }
  hit() { if (this.m) this.m.hit = true; }
  assist() { this.d.assists = (this.d.assists || 0) + 1; this.save(); }
  // called for every hit, so it saves at the end of the match rather than each time
  damage(amt) { this.d.damage = (this.d.damage || 0) + amt; if (this.m) { this.m.dmg = (this.m.dmg || 0) + amt; this.d.mostDamage = Math.max(this.d.mostDamage || 0, this.m.dmg); } }
  died() { this.d.deaths++; if (this.m) this.m.died = true; this.save(); }
  trap(wire) { this.d.traps++; this.award('trap'); if (wire === 3) { this.d.perfectTraps++; this.award('ok3'); } this.save(); }
  lesson(key) { this.d.lessons[key] = true; this.award('student'); if (Object.keys(this.d.lessons).length >= LESSON_COUNT) this.award('graduate'); this.save(); }
  wave(n) { this.d.bestWave = Math.max(this.d.bestWave, n); if (n >= 5) this.award('survivor'); if (n >= 10) this.award('wall'); this.save(); }
  race(id, t) { this.award('racer'); const b = this.d.races[id]; const best = !b || t < b; if (best) this.d.races[id] = t; this.save(); return best; }
  best(id) { return this.d.races[id] || null; }
  // end of a match. st: the mission's G.stats; won: true/false/null (draw); online: bool
  matchEnd(st, won, online) {
    const d = this.d;
    if (st) { d.shots += st.msl; d.hits += st.mslHits; d.rounds += st.rounds; d.gunHits += st.gunHits; d.agShots += st.ag; d.agHits += st.agHits; d.flight += st.flight || 0;
      if (st.msl >= 4 && st.mslHits / st.msl >= 0.75) this.award('marksman'); }
    if (won === true) { d.wins++; this.award('victory'); if (online) this.award('online'); if (this.m && !this.m.hit && this.m.kills + this.m.gk > 0) this.award('untouch'); }
    else if (won === false) d.losses++; else d.draws++;
    this.save();
  }
}

// ---------------- profile screen ----------------
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
export function renderProfile(root, P, settings, hooks) {
  const d = P.d, art = sanitizeArt(settings.art) || { d: 'none', c: ART_COLORS[0], text: '' };
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const hours = d.flight / 3600;
  const races = Object.entries(d.races).map(([id, t]) => `<li>${esc(hooks.scenarioName(id))}: <b>${fmt(t)}</b></li>`).join('');
  root.innerHTML = `
    <h2>Pilot profile</h2>
    <div class="grid">
      <section>
        <label>Callsign <input id="pfName" maxlength="16" value="${esc(settings.name)}"></label>
        <h3 class="mt">Nose art</h3>
        <p class="dim small">Painted on both sides of your jet's nose. Other pilots see it online.</p>
        <div class="artgrid" id="pfArt">${Object.entries(ART).map(([k, v]) => `<button data-art="${k}" class="${art.d === k ? 'on' : ''}" title="${esc(v)}"><canvas width="256" height="160"></canvas></button>`).join('')}</div>
        <div class="brow">
          <label>Colour <select id="pfColor">${ART_COLORS.map((c) => `<option value="${c}" ${c === art.c ? 'selected' : ''} style="background:${c}">${c}</option>`).join('')}</select></label>
          <label>Name on the nose <input id="pfText" maxlength="14" value="${esc(art.text)}" placeholder="optional"></label>
        </div>
      </section>
      <section>
        <h3>Career</h3>
        <div class="pstats">
          <div><span>${d.sorties}</span>sorties</div>
          <div><span>${d.wins}–${d.losses}${d.draws ? '–' + d.draws : ''}</span>won–lost</div>
          <div><span>${d.airKills}</span>air kills (${d.gunKills} guns)</div>
          <div><span>${d.assists || 0}</span>assists</div>
          <div><span>${d.groundKills}</span>ground kills</div>
          <div><span>${Math.round(d.damage || 0)}</span>damage dealt (best ${Math.round(d.mostDamage || 0)})</div>
          <div><span>${d.mostKills || 0}</span>most kills in a match</div>
          <div><span>${d.deaths}</span>times shot down</div>
          <div><span>${d.deaths ? (d.airKills / d.deaths).toFixed(2) : d.airKills}</span>kill/death ratio</div>
          <div><span>${pct(d.hits, d.shots)}</span>missile hits (${d.hits}/${d.shots})</div>
          <div><span>${pct(d.agHits, d.agShots)}</span>bombs/ARMs on target</div>
          <div><span>${pct(d.gunHits, d.rounds)}</span>gun rounds on target</div>
          <div><span>${d.traps}</span>carrier traps (${d.perfectTraps} 3-wires)</div>
          <div><span>${d.bestWave || '—'}</span>best survival wave</div>
          <div><span>${hours < 1 ? Math.round(d.flight / 60) + ' min' : hours.toFixed(1) + ' h'}</span>flight time</div>
        </div>
        ${races ? `<h3>Best times</h3><ul class="small">${races}</ul>` : ''}
        <p class="small">Training: ${Object.keys(d.lessons).length}/${LESSON_COUNT} lessons complete.</p>
      </section>
    </div>
    <h3>Medals and achievements <span class="dim small">${Object.keys(d.medals).length}/${MEDALS.length}</span></h3>
    <div class="medals">${MEDALS.map((m) => `<div class="medal ${d.medals[m.id] ? 'on' : ''}"><span class="ic">${m.ic}</span><b>${esc(m.name)}</b>${esc(m.desc)}${d.medals[m.id] ? `<div class="dim">${new Date(d.medals[m.id]).toLocaleDateString()}</div>` : ''}</div>`).join('')}</div>
    <div class="brow"><button id="pfClose" class="primary">Done</button><button id="pfReset" class="ghost danger">Reset career</button></div>`;
  const cur = { ...art };
  const paint = () => {
    root.querySelectorAll('#pfArt button').forEach((b) => {
      b.classList.toggle('on', b.dataset.art === cur.d);
      drawArt(b.querySelector('canvas').getContext('2d'), 256, 160, { d: b.dataset.art, c: cur.c, text: cur.text }, false);
    });
  };
  const commit = () => { settings.art = sanitizeArt(cur); hooks.save(); };
  paint();
  root.querySelector('#pfArt').onclick = (e) => { const b = e.target.closest('button[data-art]'); if (!b) return; cur.d = b.dataset.art; paint(); commit(); };
  root.querySelector('#pfColor').onchange = (e) => { cur.c = e.target.value; paint(); commit(); };
  root.querySelector('#pfText').oninput = (e) => { cur.text = e.target.value; paint(); commit(); };
  root.querySelector('#pfName').onchange = (e) => { settings.name = (e.target.value || 'Viper').replace(/[^\w \-]/g, '').slice(0, 16) || 'Viper'; hooks.save(); };
  root.querySelector('#pfClose').onclick = () => hooks.close();
  root.querySelector('#pfReset').onclick = () => { if (confirm('Reset all career statistics, medals and best times?')) { P.d = blank(); P.save(); renderProfile(root, P, settings, hooks); } };
}

export { BY_ID as MEDAL_BY_ID };
