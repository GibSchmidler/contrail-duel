// Scenario builder, mission half: mode and scoring rules, ground units and ships, waves of
// reinforcements, objectives, triggers, map markers, time-trial gates and the briefing.
// Units, markers, gates, waves, zones and route points can all be placed and dragged on the map.
import { UNITS } from './ground.js';
import { JETS, JETS_OF, COUNTRIES } from './aircraft.js';
import { MODES, WIN_RULES, OBJ_KINDS, TRIG_WHEN, TRIG_DO, MARKER_ICONS, MAX_UNITS, MAX_WAVES, MAX_OBJ, MAX_TRIG, MAX_MARK, MAX_GATES,
  SKILL_LABELS, ORDERS, FORMATIONS, SIDE_COLORS, MAX_PER_SIDE, slot, aiConfig } from './scenario.js';
import { ARENA_RADIUS } from './world.js';
import { LESSONS } from './training.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const opt = (v, label, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(label)}</option>`;

export const TABS = { air: 'Setup & aircraft', mode: 'Mode & scoring', units: 'Ground & ships', waves: 'Waves', obj: 'Objectives', trig: 'Triggers', marks: 'Markers', gates: 'Gates', brief: 'Briefing' };
export const TOOLS = { drag: 'Drag things around', unit: 'Place a ground unit / ship', marker: 'Place a map marker', gate: 'Add a time-trial gate', wave: 'Place a new wave', route: 'Add route points' };
const MARK_COL = { wp: '#ffe08a', target: '#ff6a5a', danger: '#ffa040', info: '#ffffff', home: '#7fc4ff' };

// ---------- small helpers ----------
const sideName = (s, k) => s.sides[k].name;
const sideOpts = (s, sel) => opt(0, sideName(s, 0), sel) + opt(1, sideName(s, 1), sel);
const num = (path, v, a = '') => `<input type="number" data-m="${path}" data-num value="${v}" ${a}>`;
const sel = (path, inner, rr = true) => `<select data-m="${path}" ${rr ? 'data-rr' : ''}>${inner}</select>`;
const del = (act, i, j) => `<button class="mini ghost" data-mact="${act}" data-i="${i}"${j != null ? ` data-j="${j}"` : ''} title="Remove">✕</button>`;
function unitLabel(s, j) {
  const u = s.units[j];
  return u ? `#${j + 1} ${u.name || UNITS[u.key].short} (${sideName(s, u.side)})` : `#${j + 1} (missing)`;
}
function unitOptions(selKey) {
  let h = '';
  for (const c of Object.keys(COUNTRIES)) {
    h += `<optgroup label="${esc(COUNTRIES[c].name)}">`;
    for (const k of Object.keys(UNITS)) if (UNITS[k].country === c) h += opt(k, UNITS[k].name, selKey);
    h += '</optgroup>';
  }
  h += '<optgroup label="Targets (any side)">';
  for (const k of Object.keys(UNITS)) if (!UNITS[k].country) h += opt(k, UNITS[k].name, selKey);
  return h + '</optgroup>';
}
function jetOpts(selJet, i) {
  let h = opt('random', 'Random (any country)', selJet);
  if (i > 0) h += opt('lead', 'Same as jet 1', selJet);
  for (const c of Object.keys(COUNTRIES)) {
    h += `<optgroup label="${esc(COUNTRIES[c].name)}">` + opt('c:' + c, `Random ${COUNTRIES[c].short} jet`, selJet);
    for (const k of JETS_OF(c)) h += opt(k, JETS[k].name, selJet);
    h += '</optgroup>';
  }
  return h;
}
function loadOpts(jet, cur) {
  const gen = { '': 'Default', dogfight: 'Dogfight', bvr: 'Long range', strike: 'Strike', sead: 'SEAD', bombs: 'Bombs', cas: 'Close support' };
  if (JETS[jet]) { const T = JETS[jet]; return opt('', 'Default', cur) + T.loadoutKeys.map((k) => opt(k, T.loadouts[k].name, cur)).join(''); }
  return Object.entries(gen).map(([k, v]) => opt(k, v + (k ? ' (if it has it)' : ''), cur)).join('');
}
const nextId = (arr) => arr.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
const waveOpts = (s, cur) => s.waves.length ? s.waves.map((w) => opt(w.id, `${w.name} (${sideName(s, w.side)})`, cur)).join('') : opt(0, '(no waves yet)', cur);
const objOpts = (s, cur) => s.objectives.length ? s.objectives.map((o, i) => opt(o.id, `${i + 1}. ${o.label || OBJ_KINDS[o.kind]}`, cur)).join('') : opt(0, '(no objectives yet)', cur);
const unitOpts = (s, cur) => s.units.length ? s.units.map((u, j) => opt(j, unitLabel(s, j), cur)).join('') : opt(0, '(no ground units yet)', cur);

