// Audio: a sound library rendered offline at load (ensemble choir, strings,
// low brass, war drums, steel, flesh, footsteps, demon voices, bells), played
// back with variation through positional panners and a cathedral reverb.
// If you put your own music in /audio (see README), it replaces the score.
import { clamp, lerp } from './util.js';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const R = Math.random;
const SR = 32000;

const VOWELS = {
  ah: [[700, 1], [1220, 0.55], [2600, 0.25], [3300, 0.12]],
  oh: [[450, 1], [800, 0.5], [2830, 0.15], [3300, 0.08]],
  oo: [[325, 1], [700, 0.35], [2530, 0.1], [3300, 0.05]],
  eh: [[530, 1], [1840, 0.45], [2480, 0.22], [3300, 0.1]],
};

// ---------------------------------------------------------------- offline renderers
function off(sec, ch = 1) { return new OfflineAudioContext(ch, Math.ceil(sec * SR), SR); }
function noiseBuf(ctx, sec, color = 'white') {
  const len = Math.ceil(sec * ctx.sampleRate), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  let l = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = R() * 2 - 1;
    if (color === 'brown') { l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; }
    else if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    else d[i] = w;
  }
  return b;
}
function src(ctx, buf) { const s = ctx.createBufferSource(); s.buffer = buf; return s; }
function gainEnv(ctx, pts) { const g = ctx.createGain(); g.gain.setValueAtTime(pts[0][1], 0); for (let i = 1; i < pts.length; i++) g.gain[pts[i][2] === 'e' ? 'exponentialRampToValueAtTime' : 'linearRampToValueAtTime'](Math.max(pts[i][2] === 'e' ? 1e-4 : 0, pts[i][1]), pts[i][0]); return g; }
function bp(ctx, f, q) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; return b; }
function filt(ctx, type, f, q = 0.7) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
function normalize(buf, peak = 0.9) {
  let m = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); }
  if (m > 0) { const k = peak / m; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; } }
  return buf;
}

