// Scenario builder: a full-screen editor with a top-down map (drag the start points and headings)
// and forms for the rules, both sides and every aircraft slot.
import { MAPS, TIMES, WEATHER, ARENA_RADIUS, previewHeights } from './world.js';
import { JETS, JETS_OF, COUNTRIES } from './aircraft.js';
import { PRESETS, MAX_PER_SIDE, SKILL_LABELS, FORMATIONS, SIDE_COLORS, sanitize, summary, sideHeading, spawnPoints, countSeats, slot, blankScenario } from './scenario.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(label)}</option>`;
const VIEW = 34000; // half-width of the map view (m)
const LOADOUT_NAMES = { '': 'Default', dogfight: 'Dogfight (if the jet has it)', bvr: 'Long range (if the jet has it)' };

const mapCache = {};
function mapImage(key) {
  if (mapCache[key]) return mapCache[key];
  const P = previewHeights(key, 200), n = P.n, pal = MAPS[key].pal;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d'), img = ctx.createImageData(n, n);
  const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  const C = { deep: rgb(pal.deep), shallow: rgb(pal.shallow), sand: rgb(pal.sand), grass: rgb(pal.grass), forest: rgb(pal.grass).map((v) => v * 0.55), rock: rgb(pal.rock), snow: rgb(pal.snow) };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const cell = P.size / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const h = P.h[i * (n + 1) + j];
    let col;
    if (h <= 0) col = mix(C.shallow, C.deep, Math.min(1, -h / 60));
    else {
      const hx = P.h[i * (n + 1) + j + 1] - h, hz = P.h[(i + 1) * (n + 1) + j] - h;
      const slope = Math.hypot(hx, hz) / cell;
      col = h < pal.sandH ? C.sand : h > pal.snowH ? C.snow : h > pal.rockH || slope > pal.rockSlope * 2 ? C.rock : h > pal.treeH * 0.6 ? mix(C.grass, C.forest, 0.6) : C.grass;
      const shade = 1 + ((-hx - hz) / cell) * 1.1;            // light from the north-west
      col = col.map((v) => v * Math.max(0.6, Math.min(1.12, shade)));
    }
    const o = (i * n + j) * 4;
    img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (mapCache[key] = { canvas: c, size: P.size });
}

function jetOptions(sel, human, i) {
  let h = '';
  if (human) h += opt('choice', "Pilot's choice", sel);
  h += opt('random', 'Random (any country)', sel);
  if (i > 0) h += opt('lead', 'Same as slot 1', sel);
  for (const c of Object.keys(COUNTRIES)) {
    h += `<optgroup label="${esc(COUNTRIES[c].name)}">` + opt('c:' + c, `Random ${COUNTRIES[c].short} jet`, sel);
    for (const k of JETS_OF(c)) h += opt(k, JETS[k].name, sel);
    h += '</optgroup>';
  }
  return h;
}
function loadoutOptions(jet, sel) {
  if (JETS[jet]) {
    const T = JETS[jet];
    return opt('', `Default (${T.loadouts[T.loadoutKeys[0]].name})`, sel) + T.loadoutKeys.map((k) => opt(k, T.loadouts[k].name, sel)).join('');
  }
  return Object.entries(LOADOUT_NAMES).map(([k, v]) => opt(k, v, sel)).join('');
}