// ---------- the form for one tab ----------
export function missionForm(s, tab, ui) {
  switch (tab) {
    case 'mode': return modeTab(s);
    case 'units': return unitsTab(s, ui);
    case 'waves': return wavesTab(s);
    case 'obj': return objTab(s);
    case 'trig': return trigTab(s);
    case 'marks': return marksTab(s);
    case 'gates': return gatesTab(s);
    case 'brief': return `<section><h3>Briefing</h3>
      <p class="dim small">Shown before the mission starts and on the pause screen. Describe the situation, the targets, the threats and any tips. Blank lines start new paragraphs.</p>
      <textarea class="brief" data-m="briefing" rows="16" maxlength="1500">${esc(s.briefing || '')}</textarea></section>`;
  }
  return '';
}

function modeTab(s) {
  const R = s.rules, S = s.survival;
  let h = `<section><h3>Mode</h3><div class="grid">
    <label>Game mode ${sel('mode', Object.entries(MODES).map(([k, v]) => opt(k, v, s.mode)).join(''))}</label>`;
  if (s.mode === 'battle') h += `<label>Win condition ${sel('rules.win', Object.entries(WIN_RULES).map(([k, v]) => opt(k, v, R.win)).join(''))}</label>`;
  if (s.mode === 'battle' && R.win === 'score') h += `<label>Score limit ${num('rules.scoreLimit', R.scoreLimit, 'min="1" max="999"')}</label>`;
  if (s.mode === 'training') h += `<label>Lesson ${sel('lesson', opt('', '(none: free flight)', s.lesson || '') + Object.entries(LESSONS).map(([k, L]) => opt(k, L.name, s.lesson || '')).join(''))}</label>`;
  h += `</div><p class="dim small">${{
    battle: R.win === 'objectives' ? 'The first side to complete all of its required objectives wins. A side also loses if every one of its aircraft and ground units is destroyed.' : R.win === 'score' ? 'Points come from kills, ground kills and objectives (see below). The first side to the limit wins; the time limit ends the round early and the higher score wins.' : 'Rounds end when one side has no aircraft left (or the time runs out). Win the set number of rounds to win the match.',
    survival: 'Endless waves of enemy aircraft attack, each bigger than the last. The mission ends when every friendly aircraft is down (with respawns off) or the unit you defend is destroyed.',
    race: 'Fly through the gates in order against the clock (set them up in the Gates tab). Only the human seats fly; AI slots are ignored.',
    training: 'A guided lesson with step-by-step prompts. The lesson sets its own targets.',
  }[s.mode]}</p></section>`;
  if (s.mode !== 'race') {
    h += `<section><h3>Scoring</h3><div class="grid">
      <label>Air kill ${num('rules.pts.air', R.pts.air, 'min="-9" max="99"')}</label>
      <label>Ground kill ${num('rules.pts.ground', R.pts.ground, 'min="-9" max="99"')}</label>
      <label>Being shot down ${num('rules.pts.death', R.pts.death, 'min="-9" max="99"')}</label>
      <label>Objective (default) ${num('rules.pts.obj', R.pts.obj, 'min="0" max="99"')}</label>
    </div>
    <div class="grid">
      <label class="chk"><input type="checkbox" data-m="rules.respawn" data-bool data-rr ${R.respawn ? 'checked' : ''}> Respawn shot-down jets</label>
      ${R.respawn ? `<label>Respawn delay (s) ${num('rules.respawnT', R.respawnT, 'min="2" max="60"')}</label>` : ''}
    </div>
    <p class="dim small">With respawn on, a jet that is shot down comes back after the delay (from a friendly carrier deck if there is one, otherwise at its side's start point). Points show on the scoreboard and decide <i>score</i> matches.</p></section>`;
  }
  if (s.mode === 'survival') {
    h += `<section><h3>Survival waves</h3><div class="grid">
      <label>First wave (jets) ${num('survival.start', S.start, 'min="1" max="8"')}</label>
      <label>Extra jets per wave ${num('survival.grow', S.grow, 'min="0" max="3" step="0.5"')}</label>
      <label>Waves to win (0 = endless) ${num('survival.max', S.max, 'min="0" max="99"')}</label>
      <label>Gap between waves (s) ${num('survival.gap', S.gap, 'min="5" max="120"')}</label>
      <label>Enemy nation ${sel('survival.country', opt('random', 'Random each wave', S.country) + Object.keys(COUNTRIES).map((c) => opt(c, COUNTRIES[c].name, S.country)).join(''), false)}</label>
      <label>Anti-ship strikers (%) <input type="number" data-m="survival.strike" data-num data-scale="0.01" min="0" max="100" value="${Math.round(S.strike * 100)}"></label>
      <label>Unit to defend ${sel('survival.defend', opt(-1, '(none)', S.defend) + s.units.map((u, j) => u.side === 0 ? opt(j, unitLabel(s, j), S.defend) : '').join(''), false).replace('<select', '<select data-num')}</label>
    </div><p class="dim small">Waves spawn at the enemy side's start point. Strikers go for your ground units and ships with anti-ship missiles; if the defended unit is sunk, the mission is lost. Put a friendly carrier in the Ground &amp; ships tab so you can land on it to rearm.</p></section>`;
  }
  return h;
}