const RENDER = {
  // a blade cutting the air: broadband rush + edge whistle, rising then falling
  async swing(heavy) {
    const dur = heavy ? 0.6 : 0.38; const ctx = off(dur + 0.05);
    const n = src(ctx, noiseBuf(ctx, dur + 0.05, 'pink'));
    const peak = dur * (0.42 + R() * 0.12);
    const f0 = (heavy ? 260 : 420) * (0.85 + R() * 0.3);
    for (const [mul, q, amp] of [[1, 1.2, 1], [4.5, 2.5, 0.45], [9, 4, 0.18]]) {
      const b = bp(ctx, f0 * mul, q); b.frequency.setValueAtTime(f0 * mul * 0.6, 0); b.frequency.exponentialRampToValueAtTime(f0 * mul * 2.2, peak); b.frequency.exponentialRampToValueAtTime(f0 * mul * 0.7, dur);
      const g = gainEnv(ctx, [[0, 0], [peak * 0.85, amp], [peak, amp * 1.1], [dur, 0.0001, 'e']]);
      n.connect(b).connect(g).connect(ctx.destination);
    }
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(1100 + R() * 500, 0); o.frequency.exponentialRampToValueAtTime(1700 + R() * 600, peak); o.frequency.exponentialRampToValueAtTime(900, dur);
    const og = gainEnv(ctx, [[0, 0], [peak, 0.04], [dur, 0.0001, 'e']]); o.connect(og).connect(ctx.destination);
    n.start(); o.start(); return normalize(await ctx.startRendering(), 0.8);
  },
  // steel on steel: inharmonic modes with differing decays and a struck transient
  async clang() {
    const dur = 1.8; const ctx = off(dur);
    const base = 520 + R() * 380;
    const modes = [1, 1.47, 2.09, 2.56, 2.98, 3.61, 4.19, 4.97, 5.84, 6.62, 7.9, 9.3];
    modes.forEach((m, i) => {
      for (const det of [-0.003, 0.004]) {
        const o = ctx.createOscillator(); o.frequency.value = base * m * (1 + det + (R() - 0.5) * 0.01);
        const dec = (1.6 / Math.pow(i + 1, 0.55)) * (0.7 + R() * 0.6);
        const g = gainEnv(ctx, [[0, 0], [0.002, (0.5 / Math.sqrt(i + 1)) * (0.6 + R() * 0.8)], [dec, 0.0001, 'e']]);
        o.connect(g).connect(ctx.destination); o.start(); o.stop(dec + 0.05);
      }
    });
    const n = src(ctx, noiseBuf(ctx, 0.08)); const h = filt(ctx, 'highpass', 2500); const ng = gainEnv(ctx, [[0, 1.2], [0.05, 0.0001, 'e']]);
    n.connect(h).connect(ng).connect(ctx.destination); n.start();
    return normalize(await ctx.startRendering(), 0.85);
  },
  // a blade or club biting into shadow-flesh
  async flesh(kind) {
    const dur = 0.7; const ctx = off(dur);
    const t = ctx.createOscillator(); t.frequency.setValueAtTime(kind === 'blunt' ? 120 : 160, 0); t.frequency.exponentialRampToValueAtTime(42, 0.22);
    const tg = gainEnv(ctx, [[0, 0], [0.004, kind === 'blunt' ? 1.2 : 0.7], [0.3, 0.0001, 'e']]); t.connect(tg).connect(ctx.destination); t.start();
    const n = src(ctx, noiseBuf(ctx, dur, 'white'));
    const crunch = filt(ctx, kind === 'cut' ? 'highpass' : 'bandpass', kind === 'cut' ? 1800 : 900, 0.8);
    // granular splatter
    const cg = ctx.createGain(); cg.gain.setValueAtTime(0, 0);
    let tt = 0; while (tt < 0.16) { const a = (1 - tt / 0.16) * (0.4 + R() * 0.6); cg.gain.setValueAtTime(a, tt); cg.gain.setValueAtTime(a * 0.1, tt + 0.004 + R() * 0.004); tt += 0.006 + R() * 0.012; }
    cg.gain.setValueAtTime(0, 0.2);
    n.connect(crunch).connect(cg).connect(ctx.destination);
    const n2 = src(ctx, noiseBuf(ctx, dur, 'pink')); const hs = bp(ctx, 3500, 0.7); const hg = gainEnv(ctx, [[0, 0], [0.03, 0.35], [0.6, 0.0001, 'e']]); n2.connect(hs).connect(hg).connect(ctx.destination);
    n.start(); n2.start(); return normalize(await ctx.startRendering(), 0.85);
  },
  // a sabaton on gravel: heel and toe, crunch, and the lames clinking
  async step() {
    const dur = 0.45; const ctx = off(dur);
    for (const [t0, a] of [[0, 1], [0.06 + R() * 0.03, 0.6]]) {
      const n = src(ctx, noiseBuf(ctx, 0.2, 'brown')); const lp = filt(ctx, 'lowpass', 380); const g = gainEnv(ctx, [[0, 0], [t0, 0], [t0 + 0.004, a], [t0 + 0.12, 0.0001, 'e']]);
      n.connect(lp).connect(g).connect(ctx.destination); n.start();
    }
    const n = src(ctx, noiseBuf(ctx, dur)); const b = bp(ctx, 2600, 0.9); const cg = ctx.createGain(); cg.gain.setValueAtTime(0, 0);
    let tt = 0.005; while (tt < 0.11) { const a = (0.2 + R() * 0.5) * (1 - tt / 0.12); cg.gain.setValueAtTime(a, tt); cg.gain.setValueAtTime(0, tt + 0.002 + R() * 0.003); tt += 0.004 + R() * 0.01; }
    n.connect(b).connect(cg).connect(ctx.destination); n.start();
    for (let k = 0; k < 3; k++) { const t0 = 0.02 + R() * 0.12; for (const m of [1, 2.7, 4.1]) { const o = ctx.createOscillator(); o.frequency.value = (2400 + R() * 2600) * m * 0.5; const g = gainEnv(ctx, [[0, 0], [t0, 0], [t0 + 0.001, 0.05 / m], [t0 + 0.09, 0.0001, 'e']]); o.connect(g).connect(ctx.destination); o.start(); } }
    return normalize(await ctx.startRendering(), 0.75);
  },
  // inhuman screeching: harsh formant voice with jitter and a breaking pitch
  async screech(low) {
    const dur = low ? 1.5 : 0.9; const ctx = off(dur + 0.1);
    const f0 = low ? 90 + R() * 40 : 320 + R() * 260;
    const mix = ctx.createGain(); mix.gain.value = 0.6;
    const ws = ctx.createWaveShaper(); const k = 25; const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i * 2 / 1024 - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); } ws.curve = curve;
    const out = gainEnv(ctx, [[0, 0], [0.05, 1], [dur * 0.6, 0.8], [dur, 0.0001, 'e']]);
    for (const [type, det] of [['sawtooth', 1], ['square', 1.012], ['sawtooth', 0.497]]) {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0 * det * 0.7, 0); o.frequency.exponentialRampToValueAtTime(f0 * det * (1.5 + R() * 0.5), dur * 0.3); o.frequency.exponentialRampToValueAtTime(f0 * det * 0.55, dur);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 18 + R() * 20; const lg = ctx.createGain(); lg.gain.value = f0 * 0.12; lfo.connect(lg).connect(o.frequency); lfo.start();
      o.connect(mix); o.start();
    }
    mix.connect(ws);
    const v = Object.values(VOWELS)[Math.floor(R() * 4)];
    for (const [f, a] of v) { const b = bp(ctx, f * (low ? 0.8 : 1.4), 5); const g = ctx.createGain(); g.gain.value = a * 1.5; ws.connect(b).connect(g).connect(out); }
    const n = src(ctx, noiseBuf(ctx, dur + 0.1)); const nb = bp(ctx, low ? 600 : 2500, 0.6); const ng = gainEnv(ctx, [[0, 0], [0.04, 0.35], [dur, 0.0001, 'e']]); n.connect(nb).connect(ng).connect(out); n.start();
    out.connect(ctx.destination);
    return normalize(await ctx.startRendering(), 0.8);
  },
  async boom() {
    const dur = 2.6; const ctx = off(dur);
    const n = src(ctx, noiseBuf(ctx, dur, 'brown')); const lp = filt(ctx, 'lowpass', 2500); lp.frequency.setValueAtTime(3000, 0); lp.frequency.exponentialRampToValueAtTime(90, 1.8);
    const g = gainEnv(ctx, [[0, 0], [0.006, 1.6], [2.4, 0.0001, 'e']]); n.connect(lp).connect(g).connect(ctx.destination); n.start();
    const s = ctx.createOscillator(); s.frequency.setValueAtTime(70, 0); s.frequency.exponentialRampToValueAtTime(26, 1.2); const sg = gainEnv(ctx, [[0, 0], [0.008, 1.3], [1.4, 0.0001, 'e']]); s.connect(sg).connect(ctx.destination); s.start();
    const c = src(ctx, noiseBuf(ctx, dur)); const cb = filt(ctx, 'highpass', 1500); const cg = ctx.createGain(); cg.gain.setValueAtTime(0, 0);
    let tt = 0.05; while (tt < 1.6) { cg.gain.setValueAtTime(R() * 0.3 * (1 - tt / 1.6), tt); cg.gain.setValueAtTime(0, tt + 0.003); tt += 0.01 + R() * 0.05; }
    c.connect(cb).connect(cg).connect(ctx.destination); c.start();
    return normalize(await ctx.startRendering(), 0.95);
  },
  // a bronze church bell (hum, prime, tierce, quint, nominal…)
  async bell(f) {
    const dur = 7; const ctx = off(dur);
    for (const [r, a, d] of [[0.5, 0.7, 6.5], [1, 1, 5], [1.2, 0.6, 3.6], [1.5, 0.4, 3], [2, 0.5, 2.6], [2.5, 0.25, 2], [3, 0.2, 1.6], [4.2, 0.12, 1.1], [5.4, 0.08, 0.8]]) {
      for (const det of [-0.0015, 0.0015]) { const o = ctx.createOscillator(); o.frequency.value = f * r * (1 + det); const g = gainEnv(ctx, [[0, 0], [0.004, a * 0.5], [d, 0.0001, 'e']]); o.connect(g).connect(ctx.destination); o.start(); }
    }
    const n = src(ctx, noiseBuf(ctx, 0.05)); const ng = gainEnv(ctx, [[0, 0.5], [0.04, 0.0001, 'e']]); n.connect(filt(ctx, 'bandpass', f * 4, 1)).connect(ng).connect(ctx.destination); n.start();
    return normalize(await ctx.startRendering(), 0.85);
  },
  // one choir note: twelve voices, each with its own drift, vibrato and breath
  async choir(note, vowel) {
    const dur = 4.2; const ctx = off(dur);
    const out = ctx.createGain(); out.gain.value = 0.3; out.connect(ctx.destination);
    const V = VOWELS[vowel]; const high = note >= 55;
    const fBank = V.map(([f, a]) => { const b = bp(ctx, f * (high ? 1.15 : 1), high ? 7 : 8); const g = ctx.createGain(); g.gain.value = a * 3; b.connect(g).connect(out); return b; });
    for (let v = 0; v < 12; v++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const f = midi(note) * (1 + (R() - 0.5) * 0.012);
      o.frequency.setValueAtTime(f * (1 - 0.01 * R()), 0); o.frequency.linearRampToValueAtTime(f, 0.3 + R() * 0.4);
      const vib = ctx.createOscillator(); vib.frequency.value = 4.2 + R() * 1.6; const vg = ctx.createGain(); vg.gain.value = f * 0.006 * (0.5 + R()); vib.connect(vg).connect(o.frequency);
      const drift = ctx.createOscillator(); drift.frequency.value = 0.2 + R() * 0.3; const dg = ctx.createGain(); dg.gain.value = f * 0.003; drift.connect(dg).connect(o.frequency);
      const amp = gainEnv(ctx, [[0, 0], [0.5 + R() * 0.4, 0.7 + R() * 0.3], [dur - 0.3, 0.7], [dur, 0]]);
      o.connect(amp); for (const b of fBank) amp.connect(b);
      o.start(); vib.start(); drift.start();
    }
    const br = src(ctx, noiseBuf(ctx, dur, 'pink')); const bb = bp(ctx, 1800, 0.5); const bg = gainEnv(ctx, [[0, 0], [0.6, 0.05], [dur, 0.03]]); br.connect(bb).connect(bg).connect(out); br.start();
    return normalize(await ctx.startRendering(), 0.7);
  },
  // the low strings: a bowed ensemble, either sustained or short (spiccato)
  async strings(note, short) {
    const dur = short ? 0.5 : 4.2; const ctx = off(dur);
    const out = ctx.createGain(); out.connect(ctx.destination);
    const body = filt(ctx, 'lowpass', short ? 2400 : 1600, 0.8); const body2 = bp(ctx, 280, 1.2); const b2g = ctx.createGain(); b2g.gain.value = 0.6;
    body.connect(out); body.connect(body2).connect(b2g).connect(out);
    for (let v = 0; v < 8; v++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; const f = midi(note + (v % 4 === 3 ? 12 : 0)) * (1 + (R() - 0.5) * 0.008); o.frequency.value = f;
      const vib = ctx.createOscillator(); vib.frequency.value = 5 + R(); const vg = ctx.createGain(); vg.gain.value = short ? 0 : f * 0.004; vib.connect(vg).connect(o.frequency); vib.start();
      const amp = short ? gainEnv(ctx, [[0, 0], [0.015, 0.9], [0.09, 0.4], [0.45, 0.0001, 'e']]) : gainEnv(ctx, [[0, 0], [0.7 + R() * 0.3, 0.8], [dur - 0.3, 0.8], [dur, 0]]);
      o.connect(amp).connect(body); o.start();
    }
    const n = src(ctx, noiseBuf(ctx, dur, 'pink')); const nb = bp(ctx, 3000, 0.8); const ng = short ? gainEnv(ctx, [[0, 0], [0.01, 0.12], [0.1, 0.0001, 'e']]) : gainEnv(ctx, [[0, 0], [0.5, 0.02], [dur, 0.01]]); n.connect(nb).connect(ng).connect(out); n.start();
    return normalize(await ctx.startRendering(), 0.7);
  },
  // low brass: horns and trombones with an opening bell
  async brass(note) {
    const dur = 2.6; const ctx = off(dur);
    const lp = filt(ctx, 'lowpass', 300, 1.5); lp.frequency.setValueAtTime(300, 0); lp.frequency.exponentialRampToValueAtTime(2400, 0.25); lp.frequency.exponentialRampToValueAtTime(900, dur);
    const out = gainEnv(ctx, [[0, 0], [0.08, 1], [0.6, 0.7], [dur, 0.0001, 'e']]); lp.connect(out).connect(ctx.destination);
    for (let v = 0; v < 6; v++) { const o = ctx.createOscillator(); o.type = v % 2 ? 'square' : 'sawtooth'; o.frequency.value = midi(note + (v === 5 ? -12 : 0)) * (1 + (R() - 0.5) * 0.006); o.connect(lp); o.start(); }
    return normalize(await ctx.startRendering(), 0.75);
  },
  // war drums: a skin with real modes, a wooden shell and the hall
  async drum(f, rim) {
    const dur = rim ? 0.4 : 1.6; const ctx = off(dur);
    if (!rim) for (const [m, a, d] of [[1, 1, 1.2], [1.59, 0.5, 0.6], [2.14, 0.3, 0.4], [2.65, 0.2, 0.3]]) {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(f * m * 1.35, 0); o.frequency.exponentialRampToValueAtTime(f * m, 0.08);
      const g = gainEnv(ctx, [[0, 0], [0.003, a], [d, 0.0001, 'e']]); o.connect(g).connect(ctx.destination); o.start();
    }
    const n = src(ctx, noiseBuf(ctx, dur, rim ? 'white' : 'brown')); const nb = rim ? bp(ctx, 1800, 1.4) : filt(ctx, 'lowpass', 700);
    const ng = gainEnv(ctx, [[0, 0], [0.002, rim ? 0.9 : 0.8], [rim ? 0.08 : 0.25, 0.0001, 'e']]); n.connect(nb).connect(ng).connect(ctx.destination); n.start();
    return normalize(await ctx.startRendering(), 0.9);
  },
  // a demon screaming: a torn human voice that climbs from a wail into a shriek,
  // two throats slightly out of tune, gargling distortion, a rasp of breath
  async scream(low) {
    const dur = low ? 2.0 : 1.3 + R() * 0.6; const ctx = off(dur + 0.2);
    const f0 = low ? 95 + R() * 30 : 210 + R() * 120;
    const out = gainEnv(ctx, [[0, 0], [0.06, 0.6], [0.22, 1], [dur * 0.75, 0.85], [dur, 0.0001, 'e']]);
    const ws = ctx.createWaveShaper(); const k = low ? 40 : 14; const curve = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = i * 2 / 2048 - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); } ws.curve = curve;
    const voice = ctx.createGain(); voice.gain.value = 0.5; voice.connect(ws);
    for (const det of [1, 1.034, 0.5]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * det, 0); o.frequency.exponentialRampToValueAtTime(f0 * det * (low ? 1.6 : 2.6 + R()), dur * 0.35); o.frequency.exponentialRampToValueAtTime(f0 * det * (low ? 1.3 : 2.1), dur * 0.8); o.frequency.exponentialRampToValueAtTime(f0 * det * 0.8, dur);
      // vocal fry and break: fast, uneven wobble
      const j = ctx.createOscillator(); j.type = 'square'; j.frequency.value = 23 + R() * 18; const jg = ctx.createGain(); jg.gain.value = f0 * det * 0.08; j.connect(jg).connect(o.frequency); j.start();
      const g = ctx.createGain(); g.gain.value = det === 0.5 ? 0.6 : 0.8; o.connect(g).connect(voice); o.start();
    }
    // formants morph ah -> eh -> ee as the mouth stretches
    const fA = VOWELS.ah, fE = VOWELS.eh;
    for (let i = 0; i < 3; i++) {
      const b = bp(ctx, fA[i][0] * (low ? 0.75 : 1.25), low ? 5 : 7);
      b.frequency.setValueAtTime(fA[i][0] * (low ? 0.75 : 1.25), 0); b.frequency.linearRampToValueAtTime(fE[i][0] * (low ? 0.8 : 1.45) * (i === 1 ? 1.25 : 1), dur * 0.5);
      const g = ctx.createGain(); g.gain.value = [1.6, 1.1, 0.6][i]; ws.connect(b).connect(g).connect(out);
    }
    const n = src(ctx, noiseBuf(ctx, dur + 0.2, 'pink')); const nb = bp(ctx, low ? 900 : 3000, 0.7); const ng = gainEnv(ctx, [[0, 0], [0.1, 0.5], [dur, 0.0001, 'e']]); n.connect(nb).connect(ng).connect(out); n.start();
    out.connect(ctx.destination);
    return normalize(await ctx.startRendering(), 0.85);
  },
  // the head-shaking fit: a gargled stutter in the throat and teeth clattering
  async chatter() {
    const dur = 1.2 + R() * 0.6; const ctx = off(dur);
    const out = ctx.createGain(); out.connect(ctx.destination);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120 + R() * 60;
    const am = ctx.createGain(); am.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11 + R() * 6; const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg).connect(am.gain); lfo.start();
    const f = bp(ctx, 700, 3); const env = gainEnv(ctx, [[0, 0], [0.05, 1], [dur * 0.8, 0.8], [dur, 0.0001, 'e']]);
    o.connect(am).connect(f).connect(env).connect(out); o.start();
    // teeth: tiny bright clicks
    const n = src(ctx, noiseBuf(ctx, dur)); const hp = filt(ctx, 'highpass', 3500); const cg = ctx.createGain(); cg.gain.setValueAtTime(0, 0);
    let t = 0.02; while (t < dur - 0.05) { cg.gain.setValueAtTime(0.5 + R() * 0.5, t); cg.gain.setValueAtTime(0, t + 0.004); t += 0.035 + R() * 0.04; }
    n.connect(hp).connect(cg).connect(out); n.start();
    return normalize(await ctx.startRendering(), 0.8);
  },
  // thunder: a crack, then the long roll across the hills
  async thunder(near) {
    const dur = 6 + R() * 2; const ctx = off(dur);
    const n = src(ctx, noiseBuf(ctx, dur, 'brown')); const lp = filt(ctx, 'lowpass', near ? 900 : 300, 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, 0);
    let t = near ? 0.0 : 0.3; const rolls = 4 + Math.floor(R() * 4);
    for (let i = 0; i < rolls; i++) { const a = (1 - i / rolls) * (0.6 + R() * 0.4); g.gain.linearRampToValueAtTime(a, t + 0.15 + R() * 0.2); t += 0.4 + R() * 0.9; g.gain.linearRampToValueAtTime(a * 0.4, t); }
    g.gain.linearRampToValueAtTime(0, dur);
    n.connect(lp).connect(g).connect(ctx.destination); n.start();
    if (near) { const c = src(ctx, noiseBuf(ctx, 0.5)); const hp = filt(ctx, 'highpass', 1200); const cg = gainEnv(ctx, [[0, 0], [0.005, 1.4], [0.35, 0.0001, 'e']]); c.connect(hp).connect(cg).connect(ctx.destination); c.start(); }
    return normalize(await ctx.startRendering(), 0.9);
  },
  // horror strings: a cluster of high violins bowed hard near the bridge, sliding apart
  async cluster() {
    const dur = 6; const ctx = off(dur);
    const out = gainEnv(ctx, [[0, 0], [1.2, 0.8], [dur - 1.5, 1], [dur, 0]]); out.connect(ctx.destination);
    const base = 70 + Math.floor(R() * 8);
    for (let v = 0; v < 10; v++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; const f = midi(base + v * 0.5 + (R() - 0.5) * 0.3);
      o.frequency.setValueAtTime(f, 0); o.frequency.linearRampToValueAtTime(f * Math.pow(2, (R() - 0.6) * 0.5), dur);
      const vib = ctx.createOscillator(); vib.frequency.value = 6 + R() * 3; const vg = ctx.createGain(); vg.gain.value = f * 0.012; vib.connect(vg).connect(o.frequency); vib.start();
      const g = ctx.createGain(); g.gain.value = 0.12; o.connect(g).connect(out); o.start();
    }
    const n = src(ctx, noiseBuf(ctx, dur)); const nb = bp(ctx, 5200, 1.2); const ng = ctx.createGain(); ng.gain.value = 0.25; n.connect(nb).connect(ng).connect(out); n.start();
    return normalize(await ctx.startRendering(), 0.6);
  },
  // the tritone drone: low strings a diabolus apart, beating against each other
  async drone() {
    const dur = 9; const ctx = off(dur);
    const out = gainEnv(ctx, [[0, 0], [2.5, 1], [dur - 2.5, 1], [dur, 0]]); const lp = filt(ctx, 'lowpass', 700, 0.8); lp.connect(out).connect(ctx.destination);
    for (const [n, a] of [[26, 1], [32, 0.8], [26.08, 0.7], [38, 0.35], [44.1, 0.25]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); const g = ctx.createGain(); g.gain.value = a * 0.3; o.connect(g).connect(lp); o.start(); }
    const sc = src(ctx, noiseBuf(ctx, dur, 'pink')); const sb = bp(ctx, 220, 4); sb.frequency.setValueAtTime(180, 0); sb.frequency.linearRampToValueAtTime(320, dur); const sg = ctx.createGain(); sg.gain.value = 0.5; sc.connect(sb).connect(sg).connect(out); sc.start();
    return normalize(await ctx.startRendering(), 0.6);
  },
  // a breath drawn in behind you, swelling and cut off dead
  async breath() {
    const dur = 2.6; const ctx = off(dur);
    const n = src(ctx, noiseBuf(ctx, dur, 'pink'));
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(1, dur - 0.08); g.gain.linearRampToValueAtTime(0, dur);
    const f1 = bp(ctx, 900, 5), f2 = bp(ctx, 2400, 6); f1.frequency.linearRampToValueAtTime(1300, dur); f2.frequency.linearRampToValueAtTime(3000, dur);
    n.connect(f1).connect(g); n.connect(f2).connect(g); g.connect(ctx.destination); n.start();
    return normalize(await ctx.startRendering(), 0.7);
  },
  // iron dragged on stone, somewhere off in the dark
  async scrape() {
    const dur = 2.4 + R(); const ctx = off(dur);
    const n = src(ctx, noiseBuf(ctx, dur)); const out = gainEnv(ctx, [[0, 0], [0.3, 1], [dur - 0.4, 0.8], [dur, 0]]); out.connect(ctx.destination);
    for (const [f, q] of [[1800, 25], [2670, 30], [3900, 35], [5100, 30]]) { const b = bp(ctx, f, q); b.frequency.setValueAtTime(f, 0); b.frequency.linearRampToValueAtTime(f * (0.8 + R() * 0.15), dur); const g = ctx.createGain(); g.gain.value = 2.5; n.connect(b).connect(g).connect(out); }
    const am = ctx.createGain(); n.start();
    return normalize(await ctx.startRendering(), 0.5);
  },
};

