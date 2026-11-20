'use strict';

const Catapult = (() => {
  const X0 = 146, X1 = 197.5, LEN = X1 - X0, NL = 26;
  let lights, shuttle, sparks, steam, uT = { value: 0 };
  const _m = new THREE.Matrix4(), _c = new THREE.Color(), _v = V3();

  function build(scene) {
    const DY = Film.DECK;
    const G = new THREE.Group(); G.name = 'catapult'; scene.add(G);
    const dark = new THREE.MeshStandardMaterial({ color: 0x07090a, metalness: 0.6, roughness: 0.7 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6f777a, metalness: 0.9, roughness: 0.28 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x1d2427, metalness: 0.7, roughness: 0.5 });
    const box = (m, w, h, d, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.receiveShadow = true; G.add(o); return o; };

    box(dark, LEN, 0.06, 1.8, X0 + LEN / 2, DY + 0.03, 0);
    for (const s of [1, -1]) {
      box(frame, LEN, 0.16, 0.34, X0 + LEN / 2, DY + 0.08, s * 1.07);
      box(steel, LEN, 0.10, 0.14, X0 + LEN / 2, DY + 0.11, s * 0.42);
    }

    for (let x = X0 + 1; x < X1; x += 2) box(frame, 0.12, 0.05, 1.6, x, DY + 0.07, 0);

    const lg = new THREE.BoxGeometry(0.55, 0.06, 0.16);
    lights = new THREE.InstancedMesh(lg, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), NL * 2);
    for (let i = 0; i < NL * 2; i++) {
      const x = X0 + 1 + (i % NL) * (LEN - 2) / (NL - 1), z = (i < NL ? 1 : -1) * 1.38;
      _m.makeTranslation(x, DY + 0.13, z); lights.setMatrixAt(i, _m); lights.setColorAt(i, _c.setRGB(1, 0.5, 0.1));
    }
    G.add(lights);

    shuttle = new THREE.Group();
    const sb = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.42, 1.25), frame); sb.position.y = 0.21; shuttle.add(sb);
    const sh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.5), steel); sh.position.set(0.6, 0.5, 0); shuttle.add(sh);
    const sl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.45, 0.1).multiplyScalar(2.5), toneMapped: false }));
    sl.position.set(-1.45, 0.44, 0); shuttle.add(sl); shuttle.userData.lamp = sl.material;
    shuttle.position.set(Film.WALK_END_X, DY, 0); G.add(shuttle);

    const NS = 700, sp = new Float32Array(NS * 3), sd = new Float32Array(NS * 4), r = rng(SEED + 2601);
    for (let i = 0; i < NS; i++) { sd[i * 4] = r(); sd[i * 4 + 1] = r(); sd[i * 4 + 2] = r(); sd[i * 4 + 3] = r(); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4));
    const T0 = Film.LAUNCH_T0, DUR = Film.LAUNCH_DUR, A = 2 * (Film.LAUNCH_END_X - Film.WALK_END_X) / (DUR * DUR);
    sparks = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uT, uPx: { value: 900 } },
      vertexShader:  `attribute vec4 aSeed; uniform float uT, uPx; varying float vA;
        void main(){
          float ts = ${T0.toFixed(3)} + aSeed.x * ${DUR.toFixed(3)};
          float tau = ts - ${T0.toFixed(3)};
          float x0 = ${Film.WALK_END_X.toFixed(2)} + 0.5 * ${A.toFixed(3)} * tau * tau - 1.6;
          float age = uT - ts, life = 0.35 + aSeed.y * 0.55;
          float side = aSeed.z < 0.5 ? -1.0 : 1.0;
          vec3 v = vec3(-6.0 - aSeed.w * 18.0, 3.0 + aSeed.y * 9.0, side * (2.0 + aSeed.z * 9.0));
          vec3 p = vec3(x0, ${(Film.DECK + 0.15).toFixed(2)}, side * 0.45) + v * age + vec3(0.0, -9.8 * 0.5 * age * age, 0.0);
          p.y = max(p.y, ${(Film.DECK + 0.05).toFixed(2)});
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          float on = step(0.0, age) * step(age, life);
          vA = on * (1.0 - age / life);
          gl_PointSize = min((0.10 + 0.25 * aSeed.w) * uPx / max(-mv.z, 1.0), 10.0);
        }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(vec3(1.0, 0.72, 0.38) * a * vA * 3.0, 1.0); }`
    }));
    sparks.frustumCulled = false; scene.add(sparks);

    const NV = 220, vp = new Float32Array(NV * 3), vd = new Float32Array(NV * 3);
    for (let i = 0; i < NV; i++) { vp[i * 3] = X0 + r() * LEN; vp[i * 3 + 1] = Film.DECK + 0.2; vp[i * 3 + 2] = (r() - 0.5) * 2.2; vd[i * 3] = r(); vd[i * 3 + 1] = r(); vd[i * 3 + 2] = r(); }
    const vg = new THREE.BufferGeometry(); vg.setAttribute('position', new THREE.BufferAttribute(vp, 3)); vg.setAttribute('aSeed', new THREE.BufferAttribute(vd, 3));
    steam = new THREE.Points(vg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uT, uPx: { value: 900 } },
      vertexShader:  `attribute vec3 aSeed; uniform float uT, uPx; varying float vA;
        void main(){
          float t0 = ${T0.toFixed(3)} + (position.x - ${X0.toFixed(1)}) / ${LEN.toFixed(1)} * ${DUR.toFixed(3)} * 0.8 + aSeed.x * 0.15;
          float age = uT - t0, life = 2.2 + aSeed.y * 1.6;
          vec3 p = position + vec3(-age * (1.0 + aSeed.z * 2.0), age * (2.5 + aSeed.y * 3.0), (aSeed.z - 0.5) * age * 4.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          float on = step(0.0, age) * step(age, life);
          vA = on * smoothstep(0.0, 0.2, age) * (1.0 - age / life) * (0.22 + 0.25 * aSeed.y);
          gl_PointSize = min((1.2 + age * 2.6) * uPx / max(-mv.z, 1.0), 260.0);
        }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.2, r); gl_FragColor = vec4(vec3(0.66, 0.70, 0.74) * a * vA, a * vA); }`
    }));
    steam.frustumCulled = false; scene.add(steam);
  }

  function update(t) {
    if (!lights) return;
    uT.value = t; sparks.material.uniforms.uPx.value = Post.H; steam.material.uniforms.uPx.value = Post.H;
    const T = Film.T, lock = Film.sstep(T.LOCK + 1.6, T.LOCK + 2.0, t), la = t - Film.LAUNCH_T0;

    Film.heroAt(Math.min(t, Film.LAUNCH_T0 + Film.LAUNCH_DUR), _v);
    shuttle.position.x = t < T.LAUNCH ? Film.WALK_END_X : Math.min(_v.x, Film.LAUNCH_END_X - 1.6);
    shuttle.userData.lamp.color.setRGB(lerp(1, 0.2, lock), lerp(0.45, 1, lock), lerp(0.1, 0.35, lock)).multiplyScalar(2.5);
    for (let i = 0; i < NL * 2; i++) {
      const k = (i % NL) / (NL - 1);
      let r = 1, g = 0.45, b = 0.08, I = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 3.2 - k * 9)) * 0.4;
      if (lock > 0) { r = lerp(r, 0.25, lock); g = lerp(g, 1.0, lock); b = lerp(b, 0.4, lock); I = lerp(I, 1.1, lock); }
      if (la > -0.6 && la < 2.5) { const front = (la + 0.6) / 0.9; I *= 1 + 2.5 * Math.exp(-Math.pow((k - front) * 6, 2)); }
      lights.setColorAt(i, _c.setRGB(r * I * 2.2, g * I * 2.2, b * I * 2.2));
    }
    lights.instanceColor.needsUpdate = true;
  }
  return { build, update };
})();
