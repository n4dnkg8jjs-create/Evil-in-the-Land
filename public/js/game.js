// The game: chapter flow, prayer and waves, combat resolution, bosses,
// multiplayer sync, camera, and the audio/visual reactions to it all.
import * as THREE from 'three';
import { Knight, RELICS } from './knight.js';
import { World } from './world.js';
import { Horde, TYPES, ST } from './demons.js';
import { Watcher, Crevices, Hound, Serpent, Cryptid, Dragon, phantomDevil } from './devil.js';
import { robeWind } from './horror.js';
import { Cave } from './cave.js';
import { Weather } from './weather.js';
import { FX, bloodyWeapon } from './fx.js';
import { Companion } from './ai.js';
import { Cinema, V, orbitShot } from './cinema.js';
import { CHAPTERS, PRAYERS, HEALED as HEALED_LOW, HEALED_HIGH } from './chapters.js';
import { Story } from './story.js';
import { Dread } from './dread.js';
import { fallenKnightSpots } from './battlefield.js';
import { Shop } from './shop.js';
import { Terror } from './terror.js';
import { account } from './account.js';
import { clamp, lerp, damp, dampAngle, angleDiff, smooth, rng, TAU } from './util.js';

const DIFF = { pilgrim: { dmg: 0.55, spawn: 0.75, prayer: 0.85 }, knight: { dmg: 1, spawn: 1, prayer: 1 }, martyr: { dmg: 1.4, spawn: 1.3, prayer: 1.15 } };
const R = Math.random;
const ALTAR_R = 7.2;

export class Game {
  constructor(app, opts) {
    this.app = app; this.engine = app.engine; this.audio = app.audio; this.ui = app.ui; this.net = app.net; this.input = app.input;
    this.opts = opts; this.isHost = opts.isHost; this.meId = opts.meId;
    this.diff = DIFF[opts.difficulty] || DIFF.knight;
    this.scene = this.engine.scene;
    this.fx = new FX(this.scene, this.engine.q);
    this.cinema = new Cinema(this.engine, this.ui);
    this.horde = new Horde(this.scene); this.horde.onDeath = (d) => this.demonDeathFx(d);
    // fits of head-shaking, with the gargling and the scream
    this.horde.onScream = (d) => {
      const p = V(d.pos.x, d.pos.y + d.def.height * 0.85, d.pos.z);
      this.audio.chatter(p, 0.45);
      if (R() < 0.55) this.audio.scream(p, !!d.def.big, 0.5, { crawler: 1.06, wraith: 1.0, husk: 0.85, brute: 0.75 }[d.type] || 0.95);
    };
    this.knights = new Map(); this.companions = []; this.trails = new Map();
    this.cam = { yaw: 0, pitch: 0.2, dist: 3.1, targetDist: 3.1, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: app.settings.fov || 62 };
    this.time = 0; this.netT = 0; this.snapT = 0; this.paused = false; this.stats = { kills: 0, start: performance.now() };
    this.projectiles = []; this.consecrations = []; this.chapterIdx = -1; this.obj = null; this.boss = null;
    this.reviveSend = 0; this.hitstop = 0; this.lastHurt = 0; this.musicMood = 'dread';
    this.prayerLine = 0; this.prayerLineT = 0; this.downedShown = false;
    // roster: humans + companions (same ids on every machine)
    for (const p of opts.players) this.addKnight(p);
    this.me = this.knights.get(this.meId);
    this.ui.setSelf(this.me);
    let role = 0;
    for (const p of opts.players) if (p.ai) { const k = this.knights.get(p.id); this.companions.push(new Companion(k, role++)); }
    this.story = new Story(this); this.dread = new Dread(this); this.shop = new Shop(this); this.shop.applyToMe(); this.terror = new Terror(this);
    this.bindNet();
  }

  addKnight(p) {
    const k = new Knight(this.scene, this.engine.q, p.loadout, { id: p.id, name: p.name, nameplate: p.id !== this.meId });
    k.isAI = !!p.ai; k.human = !p.ai; this.knights.set(p.id, k);
    this.trails.set(p.id, this.fx.trail(p.loadout.relic === 'medal' ? 0xffe0b0 : 0xfff2d8));
    return k;
  }
  get knightList() { return [...this.knights.values()]; }
  // knights whose simulation this machine runs
  owns(k) { return k === this.me || (this.isHost && k.isAI); }
  leader() { return this.knightList.filter((k) => k.human && !k.downed).sort((a, b) => a.id - b.id)[0] || this.me; }

  // ================================================================ chapters
  loadChapter(n, { skipIntro = false } = {}) {
    this.chT0 = performance.now(); this.myDowns = 0; this.secondWindUsed = false; this.burns = [];
    this.ui.fade(true);
    this.chapterIdx = n; const ch = CHAPTERS[n];
    if (this.world) this.world.dispose();
    this.horde.clear(); this.projectiles.length = 0; this.consecrations.length = 0;
    if (this.boss) { this.boss.dispose(); this.boss = null; }
    if (this.watcher) { this.scene.remove(this.watcher.mesh); this.watcher = null; }
    this.crevices = null;
    this.world = new World(this.engine, this.engine.q, n);
    this.story.build(this.world, n); this.dread.clear();
    this.layOutFallen(ch);
    this.shop.build(this.world); this.terror.reset();
    this.cave?.dispose(); this.cave = this.world.cave ? new Cave(this) : null;
    this.weather?.dispose(); this.weather = new Weather(this);   // after everything in the land is built, so it all goes wet
    if (this.world.vista) { const peak = this.world.ch.id === 'peak'; this.world.vista.onThunder = (str, delay) => this.audio.thunder(peak ? Math.max(1.3, str * 1.6) : str, peak ? Math.min(delay, 0.7) : delay); }   // on the Peak the storm is right on top of you
    this.world.onToll = (p) => this.audio.bell(p, 0.5, 0.75);
    this.world.dragonWorld = this.world;
    this.fx.setFog(this.scene.fog);
    if (ch.devil?.watch) { this.watcher = new Watcher(this.scene, this.fx); this.watcher.world = this.world; if (ch.devil.army) this.watcher.mode = 'army'; this.watcher.audio = this.audio; this.watcher.view = this.engine.camera; this.watcher.prewarm(this.engine.renderer, this.engine.camera); }
    phantomDevil(this);   // the scares' Devil, built and compiled now rather than the first time he appears
    if (ch.devil?.crevice) this.crevices = new Crevices(this.scene, this.world.creviceSpots);
    this.obj = { ch: n, ph: 'intro', a: 0, p: this.world.altars.map(() => 0), s: this.world.altars.map(() => 'blighted'), waveT: 6, roamT: 14, checkpoint: null, wards: false, bossDone: [] };
    // place the company at the road's start
    const sp = this.world.startPos; const next = this.world.altars[0];
    const face = Math.atan2(next.x - sp.x, next.z - sp.z);
    this.knightList.forEach((k, i) => {
      const a = face + Math.PI + (i - 2) * 0.5; k.pos.set(sp.x + Math.sin(a) * 2.5 * (i ? 1 : 0), 0, sp.z + Math.cos(a) * 2.5 * (i ? 1 : 0));
      k.pos.y = this.world.heightAt(k.pos.x, k.pos.z); k.yaw = face; k.hp = k.maxHp; k.downed = false; k.stamina = k.maxStamina;
    });
    this.cam.yaw = face; this.cam.pitch = 0.2;
    this.audio.setAmbience(ch.id === 'peak' || ch.id === 'ascent' ? 0.9 : 0.55, 0.05);
    this.setMood('dread', 0);
    setTimeout(() => this.ui.fade(false), 200);
    if (skipIntro) { this.obj.ph = 'travel'; if (this.isHost && ch.boss === 'dragon') this.spawnBoss('dragon'); return; }
    this.playIntro(n);
  }

  // the Emperor's household knights, dead in their rusted harness where they fell
  layOutFallen(ch) {
    for (const k of this.fallenKnights || []) k.dispose();
    this.fallenKnights = [];
    const n = ch.props?.fallenKnights; if (!n) return;
    const r = rng(ch.seed + 5); const styles = ['gothic', 'maximilian', 'milanese'], weapons = ['longsword', 'pollaxe', 'halberd', 'zweihander'], her = ['sable', 'argent', 'gules', 'azure'];
    for (const s of fallenKnightSpots(this.world, n, r)) {
      const k = new Knight(this.scene, this.engine.q, { style: styles[Math.floor(r() * 3)], finish: 'rusted', weapon: weapons[Math.floor(r() * 4)], relic: 'water', heraldry: her[Math.floor(r() * 4)], cape: r() < 0.5, plume: false }, { id: -100 - this.fallenKnights.length, name: '', nameplate: false });
      k.pos.set(s.x, this.world.heightAt(s.x, s.z), s.z); k.yaw = s.yaw; k.hp = 0; k.downed = true; k.downT = 5;
      for (let i = 0; i < 40; i++) k.animate(1 / 30, this.world);
      this.fallenKnights.push(k);
    }
  }

  playIntro(n) {
    const ch = CHAPTERS[n], w = this.world, a0 = w.altars[0];
    const sp = w.startPos; const p0 = V(sp.x, w.heightAt(sp.x, sp.z), sp.z);
    const lead = this.me.pos;
    const shots = [];
    let cleanup = null;
    if (ch.id === 'peak') {
      // before anything else: the knights look up into the storm, and something vast passes across it, black against the lightning
      const sil = this.peakSilhouette(lead); cleanup = sil.cleanup;
      shots.push({ dur: 6.5, from: { pos: V(lead.x - 1.5, lead.y + 1.7, lead.z - 3), look: V(lead.x + 8, lead.y + 30, lead.z + 40) }, to: { pos: V(lead.x - 1.2, lead.y + 1.6, lead.z - 3.4), look: V(lead.x - 14, lead.y + 34, lead.z + 44) }, fov: 55, fovTo: 46, text: ch.narration?.[0] || '', tick: sil.tick });
      shots.push({ dur: 6, from: { pos: V(-60, 30, -70), look: V(0, 5, 0) }, to: { pos: V(-30, 14, -46), look: V(0, 3, 0) }, fov: 45, text: [ch.intro[0], ''] });
      shots.push({ dur: 5, from: { pos: V(lead.x + 3, lead.y + 2.0, lead.z - 4), look: V(lead.x, lead.y + 1.6, lead.z) }, to: { pos: V(lead.x + 4.5, lead.y + 2.3, lead.z - 2.5), look: V(0, 8, 0) }, fov: 40, text: [ch.intro[1], ''], title: { num: n, title: ch.title, latin: ch.latin } });
      shots.push({ dur: 4, from: { pos: V(lead.x, lead.y + 1.8, lead.z - 3.5), look: V(lead.x, lead.y + 1.7, lead.z + 6) }, to: { pos: V(lead.x, lead.y + 1.5, lead.z - 4.5), look: V(lead.x, lead.y + 1.7, lead.z + 6) }, fov: 50, text: [ch.intro[2], 'Let God arise.'] });
    } else {
      const mid = w.path.at(0.3), far = w.path.at(0.75);
      shots.push({ dur: 6.5, from: { pos: V(far.x + 40, w.heightAt(far.x, far.z) + 34, far.z + 30), look: V(mid.x, w.heightAt(mid.x, mid.z), mid.z) }, to: { pos: V(mid.x + 30, w.heightAt(mid.x, mid.z) + 22, mid.z + 10), look: V(a0.x, a0.y + 2, a0.z) }, fov: 42, text: ch.intro[0] });
      shots.push({ dur: 5.5, from: { pos: V(a0.x + 9, a0.y + 3.5, a0.z + 9), look: V(a0.x, a0.y + 2.5, a0.z) }, to: { pos: V(a0.x + 5, a0.y + 2.2, a0.z + 7), look: V(a0.x, a0.y + 3.2, a0.z) }, fov: 38, text: ch.intro[1], title: { num: n, title: ch.title, latin: ch.latin } });
      // the place itself: low along the road ahead, toward the far altar, the narrator naming it
      if (ch.narration) { const q0 = w.path.at(0.2), q1 = w.path.at(0.42), aL = w.altars[w.altars.length - 1]; shots.push({ dur: 5.5, from: { pos: V(q0.x, w.heightAt(q0.x, q0.z) + 2.6, q0.z), look: V(q1.x, w.heightAt(q1.x, q1.z) + 2, q1.z) }, to: { pos: V(q1.x, w.heightAt(q1.x, q1.z) + 3.4, q1.z), look: V(aL.x, aL.y + 3, aL.z) }, fov: 50, text: ch.narration[0] }); }
      shots.push({ dur: 5, from: { pos: V(lead.x + 2.5, lead.y + 1.4, lead.z + 3.5), look: V(lead.x, lead.y + 1.55, lead.z) }, to: { pos: V(lead.x + 1.5, lead.y + 1.7, lead.z - 3.8), look: V(lead.x, lead.y + 1.6, lead.z + 4) }, fov: 46, text: ch.intro[2] });
    }
    this.obj.ph = 'intro';
    this.setMood(ch.id === 'peak' ? 'final' : 'dread', 0);
    this.audio.bell(null, 0.8, 0.25);
    this.cinema.play(shots, () => {
      cleanup?.();
      if (!this.isHost) return;
      if (ch.boss === 'dragon') this.spawnBoss('dragon');
      else this.obj.ph = 'travel';
    }, { skippable: this.isHost });
  }

