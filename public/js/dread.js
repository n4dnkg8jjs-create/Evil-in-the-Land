// Dread: the fear the First Company wrote about. It is yours alone (every player
// has their own, nothing about it is shared over the network) and it rises when
// you stand alone in the blight, when demons close in, when He watches, when you
// bleed. It falls when you pray, stand in the light of a cleansed altar, keep
// close to your brothers, or strike one of them down.
// As it climbs the world closes in: your heart pounds, voices whisper at your
// ear, the edges of sight go dark, and things that are not there begin to stand
// at the corner of your eye. Look at one and it is gone. At its worst your hands
// shake (you hit softer, tire faster), and sometimes, when you turn round, He is
// standing right behind you.
import * as THREE from 'three';
import { Demon, ST } from './demons.js';
import { phantomDevil, releasePhantom } from './devil.js';
import { clamp, damp, TAU } from './util.js';

const R = Math.random;
const PHANTOMS = ['shade', 'crawler', 'wretch', 'shade'];

export class Dread {
  constructor(game) {
    this.g = game; this.level = 0; this.shown = 0; this.revealed = false;
    this.phantoms = []; this.pid = 0; this.nextPhantom = 10; this.nextWhisper = 6; this.nextBeat = 0; this.nextDevil = 30;
    this.devil = null; this.devilT = 0; this.lastHp = null; this.lastKills = 0;
    this.veil = document.getElementById('dreadVeil'); this.bar = document.getElementById('dreadBar'); this.box = document.getElementById('dread');
  }
  reveal() {
    if (this.revealed) return; this.revealed = true; this.box?.removeAttribute('hidden');
    this.g.ui.toast('Dread: stay with your brothers, pray, keep to the light', 5);
  }
  // how alone is a knight: allies near enough to matter
  alliesNear(me, r) { let n = 0; for (const k of this.g.knightList) if (k !== me && !k.downed && k.pos.distanceTo(me.pos) < r) n++; return n; }

