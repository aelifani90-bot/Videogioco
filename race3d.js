// Gran Galoppo, gara in 3D con Three.js
import * as THREE from 'three';
import { GLTFLoader } from './lib/three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from './lib/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from './lib/three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from './lib/three/addons/postprocessing/BokehPass.js';
import { OutputPass } from './lib/three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from './lib/three/addons/shaders/VignetteShader.js';

const HIGH = !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) && (navigator.hardwareConcurrency || 4) >= 4;

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

// Suddivisione di Loop: rende il modello liscio, anche in tutte le pose del galoppo
function loopSubdivide(chans, F) {
  const nv = chans[0].length / 3;
  const edges = new Map();
  const nbr = Array.from({ length: nv }, () => new Set());
  const ek = (a, b) => (a < b ? a * nv + b : b * nv + a);
  for (let f = 0; f < F.length; f += 3) {
    for (let e = 0; e < 3; e++) {
      const a = F[f + e], b = F[f + (e + 1) % 3], c = F[f + (e + 2) % 3];
      const k = ek(a, b);
      let ed = edges.get(k);
      if (!ed) { ed = { a: Math.min(a, b), b: Math.max(a, b), opp: [] }; edges.set(k, ed); }
      ed.opp.push(c);
      nbr[a].add(b); nbr[b].add(a);
    }
  }
  let next = nv;
  const bnd = Array.from({ length: nv }, () => []);
  edges.forEach((ed) => { ed.id = next++; if (ed.opp.length !== 2) { bnd[ed.a].push(ed.b); bnd[ed.b].push(ed.a); } });
  const out = chans.map(() => new Float32Array(next * 3));
  for (let v = 0; v < nv; v++) {
    let ws;
    if (bnd[v].length) ws = bnd[v].length === 2 ? [[v, 0.75], [bnd[v][0], 0.125], [bnd[v][1], 0.125]] : [[v, 1]];
    else {
      const n = nbr[v].size, beta = n > 3 ? 3 / (8 * n) : 3 / 16;
      ws = [[v, 1 - n * beta]];
      nbr[v].forEach((u) => ws.push([u, beta]));
    }
    for (let c = 0; c < chans.length; c++) {
      const src = chans[c], dst = out[c];
      let x = 0, y = 0, z = 0;
      for (const [u, w] of ws) { x += src[u * 3] * w; y += src[u * 3 + 1] * w; z += src[u * 3 + 2] * w; }
      dst[v * 3] = x; dst[v * 3 + 1] = y; dst[v * 3 + 2] = z;
    }
  }
  edges.forEach((ed) => {
    const ws = ed.opp.length === 2 ? [[ed.a, 0.375], [ed.b, 0.375], [ed.opp[0], 0.125], [ed.opp[1], 0.125]] : [[ed.a, 0.5], [ed.b, 0.5]];
    for (let c = 0; c < chans.length; c++) {
      const src = chans[c], dst = out[c];
      let x = 0, y = 0, z = 0;
      for (const [u, w] of ws) { x += src[u * 3] * w; y += src[u * 3 + 1] * w; z += src[u * 3 + 2] * w; }
      dst[ed.id * 3] = x; dst[ed.id * 3 + 1] = y; dst[ed.id * 3 + 2] = z;
    }
  });
  const NF = new Uint32Array(F.length * 4);
  let o = 0;
  for (let f = 0; f < F.length; f += 3) {
    const a = F[f], b = F[f + 1], c = F[f + 2];
    const ab = edges.get(ek(a, b)).id, bc = edges.get(ek(b, c)).id, ca = edges.get(ek(c, a)).id;
    NF.set([a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca], o); o += 12;
  }
  return { chans: out, F: NF };
}