// ---------------------------------------------------------------- engine
export class AudioEngine {
  constructor() { this.ctx = null; this.voices = 0; this.music = null; this.vol = { master: 0.8, music: 0.6, sfx: 0.9 }; this.lib = null; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.vol.master;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.3;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.vol.sfx; this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.vol.music; this.musicBus.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.5; this.amb.connect(this.master);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this.impulse(3.6, 2.4);
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0.32; this.revSend.connect(this.reverb).connect(this.master);
    this.noiseBuf = this.makeNoise(2); this.brownBuf = this.makeNoise(4, true);
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.startAmbience();
    this.music = new Score(this);
    this.renderLibrary();
    this.loadUserMusic();
  }

  // render the sound library in the background; until each bank is ready the live synths fill in
  async renderLibrary() {
    const L = this.lib = { swing: [], heavySwing: [], clang: [], cut: [], blunt: [], pierce: [], step: [], screech: [], growl: [], boom: [], scream: [], screamLow: [], chatter: [], thunder: [], thunderNear: [], cluster: [], drone: [], breath: [], scrape: [], bells: {}, choir: {}, strings: {}, spic: {}, brass: {}, drums: {} };
    const tasks = [];
    const to = (arr, fn, n) => { for (let i = 0; i < n; i++) tasks.push(async () => arr.push(await fn())); };
    to(L.step, () => RENDER.step(), 10); to(L.swing, () => RENDER.swing(false), 6); to(L.heavySwing, () => RENDER.swing(true), 4);
    to(L.clang, () => RENDER.clang(), 6); to(L.cut, () => RENDER.flesh('cut'), 4); to(L.blunt, () => RENDER.flesh('blunt'), 4); to(L.pierce, () => RENDER.flesh('pierce'), 3);
    to(L.screech, () => RENDER.screech(false), 8); to(L.growl, () => RENDER.screech(true), 4); to(L.boom, () => RENDER.boom(), 2);
    to(L.scream, () => RENDER.scream(false), 8); to(L.screamLow, () => RENDER.scream(true), 3); to(L.chatter, () => RENDER.chatter(), 4);
    to(L.thunder, () => RENDER.thunder(false), 2); to(L.thunderNear, () => RENDER.thunder(true), 2);
    to(L.cluster, () => RENDER.cluster(), 3); to(L.drone, () => RENDER.drone(), 2); to(L.breath, () => RENDER.breath(), 3); to(L.scrape, () => RENDER.scrape(), 3);
    tasks.push(async () => { L.bells.low = await RENDER.bell(110); }, async () => { L.bells.mid = await RENDER.bell(220); });
    tasks.push(async () => { L.drums.low = await RENDER.drum(55); });
    tasks.push(async () => { L.drums.mid = await RENDER.drum(82); }, async () => { L.drums.rim = await RENDER.drum(0, true); });
    for (let n = 38; n <= 74; n += 3) for (const v of ['ah', 'oo']) tasks.push(async () => { L.choir[v + n] = await RENDER.choir(n, v); });
    for (let n = 26; n <= 50; n += 3) { tasks.push(async () => { L.strings[n] = await RENDER.strings(n, false); }); tasks.push(async () => { L.spic[n] = await RENDER.strings(n, true); }); }
    for (let n = 29; n <= 47; n += 3) tasks.push(async () => { L.brass[n] = await RENDER.brass(n); });
    // render a few at a time so the page stays responsive
    let i = 0; const run = async () => { while (i < tasks.length) { const t = tasks[i++]; try { await t(); } catch (e) { console.warn('audio render', e); } } };
    await Promise.all([run(), run(), run()]);
    L.ready = true;
  }
  // nearest rendered sample + playbackRate to reach `note`
  sampleFor(bank, note, prefix = '') {
    let best = null, bd = 99;
    for (const k in bank) { const n = +k.replace(prefix, ''); if (prefix && !k.startsWith(prefix)) continue; const d = Math.abs(n - note); if (d < bd) { bd = d; best = n; } }
    if (best === null) return null;
    return { buf: bank[prefix + best], rate: Math.pow(2, (note - best) / 12) };
  }