function unitsTab(s, ui) {
  let h = `<section><h3>Ground units and ships <span class="dim small">${s.units.length}/${MAX_UNITS}</span></h3>`;
  if (s.units.length) {
    h += `<table class="slots"><tr><th>#</th><th>Type</th><th>Side</th><th>Name</th><th>Heading°</th><th>Radar</th><th>Route</th><th></th></tr>`;
    s.units.forEach((u, j) => {
      const D = UNITS[u.key], p = `units.${j}`, rn = u.route ? u.route.length : 0;
      const drawing = ui.tool === 'route' && ui.owner === 'u:' + j;
      h += `<tr><td>${j + 1}</td>
        <td>${sel(p + '.key', unitOptions(u.key))}</td>
        <td><select data-m="${p}.side" data-num data-rr>${sideOpts(s, u.side)}</select></td>
        <td><input data-m="${p}.name" maxlength="24" value="${esc(u.name)}" placeholder="${esc(D.short)}"></td>
        <td>${num(p + '.hdg', Math.round(u.hdg), 'min="0" max="359" style="width:64px"')}</td>
        <td>${D.radar ? sel(p + '.emcon', opt('on', 'Always on', u.emcon) + opt('ambush', 'Silent until cued', u.emcon), false) : '<span class="dim">—</span>'}</td>
        <td>${D.cat === 'sam' && !D.speed && !D.ship && D.mesh === 'site' ? '<span class="dim">fixed</span>' : `<button class="mini${drawing ? ' on' : ''}" data-mact="routeUnit" data-i="${j}">${drawing ? 'Drawing…' : rn ? `${rn} pts` : 'Draw'}</button>${rn ? ' ' + del('clearRouteU', j) : ''}`}</td>
        <td>${del('delUnit', j)}</td></tr>`;
    });
    h += '</table>';
  } else h += '<p class="dim">No ground units yet.</p>';
  h += `<div class="brow">
    <select data-ui="unitKey">${unitOptions(ui.unitKey)}</select>
    <select data-ui="unitSide">${sideOpts(s, ui.unitSide)}</select>
    <button class="mini${ui.tool === 'unit' ? ' on' : ''}" data-mact="toolUnit" ${s.units.length >= MAX_UNITS ? 'disabled' : ''}>Place on map</button>
    <button class="mini" data-mact="addUnit" ${s.units.length >= MAX_UNITS ? 'disabled' : ''}>+ Add at side start</button>
  </div>
  <p class="dim small">Pick a type and side, press <b>Place on map</b>, then click the map (each click adds one). Drag units to move them; right-click one to delete it. Vehicles and ships with a route drive along it (vehicles stop at the end, ships loop). SAM radars <i>silent until cued</i> stay dark until an early-warning radar or a trigger wakes them. Ships belong on water; carriers let friendly jets land, rearm and relaunch.</p></section>`;
  return h;
}

function wavesTab(s) {
  let h = `<section><h3>Waves and reinforcements <span class="dim small">${s.waves.length}/${MAX_WAVES}</span></h3>
    <p class="dim small">A wave is a flight of AI jets that joins the fight later: after a time, or when a trigger sends it in (see Triggers). Drag the ▲ on the map to set where it appears.</p></section>`;
  s.waves.forEach((w, i) => {
    const p = `waves.${i}`;
    h += `<section class="bside" style="--side:${SIDE_COLORS[w.side]}"><div class="bside-head">
      <input class="sname" data-m="${p}.name" maxlength="24" value="${esc(w.name)}"> <span class="dim small">wave id ${w.id}</span>
      <span style="flex:1"></span>${del('delWave', i)}</div>
      <div class="grid">
        <label>Side <select data-m="${p}.side" data-num data-rr>${sideOpts(s, w.side)}</select></label>
        <label>Arrives ${sel(p + '.when', opt('time', 'After a time', w.when) + opt('trigger', 'When a trigger fires', w.when))}</label>
        ${w.when === 'time' ? `<label>Time (s) ${num(p + '.t', Math.round(w.t), 'min="0" max="3600"')}</label>` : ''}
        <label>Altitude (m) ${num(p + '.alt', Math.round(w.alt), 'min="300" max="12000" step="100"')}</label>
        <label>Speed (km/h) <input type="number" data-m="${p}.spd" data-num data-scale="${1 / 3.6}" min="430" max="1440" step="10" value="${Math.round(w.spd * 3.6)}"></label>
        <label>Formation ${sel(p + '.form', Object.entries(FORMATIONS).map(([f, n]) => opt(f, n, w.form)).join(''), false)}</label>
        <label>Heading (°) <span class="hdg"><input type="number" data-m="${p}.hdg" data-num min="0" max="359" value="${w.hdg == null ? '' : Math.round(w.hdg)}" ${w.hdg == null ? 'disabled' : ''}><label class="chk"><input type="checkbox" data-m="${p}.hdgAuto" data-bool data-rr ${w.hdg == null ? 'checked' : ''}> auto</label></span></label>
      </div>
      <table class="slots"><tr><th>#</th><th>Aircraft</th><th>Loadout</th><th>Experience</th><th>Orders</th><th></th></tr>`;
    w.slots.forEach((q, j) => {
      const sp = `${p}.slots.${j}`, ord = q.ai ? q.ai.ord : 'engage';
      h += `<tr><td>${j + 1}</td><td>${sel(sp + '.jet', jetOpts(q.jet, j))}</td><td>${sel(sp + '.loadout', loadOpts(q.jet, q.loadout), false)}</td>
        <td>${sel(sp + '.skill', Object.entries(SKILL_LABELS).map(([k, n]) => opt(k, n, q.skill)).join(''), false)}</td>
        <td>${sel(sp + '.ai.ord', Object.entries(ORDERS).filter(([k]) => k !== 'route').map(([k, v]) => opt(k, v.name, ord)).join(''), false)}</td>
        <td>${w.slots.length > 1 ? del('delWaveSlot', i, j) : ''}</td></tr>`;
    });
    h += `</table><div class="brow"><button class="mini" data-mact="addWaveSlot" data-i="${i}" ${w.slots.length >= MAX_PER_SIDE ? 'disabled' : ''}>+ Jet</button></div></section>`;
  });
  h += `<div class="brow"><button class="mini" data-mact="addWave" ${s.waves.length >= MAX_WAVES ? 'disabled' : ''}>+ New wave</button></div>`;
  return h;
}

