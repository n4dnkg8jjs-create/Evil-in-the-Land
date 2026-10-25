// The First Company. A year before you, twenty knights rode out of the city under
// Sir Godric of Wenden, with Brother Anselm as their chaplain. None came home.
// Their dead lie along the same road, and Anselm's pages lie with them: a story
// told in the order you find it, and a warning about the fear (see dread.js).
import { account } from './account.js';
import * as THREE from 'three';
import { clamp, rng, TAU } from './util.js';
import { normalFromHeight } from './textures.js';
import { CHAPTERS } from './chapters.js';

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
// Other things left along the road, one or two a chapter: a letter that never reached Sir Godric, the names cut at
// Saint Aldric's lychgate, a drowned shrine, the old relief that tells how the Dragon came to the mountain, the
// Emperor's standard on the field of bones, Brother Anselm's own cross on the ascent.
export const LORE = [
  [{ kind: 'letter', title: 'A letter that never arrived', who: 'From the Bishop, to Sir Godric of Wenden', text: 'My lord, on the Tuesday after you rode out the cathedral bells rang of themselves, at the third hour of the night, and would not stop. The well in the cloister has gone black. Children in the lower town speak in their sleep of a tall man at the window. Come home, Godric. Whatever you have found, come home.' }],
  [{ kind: 'cross', title: 'Names cut at the lychgate', who: 'A stone cross by the churchyard wall', text: 'Twenty names, cut deep and carefully, one beneath another: Hugh, Raoul, Simon, Bertrand, Anselm… and the First Company\'s own. The last is only begun, scratched in haste with a knife: GODR. Below it, fresh, as if this morning: a twenty-first line, and no name in it yet.' }],
  [{ kind: 'shrine', title: 'The drowned shrine', who: 'A wayside shrine, half under the black water', text: 'Our Lady of the Fen, her face worn away by the rain. Someone has turned the statue to face the mountain. Scratched into the plinth in Raoul\'s hand: SHE WEEPS AT NIGHT. I HAVE HEARD HER. SHE IS NOT WEEPING FOR US.' },
   { kind: 'letter', title: 'From the city', who: 'A courier\'s satchel, the courier long gone', text: 'To any knight of the Company. The rot has reached the walls. The Bishop has died in the night with his eyes open. Six thousand souls are inside the city and the bread will last until Candlemas. If the mountain can be climbed, climb it.' }],
  [{ kind: 'relief', title: 'The legend of the Dragon', who: 'An ancient relief, older than the abbey', text: 'Carved long before any of us: a great serpent with wings coils about a mountain, and the mountain\'s roots are in fire. Beneath, the old words: When the Serpent was cast out of Heaven he fell upon the high place and slept beneath it, and the land above him sickened. He wakes when a shepherd offers him a soul. He is driven down by prayer upon the summit, and not by the sword alone.' }],
  [{ kind: 'standard', title: 'The Emperor\'s standard', who: 'Driven into the earth at the centre of the field', text: 'The Emperor\'s black eagle, rotted to threads. A plate nailed to the staff: THE HOST OF THE EMPIRE, FOUR THOUSAND STRONG, CAME TO THIS FIELD ON THE FEAST OF ALL SOULS AND STOOD. Beneath, scratched with a dagger by some later hand: AND THEY STAND HERE STILL.' }],
  [{ kind: 'cross', title: 'Brother Anselm\'s cross', who: 'Two sticks bound with a rosary, wedged in the rock', text: 'A small cross made from two sticks and Anselm\'s rosary. Under it, his breviary, the last pages torn out and gone. On the inside of the cover, in his hand: If you have come this far, you are braver than I was. Do not look back down the mountain. Pray at the top. He cannot abide it.' }],
  [],
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

const stone2 = new THREE.MeshStandardMaterial({ color: 0x6a645c, roughness: 0.92 });
const gild = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.7, roughness: 0.5 });
const cloth = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.95, side: THREE.DoubleSide });
// the relief: a winged serpent about a mountain over fire, a knight kneeling, carved into a slab (height drawn on a canvas)
let RELIEF = null;
function reliefMat() {
  if (RELIEF) return RELIEF;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  x.fillStyle = '#404040'; x.fillRect(0, 0, S, S); x.strokeStyle = '#d0d0d0'; x.fillStyle = '#b0b0b0'; x.lineCap = 'round';
  x.beginPath(); x.moveTo(30, 220); x.lineTo(128, 70); x.lineTo(226, 220); x.closePath(); x.fill();             // the mountain
  x.fillStyle = '#e8e8e8'; for (let i = 0; i < 9; i++) { x.beginPath(); x.moveTo(40 + i * 22, 236); x.quadraticCurveTo(48 + i * 22, 214, 52 + i * 22, 236); x.fill(); }   // the fire under its roots
  x.lineWidth = 9; x.beginPath(); x.moveTo(60, 200); x.bezierCurveTo(10, 120, 120, 60, 170, 110); x.bezierCurveTo(230, 160, 200, 210, 150, 190); x.bezierCurveTo(110, 175, 140, 120, 190, 70); x.stroke();   // the coils
  x.lineWidth = 3; x.beginPath(); x.moveTo(190, 70); x.lineTo(214, 52); x.lineTo(200, 76); x.stroke(); x.beginPath(); x.moveTo(205, 58); x.lineTo(222, 40); x.stroke();   // the head, horned
  x.fillStyle = '#d8d8d8'; x.beginPath(); x.moveTo(120, 95); x.lineTo(70, 30); x.lineTo(95, 70); x.lineTo(60, 60); x.lineTo(115, 105); x.fill();   // a wing
  x.beginPath(); x.arc(40, 160, 7, 0, 7); x.fill(); x.fillRect(34, 166, 12, 16); x.fillRect(30, 182, 20, 6);   // the kneeling knight
  x.lineWidth = 2; x.beginPath(); x.moveTo(52, 150); x.lineTo(52, 186); x.stroke();
  x.strokeStyle = '#202020'; x.lineWidth = 6; x.strokeRect(4, 4, S - 8, S - 8);
  const d = x.getImageData(0, 0, S, S).data, H = new Float32Array(S * S); for (let i = 0; i < H.length; i++) H[i] = d[i * 4] / 255;
  const t = new THREE.CanvasTexture(normalFromHeight(H, S, S, 4)); t.colorSpace = THREE.NoColorSpace;
  const ao = new THREE.CanvasTexture(c); ao.colorSpace = THREE.SRGBColorSpace;
  RELIEF = new THREE.MeshStandardMaterial({ color: 0x8a847a, map: ao, normalMap: t, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.95 });
  return RELIEF;
}
function loreModel(kind, r) {
  const g = new THREE.Group(); let page = null;
  const add = (geo, m, p, rot = [0, 0, 0]) => { const o = new THREE.Mesh(geo, m); o.position.set(...p); o.rotation.set(...rot); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  if (kind === 'cross') {   // a stone cross with a ring, names cut in its shaft
    add(new THREE.BoxGeometry(0.9, 0.35, 0.6), stone2, [0, 0.17, 0]); add(new THREE.BoxGeometry(0.28, 1.9, 0.2), stone2, [0, 1.3, 0]); add(new THREE.BoxGeometry(1.0, 0.24, 0.18), stone2, [0, 1.75, 0]);
    add(new THREE.TorusGeometry(0.3, 0.05, 6, 20), stone2, [0, 1.75, 0]);
    for (let i = 0; i < 8; i++) add(new THREE.BoxGeometry(0.16 - (i === 7 ? 0.08 : 0), 0.018, 0.01), new THREE.MeshStandardMaterial({ color: 0x1a1816 }), [i === 7 ? -0.04 : 0, 0.55 + i * 0.09, 0.103]);
  } else if (kind === 'shrine' || kind === 'relief') {   // a wayside shrine: pillar, gabled niche; the relief panel, or a worn statue
    add(new THREE.BoxGeometry(0.7, 1.3, 0.55), stone2, [0, 0.65, 0]); add(new THREE.BoxGeometry(1.0, 1.0, 0.55), stone2, [0, 1.8, -0.05]);
    const roof = new THREE.CylinderGeometry(0.01, 0.82, 0.5, 4, 1); roof.rotateY(Math.PI / 4); roof.scale(1, 1, 0.7); add(roof, stone2, [0, 2.55, -0.05]);
    if (kind === 'relief') { add(new THREE.PlaneGeometry(0.8, 0.8), reliefMat(), [0, 1.8, 0.226]); }
    else { add(new THREE.CylinderGeometry(0.12, 0.17, 0.62, 10), stone2, [0, 1.65, 0.12]); add(new THREE.SphereGeometry(0.1, 10, 8), stone2, [0, 2.03, 0.12]); }
    for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.03, 0.03, 0.08 + i * 0.03, 8), new THREE.MeshStandardMaterial({ color: 0xd8ccb0 }), [-0.2 + i * 0.2, 1.36, 0.28]);   // stubs of candles
  } else if (kind === 'standard') {   // the Emperor's standard: a tall staff, crossbar, the rotted banner, an eagle finial
    add(new THREE.CylinderGeometry(0.04, 0.05, 4.2, 8), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }), [0, 2.1, 0], [0.05, 0, 0.04]);
    add(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), gild, [0, 3.8, 0], [0, 0, Math.PI / 2]);
    const ban = new THREE.PlaneGeometry(1.2, 1.6, 8, 10); const bp = ban.attributes.position;
    for (let i = 0; i < bp.count; i++) { const y = bp.getY(i), x0 = bp.getX(i); bp.setZ(i, Math.sin(x0 * 5 + y * 3) * 0.06); if (y < -0.4 && Math.sin(x0 * 23) > 0.2) bp.setY(i, y + 0.3); }
    ban.computeVertexNormals(); add(ban, cloth, [0, 2.95, 0.03]);
    add(new THREE.ConeGeometry(0.1, 0.3, 6), gild, [0, 4.35, 0]); add(new THREE.BoxGeometry(0.34, 0.12, 0.02), gild, [0, 4.2, 0]);
    add(new THREE.BoxGeometry(0.3, 0.2, 0.01), gild, [0, 1.4, 0.05]);   // the plate
  } else {   // a letter: a dead courier's satchel against a stone, a broken lance with its pennon, letters blown about
    add(new THREE.DodecahedronGeometry(0.5, 0), stone2, [0, 0.25, -0.4], [0.3, 0.5, 0]);
    add(new THREE.BoxGeometry(0.36, 0.1, 0.26), leather, [0.1, 0.05, 0.05], [0, 0.4, 0.1]);
    add(new THREE.CylinderGeometry(0.025, 0.025, 2.0, 6), new THREE.MeshStandardMaterial({ color: 0x4a3a28 }), [-0.6, 0.06, 0.3], [Math.PI / 2, 0, 0.5]);
    add(new THREE.PlaneGeometry(0.4, 0.2), new THREE.MeshStandardMaterial({ color: 0x6a1010, side: THREE.DoubleSide }), [-0.95, 0.08, -0.2], [-Math.PI / 2, 0, 0.3]);
  }
  page = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.28), parch); page.rotation.set(-Math.PI / 2, 0, r() * 2); page.position.set(0.45, 0.025, 0.45); g.add(page);
  return { g, page };
}

