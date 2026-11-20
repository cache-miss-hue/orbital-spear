'use strict';

const Env = (() => {
  const PLANET = G.anchors.planet, PR = G.anchors.planetR;
  const SUNP = V3(-0.80, 0.30, -0.35).normalize();
  let skyMat, planetMesh, ringMat, sunMesh, dustMat, fleetGroups = [], skyMesh;
  const ringGroup = new THREE.Group();

  async function loadSkyMap() {
    try {
      if (typeof NEB_A === 'undefined') return null;
      const grab = async b64 => {
        const img = new Image(); img.decoding = 'async'; img.src = b64; await img.decode();
        const t = new THREE.Texture(img);
        t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
        return t;
      };
      return { a: await grab(NEB_A), b: await grab(NEB_B), c: await grab(NEB_C) };
    } catch (e) { console.warn('sky nebula unavailable', e); return null; }
  }

  function makeSky(tex) {
    const mapTex = tex ? tex.a : null;
    skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: { uTime: G.uTime, uNa: { value: mapTex }, uNb: { value: tex ? tex.b : null }, uNc: { value: tex ? tex.c : null }, uHas: { value: mapTex ? 1 : 0 },
        uBandN: { value: (() => { const S = SUN.clone(), P = G.anchors.planet.clone().normalize(); return S.cross(P).normalize(); })() } },
      vertexShader:  `varying vec3 vD, vW; void main(){ vD = position; vW = mat3(modelMatrix) * position; vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader:  `${GLSL_NOISE}
        uniform float uTime, uHas; uniform sampler2D uNa, uNb, uNc; uniform vec3 uBandN; varying vec3 vD, vW;
        vec3 tri(sampler2D t, vec3 d, float k, vec3 off){
          vec3 w = pow(abs(d), vec3(6.0)); w /= (w.x + w.y + w.z);
          return texture2D(t, d.yz * k + off.xy).rgb * w.x + texture2D(t, d.zx * k + off.yz).rgb * w.y + texture2D(t, d.xy * k + off.zx).rgb * w.z;
        }

        float starLayer(vec3 d, float scale, float thr, float sz, float seed, float pxd){
          vec3 p = d * scale, id = floor(p), f = fract(p) - 0.5;
          float h = hash31(id + seed);
          float m = smoothstep(thr, thr + 0.006, h);
          vec3 j = (hash33(id + seed + 11.0) - 0.5) * 0.55;
          float r = max(sz, pxd * scale * 0.7);
          float s = smoothstep(r, 0.0, length(f - j)) * m * (sz * sz) / (r * r);
          return s * (0.35 + 0.65 * hash31(id + seed + 5.0));
        }
        void main(){
          vec3 d = normalize(vD);
          vec3 col = vec3(0.0035, 0.0055, 0.011);

          if (uHas > 0.5) {
            vec3 dw = normalize(vW);
            float lat = dot(dw, uBandN);
            float band = exp(-lat * lat * 4.5) * (0.45 + 1.1 * fbm3(dw * 1.7 + 4.0));
            float core = exp(-lat * lat * 26.0) * smoothstep(0.35, 0.8, fbm3(dw * 2.6 + 9.0));
            vec3 na = pow(tri(uNa, dw, 1.05, vec3(0.13, 0.57, 0.31)), vec3(2.2));
            vec3 nb = pow(tri(uNb, dw.zxy, 1.65, vec3(0.71, 0.29, 0.83)), vec3(2.2));
            vec3 nc = pow(tri(uNc, dw.yzx, 0.75, vec3(0.41, 0.07, 0.66)), vec3(2.2));
            vec3 neb = (na * 1.15 + nb * 0.75) * band + nc * (0.18 + 0.55 * band);
            neb *= vec3(1.12, 0.78, 1.18);
            neb += vec3(1.0, 0.55, 0.75) * core * 0.035;
            col += neb * 0.85;
          }

          vec3 nb = normalize(vec3(0.18, 0.86, -0.48));
          float lat = dot(d, nb);
          float band = exp(-lat * lat * 34.0);
          float fil = fbm3(d * 4.2 + 3.0);
          float dust = fbm3(d * 11.0 + 9.0);
          float pmix = 1.0 - 0.90 * uHas;
          col += vec3(0.050, 0.060, 0.090) * band * (0.35 + 1.35 * fil) * (1.0 - 0.55 * smoothstep(0.5, 0.75, dust)) * pmix;
          col += vec3(0.022, 0.010, 0.026) * (fbm3(d * 2.1 + 21.0) - 0.45) * 1.4 * pmix;
          col += vec3(0.008, 0.020, 0.026) * (fbm3(d * 3.3 + 41.0) - 0.4) * 1.2 * pmix;
          float pxd = length(fwidth(d));
          float s = starLayer(d, 52.0, 0.955, 0.019, 1.0, pxd) * 5.0
                  + starLayer(d, 96.0, 0.968, 0.026, 17.0, pxd) * 3.6
                  + starLayer(d, 168.0, 0.979, 0.031, 33.0, pxd) * 2.4
                  + starLayer(d, 268.0, 0.987, 0.034, 51.0, pxd) * 1.2;
          float tw = 0.92 + 0.08 * sin(uTime * 1.7 + hash31(floor(d * 60.0)) * 30.0);
          col += s * tw * mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.72), hash31(floor(d * 90.0) + 3.0));
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    skyMesh = new THREE.Mesh(new THREE.SphereGeometry(14000, 48, 24), skyMat);
    skyMesh.rotation.set(0.10, 2.35, 0.18);
    skyMesh.frustumCulled = false; skyMesh.renderOrder = -1000; return skyMesh;
  }

  const GLSL_RING =  `
    float ringTerm(float x, float f, float w){ return sin(x * f) * clamp(1.0 - w * f * 0.35, 0.0, 1.0); }
    float ringDen(float r, float w){
      if (r < 0.0 || r > 1.0) return 0.0;
      float d = 0.55 + 0.20 * ringTerm(r, 61.0, w) + 0.13 * ringTerm(r + 0.13, 149.0, w) + 0.09 * ringTerm(r + 0.31, 337.0, w) + 0.06 * ringTerm(r + 0.07, 811.0, w);
      d *= 0.75 + 0.5 * vnoise(vec2(r * 38.0, 0.5));
      float zone = 0.22;
      zone = mix(zone, 1.0, smoothstep(0.17, 0.21, r));
      zone = mix(zone, 0.03, smoothstep(0.545, 0.56, r));
      zone = mix(zone, 0.62, smoothstep(0.60, 0.615, r));
      zone *= 1.0 - 0.92 * (1.0 - smoothstep(0.0, 0.006, abs(r - 0.80)));
      zone = mix(zone, 0.0, smoothstep(0.88, 0.90, r));
      zone += 0.55 * (1.0 - smoothstep(0.0, 0.004, abs(r - 0.955)));
      return clamp(d * zone * smoothstep(0.0, 0.03, r), 0.0, 1.0);
    }`;
  const RING_I = 1.30, RING_O = 2.30;
  const uRingN = { value: V3(0, 1, 0) };

  function makePlanet() {
    planetMesh = new THREE.Mesh(new THREE.SphereGeometry(PR, 192, 96), new THREE.ShaderMaterial({
      uniforms: { uSun: { value: SUNP }, uSunCol: { value: SUN_COL }, uTime: G.uTime, uCenter: { value: PLANET }, uR: { value: PR }, uRingN },
      vertexShader:  `varying vec3 vN, vP, vL; void main(){ vL = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader:  `${GLSL_NOISE}
        ${GLSL_RING}
        uniform vec3 uSun, uSunCol, uCenter, uRingN; uniform float uTime, uR; varying vec3 vN, vP, vL;
        void main(){
          vec3 n = normalize(vN), p = normalize(vL);
          float lat = p.y;

          float shear = fbm3(vec3(p.x * 1.6, p.y * 16.0, p.z * 1.6) + vec3(uTime * 0.003, 0.0, 0.0)) - 0.5;
          float edgeT = fbm3(vec3(p.x * 6.0, p.y * 30.0, p.z * 6.0) + 7.0) - 0.5;
          float y = lat + shear * 0.045 + edgeT * 0.012;
          float h = 0.5 + 0.30 * sin(y * 21.0 + 0.6) + 0.16 * sin(y * 53.0 + 1.9) + 0.09 * sin(y * 131.0 + 0.3) + 0.05 * sin(y * 287.0);
          vec3 cream = vec3(0.60, 0.52, 0.39), tan = vec3(0.40, 0.29, 0.19), teal = vec3(0.17, 0.24, 0.26), umber = vec3(0.15, 0.10, 0.07);
          vec3 base = mix(umber, tan, smoothstep(0.15, 0.45, h));
          base = mix(base, cream, smoothstep(0.50, 0.80, h));
          float tz = smoothstep(0.35, 0.65, 0.5 + 0.5 * sin(y * 9.0 + 2.2));
          base = mix(base, teal, tz * 0.55 * smoothstep(0.62, 0.30, h));
          base *= 0.86 + 0.28 * fbm3(vec3(p.x * 3.0, p.y * 40.0, p.z * 3.0));

          vec2 sc = vec2(atan(p.z, p.x) * 1.1 - 1.9, (p.y + 0.24) * 3.4);
          float sp = length(sc), sw = 1.0 - smoothstep(0.08, 0.20, sp);
          base = mix(base, vec3(0.52, 0.26, 0.14), sw * (0.55 + 0.25 * sin(sp * 60.0 + atan(sc.y, sc.x) * 2.0)));

          vec3 V = normalize(cameraPosition - vP);
          float ndl = dot(n, uSun), ndv = max(dot(n, V), 0.0);
          float day = smoothstep(-0.10, 0.45, ndl);
          vec3 col = base * uSunCol * day * 1.15 * (0.55 + 0.45 * pow(ndv, 0.35));
          float term = exp(-pow((ndl - 0.02) / 0.10, 2.0));
          col += vec3(0.42, 0.20, 0.08) * term * 0.10 * smoothstep(-0.2, 0.2, ndl);
          col += base * vec3(0.10, 0.16, 0.20) * 0.025;

          float tR = -dot(vP - uCenter, uRingN) / dot(uSun, uRingN);
          if (tR > 0.0) {
            vec3 hp = vP + uSun * tR - uCenter;
            float rr = (length(hp) / uR - ${RING_I.toFixed(2)}) / ${(RING_O - RING_I).toFixed(2)};
            col *= 1.0 - 0.85 * ringDen(rr, 0.002);
          }

          float rim = pow(1.0 - ndv, 4.0);
          float fwd = pow(max(dot(-V, uSun), 0.0), 3.0);
          col += vec3(0.30, 0.55, 0.80) * rim * (0.65 * smoothstep(-0.25, 0.35, ndl) + 0.9 * fwd * smoothstep(-0.6, 0.0, ndl));
          gl_FragColor = vec4(col, 1.0);
        }`
    }));
    planetMesh.position.copy(PLANET); planetMesh.name = 'planet';
    return planetMesh;
  }

  function makeRings() {
    const RI = PR * RING_I, RO = PR * RING_O, SEG = 512, ROWS = 24;
    const pos = [], idx = [];
    for (let j = 0; j <= ROWS; j++) for (let i = 0; i < SEG; i++) {
      const a = i / SEG * TAU, r = lerp(RI, RO, j / ROWS);
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < SEG; i++) {
      const a = j * SEG + i, b = j * SEG + (i + 1) % SEG, c = (j + 1) * SEG + i, d = (j + 1) * SEG + (i + 1) % SEG;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    ringMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: SUNP }, uSunCol: { value: SUN_COL }, uCenter: { value: PLANET }, uR: { value: PR }, uTime: G.uTime, uRingN },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader:  `varying vec3 vP, vLp; void main(){ vLp = position; vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader:  `${GLSL_NOISE}
        ${GLSL_RING}
        uniform vec3 uSun, uSunCol, uCenter, uRingN; uniform float uR, uTime; varying vec3 vP, vLp;
        void main(){
          float r = (length(vLp.xz) / uR - ${RING_I.toFixed(2)}) / ${(RING_O - RING_I).toFixed(2)};
          float w = fwidth(r);
          float den = ringDen(r, w);
          float ang = atan(vLp.z, vLp.x);
          den *= 0.88 + 0.24 * vnoise(vec2(r * 120.0, ang * 3.0));
          vec3 V = normalize(cameraPosition - vP);
          float ls = dot(uRingN, uSun), vs = dot(uRingN, V);
          float mu0 = abs(ls), mu = max(abs(vs), 0.03);
          vec3 alb = mix(vec3(0.62, 0.55, 0.45), vec3(0.42, 0.40, 0.38), smoothstep(0.55, 0.9, r));

          float refl = mu0 * 1.4;
          float trans = mu0 * (1.0 - den) * 2.2;
          float fwd = pow(max(dot(-V, uSun), 0.0), 6.0) * 2.5;
          float lit = (ls * vs > 0.0) ? refl : (trans + fwd * (1.0 - den * 0.6));

          vec3 d = vP - uCenter; float side = dot(d, uSun); float perp = length(d - uSun * side);
          float shade = 1.0 - (1.0 - smoothstep(uR * 0.97, uR * 1.03, perp)) * step(side, 0.0);
          vec3 col = alb * uSunCol * (0.06 + lit) * shade * 0.75;
          float alpha = clamp(den * 1.05 / (0.35 + 0.65 * mu), 0.0, 0.92);
          gl_FragColor = vec4(col * alpha, alpha);
        }`
    });
    ringMat.blending = THREE.CustomBlending; ringMat.blendSrc = THREE.OneFactor; ringMat.blendDst = THREE.OneMinusSrcAlphaFactor;
    const m = new THREE.Mesh(g, ringMat); m.frustumCulled = false;
    ringGroup.add(m);
    ringGroup.position.copy(PLANET); ringGroup.name = 'rings';
    ringGroup.rotation.set(0.46, 0.18, 0.34);
    return ringGroup;
  }

  function makeSun() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uCol: { value: SUN_COL } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader:  `uniform vec3 uCol; varying vec2 vUv;
        void main(){
          vec2 q = (vUv - 0.5) * 2.0; float d = length(q);
          float core = exp(-pow(d / 0.055, 2.0)) * 14.0;
          float inner = exp(-pow(d / 0.16, 2.0)) * 2.6;
          float halo = exp(-pow(d / 0.52, 2.0)) * 0.42;
          float streak = exp(-abs(q.y) * 90.0) * exp(-abs(q.x) * 1.35) * 0.9;
          float streak2 = exp(-abs(q.y) * 26.0) * exp(-abs(q.x) * 4.2) * 0.18;
          vec3 c = uCol * (core + inner + halo) + vec3(0.55, 0.72, 1.0) * (streak + streak2);
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), mat);
    sunMesh.position.copy(SUN).multiplyScalar(9200);
    sunMesh.lookAt(0, 0, 0);
    mat.depthTest = false; sunMesh.frustumCulled = false; sunMesh.renderOrder = 900; sunMesh.name = 'sun';

    const sc = document.createElement('canvas'); sc.width = sc.height = 256;
    const sx = sc.getContext('2d');
    const sg = sx.createRadialGradient(128, 128, 0, 128, 128, 128);
    sg.addColorStop(0.00, 'rgba(255,255,255,1.0)');
    sg.addColorStop(0.035, 'rgba(255,255,255,0.95)');
    sg.addColorStop(0.10, 'rgba(255,238,205,0.55)');
    sg.addColorStop(0.30, 'rgba(255,196,120,0.16)');
    sg.addColorStop(0.62, 'rgba(255,170,90,0.04)');
    sg.addColorStop(1.00, 'rgba(255,160,80,0)');
    sx.fillStyle = sg; sx.fillRect(0, 0, 256, 256);
    const stex = new THREE.CanvasTexture(sc); stex.colorSpace = THREE.SRGBColorSpace;
    const smat = new THREE.SpriteMaterial({ map: stex, color: SUN_COL, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false, fog: false });
    const spr = new THREE.Sprite(smat); spr.scale.set(1600, 1600, 1); spr.renderOrder = 901; spr.frustumCulled = false;
    sunMesh.add(spr);

    const bmat = new THREE.SpriteMaterial({ map: stex, color: 0x9fc8ff, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false, fog: false, opacity: 0.10 });
    const bar = new THREE.Sprite(bmat); bar.scale.set(5600, 150, 1); bar.renderOrder = 902; bar.frustumCulled = false; sunMesh.add(bar);
    return sunMesh;
  }

  function makeFleetShip(len, hue) {
    const g = new THREE.Group();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color(hue) }, uLen: { value: len } },
      vertexShader: `varying vec3 vN, vV, vL; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vV = normalize(cameraPosition - wp.xyz); vL = position; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 uCol; uniform float uLen; varying vec3 vN, vV, vL;
        void main(){
          float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
          float wy = vL.y / uLen, wz = vL.z / uLen;
          float row = smoothstep(0.0032, 0.0012, abs(wy - 0.009)) + smoothstep(0.0028, 0.0010, abs(wy + 0.004));
          float cell = fract(vL.x / uLen * 54.0);
          float col = step(0.68, cell) * step(cell, 0.86);
          float face = smoothstep(0.046, 0.052, abs(wz));
          float wv = row * col * face;
          vec3 col3 = vec3(0.012, 0.015, 0.020) + uCol * rim * 0.52;
          col3 += uCol * wv * 0.55;
          gl_FragColor = vec4(col3, 1.0);
        }`
    });
    const body = new THREE.Mesh(plateGeo(len, len * 0.075, len * 0.11, len * 0.018), mat);
    body.rotation.z = 0; g.add(body);
    const spine = new THREE.Mesh(plateGeo(len * 0.42, len * 0.035, len * 0.075, len * 0.012), mat);
    spine.position.y = len * 0.055; g.add(spine);
    const fin = new THREE.Mesh(plateGeo(len * 0.16, len * 0.14, len * 0.012, len * 0.006), mat);
    fin.position.set(-len * 0.28, len * 0.05, 0); g.add(fin);
    const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hue).multiplyScalar(3.4) });
    const lg = new THREE.SphereGeometry(len * 0.0035, 6, 4);
    const lights = new THREE.InstancedMesh(lg, lightMat, 14);
    for (let i = 0; i < 14; i++) {
      const x = (hash2(i, 4, 9) - 0.5) * len * 0.90, y = (hash2(i, 5, 9) - 0.5) * len * 0.05, z = len * 0.055 + (hash2(i, 6, 9) - 0.5) * len * 0.01;
      const s = i % 4 === 1 ? 0.0 : 0.5 + hash2(i, 7, 9) * 1.7;
      TMPM.compose(V3(x, y, z), TMPQ.identity(), V3(s, s, s)); lights.setMatrixAt(i, TMPM.clone());
    }
    g.add(lights);
    return g;
  }

  function makeFleet() {
    const defs = [
      { p: [-9200, 700, -1500], len: 1250, hue: 0x5ec8e8, rot: 0.4 },
      { p: [-7600, -1500, 1500], len: 760, hue: 0x5ec8e8, rot: -0.7 },
      { p: [-9000, -500, -2500], len: 2100, hue: 0xff3826, rot: 0.15 },
    ];
    for (const d of defs) {
      const s = makeFleetShip(d.len, d.hue); s.name = 'fleet';
      s.position.set(...d.p); s.rotation.set(0.12, d.rot, 0.06);
      fleetGroups.push(s);
    }
  }

  function makeDust() {
    const N = 4200, pos = new Float32Array(N * 3), seed = new Float32Array(N * 4), r = rng(SEED + 71);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (r() - 0.5) * 620; pos[i * 3 + 1] = (r() - 0.5) * 260; pos[i * 3 + 2] = (r() - 0.5) * 620;
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    dustMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: G.uTime, uPx: { value: 900 } },
      vertexShader:  `attribute vec4 aSeed; uniform float uTime, uPx; varying float vA; varying vec3 vC;
        void main(){
          vec3 p = position;
          float t = uTime * (0.008 + 0.02 * aSeed.w) + aSeed.w * 60.0;
          p.x += sin(t + aSeed.x * 40.0) * 5.0; p.y += cos(t * 0.8 + aSeed.y * 35.0) * 3.0; p.z += sin(t * 0.6 + aSeed.z * 30.0) * 5.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.20 + 0.72 * aSeed.w * aSeed.w) * uPx / max(-mv.z, 1.0);
          vA = (0.20 + 0.65 * aSeed.y) * smoothstep(10.0, 34.0, -mv.z) * smoothstep(620.0, 260.0, -mv.z);
          vC = mix(vec3(0.55, 0.72, 1.0), vec3(1.0, 0.72, 0.45), aSeed.z);
        }`,
      fragmentShader: `varying float vA; varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(vC * a * a * vA * 0.26, 1.0); }`
    });
    const pts = new THREE.Points(g, dustMat); pts.frustumCulled = false; return pts;
  }

  async function build(scene) {
    const map = await loadSkyMap();
    scene.add(makeSky(map));
    scene.add(makePlanet());
    scene.add(makeRings());
    scene.add(makeSun());
    scene.add(makeDust());

  }

  function update(t, camera) {
    if (sunMesh) sunMesh.quaternion.copy(camera.quaternion);
    if (planetMesh) planetMesh.rotation.y = t * 0.0035;
    if (ringGroup) ringGroup.rotation.y = 0.10 + t * 0.002;
    if (ringGroup) { ringGroup.updateMatrixWorld(); uRingN.value.set(0, 1, 0).applyQuaternion(ringGroup.quaternion).normalize(); }
  }
  return { build, update, PLANET, PR, SUNP };
})();
