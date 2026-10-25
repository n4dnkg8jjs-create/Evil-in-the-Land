// The knight's mail coif and the quilted wool arming cap under it, worn beneath the helmet.
// Both are fitted to the man's own (MakeHuman) head: the head is sampled in the head bone's frame, in slices
// round an upright axis, and the cap and mail are laid a few millimetres outside it. Wherever the helmet or the
// neck guard comes closer than that, they are drawn in under the steel. The opening leaves only the face bare.
import * as THREE from 'three';
import { mailTextures, clothTextures } from './textures.js';

const Y0 = -0.1, Y1 = 0.24, DY = 0.01, NY = Math.round((Y1 - Y0) / DY) + 1;   // slices, head frame
const NA = 48, AX_Z = 0.012;                                                    // angles round the axis (0 = forward)
const RING = 0.0088;                                                            // mail ring, metres
const FIT = new Map();

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const angOf = (x, z) => Math.atan2(x, z - AX_Z);
const binA = (a) => ((Math.round((a + Math.PI) / (2 * Math.PI) * NA) % NA) + NA) % NA;

// max radius of the skin and min radius of the steel in each (slice, angle) cell
function sample(rig, face, steel) {
  rig.root.updateMatrixWorld(true);
  const head = rig.j.head, inv = new THREE.Matrix4().copy(head.matrixWorld).invert(), v = new THREE.Vector3();
  const skin = new Float32Array(NY * NA).fill(-1), helm = new Float32Array(NY * NA).fill(9);
  const put = (arr, x, y, z, max) => {
    const iy = Math.round((y - Y0) / DY); if (iy < 0 || iy >= NY) return;
    const k = iy * NA + binA(angOf(x, z)), r = Math.hypot(x, z - AX_Z);
    if (max) { if (r > arr[k]) arr[k] = r; } else if (r < arr[k]) arr[k] = r;
  };
  const g = face.geometry, idx = g.index.array, used = new Uint8Array(g.attributes.position.count);
  for (let i = 0; i < idx.length; i++) used[idx[i]] = 1;
  for (let i = 0; i < used.length; i++) if (used[i]) { face.getVertexPosition(i, v); v.applyMatrix4(face.matrixWorld).applyMatrix4(inv); put(skin, v.x, v.y, v.z, true); }
  for (const m of steel) {
    const P = m.geometry.attributes.position, M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(M); put(helm, v.x, v.y, v.z, false); }
  }
  // fill the gaps round each slice, then soften the skin into a smooth shape (max of a little neighbourhood)
  for (let iy = 0; iy < NY; iy++) {
    const row = skin.subarray(iy * NA, iy * NA + NA);
    if (!row.some((r) => r > 0)) continue;
    for (let pass = 0; pass < NA; pass++) { let left = false; for (let a = 0; a < NA; a++) if (row[a] < 0) { const l = row[(a + NA - 1) % NA], r = row[(a + 1) % NA]; if (l > 0 || r > 0) row[a] = Math.max(l, r); else left = true; } if (!left) break; }
  }
  const out = new Float32Array(NY * NA);
  for (let iy = 0; iy < NY; iy++) for (let a = 0; a < NA; a++) {
    let m = -1; for (let dy = -1; dy <= 1; dy++) for (let da = -1; da <= 1; da++) { const y = iy + dy; if (y < 0 || y >= NY) continue; m = Math.max(m, skin[y * NA + (a + da + NA) % NA] - (dy || da ? 0.002 : 0)); }
    out[iy * NA + a] = m;
  }
  // below the jaw the head runs out: carry the lowest real slice down (the neck goes on into the collar)
  let low = -1; for (let iy = 0; iy < NY; iy++) if (out[iy * NA] > 0 || out[iy * NA + NA / 2] > 0) { low = iy; break; }
  for (let iy = 0; iy < low; iy++) for (let a = 0; a < NA; a++) out[iy * NA + a] = out[low * NA + a];
  let top = NY - 1; while (top > 0 && !(out[top * NA] > 0.02 || out[top * NA + NA / 2] > 0.02)) top--;
  return { skin: out, helm, top };
}

