'use strict';

const Ship = (() => {
  const DECK_Y = 39.5;
  const g = { guns: [], engines: [], heads: [], deckY: DECK_Y };
  const M = {};
  let group, staticG, radar, beacon;
  const V = new THREE.Vector3(), TMPV = new THREE.Vector3(), TMPM = new THREE.Matrix4(), TMPQ = new THREE.Quaternion();
  const ZAX = new THREE.Vector3(0, 0, 1), YAX = new THREE.Vector3(0, 1, 0);

  function shipMat(color, { metal = 0.55, rough = 0.46, win = 0, pscale = 1, key = 'hull', chip = 0.5 } = {}) {
    const m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
    patch(m, api => {
      api.vHead('varying vec3 vWp; varying vec3 vWn;');
      api.v('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = vec4(transformed, 1.0); vec3 onrm = objectNormal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp; onrm = mat3(instanceMatrix) * onrm;
        #endif
        wp = modelMatrix * wp; vWp = wp.xyz; vWn = normalize(mat3(modelMatrix) * onrm);`);
      api.fHead(`${GLSL_NOISE}
        varying vec3 vWp; varying vec3 vWn;
        float hLine(vec2 p, float s, float w){
          vec2 q = p * s; vec2 f = abs(fract(q) - 0.5);
          float aa = fwidth(q.x) + fwidth(q.y) + 1e-5;
          return smoothstep(0.5 - w - aa, 0.5 - w + aa, max(f.x, f.y));
        }
        float winGrid(vec2 p){
          vec2 q = p / vec2(1.45, 0.48); vec2 cell = floor(q); vec2 f = fract(q);
          float on = step(0.86, hash21(cell + 7.3));
          float wnd = smoothstep(0.14, 0.24, f.x) * (1.0 - smoothstep(0.76, 0.86, f.x)) * smoothstep(0.24, 0.34, f.y) * (1.0 - smoothstep(0.66, 0.76, f.y));
          float aa = clamp(1.0 - max(fwidth(q.x), fwidth(q.y)) * 1.2, 0.0, 1.0);
          return on * wnd * aa;
        }`);
      api.f('#include <color_fragment>', `#include <color_fragment>
        float PSC = ${pscale.toFixed(3)};
        vec3 wn = normalize(vWn); vec3 aw = abs(wn); aw /= (aw.x + aw.y + aw.z + 1e-5);
        float li  = hLine(vWp.zy, 0.070 * PSC, 0.016) * aw.x + hLine(vWp.xz, 0.062 * PSC, 0.016) * aw.y + hLine(vWp.xy, 0.070 * PSC, 0.016) * aw.z;
        float li2 = hLine(vWp.zy, 0.285 * PSC, 0.014) * aw.x + hLine(vWp.xz, 0.255 * PSC, 0.014) * aw.y + hLine(vWp.xy, 0.285 * PSC, 0.014) * aw.z;
        float li3 = hLine(vWp.zy, 1.15 * PSC, 0.020) * aw.x + hLine(vWp.xz, 1.05 * PSC, 0.020) * aw.y + hLine(vWp.xy, 1.15 * PSC, 0.020) * aw.z;
        diffuseColor.rgb *= 1.0 - 0.30 * li - 0.13 * li2 - 0.055 * li3;
        float plateTone = hash31(floor(vWp * (0.11 * PSC))) - 0.5;
        diffuseColor.rgb *= 1.0 + 0.20 * plateTone;
        float grime = fbm3(vWp * vec3(0.075, 0.030, 0.075));
        diffuseColor.rgb *= mix(0.72, 1.06, smoothstep(0.24, 0.82, grime));
        float streak = fbm2(vec2((vWp.x + vWp.z) * 1.55, vWp.y * 0.055));
        diffuseColor.rgb *= mix(0.90, 1.0, smoothstep(0.30, 0.72, streak));
        float pits = smoothstep(0.72, 0.82, fbm3(vWp * 8.6 + 2.0));
        diffuseColor.rgb *= 1.0 - 0.20 * pits;
        float chip = smoothstep(0.828, 0.880, fbm3(vWp * 5.2 + 8.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.25, 0.30, 0.32), chip * ${chip.toFixed(2)});
        float wear = pow(1.0 - abs(dot(wn, normalize(cameraPosition - vWp))), 3.2) * (0.35 + 0.65 * fbm3(vWp * 2.4));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.50, 0.58, 0.60), wear * 0.14);
        vec2 rv = vWp.zy * 1.05; vec2 rc = floor(rv);
        float rivet = step(0.90, hash21(rc + 3.1)) * smoothstep(0.44, 0.30, length(fract(rv) - 0.5)) * aw.x;
        diffuseColor.rgb *= 1.0 + rivet * 0.30;`);
      api.f('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float rg = fbm3(vWp * vec3(0.24, 0.17, 0.24) + 5.0);
        roughnessFactor = clamp(roughnessFactor * mix(0.76, 1.34, rg), 0.05, 1.0);
        roughnessFactor *= 1.0 - 0.20 * smoothstep(0.50, 0.90, grime);
        { vec3 dn = fwidth(normalize(vWn)); roughnessFactor = max(roughnessFactor, clamp(pow(dot(dn, dn), 0.333) * 1.6, 0.0, 1.0)); }   `);
      const winAmt = win;
      api.f('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float wg = winGrid(vWp.xy) * aw.z + winGrid(vWp.zy) * aw.x + winGrid(vWp.xz) * aw.y * 0.10;
        wg *= smoothstep(0.55, 0.30, aw.y);
        totalEmissiveRadiance += vec3(1.0, 0.55, 0.26) * wg * ${winAmt.toFixed(3)} * 3.6;
        totalEmissiveRadiance += vec3(0.34, 0.82, 1.0) * wg * ${(winAmt * 0.10).toFixed(3)} * 2.2;

        { vec3 Vd = normalize(cameraPosition - vWp); vec3 sd = vec3(${SUN.x.toFixed(3)}, ${SUN.y.toFixed(3)}, ${SUN.z.toFixed(3)});
          float fr = pow(1.0 - max(dot(wn, Vd), 0.0), 5.0);
          float rimL = fr * smoothstep(0.0, 0.55, dot(wn, sd)) * (0.35 + 0.65 * smoothstep(-0.3, 0.8, dot(-Vd, sd)));
          rimL *= smoothstep(0.80, 0.45, abs(wn.y));
          { vec3 dn = fwidth(wn); rimL *= 1.0 - clamp(pow(dot(dn, dn), 0.333) * 2.0, 0.0, 1.0); }
          totalEmissiveRadiance += vec3(1.0, 0.80, 0.58) * rimL * 0.9; }`);
    }, 'ship-' + key, {});
    return m;
  }

  const SECT = [
    [240, 1.5, 1.5, 0.5], [232, 8, 7, 0.8], [222, 17, 14, 1.5], [208, 28, 22, 3],
    [190, 36, 27, 4], [170, 41, 30, 5], [150, 43, 31, 5], [128, 42, 31, 5],
    [108, 39, 30, 4], [86, 35, 28, 3], [50, 33, 27, 2], [0, 33, 27, 1],
    [-50, 33, 27, 0], [-100, 32, 26, 0], [-145, 30, 25, 0], [-185, 27, 23, 0],
    [-215, 23, 20, 0], [-232, 19, 17, 0],
  ];
  function sect(x) {
    const C = SECT;
    if (x >= C[0][0]) return { w: C[0][1], h: C[0][2], yc: C[0][3] };
    for (let i = 0; i < C.length - 1; i++) {
      if (x >= C[i + 1][0]) {
        const a = C[i], b = C[i + 1], u = (a[0] - x) / (a[0] - b[0]), k = u * u * (3 - 2 * u);
        return { w: lerp(a[1], b[1], k), h: lerp(a[2], b[2], k), yc: lerp(a[3], b[3], k) };
      }
    }
    const L = C[C.length - 1]; return { w: L[1], h: L[2], yc: L[3] };
  }

  const RING = [[0, 1.0], [0.46, 0.97], [0.79, 0.84], [0.96, 0.52], [1.0, 0.12], [0.94, -0.30], [0.72, -0.64], [0.34, -0.90], [0, -1.0]];
  const RING_FULL = RING.concat(RING.slice(1, -1).reverse().map(p => [-p[0], p[1]]));
  const NU = RING_FULL.length;
  function ringPoint(x, u, out = V3()) {
    const p = sect(x), s = u * NU, i = Math.floor(s) % NU, f = s - Math.floor(s);
    const a = RING_FULL[i], b = RING_FULL[(i + 1) % NU];
    return out.set(x, p.yc + lerp(a[1], b[1], f) * p.h, lerp(a[0], b[0], f) * p.w);
  }
  function surfNormal(x, u, out = V3()) {
    const dx = 0.7, du = 0.006;
    ringPoint(x + dx, u, TMPV); const px = TMPV.clone();
    ringPoint(x - dx, u, TMPV); const mx = px.clone().sub(TMPV);
    ringPoint(x, u + du, TMPV); const pu = TMPV.clone();
    ringPoint(x, u - du, TMPV); const mu = pu.clone().sub(TMPV);
    return out.crossVectors(mu, mx).normalize();
  }
  function buildHull(mat) {
    const NX = 58, pos = [], idx = [];
    for (let i = 0; i <= NX; i++) {
      const x = lerp(240, -232, i / NX);
      for (let j = 0; j < NU; j++) { ringPoint(x, j / NU, TMPV); pos.push(TMPV.x, TMPV.y, TMPV.z); }
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NU; j++) {
      const a = i * NU + j, b = i * NU + (j + 1) % NU, c = (i + 1) * NU + j, d = (i + 1) * NU + (j + 1) % NU;
      idx.push(a, c, b, b, c, d);
    }
    const capA = pos.length / 3; pos.push(241, 1.0, 0);
    const capB = capA + 1; pos.push(-233, 1.0, 0);
    for (let j = 0; j < NU; j++) { idx.push(NX * NU + j, capA, NX * NU + (j + 1) % NU); idx.push(capB, j, (j + 1) % NU); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const flat = geo.toNonIndexed(); flat.computeVertexNormals();
    const m = new THREE.Mesh(flat, mat); m.castShadow = m.receiveShadow = true; return m;
  }

  function mergeGeos(geos) {
    let n = 0; for (const ge of geos) n += ge.attributes.position.count;
    const P2 = new Float32Array(n * 3), N2 = new Float32Array(n * 3), U2 = new Float32Array(n * 2);
    let o = 0;
    for (const ge of geos) {
      const c = ge.attributes.position.count;
      P2.set(ge.attributes.position.array, o * 3);
      if (ge.attributes.normal) N2.set(ge.attributes.normal.array, o * 3);
      if (ge.attributes.uv) U2.set(ge.attributes.uv.array, o * 2);
      o += c;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(P2, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(N2, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(U2, 2));
    return out;
  }
  function bake(root, cast = true) {
    root.updateMatrixWorld(true);
    const buckets = new Map(), del = [];
    root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || o.userData.noBake || !o.geometry || Array.isArray(o.material)) return;
      const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
      geo.applyMatrix4(o.matrixWorld);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      const key = o.material.uuid;
      if (!buckets.has(key)) buckets.set(key, { mat: o.material, list: [] });
      buckets.get(key).list.push(geo); del.push(o);
    });
    for (const o of del) if (o.parent) o.parent.remove(o);
    for (const { mat, list } of buckets.values()) {
      const mesh = new THREE.Mesh(mergeGeos(list), mat);
      mesh.castShadow = cast; mesh.receiveShadow = true; root.add(mesh);
      for (const ge of list) ge.dispose();
    }
  }

  function bakeTree(root, stop) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const buckets = new Map(), del = [];
    (function walk(o) {
      for (const c of o.children.slice()) {
        if (stop && stop.includes(c)) continue;
        if (c.isMesh && !c.isInstancedMesh && !c.userData.noBake) {
          const geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
          geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
          if (!geo.attributes.normal) geo.computeVertexNormals();
          if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
          const k = c.material.uuid;
          if (!buckets.has(k)) buckets.set(k, { mat: c.material, list: [] });
          buckets.get(k).list.push(geo); del.push(c);
        } else if (c.isGroup) walk(c);
      }
    })(root);
    for (const o of del) if (o.parent) o.parent.remove(o);
    for (const { mat, list } of buckets.values()) {
      const mesh = new THREE.Mesh(mergeGeos(list), mat); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
      for (const g of list) g.dispose();
    }
  }
  function plate(mat, w, h, d, r = 0.12, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(plateGeo(w, h, d, r), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m;
  }
  function bar(mat, w, h, d, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; }
  function cyl(mat, r1, r2, h, x, y, z, seg = 12) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; }
  function poly(parent, mat, pts, thick, x = 0, y = 0, z = 0, bevel = 0.05) {
    const shape = new THREE.Shape(); pts.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1]));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 });
    geo.translate(0, 0, -thick / 2);
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  }

  function hullPlate(parent, mat, w, h, d, x, u, lift = 0.2, spin = 0) {
    ringPoint(x, u, TMPV); const surf = TMPV.clone();
    surfNormal(x, u, TMPV); const nrm = TMPV.clone();
    const m = new THREE.Mesh(plateGeo(w, h, d, Math.min(w, h) * 0.10), mat);
    m.position.copy(surf).addScaledVector(nrm, lift + d * 0.5);
    TMPQ.setFromUnitVectors(ZAX, nrm);
    if (spin) TMPQ.multiply(new THREE.Quaternion().setFromAxisAngle(ZAX, spin));
    m.quaternion.copy(TMPQ); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  }

  const DECK = { x0: 122, x1: 197, halfW: 18.5 };
  function deckTexture() {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
    const x = c.getContext('2d'), W = 2048, H = 1024, rr = rng(SEED + 717);
    const X = v => (v - DECK.x0) / (DECK.x1 - DECK.x0) * W, Z = v => (v + DECK.halfW) / (DECK.halfW * 2) * H;
    x.clearRect(0, 0, W, H);
    for (let i = 0; i < 1100; i++) {
      const px = rr() * W, py = rr() * H, w = 24 + rr() * 130, h = 10 + rr() * 54;
      x.fillStyle = `rgba(${8 + rr() * 22 | 0},${18 + rr() * 26 | 0},${20 + rr() * 24 | 0},${0.22 + rr() * 0.34})`;
      x.fillRect(px, py, w, h);
    }

    for (let gx = DECK.x0 + 8; gx < DECK.x1; gx += 9) {
      x.strokeStyle = 'rgba(6,10,11,0.62)'; x.lineWidth = 3; x.beginPath(); x.moveTo(X(gx), 0); x.lineTo(X(gx + 2), H); x.stroke();
    }
    for (let gz = -DECK.halfW + 5; gz < DECK.halfW; gz += 7) {
      x.strokeStyle = 'rgba(6,10,11,0.42)'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, Z(gz)); x.lineTo(W, Z(gz + 1)); x.stroke();
    }

    for (const s of [1, -1]) {
      x.strokeStyle = 'rgba(226,235,232,0.24)'; x.lineWidth = 6;
      x.beginPath(); x.moveTo(X(DECK.x0 + 4), Z(s * (DECK.halfW - 3.4))); x.lineTo(X(DECK.x1 - 4), Z(s * (DECK.halfW - 3.4))); x.stroke();
      x.strokeStyle = 'rgba(228,96,34,0.34)'; x.lineWidth = 4;
      x.beginPath(); x.moveTo(X(DECK.x0 + 10), Z(s * (DECK.halfW - 6.0))); x.lineTo(X(DECK.x1 - 12), Z(s * (DECK.halfW - 6.0))); x.stroke();
    }

    x.fillStyle = 'rgba(66,80,82,0.92)'; x.fillRect(X(126), Z(-1.8), X(191) - X(126), Z(1.8) - Z(-1.8));
    x.strokeStyle = 'rgba(232,146,58,0.36)'; x.lineWidth = 4;
    x.beginPath(); x.moveTo(X(128), Z(-1.4)); x.lineTo(X(190), Z(-1.4)); x.stroke();
    x.beginPath(); x.moveTo(X(128), Z(1.4)); x.lineTo(X(190), Z(1.4)); x.stroke();
    for (let gx = 128; gx < 190; gx += 2.2) { x.strokeStyle = 'rgba(120,138,138,0.42)'; x.lineWidth = 2; x.beginPath(); x.moveTo(X(gx), Z(-1.8)); x.lineTo(X(gx), Z(1.8)); x.stroke(); }

    x.strokeStyle = 'rgba(224,236,232,0.24)'; x.lineWidth = 6; x.strokeRect(X(144), Z(-9.5), X(177) - X(144), Z(9.5) - Z(-9.5));
    x.fillStyle = 'rgba(226,238,232,0.30)'; x.font = 'bold 108px "Arial Black", Arial'; x.textAlign = 'center';
    x.fillText('09', X(160.5), Z(9.2));
    x.font = 'bold 36px "Arial Narrow", Arial'; x.fillStyle = 'rgba(226,238,232,0.30)';
    x.fillText('MF-07 // ZHEN XING', X(160.5), Z(13.0));
    x.font = 'bold 30px "Microsoft YaHei", sans-serif'; x.fillStyle = 'rgba(226,238,232,0.28)';
    x.fillText('第一舰载机甲队', X(160.5), Z(-12.5));

    x.save(); x.beginPath(); x.rect(X(183), Z(-11), X(194) - X(183), Z(11) - Z(-11)); x.clip();
    for (let i = -20; i < 40; i++) { x.fillStyle = i % 2 ? 'rgba(232,150,48,0.62)' : 'rgba(18,20,20,0.9)'; x.save(); x.translate(X(183) + i * 14, 0); x.transform(1, 0, -0.4, 1, 0, 0); x.fillRect(0, Z(-11), 15, Z(11) - Z(-11)); x.restore(); }
    x.restore();
    x.fillStyle = 'rgba(16,20,21,0.92)'; x.fillRect(X(185), Z(-9), X(193) - X(185), Z(9) - Z(-9));
    x.strokeStyle = 'rgba(226,144,54,0.58)'; x.lineWidth = 5; x.strokeRect(X(185), Z(-9), X(193) - X(185), Z(9) - Z(-9));

    for (let i = 0; i < 70; i++) {
      const px = X(DECK.x0 + rr() * (DECK.x1 - DECK.x0)), py = Z(-DECK.halfW + rr() * DECK.halfW * 2);
      const gr = x.createRadialGradient(px, py, 2, px, py, 18 + rr() * 60);
      gr.addColorStop(0, `rgba(5,7,8,${0.20 + rr() * 0.34})`); gr.addColorStop(1, 'rgba(5,7,8,0)');
      x.fillStyle = gr; x.fillRect(px - 90, py - 90, 180, 180);
    }
    for (let i = 0; i < 12; i++) {
      x.strokeStyle = `rgba(10,12,12,${0.18 + rr() * 0.25})`; x.lineWidth = 2 + rr() * 6;
      x.beginPath(); x.moveTo(X(126), Z(-10 + rr() * 20)); x.lineTo(X(188), Z(-10 + rr() * 20)); x.stroke();
    }

    x.fillStyle = 'rgba(224,236,232,0.40)'; x.font = 'bold 20px Arial'; x.textAlign = 'left';
    x.fillText('CAUTION · JET BLAST', X(130), Z(-15.2));
    x.fillText('TIE-DOWN 12', X(130), Z(16.0));
    x.fillText('ELEV 2', X(186), Z(15.0));
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; return tex;
  }

  function deckBaseTexture() {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
    const x = c.getContext('2d'), W = 2048, H = 1024, rr = rng(SEED + 729);
    x.fillStyle = '#3a5054'; x.fillRect(0, 0, W, H);

    let g = x.createRadialGradient(W * 0.54, H * 0.52, 40, W * 0.54, H * 0.52, W * 0.46);
    g.addColorStop(0, 'rgba(255,188,130,0.38)'); g.addColorStop(0.35, 'rgba(180,150,120,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(8,20,24,0.5)'); g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(8,20,24,0.62)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);

    for (let gx = 0; gx < W; gx += 64) { x.strokeStyle = 'rgba(4,9,10,0.65)'; x.lineWidth = 3; x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, H); x.stroke(); }
    for (let gy = 0; gy < H; gy += 58) { x.strokeStyle = 'rgba(4,9,10,0.42)'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke(); }
    for (let i = 0; i < 1300; i++) {
      const px = rr() * W, py = rr() * H, w = 20 + rr() * 120, h = 10 + rr() * 40;
      x.fillStyle = `rgba(${16 + rr() * 26 | 0},${30 + rr() * 26 | 0},${34 + rr() * 24 | 0},${0.10 + rr() * 0.20})`;
      x.fillRect(px, py, w, h);
    }

    for (let i = 0; i < 40; i++) {
      const px = rr() * W, py = rr() * H, r = 12 + rr() * 50;
      const gr = x.createRadialGradient(px, py, 1, px, py, r);
      gr.addColorStop(0, 'rgba(4,6,7,0.30)'); gr.addColorStop(1, 'rgba(4,6,7,0)');
      x.fillStyle = gr; x.fillRect(px - r, py - r, r * 2, r * 2);
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; return tex;
  }
  function deckShape() {
    const s = new THREE.Shape(), x0 = DECK.x0, x1 = DECK.x1, w = DECK.halfW - 1.2;
    s.moveTo(x0 - 1.6, -w + 2.4); s.lineTo(x0 + 2.0, -w); s.lineTo(x1 - 3.0, -w); s.lineTo(x1, -w + 3.0);
    s.lineTo(x1, w - 3.0); s.lineTo(x1 - 3.0, w); s.lineTo(x0 + 2.0, w); s.lineTo(x0 - 1.6, w - 2.4); s.closePath();
    return s;
  }
  function buildDeckLegs(matTrim, matDark, matAmber, matCyan, matHazard) {
    const G = new THREE.Group();

    G.add(plate(matDark, DECK.x1 - DECK.x0 - 3, 4.0, DECK.halfW * 2 - 3, 0.5, (DECK.x0 + DECK.x1) / 2, DECK_Y - 2.85, 0));
    for (const s of [1, -1]) {
      for (let i = 0; i < 4; i++) {
        const x = DECK.x0 + 8 + i * 18;
        const b = bar(matTrim, 1.0, 5.0, 1.0, x, DECK_Y - 3.0, s * (DECK.halfW - 3.4)); b.rotation.x = s * 0.10; G.add(b);
      }
      G.add(bar(matHazard, DECK.x1 - DECK.x0 - 8, 0.35, 0.16, (DECK.x0 + DECK.x1) / 2, DECK_Y - 5.0, s * (DECK.halfW - 1.2)));
    }

    const shape = deckShape();
    const top = new THREE.ShapeGeometry(shape, 2); top.rotateX(-Math.PI / 2);
    const pos = top.attributes.position, uv = [];
    for (let i = 0; i < pos.count; i++) uv.push((pos.getX(i) - DECK.x0) / (DECK.x1 - DECK.x0), (pos.getZ(i) + DECK.halfW) / (DECK.halfW * 2));
    top.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));

    const baseTex = deckBaseTexture();
    const markTex = deckTexture();
    const bc = baseTex.image.getContext('2d');
    bc.globalAlpha = 0.55; bc.drawImage(markTex.image, 0, 0); bc.globalAlpha = 1;
    const composed = new THREE.CanvasTexture(baseTex.image); composed.colorSpace = THREE.SRGBColorSpace; composed.anisotropy = 8;
    const deckTopMat = new THREE.MeshLambertMaterial({ map: composed, emissive: 0x0a1416, emissiveIntensity: 0.24 });
    const topMesh = new THREE.Mesh(top, deckTopMat); topMesh.position.y = DECK_Y + 0.09; topMesh.receiveShadow = true; topMesh.userData.noBake = true; G.add(topMesh);

    const eG = new THREE.Group();
    for (const s of [1, -1]) {
      eG.add(bar(matTrim, DECK.x1 - DECK.x0 + 1.2, 1.6, 0.9, (DECK.x0 + DECK.x1) / 2, DECK_Y - 0.55, s * (DECK.halfW + 0.35)));
      eG.add(bar(matDark, DECK.x1 - DECK.x0 + 1.2, 0.25, 1.35, (DECK.x0 + DECK.x1) / 2, DECK_Y + 0.30, s * (DECK.halfW + 0.30)));
      for (let i = 0; i < 30; i++) {
        const b = cyl(matTrim, 0.075, 0.075, 0.16, DECK.x0 + 2 + i * ((DECK.x1 - DECK.x0 - 4) / 29), DECK_Y - 0.15, s * (DECK.halfW + 0.82), 5);
        b.rotation.x = Math.PI / 2; eG.add(b);
      }
      for (let i = 0; i < 9; i++) {
        const x = DECK.x0 + 6 + i * ((DECK.x1 - DECK.x0 - 12) / 8);
        eG.add(bar(matTrim, 0.35, 1.4, 1.0, x, DECK_Y - 1.05, s * (DECK.halfW + 0.85)));
      }

      for (let i = 0; i < 24; i++) {
        const x = DECK.x0 + 2.4 + i * ((DECK.x1 - DECK.x0 - 4.8) / 23);
        eG.add(bar(i % 3 ? matTrim : matDark, 0.22, 1.45, 0.28, x, DECK_Y - 0.55, s * (DECK.halfW + 0.46)));
      }
    }
    G.add(eG);

    for (const s of [1, -1]) {
      G.add(bar(matTrim, DECK.x1 - DECK.x0 - 2, 0.9, 0.7, (DECK.x0 + DECK.x1) / 2, DECK_Y + 0.1, s * DECK.halfW));
      G.add(bar(matHazard, DECK.x1 - DECK.x0 - 8, 0.24, 0.30, (DECK.x0 + DECK.x1) / 2, DECK_Y + 0.62, s * (DECK.halfW - 0.4)));
      for (let i = 0; i < 12; i++) G.add(plate(matAmber, 0.55, 0.10, 0.22, 0.02, DECK.x0 + 6 + i * 6.6, DECK_Y + 0.62, s * (DECK.halfW - 0.5)));

      G.add(bar(matTrim, DECK.x1 - DECK.x0 - 4, 0.17, 0.17, (DECK.x0 + DECK.x1) / 2, DECK_Y + 2.0, s * (DECK.halfW - 0.4)));
      for (let i = 0; i < 24; i++) G.add(bar(matTrim, 0.13, 1.5, 0.13, DECK.x0 + 3 + i * 3.1, DECK_Y + 1.15, s * (DECK.halfW - 0.4)));

      G.add(bar(matTrim, 0.20, 2.5, 0.20, DECK.x1 - 2.0, DECK_Y + 1.25, s * (DECK.halfW - 0.4)));
      const endBrace = bar(matTrim, 0.13, 2.6, 0.13, DECK.x1 - 0.6, DECK_Y + 0.65, s * (DECK.halfW - 0.4));
      endBrace.rotation.z = -0.52; G.add(endBrace);
    }

    for (const s of [1, -1]) {
      const d = new THREE.Group(); d.position.set(DECK.x0 + 6.5, DECK_Y + 4.6, s * 6.0); d.rotation.z = -0.90;
      d.add(plate(matTrim, 12, 8.0, 0.7, 0.22, 0, 0, 0));
      for (let i = 0; i < 4; i++) d.add(bar(matTrim, 0.4, 7.4, 0.32, -4.6 + i * 3.0, 0, 0.46));
      d.add(plate(matHazard, 11.2, 0.8, 0.14, 0.03, 0, -3.6, 0.40));
      d.add(plate(matDark, 10.2, 5.8, 0.10, 0.04, 0, 0.2, 0.40));
      G.add(d);
    }

    const rr = rng(SEED + 733);
    for (let i = 0; i < 22; i++) {
      const s = i % 2 ? 1 : -1;
      G.add(plate(matTrim, 0.55, 0.12, 0.55, 0.04, DECK.x0 + 5 + rr() * (DECK.x1 - DECK.x0 - 10), DECK_Y + 0.10, s * (7 + rr() * 8)));
    }
    for (let i = 0; i < 7; i++) {
      const x = DECK.x0 + 10 + rr() * 26, z = (i % 2 ? 1 : -1) * (10 + rr() * 5);
      G.add(bar(matTrim, 1.4, 1.0, 1.0, x, DECK_Y + 0.5, z));
      G.add(bar(matHazard, 0.32, 0.10, 0.32, x, DECK_Y + 1.03, z));
    }

    for (const [x, s] of [[DECK.x0 + 3, 1], [DECK.x0 + 3, -1], [DECK.x1 - 3, 1], [DECK.x1 - 3, -1]]) {
      const z = s * (DECK.halfW - 1.6);
      G.add(cyl(matTrim, 0.16, 0.26, 4.6, x, DECK_Y + 2.3, z, 8));
      const head = new THREE.Group(); head.position.set(x, DECK_Y + 4.7, z); G.add(head);
      head.add(plate(matTrim, 1.4, 0.8, 0.9, 0.10, 0, 0, 0));
      head.add(plate(matAmber, 0.95, 0.34, 0.10, 0.03, 0, -0.12, s * 0.46));
      head.rotation.y = -s * 0.35;
    }

    const crane = new THREE.Group(); crane.position.set(DECK.x0 + 62, DECK_Y, -12);
    crane.add(cyl(matTrim, 1.1, 1.5, 2.2, 0, 1.1, 0, 8));
    const arm = plate(matTrim, 13, 0.65, 1.1, 0.12, 5.2, 2.0, 0); arm.rotation.z = 0.24; crane.add(arm);
    crane.add(bar(matTrim, 0.14, 4.2, 0.14, 10.6, 0.8, 0));
    crane.add(plate(matDark, 0.7, 0.7, 0.7, 0.08, 10.6, -1.5, 0));
    G.add(crane);

    G.add(plate(matDark, 7.4, 0.18, 16.5, 0.06, 189, DECK_Y + 0.06, 0));
    for (const s of [1, -1]) G.add(bar(matHazard, 8.2, 0.10, 0.5, 189, DECK_Y + 0.14, s * 8.4));
    G.add(bar(matCyan, 6.4, 0.06, 0.22, 189, DECK_Y + 0.13, 0));

    const suit = new THREE.MeshStandardMaterial({ color: 0x1a2327, roughness: 0.86, metalness: 0.15 });

    const shadowTex = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const c2 = cv.getContext('2d'), rg = c2.createRadialGradient(64, 64, 2, 64, 64, 62);
      rg.addColorStop(0, 'rgba(0,0,0,0.58)'); rg.addColorStop(0.55, 'rgba(0,0,0,0.26)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      c2.fillStyle = rg; c2.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; return t;
    })();
    const drop = (x, z, w, d, op = 0.5) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: 0x000000, opacity: op }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, DECK_Y + 0.105, z); m.renderOrder = 2; G.add(m);
    };
    const crew = (x, z, ry, tone = 0, pose = 0) => {
      drop(x, z, 1.5, 1.0, 0.46);
      const g = new THREE.Group(); g.position.set(x, DECK_Y + 0.10, z); g.rotation.y = ry + pose * 0.21;
      const l1 = cyl(suit, 0.09, 0.12, 0.62, 0.09, 0.31, 0, 6); l1.rotation.z = 0.14 + pose * 0.08; g.add(l1);
      const l2 = cyl(suit, 0.09, 0.12, 0.62, -0.09, 0.31, 0, 6); l2.rotation.z = -0.10 - pose * 0.05; g.add(l2);
      const torso = cyl(suit, 0.19, 0.16, 0.60, 0, 0.88, 0, 7); torso.rotation.z = (pose % 2 ? -0.06 : 0.04); g.add(torso);
      g.add(plate(matHazard, 0.30, 0.26, 0.20, 0.03, 0, 0.95, 0.10 + pose * 0.02));
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.125, 8, 6), M.collar); h.position.set(0, 1.29, 0); h.rotation.y = pose * 0.5; g.add(h);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), tone ? matAmber : matCyan); lamp.position.set(0.07, 1.31, 0.07); g.add(lamp);
      const a1 = cyl(suit, 0.055, 0.065, 0.52, 0.22, 0.98, 0.04, 5); a1.rotation.z = 0.32 + pose * 0.30; a1.rotation.x = pose * 0.25; g.add(a1);
      const a2 = cyl(suit, 0.055, 0.065, 0.50, -0.20, 0.96, 0.02, 5); a2.rotation.z = -0.18 - pose * 0.16; a2.rotation.x = -pose * 0.18; g.add(a2);
      G.add(g);
    };

    const tug = new THREE.Group(); tug.position.set(148.0, DECK_Y + 0.10, -9.0); tug.rotation.y = 0.40;
    drop(148.0, -9.0, 5.6, 3.6, 0.62);
    const tb = plate(M.armorDark, 4.0, 1.3, 2.1, 0.20, 0, 0.95, 0); tug.add(tb);
    tug.add(plate(M.armorDark, 1.5, 1.0, 1.6, 0.15, 0.9, 1.55, 0));
    tug.add(plate(M.dark, 1.0, 0.55, 0.10, 0.03, 0.9, 1.7, 0.88));
    for (const sx of [-1.4, 1.4]) for (const sz of [-1.0, 1.0]) {
      const wh = cyl(M.dark, 0.55, 0.55, 0.45, sx, 0.55, sz, 10); wh.rotation.x = Math.PI / 2; tug.add(wh);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), matAmber); beacon.position.set(0.9, 2.25, 0); tug.add(beacon);
    G.add(tug);

    const cont = (x, z, ry, mat, hzA) => {
      const g2 = new THREE.Group(); g2.position.set(x, DECK_Y + 0.10, z); g2.rotation.y = ry;
      g2.add(plate(mat, 4.4, 2.4, 2.3, 0.16, 0, 1.3, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g2.add(bar(matDark, 0.20, 2.5, 0.20, sx * 2.05, 1.3, sz * 1.0));
      g2.add(bar(matDark, 4.5, 0.18, 2.35, 0, 2.48, 0));
      g2.add(bar(hzA, 4.0, 0.35, 0.14, 0, 1.9, 1.17));
      g2.add(plate(matTrim, 1.6, 0.9, 0.08, 0.03, 0.5, 1.2, 1.18));
      G.add(g2); drop(x, z, 5.2, 3.2, 0.58);
    };
    cont(192.2, -10.4, 0.10, M.armorDark, matHazard);
    cont(192.6, -4.2, -0.06, M.armor, matHazard);
    cont(176.5, -13.0, 0.15, M.armor, matHazard);
    cont(181.0, -8.5, -0.20, M.armorDark, matHazard);

    const mast = new THREE.Group(); mast.position.set(137, DECK_Y, -11.0);
    mast.add(cyl(matTrim, 0.16, 0.24, 6.0, 0, 3.0, 0, 8));
    mast.add(bar(matTrim, 2.2, 0.14, 0.14, 0.8, 5.8, 0));
    const headLamp = plate(matDark, 1.1, 0.7, 0.8, 0.08, 1.8, 5.5, 0); headLamp.rotation.z = -0.22; mast.add(headLamp);
    mast.add(plate(matAmber, 0.85, 0.28, 0.08, 0.02, 1.95, 5.38, 0.41));
    G.add(mast);
    drop(137, -11.0, 1.7, 1.7, 0.40);
    return G;
  }

  function buildCitadel(matHull, matTrim, matAmber, matDark, matCyan, matHazard, matLight) {
    const G = new THREE.Group(); G.position.set(98, 0, 0);
    const y0 = sect(98).yc + sect(98).h;
    G.add(plate(matTrim, 26, 3.0, 20, 0.5, 0, y0 + 1.5, 0));

    const body = plate(matHull, 22, 9.0, 15, 0.7, 0, y0 + 7.2, 0); G.add(body);
    const nose = poly(G, matHull, [[-3.6, -4.5], [3.6, -4.0], [4.4, 1.8], [2.0, 4.5], [-4.2, 4.2], [-4.6, -1.0]], 14.4, 12.1, y0 + 7.2, 0, 0.30);
    nose.rotation.y = Math.PI / 2;

    G.add(plate(matDark, 0.5, 2.0, 9.0, 0.06, 11.4, y0 + 8.4, 0));
    G.add(plate(matAmber, 0.14, 0.5, 8.2, 0.02, 11.7, y0 + 8.5, 0));
    G.add(plate(matCyan, 0.14, 0.22, 8.2, 0.02, 11.7, y0 + 7.7, 0));
    for (let i = 0; i < 7; i++) G.add(bar(matDark, 0.2, 2.0, 0.16, 11.6, y0 + 8.4, -3.6 + i * 1.2));

    for (const s of [1, -1]) {
      G.add(plate(matDark, 15, 1.6, 0.4, 0.04, -1, y0 + 7.8, s * 7.7));
      G.add(plate(matAmber, 12, 0.36, 0.12, 0.02, -1, y0 + 8.0, s * 7.95));
      for (let i = 0; i < 7; i++) G.add(bar(matDark, 0.14, 1.6, 0.2, -7 + i * 2.0, y0 + 7.8, s * 7.9));
    }

    G.add(plate(matHull, 16, 6.0, 11, 0.6, -1.0, y0 + 14.4, 0));
    G.add(plate(matDark, 0.4, 1.2, 8.0, 0.04, 7.2, y0 + 15.0, 0));
    G.add(plate(matAmber, 0.10, 0.28, 7.2, 0.02, 7.44, y0 + 15.0, 0));
    G.add(plate(matTrim, 12, 1.2, 8.0, 0.3, -1, y0 + 17.8, 0));

    for (const [dx, dz] of [[-4, -2.5], [-4, 2.5]]) {
      G.add(cyl(matTrim, 0.12, 0.22, 9.0, dx, y0 + 22.8, dz, 5));
      for (let i = 0; i < 3; i++) G.add(bar(matTrim, 3.6, 0.10, 0.10, dx + 1.6, y0 + 20.0 + i * 2.4, dz));
    }
    G.add(bar(matTrim, 8.4, 0.14, 0.14, -2.0, y0 + 25.8, 0));
    G.add(cyl(matTrim, 0.04, 0.09, 5.5, -2.0, y0 + 28.4, 0, 4));
    G.add(plate(matAmber, 0.30, 0.30, 0.30, 0.04, -2.0, y0 + 31.2, 0));

    for (let i = 0; i < 3; i++) {
      G.add(cyl(matTrim, 0.42, 0.42, 0.8, -8 + i * 6, y0 + 4.0, 7.8, 8));
      G.add(plate(matHazard, 1.0, 0.12, 0.16, 0.02, -8 + i * 6, y0 + 4.4, 7.6));
    }

    radar = new THREE.Group();
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.8, 18, 10, 0, TAU, 0, Math.PI * 0.42), matTrim);
    dish.rotation.x = -0.95; dish.castShadow = true; radar.add(dish);
    radar.add(cyl(matTrim, 0.16, 0.16, 1.7, 0, -0.85, 0, 6));
    radar.position.set(-1, y0 + 19.4, 0); G.add(radar);
    return G;
  }

  function tankCluster(cx, mats) {
    const G = new THREE.Group();
    const rr = rng(SEED + Math.round(cx * 7) + 900);
    const LEN = 108, R = 14.0;
    for (const sy of [1, -1]) for (const sz of [1, -1]) {
      const y = sy * 16.4, z = sz * 21.6;
      const tmat = (sy * sz < 0 && mats.tankB) ? mats.tankB : mats.tank;
      const cap = new THREE.Mesh(new THREE.CapsuleGeometry(R, LEN - R * 2, 10, 26), tmat);
      cap.rotation.z = Math.PI / 2; cap.position.set(cx, y, z); cap.castShadow = cap.receiveShadow = true; G.add(cap);

      for (const e of [-1, 1]) {
        const ring = cyl(mats.collar, R * 1.03, R * 1.03, 3.0, cx + e * (LEN / 2 - 5.5), y, z, 26);
        ring.rotation.z = Math.PI / 2; G.add(ring);
        const lip = cyl(mats.collar, R * 0.72, R * 1.02, 2.2, cx + e * (LEN / 2 - 2.2), y, z, 26);
        lip.rotation.z = e > 0 ? -Math.PI / 2 : Math.PI / 2; G.add(lip);
      }

      for (const e of [-1, 1]) for (let k = 0; k < 12; k++) {
        const a2 = k / 12 * TAU;
        const bl = cyl(mats.bolt, 0.16, 0.16, 0.36, cx + e * (LEN / 2 - 6.2), y + Math.cos(a2) * (R + 2.0), z + Math.sin(a2) * (R + 2.0), 5);
        bl.rotation.z = Math.PI / 2; bl.rotation.x = a2; G.add(bl);
      }

      const off = sy * 1.7 + sz * 2.4;
      const ringDefs = [
        [-LEN * 0.25 + off, 2.0 + (sy > 0 ? 0.3 : 0.0)],
        [-LEN * 0.02 + off * 0.6, 1.5],
        [LEN * 0.21 + off, 2.2 + (sz > 0 ? 0.2 : 0.0)],
      ];
      for (let ri = 0; ri < ringDefs.length; ri++) {
        const [dx, cw] = ringDefs[ri];
        const cmat = (ri === 1 && sy * sz < 0) ? mats.tankDark : mats.collar;
        const ring = cyl(cmat, R * 1.035, R * 1.035, cw, cx + dx, y, z, 26);
        ring.rotation.z = Math.PI / 2; G.add(ring);
        for (let k = 0; k < 4; k++) {
          const a = k / 4 * TAU + 0.3 + off * 0.2;
          const b = bar(cmat, 1.1, 0.45, 0.9, cx + dx, y + Math.cos(a) * (R + 0.5), z + Math.sin(a) * (R + 0.5));
          b.rotation.x = a; G.add(b);
        }
      }

      for (let k = 0; k < 4; k++) {
        const a = k / 4 * TAU + 0.35 + sy * 0.12;
        const rib = bar(k % 2 ? mats.collar : mats.tankDark, LEN * 0.72, 0.30, 0.46, cx, y + Math.cos(a) * (R + 0.12), z + Math.sin(a) * (R + 0.12));
        rib.rotation.x = a; G.add(rib);
      }

      G.add(bar(mats.hazard, 7.0, 1.05, 0.18, cx + 20 + off, y + 2.0, z + sz * (R + 0.20)));
      const sn = plate(mats.tankDark, 5.0, 1.6, 0.14, 0.03, cx - 14 + off, y + 2.0, z + sz * (R + 0.22));
      if (sz < 0) sn.rotation.y = Math.PI; G.add(sn);

      for (const dx of [-LEN * 0.36, -LEN * 0.12, LEN * 0.12, LEN * 0.36]) {
        const ring = cyl(mats.tankDark, R * 1.012, R * 1.012, 0.45, cx + dx + off * 0.4, y, z, 26);
        ring.rotation.z = Math.PI / 2; G.add(ring);
      }

      for (let k = 0; k < 5; k++) {
        const ang = (k / 5) * TAU + 0.5 + sy * 0.25;
        const hx = cx - 32 + k * 16;
        const hatch = cyl(mats.steel, 1.25, 1.25, 0.55, hx, y + Math.cos(ang) * (R + 0.25), z + Math.sin(ang) * (R + 0.25), 10);
        hatch.rotation.x = ang; hatch.rotation.z = Math.PI / 2; G.add(hatch);
        const hr = cyl(mats.tankDark, 1.45, 1.45, 0.22, hx, y + Math.cos(ang) * (R + 0.42), z + Math.sin(ang) * (R + 0.42), 10);
        hr.rotation.x = ang; hr.rotation.z = Math.PI / 2; G.add(hr);
        if (k % 2 === 0) {
          const vb = bar(mats.frame, 2.0, 1.5, 1.0, hx + 4, y + Math.cos(ang + 0.4) * (R + 1.1), z + Math.sin(ang + 0.4) * (R + 1.1));
          vb.rotation.x = ang + 0.4; G.add(vb);
        }
      }

      for (const hx of [-30, 0, 30]) {
        const hatch2 = cyl(mats.steel, 1.15, 1.15, 0.55, cx + hx + off * 0.5, y + 2.0, z + sz * (R + 0.22), 10);
        hatch2.rotation.x = Math.PI / 2; G.add(hatch2);
        const hr2 = cyl(mats.tankDark, 1.35, 1.35, 0.22, cx + hx + off * 0.5, y + 2.0, z + sz * (R + 0.40), 10);
        hr2.rotation.x = Math.PI / 2; G.add(hr2);
      }
      for (let k = 0; k < 4; k++) {
        const ang = k / 4 * TAU + 0.9;
        const pts2 = [];
        for (let i = 0; i <= 5; i++) pts2.push(new THREE.Vector3(cx - LEN / 2 + 8 + i * (LEN - 16) / 5, y + Math.cos(ang) * (R + 0.85), z + Math.sin(ang) * (R + 0.85)));
        G.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts2), 24, 0.24, 5, false), mats.pipe));
      }

      for (let k = 0; k < 2; k++) {
        const t = plate(mats.collar, 5.4, 2.2, 0.18, 0.05, cx - 24 + k * 34, y + (sy > 0 ? R - 0.4 : -R + 0.4), z + sz * (R * 0.35));
        t.rotation.x = sy > 0 ? -0.35 : 0.35; G.add(t);
      }

      const pts = [];
      for (let i = 0; i <= 6; i++) pts.push(new THREE.Vector3(cx - LEN / 2 + 6 + i * (LEN - 12) / 6, y - sy * (R + 1.0), z + sz * (R * 0.55)));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.36, 6, false), mats.pipe);
      tube.castShadow = true; G.add(tube);
    }

    for (const sy of [1, -1]) {
      G.add(bar(mats.structure, LEN - 22, 1.2, 2.4, cx, sy * 31.4, 0));
      for (let i = 0; i < 6; i++) G.add(bar(mats.structure, 1.0, 1.8, 37, cx - (LEN - 28) / 2 + i * (LEN - 28) / 5, sy * 31.0, 0));
    }

    for (const dx of [-LEN * 0.36, 0, LEN * 0.36]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.34, 5, 48), mats.structure);
      ring.position.set(cx + dx, 0, 0); ring.scale.set(1, 34, 34); ring.rotation.y = Math.PI / 2; ring.castShadow = true; G.add(ring);
    }
    return G;
  }

  function buildRing(mats) {
    const R = new THREE.Group(); R.position.set(-10, 1, 0);
    const OUT = 101, IN = 85;

    const prof = [
      new THREE.Vector2(IN - 2, -6.5), new THREE.Vector2(OUT + 1.5, -6.5), new THREE.Vector2(OUT + 3, -4.0),
      new THREE.Vector2(OUT + 3, 4.0), new THREE.Vector2(OUT + 1.5, 6.5), new THREE.Vector2(IN - 2, 6.5),
      new THREE.Vector2(IN - 4, 4.0), new THREE.Vector2(IN - 4, -4.0), new THREE.Vector2(IN - 2, -6.5),
    ];
    const lathe = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), mats.ring);
    lathe.rotation.z = Math.PI / 2; lathe.castShadow = lathe.receiveShadow = true; R.add(lathe);

    const inner = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(IN - 11, -3.2), new THREE.Vector2(IN - 3.0, -3.2), new THREE.Vector2(IN - 3.0, 3.2), new THREE.Vector2(IN - 11, 3.2), new THREE.Vector2(IN - 11, -3.2),
    ], 96), mats.ringDark);
    inner.rotation.z = Math.PI / 2; R.add(inner);
    const glowRing = new THREE.Mesh(new THREE.TorusGeometry(IN - 7.6, 0.34, 4, 96), mats.cyan);
    glowRing.rotation.y = Math.PI / 2; R.add(glowRing);

    const NSEG = 36;
    const segMats = [mats.armor, mats.armorLight, mats.armorDark, mats.armor, mats.armorLight];
    for (let i = 0; i < NSEG; i++) {
      const a = i / NSEG * TAU;
      const thick = 15.2 + (i % 5) * 0.55 + (i % 3) * 0.25;
      const seg = plate(segMats[i % segMats.length], 12.6 + (i % 4) * 0.28, 8.0 + (i % 3) * 0.35, thick, 0.55, 0, 0, 0);
      seg.position.set(0, Math.cos(a) * (OUT - 1.2 + (i % 4) * 0.18), Math.sin(a) * (OUT - 1.2 + (i % 4) * 0.18)); seg.rotation.x = a; R.add(seg);

      for (let k = 0; k < 3; k++) {
        const d = bar(mats.ringDark, 12.9, 0.22, 0.9, 0, 0, 0);
        d.position.set(6.9 - k * 6.9, Math.cos(a + (k - 1) * 0.006) * (OUT + 0.9), Math.sin(a + (k - 1) * 0.006) * (OUT + 0.9));
        d.rotation.x = a; R.add(d);
      }
      if (i % 5 === 2) {
        const hl = bar(mats.hazard, 4.6, 1.5, 0.55, 0, 0, 0);
        hl.position.set(3.6, Math.cos(a) * (OUT + 4.0), Math.sin(a) * (OUT + 4.0)); hl.rotation.x = a; R.add(hl);
      }
      if (i % 9 === 4) {
        const wp = plate(mats.collar, 7.0, 2.2, 0.5, 0.05, 0, 0, 0);
        wp.position.set(-2.0, Math.cos(a) * (OUT + 4.1), Math.sin(a) * (OUT + 4.1)); wp.rotation.x = a; R.add(wp);
      }
      for (let k = 0; k < 6; k++) {
        const aa = a + (k - 2.5) * 0.0105;
        const bl = cyl(mats.bolt, 0.22, 0.22, 0.4, 7.3, Math.cos(aa) * (OUT + 3.8), Math.sin(aa) * (OUT + 3.8), 6);
        bl.rotation.z = Math.PI / 2; bl.rotation.x = aa; R.add(bl);
      }

      if (i % 2 === 0) {
        const d = bar(mats.ringDark, 13.4, 1.1, 1.0, 0, 0, 0);
        d.position.set(0, Math.cos(a + Math.PI / NSEG) * (OUT + 1.5), Math.sin(a + Math.PI / NSEG) * (OUT + 1.5));
        d.rotation.x = a + Math.PI / NSEG; R.add(d);
      }
    }

    for (const off of [-4.2, 4.2]) {
      const pipe = new THREE.Mesh(new THREE.TorusGeometry(OUT + 5.0, 0.34, 5, 128), mats.pipe);
      pipe.rotation.y = Math.PI / 2; pipe.position.x = off; R.add(pipe);
      const cable = new THREE.Mesh(new THREE.TorusGeometry(OUT + 6.0, 0.20, 4, 128), mats.ringDark);
      cable.rotation.y = Math.PI / 2; cable.position.x = off * 0.6; R.add(cable);
    }
    for (let i = 0; i < 30; i++) {
      const a = i / 30 * TAU;
      const clamp = cyl(mats.structure, 0.55, 0.55, 1.2, 0, Math.cos(a) * (OUT + 5.0), Math.sin(a) * (OUT + 5.0), 5);
      clamp.rotation.z = Math.PI / 2; clamp.rotation.x = a; R.add(clamp);
    }

    for (const rx of [-7.0, 7.0]) {
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * TAU + Math.PI / 32;
        const len = 62, rm = 55;
        const member = bar(i % 2 ? mats.structure : mats.armorDark, 2.2, 2.2, len, rx, Math.cos(a) * rm, Math.sin(a) * rm);
        member.rotation.x = a; R.add(member);
      }
      for (const rr of [34, 62]) {
        const truss = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.7, 4, 64), mats.structure);
        truss.rotation.y = Math.PI / 2; truss.position.x = rx; R.add(truss);
      }
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * TAU;
        const lamp = cyl(i % 3 ? mats.cyan : mats.amber, 0.34, 0.34, 0.5, rx, Math.cos(a) * 66, Math.sin(a) * 66, 6);
        lamp.rotation.z = Math.PI / 2; lamp.rotation.x = a; R.add(lamp);
      }
    }

    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU + Math.PI / 32;
      const r0 = 22, r1 = IN - 4, len = r1 - r0, rm = (r0 + r1) / 2;
      const spoke = bar(mats.structure, 5.2, 4.4, len, 0, Math.cos(a) * rm, Math.sin(a) * rm);
      spoke.rotation.x = a; R.add(spoke);
      const spoke2 = bar(mats.ringDark, 2.0, 2.0, len * 0.92, 0, Math.cos(a) * rm, Math.sin(a) * rm);
      spoke2.rotation.x = a; spoke2.position.x = -3.2; R.add(spoke2);
      if (i % 2 === 0) {
        const brace = bar(mats.structure, 1.2, 1.2, len * 0.5, 0, Math.cos(a + 0.10) * rm, Math.sin(a + 0.10) * rm);
        brace.rotation.x = a + 0.10; brace.rotation.z = 0.18; R.add(brace);
        const brace2 = bar(mats.structure, 1.2, 1.2, len * 0.5, 0, Math.cos(a - 0.10) * rm, Math.sin(a - 0.10) * rm);
        brace2.rotation.x = a - 0.10; brace2.rotation.z = -0.18; R.add(brace2);
      }

      const joint = cyl(mats.structure, 2.7, 2.7, 13.5, 0, Math.cos(a) * r1, Math.sin(a) * r1, 8);
      joint.rotation.z = Math.PI / 2; joint.rotation.x = a; R.add(joint);
      const jb = bar(mats.ringDark, 9.0, 6.0, 3.0, 0, Math.cos(a) * r1, Math.sin(a) * r1);
      jb.rotation.x = a; R.add(jb);
      const jr = cyl(mats.collar, 3.0, 3.0, 1.3, 0, Math.cos(a) * r1, Math.sin(a) * r1, 8);
      jr.rotation.z = Math.PI / 2; jr.rotation.x = a; R.add(jr);
      const jl = cyl(i % 2 ? mats.cyan : mats.amber, 0.42, 0.42, 0.5, 7.0, Math.cos(a) * (r1 - 0.4), Math.sin(a) * (r1 - 0.4), 6);
      jl.rotation.z = Math.PI / 2; jl.rotation.x = a; R.add(jl);
    }

    const hub = cyl(mats.armor, 23, 23, 20, 0, 0, 0, 32); hub.rotation.z = Math.PI / 2; R.add(hub);
    for (const dx of [-11.5, 11.5]) {
      const u = cyl(mats.collar, 24.2, 24.2, 2.6, dx, 0, 0, 32); u.rotation.z = Math.PI / 2; R.add(u);
    }
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU;
      const p = plate(mats.armorLight, 5.6, 1.2, 9.0, 0.20, 0, Math.cos(a) * 22.4, Math.sin(a) * 22.4);
      p.rotation.x = a; R.add(p);
    }
    for (const dx of [-9.8, 0, 9.8]) {
      const g = new THREE.Mesh(new THREE.TorusGeometry(23.6, 0.22, 4, 64), mats.cyan);
      g.rotation.y = Math.PI / 2; g.position.x = dx; R.add(g);
    }

    for (const e of [-1, 1]) for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU;
      const lamp = cyl(i % 3 ? mats.cyan : mats.amber, 0.46, 0.46, 0.55, e * 12.4, Math.cos(a) * 18.2, Math.sin(a) * 18.2, 6);
      lamp.rotation.z = Math.PI / 2; lamp.rotation.x = a; R.add(lamp);
    }

    for (const sx of [-1.6, 1.6]) {
      const leg = cyl(mats.structure, 0.12, 0.30, 30, sx, OUT + 20, 0, 5); R.add(leg);
    }
    for (let i = 0; i < 6; i++) {
      const yy = OUT + 8 + i * 4.8;
      R.add(bar(mats.structure, 3.8, 0.16, 0.16, 0, yy, 0));
      if (i % 2 === 0) R.add(bar(mats.structure, 0.14, 0.14, 3.2, 0, yy, 0));
    }
    const ant = cyl(mats.structure, 0.10, 0.34, 22, 0, OUT + 52, 0, 5); R.add(ant);
    const ab = bar(mats.armorLight, 6.0, 3.0, 1.0, 0, OUT + 28, 0); R.add(ab);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), mats.beacon); tip.position.set(0, OUT + 64, 0); R.add(tip);
    const bea = cyl(mats.beacon, 0.55, 0.55, 0.25, 0, OUT + 61, 0, 8); bea.rotation.z = Math.PI / 2; R.add(bea);

    const finD = poly(R, mats.armor, [[-12, -8], [10, -6], [14, -40], [4, -58], [-10, -46], [-14, -10]], 3.4, -4, -OUT - 30, 0, 0.4);
    finD.rotation.y = Math.PI / 2;
    for (let i = 0; i < 3; i++) R.add(bar(mats.structure, 1.4, 30, 1.4, 8, -OUT - 40, -14 + i * 8));

    for (const s of [1, -1]) {
      const strut = bar(mats.structure, 5.0, 2.4, 52, 0, s * 36, 0);
      strut.rotation.x = s * 0.0; R.add(strut);
      const diag = bar(mats.structure, 4.0, 2.0, 46, -12, s * 48, 14); diag.rotation.y = -0.5; diag.rotation.z = s * 0.4; R.add(diag);
    }
    return R;
  }

  function buildEngines(mats) {
    const G = new THREE.Group();

    G.add(plate(mats.hullDark, 46, 38, 66, 1.2, -190, 0, 0));
    G.add(plate(mats.armor, 38, 30, 58, 0.9, -193, 1, 0));
    for (let i = 0; i < 5; i++) G.add(bar(mats.structure, 2.0, 32, 62, -163 - i * 8, 1, 0));
    G.add(plate(mats.armorLight, 38, 5.0, 14, 0.4, -190, 15.5, 0));
    G.add(plate(mats.hazard, 16, 0.5, 0.16, 0.03, -190, 18.0, 24));

    for (const y of [10, -10]) for (const z of [-12, 12]) {
      const prof = [];
      for (let i = 0; i <= 10; i++) { const u = i / 10; prof.push(new THREE.Vector2((7.0 + 2.2 * Math.pow(u, 1.5)), u * 9.0)); }
      const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), mats.dark);
      bell.rotation.z = -Math.PI / 2; bell.position.set(-226, y, z); bell.castShadow = bell.receiveShadow = true; G.add(bell);
      const ring = cyl(mats.steel, 9.2, 9.5, 0.9, -225, y, z, 24); ring.rotation.z = Math.PI / 2; G.add(ring);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(8.2, 28), mats.thr); glow.position.set(-234.6, y, z); glow.rotation.y = -Math.PI / 2; G.add(glow);
      g.engines.push({ pos: V3(-235, y, z), dir: V3(-1, 0, 0), size: 8.2 });
    }

    for (const s of [1, -1]) {
      const N = new THREE.Group(); N.position.set(0, 0, s * 48); G.add(N);
      N.add(plate(mats.armorLight, 54, 22, 21, 1.0, -178, 0, 0));
      N.add(plate(mats.armor, 46, 16, 17, 0.8, -176, 1, s * 3.2));
      N.add(plate(mats.hullDark, 10, 24, 23, 0.6, -202, 0, 0));
      N.add(plate(mats.hazard, 20, 0.45, 0.16, 0.03, -176, 10.4, s * 10.7));

      N.add(plate(mats.armorLight, 16, 8.0, 0.6, 0.15, -168, 0, s * 10.8));
      for (let i = 0; i < 7; i++) N.add(bar(mats.dark, 14, 0.28, 0.22, -168, -3.2 + i * 1.05, s * 11.15));
      for (let i = 0; i < 5; i++) N.add(bar(mats.structure, 0.4, 9.0, 0.4, -190 + i * 5.4, 0, s * 10.9));

      const prof = [];
      for (let i = 0; i <= 8; i++) { const u = i / 8; prof.push(new THREE.Vector2(6.4 + 1.8 * Math.pow(u, 1.4), u * 7.2)); }
      const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 22), mats.dark);
      bell.rotation.z = -Math.PI / 2; bell.position.set(-211, 0, s * 4); N.add(bell);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(7.2, 26), mats.thr); glow.position.set(-218.6, 0, s * 4); glow.rotation.y = -Math.PI / 2; N.add(glow);
      g.engines.push({ pos: V3(-219, 0, s * 52), dir: V3(-1, 0, 0), size: 7.2 });

      const fin = poly(N, mats.armor, [[-20, -6], [16, -4], [24, 20], [8, 34], [-14, 26]], 2.4, -4, 16, 0, 0.35);
      fin.rotation.y = Math.PI / 2;
      N.add(bar(mats.structure, 0.30, 6.0, 0.30, 8, 18, 0));

      G.add(bar(mats.structure, 4.0, 3.0, 26, -160, 0, s * 34));
      G.add(bar(mats.structure, 3.0, 2.0, 30, -186, 5, s * 33));
    }

    const fin = poly(G, mats.armor, [[-22, -8], [14, -6], [22, 30], [6, 44], [-16, 32]], 2.8, -4, 24, 0, 0.4);
    fin.rotation.y = Math.PI / 2;
    G.add(bar(mats.structure, 0.35, 12, 0.35, -8, 38, 0));
    G.add(plate(mats.beacon, 0.3, 3.2, 3.2, 0.05, -8, 45, 0));
    return G;
  }

  function buildRunningLights() {
    const G = new THREE.Group();
    const mk = (mat, n, seed) => {
      const geo = plateGeo(0.55, 0.14, 0.10, 0.02);
      const inst = new THREE.InstancedMesh(geo, mat, n);
      const rr = rng(seed), q = new THREE.Quaternion();
      let k = 0, guard = 0;
      while (k < n && guard++ < 3000) {
        const x = lerp(-220, 232, rr());
        if (x > 118 && x < 200) continue;
        const u = rr() < 0.5 ? 0.13 + rr() * 0.06 : 0.81 + rr() * 0.06;
        ringPoint(x, u, TMPV); const surf = TMPV.clone();
        surfNormal(x, u, TMPV); const nrm = TMPV.clone();
        q.setFromUnitVectors(ZAX, nrm);
        TMPV.copy(surf).addScaledVector(nrm, 0.28);
        TMPM.compose(TMPV, q, V3(1, 1, 1)); inst.setMatrixAt(k, TMPM); k++;
      }
      inst.count = k; inst.instanceMatrix.needsUpdate = true; inst.userData.noBake = true; G.add(inst);
    };
    mk(M.amber, 46, SEED + 1201);
    mk(M.cyan, 24, SEED + 1202);

    for (let i = 0; i < 18; i++) {
      const a = i / 18 * TAU;
      const l = cyl(i % 4 ? M.amber : M.cyan, 0.26, 0.26, 0.4, -18.5, 1 + Math.cos(a) * 103, Math.sin(a) * 103, 5);
      l.rotation.z = Math.PI / 2; l.rotation.x = a; G.add(l);
    }
    return G;
  }

  function buildTurret(mats, x, y, z, scale, baseYaw) {
    const G = new THREE.Group(); G.position.set(x, y, z); G.scale.setScalar(scale);
    G.add(cyl(mats.trim, 3.4, 4.2, 1.4, 0, 0.7, 0, 12));
    G.add(cyl(mats.armorLight, 4.4, 4.4, 0.5, 0, 0.2, 0, 12));
    const head = new THREE.Group(); head.position.y = 2.2; head.userData.baseYaw = baseYaw;
    head.add(plate(mats.armor, 6.2, 2.8, 5.2, 0.45, 0, 1.0, 0));
    head.add(plate(mats.armorLight, 4.4, 1.0, 4.0, 0.2, 0, 2.7, 0));
    head.add(plate(mats.hazard, 2.4, 0.4, 0.16, 0.03, 2.2, 2.0, 1.8));

    const barrels = new THREE.Group();
    for (const s of [1, -1]) {
      const b = cyl(mats.dark, 0.26, 0.34, 8.0, 0, 0, 0, 10); b.rotation.z = Math.PI / 2; b.position.set(-5.0, 1.0, s * 1.05); barrels.add(b);
      barrels.add(cyl(mats.steel, 0.48, 0.48, 0.7, -8.6, 1.0, s * 1.05, 10));
      barrels.add(cyl(mats.steel, 0.36, 0.36, 1.4, -2.4, 1.0, s * 1.05, 10));
    }
    head.add(barrels); G.add(head);
    G.updateMatrixWorld(true);
    const mp = new THREE.Vector3(-8.2, 1.0, 1.05).applyMatrix4(head.matrixWorld);
    g.guns.push({ pos: mp.clone(), dir: V3(-2480, 150, -820).sub(mp).normalize(), phase: g.guns.length * 1.7, head, barrels });
    g.heads.push(head);
    bakeTree(G, [head]); bakeTree(head);
    return G;
  }

  function buildSideDetail(mats) {
    const G = new THREE.Group();
    for (const side of [1, -1]) {
      const u = side > 0 ? 0.205 : 0.795;

      for (const [x, w, h] of [[171, 18, 8.2], [146, 16, 7.0]]) {
        ringPoint(x, u, TMPV); const surf = TMPV.clone();
        surfNormal(x, u, TMPV); const nrm = TMPV.clone();
        const m = new THREE.Mesh(plateGeo(w, h, 1.6, 0.4), mats.armorLight);
        m.position.copy(surf).addScaledVector(nrm, 1.2); m.quaternion.setFromUnitVectors(ZAX, nrm); m.castShadow = true; G.add(m);
        for (let i = 0; i < 9; i++) {
          const f = bar(mats.dark, w - 2.0, 0.26, 0.30, 0, 0, 0);
          f.position.copy(surf).addScaledVector(nrm, 2.0).add(V3(0, 0, 0));
          f.position.y += (i - 4) * (h - 1.2) / 8;
          f.quaternion.setFromUnitVectors(ZAX, nrm); f.castShadow = true; G.add(f);
        }
        ringPoint(x, u, TMPV);
        const fr = bar(mats.trim, w + 1.6, 0.5, 1.0, 0, 0, 0);
        fr.position.copy(surf).addScaledVector(nrm, 1.4).add(V3(0, h / 2 + 0.4, 0)); fr.quaternion.setFromUnitVectors(ZAX, nrm); G.add(fr);
      }

      for (let i = 0; i < 16; i++) {
        const x = 90 + i * 9.3;
        const p = ringPoint(x, u + side * 0.028, new THREE.Vector3());
        G.add(plate(i % 4 === 0 ? mats.cyan : mats.amber, 1.8, 0.34, 0.12, 0.02, p.x, p.y, p.z + side * 0.7));
      }

      for (let i = 0; i < 6; i++) {
        const x = 128 + i * 17;
        const w = 15.5 - (i > 3 ? (i - 3) * 2 : 0), h = 6.5 + (i % 2) * 1.2;
        hullPlate(G, i % 2 ? mats.armor : mats.armorLight, w, h, 1.2, x, u + side * 0.045, 0.5, side * 0.03);
        hullPlate(G, mats.armorDark, w - 2.4, 1.0, 0.5, x - 2, u + side * 0.06, 1.4, side * 0.03);
        if (i === 1 || i === 4) hullPlate(G, mats.hazard, 4.0, 0.9, 0.35, x + 3, u + side * 0.07, 1.8);
      }

      for (const [x, w, h] of [[196, 16, 6.0], [118, 20, 5.2]]) {
        ringPoint(x, u + side * 0.015, TMPV); const surf = TMPV.clone();
        surfNormal(x, u + side * 0.015, TMPV); const nrm = TMPV.clone();
        const base = new THREE.Mesh(plateGeo(w + 2.4, h + 2.0, 1.0, 0.35), mats.armorDark);
        base.position.copy(surf).addScaledVector(nrm, 0.35); base.quaternion.setFromUnitVectors(ZAX, nrm); base.castShadow = true; G.add(base);
        const pale = new THREE.Mesh(plateGeo(w, h, 1.2, 0.22), mats.collar);
        pale.position.copy(surf).addScaledVector(nrm, 1.15); pale.quaternion.setFromUnitVectors(ZAX, nrm); pale.castShadow = true; G.add(pale);
        const red = new THREE.Mesh(plateGeo(w - 3.0, 0.9, 0.4, 0.05), mats.hazard);
        red.position.copy(surf).addScaledVector(nrm, 1.85).add(V3(0, h * 0.25, 0)); red.quaternion.setFromUnitVectors(ZAX, nrm); G.add(red);
        for (let k = 0; k < 10; k++) {
          const b = cyl(mats.steel, 0.10, 0.10, 0.24, 0, 0, 0, 5);
          b.position.copy(surf).addScaledVector(nrm, 1.9).add(V3(-w / 2 + 1.2 + k * (w - 2.4) / 9, -h / 2 + 0.9, 0));
          b.quaternion.setFromUnitVectors(YAX, nrm); G.add(b);
        }
      }

      for (let i = 0; i < 5; i++) {
        const x = 60 - i * 38;
        hullPlate(G, i % 2 ? mats.armorDark : mats.armor, 28, 4.6, 1.0, x, u, 0.4);
      }
      const pts = [];
      for (let i = 0; i <= 9; i++) {
        const x = 96 - i * 34;
        const p = ringPoint(x, u + side * 0.06, new THREE.Vector3());
        pts.push(new THREE.Vector3(p.x, p.y - 3.0, p.z));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.42, 6, false), mats.pipe);
      tube.castShadow = true; G.add(tube);

      for (let k = 0; k < 2; k++) {
        const R = new THREE.Group(); R.position.set(-146 + k * 7, 6, side * 37); R.rotation.x = side * 0.5; R.rotation.z = 0.10;
        R.add(plate(mats.armorDark, 18, 8.5, 0.6, 0.2, 0, 0, 0));
        for (let i = 0; i < 7; i++) R.add(bar(mats.trim, 18, 0.55, 0.3, 0, 0.5, -3.6 + i * 1.15));
        for (let i = 0; i < 2; i++) R.add(bar(mats.hot, 15, 0.06, 0.22, 0, 0.62, -2.2 + i * 3.2));
        G.add(R);
      }

      for (let i = 0; i < 5; i++) {
        const x = -10 - i * 24;
        const p = ringPoint(x, u + side * 0.02, new THREE.Vector3());
        G.add(cyl(mats.dark, 0.42, 0.62, 6.0, p.x, p.y - 1.2, p.z + side * 1.4, 8)).rotation.x = side * 0.0;
      }
    }
    return G;
  }

  function buildGreebles(mat) {
    const N = 520, geo = plateGeo(1, 1, 1, 0.07);
    const inst = new THREE.InstancedMesh(geo, mat, N);
    const base = new THREE.InstancedMesh(geo, M.armorDark, N);
    inst.castShadow = inst.receiveShadow = true; base.castShadow = base.receiveShadow = true;
    const r = rng(SEED + 311), q = new THREE.Quaternion(), c = new THREE.Color();
    let k = 0, guard = 0;
    while (k < N && guard++ < 9000) {
      const x = lerp(-218, 226, r());
      const u = r();
      if (x > 112 && x < 202 && (u < 0.14 || u > 0.86)) continue;
      if (u > 0.94 || u < 0.06) continue;
      ringPoint(x, u, TMPV); const surf = TMPV.clone();
      surfNormal(x, u, TMPV); const nrm = TMPV.clone();
      const w = lerp(1.2, 5.4, r()), h = lerp(0.8, 3.4, r()), d = lerp(0.12, 0.46, r());
      q.setFromUnitVectors(ZAX, nrm);
      TMPV.copy(surf).addScaledVector(nrm, d * 0.5 + 0.02);
      TMPM.compose(TMPV, q, V3(w, h, d));
      inst.setMatrixAt(k, TMPM);
      TMPV.copy(surf).addScaledVector(nrm, d * 0.12);
      TMPM.compose(TMPV, q, V3(w * 1.20, h * 1.22, Math.max(0.18, d * 0.55)));
      base.setMatrixAt(k, TMPM);
      const tone = 0.55 + r() * 0.35; c.setRGB(tone * 0.92, tone * 1.0, tone * 1.0);
      inst.setColorAt(k, c); k++;
    }
    inst.count = k; base.count = k; inst.instanceMatrix.needsUpdate = true; base.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    const grp = new THREE.Group(); grp.add(base); grp.add(inst); return grp;
  }
  function buildBigPlates(mats) {
    const G = new THREE.Group();
    for (const side of [1, -1]) {

      for (let i = 0; i < 5; i++) {
        const x = 205 - i * 15;
        hullPlate(G, i % 2 ? mats.armorLight : mats.armor, 13.5, 5.0, 1.1, x, side > 0 ? 0.085 : 0.915, 0.6, side * 0.02);
      }

      for (let i = 0; i < 4; i++) {
        const x = 216 - i * 16;
        hullPlate(G, i % 2 ? mats.armor : mats.armorLight, 14.5, 8.5, 0.9, x, side > 0 ? 0.02 : 0.98, 0.35, 0);
      }

      for (let i = 0; i < 6; i++) {
        const x = 90 - i * 46;
        hullPlate(G, i % 2 ? mats.armor : mats.armorDark, 32, 7.4, 0.9, x, side > 0 ? 0.24 : 0.76, 0.35);
        hullPlate(G, mats.armorLight, 28, 1.4, 0.4, x - 2, side > 0 ? 0.242 : 0.758, 1.2);
      }

      for (let i = 0; i < 5; i++) hullPlate(G, mats.armorDark, 26, 5.0, 0.8, 80 - i * 50, side > 0 ? 0.40 : 0.60, 0.4);
    }
    return G;
  }

  function buildBowSpikes(mats) {
    const G = new THREE.Group();
    for (const [z, len] of [[0, 16], [-4.2, 12], [4.2, 12]]) {
      const b = cyl(mats.trim, 0.12, 0.42, len, 236 + len / 2, 2.4, z, 6);
      b.rotation.z = -Math.PI / 2; G.add(b);
      const tip = cyl(mats.steel, 0.0, 0.14, 1.2, 236 + len + 0.4, 2.4, z, 5);
      tip.rotation.z = -Math.PI / 2; G.add(tip);
    }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 8, 0, TAU, 0, Math.PI * 0.45), mats.armorLight);
    dish.position.set(207, sect(207).yc + sect(207).h + 0.7, 0); dish.rotation.x = -0.7; G.add(dish);
    G.add(bar(mats.trim, 8.0, 0.18, 0.18, 191, 2.4, 0));
    G.add(cyl(mats.beacon, 0.3, 0.3, 0.26, 233, 3.2, 0, 6));
    return G;
  }

  function buildDecals() {
    const tex = decalTexture(512, (c, S) => {
      c.clearRect(0, 0, S, S);
      c.fillStyle = 'rgba(235,242,240,0.80)'; c.font = 'bold 168px "Arial Narrow", Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText('CVN-09', 26, 170);
      c.font = 'bold 64px "Microsoft YaHei", sans-serif'; c.fillStyle = 'rgba(235,242,240,0.82)'; c.fillText('镇 星', 30, 288);
      c.strokeStyle = 'rgba(232,92,38,0.95)'; c.lineWidth = 14; c.beginPath(); c.moveTo(30, 348); c.lineTo(440, 348); c.stroke();
      c.save(); c.translate(420, 96); c.fillStyle = 'rgba(240,150,58,0.95)'; c.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 14 : 36; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.closePath(); c.fill(); c.restore();
      c.fillStyle = 'rgba(220,235,232,0.52)'; c.font = 'bold 24px Arial'; c.fillText('ORBITAL SPEAR · 7TH FLEET', 32, 396);
    });
    const tex2 = decalTexture(512, (c, S) => {
      c.clearRect(0, 0, S, S);
      c.fillStyle = 'rgba(240,244,240,0.95)'; c.font = 'bold 310px "Arial Black", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('09', 256, 230);
      c.fillStyle = 'rgba(236,98,42,0.94)'; c.fillRect(46, 372, 420, 28);
      c.fillStyle = 'rgba(240,244,240,0.72)'; c.font = 'bold 44px "Microsoft YaHei", sans-serif'; c.fillText('镇 星 · 环带突击', 256, 438);
    });
    const hz = decalTexture(256, (c, S) => {
      c.clearRect(0, 0, S, S);
      for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? 'rgba(232,120,48,0.95)' : 'rgba(18,22,22,0.95)'; c.save(); c.translate(i * 46 - 30, 0); c.transform(1, 0, -0.5, 1, 0, 0); c.fillRect(0, 18, 46, 220); c.restore(); }
    });
    const D = new THREE.Group();

    const mk = (t, w, h, x, y, z, ry, rx = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), decalMat(t));
      m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.userData.noBake = true; D.add(m);
    };

    {
      const s = 1;
      const p = ringPoint(160, 0.20, new THREE.Vector3());
      const n = surfNormal(160, 0.20, new THREE.Vector3());
      const m = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), decalMat(tex));
      m.position.copy(p).addScaledVector(n, 1.0); m.lookAt(p.clone().add(n)); m.userData.noBake = true; D.add(m);
      mk(hz, 8.0, 2.0, -150, 8.0, s * 34.5, 0);
    }

    mk(hz, 6.0, 1.5, 190, DECK_Y + 0.10, 12.0, 0, -Math.PI / 2);
    return D;
  }

  function build(scene) {
    group = new THREE.Group(); group.name = 'ship'; staticG = new THREE.Group(); group.add(staticG); scene.add(group);
    M.armor = shipMat(0x5b6e72, { metal: 0.30, rough: 0.58, win: 0.0, key: 'armor', chip: 0.55 });
    M.armorLight = shipMat(0x8c9b9c, { metal: 0.30, rough: 0.54, win: 0.0, key: 'armorl', chip: 0.45 });
    M.armorDark = shipMat(0x3c4c51, { metal: 0.34, rough: 0.60, win: 0.0, key: 'armord', chip: 0.5 });
    M.hullDark = shipMat(0x2b373b, { metal: 0.36, rough: 0.62, win: 0.0, key: 'hulld', chip: 0.4 });
    M.ring = shipMat(0x55676b, { metal: 0.34, rough: 0.52, win: 0.0, key: 'ring', chip: 0.5 });
    M.ringDark = new THREE.MeshStandardMaterial({ color: 0x111d22, metalness: 0.55, roughness: 0.62 });
    M.tank = shipMat(0x587f84, { metal: 0.26, rough: 0.48, win: 0.0, key: 'tank', chip: 0.22 });
    M.tankB = shipMat(0x48676b, { metal: 0.24, rough: 0.54, win: 0.0, key: 'tankb', chip: 0.26, pscale: 1.18 });
    M.tankDark = new THREE.MeshStandardMaterial({ color: 0x244a50, metalness: 0.50, roughness: 0.58 });
    M.collar = shipMat(0xaab8b5, { metal: 0.50, rough: 0.40, key: 'collar', chip: 0.3 });
    M.structure = new THREE.MeshStandardMaterial({ color: 0x22343a, metalness: 0.62, roughness: 0.54 });
    M.trim = new THREE.MeshStandardMaterial({ color: 0x33474d, metalness: 0.62, roughness: 0.46 });
    M.dark = new THREE.MeshStandardMaterial({ color: 0x141f23, metalness: 0.50, roughness: 0.76 });
    M.steel = new THREE.MeshStandardMaterial({ color: 0x889496, metalness: 0.82, roughness: 0.28 });
    M.bolt = new THREE.MeshStandardMaterial({ color: 0xa6b1b1, metalness: 0.80, roughness: 0.32 });
    M.pipe = new THREE.MeshStandardMaterial({ color: 0x2d444a, metalness: 0.55, roughness: 0.55 });
    M.amber = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.52, 0.18).multiplyScalar(1.55) });
    M.cyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.34, 0.90, 1.0).multiplyScalar(2.2) });
    M.hazard = new THREE.MeshStandardMaterial({ color: 0xa6481f, metalness: 0.32, roughness: 0.66, emissive: 0x1c0802, emissiveIntensity: 0.22 });
    M.thr = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.42, 0.82, 1.0).multiplyScalar(7.5) });
    M.hot = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.34, 0.08).multiplyScalar(2.4) });
    M.beacon = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.18, 0.10).multiplyScalar(3.5) });

    staticG.add(buildHull(M.armor));
    staticG.add(buildBigPlates(M));
    staticG.add(buildSideDetail(M));
    M.bridge = shipMat(0x56696d, { metal: 0.30, rough: 0.56, win: 0.0, key: 'bridge', chip: 0.4 });
    staticG.add(buildCitadel(M.bridge, M.trim, M.amber, M.dark, M.cyan, M.hazard, M.armorLight));
    staticG.add(buildDeckLegs(M.trim, M.dark, M.amber, M.cyan, M.hazard));
    staticG.add(tankCluster(65, M));
    staticG.add(tankCluster(-78, M));
    staticG.add(buildRing(M));
    staticG.add(buildEngines(M));
    staticG.add(buildBowSpikes(M));
    staticG.add(buildGreebles(M.armorLight));
    group.add(buildRunningLights());

    const TG = new THREE.Group(); group.add(TG);
    const tdefs = [
      [206, 24, 20, 0.80, -0.25], [206, 24, -20, 0.80, 0.25],
      [30, 32, 24, 0.72, -0.45], [30, 32, -24, 0.72, 0.45],
      [-148, 20, 22, 0.74, 0.5], [-148, 20, -22, 0.74, -0.5],
    ];
    for (const [x, y, z, sc, yaw] of tdefs) TG.add(buildTurret(M, x, y, z, sc, yaw));

    group.add(buildDecals());
    bake(staticG);

    G.anchors.hero = V3(158, DECK_Y + 0.06, 0);
    G.anchors.deckY = DECK_Y;
    G.anchors.deckFront = V3(190, DECK_Y + 1, 0);
    G.anchors.floods = [
      { p: V3(126, DECK_Y + 5.2, 16.0), d: V3(0.45, -0.55, -0.70).normalize() },
      { p: V3(126, DECK_Y + 5.2, -16.0), d: V3(0.45, -0.55, 0.70).normalize() },
    ];
  }

  const _ambC = new THREE.Color(), _cyaC = new THREE.Color();
  let AMB0 = null, CYA0 = null, HAZ0 = 0;
  function alertLights(t) {
    if (!AMB0) { AMB0 = M.amber.color.clone(); CYA0 = M.cyan.color.clone(); HAZ0 = M.hazard.emissiveIntensity; }
    const a = Film.sstep(Film.T.ALERT, Film.T.ALERT + 0.5, t);
    const pulse = 0.5 + 0.5 * Math.sin((t - Film.T.ALERT) * 5.2);
    const on = 0.35 + 0.65 * Math.pow(pulse, 1.6);
    _ambC.setRGB(1.0, 0.10, 0.05).multiplyScalar(2.6 * on);
    M.amber.color.copy(AMB0).lerp(_ambC, a);
    _cyaC.copy(CYA0).multiplyScalar(0.35); M.cyan.color.copy(CYA0).lerp(_cyaC, a);
    M.hazard.emissiveIntensity = HAZ0 + a * on * 1.2;
    if (G.lights.alert) G.lights.alert.intensity = a * Math.pow(pulse, 2.2) * 1100 * (1 - 0.6 * Film.sstep(Film.T.LAUNCH + 2, Film.T.LAUNCH + 4, t));
  }
  function update(t) {
    alertLights(t);
    for (const h of g.heads) {
      const b = h.userData.baseYaw;
      h.rotation.y = b + Math.sin(t * 0.10 + b * 7.0) * 0.28;
    }
    if (radar) radar.rotation.y = t * 0.5;
  }

  const ENEMY_MATS = new Map();
  function buildEnemy(scene, pos, yaw, scale = 1) {
    const map = ENEMY_MATS;
    const dark = (m) => {
      const lum = m.color ? (m.color.r + m.color.g + m.color.b) / 3 : 0.3;
      const c = new THREE.Color(0.075, 0.078, 0.088).multiplyScalar(0.8 + lum * 1.4);
      if (m.customProgramCacheKey && m.onBeforeCompile) return shipMat(c, { metal: 0.82, rough: 0.34, key: m.customProgramCacheKey().replace(/^ship-/, ''), chip: 0.15 });
      return new THREE.MeshStandardMaterial({ color: c, metalness: 0.80, roughness: 0.38 });
    };
    const red = (m) => { const k = m.color ? Math.max(m.color.r, m.color.g, m.color.b) : 2; return new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.10, 0.05).multiplyScalar(Math.min(k, 4)) }); };
    const E = group.clone(true); E.name = 'enemy';
    E.traverse(o => {
      if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isSprite) return;
      const m = o.material; if (!m || Array.isArray(m)) return;
      if (o.isPoints || m.isShaderMaterial) { o.visible = false; return; }
      if (m.map || m.transparent) { o.visible = false; return; }
      if (!map.has(m)) map.set(m, m.isMeshBasicMaterial || m.isSpriteMaterial || m.isPointsMaterial ? red(m) : dark(m));
      o.material = map.get(m); o.castShadow = false; o.receiveShadow = false;
    });

    const gt = decalTexture(64, (c, S) => { const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,120,90,0.6)'); g.addColorStop(1, 'rgba(255,40,20,0)'); c.fillStyle = g; c.fillRect(0, 0, S, S); });
    const lm = new THREE.SpriteMaterial({ map: gt, color: new THREE.Color(1.0, 0.16, 0.08).multiplyScalar(2.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    const pts = [];
    for (let x = -215; x <= 235; x += 22) for (const s of [1, -1]) pts.push([x, sect(x).yc + sect(x).h * 0.92, s * sect(x).w * 0.98, 7]);
    pts.push([98, 62, 8, 12], [98, 62, -8, 12], [-235, 10, 30, 14], [-235, 10, -30, 14], [240, 4, 0, 16]);
    for (const [x, y, z, sc] of pts) { const sp = new THREE.Sprite(lm); sp.position.set(x, y, z); sp.scale.setScalar(sc); E.add(sp); }
    E.position.copy(pos); E.rotation.y = yaw; E.scale.setScalar(scale);
    E.updateMatrixWorld(true);
    E.traverse(o => { o.matrixAutoUpdate = false; });
    scene.add(E);
    return E;
  }
  return { build, update, buildEnemy, guns: g.guns, engines: g.engines, deckY: DECK_Y, M };
})();
