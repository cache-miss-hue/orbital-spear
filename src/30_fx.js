'use strict';

const FX = (() => {
  const _v = V3(), _v2 = V3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = V3();
  let beams, beamsData = [], muzzle, muzzleGeo, bursts, flashQuads = [], plumes, trails, trailGeo, steam, deckCones = [], hero, fliers = [];
  const ENEMY = V3(-2560, 110, -880);
  const FIRE_PERIOD = 2.35;

  function adMat(fs, uniforms = {}, vHead = '') {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms,
      vertexShader:  `${vHead} varying vec2 vUv; varying float vFade; varying float vNear;
        void main(){ vUv = uv;
          vec4 wp = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          gl_Position = projectionMatrix * viewMatrix * wp;
          float d = length(cameraPosition - wp.xyz);
          vFade = clamp(1.0 - smoothstep(900.0, 2400.0, d), 0.0, 1.0);
          vNear = smoothstep(22.0, 130.0, d);
        }`,
      fragmentShader: fs
    });
  }

  function buildBeams(scene) {
    const guns = Ship.guns.filter(g => g.pos.y < 45);
    const gg = new THREE.CylinderGeometry(0.065, 0.065, 1, 6, 1, true);
    const mat = adMat( `varying vec2 vUv; varying float vFade; varying float vNear;
      uniform vec3 uCol;
      void main(){
        float end = smoothstep(0.0, 0.10, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        vec3 c = mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.82, 0.52), end) * 1.05;
        gl_FragColor = vec4(c, end * end * vFade * vNear * 0.8);
      }`, { uCol: { value: new THREE.Color(1, 0.45, 0.12) } });
    beams = new THREE.InstancedMesh(gg, mat, 18);
    beams.frustumCulled = false; scene.add(beams);
    for (let i = 0; i < 18; i++) {
      const gun = guns[i % guns.length];
      const spread = V3((hash2(i, 1, 4) - 0.5) * 0.035, (hash2(i, 2, 4) - 0.5) * 0.028, (hash2(i, 3, 4) - 0.5) * 0.035);
      const dir = gun.dir.clone().add(spread).normalize();
      beamsData.push({ start: gun.pos.clone(), dir, phase: hash2(i, 7, 4) * FIRE_PERIOD, speed: 520 + hash2(i, 8, 4) * 160 });
    }
  }

  function updateBeams(t) {
    const LEN = 5900, Z = V3(0, 0, 0), yAxis = V3(0, 1, 0);
    for (let i = 0; i < beamsData.length; i++) {
      const b = beamsData[i];
      const k = ((t + b.phase) % FIRE_PERIOD) / FIRE_PERIOD;
      const dist = k * 5600;
      const fireOn = t - k * FIRE_PERIOD >= Film.T.CONTACT;
      if (dist > LEN || !fireOn) { _m.compose(_v.set(0, -9999, 0), _q.identity(), Z); beams.setMatrixAt(i, _m); continue; }
      const seg = 96;
      _v.copy(b.start).addScaledVector(b.dir, dist);
      _q.setFromUnitVectors(yAxis, b.dir);
      const yaw = new THREE.Quaternion().setFromAxisAngle(yAxis, Math.PI / 2);
      _q.multiply(yaw);
      _s.set(1, seg, 1);
      _m.compose(_v, _q, _s); beams.setMatrixAt(i, _m);
    }
    beams.instanceMatrix.needsUpdate = true;
  }

  function buildMuzzle(scene) {
    const guns = Ship.guns, N = guns.length;
    const pos = new Float32Array(N * 3), ph = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = guns[i].pos.x; pos[i * 3 + 1] = guns[i].pos.y; pos[i * 3 + 2] = guns[i].pos.z; ph[i] = i / N; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    muzzle = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: G.uTime, uPx: { value: 900 } },
      vertexShader:  `attribute float aPhase; uniform float uTime, uPx; varying float vA;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float k = fract((uTime + aPhase * ${FIRE_PERIOD.toFixed(2)}) / ${FIRE_PERIOD.toFixed(2)});
          vA = smoothstep(0.0, 0.02, k) * (1.0 - smoothstep(0.03, 0.10, k));
          gl_PointSize = (10.0 + 26.0 * vA) * uPx / max(-mv.z, 1.0) * (0.5 + vA);
        }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(vec3(1.0, 0.72, 0.34) * a * a * vA * 5.0, 1.0); }`
    }));
    muzzle.frustumCulled = false; scene.add(muzzle);
  }

  function buildBursts(scene) {
    const centers = [ENEMY.clone(), ENEMY.clone().add(V3(320, 160, 220)), ENEMY.clone().add(V3(-260, -120, 340)),
      V3(330, 40, 30), V3(520, 110, 90)];
    const per = 150, N = centers.length * per;
    const pos = new Float32Array(N * 3), dir = new Float32Array(N * 3), spd = new Float32Array(N), ph = new Float32Array(N), sd = new Float32Array(N);
    const r = rng(SEED + 808);
    for (let i = 0; i < N; i++) {
      const ci = Math.floor(i / per), c = centers[ci];
      pos[i * 3] = c.x; pos[i * 3 + 1] = c.y; pos[i * 3 + 2] = c.z;
      const a = r() * TAU, b = Math.acos(2 * r() - 1), sp = 40 + r() * 210;
      dir[i * 3] = Math.sin(b) * Math.cos(a); dir[i * 3 + 1] = Math.cos(b); dir[i * 3 + 2] = Math.sin(b) * Math.sin(a);
      spd[i] = sp; ph[i] = ci * 2.3 + r() * 0.4; sd[i] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    bursts = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: G.uTime, uPx: { value: 900 }, uOn: { value: 0 } },
      vertexShader:  `attribute vec3 aDir; attribute float aSpeed, aPhase, aSeed; uniform float uTime, uPx, uOn; varying float vA; varying vec3 vC;
        void main(){
          float age = mod(uTime + aPhase, 9.0);
          float life = clamp(age / 2.2, 0.0, 1.0);
          vec3 p = position + aDir * aSpeed * life + vec3(0.0, -8.0 * life * life, 0.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          float on = step(age, 2.2) * step(uOn, uTime - age);
          vA = on * (1.0 - life) * (0.25 + 0.75 * aSeed);
          gl_PointSize = (14.0 + 42.0 * aSeed) * uPx / max(-mv.z, 1.0) * (1.0 - life * 0.4);
          vC = mix(vec3(1.0, 0.30, 0.05), vec3(1.0, 0.92, 0.70), aSeed * aSeed);
        }`,
      fragmentShader: `varying float vA; varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(vC * a * a * vA * 2.2, 1.0); }`
    }));
    bursts.frustumCulled = false; scene.add(bursts);

    const flashGeo = new THREE.PlaneGeometry(1, 1);
    for (let ci = 0; ci < centers.length; ci++) {
      const mat = adMat( `varying vec2 vUv; varying float vFade; uniform float uA;
        void main(){ vec2 q = (vUv - 0.5) * 2.0; float d = length(q); float core = exp(-pow(d / 0.16, 2.0)) * 4.0 + exp(-pow(d / 0.6, 2.0)) * 0.5; gl_FragColor = vec4(vec3(1.0, 0.72, 0.42) * core * uA, uA); }`, { uA: { value: 0 } });
      const q = new THREE.Mesh(flashGeo, mat); q.userData.c = ci; q.frustumCulled = false; q.renderOrder = 5;
      scene.add(q); flashQuads.push({ mesh: q, mat, center: centers[ci], kind: 'flash' });
      const ringMat = adMat( `varying vec2 vUv; varying float vFade; uniform float uA;
        void main(){ vec2 q = (vUv - 0.5) * 2.0; float d = length(q); float an = atan(q.y, q.x);
          float brk = 0.35 + 0.65 * smoothstep(-0.2, 0.9, sin(an * 3.0 + 1.3) * 0.6 + sin(an * 7.0 + 0.4) * 0.4);
          float rr = 0.70 + 0.05 * sin(an * 5.0 + 2.0);
          float ring = (smoothstep(0.16, 0.0, abs(d - rr)) * 0.55 + smoothstep(0.45, 0.0, d - 0.1) * 0.12) * brk;
          vec3 c = mix(vec3(1.0, 0.62, 0.32), vec3(0.55, 0.70, 0.90), smoothstep(0.3, 0.8, d));
          gl_FragColor = vec4(c * ring * uA * 1.4, ring * uA); }`, { uA: { value: 0 } });
      const qr = new THREE.Mesh(flashGeo, ringMat); qr.frustumCulled = false; qr.renderOrder = 5;
      scene.add(qr); flashQuads.push({ mesh: qr, mat: ringMat, center: centers[ci], kind: 'ring' });
    }
  }

  function updateBursts(t, camera) {
    for (const f of flashQuads) {
      const age = (t + f.center.x * 0.0007 + f.center.z * 0.0003) % 9.0;
      const life = clamp(age / 2.4, 0, 1);
      const on = (age < 2.4 && t - age >= Film.T.CONTACT + 1.0) ? 1 : 0;
      if (f.kind === 'flash') {
        const s = 11 + life * 20; f.mesh.scale.set(s, s, 1); f.mesh.position.copy(f.center);
        f.mat.uniforms.uA.value = on * (1 - life) * 0.75;
      } else {
        const s = 18 + life * 120; f.mesh.scale.set(s, s, 1); f.mesh.position.copy(f.center);
        f.mat.uniforms.uA.value = on * (1 - life) * 0.38;
      }
      f.mesh.quaternion.copy(camera.quaternion);
    }
  }

  function buildPlumes(scene, engines) {
    const geo = new THREE.CylinderGeometry(0.10, 1.0, 1, 16, 1, true);
    const mat = adMat( `varying vec2 vUv; varying float vFade; uniform float uTime;
        void main(){
          float y = vUv.y; float flick = 0.86 + 0.14 * sin(uTime * 23.0 + vUv.x * 40.0) * sin(uTime * 7.0);
          float a = smoothstep(0.0, 0.04, y) * (1.0 - smoothstep(0.25, 0.95, y)) * 0.85;
          vec3 c = mix(vec3(0.55, 0.85, 1.0), vec3(1.0, 0.42, 0.12), smoothstep(0.08, 0.6, y));
          c += vec3(1.0, 0.96, 0.9) * exp(-y * 12.0) * 2.4;
          float shock = 0.75 + 0.25 * smoothstep(0.6, 1.0, sin(y * 46.0 - uTime * 30.0));
          gl_FragColor = vec4(c * a * flick * shock * 1.6 * vFade, a);
        }`, { uTime: G.uTime });
    plumes = new THREE.InstancedMesh(geo, mat, engines.length);
    plumes.frustumCulled = false; scene.add(plumes);
    plumes.userData.engines = engines;

    const gt = decalTexture(128, (c, S) => { const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      g.addColorStop(0, 'rgba(255,250,240,1)'); g.addColorStop(0.12, 'rgba(190,225,255,0.85)'); g.addColorStop(0.4, 'rgba(255,150,70,0.22)'); g.addColorStop(1, 'rgba(255,120,40,0)');
      c.fillStyle = g; c.fillRect(0, 0, S, S); });
    for (const e of engines) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: new THREE.Color(1.0, 0.85, 0.7).multiplyScalar(2.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
      sp.position.copy(e.pos).add(V3(-2.5, 0, 0)); sp.scale.setScalar(e.size * 2.4); sp.renderOrder = 6; scene.add(sp);
    }
  }
  function updatePlumes(t) {
    const E = plumes.userData.engines, yAxis = V3(0, 1, 0), negX = V3(-1, 0, 0);
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      _q.setFromUnitVectors(yAxis, negX);
      _v.copy(e.pos).addScaledVector(negX, 24);
      _s.set(e.size * 0.50 * (0.95 + 0.05 * Math.sin(t * 17 + i)), 48 + 4.5 * Math.sin(t * 9 + i * 2), e.size * 0.50 * (0.95 + 0.05 * Math.cos(t * 13 + i)));
      _m.compose(_v, _q, _s); plumes.setMatrixAt(i, _m);
    }
    plumes.instanceMatrix.needsUpdate = true;
  }

  function buildSquadFX(scene) {
    const N = fliers.length;
    const plumeGeo = new THREE.CylinderGeometry(0.04, 0.40, 1, 10, 1, true); plumeGeo.translate(0, 0.5, 0);
    const plumeMat = adMat( `varying vec2 vUv; varying float vFade; uniform float uTime;
      void main(){ float y = vUv.y; float a = smoothstep(0.0, 0.12, y) * (1.0 - smoothstep(0.45, 1.0, y));
        vec3 c = mix(vec3(0.62, 0.88, 1.0), vec3(1.0, 0.52, 0.18), smoothstep(0.02, 0.4, y));
        gl_FragColor = vec4(c * a * (2.2 + 0.8 * sin(uTime * 19.0 + vUv.x * 22.0)) * vFade, a); }`, { uTime: G.uTime });
    plumes.userData.squad = new THREE.InstancedMesh(plumeGeo, plumeMat, N * 2);
    plumes.userData.squad.frustumCulled = false; scene.add(plumes.userData.squad);

    const TP = 64, pts = N * TP;
    const P = new Float32Array(pts * 2 * 3), NX = new Float32Array(pts * 2 * 3), SD = new Float32Array(pts * 2), AA = new Float32Array(pts * 2), WW = new Float32Array(pts * 2), UU = new Float32Array(pts * 2);
    for (let k = 0; k < pts; k++) { SD[k * 2] = -1; SD[k * 2 + 1] = 1; UU[k * 2] = UU[k * 2 + 1] = (k % TP) / (TP - 1); }
    const idx = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < TP - 1; j++) { const a = (i * TP + j) * 2, b = a + 2; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    trailGeo.setAttribute('aN', new THREE.BufferAttribute(NX, 3));
    trailGeo.setAttribute('aSide', new THREE.BufferAttribute(SD, 1));
    trailGeo.setAttribute('aAlpha', new THREE.BufferAttribute(AA, 1));
    trailGeo.setAttribute('aW', new THREE.BufferAttribute(WW, 1));
    trailGeo.setAttribute('aU', new THREE.BufferAttribute(UU, 1));
    trailGeo.setIndex(idx);
    trailGeo.userData.TP = TP;
    trails = new THREE.Mesh(trailGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
      vertexShader:  `attribute vec3 aN; attribute float aSide, aAlpha, aW, aU; varying float vA, vS, vU;
        void main(){ vec4 a = modelViewMatrix * vec4(position, 1.0), b = modelViewMatrix * vec4(aN, 1.0);
          vec2 d = b.xy - a.xy; float l = length(d); d = l > 1e-4 ? d / l : vec2(1.0, 0.0);
          a.xy += vec2(-d.y, d.x) * aW * aSide;
          gl_Position = projectionMatrix * a; vA = aAlpha * smoothstep(3.0, 20.0, -a.z); vS = aSide; vU = aU; }`,
      fragmentShader: `varying float vA, vS, vU; void main(){ float e = 1.0 - abs(vS); float core = e * e;
        vec3 hot = vec3(0.75, 0.88, 1.0), warm = vec3(1.0, 0.52, 0.20);
        vec3 c = mix(hot, warm, smoothstep(0.0, 0.18, vU)) * (core * 0.95 + e * 0.30) * smoothstep(0.0, 0.06, vU + 0.02);
        gl_FragColor = vec4(c * vA, 1.0); }`
    }));
    trails.frustumCulled = false; scene.add(trails);

    const NS = 110, spos = new Float32Array(NS * 3), sseed = new Float32Array(NS * 3), r = rng(SEED + 909);
    for (let i = 0; i < NS; i++) {
      const onMech = false;
      const HA = G.anchors.hero, base = onMech ? V3(HA.x - 3.6, HA.y + 13.0, (i % 2 ? 2.0 : -2.0)) : G.anchors.floods[i % 2].p.clone();
      spos[i * 3] = base.x + (r() - 0.5) * (onMech ? 2.0 : 8.0);
      spos[i * 3 + 1] = base.y + (onMech ? 0.0 : 0.2);
      spos[i * 3 + 2] = base.z + (r() - 0.5) * (onMech ? 1.2 : 8.0);
      sseed[i * 3] = r(); sseed[i * 3 + 1] = r(); sseed[i * 3 + 2] = r();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(spos, 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(sseed, 3));
    steam = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: false,
      uniforms: { uTime: G.uTime, uPx: { value: 900 } },
      vertexShader:  `attribute vec3 aSeed; uniform float uTime, uPx; varying float vA;
        void main(){
          float age = fract(uTime * 0.16 + aSeed.x);
          vec3 p = position + vec3((aSeed.y - 0.5) * age * 9.0, age * (7.0 + aSeed.z * 8.0), (aSeed.z - 0.5) * age * 5.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          vA = smoothstep(0.0, 0.15, age) * (1.0 - age) * (0.10 + 0.22 * aSeed.y);
          gl_PointSize = (1.2 + age * 9.0) * uPx / max(-mv.z, 1.0);
        }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.1, r); gl_FragColor = vec4(vec3(0.62, 0.70, 0.78) * a * vA, a * vA); }`
    }));
    steam.frustumCulled = false; scene.add(steam);

  }

  function updateSquad(t) {
    const yAxis = V3(0, 1, 0), back = V3(-1, 0, 0), light = new THREE.Color();
    const sq = plumes.userData.squad;
    for (let i = 0; i < fliers.length; i++) {
      const f = fliers[i], thrust = f.userData.thrust || (() => 1), th0 = thrust(t);
      f.updateMatrixWorld(true);
      for (let k = 0; k < 2; k++) {
        const th = f.userData.thr[k];
        th.p.getWorldPosition(_v); th.q.getWorldPosition(_v2); _v2.sub(_v).normalize();
        _q.setFromUnitVectors(yAxis, _v2);
        const sc = Math.max(th0, 1e-4);
        _s.set(sc, (7.0 + 1.2 * Math.sin(t * 15 + i + k)) * sc, sc);
        _m.compose(_v, _q, _s); sq.setMatrixAt(i * 2 + k, _m);
      }

      f.userData.thr[0].p.getWorldPosition(_v2); f.userData.pathAt(t, _v); _v2.sub(_v);
      const TP = trailGeo.userData.TP, base = i * TP;
      for (let j = 0; j < TP; j++) {
        const tt = t - j * 0.03;
        f.userData.pathAt(tt, _v);
        _v.add(_v2);
        const q = (1 - j / TP) * thrust(tt);
        _v.y += Math.sin(j * 0.85 + i * 2.1) * 0.30 * q;
        _v.z += Math.cos(j * 0.71 + i * 1.3) * 0.42 * q;
        const arr = trailGeo.attributes, k = (base + j) * 2;
        arr.position.setXYZ(k, _v.x, _v.y, _v.z); arr.position.setXYZ(k + 1, _v.x, _v.y, _v.z);
        arr.aAlpha.setX(k, q * q * 0.42); arr.aAlpha.setX(k + 1, q * q * 0.42);
        const w = 0.45 + (1 - q) * 2.2; arr.aW.setX(k, w); arr.aW.setX(k + 1, w);
      }
    }
    sq.instanceMatrix.needsUpdate = true;

    { const A = trailGeo.attributes, TP = trailGeo.userData.TP, pp = A.position.array, nn = A.aN.array;
      for (let i = 0; i < fliers.length; i++) for (let j = 0; j < TP; j++) {
        const k = (i * TP + j) * 2, m = (i * TP + (j < TP - 1 ? j + 1 : j - 1)) * 2;
        for (let s2 = 0; s2 < 2; s2++) for (let c = 0; c < 3; c++) nn[(k + s2) * 3 + c] = pp[m * 3 + c] + (j < TP - 1 ? 0 : 2 * (pp[k * 3 + c] - pp[m * 3 + c]));
      }
      A.aN.needsUpdate = true; }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.aAlpha.needsUpdate = true;
    trailGeo.attributes.aW.needsUpdate = true;
  }

  let big = null;
  function buildBigBlast(scene) {
    const N = 900, pos = new Float32Array(N * 3), dir = new Float32Array(N * 3), spd = new Float32Array(N), sd = new Float32Array(N), r = rng(SEED + 4545);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = Film.BLAST_P.x; pos[i * 3 + 1] = Film.BLAST_P.y; pos[i * 3 + 2] = Film.BLAST_P.z;
      const a = r() * TAU, b = Math.acos(2 * r() - 1);
      dir[i * 3] = Math.sin(b) * Math.cos(a); dir[i * 3 + 1] = Math.cos(b) * 0.7; dir[i * 3 + 2] = Math.sin(b) * Math.sin(a);
      spd[i] = 60 + Math.pow(r(), 0.6) * 420; sd[i] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    const uAge = { value: -1 };
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uAge, uPx: { value: 900 } },
      vertexShader:  `attribute vec3 aDir; attribute float aSpeed, aSeed; uniform float uAge, uPx; varying float vA; varying vec3 vC;
        void main(){
          float age = max(uAge, 0.0), life = clamp(age / (2.5 + aSeed * 3.0), 0.0, 1.0);
          float dist = aSpeed * (1.0 - exp(-age * 1.6)) / 1.6;
          vec3 p = position + aDir * dist;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          vA = step(0.0, uAge) * (1.0 - life) * (0.3 + 0.7 * aSeed);
          gl_PointSize = min((20.0 + 60.0 * aSeed) * uPx / max(-mv.z, 1.0), 40.0);
          vC = mix(vec3(1.0, 0.36, 0.08), vec3(1.0, 0.90, 0.70), aSeed * (1.0 - life));
        }`,
      fragmentShader: `varying float vA; varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(vC * a * a * vA * 2.4, 1.0); }`
    }));
    pts.frustumCulled = false; scene.add(pts);
    const q = new THREE.PlaneGeometry(1, 1);
    const flash = new THREE.Mesh(q, adMat( `varying vec2 vUv; varying float vFade; uniform float uA;
      void main(){ vec2 c = (vUv - 0.5) * 2.0; float d = length(c);
        float core = (exp(-pow(d / 0.10, 2.0)) * 6.0 + exp(-pow(d / 0.35, 2.0)) * 1.2 + exp(-pow(d / 0.8, 2.0)) * 0.25) * smoothstep(1.0, 0.75, d);
        gl_FragColor = vec4(vec3(1.0, 0.70, 0.40) * core * uA, uA); }`, { uA: { value: 0 } }));
    const shell = new THREE.Mesh(q, adMat( `varying vec2 vUv; varying float vFade; uniform float uA, uK;
      void main(){ vec2 c = (vUv - 0.5) * 2.0; float d = length(c), an = atan(c.y, c.x);
        float brk = 0.30 + 0.70 * smoothstep(-0.3, 0.9, sin(an * 4.0 + 0.7) * 0.5 + sin(an * 9.0 + 2.1) * 0.3 + sin(an * 17.0) * 0.2);
        float rr = 0.78 + 0.06 * sin(an * 6.0 + 1.0);
        float ring = (smoothstep(0.20, 0.0, abs(d - rr)) * brk + smoothstep(0.9, 0.0, d) * 0.10) * smoothstep(1.0, 0.92, d);
        vec3 col = mix(vec3(1.0, 0.55, 0.25), vec3(0.6, 0.72, 0.95), uK);
        gl_FragColor = vec4(col * ring * uA, ring * uA); }`, { uA: { value: 0 }, uK: { value: 0 } }));
    for (const m of [flash, shell]) { m.frustumCulled = false; m.renderOrder = 6; m.position.copy(Film.BLAST_P); scene.add(m); }
    const light = new THREE.DirectionalLight(0xffa860, 0); light.position.copy(Film.BLAST_P); scene.add(light, light.target);

    const burn = new THREE.Mesh(q, adMat( `varying vec2 vUv; varying float vFade; uniform float uA, uTime;
      void main(){ vec2 c = (vUv - 0.5) * 2.0; float d = length(c);
        float f = 0.8 + 0.2 * sin(uTime * 13.0) * sin(uTime * 7.3 + 1.0);
        float core = (exp(-pow(d / 0.18, 2.0)) * 2.4 + exp(-pow(d / 0.5, 2.0)) * 0.5) * smoothstep(1.0, 0.7, d);
        gl_FragColor = vec4(vec3(1.0, 0.45, 0.14) * core * uA * f, uA); }`, { uA: { value: 0 }, uTime: G.uTime }));
    burn.frustumCulled = false; burn.renderOrder = 6; burn.position.copy(Film.BLAST_P); scene.add(burn);

    const NSm = 70, smp = new Float32Array(NSm * 3), sms = new Float32Array(NSm * 4), r2 = rng(SEED + 4646);
    for (let i = 0; i < NSm; i++) { const a = r2() * TAU, b = Math.acos(2 * r2() - 1); smp[i * 3] = Math.sin(b) * Math.cos(a); smp[i * 3 + 1] = Math.cos(b) * 0.6; smp[i * 3 + 2] = Math.sin(b) * Math.sin(a); sms[i * 4] = r2(); sms[i * 4 + 1] = r2(); sms[i * 4 + 2] = r2(); sms[i * 4 + 3] = r2(); }
    const smg = new THREE.BufferGeometry(); smg.setAttribute('position', new THREE.BufferAttribute(smp, 3)); smg.setAttribute('aSeed', new THREE.BufferAttribute(sms, 4));
    const smoke = new THREE.Points(smg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, uniforms: { uAge, uPx: { value: 900 }, uC: { value: Film.BLAST_P } },
      vertexShader:  `attribute vec4 aSeed; uniform float uAge, uPx; uniform vec3 uC; varying float vA, vHeat;
        void main(){ float age = max(uAge, 0.0); float R = 60.0 + 260.0 * (1.0 - exp(-age * 0.8)) * (0.5 + aSeed.x);
          vec3 p = uC + position * R; vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          vA = step(0.0, uAge) * smoothstep(0.0, 0.6, age) * exp(-age * 0.12) * (0.35 + 0.35 * aSeed.y);
          vHeat = exp(-age * 0.9) * (1.0 - aSeed.x * 0.6);
          gl_PointSize = min((140.0 + 260.0 * aSeed.z) * (0.6 + 0.4 * min(age, 3.0)) * uPx / max(-mv.z, 1.0), 900.0); }`,
      fragmentShader: `varying float vA, vHeat; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.25, r) * vA;
        vec3 c = mix(vec3(0.05, 0.045, 0.05), vec3(0.9, 0.35, 0.10), vHeat * (1.0 - r)); gl_FragColor = vec4(c * a, a); }`
    }));
    smoke.material.blending = THREE.CustomBlending; smoke.material.blendSrc = THREE.OneFactor; smoke.material.blendDst = THREE.OneMinusSrcAlphaFactor;
    smoke.frustumCulled = false; smoke.renderOrder = 5; scene.add(smoke);
    big = { pts, uAge, flash, shell, light, burn, smoke };
  }
  function updateBigBlast(t, camera) {
    if (!big) return;
    const a = t - Film.T.BLAST;
    big.uAge.value = a; big.pts.material.uniforms.uPx.value = Post.H;
    const on = a >= 0 ? 1 : 0;
    big.smoke.material.uniforms.uPx.value = Post.H;
    const fs = 260 + 900 * (1 - Math.exp(-Math.max(a, 0) * 2.5));
    big.flash.scale.set(fs, fs, 1); big.flash.quaternion.copy(camera.quaternion);
    big.flash.material.uniforms.uA.value = on * (Math.exp(-Math.max(a, 0) * 1.4) * 1.4 + 0.10 * Math.exp(-Math.max(a, 0) * 0.25));
    const ss = 200 + 1700 * (1 - Math.exp(-Math.max(a, 0) * 0.9));
    big.shell.scale.set(ss, ss, 1); big.shell.quaternion.copy(camera.quaternion);
    big.shell.material.uniforms.uA.value = on * Math.exp(-Math.max(a, 0) * 0.55) * 0.55; big.shell.material.uniforms.uK.value = clamp(a / 4);
    big.light.intensity = on * (5.5 * Math.exp(-Math.max(a, 0) * 1.2) + 0.6 * Math.exp(-Math.max(a, 0) * 0.2));
    if (hero && hero.root) big.light.target.position.copy(hero.root.position);
    big.burn.scale.set(170, 170, 1); big.burn.quaternion.copy(camera.quaternion); big.burn.material.uniforms.uA.value = Film.sstep(Film.T.BLAST + 0.8, Film.T.BLAST + 2.5, t);
  }

  function build(scene, heroRef, fliersRef) {
    hero = heroRef; fliers = fliersRef;
    buildBeams(scene); buildMuzzle(scene); buildBursts(scene);
    buildPlumes(scene, Ship.engines);
    buildSquadFX(scene);
    buildBigBlast(scene);
  }
  function update(t, camera) {
    updateBeams(t); updatePlumes(t); updateSquad(t); updateBursts(t, camera); updateBigBlast(t, camera);
    if (muzzle) muzzle.visible = t >= Film.T.CONTACT;
    if (bursts) bursts.material.uniforms.uOn.value = Film.T.CONTACT + 1.0;
    if (muzzle) muzzle.material.uniforms.uPx.value = Post.H;
    if (steam) steam.material.uniforms.uPx.value = Post.H;
  }
  return { build, update, ENEMY };
})();
