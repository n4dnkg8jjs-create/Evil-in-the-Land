// Procedural PBR texture generation. Everything is painted at load time on
// canvases (hammer dents, etching, mail rings, quilting, cracked earth...)
// and converted to colour / normal / roughness maps.
import * as THREE from 'three';
import { rng, makeTileNoise, clamp, lerp, smooth } from './util.js';

const tn = makeTileNoise(1337);

function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// Read a grayscale canvas into a Float32 heightfield [0,1]
function readHeight(c) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const h = new Float32Array(c.width * c.height);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] / 255;
  return h;
}

// Sobel normal map from heightfield (wrapping) -> canvas
export function normalFromHeight(h, w, hh, strength = 2) {
  const c = canvas(w, hh); const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, hh); const o = img.data;
  const at = (x, y) => h[((y + hh) % hh) * w + ((x + w) % w)];
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = -dy * strength, nz = 1; // ny: +y down in canvas
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    o[i] = (nx * 0.5 + 0.5) * 255; o[i + 1] = (-ny * 0.5 + 0.5) * 255; o[i + 2] = (nz * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function fillNoise(ctx, w, h, period, oct, fn) {
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = tn.fbm(x / w, y / h, period, oct);
    const i = (y * w + x) * 4; const [r, g, b] = fn(n, x, y, d[i], d[i + 1], d[i + 2]);
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// Paint a soft dimple (wrapping across edges)
function dimple(ctx, w, h, x, y, r, a, light) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
    const cx = x + ox, cy = y + oy;
    if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) continue;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const c = light ? 255 : 0;
    g.addColorStop(0, `rgba(${c},${c},${c},${a})`); g.addColorStop(1, `rgba(${c},${c},${c},0)`);
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
}

// Etched arabesque band pattern (Augsburg/Nuremberg-style etched borders)
function etchPattern(ctx, x0, y0, w, h, seed, color) {
  const r = rng(seed);
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round';
  const vertical = h > w;
  const len = vertical ? h : w, th = vertical ? w : h;
  // border lines
  ctx.lineWidth = Math.max(1, th * 0.06);
  if (vertical) { ctx.strokeRect(x0 + th * 0.08, y0 - 2, w - th * 0.16, h + 4); }
  else { ctx.strokeRect(x0 - 2, y0 + th * 0.08, w + 4, h - th * 0.16); }
  // scrolling vine
  ctx.lineWidth = Math.max(1, th * 0.05);
  const step = th * 0.9;
  for (let s = -step; s < len + step; s += step) {
    const flip = Math.round(s / step) % 2 === 0 ? 1 : -1;
    ctx.beginPath();
    for (let k = 0; k <= 16; k++) {
      const t = k / 16; const a = s + t * step; const b = th / 2 + Math.sin(t * Math.PI) * th * 0.26 * flip;
      vertical ? (k ? ctx.lineTo(x0 + b, y0 + a) : ctx.moveTo(x0 + b, y0 + a)) : (k ? ctx.lineTo(x0 + a, y0 + b) : ctx.moveTo(x0 + a, y0 + b));
    }
    ctx.stroke();
    // curling leaf
    const la = s + step * 0.5, lb = th / 2 + th * 0.26 * flip;
    const cx = vertical ? x0 + lb : x0 + la, cy = vertical ? y0 + la : y0 + lb;
    ctx.beginPath(); ctx.arc(cx, cy, th * 0.12, 0, Math.PI * (1.2 + r() * 0.6)); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, th * 0.04, 0, Math.PI * 2); ctx.fill();
  }
  // stippled ground (the etched-away background)
  const dots = Math.floor(len * th * 0.02);
  for (let i = 0; i < dots; i++) {
    const a = r() * len, b = th * 0.15 + r() * th * 0.7;
    const px = vertical ? x0 + b : x0 + a, py = vertical ? y0 + a : y0 + b;
    ctx.fillRect(px, py, 1, 1);
  }
  ctx.restore();
}

export const FINISHES = {
  bright:    { name: 'Bright Steel',       base: [190, 194, 198], rough: 0.22, etch: [150, 148, 140], etchRough: 0.55, gilt: false },
  blued:     { name: 'Fire-Blued',         base: [52, 66, 104],   rough: 0.30, etch: [180, 150, 80],  etchRough: 0.35, gilt: true },
  blackened: { name: 'Blackened & Gilt',   base: [34, 33, 32],    rough: 0.48, etch: [214, 168, 72],  etchRough: 0.30, gilt: true },
  russet:    { name: 'Russeted',           base: [92, 54, 38],    rough: 0.42, etch: [176, 172, 160], etchRough: 0.30, gilt: false },
  // a year in the rain on the Emperor's field (the dead only; not offered to the living)
  rusted:    { name: 'Rusted',             base: [104, 92, 80],   rough: 0.78, etch: [88, 62, 44],    etchRough: 0.85, gilt: false, hidden: true },
};