export class Story {
  constructor(game) {
    this.game = game; this.spots = []; this.group = null;
    this.found = new Set(account.get('evil.pages', []));
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
        const off2 = world.ch.terrain.kind === 'mountain' ? 3 + r() * 2.5 : off;   // in the ravine: on its floor, never up the walls
        x = p.x + nx * side * off2; z = p.z + nz * side * off2; ok = world.okSpot(x, z, world.ch.terrain.kind === 'mountain' ? 2.5 : 4, 12) && world.normalAt(x, z).y > 0.93;
      }
      const { g, page } = cairn(r);
      g.position.set(x, world.heightAt(x, z) - 0.04, z); g.rotation.y = r() * TAU; this.group.add(g);
      this.spots.push({ x, y: g.position.y, z, pageIdx, page, taken: false });
    }
    this.buildLore(world, chIdx, r);
  }
  buildLore(world, chIdx, r) {
    const list = LORE[chIdx] || [];
    list.forEach((L, k) => {
      let x = 0, z = 0, ok = false;
      for (let tries = 0; tries < 40 && !ok; tries++) {
        const t = (k === 0 ? 0.45 : 0.8) + (r() - 0.5) * 0.1; const p = world.path.at(t), q = world.path.at(Math.min(1, t + 0.01));
        let nx = -(q.z - p.z), nz = q.x - p.x; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
        const off = world.ch.terrain.kind === 'mountain' ? 3 + r() * 2 : 5 + r() * 4, side = r() < 0.5 ? -1 : 1;
        x = p.x + nx * side * off; z = p.z + nz * side * off; ok = world.okSpot(x, z, world.ch.terrain.kind === 'mountain' ? 2.5 : 3.5, 12) && world.normalAt(x, z).y > 0.9;
        if (ok) { const yaw = Math.atan2(p.x - x, p.z - z); this.loreYaw = yaw; }
      }
      const { g, page } = loreModel(L.kind, r);
      g.position.set(x, world.heightAt(x, z) - 0.05, z); g.rotation.y = this.loreYaw ?? 0; this.group.add(g);   // faces the road
      this.spots.push({ x, y: g.position.y, z, lore: L, loreKey: chIdx + ':' + k, page, taken: false, yaw: g.rotation.y });
    });
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
    if (s.lore) return this.readLore(s);
    s.taken = true; s.page.visible = false;
    this.found.add(s.pageIdx); account.set('evil.pages', [...this.found]);
    const [title, text] = PAGES[s.pageIdx];
    const el = document.getElementById('page');
    if (el) { el.innerHTML = `<div class="page-num">Brother Anselm · page ${s.pageIdx + 1} of ${PAGES.length}</div><h3>${title}</h3><p>${text}</p>`; el.classList.add('show'); }
    this.cardT = 13 + text.length * 0.02;
    this.game.audio.paper?.(); this.game.shop?.earn(25); this.game.ui.toast('A page from the First Company · +25 silver from his purse', 3);
    // the fear is named: from here on the dread shows on the HUD
    if (s.pageIdx >= 4) this.game.dread?.reveal();
    // the first page ever found: the camera lingers on the cairn while Anselm's words are read
    this.cinematic(s, 'page', [[title, ''], [text.split('. ').slice(0, 2).join('. ') + '.', '']]);
  }
  readLore(s) {
    s.taken = true; if (s.page) s.page.visible = false;
    const L = s.lore, el = document.getElementById('page');
    if (el) { el.innerHTML = `<div class="page-num">${L.who}</div><h3>${L.title}</h3><p>${L.text}</p>`; el.classList.add('show'); }
    this.cardT = 14 + L.text.length * 0.02;
    this.game.audio.paper?.(); this.game.shop?.earn(10); this.game.ui.toast('Lore of the road · +10 silver', 2.5);
    const ch = CHAPTERS[this.game.chapterIdx];
    const nar = ch?.narration?.[1];
    this.cinematic(s, s.loreKey, [nar || [L.title, ''], [L.text.split('. ')[0] + '.', '']]);
  }
  // a short, skippable look at what was found, the first time only (and never with demons close by)
  cinematic(s, key, lines) {
    const g = this.game; if (g.cinema.active || g.boss || g.obj?.ph !== 'travel') return;
    let seen = { ...account.get('evil.loreSeen', {}) };
    if (seen[key]) return;
    for (const d of g.horde.list) if (d.alive && d.pos.distanceTo(g.me.pos) < 25) return;
    seen[key] = 1; account.set('evil.loreSeen', seen);
    const V = (x, y, z) => new THREE.Vector3(x, y, z), y0 = s.y, a = (s.yaw ?? Math.atan2(g.me.pos.x - s.x, g.me.pos.z - s.z));
    const P = (ang, r, h) => V(s.x + Math.sin(ang) * r, y0 + h, s.z + Math.cos(ang) * r);
    g.cinema.play([
      { dur: 4.2, from: { pos: P(a + 0.9, 4.2, 2.2), look: V(s.x, y0 + 1.0, s.z) }, to: { pos: P(a + 0.35, 3.0, 1.7), look: V(s.x, y0 + 1.2, s.z) }, fov: 42, text: lines[0] },
      { dur: 4.4, from: { pos: P(a - 0.1, 2.4, 1.5), look: V(s.x, y0 + 1.3, s.z) }, to: { pos: P(a - 0.45, 2.1, 1.6), look: V(s.x, y0 + 1.5, s.z) }, fov: 34, text: lines[1] },
    ], null, { skippable: true });
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
