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

// Test hooks (the two-browser test runs against local stand-ins): ?brokers=ws://localhost:1884,... and ?peerjs=host:port
const QS = new URLSearchParams(location.search);
const PEER_OPTS = (() => { const p = QS.get('peerjs'); if (!p) return {}; const [host, port] = p.split(':'); return { host, port: +port || 9000, path: '/', secure: false }; })();

// The two connection libraries are served with the game (public/lib); the CDN copy is only a second try.
const libs = {};
function loadLib(global, urls, what) {
  if (window[global]) return Promise.resolve(window[global]);
  if (libs[global]) return libs[global];
  return (libs[global] = (async () => {
    for (const src of urls) {
      const ok = await new Promise((res) => { const el = document.createElement('script'); el.src = src; el.async = true; el.onload = () => res(true); el.onerror = () => { el.remove(); res(false); }; document.head.appendChild(el); });
      if (ok && window[global]) return window[global];
    }
    libs[global] = null; throw new Error(`Could not load ${what}. Check your internet connection.`);
  })());
}
const loadPeerJS = () => loadLib('Peer', ['lib/peerjs.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'], 'the connection library');
const loadMQTT = () => loadLib('mqtt', ['lib/mqtt.min.js', 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js'], 'the relay library');

// ---------------------------------------------------------------- the relay (fallback)
// When a direct browser-to-browser link can't be opened (strict routers, school and work WiFi, hotspots), everything
// goes through a free public MQTT message relay over a secure websocket, which nearly every network allows. No
// accounts. Each lobby talks on its own topics; the host carries on relaying exactly as with direct links.
//
// The brokers are separate services that do not talk to each other, so host and guest must meet on the same one.
// Neither can know which of them the other can reach, so both use ALL of them at once: the host listens on every
// broker it can connect to (and keeps trying the rest), a guest knocks on every one it can reach, and the first
// broker to carry the knock to the host is the one that lobby's link then runs over.
// shiftr.io's public broker answers on the standard https port (443), which even strict networks let through.
const BROKERS = QS.get('brokers') ? QS.get('brokers').split(',').map((url) => ({ url })) : [
  { url: 'wss://public.cloud.shiftr.io', username: 'public', password: 'public' },
  { url: 'wss://broker.emqx.io:8084/mqtt' }, { url: 'wss://broker.hivemq.com:8884/mqtt' }, { url: 'wss://test.mosquitto.org:8081/mqtt' },
];
const TOPIC = (code) => `evil-in-the-land/v${PROTO}/${code}`;
const rid = () => Math.random().toString(36).slice(2, 12);
// One connection to every broker. Each keeps itself alive and reconnects by itself; onUp runs every time one comes
// up (so again after a reconnect: subscriptions are made there). A short keep-alive, because a lobby sits idle for
// minutes while the code is passed round, and an idle connection is quietly dropped by many routers: with the
// old two-minute keep-alive the host could be deaf on the relay when a friend finally knocked.
async function openRelays(onUp) {
  const mqtt = await loadMQTT();
  return BROKERS.map(({ url, username, password }) => {
    let cl; try { cl = mqtt.connect(url, { username, password, clientId: 'eil_' + rid(), clean: true, keepalive: 20, reconnectPeriod: 3000, connectTimeout: 8000, resubscribe: true, queueQoSZero: false }); } catch (e) { console.warn('relay', url, e); return null; }
    cl.eilUrl = url; cl.on('connect', () => { cl.eilUp = true; onUp(cl); }); cl.on('close', () => { cl.eilUp = false; }); cl.on('error', () => {});
    return cl;
  }).filter(Boolean);
}
const brokerName = (cl) => { try { return new URL(cl.eilUrl).hostname; } catch { return 'relay'; } };
// looks like a PeerJS DataConnection to the rest of this file
class RelayConn {
  constructor(client, out, wrap) { this.client = client; this.out = out; this.wrap = wrap; this.open = true; this.h = {}; this.relay = true; }
  on(t, f) { (this.h[t] || (this.h[t] = [])).push(f); }
  emit(t, a) { for (const f of this.h[t] || []) { try { f(a); } catch (e) { console.error(e); } } }
  send(obj) { if (this.open && this.client.eilUp) this.client.publish(this.out, JSON.stringify(this.wrap(obj)), { qos: 0 }); }
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
    this.relays = []; this.via = '';   // via: how this player is linked to the host ('direct' | 'relay'), for the lobby to show
    this.diag = {};                    // what each step of connecting came to, for the error message when it fails
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
    this.leave(true); this.diag = { role: 'host', direct: 'trying', relayUp: 0, relayOf: BROKERS.length };
    try { const m = await this.p2pHost(name); this.diag.direct = 'ready'; this.relayHost(this.code).catch((e) => console.warn('relay unavailable', e)); this.status(); return m; } catch (e) {
      this.diag.direct = 'matchmaker unreachable';
      // the matchmaking service is unreachable from here: hold the lobby on the relay alone
      try { return await this.relayOnlyHost(name); } catch (e2) { console.warn('relay host failed', e2); }
      // no broker reachable: if this page came from the local server, hold the lobby there instead
      if (this.serverAvailable) { await this.wsConnect(); return this.waitFor('hosted', () => this.raw({ t: 'host', name })); }
      throw e;
    }
  }
  status() { this.emit('status', this.diag); }
  // a line for the lobby: which ways in are open (host), or which way this player came in (guest)
  statusLine() {
    const d = this.diag || {};
    if (this.mode !== 'p2p') return '';
    if (this.isHost) return `Ways in: direct ${d.direct === 'ready' ? 'open' : 'closed'} · relay ${d.relayUp ? `open (${d.relayUp} of ${d.relayOf})` : 'not reached yet'}`;
    return this.via === 'relay' ? `Linked through the relay (${d.broker || ''})` : this.via === 'direct' ? 'Linked directly to the host' : '';
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
    const peer = this.peer, ws = this.ws, conns = [...this.conns.values()], hc = this.hostConn, relays = this.relays; this.relays = []; this.via = '';
    this.mode = null; this.connected = false;
    clearInterval(this._pi); clearInterval(this._wd);
    this.peer = null; this.ws = null; this.hostConn = null; this.conns = new Map();
    // let the goodbye go out before the channels close
    if (peer || ws || relays.length || hc) setTimeout(() => { for (const c of conns) try { c.close(); } catch {} try { hc?.close(); } catch {} try { peer?.destroy(); } catch {} try { ws?.close(); } catch {} setTimeout(() => { for (const r of relays) try { r.end(true); } catch {} }, 200); }, silent ? 0 : 150);
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
      let peer; try { peer = new Peer(id, { config: { iceServers: ice }, debug: 1, ...PEER_OPTS }); } catch (e) { reject(new Error('This browser cannot make direct connections (WebRTC).')); return; }
      const t = setTimeout(() => { try { peer.destroy(); } catch {} reject(new Error('Could not reach the matchmaking service. Check your internet connection.')); }, 12000);
      peer.on('open', () => { clearTimeout(t); resolve(peer); });
      peer.on('error', (e) => {
        if (peer.open) return; clearTimeout(t); try { peer.destroy(); } catch {}
        const err = new Error(e.type === 'browser-incompatible' ? 'This browser cannot make direct connections (WebRTC).' : e.type === 'unavailable-id' ? 'Code taken.' : 'Could not reach the matchmaking service. Check your internet connection.');
        err.type = e.type; reject(err);
      });
    });
  }
  // the host also listens on the relay (on every broker it can reach), so friends whose direct link fails can still come in
  async relayHost(code) {
    const T = TOPIC(code), conns = new Map();   // guest key -> its link
    const mine = () => this.code === code && this.mode === 'p2p';
    const relays = await openRelays((client) => {
      if (!mine()) return;
      client.subscribe(T + '/h');
      this.diag.relayUp = relays.filter((r) => r.eilUp).length; this.status();
    });
    if (!mine()) { for (const r of relays) try { r.end(true); } catch {} return; }
    this.relays = relays;
    for (const client of relays) {
      client.on('close', () => { if (mine()) { this.diag.relayUp = relays.filter((r) => r.eilUp).length; this.status(); } });
      client.on('message', (topic, buf) => {
        if (!mine()) return;
        let env; try { env = JSON.parse(buf.toString()); } catch { return; }
        if (!env || typeof env.c !== 'string') return;
        let c = conns.get(env.c);
        // the same guest knocking on another broker as well: the broker that brought the first knock keeps the link
        if (c && c.client !== client) { if (c.open) return; c = null; }
        if (env.k === 'x') { if (c) { conns.delete(env.c); c.shut(); } return; }
        if (!c) {
          if (!env.m || env.m.t !== 'join') return;
          c = new RelayConn(client, `${T}/g/${env.c}`, (m) => m); conns.set(env.c, c); c.on('close', () => { if (conns.get(env.c) === c) conns.delete(env.c); }); this.hostAccept(c);
        }
        c.emit('data', env.m);
      });
    }
  }
  async relayOnlyHost(name) {
    name = cleanName(name);
    const code = makeCode();
    this.mode = 'p2p'; this.peer = null; this.connected = true; this.started = false; this.nextId = HOST_ID + 1; this.code = code;
    this.roster = new Map([[HOST_ID, { id: HOST_ID, name, conn: null, heard: performance.now() }]]);
    try {
      await this.relayHost(code);
      // a lobby nobody can reach is no lobby: wait until at least one broker has answered
      for (let i = 0; i < 48 && !this.diag.relayUp; i++) await new Promise((r) => setTimeout(r, 250));
      if (!this.diag.relayUp) throw new Error('Could not reach the matchmaking service or the relay. Check your internet connection.');
    } catch (e) { const relays = this.relays; this.relays = []; for (const r of relays) try { r.end(true); } catch {} this.mode = null; this.connected = false; this.code = ''; throw e; }
    clearInterval(this._wd); this._tick = 0; this._wd = setInterval(() => this.hostWatchdog(), 2000);
    const m = { t: 'hosted', code, id: HOST_ID, players: this.rosterList() };
    this.handle(m); this.status(); return m;
  }
  rosterList() { return [...this.roster.values()].map((p) => ({ id: p.id, name: p.name })); }
  hostAccept(conn) {
    let me = null;
    const refuse = (msg) => { try { conn.send({ t: 'error', msg }); } catch {} setTimeout(() => { try { conn.close(); } catch {} }, 400); };
    conn.on('data', (m) => {
      if (!m || typeof m !== 'object') return;
      if (!me) {
        if (m.t !== 'join') return;
        // the same guest knocking by a second path (direct and relay together): the first path in keeps the seat
        if (m.key) for (const p of this.roster.values()) if (p.key === m.key && p.conn !== conn && p.conn && p.conn.open) return;
        if (m.v !== PROTO) return refuse('That lobby is running a different version of the game. Both of you should reload the page.');
        if (this.roster.size >= MAX_PLAYERS) return refuse('That lobby is full (5 knights).');
        if (this.started) return refuse('That game has already started. Ask the host to return to the lobby.');
        me = { id: this.nextId++, name: cleanName(m.name), conn, heard: performance.now(), key: m.key || null };
        this.roster.set(me.id, me); this.conns.set(me.id, conn);
        conn.send({ t: 'joined', code: this.code, id: me.id, hostId: HOST_ID, players: this.rosterList() });
        this.broadcast({ t: 'peer', id: me.id, name: me.name, players: this.rosterList() }, me.id, true);
        return;
      }
      me.heard = performance.now();
      // a guest knocks until it is answered: if the answer was lost on the way, give it again
      if (m.t === 'join') { if (this.roster.get(me.id) === me) try { conn.send({ t: 'joined', code: this.code, id: me.id, hostId: HOST_ID, players: this.rosterList() }); } catch {} return; }
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
  // Both ways to the host are tried: the direct link first, and the relay as soon as the direct link is seen to fail
  // or has not got an answer after a few seconds. On each open path the guest knocks ('join') every couple of
  // seconds until the host answers; the first answer wins and the other path is dropped.
  async p2pJoin(code, name) {
    this.mode = 'p2p';
    const D = this.diag = { role: 'guest', direct: 'trying', relay: 'waiting', relayUp: 0, relayOf: BROKERS.length };
    return new Promise((resolve, reject) => {
      let done = false, peer = null, relays = [], relayGo = false, relayStarted = false;
      const key = rid(), tries = [], held = [];   // held: relay paths that are up, waiting for the word to knock
      const hello = () => ({ t: 'join', name: cleanName(name), v: PROTO, key });
      const stop = () => { clearTimeout(t); clearTimeout(rt); for (const c of tries) clearInterval(c._knock); };
      const why = () => {
        const rel = D.relayUp ? `relay reached (${D.relayUp} of ${D.relayOf}), no answer from the host` : 'relay not reached';
        const lost = D.direct === 'no lobby with that code' && D.relayUp > 0;
        return (lost ? 'No lobby with that code was found. Check the code, and that the host still has the lobby open.' : 'Could not reach the host. Check the code is right and the host still has the lobby open, then try again.') + ` [direct: ${D.direct}; ${rel}]`;
      };
      const fail = (msg) => { if (done) return; done = true; stop(); for (const c of tries) try { c.shut ? c.shut() : c.close(); } catch {} try { peer?.destroy(); } catch {} for (const r of relays) try { r.end(true); } catch {} this.leave(true); reject(new Error(msg)); };
      const t = setTimeout(() => fail(why()), 32000);
      // an answer from the host on either path
      const attach = (conn) => {
        tries.push(conn);
        const knock = () => { if (!done && conn.open) try { conn.send(hello()); } catch {} };
        conn.on('open', () => { knock(); clearInterval(conn._knock); conn._knock = setInterval(knock, 2500); });
        conn.on('data', (m) => {
          if (!m || typeof m !== 'object') return;
          if (m.t === '__x') { conn.shut ? conn.shut() : conn.close(); return; }
          if (this.hostConn === conn) this.lastHeard = performance.now();
          if (!done) {
            if (m.t === 'error') return fail(m.msg);
            if (m.t === 'joined') {
              done = true; stop();
              for (const c of tries) if (c !== conn) try { c.shut ? c.shut() : c.close(); } catch {}
              // keep only the path that answered
              if (conn.relay) { try { peer?.destroy(); } catch {} this.peer = null; for (const r of relays) if (r !== conn.client) try { r.end(true); } catch {} this.relays = [conn.client]; this.via = 'relay'; D.broker = brokerName(conn.client); }
              else { for (const r of relays) try { r.end(true); } catch {} this.relays = []; this.via = 'direct'; }
              this.hostConn = conn; this.lastHeard = performance.now(); this.connected = true; this.handle(m); resolve(m); this.status();
              clearInterval(this._pi); this._pi = setInterval(() => this.raw({ t: 'ping', ts: performance.now() }), 3000);
              clearInterval(this._wd); this._tick = 0; this._wd = setInterval(() => { if (this.frozen()) this.lastHeard = performance.now(); else if (this.hostConn === conn && performance.now() - this.lastHeard > SILENT_MS) this.lost(conn); }, 2000);
            }
            return;
          }
          if (m.t === 'joined') return;   // a late answer to an earlier knock
          if (this.hostConn === conn) this.handle(m);
        });
        conn.on('close', () => { clearInterval(conn._knock); if (done && this.hostConn === conn) this.lost(conn); });
        conn.on('error', (e) => console.warn('conn error', e));
      };
      // the relay: every broker is connected to at once, from the start, so that it is ready; the knocking there
      // begins when the direct link has failed or has had its few seconds (goRelay)
      const startRelay = async () => {
        if (relayStarted || done) return; relayStarted = true;
        try {
          const T = TOPIC(code);
          relays = await openRelays((client) => {
            if (done) return;   // (after joining, the link's own broker resubscribes by itself when it reconnects)
            D.relayUp = relays.filter((r) => r.eilUp).length || 1;
            let conn = client.eilConn;
            if (!conn) {
              conn = client.eilConn = new RelayConn(client, T + '/h', (m) => (m.t === '__x' ? { c: key, k: 'x' } : { c: key, k: 'd', m }));
              client.on('message', (topic, buf) => { let m; try { m = JSON.parse(buf.toString()); } catch { return; } conn.emit('data', m); });
              attach(conn);
            }
            client.subscribe(`${T}/g/${key}`, () => { if (done) return; if (relayGo) conn.emit('open'); else if (!held.includes(conn)) held.push(conn); });
          });
          if (done && !this.relays.length) for (const r of relays) if (r !== this.hostConn?.client) try { r.end(true); } catch {}
        } catch (e) { D.relay = 'library did not load'; console.warn('relay join failed', e); }
      };
      const goRelay = () => { if (relayGo || done) return; relayGo = true; D.relay = 'knocking'; startRelay(); for (const c of held) c.emit('open'); held.length = 0; };
      const forceRelay = QS.has('relay');   // ?relay: go straight to the relay
      startRelay();
      const rt = setTimeout(goRelay, forceRelay ? 0 : 5000);
      // the direct link
      if (forceRelay) D.direct = 'skipped';
      else (async () => {
        try {
          const Peer = await loadPeerJS(); peer = await this.openPeer(Peer, undefined); if (done) { peer.destroy(); return; }
          this.peer = peer; D.direct = 'looking for the host';
          // no direct lobby with that code: it may still be held on the relay
          peer.on('error', (e) => { if (e.type === 'peer-unavailable') { D.direct = 'no lobby with that code'; goRelay(); } else if (!done) console.warn('peer error', e.type); });
          const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
          conn.on('open', () => { D.direct = 'open, no answer'; });
          attach(conn);
          conn.on('iceStateChanged', (st) => { if (!done && (st === 'failed' || st === 'disconnected')) { D.direct = 'blocked by the network'; goRelay(); } });
        } catch (e) { D.direct = 'matchmaker unreachable'; console.warn('direct link unavailable', e); goRelay(); }
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