const cache = new Map();

// Armour plate textures. UV: u around the plate, v along its length.
export function armorTextures(finishKey, size = 1024) {
  const key = 'armor:' + finishKey + size;
  if (cache.has(key)) return cache.get(key);
  const F = FINISHES[finishKey];
  const r = rng(77 + finishKey.length * 13);
  const s = size;

  // height: hammer dents + planishing + rolled-border step + etching
  const hc = canvas(s); const hx = hc.getContext('2d', { willReadFrequently: true });
  hx.fillStyle = 'rgb(128,128,128)'; hx.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) dimple(hx, s, s, r() * s, r() * s, s * (0.01 + r() * 0.035), 0.05 + r() * 0.06, r() < 0.5);
  for (let i = 0; i < 30; i++) dimple(hx, s, s, r() * s, r() * s, s * (0.04 + r() * 0.08), 0.05, r() < 0.4);
  // etched bands: borders along v edges + a central vertical band
  const bandH = s * 0.055;
  const etchMask = canvas(s); const ex = etchMask.getContext('2d');
  ex.fillStyle = '#000'; ex.fillRect(0, 0, s, s);
  etchPattern(ex, 0, s * 0.012, s, bandH, 5, '#fff');
  etchPattern(ex, 0, s - bandH - s * 0.012, s, bandH, 6, '#fff');
  etchPattern(ex, s * 0.47, 0, s * 0.06, s, 7, '#fff');
  // scratches
  const scr = canvas(s); const sx = scr.getContext('2d');
  sx.fillStyle = '#000'; sx.fillRect(0, 0, s, s);
  for (let i = 0; i < 260; i++) {
    const x = r() * s, y = r() * s, a = r() * Math.PI, l = s * (0.01 + r() * 0.08);
    sx.strokeStyle = `rgba(255,255,255,${0.15 + r() * 0.5})`; sx.lineWidth = 0.5 + r();
    sx.beginPath(); sx.moveTo(x, y); sx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 6, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); sx.stroke();
  }
  const H = readHeight(hc);
  const emData = ex.getImageData(0, 0, s, s).data;
  const scData = sx.getImageData(0, 0, s, s).data;
  for (let i = 0; i < H.length; i++) H[i] = H[i] - emData[i * 4] / 255 * 0.05 - scData[i * 4] / 255 * 0.015;
  const nC = normalFromHeight(H, s, s, 3.2);

  // albedo + roughness
  const aC = canvas(s), rC = canvas(s);
  const ax = aC.getContext('2d'), rx = rC.getContext('2d');
  const aImg = ax.createImageData(s, s), rImg = rx.createImageData(s, s);
  const A = aImg.data, R = rImg.data;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x, p = i * 4;
    const u = x / s, v = y / s;
    const grime = tn.fbm(u, v, 4, 5);
    const streak = tn.fbm(u * 0.25, v, 64, 2); // polishing streaks (anisotropic)
    const temper = tn.fbm(u, v, 2, 3); // heat-tint variation
    const etch = emData[p] / 255, sc = scData[p] / 255;
    let cr = F.base[0], cg = F.base[1], cb = F.base[2];
    const vary = (temper - 0.5) * (finishKey === 'blued' ? 60 : 24);
    cr += vary * (finishKey === 'blued' ? 0.6 : 1); cg += vary * 0.8; cb += vary * (finishKey === 'blued' ? 1.4 : 0.9);
    const dirt = clamp((grime - 0.6) * 1.4, 0, 0.3);       // light oxidation, never blotches
    const polish = (streak - 0.5) * 18;                       // lengthwise polishing lines
    cr = lerp(cr, cr * 0.8, dirt) + polish; cg = lerp(cg, cg * 0.78, dirt) + polish; cb = lerp(cb, cb * 0.76, dirt) + polish;
    cr = lerp(cr, F.etch[0], etch); cg = lerp(cg, F.etch[1], etch); cb = lerp(cb, F.etch[2], etch);
    // bright scratches through dark finishes
    if (finishKey === 'rusted') {   // flaking rust eating in from the edges of the blotches
      const rust = clamp((grime - 0.38) * 2.4, 0, 1) * 0.9, pit = clamp((temper - 0.55) * 3, 0, 1) * 0.5;
      cr = lerp(cr, 118 - pit * 40, rust); cg = lerp(cg, 54 - pit * 20, rust); cb = lerp(cb, 26 - pit * 10, rust);
    }
    const scrC = finishKey === 'bright' || finishKey === 'rusted' ? 0 : sc * 0.6;
    cr = lerp(cr, 200, scrC); cg = lerp(cg, 200, scrC); cb = lerp(cb, 205, scrC);
    A[p] = clamp(cr, 0, 255); A[p + 1] = clamp(cg, 0, 255); A[p + 2] = clamp(cb, 0, 255); A[p + 3] = 255;
    let rough = F.rough + (streak - 0.5) * 0.14 + dirt * 0.4 + sc * (finishKey === 'bright' ? 0.25 : -0.05);
    if (finishKey === 'rusted') rough = Math.max(rough, 0.6 + clamp((grime - 0.38) * 2.4, 0, 1) * 0.35);
    rough = lerp(rough, F.etchRough, etch);
    const rv = clamp(rough, 0.04, 1) * 255;
    R[p] = 255; R[p + 1] = rv; R[p + 2] = 255; R[p + 3] = 255; // three reads roughness from G, metalness from B
  }
  ax.putImageData(aImg, 0, 0); rx.putImageData(rImg, 0, 0);
  const out = { map: tex(aC), normalMap: tex(nC, { srgb: false }), roughnessMap: tex(rC, { srgb: false }), finish: F };
  cache.set(key, out);
  return out;
}