export class Builder {
  constructor(root, hooks) {
    this.root = root; this.hooks = hooks;
    this.s = null; this.opts = {}; this.drag = null;
    root.innerHTML = `
      <div class="bwrap">
        <div class="bhead">
          <h2>Scenario builder</h2>
          <div class="bsum" id="bSummary"></div>
          <button id="bClose" class="ghost">✕ Close</button>
        </div>
        <div class="bbody">
          <div class="bleft">
            <canvas id="bMap"></canvas>
            <p class="dim small">Drag a circle to move a side's start point. Drag the arrow tip to aim it (or tick <i>auto</i> to face the enemy). Dots show each jet in formation; the dashed ring is the edge of the battle area.</p>
            <div class="bshare">
              <h3>Share</h3>
              <div class="brow"><button id="bCopyCode">Copy code</button><button id="bCopyLink">Copy link</button></div>
              <textarea id="bCode" rows="3" placeholder="Paste a scenario code or link here to load it" spellcheck="false"></textarea>
              <div class="brow"><button id="bImport">Load pasted code</button><button id="bNew" class="ghost">New blank</button></div>
              <div id="bShareMsg" class="dim small"></div>
            </div>
          </div>
          <div class="bright" id="bForm"></div>
        </div>
        <div class="bfoot">
          <span id="bWarn" class="small"></span>
          <button id="bDelete" class="ghost danger">Delete</button>
          <button id="bSave">Save</button>
          <button id="bPlay" class="primary">Fly vs AI</button>
          <button id="bHost">Host online room</button>
          <button id="bUse" class="primary">Use in room</button>
        </div>
      </div>`;
    const $ = (id) => root.querySelector('#' + id);
    this.$ = $;
    this.cv = $('bMap');
    this.form = $('bForm');
    $('bClose').onclick = () => this.close();
    $('bSave').onclick = () => this.save();
    $('bDelete').onclick = () => {
      if (!confirm(`Delete "${this.s.name}" from this browser?`)) return;
      this.hooks.remove(this.s.id); this.close();
    };
    $('bPlay').onclick = () => { const s = this.save(true); this.hide(); this.hooks.play(s); };
    $('bHost').onclick = () => { const s = this.save(true); this.hide(); this.hooks.host(s); };
    $('bUse').onclick = () => { const s = this.save(true); this.hooks.useInRoom(s); this.close(); };
    $('bCopyCode').onclick = () => this.share(false);
    $('bCopyLink').onclick = () => this.share(true);
    $('bImport').onclick = async () => {
      const s = await this.hooks.decode($('bCode').value);
      if (!s) { this.note('That code could not be read. Copy the whole code or link and try again.'); return; }
      s.id = 'u' + Math.random().toString(36).slice(2, 8);
      this.load(s); this.note(`Loaded "${s.name}". Press Save to keep it.`);
    };
    $('bNew').onclick = () => { this.load(blankScenario()); this.note('New scenario. Press Save to keep it.'); };
    this.form.addEventListener('input', (e) => this.onField(e, false));
    this.form.addEventListener('change', (e) => this.onField(e, true));
    this.form.addEventListener('click', (e) => this.onClick(e));
    this.cv.addEventListener('pointerdown', (e) => this.onDown(e));
    this.cv.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', () => { this.drag = null; });
    window.addEventListener('resize', () => { if (this.s) this.drawMap(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('show')) this.close(); });
  }

  open(s, opts = {}) {
    this.opts = opts;
    for (const el of document.querySelectorAll('.screen')) el.classList.toggle('show', el === this.root);
    document.body.classList.add('in-menu');
    this.load(JSON.parse(JSON.stringify(s)));
    this.$('bCode').value = '';
    this.note(opts.imported ? 'Loaded a shared scenario. Press Save to keep it, or fly it straight away.' : '');
  }
  hide() { this.root.classList.remove('show'); }
  close() { this.hide(); this.hooks.close(); }
  note(t) { this.$('bShareMsg').textContent = t; }

  load(s) {
    this.s = sanitize(s);
    this.builtIn = PRESETS.some((p) => p.id === this.s.id);
    this.renderForm();
    this.refresh();
  }

  save(silent) {
    const saved = this.hooks.save(this.s);
    this.s.id = saved.id; this.builtIn = false;
    this.refresh();
    if (!silent) this.note(`Saved "${saved.name}" in this browser.`);
    return saved;
  }

  async share(link) {
    const code = await this.hooks.encode(this.s);
    const text = link ? `${location.origin}${location.pathname}?s=${code}` : code;
    this.$('bCode').value = text;
    try { await navigator.clipboard.writeText(text); this.note(link ? 'Link copied. Anyone who opens it gets this scenario.' : 'Code copied. Paste it into the builder to load it.'); }
    catch { this.$('bCode').select(); this.note('Select the text above and copy it (Ctrl/Cmd+C).'); }
  }

  refresh() {
    const s = this.s, $ = this.$;
    $('bSummary').textContent = summary(s);
    const inRoom = !!this.opts.inRoom;
    $('bPlay').style.display = inRoom ? 'none' : '';
    $('bHost').style.display = inRoom ? 'none' : '';
    $('bUse').style.display = inRoom ? '' : 'none';
    $('bDelete').style.display = this.hooks.isUser(s.id) ? '' : 'none';
    $('bSave').textContent = this.builtIn ? 'Save as copy' : 'Save';
    const seats = countSeats(s);
    const warn = [];
    if (!seats.human) warn.push('No human seats: everyone will watch the AI fight.');
    const d = Math.hypot(s.sides[0].x - s.sides[1].x, s.sides[0].z - s.sides[1].z);
    if (d < 3000) warn.push('The sides start very close together.');
    $('bWarn').textContent = warn.join(' ');
    this.drawMap();
  }