  // ================================================================ net
  bindNet() {
    const n = this.net; if (!n || this.opts.solo) return;
    n.on('k:sv', (m) => { const d = this.horde.byId.get(m.d); if (!d || d.severed) return; const P = V(m.p[0], m.p[1], m.p[2]); d.sever(P, V(m.c[0], m.c[1], m.c[2]), this.fx, (x, z) => this.world ? this.world.heightAt(x, z) : 0, m.part); this.audio.gore?.('cut', P, true); });
    n.on('k:ks', (m) => { const k = this.knights.get(m.from); if (k && k !== this.me) k.netS = m.s; });
    n.on('k:snap', (m) => { if (!this.isHost) this.lastSnap = m; });
    n.on('k:ev', (m) => { if (!this.isHost || m.from !== this.net.id) this.onEvent(m.e, m.a, true); });
    n.on('k:hit', (m) => { if (this.isHost) this.hostApplyHit(m); });
    n.on('k:bhit', (m) => { if (this.isHost && this.boss) this.hostApplyBossHit(m); });
    n.on('k:dmg', (m) => { if (m.to === this.meId) this.applyMyDamage(m); });
    n.on('k:parried', (m) => { if (this.isHost) this.hostParried(m.src); });
    n.on('k:rev', (m) => { const k = this.knights.get(m.to); if (k && this.owns(k) && k.downed) { k.reviveProgress = Math.max(k.reviveProgress, m.p); if (k.reviveProgress >= 1) this.reviveKnight(k); } });
    n.on('k:relic', (m) => this.onRelic(m, false));
    n.on('k:gear', (m) => { const k = this.knights.get(m.id); if (k && k !== this.me) { k.setWeapon(m.weapon, this.engine.q); if (m.maxHp) k.maxHp = m.maxHp; } });
    n.on('k:skip', () => { if (this.cinema.active) this.cinema.finish(); });
    n.on('k:kc', () => account.record('kill'));
    // a knight whose player drops out keeps fighting: a companion takes up their place
    n.on('left', (m) => { for (const [id, k] of this.knights) if (!k.isAI && k !== this.me && !m.players.find((p) => p.id === id)) this.knightToAI(k); });
  }
  knightToAI(k) {
    k.isAI = true; k.human = false; k.netS = null;
    if (this.isHost) this.companions.push(new Companion(k, this.companions.length));
    this.ui.toast(`${k.name} has lost the road. A companion fights on in his harness.`, 3);
  }
  bcast(e, a) { if (this.isHost) { if (!this.opts.solo) this.net.send('ev', { e, a }); this.onEvent(e, a, false); } }

  // events that change the world for everyone (host decides, all apply)
  onEvent(e, a, remote) {
    switch (e) {
      case 'chapter': this.loadChapter(a.n); break;
      case 'cleanse': this.cleanseFx(a.i); break;
      case 'dsfx': this.demonSfx(a); break;
      case 'bsfx': this.bossSfx(a.kind); break;
      case 'slam': this.fx.slam(V(a.x, a.y, a.z), a.r); this.audio.explode(V(a.x, a.y, a.z), 0.5); this.shakeNear(V(a.x, a.y, a.z), a.r * 0.25); break;
      case 'boom': this.fx.explosion(V(a.x, a.y, a.z), a.r); this.audio.explode(V(a.x, a.y, a.z), 1); this.shakeNear(V(a.x, a.y, a.z), 0.6); break;
      case 'proj': this.addProjectile(a, false); break;
      case 'boss': if (!this.isHost && !this.boss) this.createBoss(a.kind, V(a.x, a.y, a.z)); this.bossIntro(a.kind); break;
      case 'bphase': this.bossPhaseFx(a.n); break;
      case 'grab': this.crevices?.remoteGrab(a.i); this.audio.growl(V(a.x, a.y, a.z), 1.3, 0.6, 0.6); break;
      case 'wipe': this.wipeFx(); break;
      case 'respawn': this.respawn(a); break;
      case 'consecrate': this.consecrations.push({ x: a.x, y: a.y, z: a.z, r: a.r, t: a.t }); break;
      case 'reliquary': this.reliquaryFx(a); break;
      case 'ward': this.wardFx(a); break;
      case 'outro': this.recordChapter(a.n); this.playOutro(a.n); break;
      case 'victory': account.record('victory'); this.victory(); break;
      case 'watcher': this.watcherEvent(a.s); break;
    }
  }

  // ================================================================ main update
  update(rawDt) {
    let dt = Math.min(rawDt, 1 / 20);
    if (this.paused) dt = 0;
    this.time += dt;
    const I = this.input;
    // cinematic skip (host decides for all)
    if (this.cinema.active && I.held('Space')) { this.skipHold = (this.skipHold || 0) + rawDt; if (this.skipHold > 0.6 && this.isHost) { this.skipHold = 0; this.cinema.skip(); if (!this.opts.solo) this.net.send('skip'); } } else this.skipHold = 0;

    // ---- local player
    const inCine = this.cinema.active || (this.obj && this.obj.ph === 'intro');
    const me = this.me;
    const myInput = inCine || this.paused ? this.emptyInput() : this.readInput(dt);
    if (this.world) {
      const W = this.worldCtx();
      // my knight
      this.handleRevive(me, myInput, dt);
      me.simulate(dt, myInput, W);
      // companions on the host
      if (this.isHost) for (const c of this.companions) { const inp = inCine ? this.emptyInput() : c.think(dt, this); this.handleRevive(c.k, inp, dt); c.k.simulate(dt, inp, W); }
      // remote puppets
      for (const k of this.knightList) if (!this.owns(k)) k.puppet(dt, k.netS, this.world);
      // host simulation
      if (this.isHost && !this.paused) this.hostUpdate(dt);
      else if (this.lastSnap) this.applySnapshot(this.lastSnap, dt);
      // combat for knights this machine owns
      for (const k of this.knightList) if (this.owns(k)) this.resolveKnightCombat(k, dt);
      this.updateProjectiles(dt);
      this.updateBurns(dt);
      this.updateConsecrations(dt);
    }
    // ---- animate
    const camPos = this.engine.camera.position;
    const hs = this.hitstop > 0 ? 0.08 : 1; this.hitstop -= rawDt;
    for (const k of this.knightList) { k.animate(k === me ? dt * hs : dt, this.world); this.knightEvents(k); this.updateTrail(k, dt); }
    this.horde.animate(dt, this.time, this.world, this.fx, camPos);
    if (this.boss) this.boss.animate(dt, this.time, this.fx);
    if (this.boss && (!this.boss.alive || this.boss.hp <= 0) && !this.boss._paid) { this.boss._paid = true; this.shop.earn(this.boss.kind === 'serpent' ? 250 : 350, 'the great one is cast down'); }
    if (this.watcher) this.watcher.animate(dt, this.time, camPos, this.knightList);
    if (this.crevices) this.crevices.update(dt, this.time, this.knightList, this.isHost, (c, k) => this.creviceGrab(c, k));
    if (this.world) this.world.update(dt, camPos);
    if (this.world) { this.story.update(dt, this.time); this.dread.update(dt, this.time); this.shop.update(dt); this.terror.update(dt, this.time); this.cave?.update(dt, this.time); this.weather?.update(dt, this.time); }
    if (this.world) this.checkDevilReveal();
    // the sky answers the land beneath you: blue over living country, ember-red in the blight
    if (this.world) {
      const life = this.world.lifeAt(this.me.pos.x, this.me.pos.z);
      const target = Math.max(this.world.healedFrac * 0.3, life * 0.8);
      this.atmosF = this.atmosF === undefined ? target : damp(this.atmosF, target, 0.6, dt);
      if (Math.abs(this.atmosF - (this.atmosShown ?? -1)) > 0.01) { const env = Math.abs(this.atmosF - (this.atmosEnvF ?? -1)) > 0.12; this.blendAtmosphere(this.atmosF, env); this.atmosShown = this.atmosF; if (env) this.atmosEnvF = this.atmosF; }
    }
    this.fx.update(dt);
    this.fx.ambient(dt, camPos, CHAPTERS[this.chapterIdx]?.ambient || 'ash', 1);
    if (this.world && this.world.fires.length && R() < 0.8) { const f = this.world.fires[Math.floor(R() * this.world.fires.length)]; if ((f.x - camPos.x) ** 2 + (f.z - camPos.z) ** 2 < 80 * 80) { this.fx.glow.emit({ x: f.x + (R() - 0.5) * f.s, y: f.y + 0.2, z: f.z + (R() - 0.5) * f.s, vy: 1.5 + R() * 2, color: [1, 0.45, 0.1], size: 0.5 * f.s, grow: 0.8, life: 0.6 + R() * 0.5, cell: 3, spin: 2 }); if (R() < 0.3) this.fx.smoke.emit({ x: f.x, y: f.y + 1.2, z: f.z, vy: 1.4, color: [0.06, 0.05, 0.05], a: 0.5, size: 0.9, grow: 1.5, life: 3, drag: 0.4, cell: 0 }); } }
    // ---- camera
    if (!this.cinema.update(rawDt)) this.updateCamera(rawDt, myInput);
    this.engine.focusShadows(this.cinema.active ? this.cam.look : me.pos);
    // ---- net send
    this.netT -= rawDt;
    if (this.netT <= 0 && !this.opts.solo) { this.netT = 0.05; this.net.send('ks', { s: me.netState() }); }
    // ---- audio & HUD
    const fwd = new THREE.Vector3(); this.engine.camera.getWorldDirection(fwd);
    this.audio.setListener(this.engine.camera.position, fwd);
    this.updateMusic(dt);
    this.updateHud(rawDt);
    this.engine.render(rawDt);
  }

  emptyInput() { return { mx: 0, mz: 0, aimYaw: this.me.yaw, sprint: false, block: false, pray: false, attack: false, heavy: false, dodge: false, relic: false }; }
  readInput(dt) {
    const I = this.input;
    let fx = 0, fz = 0;
    if (I.held('KeyW') || I.held('ArrowUp')) fz += 1; if (I.held('KeyS') || I.held('ArrowDown')) fz -= 1;
    if (I.held('KeyA') || I.held('ArrowLeft')) fx += 1; if (I.held('KeyD') || I.held('ArrowRight')) fx -= 1;
    const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    const y = this.cam.yaw; const s = Math.sin(y), c = Math.cos(y);
    const mx = fz * s + fx * c, mz = fz * c - fx * s;
    let aim = this.cam.yaw;
    const attack = I.pressed('Mouse0'), heavy = I.pressed('Mouse2');
    // shift lock: one key toggles; the other runs
    const lk = this.app.settings.lockKey;
    const lockKeys = lk === 'caps' ? ['CapsLock'] : lk === 'tab' ? ['Tab'] : ['ControlLeft', 'ControlRight'];
    const runKeys = ['ShiftLeft', 'ShiftRight'];
    if (lockKeys.some((k) => I.pressed(k))) {
      this.shiftLock = !this.shiftLock; this.ui.toast(this.shiftLock ? 'Shift lock on' : 'Shift lock off', 1.2);
      const ind = document.getElementById('lockInd'); if (ind) ind.hidden = !this.shiftLock;
      document.getElementById('hud')?.classList.toggle('locked', !!this.shiftLock);
    }
    if ((attack || heavy) && !this.shiftLock) aim = this.softAim(aim);
    return { mx, mz, aimYaw: aim, lock: !!this.shiftLock, sprint: runKeys.some((k) => I.held(k)), block: I.held('KeyQ') || I.held('Mouse3'), pray: I.held('KeyE'), attack, heavy, dodge: I.pressed('Space'), relic: I.pressed('KeyR') };
  }
  // gentle aim assist toward the most threatening demon in front
  softAim(yaw) {
    const k = this.me; let best = null, bs = 1e9;
    for (const d of this.horde.list) {
      if (!d.alive) continue; const dx = d.pos.x - k.pos.x, dz = d.pos.z - k.pos.z; const dist = Math.hypot(dx, dz);
      if (dist > 6.5) continue; const a = Math.abs(angleDiff(yaw, Math.atan2(dx, dz))); if (a > 0.7) continue;
      const sc = dist + a * 4; if (sc < bs) { bs = sc; best = Math.atan2(dx, dz); }
    }
    if (this.boss && this.boss.alive) { const dx = this.boss.pos.x - k.pos.x, dz = this.boss.pos.z - k.pos.z; if (Math.hypot(dx, dz) < 12 && Math.abs(angleDiff(yaw, Math.atan2(dx, dz))) < 0.6) best = Math.atan2(dx, dz); }
    return best ?? yaw;
  }

