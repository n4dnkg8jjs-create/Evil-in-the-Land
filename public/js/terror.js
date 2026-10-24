// The fear builds. Each chapter deeper into the blight the dread comes faster and things happen on the road
// that should not: He stands in the middle of the way ahead, waiting, and is gone when you look again; something
// pale runs across the road in the fog; the whole world falls silent before a scream right at your back; footsteps
// behind you, and nothing there; your own name, whispered; the light goes out and the dark is full of eyes.
// Like the dread, all of it is yours alone: every player is frightened on their own machine.
import * as THREE from 'three';
import { Demon, ST } from './demons.js';
import { Watcher } from './devil.js';
import { clamp, TAU } from './util.js';

const R = Math.random;
// how frightening each chapter is, 0..1
export const TERROR = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0];
// scares: the first chapter (index) in which each may happen
const SCARES = { roadFigure: 0, crossing: 1, silence: 2, footsteps: 2, name: 3, eyes: 4, behindYou: 5 };

export class Terror {
  constructor(game) { this.g = game; this.next = 50; this.active = null; this.figure = null; this.used = {}; }
  get level() { return TERROR[this.g.chapterIdx] ?? 0.5; }
  reset() { this.end(); this.next = 35 + R() * 30; this.used = {}; }

  // only when the knight is on the road, not in the middle of a fight or a prayer, and not in a cinematic
  quiet() {
    const g = this.g, o = g.obj, me = g.me;
    if (!o || o.ph !== 'travel' || g.cinema.active || me.downed || g.boss) return false;
    if (g.shop?.inSanctuary(me.pos, 15)) return false;
    for (const d of g.horde.list) if (d.alive && d.pos.distanceTo(me.pos) < 22) return false;
    return true;
  }
  update(dt, time) {
    const g = this.g; if (!g.world) return;
    g.audio.terror = this.level;
    if (this.active) { if (!this.active.done && this.active.update) this.active.update(dt, time); if (this.active.done) this.end(); return; }
    if (!this.quiet()) return;
    this.next -= dt;
    if (this.next > 0) return;
    // later chapters: more often
    this.next = (70 - 40 * this.level) * (0.7 + R() * 0.6);
    const pool = Object.entries(SCARES).filter(([k, c]) => g.chapterIdx >= c && (this.used[k] || 0) < 2);
    if (!pool.length) return;
    // favour the ones not yet seen this chapter
    pool.sort((a, b) => (this.used[a[0]] || 0) - (this.used[b[0]] || 0) + (R() - 0.5) * 0.9);
    const kind = pool[0][0]; this.used[kind] = (this.used[kind] || 0) + 1;
    this.active = this[kind]();
  }
  end() { if (this.active && this.active.cleanup) this.active.cleanup(); this.active = null; }

  // ---------------------------------------------------------------- helpers
  camFwd() { const f = new THREE.Vector3(); this.g.engine.camera.getWorldDirection(f); f.y = 0; return f.normalize(); }
  lookedAt(p, h = 1.2) {
    const cam = this.g.engine.camera, f = new THREE.Vector3(); cam.getWorldDirection(f);
    return f.dot(new THREE.Vector3(p.x - cam.position.x, p.y + h - cam.position.y, p.z - cam.position.z).normalize());
  }
  ahead(dist, side = 0) {   // a point on the road ahead of the knight
    const g = this.g, w = g.world, me = g.me.pos; const nr = w.path.nearest(me.x, me.z);
    const step = dist / 260; const p = w.path.at(clamp(nr.t + step, 0, 1)), q = w.path.at(clamp(nr.t + step + 0.01, 0, 1));
    let nx = -(q.z - p.z), nz = q.x - p.x; const l = Math.hypot(nx, nz) || 1;
    const x = p.x + nx / l * side, z = p.z + nz / l * side; return new THREE.Vector3(x, w.heightAt(x, z), z);
  }
  devil() { if (!this.figure) this.figure = new Watcher(this.g.scene, this.g.fx); return this.figure; }