  async loadUserMusic() {
    this.userMusic = {};
    try {
      const r = await fetch('audio/list'); if (!r.ok) return; const files = await r.json();
      for (const f of files) {
        const m = f.match(/^music_(explore|dread|battle|combat|prayer|boss|victory|triumph)\.(ogg|mp3|wav|m4a|flac)$/i); if (!m) continue;
        const key = { explore: 'dread', battle: 'combat' }[m[1].toLowerCase()] || m[1].toLowerCase();
        const data = await (await fetch('audio/' + encodeURIComponent(f))).arrayBuffer();
        this.userMusic[key] = await this.ctx.decodeAudioData(data);
      }
      if (Object.keys(this.userMusic).length) this.music.useStems(this.userMusic);
    } catch {}
  }

  setVolumes(v) { Object.assign(this.vol, v); if (!this.ctx) return; this.master.gain.value = this.vol.master; this.sfx.gain.value = this.vol.sfx; this.musicBus.gain.value = this.vol.music; }
  makeNoise(sec, brown = false) { const ctx = this.ctx; const len = Math.floor(ctx.sampleRate * sec); const b = ctx.createBuffer(1, len, ctx.sampleRate); const d = b.getChannelData(0); let l = 0; for (let i = 0; i < len; i++) { const w = R() * 2 - 1; if (brown) { l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; } else d[i] = w; } return b; }
  impulse(sec, decay) {
    // early reflections then a dense, darkening tail (stone nave)
    const ctx = this.ctx; const len = Math.floor(ctx.sampleRate * sec); const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0;
      for (let i = 0; i < len; i++) { const t = i / len; const w = (R() * 2 - 1); lp = lp + (w - lp) * (0.6 - t * 0.5); d[i] = lp * Math.pow(1 - t, decay); }
      for (let k = 0; k < 12; k++) { const at = Math.floor((0.008 + k * 0.011 + R() * 0.01) * ctx.sampleRate); if (at < len) d[at] += (R() < 0.5 ? -1 : 1) * 0.6 * (1 - k / 14); }
    }
    return b;
  }
  setListener(pos, fwd) {
    if (!this.ctx) return;
    const L = this.ctx.listener; const t = this.ctx.currentTime; this.listenerPos = { x: pos.x, y: pos.y, z: pos.z };
    if (L.positionX) { L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02); L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02); L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }
  out(pos, gain = 1, rev = 0.25, dur = 1) {
    if (!this.ctx || this.voices > 64) return null;
    const ctx = this.ctx;
    if (pos) { const dx = pos.x - this.listenerPos.x, dy = pos.y - this.listenerPos.y, dz = pos.z - this.listenerPos.z; if (dx * dx + dy * dy + dz * dz > 150 * 150) return null; }
    const g = ctx.createGain(); g.gain.value = gain;
    if (pos) {
      const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.maxDistance = 160; p.rolloffFactor = 1.1;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); p.connect(this.sfx);
      if (rev > 0) { const s = ctx.createGain(); s.gain.value = rev; p.connect(s); s.connect(this.revSend); }
    } else { g.connect(this.sfx); if (rev > 0) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s); s.connect(this.revSend); } }
    this.voices++; setTimeout(() => { this.voices--; }, (dur + 0.3) * 1000);
    return g;
  }
  // play one of a bank's rendered variations
  play(bank, pos, gain, rev, rate = 1) {
    const list = this.lib && this.lib[bank]; if (!list || !list.length) return false;
    const buf = list[Math.floor(R() * list.length)];
    const o = this.out(pos, gain, rev, buf.duration / rate); if (!o) return true;
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate * (0.94 + R() * 0.12); s.connect(o); s.start();
    return true;
  }
  noiseSrc(buf = this.noiseBuf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = R(); return s; }
  env(param, t, a, peak, d, sustain = 0) { param.cancelScheduledValues(t); param.setValueAtTime(0.0001, t); param.linearRampToValueAtTime(peak, t + a); param.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d); }
  distCurve(k) { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); } return c; }

  // ---------------------------------------------------------------- effects (rendered bank first, live synth as fallback)
  swing(heavy = false, pos = null, pitch = 1) { if (this.play(heavy ? 'heavySwing' : 'swing', pos, heavy ? 0.65 : 0.45, 0.12, pitch)) return; this.liveWhoosh(pos, heavy ? 0.45 : 0.3, heavy ? 0.42 : 0.26, pitch); }
  hit(kind, pos, strength = 1) { if (this.play(kind === 'blunt' ? 'blunt' : kind === 'pierce' ? 'pierce' : 'cut', pos, 0.7 * strength, 0.2)) return; this.liveHit(kind, pos, strength); }
  clang(pos, strength = 1, pitch = 1) { if (this.play('clang', pos, 0.45 * strength, 0.4, pitch)) return; this.liveClang(pos, strength, pitch); }
  footstep(pos, armored = true, heavy = 1) { if (this.play('step', pos, 0.22 * heavy, 0.06, 0.95 + R() * 0.1)) return; }
  shriek(pos, pitch = 1, len = 0.7, gain = 0.4) { if (this.play(pitch < 0.75 ? 'growl' : 'screech', pos, gain, 0.45, clamp(pitch, 0.5, 1.8))) return; this.liveShriek(pos, pitch, len, gain); }
  growl(pos, pitch = 1, len = 1, gain = 0.5) { if (this.play('growl', pos, gain, 0.4, clamp(pitch, 0.4, 2.5))) return; this.liveGrowl(pos, pitch, len, gain); }
  explode(pos, big = 1) { if (this.play('boom', pos, 0.9 * big, 0.5, 1 / Math.max(0.6, big * 0.9))) return; this.liveBoom(pos, big); }
  bell(pos, pitch = 1, gain = 0.5) {
    const L = this.lib; if (L && L.bells.mid) { const buf = pitch < 0.7 ? L.bells.low : L.bells.mid; const o = this.out(pos, gain, 0.8, 7); if (!o) return; const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = pitch < 0.7 ? pitch * 2 : pitch; s.connect(o); s.start(); return; }
    this.liveBell(pos, pitch, gain);
  }
  whoosh(pos, pitch = 1, len = 0.6, gain = 0.3) { this.liveWhoosh(pos, gain, len, pitch); }
  // ---- the horror layer
  scream(pos, big = false, gain = 0.5, pitch = 1) {
    const now = performance.now(); if (now - (this.lastScream || 0) < 450) return; this.lastScream = now;
    if (!this.play(big ? 'screamLow' : 'scream', pos, gain, 0.55, pitch)) this.liveShriek(pos, pitch, 1.0, gain * 0.7);
  }
  chatter(pos, gain = 0.4) { const now = performance.now(); if (now - (this.lastChatter || 0) < 600) return; this.lastChatter = now; this.play('chatter', pos, gain, 0.35, 0.9 + R() * 0.25); }
  thunder(strength = 1, delay = 2) {
    setTimeout(() => { const near = strength > 0.8; if (!this.play(near ? 'thunderNear' : 'thunder', null, 0.55 * strength, 0.4, 0.85 + R() * 0.3)) this.liveBoom(null, 0.5 * strength); }, delay * 1000);
  }
  // unpositioned stingers that live under the music
  stinger(kind, gain = 0.35) {
    const list = this.lib && this.lib[kind]; if (!list || !list.length || !this.ctx) return;
    const buf = list[Math.floor(R() * list.length)];
    const g = this.ctx.createGain(); g.gain.value = gain; g.connect(this.musicBus);
    const rs = this.ctx.createGain(); rs.gain.value = 0.6; g.connect(rs); rs.connect(this.revSend);
    const b = this.ctx.createBufferSource(); b.buffer = buf; b.playbackRate.value = 0.92 + R() * 0.16; b.connect(g); b.start();
  }
  // a voice from somewhere out in the dark
  distant(kind = 'scream') {
    const a = R() * Math.PI * 2, d = 60 + R() * 70, L = this.listenerPos;
    const p = { x: L.x + Math.cos(a) * d, y: L.y + 2, z: L.z + Math.sin(a) * d };
    if (kind === 'scream') this.play(R() < 0.3 ? 'screamLow' : 'scream', p, 1.0, 1.2, 0.8 + R() * 0.3);
    else this.play(kind, p, 0.9, 1.2);
  }

  liveWhoosh(pos, gain, dur, pitch) {
    const o = this.out(pos, gain, 0.15, dur + 0.1); if (!o) return; const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc(); const bpf = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.Q.value = 1.6;
    bpf.frequency.setValueAtTime(300 * pitch, t); bpf.frequency.exponentialRampToValueAtTime(2400 * pitch, t + dur * 0.5); bpf.frequency.exponentialRampToValueAtTime(500 * pitch, t + dur);
    const g = ctx.createGain(); this.env(g.gain, t, dur * 0.45, 1, dur * 0.55); n.connect(bpf).connect(g).connect(o); n.start(t); n.stop(t + dur + 0.05);
  }
  liveHit(kind, pos, strength) {
    const o = this.out(pos, 0.6 * strength, 0.2, 0.6); if (!o) return; const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.frequency.setValueAtTime(kind === 'blunt' ? 140 : 220, t); osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const og = ctx.createGain(); this.env(og.gain, t, 0.004, 0.9, 0.2); osc.connect(og).connect(o); osc.start(t); osc.stop(t + 0.3);
    const n = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; const ng = ctx.createGain(); this.env(ng.gain, t, 0.002, 0.8, 0.12); n.connect(f).connect(ng).connect(o); n.start(t); n.stop(t + 0.25);
  }
  liveClang(pos, strength, pitch) {
    const o = this.out(pos, 0.35 * strength, 0.4, 1.4); if (!o) return; const ctx = this.ctx, t = ctx.currentTime; const base = (900 + R() * 400) * pitch;
    for (const [r, a, d] of [[1, 1, 0.9], [2.76, 0.5, 0.5], [5.4, 0.35, 0.3], [8.93, 0.2, 0.2]]) { const osc = ctx.createOscillator(); osc.frequency.value = base * r; const g = ctx.createGain(); this.env(g.gain, t, 0.001, a, d); osc.connect(g).connect(o); osc.start(t); osc.stop(t + d + 0.1); }
  }
  liveShriek(pos, pitch, len, gain) {
    const o = this.out(pos, gain, 0.45, len + 0.3); if (!o) return; const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; const f0 = (380 + R() * 160) * pitch;
    osc.frequency.setValueAtTime(f0 * 0.7, t); osc.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + len * 0.25); osc.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + len);
    const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = 1100 * pitch; b.Q.value = 3; const g = ctx.createGain(); this.env(g.gain, t, 0.05, 1, len);
    osc.connect(b).connect(g).connect(o); osc.start(t); osc.stop(t + len + 0.1);
  }
  liveGrowl(pos, pitch, len, gain) {
    const o = this.out(pos, gain, 0.4, len + 0.3); if (!o) return; const ctx = this.ctx, t = ctx.currentTime;
    const ws = ctx.createWaveShaper(); ws.curve = this.distCurve(30); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; const g = ctx.createGain(); this.env(g.gain, t, 0.08, 1, len);
    for (const det of [1, 1.013, 0.497]) { const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 70 * pitch * det; osc.connect(ws); osc.start(t); osc.stop(t + len + 0.1); }
    ws.connect(lp).connect(g).connect(o);
  }
  liveBoom(pos, big) {
    const o = this.out(pos, 0.9 * big, 0.5, 2); if (!o) return; const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc(this.brownBuf); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(120, t + 1.2);
    const g = ctx.createGain(); this.env(g.gain, t, 0.005, 1.4, 1.4); n.connect(lp).connect(g).connect(o); n.start(t); n.stop(t + 1.6);
  }
  liveBell(pos, pitch, gain) {
    const o = this.out(pos, gain, 0.8, 6); if (!o) return; const ctx = this.ctx, t = ctx.currentTime; const f = 220 * pitch;
    for (const [r, a, d] of [[0.5, 0.6, 5], [1, 1, 4], [1.19, 0.5, 3], [1.5, 0.35, 2.5], [2, 0.45, 2]]) { const osc = ctx.createOscillator(); osc.frequency.value = f * r; const g = ctx.createGain(); this.env(g.gain, t, 0.003, a * 0.4, d); osc.connect(g).connect(o); osc.start(t); osc.stop(t + d + 0.1); }
  }
  whisper(pos, len = 2.5, gain = 0.35) { // the Devil's whispering: noise shaped into vowels, hissed consonants
    const o = this.out(pos, gain, 0.7, len + 0.5); if (!o) return; const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc(); const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 6; const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); const vowels = Object.values(VOWELS);
    for (let k = 0; k < len * 5; k++) { const tt = t + k * 0.2; const v = vowels[Math.floor(R() * vowels.length)]; f1.frequency.setTargetAtTime(v[0][0] * 1.3, tt, 0.04); f2.frequency.setTargetAtTime(v[1][0] * 1.3, tt, 0.04); g.gain.setTargetAtTime(R() < 0.25 ? 0.05 : 0.9, tt, 0.05); }
    g.gain.setTargetAtTime(0.0001, t + len, 0.2);
    const hs = ctx.createBiquadFilter(); hs.type = 'highpass'; hs.frequency.value = 3500; const sg = ctx.createGain(); sg.gain.value = 0.3;
    n.connect(f1).connect(g); n.connect(f2).connect(g); n.connect(hs).connect(sg).connect(g); g.connect(o); n.start(t); n.stop(t + len + 1);
  }
  roar(pos, gain = 1, len = 2.4) {
    // the dragon: rendered growls stacked an octave apart, plus a live breath of fire-noise
    const L = this.lib;
    if (L && L.growl.length) { for (const r of [0.55, 0.42, 0.8]) this.play('growl', pos, gain * 0.7, 0.6, r); }
    const o = this.out(pos, gain * 0.7, 0.6, len + 0.5); if (!o) return; const ctx = this.ctx, t = ctx.currentTime;
    const ws = ctx.createWaveShaper(); ws.curve = this.distCurve(60); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(300, t); lp.frequency.linearRampToValueAtTime(1600, t + len * 0.25); lp.frequency.exponentialRampToValueAtTime(200, t + len);
    const g = ctx.createGain(); this.env(g.gain, t, 0.2, 1, len);
    for (const [f, d] of [[55, 1], [56.3, 1], [82, 0.6], [27.5, 1]]) { const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f * 0.8, t); osc.frequency.linearRampToValueAtTime(f * 1.15, t + len * 0.3); osc.frequency.linearRampToValueAtTime(f * 0.7, t + len); const og = ctx.createGain(); og.gain.value = d * 0.3; osc.connect(og).connect(ws); osc.start(t); osc.stop(t + len + 0.1); }
    const n = this.noiseSrc(); const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.5; const ng = ctx.createGain(); ng.gain.value = 0.7; n.connect(nf).connect(ng).connect(ws); n.start(t); n.stop(t + len + 0.1);
    ws.connect(lp).connect(g).connect(o);
  }
  fire(pos, len = 2, gain = 0.6) {
    const o = this.out(pos, gain, 0.3, len + 0.3); if (!o) return; const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 0.15); g.gain.setValueAtTime(1, t + len - 0.3); g.gain.linearRampToValueAtTime(0.0001, t + len);
    n.connect(lp).connect(g).connect(o); n.start(t); n.stop(t + len + 0.1);
  }
  heartbeat(gain = 0.5) {
    const o = this.out(null, gain, 0, 1); if (!o) return; const ctx = this.ctx, t = ctx.currentTime;
    for (const dt of [0, 0.22]) { const s = ctx.createOscillator(); s.frequency.setValueAtTime(60, t + dt); s.frequency.exponentialRampToValueAtTime(35, t + dt + 0.15); const g = ctx.createGain(); this.env(g.gain, t + dt, 0.01, dt ? 0.6 : 1, 0.18); s.connect(g).connect(o); s.start(t + dt); s.stop(t + dt + 0.3); }
  }
  holy(pos, gain = 0.5) { // a choir chord swelling out of nothing
    const L = this.lib;
    if (L && L.ready) { for (const n of [62, 66, 69, 74]) { const s = this.sampleFor(L.choir, n, 'ah'); if (!s) continue; const o = this.out(pos, gain * 0.5, 0.9, 4.5); if (!o) return; const b = this.ctx.createBufferSource(); b.buffer = s.buf; b.playbackRate.value = s.rate; b.connect(o); b.start(); } return; }
    const o = this.out(pos, gain, 0.9, 4); if (!o) return; const ctx = this.ctx, t = ctx.currentTime;
    [72, 76, 79, 84].forEach((m, i) => { const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = midi(m); const g = ctx.createGain(); this.env(g.gain, t + i * 0.06, 0.4, 0.15, 3); osc.connect(g).connect(o); osc.start(t); osc.stop(t + 4); });
  }
  ui(kind = 'click') {
    const o = this.out(null, 0.2, 0.15, 0.4); if (!o) return; const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = kind === 'click' ? 520 : 780;
    const g = ctx.createGain(); this.env(g.gain, t, 0.003, 0.4, 0.25); osc.connect(g).connect(o); osc.start(t); osc.stop(t + 0.3);
  }
  // ---------------------------------------------------------------- ambience
  startAmbience() {
    const ctx = this.ctx;
    const n = this.noiseSrc(this.brownBuf); const bpf = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = 400; bpf.Q.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 250; lfo.connect(lg).connect(bpf.frequency);
    const g = ctx.createGain(); g.gain.value = 0.5; const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11; const lg2 = ctx.createGain(); lg2.gain.value = 0.3; lfo2.connect(lg2).connect(g.gain);
    n.connect(bpf).connect(g).connect(this.amb); n.start(); lfo.start(); lfo2.start(); this.windGain = g;
    const r = ctx.createOscillator(); r.frequency.value = 38; const rg = ctx.createGain(); rg.gain.value = 0.05; r.connect(rg).connect(this.amb); r.start(); this.rumble = rg;
  }
  setAmbience(wind = 0.5, rumble = 0.05) { if (!this.ctx) return; const t = this.ctx.currentTime; this.windGain.gain.setTargetAtTime(wind, t, 1.5); this.rumble.gain.setTargetAtTime(rumble, t, 1.5); }
  update(dt) { if (this.music) this.music.update(dt); }
}

