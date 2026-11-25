// Contrail Duel — static file server + WebSocket rooms (up to 8 players) and message relay.
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

// ---------------- Rooms ----------------
// A room has a host (who runs the AI and owns the scenario) and up to 8 members.
// Game traffic is relayed to everyone else in the room, or to one member when it carries `to`.
const MAX_MEMBERS = 8;
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });
const rooms = new Map(); // code -> { code, host, members: Set<ws>, quick }
let quickRoom = null;    // a quick-match room still waiting for its second player
let nextId = 1;

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function roomInfo(room) {
  return { t: 'room', code: room.code, host: room.host.id, quick: !!room.quick, members: [...room.members].map((m) => ({ id: m.id, name: m.name })) };
}
function broadcastInfo(room) { const info = roomInfo(room); for (const m of room.members) send(m, info); }

function createRoom(ws, quick) {
  const room = { code: makeCode(), host: ws, members: new Set([ws]), quick };
  rooms.set(room.code, room);
  ws.room = room;
  broadcastInfo(room);
  return room;
}
function joinRoom(ws, room) {
  if (room.members.size >= MAX_MEMBERS) { send(ws, { t: 'error', msg: 'That room is full (8 pilots).' }); return false; }
  room.members.add(ws); ws.room = room;
  broadcastInfo(room);
  return true;
}
function leaveRoom(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  room.members.delete(ws);
  if (quickRoom === room) quickRoom = null;
  if (room.host === ws) {
    // the host runs the AI and the rules, so the room closes with it
    for (const m of room.members) { m.room = null; send(m, { t: 'hostLeft' }); }
    rooms.delete(room.code);
    console.log(`room ${room.code} closed`);
    return;
  }
  for (const m of room.members) send(m, { t: 'peerLeft', id: ws.id, name: ws.name });
  broadcastInfo(room);
}

wss.on('connection', (ws) => {
  ws.id = nextId++;
  ws.name = 'Pilot' + ws.id;
  ws.room = null;
  ws.rateWindow = Date.now();
  ws.rateCount = 0;

  ws.on('message', (raw) => {
    // Flood protection: a host with 15 AI jets sends roughly 60 messages a second.
    const now = Date.now();
    if (now - ws.rateWindow > 1000) { ws.rateWindow = now; ws.rateCount = 0; }
    if (++ws.rateCount > 300) { if (ws.rateCount > 1200) ws.terminate(); return; }
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
        leaveRoom(ws);
        if (quickRoom && quickRoom.host.readyState === 1 && quickRoom.members.size < 2) {
          const r = quickRoom; quickRoom = null;
          joinRoom(ws, r);
          console.log(`quick match in ${r.code}`);
        } else quickRoom = createRoom(ws, true);
        break;
      case 'create':
        leaveRoom(ws);
        createRoom(ws, false);
        break;
      case 'join': {
        const room = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!room || room.host.readyState !== 1) { send(ws, { t: 'error', msg: 'Room not found' }); break; }
        if (ws.room === room) break;
        leaveRoom(ws);
        joinRoom(ws, room);
        break;
      }
      case 'cancel':
      case 'leave':
        leaveRoom(ws);
        break;
      default: {
        // Game traffic: stamp the sender and relay.
        const room = ws.room;
        if (!room) break;
        msg.from = ws.id;
        const out = JSON.stringify(msg);
        if (msg.to != null) {
          for (const m of room.members) if (m.id === msg.to && m.readyState === 1) m.send(out);
        } else {
          for (const m of room.members) if (m !== ws && m.readyState === 1) m.send(out);
        }
      }
    }
  });

  ws.on('close', () => leaveRoom(ws));
});

server.listen(PORT, () => {
  console.log(`Contrail Duel running at http://localhost:${PORT}`);
});