// Riveted mail (maille) — alternating rows of rings
export function mailTextures(size = 512) {
  if (cache.has('mail' + size)) return cache.get('mail' + size);
  const s = size; const hc = canvas(s); const hx = hc.getContext('2d', { willReadFrequently: true });
  hx.fillStyle = '#000'; hx.fillRect(0, 0, s, s);
  const ring = s / 16; const rows = s / (ring * 0.7);
  for (let row = -1; row <= rows + 1; row++) {
    for (let col = -1; col <= 17; col++) {
      const x = col * ring + (row % 2 ? ring / 2 : 0), y = row * ring * 0.7;
      const g = hx.createRadialGradient(x, y, ring * 0.22, x, y, ring * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(255,255,255,1)'); g.addColorStop(0.75, 'rgba(160,160,160,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      hx.fillStyle = g; hx.beginPath(); hx.ellipse(x, y, ring * 0.58, ring * 0.5, 0, 0, Math.PI * 2); hx.fill();
    }
  }
  const H = readHeight(hc);
  const nC = normalFromHeight(H, s, s, 4);
  const aC = canvas(s); const ax = aC.getContext('2d'); ax.drawImage(hc, 0, 0);
  const img = ax.getImageData(0, 0, s, s); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const h = d[i] / 255; d[i] = 20 + h * 140; d[i + 1] = 20 + h * 138; d[i + 2] = 22 + h * 135; }
  ax.putImageData(img, 0, 0);
  const rC = canvas(s); const rx = rC.getContext('2d'); const ri = rx.createImageData(s, s);
  for (let i = 0; i < H.length; i++) { const p = i * 4; ri.data[p] = 255; ri.data[p + 1] = (0.75 - H[i] * 0.45) * 255; ri.data[p + 2] = 255; ri.data[p + 3] = 255; }
  rx.putImageData(ri, 0, 0);
  const out = { map: tex(aC), normalMap: tex(nC, { srgb: false }), roughnessMap: tex(rC, { srgb: false }) };
  cache.set('mail' + size, out); return out;
}

// Quilted linen/wool (arming doublet, gambeson, cape)
export function clothTextures(color = [120, 24, 24], quilted = true, size = 512, key = '') {
  const k = 'cloth' + color.join(',') + quilted + size + key;
  if (cache.has(k)) return cache.get(k);
  const s = size; const hc = canvas(s); const hx = hc.getContext('2d', { willReadFrequently: true });
  fillNoise(hx, s, s, 128, 2, (n, x, y) => {
    const weave = (Math.sin(x * 1.6) * Math.sin(y * 1.6)) * 0.5 + 0.5;
    const v = 110 + weave * 40 + (n - 0.5) * 60; return [v, v, v];
  });
  if (quilted) {
    hx.strokeStyle = 'rgba(0,0,0,0.85)'; hx.lineWidth = s / 128;
    const q = s / 6;
    for (let i = -6; i < 12; i++) {
      hx.beginPath(); hx.moveTo(i * q, 0); hx.lineTo(i * q + s, s); hx.stroke();
      hx.beginPath(); hx.moveTo(i * q, s); hx.lineTo(i * q + s, 0); hx.stroke();
    }
    hx.filter = 'blur(2px)'; hx.drawImage(hc, 0, 0); hx.filter = 'none';
  }
  const H = readHeight(hc);
  const nC = normalFromHeight(H, s, s, quilted ? 3 : 1.5);
  const aC = canvas(s); const ax = aC.getContext('2d'); const img = ax.createImageData(s, s);
  for (let i = 0; i < H.length; i++) {
    const p = i * 4; const h = 0.55 + H[i] * 0.6;
    img.data[p] = clamp(color[0] * h, 0, 255); img.data[p + 1] = clamp(color[1] * h, 0, 255); img.data[p + 2] = clamp(color[2] * h, 0, 255); img.data[p + 3] = 255;
  }
  ax.putImageData(img, 0, 0);
  const out = { map: tex(aC), normalMap: tex(nC, { srgb: false }) };
  cache.set(k, out); return out;
}

export function leatherTextures(size = 256) {
  if (cache.has('leather')) return cache.get('leather');
  const s = size; const hc = canvas(s); const hx = hc.getContext('2d', { willReadFrequently: true });
  fillNoise(hx, s, s, 32, 5, (n) => { const v = n * 255; return [v, v, v]; });
  const H = readHeight(hc); const nC = normalFromHeight(H, s, s, 2);
  const aC = canvas(s); const ax = aC.getContext('2d'); const img = ax.createImageData(s, s);
  for (let i = 0; i < H.length; i++) { const p = i * 4, h = 0.6 + H[i] * 0.5; img.data[p] = 78 * h; img.data[p + 1] = 46 * h; img.data[p + 2] = 26 * h; img.data[p + 3] = 255; }
  ax.putImageData(img, 0, 0);
  const out = { map: tex(aC), normalMap: tex(nC, { srgb: false }) }; cache.set('leather', out); return out;
}

export function woodTextures(size = 256, tint = [96, 66, 40]) {
  const k = 'wood' + tint.join(); if (cache.has(k)) return cache.get(k);
  const s = size; const aC = canvas(s); const ax = aC.getContext('2d'); const img = ax.createImageData(s, s);
  const H = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const n = tn.fbm(x / s, y / s * 0.08, 16, 4); const ring = Math.sin((x / s * 40 + n * 12) * Math.PI) * 0.5 + 0.5;
    const h = 0.6 + ring * 0.25 + n * 0.3; H[y * s + x] = ring;
    const p = (y * s + x) * 4; img.data[p] = tint[0] * h; img.data[p + 1] = tint[1] * h; img.data[p + 2] = tint[2] * h; img.data[p + 3] = 255;
  }
  ax.putImageData(img, 0, 0);
  const out = { map: tex(aC), normalMap: tex(normalFromHeight(H, s, s, 1.2), { srgb: false }) }; cache.set(k, out); return out;
}