function objTab(s) {
  let h = `<section><h3>Objectives <span class="dim small">${s.objectives.length}/${MAX_OBJ}</span></h3>
    <p class="dim small">Objectives show on the HUD. With the <i>Complete the objectives</i> win condition (Mode tab), a side wins once all its required (non-optional) objectives are done; a failed required objective loses. Each completed objective is worth its points.</p></section>`;
  s.objectives.forEach((o, i) => {
    const p = `objectives.${i}`;
    h += `<section class="bside" style="--side:${SIDE_COLORS[o.side]}"><div class="bside-head">
      <b>${i + 1}.</b> <input data-m="${p}.label" maxlength="60" value="${esc(o.label)}" placeholder="Label on the HUD (optional)" style="flex:1">
      ${del('delObj', i)}</div>
      <div class="grid">
        <label>For <select data-m="${p}.side" data-num data-rr>${sideOpts(s, o.side)}</select></label>
        <label>Goal ${sel(p + '.kind', Object.entries(OBJ_KINDS).map(([k, v]) => opt(k, v, o.kind)).join(''))}</label>
        <label>Points ${num(p + '.pts', o.pts, 'min="0" max="99"')}</label>
        ${o.kind === 'kills' ? `<label>Kills needed ${num(p + '.n', o.n, 'min="1" max="99"')}</label>` : ''}
        ${o.kind === 'survive' ? `<label>Hold out (s) ${num(p + '.t', Math.round(o.t), 'min="10" max="3600"')}</label>` : ''}
        ${o.kind === 'reach' ? `<label>Zone radius (m) ${num(p + '.r', Math.round(o.r), 'min="300" max="15000" step="100"')}</label>` : ''}
        <label class="chk"><input type="checkbox" data-m="${p}.optional" data-bool ${o.optional ? 'checked' : ''}> Optional (bonus)</label>
      </div>`;
    if (o.kind === 'destroy' || o.kind === 'defend') {
      const want = o.kind === 'destroy' ? 1 - o.side : o.side;
      const list = s.units.map((u, j) => (u.side === want ? j : -1)).filter((j) => j >= 0);
      h += `<div class="ulist">${list.length ? list.map((j) => `<label class="chk"><input type="checkbox" data-mlist="${p}.units" data-v="${j}" ${o.units.includes(j) ? 'checked' : ''}> ${esc(unitLabel(s, j))}</label>`).join('') : `<span class="dim small">No ${esc(sideName(s, want))} ground units yet: add them in the Ground &amp; ships tab.</span>`}</div>
        <p class="dim small">${o.kind === 'destroy' ? 'Tick the units to destroy (none ticked = every enemy ground unit).' : 'Tick the units to protect. The objective fails if any of them is destroyed; it completes when the round ends with them alive.'}</p>`;
    }
    if (o.kind === 'reach') h += `<p class="dim small">Drag the green zone on the map. Ground units of this side driving a route also count.</p>`;
    h += '</section>';
  });
  h += `<div class="brow"><button class="mini" data-mact="addObj" ${s.objectives.length >= MAX_OBJ ? 'disabled' : ''}>+ New objective</button></div>`;
  return h;
}