  // ---------------- form ----------------
  renderForm() {
    const s = this.s;
    let h = `
      <section>
        <label class="wide">Name <input data-k="name" maxlength="48" value="${esc(s.name)}"></label>
        <label class="wide">Briefing <input data-k="desc" maxlength="200" value="${esc(s.desc)}" placeholder="A line or two about the mission"></label>
        <div class="grid">
          <label>Map <select data-k="map">${Object.entries(MAPS).map(([k, m]) => opt(k, m.name, s.map)).join('')}</select></label>
          <label>Time of day <select data-k="time">${Object.entries(TIMES).map(([k, m]) => opt(k, m.name, s.time)).join('')}</select></label>
          <label>Weather <select data-k="weather">${Object.entries(WEATHER).map(([k, m]) => opt(k, m.name, s.weather)).join('')}</select></label>
          <label>Rounds to win <input type="number" data-k="rounds" min="1" max="9" value="${s.rounds}"></label>
          <label>Round time limit <select data-k="timeLimit">${[0, 3, 5, 8, 10, 15, 20, 30].map((m) => opt(String(m), m ? `${m} min` : 'None', String(s.timeLimit))).join('')}</select></label>
        </div>
        <p class="dim small">${esc(MAPS[s.map].desc)}</p>
      </section>`;
    s.sides.forEach((sd, k) => {
      const auto = sd.hdg == null;
      h += `
      <section class="bside" style="--side:${SIDE_COLORS[k]}">
        <div class="bside-head">
          <input class="sname" data-side="${k}" data-f="name" maxlength="16" value="${esc(sd.name)}">
          <span class="dim small">${sd.slots.length} aircraft</span>
        </div>
        <div class="grid">
          <label>Altitude (m) <input type="number" data-side="${k}" data-f="alt" min="300" max="12000" step="100" value="${Math.round(sd.alt)}"></label>
          <label>Speed (km/h) <input type="number" data-side="${k}" data-f="spd" min="430" max="1440" step="10" value="${Math.round(sd.spd * 3.6)}"></label>
          <label>Formation <select data-side="${k}" data-f="form">${Object.entries(FORMATIONS).map(([f, n]) => opt(f, n, sd.form)).join('')}</select></label>
          <label>Spacing (m) <input type="number" data-side="${k}" data-f="spacing" min="300" max="5000" step="100" value="${Math.round(sd.spacing)}"></label>
          <label>Heading (°) <span class="hdg"><input type="number" data-side="${k}" data-f="hdg" min="0" max="359" value="${Math.round(((sideHeading(s, k) % 360) + 360) % 360)}" ${auto ? 'disabled' : ''}><label class="chk"><input type="checkbox" data-side="${k}" data-f="auto" ${auto ? 'checked' : ''}> auto</label></span></label>
        </div>
        <table class="slots"><tr><th>#</th><th>Pilot</th><th>Aircraft</th><th>Loadout</th><th>AI skill</th><th></th></tr>`;
      sd.slots.forEach((q, i) => {
        const human = q.pilot === 'human';
        h += `<tr>
          <td>${i + 1}</td>
          <td><select data-side="${k}" data-slot="${i}" data-q="pilot">${opt('human', 'Human', q.pilot)}${opt('ai', 'AI', q.pilot)}</select></td>
          <td><select data-side="${k}" data-slot="${i}" data-q="jet">${jetOptions(q.jet, human, i)}</select></td>
          <td><select data-side="${k}" data-slot="${i}" data-q="loadout">${human && q.jet === 'choice' ? opt('', "Pilot's choice", '') : loadoutOptions(q.jet, q.loadout)}</select></td>
          <td><select data-side="${k}" data-slot="${i}" data-q="skill" title="${human ? 'Used if no human takes this seat' : ''}">${Object.entries(SKILL_LABELS).map(([sk, n]) => opt(sk, n, q.skill)).join('')}</select></td>
          <td>${sd.slots.length > 1 ? `<button class="mini ghost" data-act="del" data-side="${k}" data-slot="${i}" title="Remove">✕</button>` : ''}</td>
        </tr>`;
      });
      h += `</table>
        <div class="brow">
          <button class="mini" data-act="addAi" data-side="${k}" ${sd.slots.length >= MAX_PER_SIDE ? 'disabled' : ''}>+ AI jet</button>
          <button class="mini" data-act="addHuman" data-side="${k}" ${sd.slots.length >= MAX_PER_SIDE ? 'disabled' : ''}>+ Human seat</button>
          <button class="mini ghost" data-act="fill" data-side="${k}">Fill to 8 with AI</button>
        </div>
      </section>`;
    });
    h += `<p class="dim small">Human seats are for players in an online room; in practice you take the first human seat and the AI flies any other. Empty human seats are flown by the AI using the skill shown.</p>`;
    this.form.innerHTML = h;
  }