// ---------------------------------------------------------------- the score
// D minor modal score in five moods; layers fade in with combat intensity:
//   drone strings → choir → war drums → spiccato strings → low brass
const PROG = {
  dread:   [[38, 45, 50, 53], [36, 43, 48, 51], [34, 41, 46, 50], [33, 40, 45, 49]],
  combat:  [[38, 45, 50, 53], [34, 41, 46, 50], [36, 43, 48, 52], [33, 40, 45, 49]],
  prayer:  [[38, 45, 50, 54], [43, 50, 55, 59], [36, 43, 48, 52], [38, 45, 50, 54]],
  boss:    [[38, 44, 50, 53], [37, 44, 49, 52], [38, 44, 50, 53], [35, 42, 47, 50]],
  triumph: [[43, 50, 55, 59], [36, 43, 48, 52], [38, 45, 50, 54], [43, 50, 55, 59]],
};
class Score {
  constructor(a) {
    this.a = a; this.ctx = a.ctx; this.mood = 'dread'; this.intensity = 0; this.targetIntensity = 0;
    this.chordIdx = 0; this.nextBar = 0; this.nextBeat = 0; this.beat = 0; this.bpm = 84; this.started = false;
    this.out = this.ctx.createGain(); this.out.gain.value = 0.9; this.out.connect(a.musicBus);
    const rs = this.ctx.createGain(); rs.gain.value = 0.55; this.out.connect(rs); rs.connect(a.revSend);
    this.chord = PROG.dread[0]; this.stems = null;
  }
  start() { this.started = true; this.nextBar = this.ctx.currentTime + 0.2; this.nextBeat = this.nextBar; }
  setMood(m) { if (PROG[m] && m !== this.mood) { this.mood = m; this.moodChanged = true; } }
  setIntensity(v) { this.targetIntensity = clamp(v, 0, 1); }
  stopAll() { this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 1); }

  useStems(stems) { // user-provided recordings take over the score
    this.stems = {}; const ctx = this.ctx;
    for (const k in stems) { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.a.musicBus); const s = ctx.createBufferSource(); s.buffer = stems[k]; s.loop = true; s.connect(g); s.start(); this.stems[k] = g; }
  }
  sample(bank, note, prefix, when, gain, dur, attack = 0.3) {
    const s = this.a.sampleFor(bank, note, prefix); if (!s) return;
    const b = this.ctx.createBufferSource(); b.buffer = s.buf; b.playbackRate.value = s.rate;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(gain, when + attack);
    const len = Math.min(dur, s.buf.duration / s.rate - 0.05);
    g.gain.setValueAtTime(gain, when + Math.max(attack, len - 0.6)); g.gain.linearRampToValueAtTime(0, when + len);
    b.connect(g).connect(this.out); b.start(when); b.stop(when + len + 0.1);
  }
  one(buf, when, gain, rate = 1) { if (!buf) return; const b = this.ctx.createBufferSource(); b.buffer = buf; b.playbackRate.value = rate; const g = this.ctx.createGain(); g.gain.value = gain; b.connect(g).connect(this.out); b.start(when); }

  update(dt) {
    if (!this.started) return;
    const ctx = this.ctx, now = ctx.currentTime;
    this.intensity = lerp(this.intensity, this.targetIntensity, 1 - Math.exp(-dt * 0.7));
    if (this.stems) {
      const want = { dread: 'dread', combat: 'combat', prayer: 'prayer', boss: 'boss', triumph: 'triumph' }[this.mood === 'dread' && this.intensity > 0.35 ? 'combat' : this.mood];
      for (const k in this.stems) this.stems[k].gain.setTargetAtTime(k === want || (!this.stems[want] && k === 'dread') ? 1 : 0, now, 1.5);
      return;
    }
    const L = this.a.lib; if (!L || !L.ready) return;
    const I = this.intensity; const mood = this.mood === 'dread' && I > 0.35 ? 'combat' : this.mood;
    const bpm = mood === 'boss' ? 96 : mood === 'combat' ? 88 : 72; const spb = 60 / bpm;
    if (this.nextBar < now - 0.5) { this.nextBar = now + 0.1; this.nextBeat = this.nextBar; }
    // a chord per two bars
    while (this.nextBar < now + 0.3) {
      const prog = PROG[mood]; this.chord = prog[this.chordIdx++ % prog.length];
      const bar = this.nextBar, len = spb * 8;
      const [root, fifth, oct, third] = this.chord;
      // drone strings, always
      this.sample(L.strings, root - 12, '', bar, 0.55, len + 1, 1.2); this.sample(L.strings, fifth - 12, '', bar, 0.35, len + 1, 1.5);
      // choir: 'oo' when quiet, 'ah' swelling in prayer, battle and triumph
      const vowel = mood === 'dread' ? 'oo' : 'ah'; const cg = mood === 'dread' ? 0.22 + I * 0.2 : mood === 'combat' ? 0.3 + I * 0.25 : 0.42;
      if (mood !== 'dread' || this.chordIdx % 2 === 0) for (const n of [oct, third + 12, fifth + 12, oct + 12]) this.sample(L.choir, n, vowel, bar + R() * 0.05, cg * (n > 60 ? 0.8 : 1), len, mood === 'combat' || mood === 'boss' ? 0.6 : 1.4);
      // low brass on the downbeat when the battle is fierce
      if ((mood === 'boss' || (mood === 'combat' && I > 0.65)) && L.brass) { this.sample(L.brass, root, '', bar, 0.5, 2.4, 0.05); this.sample(L.brass, fifth, '', bar, 0.35, 2.4, 0.05); }
      if (mood === 'triumph' && this.chordIdx % 2 === 1) this.one(L.bells.mid, bar, 0.25, Math.pow(2, (root + 24 - 57) / 12));
      // the creeping dread: dissonance under the hymn, gone when the knights pray
      if (mood === 'dread' || mood === 'combat' || mood === 'boss') {
        const k = R();
        if (k < 0.35) this.a.stinger('drone', 0.35);
        else if (k < 0.6) this.a.stinger('cluster', mood === 'dread' ? 0.22 : 0.3);
        else if (k < 0.72) this.a.stinger('scrape', 0.18);
        else if (k < 0.82 && mood === 'dread') this.a.stinger('breath', 0.25);
        // a semitone grinding against the choir's top note
        if (mood !== 'boss' && R() < 0.5) this.sample(L.choir, oct + 13, 'oo', bar + spb * 2, 0.12, len - spb * 2, 2.5);
        if (mood === 'dread' && R() < 0.35) this.a.distant('scream');
      }
      if (mood === 'prayer') { // the angelic answer: a high descant over the hymn
        for (const n of [oct + 24, third + 24]) this.sample(L.choir, n, 'ah', bar + 0.2, 0.18, len, 2.0);
      }
      this.nextBar += len;
    }
    // drums and spiccato ostinato
    while (this.nextBeat < now + 0.25) {
      const b = this.beat++ % 16; const t = this.nextBeat;
      const drums = mood === 'boss' ? 1 : mood === 'combat' ? I : mood === 'prayer' ? I * 0.5 : 0;
      const pat = [1, 0, 0, 0.4, 0.7, 0, 0.3, 0, 1, 0, 0.5, 0, 0.7, 0.3, 0.5, 0.6];
      if (drums > 0.05 && pat[b] > 0 && pat[b] <= drums + 0.35) this.one(b % 4 === 0 ? L.drums.low : L.drums.mid, t, 0.5 * pat[b] * (0.5 + drums * 0.5));
      if (drums > 0.6 && b % 2 === 1) this.one(L.drums.rim, t, 0.12);
      const spic = mood === 'boss' ? 1 : mood === 'combat' ? I : 0;
      if (spic > 0.3) { const [root, fifth] = this.chord; const n = [root, root, fifth, root, root + 12, root, fifth, root][b % 8] - 12; this.sample(L.spic, n, '', t, 0.35 * spic, 0.45, 0.01); }
      this.nextBeat += spb / 2;
    }
  }
}
