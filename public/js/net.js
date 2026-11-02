// Multiplayer transport. The host's browser runs the simulation; everyone else
// sends their own knight and receives snapshots.
//
// Two ways to connect, with the same API for main.js and game.js:
//  * Peer to peer (the default, nothing to install): the host's browser holds
//    the lobby. Players find each other through the free PeerJS broker using
//    the five-letter lobby code, then talk directly over WebRTC data channels.
//    The host relays messages between guests, as the old server did.
//  * The local server (server.js), if the page was opened from one: four-letter
//    codes, everyone connects to that server by WebSocket. Kept as a fallback
//    for networks where direct connections fail.
//
// Messages are the same either way: hosted/joined/peer/left/hostLeft/kicked/
// close, and 'r' relays which also emit 'k:<kind>'.

const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const ID_PREFIX = 'evil-in-the-land-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (they look like 1 and 0)
export const P2P_CODE_LEN = 5, WS_CODE_LEN = 4;
const MAX_PLAYERS = 5, HOST_ID = 1, PROTO = 1;
// A closed channel is noticed at once; this only catches connections that die silently. It is
// long because loading a chapter can freeze a slow machine's page for many seconds.
const SILENT_MS = 120000;
// Google's public STUN servers find each player's public address. Some strict
// networks (symmetric NAT, some offices and mobile carriers) also need a TURN
// relay server, which would go here.
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun2.l.google.com:19302' }];
// Relays for networks that block direct links (strict routers, school and work WiFi, phone hotspots), used only when
// no direct route is found: the free Open Relay Project. Its static-auth relay takes short-lived logins made from a
// public shared secret (the standard TURN REST scheme: user = expiry time, password = HMAC-SHA1 of it).
const RELAY_HOST = 'staticauth.openrelay.metered.ca', RELAY_SECRET = 'openrelayprojectsecret';
async function iceServers() {
  try {
    const user = String(Math.floor(Date.now() / 1000) + 24 * 3600);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(RELAY_SECRET), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(user));
    const credential = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return [...ICE, { urls: [`turn:${RELAY_HOST}:80`, `turn:${RELAY_HOST}:80?transport=tcp`, `turn:${RELAY_HOST}:443`, `turns:${RELAY_HOST}:443?transport=tcp`], username: user, credential }];
  } catch (e) { console.warn('no relay login', e); return ICE; }
}

