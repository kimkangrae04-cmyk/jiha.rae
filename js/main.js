// 우리의 추억 박물관 — 2인 3D 웹 게임
// Three.js(렌더링) + PeerJS(방 코드로 둘이 연결)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/* =========================================================
   설정
   ========================================================= */
const PEER_PREFIX = 'jiharae-museum-v1-';          // 방 코드 앞에 붙는 고유 접두사
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 글자(0,O,1,I,L) 제외
const HALL_W = 14;            // 전시관 폭
const WALL_H = 5;             // 벽 높이
const FRAME_SPACING = 5;      // 액자 간격
const MOVE_SPEED = 3.2;       // 걷는 속도 (m/s)
const VIEW_DIST = 2.6;        // 액자 앞 이 거리 안에 들어오면 안내 표시
const SEND_INTERVAL = 66;     // 위치 전송 간격(ms) ≈ 15회/초

const $ = (id) => document.getElementById(id);

/* =========================================================
   저장 / 로비
   ========================================================= */
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
};

let myName = store.get('museum-name', '');
let myChar = store.get('museum-char', 'wajiha');
$('name-input').value = myName;

document.querySelectorAll('.char-card').forEach((card) => {
  card.classList.toggle('on', card.dataset.char === myChar);
  card.onclick = () => {
    myChar = card.dataset.char;
    document.querySelectorAll('.char-card').forEach((el) => el.classList.toggle('on', el === card));
  };
});

const params = new URLSearchParams(location.search);
if (params.get('room')) {
  $('code-input').value = params.get('room').toUpperCase().slice(0, 5);
  $('lobby-msg').style.color = '#6b3a4a';
  $('lobby-msg').textContent = '초대받은 방이에요. 이름을 적고 “참가”를 눌러주세요!';
}

function lobbyMsg(text, ok = false) {
  $('lobby-msg').style.color = ok ? '#6b3a4a' : '#c0395a';
  $('lobby-msg').textContent = text;
}

function readName() {
  const n = $('name-input').value.trim();
  if (!n) { lobbyMsg('이름을 먼저 적어주세요.'); $('name-input').focus(); return null; }
  myName = n;
  store.set('museum-name', n);
  store.set('museum-char', myChar);
  return n;
}

function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/* =========================================================
   전시 데이터 (photos/photos.json)
   ========================================================= */
let gallery = { title: '우리의 추억 박물관', photos: [] };

const galleryReady = fetch('photos/photos.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    if (data) gallery = { title: data.title || gallery.title, photos: data.photos || [] };
  })
  .catch(() => { /* 파일이 없으면 기본값 */ })
  .finally(() => {
    document.title = gallery.title;
    $('lobby-title').textContent = gallery.title;
  });