function trigTab(s) {
  let h = `<section><h3>Triggers <span class="dim small">${s.triggers.length}/${MAX_TRIG}</span></h3>
    <p class="dim small">A trigger fires once, when its condition first becomes true, and does one thing: send in a wave, put a message on the radio, complete or fail an objective, end the mission, or wake up silent SAM radars.</p></section>`;
  s.triggers.forEach((t, i) => {
    const p = `triggers.${i}`;
    h += `<section><div class="bside-head"><b>${i + 1}.</b><span style="flex:1"></span>${del('delTrig', i)}</div><div class="grid">
      <label>When ${sel(p + '.when', Object.entries(TRIG_WHEN).map(([k, v]) => opt(k, v, t.when)).join(''))}</label>`;
    if (t.when === 'time') h += `<label>Time (s) ${num(p + '.t', Math.round(t.t), 'min="0" max="3600"')}</label>`;
    if (t.when === 'enter' || t.when === 'kills') h += `<label>${t.when === 'enter' ? 'Aircraft of' : 'Side'} <select data-m="${p}.side" data-num>${sideOpts(s, t.side)}</select></label>`;
    if (t.when === 'enter') h += `<label>Zone radius (m) ${num(p + '.r', Math.round(t.r), 'min="300" max="15000" step="100"')}</label>`;
    if (t.when === 'kills') h += `<label>Kills ${num(p + '.n', t.n, 'min="1" max="99"')}</label>`;
    if (t.when === 'unitDead') h += `<label>Unit ${sel(p + '.unit', unitOpts(s, t.unit), false).replace('<select', '<select data-num')}</label>`;
    if (t.when === 'waveDead') h += `<label>Wave ${sel(p + '.wave', waveOpts(s, t.wave), false).replace('<select', '<select data-num')}</label>`;
    if (t.when === 'objective') h += `<label>Objective ${sel(p + '.obj', objOpts(s, t.obj), false).replace('<select', '<select data-num')}</label>`;
    h += `<label>Do ${sel(p + '.do', Object.entries(TRIG_DO).map(([k, v]) => opt(k, v, t.do)).join(''))}</label>`;
    if (t.do === 'spawn') h += `<label>Wave ${sel(p + '.target', waveOpts(s, t.target), false).replace('<select', '<select data-num')}</label>`;
    if (t.do === 'complete' || t.do === 'fail') h += `<label>Objective ${sel(p + '.target', objOpts(s, t.target), false).replace('<select', '<select data-num')}</label>`;
    if (t.do === 'win') h += `<label>Winner <select data-m="${p}.winSide" data-num>${sideOpts(s, t.winSide)}</select></label>`;
    h += '</div>';
    if (t.do === 'message' || t.do === 'win') h += `<label class="wide">${t.do === 'win' ? 'Reason (shown at the end)' : 'Message'} <input data-m="${p}.text" maxlength="120" value="${esc(t.text)}"></label>`;
    if (t.when === 'enter') h += `<p class="dim small">Drag the purple zone on the map.</p>`;
    h += '</section>';
  });
  h += `<div class="brow"><button class="mini" data-mact="addTrig" ${s.triggers.length >= MAX_TRIG ? 'disabled' : ''}>+ New trigger</button></div>`;
  return h;
}

function marksTab(s) {
  let h = `<section><h3>Map markers <span class="dim small">${s.markers.length}/${MAX_MARK}</span></h3>
    <p class="dim small">Markers show in the 3D world as coloured beams with a label, on the HUD, and on the after-action map. Use <b>Place on map</b> and click; drag to move, right-click to delete.</p>`;
  if (s.markers.length) {
    h += `<table class="slots"><tr><th>#</th><th>Label</th><th>Icon</th><th>Position</th><th></th></tr>`;
    s.markers.forEach((m, i) => {
      h += `<tr><td>${i + 1}</td><td><input data-m="markers.${i}.label" maxlength="24" value="${esc(m.label)}"></td>
        <td>${sel(`markers.${i}.icon`, Object.entries(MARKER_ICONS).map(([k, v]) => opt(k, v, m.icon)).join(''))}</td>
        <td class="dim">${(m.x / 1000).toFixed(1)}, ${(m.z / 1000).toFixed(1)} km</td><td>${del('delMark', i)}</td></tr>`;
    });
    h += '</table>';
  }
  h += `<div class="brow"><button class="mini" data-mact="toolMarker" ${s.markers.length >= MAX_MARK ? 'disabled' : ''}>Place on map</button></div></section>`;
  return h;
}

function gatesTab(s) {
  let h = `<section><h3>Time-trial gates <span class="dim small">${s.gates.length}/${MAX_GATES}</span></h3>
    <div class="grid">
      <label>Laps ${num('laps', s.laps, 'min="1" max="9"')}</label>
      <label>Altitude ceiling (m above ground, 0 = none) ${num('ceiling', Math.round(s.ceiling), 'min="0" max="3000" step="10"')}</label>
    </div>
    <p class="dim small">Used when the mode is <i>Time trial</i>. Gates are flown in order; the player starts at Blue's start point. Press <b>Add gates</b> and click the map: each gate is placed 150 m above the ground there. Drag to move, right-click to delete. Flying above the ceiling for more than a second adds penalty time.</p>`;
  if (s.gates.length) {
    h += `<table class="slots"><tr><th>#</th><th>Altitude (m)</th><th>Radius (m)</th><th>Position</th><th></th></tr>`;
    s.gates.forEach((g, i) => {
      h += `<tr><td>${i + 1}</td><td>${num(`gates.${i}.1`, Math.round(g[1]), 'min="30" max="12000" step="10"')}</td><td>${num(`gates.${i}.3`, Math.round(g[3]), 'min="40" max="600" step="10"')}</td>
        <td class="dim">${(g[0] / 1000).toFixed(1)}, ${(g[2] / 1000).toFixed(1)} km</td><td>${del('delGate', i)}</td></tr>`;
    });
    h += '</table>';
  }
  h += `<div class="brow"><button class="mini" data-mact="toolGate" ${s.gates.length >= MAX_GATES ? 'disabled' : ''}>Add gates on the map</button>
    <button class="mini ghost" data-mact="revGates" ${s.gates.length < 2 ? 'disabled' : ''}>Reverse order</button>
    <button class="mini ghost" data-mact="clearGates" ${!s.gates.length ? 'disabled' : ''}>Remove all</button></div></section>`;
  return h;
}