function smoothHorse(geo, levels) {
  const pos = geo.attributes.position, col = geo.attributes.color;
  const morphs = geo.morphAttributes.position || [];
  const rel = geo.morphTargetsRelative;
  const idx = geo.index ? geo.index.array : Array.from({ length: pos.count }, (_, i) => i);
  const keyMap = new Map(), remap = new Int32Array(pos.count);
  const P = [], C = [], cnt = [], M = morphs.map(() => []);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = Math.round(x * 10) + '_' + Math.round(y * 10) + '_' + Math.round(z * 10);
    let k = keyMap.get(key);
    if (k === undefined) {
      k = cnt.length; keyMap.set(key, k);
      P.push(x, y, z); C.push(0, 0, 0); cnt.push(0);
      morphs.forEach((m, t) => {
        const mx = m.getX(i), my = m.getY(i), mz = m.getZ(i);
        if (rel) M[t].push(x + mx, y + my, z + mz); else M[t].push(mx, my, mz);
      });
    }
    remap[i] = k;
    C[k * 3] += col.getX(i); C[k * 3 + 1] += col.getY(i); C[k * 3 + 2] += col.getZ(i); cnt[k]++;
  }
  for (let k = 0; k < cnt.length; k++) { C[k * 3] /= cnt[k]; C[k * 3 + 1] /= cnt[k]; C[k * 3 + 2] /= cnt[k]; }
  let F = [];
  for (let f = 0; f < idx.length; f += 3) {
    const a = remap[idx[f]], b = remap[idx[f + 1]], c = remap[idx[f + 2]];
    if (a !== b && b !== c && a !== c) F.push(a, b, c);
  }
  let chans = [Float32Array.from(P), Float32Array.from(C)].concat(M.map((m) => Float32Array.from(m)));
  F = Uint32Array.from(F);
  for (let l = 0; l < levels; l++) { const r = loopSubdivide(chans, F); chans = r.chans; F = r.F; }
  const out = new THREE.BufferGeometry();
  out.setIndex(new THREE.BufferAttribute(F, 1));
  out.setAttribute('position', new THREE.BufferAttribute(chans[0], 3));
  out.setAttribute('color', new THREE.BufferAttribute(chans[1], 3));
  out.computeVertexNormals();
  const baseN = out.attributes.normal.array;
  const mp = [], mn = [];
  for (let t = 2; t < chans.length; t++) {
    const abs = chans[t];
    const d = new Float32Array(abs.length);
    for (let i = 0; i < abs.length; i++) d[i] = abs[i] - chans[0][i];
    mp.push(new THREE.BufferAttribute(d, 3));
    const g2 = new THREE.BufferGeometry();
    g2.setIndex(out.index); g2.setAttribute('position', new THREE.BufferAttribute(abs, 3));
    g2.computeVertexNormals();
    const n = g2.attributes.normal.array, dn = new Float32Array(n.length);
    for (let i = 0; i < n.length; i++) dn[i] = n[i] - baseN[i];
    mn.push(new THREE.BufferAttribute(dn, 3));
  }
  out.morphAttributes.position = mp;
  out.morphAttributes.normal = mn;
  out.morphTargetsRelative = true;
  return out;
}

