// Gran Galoppo, gara in 3D con Three.js
import * as THREE from 'three';
import { GLTFLoader } from './lib/three/addons/loaders/GLTFLoader.js';

const LANE_W = 1.7;
const HORSE_SCALE = 0.0068;
const COAT = {
  baio: { body: 0x7a4426, points: 0x16100c },
  baio_scuro: { body: 0x45261a, points: 0x110c09 },
  sauro: { body: 0xa85a28, points: null },
  morello: { body: 0x1f1c1d, points: null },
  grigio: { body: 0xc2beb7, points: 0x6e6a64 },
  palomino: { body: 0xd2a65c, points: null },
  pezzato_nero: { body: 0xece8e1, patch: 0x161415, points: null },
  pezzato_sauro: { body: 0xebe3d6, patch: 0x9a4e22, points: 0x2a1e18 }
};

let state = null;
let template = null;
let loading = null;

function loadHorse() {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      new GLTFLoader().load('models/Horse.glb', (g) => {
        let mesh = null;
        g.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
        const geo = mesh.geometry;
        const pos = geo.attributes.position;
        // capisce da che parte guarda la testa: la testa sta più in alto della coda
        let yFront = 0, nFront = 0, yBack = 0, nBack = 0;
        for (let i = 0; i < pos.count; i++) {
          const z = pos.getZ(i), y = pos.getY(i);
          if (z > 200) { yFront += y; nFront++; }
          if (z < -200) { yBack += y; nBack++; }
        }
        const headPlusZ = yFront / Math.max(1, nFront) > yBack / Math.max(1, nBack);
        const box = new THREE.Box3().setFromBufferAttribute(pos);
        const col = geo.attributes.color;
        let sum = 0;
        for (let i = 0; i < col.count; i++) sum += 0.3 * col.getX(i) + 0.59 * col.getY(i) + 0.11 * col.getZ(i);
        template = { geo, clip: g.animations[0], headPlusZ, box, meanLum: sum / col.count };
        resolve(template);
      }, undefined, reject);
    });
  }
  return loading;
}

function coatColors(baseGeo, coat, seed, box, meanLum) {
  const c = COAT[coat] || COAT.baio;
  const orig = baseGeo.attributes.color;
  const pos = baseGeo.attributes.position;
  const out = new Float32Array(orig.count * 3);
  const body = new THREE.Color(c.body), tmp = new THREE.Color();
  const pts = c.points != null ? new THREE.Color(c.points) : null;
  const patch = c.patch != null ? new THREE.Color(c.patch) : null;
  const h = box.max.y - box.min.y;
  for (let i = 0; i < orig.count; i++) {
    const lum = Math.max(0.3, Math.min(1.25, (0.3 * orig.getX(i) + 0.59 * orig.getY(i) + 0.11 * orig.getZ(i)) / meanLum));
    const y = (pos.getY(i) - box.min.y) / h;
    const z = pos.getZ(i), x = pos.getX(i);
    tmp.copy(body);
    if (patch) {
      const n = Math.sin(z * 0.012 + seed) * Math.cos(y * 7 + seed * 2) + Math.sin(z * 0.025 + x * 0.02 + seed * 3) * 0.6;
      if (n > 0.25 || y > 0.72) tmp.copy(patch);
    }
    if (pts && y < 0.26) tmp.copy(pts);
    out[i * 3] = Math.min(1, tmp.r * lum);
    out[i * 3 + 1] = Math.min(1, tmp.g * lum);
    out[i * 3 + 2] = Math.min(1, tmp.b * lum);
  }
  return new THREE.BufferAttribute(out, 3);
}

function canvasTex(w, h, draw, repeat) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}

