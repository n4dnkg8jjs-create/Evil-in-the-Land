// Player profiles: who is playing, and everything their knight keeps.
//
// For now profiles live in this browser (localStorage). Everything else in the
// game talks to the `account` object below, never to localStorage, so a real
// account service (Supabase, Firebase, our own server…) can replace
// LocalBackend later: write a backend with the same async methods
// (list/create/signIn/remove/read/write) and pass it to setBackend().
//
// A profile's data:
//   name, loadout, settings,
//   armoury  { silver, owned[], up{}, draughts, … }   (see shop.js)
//   progress { chapter, best{chapterIdx: seconds}, kills, deaths, runs, victories }
//   flags    { anything small the game wants remembered (devilReveal, soloAI…) }

const INDEX = 'evil.profiles', CURRENT = 'evil.currentProfile', PREFIX = 'evil.profile.';
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// a PIN only stops casual switching on a shared computer; it is not security
async function hashPin(pin, salt) {
  const text = `evil-in-the-land:${salt}:${pin}`;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { // no SubtleCrypto (plain http on a LAN address): a simple fallback hash
    let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'f' + (h >>> 0).toString(16);
  }
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18);

export function blankData(name) {
  return { name, loadout: null, settings: null, armoury: null, progress: { chapter: 0, best: {}, kills: 0, deaths: 0, runs: 0, victories: 0 }, flags: {} };
}

// ------------------------------------------------------------ browser storage backend
export class LocalBackend {
  get kind() { return 'local'; }
  async list() { return ls.get(INDEX, []); }
  async create(name, pin) {
    name = cleanName(name); if (!name) throw new Error('Give your knight a name.');
    const list = ls.get(INDEX, []);
    if (list.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error('A knight of that name already rides here. Choose another name.');
    const id = newId(), salt = newId();
    const entry = { id, name, created: Date.now(), last: Date.now(), pin: pin ? { salt, hash: await hashPin(pin, salt) } : null };
    list.push(entry); if (!ls.set(INDEX, list)) throw new Error('This browser will not let the game save (private window or storage blocked).');
    ls.set(PREFIX + id, blankData(name));
    return { id, name };
  }
  async signIn(id, pin) {
    const list = ls.get(INDEX, []); const e = list.find((p) => p.id === id);
    if (!e) throw new Error('That profile is gone.');
    if (e.pin && (await hashPin(pin || '', e.pin.salt)) !== e.pin.hash) throw new Error('That PIN is not right.');
    e.last = Date.now(); ls.set(INDEX, list);
    return { id: e.id, name: e.name };
  }
  async remove(id) { ls.set(INDEX, ls.get(INDEX, []).filter((p) => p.id !== id)); ls.del(PREFIX + id); }
  async read(id) { return ls.get(PREFIX + id, null); }
  async write(id, data) {
    if (!ls.set(PREFIX + id, data)) return false;
    const list = ls.get(INDEX, []); const e = list.find((p) => p.id === id);
    if (e && e.name !== data.name) { e.name = data.name; ls.set(INDEX, list); }
    return true;
  }
  remembered() { return ls.get(CURRENT, null); }
  remember(id) { if (id) ls.set(CURRENT, id); else ls.del(CURRENT); }
}

// ------------------------------------------------------------ the account the game uses
// Old builds kept these keys loose in localStorage; they map onto the profile so
// callers can keep using account.get('evil.loadout') and so on.
const KEYMAP = {
  'evil.name': ['name'], 'evil.loadout': ['loadout'], 'evil.settings': ['settings'],
  'evil.armoury': ['armoury'], 'evil.progress': ['progress', 'chapter'],
};
const LEGACY = ['evil.name', 'evil.loadout', 'evil.settings', 'evil.armoury', 'evil.progress', 'evil.devilReveal', 'evil.soloAI', 'evil.pages', 'evil.loreSeen'];

class Account {
  constructor(backend) { this.backend = backend; this.user = null; this.data = null; this.listeners = []; this.saveT = 0; }
  setBackend(b) { this.backend = b; this.user = null; this.data = null; }
  current() { return this.user ? { ...this.user, local: this.backend.kind === 'local' } : null; }
  get signedIn() { return !!this.user; }
  onChange(fn) { this.listeners.push(fn); }
  changed() { for (const fn of this.listeners) try { fn(this.current()); } catch (e) { console.error(e); } }
  async list() { try { return await this.backend.list(); } catch { return []; } }
  async create(name, pin) { const u = await this.backend.create(name, pin); return this.signIn(u.id, pin); }
  async signIn(id, pin) {
    const u = await this.backend.signIn(id, pin);
    this.user = u; this.data = Object.assign(blankData(u.name), (await this.backend.read(u.id)) || {});
    this.data.progress = Object.assign(blankData().progress, this.data.progress || {}); this.data.flags = this.data.flags || {};
    this.backend.remember?.(u.id); this.changed(); return this.current();
  }
  // sign straight back in to the profile this browser used last (only if it has no PIN)
  async resume() {
    const id = this.backend.remembered?.(); if (!id) return null;
    const e = (await this.list()).find((p) => p.id === id); if (!e || e.pin) return null;
    try { return await this.signIn(id); } catch { return null; }
  }
  signOut() { this.flush(); this.user = null; this.data = null; this.backend.remember?.(null); this.changed(); }
  async remove(id) { if (this.user?.id === id) this.signOut(); await this.backend.remove(id); }
  load() { return this.data; }
  // merge and save now
  async save(patch) { if (!this.data) return false; if (patch) Object.assign(this.data, patch); clearTimeout(this.saveT); return this.backend.write(this.user.id, this.data); }
  // save soon (many small changes in a row write once)
  touch() { if (!this.data) return; clearTimeout(this.saveT); this.saveT = setTimeout(() => this.save(), 400); }
  flush() { if (this.data && this.saveT) { clearTimeout(this.saveT); this.saveT = 0; this.backend.write(this.user.id, this.data); } }
  rename(name) { name = cleanName(name); if (!name || !this.data) return; this.data.name = name; this.user.name = name; this.save(); this.changed(); }

