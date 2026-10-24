// Cinematic camera: scripted shots with easing, letterboxing and subtitles.
import * as THREE from 'three';
import { clamp, easeInOut, smooth } from './util.js';

export class Cinema {
  constructor(engine, ui) {
    this.engine = engine; this.ui = ui; this.shots = null; this.t = 0; this.idx = 0; this.onDone = null; this.active = false;
    this.cam = engine.camera; this.lb = 0; this.skippable = true;
  }
  // shots: [{ dur, from:{pos,look}, to:{pos,look}, fov?, fovTo?, ease?, text?, title?, shake?, at?: fn }]
  play(shots, onDone, { skippable = true } = {}) {
    this.shots = shots; this.t = 0; this.idx = 0; this.onDone = onDone; this.active = true; this.skippable = skippable; this.fired = new Set();
    this.ui.letterbox(true); this.ui.hint(skippable ? 'Hold Space to skip' : '');
  }
  skip() { if (!this.active || !this.skippable) return; this.finish(); }
  finish() {
    this.active = false; this.ui.letterbox(false); this.ui.subtitle(''); this.ui.hint('');
    const cb = this.onDone; this.onDone = null; this.shots = null; if (cb) cb();
  }
  update(dt) {
    if (!this.active) return false;
    const s = this.shots[this.idx];
    this.t += dt;
    const k = clamp(this.t / s.dur, 0, 1); const e = (s.ease || easeInOut)(k);
    const fp = s.from.pos, tp = s.to.pos, fl = s.from.look, tl = s.to.look;
    this.cam.position.set(fp.x + (tp.x - fp.x) * e, fp.y + (tp.y - fp.y) * e, fp.z + (tp.z - fp.z) * e);
    const look = new THREE.Vector3(fl.x + (tl.x - fl.x) * e, fl.y + (tl.y - fl.y) * e, fl.z + (tl.z - fl.z) * e);
    this.cam.up.set(0, 1, 0); this.cam.lookAt(look);
    if (s.roll) this.cam.rotateZ(s.roll * (1 - e));
    const fov = s.fov ? s.fov + ((s.fovTo ?? s.fov) - s.fov) * e : 50;
    if (Math.abs(this.cam.fov - fov) > 0.01) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    if (!this.fired.has(this.idx)) {
      this.fired.add(this.idx);
      if (s.text !== undefined) this.ui.subtitle(s.text);
      if (s.title) this.ui.chapterCard(s.title);
      if (s.at) s.at();
      if (s.shake) this.engine.shake(s.shake, s.dur);
    }
    if (this.t >= s.dur) { this.idx++; this.t = 0; if (this.idx >= this.shots.length) this.finish(); }
    return true;
  }
}

// helpers to compose shots around a point of interest
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export function orbitShot(center, r, h, a0, a1, dur, lookY = 1.5, extra = {}) {
  return { dur, from: { pos: V(center.x + Math.sin(a0) * r, center.y + h, center.z + Math.cos(a0) * r), look: V(center.x, center.y + lookY, center.z) }, to: { pos: V(center.x + Math.sin(a1) * r, center.y + h, center.z + Math.cos(a1) * r), look: V(center.x, center.y + lookY, center.z) }, fov: 40, ...extra };
}