let peerLib = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (peerLib) return peerLib;
  peerLib = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = PEERJS_URL; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('The connection library did not load.')));
    s.onerror = () => { peerLib = null; reject(new Error('Could not load the connection library. Check your internet connection.')); };
    document.head.appendChild(s);
  });
  return peerLib;
}
// ---------------------------------------------------------------- the relay (fallback)
// When a direct browser-to-browser link can't be opened (strict routers, school and work WiFi, hotspots), everything
// goes through a free public MQTT message relay over a secure websocket on port 443-ish, which nearly every network
// allows. No accounts. Each lobby talks on its own topics; the host carries on relaying exactly as with direct links.
const MQTT_URL = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js';
// shiftr.io's public broker answers on the standard https port (443), which even strict networks let through;
// the others are backups on their own ports
const BROKERS = [
  { url: 'wss://public.cloud.shiftr.io', username: 'public', password: 'public' },
  { url: 'wss://broker.emqx.io:8084/mqtt' }, { url: 'wss://broker.hivemq.com:8884/mqtt' }, { url: 'wss://test.mosquitto.org:8081/mqtt' },
];
const TOPIC = (code) => `evil-in-the-land/v${PROTO}/${code}`;
let mqttLib = null;
function loadMQTT() {
  if (window.mqtt) return Promise.resolve(window.mqtt);
  if (mqttLib) return mqttLib;
  mqttLib = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = MQTT_URL; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => (window.mqtt ? resolve(window.mqtt) : reject(new Error('The relay library did not load.')));
    s.onerror = () => { mqttLib = null; reject(new Error('Could not load the relay library.')); };
    document.head.appendChild(s);
  });
  return mqttLib;
}
// connect to the first public broker that answers
async function relayClient() {
  const mqtt = await loadMQTT();
  for (const { url, username, password } of BROKERS) {
    const c = await new Promise((resolve) => {
      let cl; try { cl = mqtt.connect(url, { username, password, clientId: 'eil_' + Math.random().toString(36).slice(2, 12), clean: true, keepalive: 120, reconnectPeriod: 1500, connectTimeout: 6000, resubscribe: true, queueQoSZero: true }); } catch { resolve(null); return; }
      const t = setTimeout(() => { try { cl.end(true); } catch {} resolve(null); }, 7000);
      cl.once('connect', () => { clearTimeout(t); resolve(cl); });
    });
    if (c) return c;
  }
  throw new Error('Could not reach the relay either. Check your internet connection.');
}
// looks like a PeerJS DataConnection to the rest of this file
class RelayConn {
  constructor(client, out, wrap) { this.client = client; this.out = out; this.wrap = wrap; this.open = true; this.h = {}; this.relay = true; }
  on(t, f) { (this.h[t] || (this.h[t] = [])).push(f); }
  emit(t, a) { for (const f of this.h[t] || []) { try { f(a); } catch (e) { console.error(e); } } }
  send(obj) { if (this.open) this.client.publish(this.out, JSON.stringify(this.wrap(obj)), { qos: 0 }); }
  shut() { if (!this.open) return; this.open = false; this.emit('close'); }
  close() { if (!this.open) return; try { this.client.publish(this.out, JSON.stringify(this.wrap({ t: '__x' })), { qos: 0 }); } catch {} this.shut(); }
}

const makeCode = () => Array.from({ length: P2P_CODE_LEN }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const cleanName = (n) => String(n || 'Knight').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18) || 'Knight';

export class Net {
  constructor() {
    this.mode = null; // 'p2p' | 'ws'
    this.ws = null; this.peer = null; this.conns = new Map(); this.hostConn = null;
    this.id = 0; this.hostId = 0; this.code = ''; this.players = []; this.handlers = {}; this.connected = false;
    this.ping = 0; this.started = false; this.nextId = HOST_ID + 1; this.lastHeard = 0;
    this.serverAvailable = false; // set by main.js when the page came from server.js
  }
  get isHost() { return !!this.id && this.id === this.hostId; }
  on(type, fn) { (this.handlers[type] || (this.handlers[type] = [])).push(fn); }
  off(type) { delete this.handlers[type]; }
  emit(type, msg) { for (const fn of this.handlers[type] || []) { try { fn(msg); } catch (e) { console.error(e); } } }
  // incoming message (from the server, the host, or the host's own loopback)
  handle(m) {
    switch (m.t) {
      case 'hosted': this.id = m.id; this.hostId = m.id; this.code = m.code; this.players = m.players; break;
      case 'joined': this.id = m.id; this.hostId = m.hostId; this.code = m.code; this.players = m.players; break;
      case 'peer': case 'left': this.players = m.players; break;
      case 'pong': this.ping = performance.now() - m.ts; break;
    }
    this.emit(m.t, m);
    if (m.t === 'r' && m.d && m.d.k) this.emit('k:' + m.d.k, { from: m.from, ...m.d });
  }

