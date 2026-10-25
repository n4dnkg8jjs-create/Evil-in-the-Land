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
  // the wet part of a cut: the edge parting meat, a suck of air, a slop of blood (no steel in it)
  async squelch(deep) {
    const dur = 0.55; const ctx = off(dur);
    const n = src(ctx, noiseBuf(ctx, dur, 'brown')); const lp = filt(ctx, 'lowpass', 2200, 2.5);
    lp.frequency.setValueAtTime(2600 + R() * 600, 0); lp.frequency.exponentialRampToValueAtTime(260, 0.22);
    const g = gainEnv(ctx, [[0, 0], [0.006, 1], [0.05, 0.55], [0.32, 0.0001, 'e']]); n.connect(lp).connect(g).connect(ctx.destination); n.start();
    // the slap of flesh closing over the blade, pitched down
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(deep ? 190 : 260, 0); o.frequency.exponentialRampToValueAtTime(55, 0.12);
    const og = gainEnv(ctx, [[0, 0], [0.003, 0.9], [0.16, 0.0001, 'e']]); o.connect(og).connect(ctx.destination); o.start();
    // a few wet clicks and the patter of blood after
    const n2 = src(ctx, noiseBuf(ctx, dur, 'pink')); const b = bp(ctx, 900 + R() * 500, 3); const cg = ctx.createGain(); cg.gain.setValueAtTime(0, 0);
    let tt = 0.02; while (tt < 0.45) { const a = (0.25 + R() * 0.5) * (1 - tt / 0.5); cg.gain.setValueAtTime(a, tt); cg.gain.setValueAtTime(0, tt + 0.008 + R() * 0.01); tt += 0.02 + R() * 0.06; }
    n2.connect(b).connect(cg).connect(ctx.destination); n2.start();
    return normalize(await ctx.startRendering(), 0.85);
  },
  // bone giving way: a dull thump and a dry splintering crackle
  async bone() {
    const dur = 0.5; const ctx = off(dur);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(110, 0); o.frequency.exponentialRampToValueAtTime(38, 0.18);
    const og = gainEnv(ctx, [[0, 0], [0.003, 1], [0.22, 0.0001, 'e']]); o.connect(og).connect(ctx.destination); o.start();
    const n = src(ctx, noiseBuf(ctx, dur, 'white')); const hp = filt(ctx, 'highpass', 1500); const b = bp(ctx, 2600, 1.4); const cg = ctx.createGain(); cg.gain.setValueAtTime(0, 0);
    let tt = 0.004; while (tt < 0.16) { const a = (0.5 + R() * 0.5) * (1 - tt / 0.18); cg.gain.setValueAtTime(a, tt); cg.gain.setValueAtTime(a * 0.05, tt + 0.002 + R() * 0.003); tt += 0.006 + R() * 0.018; }
    n.connect(hp).connect(b).connect(cg).connect(ctx.destination); n.start();
    return normalize(await ctx.startRendering(), 0.8);
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
    const f0 = low ? 80 + R() * 35 : 150 + R() * 90;
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
    for (const [f, a] of v) { const b = bp(ctx, f * (low ? 0.8 : 1.05), 5); const g = ctx.createGain(); g.gain.value = a * 1.5; ws.connect(b).connect(g).connect(out); }
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
  async choir(note, vowel, voices = 12) {
    const dur = 4.2; const ctx = off(dur); const solo = voices < 4;
    const out = ctx.createGain(); out.gain.value = 0.3; out.connect(ctx.destination);
    const V = VOWELS[vowel]; const high = note >= 55;
    const fBank = V.map(([f, a]) => { const b = bp(ctx, f * (high ? 1.15 : 1), high ? 7 : 8); const g = ctx.createGain(); g.gain.value = a * 3; b.connect(g).connect(out); return b; });
    for (let v = 0; v < voices; v++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const f = midi(note) * (1 + (R() - 0.5) * (solo ? 0.004 : 0.012));
      o.frequency.setValueAtTime(f * (1 - 0.01 * R()), 0); o.frequency.linearRampToValueAtTime(f, 0.3 + R() * 0.4);
      const vib = ctx.createOscillator(); vib.frequency.value = 4.2 + R() * 1.6; const vg = ctx.createGain(); vg.gain.value = f * (solo ? 0.011 : 0.006) * (0.5 + R()); vib.connect(vg).connect(o.frequency);
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
  // a pipe organ note: ranks drawn together (16', 8', 4', 2 2/3', 2' and a mixture), each pipe a little out of tune
  // with the next so they beat slowly; the chiff of air at the mouth as it speaks; steady wind, no vibrato
  async organ(note) {
    const dur = 4.6; const ctx = off(dur);
    const out = gainEnv(ctx, [[0, 0], [0.09, 1], [dur - 0.35, 1], [dur, 0]]); const tone = filt(ctx, 'lowpass', note < 40 ? 2600 : 5200, 0.5);
    tone.connect(out).connect(ctx.destination);
    const f0 = midi(note);
    for (const [mul, amp, det] of [[0.5, 0.55, 0.0008], [1, 1, 0], [2, 0.55, 0.0012], [3, 0.28, -0.0009], [4, 0.3, 0.0015], [6, 0.12, -0.002], [8, 0.1, 0.0022], [12, 0.04, 0.003]]) {
      if (f0 * mul > 9000) continue;
      for (const d of [-det, det]) { const o = ctx.createOscillator(); o.type = mul === 1 ? 'triangle' : 'sine'; o.frequency.value = f0 * mul * (1 + d); const g = ctx.createGain(); g.gain.value = amp * 0.5; o.connect(g).connect(tone); o.start(); }
    }
    // the chiff: a breath of noise at the pipe's pitch as it speaks
    const n = src(ctx, noiseBuf(ctx, 0.3, 'white')); const nb = bp(ctx, f0 * 4, 4); const ng = gainEnv(ctx, [[0, 0], [0.015, 0.5], [0.12, 0.0001, 'e']]); n.connect(nb).connect(ng).connect(out); n.start();
    // the wind in the pipes
    const w = src(ctx, noiseBuf(ctx, dur, 'pink')); const wb = bp(ctx, f0 * 2, 1.5); const wg = ctx.createGain(); wg.gain.value = 0.015; w.connect(wb).connect(wg).connect(out); w.start();
    return normalize(await ctx.startRendering(), 0.75);
  },
  // low brass: horns and trombones with an opening bell
  async brass(note) {
    const dur = 2.6; const ctx = off(dur);
    const lp = filt(ctx, 'lowpass', 300, 1.5); lp.frequency.setValueAtTime(300, 0); lp.frequency.exponentialRampToValueAtTime(2400, 0.25); lp.frequency.exponentialRampToValueAtTime(900, dur);
    const out = gainEnv(ctx, [[0, 0], [0.08, 1], [0.6, 0.7], [dur, 0.0001, 'e']]); lp.connect(out).connect(ctx.destination);
    for (let v = 0; v < 6; v++) { const o = ctx.createOscillator(); o.type = v % 2 ? 'square' : 'sawtooth'; o.frequency.value = midi(note + (v === 5 ? -12 : 0)) * (1 + (R() - 0.5) * 0.006); o.connect(lp); o.start(); }
    return normalize(await ctx.startRendering(), 0.75);
  },
  // a snare: a crack of wires over a short tuned body
  async snare() {
    const dur = 0.45; const ctx = off(dur);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(260, 0); o.frequency.exponentialRampToValueAtTime(185, 0.05);
    const og = gainEnv(ctx, [[0, 0], [0.002, 0.7], [0.12, 0.0001, 'e']]); o.connect(og).connect(ctx.destination); o.start();
    const n = src(ctx, noiseBuf(ctx, dur, 'white')); const hp = filt(ctx, 'highpass', 1500); const nb = bp(ctx, 4200, 0.7);
    const ng = gainEnv(ctx, [[0, 0], [0.002, 1], [0.05, 0.45], [0.3, 0.0001, 'e']]); n.connect(hp).connect(nb).connect(ng).connect(ctx.destination); n.start();
    return normalize(await ctx.startRendering(), 0.8);
  },
  // cymbals: a crash, or a rising swell (a roll on a suspended cymbal) that leads into one
  async cymbal(swell) {
    const dur = swell ? 1.3 : 3.2; const ctx = off(dur);
    const n = src(ctx, noiseBuf(ctx, dur, 'white')); const hp = filt(ctx, 'highpass', swell ? 3500 : 2600);
    const shimmer = bp(ctx, 7000, 0.6); const sg = ctx.createGain(); sg.gain.value = 0.7;
    const env = swell ? gainEnv(ctx, [[0, 0.0001], [dur - 0.05, 1, 'e'], [dur, 0]]) : gainEnv(ctx, [[0, 0], [0.004, 1], [0.25, 0.5], [dur, 0.0001, 'e']]);
    n.connect(hp); hp.connect(env); hp.connect(shimmer).connect(sg).connect(env); env.connect(ctx.destination); n.start();
    // inharmonic metal partials
    for (const f of [3150, 4270, 5530, 6890, 8120]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * (0.97 + R() * 0.06); const g = ctx.createGain(); g.gain.value = 0.015; o.connect(g).connect(env); o.start(); }
    return normalize(await ctx.startRendering(), swell ? 0.6 : 0.7);
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
    // a grown throat torn open in agony: a ragged gasp, the howl climbing out of the chest, a voice that cracks
    // and wavers on the sustain, then sinks, shuddering, into a sob. Low enough to be a man's, rough enough to be wrong.
    const dur = low ? 2.4 + R() * 0.6 : 1.8 + R() * 0.9; const T0 = 0.16 + R() * 0.08; const ctx = off(dur + T0 + 0.2);
    const f0 = low ? 70 + R() * 16 : 118 + R() * 42, peak = low ? 1.5 + R() * 0.2 : 1.7 + R() * 0.35;
    const end = T0 + dur;
    const out = gainEnv(ctx, [[0, 0], [T0, 0], [T0 + 0.07, 0.7], [T0 + 0.3, 1], [T0 + dur * 0.7, 0.85], [end, 0.0001, 'e']]);
    // the sob: the sustain starts to shudder near the end
    const trem = ctx.createGain(); trem.gain.value = 1; const tl = ctx.createOscillator(); tl.frequency.value = 6 + R() * 2.5; const tg = ctx.createGain(); tg.gain.setValueAtTime(0, 0); tg.gain.setValueAtTime(0, T0 + dur * 0.6); tg.gain.linearRampToValueAtTime(0.45, end); tl.connect(tg).connect(trem.gain); tl.start();
    trem.connect(ctx.destination); out.connect(trem);
    const ws = ctx.createWaveShaper(); const k = low ? 45 : 28; const curve = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = i * 2 / 2048 - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); } ws.curve = curve;
    const voice = ctx.createGain(); voice.gain.value = 0.45; voice.connect(ws);
    const crack = T0 + dur * (0.45 + R() * 0.25);
    for (const [det, gain] of [[1, 0.8], [1.013, 0.55], [0.5, 0.42]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; const F = (m) => f0 * det * m;
      o.frequency.setValueAtTime(F(0.8), T0); o.frequency.exponentialRampToValueAtTime(F(peak), T0 + 0.35 + R() * 0.15);
      o.frequency.exponentialRampToValueAtTime(F(peak * 0.94), crack - 0.02); o.frequency.exponentialRampToValueAtTime(F(peak * 0.78), crack + 0.05);   // the voice cracks
      o.frequency.exponentialRampToValueAtTime(F(peak * 0.9), crack + 0.25); o.frequency.exponentialRampToValueAtTime(F(0.62), end);
      // anguished wavering and the rasp of a throat giving out
      const v = ctx.createOscillator(); v.frequency.value = 4.5 + R() * 2; const vg = ctx.createGain(); vg.gain.value = F(0.035); v.connect(vg).connect(o.frequency); v.start();
      const j = ctx.createOscillator(); j.type = 'square'; j.frequency.value = 27 + R() * 16; const jg = ctx.createGain(); jg.gain.value = F(0.05); j.connect(jg).connect(o.frequency); j.start();
      const g = ctx.createGain(); g.gain.value = gain; o.connect(g).connect(voice); o.start(T0);
    }
    // an open, bawling 'AAH' that rounds toward 'OH' as the breath runs out
    const fA = VOWELS.ah, fO = VOWELS.oh, sc = low ? 0.78 : 1.0;
    for (let i = 0; i < 4; i++) {
      const b = bp(ctx, fA[i][0] * sc, low ? 4.5 : 6);
      b.frequency.setValueAtTime(fA[i][0] * sc * 0.9, T0); b.frequency.linearRampToValueAtTime(fA[i][0] * sc * 1.06, T0 + 0.4); b.frequency.linearRampToValueAtTime(fO[i][0] * sc, end);
      const g = ctx.createGain(); g.gain.value = [1.7, 1.0, 0.5, 0.22][i]; ws.connect(b).connect(g).connect(out);
    }
    // what makes it wrong: a second throat a tritone below, torn by distortion; the whole voice ring-modulated
    // into something metallic; a thin glassy shriek riding over the top at the peak; a wet gurgle at the end
    {
      const v2 = ctx.createOscillator(); v2.type = 'sawtooth'; v2.frequency.setValueAtTime(f0 * 0.707 * 0.8, T0); v2.frequency.exponentialRampToValueAtTime(f0 * 0.707 * peak, T0 + 0.45); v2.frequency.exponentialRampToValueAtTime(f0 * 0.707 * 0.6, end);
      const j2 = ctx.createOscillator(); j2.type = 'square'; j2.frequency.value = 13 + R() * 9; const jg2 = ctx.createGain(); jg2.gain.value = f0 * 0.06; j2.connect(jg2).connect(v2.frequency); j2.start();
      const ws2 = ctx.createWaveShaper(); const c2 = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i * 2 / 1024 - 1; c2[i] = Math.tanh(x * 9) * 0.8 + Math.sign(x) * 0.2; } ws2.curve = c2;
      const lp2 = filt(ctx, 'lowpass', 1100); const g2 = gainEnv(ctx, [[0, 0], [T0 + 0.05, 0], [T0 + 0.25, 0.42], [end - 0.2, 0.35], [end, 0.0001, 'e']]);
      v2.connect(ws2).connect(lp2).connect(g2).connect(out); v2.start(T0);
      const ring = ctx.createGain(); ring.gain.value = 0; const rm = ctx.createOscillator(); rm.frequency.value = 55 + R() * 40; rm.connect(ring.gain); rm.start();
      const rg = ctx.createGain(); rg.gain.value = 0.55; ws.connect(ring).connect(bp(ctx, 1400, 1.2)).connect(rg).connect(out);
      const gl = ctx.createOscillator(); gl.type = 'triangle'; gl.frequency.setValueAtTime(f0 * 7, T0 + 0.2); gl.frequency.exponentialRampToValueAtTime(f0 * peak * 7.4, T0 + 0.6); gl.frequency.exponentialRampToValueAtTime(f0 * 5.5, end);
      const gv = ctx.createOscillator(); gv.frequency.value = 7 + R() * 3; const gvg = ctx.createGain(); gvg.gain.value = f0 * 0.25; gv.connect(gvg).connect(gl.frequency); gv.start();
      const glg = gainEnv(ctx, [[0, 0], [T0 + 0.25, 0], [T0 + 0.55, low ? 0.03 : 0.07], [end - 0.3, 0.04], [end, 0.0001, 'e']]); gl.connect(bp(ctx, f0 * peak * 7, 6)).connect(glg).connect(out); gl.start(T0 + 0.2);
      const gn = src(ctx, noiseBuf(ctx, end + 0.2, 'pink')); const gam = ctx.createGain(); gam.gain.value = 0; const gsq = ctx.createOscillator(); gsq.type = 'square'; gsq.frequency.value = 21 + R() * 10; const gsg = ctx.createGain(); gsg.gain.value = 0.5; gsq.connect(gsg).connect(gam.gain); gsq.start();
      const gge = gainEnv(ctx, [[0, 0], [end - dur * 0.35, 0], [end - dur * 0.15, 0.6], [end + 0.1, 0.0001, 'e']]); gn.connect(bp(ctx, 380, 2)).connect(gam).connect(gge).connect(out); gn.start();
    }
    // breath through the scream, and the ragged gasp before it
    const n = src(ctx, noiseBuf(ctx, end + 0.2, 'pink')); const nb = bp(ctx, low ? 800 : 1300, 0.8); const ng = gainEnv(ctx, [[0, 0], [T0 * 0.5, 0.5], [T0, 0.08], [T0 + 0.1, 0.28], [end, 0.0001, 'e']]); n.connect(nb).connect(ng).connect(trem); n.start();
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
  // thunder, synthesised sample by sample. Near: the air tearing open, a ripping crackle that runs on for most of a
  // second, a great low boom under it, then the roll. Far: no crack, only the roll, coming late and from low down.
  // The roll is brown noise through a low-pass that closes as the sound travels, swelling and sinking in uneven surges
  // (each a fast rise and a long fall), with a grumbling middle band that flutters over it, and a long tail.
  async thunder(near) {
    const dur = near ? 10 + R() * 2 : 8 + R() * 3, N = Math.floor(dur * SR), out = new Float32Array(N);
    const swells = []; const t0 = near ? 0.12 : 0.35 + R() * 0.6, ns = 5 + Math.floor(R() * 5);
    let tt = t0; for (let i = 0; i < ns; i++) { swells.push({ t: tt, up: 0.12 + R() * 0.3, down: 0.6 + R() * 1.6, a: (1 - i / ns * 0.6) * (0.45 + R() * 0.6) }); tt += 0.35 + R() * 1.1; }
    const env = (t) => { let e = 0; for (const s of swells) { const d = t - s.t; e += s.a * Math.exp(-((d / (d < 0 ? s.up : s.down)) ** 2)); } return e * Math.exp(-Math.max(0, t - t0) / (near ? 6.5 : 6.5)); };
    let br = 0, l1 = 0, l2 = 0, m1 = 0, m2 = 0, fl = 0, fl2 = 0;
    const k = (fc) => 1 - Math.exp(-2 * Math.PI * fc / SR);
    const kM1 = k(240), kM2 = k(70), kF = k(3);
    for (let i = 0; i < N; i++) {
      const t = i / SR, w = R() * 2 - 1;
      br = (br + 0.03 * w) * 0.9985;                                   // brown noise
      const fc = near ? 1100 * Math.exp(-t / 1.4) + 110 : 380 * Math.exp(-t / 2.5) + 80;
      const kk = k(fc); l1 += kk * (br - l1); l2 += kk * (l1 - l2);    // the roll: low and closing
      m1 += kM1 * (w - m1); m2 += kM2 * (w - m2);                      // a middle band, for the grumble
      fl += kF * ((R() * 2 - 1) - fl); fl2 += kF * (fl - fl2);         // and its flutter
      const e = env(t);
      out[i] = l2 * 9 * e + (m1 - m2) * 0.08 * e * (near ? 1 : 0.5);   // a little body above the roll, smooth (no flutter)
    }
    if (near) {
      // the crack: one sharp report, and the air ripping straight after it, a continuous tearing that dies in a
      // third of a second (bright noise whose loudness flickers fast, not separate clicks)
      let prev = 0, fk = 0; const nc = Math.floor(0.45 * SR);
      for (let i = 0; i < nc && i < N; i++) {
        const t = i / SR, w = R() * 2 - 1, hp = w - prev * 0.85; prev = w;
        fk += 0.08 * ((R() * 2 - 1) - fk);                                   // the flicker of the rip
        const report = Math.exp(-t / 0.012), rip = Math.exp(-t / 0.11) * (0.55 + 0.45 * Math.abs(fk) * 3) * Math.min(1, t / 0.004);
        out[i] += hp * (report * 1.1 + rip * 0.55);
      }
      // the boom under it: a falling low thud with body
      let ph = 0; const nb = Math.floor(3.5 * SR);
      for (let i = 0; i < nb && i < N; i++) { const t = i / SR, f = 75 * Math.exp(-t / 0.5) + 32; ph += 2 * Math.PI * f / SR; out[i] += Math.sin(ph) * 0.9 * Math.min(1, t / 0.015) * Math.exp(-t / 1.1); }
    }
    const ctx = off(dur), buf = ctx.createBuffer(1, N, SR); buf.copyToChannel(out, 0);
    return normalize(buf, 0.95);
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
    const L = this.lib = { swing: [], heavySwing: [], clang: [], cut: [], blunt: [], pierce: [], squelch: [], squelchDeep: [], bone: [], step: [], screech: [], growl: [], boom: [], scream: [], screamLow: [], chatter: [], thunder: [], thunderNear: [], cluster: [], drone: [], breath: [], scrape: [], bells: {}, choir: {}, strings: {}, spic: {}, brass: {}, drums: {} };
    const tasks = [];
    const to = (arr, fn, n) => { for (let i = 0; i < n; i++) tasks.push(async () => arr.push(await fn())); };
    to(L.step, () => RENDER.step(), 10); to(L.swing, () => RENDER.swing(false), 6); to(L.heavySwing, () => RENDER.swing(true), 4);
    to(L.clang, () => RENDER.clang(), 6); to(L.cut, () => RENDER.flesh('cut'), 4); to(L.blunt, () => RENDER.flesh('blunt'), 4); to(L.pierce, () => RENDER.flesh('pierce'), 3);
    to(L.squelch, () => RENDER.squelch(false), 4); to(L.squelchDeep, () => RENDER.squelch(true), 3); to(L.bone, () => RENDER.bone(), 3);
    to(L.screech, () => RENDER.screech(false), 8); to(L.growl, () => RENDER.screech(true), 4); to(L.boom, () => RENDER.boom(), 2);
    to(L.scream, () => RENDER.scream(false), 8); to(L.screamLow, () => RENDER.scream(true), 3); to(L.chatter, () => RENDER.chatter(), 4);
    // thunder: real recordings (public/audio/sfx, from Wikimedia Commons, CC BY-SA 4.0: see the credits), the
    // synthesised kind only if they cannot be had
    const rec = async (name) => { for (const ext of ['ogg', 'mp3']) { try { const r = await fetch(`audio/sfx/${name}.${ext}`); if (!r.ok) continue; return await this.ctx.decodeAudioData(await r.arrayBuffer()); } catch {} } return null; };
    tasks.unshift(async () => {
      const [n1, f1, f2] = await Promise.all([rec('thunder_near'), rec('thunder_far'), rec('thunder_far2')]);
      if (n1) L.thunderNear.push(n1); else for (let i = 0; i < 2; i++) L.thunderNear.push(await RENDER.thunder(true));
      if (f1 || f2) { if (f1) L.thunder.push(f1); if (f2) L.thunder.push(f2); } else for (let i = 0; i < 2; i++) L.thunder.push(await RENDER.thunder(false));
    });
    to(L.cluster, () => RENDER.cluster(), 3); to(L.drone, () => RENDER.drone(), 2); to(L.breath, () => RENDER.breath(), 3); to(L.scrape, () => RENDER.scrape(), 3);
    tasks.push(async () => { L.bells.low = await RENDER.bell(110); }, async () => { L.bells.mid = await RENDER.bell(220); });
    tasks.push(async () => { L.drums.low = await RENDER.drum(55); });
    tasks.push(async () => { L.drums.mid = await RENDER.drum(82); }, async () => { L.drums.rim = await RENDER.drum(0, true); });
    // the final battle's kit: a great drum, snare, cymbals, and horns high enough to carry a theme
    tasks.push(async () => { L.drums.taiko = await RENDER.drum(39); }, async () => { L.drums.snare = await RENDER.snare(); }, async () => { L.drums.swell = await RENDER.cymbal(true); }, async () => { L.drums.crash = await RENDER.cymbal(false); });
    L.horn = {}; for (let n = 50; n <= 65; n += 3) tasks.push(async () => { L.horn[n] = await RENDER.brass(n); });
    for (let n = 38; n <= 74; n += 3) for (const v of ['ah', 'oo']) tasks.push(async () => { L.choir[v + n] = await RENDER.choir(n, v); });
    // the cantor: one man's voice (two, close together), for the chant and the responsory
    L.cantor = {}; for (let n = 44; n <= 65; n += 3) tasks.push(async () => { L.cantor['oh' + n] = await RENDER.choir(n, 'oh', 2); });
    for (let n = 26; n <= 50; n += 3) { tasks.push(async () => { L.strings[n] = await RENDER.strings(n, false); }); tasks.push(async () => { L.spic[n] = await RENDER.strings(n, true); }); }
    for (let n = 29; n <= 47; n += 3) tasks.push(async () => { L.brass[n] = await RENDER.brass(n); });
    L.organ = {}; for (let n = 26; n <= 74; n += 3) tasks.push(async () => { L.organ[n] = await RENDER.organ(n); });
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
  // the blade going into a body: the wet of the cut, and bone breaking under a heavy blow or a club
  gore(kind, pos, heavy = false) {
    if (kind !== 'blunt') this.play(heavy ? 'squelchDeep' : 'squelch', pos, heavy ? 0.75 : 0.55, 0.15, 0.9 + R() * 0.2);
    if (heavy || kind === 'blunt') this.play('bone', pos, kind === 'blunt' ? 0.7 : 0.5, 0.2, 0.85 + R() * 0.25);
  }
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
    setTimeout(() => { const near = strength > 0.8; if (!this.play(near ? 'thunderNear' : 'thunder', null, (near ? 0.95 : 0.7) * Math.min(1.7, strength), 0.55, 0.92 + R() * 0.16)) this.liveBoom(null, 0.5 * strength); }, delay * 1000);
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
    if (kind === 'scream') this.play(R() < 0.3 ? 'screamLow' : 'scream', p, 1.0, 1.2, 0.82 + R() * 0.16);
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
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; const f0 = (170 + R() * 70) * pitch;
    osc.frequency.setValueAtTime(f0 * 0.7, t); osc.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + len * 0.25); osc.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + len);
    const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = 760 * pitch; b.Q.value = 3; const g = ctx.createGain(); this.env(g.gain, t, 0.05, 1, len);
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
  // the world goes quiet: music, wind and the battle fall away for a few seconds, then come back
  silence(sec = 4) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    for (const [bus, back] of [[this.musicBus, this.vol.music], [this.amb, 0.5], [this.sfx, this.vol.sfx]]) {
      bus.gain.cancelScheduledValues(t); bus.gain.setTargetAtTime(bus === this.sfx ? back * 0.15 : 0.0001, t, 0.25);
      bus.gain.setTargetAtTime(back, t + sec, bus === this.sfx ? 0.02 : 1.2);
    }
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
  // the last battle: D Phrygian, the flat second (E flat) grinding against the tonic
  final:   [[38, 45, 50, 53], [39, 46, 51, 55], [38, 45, 50, 53], [36, 43, 48, 51]],
  // the title: D minor, broad and slow, a chord a bar: Dm Bb F C | Gm Bb A A
  menu:    [[38, 45, 50, 53], [34, 41, 46, 50], [41, 48, 53, 57], [36, 43, 48, 52], [43, 50, 55, 58], [34, 41, 46, 50], [33, 40, 45, 49], [33, 40, 45, 49]],
};
// the title anthem's melody, sung by the whole choir over each bar: [beat, note, beats]
const MENU_THEME = [
  [[0, 62, 2], [2, 65, 1], [3, 64, 1]], [[0, 62, 3], [3, 58, 1]], [[0, 60, 2], [2, 57, 1], [3, 60, 1]], [[0, 64, 4]],
  [[0, 62, 2], [2, 67, 2]], [[0, 65, 2], [2, 62, 2]], [[0, 64, 2], [2, 61, 2]], [[0, 64, 3], [3, 57, 1]],
];
// and its answer, an octave up, the second time round
const MENU_THEME_B = [
  [[0, 69, 3], [3, 67, 1]], [[0, 65, 2], [2, 62, 2]], [[0, 65, 2], [2, 69, 2]], [[0, 67, 4]],
  [[0, 70, 2], [2, 69, 1], [3, 67, 1]], [[0, 65, 3], [3, 62, 1]], [[0, 64, 2], [2, 67, 2]], [[0, 69, 4]],
];
// every fourth phrase climbs: B flat, G minor, A major, and back to D
const FINAL_BRIDGE = [[34, 41, 46, 50], [31, 43, 50, 55], [33, 40, 45, 49], [33, 40, 45, 49]];
// the horn theme over each chord of the phrase: [beat, note, beats]
const FINAL_THEME = [
  [[0, 50, 3], [3, 53, 1], [4, 57, 4]],
  [[0, 58, 3], [3, 57, 1], [4, 55, 2], [6, 51, 2]],
  [[0, 53, 2], [2, 55, 1], [3, 57, 1], [4, 62, 4]],
  [[0, 60, 3], [3, 58, 1], [4, 55, 2], [6, 57, 2]],
];
const FINAL_BRIDGE_THEME = [[[0, 58, 4], [4, 62, 4]], [[0, 62, 3], [3, 58, 1], [4, 55, 4]], [[0, 57, 4], [4, 61, 4]], [[0, 64, 4], [4, 61, 2], [6, 57, 2]]];
// Prayer: four pieces, chosen in turn with a little chance, so the knights do not kneel to the same music twice
// running. Each lasts as long as the prayer does, looping its phrases over the prayer progression (D Dorian).
//  chant       — plainchant: one line of men's voices over a drone, the fifth below joining it (organum)
//  motet       — four voices weaving in imitation, Renaissance style
//  responsory  — a lone cantor sings a verse; the whole choir answers
//  cathedral   — slow chords far off in a great stone nave, a bell tolling the hours
const PRAYER_PIECES = ['chant', 'motet', 'responsory', 'cathedral'];
// plainchant neumes in D Dorian: [note, beats]
const CHANT = [
  [[50, 1], [52, 1], [53, 2], [55, 1], [53, 1], [52, 1], [50, 1]],
  [[53, 1], [55, 1], [57, 2], [57, 1], [55, 1], [53, 1], [55, 1]],
  [[57, 1], [59, 1], [60, 1], [57, 1], [55, 2], [53, 1], [52, 1]],
  [[53, 1], [52, 1], [50, 1], [48, 1], [50, 4]],
];
// the cantor's verse (answered by the choir on the next chord)
const VERSE = [[[57, 1], [57, 1], [57, 1], [59, 1], [57, 2], [55, 2]], [[55, 1], [57, 1], [53, 2], [52, 1], [50, 3]], [[50, 1], [53, 1], [55, 1], [57, 1], [57, 2], [55, 1], [57, 1]], [[60, 2], [59, 1], [57, 1], [55, 2], [57, 2]]];
// a motet's four voices: each a line of half- and whole-notes, imitating one another a beat apart
const MOTET = [
  [[62, 2], [64, 2], [65, 3], [64, 1], [62, 2], [60, 2], [62, 4]],
  [[57, 3], [59, 1], [60, 2], [62, 2], [57, 4], [55, 2], [57, 2]],
  [[50, 4], [53, 2], [55, 2], [53, 3], [52, 1], [50, 4]],
  [[38, 4], [43, 4], [41, 4], [38, 4]],
];
class Score {
  constructor(a) {
    this.a = a; this.ctx = a.ctx; this.mood = 'dread'; this.intensity = 0; this.targetIntensity = 0;
    this.chordIdx = 0; this.nextBar = 0; this.nextBeat = 0; this.beat = 0; this.bpm = 84; this.started = false;
    this.out = this.ctx.createGain(); this.out.gain.value = 0.9; this.out.connect(a.musicBus);
    const rs = this.ctx.createGain(); rs.gain.value = 0.55; this.out.connect(rs); rs.connect(a.revSend);
    this.chord = PROG.dread[0]; this.stems = null;
    // the choir has its own fader: hymns belong to prayer alone, and fade the moment the knights rise
    this.choirOut = this.ctx.createGain(); this.choirOut.gain.value = 0; this.choirOut.connect(this.out);
    // and a send of its own into the hall, deeper for the far-off cathedral
    this.choirRev = this.ctx.createGain(); this.choirRev.gain.value = 0.4; this.choirOut.connect(this.choirRev); this.choirRev.connect(a.revSend);
    this.prayerN = Math.floor(R() * PRAYER_PIECES.length); this.piece = null;
  }
  // a voice from a sample bank, starting into the sustained part of the note so a short note still speaks at once
  voice(bank, note, prefix, when, gain, dur, attack = 0.08, skip = 0.7) {
    const s = this.a.sampleFor(bank, note, prefix); if (!s) return;
    const b = this.ctx.createBufferSource(); b.buffer = s.buf; b.playbackRate.value = s.rate;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(gain, when + attack);
    const len = Math.min(dur, s.buf.duration / s.rate - skip - 0.1);
    g.gain.setValueAtTime(gain, when + Math.max(attack, len - 0.18)); g.gain.linearRampToValueAtTime(0, when + len);
    b.connect(g).connect(this.choirOut); b.start(when, skip); b.stop(when + len + 0.1);
  }
  // which prayer piece: in turn, sometimes skipping one; the rare dark variant when the fear is on them
  pickPrayer() {
    this.prayerN += R() < 0.3 ? 2 : 1;
    this.piece = PRAYER_PIECES[this.prayerN % PRAYER_PIECES.length];
    this.phrase = 0;
    const fear = Math.max(this.a.dread ?? 0, (this.a.terror ?? 0) * 0.6);
    this.falter = R() < 0.08 + fear * 0.5;   // something else is singing with them
    this.choirRev.gain.setTargetAtTime(this.piece === 'cathedral' ? 1.4 : this.piece === 'chant' ? 0.7 : 0.45, this.ctx.currentTime, 0.5);
  }
  // one chord's worth (eight beats) of the prayer piece, starting at `bar`
  prayerBar(L, bar, spb, len) {
    const [root, fifth, oct, third] = this.chord, P = this.piece, ph = this.phrase++;
    const line = (notes, bank, prefix, gain, octave = 0, t0 = bar) => { let b = 0; for (const [n, d] of notes) { this.voice(bank, n + octave, prefix, t0 + b * spb, gain, d * spb + 0.12); b += d; } };
    if (P === 'chant') {
      // the drone on the final and its fifth, hummed; the chant above it, and from the second verse the organum a fifth below
      this.sample(L.choir, root + 12, 'oo', bar, 0.3, len, 1.2, this.choirOut);
      this.sample(L.choir, fifth + 12, 'oo', bar, 0.18, len, 1.6, this.choirOut);
      const c = CHANT[ph % CHANT.length];
      line(c, L.choir, 'ah', 0.5); if (ph % 8 >= 2) line(c, L.choir, 'oo', 0.26, -7);
      if (ph % 8 >= 4) line(c, L.choir, 'ah', 0.16, 12);   // the boys, an octave up, in the last verses
    } else if (P === 'motet') {
      // the voices enter one by one, then weave
      MOTET.forEach((v, i) => { if (ph >= i || ph > 3) line(v.map(([n, d]) => [n + ((ph >> 2) % 2 ? -2 : 0), d]), L.choir, i === 3 ? 'oo' : 'ah', i === 3 ? 0.34 : 0.3, 0, bar + (ph < 4 ? 0 : i * spb * 0.5)); });
    } else if (P === 'responsory') {
      if (ph % 2 === 0) { // the cantor's verse, alone but for the drone
        this.sample(L.choir, root + 12, 'oo', bar, 0.16, len, 1.5, this.choirOut);
        line(VERSE[(ph >> 1) % VERSE.length], L.cantor, 'oh', 0.62);
      } else {             // the choir's answer: the full chord, swelling
        for (const n of [root + 12, oct, third + 12, fifth + 12]) this.sample(L.choir, n, 'ah', bar + R() * 0.05, 0.44, len, 0.9, this.choirOut);
        this.sample(L.choir, oct + 12, 'ah', bar + spb * 2, 0.2, len - spb * 2, 1.4, this.choirOut);
      }
    } else { // cathedral: slow chords far down the nave, the bell tolling, a boy's voice high above
      for (const n of [oct, third + 12, fifth + 12, oct + 12]) this.sample(L.choir, n, 'oo', bar + R() * 0.1, 0.32, len, 2.2, this.choirOut);
      this.sample(L.choir, oct + 24, 'ah', bar + spb * 2, 0.12, len - spb * 2, 2.5, this.choirOut);
      if (ph % 2 === 0) this.one(L.bells.low, bar, 0.22, Math.pow(2, (root + 12 - 45) / 12));
    }
    // the rare dark variant: one voice slips a semitone off the chord and will not come back, and something whispers under it
    if (this.falter && ph >= 2) {
      this.sample(L.choir, oct + 1, 'oo', bar + spb * 3, 0.12 + Math.min(0.12, ph * 0.015), len - spb * 3, 2.5, this.choirOut);
      if (R() < 0.6) setTimeout(() => this.a.whisper(null, 2.2, 0.16), Math.max(0, (bar - this.ctx.currentTime + spb * 2) * 1000));
    }
  }
  start() { this.started = true; this.nextBar = this.ctx.currentTime + 0.2; this.nextBeat = this.nextBar; }
  setMood(m) { if (PROG[m] && m !== this.mood) { this.mood = m; this.moodChanged = true; } }
  setIntensity(v) { this.targetIntensity = clamp(v, 0, 1); }
  stopAll() { this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 1); }

  useStems(stems) { // user-provided recordings take over the score
    this.stems = {}; const ctx = this.ctx;
    for (const k in stems) { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.a.musicBus); const s = ctx.createBufferSource(); s.buffer = stems[k]; s.loop = true; s.connect(g); s.start(); this.stems[k] = g; }
  }
  sample(bank, note, prefix, when, gain, dur, attack = 0.3, dest = this.out) {
    const s = this.a.sampleFor(bank, note, prefix); if (!s) return;
    const b = this.ctx.createBufferSource(); b.buffer = s.buf; b.playbackRate.value = s.rate;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(gain, when + attack);
    const len = Math.min(dur, s.buf.duration / s.rate - 0.05);
    g.gain.setValueAtTime(gain, when + Math.max(attack, len - 0.6)); g.gain.linearRampToValueAtTime(0, when + len);
    b.connect(g).connect(dest); b.start(when); b.stop(when + len + 0.1);
  }
  one(buf, when, gain, rate = 1) { if (!buf) return; const b = this.ctx.createBufferSource(); b.buffer = buf; b.playbackRate.value = rate; const g = this.ctx.createGain(); g.gain.value = gain; b.connect(g).connect(this.out); b.start(when); }

  update(dt) {
    if (!this.started) return;
    const ctx = this.ctx, now = ctx.currentTime;
    this.intensity = lerp(this.intensity, this.targetIntensity, 1 - Math.exp(-dt * 0.7));
    if (this.stems) {
      const want = { dread: 'dread', combat: 'combat', prayer: 'prayer', boss: 'boss', final: 'boss', triumph: 'triumph' }[this.mood === 'dread' && this.intensity > 0.35 ? 'combat' : this.mood];
      for (const k in this.stems) this.stems[k].gain.setTargetAtTime(k === want || (!this.stems[want] && k === 'dread') ? 1 : 0, now, 1.5);
      return;
    }
    const L = this.a.lib; if (!L || !L.ready) return;
    if (this.mood === 'final') { this.choirOut.gain.setTargetAtTime(0, now, 0.35); this.updateFinal(now, L); return; }
    if (this.mood === 'menu') { this.choirOut.gain.setTargetAtTime(1, now, 0.8); this.updateMenu(now, L); return; }
    this.fStep = null;
    const I = this.intensity; const mood = this.mood === 'dread' && I > 0.35 ? 'combat' : this.mood;
    const bpm = mood === 'boss' ? 96 : mood === 'combat' ? 88 : 72; const spb = 60 / bpm;
    if (this.nextBar < now - 0.5) { this.nextBar = now + 0.1; this.nextBeat = this.nextBar; }
    const hymn = mood === 'prayer';
    if (!hymn && this.piece) this.piece = null;   // the next prayer gets the next piece
    this.choirOut.gain.setTargetAtTime(hymn ? 1 : 0, now, hymn ? 0.8 : 0.35);
    // a chord per two bars
    while (this.nextBar < now + 0.3) {
      const prog = PROG[mood]; this.chord = prog[this.chordIdx++ % prog.length];
      const bar = this.nextBar, len = spb * 8;
      const [root, fifth, oct, third] = this.chord;
      const dark = mood === 'dread', fight = mood === 'combat' || mood === 'boss';
      // drone strings, always: in the dark they sit low, with a semitone rubbing beneath
      this.sample(L.strings, root - 12, '', bar, dark ? 0.5 : 0.55, len + 1, 1.2);
      this.sample(L.strings, dark ? root - 11 : fifth - 12, '', bar + (dark ? spb * 3 : 0), dark ? 0.16 : 0.35, len + 1, dark ? 3 : 1.5);
      if (hymn) { // the prayer piece for this prayer
        if (!this.piece) this.pickPrayer();
        this.prayerBar(L, bar, spb, len);
      }
      if (fight) { // war: the strings take the tune up high, brass hammers the downbeats
        this.sample(L.strings, oct, '', bar, 0.22 + I * 0.18, len, 0.25); this.sample(L.strings, third + 12, '', bar + spb * 4, 0.16 + I * 0.14, len - spb * 4, 0.25);
        if ((mood === 'boss' || I > 0.4) && L.brass) { this.sample(L.brass, root, '', bar, 0.5, 2.4, 0.05); this.sample(L.brass, fifth, '', bar, 0.35, 2.4, 0.05); if (mood === 'boss' || I > 0.7) this.sample(L.brass, root + 12, '', bar + spb * 4, 0.3, 2.0, 0.05); }
      }
      if (mood === 'triumph') { // the land breathes again: open strings, a soft horn, bells
        for (const n of [oct, fifth + 12, third + 12]) this.sample(L.strings, n, '', bar, 0.22, len, 1.6);
        if (L.brass && this.chordIdx % 2 === 0) this.sample(L.brass, root + 12, '', bar + 0.3, 0.22, 3.2, 0.4);
        if (this.chordIdx % 2 === 1) this.one(L.bells.mid, bar, 0.25, Math.pow(2, (root + 24 - 57) / 12));
      }
      // the creeping dread: dissonance, breath and far-off screams, never while the knights pray
      if (dark || fight) {
        const k = R() / (0.7 + 0.6 * (this.a.terror ?? 0.5));   // the deeper the chapter, the more of it
        if (k < (dark ? 0.32 : 0.16)) this.a.stinger('drone', 0.35);
        else if (k < (dark ? 0.52 : 0.28)) this.a.stinger('cluster', dark ? 0.24 : 0.28);
        else if (k < (dark ? 0.62 : 0.34)) this.a.stinger('scrape', 0.18);
        else if (dark && k < 0.74) this.a.stinger('breath', 0.25);
        // high strings hanging a semitone off the chord, barely there
        if (dark && R() < 0.45) this.sample(L.strings, oct + 13, '', bar + spb * 2, 0.07, len - spb * 2, 3);
        if (dark && R() < 0.15 + 0.35 * (this.a.terror ?? 0.5)) this.a.distant('scream');
      }
      this.heart = dark && R() < 0.55;
      this.nextBar += len;
    }
    // drums and spiccato ostinato
    while (this.nextBeat < now + 0.25) {
      const b = this.beat++ % 16; const t = this.nextBeat;
      // in the dark, only a slow heartbeat; in prayer, nothing but the hymn
      if (mood === 'dread' && this.heart && (b === 0 || b === 1)) this.one(L.drums.low, t, b === 0 ? 0.2 : 0.12, 0.8);
      const drums = mood === 'boss' ? 1 : mood === 'combat' ? 0.35 + I * 0.65 : 0;
      const pat = [1, 0, 0, 0.4, 0.7, 0, 0.3, 0, 1, 0, 0.5, 0, 0.7, 0.3, 0.5, 0.6];
      if (drums > 0.05 && pat[b] > 0 && pat[b] <= drums + 0.35) this.one(b % 4 === 0 ? L.drums.low : L.drums.mid, t, 0.5 * pat[b] * (0.5 + drums * 0.5));
      if (drums > 0.6 && b % 2 === 1) this.one(L.drums.rim, t, 0.12);
      const spic = mood === 'boss' ? 1 : mood === 'combat' ? I : 0;
      if (spic > 0.3) { const [root, fifth] = this.chord; const n = [root, root, fifth, root, root + 12, root, fifth, root][b % 8] - 12; this.sample(L.spic, n, '', t, 0.35 * spic, 0.45, 0.01); }
      this.nextBeat += spb / 2;
    }
  }

  // The title: a great organ and the whole choir in a stone nave. The organ holds each chord, the pedal an octave
  // below; the choir sings the chord and over it the theme; a great drum on the first beat and the third; at the head
  // of each phrase a cymbal swell, a crash and the low bell. The first phrase is organ and choir alone, the drums come
  // in with the second, the theme climbs an octave in the third.
  updateMenu(now, L) {
    const spb = 60 / 62, bar = spb * 4;
    if (this.mStep == null || this.nextBar < now - 0.5) { this.mStep = 0; this.nextBar = now + 0.15; }
    while (this.nextBar < now + 0.3) {
      const i = this.mStep++, n = i % 8, phrase = Math.floor(i / 8), t = this.nextBar;
      const [root, fifth, oct, third] = this.chord = PROG.menu[n];
      const organ = (note, g, d = bar + 0.25) => this.sample(L.organ || L.strings, note, '', t, g, d, 0.12);
      // the organ: pedal, and the chord full in the manuals
      organ(root - 12, 0.55); organ(root, 0.34); for (const m of [fifth, oct, third, oct + 12]) organ(m, 0.2);
      if (phrase > 0) organ(fifth + 12, 0.12);
      // the strings under it all
      this.sample(L.strings, root - 12, '', t, 0.3, bar + 0.3, 0.6);
      // the choir: the chord, 'ah', and the theme
      for (const m of [oct, third + 12, fifth + 12]) this.sample(L.choir, m, phrase === 0 ? 'oo' : 'ah', t + R() * 0.03, 0.26, bar + 0.2, 0.5, this.choirOut);
      const theme = phrase % 4 === 2 ? MENU_THEME_B : MENU_THEME;
      if (phrase > 0 || n >= 4) for (const [b, note, d] of theme[n]) this.voice(L.choir, note, 'ah', t + b * spb, phrase === 0 ? 0.32 : 0.5, d * spb + 0.15, 0.1, 0.5);
      if (phrase >= 2) for (const [b, note, d] of theme[n]) this.voice(L.choir, note - 12, 'ah', t + b * spb, 0.28, d * spb + 0.15, 0.1, 0.5);
      // the drums, from the second phrase; brass on the strong chords
      if (phrase > 0) {
        this.one(L.drums.taiko || L.drums.low, t, 0.75); this.one(L.drums.low, t + spb * 2, 0.45);
        if (n === 3 || n === 7) { this.one(L.drums.taiko || L.drums.low, t + spb * 3, 0.35); this.one(L.drums.taiko || L.drums.low, t + spb * 3.5, 0.45); }
        if (L.brass && (n === 0 || n === 4 || n === 6)) { this.sample(L.brass, root, '', t, 0.42, bar, 0.08); this.sample(L.brass, fifth, '', t, 0.3, bar, 0.08); }
      }
      // the head of each phrase: the swell before it, the crash and the bell on it
      if (n === 7 && L.drums.swell) this.one(L.drums.swell, t + bar - 1.6, 0.35);
      if (n === 0 && phrase > 0 && L.drums.crash) this.one(L.drums.crash, t, 0.4);
      if (n === 0) this.one(L.bells.low, t, 0.3, Math.pow(2, (root + 12 - 45) / 12));
      this.nextBar += bar;
    }
  }

  // The battle with the Dragon: war drums in 3-3-2, a spiccato ostinato grinding on the flat second, brass stabs,
  // and over it all a horn theme. Layers enter with the fight (intensity: 0.3 waiting, 0.6 on the ground, 0.82 in
  // the air over the wards, 1.0 when He is cast down and enraged); snare rolls and a cymbal swell drive every
  // fourth bar into the next phrase.
  updateFinal(now, L) {
    const I = this.intensity, spb = 60 / 108, step = spb / 4;
    if (this.fStep == null || this.nextStep < now - 0.5) { this.fStep = 0; this.nextStep = now + 0.1; }
    while (this.nextStep < now + 0.25) {
      const s = this.fStep++, t = this.nextStep, inChord = s % 32, b16 = s % 16;
      if (inChord === 0) {
        const idx = this.chordIdx++, n = idx % 4, bridge = Math.floor(idx / 4) % 4 === 3;
        this.chord = (bridge ? FINAL_BRIDGE : PROG.final)[n]; this.fN = n; this.fBridge = bridge;
        const [root, fifth, oct, third] = this.chord, len = spb * 8;
        // the floor: low strings an octave and two below, and the brass pedal once the fight is on
        this.sample(L.strings, root - 12, '', t, 0.55, len + 0.6, 0.4);
        this.sample(L.strings, fifth - 12, '', t, 0.3, len + 0.6, 0.4);
        if (I > 0.5) this.sample(L.strings, fifth, '', t, 0.18 + I * 0.12, len, 0.5);
        if (I > 0.85) { this.sample(L.strings, oct + 12, '', t, 0.16, len, 0.6); this.sample(L.strings, third + 12, '', t + spb * 4, 0.12, len - spb * 4, 0.6); }
        if (n === 0 && I > 0.5) { this.one(L.drums.crash, t, 0.32 + I * 0.15); this.one(L.drums.taiko, t, 0.9); }
        // the theme
        if (I > 0.6 && L.horn) {
          const line = (bridge ? FINAL_BRIDGE_THEME : FINAL_THEME)[n];
          for (const [bt, note, d] of line) {
            this.sample(L.horn, note, '', t + bt * spb, 0.38 + (I - 0.6) * 0.3, d * spb + 0.35, 0.05);
            if (I > 0.9) this.sample(L.brass, note - 12, '', t + bt * spb, 0.3, d * spb + 0.3, 0.05);   // doubled below, when He is enraged
          }
        }
        if (R() < 0.25 * (1 - I)) this.a.stinger('drone', 0.25);
      }
      const [root, fifth] = this.chord;
      // drums: the great drum in 3-3-2, toms answering, a heartbeat of it before the fight begins
      const taiko = b16 === 0 || b16 === 6 || b16 === 12 || (I > 0.8 && b16 === 14);
      if (I < 0.45) { if (b16 === 0 || (b16 === 3 && s % 32 < 16)) this.one(L.drums.taiko, t, b16 === 0 ? 0.55 : 0.3); }
      else {
        if (taiko) this.one(L.drums.taiko, t, b16 === 0 ? 0.85 : 0.6);
        if (b16 === 3 || b16 === 9 || (I > 0.7 && (b16 === 10 || b16 === 15))) this.one(L.drums.mid, t, 0.4);
        if (b16 === 8) this.one(L.drums.low, t, 0.55);
      }
      // snare: backbeat once the fight is in the air, and a roll that swells through the last bar of the phrase
      const lastBar = this.fN === 3 && inChord >= 16;
      if (L.drums.snare) {
        if (I > 0.65 && (b16 === 4 || b16 === 12) && !lastBar) this.one(L.drums.snare, t, 0.32 + I * 0.15);
        if (I > 0.55 && lastBar) this.one(L.drums.snare, t, 0.08 + 0.38 * ((inChord - 16) / 16), 1 + (R() - 0.5) * 0.04);
      }
      if (I > 0.85 && s % 2 === 1) this.one(L.drums.rim, t, 0.07);
      if (this.fN === 3 && inChord === 24 && I > 0.5) this.one(L.drums.swell, t, 0.4);
      // the ostinato: low spiccato strings, eighths, then sixteenths, leaning on the flat second
      if (I > 0.35 && (I > 0.6 || s % 2 === 0)) {
        const pat = [0, 0, 12, 0, 0, 0, 7, 0, 0, 0, 12, 0, 1, 0, 7, 0];
        this.sample(L.spic, root + pat[b16] - 12, '', t, (b16 % 4 === 0 ? 0.42 : 0.28) * Math.min(1, 0.4 + I), 0.4, 0.008);
      }
      // brass stabs on the 3-3-2 accents of the first bar of each chord
      if (I > 0.45 && inChord < 16 && (b16 === 0 || b16 === 6 || b16 === 12)) {
        this.sample(L.brass, root, '', t, 0.42 + I * 0.15, 0.55, 0.02); this.sample(L.brass, fifth, '', t, 0.3, 0.55, 0.02);
      }
      this.nextStep += step;
    }
  }
}
