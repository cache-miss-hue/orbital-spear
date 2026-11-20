'use strict';

const Film = (() => {
  const DUR = 60;
  const T = {
    OPEN: 0.0, ALERT: 6.5, WAKE: 12.0, WALK: 17.0, LOCK: 24.0, LAUNCH: 28.0, CLIMB: 31.0,
    FORM: 34.0, CONTACT: 41.0, BLAST: 45.5, CHARGE: 48.0, TABLEAU: 53.0, OUT: 58.0,
  };
  const DECK = 39.5;
  const HERO_Y = DECK + 0.015;
  const START_X = 138, STRIDE = 3.0, WALK_END_X = START_X + 4 * STRIDE;
  const LAUNCH_END_X = 197;
  const LAUNCH_T0 = T.LAUNCH + 0.05, LAUNCH_DUR = 0.85;
  const LAUNCH_A = 2 * (LAUNCH_END_X - WALK_END_X) / (LAUNCH_DUR * LAUNCH_DUR);
  const ENEMY_P = V3(-2560, 110, -880), ENEMY_YAW = 0.42;
  const BLAST_P = V3(-2470, 150, -800);

  function mono(xs, ys) {
    const n = xs.length, d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]);
    return x => {
      if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
      if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
      let i = 0; while (x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  }
  function track3(rows) {
    const ts = rows.map(r => r[0]), fx = mono(ts, rows.map(r => r[1])), fy = mono(ts, rows.map(r => r[2])), fz = mono(ts, rows.map(r => r[3]));
    return (t, out) => out.set(fx(t), fy(t), fz(t));
  }
  const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

  const W0 = T.WALK + 0.3, SW = 0.9, GAP = 1.3;
  const STEPS = [['R', 0, 3], ['L', 0, 6], ['R', 3, 9], ['L', 6, 12], ['R', 9, 12]].map((s, k) => ({ foot: s[0], from: s[1], to: s[2], t0: W0 + k * GAP, t1: W0 + k * GAP + SW }));
  const WALK_T1 = STEPS[STEPS.length - 1].t1;
  function footState(foot, t) {
    let z = 0, lift = 0, u = -1;
    for (const s of STEPS) {
      if (s.foot !== foot) continue;
      if (t >= s.t1) { z = s.to; continue; }
      if (t > s.t0) { const k = (t - s.t0) / SW; const e = k * k * (3 - 2 * k); z = s.from + (s.to - s.from) * e; lift = Math.sin(Math.PI * Math.pow(k, 0.82)) * clamp(0.30 + (s.to - s.from) * 0.13, 0.34, 0.8); u = k; }
      else z = s.from;
      break;
    }
    return { z, lift, u };
  }
  const _fs = { R: null, L: null };
  function heroWalk(t) {
    const R = footState('R', t), L = footState('L', t);

    const mid = (R.z + L.z) * 0.5;
    const lead = (t > W0 && t < WALK_T1) ? 0.55 : 0;
    const fwd = clamp(mid + lead, 0, 12);
    const swingR = R.u >= 0 ? Math.sin(Math.PI * R.u) : 0, swingL = L.u >= 0 ? Math.sin(Math.PI * L.u) : 0;
    const sway = (swingR - swingL) * -0.22;
    const bob = (swingR + swingL) * 0.12 - 0.10 * (t > W0 && t < WALK_T1 ? 1 : 0);
    _fs.R = R; _fs.L = L;
    return { fwd, R, L, sway, bob, swingR, swingL, walking: t > W0 - 0.2 && t < WALK_T1 + 0.4 };
  }

  const FOOTFALLS = STEPS.map(s => s.t1);

  const FLIGHT = track3([
    [T.LAUNCH + 0.05 + LAUNCH_DUR, LAUNCH_END_X, HERO_Y + 0.6, 0],
    [29.6, 272, 44, -2], [30.4, 350, 58, -10], [31.5, 430, 92, -30], [33.0, 470, 160, -80],
    [34.5, 410, 215, -130], [36.5, 260, 225, -160], [39.0, 40, 200, -180], [41.0, -140, 180, -195],
    [45.5, -560, 140, -250], [48.0, -820, 115, -290], [53.0, -1350, 80, -370], [60.0, -2100, 50, -480],
  ]);
  function heroAt(t, out) {
    if (t < T.LAUNCH) { const w = heroWalk(t); return out.set(START_X + w.fwd, HERO_Y, 0); }
    const tau = t - LAUNCH_T0;
    if (tau < LAUNCH_DUR) { const tt = Math.max(0, tau); return out.set(WALK_END_X + 0.5 * LAUNCH_A * tt * tt, HERO_Y, 0); }
    return FLIGHT(t, out);
  }

  const flightMix = t => sstep(T.LAUNCH + 0.75, T.LAUNCH + 2.4, t);
  const crouchMix = t => sstep(T.LOCK + 0.3, T.LOCK + 1.8, t) * (1 - flightMix(t));

  const FORM_OFF = [[-16, 3, 18], [-16, 3, -18], [-32, 6, 36], [-32, 6, -36], [-46, -4, 0]];
  const ENTRY = [[-260, -60, -620], [-180, -90, -520], [-320, -30, -700], [-220, -120, -560], [-300, -80, -760]];
  const _h = V3(), _h2 = V3(), _f = V3(), _r = V3(), _u = V3(0, 1, 0);
  function headingAt(t, out) {
    if (t < T.LAUNCH + 1.0) return out.set(1, 0, 0);
    heroAt(t + 0.25, _h2); heroAt(t - 0.25, _h); out.subVectors(_h2, _h); out.y = 0;
    const l = out.length(); return l > 1e-3 ? out.multiplyScalar(1 / l) : out.set(1, 0, 0);
  }
  function squadAt(i, t, out) {
    const tt = Math.max(t, T.LAUNCH + 1.5);
    heroAt(tt, out); headingAt(tt, _f); _r.crossVectors(_f, _u).normalize();
    const o = FORM_OFF[i];
    out.addScaledVector(_f, o[0]).addScaledVector(_u, o[1]).addScaledVector(_r, o[2]);
    const k = 1 - sstep(T.CLIMB, T.FORM + 2.5, t);
    const e = ENTRY[i];
    out.x += e[0] * k + Math.sin(t * 0.21 + i) * 6 * k;
    out.y += e[1] * k + Math.sin(t * 0.33 + i * 1.7) * 3;
    out.z += e[2] * k + Math.cos(t * 0.17 + i) * 6 * k;
    if (t < T.LAUNCH + 1.5) out.x += (T.LAUNCH + 1.5 - t) * 55;
    return out;
  }

  const _p0 = V3(), _p1 = V3(), _p2 = V3(), _v = V3(), _a = V3(), _m = new THREE.Matrix4(), _x = V3(), _y = V3();
  function frameAt(posFn, t, outQ, h = 0.12) {
    posFn(t - h, _p0); posFn(t, _p1); posFn(t + h, _p2);
    _v.subVectors(_p2, _p0); const sp = _v.length() / (2 * h);
    if (sp < 0.5) return outQ.setFromAxisAngle(_u, Math.PI / 2);
    _v.normalize();
    _a.copy(_p2).add(_p0).addScaledVector(_p1, -2).multiplyScalar(1 / (h * h));
    _x.crossVectors(_u, _v).normalize();
    const lat = _a.dot(_x);
    const bank = clamp(Math.atan2(lat, 9.8) * 0.6, -0.9, 0.9);
    _y.crossVectors(_v, _x).normalize();
    _y.applyAxisAngle(_v, -bank); _x.crossVectors(_y, _v).normalize();
    _m.makeBasis(_x, _y, _v); return outQ.setFromRotationMatrix(_m);
  }

  const _hp = V3(), _hq = V3(), _hd = V3(), _side = V3();
  const SHOTS = [

    { t0: T.OPEN, name: '环带开场', f: (t, s) => {
      const u = sstep(T.OPEN, T.ALERT, t);
      s.pos.set(lerp(430, 255, u), lerp(-6, 16, u), lerp(780, 480, u)); s.look.set(lerp(-40, 5, u), lerp(48, 54, u), 0); s.fov = lerp(42, 36, u); } },

    { t0: T.ALERT, name: '警报', f: (t, s) => {
      const u = sstep(T.ALERT, T.WAKE, t);
      s.pos.set(lerp(252, 206, u), lerp(22, 31, u), lerp(72, 47, u)); s.look.set(lerp(105, 150, u), lerp(60, 52, u), 0); s.fov = lerp(40, 34, u); } },

    { t0: T.WAKE, name: '苏醒', f: (t, s) => {
      const u = sstep(T.WAKE, T.WALK, t);
      s.pos.set(START_X + lerp(10.5, 8.6, u), DECK + 0.8, lerp(9.0, 8.0, u)); s.look.set(START_X - 3, lerp(52, 56, u), -4.5); s.fov = lerp(54, 50, u); } },

    { t0: T.WALK, name: '踏步', f: (t, s) => {
      heroAt(t, _hp); const u = sstep(T.WALK, T.LOCK, t);
      s.pos.set(_hp.x + lerp(4, 2, u), DECK + 1.2, 16.5); s.look.set(_hp.x + 0.5, DECK + 7.2, 0); s.fov = 52; } },

    { t0: T.LOCK, name: '锁定', f: (t, s) => {
      const u = sstep(T.LOCK, T.LAUNCH, t);
      s.pos.set(WALK_END_X + lerp(13, 11, u), DECK + 0.9, lerp(7.5, 6.5, u)); s.look.set(WALK_END_X - 2.5, DECK + 6.0, -3.0); s.fov = 50; } },

    { t0: T.LAUNCH, name: '弹射环绕', f: (t, s) => {
      heroAt(t, _hp); headingAt(t, _hd); _side.crossVectors(_hd, _u).normalize();
      const u = sstep(T.LAUNCH, T.FORM, t);
      const th = lerp(0.55, -2.35, u);
      const R = lerp(19, 30, u), h = lerp(1.5, -9, sstep(T.LAUNCH + 0.9, T.FORM, t));
      s.pos.copy(_hp).addScaledVector(_hd, Math.cos(th) * R).addScaledVector(_side, Math.sin(th) * R).add(V3(0, 7 + h, 0));
      if (s.pos.x < LAUNCH_END_X + 4) s.pos.y = Math.max(s.pos.y, DECK + 0.9);
      s.look.copy(_hp).add(V3(0, 7.0, 0)); s.fov = lerp(44, 50, u); } },

    { t0: T.FORM, name: '编队', f: (t, s) => {
      heroAt(t, _hp); headingAt(t, _hd); _side.crossVectors(_hd, _u).normalize(); const u = sstep(T.FORM, T.CONTACT, t);
      s.pos.copy(_hp).addScaledVector(_hd, lerp(46, 24, u)).addScaledVector(_side, -24).add(V3(0, -17, 0));
      s.look.copy(_hp).addScaledVector(_hd, -18).add(V3(0, 6, 0)); s.fov = 50; } },

    { t0: T.FORM + 3.6, name: '贴身', f: (t, s) => {
      heroAt(t, _hp); headingAt(t, _hd); _side.crossVectors(_hd, _u).normalize();
      s.pos.copy(_hp).addScaledVector(_side, -15).addScaledVector(_hd, 5).add(V3(0, 4, 0)); s.look.copy(_hp).addScaledVector(_hd, -6).add(V3(0, 7.5, 0)); s.fov = 40; } },

    { t0: T.CONTACT, name: '交火', f: (t, s) => {
      const u = sstep(T.CONTACT, T.BLAST, t);
      heroAt(t, _hp); s.pos.set(lerp(-40, -60, u), 2, lerp(105, 100, u)); s.look.copy(_hp).lerp(ENEMY_P, 0.30).add(V3(0, 8, 0)); s.fov = 50; } },

    { t0: T.CONTACT + 2.3, name: '敌舰', f: (t, s) => {
      const u = sstep(T.CONTACT + 2.3, T.BLAST + 0.6, t);
      s.pos.copy(ENEMY_P).add(V3(lerp(620, 560, u), lerp(-40, -20, u), lerp(470, 430, u))); s.look.copy(ENEMY_P).add(V3(40, 30, 0)); s.fov = 34; } },

    { t0: T.BLAST + 0.6, name: '爆炸', f: (t, s) => {
      heroAt(t, _hp); headingAt(t, _hd); _side.crossVectors(_hd, _u).normalize();
      s.pos.copy(_hp).addScaledVector(_hd, -80).addScaledVector(_side, 24).add(V3(0, -18, 0)); s.look.copy(BLAST_P); s.fov = 42; } },

    { t0: T.CHARGE, name: '掠拍', f: (t, s) => {
      heroAt(T.CHARGE + 2.6, _hq); heroAt(t, _hp);
      s.pos.copy(_hq).add(V3(6, -6, 44)); s.look.copy(_hp).add(V3(0, 7, 0)); s.fov = lerp(30, 50, sstep(T.CHARGE + 1.6, T.CHARGE + 3.4, t)); } },

    { t0: T.TABLEAU, name: '大全景', f: (t, s) => {
      const u = sstep(T.TABLEAU, DUR, t);
      s.pos.set(lerp(560, 760, u), lerp(70, 120, u), lerp(760, 960, u)); s.look.set(lerp(-1100, -1250, u), lerp(60, 50, u), lerp(-420, -470, u)); s.fov = 40; } },
  ];
  function shotAt(t) { let i = 0; while (i < SHOTS.length - 1 && t >= SHOTS[i + 1].t0) i++; return i; }
  function camAt(t, s) {
    const i = shotAt(t); SHOTS[i].f(t, s);

    s.pos.x += Math.sin(t * 0.31) * 0.12; s.pos.y += Math.sin(t * 0.23 + 1.7) * 0.08; s.pos.z += Math.cos(t * 0.27) * 0.10;
    s.roll = Math.sin(t * 0.17) * 0.004;
    return i;
  }

  function post(t, o) {
    o.fade = sstep(0.0, 2.2, t) * (1 - sstep(T.OUT, DUR, t));
    let sh = 0;
    for (const f of FOOTFALLS) { const a = t - f; if (a > 0 && a < 0.5) sh += 0.10 * Math.exp(-a * 9); }
    const la = t - LAUNCH_T0; if (la > -0.05 && la < 1.4) sh += 0.55 * Math.exp(-Math.max(0, la) * 3.2);
    const ba = t - T.BLAST; if (ba > 0 && ba < 2.5) sh += 0.35 * Math.exp(-ba * 2.2);
    o.shake = sh;
    o.flash = ba > 0 && ba < 1.2 ? Math.exp(-ba * 5.5) * 0.9 : 0;
    return o;
  }

  return { ENEMY_P, ENEMY_YAW, DUR, T, DECK, START_X, WALK_END_X, LAUNCH_END_X, LAUNCH_T0, LAUNCH_DUR, BLAST_P, FORM_OFF, FOOTFALLS,
    heroAt, heroWalk, flightMix, crouchMix, squadAt, headingAt, frameAt, camAt, shotAt, SHOTS, post, sstep, track3 };
})();