/* =========================================================
   Three.js 기본 세팅
   ========================================================= */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a1d22');

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------- 캔버스 텍스처 도우미 ---------- */
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function woodFloorTexture() {
  const t = canvasTexture(512, 512, (g, w, h) => {
    const plankH = 64;
    for (let y = 0; y < h; y += plankH) {
      const offset = ((y / plankH) % 2) * 160;
      for (let x = -offset; x < w; x += 320) {
        const shade = 150 + Math.floor(Math.random() * 30);
        g.fillStyle = `rgb(${shade + 40},${shade - 10},${shade - 50})`;
        g.fillRect(x, y, 320, plankH);
        g.strokeStyle = 'rgba(60,30,15,0.35)';
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, 318, plankH - 2);
        for (let k = 0; k < 6; k++) {
          g.strokeStyle = 'rgba(90,50,25,0.12)';
          g.beginPath();
          const yy = y + 8 + Math.random() * (plankH - 16);
          g.moveTo(x, yy);
          g.bezierCurveTo(x + 100, yy + 4, x + 200, yy - 4, x + 320, yy);
          g.stroke();
        }
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function placeholderImage(title, index) {
  // 사진 파일이 없을 때 대신 보여줄 그림
  const hues = [345, 20, 200, 150, 270, 40];
  const hue = hues[index % hues.length];
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 800, 600);
  grad.addColorStop(0, `hsl(${hue},70%,85%)`);
  grad.addColorStop(1, `hsl(${hue + 30},60%,70%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 800, 600);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = '120px sans-serif';
  g.textAlign = 'center';
  g.fillText('♥', 400, 270);
  g.fillStyle = '#5b3442';
  g.font = 'bold 48px sans-serif';
  g.fillText(title || '추억', 400, 380);
  g.font = '28px sans-serif';
  g.fillText('photos 폴더에 사진을 넣어주세요', 400, 440);
  return c;
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* =========================================================
   박물관 만들기
   ========================================================= */
const frames = [];       // { mesh, spot: Vector3, data, src }
const obstacles = [];    // 벤치 등 충돌 상자 { minX, maxX, minZ, maxZ }
let HALL_L = 30;

async function buildMuseum() {
  const photos = gallery.photos;
  const perSide = Math.max(1, Math.ceil(photos.length / 2));
  HALL_L = Math.max(26, perSide * FRAME_SPACING + 14);
  const halfW = HALL_W / 2;
  const halfL = HALL_L / 2;

  // 조명
  scene.add(new THREE.HemisphereLight(0xfff4ea, 0x6e5048, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(2, 10, 4);
  scene.add(sun);
  const lampCount = Math.min(6, Math.ceil(HALL_L / 10));
  for (let i = 0; i < lampCount; i++) {
    const z = halfL - (HALL_L / lampCount) * (i + 0.5);
    const p = new THREE.PointLight(0xffe2c0, 18, 16, 2);
    p.position.set(0, WALL_H - 0.6, z);
    scene.add(p);
    // 천장 조명 모양
    const lampMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.08, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff3dc })
    );
    lampMesh.position.set(0, WALL_H - 0.04, z);
    scene.add(lampMesh);
  }

  // 바닥
  const floorTex = woodFloorTexture();
  floorTex.repeat.set(HALL_W / 4, HALL_L / 4);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL_W, HALL_L),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.75 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // 가운데 카펫
  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, HALL_L - 3),
    new THREE.MeshStandardMaterial({ color: 0x9c3a52, roughness: 1 })
  );
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.y = 0.01;
  scene.add(carpet);

  // 천장
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL_W, HALL_L),
    new THREE.MeshStandardMaterial({ color: 0xf7f1ea })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = WALL_H;
  scene.add(ceiling);

  // 벽 (4면) + 아래쪽 징두리
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf2e6dc, roughness: 0.95 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x7a4a3c, roughness: 0.7 });
  const walls = [
    { w: HALL_L, pos: [-halfW, WALL_H / 2, 0], ry: Math.PI / 2 },
    { w: HALL_L, pos: [halfW, WALL_H / 2, 0], ry: -Math.PI / 2 },
    { w: HALL_W, pos: [0, WALL_H / 2, -halfL], ry: 0 },
    { w: HALL_W, pos: [0, WALL_H / 2, halfL], ry: Math.PI },
  ];
  for (const wDef of walls) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(wDef.w, WALL_H), wallMat);
    wall.position.set(...wDef.pos);
    wall.rotation.y = wDef.ry;
    scene.add(wall);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(wDef.w, 0.9, 0.06), trimMat);
    trim.position.set(wDef.pos[0], 0.45, wDef.pos[2]);
    trim.rotation.y = wDef.ry;
    scene.add(trim);
  }

  // 안쪽 벽: 제목 간판
  const signTex = canvasTexture(1024, 384, (g, w, h) => {
    g.fillStyle = '#fffaf3';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#b8935a';
    g.lineWidth = 14;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#e05a7a';
    g.font = '96px sans-serif';
    g.textAlign = 'center';
    g.fillText('♥', w / 2, 140);
    g.fillStyle = '#4a2a35';
    g.font = 'bold 72px sans-serif';
    g.fillText(gallery.title, w / 2, 260, w - 80);
    g.font = '34px sans-serif';
    g.fillStyle = '#8a6a74';
    g.fillText(`전시 작품 ${photos.length}점`, w / 2, 320);
  });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 2.25),
    new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false })
  );
  sign.position.set(0, 2.6, -halfL + 0.05);
  scene.add(sign);

  // 벤치 (가운데, 일정 간격)
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x5c3b2e, roughness: 0.6 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.5, roughness: 0.4 });
  for (let z = halfL - 10; z > -halfL + 6; z -= 10) {
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 2.2), benchMat);
    seat.position.y = 0.48;
    bench.add(seat);
    for (const dz of [-0.9, 0.9]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.08), legMat);
      leg.position.set(0, 0.22, dz);
      bench.add(leg);
    }
    bench.position.set(0, 0, z);
    scene.add(bench);
    obstacles.push({ minX: -0.45, maxX: 0.45, minZ: z - 1.15, maxZ: z + 1.15 });
  }

  // 액자들
  const glowTex = canvasTexture(256, 256, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,225,180,0.55)');
    r.addColorStop(1, 'rgba(255,225,180,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
  const images = await Promise.all(photos.map((p) => loadImage(p.file)));
  photos.forEach((p, i) => {
    const side = i % 2 === 0 ? -1 : 1; // 왼쪽 벽, 오른쪽 벽 번갈아
    const slot = Math.floor(i / 2);
    const z = halfL - 8 - slot * FRAME_SPACING;
    const source = images[i] || placeholderImage(p.title, i);
    addFrame(p, source, side, z, glowTex, images[i] ? p.file : null);
  });
}

function addFrame(data, source, side, z, glowTex, src) {
  const tex = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;

  const iw = source.naturalWidth || source.width;
  const ih = source.naturalHeight || source.height;
  const aspect = iw / ih;
  const maxW = 2.6, maxH = 2.0;
  let pw, ph;
  if (aspect > maxW / maxH) { pw = maxW; ph = maxW / aspect; } else { ph = maxH; pw = maxH * aspect; }

  const group = new THREE.Group();
  const halfW = HALL_W / 2;
  group.position.set(side * (halfW - 0.02), 2.2, z);
  group.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;

  // 벽에 비치는 은은한 빛
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(pw + 2.4, ph + 2.6),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  glow.position.set(0, 0.2, 0.005);
  group.add(glow);

  // 매트(흰 여백)
  const mat = new THREE.Mesh(
    new THREE.BoxGeometry(pw + 0.36, ph + 0.36, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xfbf8f2, roughness: 0.9 })
  );
  mat.position.z = 0.04;
  group.add(mat);

  // 사진
  const photo = new THREE.Mesh(
    new THREE.PlaneGeometry(pw, ph),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
  );
  photo.position.z = 0.065;
  group.add(photo);

  // 금색 테두리
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.6, roughness: 0.35 });
  const t = 0.12, d = 0.12;
  const W = pw + 0.36 + t * 2, H = ph + 0.36 + t * 2;
  const bars = [
    [W, t, 0, H / 2 - t / 2], [W, t, 0, -H / 2 + t / 2],
    [t, H, -W / 2 + t / 2, 0], [t, H, W / 2 - t / 2, 0],
  ];
  for (const [bw, bh, bx, by] of bars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), frameMat);
    bar.position.set(bx, by, d / 2);
    group.add(bar);
  }

  // 작품 설명 명판
  const plaqueTex = canvasTexture(512, 160, (g, w, h) => {
    g.fillStyle = '#fffdf8';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d8c7b0';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = '#3b2a30';
    g.textAlign = 'center';
    g.font = 'bold 46px sans-serif';
    g.fillText(data.title || '제목 없음', w / 2, 70, w - 40);
    g.fillStyle = '#9a7c86';
    g.font = '32px sans-serif';
    g.fillText(data.date || '', w / 2, 122, w - 40);
  });
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.34),
    new THREE.MeshBasicMaterial({ map: plaqueTex, toneMapped: false })
  );
  plaque.position.set(0, -H / 2 - 0.35, 0.03);
  group.add(plaque);

  scene.add(group);

  // 감상 위치: 액자 정면, 벽에서 1.6m 떨어진 바닥
  const spot = new THREE.Vector3(side * (halfW - 1.6), 0, z);
  const index = frames.length;
  photo.userData.frameIndex = index;
  frames.push({ mesh: photo, spot, data, src: src || source.toDataURL?.() || '' });
}

/* =========================================================
   캐릭터
   ========================================================= */
function labelSprite(text) {
  const tex = canvasTexture(256, 72, (g, w, h) => {
    g.font = 'bold 34px sans-serif';
    const tw = Math.min(w - 8, g.measureText(text).width + 32);
    g.fillStyle = 'rgba(30,18,24,0.7)';
    const x = (w - tw) / 2;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, 10, tw, 52, 26); else g.rect(x, 10, tw, 52);
    g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, 37, w - 40);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, toneMapped: false }));
  s.scale.set(1.2, 0.34, 1);
  s.renderOrder = 10;
  return s;
}

const heartTex = canvasTexture(128, 128, (g, w, h) => {
  g.fillStyle = '#ff4f7b';
  g.font = '110px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('♥', w / 2, h / 2 + 6);
});

/* ---------- 캐릭터 모델 (models/*.glb) ---------- */
const CHARACTERS = {
  wajiha: { label: 'Wajiha', file: 'models/wajiha.glb', height: 1.2, tint: null, fallbackColor: '#e05a7a' },
  // rae.glb가 아직 없으면 wajiha 모델을 조금 크고 푸르스름하게 바꿔서 임시로 씁니다.
  rae: {
    label: 'Rae', file: 'models/rae.glb', fallbackFile: 'models/wajiha.glb', height: 1.3, tint: 0xa9bccf, fallbackColor: '#5a8de0',
    // 리깅된 모델용 동작 숫자 (라디안 / 모델 키=1 기준 길이)
    rig: {
      prone: 1.25,     // 앞으로 엎드리는 각도
      spineUp: 0.25,   // 가슴 들기
      neckUp: 0.45,    // 목 들기
      headUp: 0.6,     // 고개 들어 앞 보기
      armDown: 0.5,    // 앞지느러미 바닥 짚기
      armOut: 0.35,    // 앞지느러미 옆으로 벌리기
      // 뒷지느러미를 뒤로 나란히 뻗기 (Tripo 뼈대가 좌우 비대칭이라 따로 맞춤)
      legLx: 1.4, legLy: -0.5, legRx: 1.35,
      speed: 1.0,      // 걷기 속도 배율
      hump: 0.32,      // 등이 물결치는 크기
      bounce: 0.07,    // 통 튀어 오르는 높이
      armSwing: 0.6,   // 앞지느러미 젓기
      tailKick: 0.45,  // 뒷지느러미 들썩임
      roll: 0.12,      // 좌우 출렁
      headBob: 0.18,   // 고개 까딱
      breathe: 0.03,   // 숨쉬기
      idleTilt: 0.18,  // 쉴 때 고개 갸웃
    },
  },
};
const modelCache = {};
window.__museum = {
  CHARACTERS,
  get me() { return me; },
  get partner() { return partner; },
  rebuild() { for (const c of [me, partner]) if (c) { c.buildBody(); c.placeLabel(); } },
}; // 동작 숫자 실시간 조정용
const gltfLoader = new GLTFLoader();

function loadGLB(url) {
  return new Promise((resolve) => gltfLoader.load(url, (g) => resolve(g.scene), undefined, () => resolve(null)));
}

// 2000년대 게임 느낌: 텍스처를 256px로 줄이고 밉맵 없이 사용
function retroTexture(tex) {
  const img = tex && tex.image;
  if (!img || !img.width) return tex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(img, 0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = tex.flipY;
  t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

async function preloadCharacters() {
  for (const [id, def] of Object.entries(CHARACTERS)) {
    let model = await loadGLB(def.file);
    let tint = null;
    if (!model && def.fallbackFile) { model = await loadGLB(def.fallbackFile); tint = def.tint; }
    if (!model) continue;
    model.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material.clone();
      if (m.map) m.map = retroTexture(m.map);
      if (tint) m.color.setHex(tint);
      m.side = THREE.FrontSide;
      o.material = m;
    });
    // 걷기 변형에 쓸 원본 크기(모델 자체 좌표)
    const raw = new THREE.Box3();
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      raw.union(o.geometry.boundingBox);
    });
    // 크기 맞추기: 발이 y=0, 키가 def.height가 되도록
    const box = new THREE.Box3().setFromObject(model);
    const s = def.height / (box.max.y - box.min.y);
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;
    const wrap = new THREE.Group();
    wrap.add(model);
    let skinned = false;
    model.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
    wrap.userData.skinned = skinned;
    wrap.userData.scale = s;
    wrap.userData.raw = {
      minY: raw.min.y,
      h: raw.max.y - raw.min.y,
      hw: Math.max(Math.abs(raw.min.x), Math.abs(raw.max.x)),
    };
    modelCache[id] = wrap;
  }
}

/* ---------- 걷기 애니메이션 (리깅 없이 버텍스 셰이더로 부위별 변형) ----------
   모델 좌표 기준: y=높이, x=좌우(+x가 오른쪽), +z가 앞
   - 아래쪽(꼬리지느러미): 좌우 번갈아 들어 올려 내딛기
   - 옆으로 튀어나온 중간 높이(앞지느러미): 어깨를 축으로 앞뒤 스윙 + 퍼덕임
   - 몸통: 위로 갈수록 좌우로 휘청, 머리는 반대로 버팀, 앞으로 살짝 숙임
   - 발 디딜 때 살짝 눌렸다 펴짐 */
const WALK_VERTEX = `
{
  float h = clamp((transformed.y - uMinY) / uH, 0.0, 1.0);
  float ws = sin(uPhase);
  float wc = cos(uPhase);
  float side = transformed.x >= 0.0 ? 1.0 : -1.0;
  float ax = abs(transformed.x) / uHW;

  // 꼬리지느러미 번갈아 들기
  float footW = 1.0 - smoothstep(0.0, 0.18, h);
  float lift = max(0.0, ws * side);
  transformed.y += footW * lift * 0.07 * uH * uAmt;
  transformed.z += footW * ws * side * 0.06 * uH * uAmt;

  // 앞지느러미 스윙/퍼덕임
  float flipW = smoothstep(0.5, 0.78, ax) * smoothstep(0.22, 0.38, h) * (1.0 - smoothstep(0.72, 0.86, h));
  vec2 pivot = vec2(side * 0.48 * uHW, uMinY + 0.64 * uH);
  float flap = (0.12 + 0.18 * abs(ws)) * uAmt + (0.04 + 0.06 * max(0.0, sin(uIdle * 1.9))) * (1.0 - uAmt);
  float a = flap * side * flipW;
  vec2 p = transformed.xy - pivot;
  p = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
  transformed.xy = pivot + p;
  float b = (-ws * side * 0.55 * uAmt + sin(uIdle * 1.3 + side) * 0.06 * (1.0 - uAmt)) * flipW;
  float dy = transformed.y - pivot.y;
  float dz = transformed.z;
  transformed.y = pivot.y + dy * cos(b) + dz * sin(b);
  transformed.z = dz * cos(b) - dy * sin(b);

  // 몸통 휘청 + 머리는 덜 흔들리게 + 앞으로 숙이기
  float bend = h * h * (1.0 - 0.55 * smoothstep(0.72, 1.0, h));
  transformed.x += ws * 0.09 * uH * bend * uAmt;
  transformed.z += 0.07 * uH * h * h * uAmt;

  // 발 디딜 때 눌림
  float squash = 1.0 - 0.06 * abs(wc) * uAmt;
  transformed.y = uMinY + (transformed.y - uMinY) * squash;
  transformed.xz *= 1.0 + (1.0 - squash) * 0.5;
}
`;

/* ---------- 뼈 애니메이션 (Tripo 리깅 모델) ----------
   Tripo의 사람형 뼈대를 물범처럼 씁니다.
   - 척추(Waist·Spine01·Spine02): 애벌레처럼 물결
   - 팔(Clavicle·Upperarm): 앞지느러미, 다리(Thigh): 뒷지느러미
   각 뼈를 '모델 기준 축'(x=좌우축, y=위, z=앞)으로 돌려서 뼈마다 다른 로컬 축을 신경 쓰지 않게 했습니다. */
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

class SealRig {
  constructor(root, params) {
    this.p = params;
    this.q = new THREE.Quaternion();
    this.bones = {};
    this.meshes = [];
    root.updateMatrixWorld(true);
    const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    root.traverse((o) => {
      if (o.isSkinnedMesh) this.meshes.push(o);
      if (!o.isBone) return;
      const inv = o.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv).invert();
      this.bones[o.name] = {
        bone: o,
        rest: o.quaternion.clone(),
        restPos: o.position.clone(),
        axes: { x: AXES.x.clone().applyQuaternion(inv), y: AXES.y.clone().applyQuaternion(inv), z: AXES.z.clone().applyQuaternion(inv) },
      };
    });
    this.root = this.bones.BoneRoot;
    this.ground = new THREE.Vector3();
    this.settle(root);
  }

  rot(name, axis, angle) {
    const b = this.bones[name];
    if (!b || !angle) return;
    b.bone.quaternion.multiply(this.q.setFromAxisAngle(b.axes[axis], angle));
  }

  // 기본 자세를 잡고, 발(배)이 바닥에 닿고 몸 가운데가 원점에 오도록 위치 보정
  settle(root) {
    this.ground.set(0, 0, 0);
    this.pose(0, 0, 0);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const m of this.meshes) { m.computeBoundingBox(); box.union(m.boundingBox); }
    if (!box.isEmpty()) {
      this.ground.set(0, -box.min.y, -(box.min.z + box.max.z) / 2);
      this.restHeight = box.max.y - box.min.y;
    }
    this.pose(0, 0, 0);
  }

  pose(amt, phase, idle) {
    const P = this.p;
    for (const k in this.bones) {
      const b = this.bones[k];
      b.bone.quaternion.copy(b.rest);
      b.bone.position.copy(b.restPos);
    }
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const still = 1 - amt;

    // ---- 기본 자세: 배를 바닥에 대고 엎드려 고개 들기 ----
    this.rot('Hip', 'x', P.prone);
    this.rot('Spine01', 'x', -P.spineUp * 0.5);
    this.rot('Spine02', 'x', -P.spineUp * 0.5);
    this.rot('NeckTwist01', 'x', -P.neckUp);
    this.rot('Head', 'x', -P.headUp);
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
      this.rot(side + '_Clavicle', 'x', P.armDown * 0.4);
      this.rot(side + '_Upperarm', 'x', P.armDown);
      this.rot(side + '_Upperarm', 'z', sign * P.armOut);
    }
    this.rot('L_Thigh', 'x', P.legLx || 0);
    this.rot('L_Thigh', 'y', P.legLy || 0);
    this.rot('R_Thigh', 'x', P.legRx || 0);

    // ---- 걷기: 갤럼핑 (가슴 튀어오름 → 등 물결 → 뒷지느러미 들썩) ----
    const hop = Math.max(0, s);                 // 가슴이 들리는 순간
    const wave = Math.sin(phase - 1.1);         // 등 물결 (가슴보다 늦게)
    this.rot('Hip', 'x', -hop * P.hump * 0.5 * amt);
    this.rot('Waist', 'x', -wave * P.hump * amt);
    this.rot('Spine01', 'x', wave * P.hump * 0.6 * amt);
    this.rot('Spine02', 'x', hop * P.hump * 0.5 * amt);
    this.rot('NeckTwist01', 'x', -hop * P.headBob * amt);
    this.rot('Head', 'x', hop * P.headBob * 0.6 * amt);
    this.rot('Hip', 'y', s * P.roll * amt);
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
      this.rot(side + '_Upperarm', 'x', -c * P.armSwing * amt);           // 둘이 같이 바닥 밀기
      this.rot(side + '_Upperarm', 'z', sign * hop * P.armSwing * 0.3 * amt);
      this.rot(side + '_Thigh', 'x', -Math.max(0, -s) * P.tailKick * amt); // 뒷지느러미 들썩
      this.rot(side + '_Calf', 'x', -Math.max(0, -s) * P.tailKick * 0.6 * amt);
    }

    // ---- 쉬기: 숨쉬기, 고개 갸웃, 가끔 꼬리 꼼지락 ----
    const br = Math.sin(idle * 2.0);
    this.rot('Spine02', 'x', br * P.breathe * still);
    this.rot('NeckTwist01', 'x', -br * P.breathe * 0.5 * still);
    this.rot('Head', 'z', Math.sin(idle * 0.7) * P.idleTilt * still);
    this.rot('Head', 'x', Math.max(0, Math.sin(idle * 0.45)) * 0.12 * still);
    const wig = Math.max(0, Math.sin(idle * 0.9) - 0.6) * 2.5;
    for (const side of ['L', 'R']) {
      this.rot(side + '_Thigh', 'x', -Math.sin(idle * 9) * wig * 0.25 * still);
    }

    // ---- 위치: 바닥 맞춤 + 튀어오르기 ----
    if (this.root) {
      this.root.bone.position.add(this.ground);
      this.root.bone.position.y += (hop * P.bounce + Math.max(0, br) * 0.004 * still) * (amt > 0 ? 1 : 1);
    }
  }
}

function applyWalkShader(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      'uniform float uPhase;\nuniform float uAmt;\nuniform float uIdle;\nuniform float uH;\nuniform float uHW;\nuniform float uMinY;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WALK_VERTEX);
  };
  material.customProgramCacheKey = () => 'seal-walk-v1';
}

class Character {
  constructor(name, charId) {
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.charId = CHARACTERS[charId] ? charId : 'wajiha';
    this.buildBody();

    this.label = labelSprite(name);
    this.group.add(this.label);
    this.placeLabel();

    this.walkTime = 0;
    this.walkAmt = 0;
    this.idleTime = Math.random() * 10;
    this.moving = false;
    this.hearts = [];
    scene.add(this.group);
  }

  buildBody() {
    this.body.clear();
    const def = CHARACTERS[this.charId];
    if (modelCache[this.charId]) {
      const cached = modelCache[this.charId];
      const raw = cached.userData.raw;
      if (cached.userData.skinned) {
        const model = SkeletonUtils.clone(cached);
        model.traverse((o) => {
          if (!o.isMesh) return;
          o.material = o.material.clone();
          o.frustumCulled = false;
        });
        this.body.add(model);
        this.uniforms = null;
        this.rig = new SealRig(model, def.rig || {});
        this.height = this.rig.restHeight ? this.rig.restHeight * cached.userData.scale : def.height;
        return;
      }
      this.rig = null;
      const model = cached.clone();
      this.uniforms = {
        uPhase: { value: 0 }, uAmt: { value: 0 }, uIdle: { value: 0 },
        uH: { value: raw.h }, uHW: { value: raw.hw }, uMinY: { value: raw.minY },
      };
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        applyWalkShader(o.material, this.uniforms);
        o.frustumCulled = false; // 변형된 모양이 화면 가장자리에서 사라지지 않게
      });
      this.body.add(model);
      this.height = def.height;
      return;
    }
    this.uniforms = null;
    this.rig = null;
    // 모델을 못 불러오면 간단한 도형 캐릭터
    const bodyMat = new THREE.MeshStandardMaterial({ color: def.fallbackColor, roughness: 0.6 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 6, 16), bodyMat);
    torso.position.y = 0.62;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 18), new THREE.MeshStandardMaterial({ color: 0xd9d2c8 }));
    head.position.y = 1.32;
    this.body.add(torso, head);
    this.height = 1.62;
  }

  placeLabel() { this.label.position.y = this.height + 0.35; }

  setName(name) {
    this.group.remove(this.label);
    this.label = labelSprite(name);
    this.group.add(this.label);
    this.placeLabel();
  }

  setCharacter(charId) {
    if (!CHARACTERS[charId] || charId === this.charId) return;
    this.charId = charId;
    this.buildBody();
    this.placeLabel();
  }

  heart() {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthTest: false }));
    s.scale.set(0.5, 0.5, 1);
    s.position.set((Math.random() - 0.5) * 0.3, this.height + 0.6, 0);
    s.userData.y0 = this.height + 0.6;
    s.renderOrder = 11;
    this.group.add(s);
    this.hearts.push({ s, life: 0 });
  }

  update(dt) {
    // 걷기 정도(0~1)를 부드럽게 올리고 내려서 출발/멈춤이 자연스럽게
    const target = this.moving ? 1 : 0;
    this.walkAmt += (target - this.walkAmt) * Math.min(1, dt * (this.moving ? 7 : 5));
    const spd = this.rig ? (this.rig.p.speed || 1) : 1;
    if (this.walkAmt > 0.01) this.walkTime += dt * 9.5 * spd;
    this.idleTime += dt;
    const amt = this.walkAmt;
    const w = Math.sin(this.walkTime);

    if (this.rig) {
      // 리깅 모델: 뼈 애니메이션이 모든 동작을 담당
      this.rig.pose(amt, this.walkTime, this.idleTime);
      this.body.rotation.set(0, 0, 0);
      this.body.position.y = 0;
      this.body.scale.set(1, 1, 1);
    } else {
    // 몸 전체: 작은 좌우 뒤뚱 + 걸음마다 콩
    this.body.rotation.z = w * 0.07 * amt;
    this.body.position.y = Math.abs(w) * 0.035 * amt;
    this.body.rotation.x = 0;
    // 가만히 있을 때 숨쉬기
    const breath = 1 + Math.sin(this.idleTime * 2.2) * 0.015 * (1 - amt);
    this.body.scale.set(1 / Math.sqrt(breath), breath, 1 / Math.sqrt(breath));

    }

    if (this.uniforms) {
      this.uniforms.uPhase.value = this.walkTime;
      this.uniforms.uAmt.value = amt;
      this.uniforms.uIdle.value = this.idleTime;
    }

    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      h.life += dt;
      h.s.position.y = h.s.userData.y0 + h.life * 0.9;
      h.s.material.opacity = Math.max(0, 1 - h.life / 1.6);
      const sc = 0.5 + Math.sin(Math.min(h.life * 6, Math.PI / 2)) * 0.2;
      h.s.scale.set(sc, sc, 1);
      if (h.life > 1.6) {
        this.group.remove(h.s);
        h.s.material.dispose();
        this.hearts.splice(i, 1);
      }
    }
  }
}

/* =========================================================
   입력 (키보드 / 마우스 드래그 / 터치 조이스틱)
   ========================================================= */
const keys = new Set();
let camYaw = 0, camPitch = 0.32, camDist = 4.5;
const joy = { x: 0, y: 0, active: false, id: null };
let viewerOpen = false;

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'KeyE' && !e.repeat) {
    if (viewerOpen) closeViewer();
    else if (nearFrame >= 0) openViewer(nearFrame);
  }
  if (e.code === 'KeyH' && !e.repeat && !viewerOpen) sendHeart();
  if (e.code === 'Escape' && viewerOpen) closeViewer();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// 시점 드래그 (화면 아무 곳)
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  camYaw -= dx * 0.006;
  camPitch = THREE.MathUtils.clamp(camPitch + dy * 0.004, -0.15, 1.1);
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
  drag = null;
  if (moved < 6) clickFrame(e.clientX, e.clientY);
});
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.004, 2.2, 8);
}, { passive: true });

// 조이스틱
const joyEl = $('joystick'), stickEl = $('stick');
function joyMove(e) {
  const r = joyEl.getBoundingClientRect();
  let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  joy.x = x; joy.y = y;
  stickEl.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
}
joyEl.addEventListener('pointerdown', (e) => {
  joy.active = true; joy.id = e.pointerId;
  joyEl.setPointerCapture(e.pointerId);
  joyMove(e);
});
joyEl.addEventListener('pointermove', (e) => { if (joy.active && e.pointerId === joy.id) joyMove(e); });
const joyEnd = (e) => {
  if (e.pointerId !== joy.id) return;
  joy.active = false; joy.x = joy.y = 0;
  stickEl.style.transform = '';
};
joyEl.addEventListener('pointerup', joyEnd);
joyEl.addEventListener('pointercancel', joyEnd);

$('heart-btn').onclick = () => sendHeart();
$('view-btn').onclick = () => { if (nearFrame >= 0) openViewer(nearFrame); };

const raycaster = new THREE.Raycaster();
function clickFrame(cx, cy) {
  if (viewerOpen || !me) return;
  const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(frames.map((f) => f.mesh))[0];
  if (!hit) return;
  const idx = hit.object.userData.frameIndex;
  if (frames[idx].spot.distanceTo(me.group.position) < 6) openViewer(idx);
  else showToast('조금 더 가까이 가서 눌러보세요');
}

/* =========================================================
   사진 뷰어 / 안내
   ========================================================= */
let nearFrame = -1;
let toastTimer = null;
let toastAction = null;

function openViewer(idx) {
  const f = frames[idx];
  if (!f) return;
  viewerOpen = true;
  keys.clear();
  $('viewer-img').src = f.src;
  $('viewer-title').textContent = f.data.title || '';
  $('viewer-date').textContent = f.data.date || '';
  $('viewer-caption').textContent = f.data.caption || '';
  $('viewer-share').classList.toggle('hidden', !conn);
  $('viewer-share').dataset.idx = idx;
  $('viewer-share').textContent = '상대에게도 보여주기';
  $('viewer').classList.remove('hidden');
}
function closeViewer() {
  viewerOpen = false;
  $('viewer').classList.add('hidden');
}
$('viewer-close').onclick = closeViewer;
$('viewer').addEventListener('click', (e) => { if (e.target.id === 'viewer') closeViewer(); });
$('viewer-share').onclick = () => {
  send({ t: 'view', idx: Number($('viewer-share').dataset.idx) });
  $('viewer-share').textContent = '보냈어요 ♥';
};

function showToast(text, action = null, ms = 3500) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  toastAction = action;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.add('hidden'); toastAction = null; }, ms);
}
$('toast').onclick = () => {
  $('toast').classList.add('hidden');
  if (toastAction) toastAction();
  toastAction = null;
};

/* =========================================================
   네트워크 (PeerJS: 방 만든 사람 = 호스트, 코드로 참가 = 게스트)
   ========================================================= */
let peer = null;
let conn = null;
let roomCode = '';
let isHost = false;
let partner = null;
let partnerName = '상대';
const partnerTarget = { x: 0, z: 0, ry: 0, moving: false };

function send(msg) {
  if (conn && conn.open) conn.send(msg);
}

function setStatus(online) {
  const el = $('partner-status');
  el.className = 'status ' + (online ? 'on' : 'wait');
  el.textContent = online ? `${partnerName}님과 함께 있어요 ♥` : '상대를 기다리는 중…';
}

function setupConnection(c) {
  conn = c;
  c.on('open', () => {
    send({ t: 'hello', name: myName, char: myChar });
  });
  c.on('data', (msg) => handleMessage(msg));
  c.on('close', () => {
    if (conn !== c) return;
    conn = null;
    if (partner) { scene.remove(partner.group); partner = null; }
    setStatus(false);
    showToast(`${partnerName}님이 나갔어요`);
  });
  c.on('error', (err) => console.warn('연결 오류', err));
}

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'hello': {
      partnerName = String(msg.name || '상대').slice(0, 10);
      const charId = msg.char === 'rae' ? 'rae' : 'wajiha';
      if (!partner) {
        partner = new Character(partnerName, charId);
        const px = isHost ? 1 : -1;
        partner.group.position.set(px, 0, HALL_L / 2 - 3);
        partnerTarget.x = px;
        partnerTarget.z = HALL_L / 2 - 3;
        partnerTarget.ry = Math.PI;
        showToast(`${partnerName}님과 연결됐어요 ♥`);
      } else {
        partner.setName(partnerName);
        partner.setCharacter(charId);
      }
      setStatus(true);
      break;
    }
    case 'full':
      showToast('이 방은 이미 두 명이 있어요. 새 방을 만들어주세요.', null, 8000);
      break;
    case 'state':
      partnerTarget.x = Number(msg.x) || 0;
      partnerTarget.z = Number(msg.z) || 0;
      partnerTarget.ry = Number(msg.ry) || 0;
      partnerTarget.moving = !!msg.m;
      break;
    case 'heart':
      if (partner) partner.heart();
      break;
    case 'view': {
      const f = frames[msg.idx];
      if (!f) break;
      showToast(`${partnerName}님이 「${f.data.title || '추억'}」을(를) 같이 보재요 · 눌러서 보기`, () => openViewer(msg.idx), 8000);
      break;
    }
  }
}

function sendHeart() {
  if (!me) return;
  me.heart();
  send({ t: 'heart' });
}

function createRoom(tries = 0) {
  isHost = true;
  roomCode = makeCode();
  peer = new Peer(PEER_PREFIX + roomCode);
  lobbyMsg('방을 만드는 중…', true);
  peer.on('open', () => startGame());
  peer.on('connection', (c) => {
    if (conn && conn.open) { // 2명까지만
      c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 500); });
      return;
    }
    setupConnection(c);
  });
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id' && tries < 5) {
      peer.destroy();
      createRoom(tries + 1);
    } else if (!started) {
      lobbyMsg('방을 만들지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.');
      setLobbyBusy(false);
    } else {
      console.warn('Peer 오류', err);
    }
  });
}

function joinRoom(code) {
  roomCode = code;
  peer = new Peer();
  lobbyMsg('방을 찾는 중…', true);
  const timeout = setTimeout(() => {
    if (!started) {
      lobbyMsg('응답이 없어요. 코드를 확인하거나 방장이 접속해 있는지 확인해주세요.');
      peer.destroy();
      setLobbyBusy(false);
    }
  }, 12000);
  peer.on('open', () => {
    const c = peer.connect(PEER_PREFIX + code, { reliable: true });
    setupConnection(c);
    c.on('open', () => { clearTimeout(timeout); startGame(); });
  });
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on('error', (err) => {
    if (started) { console.warn('Peer 오류', err); return; }
    clearTimeout(timeout);
    lobbyMsg(err.type === 'peer-unavailable'
      ? '그 코드의 방을 찾을 수 없어요. 코드를 다시 확인해주세요.'
      : '연결하지 못했어요. 잠시 후 다시 시도해주세요.');
    peer.destroy();
    setLobbyBusy(false);
  });
}

function setLobbyBusy(busy) {
  $('create-btn').disabled = busy;
  $('join-btn').disabled = busy;
}

$('create-btn').onclick = () => {
  if (!readName()) return;
  if (typeof Peer === 'undefined') { lobbyMsg('연결 모듈을 불러오지 못했어요. 새로고침 해주세요.'); return; }
  setLobbyBusy(true);
  createRoom();
};
$('join-btn').onclick = () => {
  if (!readName()) return;
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length !== 5) { lobbyMsg('방 코드 5자리를 입력해주세요.'); return; }
  if (typeof Peer === 'undefined') { lobbyMsg('연결 모듈을 불러오지 못했어요. 새로고침 해주세요.'); return; }
  setLobbyBusy(true);
  joinRoom(code);
};
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-btn').click(); });

$('copy-link').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${roomCode}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast('초대 링크를 복사했어요. 상대에게 보내주세요!');
  } catch {
    showToast(`이 링크를 보내주세요: ${url}`, null, 8000);
  }
};

/* =========================================================
   게임 시작 / 루프
   ========================================================= */
let me = null;
let started = false;

async function startGame() {
  if (started) return;
  started = true;
  await galleryReady;
  await Promise.all([buildMuseum(), preloadCharacters()]);

  me = new Character(myName, myChar);
  me.group.position.set(isHost ? -1 : 1, 0, HALL_L / 2 - 3);
  // 모델이 준비되기 전에 들어온 상대 캐릭터도 다시 그리기
  if (partner) { partner.buildBody(); partner.placeLabel(); }
  me.group.rotation.y = Math.PI; // 안쪽(-z) 바라보기

  $('room-code').textContent = roomCode;
  $('lobby').classList.add('hidden');
  $('hud').classList.remove('hidden');
  history.replaceState(null, '', `${location.pathname}?room=${roomCode}`);
  if (conn && conn.open) send({ t: 'hello', name: myName, char: myChar });
  setStatus(!!partner);
  requestAnimationFrame(loop);
}

const clock = new THREE.Clock();
let sendTimer = 0;
const tmpV = new THREE.Vector3();

function collide(pos) {
  const r = 0.35;
  const halfW = HALL_W / 2 - r - 0.1;
  const halfL = HALL_L / 2 - r - 0.1;
  pos.x = THREE.MathUtils.clamp(pos.x, -halfW, halfW);
  pos.z = THREE.MathUtils.clamp(pos.z, -halfL, halfL);
  for (const o of obstacles) {
    const minX = o.minX - r, maxX = o.maxX + r, minZ = o.minZ - r, maxZ = o.maxZ + r;
    if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
      const pushes = [pos.x - minX, maxX - pos.x, pos.z - minZ, maxZ - pos.z];
      const m = Math.min(...pushes);
      if (m === pushes[0]) pos.x = minX;
      else if (m === pushes[1]) pos.x = maxX;
      else if (m === pushes[2]) pos.z = minZ;
      else pos.z = maxZ;
    }
  }
}

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  // --- 내 캐릭터 이동 ---
  let ix = 0, iz = 0;
  if (!viewerOpen) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (joy.active) { ix += joy.x; iz += joy.y; }
  }
  const len = Math.hypot(ix, iz);
  me.moving = len > 0.1;
  if (me.moving) {
    if (len > 1) { ix /= len; iz /= len; }
    // 카메라 방향 기준으로 이동
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const dx = ix * cos + iz * sin;
    const dz = -ix * sin + iz * cos;
    const p = me.group.position;
    p.x += dx * MOVE_SPEED * dt;
    p.z += dz * MOVE_SPEED * dt;
    collide(p);
    me.group.rotation.y = angleLerp(me.group.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 12));
  }
  me.update(dt);

  // --- 상대 캐릭터 보간 ---
  if (partner) {
    const p = partner.group.position;
    const k = Math.min(1, dt * 10);
    p.x += (partnerTarget.x - p.x) * k;
    p.z += (partnerTarget.z - p.z) * k;
    partner.group.rotation.y = angleLerp(partner.group.rotation.y, partnerTarget.ry, k);
    partner.moving = partnerTarget.moving;
    partner.update(dt);
  }

  // --- 위치 전송 ---
  sendTimer += dt * 1000;
  if (sendTimer >= SEND_INTERVAL) {
    sendTimer = 0;
    const p = me.group.position;
    send({ t: 'state', x: +p.x.toFixed(3), z: +p.z.toFixed(3), ry: +me.group.rotation.y.toFixed(3), m: me.moving });
  }

  // --- 가까운 액자 안내 ---
  let best = -1, bestD = VIEW_DIST;
  frames.forEach((f, i) => {
    const d = f.spot.distanceTo(me.group.position);
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best !== nearFrame) {
    nearFrame = best;
    const hint = $('hint');
    if (best >= 0) {
      const f = frames[best];
      hint.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = f.data.title || '추억';
      hint.append(b, document.createTextNode(f.data.date ? ` · ${f.data.date}` : ''));
      hint.appendChild(document.createElement('br'));
      hint.appendChild(document.createTextNode('E 키 또는 🔍 버튼으로 크게 보기'));
      hint.classList.remove('hidden');
      $('view-btn').classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
      $('view-btn').classList.add('hidden');
    }
  }

  // --- 카메라 (3인칭) ---
  const target = tmpV.copy(me.group.position);
  target.y += me.height * 0.8;
  const cx = target.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist;
  const cz = target.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist;
  const cy = target.y + Math.sin(camPitch) * camDist;
  camera.position.set(
    THREE.MathUtils.clamp(cx, -HALL_W / 2 + 0.3, HALL_W / 2 - 0.3),
    THREE.MathUtils.clamp(cy, 0.4, WALL_H - 0.3),
    THREE.MathUtils.clamp(cz, -HALL_L / 2 + 0.3, HALL_L / 2 - 0.3)
  );
  camera.lookAt(target);

  renderer.render(scene, camera);
}