  // ------------------------------------------------------------ public API
  async host(name) {
    this.leave(true);
    try { const m = await this.p2pHost(name); this.relayHost(this.code).catch((e) => console.warn('relay unavailable', e)); return m; } catch (e) {
      // the matchmaking service is unreachable from here: hold the lobby on the relay alone
      try { return await this.relayOnlyHost(name); } catch (e2) { console.warn('relay host failed', e2); }
      // no broker reachable: if this page came from the local server, hold the lobby there instead
      if (this.serverAvailable) { await this.wsConnect(); return this.waitFor('hosted', () => this.raw({ t: 'host', name })); }
      throw e;
    }
  }
  async join(code, name) {
    this.leave(true);
    code = String(code || '').trim().toUpperCase();
    if (code.length === WS_CODE_LEN) {
      if (!this.serverAvailable) throw new Error('Four-letter codes belong to a lobby on a local game server. Open the game from the address the host gave you.');
      await this.wsConnect(); return this.waitFor('joined', () => this.raw({ t: 'join', code, name }));
    }
    if (code.length !== P2P_CODE_LEN || [...code].some((c) => !ALPHABET.includes(c))) throw new Error(`Lobby codes are ${P2P_CODE_LEN} letters, like KDRWX.`);
    return this.p2pJoin(code, name);
  }
  raw(obj) {
    if (this.mode === 'ws') { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); return; }
    if (this.mode !== 'p2p') return;
    if (this.isHost) this.hostReceive(HOST_ID, obj);
    else if (this.hostConn && this.hostConn.open) { try { this.hostConn.send(obj); } catch (e) { console.warn('send failed', e); } }
  }
  // relay to everyone else (or one player)
  send(k, data = {}, to) { this.raw({ t: 'r', to, d: { k, ...data } }); }
  start(data) { this.raw({ t: 'start', d: { k: 'start', ...data } }); }
  backToLobby(data) { this.raw({ t: 'lobby', d: { k: 'lobby', ...data } }); }
  kick(id) { this.raw({ t: 'kick', id }); }
  leave(silent = false) {
    if (this.mode) this.raw({ t: 'leave' });
    const peer = this.peer, ws = this.ws, conns = [...this.conns.values()], hc = this.hostConn, relay = this.relay; this.relay = null;
    this.mode = null; this.connected = false;
    clearInterval(this._pi); clearInterval(this._wd);
    this.peer = null; this.ws = null; this.hostConn = null; this.conns = new Map();
    // let the goodbye go out before the channels close
    if (peer || ws || relay || hc) setTimeout(() => { for (const c of conns) try { c.close(); } catch {} try { hc?.close(); } catch {} try { peer?.destroy(); } catch {} try { ws?.close(); } catch {} setTimeout(() => { try { relay?.end(true); } catch {} }, 200); }, silent ? 0 : 150);
    this.id = 0; this.hostId = 0; this.code = ''; this.players = []; this.started = false;
  }
  waitFor(type, send) {
    return new Promise((resolve, reject) => {
      const ok = (m) => { cleanup(); resolve(m); }, bad = (m) => { cleanup(); reject(new Error(m.msg)); };
      const cleanup = () => { this.handlers[type] = (this.handlers[type] || []).filter((f) => f !== ok); this.handlers.error = (this.handlers.error || []).filter((f) => f !== bad); };
      this.on(type, ok); this.on('error', bad); send();
    });
  }

  // ------------------------------------------------------------ local server (WebSocket)
  wsConnect() {
    if (this.ws && this.ws.readyState <= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(new Error('Could not reach the game server.')); return; }
      this.ws = ws; this.mode = 'ws';
      const t = setTimeout(() => { reject(new Error('The game server did not answer. Is it running?')); try { ws.close(); } catch {} }, 5000);
      ws.onopen = () => { clearTimeout(t); this.connected = true; resolve(); clearInterval(this._pi); this._pi = setInterval(() => this.raw({ t: 'ping', ts: performance.now() }), 3000); };
      ws.onerror = () => { clearTimeout(t); reject(new Error('Could not connect to the game server.')); };
      ws.onclose = () => { if (this.ws !== ws) return; this.connected = false; this.mode = null; this.emit('close', {}); };
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.handle(m); };
    });
  }

  // ------------------------------------------------------------ peer to peer: host
  async p2pHost(name) {
    const Peer = await loadPeerJS();
    name = cleanName(name);
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = makeCode();
      try {
        const peer = await this.openPeer(Peer, ID_PREFIX + code);
        this.mode = 'p2p'; this.peer = peer; this.connected = true; this.started = false; this.nextId = HOST_ID + 1;
        this.roster = new Map([[HOST_ID, { id: HOST_ID, name, conn: null, heard: performance.now() }]]);
        peer.on('connection', (conn) => this.hostAccept(conn));
        // the broker drops idle peers now and then; reconnect so friends can still find the lobby
        peer.on('disconnected', () => { if (this.peer === peer && !peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch {} }, 1000); });
        peer.on('error', (e) => console.warn('peer error', e.type, e.message));
        clearInterval(this._wd); this._tick = 0; this._wd = setInterval(() => this.hostWatchdog(), 2000);
        const m = { t: 'hosted', code, id: HOST_ID, players: this.rosterList() };
        this.handle(m); return m;
      } catch (e) { if (e.type !== 'unavailable-id') throw e; } // that code is taken: roll another
    }
    throw new Error('Could not make a lobby code. Try again.');
  }
  async openPeer(Peer, id) {
    const ice = await iceServers();
    return new Promise((resolve, reject) => {
      let peer; try { peer = new Peer(id, { config: { iceServers: ice }, debug: 1 }); } catch (e) { reject(new Error('This browser cannot make direct connections (WebRTC).')); return; }
      const t = setTimeout(() => { try { peer.destroy(); } catch {} reject(new Error('Could not reach the matchmaking service. Check your internet connection.')); }, 12000);
      peer.on('open', () => { clearTimeout(t); resolve(peer); });
      peer.on('error', (e) => {
        if (peer.open) return; clearTimeout(t); try { peer.destroy(); } catch {}
        const err = new Error(e.type === 'browser-incompatible' ? 'This browser cannot make direct connections (WebRTC).' : e.type === 'unavailable-id' ? 'Code taken.' : 'Could not reach the matchmaking service. Check your internet connection.');
        err.type = e.type; reject(err);
      });
    });
  }
  // the host also listens on the relay, so friends whose direct link fails can still come in
  async relayHost(code) {
    const client = await relayClient();
    if (this.code !== code || this.mode !== 'p2p') { client.end(true); return; }
    this.relay = client; const T = TOPIC(code), conns = new Map();
    client.subscribe(T + '/h');
    client.on('message', (topic, buf) => {
      let env; try { env = JSON.parse(buf.toString()); } catch { return; }
      if (!env || typeof env.c !== 'string') return;
      let c = conns.get(env.c);
      if (env.k === 'x') { if (c) { conns.delete(env.c); c.shut(); } return; }
      if (!c) { c = new RelayConn(client, `${T}/g/${env.c}`, (m) => m); conns.set(env.c, c); c.on('close', () => conns.delete(env.c)); this.hostAccept(c); }
      c.emit('data', env.m);
    });
  }
  async relayOnlyHost(name) {
    name = cleanName(name);
    const code = makeCode();
    this.mode = 'p2p'; this.peer = null; this.connected = true; this.started = false; this.nextId = HOST_ID + 1; this.code = code;
    this.roster = new Map([[HOST_ID, { id: HOST_ID, name, conn: null, heard: performance.now() }]]);
    try { await this.relayHost(code); } catch (e) { this.mode = null; this.connected = false; throw e; }
    clearInterval(this._wd); this._tick = 0; this._wd = setInterval(() => this.hostWatchdog(), 2000);
    const m = { t: 'hosted', code, id: HOST_ID, players: this.rosterList() };
    this.handle(m); return m;
  }
  rosterList() { return [...this.roster.values()].map((p) => ({ id: p.id, name: p.name })); }
  hostAccept(conn) {
    let me = null;
    const refuse = (msg) => { try { conn.send({ t: 'error', msg }); } catch {} setTimeout(() => { try { conn.close(); } catch {} }, 400); };
    conn.on('data', (m) => {
      if (!m || typeof m !== 'object') return;
      if (!me) {
        if (m.t !== 'join') return;
        if (m.v !== PROTO) return refuse('That lobby is running a different version of the game. Both of you should reload the page.');
        if (this.roster.size >= MAX_PLAYERS) return refuse('That lobby is full (5 knights).');
        if (this.started) return refuse('That game has already started. Ask the host to return to the lobby.');
        me = { id: this.nextId++, name: cleanName(m.name), conn, heard: performance.now() };
        this.roster.set(me.id, me); this.conns.set(me.id, conn);
        conn.send({ t: 'joined', code: this.code, id: me.id, hostId: HOST_ID, players: this.rosterList() });
        this.broadcast({ t: 'peer', id: me.id, name: me.name, players: this.rosterList() }, me.id, true);
        return;
      }
      me.heard = performance.now();
      this.hostReceive(me.id, m);
    });
    conn.on('close', () => { if (me && this.roster.get(me.id) === me) this.hostRemove(me.id); });
    conn.on('error', (e) => console.warn('conn error', e));
  }
  // send to every guest (and to the host's own handlers when `self`), except one
  broadcast(obj, exceptId, self = false) {
    for (const [id, c] of this.conns) if (id !== exceptId && c.open) { try { c.send(obj); } catch {} }
    if (self && exceptId !== HOST_ID) this.handle(obj);
  }
  // what the old server did with each message, done by the host's browser
  hostReceive(from, m) {
    switch (m.t) {
      case 'r': {
        const out = { t: 'r', from, d: m.d };
        if (m.to != null) { if (m.to === HOST_ID) { if (from !== HOST_ID) this.handle(out); } else { const c = this.conns.get(m.to); if (c && c.open) try { c.send(out); } catch {} } }
        else this.broadcast(out, from, true);
        break;
      }
      case 'start': if (from === HOST_ID) { this.started = true; this.broadcast({ t: 'r', from, d: m.d }, HOST_ID); } break;
      case 'lobby': if (from === HOST_ID) { this.started = false; this.broadcast({ t: 'r', from, d: m.d }, HOST_ID); } break;
      case 'kick': if (from === HOST_ID && m.id !== HOST_ID) { const c = this.conns.get(m.id); if (c) { try { c.send({ t: 'kicked' }); } catch {} setTimeout(() => { try { c.close(); } catch {} }, 300); } this.hostRemove(m.id); } break;
      case 'leave':
        if (from === HOST_ID) this.broadcast({ t: 'hostLeft' }, HOST_ID);
        else this.hostRemove(from);
        break;
      case 'ping': if (from !== HOST_ID) { const c = this.conns.get(from); try { c?.send({ t: 'pong', ts: m.ts }); } catch {} } break;
    }
  }
  hostRemove(id) {
    if (!this.roster.has(id)) return;
    this.roster.delete(id); this.conns.delete(id);
    this.broadcast({ t: 'left', id, players: this.rosterList() }, undefined, true);
  }
  // true when this page itself was frozen (the timer fired late): then silence from others means nothing
  frozen() { const now = performance.now(), gap = now - (this._tick || now); this._tick = now; return gap > 5000; }
  hostWatchdog() {
    if (!this.isHost || this.mode !== 'p2p') return;
    const now = performance.now(), froze = this.frozen();
    for (const p of this.roster.values()) {
      if (p.id === HOST_ID) continue;
      if (froze) { p.heard = now; continue; }
      if (now - p.heard > SILENT_MS) { try { p.conn.close(); } catch {} this.hostRemove(p.id); }
    }
  }

  // ------------------------------------------------------------ peer to peer: guest
  async p2pJoin(code, name) {
    this.mode = 'p2p';
    return new Promise((resolve, reject) => {
      let done = false, relayStarted = false, peer = null;
      const tries = [];   // the connections being attempted; the first to be let in wins
      const fail = (msg) => { if (done) return; done = true; clearTimeout(t); clearTimeout(rt); for (const c of tries) try { c.close(); } catch {} try { peer?.destroy(); } catch {} this.leave(true); reject(new Error(msg)); };
      const t = setTimeout(() => fail('Could not reach the host. Check the code is right and the host still has the lobby open, then try again.'), 35000);
      // an answer from the host on either path
      const attach = (conn) => {
        tries.push(conn);
        conn.on('open', () => { conn.send({ t: 'join', name: cleanName(name), v: PROTO }); });
        conn.on('data', (m) => {
          if (!m || typeof m !== 'object') return;
          if (m.t === '__x') { conn.shut ? conn.shut() : conn.close(); return; }
          if (this.hostConn === conn) this.lastHeard = performance.now();
          if (!done) {
            if (m.t === 'error') return fail(m.msg);
            if (m.t === 'joined') {
              done = true; clearTimeout(t); clearTimeout(rt);
              for (const c of tries) if (c !== conn) try { c.close(); } catch {}
              if (conn.relay) { try { peer?.destroy(); } catch {} this.peer = null; }
              this.hostConn = conn; this.lastHeard = performance.now(); this.connected = true; this.handle(m); resolve(m);
              clearInterval(this._pi); this._pi = setInterval(() => this.raw({ t: 'ping', ts: performance.now() }), 3000);
              clearInterval(this._wd); this._tick = 0; this._wd = setInterval(() => { if (this.frozen()) this.lastHeard = performance.now(); else if (this.hostConn === conn && performance.now() - this.lastHeard > SILENT_MS) this.lost(conn); }, 2000);
            }
            return;
          }
          if (this.hostConn === conn) this.handle(m);
        });
        conn.on('close', () => { if (done && this.hostConn === conn) this.lost(conn); });
        conn.on('error', (e) => console.warn('conn error', e));
      };
      // the relay: started if the direct link has not opened after a few seconds, or cannot be tried at all
      const startRelay = async () => {
        if (relayStarted || done) return; relayStarted = true;
        try {
          const client = await relayClient(); if (done) { client.end(true); return; }
          this.relay = client;
          const T = TOPIC(code), key = Math.random().toString(36).slice(2, 12);
          const conn = new RelayConn(client, T + '/h', (m) => (m.t === '__x' ? { c: key, k: 'x' } : { c: key, k: 'd', m }));
          client.subscribe(`${T}/g/${key}`, () => { attach(conn); conn.emit('open'); });
          client.on('message', (topic, buf) => { let m; try { m = JSON.parse(buf.toString()); } catch { return; } conn.emit('data', m); });
        } catch (e) { console.warn('relay join failed', e); }
      };
      const forceRelay = /[?&]relay\b/.test(location.search);   // ?relay: go straight to the relay
      const rt = setTimeout(startRelay, forceRelay ? 0 : 8000);
      // the direct link
      if (!forceRelay) (async () => {
        try {
          const Peer = await loadPeerJS(); peer = await this.openPeer(Peer, undefined); if (done) { peer.destroy(); return; }
          this.peer = peer;
          // no direct lobby with that code: it may still be held on the relay
          peer.on('error', (e) => { if (e.type === 'peer-unavailable') startRelay(); else if (!done) console.warn('peer error', e.type); });
          const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
          attach(conn);
          conn.on('iceStateChanged', (st) => { if (st === 'failed' || st === 'disconnected') startRelay(); });
        } catch (e) { console.warn('direct link unavailable', e); startRelay(); }
      })();
    });
  }
  lost(conn) {
    if (this.hostConn !== conn || this.mode !== 'p2p') return;
    this.hostConn = null; this.connected = false; clearInterval(this._pi); clearInterval(this._wd);
    this.emit('close', {});
    this.leave(true);
  }
}