function makeJockey(silk, cap, num) {
  const g = new THREE.Group();
  const silkM = new THREE.MeshStandardMaterial({ color: silk, roughness: 0.55 });
  const capM = new THREE.MeshStandardMaterial({ color: cap, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.8 });
  const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe3c2a0, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.42, 4, 10), silkM);
  torso.rotation.z = -1.2; torso.position.set(0.05, 0.36, 0); g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12), capM);
  head.position.set(0.36, 0.52, 0); g.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), skin);
  face.position.set(0.43, 0.46, 0); g.add(face);
  [-1, 1].forEach((s) => {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.32, 4, 8), silkM);
    arm.rotation.z = -0.6; arm.position.set(0.36, 0.28, 0.16 * s); g.add(arm);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.26, 4, 8), white);
    thigh.rotation.z = 0.9; thigh.position.set(0.0, 0.16, 0.2 * s); g.add(thigh);
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.24, 4, 8), black);
    boot.rotation.z = -0.4; boot.position.set(0.1, -0.06, 0.24 * s); g.add(boot);
  });
  const clothTex = canvasTex(128, 96, (x, w, h) => {
    x.fillStyle = '#f4f1e8'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#2a2a2a'; x.lineWidth = 4; x.strokeRect(2, 2, w - 4, h - 4);
    x.fillStyle = '#1a1a1a'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(num, w / 2, h / 2 + 4);
  });
  const clothM = new THREE.MeshStandardMaterial({ map: clothTex, side: THREE.DoubleSide, roughness: 0.9 });
  [-1, 1].forEach((s) => {
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.38), clothM);
    cloth.position.set(-0.22, -0.16, 0.3 * s);
    g.add(cloth);
  });
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function itemMesh(kind) {
  let m;
  if (kind === 'carota') {
    m = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 12), new THREE.MeshStandardMaterial({ color: 0xe8742a, roughness: 0.6 }));
    body.rotation.z = Math.PI;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0x4f9a38 }));
    leaf.position.y = 0.48;
    m.add(body, leaf);
  } else if (kind === 'zolletta') {
    m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0xfbfbf7, roughness: 0.9, emissive: 0x333333 }));
  } else {
    m = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.08, 10, 24, Math.PI * 1.5), new THREE.MeshStandardMaterial({ color: 0xe2b93b, metalness: 0.8, roughness: 0.25, emissive: 0x443300 }));
    m.rotation.z = Math.PI * 0.25;
  }
  m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return m;
}

