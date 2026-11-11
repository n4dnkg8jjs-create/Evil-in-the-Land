const W = await import('/js/weather.js');
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x40464e);
// a sky to reflect: bright band near the horizon, dark above
const sky = new THREE.Scene(); const sg = new THREE.SphereGeometry(50, 32, 16);
const sm = new THREE.ShaderMaterial({ side: THREE.BackSide, vertexShader: 'varying vec3 v; void main(){ v = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }', fragmentShader: 'varying vec3 v; void main(){ float y = normalize(v).y; gl_FragColor = vec4(mix(vec3(0.75,0.78,0.8), vec3(0.18,0.2,0.24), smoothstep(0.0, 0.5, y)) * (y < 0.0 ? 0.2 : 1.0), 1.0); }' });
sky.add(new THREE.Mesh(sg, sm)); const pm = new THREE.PMREMGenerator(R); const env = pm.fromScene(sky).texture; scene.environment = env;
const sim = new W.WaterSim(R, false);
const mat = new THREE.MeshStandardMaterial({ color: 0x0c1010, roughness: 0.06, metalness: 0, envMapIntensity: 1.3 });
mat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, W.WATER_U); sh.uniforms.uRainOn = { value: 1 };
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vW;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvW = (modelMatrix * vec4(position,1.0)).xz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vW; uniform float uRainOn;' + W.WATER_GLSL)
    .replace('#include <normal_fragment_maps>', 'vec3 nn = waterNormal(vec3(0.0,0.0,1.0), vW, uRainOn); normal = normalize((viewMatrix * vec4(nn.x, nn.z, -nn.y, 0.0)).xyz);');
};
const pl = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), mat); scene.add(pl);
scene.add(new THREE.HemisphereLight(0x8890a0, 0x202020, 0.6));
// a post for scale (1.8 m) where the walker ends
const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.8), new THREE.MeshStandardMaterial({ color: 0x553322 })); scene.add(post);
W.WX.uRain.value = 0.8;
const center = new THREE.Vector3(0, 0, 0); let x = -6, w = 0;
for (let i = 0; i < 150; i++) {
  const dt = 1 / 60, v = 1.6; x += v * dt; w += v * dt;
  sim.drop(x, 0, 0.15, Math.min(0.016, v * 0.004));
  if (w > 0.75) { w = 0; sim.drop(x, 0.15, 0.14, 0.06); }
  if (i === 30) sim.drop(2, -3, 0.14, 0.12);   // one single footfall, ~2 s old by the end
  W.WX.uWTime.value = i * dt; sim.step(dt, center);
}
post.position.set(x, 0.9, 0.6);
const cam = new THREE.PerspectiveCamera(50, 960 / 540, 0.1, 200); cam.position.set(x - 1, 3.2, 6.5); cam.lookAt(x - 2.5, 0, -0.5);
R.render(scene, cam); return R.domElement.toDataURL('image/jpeg', 0.9);