// ---------- editing ----------
// Set a value by dotted path ("waves.0.slots.1.jet"). Returns true if the form should be redrawn.
export function setField(s, t) {
  const path = t.dataset.m.split('.');
  let v = t.dataset.bool != null ? t.checked : t.value;
  if (t.dataset.num != null) {
    if (t.value === '') return false;
    v = +t.value * (t.dataset.scale ? +t.dataset.scale : 1);
  }
  const last = path.pop();
  let o = s;
  for (const k of path) {
    if (k === 'ai' && !o.ai) o.ai = aiConfig(o);
    o = o[k];
    if (o == null) return false;
  }
  if (last === 'hdgAuto') { o.hdg = v ? null : 0; return true; }
  if (last === 'lesson') { o.lesson = v; if (!v) delete o.lesson; return true; }
  if (last === 'ord' && o.ord !== v) { o.ord = v; return false; }
  o[last] = v;
  if (last === 'jet' && JETS[v] && o.loadout && !JETS[v].loadouts[o.loadout]) o.loadout = '';
  if (last === 'skill' && o.ai) o.ai = { ...aiConfig({ skill: v }), ord: o.ai.ord };
  if (path[0] === 'objectives' && (last === 'side' || last === 'kind')) o.units = [];
  return t.dataset.rr != null;
}
export function toggleList(s, t) {
  const path = t.dataset.mlist.split('.');
  let o = s;
  for (const k of path.slice(0, -1)) o = o[k];
  const arr = o[path[path.length - 1]], v = +t.dataset.v, at = arr.indexOf(v);
  if (t.checked && at < 0) arr.push(v);
  if (!t.checked && at >= 0) arr.splice(at, 1);
}

export function removeUnit(s, j) {
  s.units.splice(j, 1);
  const fix = (x) => (x > j ? x - 1 : x);
  for (const o of s.objectives) o.units = o.units.filter((x) => x !== j).map(fix);
  for (const t of s.triggers) t.unit = t.unit === j ? 0 : fix(t.unit);
  if (s.survival.defend === j) s.survival.defend = -1; else s.survival.defend = fix(s.survival.defend);
}

function newUnit(s, key, side, x, z) {
  if (s.units.length >= MAX_UNITS) return null;
  const u = { key, side, x: Math.round(x), z: Math.round(z), hdg: side === 0 ? 0 : 180, name: '', emcon: 'on' };
  s.units.push(u);
  return u;
}
function newWave(s, x, z) {
  const side = 1, sd = s.sides[side];
  s.waves.push({ id: nextId(s.waves), name: `Wave ${s.waves.length + 1}`, side, x: x ?? sd.x, z: z ?? sd.z, alt: sd.alt, spd: sd.spd, hdg: null, form: 'line', spacing: 1200, when: 'time', t: 120,
    slots: [slot('ai', 'random', 'pilot'), slot('ai', 'lead', 'pilot')] });
}

