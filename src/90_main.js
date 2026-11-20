'use strict';

(async () => {
  const $ = id => document.getElementById(id), canvas = $('c'), st = $('st'), bar = $('bar').firstElementChild, ld = $('ld');
  let R;
  try { R = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false }); }
  catch (e) { st.textContent = '需要 WebGL 2 才能运行'; window.__ERR = 'no webgl2'; return; }
  R.outputColorSpace = THREE.LinearSRGBColorSpace; R.toneMapping = THREE.NoToneMapping;
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap; R.info.autoReset = false;
  const gl = R.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
  G.info.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?'; G.info.seed = SEED;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.3, 32000)
  camera.rotation.order = 'YXZ';
  G.scene = scene; G.camera = camera; G.R = R; Post.init(R);

  let quality = 1, sizeDirty = false; const buf = new THREE.Vector2(), PIXMAX = 3.7e6;
  function resize() {
    sizeDirty = false; const w = innerWidth, h = innerHeight; if (w < 2 || h < 2) return;
    const pr = CAPTURE ? +(Q.get('dpr') || 1) : Math.min(devicePixelRatio || 1, Math.sqrt(PIXMAX / (w * h))) * quality;
    camera.aspect = w / h; camera.updateProjectionMatrix(); R.setPixelRatio(pr); R.setSize(w, h, false);
    R.getDrawingBufferSize(buf); Post.size(buf.x, buf.y, 4);
    for (const u of ['muzzle', 'squad', 'steam']) {   }
  }
  addEventListener('resize', () => { sizeDirty = true; }); resize();

  (function envMap() {
    const es = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD;
        void main(){
          vec3 d = normalize(vD);
          vec3 col = mix(vec3(0.012,0.024,0.038), vec3(0.10,0.19,0.25), smoothstep(-0.4,0.9,d.y));
          col += vec3(0.10,0.03,0.012) * pow(max(dot(d, normalize(vec3(-0.56,0.24,-0.79))),0.0), 18.0);
          col += vec3(1.0,0.72,0.42) * pow(max(dot(d, normalize(vec3(-0.56,0.24,-0.79))),0.0), 220.0) * 4.0;
          col += vec3(0.05,0.10,0.12) * pow(max(dot(d, normalize(vec3(0.6,0.15,0.7))),0.0), 6.0);
          gl_FragColor = vec4(col, 1.0);
        }`
    }));
    es.add(sky);
    const pm = new THREE.PMREMGenerator(R); pm.compileCubemapShader();
    const rt = pm.fromScene(es, 0.03);
    scene.environment = rt.texture; scene.environmentIntensity = 0.20;
    pm.dispose(); sky.geometry.dispose(); sky.material.dispose();
  })();

  function lights() {
    const sun = new THREE.DirectionalLight(SUN_COL, 9.0);
    sun.position.copy(SUN).multiplyScalar(620).add(V3(60, 24, 0));
    sun.target.position.set(60, 24, 0); scene.add(sun, sun.target);
    sun.castShadow = true; const sc = sun.shadow.camera;
    sc.left = -230; sc.right = 230; sc.top = 220; sc.bottom = -220; sc.near = 20; sc.far = 1500; sc.updateProjectionMatrix();
    sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.00030; sun.shadow.normalBias = 0.35;
    G.lights.sun = sun;
    const fill = new THREE.DirectionalLight(SUN_FILL, 1.05);
    fill.position.set(0.55, -0.10, 0.82).multiplyScalar(340); scene.add(fill, fill.target);
    const hemi = new THREE.HemisphereLight(new THREE.Color(0.20, 0.30, 0.40), new THREE.Color(0.015, 0.020, 0.026), 0.30); scene.add(hemi);

    const rim = new THREE.SpotLight(0xffb765, 9000, 110, 0.42, 0.70, 1.8);
    rim.position.set(116, 61, -36); rim.target.position.set(144, 48, 0); scene.add(rim, rim.target);
    const key = new THREE.SpotLight(0xc8d8e0, 330, 90, 0.46, 0.85, 1.6);
    key.position.set(166, 47, 24); key.target.position.set(144, 47, 0); scene.add(key, key.target);

    const pool = new THREE.SpotLight(0xffc190, 260, 80, 0.86, 0.96, 1.8);
    pool.position.set(158, 58, 18); pool.target.position.set(144, 39.6, 0); scene.add(pool, pool.target);
    const deck = new THREE.SpotLight(0xffc89a, 8, 70, 0.68, 0.92, 2.0);
    deck.position.set(150, 55, 12); deck.target.position.set(157, 39.8, 0); scene.add(deck, deck.target);

    const eng = new THREE.PointLight(0xff7430, 500, 340, 2.0); eng.position.set(-250, 0, 0); scene.add(eng);

    const alert = new THREE.PointLight(0xff1a0c, 0, 120, 1.4); alert.position.set(112, 66, 0); scene.add(alert); G.lights.alert = alert;
    scene.add(camera);
    G.lights.deck = deck;
  }

  const fliers = [];
  function buildSquad() {
    for (let i = 0; i < 5; i++) { const f = MechGLB.buildFlier(i); f.name = 'flier'; scene.add(f); fliers.push(f); }
  }
  function updateSquad(t) { for (const f of fliers) f.userData.drive(t); }

  const tick = () => new Promise(r => setTimeout(r, 0));
  let hero = null; const _post = {};
  const steps = [
    ['展开星图与环带', 14, async p => { await Env.build(scene); p(1); }],
    ['铺设镇星号龙骨', 40, async p => { Ship.build(scene); Ship.buildEnemy(scene, Film.ENEMY_P, Film.ENEMY_YAW); Ship.buildEnemy(scene, V3(-4300, 380, -2500), 0.7, 0.85); p(1); }],
    ['装填机甲与中队', 22, async p => { hero = MechGLB.buildHero(scene); buildSquad(); p(1); }],
    ['校射炮术', 14, async p => { FX.build(scene, hero, fliers.concat([hero.root])); Debris.build(scene); Catapult.build(scene); lights(); p(1); }],
    ['第一缕光', 10, async p => { Cam.flyAt(0, camera); resize(); try { await R.compileAsync(scene, camera); } catch (e) {   } Post.warm(); frame(0, 1 / 60); p(1); }],
  ];
  const total = steps.reduce((a, s) => a + s[1], 0); let done = 0; const t0 = performance.now();
  G.info.steps = {};
  for (const [label, w, fn] of steps) { st.textContent = label; await tick(); const ts = performance.now(); await fn(p => { bar.style.width = ((done + w * p) / total * 100).toFixed(1) + '%'; }); G.info.steps[label] = Math.round(performance.now() - ts); done += w; }
  G.info.loadMs = Math.round(performance.now() - t0);

  function frame(t, dt = 1 / 60) {
    G.t = t; G.uTime.value = t;
    Film.post(t, _post); G.post.fade = _post.fade; G.post.shake = _post.shake; G.post.flash = _post.flash;
    if (hero) hero.drive(t);
    updateSquad(t);
    Env.update(t, camera);
    Ship.update(t);
    Cam.apply(camera);
    FX.update(t, camera);
    Catapult.update(t);
    Debris.update(t);
    R.info.reset();
    Post.render(scene, null, camera, G.post);
    return { calls: R.info.render.calls, tris: R.info.render.triangles };
  }

  window.__POSES = POSES;
  window.__pose = (i, t = 0) => { const tt = POSES[i].t + t; Cam.flyAt(tt, camera); return frame(tt); };
  window.__renderFrame = t => { Cam.flyAt(t, camera); return frame(t); };
  window.__sync = () => { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  window.__INFO = G.info; window.__dbg = { G, scene, camera, R, Post, Cam, frame, fliers, hero };
  if (CAPTURE) { ld.remove(); const h = $('hud'); if (h) h.remove(); const tt = $('title'); if (tt) tt.remove(); window.__READY = true; return; }

  const hud = $('hud'), fpsEl = $('fps'), shotEl = $('shot'), tcEl = $('tc'), msg = $('msg'), title = $('title');
  let msgT = 0; const say = s => { msg.textContent = s; msg.style.opacity = 1; clearTimeout(msgT); msgT = setTimeout(() => { msg.style.opacity = 0; }, 1500); };
  let paused = false, t = 0, last = 0, acc = 0, nfr = 0, slow = 0, good = 0;
  Cam.setCinema(true);
  Cam.bind(canvas, code => {
    if (code === 'pose') { t = POSES[Cam.st.pose].t; Cam.setCinema(true); say('跳到 ' + POSES[Cam.st.pose].name); }
    else if (code === 'cinema') { say('电影模式'); }
    else if (code === 'free') { say('自由相机'); }
    else if (code === 'KeyH') hud.classList.toggle('min');
    else if (code === 'KeyP' || code === 'Space') { paused = !paused; say(paused ? '已暂停' : '继续'); }
    else if (code === 'speed') say('速度 ' + Cam.st.speed.toFixed(0) + ' m/s');
  });
  for (const b of hud.querySelectorAll('[data-key]')) b.addEventListener('click', () => dispatchEvent(new KeyboardEvent('keydown', { code: b.dataset.key })));
  const liveT0 = performance.now();
  function govern(avg, span) {
    fpsEl.textContent = (1000 / avg).toFixed(0) + ' FPS · ' + Math.round(quality * 100) + '% · 构建 {{BUILD_TIME}}';
    if (avg > 100 || performance.now() - liveT0 < 4000) return;
    if (avg > 19.5) { good = 0; if (++slow >= 3 && quality > 0.5) { slow = 0; quality = Math.max(0.5, quality * 0.86); resize(); } return; }
    slow = 0; good = avg < 17.5 ? good + span : 0;
    if (good > 4000 && quality < 1) { good = 0; quality = Math.min(1, quality / 0.86); resize(); }
  }
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); st.textContent = '图形上下文丢失，正在恢复'; document.body.appendChild(ld); ld.style.opacity = 1; });
  canvas.addEventListener('webglcontextrestored', () => location.reload());
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 1 / 60;
    if (sizeDirty) resize();
    if (Cam.cinema) { if (!paused) t += dt; Cam.flyAt(t, camera); }
    else { if (!paused) t += dt; Cam.update(dt); }
    frame(((t % Film.DUR) + Film.DUR) % Film.DUR, dt);
    const shotName = Cam.cinema ? Film.SHOTS[Film.shotAt(((t % Film.DUR) + Film.DUR) % Film.DUR)].name : ('自由相机 · ' + (Cam.st.pose + 1));
    shotEl.textContent = shotName;
    const T = ((t % Film.DUR) + Film.DUR) % Film.DUR;
    tcEl.textContent = 'T+' + String(Math.floor(T / 60)).padStart(2, '0') + ':' + (T % 60).toFixed(1).padStart(4, '0');
    if (last) { const g = ts - last; if (g > 250) { acc = 0; nfr = 0; } else { acc += g; nfr++; if (acc >= 750) { govern(acc / nfr, acc); acc = 0; nfr = 0; } } }
    last = ts;
  }
  ld.style.opacity = 0; setTimeout(() => ld.remove(), 900);
  if (title) setTimeout(() => title.classList.add('out'), 4200);
  requestAnimationFrame(loop); window.__READY = true;
})().catch(e => { console.error('BOOT', e && e.stack || e); const s = document.getElementById('st'); if (s) s.textContent = '出错了：' + (e && e.message || e); window.__ERR = String(e && e.stack || e); });
