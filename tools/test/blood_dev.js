const Fx = await import('/js/fx.js'); const Wp = await import('/js/weapons.js');
const sc = new THREE.Scene(); sc.background = new THREE.Color(0x3a3634); sc.fog = new THREE.FogExp2(0x3a3634, 0.02);
sc.add(new THREE.HemisphereLight(0xc8ccd4, 0x3a3028, 0.9)); const dl = new THREE.DirectionalLight(0xfff0dc, 2.4); dl.position.set(-3, 5, 2); sc.add(dl);
const pm = new THREE.PMREMGenerator(R); sc.environment = pm.fromScene(new (await import('three/addons/environments/RoomEnvironment.js')).RoomEnvironment(), 0.04).texture;
const ground = (x, z) => 0.12 * Math.sin(x * 0.7) + 0.08 * Math.cos(z * 0.9) + 0.05 * x;
const gg = new THREE.PlaneGeometry(16, 16, 80, 80); gg.rotateX(-Math.PI / 2); const P = gg.attributes.position; for (let i = 0; i < P.count; i++) P.setY(i, ground(P.getX(i), P.getZ(i))); gg.computeVertexNormals();
sc.add(new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: 0x5a5046, roughness: 0.95 })));
const q = { tex: 512, shadows: false, particles: 1, post: false };
const fx = new Fx.FX(sc, q); fx.setFog(sc.fog); fx.resize(540);
const V = (a, b, c) => new THREE.Vector3(a, b, c);
// three hits: a cut, a thrust, a heavy blow
fx.blood(V(-1, 1.3, 0), V(1, 0.15, 0.2).normalize(), V(0.2, 0.25, 1).normalize(), 1.3, ground, 'cut');
fx.blood(V(1.2, 1.2, -0.5), V(0, 0, 1), V(-0.3, 0.2, -1).normalize(), 1.0, ground, 'pierce');
fx.blood(V(0.2, 1.0, 1.2), V(-1, -0.2, 0).normalize(), V(0, 0.3, 1).normalize(), 1.6, ground, 'blunt');
fx.corpsePool(V(-0.6, 0, 0.6), ground, 1.2); fx.corpsePool(V(1.5, 0, 0.2), ground, 1);
for (let i = 0; i < 4; i++) fx.update(1 / 30);
const cam = new THREE.PerspectiveCamera(45, 1, 0.05, 80); R.setScissorTest(true);
const view = (x, y, w, h, pos, look) => { cam.aspect = w / h; cam.updateProjectionMatrix(); cam.position.copy(pos); cam.lookAt(look); R.setViewport(x, y, w, h); R.setScissor(x, y, w, h); R.render(sc, cam); };
view(0, 0, 480, 540, V(0.2, 2.0, 4.2), V(0.1, 0.9, 0));
// a knight's sword after a few kills
const k = { weapon: Wp.buildWeapon('longsword', q) }; k.weapon.position.set(0.2, 0.25, -1.4); k.weapon.rotation.set(0, 0.3, -1.45); sc.add(k.weapon);
for (let i = 0; i < 6; i++) Fx.bloodyWeapon(k, 0.12);
for (let i = 0; i < 150; i++) fx.update(1 / 30);
view(480, 270, 480, 270, V(0.4, 2.6, 3.4), V(0.2, 0, 0.1));
view(480, 0, 480, 270, V(0.3, 0.9, -0.2), V(0.2, 0.2, -1.4));
R.setScissorTest(false); return R.domElement.toDataURL('image/jpeg', 0.9);