// A button inside the mission form. ui is the builder's map-tool state. Returns true to redraw.
export function action(s, b, ui) {
  const i = +b.dataset.i, j = +b.dataset.j;
  switch (b.dataset.mact) {
    case 'toolUnit': ui.tool = ui.tool === 'unit' ? 'drag' : 'unit'; break;
    case 'toolMarker': ui.tool = 'marker'; break;
    case 'toolGate': ui.tool = 'gate'; break;
    case 'addUnit': { const sd = s.sides[ui.unitSide]; newUnit(s, ui.unitKey, ui.unitSide, sd.x + (Math.random() - 0.5) * 3000, sd.z + (Math.random() - 0.5) * 3000); break; }
    case 'delUnit': removeUnit(s, i); if (ui.owner === 'u:' + i) { ui.tool = 'drag'; ui.owner = null; } break;
    case 'routeUnit': if (ui.tool === 'route' && ui.owner === 'u:' + i) { ui.tool = 'drag'; ui.owner = null; } else { ui.tool = 'route'; ui.owner = 'u:' + i; } break;
    case 'clearRouteU': delete s.units[i].route; break;
    case 'routeSlot': { const o = `s:${b.dataset.side}:${b.dataset.slot}`; if (ui.tool === 'route' && ui.owner === o) { ui.tool = 'drag'; ui.owner = null; } else { ui.tool = 'route'; ui.owner = o; } break; }
    case 'clearRouteS': delete s.sides[+b.dataset.side].slots[+b.dataset.slot].route; break;
    case 'addWave': newWave(s); break;
    case 'delWave': s.waves.splice(i, 1); break;
    case 'addWaveSlot': s.waves[i].slots.push(slot('ai', 'lead', s.waves[i].slots[0].skill)); break;
    case 'delWaveSlot': s.waves[i].slots.splice(j, 1); break;
    case 'addObj': s.objectives.push({ id: nextId(s.objectives), side: 0, kind: s.units.some((u) => u.side === 1) ? 'destroy' : 'eliminate', label: '', units: [], n: 4, t: 300, x: 0, z: 0, r: 2500, optional: false, pts: s.rules.pts.obj }); break;
    case 'delObj': s.objectives.splice(i, 1); break;
    case 'addTrig': s.triggers.push({ id: s.triggers.length + 1, when: 'time', t: 60, side: 0, x: 0, z: 0, r: 3000, unit: 0, wave: s.waves[0] ? s.waves[0].id : 1, obj: s.objectives[0] ? s.objectives[0].id : 1, n: 3, do: 'message', text: '', target: 1, winSide: 0 }); break;
    case 'delTrig': s.triggers.splice(i, 1); break;
    case 'delMark': s.markers.splice(i, 1); break;
    case 'delGate': s.gates.splice(i, 1); break;
    case 'revGates': s.gates.reverse(); break;
    case 'clearGates': s.gates.length = 0; break;
    default: return false;
  }
  return true;
}

// ---------- the map ----------
function routeOf(s, owner) {
  if (!owner) return null;
  const p = owner.split(':');
  if (p[0] === 'u') { const u = s.units[+p[1]]; return u ? { list: u.route || (u.route = []), alt: false, from: u } : null; }
  const q = s.sides[+p[1]] && s.sides[+p[1]].slots[+p[2]];
  return q ? { list: q.route || (q.route = []), alt: s.sides[+p[1]].alt, from: s.sides[+p[1]] } : null;
}
export function ownerName(s, owner) {
  const p = (owner || '').split(':');
  if (p[0] === 'u') return unitLabel(s, +p[1]);
  if (p[0] === 's') return `${sideName(s, +p[1])} jet ${+p[2] + 1}`;
  return '';
}

// A click on empty map with a placing tool. heightAt(x, z) samples the terrain preview.
export function place(s, ui, x, z, heightAt) {
  const lim = ARENA_RADIUS - 500, d = Math.hypot(x, z);
  if (d > lim) { x *= lim / d; z *= lim / d; }
  x = Math.round(x / 50) * 50; z = Math.round(z / 50) * 50;
  switch (ui.tool) {
    case 'unit': return !!newUnit(s, ui.unitKey, ui.unitSide, x, z);
    case 'marker': if (s.markers.length < MAX_MARK) { s.markers.push({ x, z, label: `Mark ${s.markers.length + 1}`, icon: 'wp' }); return true; } return false;
    case 'gate': if (s.gates.length < MAX_GATES) { s.gates.push([x, Math.round(Math.max(0, heightAt(x, z)) + 150), z, 120]); return true; } return false;
    case 'wave': if (s.waves.length < MAX_WAVES) { newWave(s, x, z); ui.tool = 'drag'; return true; } return false;
    case 'route': {
      const r = routeOf(s, ui.owner);
      if (!r || r.list.length >= 12) return false;
      r.list.push(r.alt ? [x, z, r.alt] : [x, z]);
      return true;
    }
  }
  return false;
}

// Everything draggable on the map, topmost first.
export function handles(s, ui) {
  const H = [];
  const add = (kind, get, set, delFn, r = 9) => H.push({ kind, get, set, del: delFn, r });
  s.units.forEach((u, j) => {
    (u.route || []).forEach((p, n) => add('rpt', () => [p[0], p[1]], (x, z) => { p[0] = x; p[1] = z; }, () => u.route.splice(n, 1), 7));
  });
  s.sides.forEach((sd) => sd.slots.forEach((q) => (q.route || []).forEach((p, n) => add('rpt', () => [p[0], p[1]], (x, z) => { p[0] = x; p[1] = z; }, () => q.route.splice(n, 1), 7))));
  s.markers.forEach((m, i) => add('mark', () => [m.x, m.z], (x, z) => { m.x = x; m.z = z; }, () => s.markers.splice(i, 1)));
  s.units.forEach((u, j) => add('unit', () => [u.x, u.z], (x, z) => { u.x = x; u.z = z; }, () => removeUnit(s, j)));
  if (s.mode === 'race' || s.gates.length) s.gates.forEach((g, i) => add('gate', () => [g[0], g[2]], (x, z) => { g[0] = x; g[2] = z; }, () => s.gates.splice(i, 1), 10));
  s.waves.forEach((w, i) => add('wave', () => [w.x, w.z], (x, z) => { w.x = x; w.z = z; }, () => s.waves.splice(i, 1), 11));
  s.objectives.forEach((o) => { if (o.kind === 'reach') add('zone', () => [o.x, o.z], (x, z) => { o.x = x; o.z = z; }, null, 12); });
  s.triggers.forEach((t) => { if (t.when === 'enter') add('zone', () => [t.x, t.z], (x, z) => { t.x = x; t.z = z; }, null, 12); });
  return H;
}

