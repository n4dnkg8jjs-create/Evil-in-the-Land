// Build the horse offline: mesh its distance field finely, decimate it, skin it, grow its hair, fit its tack,
// and write public/models/horse.json for the game to load (see public/js/horse.js).
// Usage: EVIL_VENDOR=/path/to/vendor node tools/build_horse.mjs [cell=0.0125] [triangles=38000]
// (EVIL_VENDOR must contain three/build/three.module.min.js, as for server.js)
import fs from 'fs'; import path from 'path'; import os from 'os'; import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.join(here, '..');
const vendor = process.env.EVIL_VENDOR || path.join(repo, 'vendor');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'horse-'));
fs.mkdirSync(path.join(tmp, 'node_modules', 'three'), { recursive: true });
const three = ['three.module.min.js', 'three.module.js'].map((f) => path.join(vendor, 'three', 'build', f)).find((f) => fs.existsSync(f));
fs.copyFileSync(three, path.join(tmp, 'node_modules', 'three', 'index.mjs'));
fs.writeFileSync(path.join(tmp, 'node_modules', 'three', 'package.json'), JSON.stringify({ name: 'three', type: 'module', exports: './index.mjs' }));
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
for (const f of ['horse.js', 'util.js']) fs.copyFileSync(path.join(repo, 'public', 'js', f), path.join(tmp, f));
const H = await import(pathToFileURL(path.join(tmp, 'horse.js')).href);
const cell = +(process.argv[2] || 0.0125), tris = +(process.argv[3] || 38000);
const t0 = Date.now(); const D = H.buildHorseData(cell, tris);
console.log('built in', ((Date.now() - t0) / 1000).toFixed(1), 's:', D.idx.length / 3, 'triangles,', D.pos.length / 3, 'vertices,', (D.hair.index.length / 3), 'hair triangles');
const out = path.join(repo, 'public', 'models', 'horse.json'); fs.writeFileSync(out, JSON.stringify(H.packHorseData(D)));
console.log('wrote', out, (fs.statSync(out).size / 1e6).toFixed(2), 'MB');
fs.rmSync(tmp, { recursive: true, force: true });