  worldCtx() {
    const w = this.world, self = this;
    return {
      heightAt: (x, z) => w.standAt(x, z), collide: (e, r) => w.collide(e, r), wind: w.wind,
      canPrayAt(k) { return self.altarFor(k) !== null || self.downedNear(k) !== null; },
    };
  }
  altarFor(k) {
    for (const a of this.world.altars) {
      if (a.state === 'cleansed') continue;
      if (CHAPTERS[this.chapterIdx].boss && !this.obj.wards) continue; // wards wake only when the dragon takes flight
      if (Math.hypot(k.pos.x - a.x, k.pos.z - a.z) < ALTAR_R) return a;
    }
    return null;
  }
  downedNear(k) { for (const o of this.knightList) if (o !== k && o.downed && o.pos.distanceTo(k.pos) < 2.4) return o; return null; }
  currentAltar() { if (!this.world) return null; return this.world.altars[this.obj.a] || null; }
  activeWard() { if (!this.obj?.wards) return null; return this.world.altars.find((a) => a.state !== 'cleansed') || null; }

  // ================================================================ camera
  updateCamera(dt, inp) {
    const I = this.input, c = this.cam, s = this.app.settings;
    const sens = 0.0024 * (s.sens || 1);
    c.yaw -= I.mouseDX * sens; c.pitch += I.mouseDY * sens * (s.invert ? -1 : 1);
    c.pitch = clamp(c.pitch, -0.55, 1.1);
    if (I.wheel) { c.targetDist = clamp(c.targetDist + I.wheel * 0.004, 2.6, 8); }
    const k = this.me;
    let dist = c.targetDist, height = 1.6, shoulder = 0.5;
    this.lockW = damp(this.lockW || 0, this.shiftLock && !k.praying && !k.downed ? 1 : 0, 6, dt);
    shoulder = lerp(shoulder, 0.85, this.lockW); dist = lerp(dist, Math.min(dist, 4.2), this.lockW); height = lerp(height, 1.75, this.lockW);
    if (this.boss && this.boss.alive) dist += this.boss.kind === 'dragon' ? 3 : 1.5;
    if (k.kneel > 0.2) { dist = lerp(dist, 3.2, k.kneel); height = lerp(height, 1.2, k.kneel); }
    if (k.downed) { dist = 5.5; height = 2.5; }
    c.dist = damp(c.dist, dist, 4, dt);
    const fwd = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), -Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch));
    const right = new THREE.Vector3(-Math.cos(c.yaw), 0, Math.sin(c.yaw));
    const pivot = new THREE.Vector3(k.pos.x, k.pos.y + height, k.pos.z).addScaledVector(right, shoulder);
    c.look.lerp(pivot, 1 - Math.exp(-18 * dt));
    if (c.look.distanceTo(pivot) > 3) c.look.copy(pivot);
    const want = c.look.clone().addScaledVector(fwd, -c.dist);
    const gy = this.world ? this.world.heightAt(want.x, want.z) + 0.5 : 0;
    if (want.y < gy) want.y = gy;
    this.cave?.clampCamera(want, c.look);
    const cam = this.engine.camera;
    cam.position.copy(want);
    cam.up.set(0, 1, 0);
    cam.lookAt(c.look.clone().addScaledVector(fwd, 5));
    const fov = (s.fov || 62) + this.me.sprintW * 6 + (this.boss && this.boss.alive ? 4 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = damp(cam.fov, fov, 5, dt); cam.updateProjectionMatrix(); }
  }
  shakeNear(p, amt) { const d = p.distanceTo(this.me.pos); if (d < 25) this.engine.shake(amt * (1 - d / 25), 0.4); }

  // ================================================================ host simulation
  hostCtx() {
    const self = this;
    return this._C || (this._C = {
      get knights() { return self.knightList; }, get world() { return self.world; }, get time() { return self.time; },
      hash: null, get dmgMul() { return self.diff.dmg; }, speedMul: 1,
      ev(type, ...args) { self.hostEvent(type, args); },
      damageKnight: (k, dmg, from, opts, src) => self.damageKnight(k, dmg, from, opts, src),
      projectile: (type, src, target, delay = 0) => self.spawnProjectile(type, src, target, delay),
      explode: (src, r, dmg) => self.hostExplode(src.pos, r, dmg),
      summon: (src, type, n) => self.summonAround(src.pos, type, n),
      summonAround: (pos, type, n) => self.summonAround(pos, type, n),
    });
  }
  hostEvent(type, args) {
    switch (type) {
      case 'demonSfx': { const [d, kind] = args; this.bcast('dsfx', { x: +d.pos.x.toFixed(1), y: +d.pos.y.toFixed(1), z: +d.pos.z.toFixed(1), type: d.type, kind }); break; }
      case 'demonDeath': break;
      case 'slam': { const [p, r] = args; this.bcast('slam', { x: p.x, y: p.y, z: p.z, r }); for (const d of this.horde.list) if (d.alive && d.pos.distanceTo(p) < r && args[2]) d.takeHit(args[2], null, 1, this.hostCtx()); break; }
      case 'bossSfx': this.bcast('bsfx', { kind: args[1] }); break;
      case 'bossDeath': this.onBossDeath(); break;
      case 'bossPhase': this.bcast('bphase', { n: args[1] }); break;
      case 'wardsActive': this.obj.wards = true; this.ui.toast('Pray at the wards to cast Him down', 4); break;
      case 'firePatch': break;
    }
  }
  hostUpdate(dt) {
    const C = this.hostCtx(); const o = this.obj; const ch = CHAPTERS[this.chapterIdx];
    this.horde.simulate(dt, C);
    if (this.boss) this.boss.simulate(dt, C);
    // the watcher on the hills
    if (this.watcher && !(this.watcher.holdNet > performance.now())) { const r = this.watcher.hostUpdate(dt, this.world, this.knightList, o.ph); if (r) this.bcast('watcher', { s: r }); }
    // prayer & waves
    if (o.ph === 'travel' && !ch.boss) {
      const a = this.world.altars[o.a];
      if (a && this.knightList.some((k) => !k.downed && Math.hypot(k.pos.x - a.x, k.pos.z - a.z) < ALTAR_R + 2)) { o.ph = 'pray'; a.state = 'active'; o.s[o.a] = 'active'; o.waveT = 3; this.bcast('dsfx', { x: a.x, y: a.y, z: a.z, type: 'altar', kind: 'wake' }); }
      o.roamT -= dt;
      if (o.roamT <= 0 && this.horde.aliveCount < 10) { o.roamT = 16 + R() * 10; this.spawnRoamers(); }
    }
    if (o.ph === 'pray') {
      const a = this.world.altars[o.a];
      const pk = this.knightList.filter((k) => k.praying && !k.downed && Math.hypot(k.pos.x - a.x, k.pos.z - a.z) < ALTAR_R + 0.5);
      const n = pk.length, faith = n ? pk.reduce((m, k) => Math.max(m, k.prayMul || 1), 1) : 1; o.n = n;
      let rate = n ? (1 + (n - 1) * 0.55) * faith : 0;
      for (const d of this.horde.list) if (d.alive && d.type === 'wraith' && d.pos.distanceTo(a) < 10) { rate *= 0.5; break; }
      o.p[o.a] = Math.min(1, o.p[o.a] + dt * rate / (ch.prayer * this.diff.prayer));
      a.progress = o.p[o.a];
      o.waveT -= dt;
      if (o.waveT <= 0) { o.waveT = lerp(11, 6, a.progress) * (0.8 + R() * 0.4); this.spawnWave(a); }
      if (o.p[o.a] >= 1) this.hostCleanse(o.a);
    }
    if (o.ph === 'boss' && o.wards) {
      // the summit wards: prayers hurl heaven's light at the dragon
      const ward = this.activeWard();
      if (ward) {
        const i = this.world.altars.indexOf(ward);
        const n = this.knightList.filter((k) => k.praying && !k.downed && Math.hypot(k.pos.x - ward.x, k.pos.z - ward.z) < ALTAR_R + 0.5).length; o.n = n;
        if (ward.state === 'blighted') { ward.state = 'active'; o.s[i] = 'active'; }
        o.p[i] = Math.min(1, o.p[i] + dt * (n ? 1 + (n - 1) * 0.55 : 0) / (ch.prayer * this.diff.prayer)); ward.progress = o.p[i];
        o.waveT -= dt; if (o.waveT <= 0) { o.waveT = 9; this.spawnWave(ward, 0.6); }
        if (o.p[i] >= 1) { o.s[i] = 'cleansed'; this.bcast('ward', { i }); if (this.boss && this.boss.wardStrike) this.boss.wardStrike(this.hostCtx()); }
      }
    }
    // wipe: every knight down
    if (o.ph !== 'wipe' && o.ph !== 'intro' && o.ph !== 'outro' && this.knightList.length && this.knightList.every((k) => k.downed)) { o.ph = 'wipe'; this.bcast('wipe', {}); setTimeout(() => this.hostRespawn(), 4200); }
    // snapshot
    this.snapT -= dt;
    if (this.snapT <= 0 && !this.opts.solo) {
      this.snapT = 1 / 15;
      this.net.send('snap', {
        d: this.horde.snapshot(), o: { ch: o.ch, ph: o.ph, a: o.a, p: o.p.map((x) => +x.toFixed(3)), s: o.s, wards: o.wards, n: o.n || 0 },
        ai: this.companions.map((c) => [c.k.id, c.k.netState()]), w: this.watcher ? this.watcher.netState() : null, b: this.boss ? this.boss.snap() : null,
      });
    }
  }
  applySnapshot(m, dt) {
    if (!this.world || m.o.ch !== this.chapterIdx) return;
    this.horde.applySnapshot(m.d, dt, this.world);
    const o = this.obj;
    o.ph = m.o.ph; o.a = m.o.a; o.wards = m.o.wards; o.n = m.o.n || 0;
    m.o.p.forEach((p, i) => { o.p[i] = p; const a = this.world.altars[i]; if (a) { a.progress = p; if (m.o.s[i] === 'active' && a.state === 'blighted') a.state = 'active'; } });
    for (const [id, s] of m.ai) { const k = this.knights.get(id); if (k) k.netS = s; }
    if (m.w && this.watcher && !(this.watcher.holdNet > performance.now())) this.watcher.applyNet(m.w);
    if (m.b) { if (!this.boss) this.createBoss(m.b[0], V(m.b[1], m.b[2], m.b[3])); if (this.boss) this.boss.applySnap(m.b, dt, this.world); }
    this.lastSnap = null;
  }

  spawnTypes(pool, n) {
    const caps = { brute: 2, wraith: 2, herald: 1, husk: 4, wretch: 5 };
    const counts = {}; for (const d of this.horde.list) if (d.alive) counts[d.type] = (counts[d.type] || 0) + 1;
    const out = []; const entries = Object.entries(pool); const tot = entries.reduce((s, [, w]) => s + w, 0);
    for (let i = 0; i < n; i++) {
      let r = R() * tot, pick = 'shade';
      for (const [t, w] of entries) { r -= w; if (r <= 0) { pick = t; break; } }
      if (caps[pick] !== undefined && (counts[pick] || 0) >= caps[pick]) pick = R() < 0.6 ? 'shade' : 'crawler';
      counts[pick] = (counts[pick] || 0) + 1; out.push(pick);
    }
    return out;
  }
  partyMul() { let m = 0; for (const k of this.knightList) m += k.isAI ? 0.7 : 1; return 0.45 + 0.42 * m; }
  spawnWave(a, mul = 1) {
    const ch = CHAPTERS[this.chapterIdx];
    const cap = this.engine.q.maxDemons - this.horde.aliveCount; if (cap <= 0) return;
    const budget = Math.min(cap, Math.round((3 + this.chapterIdx * 1.1 + (a.progress || 0) * 6) * this.partyMul() * this.diff.spawn * ch.density * mul));
    const types = this.spawnTypes(ch.pool, budget);
    const groups = 1 + (budget > 7 ? 1 : 0) + (budget > 14 ? 1 : 0);
    const pts = []; for (let g = 0; g < groups; g++) pts.push(this.world.spawnPoint(a));
    types.forEach((t, i) => { const p = pts[i % groups]; this.spawnDemon(t, p.x + (R() - 0.5) * 6, p.z + (R() - 0.5) * 6); });
  }
  spawnRoamers() {
    const lead = this.leader(); const ch = CHAPTERS[this.chapterIdx];
    if (!lead || ch.boss) return;
    if (this.shop?.inSanctuary(lead.pos, 25)) return;   // the road is quiet near the sanctuary
    if (this.world.inCaveZone?.(lead.pos.x, lead.pos.z, 14)) return;   // under the mountain there is only Him
    const nr = this.world.path.nearest(lead.pos.x, lead.pos.z); const p = this.world.path.at(Math.min(1, nr.t + 0.12));
    const n = Math.round((3 + this.chapterIdx * 0.6) * this.partyMul() * this.diff.spawn);
    const types = this.spawnTypes(ch.pool, n);
    types.forEach((t) => this.spawnDemon(t, p.x + (R() - 0.5) * 10, p.z + (R() - 0.5) * 10));
  }
  spawnDemon(type, x, z) {
    if (!this.world.inBounds(x, z) || this.world.inCaveZone?.(x, z, 4)) return null;
    const p = { pos: new THREE.Vector3(x, 0, z) }; this.world.collide(p, 0.6);
    const d = this.horde.spawn(type, p.pos.x, p.pos.z, this.world);
    const k = this.leader(); if (k) d.yaw = Math.atan2(k.pos.x - d.pos.x, k.pos.z - d.pos.z);
    return d;
  }
  summonAround(pos, type, n) {
    for (let i = 0; i < n; i++) { const a = R() * TAU, r = 5 + R() * 6; this.spawnDemon(type, pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r); }
  }

  hostCleanse(i) {
    const o = this.obj; o.s[i] = 'cleansed'; o.p[i] = 1; o.checkpoint = i;
    this.bcast('cleanse', { i });
    const n = this.world.altars.length; const ch = CHAPTERS[this.chapterIdx];
    // banish every demon near the altar
    const a = this.world.altars[i];
    for (const d of this.horde.list) if (d.alive && d.pos.distanceTo(a) < 42) d.die(this.hostCtx());
    o.ph = 'cleansed';
    setTimeout(() => {
      if (this.chapterIdx !== o.ch) return;
      // mini-bosses
      if (ch.miniboss === 'hound' && i === n - 1) { this.spawnBoss('hound'); return; }
      if (Array.isArray(ch.miniboss) && i === 1 && !o.bossDone.includes('serpent')) { this.spawnBoss('serpent'); o.a = i + 1; return; }
      if (Array.isArray(ch.miniboss) && i === n - 1 && !o.bossDone.includes('cryptid')) { this.spawnBoss('cryptid'); return; }
      if (i < n - 1) { o.a = i + 1; o.ph = 'travel'; o.roamT = 10; }
      else this.hostChapterComplete();
    }, 6500);
  }
  hostChapterComplete() {
    const n = this.chapterIdx; this.obj.ph = 'outro';
    this.saveProgress(n + 1);
    this.bcast('outro', { n });
    setTimeout(() => { if (this.chapterIdx === n && this.obj.ph === 'outro' && n + 1 < CHAPTERS.length) this.bcast('chapter', { n: n + 1 }); }, 14000);
  }
  saveProgress(next) { if (next > account.get('evil.progress', 0)) account.set('evil.progress', Math.min(next, CHAPTERS.length - 1)); }
  // every knight's own profile keeps what they did (host and guests alike)
  recordChapter(n) { account.record('chapterDone', { idx: n, next: Math.min(n + 1, CHAPTERS.length - 1), secs: this.chT0 ? (performance.now() - this.chT0) / 1000 : 0 }); }

  hostRespawn() {
    const o = this.obj; const cp = o.checkpoint !== null ? this.world.altars[o.checkpoint] : null;
    const sp = cp ? { x: cp.x + 3, z: cp.z + 3 } : this.world.startPos;
    for (const d of this.horde.list) d.die(null);
    if (o.ph === 'wipe') {
      if (this.boss) { o.ph = 'boss'; this.boss.hp = Math.min(this.boss.maxHp, this.boss.hp + this.boss.maxHp * 0.25); }
      else { const a = this.world.altars[o.a]; if (a && a.state === 'active') { a.state = 'blighted'; o.s[o.a] = 'blighted'; o.p[o.a] = 0; a.progress = 0; } o.ph = 'travel'; }
    }
    this.bcast('respawn', { x: sp.x, z: sp.z });
  }
  respawn(a) {
    this.ui.fade(false); this.ui.downed(false);
    for (const k of this.knightList) if (this.owns(k)) {
      const ang = R() * TAU; k.pos.set(a.x + Math.cos(ang) * 2, 0, a.z + Math.sin(ang) * 2); k.pos.y = this.world.heightAt(k.pos.x, k.pos.z);
      k.downed = false; k.hp = k.maxHp; k.stamina = k.maxStamina; k.action = null; k.iframes = 2;
    }
    if (!this.isHost) { /* altars reset by snapshot */ }
    this.ui.toast('Rise, and pray again', 3);
  }
  wipeFx() { this.ui.fade(true); this.audio.bell(null, 0.5, 0.6); this.setMood('dread', 0); this.ui.subtitle(['The darkness takes the land.', 'You will rise at the last consecrated altar.'], 4); }

  // ================================================================ bosses
  createBoss(kind, pos) {
    const n = this.knightList.length;
    if (kind === 'hound') this.boss = new Hound(this.scene, n);
    else if (kind === 'serpent') this.boss = new Serpent(this.scene, n);
    else if (kind === 'cryptid') this.boss = new Cryptid(this.scene, n, this.fx);
    else if (kind === 'dragon') this.boss = new Dragon(this.scene, n, this.fx);
    this.boss.world = this.world;
    this.boss.pos.copy(pos);
    if (kind === 'serpent') this.boss.placeAt(pos);   // coiled under the ground there, about to rise
    if (kind === 'dragon') { this.boss.alt = 40; this.boss.fly = 1; }
    return this.boss;
  }
  spawnBoss(kind) {
    const lead = this.leader();
    let pos;
    if (kind === 'dragon') pos = V(0, 0, 18);
    else if (kind === 'serpent') pos = V(lead.pos.x + 20, 0, lead.pos.z + 10);
    else { const a = R() * TAU; pos = V(lead.pos.x + Math.cos(a) * 24, 0, lead.pos.z + Math.sin(a) * 24); const p = { pos }; this.world.collide(p, 1); }
    pos.y = this.world.heightAt(pos.x, pos.z);
    this.createBoss(kind, pos);
    this.obj.ph = 'boss';
    this.bcast('boss', { kind, x: pos.x, y: pos.y, z: pos.z });
  }
  bossIntro(kind) {
    const b = this.boss; if (!b) return;
    this.setMood('boss', 0.9);
    this.ui.chapterCard({ title: b.name, latin: b.title }, 3.5);
    if (kind === 'dragon') {
      // He descends upon the summit
      const lead = this.me.pos;
      this.cinema.play([
        { dur: 4, from: { pos: V(lead.x - 6, lead.y + 2, lead.z - 6), look: V(0, 30, 10) }, to: { pos: V(lead.x - 5, lead.y + 1.6, lead.z - 7), look: V(0, 12, 14) }, fov: 48, at: () => this.audio.roar(V(0, 20, 10), 1.2, 3) },
        { dur: 5, from: { pos: V(-14, 4, 2), look: V(0, 4, 18) }, to: { pos: V(-9, 3, 6), look: V(0, 5, 18) }, fov: 40, text: ['Draco magnus rufus…', 'A great red dragon, having seven heads and ten horns.'], shake: 0.25 },
      ], null, { skippable: this.isHost });
      this.audio.bell(null, 0.4, 0.6);
    } else {
      // (the great ones are framed from further off, looking up at them)
      const bp = b.pos, h = b.camH || 1.2, f = b.camD || 1;
      this.cinema.play([{ dur: kind === 'hound' ? 3.5 : 4.2, from: { pos: V(bp.x + 6 * f, bp.y + 2.5 + h * 0.2, bp.z + 8 * f), look: V(bp.x, bp.y + h, bp.z) }, to: { pos: V(bp.x + 4 * f, bp.y + 1.8 + h * 0.1, bp.z + 6 * f), look: V(bp.x, bp.y + h * 1.1, bp.z) }, fov: 42 }], null, { skippable: this.isHost });
    }
  }
  bossSfx(kind) {
    const b = this.boss; const p = b ? (b.headPos || b.pos).clone().add(V(0, 2, 0)) : this.me.pos;
    switch (kind) {
      case 'howl': this.audio.growl(p, 0.6, 2.5, 1); this.audio.shriek(p, 0.4, 2.4, 0.6); break;
      case 'snarl': case 'growl': this.audio.growl(p, b?.kind === 'dragon' ? 0.5 : 1, 1, 0.8); break;
      case 'roar': this.audio.roar(p, 1, 2.6); this.engine.shake(0.15, 1.2); break;
      case 'erupt': this.audio.explode(p, 1); this.audio.roar(p, 0.8, 1.6); break;
      case 'hiss': this.audio.whoosh(p, 2.5, 1.2, 0.6); break;
      case 'scream': this.audio.shriek(p, 0.7, 1.6, 0.9); break;
      case 'inhale': this.audio.whoosh(p, 0.5, 1.0, 0.8); break;
      case 'crash': this.audio.explode(p, 1.5); this.engine.shake(0.6, 1.5); break;
    }
  }
  bossPhaseFx(n) {
    const b = this.boss;
    if (b && b.kind !== 'dragon') { if (b.phaseLine) this.ui.toast(b.phaseLine(n), 3); this.audio.roar((b.headPos || b.pos).clone().add(V(0, 3, 0)), 1, 2.4); this.engine.shake(0.2, 1); return; }
    if (n === 2) { this.ui.toast('He takes to the air', 3); this.ui.subtitle(['Pray at the wards.', 'Their light will cast Him down.'], 5); this.audio.roar(this.boss?.pos || this.me.pos, 1.2, 3); }
    if (n === 3) { this.ui.toast('The Dragon is cast down', 3); this.engine.fx.flash = 0.4; this.ui.subtitle(['Et proiectus est draco ille magnus.', 'And that great dragon was cast out.'], 5); }
  }
  wardFx(a) {
    const w = this.world.altars[a.i]; if (!w) return;
    this.world.cleanse(a.i);
    this.fx.holyBurst(V(w.x, w.y, w.z), 7); this.fx.beam(V(w.x, w.y, w.z), 0xffe2a0, 4, 2.2, 80);
    this.audio.bell(V(w.x, w.y + 3, w.z), 1, 0.7); this.audio.holy(V(w.x, w.y, w.z), 0.7);
    if (this.boss) { const bp = this.boss.pos.clone(); bp.y += (this.boss.alt || 0) + 3; this.fx.beam(V(bp.x, bp.y - 40, bp.z), 0xfff0c0, 2.5, 1.6, 80); this.fx.holyBurst(bp, 5); this.audio.roar(bp, 1.1, 2); }
    this.engine.fx.holy = 0.8;
  }
  onBossDeath() {
    const b = this.boss; const o = this.obj;
    if (b.kind === 'dragon') { o.ph = 'outro'; for (const d of this.horde.list) if (d.alive) d.die(this.hostCtx()); setTimeout(() => this.bcast('victory', {}), 3500); return; }
    o.bossDone.push(b.kind);
    setTimeout(() => {
      if (this.boss === b) { this.boss.dispose(); this.boss = null; this.bcast('dsfx', { x: 0, y: 0, z: 0, type: 'boss', kind: 'gone' }); }
      const ch = CHAPTERS[this.chapterIdx]; const n = this.world.altars.length;
      if (b.kind === 'serpent') { o.ph = 'travel'; o.roamT = 12; }
      else this.hostChapterComplete();
    }, 5000);
  }

  // ================================================================ combat
  // the foe a blow should close on: near, and roughly in front of the knight
  meleeTarget(k) {
    const range = (k.wdef.hitTo || 1) + 3.2; let best = null, bs = 1e9;
    const consider = (x, z, rad) => {
      const dist = Math.hypot(x - k.pos.x, z - k.pos.z) - rad; if (dist > range) return;
      const off = Math.abs(angleDiff(k.yaw, Math.atan2(x - k.pos.x, z - k.pos.z))); if (off > 1.05) return;
      const sc = dist + off * 2.2; if (sc < bs) { bs = sc; best = { x, z, dist: Math.max(0, dist) }; }
    };
    for (const d of this.horde.list) if (d.alive) consider(d.pos.x, d.pos.z, d.radius * 0.6);
    if (this.boss && this.boss.alive && (this.boss.alt || 0) < 3) consider(this.boss.pos.x, this.boss.pos.z, 2.6);
    return best;
  }
  resolveKnightCombat(k, dt) {
    if (!k.findTarget) k.findTarget = (kn) => this.meleeTarget(kn);
    const hits = k.currentHits(); if (!hits) { k._sweepPrev = null; return; }
    const segs = [];
    const pb = k._sweepPrev ? k._sweepPrev[0] : k.base, pt = k._sweepPrev ? k._sweepPrev[1] : k.tip;
    for (let s = 1; s <= 3; s++) { const t = s / 3; segs.push([pb.clone().lerp(k.base, t), pt.clone().lerp(k.tip, t)]); }
    k._sweepPrev = [k.base.clone(), k.tip.clone()];
    for (const h of hits) {
      const kind = h.kind || k.wdef.kind;
      let cleave = h.cleave || 1;
      if (k.wdef.pierceAll && k.actKind === 'heavy') cleave = 99;   // the Lance's charged thrust runs through the whole line
      const dmgBase = h.dmg * k.dmgMul();
      const leftSrc = h.src === 'left';
      // demons
      for (const d of this.horde.list) {
        if (!d.alive || k.hitSet.has(d.id) || cleave <= 0) continue;
        const c = d.chest; const r = d.radius * 1.15 + 0.25;
        let hitP = null;
        if (leftSrc) { const lp = k.rig.j.handL.getWorldPosition(new THREE.Vector3()); if (lp.distanceTo(c) < r + 0.5) hitP = lp; }
        else {
          // the blade against the whole body (a capsule from shin to crown, lifted when it leaps), where it is now
          // and where it was a moment ago, so a demon rushing or springing through the swing is still caught
          const H = d.def.height * d.scale, y0 = d.pos.y + (d.alt || 0) + Math.min(0.3, H * 0.2), y1 = d.pos.y + (d.alt || 0) + H * 0.95;
          const back = Math.min(0.12, dt * 2);
          for (const [a, b] of segs) {
            for (const bt of [0, back]) {
              const cx = d.pos.x - d.vel.x * bt, cz = d.pos.z - d.vel.z * bt;
              const q = segSegClosest(a, b, _ca.set(cx, y0, cz), _cb.set(cx, y1, cz));
              if (q.d < r) { hitP = q.p; break; }
            }
            if (hitP) break;
          }
        }
        if (!hitP) continue;
        k.hitSet.add(d.id); cleave--;
        let dmg = dmgBase; if (d.def.big && kind === 'blunt') dmg *= (k.wdef.armorBreak || 1.25);
        if (kind === 'pierce' && d.def.big) dmg *= 1.15;
        if (k.wdef.holy) dmg *= 1 + 0.3 * k.wdef.holy;
        const dir = new THREE.Vector3(d.pos.x - k.pos.x, 0, d.pos.z - k.pos.z).normalize();
        this.onWeaponHit(k, hitP, kind, d.def.big ? 1.2 : 1, dir, false, d, d.hp - dmg <= 0);
        if (k.wdef.legendary) this.relicHit(k, d, dmg, hitP, d.hp - dmg <= 0);
        if (this.isHost) { if (d.takeHit(dmg, dir, h.stagger || 0.5, this.hostCtx(), k.id)) { this.stats.kills++; if (k === this.me) account.record('kill'); } }
        else this.net.send('hit', { d: d.id, dmg, dx: dir.x, dz: dir.z, st: h.stagger || 0.5 }, this.net.hostId);
      }
      // boss
      const b = this.boss;
      if (b && b.alive && !k.hitSet.has('boss')) {
        let res = null; for (const [a, bb] of segs) { res = b.hitTest(a, bb, 0.2); if (res) break; }
        if (res) {
          k.hitSet.add('boss');
          let dmg = dmgBase * res.mul; if (kind === 'blunt') dmg *= (k.wdef.armorBreak || 1);
          const dir = new THREE.Vector3(b.pos.x - k.pos.x, 0, b.pos.z - k.pos.z).normalize();
          this.onWeaponHit(k, res.point, kind, 1.4, dir, true);
          if (this.isHost) b.takeHit(dmg, dir, h.stagger || 0.5, this.hostCtx());
          else this.net.send('bhit', { dmg, dx: dir.x, dz: dir.z, st: h.stagger || 0.5 }, this.net.hostId);
        }
      }
    }
  }
  onWeaponHit(k, p, kind, weight, dir, boss, target, lethal = false) {
    // how hard the blow lands: the weapon's heft, a heavy or a finishing blow, the size of what it struck
    const heavy = k.actKind === 'heavy', fin = !heavy && k.combo === 0;
    const heft = (k.wdef.dmg || 1) * (heavy ? 1.6 : fin ? 1.25 : 1) * weight;
    // blood where the edge actually met flesh, thrown along the line of the cut and out of the wound
    const cut = k.weaponDir ? new THREE.Vector3().subVectors(k.tip, k.prevTip).normalize().lerp(dir, 0.4).normalize() : dir;
    const out = target ? new THREE.Vector3(p.x - target.pos.x, 0.25, p.z - target.pos.z).normalize() : dir.clone().negate();
    const ground = (x, z) => this.world ? this.world.heightAt(x, z) : 0;
    this.fx.ichor(p, cut, 0.35 * weight);   // a breath of the black smoke they are made of
    this.fx.blood(p, cut, out, (kind === 'blunt' ? 0.5 : kind === 'pierce' ? 0.8 : 1.1) * weight * (heavy ? 1.5 : 1) * (k.fury > 0 ? 1.3 : 1), ground, kind);
    bloodyWeapon(k, (heavy ? 0.12 : 0.07) * weight * (lethal ? 1.6 : 1));
    if (lethal && target) this.fx.corpsePool(target.pos, ground, target.def?.big ? 1.6 : 1);
    if (boss || kind === 'blunt') this.fx.sparks(p, boss ? 8 : 3, [1, 0.5, 0.2]);
    if (k.fury > 0) this.fx.holyMotes(p, 0.5, 8);
    this.audio.hit(kind, p, weight * (heavy ? 1.3 : 1));
    this.audio.gore?.(kind, p, heavy || heft > 1.4 || lethal);
    // the blade bites: the swing stops dead in the body for a beat, then drags on through the cut, slow at
    // first; a club stops shorter and rebounds; a thrust sticks, and is wrenched free
    const stop = Math.min(0.16, (0.05 + (heavy ? 0.05 : fin ? 0.025 : 0)) * heft);
    const drag = kind === 'blunt' ? 0.05 : kind === 'pierce' ? 0.15 : Math.min(0.26, (0.08 + 0.05 * heft) * (heavy ? 1.35 : 1));
    k.hitStop = Math.max(k.hitStop || 0, stop); k.biteT = 0; k.biteFreeze = stop; k.biteDrag = drag;
    if (target) {
      target.hitStopT = stop * 1.2; if (dir) target.hitDir = dir.clone();
      target.addWound?.(p, cut, kind, heft);
      target.strikePart?.(p, dir, Math.min(1.6, heft));
      if ((heavy || kind === 'blunt' && fin) && !target.def?.big && !lethal) target.knockVis = 1;
      if (lethal && kind !== 'blunt' && (heavy || fin || Math.random() < 0.45)) {
        const part = target.sever?.(p, cut, this.fx, ground); this.audio.gore?.('cut', p, true);
        // everyone else sees the same part come off the same demon
        if (part && !this.opts.solo && target.id != null && this.horde.byId.get(target.id) === target) this.net.send('sv', { d: target.id, part, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], c: [+cut.x.toFixed(2), +cut.y.toFixed(2), +cut.z.toFixed(2)] });
      }
    }
    if (k === this.me) {
      this.ui.hitMark(); this.hitstop = stop;
      // the camera is jolted the way the blow travelled
      this.engine.kick(cut.clone().setY(-0.35), 0.05 + 0.05 * heft, 0.14 + 0.05 * heft);
      this.engine.shake(0.025 * heft, 0.1);
    }
  }
  hostApplyHit(m) { const d = this.horde.byId.get(m.d); if (d && d.alive) { if (d.takeHit(m.dmg, V(m.dx, 0, m.dz), m.st, this.hostCtx(), m.from)) { this.stats.kills++; this.net.send('kc', {}, m.from); } } }
  hostApplyBossHit(m) { if (this.boss && this.boss.alive) this.boss.takeHit(m.dmg, V(m.dx, 0, m.dz), m.st, this.hostCtx()); }
  hostParried(srcId) {
    if (srcId === 'boss') { if (this.boss && this.boss.alive) this.boss.parried?.(this.hostCtx()); return; }   // a parry wears down a boss's poise
    const d = this.horde.byId.get(srcId); if (d && d.alive) { d.setState(ST.stagger); d.vel.multiplyScalar(-1); }
  }

  // host-side: route damage to the knight's owner
  damageKnight(k, dmg, from, opts = {}, src) {
    if (k.downed || this.obj?.ph === 'outro' || this.obj?.ph === 'intro') return;
    const srcId = src ? (src.kind && !src.def ? 'boss' : src.id) : null;
    if (this.owns(k)) { const r = k.receiveHit(dmg, from, opts); this.afterHit(k, r, from, opts); if (r.parried && srcId !== null) this.hostParried(srcId); }
    else this.net.send('dmg', { to: k.id, dmg, x: from.x, z: from.z, o: opts, src: srcId }, k.id);
  }
  applyMyDamage(m) {
    const from = V(m.x, this.me.pos.y, m.z);
    const r = this.me.receiveHit(m.dmg, from, m.o || {});
    this.afterHit(this.me, r, from, m.o || {});
    if (r.parried && m.src !== null && m.src !== undefined) this.net.send('parried', { src: m.src }, this.net.hostId);
  }
  afterHit(k, r, from, opts) {
    if (!r || r.ignored || r.dodged) return;
    const p = k.chestPos;
    if (r.blocked) { this.fx.sparks(p, r.parried ? 26 : 12); this.audio.clang(p, r.parried ? 1.3 : 1, r.parried ? 1.4 : 1); if (k === this.me) this.engine.shake(r.parried ? 0.08 : 0.05, 0.15); if (r.parried && k === this.me) { this.ui.toast('Parried', 0.8); this.hitstop = 0.12; } return; }
    this.audio.clang(p, 0.55, 0.7 + R() * 0.3);
    this.audio.hit('blunt', p, 0.5);
    if (opts.fire) this.fx.explosion && this.fx.glow.emit({ x: p.x, y: p.y, z: p.z, color: [1, 0.4, 0.1], size: 0.8, life: 0.3, cell: 3 });
    if (k === this.me) { this.engine.fx.hurt = Math.min(1, this.engine.fx.hurt + r.dmg / 40); this.engine.shake(0.08, 0.2); this.lastHurt = this.time; }
  }

  hostExplode(pos, r, dmg) {
    this.bcast('boom', { x: pos.x, y: pos.y, z: pos.z, r });
    for (const k of this.knightList) { const d = k.pos.distanceTo(pos); if (d < r) this.damageKnight(k, dmg * (1 - d / r * 0.5) * this.diff.dmg, pos, { knockback: 8, knockdown: d < r * 0.5, unblockable: true }, null); }
    for (const d of this.horde.list) { if (!d.alive) continue; const dd = d.pos.distanceTo(pos); if (dd < r && dd > 0.1) d.takeHit(dmg * 1.5, d.pos.clone().sub(pos).normalize(), 1.2, this.hostCtx()); }
  }

  // ================================================================ projectiles
  spawnProjectile(type, src, target, delay = 0) {
    const from = src.chest ? (src.chest.clone ? src.chest.clone() : src.chest) : src.pos.clone();
    const lead = target.vel ? target.vel.clone().multiplyScalar(type === 'lance' ? 0.15 : 0.5) : V(0, 0, 0);
    const to = target.pos.clone().add(lead); to.y = this.world.heightAt(to.x, to.z) + 1.0;
    const a = { id: Math.floor(R() * 1e9), type, from: [from.x, from.y, from.z], to: [to.x, to.y, to.z], delay };
    this.bcast('proj', a);
  }
  addProjectile(a, local) {
    const from = V(...a.from), to = V(...a.to); const dist = from.distanceTo(to);
    const speed = a.type === 'lance' ? 38 : a.type === 'vial' ? 16 : a.type === 'venom' ? 18 : 15;
    const T = Math.max(0.35, dist / speed);
    this.projectiles.push({ ...a, fromV: from, toV: to, T, t: -(a.delay || 0), arc: a.type === 'lance' ? 0 : dist * (a.type === 'vial' ? 0.25 : 0.14), pos: from.clone(), local });
    if (a.type === 'lance') this.audio.whoosh(from, 3, 0.4, 0.4); else if (a.type !== 'vial') this.audio.whoosh(from, 1.2, 0.6, 0.35);
  }
  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]; p.t += dt; if (p.t < 0) continue;
      const k = Math.min(1, p.t / p.T);
      p.pos.lerpVectors(p.fromV, p.toV, k); p.pos.y += Math.sin(k * Math.PI) * p.arc;
      if (p.type === 'bolt') this.fx.bolt(p.pos); else if (p.type === 'lance') { this.fx.bolt(p.pos, [0.6, 0.75, 1]); this.fx.bolt(p.pos.clone().lerp(p.fromV, 0.02), [0.6, 0.75, 1]); }
      else if (p.type === 'venom') this.fx.bolt(p.pos, [0.4, 0.9, 0.2]); else if (p.type === 'vial') this.fx.glow.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, color: [0.8, 0.9, 1], size: 0.18, life: 0.2, cell: 1 });
      if (k >= 1) {
        this.projectiles.splice(i, 1);
        if (p.type === 'vial') { this.vialLand(p); continue; }
        this.fx.ichor(p.pos, null, 0.8); this.audio.hit('cut', p.pos, 0.4);
        if (this.isHost) {
          const dmg = { bolt: 12, lance: 15, venom: 10 }[p.type] * this.diff.dmg;
          for (const kn of this.knightList) if (!kn.downed && kn.chestPos.distanceTo(p.pos) < 1.5) this.damageKnight(kn, dmg, p.fromV, { knockback: 2 }, null);
        }
      }
    }
  }

  // ================================================================ relics
  knightRelic(k, relic) {
    const r = relic || k.loadout.relic;
    if (r === 'water') {
      const f = V(Math.sin(k.yaw), 0, Math.cos(k.yaw)); const hand = k.rig.j.handL.getWorldPosition(new THREE.Vector3());
      let to = k.pos.clone().addScaledVector(f, 11);
      // land on a demon if one is close to the aim line
      let best = null, bs = 1e9; for (const d of this.horde.list) { if (!d.alive) continue; const v = d.pos.clone().sub(k.pos); const along = v.dot(f); if (along < 2 || along > 16) continue; const off = v.clone().addScaledVector(f, -along).length(); if (off < 3 && along < bs) { bs = along; best = d; } }
      if (best) to = best.pos.clone();
      to.y = this.world.heightAt(to.x, to.z);
      const m = { relic: 'water', from: [hand.x, hand.y, hand.z], to: [to.x, to.y, to.z], by: k.id };
      this.onRelic(m, true);
      if (!this.opts.solo) this.net.send('relic', m);
    } else if (r === 'reliquary') {
      const m = { relic: 'reliquary', x: k.pos.x, y: k.pos.y, z: k.pos.z, by: k.id };
      this.onRelic(m, true); if (!this.opts.solo) this.net.send('relic', m);
    } else if (r === 'medal') {
      k.fury = 8; this.fx.holyBurst(k.pos, 2); this.audio.holy(k.pos, 0.6);
      if (!this.opts.solo) this.net.send('relic', { relic: 'medal', x: k.pos.x, y: k.pos.y, z: k.pos.z, by: k.id });
    }
  }
  onRelic(m, local) {
    if (m.relic === 'water') this.addProjectile({ type: 'vial', from: m.from, to: m.to, by: m.by }, local);
    else if (m.relic === 'reliquary') this.reliquaryFx(m);
    else if (m.relic === 'medal') { this.fx.holyBurst(V(m.x, m.y, m.z), 2); this.audio.holy(V(m.x, m.y, m.z), 0.5); }
  }
  vialLand(p) {
    const pos = p.toV;
    this.fx.holyBurst(pos, 4.5); this.audio.clang(pos, 0.4, 2.5); this.audio.holy(pos, 0.6);
    if (this.isHost) {
      for (const d of this.horde.list) if (d.alive && d.pos.distanceTo(pos) < 4.5) d.takeHit(60, d.pos.clone().sub(pos).setY(0).normalize(), 1.2, this.hostCtx());
      if (this.boss && this.boss.alive && this.boss.pos.distanceTo(pos) < 6) this.boss.takeHit(80, null, 0, this.hostCtx());
      this.bcast('consecrate', { x: pos.x, y: pos.y, z: pos.z, r: 4.5, t: 6 });
    }
  }
  updateConsecrations(dt) {
    for (let i = this.consecrations.length - 1; i >= 0; i--) {
      const c = this.consecrations[i]; c.t -= dt; c.tick = (c.tick || 0) - dt;
      this.fx.consecration(c, c.r);
      if (this.isHost && c.tick <= 0) { c.tick = 0.5; for (const d of this.horde.list) if (d.alive && Math.hypot(d.pos.x - c.x, d.pos.z - c.z) < c.r) d.takeHit(8, null, 0.2, this.hostCtx()); }
      if (c.t <= 0) this.consecrations.splice(i, 1);
    }
  }
  reliquaryFx(m) {
    const p = V(m.x, m.y, m.z);
    this.fx.holyBurst(p, 9); this.fx.beam(p, 0xfff0c8, 2.2, 1.4, 30); this.audio.bell(p, 1.2, 0.5); this.audio.holy(p, 0.8);
    for (const k of this.knightList) if (this.owns(k) && !k.downed && k.pos.distanceTo(p) < 10) { k.hp = Math.min(k.maxHp, k.hp + 45); }
    if (this.isHost) for (const d of this.horde.list) if (d.alive && d.pos.distanceTo(p) < 7) d.takeHit(25, d.pos.clone().sub(p).setY(0).normalize(), 1.5, this.hostCtx());
  }

  // ================================================================ revive
  handleRevive(k, inp, dt) {
    if (k.downed || !inp.pray) { if (k.reviving) k.reviving = null; return; }
    const t = this.downedNear(k); if (!t) { k.reviving = null; return; }
    k.reviving = t; inp.mx = inp.mz = 0;
    if (!k.praying) return; // the knight kneels to raise his brother
    const prog = (t._revLocal = Math.min(1, (t._revLocal || t.reviveProgress || 0) + dt / 3 * (k.prayMul || 1)));
    if (this.owns(t)) { t.reviveProgress = Math.max(t.reviveProgress, prog); if (t.reviveProgress >= 1) this.reviveKnight(t); }
    else { this.reviveSend -= dt; if (this.reviveSend <= 0 || prog >= 1) { this.reviveSend = 0.25; this.net.send('rev', { to: t.id, p: prog }, t.isAI ? this.net.hostId : t.id); } if (prog >= 1) t._revLocal = 0; }
  }
  // the priest's blessing raises you once by itself; the second wind, once a chapter, if no brother is near to do it
  selfRise(k) {
    const alone = !this.knightList.some((o) => o !== k && !o.downed && o.pos.distanceTo(k.pos) < 25);
    let why = null, hp = 0.3;
    if (k.blessRise) { k.blessRise = false; why = 'Father Bertram\'s blessing raises you'; hp = 0.5; }
    else if (k.secondWind && !this.secondWindUsed && alone) { this.secondWindUsed = true; why = 'Second wind'; }
    if (!why) return;
    setTimeout(() => { if (k.downed && this.me === k) { k.revive(hp); this.fx.holyBurst(k.pos, 2.5); this.audio.holy(k.pos, 0.7); this.ui.downed(false); this.ui.toast(why, 2.5); } }, 2200);
  }
  reviveKnight(k) { k.revive(0.45); k._revLocal = 0; this.fx.holyBurst(k.pos, 2.5); this.audio.holy(k.pos, 0.6); if (k === this.me) this.ui.downed(false); }

  // ================================================================ reactions
  knightEvents(k) {
    const ev = k.events; if (!ev.length) return;
    const p = k.chestPos;
    for (const e of ev) switch (e.type) {
      case 'step': { const wd = this.weather?.hasWater ? this.weather.waterDepth(k.pos.x, k.pos.z) : -1;
        if (wd > 0.04) { this.weather.footSplash(k.pos, wd, e.run); break; }
        this.audio.footstep(k.pos, true, 0.8 + e.run * 0.6); if (e.run > 0.5 && R() < 0.5) this.fx.dust(k.pos, 2); break; }
      case 'sfx':
        if (e.k === 'swing') this.audio.swing(false, p, 1 + R() * 0.15);
        else if (e.k === 'heavySwing') this.audio.swing(true, p, 0.8 + R() * 0.1);
        else if (e.k === 'thrust') this.audio.whoosh(p, 1.6, 0.25, 0.35);
        else if (e.k === 'roll') { this.audio.footstep(k.pos, true, 1.6); this.fx.dust(k.pos, 6); }
        else if (e.k === 'land') { this.audio.footstep(k.pos, true, 2); this.fx.dust(k.pos, 5); }
        else if (e.k === 'grunt') this.audio.growl(p, 2.4, 0.25, 0.12);
        break;
      case 'slam': {
        this.fx.slam(k.pos, e.r); this.audio.explode(k.pos, 0.45); if (k === this.me) this.engine.shake(0.12, 0.3);
        if (this.owns(k)) for (const d of this.horde.list) if (d.alive && !k.hitSet.has('slam' + d.id) && d.pos.distanceTo(k.pos) < e.r) {
          const dir = d.pos.clone().sub(k.pos).setY(0).normalize();
          if (this.isHost) d.takeHit(e.dmg, dir, 1.0, this.hostCtx(), k.id); else this.net.send('hit', { d: d.id, dmg: e.dmg, dx: dir.x, dz: dir.z, st: 1 }, this.net.hostId);
        }
        break;
      }
      case 'relic': if (this.owns(k)) this.knightRelic(k, e.relic); break;
      case 'parry': break;
      case 'block': break;
      case 'downed': this.audio.clang(p, 0.8, 0.5); this.fx.dust(k.pos, 8); if (k === this.me) { this.ui.downed(true); this.audio.heartbeat(0.7); this.myDowns = (this.myDowns || 0) + 1; this.selfRise(k); } else this.ui.toast(`${k.name} has fallen`, 2.5); break;
      case 'revived': if (k === this.me) this.ui.downed(false); break;
      case 'prayStart': if (k === this.me && !k.reviving) { this.prayerLine = 0; this.prayerLineT = 0.4; } break;
      case 'cross': this.audio.bell(p, 2.2, 0.08); break;
      case 'tired': if (k === this.me) this.ui.toast('Out of breath', 0.8); break;
    }
    ev.length = 0;
  }
  updateTrail(k, dt) {
    const tr = this.trails.get(k.id); if (!tr) return;
    const a = k.action; const active = !!(a && a.hits && a.hits.some((h) => k.actT >= h.t0 - 0.05 && k.actT <= h.t1 + 0.03));
    tr.update(dt, k.base, k.tip, active);
    if (k.fury > 0 && R() < 0.5) this.fx.holyMotes(k.tip, 0.15, 1, [1, 0.8, 0.4]);
    if (k.wdef.glow && R() < dt * 9) this.fx.holyMotes(k.base.clone().lerp(k.tip, 0.6 + R() * 0.4), 0.08, 1, k.wdef.glow);
    if (k.blessT > 0 && R() < dt * 5) this.fx.holyMotes(k.chestPos, 0.45, 1, [1, 0.92, 0.65]);
  }
  // ---------------------------------------------------------------- the relic weapons' gifts
  // a hit on a demon from this machine: the host applies it, a guest sends it to the host
  strikeDemon(k, d, dmg, st = 0.5) {
    if (!d.alive) return; const dir = new THREE.Vector3(d.pos.x - k.pos.x, 0, d.pos.z - k.pos.z).normalize();
    if (this.isHost) { if (d.takeHit(dmg, dir, st, this.hostCtx(), k.id)) { this.stats.kills++; if (k === this.me) account.record('kill'); } }
    else this.net.send('hit', { d: d.id, dmg, dx: dir.x, dz: dir.z, st }, this.net.hostId);
  }
  relicHit(k, d, dmg, p, kill) {
    const w = k.wdef; if (!this.owns(k)) return;
    if (w.holy && !kill) { const b = this.burns.find((x) => x.d === d); if (b) b.t = 3; else this.burns.push({ d, k, t: 3, tick: 0.5, dps: 7 * w.holy * (w.fireHeavy ? 1.6 : 1) }); }
    if (w.lifeSteal && kill && !k.downed) { k.hp = Math.min(k.maxHp, k.hp + w.lifeSteal); this.fx.holyMotes(k.chestPos, 0.4, 3, [1, 0.9, 0.6]); }
    if (k.actKind === 'heavy' && !k.hitSet.has('relicFx')) {
      k.hitSet.add('relicFx');
      if (w.fireHeavy) {   // holy fire where the blade came down: it burns everything standing in it
        const c = p.clone(); c.y = this.world.heightAt(c.x, c.z);
        this.fx.holyBurst(c, 1.5); this.fx.flames?.(c, 1.2); this.audio.holy?.(c, 0.5);
        for (const o of this.horde.list) if (o.alive && o !== d && o.pos.distanceTo(c) < 3) { this.strikeDemon(k, o, 14); if (!this.burns.find((x) => x.d === o)) this.burns.push({ d: o, k, t: 3, tick: 0.5, dps: 9 }); }
      }
      if (w.shockHeavy) {   // the hammer rings: a wave of holy force round the blow
        const c = p.clone(); this.fx.holyBurst(c, 2.2); this.audio.bell?.(c, 1.6, 0.5); this.engine.shake(0.06, 0.2);
        for (const o of this.horde.list) if (o.alive && o !== d && o.pos.distanceTo(c) < 3.5) this.strikeDemon(k, o, 22, 1.2);
      }
    }
  }
  updateBurns(dt) {
    if (!this.burns?.length) return;
    for (const b of this.burns) {
      b.t -= dt; b.tick -= dt; const d = b.d; if (!d.alive) { b.t = 0; continue; }
      if (R() < dt * 14) this.fx.glow.emit({ x: d.chest.x + (R() - 0.5) * 0.5, y: d.chest.y + (R() - 0.3) * 0.8, z: d.chest.z + (R() - 0.5) * 0.5, vy: 1.4, color: [1, 0.75, 0.35], size: 0.22, grow: 0.6, life: 0.5, cell: 3, spin: 2 });
      if (b.tick <= 0) { b.tick = 0.5; this.strikeDemon(b.k, d, b.dps * 0.5, 0.1); }
    }
    this.burns = this.burns.filter((b) => b.t > 0);
  }
  // silver for each demon banished near you, by how dangerous it was
  demonDeathFx(d) {
    if (this.me && !this.me.downed && d.pos.distanceTo(this.me.pos) < 35) this.shop.earn(d.def.silver || 3 + (d.def.score || 1) * 3, null, d.chest);
    this.fx.death(d.chest, d.def.big ? 2 : 1);
    this.audio.shriek(d.chest, d.def.big ? 0.5 : 0.82 + R() * 0.2, d.def.big ? 1.2 : 0.5, 0.3);
  }
  demonSfx(a) {
    const p = V(a.x, a.y + 1.2, a.z);
    if (a.type === 'altar') { this.audio.growl(p, 0.5, 2, 0.5); this.ui.toast('The altar wakes. Kneel and pray', 3); return; }
    if (a.type === 'boss') return;
    const pitch = { shade: 1.0, crawler: 1.1, wretch: 0.95, husk: 0.75, brute: 0.6, wraith: 1.05, herald: 0.85 }[a.type] || 1;
    switch (a.kind) {
      case 'windup': if (R() < 0.6) this.audio.scream(p, pitch < 0.8, 0.45, pitch * 0.85); else this.audio.shriek(p, pitch, 0.35, 0.22); break;
      case 'leap': this.audio.scream(p, pitch < 0.8, 0.55, pitch); break;
      case 'cast': this.audio.whisper(p, 0.9, 0.35); break;
      case 'inflate': this.audio.growl(p, 1.6, 1.1, 0.5); break;
      case 'roar': this.audio.roar(p, 0.6, 1.4); break;
      case 'blink': this.audio.whoosh(p, 2, 0.5, 0.4); this.fx.death(p, 0.6); break;
      case 'lance': this.audio.whisper(p, 1.2, 0.5); break;
      case 'shriek': this.audio.shriek(p, 0.8, 1.4, 0.7); this.engine.shake(0.05, 0.5); break;
      case 'shriekShort': this.audio.shriek(p, 0.9, 0.6, 0.5); break;
      case 'spot': this.audio.scream(p, pitch < 0.8, 0.7, pitch * 0.9); if (R() < 0.5) this.audio.shriek(p, pitch * 1.05, 0.9, 0.35); break;   // it has seen you
    }
  }
  creviceGrab(c, k) {
    this.damageKnight(k, 14 * this.diff.dmg, V(c.s.x, 0, c.s.z), { knockback: 7 }, null);
    this.bcast('grab', { i: c.idx, x: c.s.x, y: c.s.y, z: c.s.z });
  }
  watcherEvent(s) {
    if (!this.watcher) return;
    const p = this.watcher.pos.clone(); p.y += 3;
    if (s === 'appear') { this.audio.whisper(p, 3, 0.5); this.audio.heartbeat(0.35); if (!this.watcherSeen) { this.watcherSeen = true; this.ui.subtitle(['Something stands on the ridge, watching.', ''], 4); } else if (R() < 0.6) setTimeout(() => this.story.whisper(this.dread.alone), 2500); }
    if (s === 'turn') this.audio.whisper(p, 2, 0.7);
  }
  cleanseFx(i) {
    const a = this.world.altars[i]; if (!a) return;
    this.shop.earn(50, 'the altar is hallowed');
    this.world.cleanse(i);
    const p = V(a.x, a.y, a.z);
    this.fx.holyBurst(p, 10); this.fx.beam(p, 0xffe8b0, 6, 3, 90); this.fx.holyMotes(p, 20, 120);
    this.audio.bell(p, 1, 0.9); setTimeout(() => this.audio.bell(p, 0.75, 0.6), 1400); this.audio.holy(p, 1);
    this.engine.fx.holy = 1.0;
    this.setMood('triumph', 0.1);
    this.ui.toast('The land is cleansed', 4);
    this.ui.subtitle(PRAYERS[5], 5);
    // every knight is healed; the fallen rise
    for (const k of this.knightList) if (this.owns(k)) { if (k.downed) this.reviveKnight(k); k.hp = k.maxHp; }
    // the sky lightens a little with every altar (eased in by the frame loop)
    this.atmosEnvF = -1;
  }
  blendAtmosphere(f, env = true) {
    const base = CHAPTERS[this.chapterIdx].atmos; const mix = {}; const kd = CHAPTERS[this.chapterIdx].terrain.kind, HEALED = kd === 'mountain' || kd === 'peak' ? HEALED_HIGH : HEALED_LOW;
    for (const key in base) {
      if (HEALED[key] !== undefined && typeof base[key] === 'number' && key !== 'cover' && key !== 'sunIntensity' && key !== 'hemiIntensity' && key !== 'fogDensity' && key !== 'exposure' && key !== 'fillIntensity' && key !== 'sunSize') mix[key] = new THREE.Color(base[key]).lerp(new THREE.Color(HEALED[key]), f).getHex();
      else mix[key] = base[key];
    }
    mix.fogDensity = base.fogDensity * (1 - f * 0.4); mix.cover = base.cover * (1 - f * 0.4);
    this.engine.setAtmosphere(mix, env); this.fx.setFog(this.scene.fog);
    if (this.cave) { this.cave.base = null; this.cave.applyDark(this.cave.inCam || 0); }   // inside the mountain the sky's light stays out
  }
  // The Peak's first shot: a dragon (a stand-in with no game state) passes across the storm above, high and dark,
  // the lightning showing him in flashes. Returns the per-frame tick and the cleanup.
  peakSilhouette(lead) {
    let d = null; try { d = new Dragon(this.scene, 1, null); } catch (e) { return { tick: () => {}, cleanup: () => {} }; }
    d.state = 'circle'; d.fly = 1; d.alt = 0; let a = -0.6, t = 0, nextBolt = 0.4;
    const tick = (dt) => {
      t += dt; a += dt * 0.16;
      d.pos.set(lead.x + Math.sin(a) * 70, lead.y + 38 + Math.sin(t * 0.7) * 3, lead.z + 40 + Math.cos(a) * 30);
      d.vel.set(Math.cos(a) * 11, 0, -Math.sin(a) * 5); d.yaw = Math.atan2(d.vel.x, d.vel.z);
      d.animate(dt, this.time + t, null);
      nextBolt -= dt; if (nextBolt <= 0) { nextBolt = 0.9 + Math.random() * 1.4; try { this.world?.vista?.strike?.(); } catch {} }
      if (t > 1.5 && t < 1.6) this.audio.roar?.(null, 0.35, 2.6);
    };
    return { tick, cleanup: () => { d.dispose(); } };
  }
  // The first time He shows himself in a chapter: the camera finds Him on the ridge and closes in on that face
  // where his face really is (the head bone, a little forward of it), whatever he is standing on
  devilFace(off = 0.12) { const D = this.watcher; if (!D || !D.B?.head) return null; D.mesh.updateMatrixWorld(true); return D.B.head.localToWorld(new THREE.Vector3(0, 0.02, off)); }
  // is the straight line from a to b clear of the ground (with a little margin)?
  terrainClear(a, b, margin = 0.4) {
    const w = this.world, n = Math.ceil(a.distanceTo(b) / 1.5);
    for (let i = 1; i < n; i++) { const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t; if (w.heightAt(x, z) > y - margin) return false; }
    return true;
  }
  // if a hill hides Him from where the camera will be, set Him on open high ground that can be seen
  placeDevilInView(eye) {
    const W = this.watcher, w = this.world, faceUp = 1.75;
    const face = (x, z) => V(x, w.heightAt(x, z) + faceUp, z);
    if (this.terrainClear(eye, face(W.pos.x, W.pos.z))) return true;
    const a0 = Math.atan2(W.pos.x - eye.x, W.pos.z - eye.z);
    let best = null, bs = -1e9;
    for (let i = 0; i < 60; i++) {
      const a = a0 + ((i % 15) - 7) * 0.16, r = 45 + Math.floor(i / 15) * 18;
      const x = eye.x + Math.sin(a) * r, z = eye.z + Math.cos(a) * r;
      if (!w.inBounds(x, z) || w.normalAt(x, z).y < 0.8 || !w.okSpot(x, z, 3, 8)) continue;
      const f = face(x, z); if (!this.terrainClear(eye, f)) continue;
      const sc = (f.y - eye.y) * 1.5 - Math.abs(a - a0) * 12 - Math.abs(r - 70) * 0.2;   // high ground, near where He was
      if (sc > bs) { bs = sc; best = { x, z }; }
    }
    if (!best) return false;
    W.pos.set(best.x, w.heightAt(best.x, best.z), best.z); W.yaw = Math.atan2(eye.x - best.x, eye.z - best.z);
    W.mesh.position.copy(W.pos); W.mesh.rotation.y = W.yaw; W.holdNet = performance.now() + 9000;
    return true;
  }
  checkDevilReveal() {
    const W = this.watcher, o = this.obj; if (!W || !o || o.ph !== 'travel' || this.cinema.active || this.boss || this.paused) return;
    if (W.state !== 'watch' || !W.mesh.visible) return;
    const me = this.me; if (me.downed || me.praying) return;
    const d = Math.hypot(W.pos.x - me.pos.x, W.pos.z - me.pos.z); if (d > 200 || d < 40) return;
    const seen = { ...account.get('evil.devilReveal', {}) };
    const key = CHAPTERS[this.chapterIdx].id; if (seen[key]) return;
    for (const dm of this.horde.list) if (dm.alive && dm.pos.distanceTo(me.pos) < 25) return;
    // from the camera's place at your shoulder, He must not be behind a hill: move Him into view, or wait
    { const dir0 = V(W.pos.x - me.pos.x, 0, W.pos.z - me.pos.z).normalize(); const eye = V(me.pos.x - dir0.x * 2.5 + dir0.z * 0.8, me.pos.y + 2.0, me.pos.z - dir0.z * 2.5 - dir0.x * 0.8);
      if (!this.placeDevilInView(eye)) return; }
    seen[key] = 1; account.set('evil.devilReveal', seen);
    const LINES = { vale: ['Ecce, adversarius vester.', 'Behold your adversary.'], village: ['Circuit, quaerens quem devoret.', 'He walks about, seeking whom he may devour.'], fen: ['Vidit vos. Semper vidit.', 'He has seen you. He has always seen you.'], wood: ['Princeps huius mundi.', 'The prince of this world.'], field: ['Legio nomen mihi est.', 'My name is Legion.'], ascent: ['Venite. Exspecto.', 'Come. I am waiting.'] };
    const p = W.pos, m = me.pos; const face = this.devilFace() || V(p.x, p.y + 3.1, p.z), hy = face.y;
    const gnd = (x, z) => this.world.heightAt(x, z), trk = () => this.devilFace();
    const dir = V(p.x - m.x, 0, p.z - m.z).normalize();
    const near = V(face.x - dir.x * 9, hy + 0.3, face.z - dir.z * 9); for (let i = 0; i < 12 && !this.terrainClear(near, face, 0.25); i++) near.y += 0.5;
    this.audio.stinger?.('drone', 0.5); this.audio.heartbeat?.(0.5);
    this.dread && (this.dread.level = Math.min(1, this.dread.level + 0.1));
    this.cinema.play([
      { dur: 3.2, from: { pos: V(m.x - dir.x * 2.5 + dir.z * 0.8, m.y + 2.0, m.z - dir.z * 2.5 - dir.x * 0.8), look: face.clone() }, to: { pos: V(m.x - dir.x * 2.2 + dir.z * 0.7, m.y + 1.9, m.z - dir.z * 2.2 - dir.x * 0.7), look: face.clone() }, fov: 40, fovTo: 22, text: LINES[key] || LINES.vale, trackLook: true, track: trk, anchor: face.clone(), ground: gnd },
      { dur: 3.4, from: { pos: near, look: face.clone() }, to: { pos: V(face.x - dir.x * 6, hy + 0.15, face.z - dir.z * 6), look: face.clone().setY(hy - 0.05) }, fov: 30, fovTo: 18, text: '', at: () => this.audio.whisper?.(V(p.x, hy, p.z), 2.6, 0.7), track: trk, anchor: face.clone(), ground: gnd },
    ], null, { skippable: true });
  }
  playOutro(n) {
    { const mins = this.chT0 ? (performance.now() - this.chT0) / 60000 : 99; let bonus = 0; const why = ['the road is won'];
      if (!this.myDowns) { bonus += 80; why.push('never fell'); }
      if (mins < 12) { bonus += 60; why.push('swift'); }
      this.shop.earn(150 + bonus, why.join(' · ')); }
    const ch = CHAPTERS[n]; const w = this.world; const last = w.altars[w.altars.length - 1];
    this.setMood('triumph', 0);
    this.blendAtmosphere(0.45);
    const p = V(last.x, last.y, last.z);
    const shots = [
      orbitShot(p, 16, 6, 0.5, 1.4, 6, 2, { text: ch.outro[0] || '' }),
      { dur: 6, from: { pos: V(p.x + 10, p.y + 30, p.z - 30), look: p }, to: { pos: V(p.x + 25, p.y + 55, p.z - 50), look: p }, fov: 48, text: ch.outro[1] || '' },
    ];
    let undo = null;
    if (ch.devil?.watch && this.watcher) {
      // He stares out of the dark at you: on open ground away from the crags, nothing behind him but black, the wind
      // dragging his robes out sideways
      let best = null, bs = -1e9;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, r = 26 + (k % 3) * 8, x = last.x + Math.cos(a) * r, z = last.z + Math.sin(a) * r;
        if (!w.inBounds(x, z)) continue;
        const n = w.normalAt(x, z); let crag = 1e9; for (const d of w.devilSpots) crag = Math.min(crag, Math.hypot(d.x - x, d.z - z));
        // the camera stands 4.4 m in front of Him, between Him and the altar: it must see His face over the ground
        { const fx0 = Math.sin(a + Math.PI), fz0 = Math.cos(a + Math.PI), gy0 = w.heightAt(x, z), cx0 = x + fx0 * 4.4, cz0 = z + fz0 * 4.4;
          if (!this.terrainClear(V(cx0, Math.max(gy0, w.heightAt(cx0, cz0)) + 1.2, cz0), V(x, gy0 + 1.75, z), 0.2)) continue; }
        const sc = n.y * 40 + Math.min(crag, 40) + (w.okSpot(x, z, 3, 6) ? 30 : 0);
        if (sc > bs) { bs = sc; best = { x, z, a }; }
      }
      if (best) {
        const gy = w.heightAt(best.x, best.z), yaw = best.a + Math.PI;   // he faces back toward the altar, and the camera between
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        const cx = best.x + fx * 4.4, cz = best.z + fz * 4.4, cy = Math.max(gy, w.heightAt(cx, cz)) + 2.1;
        const D = this.watcher, e = this.engine, sc = this.scene;
        const plan = V(best.x, gy + 2.7, best.z);
        shots.push({ dur: 6.5, from: { pos: V(cx, cy, cz), look: plan.clone().setY(gy + 2.75) }, to: { pos: V(best.x + fx * 3.2, cy + 0.25, best.z + fz * 3.2), look: plan.clone().setY(gy + 2.6) }, fov: 34,
          track: () => this.devilFace(), anchor: plan, ground: (x, z) => w.heightAt(x, z),
          at: () => {
            D.pos.set(best.x, gy, best.z); D.yaw = yaw; D.state = 'stare'; D.t = 0; D.fade = 1; D.mesh.visible = true; D.mesh.position.set(best.x, gy, best.z); D.mesh.rotation.y = yaw;
            robeWind(0.45, 0.08);
            // the dark: black all round, the world lit only by a cold glimmer on his face
            const saved = { fc: sc.fog.color.clone(), fd: sc.fog.density, sun: e.sun.intensity, hemi: e.hemi.intensity, fill: e.fill.intensity, exp: e.renderer.toneMappingExposure };
            sc.fog.color.setHex(0x010102); sc.fog.density = 0.1; e.sun.intensity *= 0.15; e.hemi.intensity *= 0.35; e.fill.intensity = 0;
            const dark = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 10), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, fog: false }));
            dark.position.set(best.x, gy, best.z); sc.add(dark);
            const key = new THREE.PointLight(0x9fb0c8, 14, 7, 2);
            const rim = new THREE.PointLight(0x5a6890, 30, 9, 2); rim.position.set(best.x - fx * 2.5 - fz * 2.2, gy + 4, best.z - fz * 2.5 + fx * 2.2); sc.add(rim); key.position.set(best.x + fx * 2.2 + fz * 1.4, gy + 3.6, best.z + fz * 2.2 - fx * 1.4); sc.add(key);
            this.audio.whisper(V(best.x, gy + 3, best.z), 3, 0.6); this.audio.setAmbience?.(1.1, 0.2);
            undo = () => {
              sc.fog.color.copy(saved.fc); sc.fog.density = saved.fd; e.sun.intensity = saved.sun; e.hemi.intensity = saved.hemi; e.fill.intensity = saved.fill; e.renderer.toneMappingExposure = saved.exp;
              dark.removeFromParent(); dark.geometry.dispose(); dark.material.dispose(); key.removeFromParent(); rim.removeFromParent();
              robeWind(0, 0); D.state = 'hidden'; D.mesh.visible = false; D.cool = 20;
            };
          } });
        // compile his shaders now, so the shot does not hitch when he first appears
        D.mesh.visible = true; D.mesh.position.set(best.x, gy, best.z); try { this.engine.renderer.compile(this.scene, this.engine.camera); } catch {} D.mesh.visible = false;
      }
    }
    this.cinema.play(shots, () => { undo?.(); this.ui.fade(true); }, { skippable: false });
  }
  victory() {
    const b = this.boss; this.setMood('triumph', 0);
    this.saveProgress(CHAPTERS.length - 1);
    const p = b ? b.pos.clone() : V(0, 0, 0);
    // Heaven's light breaks over the summit and runs down the mountain
    this.fx.beam(V(p.x, p.y, p.z), 0xfff4d0, 12, 6, 200); this.fx.holyBurst(p, 14);
    this.audio.bell(p, 0.5, 1); setTimeout(() => this.audio.bell(p, 0.75, 0.8), 1500); setTimeout(() => this.audio.bell(p, 1, 0.7), 3000);
    let f = 0, step = 0; const tick = setInterval(() => { f = Math.min(1, f + 0.05); this.blendAtmosphere(f, f >= 1 || ++step % 5 === 0); /* reflections rebuilt now and then, not every step */ for (const a of this.world.altars) this.world.paintLife(a.x, a.z, 60 * f, 1); if (f >= 1) clearInterval(tick); }, 300);
    for (const k of this.knightList) if (!k.downed) setTimeout(() => k.salute(), 1500);
    const me = this.me.pos;
    this.cinema.play([
      orbitShot(p, 22, 8, 0, 1.2, 8, 3, { text: ['Et proiectus est draco ille magnus, serpens antiquus.', 'And that great dragon was cast out, that old serpent, called the Devil and Satan.'] }),
      orbitShot(me, 7, 1.8, 2.4, 3.4, 7, 1.6, { text: ['The land lives.', ''] }),
      { dur: 9, from: { pos: V(me.x, me.y + 4, me.z - 6), look: V(me.x, me.y + 2, me.z) }, to: { pos: V(me.x - 60, me.y + 70, me.z - 120), look: V(0, -20, 0) }, fov: 50, text: ['Deo gratias.', 'Thanks be to God.'] },
    ], () => this.credits(), { skippable: false });
  }
  credits() {
    const mins = Math.round((performance.now() - this.stats.start) / 60000);
    const el = document.getElementById('credits'); el.hidden = false;
    el.innerHTML = `<h1 class="title">Evil in the Land</h1><p>The Great Dragon is cast down, and the land is healed from the city walls to the peak.</p><p>${this.stats.kills} demons banished · ${mins} minutes on the road</p><div class="row"><button class="btn primary" id="credBack">Return</button></div>`;
    document.getElementById('credBack').onclick = () => { el.hidden = true; this.app.endGame(true); };
  }

  // ================================================================ music
  setMood(m, intensity) { this.musicMood = m; const mu = this.audio.music; if (mu) { mu.setMood(m); if (intensity !== undefined) mu.setIntensity(intensity); } }
  updateMusic(dt) {
    const mu = this.audio.music; if (!mu) return;
    this.audio.update(dt);
    this.audio.dread = this.dread?.level ?? 0;   // the prayer music falters when the fear is on them
    const near = this.horde.list.filter((d) => d.alive && d.pos.distanceTo(this.me.pos) < 30).length;
    let mood = 'dread', I = Math.min(1, near / 10);
    if (this.boss && this.boss.alive) {
      // the Dragon gets his own score, building with each phase of the fight
      if (this.boss.kind === 'dragon') { mood = 'final'; I = this.boss.phase >= 3 ? 1 : this.boss.phase === 2 ? 0.82 : this.boss.state === 'intro' ? 0.5 : 0.62; }
      else { mood = 'boss'; I = 1; }
    }
    else if (this.obj?.ph === 'pray') { mood = this.me.praying ? 'prayer' : 'dread'; I = Math.max(0.5, I); }
    else if (this.obj?.ph === 'cleansed' || this.obj?.ph === 'outro') { mood = 'triumph'; I = 0; }
    if (this.cinema.active && this.obj?.ph === 'intro') { I = 0.1; if (CHAPTERS[this.chapterIdx]?.id === 'peak') { mood = 'final'; I = 0.3; } }
    mu.setMood(mood); mu.setIntensity(I);
    // the Latin of the prayer, line by line, while the local knight kneels
    if (this.me.praying && !this.me.reviving && this.obj?.ph === 'pray') {
      this.prayerLineT -= dt;
      if (this.prayerLineT <= 0) { this.prayerLineT = 6; this.ui.subtitle(PRAYERS[this.prayerLine % PRAYERS.length], 5); this.prayerLine++; }
    }
  }

  // ================================================================ HUD
  updateHud(dt) {
    const ui = this.ui, me = this.me, o = this.obj;
    ui.update(dt);
    ui.updateSelf(me);
    ui.party(this.knightList, this.meId);
    ui.hurt(this.engine.fx.hurt * 0.9 + (me.hp / me.maxHp < 0.25 ? 0.25 + Math.sin(this.time * 4) * 0.1 : 0));
    this.engine.fx.desat = Math.max(me.downed ? 0.8 : me.hp / me.maxHp < 0.25 ? 0.35 : 0, this.engine.fx.dreadDesat || 0);
    if (me.hp / me.maxHp < 0.25 && !me.downed) { this.heartT = (this.heartT || 0) - dt; if (this.heartT <= 0) { this.heartT = 1.1; this.audio.heartbeat(0.4); } }
    if (!o || !this.world) return;
    const ch = CHAPTERS[this.chapterIdx];
    // objective & prayer meter
    const a = this.currentAltar();
    let objText = '';
    if (o.ph === 'travel') objText = `Seek the ${ordinal(o.a)} blighted altar · ${this.world.altars.filter((x) => x.state === 'cleansed').length} of ${this.world.altars.length} cleansed`;
    else if (o.ph === 'pray') objText = 'Kneel and pray · defend those at prayer';
    else if (o.ph === 'cleansed') objText = 'The land is cleansed';
    else if (o.ph === 'boss' && this.boss) objText = o.wards ? 'Pray at the wards to cast Him down' : `Destroy ${this.boss.name}`;
    else if (o.ph === 'wipe') objText = '';
    const trade = o.ph === 'travel' && this.shop?.tradeLabel?.(); if (trade) objText = trade;
    ui.objective(objText);
    const showPrayer = (o.ph === 'pray' && a && a.state === 'active') || (o.wards && this.activeWard());
    const pa = o.wards ? this.activeWard() : a;
    if (showPrayer && pa) { ui.prayer(true, pa.progress || 0, o.n || 0); } else ui.prayer(false);
    // prompt
    let pr = '';
    if (!me.downed && !this.cinema.active) {
      const dn = this.downedNear(me);
      if (dn) pr = `<kbd>E</kbd>Hold to raise ${esc(dn.name)}`;
      else if (this.altarFor(me) && !me.praying) pr = '<kbd>E</kbd>Hold to kneel and pray';
      else if (this.cave?.prompt()) pr = this.cave.prompt();
      else if (this.shop.prompt()) pr = this.shop.prompt();
    }
    ui.prompt(pr);
    ui.counter(this.horde.aliveCount ? `${this.horde.aliveCount} demons` : '');
    ui.boss(this.boss && (this.boss.alive || this.boss.hp <= 0) && this.obj.ph !== 'outro' ? this.boss : null);
    // compass
    const marks = [];
    const tgt = o.wards ? this.activeWard() : (o.ph === 'travel' || o.ph === 'pray') ? a : null;
    if (tgt) marks.push({ yaw: Math.atan2(tgt.x - me.pos.x, tgt.z - me.pos.z), kind: 'altar' });
    if (this.boss && this.boss.alive) marks.push({ yaw: Math.atan2(this.boss.pos.x - me.pos.x, this.boss.pos.z - me.pos.z), kind: 'boss' });
    for (const sp of this.story.spots) if (!sp.taken && Math.hypot(sp.x - me.pos.x, sp.z - me.pos.z) < 70) marks.push({ yaw: Math.atan2(sp.x - me.pos.x, sp.z - me.pos.z), kind: 'page' });
    ui.compass(this.cam.yaw, marks);
  }

  dispose() {
    for (const k of this.knightList) k.dispose();
    for (const t of this.trails.values()) t.dispose(this.scene);
    this.horde.clear(); if (this.boss) this.boss.dispose(); if (this.world) this.world.dispose();
    if (this.watcher) this.scene.remove(this.watcher.mesh);
    if (this._phantomDevil) this.scene.remove(this._phantomDevil.mesh);
    this.story.dispose(); this.dread.dispose(); this.shop.dispose(); this.terror.dispose(); this.cave?.dispose(); this.cave = null; this.weather?.dispose(); this.weather = null; for (const k of this.fallenKnights || []) k.dispose();
    for (const k of ['k:sv', 'k:ks', 'k:snap', 'k:ev', 'k:hit', 'k:bhit', 'k:dmg', 'k:parried', 'k:rev', 'k:relic', 'k:gear', 'k:skip', 'k:kc', 'left']) this.net?.off(k);
  }
}

// closest points between segments ab and cd: { p (on ab), d (distance) }
const _ca = new THREE.Vector3(), _cb = new THREE.Vector3();
function segSegClosest(a, b, c, d) {
  const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
  const A = u.dot(u), B = u.dot(v), Cc = v.dot(v), D = u.dot(w), E = v.dot(w), den = A * Cc - B * B;
  let s = den > 1e-8 ? clamp((B * E - Cc * D) / den, 0, 1) : 0;
  let t = Cc > 1e-8 ? clamp((B * s + E) / Cc, 0, 1) : 0;
  s = A > 1e-8 ? clamp((B * t - D) / A, 0, 1) : 0;
  const p = a.clone().addScaledVector(u, s), q = c.clone().addScaledVector(v, t);
  return { p, d: p.distanceTo(q) };
}
function closestOnSeg(p, a, b) { const ab = b.clone().sub(a); const t = clamp(p.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1); return a.clone().addScaledVector(ab, t); }
function ordinal(i) { return ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][i] || 'next'; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