  // key/value view of the profile, for the old storage keys and small flags
  get(key, d) {
    if (!this.data) return d;
    const path = KEYMAP[key];
    let v = path ? path.reduce((o, p) => (o == null ? undefined : o[p]), this.data) : this.data.flags[key];
    return v === undefined || v === null ? d : v;
  }
  set(key, value) {
    if (!this.data) return;
    const path = KEYMAP[key];
    if (!path) this.data.flags[key] = value;
    else { let o = this.data; for (let i = 0; i < path.length - 1; i++) o = o[path[i]] || (o[path[i]] = {}); o[path[path.length - 1]] = value; }
    this.touch();
  }
  // progress bookkeeping, called by the game
  record(evt, a = {}) {
    if (!this.data) return; const P = this.data.progress;
    switch (evt) {
      case 'chapterDone': {
        P.chapter = Math.max(P.chapter || 0, a.next ?? 0);
        if (a.idx != null && a.secs > 0) { const b = P.best[a.idx]; if (!b || a.secs < b) P.best[a.idx] = Math.round(a.secs); }
        break;
      }
      case 'kill': P.kills = (P.kills || 0) + (a.n || 1); break;
      case 'death': P.deaths = (P.deaths || 0) + 1; break;
      case 'run': P.runs = (P.runs || 0) + 1; break;
      case 'victory': P.victories = (P.victories || 0) + 1; break;
    }
    if (evt === 'kill') this.touch(); else this.save();
  }
  // first visit after this update: fold the old loose keys into a profile
  async migrateLegacy() {
    if ((await this.list()).length) return null;
    const old = {}; let any = false;
    for (const k of LEGACY) { let raw = null; try { raw = localStorage.getItem(k); } catch {} if (raw !== null) { old[k] = ls.get(k); any = true; } }
    if (!any) return null;
    const name = cleanName(old['evil.name']) || 'Knight';
    await this.create(name);
    for (const k of LEGACY) if (k in old && k !== 'evil.name') this.set(k, k === 'evil.progress' ? +old[k] || 0 : old[k]);
    await this.save();
    for (const k of LEGACY) ls.del(k); // folded in: don't import them again
    return this.current();
  }
}

export const account = new Account(new LocalBackend());
window.__account = account;
addEventListener('pagehide', () => account.flush());