// Terrain material set. Each returned albedo carries a height in alpha for blending.
export function terrainTextures(size = 512) {
  if (cache.has('terrain' + size)) return cache.get('terrain' + size);
  const s = size; const r = rng(99);
  function make(fn, heightFn, nStrength) {
    const aC = canvas(s); const ax = aC.getContext('2d'); const img = ax.createImageData(s, s);
    const H = new Float32Array(s * s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = x / s, v = y / s; const i = y * s + x;
      const h = heightFn(u, v); H[i] = h; const c = fn(u, v, h);
      const p = i * 4; img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = clamp(h * 255, 0, 255);
    }
    ax.putImageData(img, 0, 0);
    return { a: aC, n: normalFromHeight(H, s, s, nStrength) };
  }
  // cracked dead earth / ash — Voronoi-ish cracks
  // jittered-grid Voronoi (G x G cells, wraps) — distance-to-edge gives crack lines
  const G = 9; const jit = []; for (let i = 0; i < G * G; i++) jit.push([r(), r()]);
  const crack = (u, v) => {
    const gx = u * G, gy = v * G; const ix = Math.floor(gx), iy = Math.floor(gy);
    let d1 = 9, d2 = 9;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const cx = ix + ox, cy = iy + oy; const j = jit[((cy + G) % G) * G + ((cx + G) % G)];
      const dx = gx - (cx + j[0]), dy = gy - (cy + j[1]); const d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return clamp((Math.sqrt(d2) - Math.sqrt(d1)) * 3.2, 0, 1);
  };
  const crackCache = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) crackCache[y * s + x] = crack(x / s, y / s);
  const cAt = (u, v) => crackCache[Math.min(s - 1, Math.floor(v * s)) * s + Math.min(s - 1, Math.floor(u * s))];
  // cracks only where the ground has baked hard; elsewhere ash, grit and dead soil
  const crackMask = (u, v) => smooth(clamp((tn.fbm(u + 0.17, v + 0.61, 3, 3) - 0.48) * 4, 0, 1));
  const fine = (u, v) => cAt((u * 2.3) % 1, (v * 2.3) % 1);
  const dead = make((u, v, h) => {
    const n = tn.fbm(u, v, 8, 5), n2 = tn.fbm(u + 0.5, v + 0.2, 24, 3);
    const m = crackMask(u, v); const c = lerp(1, Math.min(cAt(u, v), fine(u, v) + 0.25), m);
    const base = 22 + n * 26 + n2 * 14; const ember = c < 0.06 && n > 0.55 ? (0.06 - c) * 7 : 0;
    const ash = smooth(clamp((tn.fbm(u + 0.9, v, 5, 3) - 0.55) * 3, 0, 1)) * 26;
    return [base * 1.05 + ash + ember * 120, base * 0.96 + ash * 0.97 + ember * 20, base * 0.9 + ash * 0.95];
  }, (u, v) => { const m = crackMask(u, v); return lerp(0.75, Math.min(cAt(u, v), fine(u, v) + 0.25), m) * 0.55 + tn.fbm(u, v, 16, 4) * 0.3 + tn.fbm(u, v, 48, 2) * 0.15; }, 1.8);
  const alive = make((u, v) => {
    const n = tn.fbm(u, v, 8, 5), m = tn.fbm(u + 0.3, v, 3, 3);
    const flower = tn.noise(u * 96, v * 96, 96) > 0.93 ? 1 : 0;
    return flower ? [210, 200, 120] : [lerp(48, 96, n) * (0.8 + m * 0.4), lerp(70, 120, n) * (0.85 + m * 0.3), lerp(26, 44, n)];
  }, (u, v) => tn.fbm(u, v, 32, 3), 1.5);
  const rock = make((u, v) => {
    const n = tn.fbm(u, v * 2.5, 6, 6); const strata = Math.sin(v * 40 + n * 8) * 0.5 + 0.5;
    const g = 60 + n * 70 + strata * 18; return [g * 0.98, g * 0.96, g * 0.93];
  }, (u, v) => tn.fbm(u, v * 2.5, 6, 6) * 0.8 + (Math.sin(v * 40) * 0.5 + 0.5) * 0.2, 3.5);
  const snow = make((u, v) => {
    const n = tn.fbm(u, v, 8, 4); const g = 205 + n * 40; return [g * 0.94, g * 0.97, g];
  }, (u, v) => tn.fbm(u, v, 8, 4), 1.2);
  const out = {
    dead: tex(dead.a), deadN: tex(dead.n, { srgb: false }),
    alive: tex(alive.a), aliveN: tex(alive.n, { srgb: false }),
    rock: tex(rock.a), rockN: tex(rock.n, { srgb: false }),
    snow: tex(snow.a),
  };
  cache.set('terrain' + size, out); return out;
}