// the opening for the face: an oval from the brow to under the chin, across the cheeks
function opening(a, y, shrink) {
  const yc = 0.05, hh = 0.098 - shrink, aw = 0.98 - shrink * 6;
  const t = (y - yc) / hh; if (Math.abs(t) >= 1) return false;
  return Math.abs(a) < aw * Math.sqrt(1 - t * t);
}

function layer(fit, off, shrink, uvScale) {
  const { skin, helm, top } = fit, pos = [], uv = [], index = [];
  const nRows = top + 2, NU = NA;
  const ys = []; for (let iy = 0; iy <= top; iy++) ys.push(Y0 + iy * DY);
  const yTop = Y0 + top * DY + off * 0.9; ys.push(yTop);
  const rad = (iy, a) => {
    if (iy > top) return 0.001;
    const k = iy * NA + a; let r = skin[k] + off;
    // the hood hangs looser round the throat and the back of the neck, as mail does
    r += 0.006 * (1 - smooth(-0.03, 0.03, ys[iy]));
    const h = helm[k]; if (h < 9) r = Math.min(r, h - 0.0045 + off * 0.35);
    // round off near the crown, where the slices shrink fast
    if (iy >= top - 1) r *= iy === top ? 0.86 : 0.97;
    return Math.max(r, 0.004);
  };
  for (let iy = 0; iy < nRows; iy++) {
    const y = ys[iy]; let arc = 0, px = 0, pz = 0;
    for (let j = 0; j <= NU; j++) {
      const a = -Math.PI + (j % NU) * 2 * Math.PI / NU, r = rad(iy, j % NU), x = Math.sin(a) * r, z = Math.cos(a) * r + AX_Z;
      if (j > 0) arc += Math.hypot(x - px, z - pz); px = x; pz = z;
      pos.push(x, y, z); uv.push(arc / uvScale, (y - Y0) / uvScale);
    }
  }
  const cellA = (j) => -Math.PI + (j + 0.5) * 2 * Math.PI / NU;
  for (let iy = 0; iy < nRows - 1; iy++) for (let j = 0; j < NU; j++) {
    if (opening(cellA(j), ys[iy] * 0.5 + ys[iy + 1] * 0.5, shrink)) continue;
    const a = iy * (NU + 1) + j, b = a + 1, c = a + NU + 1, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index); g.computeVertexNormals();
  return g;
}

let MATS = null;
function materials() {
  if (MATS) return MATS;
  const mt = mailTextures(512), tile = (t) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(1, 1); c.needsUpdate = true; return c; };
  const mail = new THREE.MeshStandardMaterial({ map: tile(mt.map), normalMap: tile(mt.normalMap), roughnessMap: tile(mt.roughnessMap), color: 0x9a9894, metalness: 0.9, roughness: 0.9, normalScale: new THREE.Vector2(1.6, 1.6), side: THREE.DoubleSide, envMapIntensity: 0.8 });
  // the rings: let the black between them show through as gaps, so it reads as mail and not as grey cloth
  mail.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= smoothstep(0.1, 0.35, texture2D(map, vMapUv).g) * 0.85 + 0.15;'); };
  const ct = clothTextures([62, 54, 44], true, 256, 'arming');
  const wool = new THREE.MeshStandardMaterial({ map: ct.map, normalMap: ct.normalMap, roughnessMap: ct.roughnessMap, color: 0xd8d0c4, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  MATS = { mail, wool };
  return MATS;
}

// rig: the knight's rig; face: his skinned MakeHuman head; steel: the helmet and neck-guard meshes; key: for the cache
export function dressCoif(rig, face, steel, key) {
  let fit = FIT.get(key);
  if (!fit) {
    const f = sample(rig, face, steel);
    fit = { cap: layer(f, 0.0035, 0.013, 0.05), mail: layer(f, 0.0085, 0.0, 16 * RING) };
    FIT.set(key, fit);
  }
  const M = materials(), out = [];
  for (const [g, m] of [[fit.cap, M.wool], [fit.mail, M.mail]]) {
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = m === M.mail; mesh.receiveShadow = true;
    rig.j.head.add(mesh); out.push(mesh);
  }
  return out;
}
