// WebSocket client for the local lobby server. The host's browser runs the
// simulation; everyone else sends their own knight and receives snapshots.
export class Net {
  constructor() {
    this.ws = null; this.id = 0; this.hostId = 0; this.code = ''; this.players = []; this.handlers = {}; this.connected = false;
    this.ping = 0; this.queue = [];
  }
  get isHost() { return this.id && this.id === this.hostId; }
  on(type, fn) { (this.handlers[type] || (this.handlers[type] = [])).push(fn); }
  off(type) { delete this.handlers[type]; }
  emit(type, msg) { for (const fn of this.handlers[type] || []) fn(msg); }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(new Error('Could not reach the game server.')); return; }
      this.ws = ws;
      const t = setTimeout(() => { reject(new Error('The game server did not answer. Is it running?')); try { ws.close(); } catch {} }, 5000);
      ws.onopen = () => { clearTimeout(t); this.connected = true; resolve(); this.pingLoop(); };
      ws.onerror = () => { clearTimeout(t); reject(new Error('Could not connect to the game server. Open the game from the address the server printed.')); };
      ws.onclose = () => { this.connected = false; this.emit('close', {}); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        switch (m.t) {
          case 'hosted': this.id = m.id; this.hostId = m.id; this.code = m.code; this.players = m.players; break;
          case 'joined': this.id = m.id; this.hostId = m.hostId; this.code = m.code; this.players = m.players; break;
          case 'peer': case 'left': this.players = m.players; break;
          case 'pong': this.ping = performance.now() - m.ts; break;
        }
        this.emit(m.t, m);
        if (m.t === 'r' && m.d && m.d.k) this.emit('k:' + m.d.k, { from: m.from, ...m.d });
      };
    });
  }
  pingLoop() { clearInterval(this._pi); this._pi = setInterval(() => this.raw({ t: 'ping', ts: performance.now() }), 3000); }
  raw(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  host(name) { return this.waitFor('hosted', () => this.raw({ t: 'host', name })); }
  join(code, name) { return this.waitFor('joined', () => this.raw({ t: 'join', code, name })); }
  waitFor(type, send) {
    return new Promise((resolve, reject) => {
      const ok = (m) => { cleanup(); resolve(m); }, bad = (m) => { cleanup(); reject(new Error(m.msg)); };
      const cleanup = () => { this.handlers[type] = (this.handlers[type] || []).filter((f) => f !== ok); this.handlers.error = (this.handlers.error || []).filter((f) => f !== bad); };
      this.on(type, ok); this.on('error', bad); send();
    });
  }
  // relay to everyone else (or one player)
  send(k, data = {}, to) { this.raw({ t: 'r', to, d: { k, ...data } }); }
  start(data) { this.raw({ t: 'start', d: { k: 'start', ...data } }); }
  backToLobby(data) { this.raw({ t: 'lobby', d: { k: 'lobby', ...data } }); }
  kick(id) { this.raw({ t: 'kick', id }); }
  leave() { this.raw({ t: 'leave' }); this.id = 0; this.hostId = 0; this.code = ''; this.players = []; }
}