export function stoneTextures(size = 512, blocks = true) {
  const k = 'stone' + size + blocks; if (cache.has(k)) return cache.get(k);
  const s = size; const r = rng(blocks ? 5151 : 6161);
  const H = new Float32Array(s * s), A = new Float32Array(s * s * 3);
  // ashlar courses: blocks of varying length, each its own tone; or rough fieldstone
  const rows = blocks ? 5 : 1;
  const rowsY = []; for (let i = 0; i <= rows; i++) rowsY.push(i / rows);
  const cells = [];
  for (let i = 0; i < rows; i++) { let x = r() * 0.3 - 0.3; const row = []; while (x < 1) { const w = blocks ? 0.18 + r() * 0.22 : 1.1; row.push([x, x + w, 0.85 + r() * 0.3, r()]); x += w; } cells.push(row); }
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const u = x / s, v = y / s; const i = y * s + x;
    const grain = tn.fbm(u, v, 32, 4), coarse = tn.fbm(u, v, 6, 4), pit = tn.noise(u * 128, v * 128, 128);
    let h = 0.6 + grain * 0.25 + coarse * 0.15, tone = 1, hue = 0;
    if (blocks) {
      const ri = Math.min(rows - 1, Math.floor(v * rows)); const row = cells[ri];
      const vy = (v * rows) % 1;
      let cell = row[0]; for (const c of row) { const cx = ((u - c[0]) % 1 + 1) % 1; if (u >= c[0] && u < c[1]) { cell = c; break; } }
      const lx = (u - cell[0]) / (cell[1] - cell[0]);
      const edge = Math.min(lx, 1 - lx) * (cell[1] - cell[0]) * rows * 2.2, edgeY = Math.min(vy, 1 - vy);
      const e = Math.min(edge, edgeY);
      const mortar = 0.035;
      if (e < mortar) h = 0.15 + grain * 0.1;                       // recessed joint
      else h -= Math.max(0, 0.09 - (e - mortar)) * 2.5;             // chiselled, worn arris
      tone = cell[2]; hue = cell[3];
    }
    if (pit > 0.88) h -= 0.12;
    H[i] = h;
    const g = (blocks ? 112 : 96) * tone * (0.75 + grain * 0.45 + coarse * 0.2);
    const lich = smooth(clamp((tn.fbm(u + 0.3, v, 5, 3) - 0.6) * 4, 0, 1)) * 0.25;   // a little lichen and soot
    A[i * 3] = g * (0.97 + hue * 0.06) * (1 - lich * 0.3); A[i * 3 + 1] = g * (0.96 + hue * 0.03) * (1 - lich * 0.1); A[i * 3 + 2] = g * 0.9 * (1 - lich * 0.35);
    if (h < 0.3) { A[i * 3] *= 0.55; A[i * 3 + 1] *= 0.55; A[i * 3 + 2] *= 0.55; }
  }
  const nC = normalFromHeight(H, s, s, 3.2);
  const aC = canvas(s); const ax = aC.getContext('2d'); const img = ax.createImageData(s, s);
  for (let i = 0; i < s * s; i++) { img.data[i * 4] = clamp(A[i * 3], 0, 255); img.data[i * 4 + 1] = clamp(A[i * 3 + 1], 0, 255); img.data[i * 4 + 2] = clamp(A[i * 3 + 2], 0, 255); img.data[i * 4 + 3] = 255; }
  ax.putImageData(img, 0, 0);
  const out = { map: tex(aC), normalMap: tex(nC, { srgb: false }) }; cache.set(k, out); return out;
}

