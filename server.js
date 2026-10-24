#!/usr/bin/env node
// Evil in the Land — local game server.
// No dependencies: serves the game, relays lobby traffic over WebSockets,
// and caches Three.js locally so players on your network don't need internet.
//   node server.js            (port 7777)
//   PORT=8080 node server.js

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = parseInt(process.env.PORT || '7777', 10);
const ROOT = path.join(__dirname, 'public');
const VENDOR = process.env.EVIL_VENDOR ? path.resolve(process.env.EVIL_VENDOR) : path.join(__dirname, 'vendor');
const THREE_VERSION = '0.160.0';
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`;
const MAX_PLAYERS = 5;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
};

// ---------------------------------------------------------------- static files
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(body);
}

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': file.startsWith(VENDOR) ? 'max-age=86400' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const pendingVendor = new Map();
async function fetchVendor(rel) {
  // Only Three.js build + example modules may be fetched.
  if (!/^three\/(build|examples\/jsm)\/[\w\-./]+\.js$/.test(rel) || rel.includes('..')) throw new Error('blocked');
  const dest = path.join(VENDOR, rel);
  if (fs.existsSync(dest)) return dest;
  if (pendingVendor.has(rel)) return pendingVendor.get(rel);
  const p = (async () => {
    const url = CDN + rel.slice('three/'.length);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`CDN ${r.status} for ${url}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    console.log(`  cached ${rel}`);
    return dest;
  })();
  pendingVendor.set(rel, p);
  try { return await p; } finally { pendingVendor.delete(rel); }
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, 'Bad request'); }
  if (url === '/health') return send(res, 200, 'ok');
  if (url === '/api/info') {
    return send(res, 200, JSON.stringify({ lan: lanAddresses(), port: PORT, rooms: rooms.size }), MIME['.json']);
  }
  if (url === '/audio/list') { // your own music/sfx files dropped into public/audio
    let files = [];
    try { files = fs.readdirSync(path.join(ROOT, 'audio')).filter((f) => /\.(ogg|mp3|wav|m4a|flac)$/i.test(f)); } catch {}
    return send(res, 200, JSON.stringify(files), MIME['.json']);
  }
  if (url.startsWith('/vendor/')) {
    const rel = url.slice('/vendor/'.length);
    try { return serveFile(res, await fetchVendor(rel)); }
    catch (e) {
      console.warn(`  vendor miss ${rel}: ${e.message}`);
      return send(res, 502, 'Could not load ' + rel + '. The host computer needs internet the first time the game runs.');
    }
  }
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  if (url === '/index.html') {
    // the page loads Three.js from the CDN; served from here it uses the local cache instead,
    // so friends on your network don't need internet
    return fs.readFile(file, 'utf8', (err, html) => {
      if (err) return send(res, 404, 'Not found');
      send(res, 200, html.split(CDN).join('/vendor/three/'), MIME['.html']);
    });
  }
  serveFile(res, file);
});

// ---------------------------------------------------------------- websockets
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.frag = null; this.open = true;
    this.onmessage = null; this.onclose = null; this.alive = true;
    sock.setNoDelay(true);
    sock.on('data', (d) => this._data(d));
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }
  _closed() { if (!this.open) return; this.open = false; this.onclose && this.onclose(); }
  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this.buf.length < 10) return;
        const hi = this.buf.readUInt32BE(2); len = this.buf.readUInt32BE(6); off = 10;
        if (hi !== 0 || len > 4 * 1024 * 1024) return this.close();
      }
      if (len > 4 * 1024 * 1024) return this.close();
      const maskLen = masked ? 4 : 0;
      if (this.buf.length < off + maskLen + len) return;
      let payload = this.buf.subarray(off + maskLen, off + maskLen + len);
      if (masked) {
        const m = this.buf.subarray(off, off + 4);
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ m[i & 3];
        payload = out;
      } else payload = Buffer.from(payload);
      this.buf = this.buf.subarray(off + maskLen + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this._frame(0xA, payload); continue; }
      if (op === 0xA) { this.alive = true; continue; }
      if (op === 0x1 || op === 0x2) {
        if (fin) this._msg(payload); else this.frag = [payload];
      } else if (op === 0x0 && this.frag) {
        this.frag.push(payload);
        if (fin) { const all = Buffer.concat(this.frag); this.frag = null; this._msg(all); }
      }
    }
  }
  _msg(buf) { if (this.onmessage) { try { this.onmessage(buf.toString('utf8')); } catch (e) { console.warn('msg error', e.message); } } }
  _frame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.from([0x80 | op, len]); }
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
    try { this.sock.write(Buffer.concat([head, payload])); } catch { this._closed(); }
  }
  send(str) { this._frame(0x1, Buffer.from(str, 'utf8')); }
  ping() { this._frame(0x9, Buffer.alloc(0)); }
  close() { if (this.open) { this._frame(0x8, Buffer.alloc(0)); try { this.sock.end(); } catch {} this._closed(); } }
}

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  onConnection(new Socket(sock));
});

