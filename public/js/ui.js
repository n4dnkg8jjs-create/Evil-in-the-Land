// DOM interface: screens, HUD, overlays.
import { HERALDRY, RELICS } from './knight.js';
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export class UI {
  constructor() {
    this.subsOn = true; this.toastT = 0; this.subT = 0; this.lagHp = 1; this.lagBoss = 1;
  }
  // show one menu screen (or none); the HUD is toggled separately
  show(id) {
    for (const s of document.querySelectorAll('.screen')) if (s.id !== 'hud') s.classList.toggle('show', s.id === id);
    this.current = id;
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