export function barkTextures(size = 256) {
  if (cache.has('bark')) return cache.get('bark');
  const s = size; const aC = canvas(s); const ax = aC.getContext('2d'); const img = ax.createImageData(s, s);
  const H = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const n = tn.fbm(x / s, y / s * 0.25, 12, 5); const ridge = Math.abs(Math.sin((x / s * 10 + n * 3) * Math.PI));
    const h = ridge * 0.7 + n * 0.3; H[y * s + x] = h; const p = (y * s + x) * 4; const g = 18 + h * 42;
    img.data[p] = g * 1.05; img.data[p + 1] = g * 0.95; img.data[p + 2] = g * 0.88; img.data[p + 3] = 255;
  }
  ax.putImageData(img, 0, 0);
  const out = { map: tex(aC), normalMap: tex(normalFromHeight(H, s, s, 3), { srgb: false }) }; cache.set('bark', out); return out;
}

// Demon "skin": near-black with faint ember veins (emissive)
export function demonTextures(size = 512) {
  if (cache.has('demon')) return cache.get('demon');
  const s = size; const H = new Float32Array(s * s);
  const aC = canvas(s), eC = canvas(s); const ax = aC.getContext('2d'), ex = eC.getContext('2d');
  const ai = ax.createImageData(s, s), ei = ex.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const u = x / s, v = y / s; const i = y * s + x, p = i * 4;
    const n = tn.fbm(u, v, 6, 5); const vein = 1 - Math.abs(tn.fbm(u + 0.5, v, 5, 4) - 0.5) * 2;
    const vv = Math.pow(clamp(vein, 0, 1), 18);
    H[i] = n * 0.8 - vv * 0.4;
    const g = 10 + n * 22; ai.data[p] = g * 1.1; ai.data[p + 1] = g * 0.9; ai.data[p + 2] = g; ai.data[p + 3] = 255;
    ei.data[p] = 255 * vv; ei.data[p + 1] = 60 * vv; ei.data[p + 2] = 20 * vv; ei.data[p + 3] = 255;
  }
  ax.putImageData(ai, 0, 0); ex.putImageData(ei, 0, 0);
  const out = { map: tex(aC), emissiveMap: tex(eC), normalMap: tex(normalFromHeight(H, s, s, 3), { srgb: false }) };
  cache.set('demon', out); return out;
}