  onField(e, committed) {
    const t = e.target, s = this.s;
    const val = t.type === 'checkbox' ? t.checked : t.value;
    let rerender = false;
    if (t.dataset.k) {
      const k = t.dataset.k;
      if (k === 'rounds' || k === 'timeLimit') { if (!committed && t.value === '') return; s[k] = +val; }
      else s[k] = val;
      rerender = committed && k === 'map';
    } else if (t.dataset.f) {
      const sd = s.sides[+t.dataset.side], f = t.dataset.f;
      if (f === 'name') sd.name = val;
      else if (f === 'form') sd.form = val;
      else if (f === 'auto') { sd.hdg = val ? null : Math.round(sideHeading(s, +t.dataset.side)); rerender = true; }
      else if (f === 'hdg') { if (t.value !== '') sd.hdg = +val; }
      else if (f === 'spd') { if (t.value !== '') sd.spd = +val / 3.6; }
      else if (t.value !== '') sd[f] = +val;
    } else if (t.dataset.q) {
      const q = s.sides[+t.dataset.side].slots[+t.dataset.slot], f = t.dataset.q;
      q[f] = val;
      if (f === 'pilot') { if (val === 'human' && q.jet === 'random') q.jet = 'choice'; if (val === 'ai' && q.jet === 'choice') q.jet = 'random'; rerender = true; }
      if (f === 'jet') { if (JETS[val] && q.loadout && !JETS[val].loadouts[q.loadout]) q.loadout = ''; rerender = true; }
    }
    if (committed) {
      // keep numbers in range etc.
      const id = s.id;
      this.s = sanitize(s); this.s.id = id;
      if (rerender) this.renderForm();
    }
    this.refresh();
  }

  onClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const sd = this.s.sides[+b.dataset.side], act = b.dataset.act;
    if (act === 'del') sd.slots.splice(+b.dataset.slot, 1);
    if (act === 'addAi' && sd.slots.length < MAX_PER_SIDE) sd.slots.push(slot('ai', sd.slots.length ? 'lead' : 'random', 'pilot'));
    if (act === 'addHuman' && sd.slots.length < MAX_PER_SIDE) sd.slots.push(slot('human', 'choice', 'pilot'));
    if (act === 'fill') while (sd.slots.length < MAX_PER_SIDE) sd.slots.push(slot('ai', 'random', 'pilot'));
    this.renderForm();
    this.refresh();
  }

  // ---------------- map ----------------
  toPx(x, z) { const S = this.px; return [((x + VIEW) / (2 * VIEW)) * S, ((z + VIEW) / (2 * VIEW)) * S]; }
  toWorld(px, py) { const S = this.px; return [(px / S) * 2 * VIEW - VIEW, (py / S) * 2 * VIEW - VIEW]; }
  handle(k) {
    const sd = this.s.sides[k], a = (sideHeading(this.s, k) * Math.PI) / 180;
    const [cx, cy] = this.toPx(sd.x, sd.z);
    return [cx + Math.sin(a) * 46, cy - Math.cos(a) * 46];
  }
  evPos(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  onDown(e) {
    const [mx, my] = this.evPos(e);
    for (let k = 1; k >= 0; k--) {
      const [hx, hy] = this.handle(k);
      if (Math.hypot(mx - hx, my - hy) < 14) { this.drag = { k, what: 'hdg' }; break; }
      const [cx, cy] = this.toPx(this.s.sides[k].x, this.s.sides[k].z);
      if (Math.hypot(mx - cx, my - cy) < 18) { this.drag = { k, what: 'pos' }; break; }
    }
    if (this.drag) { this.cv.setPointerCapture(e.pointerId); e.preventDefault(); }
  }
  onMove(e) {
    const [mx, my] = this.evPos(e);
    if (!this.drag) {
      let over = false;
      for (let k = 0; k < 2; k++) {
        const [hx, hy] = this.handle(k), [cx, cy] = this.toPx(this.s.sides[k].x, this.s.sides[k].z);
        if (Math.hypot(mx - hx, my - hy) < 14 || Math.hypot(mx - cx, my - cy) < 18) over = true;
      }
      this.cv.style.cursor = over ? 'grab' : 'default';
      return;
    }
    const sd = this.s.sides[this.drag.k];
    const [wx, wz] = this.toWorld(mx, my);
    if (this.drag.what === 'pos') {
      let x = wx, z = wz;
      const d = Math.hypot(x, z), lim = ARENA_RADIUS - 1500;
      if (d > lim) { x *= lim / d; z *= lim / d; }
      sd.x = Math.round(x / 100) * 100; sd.z = Math.round(z / 100) * 100;
    } else {
      const a = Math.atan2(wx - sd.x, -(wz - sd.z));
      sd.hdg = Math.round((((a * 180) / Math.PI) + 360) % 360 / 5) * 5;
      const el = this.form.querySelector(`input[data-side="${this.drag.k}"][data-f="hdg"]`), cb = this.form.querySelector(`input[data-side="${this.drag.k}"][data-f="auto"]`);
      if (el) { el.disabled = false; }
      if (cb) cb.checked = false;
    }
    // keep the other side's "auto" heading readout current
    for (let k = 0; k < 2; k++) {
      const el = this.form.querySelector(`input[data-side="${k}"][data-f="hdg"]`);
      if (el && document.activeElement !== el) el.value = Math.round(((sideHeading(this.s, k) % 360) + 360) % 360);
    }
    this.refresh();
  }

  drawMap() {
    const cv = this.cv, s = this.s;
    const css = Math.max(260, Math.min(cv.parentElement.clientWidth || 440, 520));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(css * dpr)) { cv.width = cv.height = Math.round(css * dpr); cv.style.width = cv.style.height = css + 'px'; }
    this.px = css;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // terrain: the preview covers the whole map; crop to the view
    const M = mapImage(s.map), n = M.canvas.width;
    const f = n / M.size, src = (M.size / 2 - VIEW) * f, sw = 2 * VIEW * f;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(M.canvas, src, src, sw, sw, 0, 0, css, css);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, 0, css, css);
    // grid every 10 km
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    for (let g = -30000; g <= 30000; g += 10000) {
      const [p] = this.toPx(g, 0), [, q] = this.toPx(0, g);
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, css); ctx.moveTo(0, q); ctx.lineTo(css, q); ctx.stroke();
    }
    // arena edge
    const [ox, oy] = this.toPx(0, 0), R = (ARENA_RADIUS / (2 * VIEW)) * css;
    ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,220,120,0.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(ox, oy, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    // separation line
    const [ax, ay] = this.toPx(s.sides[0].x, s.sides[0].z), [bx, by] = this.toPx(s.sides[1].x, s.sides[1].z);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
    const km = Math.hypot(s.sides[0].x - s.sides[1].x, s.sides[0].z - s.sides[1].z) / 1000;
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3;
    ctx.strokeText(`${km.toFixed(1)} km`, (ax + bx) / 2, (ay + by) / 2 - 6); ctx.fillText(`${km.toFixed(1)} km`, (ax + bx) / 2, (ay + by) / 2 - 6);
    // jets in formation
    const sp = spawnPoints(s, null);
    for (let k = 0; k < 2; k++) {
      const sd = s.sides[k], col = SIDE_COLORS[k];
      sp[k].forEach((p, i) => {
        const [x, y] = this.toPx(p.pos.x, p.pos.z);
        ctx.fillStyle = sd.slots[i].pilot === 'human' ? '#ffffff' : col;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
      const [cx, cy] = this.toPx(sd.x, sd.z), [hx, hy] = this.handle(k);
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + (hx - cx) * 0.33, cy + (hy - cy) * 0.33); ctx.lineTo(hx, hy); ctx.stroke();
      const a = Math.atan2(hy - cy, hx - cx);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(hx + Math.cos(a) * 8, hy + Math.sin(a) * 8);
      ctx.lineTo(hx + Math.cos(a + 2.4) * 9, hy + Math.sin(a + 2.4) * 9); ctx.lineTo(hx + Math.cos(a - 2.4) * 9, hy + Math.sin(a - 2.4) * 9); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      const label = `${sd.name} · ${sd.slots.length} · ${(sd.alt / 1000).toFixed(1)} km`;
      ctx.strokeText(label, cx, cy + 30); ctx.fillStyle = col; ctx.fillText(label, cx, cy + 30);
    }
    // north arrow + scale
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText('N ▲', 8, 16);
    ctx.fillText('grid 10 km · white dots = human seats', 8, css - 8);
  }
}
