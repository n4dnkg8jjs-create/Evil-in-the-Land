// The First Company. A year before you, twenty knights rode out of the city under
// Sir Godric of Wenden, with Brother Anselm as their chaplain. None came home.
// Their dead lie along the same road, and Anselm's pages lie with them: a story
// told in the order you find it, and a warning about the fear (see dread.js).
import * as THREE from 'three';
import { clamp, rng, TAU } from './util.js';

export const PAGES = [
  // the Vale
  ['Brother Anselm, the first week of Lent', 'Twenty lances under Sir Godric of Wenden. The Bishop blessed us at the city gate and the people sang the Te Deum as we rode out. We will be home by Easter, Godric says, and I believe him.'],
  ['The Vale', 'The ash begins here. Sir Hugh cut a shade in two and it laughed at him from both halves. Only the altars drive them off: rekindled in prayer, they burn the blight out of the ground. The sword buys time for the prayer. Nothing more.'],
  // the village
  ["Saint Aldric's", 'The bell-rope was cut. We found the villagers in the church, all kneeling, all facing the door. Not one had a mark on him. Godric had them buried in the yard. In the night the graves stood open.'],
  ['The one on the ridge', 'At dusk a tall man stood on the ridge, hooded, with horns that came through the cloth. A face like tallow, eyes white as milk. He did not move. Raoul swears he saw the head turn all the way round. The men do not sleep now.'],
  // the fen
  ['On fear', 'The fear is the worst of it. It comes on a man when he is alone, and then he sees them where they are not. Raoul struck at shadows all night and by morning he had wounded Hugh. Keep close to your brothers. Pray often. Stand in the light of the altars. A frightened man is a door left open.'],
  ['The black water', 'Raoul walked into the fen at night. We heard him singing the Pater Noster backwards, further and further out, until the water closed. Godric would not let us go after him. I think he was right. I think he was afraid.'],
  // the wood
  ['Eleven', 'The hound took Simon and Bertrand among the oaks. Godric speaks less now and listens more. Last night I saw him kneeling in the dark, facing the ridge, not the altar.'],
  ['A bargain', 'I asked my lord to whom he prayed. He said: "He offered me the city, Anselm. Its walls, its children, every soul in it kept safe, for one soul. Is that not a bargain any shepherd would make?" I could not answer him.'],
  // the field
  ['The Emperor\'s field', 'The Emperor\'s dead stand in their ranks on this field. The hooded one walks among them like a captain reviewing his men. Tonight Godric did not come back to the fire.'],
  ['Godric', 'I saw my lord on the hill beside Him, bareheaded. His eyes have gone white. Whoever reads this: the thing on the mountain is not killed by the sword alone. Its wards at the summit must be taken back in prayer, one by one, while your brothers keep the dark off you.'],
  // the ascent
  ['Three', 'Three of us left. The crevices have eyes. I write by touch. If the city still stands, it is because no one has reached the top. I think He waits for someone to carry the last of their courage up to Him.'],
  ['The last page', 'Lord, I am alone now, and I am afraid. If I am afraid, He hears it. Forgive Godric. Forgive me. Let whoever comes after not walk this road alo'],
];
// what He says, when He is near. Some lines only once the pages have told you why.
export const WHISPERS = [
  ['Your city is very far away.', 'Your city is very far away.'],
  ['They all kneel, in the end.', 'They all kneel, in the end.'],
  ['Godric knelt.', 'Godric knelt.', 6],
  ['Alone, little knight?', 'Alone, little knight?', 0, true],
  ['One soul. Only one.', 'One soul. Only one.', 7],
  ['I hear you.', 'I hear you.', 4],
];

const rusty = new THREE.MeshStandardMaterial({ color: 0x5a4a3c, metalness: 0.7, roughness: 0.75 });
const stoneM = new THREE.MeshStandardMaterial({ color: 0x4a4540, roughness: 0.95 });
const leather = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.85 });
const parch = new THREE.MeshStandardMaterial({ color: 0xd8c8a0, roughness: 0.9, emissive: 0x2a2010, side: THREE.DoubleSide });