// Dragon scales: overlapping scale pattern + ember glow between scales
export function scaleTextures(size = 512) {
  if (cache.has('scales')) return cache.get('scales');
  const s = size; const hc = canvas(s); const hx = hc.getContext('2d', { willReadFrequently: true });
  hx.fillStyle = '#000'; hx.fillRect(0, 0, s, s);
  const sc = s / 12;
  for (let row = 14; row >= -1; row--) for (let col = -1; col <= 13; col++) {
    const x = col * sc + (row % 2 ? sc / 2 : 0), y = row * sc * 0.62;
    const g = hx.createRadialGradient(x, y - sc * 0.2, sc * 0.05, x, y, sc * 0.62);
    g.addColorStop(0, '#fff'); g.addColorStop(0.8, '#999'); g.addColorStop(1, '#222');
    hx.fillStyle = g; hx.beginPath(); hx.ellipse(x, y, sc * 0.55, sc * 0.62, 0, Math.PI * 0.05, Math.PI * 0.95); hx.lineTo(x, y - sc * 0.5); hx.closePath(); hx.fill();
  }
  const H = readHeight(hc); const nC = normalFromHeight(H, s, s, 3);
  const aC = canvas(s), eC = canvas(s); const ax = aC.getContext('2d'), ex = eC.getContext('2d');
  const ai = ax.createImageData(s, s), ei = ex.createImageData(s, s);
  for (let i = 0; i < H.length; i++) {
    const p = i * 4, h = H[i]; const g = 12 + h * 30;
    ai.data[p] = g * 1.2; ai.data[p + 1] = g * 0.85; ai.data[p + 2] = g * 0.8; ai.data[p + 3] = 255;
    const glow = h < 0.1 ? (0.1 - h) * 10 : 0;
    ei.data[p] = 255 * glow; ei.data[p + 1] = 70 * glow; ei.data[p + 2] = 10 * glow; ei.data[p + 3] = 255;
  }
  ax.putImageData(ai, 0, 0); ex.putImageData(ei, 0, 0);
  const out = { map: tex(aC), normalMap: tex(nC, { srgb: false }), emissiveMap: tex(eC) };
  cache.set('scales', out); return out;
}

