// DOM interface: screens, HUD, overlays.
import { HERALDRY, RELICS } from './knight.js';
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export class UI {
  constructor() {
    this.subsOn = true; this.toastT = 0; this.subT = 0; this.lagHp = 1; this.lagBoss = 1;
    this.navMode = false; this.setupNav();
  }
  // show one menu screen (or none); the HUD is toggled separately
  show(id) {
    for (const s of document.querySelectorAll('.screen')) if (s.id !== 'hud') s.classList.toggle('show', s.id === id);
    this.current = id;
    // playing by keyboard or pad: put the focus on the new screen's first control
    if (id && this.navMode) requestAnimationFrame(() => { const f = this.focusables(); if (f.length && !$(id).contains(document.activeElement)) f[0].focus({ preventScroll: true }); });
  }
  // ---- menus by keyboard and by game pad: arrows / d-pad move between controls, Enter / A presses, B goes back
  focusables() {
    const scr = this.current && $(this.current); if (!scr) return [];
    const shop = $('shop'); const root = shop && shop.classList.contains('show') ? shop : scr;
    return [...root.querySelectorAll('button, select, input, a[href]')].filter((n) => !n.disabled && n.offsetParent !== null && getComputedStyle(n).visibility !== 'hidden');
  }
  moveFocus(dir) {
    const f = this.focusables(); if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    f[i < 0 ? 0 : (i + dir + f.length) % f.length].focus({ preventScroll: false });
  }
  back() {
    const scr = this.current && $(this.current); if (!scr) return;
    const b = scr.querySelector('[data-back], #joinBack, #hostBack, #setBack, #howBack, #pResume'); if (b && b.offsetParent !== null) b.click();
  }
  setupNav() {
    addEventListener('pointermove', () => { this.navMode = false; }, { passive: true });
    addEventListener('keydown', (e) => {
      if (!this.current || this.current === 'boot' || document.getElementById('intro')) return;
      const a = document.activeElement, typing = a && (a.tagName === 'INPUT' && !['checkbox', 'range', 'button'].includes(a.type) || a.tagName === 'SELECT');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (typing && a.tagName === 'SELECT') return;   // a select's own arrows change its value
        this.navMode = true; e.preventDefault(); this.moveFocus(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Tab') this.navMode = true;
    });
    // game pads: polled only while a menu screen is up
    const pad = { held: {}, next: 0 };
    const poll = (now) => {
      requestAnimationFrame(poll);
      if (!this.current || this.current === 'boot' || !navigator.getGamepads) return;
      const gp = [...navigator.getGamepads()].find((g) => g && g.connected); if (!gp) return;
      const B = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed), ax = gp.axes[1] || 0, axX = gp.axes[0] || 0;
      const up = B(12) || ax < -0.6, down = B(13) || ax > 0.6, left = B(14) || axX < -0.6, right = B(15) || axX > 0.6;
      const edge = (k, on) => { const was = pad.held[k]; pad.held[k] = on; return on && !was; };
      const rep = (k, on) => { if (!on) { pad.held[k] = false; return false; } if (!pad.held[k]) { pad.held[k] = true; pad.next = now + 380; return true; } if (now > pad.next) { pad.next = now + 120; return true; } return false; };
      if (rep('up', up)) { this.navMode = true; this.moveFocus(-1); }
      if (rep('down', down)) { this.navMode = true; this.moveFocus(1); }
      const a = document.activeElement;
      const lr = rep('left', left) ? -1 : rep('right', right) ? 1 : 0;
      if (lr && a) {
        if (a.type === 'range') { const s = +a.step || 0.01; a.value = Math.min(+a.max, Math.max(+a.min, +a.value + lr * s * 4)); a.dispatchEvent(new Event('input', { bubbles: true })); a.dispatchEvent(new Event('change', { bubbles: true })); }
        else if (a.tagName === 'SELECT') { a.selectedIndex = Math.min(a.options.length - 1, Math.max(0, a.selectedIndex + lr)); a.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      if (edge('a', B(0))) { this.navMode = true; if (a && a !== document.body) { if (a.type === 'checkbox') { a.checked = !a.checked; a.dispatchEvent(new Event('change', { bubbles: true })); } else a.click(); } else this.moveFocus(0); }
      if (edge('b', B(1))) this.back();
    };
    requestAnimationFrame(poll);
  }
  setHud(on) { $('hud').classList.toggle('show', on); }
  overlay(id, on) { $(id).classList.toggle('show', on); }
  boot(frac, msg) { $('bootBar').style.width = Math.round(frac * 100) + '%'; if (msg) $('bootMsg').textContent = msg; }
  letterbox(on) { $('letterTop').classList.toggle('on', on); $('letterBot').classList.toggle('on', on); document.body.classList.toggle('cine', on); $('hud').style.opacity = on ? 0 : 1; }
  subtitle(text, dur = 0) {
    const el = $('subtitle');
    if (!text || !this.subsOn) { el.classList.remove('show'); return; }
    if (Array.isArray(text)) el.innerHTML = `${esc(text[0])}<span class="tr">${esc(text[1])}</span>`; else el.textContent = text;
    el.classList.add('show'); this.subT = dur;
  }
  hint(t) { $('hint').textContent = t || ''; }
  chapterCard({ num, title, latin }, hold = 4.2) {
    $('cardNum').textContent = num !== undefined ? `Chapter ${ROMAN[num] || num + 1}` : '';
    $('cardTitle').textContent = title; $('cardLatin').textContent = latin || '';
    $('card').classList.add('show'); clearTimeout(this._card); this._card = setTimeout(() => $('card').classList.remove('show'), hold * 1000);
  }
  fade(on) { $('fade').classList.toggle('on', on); }
  toast(text, dur = 3) { const el = $('toast'); el.textContent = text; el.classList.add('show'); this.toastT = dur; }
  objective(t) { if (this._obj !== t) { $('objective').textContent = t; this._obj = t; } }
  counter(t) { if (this._cnt !== t) { $('counter').textContent = t; this._cnt = t; } }
  prompt(html) { const el = $('prompt'); if (!html) { el.hidden = true; return; } if (this._pr !== html) { el.innerHTML = html; this._pr = html; } el.hidden = false; }
  downed(on) { $('downed').hidden = !on; }
  hurt(a) { $('hurt').style.opacity = Math.min(1, a); }
  hitMark() { const c = $('crosshair'); c.classList.add('hit'); clearTimeout(this._hm); this._hm = setTimeout(() => c.classList.remove('hit'), 90); }

  setSelf(k) {
    $('weaponName').textContent = WEAPONS[k.loadout.weapon].name;
    $('relicName').textContent = RELICS[k.loadout.relic].name;
  }
  updateSelf(k) {
    const hp = Math.max(0, k.hp / k.maxHp);
    $('hpBar').style.width = hp * 100 + '%';
    if (hp < this.lagHp) setTimeout(() => {}, 0);
    this.lagHp = hp; $('hpLag').style.width = hp * 100 + '%';
    $('stBar').style.width = Math.max(0, k.stamina / k.maxStamina) * 100 + '%';
    const cd = k.relicCd / RELICS[k.loadout.relic].cooldown;
    $('relicCd').style.width = Math.max(0, cd) * 100 + '%';
    $('relic').classList.toggle('ready', k.relicCd <= 0);
  }
  party(knights, meId) {
    const el = $('partyFrames');
    const key = knights.map((k) => k.id).join(',');
    if (this._partyKey !== key) {
      this._partyKey = key;
      el.innerHTML = knights.map((k) => `<li data-id="${k.id}"><span class="shield" style="background:${heraldCss(k.loadout.heraldry)}"></span><span class="nm"><span>${esc(k.name)}${k.id === meId ? '' : ''}</span><span class="st"></span></span><span class="mini"><i></i></span></li>`).join('');
    }
    for (const k of knights) {
      const li = el.querySelector(`li[data-id="${k.id}"]`); if (!li) continue;
      li.querySelector('.mini i').style.width = Math.max(0, k.hp / k.maxHp) * 100 + '%';
      const st = li.querySelector('.st');
      const s = k.downed ? (k.reviveProgress > 0 ? `rising ${Math.round(k.reviveProgress * 100)}%` : 'fallen') : k.praying ? 'praying' : '';
      if (st.textContent !== s) { st.textContent = s; st.classList.toggle('down', k.downed); }
    }
  }
  prayer(show, frac, count) {
    $('prayer').hidden = !show; if (!show) return;
    $('prayerArc').style.strokeDashoffset = (326.7 * (1 - frac)).toFixed(1);
    $('prayerPct').textContent = Math.floor(frac * 100) + '%';
    $('prayerCount').textContent = count ? `${count} at prayer` : 'No one is praying';
  }
  boss(b) {
    const bar = $('bossbar');
    if (!b) { bar.hidden = true; return; }
    bar.hidden = false;
    if (this._bossName !== b.name) { $('bossName').textContent = b.name; $('bossSub').textContent = b.title || ''; this._bossName = b.name; this.lagBoss = 1; }
    const f = Math.max(0, b.hp / b.maxHp);
    $('bossHp').style.width = f * 100 + '%'; $('bossHpLag').style.width = f * 100 + '%';
  }
  compass(camYaw, marks) {
    // marks: [{yaw, kind}] yaw = world bearing
    const strip = $('compassStrip'); const W = strip.clientWidth || 500; const span = Math.PI * 0.9;
    const items = [['N', Math.PI], ['E', Math.PI / 2], ['S', 0], ['W', -Math.PI / 2], ['NE', Math.PI * 0.75], ['SE', Math.PI * 0.25], ['SW', -Math.PI * 0.25], ['NW', -Math.PI * 0.75]];
    let html = '';
    const place = (yaw) => { let d = yaw - camYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) > span / 2) return null; return W / 2 - (d / span) * W; };
    for (const [n, y] of items) { const x = place(y); if (x !== null) html += `<span class="${n.length === 1 ? 'card' : ''}" style="left:${x.toFixed(0)}px">${n}</span>`; }
    for (const m of marks) { const x = place(m.yaw); if (x !== null) html += `<span class="mk ${m.kind}" style="left:${x.toFixed(0)}px">${m.kind === 'boss' ? '◆' : m.kind === 'page' ? '❦' : '✝'}</span>`; }
    if (html !== this._cmp) { strip.innerHTML = html; this._cmp = html; }
  }
  update(dt) {
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('show'); }
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) $('subtitle').classList.remove('show'); }
  }
}
export function heraldCss(h) { const c = (HERALDRY[h] || HERALDRY.gules).cloth; return `rgb(${c[0]},${c[1]},${c[2]})`; }
export function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