  // ---------------------------------------------------------------- the scares
  // He stands in the middle of the road ahead. Walk toward him, or look away and back, and he is gone.
  roadFigure() {
    const g = this.g, D = this.devil(), p = this.ahead(28 + R() * 8);
    if (!g.world.inBounds(p.x, p.z)) return { done: true };
    D.pos.copy(p); D.yaw = Math.atan2(g.me.pos.x - p.x, g.me.pos.z - p.z); D.state = 'watch'; D.t = 2; D.retarget = 0; D.mesh.visible = true;
    let seen = false, away = 0, t = 0;
    return {
      update: (dt, time) => {
        t += dt; D.t += dt; const look = this.lookedAt(D.pos, 3);
        if (look > 0.9 && !seen) { seen = true; g.audio.stinger('drone', 0.55); g.audio.heartbeat(0.45); g.dread.level = Math.min(1, g.dread.level + 0.12); }
        if (seen && look < 0.5) away += dt; else away = Math.max(0, away - dt);
        const d = D.pos.distanceTo(g.me.pos);
        if (D.state === 'watch' && (d < 20 || away > 1.6 || t > 30)) { D.state = away > 1.6 ? 'hidden' : 'vanish'; D.t = 0; if (D.state === 'vanish') g.audio.whisper(D.pos.clone().setY(D.pos.y + 3), 1.5, 0.6); }
        D.animate(dt, time, g.engine.camera.position, [g.me]);
        if (D.state === 'hidden' || (D.state === 'vanish' && D.t > 1.3)) { D.state = 'hidden'; D.mesh.visible = false; this.active.done = true; }
      },
      cleanup: () => { D.state = 'hidden'; D.mesh.visible = false; },
    };
  }
  // something pale and fast crosses the road ahead, in and out of the fog
  crossing() {
    const g = this.g; const side = R() < 0.5 ? -1 : 1;
    const a = this.ahead(18 + R() * 8, side * 16), b = this.ahead(18 + R() * 8, -side * 22);
    if (!g.world.inBounds(a.x, a.z) || !g.world.inBounds(b.x, b.z)) return { done: true };
    const d = new Demon(R() < 0.6 ? 'crawler' : 'shade', -2000, g.scene); d.pos.copy(a); d.setState(ST.chase); d.stateT = 2; d.mesh.castShadow = false;
    const dir = b.clone().sub(a); const len = dir.length(); dir.normalize(); d.yaw = Math.atan2(dir.x, dir.z);
    let t = 0, gone = false;
    g.audio.chatter(a, 0.5);
    return {
      update: (dt, time) => {
        t += dt;
        if (!gone) { d.vel.set(dir.x * 11, 0, dir.z * 11); d.pos.addScaledVector(d.vel, dt); d.pos.y = g.world.heightAt(d.pos.x, d.pos.z); if (t * 11 > len) { gone = true; d.alive = false; d.setState(ST.dead); g.fx.wisp(d.chest, 1); } }
        d.animate(dt, time, g.world, g.fx, g.engine.camera.position);
        if (gone && (d.removed || t > 6)) this.active.done = true;
      },
      cleanup: () => d.dispose(),
    };
  }
  // the world goes silent; then something screams right behind you
  silence() {
    const g = this.g; let t = 0, fired = false; const quiet = 3.5 + R() * 2;
    g.audio.silence(quiet + 0.4);
    return {
      update: (dt) => {
        t += dt;
        if (!fired && t > quiet) {
          fired = true; const f = this.camFwd(); const me = g.me.pos;
          const p = new THREE.Vector3(me.x - f.x * 2.5, me.y + 1.6, me.z - f.z * 2.5);
          g.audio.scream(p, false, 0.85, 0.9); g.engine.shake(0.5, 0.35); g.engine.fx.hurt = Math.max(g.engine.fx.hurt, 0.35);
          g.dread.level = Math.min(1, g.dread.level + 0.15);
        }
        if (t > quiet + 1.5) this.active.done = true;
      },
    };
  }
  // footsteps behind, keeping pace; turn round and there is no one
  footsteps() {
    const g = this.g; let t = 0, n = 0; const steps = 5 + Math.floor(R() * 4);
    return {
      update: (dt) => {
        t += dt;
        if (t > 0.55 * n + 0.4 && n < steps) {
          n++; const f = this.camFwd(), me = g.me.pos; const back = 4.5 - n * 0.35;
          g.audio.footstep(new THREE.Vector3(me.x - f.x * back, me.y, me.z - f.z * back), true, 1.4);
        }
        if (n >= steps && t > 0.55 * n + 1) { g.audio.whisper(g.engine.camera.position.clone().add(new THREE.Vector3(0, 0, 0.4)), 1.2, 0.4); g.dread.level = Math.min(1, g.dread.level + 0.08); this.active.done = true; }
      },
    };
  }
  // your own name, at your ear
  name() {
    const g = this.g; const nm = g.me.name || 'knight';
    const f = this.camFwd(); const p = g.engine.camera.position.clone().addScaledVector(f, -0.6);
    g.audio.whisper(p, 2.2, 0.75); g.ui.subtitle([`…${nm}…`, ''], 3);
    g.dread.level = Math.min(1, g.dread.level + 0.1);
    return { done: true };
  }
  // the light goes out; in the dark, all round, eyes
  eyes() {
    const g = this.g, me = g.me.pos, e = g.engine; const base = e.renderer.toneMappingExposure;
    const grp = new THREE.Group(); g.scene.add(grp);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.08, 0.02).multiplyScalar(4), toneMapped: false, fog: false });
    const eg = new THREE.SphereGeometry(0.05, 6, 4);
    for (let k = 0; k < 14; k++) {
      const a = R() * TAU, d = 14 + R() * 16, x = me.x + Math.cos(a) * d, z = me.z + Math.sin(a) * d; const y = g.world.heightAt(x, z) + 0.6 + R() * 1.6;
      const pair = new THREE.Group(); pair.position.set(x, y, z); pair.lookAt(me.x, y, me.z);
      for (const s of [-1, 1]) { const m = new THREE.Mesh(eg, mat); m.position.x = s * 0.09; pair.add(m); }
      grp.add(pair); pair.userData.blink = R() * 5;
    }
    let t = 0; g.audio.silence(5.5); g.audio.stinger('breath', 0.6);
    return {
      update: (dt, time) => {
        t += dt; const k = t < 0.8 ? t / 0.8 : t > 5 ? Math.max(0, 1 - (t - 5) / 0.8) : 1;
        e.renderer.toneMappingExposure = base * (1 - 0.8 * k);
        grp.visible = k > 0.6;
        for (const p of grp.children) p.visible = Math.sin(time * 1.3 + p.userData.blink * 7) > -0.9;
        if (t > 2.5 && t < 2.6) for (let i = 0; i < 3; i++) g.audio.whisper(new THREE.Vector3(me.x + (R() - 0.5) * 6, me.y + 1.5, me.z + (R() - 0.5) * 6), 1.5, 0.4);
        if (t > 5.9) { e.renderer.toneMappingExposure = base; this.active.done = true; }
      },
      cleanup: () => { e.renderer.toneMappingExposure = base; grp.removeFromParent(); eg.dispose(); mat.dispose(); g.dread.level = Math.min(1, g.dread.level + 0.15); },
    };
  }
  // late on, whatever your dread: turn round, and He is there
  behindYou() { this.g.dread.devilBehind(); return { done: true }; }
  dispose() { this.end(); if (this.figure) { this.g.scene.remove(this.figure.mesh); this.figure = null; } }
}