// Grass blade cards (alpha)
export function grassTexture(alive = true) {
  const k = 'grass' + alive; if (cache.has(k)) return cache.get(k);
  const w = 128, h = 128; const c = canvas(w, h); const x = c.getContext('2d'); const r = rng(alive ? 3 : 4);
  for (let i = 0; i < 26; i++) {
    const bx = 8 + r() * (w - 16), lean = (r() - 0.5) * 30, top = r() * h * 0.5;
    const col = alive ? `rgb(${50 + r() * 50},${90 + r() * 60},${25 + r() * 25})` : `rgb(${50 + r() * 30},${44 + r() * 22},${34 + r() * 16})`;
    x.fillStyle = col; x.beginPath(); x.moveTo(bx - 3, h); x.quadraticCurveTo(bx + lean * 0.3, h * 0.6, bx + lean, top); x.quadraticCurveTo(bx + lean * 0.3 + 2, h * 0.6, bx + 3, h); x.fill();
  }
  if (alive) for (let i = 0; i < 5; i++) {
    const fx = 10 + r() * (w - 20), fy = 10 + r() * h * 0.5;
    x.fillStyle = r() < 0.5 ? '#e8e2c0' : (r() < 0.5 ? '#c9a2d8' : '#e8c64a');
    for (let p = 0; p < 5; p++) { x.beginPath(); x.arc(fx + Math.cos(p * 1.26) * 3, fy + Math.sin(p * 1.26) * 3, 2.6, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = '#d4a020'; x.beginPath(); x.arc(fx, fy, 1.6, 0, Math.PI * 2); x.fill();
  }
  const t = tex(c, { repeat: false }); cache.set(k, t); return t;
}

// Soft particle sprites
export function spriteTextures() {
  if (cache.has('sprites')) return cache.get('sprites');
  const s = 128; const c = canvas(s * 4, s); const x = c.getContext('2d');
  // 0: smoke puff
  for (let i = 0; i < 9; i++) {
    const r = rng(i + 4); const cx = s / 2 + (r() - 0.5) * s * 0.4, cy = s / 2 + (r() - 0.5) * s * 0.4, rad = s * (0.18 + r() * 0.18);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
  }
  // 1: glow
  let g = x.createRadialGradient(s * 1.5, s / 2, 0, s * 1.5, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(s, 0, s, s);
  // 2: spark streak
  g = x.createLinearGradient(s * 2, s / 2, s * 3, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(s * 2, s / 2 - 3, s, 6);
  const g2 = x.createRadialGradient(s * 2.5, s / 2, 0, s * 2.5, s / 2, s * 0.15); g2.addColorStop(0, 'rgba(255,255,255,1)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g2; x.fillRect(s * 2, 0, s, s);
  // 3: flame tongue
  for (let i = 0; i < 6; i++) {
    const r = rng(i + 40); const cx = s * 3.5 + (r() - 0.5) * s * 0.25, cy = s * 0.55 + (r() - 0.5) * s * 0.3, rad = s * (0.2 + r() * 0.2);
    const gg = x.createRadialGradient(cx, cy, 0, cx, cy, rad); gg.addColorStop(0, 'rgba(255,255,255,0.7)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gg; x.fillRect(s * 3, 0, s, s);
  }
  const t = tex(c, { repeat: false }); cache.set('sprites', t); return t;
}

// Ostrich feather: a pale shaft with long, soft, drooping barbs. White in the
// texture; the plume material tints it. Alpha carries the wispy edge.
export function featherTexture(size = 256) {
  if (cache.has('feather' + size)) return cache.get('feather' + size);
  const w = size, h = size * 2; const c = canvas(w, h); const x = c.getContext('2d');
  x.clearRect(0, 0, w, h);
  const R = rngLocal(7);
  for (let i = 0; i < 900; i++) {
    const t = R(); const y0 = t * h * 0.97;
    const side = R() < 0.5 ? -1 : 1;
    const len = w * (0.32 + 0.16 * Math.sin(t * Math.PI)) * (0.7 + R() * 0.3) * (t > 0.92 ? (1 - t) * 10 : 1);
    const droop = h * (0.04 + R() * 0.05);
    const a = 0.25 + R() * 0.45;
    x.strokeStyle = `rgba(255,255,255,${a})`; x.lineWidth = 0.6 + R() * 1.1;
    x.beginPath(); x.moveTo(w / 2, y0);
    x.bezierCurveTo(w / 2 + side * len * 0.4, y0 + droop * 0.1, w / 2 + side * len * 0.8, y0 + droop * 0.5, w / 2 + side * len, y0 + droop);
    x.stroke();
  }
  x.strokeStyle = 'rgba(240,235,225,0.95)'; x.lineWidth = 2.2; x.beginPath(); x.moveTo(w / 2, 0); x.lineTo(w / 2, h * 0.97); x.stroke();
  const out = tex(c, { repeat: false });
  cache.set('feather' + size, out); return out;
}
function rngLocal(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Billowing cloud for distant storms and smoke: brighter crowns, dark bellies.
export function cloudTexture(size = 256) {
  if (cache.has('cloud' + size)) return cache.get('cloud' + size);
  const s = size; const c = canvas(s); const x = c.getContext('2d'); const r = rng(311);
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s * 0.32;
    const cx = s / 2 + Math.cos(a) * d * 1.2, cy = s * 0.55 + Math.sin(a) * d * 0.6 - r() * s * 0.08, rad = s * (0.08 + r() * 0.14);
    const top = 1 - (cy - rad) / s;
    const g = x.createRadialGradient(cx, cy - rad * 0.3, 0, cx, cy, rad);
    const L = Math.round(120 + top * 120);
    g.addColorStop(0, `rgba(${L},${L},${L},0.5)`); g.addColorStop(0.7, `rgba(${L * 0.7 | 0},${L * 0.7 | 0},${L * 0.72 | 0},0.3)`); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill();
  }
  const t = tex(c, { repeat: false }); cache.set('cloud' + size, t); return t;
}

// A spray of leaves on a transparent card (oak), or a fan of needles (pine).
export function leafTexture(pine = false, size = 256) {
  const key = 'leaf' + pine + size; if (cache.has(key)) return cache.get(key);
  const s = size; const c = canvas(s); const x = c.getContext('2d'); const r = rng(pine ? 77 : 55);
  x.clearRect(0, 0, s, s);
  const n = pine ? 260 : 150;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s * 0.42;
    const cx = s / 2 + Math.cos(a) * d, cy = s / 2 + Math.sin(a) * d;
    const L = pine ? s * 0.05 : s * (0.04 + r() * 0.03);
    const g = Math.round(70 + r() * 70), rr = Math.round(g * (0.55 + r() * 0.2)), b = Math.round(g * 0.35);
    x.fillStyle = `rgb(${rr},${g},${b})`;
    x.save(); x.translate(cx, cy); x.rotate(r() * Math.PI * 2);
    if (pine) { x.fillRect(-L, -0.8, L * 2, 1.6); }
    else { x.beginPath(); x.ellipse(0, 0, L, L * 0.5, 0, 0, Math.PI * 2); x.fill(); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(-L, -0.4, L * 2, 0.8); }
    x.restore();
  }
  const t = tex(c, { repeat: false }); cache.set(key, t); return t;
}