function loadHorse() {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      new GLTFLoader().load('models/Horse.glb', (g) => {
        let mesh = null;
        g.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
        const raw = mesh.geometry;
        const rp = raw.attributes.position;
        // capisce da che parte guarda la testa: la testa sta più in alto della coda
        let yFront = 0, nFront = 0, yBack = 0, nBack = 0;
        for (let i = 0; i < rp.count; i++) {
          const z = rp.getZ(i), y = rp.getY(i);
          if (z > 200) { yFront += y; nFront++; }
          if (z < -200) { yBack += y; nBack++; }
        }
        const headPlusZ = yFront / Math.max(1, nFront) > yBack / Math.max(1, nBack);
        const geo = smoothHorse(raw, 1);
        const pos = geo.attributes.position;
        const box = new THREE.Box3().setFromBufferAttribute(pos);
        const col = geo.attributes.color;
        let sum = 0;
        for (let i = 0; i < col.count; i++) sum += 0.3 * col.getX(i) + 0.59 * col.getY(i) + 0.11 * col.getZ(i);
        template = { geo, name: mesh.name, clip: g.animations[0], headPlusZ, box, meanLum: sum / col.count };
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
    const grain = 1 + Math.sin(x * 0.31 + z * 0.17) * Math.sin(y * 40 + z * 0.05) * 0.04;
    tmp.multiplyScalar(grain);
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

function limb(a, b, r, mat) {
  // capsula tra due punti: braccia e gambe del fantino
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 4, 8), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}
function makeJockey(silk, cap, num) {
  const g = new THREE.Group();
  const silkM = new THREE.MeshStandardMaterial({ color: silk, roughness: 0.45 });
  const capM = new THREE.MeshStandardMaterial({ color: cap, roughness: 0.35 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.8 });
  const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.4 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9b48f, roughness: 0.8 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.6 });
  // posizione accucciata: bacino alto sopra la sella, busto quasi orizzontale verso il collo
  const hip = [-0.05, 0.42, 0], shoulder = [0.4, 0.5, 0];
  g.add(limb(hip, shoulder, 0.13, silkM));
  const neck = limb(shoulder, [0.5, 0.57, 0], 0.05, skin); g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), capM);
  head.position.set(0.56, 0.62, 0); head.scale.set(1.1, 0.95, 0.95); g.add(head);
  const peak = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.12), capM); peak.position.set(0.66, 0.6, 0); g.add(peak);
  const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.15), new THREE.MeshStandardMaterial({ color: 0x9fc3d6, metalness: 0.6, roughness: 0.2 }));
  goggles.position.set(0.64, 0.57, 0); g.add(goggles);
  [-1, 1].forEach((s) => {
    const z = 0.13 * s;
    g.add(limb([0.36, 0.5, z], [0.6, 0.36, z * 1.2], 0.04, silkM));
    g.add(limb([0.6, 0.36, z * 1.2], [0.8, 0.28, z * 0.6], 0.035, silkM));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), white); hand.position.set(0.82, 0.27, z * 0.6); g.add(hand);
    g.add(limb([-0.03, 0.4, z * 1.1], [0.26, 0.22, z * 1.9], 0.06, white));
    g.add(limb([0.26, 0.22, z * 1.9], [0.08, 0.02, z * 2.0], 0.045, black));
    const iron = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12), new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.9, roughness: 0.3 }));
    iron.position.set(0.09, -0.02, z * 2.0); g.add(iron);
  });
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.42), leather); saddle.position.set(-0.02, 0.04, 0); g.add(saddle);
  const clothTex = canvasTex(128, 96, (x, w, h) => {
    x.fillStyle = '#f4f1e8'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#2a2a2a'; x.lineWidth = 4; x.strokeRect(2, 2, w - 4, h - 4);
    x.fillStyle = '#1a1a1a'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(num, w / 2, h / 2 + 4);
  });
  const clothM = new THREE.MeshStandardMaterial({ map: clothTex, side: THREE.DoubleSide, roughness: 0.9 });
  [-1, 1].forEach((s) => {
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.34), clothM);
    cloth.position.set(-0.08, -0.14, 0.27 * s);
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
  scene.background = new THREE.Color(0xa9c8de);
  scene.add(skyDome());
  scene.fog = new THREE.Fog(0xc4d6e3, 260, 950);

  const hemi = new THREE.HemisphereLight(0xdfeaf2, 0x4e6b3a, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(-30, 60, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(HIGH ? 2048 : 1024, HIGH ? 2048 : 1024);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
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
    const z = Math.random() < 0.7 ? 62 + Math.random() * 100 : -(40 + Math.random() * 80);
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
  const geo = new THREE.BufferGeometry();
  geo.setIndex(t.geo.index);
  geo.setAttribute('position', t.geo.attributes.position);
  geo.setAttribute('normal', t.geo.attributes.normal);
  geo.morphAttributes = t.geo.morphAttributes;
  geo.morphTargetsRelative = true;
  geo.setAttribute('color', coatColors(t.geo, r.coat, (r.num | 0) * 1.7, t.box, t.meanLum));
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.0, sheen: 0.35, sheenRoughness: 0.45, sheenColor: 0xbfa58a, clearcoat: 0.12, clearcoatRoughness: 0.55 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = t.name;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.morphTargetInfluences = t.geo.morphAttributes.position.map(() => 0);
  mesh.updateMorphTargets();
  const holder = new THREE.Group();
  mesh.scale.set(HORSE_SCALE * 1.18, HORSE_SCALE, HORSE_SCALE);
  mesh.rotation.y = t.headPlusZ ? -Math.PI / 2 : Math.PI / 2;
  mesh.position.y = -t.box.min.y * HORSE_SCALE;
  holder.add(mesh);
  const jockey = makeJockey(r.silk, r.cap, r.num);
  const h = (t.box.max.y - t.box.min.y) * HORSE_SCALE;
  jockey.position.set(0.12, h * 0.58, 0);
  holder.add(jockey);
  const mixer = new THREE.AnimationMixer(mesh);
  const action = mixer.clipAction(t.clip);
  action.play();
  action.time = Math.random() * t.clip.duration;
  return { holder, mixer, action, jockey, jy: h * 0.58, x: r.pos, z: (r.lane - 2.5) * LANE_W, speed: 0 };
}

function skyDome() {
  const geo = new THREE.SphereGeometry(950, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x5f97c9) }, mid: { value: new THREE.Color(0xa9c8de) }, bottom: { value: new THREE.Color(0xdde8ee) }, sun: { value: new THREE.Vector3(-0.45, 0.55, 0.7).normalize() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sun; varying vec3 vDir;' +
      'void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(bottom, mid, smoothstep(0.0, 0.12, h)); c = mix(c, top, smoothstep(0.12, 0.7, h));' +
      'float s = max(dot(normalize(vDir), sun), 0.0); c += vec3(1.0, 0.92, 0.78) * pow(s, 64.0) * 0.6 + vec3(1.0, 0.95, 0.85) * pow(s, 6.0) * 0.12; gl_FragColor = vec4(c, 1.0); }'
  });
  return new THREE.Mesh(geo, mat);
}

