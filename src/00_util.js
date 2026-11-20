'use strict';

const Q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const CAPTURE = Q.has('capture');
const SEED = +(Q.get('seed') || 20261116);
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const damp = (x, target, rate, dt) => target + (x - target) * Math.exp(-rate * dt);
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const hash2 = (i, j, k = 0) => { let n = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k + SEED, 0x9e3779b1); n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
const vnoise = (x, y, k = 0) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash2(i, j, k), hash2(i + 1, j, k), u), lerp(hash2(i, j + 1, k), hash2(i + 1, j + 1, k), u), v); };
const fbm = (x, y, oct = 5, k = 0) => { let a = 0.5, s = 0; for (let o = 0; o < oct; o++) { s += a * vnoise(x, y, k + o); x = x * 2.03 + 17.1; y = y * 2.03 + 9.2; a *= 0.5; } return s; };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TMPV = V3(), TMPQ = new THREE.Quaternion(), TMPM = new THREE.Matrix4(), TMPE = new THREE.Euler();

function plateGeo(w = 1, h = 1, d = 1, r = 0.06) {
  const c = Math.min(r, w * 0.30, h * 0.30, d * 0.35);
  const x = w / 2, y = h / 2, s = new THREE.Shape();
  s.moveTo(-x + c, -y); s.lineTo(x - c, -y); s.lineTo(x, -y + c); s.lineTo(x, y - c);
  s.lineTo(x - c, y); s.lineTo(-x + c, y); s.lineTo(-x, y - c); s.lineTo(-x, -y + c); s.closePath();
  const dep = Math.max(0.002, d - 2 * c);
  const g = new THREE.ExtrudeGeometry(s, { depth: dep, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, curveSegments: 1, steps: 1 });
  g.translate(0, 0, -dep / 2);
  return g;
}

function decalTexture(size, draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d'); draw(c, size);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}
function decalMat(tex, color = 0xffffff) {
  return new THREE.MeshStandardMaterial({ map: tex, color, transparent: true, roughness: 0.55, metalness: 0.25, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
}

let BUMP_TEX = null;
function bumpTexture(size = 512, seed = 9091) {
  if (BUMP_TEX) return BUMP_TEX;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d'), rr = rng(seed);
  c.fillStyle = '#808080'; c.fillRect(0, 0, size, size);
  const im = c.getImageData(0, 0, size, size), D = im.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const n = fbm(x / 34, y / 34, 4, seed) * 0.65 + fbm(x / 7.5, y / 7.5, 3, seed + 7) * 0.35;
    const v = 118 + (n - 0.5) * 46;
    D[i] = D[i + 1] = D[i + 2] = v; D[i + 3] = 255;
  }
  c.putImageData(im, 0, 0);

  for (let i = 0; i < 220; i++) {
    const x = rr() * size, y = rr() * size, a = rr() * TAU, l = 6 + rr() * 46;
    c.strokeStyle = rr() < 0.55 ? 'rgba(70,70,70,0.22)' : 'rgba(190,190,190,0.20)';
    c.lineWidth = 0.6 + rr() * 1.2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }

  for (let i = 0; i < 90; i++) {
    const x = rr() * size, y = rr() * size, r = 2 + rr() * 8;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(60,60,60,0.22)'); g.addColorStop(1, 'rgba(128,128,128,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  BUMP_TEX = new THREE.CanvasTexture(cv);
  BUMP_TEX.wrapS = BUMP_TEX.wrapT = THREE.RepeatWrapping;
  BUMP_TEX.colorSpace = THREE.NoColorSpace;
  BUMP_TEX.anisotropy = 4;
  return BUMP_TEX;
}

const G = { tick: [], info: {}, uTime: { value: 0 }, t: 0, lights: {}, anchors: {} };
