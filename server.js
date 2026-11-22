// Contrail Duel — static file server + WebSocket matchmaking/relay for 1v1 matches.
// Run: npm install && npm start   (then open http://localhost:3000)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const VENDOR = path.join(__dirname, 'node_modules', 'three', 'build');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); res.end(); return; }
  if (url === '/') url = '/index.html';
  let base = PUBLIC;
  if (url.startsWith('/vendor/')) { base = VENDOR; url = url.slice('/vendor'.length); }
  const file = path.normalize(path.join(base, url));
  if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
  sendFile(res, file);
});

// ---------------- Matchmaking ----------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
const rooms = new Map(); // code -> host socket
let waiting = null;      // quick-match queue (1 slot is enough for 1v1)
let nextId = 1;

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function unqueue(ws) {
  if (waiting === ws) waiting = null;
  if (ws.room && rooms.get(ws.room) === ws) rooms.delete(ws.room);
  ws.room = null;
}

function unpair(ws) {
  const p = ws.partner;
  if (p) { p.partner = null; send(p, { t: 'peerLeft' }); }
  ws.partner = null;
}

function pair(host, guest) {
  unqueue(host); unqueue(guest);
  host.partner = guest; guest.partner = host;
  send(host, { t: 'matched', role: 'host', opp: guest.name });
  send(guest, { t: 'matched', role: 'guest', opp: host.name });
  console.log(`match: ${host.name} vs ${guest.name}`);
}

wss.on('connection', (ws) => {
  ws.id = nextId++;
  ws.name = 'Pilot' + ws.id;
  ws.partner = null;
  ws.room = null;

  ws.rateWindow = Date.now();
  ws.rateCount = 0;

  ws.on('message', (raw) => {
    // Basic flood protection: a normal client sends ~35 msgs/s.
    const now = Date.now();
    if (now - ws.rateWindow > 1000) { ws.rateWindow = now; ws.rateCount = 0; }
    if (++ws.rateCount > 150) { if (ws.rateCount > 600) ws.terminate(); return; }
    const str = raw.toString();
    let msg;
    try { msg = JSON.parse(str); } catch { return; }
    switch (msg.t) {
      case 'hello':
        ws.name = String(msg.name || ws.name).replace(/[^\w \-]/g, '').slice(0, 16) || ws.name;
        send(ws, { t: 'welcome', id: ws.id });
        break;
      case 'ping':
        send(ws, { t: 'pong', c: msg.c });
        break;
      case 'quick':
        unpair(ws); unqueue(ws);
        if (waiting && waiting !== ws && waiting.readyState === 1) pair(waiting, ws);
        else { waiting = ws; send(ws, { t: 'waiting' }); }
        break;
      case 'create': {
        unpair(ws); unqueue(ws);
        const code = makeCode();
        rooms.set(code, ws); ws.room = code;
        send(ws, { t: 'room', code });
        break;
      }
      case 'join': {
        const code = String(msg.code || '').toUpperCase().trim();
        const host = rooms.get(code);
        if (!host || host === ws || host.readyState !== 1) { send(ws, { t: 'error', msg: 'Room not found' }); break; }
        unpair(ws);
        pair(host, ws);
        break;
      }
      case 'cancel':
        unqueue(ws);
        break;
      case 'leave':
        unpair(ws); unqueue(ws);
        break;
      default:
        // Game traffic: relay verbatim to the opponent.
        if (ws.partner && ws.partner.readyState === 1) ws.partner.send(str);
    }
  });

  ws.on('close', () => { unqueue(ws); unpair(ws); });
});

server.listen(PORT, () => {
  console.log(`Contrail Duel running at http://localhost:${PORT}`);
});