  update(dt, time) {
    const g = this.g, me = g.me, w = g.world, o = g.obj;
    if (!w || !o || !me) return;
    const calm = o.ph === 'intro' || o.ph === 'outro' || o.ph === 'cleansed' || g.cinema.active || me.downed;
    let rise = 0, fall = 0;
    if (!calm) {
      const life = w.lifeAt(me.pos.x, me.pos.z);
      rise += (1 - life) * 0.006;
      let near = 0; for (const d of g.horde.list) if (d.alive && d.pos.distanceTo(me.pos) < 14) near++;
      rise += Math.min(0.05, near * 0.0075);
      const wt = g.watcher; if (wt && (wt.state === 'watch' || wt.state === 'turn') && wt.pos.distanceTo(me.pos) < 220) rise += 0.012;
      if (me.hp / me.maxHp < 0.35) rise += 0.01;
      const others = g.knightList.filter((k) => k !== me && !k.downed).length;
      const allies = this.alliesNear(me, 14);
      if (others && !allies) { rise = rise * 1.7 + 0.004; this.alone = true; } else this.alone = false;
      fall += Math.min(0.03, this.alliesNear(me, 6) * 0.012);
      if (life > 0.7) fall += 0.02;
      rise *= 0.7 + 0.8 * (g.terror ? g.terror.level : 0.5);   // deeper into the blight, the fear comes faster
      if (me.blessT > 0) rise *= 0.55;   // Father Bertram's blessing keeps the fear off
    } else fall += 0.1;
    if (me.praying) fall += 0.07 * (me.prayMul || 1);
    if (g.shop?.inSanctuary(me.pos)) fall += 0.12;   // the priest's sanctuary keeps it off
    for (const a of w.altars) if (a.state === 'cleansed' && Math.hypot(a.x - me.pos.x, a.z - me.pos.z) < 12) { fall += 0.05; break; }
    // wounds feed it; kills starve it
    if (this.lastHp !== null && me.hp < this.lastHp - 0.5) rise += (this.lastHp - me.hp) / me.maxHp * 0.6 / Math.max(dt, 1e-3);
    this.lastHp = me.hp;
    if (g.stats.kills > this.lastKills) { this.level -= 0.03 * (g.stats.kills - this.lastKills); this.lastKills = g.stats.kills; }
    // the dread climbs fast but leaves slowly
    this.level = clamp(this.level + (rise - fall) * dt, 0, 1);
    if (!this.revealed && this.level > 0.3) this.reveal();
    const L = this.level;
    this.shown = damp(this.shown, L, 3, dt);
    // shaking hands
    me.dreadMul = L > 0.75 ? 0.8 : 1; me.dreadStam = L > 0.75 ? 0.75 : 1;
    // the edges of sight close in, colour drains away
    if (this.veil) this.veil.style.opacity = String(clamp((this.shown - 0.3) / 0.6, 0, 1) * 0.85);
    if (this.bar) { this.bar.style.width = (this.shown * 100).toFixed(1) + '%'; this.box?.classList.toggle('high', L > 0.75); }
    g.engine.fx.dreadDesat = clamp((L - 0.4) / 0.5, 0, 1) * 0.4;
    // heartbeat and whispers
    if (L > 0.5 && !calm) { this.nextBeat -= dt; if (this.nextBeat <= 0) { this.nextBeat = 1.4 - L * 0.7; g.audio.heartbeat(0.2 + L * 0.3); } }
    if (L > 0.4 && !calm) {
      this.nextWhisper -= dt;
      if (this.nextWhisper <= 0) {
        this.nextWhisper = 5 + R() * 8 - L * 3;
        const a = R() * TAU, cam = g.engine.camera.position;
        g.audio.whisper({ x: cam.x + Math.cos(a) * 1.2, y: cam.y, z: cam.z + Math.sin(a) * 1.2 }, 1.5 + R() * 1.5, 0.25 + L * 0.25);
        if (R() < 0.35) g.audio.stinger('breath', 0.2 + L * 0.2);
      }
    }
    // things at the corner of the eye
    if (L > 0.5 && !calm) {
      this.nextPhantom -= dt;
      if (this.nextPhantom <= 0 && this.phantoms.length < 2) { this.nextPhantom = 6 + R() * 8 - L * 4; this.spawnPhantom(L > 0.7 && R() < 0.45 ? 'rush' : 'lurk'); }
    }
    if (L > 0.8 && !calm) { this.nextDevil -= dt; if (this.nextDevil <= 0 && !this.devilT) { this.nextDevil = 25 + R() * 20; this.devilBehind(); } }
    this.updatePhantoms(dt, time);
    this.updateDevil(dt, time);
  }

