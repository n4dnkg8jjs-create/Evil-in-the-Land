const Pp0 = await import('/js/people.js'); await Pp0.loadPeople('/models/people.json');
const sc = new THREE.Scene(); sc.background = new THREE.Color(0x3a3e44);
sc.add(new THREE.HemisphereLight(0xdfe6f0, 0x3a3530, 1.6)); const dl = new THREE.DirectionalLight(0xffffff, 3); dl.position.set(2, 4, 4); sc.add(dl);
const q = { tex: 512, shadows: false, particles: 0.5, post: false };
const P = Pp0.makePerson('priest', q); sc.add(P.root);
P.setGround?.(() => 0);
const dt = 1 / 60; let T = 0;
for (let i = 0; i < 60; i++) { P.update(dt, null, null); T += dt; }
P.bless();
const keys = [1.15, 1.82, 2.47, 3.25];
const wantT = [0.95, 1.15, 1.65, 1.82, 2.3, 2.47, 3.02, 3.25];
const log = []; const shots = [];
const hand = P.rig.j.handR, sh = P.rig.j.uArmR; const v = new THREE.Vector3(), s0 = new THREE.Vector3();
let prevH = null, maxJump = 0;
const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
const W = 240, H = 270; R.setSize(960, 540); R.setScissorTest(true);
let panel = 0; const snapAt = [0.6, 1.15, 1.82, 2.47, 2.75, 3.25, 3.7, 4.4];
for (let i = 0; i < 300; i++) {
  P.update(dt, null, new THREE.Vector3(0, 0, 3)); const t = i * dt + dt;
  P.root.updateMatrixWorld(true); hand.getWorldPosition(v);
  if (prevH) maxJump = Math.max(maxJump, v.distanceTo(prevH) / dt); prevH = v.clone();
  for (const kt of keys) if (Math.abs(t - kt) < dt / 2 + 1e-6) { sh.getWorldPosition(s0); log.push(`t ${kt}: wrist ${v.toArray().map(x => x.toFixed(3))} shoulder ${s0.toArray().map(x => x.toFixed(3))}`); }
  for (const st of snapAt) if (Math.abs(t - st) < dt / 2 + 1e-6 && panel < 8) {
    const x = (panel % 4) * W, y = panel < 4 ? H : 0; cam.aspect = W / H; cam.updateProjectionMatrix(); cam.position.set(1.0, 1.6, 2.4); cam.lookAt(0, 1.35, 0);
    R.setViewport(x, y, W, H); R.setScissor(x, y, W, H); R.render(sc, cam); panel++;
  }
}
console.warn('BLESS ' + log.join(' | ') + ` | max hand speed ${maxJump.toFixed(2)} m/s`);
R.setScissorTest(false);
return R.domElement.toDataURL('image/jpeg', 0.9);
