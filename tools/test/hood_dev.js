const Pp0 = await import('/js/people.js'); await Pp0.loadPeople('/models/people.json');
const Hr = await import('/js/horror.js'); const Dv = await import('/js/devil.js');
const sc = new THREE.Scene(); sc.background = new THREE.Color(0x3a3e44);
sc.add(new THREE.HemisphereLight(0xdfe6f0, 0x3a3530, 1.6)); const dl = new THREE.DirectionalLight(0xffffff, 3); dl.position.set(2, 4, 4); sc.add(dl);
const W = Dv.WATCHER_DEF ? Hr.buildHumanDevil(Dv.WATCHER_DEF) : Hr.buildHumanDevil({ hooded: true, horns: [0.5, 0.06, 1.2] });
const poses = [[0, 0], [70, 0], [-70, 0], [0, 40], [60, 35]];
const res = [];
const out = [];
const bodies = poses.map(([yw, pt], i) => { const b = i === 0 ? W : Hr.buildHumanDevil(Dv.WATCHER_DEF || { hooded: true }); b.mesh.position.x = i * 1.6; sc.add(b.mesh); return b; });
// settle the spring with each head pose
for (let f = 0; f < 120; f++) { bodies.forEach((b, i) => { const [yw, pt] = poses[i]; b.B.head.rotation.set(pt * Math.PI / 180, yw * Math.PI / 180, 0, 'YXZ'); }); Hr.tickRobes(f / 60); }
sc.updateMatrixWorld(true);
// hood skinned positions vs robe collar: bottom ring of each hood, distance to the rest pose bottom ring
const hoodOf = (b) => { let h = null; b.mesh.traverse((o) => { if (o.isSkinnedMesh && o.geometry.attributes.skinWeight.count < 3000) h = o; }); return h; };
const ring = (b, rows) => { const h = hoodOf(b), P = h.geometry.attributes.position, v = new THREE.Vector3(), r = []; const NU1 = 57; for (const j of rows) for (let i = 0; i < NU1; i++) { h.getVertexPosition(j * NU1 + i, v); v.applyMatrix4(h.matrixWorld); v.x -= b.mesh.position.x; r.push(v.clone()); } return r; };
const r0b = ring(bodies[0], [30]), r0m = ring(bodies[0], [20]);
const lines = [];
bodies.forEach((b, i) => { const rb = ring(b, [30]), rm = ring(b, [20]); let mb = 0, mm = 0; rb.forEach((v, k) => mb = Math.max(mb, v.distanceTo(r0b[k]))); rm.forEach((v, k) => mm = Math.max(mm, v.distanceTo(r0m[k]))); lines.push(`pose ${poses[i]}: bottom-ring max move ${(mb * 100).toFixed(1)} cm, mid-row ${(mm * 100).toFixed(1)} cm`); });
// neck skin outside the cloth? fraction of neck/upper-chest body verts not covered: test rays from camera dirs is heavy; instead report body verts weighted to neck whose distance to nearest hood vertex > 6 cm and that lie above the robe collar
console.warn('HOOD ' + lines.join(' | '));
const cam = new THREE.PerspectiveCamera(28, 960 / 540, 0.05, 50);
cam.position.set(3.2, 2.0, 4.6); cam.lookAt(3.2, 1.75, 0);
R.setSize(960, 540); R.render(sc, cam);
return R.domElement.toDataURL('image/jpeg', 0.9);