  camBasis() {
    const cam = this.g.engine.camera; const f = new THREE.Vector3(); cam.getWorldDirection(f); f.y = 0; f.normalize();
    return { cam: cam.position, f };
  }
  // how squarely the camera looks at a point (cosine)
  lookedAt(p) {
    const { cam } = this.camBasis(); const f = new THREE.Vector3(); this.g.engine.camera.getWorldDirection(f);
    const d = new THREE.Vector3(p.x - cam.x, p.y + 1.2 - cam.y, p.z - cam.z).normalize();
    return f.dot(d);
  }
  spawnPhantom(kind) {
    const g = this.g, w = g.world, me = g.me;
    const { f } = this.camBasis(); const base = Math.atan2(f.x, f.z);
    const side = R() < 0.5 ? -1 : 1;
    const ang = base + (kind === 'rush' ? Math.PI + (R() - 0.5) * 0.6 : side * (0.95 + R() * 0.45));
    const dist = kind === 'rush' ? 15 + R() * 4 : 11 + R() * 9;
    const x = me.pos.x + Math.sin(ang) * dist, z = me.pos.z + Math.cos(ang) * dist;
    if (!w.inBounds(x, z)) return;
    const d = new Demon(PHANTOMS[Math.floor(R() * PHANTOMS.length)], -1000 - this.pid++, g.scene);
    d.pos.set(x, w.heightAt(x, z), z); d.yaw = Math.atan2(me.pos.x - x, me.pos.z - z);
    d.setState(kind === 'rush' ? ST.chase : ST.chase); d.stateT = 2; d.mesh.castShadow = false;
    this.phantoms.push({ d, kind, t: 0, seen: 0 });
    if (kind === 'rush') g.audio.scream(new THREE.Vector3(x, d.pos.y + 1.4, z), false, 0.45, 0.9);
  }
  vanish(p, loud) {
    const d = p.d; if (!d.alive) return;
    d.alive = false; d.setState(ST.dead);
    this.g.fx.wisp(d.chest, 1.2); this.g.fx.wisp(d.chest, 0.9);
    if (loud) { this.g.audio.scream(d.chest, false, 0.55, 0.85); this.g.engine.shake(0.35, 0.3); this.level = Math.min(1, this.level + 0.05); }
    else this.g.audio.whisper(d.chest, 0.8, 0.3);
  }
  updatePhantoms(dt, time) {
    const g = this.g, me = g.me, w = g.world;
    for (let i = this.phantoms.length - 1; i >= 0; i--) {
      const p = this.phantoms[i], d = p.d; p.t += dt;
      if (d.alive) {
        const to = new THREE.Vector3(me.pos.x - d.pos.x, 0, me.pos.z - d.pos.z); const dist = to.length(); to.divideScalar(dist || 1);
        d.yaw = Math.atan2(to.x, to.z);
        if (p.kind === 'rush') {
          d.vel.set(to.x * 9, 0, to.z * 9); d.pos.addScaledVector(d.vel, dt); d.pos.y = w.heightAt(d.pos.x, d.pos.z);
          if (dist < 1.8 || p.t > 5) this.vanish(p, dist < 1.8);
        } else {
          d.vel.set(0, 0, 0);
          // look straight at it and it is not there
          if (this.lookedAt(d.pos) > 0.92) p.seen += dt; else p.seen = 0;
          if (p.seen > 0.25 || p.t > 9 || dist < 4) this.vanish(p, false);
        }
      }
      d.animate(dt, time, w, g.fx, g.engine.camera.position);
      if (d.removed || (!d.alive && p.t > 6)) { d.dispose(); this.phantoms.splice(i, 1); }
    }
  }
  // turn round, and He is there
  devilBehind() {
    const g = this.g, me = g.me, w = g.world;
    if (g.terror?.active?.figure) return;   // He is already standing on the road ahead
    this.devil = phantomDevil(g); this.devil.owner = 'dread';
    const { f } = this.camBasis(); const ang = Math.atan2(f.x, f.z) + Math.PI + (R() - 0.5) * 0.5, dist = 8 + R() * 3;
    const x = me.pos.x + Math.sin(ang) * dist, z = me.pos.z + Math.cos(ang) * dist;
    if (!w.inBounds(x, z)) return;
    const D = this.devil; D.pos.set(x, w.heightAt(x, z), z); D.yaw = Math.atan2(me.pos.x - x, me.pos.z - z);
    D.state = 'watch'; D.t = 2; D.mesh.visible = true; this.devilT = 0.001; this.devilSeen = 0;
  }
  updateDevil(dt, time) {
    const D = this.devil; if (!D || !this.devilT) return;
    this.devilT += dt;
    D.t += dt;
    const look = this.lookedAt(D.pos.clone().setY(D.pos.y + 1.5));
    if (D.state === 'watch') {
      if (look > 0.85) { this.devilSeen += dt; if (this.devilSeen > 0.5) { D.state = 'vanish'; D.t = 0; this.g.audio.stinger('cluster', 0.6); this.g.audio.scream(D.pos.clone().setY(D.pos.y + 3), true, 0.5, 0.8); this.g.engine.shake(0.4, 0.4); this.level = Math.min(1, this.level + 0.08); } }
      if (this.devilT > 7) { D.state = 'vanish'; D.t = 0; }
    }
    D.animate(dt, time, this.g.engine.camera.position, [this.g.me]);
    if (D.state === 'vanish' && D.t > 1.3) { releasePhantom(D, 'dread'); this.devilT = 0; }
  }
  clear() {
    for (const p of this.phantoms) p.d.dispose(); this.phantoms.length = 0;
    if (this.devil) { releasePhantom(this.devil, 'dread'); this.devilT = 0; }
    this.level = Math.min(this.level, 0.2); this.lastHp = null;
  }
  dispose() { this.clear(); this.devil = null; }
}