// a fallen knight of the First Company: a cairn, his sword driven in at its head, his helm on the stones
function cairn(r) {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + r() * 0.16, 0), stoneM);
    const a = r() * TAU, d = r() * 0.55;
    s.position.set(Math.cos(a) * d * 0.6, 0.08 + (i > 5 ? 0.22 : 0), Math.sin(a) * d * 1.3); s.rotation.set(r() * 3, r() * 3, r() * 3); s.scale.y = 0.6; s.castShadow = true; g.add(s);
  }
  // the sword, leaning
  const sw = new THREE.Group();
  sw.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.85, 0.012), rusty));
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.035, 0.04), rusty); guard.position.y = 0.44; sw.add(guard);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 6), leather); grip.position.y = 0.56; sw.add(grip);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), rusty); pommel.position.y = 0.68; sw.add(pommel);
  sw.position.set(0, 0.3, -0.85); sw.rotation.set(0.18, 0.4, 0.12); sw.traverse((o) => { o.castShadow = true; }); g.add(sw);
  // a rough wooden cross at its head, his helm hung on it: you can see these from far off
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 0.95 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.55, 0.08), wood); post.position.set(0, 0.75, -0.55); post.rotation.z = 0.06; post.castShadow = true; g.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.07), wood); arm.position.set(0.02, 1.18, -0.55); arm.rotation.z = -0.1; arm.castShadow = true; g.add(arm);
  const hung = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 9, 0, TAU, 0, Math.PI * 0.62), rusty); hung.scale.set(1, 1.25, 1.15); hung.position.set(0.05, 1.42, -0.53); hung.rotation.set(0.25, 0.3, 0.12); hung.castShadow = true; g.add(hung);
  // the dented bascinet's mail aventail, rotten, and a second helm on the stones
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 9, 0, TAU, 0, Math.PI * 0.62), rusty); helm.scale.set(1, 1.25, 1.15); helm.position.set(0.05, 0.36, 0.1); helm.rotation.set(-0.5, 0.6, 0.3); helm.castShadow = true; g.add(helm);
  // and the satchel, with pages spilling out of it
  const sat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.22), leather); sat.position.set(0.45, 0.06, 0.45); sat.rotation.y = 0.5; g.add(sat);
  const page = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.28), parch); page.rotation.set(-Math.PI / 2, 0, 0.4); page.position.set(0.62, 0.025, 0.62); g.add(page);
  return { g, page };
}

export class Story {
  constructor(game) {
    this.game = game; this.spots = []; this.group = null;
    try { this.found = new Set(JSON.parse(localStorage.getItem('evil.pages') || '[]')); } catch { this.found = new Set(); }
    this.whisperI = 0; this.cardT = 0;
  }
  // two of Anselm's dead lie along each road (not on the summit)
  build(world, chIdx) {
    this.dispose();
    if (chIdx * 2 + 1 >= PAGES.length) return;
    this.world = world; this.group = new THREE.Group(); this.game.scene.add(this.group);
    const r = rng(777 + chIdx * 31);
    for (let k = 0; k < 2; k++) {
      const pageIdx = chIdx * 2 + k;
      // between the altars, a little off the road
      const t0 = k === 0 ? 0.24 : 0.62; let x = 0, z = 0, ok = false;
      for (let tries = 0; tries < 30 && !ok; tries++) {
        const t = t0 + r() * 0.12; const p = world.path.at(t), q = world.path.at(Math.min(1, t + 0.01));
        let nx = -(q.z - p.z), nz = q.x - p.x; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
        const side = r() < 0.5 ? -1 : 1, off = 6 + r() * 5;
        x = p.x + nx * side * off; z = p.z + nz * side * off; ok = world.okSpot(x, z, 4, 12);
      }
      const { g, page } = cairn(r);
      g.position.set(x, world.heightAt(x, z) - 0.04, z); g.rotation.y = r() * TAU; this.group.add(g);
      this.spots.push({ x, y: g.position.y, z, pageIdx, page, taken: false });
    }
  }
  update(dt, time) {
    if (!this.group) return;
    const g = this.game, me = g.me;
    for (const s of this.spots) {
      // a faint gleam of motes, so the eye finds it in the dusk
      if (!s.taken && Math.random() < dt * 2.5) g.fx.holyMotes(new THREE.Vector3(s.x, s.y + 0.3, s.z), 0.6, 1, [1, 0.8, 0.5]);
      if (s.taken || me.downed) continue;
      const d = Math.hypot(me.pos.x - s.x, me.pos.z - s.z);
      if (d < 2.4) this.read(s);
    }
    if (this.cardT > 0) { this.cardT -= dt; if (this.cardT <= 0) this.hideCard(); }
  }
  read(s) {
    s.taken = true; s.page.visible = false;
    this.found.add(s.pageIdx); try { localStorage.setItem('evil.pages', JSON.stringify([...this.found])); } catch {}
    const [title, text] = PAGES[s.pageIdx];
    const el = document.getElementById('page');
    if (el) { el.innerHTML = `<div class="page-num">Brother Anselm · page ${s.pageIdx + 1} of ${PAGES.length}</div><h3>${title}</h3><p>${text}</p>`; el.classList.add('show'); }
    this.cardT = 13 + text.length * 0.02;
    this.game.audio.paper?.(); this.game.shop?.earn(10); this.game.ui.toast('A page from the First Company · +10 silver from his purse', 3);
    // the fear is named: from here on the dread shows on the HUD
    if (s.pageIdx >= 4) this.game.dread?.reveal();
  }
  hideCard() { document.getElementById('page')?.classList.remove('show'); }
  // a line from Him, when He shows himself
  whisper(alone) {
    const known = this.found.size;
    const pool = WHISPERS.filter((w) => (w[2] || 0) <= known && (!w[3] || alone));
    const w = pool[(this.whisperI++ * 7 + Math.floor(Math.random() * 3)) % pool.length];
    if (w) this.game.ui.subtitle([w[0], ''], 3.5, true);
  }
  dispose() {
    if (this.group) { this.group.removeFromParent(); this.group.traverse((o) => { o.geometry?.dispose?.(); }); }
    this.group = null; this.spots = []; this.hideCard();
  }
}