function makeDust(scene) {
  const N = 900;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  const p = { pts, pos, col, vel: new Float32Array(N * 3), life: new Float32Array(N), next: 0, N };
  for (let i = 0; i < N; i++) pos[i * 3 + 1] = -10;
  return p;
}
function emitDust(d, x, z, vx) {
  const i = d.next; d.next = (d.next + 1) % d.N;
  d.pos[i * 3] = x - 0.2 - Math.random() * 0.8; d.pos[i * 3 + 1] = 0.05; d.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
  d.vel[i * 3] = vx * (0.15 + Math.random() * 0.3) - 2 - Math.random() * 3; d.vel[i * 3 + 1] = 1.5 + Math.random() * 2.5; d.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
  d.life[i] = 0.5 + Math.random() * 0.5;
  const g = Math.random() < 0.6;
  d.col[i * 3] = g ? 0.27 : 0.42; d.col[i * 3 + 1] = g ? 0.42 : 0.33; d.col[i * 3 + 2] = g ? 0.2 : 0.22;
}
function stepDust(d, dt) {
  for (let i = 0; i < d.N; i++) {
    if (d.life[i] <= 0) continue;
    d.life[i] -= dt;
    d.vel[i * 3 + 1] -= 9.8 * dt;
    d.pos[i * 3] += d.vel[i * 3] * dt; d.pos[i * 3 + 1] += d.vel[i * 3 + 1] * dt; d.pos[i * 3 + 2] += d.vel[i * 3 + 2] * dt;
    if (d.pos[i * 3 + 1] < 0.02 || d.life[i] <= 0) { d.life[i] = 0; d.pos[i * 3 + 1] = -10; }
  }
  d.pts.geometry.attributes.position.needsUpdate = true;
  d.pts.geometry.attributes.color.needsUpdate = true;
}