function buildWorld(scene, race) {
  const len = race.dist + 600;
  const sky = new THREE.Color(0xa9c8de);
  scene.background = sky;
  scene.fog = new THREE.Fog(0xc9dbe6, 120, 520);

  const hemi = new THREE.HemisphereLight(0xdfeaf2, 0x4e6b3a, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(-30, 60, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 200;
  scene.add(sun, sun.target);

  const grassTex = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#5f8f4c'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { x.fillStyle = Math.random() < 0.5 ? 'rgba(40,70,30,.25)' : 'rgba(140,180,100,.18)'; x.fillRect(Math.random() * w, Math.random() * h, 2, 3); }
  }, [len / 8, 60]);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(len + 800, 480), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(len / 2 - 300, -0.02, 0); ground.receiveShadow = true;
  scene.add(ground);

  const turfTex = canvasTex(512, 64, (x, w, h) => {
    x.fillStyle = '#3f7d37'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,0.07)'; x.fillRect(0, 0, w / 2, h);
    for (let i = 0; i < 1800; i++) { x.fillStyle = Math.random() < 0.5 ? 'rgba(20,50,15,.25)' : 'rgba(150,200,110,.15)'; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }, [len / 20, 2]);
  const turf = new THREE.Mesh(new THREE.PlaneGeometry(len, 13), new THREE.MeshStandardMaterial({ map: turfTex, roughness: 0.95 }));
  turf.rotation.x = -Math.PI / 2; turf.position.set(len / 2 - 300, 0, 0); turf.receiveShadow = true;
  scene.add(turf);

  const white = new THREE.MeshStandardMaterial({ color: 0xf8f8f4, roughness: 0.5 });
  [-6.6, 6.6].forEach((z) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), white);
    rail.position.set(len / 2 - 300, 1.05, z); rail.castShadow = true; scene.add(rail);
    const n = Math.floor(len / 4);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.05, 0.08), white, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { m.makeTranslation(-300 + i * 4, 0.52, z); posts.setMatrixAt(i, m); }
    posts.castShadow = true; scene.add(posts);
  });

  // tribuna lungo il rettilineo d'arrivo
  const crowdTex = canvasTex(512, 256, (x, w, h) => {
    x.fillStyle = '#5d5952'; x.fillRect(0, 0, w, h);
    const cols = ['#e3d2ae', '#9a3b32', '#3d5c8a', '#f2efe6', '#2f2b27', '#c9a46a', '#6c8f5a'];
    for (let r = 0; r < 26; r++) for (let c = 0; c < 70; c++) {
      x.fillStyle = cols[(r * 7 + c * 13 + ((r * c) % 5)) % cols.length];
      x.beginPath(); x.arc(4 + c * 7.3 + (r % 2) * 3, 6 + r * 9.6, 2.6, 0, Math.PI * 2); x.fill();
    }
  }, [12, 1]);
  const standLen = 420, standX = race.dist - 200;
  const tiers = new THREE.Mesh(new THREE.BoxGeometry(standLen, 9, 10), [
    new THREE.MeshStandardMaterial({ color: 0xd9d2c2 }), new THREE.MeshStandardMaterial({ color: 0xd9d2c2 }),
    new THREE.MeshStandardMaterial({ color: 0x8c877c }), new THREE.MeshStandardMaterial({ color: 0x8c877c }),
    new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 1 }), new THREE.MeshStandardMaterial({ color: 0xd9d2c2 })
  ]);
  tiers.position.set(standX, 4.5, -22); tiers.rotation.x = -0.18; tiers.castShadow = true; tiers.receiveShadow = true;
  scene.add(tiers);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(standLen + 6, 0.6, 14), new THREE.MeshStandardMaterial({ color: 0x3c4650, roughness: 0.6 }));
  roof.position.set(standX, 12.5, -22); roof.castShadow = true; scene.add(roof);
  const colN = Math.floor(standLen / 20) + 1;
  const cols = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.25, 12.5, 10), new THREE.MeshStandardMaterial({ color: 0xe9e3d4 }), colN);
  const cm = new THREE.Matrix4();
  for (let i = 0; i < colN; i++) { cm.makeTranslation(standX - standLen / 2 + i * 20, 6.25, -15.5); cols.setMatrixAt(i, cm); }
  scene.add(cols);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(standLen, 1.2, 0.4), new THREE.MeshStandardMaterial({ color: 0xe9e3d4 }));
  wall.position.set(standX, 0.6, -15.5); scene.add(wall);

  // alberi nell'anello interno e sul fondo
  const trunks = [], crowns = [];
  for (let i = 0; i < 260; i++) {
    const x = -300 + Math.random() * (len + 400);
    const z = Math.random() < 0.7 ? 30 + Math.random() * 90 : -(40 + Math.random() * 80);
    if (z < 0 && Math.abs(x - standX) < standLen / 2 + 20) continue;
    const s = 0.7 + Math.random() * 0.8;
    trunks.push([x, z, s]); crowns.push([x, z, s]);
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 6), new THREE.MeshStandardMaterial({ color: 0x4b3524 }), trunks.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 1), new THREE.MeshStandardMaterial({ color: 0x3a6b3a, roughness: 0.9, flatShading: true }), crowns.length);
  const tm = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const crownCol = new THREE.Color();
  trunks.forEach((t, i) => {
    tm.compose(pv.set(t[0], 1.5 * t[2], t[1]), q.identity(), sv.set(t[2], t[2], t[2])); trunk.setMatrixAt(i, tm);
    tm.compose(pv.set(t[0], 4.6 * t[2], t[1]), q.setFromAxisAngle(sv.set(0, 1, 0), Math.random() * 6), sv.set(t[2], t[2] * 1.15, t[2])); crown.setMatrixAt(i, tm);
    crown.setColorAt(i, crownCol.setHSL(0.27 + Math.random() * 0.06, 0.35, 0.22 + Math.random() * 0.1));
  });
  trunk.castShadow = crown.castShadow = true;
  scene.add(trunk, crown);

  // colline lontane
  for (let i = 0; i < 9; i++) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(120 + Math.random() * 80, 18, 10), new THREE.MeshStandardMaterial({ color: 0x86a77f, roughness: 1 }));
    hill.scale.y = 0.25; hill.position.set(-200 + i * (len / 7), -10, i % 2 ? 330 : -330);
    scene.add(hill);
  }

  // paletti della distanza
  const poleTex = canvasTex(16, 64, (x, w, h) => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#f8f8f4' : '#c8452f'; x.fillRect(0, i * 8, w, 8); } });
  for (let m = 100; m < race.dist; m += 100) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8), new THREE.MeshStandardMaterial({ map: poleTex }));
    pole.position.set(m, 1.3, -7.3); pole.castShadow = true; scene.add(pole);
    const lab = canvasTex(128, 64, (x, w, h) => {
      x.fillStyle = '#f8f8f4'; x.fillRect(0, 0, w, h); x.strokeStyle = '#333'; x.lineWidth = 4; x.strokeRect(2, 2, w - 4, h - 4);
      x.fillStyle = '#1c1c1c'; x.font = 'bold 40px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(race.dist - m), w / 2, h / 2 + 2);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshStandardMaterial({ map: lab, side: THREE.DoubleSide }));
    sign.position.set(m, 2.8, -7.3); sign.rotation.y = Math.PI / 2 * 0; scene.add(sign);
    const sign2 = sign.clone(); sign2.rotation.y = Math.PI / 2; scene.add(sign2);
  }

  // traguardo
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 13), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  line.rotation.x = -Math.PI / 2; line.position.set(race.dist, 0.02, 0); scene.add(line);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.2, 10), white);
  post.position.set(race.dist, 2.1, -7.6); post.castShadow = true; scene.add(post);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.08, 28), new THREE.MeshStandardMaterial({ color: 0xc8452f }));
  disc.rotation.z = Math.PI / 2; disc.position.set(race.dist, 4.4, -7.6); scene.add(disc);
  const disc2 = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.08, 28), new THREE.MeshStandardMaterial({ color: 0xc8452f }));
  disc2.position.set(race.dist, 4.4, -7.6); scene.add(disc2);

  // gabbie di partenza
  const gateM = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.5 });
  const gate = new THREE.Group();
  for (let i = 0; i <= 6; i++) {
    const z = (i - 3) * LANE_W;
    const side = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 0.1), gateM); side.position.set(-0.6, 1.3, z); gate.add(side);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 6 * LANE_W + 0.4), new THREE.MeshStandardMaterial({ color: 0x2f6a50 }));
  top.position.set(-0.6, 2.75, 0); gate.add(top);
  gate.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(gate);
  return { sun };
}

