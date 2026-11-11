const Pp0 = await import('/js/people.js'); await Pp0.loadPeople('/models/people.json');
const Bd = await import('/js/body.js'); await Bd.loadBody('/models/body.json');
const Kn = await import('/js/knight.js'); const Wp = await import('/js/weapons.js');
const sc = new THREE.Scene(); sc.background = new THREE.Color(0x30343a);
sc.add(new THREE.HemisphereLight(0xdfe6f0, 0x3a3530, 1.3)); const dl = new THREE.DirectionalLight(0xffffff, 2.6); dl.position.set(2, 4, 3); sc.add(dl);
const pm = new THREE.PMREMGenerator(R); sc.environment = pm.fromScene(new (await import('three/addons/environments/RoomEnvironment.js')).RoomEnvironment(), 0.04).texture;
const q = { tex: 512, shadows: false, particles: 0.5, post: false };
// the four relics laid out, far apart
const keys = ['lance', 'joyeuse', 'flamberge', 'hammer'], at = {};
keys.forEach((k, i) => { const w = Wp.buildWeapon(k, q); w.position.set(20 + i * 6, 0, 0); sc.add(w); at[k] = w.position; });
const W = { heightAt: () => 0, collide() {}, wind: new THREE.Vector2(0.5, 0.2), canPrayAt: () => true };
const mk = (weapon, x, id) => { const k = new Kn.Knight(sc, q, { style: 'gothic', finish: 'bright', weapon, relic: 'water', heraldry: 'gules', cape: false, plume: false }, { id, name: '' }); k.pos.set(x, 0, 0); k.yaw = 0.5; return k; };
const ks = [mk('lance', 0, 0), mk('flamberge', 4, 1)];
const inp = { mx: 0, mz: 0, aimYaw: 0.5, sprint: false, block: false, pray: false, attack: false, heavy: false, dodge: false, relic: false };
for (let i = 0; i < 25; i++) for (const kk of ks) { kk.simulate(1 / 30, inp, W); kk.events.length = 0; kk.animate(1 / 30, W); }
sc.updateMatrixWorld(true);
const cam = new THREE.PerspectiveCamera(30, 1, 0.02, 80); R.setScissorTest(true);
await new Promise((r) => setTimeout(r, 1200));
const view = (x, y, w, h, look, off) => { cam.aspect = w / h; cam.updateProjectionMatrix(); cam.position.copy(look).add(off); cam.lookAt(look); R.setViewport(x, y, w, h); R.setScissor(x, y, w, h); R.render(sc, cam); };
const V = (a, b, c) => new THREE.Vector3(a, b, c);
// top row: lance head close, joyeuse hilt, flamberge whole, hammer head
view(0, 270, 240, 270, at.lance.clone().add(V(0, 1.98, 0)), V(0.25, 0.05, 0.85));
view(240, 270, 240, 270, at.joyeuse.clone().add(V(0, 0.25, 0)), V(0, 0, 1.6));
view(480, 270, 240, 270, at.flamberge.clone().add(V(0, 0.45, 0)), V(0, 0, 3.2));
view(720, 270, 240, 270, at.hammer.clone().add(V(0, 0.3, 0)), V(0.2, 0, 1.1));
// bottom: the knights holding them
view(0, 0, 480, 270, V(0, 1.2, 0.6), V(2.6, 0.4, 3.6));
view(480, 0, 480, 270, V(4, 1.2, 0.3), V(2.4, 0.3, 3.6));
R.setScissorTest(false); return R.domElement.toDataURL('image/jpeg', 0.9);