export function drawMission(ctx, s, toPx, scale, ui) {
  const lbl = (text, x, y, col, al = 'center') => {
    ctx.textAlign = al; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(text, x, y); ctx.fillStyle = col; ctx.fillText(text, x, y);
  };
  ctx.font = '600 10.5px system-ui, sans-serif';
  // zones
  const zone = (x, z, r, col, text) => {
    const [px, py] = toPx(x, z);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = col; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(px, py, Math.max(6, r * scale), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    lbl(text, px, py - Math.max(6, r * scale) - 4, col);
  };
  s.objectives.forEach((o, i) => { if (o.kind === 'reach') zone(o.x, o.z, o.r, '#7dffa0', `Obj ${i + 1}`); });
  s.triggers.forEach((t, i) => { if (t.when === 'enter') zone(t.x, t.z, t.r, '#d08cff', `Trigger ${i + 1}`); });
  // SAM coverage
  for (const u of s.units) {
    const D = UNITS[u.key];
    if (D.cat !== 'sam' && !D.ship) continue;
    const R = D.radar ? D.radar.range : D.optical || 0;
    if (!R) continue;
    const [px, py] = toPx(u.x, u.z);
    ctx.strokeStyle = u.side === 0 ? 'rgba(110,170,255,0.35)' : 'rgba(255,110,90,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, py, R * scale, 0, Math.PI * 2); ctx.stroke();
  }
  // routes
  const route = (pts, from, col, active, loop) => {
    if (!pts || !pts.length) return;
    const [sx, sy] = toPx(from.x, from.z);
    ctx.strokeStyle = col; ctx.lineWidth = active ? 2 : 1.3; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(sx, sy);
    for (const p of pts) { const [x, y] = toPx(p[0], p[1]); ctx.lineTo(x, y); }
    if (loop) { const [x, y] = toPx(pts[0][0], pts[0][1]); ctx.lineTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
    pts.forEach((p, n) => { const [x, y] = toPx(p[0], p[1]); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, active ? 4.5 : 3.2, 0, Math.PI * 2); ctx.fill(); if (active) lbl(String(n + 1), x, y - 7, '#fff'); });
  };
  s.units.forEach((u, j) => route(u.route, u, u.side === 0 ? '#9cc8ff' : '#ffa898', ui.owner === 'u:' + j, !!UNITS[u.key].ship));
  s.sides.forEach((sd, k) => sd.slots.forEach((q, i) => route(q.route, sd, SIDE_COLORS[k], ui.owner === `s:${k}:${i}`, true)));
  // gates
  if (s.mode === 'race' || s.gates.length) {
    ctx.strokeStyle = 'rgba(120,255,160,0.6)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    s.gates.forEach((g, i) => { const [x, y] = toPx(g[0], g[2]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    if (s.laps > 1 && s.gates.length > 2) { const [x, y] = toPx(s.gates[0][0], s.gates[0][2]); ctx.lineTo(x, y); }
    ctx.stroke();
    s.gates.forEach((g, i) => {
      const [x, y] = toPx(g[0], g[2]);
      ctx.strokeStyle = i === 0 ? '#ffffff' : '#78ffa0'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
      lbl(String(i + 1), x, y + 3.5, '#fff');
    });
  }
  // units
  s.units.forEach((u, j) => {
    const D = UNITS[u.key], [x, y] = toPx(u.x, u.z), col = u.side === 0 ? '#7fb4ff' : '#ff7a6a';
    ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (D.ship) { const a = (u.hdg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a); ctx.moveTo(x + sn * 9, y - c * 9); ctx.lineTo(x + c * 4 - sn * 7, y + sn * 4 + c * 7); ctx.lineTo(x - c * 4 - sn * 7, y - sn * 4 + c * 7); ctx.closePath(); }
    else if (D.cat === 'sam') { ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.closePath(); }
    else if (D.cat === 'aaa') ctx.arc(x, y, 5, 0, Math.PI * 2);
    else ctx.rect(x - 4.5, y - 4.5, 9, 9);
    ctx.fill(); ctx.stroke();
    lbl(u.name || D.short, x, y + 16, col);
  });
  // waves
  s.waves.forEach((w) => {
    const [x, y] = toPx(w.x, w.z), col = SIDE_COLORS[w.side];
    ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x - 7, y + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    lbl(`${w.name} (${w.slots.length})${w.when === 'time' ? ` +${Math.round(w.t)}s` : ''}`, x, y + 18, col);
  });
  // markers
  s.markers.forEach((m) => {
    const [x, y] = toPx(m.x, m.z), col = MARK_COL[m.icon] || '#fff';
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 14); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - 14); ctx.lineTo(x + 9, y - 11); ctx.lineTo(x, y - 8); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    lbl(m.label, x + 3, y - 17, col, 'left');
  });
}