// Regia televisiva: sceglie le inquadrature come in una diretta
const SHOTS = ['side', 'head', 'side', 'rail', 'aerial', 'side', 'head'];
function directorShot(st, race, fx, now) {
  const left = race.dist - fx;
  if (race.count > 0) return 'gate';
  const done = race.racers.some((r) => r.finished);
  if (done) return st.shot === 'finish' && now - st.shotAt < 4000 ? 'finish' : 'side';
  if (left < 70) return 'finish';
  if (left < 260) return 'head';
  if (!st.shot || st.shot === 'gate') { st.seq = 0; return 'aerial'; }
  if (now - st.shotAt > st.shotLen) { st.seq = (st.seq + 1) % SHOTS.length; return SHOTS[st.seq]; }
  return st.shot;
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
  renderer.setPixelRatio(Math.min(HIGH ? 2 : 1.25, window.devicePixelRatio || 1));
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.innerHTML = '';
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 2000);
  camera.position.set(-10, 4, 20);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  let bokeh = null;
  if (HIGH) {
    bokeh = new BokehPass(scene, camera, { focus: 40, aperture: 0.0006, maxblur: 0.006 });
    composer.addPass(bokeh);
  }
  const vig = new ShaderPass(VignetteShader);
  vig.uniforms.offset.value = 0.95; vig.uniforms.darkness.value = 1.05;
  composer.addPass(vig);
  composer.addPass(new OutputPass());
  const st = { renderer, composer, bokeh, scene, camera, container, getRace, horses: null, items: null, world: null, dust: null, raf: 0, last: performance.now(), mode: lastMode, camPos: new THREE.Vector3(-2, 4.5, 20), look: new THREE.Vector3(3, 1.1, 0), shot: null, shotAt: 0, shotLen: 7000, seq: 0, fov: 42, fx: 0 };
  state = st;
  loadHorse().then(() => {
    if (state !== st) return;
    const race = getRace();
    if (!race) return;
    st.world = buildWorld(scene, race);
    st.dust = makeDust(scene);
    st.horses = race.racers.map((r) => { const h = makeHorse(r); scene.add(h.holder); return h; });
    const hasPlayer = race.racers[0] && race.racers[0].isPlayer;
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 4), new THREE.MeshStandardMaterial({ color: 0xd4af37, emissive: 0x6b5410, metalness: 0.4, roughness: 0.3 }));
    marker.rotation.x = Math.PI;
    marker.position.set(0.3, 2.35, 0);
    if (hasPlayer) { st.horses[0].holder.add(marker); st.marker = marker; }
    st.items = race.items.map((it) => {
      const m = itemMesh(it.kind);
      m.position.set(it.m, 1.1, (it.lane - 2.5) * LANE_W);
      scene.add(m);
      return m;
    });
  }).catch((e) => { console.error(e); container.innerHTML = '<div style="padding:40px;color:#F3EEDF">Non riesco a caricare il modello del cavallo.</div>'; });

  const tgt = new THREE.Vector3(), lk = new THREE.Vector3();
  const loop = (now) => {
    if (state !== st) return;
    const dt = Math.min(0.05, (now - st.last) / 1000);
    st.last = now;
    const race = getRace();
    if (race && st.horses) {
      const racing = race.count <= 0;
      const rate = race.rate || 2;
      const since = race.tickAt ? Math.min(0.06, Math.max(0, (now - race.tickAt) / 1000)) : 0;
      race.racers.forEach((r, i) => {
        const h = st.horses[i];
        const pred = racing ? r.pos + r.speed * rate * since : r.pos;
        h.x += (pred - h.x) * Math.min(1, dt * 18);
        h.z += ((r.lane - 2.5) * LANE_W - h.z) * Math.min(1, dt * 3);
        h.holder.position.set(h.x, 0, h.z);
        h.holder.rotation.y = -(((r.lane - 2.5) * LANE_W - h.z) * 0.05);
        const moving = racing && r.speed > 1;
        h.action.paused = !moving;
        h.mixer.update(moving ? dt * (0.5 + r.speed / 18) * 1.3 : 0);
        const ph = h.action.time / template.clip.duration;
        h.jockey.position.y = h.jy + (moving ? Math.sin(ph * Math.PI * 4) * 0.045 : 0);
        h.jockey.rotation.z = moving ? Math.sin(ph * Math.PI * 4 + 0.6) * 0.04 : 0;
        if (moving && st.dust && Math.random() < 0.9) { emitDust(st.dust, h.x, h.z, r.speed * rate); if (HIGH) emitDust(st.dust, h.x, h.z, r.speed * rate); }
      });
      if (st.dust) stepDust(st.dust, dt);
      race.items.forEach((it, i) => {
        const m = st.items[i];
        m.visible = !it.taken;
        if (m.visible) { m.rotation.y += dt * 2; m.position.y = 1.1 + Math.sin(now / 300 + i) * 0.12; }
      });
      if (st.marker) { st.marker.rotation.y += dt * 2; st.marker.position.y = 2.35 + Math.sin(now / 250) * 0.1; }
      let fi = 0;
      race.racers.forEach((r, i) => { if (r.pos > race.racers[fi].pos) fi = i; });
      const leader = st.horses[fi];
      const me = (race.racers[0] && race.racers[0].isPlayer) ? st.horses[0] : leader;
      let fov = 42, follow = me;
      if (st.mode === 'tv') {
        const shot = directorShot(st, race, me.x, now);
        if (shot !== st.shot) { st.shot = shot; st.shotAt = now; st.shotLen = 6000 + Math.random() * 3000; st.cut = true; }
        const fxT = me === leader ? leader.x : (leader.x - me.x < 25 ? (leader.x + me.x) / 2 : me.x);
        st.anchor = st.anchor == null || st.cut || Math.abs(fxT - st.anchor) < 4 ? fxT : st.anchor + (fxT - st.anchor) * Math.min(1, dt * 6);
        const fx = st.anchor;
        const fixed = shot === 'gate' || shot === 'finish';
        const mz = me.z;
        const sh = now / 1000;
        const shake = 0.05;
        if (shot === 'gate') { tgt.set(-14, 4.5, 16); lk.set(2, 1.2, 0); fov = 32; }
        else if (shot === 'aerial') { tgt.set(fx - 22, 26, 34); lk.set(fx + 6, 0.5, 0); fov = 34; }
        else if (shot === 'side') { tgt.set(fx - 3, 6, 46); lk.set(fx + 1.5, 1.2, mz * 0.4); fov = 15; }
        else if (shot === 'rail') { tgt.set(fx - 5, 1.5, 8.2); lk.set(fx + 6, 1.2, mz * 0.5); fov = 38; }
        else if (shot === 'head') { tgt.set(fx + 75, 4.2, mz * 0.2 + 1); lk.set(fx, 1.3, mz * 0.5); fov = 8.5; }
        else if (shot === 'finish') { tgt.set(race.dist + 2, 7, 40); lk.set(Math.min(race.dist, fx + 2), 1.3, 0); fov = 16; }
        tgt.x += Math.sin(sh * 1.3) * shake * 4; tgt.y += Math.sin(sh * 1.7) * shake * 2;
        // le inquadrature che seguono la corsa restano agganciate al gruppo, senza ritardo
        if (!fixed) { tgt.x -= fx; lk.x -= fx; }
        if (st.cut || st.rel === undefined || st.rel !== !fixed) { st.camPos.copy(tgt); st.look.copy(lk); if (st.cut) st.fov = fov; st.cut = false; st.rel = !fixed; }
        st.camPos.lerp(tgt, Math.min(1, dt * 5));
        st.look.lerp(lk, Math.min(1, dt * 6));
        camera.position.copy(st.camPos); if (!fixed) camera.position.x += fx;
        st.fov += (fov - st.fov) * Math.min(1, dt * 4);
        camera.lookAt(fixed ? st.look.x : st.look.x + fx, st.look.y, st.look.z);
        follow = null;
      } else {
        st.shot = null; st.rel = undefined; st.anchor = null;
        if (st.mode === 'dietro') { tgt.set(-8, 3.2, me.z * 0.8); lk.set(8, 1.3, me.z * 0.7); fov = 42; }
        else if (st.mode === 'fronte') { tgt.set(12, 2.1, me.z * 0.5); lk.set(-4, 1.5, me.z * 0.7); fov = 42; }
        else { tgt.set(-2, 4.5, 20); lk.set(3, 1.1, 0); fov = 42; }
        st.camPos.lerp(tgt, Math.min(1, dt * 3));
        st.look.lerp(lk, Math.min(1, dt * 4));
        camera.position.set(me.x + st.camPos.x, st.camPos.y, st.camPos.z);
        camera.lookAt(me.x + st.look.x, st.look.y, st.look.z);
        st.fov += (fov - st.fov) * Math.min(1, dt * 4);
      }
      camera.fov = st.fov; camera.updateProjectionMatrix();
      st.fx = me.x; st.fz = me.z;
      if (st.bokeh) {
        const d = camera.position.distanceTo(new THREE.Vector3(me.x, 1.3, me.z));
        st.bokeh.uniforms.focus.value = d;
        st.bokeh.uniforms.aperture.value = (st.mode === 'tv' && (st.shot === 'head' || st.shot === 'side' || st.shot === 'finish')) ? 0.00025 : 0.0001;
      }
      if (st.world) {
        st.world.sun.position.set(me.x - 30, 60, 40);
        st.world.sun.target.position.set(me.x, 0, 0);
      }
    }
    st.composer.render();
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
  if (st.composer) st.composer.dispose();
  st.renderer.dispose();
  st.renderer.forceContextLoss();
  if (st.renderer.domElement.parentNode) st.renderer.domElement.remove();
  state = null;
  lastMode = st.mode || lastMode;
}

