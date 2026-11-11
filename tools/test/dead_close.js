const Pp = await import('/js/people.js?' + Date.now()); await Pp.loadPeople('/models/people.json');
const sc = new THREE.Scene(); sc.background = new THREE.Color(0x6a7078);
sc.add(new THREE.HemisphereLight(0xdde4ee, 0x403a34, 1.3)); const dl = new THREE.DirectionalLight(0xfff4e8, 2.4); dl.position.set(3, 6, 4); dl.castShadow = true; dl.shadow.mapSize.set(2048, 2048); Object.assign(dl.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 }); sc.add(dl); R.shadowMap.enabled = true;
const G = (x, z) => 0.12 * x + 0.18 * Math.sin(z * 1.1 + x * 0.6) + 0.06 * Math.sin(x * 3.1) * Math.cos(z * 2.7);
const pg = new THREE.PlaneGeometry(14, 14, 140, 140).rotateX(-Math.PI / 2), pp = pg.attributes.position; for (let i = 0; i < pp.count; i++) pp.setY(i, G(pp.getX(i), pp.getZ(i))); pg.computeVertexNormals();
const fl = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.95 })); fl.receiveShadow = true; sc.add(fl);
const out = [];
for (const [pose, seed, x, z, yaw] of [['sit', 3, -1.6, 0.2, 0.5], ['slump', 4, 0.1, -0.6, -0.2], ['prone', 10, 1.9, 0.4, 2.2]]) { const f = Pp.makeFrozen(pose, seed); f.settle(G, x, z, yaw); sc.add(f.root); const g = f.gaps(G); out.push(pose + ' ' + Object.entries(g.per).map(([k, v]) => k + ':' + v.toFixed(3)).join(' ')); }
console.warn(out.join('\n'));
const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 80); cam.position.set(0.2, 2.1, 3.6); cam.lookAt(0.1, 0.25, -0.1);
R.render(sc, cam); return R.domElement.toDataURL('image/jpeg', 0.88);