// ---------------------------------------------------------------- lobbies
// A room holds up to 5 players. The host's browser runs the simulation;
// this server only relays messages between players in the same room.
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let nextId = 1;

function makeCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('no codes left');
}

function roster(room) {
  return [...room.players.values()].map((p) => ({ id: p.id, name: p.name }));
}
function sendTo(p, obj) { p.ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, exceptId) {
  const s = JSON.stringify(obj);
  for (const p of room.players.values()) if (p.id !== exceptId) p.ws.send(s);
}
function cleanName(n) {
  n = String(n || '').replace(/[^\p{L}\p{N} _'\-.]/gu, '').trim().slice(0, 18);
  return n || 'Knight';
}

function onConnection(ws) {
  const me = { id: nextId++, ws, name: 'Knight', room: null };

  ws.onmessage = (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const room = me.room;
    switch (m.t) {
      case 'host': {
        if (room) leave();
        me.name = cleanName(m.name);
        const code = makeCode();
        const r = { code, hostId: me.id, players: new Map(), started: false, created: Date.now() };
        r.players.set(me.id, me); rooms.set(code, r); me.room = r;
        sendTo(me, { t: 'hosted', code, id: me.id, players: roster(r) });
        console.log(`  lobby ${code} opened by ${me.name}`);
        break;
      }
      case 'join': {
        if (room) leave();
        me.name = cleanName(m.name);
        const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const r = rooms.get(code);
        if (!r) return sendTo(me, { t: 'error', msg: `No lobby with code ${code || '(blank)'}. Check the code with your host.` });
        if (r.players.size >= MAX_PLAYERS) return sendTo(me, { t: 'error', msg: 'That lobby is full (5 knights).' });
        if (r.started) return sendTo(me, { t: 'error', msg: 'That game has already started. Ask the host to return to the lobby.' });
        r.players.set(me.id, me); me.room = r;
        sendTo(me, { t: 'joined', code, id: me.id, hostId: r.hostId, players: roster(r) });
        broadcast(r, { t: 'peer', id: me.id, name: me.name, players: roster(r) }, me.id);
        console.log(`  ${me.name} joined ${code} (${r.players.size}/${MAX_PLAYERS})`);
        break;
      }
      case 'start': if (room && room.hostId === me.id) { room.started = true; broadcast(room, { t: 'r', from: me.id, d: m.d }, me.id); } break;
      case 'lobby': if (room && room.hostId === me.id) { room.started = false; broadcast(room, { t: 'r', from: me.id, d: m.d }, me.id); } break;
      case 'kick': {
        if (!room || room.hostId !== me.id) break;
        const p = room.players.get(m.id);
        if (p && p !== me) { sendTo(p, { t: 'kicked' }); removeFrom(room, p); p.room = null; }
        break;
      }
      case 'r': { // relay
        if (!room) break;
        const out = JSON.stringify({ t: 'r', from: me.id, d: m.d });
        if (m.to != null) { const p = room.players.get(m.to); if (p) p.ws.send(out); }
        else for (const p of room.players.values()) if (p !== me) p.ws.send(out);
        break;
      }
      case 'leave': leave(); break;
      case 'ping': sendTo(me, { t: 'pong', ts: m.ts }); break;
    }
  };

  function removeFrom(r, p) {
    r.players.delete(p.id);
    if (r.players.size === 0) { rooms.delete(r.code); console.log(`  lobby ${r.code} closed`); return; }
    if (r.hostId === p.id) {
      broadcast(r, { t: 'hostLeft' });
      for (const q of r.players.values()) q.room = null;
      rooms.delete(r.code);
      console.log(`  lobby ${r.code} closed (host left)`);
    } else {
      broadcast(r, { t: 'left', id: p.id, players: roster(r) });
    }
  }
  function leave() { if (me.room) { removeFrom(me.room, me); me.room = null; } }
  ws.onclose = leave;
}

setInterval(() => {
  for (const r of rooms.values()) for (const p of r.players.values()) {
    if (!p.ws.alive) { p.ws.close(); continue; }
    p.ws.alive = false; p.ws.ping();
  }
}, 15000);

// ---------------------------------------------------------------- start
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanAddresses();
  console.log('\n  EVIL IN THE LAND — server running\n');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const a of lan) console.log(`  Friends on your network:  http://${a}:${PORT}`);
  console.log('\n  Host a lobby in the game, then give friends the 4-letter code.');
  console.log('  Leave this window open while you play. Ctrl+C to stop.\n');
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is busy. Try:  PORT=7788 node server.js\n`);
  else console.error(e);
  process.exit(1);
});