let lastMode = 'tv';
const MODES = ['tv', 'dietro', 'lato', 'fronte'];
const LABELS = { tv: 'Regia TV', dietro: 'Da dietro', lato: 'Laterale', fronte: 'Frontale' };
function cycleCamera() {
  const cur = state && state.mode ? state.mode : lastMode;
  const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
  lastMode = next;
  if (state) state.mode = next;
  return LABELS[next];
}
function cameraMode() { return state && state.mode ? state.mode : lastMode; }
// +1 se la freccia destra deve aumentare la corsia, con qualsiasi inquadratura
function laneSign() {
  if (!state) return 1;
  const cam = state.camera;
  const right = new THREE.Vector3();
  cam.getWorldDirection(right);
  right.cross(cam.up).normalize();
  if (Math.abs(right.z) >= 0.3) return right.z > 0 ? 1 : -1;
  return cam.position.z > (state.fz || 0) ? 1 : -1;
}
function shotName() { return state && state.mode === 'tv' ? state.shot : null; }
function cameraLabel() { return LABELS[state && state.mode ? state.mode : lastMode]; }
const _start = start;
window.Race3D = {
  start: (c, g) => { _start(c, g); if (state) state.mode = lastMode; },
  stop, cycleCamera, cameraLabel, cameraMode, laneSign, shotName, preload: loadHorse
};
loadHorse().catch(() => {});