function makeHorse(r) {
  const t = template;
  const geo = t.geo.clone();
  geo.setAttribute('color', coatColors(t.geo, r.coat, (r.num | 0) * 1.7, t.box, t.meanLum));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.morphTargetInfluences = t.geo.morphAttributes.position.map(() => 0);
  mesh.updateMorphTargets();
  const holder = new THREE.Group();
  mesh.scale.setScalar(HORSE_SCALE);
  mesh.rotation.y = t.headPlusZ ? Math.PI / 2 : -Math.PI / 2;
  mesh.position.y = -t.box.min.y * HORSE_SCALE;
  holder.add(mesh);
  const jockey = makeJockey(r.silk, r.cap, r.num);
  const h = (t.box.max.y - t.box.min.y) * HORSE_SCALE;
  jockey.position.set(0.2, h * 0.6, 0);
  holder.add(jockey);
  const mixer = new THREE.AnimationMixer(mesh);
  const action = mixer.clipAction(t.clip);
  action.play();
  action.time = Math.random() * t.clip.duration;
  return { holder, mixer, action, jockey, jy: h * 0.6, x: r.pos, z: (r.lane - 2.5) * LANE_W };
}

function start(container, getRace) {
  stop();
  const W = 1240, H = 520;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    container.innerHTML = '<div style="padding:40px;color:#F3EEDF">Il tuo browser non supporta il 3D (WebGL).</div>';
    return;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.innerHTML = '';
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 1200);
  camera.position.set(-10, 4, 20);
  const st = { renderer, scene, camera, container, getRace, horses: null, items: null, world: null, raf: 0, last: performance.now(), mode: lastMode, camPos: new THREE.Vector3(-2, 4.5, 20), look: new THREE.Vector3(3, 1.1, 0) };
  state = st;
  loadHorse().then(() => {
    if (state !== st) return;
    const race = getRace();
    if (!race) return;
    st.world = buildWorld(scene, race);
    st.horses = race.racers.map((r) => { const h = makeHorse(r); scene.add(h.holder); return h; });
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 4), new THREE.MeshStandardMaterial({ color: 0xd4af37, emissive: 0x6b5410, metalness: 0.4, roughness: 0.3 }));
    marker.rotation.x = Math.PI;
    marker.position.set(0.3, 2.75, 0);
    st.horses[0].holder.add(marker);
    st.marker = marker;
    st.items = race.items.map((it) => {
      const m = itemMesh(it.kind);
      m.position.set(it.m, 1.1, (it.lane - 2.5) * LANE_W);
      scene.add(m);
      return m;
    });
  }).catch(() => { container.innerHTML = '<div style="padding:40px;color:#F3EEDF">Non riesco a caricare il modello del cavallo.</div>'; });

  const loop = (now) => {
    if (state !== st) return;
    const dt = Math.min(0.1, (now - st.last) / 1000);
    st.last = now;
    const race = getRace();
    if (race && st.horses) {
      const racing = race.count <= 0;
      race.racers.forEach((r, i) => {
        const h = st.horses[i];
        h.x += (r.pos - h.x) * Math.min(1, dt * 10);
        h.z += ((r.lane - 2.5) * LANE_W - h.z) * Math.min(1, dt * 4);
        h.holder.position.set(h.x, 0, h.z);
        const moving = racing && r.speed > 1;
        h.action.paused = !moving;
        h.mixer.update(moving ? dt * (0.5 + r.speed / 18) * 1.3 : 0);
        h.jockey.position.y = h.jy + (moving ? Math.sin(h.action.time / template.clip.duration * Math.PI * 4) * 0.05 : 0);
      });
      race.items.forEach((it, i) => {
        const m = st.items[i];
        m.visible = !it.taken;
        if (m.visible) { m.rotation.y += dt * 2; m.position.y = 1.1 + Math.sin(now / 300 + i) * 0.12; }
      });
      if (st.marker) { st.marker.rotation.y += dt * 2; st.marker.position.y = 2.75 + Math.sin(now / 250) * 0.1; }
      const me = st.horses[0];
      const target = new THREE.Vector3(), look = new THREE.Vector3();
      if (st.mode === 'dietro') { target.set(-8, 3.2, me.z * 0.8); look.set(8, 1.3, me.z * 0.7); }
      else if (st.mode === 'fronte') { target.set(12, 2.1, me.z * 0.5); look.set(-4, 1.5, me.z * 0.7); }
      else { target.set(-2, 4.5, 20); look.set(3, 1.1, 0); }
      st.camPos.lerp(target, Math.min(1, dt * 3));
      st.look.lerp(look, Math.min(1, dt * 4));
      camera.position.set(me.x + st.camPos.x, st.camPos.y, st.camPos.z);
      camera.lookAt(me.x + st.look.x, st.look.y, st.look.z);
      if (st.world) {
        st.world.sun.position.set(me.x - 30, 60, 40);
        st.world.sun.target.position.set(me.x, 0, 0);
      }
    }
    renderer.render(scene, camera);
    st.raf = requestAnimationFrame(loop);
  };
  st.raf = requestAnimationFrame(loop);
}

function stop() {
  if (!state) return;
  const st = state;
  cancelAnimationFrame(st.raf);
  st.scene.traverse((o) => {
    if (o.geometry && o.geometry !== (template && template.geo)) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
  });
  st.renderer.dispose();
  st.renderer.forceContextLoss();
  if (st.renderer.domElement.parentNode) st.renderer.domElement.remove();
  state = null;
  lastMode = st.mode || lastMode;
}

let lastMode = 'tv';
const MODES = ['tv', 'dietro', 'fronte'];
const LABELS = { tv: 'Laterale', dietro: 'Da dietro', fronte: 'Frontale' };
function cycleCamera() {
  const cur = state && state.mode ? state.mode : lastMode;
  const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
  lastMode = next;
  if (state) state.mode = next;
  return LABELS[next];
}
function cameraLabel() { return LABELS[state && state.mode ? state.mode : lastMode]; }
const _start = start;
window.Race3D = {
  start: (c, g) => { _start(c, g); if (state) state.mode = lastMode; },
  stop, cycleCamera, cameraLabel, preload: loadHorse
};
loadHorse().catch(() => {});
