'use strict';

const MechGLB = (() => {
  const B64 = '{{ROBOT_GLB_B64}}';
  const TARGET_H = 14.0;
  const CREASE = Math.cos(38 * Math.PI / 180);
  let S = 1, MAT = null, LIGHT = null, STRIPE = null, HLIGHT = null;
  const uGlow = { value: 1 };

  function bytesFromB64(s) {
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const C_TOR = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
  const C_N = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  function readAccessor(json, bytes, binStart, ai) {
    const a = json.accessors[ai], bv = json.bufferViews[a.bufferView];
    const n = C_N[a.type], Ctor = C_TOR[a.componentType];
    const base = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || n * Ctor.BYTES_PER_ELEMENT;
    const out = new Ctor(a.count * n), dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const get = { 5126: 'getFloat32', 5125: 'getUint32', 5123: 'getUint16', 5121: 'getUint8' }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv[get](base + k * stride + c * Ctor.BYTES_PER_ELEMENT, true);
    return out;
  }
  function loadParts() {
    const bytes = bytesFromB64(B64);
    const dv = new DataView(bytes.buffer);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('机器人.glb 格式不对');
    const jlen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jlen)));
    const binStart = 20 + jlen + 8;
    let minY = Infinity, maxY = -Infinity;
    for (const m of json.meshes) { const a = json.accessors[m.primitives[0].attributes.POSITION]; minY = Math.min(minY, a.min[1]); maxY = Math.max(maxY, a.max[1]); }
    S = TARGET_H / (maxY - minY);
    const parts = [];
    for (const m of json.meshes) {
      const prim = m.primitives[0];
      if (prim.mode != null && prim.mode !== 4) continue;
      const pos = readAccessor(json, bytes, binStart, prim.attributes.POSITION);
      for (let i = 0; i < pos.length; i++) pos[i] *= S;
      pos.forEach((v, i) => { if (i % 3 === 1) pos[i] = v - minY * S; });
      const nrm = prim.attributes.NORMAL != null ? readAccessor(json, bytes, binStart, prim.attributes.NORMAL) : null;
      const idx = readAccessor(json, bytes, binStart, prim.indices);
      parts.push({ pos, nrm, idx, nv: pos.length / 3, nt: idx.length / 3 });
    }
    return parts;
  }

  function bakeAO(parts) {
    const R = G.R, RES = 512, NDIR = 96;
    const sc = new THREE.Scene();
    const depthMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',

      fragmentShader: `void main(){ float v = floor(clamp(gl_FragCoord.z, 0.0, 1.0) * 16777215.0);
        float r = floor(v / 65536.0); float g = floor((v - r * 65536.0) / 256.0); float b = v - r * 65536.0 - g * 256.0;
        gl_FragColor = vec4(r, g, b, 255.0) / 255.0; }`
    });
    const tmpGeos = [];
    for (const p of parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3)); g.setIndex(new THREE.BufferAttribute(p.idx, 1));
      tmpGeos.push(g); sc.add(new THREE.Mesh(g, depthMat));
    }
    const box = new THREE.Box3().setFromObject(sc), ctr = box.getCenter(new THREE.Vector3());
    const rad = box.getSize(new THREE.Vector3()).length() * 0.5 + 0.2;
    const cam = new THREE.OrthographicCamera(-rad, rad, rad, -rad, 0.1, rad * 2 + 0.2);
    const rt = new THREE.WebGLRenderTarget(RES, RES, { type: THREE.UnsignedByteType, depthBuffer: true });
    const px = new Uint8Array(RES * RES * 4);

    const acc = parts.map(p => new Float32Array(p.nv)), wsum = parts.map(p => new Float32Array(p.nv));
    const nrms = parts.map(p => p.nrm || smoothNormals(p));
    const prevRT = R.getRenderTarget(), prevClear = R.getClearColor(new THREE.Color()), prevA = R.getClearAlpha();
    R.setClearColor(0xffffff, 1);
    const d = new THREE.Vector3(), v = new THREE.Vector3(), M = new THREE.Matrix4();
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < NDIR; k++) {
      const y = 1 - (k + 0.5) / NDIR * 2, r = Math.sqrt(1 - y * y);
      d.set(Math.cos(ga * k) * r, y, Math.sin(ga * k) * r);
      cam.position.copy(ctr).addScaledVector(d, rad + 0.1); cam.lookAt(ctr); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      R.setRenderTarget(rt); R.clear(); R.render(sc, cam);
      R.readRenderTargetPixels(rt, 0, 0, RES, RES, px);
      M.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      const e = M.elements;
      for (let pi = 0; pi < parts.length; pi++) {
        const P = parts[pi].pos, N = nrms[pi], A = acc[pi], W = wsum[pi];
        for (let i = 0; i < parts[pi].nv; i++) {
          const cw = N[i * 3] * d.x + N[i * 3 + 1] * d.y + N[i * 3 + 2] * d.z;
          if (cw <= 0.02) continue;
          const x = P[i * 3] + N[i * 3] * 0.03, yy = P[i * 3 + 1] + N[i * 3 + 1] * 0.03, z = P[i * 3 + 2] + N[i * 3 + 2] * 0.03;
          const nx = e[0] * x + e[4] * yy + e[8] * z + e[12], ny = e[1] * x + e[5] * yy + e[9] * z + e[13], nz = e[2] * x + e[6] * yy + e[10] * z + e[14];
          const sx = Math.min(RES - 1, Math.max(0, ((nx * 0.5 + 0.5) * RES) | 0)), sy = Math.min(RES - 1, Math.max(0, ((ny * 0.5 + 0.5) * RES) | 0));
          const o = (sy * RES + sx) * 4;
          const dep = (px[o] * 65536 + px[o + 1] * 256 + px[o + 2]) / 16777215;
          const vis = (nz * 0.5 + 0.5) <= dep + 0.004 ? 1 : 0;
          A[i] += vis * cw; W[i] += cw;
        }
      }
    }
    R.setRenderTarget(prevRT); R.setClearColor(prevClear, prevA);
    rt.dispose(); depthMat.dispose(); tmpGeos.forEach(g => g.dispose());
    return acc.map((A, pi) => { const W = wsum[pi], out = new Float32Array(A.length); for (let i = 0; i < A.length; i++) out[i] = W[i] > 0 ? A[i] / W[i] : 1; return out; });
  }
  function smoothNormals(p) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3)); g.setIndex(new THREE.BufferAttribute(p.idx, 1));
    g.computeVertexNormals(); return g.attributes.normal.array;
  }

  function buildGeometry(p, ao, force) {
    const { pos, idx, nv, nt } = p;
    const fn = new Float32Array(nt * 3), fa = new Float32Array(nt);
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1e-9; fa[t] = l; fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
    }
    const cnt = new Uint32Array(nv + 1);
    for (let i = 0; i < idx.length; i++) cnt[idx[i] + 1]++;
    for (let i = 0; i < nv; i++) cnt[i + 1] += cnt[i];
    const fill = cnt.slice(0, nv), adj = new Uint32Array(idx.length);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) adj[fill[idx[t * 3 + k]]++] = t;
    const P = new Float32Array(nt * 9), N = new Float32Array(nt * 9), AO = new Float32Array(nt * 3), ED = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2];
      for (let k = 0; k < 3; k++) {
        const vi = idx[t * 3 + k], o = t * 3 + k;
        let nx = 0, ny = 0, nz = 0, rej = 0;
        for (let j = cnt[vi]; j < cnt[vi + 1]; j++) {
          const f = adj[j], d = fn[f * 3] * fx + fn[f * 3 + 1] * fy + fn[f * 3 + 2] * fz;
          if (d >= CREASE) { nx += fn[f * 3] * fa[f]; ny += fn[f * 3 + 1] * fa[f]; nz += fn[f * 3 + 2] * fa[f]; }
          else rej++;
        }
        const l = Math.hypot(nx, ny, nz) || 1;
        P[o * 3] = pos[vi * 3]; P[o * 3 + 1] = pos[vi * 3 + 1]; P[o * 3 + 2] = pos[vi * 3 + 2];
        N[o * 3] = nx / l; N[o * 3 + 1] = ny / l; N[o * 3 + 2] = nz / l;
        AO[o] = ao[vi]; ED[o] = rej > 0 ? 1 : 0;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('aAO', new THREE.BufferAttribute(AO, 1));
    g.setAttribute('aEdge', new THREE.BufferAttribute(ED, 1));
    g.setAttribute('aForce', new THREE.BufferAttribute(new Float32Array(nt * 3).fill(force), 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }

  function makeMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 });
    return patch(m, api => {
      api.vHead('attribute float aAO; attribute float aEdge; attribute float aForce; varying float vForce; varying float vAO; varying float vEdge; varying vec3 vOp; varying vec3 vOn;');
      api.v('#include <begin_vertex>', `#include <begin_vertex>
        vAO = aAO; vEdge = aEdge; vForce = aForce; vOp = position; vOn = normal;`);
      api.fHead(`${GLSL_NOISE}
        varying float vAO; varying float vEdge; varying vec3 vOp; varying vec3 vOn; varying float vForce;
        float gMech; float gAO; float gH;

        float seamSet(vec2 q, vec2 sp, out float rv){
          vec2 c = q / sp; vec2 id = floor(c); vec2 f = fract(c);
          float aa = max(fwidth(c.x), fwidth(c.y)) * 1.3 + 0.002;
          float keepU = step(0.45, hash21(vec2(id.x, 3.7))), keepV = step(0.55, hash21(vec2(id.y, 9.1) + floor(id.x * 0.5)));
          float lu = keepU * (1.0 - smoothstep(0.0, 0.012 + aa, min(f.x, 1.0 - f.x)));
          float lv = keepV * (1.0 - smoothstep(0.0, 0.010 + aa, min(f.y, 1.0 - f.y)));

          float dx = min(f.x, 1.0 - f.x) * sp.x;
          float ry = fract(q.y / 0.28) - 0.5;
          float d = length(vec2(dx - 0.09, ry * 0.28));
          rv = keepU * (1.0 - smoothstep(0.022, 0.034 + aa, d));
          return max(lu, lv);
        }
        float crack(vec3 p){ float n = fbm3(p); float w = fwidth(n) * 1.2 + 0.004; return 1.0 - smoothstep(0.0, w, abs(n - 0.5)); }
        vec3 pnArb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd){
          vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos)); vec3 vN = surf_norm;
          vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX); float fDet = dot(vSigmaX, R1) * fd;
          vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2); return normalize(abs(fDet) * surf_norm - vGrad); }`);
      api.f('#include <color_fragment>', `#include <color_fragment>
        gAO = clamp(vAO, 0.0, 1.0);
        vec3 op = vOp;

        gMech = 1.0 - smoothstep(0.40, 0.62, gAO + (fbm3(op * 1.1) - 0.5) * 0.10);
        gMech = max(gMech, vForce * (0.55 + 0.45 * smoothstep(0.75, 0.45, gAO)));
        vec3 armor = vec3(0.140, 0.140, 0.108);
        vec3 mech  = vec3(0.020, 0.022, 0.024);
        float tone = fbm3(op * 0.32 + 3.0);
        armor *= 0.93 + 0.12 * tone;
        float grain = vnoise3(op * 22.0) * 0.6 + vnoise3(op * 7.0) * 0.4;
        armor *= 0.93 + 0.14 * grain;
        mech  *= 0.85 + 0.30 * vnoise3(op * 6.0);
        vec3 col = mix(armor, mech, gMech);
        vec3 an = abs(normalize(vOn)); float rv = 0.0; float seam = 0.0; float r0;
        if (an.x > an.y && an.x > an.z) seam = seamSet(op.zy, vec2(1.55, 1.15), rv);
        else if (an.y > an.z) seam = seamSet(op.xz, vec2(1.40, 1.25), rv);
        else seam = seamSet(op.xy, vec2(1.50, 1.10), rv);
        seam *= (1.0 - gMech) * smoothstep(0.45, 0.7, gAO);
        rv *= (1.0 - gMech) * smoothstep(0.45, 0.7, gAO);
        col *= 1.0 - 0.55 * seam;
        col = mix(col, vec3(0.20, 0.20, 0.17), rv * 0.55);

        float ck = crack(op * 0.55 + 11.0) * smoothstep(0.42, 0.62, fbm3(op * 0.9 + 5.0));
        col *= 1.0 - 0.55 * ck * (1.0 - gMech);
        float chip = smoothstep(0.74, 0.80, fbm3(op * 3.1 + 8.0));
        col = mix(col, vec3(0.030, 0.032, 0.028), chip * 0.55 * (1.0 - gMech));

        float wear = pow(vEdge, 6.0) * smoothstep(0.50, 0.66, fbm3(op * 5.0 + 1.7));
        col = mix(col, vec3(0.34, 0.34, 0.30), wear * 0.45 * (1.0 - gMech));

        float low = smoothstep(3.6, 0.0, op.y);
        col *= 1.0 - 0.22 * low * smoothstep(0.35, 0.75, fbm3(op * 0.8));
        float st = fbm2(vec2((op.x + op.z) * 2.2, op.y * 0.20));
        col *= mix(0.82, 1.0, smoothstep(0.30, 0.72, st));

        col *= mix(0.42, 1.0, smoothstep(0.08, 0.75, gAO));
        diffuseColor.rgb = col;
        gH = grain * 0.35 - ck * 0.9 - chip * 0.5 - seam * 1.6 + rv * 1.2;`);
      api.f('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.56 + 0.16 * fbm3(vOp * 0.7), 0.42 + 0.10 * vnoise3(vOp * 4.0), gMech);

        { vec3 dn = fwidth(normalize(vNormal)); float spaa = clamp(pow(dot(dn, dn), 0.333) * 1.6, 0.0, 1.0);
          roughnessFactor = max(roughnessFactor, mix(roughnessFactor, 1.0, spaa)); }`);
      api.f('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(0.10, 0.70, gMech);`);
      api.f('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec2 dH = vec2(dFdx(gH), dFdy(gH)) * 0.020; normal = pnArb(-vViewPosition, normal, dH, faceDirection); }`);
      api.f('#include <aomap_fragment>', `#include <aomap_fragment>
        { float a = mix(0.18, 1.0, smoothstep(0.05, 0.85, gAO));
          reflectedLight.indirectDiffuse *= a; reflectedLight.indirectSpecular *= a; }`);
    }, 'mech-glb-v2', {});
  }

  function makeDecalMats() {
    const lightTex = decalTexture(256, (c, s) => {
      c.clearRect(0, 0, s, s);
      const g = c.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0.0, 'rgba(255,200,120,0)'); g.addColorStop(0.32, 'rgba(255,200,120,0.25)');
      g.addColorStop(0.42, 'rgba(255,236,200,1)'); g.addColorStop(0.58, 'rgba(255,236,200,1)');
      g.addColorStop(0.68, 'rgba(255,200,120,0.25)'); g.addColorStop(1.0, 'rgba(255,200,120,0)');
      c.fillStyle = g; c.fillRect(10, 0, s - 20, s);
      c.globalCompositeOperation = 'destination-in';
      const h = c.createLinearGradient(0, 0, s, 0);
      h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.07, 'rgba(0,0,0,1)'); h.addColorStop(0.93, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = h; c.fillRect(0, 0, s, s);
    });
    LIGHT = new THREE.MeshBasicMaterial({ map: lightTex, color: new THREE.Color(1.0, 0.62, 0.30).multiplyScalar(3.2), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false });
    HLIGHT = [0, 1, 2, 3].map(() => LIGHT.clone());

    const stripeTex = decalTexture(256, (c, s) => {
      c.clearRect(0, 0, s, s);
      c.fillStyle = 'rgba(196,84,30,0.95)';
      for (let i = 0; i < 2; i++) { c.save(); c.translate(s * 0.5, s * (0.34 + i * 0.32)); c.rotate(-0.42); c.fillRect(-s * 0.42, -s * 0.07, s * 0.84, s * 0.14); c.restore(); }

      c.globalCompositeOperation = 'destination-out';
      const r = rng(SEED + 411);
      for (let i = 0; i < 140; i++) { c.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`; c.fillRect(r() * s, r() * s, 1 + r() * 5, 1 + r() * 3); }
    });
    STRIPE = new THREE.MeshStandardMaterial({ map: stripeTex, transparent: true, roughness: 0.72, metalness: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  }
  const _ray = new THREE.Raycaster(), _up = new THREE.Vector3(0, 1, 0);

  function stick(root, meshes, o, dir, w, h, mat, rz = 0) {
    _ray.set(new THREE.Vector3(...o), new THREE.Vector3(...dir).normalize()); _ray.far = 40;
    const hit = _ray.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    let up = _up.clone().addScaledVector(n, -_up.dot(n)); if (up.lengthSq() < 1e-4) up.set(0, 0, -1); up.normalize();
    const right = new THREE.Vector3().crossVectors(up, n).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    pl.quaternion.copy(q); if (rz) pl.rotateZ(rz);
    pl.position.copy(hit.point).addScaledVector(n, 0.012); pl.renderOrder = 2;
    root.add(pl); root.updateMatrixWorld(true); hit.object.parent.attach(pl); return pl;
  }
  function addDecals(root, meshes, hero) {
    const F = [0, 0, 1], Fd = [0, 0, -1];

    const L = (x, y, w, h = 0.14, rz = 0, g = 0) => stick(root, meshes, [x, y, 20], Fd, w, h, hero ? HLIGHT[g] : LIGHT, rz);
    for (const s of [1, -1]) {
      L(s * 3.0, 10.75, 0.95, 0.14, 0, 2);
      L(s * 1.10, 9.35, 0.42, 0.13, s * 0.75, 1);
      L(s * 2.35, 0.22, 0.80, 0.13, 0, 0);
      L(s * 2.2, 13.30, 0.30, 0.20, 0, 3);
      stick(root, meshes, [s * 5.0, 7.2, 20], Fd, 0.75, 0.75, STRIPE);
      stick(root, meshes, [s * 2.95, 3.6, 20], Fd, 0.85, 0.85, STRIPE);
    }
    L(0, 12.20, 0.46, 0.12, 0, 3);
    L(0, 13.35, 0.62, 0.14, 0, 3);
    void F;
  }

  let PANEL_GEO = null, BOLTS = [];
  function buildPanels(parts, aos) {
    const P = [], N = [], AOa = [], EDa = [];
    const push = (p, n, ed) => { P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); AOa.push(1); EDa.push(ed); };
    const tri = (a, b, c, n, ed = 0) => { push(a, n, ed); push(b, n, ed); push(c, n, ed); };
    const V = THREE.Vector3;
    const RANGE = [];
    for (let pi = 0; pi < parts.length; pi++) {
      RANGE[pi] = P.length;
      if (pi === 1 || pi === 13) continue;
      const { pos, idx, nt } = parts[pi], ao = aos[pi];
      const fn = new Float32Array(nt * 3), fa = new Float32Array(nt);
      for (let t = 0; t < nt; t++) {
        const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1e-9; fa[t] = l * 0.5; fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
      }

      const edge = new Map();
      for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
        const i0 = idx[t * 3 + k], i1 = idx[t * 3 + (k + 1) % 3], key = Math.min(i0, i1) * 1e6 + Math.max(i0, i1);
        const L = edge.get(key); if (L) L.push(t); else edge.set(key, [t]);
      }
      const seen = new Uint8Array(nt);
      for (let s = 0; s < nt; s++) {
        if (seen[s]) continue;
        const sn = new V(fn[s * 3], fn[s * 3 + 1], fn[s * 3 + 2]), sp = new V(pos[idx[s * 3] * 3], pos[idx[s * 3] * 3 + 1], pos[idx[s * 3] * 3 + 2]);
        const d0 = sn.dot(sp), cl = [s], q = [s]; seen[s] = 1; let area = 0;
        while (q.length) {
          const t = q.pop(); area += fa[t];
          for (let k = 0; k < 3; k++) {
            const i0 = idx[t * 3 + k], i1 = idx[t * 3 + (k + 1) % 3];
            for (const f of edge.get(Math.min(i0, i1) * 1e6 + Math.max(i0, i1))) {
              if (seen[f]) continue;
              if (fn[f * 3] * sn.x + fn[f * 3 + 1] * sn.y + fn[f * 3 + 2] * sn.z < 0.985) continue;
              const vi = idx[f * 3] * 3;
              if (Math.abs(pos[vi] * sn.x + pos[vi + 1] * sn.y + pos[vi + 2] * sn.z - d0) > 0.06) continue;
              seen[f] = 1; cl.push(f); q.push(f);
            }
          }
        }
        if (area < 0.55) continue;

        const vs = new Set(); for (const t of cl) for (let k = 0; k < 3; k++) vs.add(idx[t * 3 + k]);
        let aoS = 0; for (const v of vs) aoS += ao[v]; if (aoS / vs.size < 0.58) continue;

        const u = new V().crossVectors(sn, Math.abs(sn.y) < 0.9 ? new V(0, 1, 0) : new V(1, 0, 0)).normalize(), w = new V().crossVectors(sn, u);
        const pts = []; for (const v of vs) { const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2]; pts.push([x * u.x + y * u.y + z * u.z, x * w.x + y * w.y + z * w.z]); }

        pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lo = [], hi = [];
        for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
        for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
        let hull = lo.slice(0, -1).concat(hi.slice(0, -1));
        let ha = 0; for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; ha += a[0] * b[1] - b[0] * a[1]; } ha = Math.abs(ha) * 0.5;
        if (area / ha < 0.80) continue;

        for (let pass = 0; pass < 3; pass++) {
          const out = [];
          for (let i = 0; i < hull.length; i++) {
            const a = hull[(i - 1 + hull.length) % hull.length], b = hull[i], c = hull[(i + 1) % hull.length];
            const e1 = Math.hypot(b[0] - a[0], b[1] - a[1]), e2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
            const turn = Math.abs(cr(a, b, c)) / (e1 * e2 + 1e-9);
            if (turn < 0.12 || e1 < 0.12) continue; out.push(b);
          }
          if (out.length >= 3) hull = out;
        }
        if (hull.length < 3 || hull.length > 9) continue;
        let cx = 0, cy = 0; for (const p of hull) { cx += p[0]; cy += p[1]; } cx /= hull.length; cy /= hull.length;
        const r = Math.sqrt(ha / Math.PI);
        const k1 = THREE.MathUtils.clamp(1 - (0.16 + 0.05 * r) / r, 0.50, 0.90);
        const k2 = k1 * (1 - 0.045 / (r * k1));
        const H = 0.035, h1 = 0.016;
        const to3 = (p, k, h) => { const x = cx + (p[0] - cx) * k, y = cy + (p[1] - cy) * k; return new V().addScaledVector(u, x).addScaledVector(w, y).addScaledVector(sn, d0 + h); };
        const outerB = hull.map(p => to3(p, k1, -0.004)), outerT = hull.map(p => to3(p, k1, h1)), inner = hull.map(p => to3(p, k2, H));
        const c3 = to3([cx, cy], 0, H);
        const n = hull.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          tri(c3, inner[i], inner[j], sn);
          const nb = new V().subVectors(outerT[j], outerT[i]).cross(new V().subVectors(inner[i], outerT[i])).normalize();
          tri(outerT[i], outerT[j], inner[j], nb, 1); tri(outerT[i], inner[j], inner[i], nb, 1);
          const ns = new V().subVectors(outerB[j], outerB[i]).cross(sn).normalize().negate();
          tri(outerB[i], outerB[j], outerT[j], ns, 1); tri(outerB[i], outerT[j], outerT[i], ns, 1);

          if (r > 0.76 && n <= 6) BOLTS.push({ p: to3(hull[i], k2 - 0.10 / r, H), n: sn.clone(), pi });
        }
      }
    }

    for (let i = 0; i < P.length; i += 9) {
      const ax = P[i + 3] - P[i], ay = P[i + 4] - P[i + 1], az = P[i + 5] - P[i + 2], bx = P[i + 6] - P[i], by = P[i + 7] - P[i + 1], bz = P[i + 8] - P[i + 2];
      const cx2 = ay * bz - az * by, cy2 = az * bx - ax * bz, cz2 = ax * by - ay * bx;
      if (cx2 * N[i] + cy2 * N[i + 1] + cz2 * N[i + 2] < 0) for (let k = 0; k < 3; k++) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t; }
    }
    RANGE[parts.length] = P.length;

    return parts.map((_, pi) => {
      const a = RANGE[pi], b = RANGE[pi + 1];
      if (b <= a) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P.slice(a, b), 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N.slice(a, b), 3));
      g.setAttribute('aAO', new THREE.Float32BufferAttribute(AOa.slice(a / 3, b / 3), 1));
      g.setAttribute('aEdge', new THREE.Float32BufferAttribute(EDa.slice(a / 3, b / 3), 1));
      g.setAttribute('aForce', new THREE.Float32BufferAttribute(new Float32Array((b - a) / 3), 1));
      g.computeBoundingSphere();
      return g;
    });
  }
  let BOLT_GEO = null, BOLT_MAT = null;
  function boltMesh(pi) {
    if (!BOLT_GEO) {
      BOLT_GEO = new THREE.CylinderGeometry(0.034, 0.038, 0.024, 6); BOLT_GEO.rotateX(Math.PI / 2); BOLT_GEO.translate(0, 0, 0.012);
      BOLT_MAT = new THREE.MeshStandardMaterial({ color: 0x55574d, metalness: 0.55, roughness: 0.48 });
    }
    const list = BOLTS.filter(b => b.pi === pi); if (!list.length) return null;
    const m = new THREE.InstancedMesh(BOLT_GEO, BOLT_MAT, list.length);
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1), S1 = new THREE.Vector3(1, 1, 1);
    list.forEach((b, i) => { Q.setFromUnitVectors(Z, b.n); M4.compose(b.p, Q, S1); m.setMatrixAt(i, M4); });
    return m;
  }

  let PARTS = null, GEOS = null;
  function ensureGeometry() {
    if (GEOS) return GEOS;
    if (!B64 || B64.charCodeAt(0) === 123) throw new Error('机器人.glb 没有内联进构建');
    PARTS = loadParts();
    const ao = bakeAO(PARTS);
    GEOS = PARTS.map((p, i) => buildGeometry(p, ao[i], (i === 1 || i === 13) ? 1 : 0));
    PANEL_GEO = buildPanels(PARTS, ao);
    MAT = makeMaterial(); makeDecalMats();
    return GEOS;
  }

  const JOINTS = [
    ['pelvis', null, [0, 8.20, 0], [4]],
    ['torso', 'pelvis', [0, 9.35, 0], [17, 7, 11, 3, 20, 2, 21, 19]],
    ['armR', 'torso', [3.35, 10.17, 0.04], [8, 12]], ['foreR', 'armR', [4.08, 8.32, 0.42], [10]], ['handR', 'foreR', [4.67, 6.10, 1.72], [1]],
    ['armL', 'torso', [-3.30, 10.62, 0], [9]], ['foreL', 'armL', [-4.26, 8.38, 0.41], [16]], ['handL', 'foreL', [-4.83, 6.15, 1.62], [13]],
    ['thighR', 'pelvis', [0.88, 7.60, 0.05], [14]], ['shinR', 'thighR', [2.02, 5.87, -0.08], [15]], ['footR', 'shinR', [2.30, 1.60, 0.04], [5]],
    ['thighL', 'pelvis', [-0.90, 7.60, 0.05], [0]], ['shinL', 'thighL', [-2.10, 5.87, -0.08], [18]], ['footL', 'shinL', [-2.34, 1.50, 0.06], [6]],
  ];

  function makeBody(withDecals, shadows, hero = false) {
    const geos = ensureGeometry();
    const body = new THREE.Group(), meshes = [], j = {}, piv = {};
    for (const [name, parent, pv, parts] of JOINTS) {
      const g = new THREE.Group(); g.name = name; j[name] = g; piv[name] = pv;
      const pp = parent ? piv[parent] : [0, 0, 0];
      g.position.set(pv[0] - pp[0], pv[1] - pp[1], pv[2] - pp[2]);
      (parent ? j[parent] : body).add(g);
      for (const pi of parts) {
        const m = new THREE.Mesh(geos[pi], MAT); m.castShadow = shadows; m.receiveShadow = shadows;
        m.position.set(-pv[0], -pv[1], -pv[2]); g.add(m); meshes.push(m);
        if (PANEL_GEO[pi]) {
          const pm = new THREE.Mesh(PANEL_GEO[pi], MAT); pm.castShadow = shadows; pm.receiveShadow = shadows;
          pm.position.copy(m.position); g.add(pm); meshes.push(pm);
        }
        const bm = boltMesh(pi); if (bm) { bm.position.copy(m.position); bm.castShadow = false; g.add(bm); }
      }
    }
    body.updateMatrixWorld(true);
    if (withDecals) addDecals(body, meshes, hero);
    const rig = { j, setPose };

    function setPose(pose) {
      for (const [name] of JOINTS) { const r = pose[name]; j[name].rotation.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0); }
      j.pelvis.position.y = 8.20 - (pose.drop || 0); j.pelvis.position.z = pose.fwd || 0;
    }
    body.userData.rig = rig;
    return body;
  }

  const LEG = {
    R: { H: [0.88, 7.60, 0.05], A: [2.30, 1.60, 0.04] },
    L: { H: [-0.90, 7.60, 0.05], A: [-2.34, 1.50, 0.06] },
  };
  const L1 = Math.hypot(5.87 - 7.60, -0.08 - 0.05), L2 = Math.hypot(1.55 - 5.87, 0.05 + 0.08);
  const P1R = Math.atan2(-0.08 - 0.05, 7.60 - 5.87), P2R = Math.atan2(0.05 + 0.08, 5.87 - 1.55);
  const PELV_Y = 8.20;

  function legIK(side, pel, ty, tz, out) {
    const H = LEG[side].H;
    const vy = ty - pel.y, vz = tz - pel.z;
    const c = Math.cos(pel.pitch), sn = Math.sin(pel.pitch);
    const ly = vy * c + vz * sn, lz = -vy * sn + vz * c;
    const dy = ly - (H[1] - PELV_Y), dz = lz - H[2];
    const dist = Math.min(Math.hypot(dy, dz), L1 + L2 - 0.002);
    const pd = Math.atan2(dz, -dy);
    const ca = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
    const p1 = pd + Math.acos(ca);
    const ky = -L1 * Math.cos(p1), kz = L1 * Math.sin(p1);
    const p2 = Math.atan2(dz - kz, -(dy - ky));
    out.thigh = -(p1 - P1R); out.shin = -((p2 - p1) - (P2R - P1R)); out.foot = -(pel.pitch + out.thigh + out.shin);
    return out;
  }
  const _ikR = {}, _ikL = {}, _pel = { x: 0, y: PELV_Y, z: 0, pitch: 0 };
  const FLY_POSE = { thigh: [0.18, 0.12], shin: [0.32, 0.42], foot: [0.45, 0.45] };
  const _pose = {};
  const mixA = (a, b, k) => a + (b - a) * k;

  function buildHero(scene) {
    const body = makeBody(true, true, true);
    const rig = body.userData.rig;
    const root = new THREE.Group(); root.name = 'hero';
    const lean = new THREE.Group(); lean.position.y = 7.0; root.add(lean);
    body.position.y = -7.0; lean.add(body);
    scene.add(root);

    const shTex = decalTexture(256, (c, s) => {
      const gr = c.createRadialGradient(s / 2, s / 2, s * 0.04, s / 2, s / 2, s * 0.5);
      gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.40)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr; c.fillRect(0, 0, s, s);
    });
    const shMat = op => new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, color: 0x000000, opacity: op });
    const pads = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), shMat(0.9)); m.rotation.x = -Math.PI / 2; m.renderOrder = 3; scene.add(m); return m; });
    const under = new THREE.Mesh(new THREE.PlaneGeometry(13, 10), shMat(0.5)); under.rotation.x = -Math.PI / 2; under.renderOrder = 3; scene.add(under);

    const thr = [];
    for (const s of [1, -1]) {
      const p = new THREE.Object3D(); p.position.set(s * 2.2, 13.0, -3.9); body.add(p);
      const q = new THREE.Object3D(); q.position.set(s * 2.2, 11.0, -4.14); body.add(q);
      thr.push({ p, q });
    }
    root.userData.thr = thr;
    root.userData.pathAt = (t, out) => Film.heroAt(t, out);
    root.userData.thrust = t => Film.sstep(Film.LAUNCH_T0 + 0.25, Film.LAUNCH_T0 + 0.6, t);

    const T = Film.T, _q = new THREE.Quaternion(), _qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), _w = V3();
    const ANK_Y = { R: LEG.R.A[1], L: LEG.L.A[1] }, ANK_Z = { R: LEG.R.A[2], L: LEG.L.A[2] };
    const LEAVE = Film.LAUNCH_T0 + Film.LAUNCH_DUR;
    function drive(t) {
      const fm = Film.flightMix(t), cm = Film.crouchMix(t);

      Film.heroAt(t, root.position);
      if (t < LEAVE) root.quaternion.copy(_qy);
      else { Film.frameAt(Film.heroAt, t, _q); root.quaternion.copy(_qy).slerp(_q, Film.sstep(LEAVE, LEAVE + 0.8, t)); }

      const awake = Film.sstep(T.WAKE + 0.2, T.WAKE + 2.6, t);
      const breathe = Math.sin(t * 1.15) * 0.012;
      const w = Film.heroWalk(t);

      const drop = 0.18 + w.bob + cm * 1.15;
      _pel.x = w.sway; _pel.y = PELV_Y - drop; _pel.z = cm * 0.25; _pel.pitch = cm * 0.10 + (1 - awake) * 0.05;

      legIK('R', _pel, ANK_Y.R + w.R.lift, ANK_Z.R + (w.R.z - w.fwd), _ikR);
      legIK('L', _pel, ANK_Y.L + w.L.lift, ANK_Z.L + (w.L.z - w.fwd), _ikL);
      if (w.R.u >= 0) _ikR.foot -= 0.22 * Math.sin(Math.PI * w.R.u);
      if (w.L.u >= 0) _ikL.foot -= 0.22 * Math.sin(Math.PI * w.L.u);

      const stride = (w.R.z - w.L.z) / 3;
      const P = _pose;
      P.thighR = [mixA(_ikR.thigh, FLY_POSE.thigh[0], fm), 0, 0]; P.shinR = [mixA(_ikR.shin, FLY_POSE.shin[0], fm), 0, 0]; P.footR = [mixA(_ikR.foot, FLY_POSE.foot[0], fm), 0, 0];
      P.thighL = [mixA(_ikL.thigh, FLY_POSE.thigh[1], fm), 0, 0]; P.shinL = [mixA(_ikL.shin, FLY_POSE.shin[1], fm), 0, 0]; P.footL = [mixA(_ikL.foot, FLY_POSE.foot[1], fm), 0, 0];
      P.pelvis = [_pel.pitch * (1 - fm), 0, 0];
      P.torso = [0.07 + breathe + (1 - awake) * 0.09 + cm * 0.20 + fm * 0.05, stride * 0.05, 0];

      P.armR = [mixA(0.15 * stride - cm * 0.10 + (1 - awake) * 0.05, 0.32, fm), 0, mixA(cm * 0.12, 0.16, fm)];
      P.armL = [mixA(-0.15 * stride - cm * 0.10 + (1 - awake) * 0.05, 0.32, fm), 0, mixA(-cm * 0.12, -0.16, fm)];
      P.foreR = [mixA(-0.10 - cm * 0.30, -0.22, fm), 0, 0]; P.foreL = [mixA(-0.10 - cm * 0.30, -0.22, fm), 0, 0];
      P.handR = null; P.handL = null;
      P.drop = drop; P.fwd = _pel.z;
      rig.setPose(P);
      rig.j.pelvis.position.x = _pel.x * (1 - fm);
      lean.rotation.x = fm * 1.45;

      for (let g = 0; g < 4; g++) {
        const a0 = T.WAKE + 0.6 + g * 0.85, on = Film.sstep(a0, a0 + 0.35, t);
        const flick = (t > a0 && t < a0 + 0.5) ? (0.55 + 0.45 * (Math.sin(t * 61 + g) > 0 ? 1 : 0)) : 1;
        HLIGHT[g].color.setRGB(1.0, 0.62, 0.30).multiplyScalar(0.06 + on * flick * (2.8 + 0.5 * Math.sin(t * 1.3 + g)));
      }

      root.updateMatrixWorld(true);
      const ground = 1 - Film.sstep(Film.LAUNCH_T0 + 0.6, Film.LAUNCH_T0 + 1.0, t);
      for (let k = 0; k < 2; k++) {
        const sd = k === 0 ? 'R' : 'L', f = k === 0 ? w.R : w.L;
        _w.set(LEG[sd].A[0], 0, ANK_Z[sd] + (f.z - w.fwd) + 0.3); body.localToWorld(_w);
        pads[k].position.set(_w.x, Film.DECK + 0.02, _w.z); pads[k].material.opacity = 0.9 * ground * (1 - clamp(f.lift / 0.8));
      }
      under.position.set(root.position.x, Film.DECK + 0.02, root.position.z); under.material.opacity = 0.5 * ground;
    }
    drive(0);
    return { root, drive, rig };
  }

  function buildFlier(i) {
    const body = makeBody(true, false);
    const rig = body.userData.rig;
    rig.setPose({ thighR: [0.18, 0, 0], thighL: [0.12, 0, 0], shinR: [0.32, 0, 0], shinL: [0.42, 0, 0], footR: [0.45, 0, 0], footL: [0.45, 0, 0],
      armR: [0.32, 0, 0.16], armL: [0.32, 0, -0.16], foreR: [-0.22, 0, 0], foreL: [-0.22, 0, 0], torso: [0.12, 0, 0], drop: 0 });
    const holder = new THREE.Group();
    const lean = new THREE.Group(); lean.position.y = 7.0; lean.rotation.x = 1.45; holder.add(lean);
    body.position.y = -7.0; lean.add(body);
    const thr = [];
    for (const s of [1, -1]) {
      const p = new THREE.Object3D(); p.position.set(s * 2.2, 13.0, -3.9); body.add(p);
      const q = new THREE.Object3D(); q.position.set(s * 2.2, 11.0, -4.14); body.add(q);
      thr.push({ p, q });
    }
    holder.userData.thr = thr;
    holder.userData.pathAt = (t, out) => Film.squadAt(i, t, out);
    holder.userData.thrust = () => 1;
    const _q = new THREE.Quaternion();
    holder.userData.drive = t => {
      Film.squadAt(i, t, holder.position);
      Film.frameAt(holder.userData.pathAt, t, _q); holder.quaternion.copy(_q);
      const fl = Math.sin(t * 0.9 + i * 1.3);
      rig.j.armR.rotation.x = 0.32 + 0.04 * fl; rig.j.armL.rotation.x = 0.32 - 0.04 * fl;
    };
    return holder;
  }

  return { buildHero, buildFlier, uGlow };
})();
