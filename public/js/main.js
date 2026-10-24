// Boot, menus, lobby and the main loop.
import { loadBody } from './body.js';
import { loadPeople } from './people.js';
import { loadDemonBodies } from './horror.js';
import * as THREE from 'three';
import { Engine } from './engine.js';
import { AudioEngine } from './audio.js';
import { UI, heraldCss, esc } from './ui.js';
import { Net } from './net.js';
import { Game } from './game.js';
import { World } from './world.js';
import { Knight, RELICS, HERALDRY } from './knight.js';
import { STYLES } from './armor.js';
import { WEAPONS } from './weapons.js';
import { FINISHES, armorTextures } from './textures.js';
import { loadArmoury, saveArmoury } from './shop.js';
import { prewarmDemons } from './demons.js';
import { Watcher } from './devil.js';
import { CHAPTERS } from './chapters.js';
import { clamp, lerp, damp } from './util.js';

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

// ---------------------------------------------------------------- input
class Input {
  constructor(canvas) {
    this.down = new Set(); this.edge = new Set(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this.locked = false; this.canvas = canvas;
    addEventListener('keydown', (e) => { if (e.repeat) return; if (!this.down.has(e.code)) this.edge.add(e.code); this.down.add(e.code); if (this.gameActive && ['Space', 'Tab'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => { const c = 'Mouse' + e.button; if (!this.down.has(c)) this.edge.add(c); this.down.add(c); });
    addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    addEventListener('mousemove', (e) => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    addEventListener('wheel', (e) => { if (this.gameActive) this.wheel += e.deltaY; }, { passive: true });
    addEventListener('contextmenu', (e) => { if (this.gameActive) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (this.onLockChange) this.onLockChange(this.locked); });
  }
  held(c) { return this.down.has(c); }
  pressed(c) { return this.edge.has(c); }
  lock() { if (!this.locked && this.canvas.requestPointerLock) { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch {} } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  endFrame() { this.edge.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; }
}

// ---------------------------------------------------------------- app
const app = {
  settings: Object.assign({ quality: 'high', sens: 1, fov: 62, invert: false, lockKey: 'ctrl', vol: 0.8, music: 0.65, sfx: 0.9, subs: true }, store.get('evil.settings', {})),
  loadout: Object.assign({ style: 'maximilian', finish: 'bright', weapon: 'longsword', relic: 'water', heraldry: 'gules', cape: true, plume: true }, store.get('evil.loadout', {})),
  name: store.get('evil.name', ''),
  game: null, lobby: null,
};
window.__app = app; // handy for debugging from the console

async function boot() {
  const ui = app.ui = new UI(); ui.subsOn = app.settings.subs;
  window.__bootProgress = 0.05;
  ui.boot(0.05, 'Lighting the forge…');
  const canvas = $('view');
  app.engine = new Engine(canvas, app.settings.quality);
  app.audio = new AudioEngine(); app.audio.vol = { master: app.settings.vol, music: app.settings.music, sfx: app.settings.sfx };
  app.net = new Net();
  app.input = new Input(canvas);
  app.input.onLockChange = (l) => { if (app.game && !l && !app.paused && !app.game.cinema.active && !app.game.shop?.open) $('clickToPlay').hidden = false; if (l) $('clickToPlay').hidden = true; };
  const step = async (frac, msg, fn) => { ui.boot(frac, msg); window.__bootProgress = frac; await new Promise((r) => setTimeout(r, 30)); fn && fn(); };
  ui.boot(0.08, 'Measuring the knight…'); window.__bootProgress = 0.08;
  await Promise.all([loadBody(), loadDemonBodies(), loadPeople()]);
  await step(0.15, 'Hammering the plate…', () => { for (const f of Object.keys(FINISHES)) if (!FINISHES[f].hidden) armorTextures(f, app.engine.q.tex); });
  await step(0.45, 'Calling up the shadows…', () => prewarmDemons());
  await step(0.6, 'The land dies…', () => buildMenuScene());
  await step(0.95, 'Saying the morning office…');
  ui.boot(1, ''); window.__bootProgress = 1;
  setupMenus();
  $('playerName').value = app.name || randomName();
  // without the local server (e.g. opened as a hosted page) only solo play is possible
  app.offline = !(await fetch('health').then((r) => r.ok && r.text()).then((t) => t === 'ok').catch(() => false));
  if (app.offline) { $('titleErr').textContent = ''; $('offlineNote').hidden = false; $('joinAddrField').hidden = false; }
  ui.show('title');
  // links from the start script (?host) or from the web page's Join (?join=CODE) go straight in
  const q = new URLSearchParams(location.search);
  if (!app.offline && (q.has('host') || q.has('join'))) {
    if (q.get('name')) { app.name = q.get('name').slice(0, 18); $('playerName').value = app.name; store.set('evil.name', app.name); }
    history.replaceState(null, '', location.pathname);
    if (q.has('join')) { $('joinCode').value = q.get('join').toUpperCase().slice(0, 4); $('btnJoin').click(); $('joinGo').click(); }
    else $('btnHost').click();
  }
  requestAnimationFrame(loop);
  // audio may only start after the first gesture
  const wake = () => { app.audio.init(); app.audio.setVolumes(app.audio.vol); if (app.audio.music) { app.audio.music.start(); app.audio.music.setMood('dread'); app.audio.music.setIntensity(0); } removeEventListener('pointerdown', wake); removeEventListener('keydown', wake); };
  addEventListener('pointerdown', wake); addEventListener('keydown', wake);
}
function randomName() { const n = ['Aldric', 'Bertrand', 'Conrad', 'Dietrich', 'Eberhard', 'Gottfried', 'Hartmann', 'Konrad', 'Leopold', 'Ulrich', 'Wolfram', 'Anselm', 'Matthias', 'Benedikt', 'Ottokar']; return n[Math.floor(Math.random() * n.length)]; }

// ---------------------------------------------------------------- menu scene
const menu = { world: null, knight: null, watcher: null, t: 0, focus: 'title' };
app.menu = menu;
function buildMenuScene() {
  const e = app.engine;
  menu.world = new World(e, e.q, 0);
  const a = menu.world.altars[0];
  menu.altar = a;
  makeMenuKnight();
  menu.watcher = new Watcher(e.scene, null);
  // for the title he stands nearer than he ever will in play, on a rise beyond the altar
  const k0 = menu.knight; const fx = Math.sin(k0.yaw), fz = Math.cos(k0.yaw);
  const wx = a.x + fx * 38 - fz * 9, wz = a.z + fz * 38 + fx * 9;
  menu.watcher.pos.set(wx, menu.world.groundAt(wx, wz), wz); menu.watcher.state = 'watch'; menu.watcher.yaw = Math.atan2(a.x - wx, a.z - wz);
  menu.world.vista.onThunder = (str, delay) => app.audio.thunder(str, delay);
  e.renderer.toneMappingExposure = (menu.world.ch.atmos.exposure || 1) * 1.4;
}
function makeMenuKnight() {
  const e = app.engine, a = menu.altar;
  if (menu.knight) menu.knight.dispose();
  const k = menu.knight = new Knight(e.scene, e.q, app.loadout, { id: 0, name: '' });
  k.pos.set(a.x + 0.9, 0, a.z - 2.9); k.pos.y = menu.world.heightAt(k.pos.x, k.pos.z);   // south of the altar, facing north toward the storm
  k.yaw = Math.atan2(a.x - k.pos.x, a.z - k.pos.z);
  k.praying = true; k.kneel = 1; k.prayT = 3;
}
function menuUpdate(dt) {
  const e = app.engine, k = menu.knight; menu.t += dt;
  const W = { heightAt: (x, z) => menu.world.heightAt(x, z), collide() {}, wind: menu.world.wind, canPrayAt: () => true };
  // the knight prays on the title screen and stands to show his harness in the lobby
  const lobby = app.ui.current === 'lobby';
  const inp = { mx: 0, mz: 0, aimYaw: k.yaw, sprint: false, block: false, pray: !lobby, attack: false, heavy: false, dodge: false, relic: false };
  k.simulate(dt, inp, W);
  if (lobby && !k.action && Math.random() < dt * 0.25) k.tryAttack(Math.random() < 0.3);
  k.events.length = 0;
  k.animate(dt, W);
  menu.world.update(dt, e.camera.position);
  menu.watcher.animate(dt, menu.t, e.camera.position, [k]);
  const c = e.camera; const p = k.pos;
  if (lobby) {
    const ang = k.yaw + 0.9 + Math.sin(menu.t * 0.15) * 0.4;
    const want = new THREE.Vector3(p.x + Math.sin(ang) * 3.2, p.y + 1.55, p.z + Math.cos(ang) * 3.2);
    c.position.lerp(want, 1 - Math.exp(-3 * dt)); c.lookAt(p.x, p.y + 1.1, p.z);
  } else {
    // behind the kneeling knight's shoulder, looking past him and the altar to the rise where He stands
    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw), sway = Math.sin(menu.t * 0.05) * 0.5;
    const want = new THREE.Vector3(p.x - fx * 4.2 + fz * (1.6 + sway), p.y + 1.25, p.z - fz * 4.2 - fx * (1.6 + sway));
    c.position.lerp(want, menu.snapped ? 1 - Math.exp(-1.5 * dt) : 1); menu.snapped = true;
    const w = menu.watcher.pos; c.lookAt(lerp(p.x, w.x, 0.35), p.y + 2.6, lerp(p.z, w.z, 0.35));
  }
  const gy = menu.world.heightAt(c.position.x, c.position.z) + 0.6; if (c.position.y < gy) c.position.y = gy;
  if (Math.abs(c.fov - 45) > 0.1) { c.fov = 45; c.updateProjectionMatrix(); }
  e.focusShadows(p);
  app.audio.update(dt);
  e.render(dt);
}
function disposeMenuScene() {
  if (!menu.world) return;
  menu.world.dispose(); menu.knight.dispose(); app.engine.scene.remove(menu.watcher.mesh);
  menu.world = null;
}

// ---------------------------------------------------------------- menus
function fillSelect(id, entries, value) {
  const s = $(id); s.innerHTML = entries.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join(''); s.value = value;
}
function setupMenus() {
  const ui = app.ui;
  const click = () => app.audio.ui('click');
  for (const b of document.querySelectorAll('button')) b.addEventListener('click', click);
  $('playerName').addEventListener('change', () => { app.name = $('playerName').value.trim().slice(0, 18) || randomName(); store.set('evil.name', app.name); });
  const nameNow = () => { app.name = $('playerName').value.trim().slice(0, 18) || randomName(); store.set('evil.name', app.name); return app.name; };
  $('btnHost').onclick = async () => { $('titleErr').textContent = ''; if (app.offline) { nameNow(); ui.show('hostHelp'); return; } try { await app.net.connect(); await app.net.host(nameNow()); enterLobby(); } catch (e) { $('titleErr').textContent = e.message; } };
  $('btnJoin').onclick = () => { nameNow(); $('joinErr').textContent = ''; ui.show('join'); $('joinCode').focus(); };
  $('joinBack').onclick = () => ui.show('title');
  $('hostBack').onclick = () => ui.show('title');
  $('hostOpenLocal').onclick = () => { location.href = `http://localhost:7777/?host&name=${encodeURIComponent(app.name)}`; };
  $('joinAddr').value = store.get('evil.lastHost', '');
  $('joinAddr').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinCode').focus(); });
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinGo').click(); });
  $('joinGo').onclick = async () => {
    const code = $('joinCode').value.trim().toUpperCase();
    if (code.length !== 4) { $('joinErr').textContent = 'Lobby codes are four letters or numbers.'; return; }
    if (app.offline) {
      // the web page can't hold the lobby itself: open the game from the host's PC with the code filled in
      const m = $('joinAddr').value.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').match(/^([\w.-]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?$/i);
      if (!m) { $('joinErr').textContent = 'Type the address shown in the host\'s lobby, like 192.168.1.20:7777.'; $('joinAddr').focus(); return; }
      store.set('evil.lastHost', $('joinAddr').value.trim());
      location.href = `http://${m[1]}:${m[2] || 7777}/?join=${code}&name=${encodeURIComponent(app.name)}`;
      return;
    }
    try { await app.net.connect(); await app.net.join(code, app.name); enterLobby(); } catch (e) { $('joinErr').textContent = e.message; }
  };
  $('btnSolo').onclick = () => { nameNow(); enterLobby(true); };
  // testing: straight into the battle on the Peak, alone with two companions
  $('btnTestPeak').onclick = () => { nameNow(); enterLobby(true); $('optAI').value = '2'; $('optChapter').value = String(CHAPTERS.length - 1); $('btnStart').click(); };
  $('btnSettings').onclick = () => openSettings('title');
  $('btnHow').onclick = () => { app.howReturn = 'title'; ui.show('how'); };
  $('howBack').onclick = () => ui.show(app.howReturn || 'title');
  $('setBack').onclick = () => { saveSettings(); ui.show(app.settingsReturn || 'title'); };
  // settings live updates
  for (const id of ['setVol', 'setMusic', 'setSfx']) $(id).addEventListener('input', () => { app.audio.setVolumes({ master: +$('setVol').value, music: +$('setMusic').value, sfx: +$('setSfx').value }); });
  // loadout options
  fillSelect('loStyle', Object.entries(STYLES).map(([k, s]) => [k, s.name]), app.loadout.style);
  fillSelect('loFinish', Object.entries(FINISHES).filter(([, f]) => !f.hidden).map(([k, f]) => [k, f.name]), app.loadout.finish);
  fillWeapons();
  fillSelect('loRelic', Object.entries(RELICS).map(([k, r]) => [k, r.name]), app.loadout.relic);
  fillSelect('loHeraldry', Object.entries(HERALDRY).map(([k, h]) => [k, h.name]), app.loadout.heraldry);
  $('loCape').checked = app.loadout.cape; $('loPlume').checked = app.loadout.plume;
  for (const id of ['loStyle', 'loFinish', 'loWeapon', 'loRelic', 'loHeraldry', 'loCape', 'loPlume']) $(id).addEventListener('change', onLoadoutChange);
  describeLoadout();
  // lobby buttons
  $('btnReady').onclick = () => { if (!app.lobby) return; app.lobby.ready = !app.lobby.ready; pushLobbySelf(); };
  $('btnStart').onclick = () => startFromLobby();
  $('btnLeave').onclick = () => leaveLobby();
  for (const id of ['optDiff', 'optAI', 'optChapter']) $(id).addEventListener('change', () => { if (app.lobby?.host) broadcastLobby(); });
  // pause
  $('pResume').onclick = () => resume();
  $('pSettings').onclick = () => openSettings('pause');
  $('pHow').onclick = () => { app.howReturn = 'pause'; ui.show('how'); };
  $('pLobby').onclick = () => { if (app.lobby?.solo || app.net.isHost) { if (!app.lobby.solo) app.net.backToLobby({}); app.endGame(false); } };
  $('pQuit').onclick = () => { app.endGame(false, true); };
  $('clickToPlay').onclick = () => { app.input.lock(); };
  $('view').addEventListener('click', () => { if (app.game && !app.paused) app.input.lock(); });
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && app.game) { if (app.game.shop?.open) { app.game.shop.close(); return; } if (app.paused) resume(); else pause(); }
  });
  // networking: lobby + lifecycle
  app.net.on('k:lobbySelf', (m) => { if (app.lobby?.host) { const p = app.lobby.players.get(m.from); if (p) { p.loadout = m.loadout; p.ready = m.ready; broadcastLobby(); } } });
  app.net.on('k:lobbyState', (m) => { if (app.lobby && !app.lobby.host) { app.lobby.state = m; renderLobby(); } });
  app.net.on('peer', (m) => { if (app.lobby?.host) { app.lobby.players.set(m.id, { id: m.id, name: m.name, loadout: null, ready: false }); broadcastLobby(); app.ui.toast?.(`${m.name} joins the company`, 2); } });
  app.net.on('left', (m) => { if (app.lobby?.host) { app.lobby.players.delete(m.id); broadcastLobby(); } });
  app.net.on('k:start', (m) => { if (!app.net.isHost) startGame(m); });
  app.net.on('k:lobby', () => { if (app.game && !app.net.isHost) app.endGame(false); });
  app.net.on('hostLeft', () => { const wasGame = !!app.game; if (app.game) app.endGame(false, true); else { app.lobby = null; app.ui.show('title'); } $('titleErr').textContent = 'The host has left. The company is disbanded.'; });
  app.net.on('kicked', () => { app.lobby = null; app.ui.show('title'); $('titleErr').textContent = 'The host removed you from the lobby.'; });
  app.net.on('close', () => { if (app.lobby && !app.lobby.solo) { if (app.game) app.endGame(false, true); else app.ui.show('title'); app.lobby = null; $('titleErr').textContent = 'Lost the connection to the game server.'; } });
}
function openSettings(ret) {
  const s = app.settings; app.settingsReturn = ret;
  $('setQuality').value = s.quality; $('setSens').value = s.sens; $('setFov').value = s.fov; $('setInvert').checked = s.invert; $('setLockKey').value = s.lockKey || 'ctrl';
  $('setVol').value = s.vol; $('setMusic').value = s.music; $('setSfx').value = s.sfx; $('setSubs').checked = s.subs;
  app.ui.show('settings');
}
function saveSettings() {
  const s = app.settings;
  const q = $('setQuality').value; const qChanged = q !== s.quality;
  Object.assign(s, { quality: q, sens: +$('setSens').value, fov: +$('setFov').value, invert: $('setInvert').checked, lockKey: $('setLockKey').value, vol: +$('setVol').value, music: +$('setMusic').value, sfx: +$('setSfx').value, subs: $('setSubs').checked });
  app.ui.subsOn = s.subs; store.set('evil.settings', s);
  app.audio.setVolumes({ master: s.vol, music: s.music, sfx: s.sfx });
  if (qChanged) app.engine.setQuality(q);
}
function onLoadoutChange() {
  const L = app.loadout;
  Object.assign(L, { style: $('loStyle').value, finish: $('loFinish').value, weapon: $('loWeapon').value, relic: $('loRelic').value, heraldry: $('loHeraldry').value, cape: $('loCape').checked, plume: $('loPlume').checked });
  store.set('evil.loadout', L); describeLoadout();
  if (menu.world) makeMenuKnight();
  if (app.lobby) pushLobbySelf();
}
function describeLoadout() {
  const L = app.loadout; const s = STYLES[L.style], w = WEAPONS[L.weapon], r = RELICS[L.relic];
  $('loDesc').textContent = `${s.desc} ${w.desc}`;
  const pips = (v) => { const n = Math.round(clamp(v, 0, 1) * 5); return `<span class="pips">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`; };
  $('loStats').innerHTML = `
    <dt>Protection</dt><dd>${pips((s.armor - 0.7) / 0.6)}</dd>
    <dt>Speed</dt><dd>${pips((s.speed - 0.85) / 0.3)}</dd>
    <dt>Wind</dt><dd>${pips((s.stamina - 0.8) / 0.45)}</dd>
    <dt>Damage</dt><dd>${pips((w.dmg - 0.8) / 0.6)}</dd>
    <dt>Swiftness</dt><dd>${pips((w.speed - 0.75) / 0.45)}</dd>
    <dt>Relic</dt><dd>${esc(r.desc)}</dd>`;
}

// ---------------------------------------------------------------- lobby
// only the weapons this knight owns can be taken on the road; more are bought from the sutler
function chapterOptions() {
  const unlocked = Math.max(0, store.get('evil.progress', 0));
  return CHAPTERS.map((c, i) => [i, `${i + 1}. ${c.title}${c.id === 'peak' ? ' — the battle with the Dragon' : ''}${i > unlocked ? ' (test)' : ''}`]);
}
function fillWeapons() {
  const a = loadArmoury(); if (!a.owned.includes(app.loadout.weapon)) { a.owned.push(app.loadout.weapon); saveArmoury(a); }
  fillSelect('loWeapon', Object.entries(WEAPONS).filter(([k]) => a.owned.includes(k)).map(([k, w]) => [k, w.name + (a.up['edge:' + k] ? ' ' + '✦'.repeat(a.up['edge:' + k]) : '')]), app.loadout.weapon);
}
function enterLobby(solo = false) {
  fillWeapons();
  const host = solo || app.net.isHost;
  app.lobby = { solo, host, ready: false, players: new Map(), state: null };
  app.lobby.players.set(solo ? 1 : app.net.id, { id: solo ? 1 : app.net.id, name: app.name, loadout: { ...app.loadout }, ready: true });
  // chapter select (unlocked chapters)
  // testing: every chapter can be chosen, up to the battle on the Peak (the Dragon), whatever has been unlocked
  fillSelect('optChapter', chapterOptions(), 0);
  $('hostOpts').hidden = !host;
  $('btnStart').hidden = !host; $('btnReady').hidden = host;
  $('lobbyCode').textContent = solo ? '—' : app.net.code;
  $('lobbyAddr').textContent = '';
  if (!solo) fetch('api/info').then((r) => r.json()).then((info) => { $('lobbyAddr').textContent = info.lan.length ? `Friends join with address ${info.lan[0]}:${info.port} (on the game's web page, or open http://${info.lan[0]}:${info.port})` : ''; }).catch(() => {});
  if (solo) { $('optAI').value = store.get('evil.soloAI', '3'); }
  app.ui.show('lobby');
  if (host) broadcastLobby(); else pushLobbySelf();
}
function pushLobbySelf() {
  if (!app.lobby) return;
  if (app.lobby.host) { const me = app.lobby.players.get(app.lobby.solo ? 1 : app.net.id); if (me) { me.loadout = { ...app.loadout }; me.name = app.name; } broadcastLobby(); return; }
  app.net.send('lobbySelf', { loadout: { ...app.loadout }, ready: app.lobby.ready }, app.net.hostId);
  $('btnReady').textContent = app.lobby.ready ? 'Not ready' : 'Ready';
}
function lobbyState() {
  const L = app.lobby;
  return { players: [...L.players.values()], opts: { diff: $('optDiff').value, ai: +$('optAI').value, chapter: +$('optChapter').value }, hostId: L.solo ? 1 : app.net.id };
}
function broadcastLobby() {
  const L = app.lobby; if (!L) return;
  // names come from the server roster
  if (!L.solo) for (const p of app.net.players) { const q = L.players.get(p.id); if (q) q.name = p.name; else L.players.set(p.id, { id: p.id, name: p.name, loadout: null, ready: false }); }
  L.state = lobbyState();
  if (!L.solo) app.net.send('lobbyState', L.state);
  renderLobby();
}
function renderLobby() {
  const L = app.lobby; if (!L || !L.state) return;
  const st = L.state; const meId = L.solo ? 1 : app.net.id;
  const rows = st.players.map((p) => {
    const lo = p.loadout; const what = lo ? `${STYLES[lo.style]?.name} · ${WEAPONS[lo.weapon]?.name}` : 'choosing a harness…';
    const ready = p.id === st.hostId ? 'host' : p.ready ? 'ready' : 'waiting';
    const kick = L.host && !L.solo && p.id !== meId ? `<button class="kick" data-kick="${p.id}" title="Remove from lobby">remove</button>` : '';
    return `<li class="${p.id === meId ? 'me' : ''}"><span class="shield" style="background:${heraldCss(lo?.heraldry || 'gules')}"></span><span>${esc(p.name)}<span class="what">${esc(what)}</span></span><span class="ready ${p.ready || p.id === st.hostId ? 'on' : ''}">${ready}${kick}</span></li>`;
  });
  const ai = Math.min(st.opts.ai, 5 - st.players.length);
  for (let i = 0; i < ai; i++) rows.push(`<li class="empty"><span class="shield" style="background:#555"></span><span>Companion knight<span class="what">fights beside you</span></span><span class="ready on">ready</span></li>`);
  for (let i = st.players.length + ai; i < 5; i++) rows.push(`<li class="empty"><span></span><span>An empty place</span><span></span></li>`);
  $('partyList').innerHTML = rows.join('');
  for (const b of document.querySelectorAll('[data-kick]')) b.onclick = () => app.net.kick(+b.dataset.kick);
  const allReady = st.players.every((p) => p.id === st.hostId || p.ready);
  $('btnStart').disabled = !allReady;
  $('lobbyMsg').textContent = L.host ? (allReady ? 'All are ready. Ride out when you will.' : 'Waiting for every knight to be ready.') : (L.ready ? 'Waiting for the host to ride out.' : 'Choose your harness, then mark yourself ready.');
  if (!L.host) { $('optDiff').value = st.opts.diff; }
}
function leaveLobby() { if (app.lobby && !app.lobby.solo) app.net.leave(); app.lobby = null; app.ui.show('title'); }

const AI_NAMES = ['Sir Hartmann', 'Sir Eberhard', 'Sir Gottfried', 'Sir Anselm'];
const AI_LOADOUTS = [
  { style: 'milanese', finish: 'bright', weapon: 'halberd', relic: 'reliquary', heraldry: 'azure', cape: true, plume: true },
  { style: 'gothic', finish: 'blued', weapon: 'zweihander', relic: 'medal', heraldry: 'vert', cape: false, plume: true },
  { style: 'maximilian', finish: 'blackened', weapon: 'mace', relic: 'water', heraldry: 'sable', cape: true, plume: false },
  { style: 'milanese', finish: 'russet', weapon: 'pike', relic: 'reliquary', heraldry: 'purpure', cape: true, plume: true },
];
function startFromLobby() {
  const L = app.lobby; if (!L || !L.host) return;
  const st = lobbyState();
  if (L.solo) store.set('evil.soloAI', String(st.opts.ai));
  const players = st.players.map((p) => ({ id: p.id, name: p.name, loadout: p.loadout || { ...app.loadout } }));
  const ai = Math.min(st.opts.ai, 5 - players.length);
  for (let i = 0; i < ai; i++) players.push({ id: 1000 + i, name: AI_NAMES[i], loadout: AI_LOADOUTS[i], ai: true });
  const m = { players, difficulty: st.opts.diff, chapter: st.opts.chapter };
  if (!L.solo) app.net.start(m);
  startGame(m);
}

function startGame(m) {
  const L = app.lobby;
  disposeMenuScene();
  app.ui.show(null); app.ui.setHud(true);
  const meId = L?.solo ? 1 : app.net.id;
  app.game = new Game(app, { isHost: !!L?.host, solo: !!L?.solo, players: m.players, meId, difficulty: m.difficulty, chapter: m.chapter });
  app.input.gameActive = true; app.paused = false;
  app.audio.init();
  app.game.loadChapter(m.chapter);
  app.input.lock();
}
app.endGame = (victory, toTitle = false) => {
  if (app.game) { app.game.dispose(); app.game = null; }
  app.input.gameActive = false; app.paused = false; app.input.unlock();
  app.ui.setHud(false); app.ui.letterbox(false); app.ui.subtitle(''); app.ui.downed(false); app.ui.fade(false); $('clickToPlay').hidden = true;
  buildMenuScene();
  if (toTitle || !app.lobby) { if (app.lobby && !app.lobby.solo) app.net.leave(); app.lobby = null; app.ui.show('title'); }
  else { app.lobby.ready = false; app.ui.show('lobby'); if (app.lobby.host) { const unlocked = store.get('evil.progress', 0); fillSelect('optChapter', chapterOptions(), Math.min(unlocked, CHAPTERS.length - 1)); broadcastLobby(); } else pushLobbySelf(); }
};
function pause() {
  app.paused = true; app.input.unlock();
  const solo = app.lobby?.solo;
  if (app.game && solo) app.game.paused = true;
  $('pauseNote').textContent = solo ? '' : 'The game continues for the rest of the company.';
  $('pLobby').hidden = !(solo || app.net.isHost);
  app.ui.show('pause');
}
function resume() { app.paused = false; if (app.game) app.game.paused = false; app.ui.show(null); app.input.lock(); }

// ---------------------------------------------------------------- loop
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  try {
    if (app.hold) app.hold(dt);
    else if (app.game) app.game.update(dt);
    else if (menu.world) menuUpdate(dt);
  } catch (err) { console.error(err); showFatal(err); }
  app.input.endFrame();
  requestAnimationFrame(loop);
}
let fatalShown = false;
function showFatal(err) {
  if (fatalShown) return; fatalShown = true;
  const el = document.createElement('div'); el.className = 'panel narrow'; el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99';
  el.innerHTML = `<h2>Something broke</h2><p class="muted small">${esc(err && err.message || err)}</p><p class="small">The game will try to continue. If it stays broken, reload the page.</p><div class="row"><button class="btn primary">Continue</button></div>`;
  el.querySelector('button').onclick = () => { el.remove(); fatalShown = false; };
  document.body.appendChild(el);
}

boot().catch((e) => { console.error(e); app.ui?.boot(1, 'Could not start: ' + e.message); });
