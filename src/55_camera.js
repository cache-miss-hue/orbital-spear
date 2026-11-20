'use strict';

const POSES = [
  { name: '环带开场', t: 4.0 },
  { name: '苏醒仰拍', t: 14.5 },
  { name: '锁定蹲伏', t: 26.5 },
  { name: '爬升', t: 30.5 },
  { name: '编队', t: 38.0 },
  { name: '爆炸', t: 46.3 },
]
const Cam = (() => {
  const st = { pos: V3(), yaw: 0, pitch: 0, fov: 42, roll: 0, speed: 24, pose: 0 };
  const from = { pos: V3(), yaw: 0, pitch: 0, fov: 42, roll: 0 }, to = { pos: V3(), yaw: 0, pitch: 0, fov: 42, roll: 0 };
  let blend = 1, cinema = true, clock = 0;
  const keys = new Set(); let drag = false;
  const wrapA = a => a - TAU * Math.round(a / TAU);
  const _p = V3(), _l = V3(), _v = V3();

  const smoother = u => u * u * u * (u * (u * 6 - 15) + 10);

  function lookFrom(pos, look, out) {
    const dx = look[0] - pos[0], dy = look[1] - pos[1], dz = look[2] - pos[2];
    out.yaw = Math.atan2(-dx, -dz); out.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return out;
  }
  const _fs = { pos: V3(), look: V3(), fov: 42, roll: 0 };
  function solvePose(i, out) {
    Film.camAt(POSES[i].t, _fs);
    out.pos.copy(_fs.pos); out.fov = _fs.fov; out.roll = 0; lookFrom([_fs.pos.x, _fs.pos.y, _fs.pos.z], [_fs.look.x, _fs.look.y, _fs.look.z], out); return out;
  }
  function jump(i, instant) {
    st.pose = i; cinema = false;
    if (instant) { solvePose(i, st); blend = 1; return; }
    from.pos.copy(st.pos); from.yaw = st.yaw; from.pitch = st.pitch; from.fov = st.fov; from.roll = st.roll;
    solvePose(i, to); to.yaw = from.yaw + wrapA(to.yaw - from.yaw); blend = 0;
  }
  function apply(camera) {
    camera.position.copy(st.pos);
    camera.rotation.set(st.pitch, st.yaw, st.roll, 'YXZ');
    if (camera.fov !== st.fov) { camera.fov = st.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(true);
  }
  function flyAt(t, camera) {
    const T = ((t % Film.DUR) + Film.DUR) % Film.DUR;
    Film.camAt(T, _fs);
    st.pos.copy(_fs.pos); st.fov = _fs.fov; st.roll = _fs.roll;
    lookFrom([_fs.pos.x, _fs.pos.y, _fs.pos.z], [_fs.look.x, _fs.look.y, _fs.look.z], st);
    apply(camera);
  }
  function update(dt) {
    if (blend < 1) {
      blend = Math.min(1, blend + dt / 0.85); const k = blend * blend * (3 - 2 * blend);
      st.pos.lerpVectors(from.pos, to.pos, k); st.yaw = lerp(from.yaw, to.yaw, k); st.pitch = lerp(from.pitch, to.pitch, k);
      st.fov = lerp(from.fov, to.fov, k); st.roll = lerp(from.roll, to.roll, k); return;
    }
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const u = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
    if (f || r || u) {
      const v = st.speed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1) * dt;
      const sy = Math.sin(st.yaw), cy = Math.cos(st.yaw), cp = Math.cos(st.pitch);
      st.pos.x += (-sy * cp * f + cy * r) * v; st.pos.z += (-cy * cp * f - sy * r) * v; st.pos.y += (Math.sin(st.pitch) * f + u) * v;
    }
    const R = Math.hypot(st.pos.x, st.pos.z);
    if (R > 1400) { st.pos.x *= 1400 / R; st.pos.z *= 1400 / R; }
    st.pos.y = clamp(st.pos.y, -900, 1400);
  }
  function bind(dom, on) {
    addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      keys.add(e.code);
      if (!e.repeat) {
        if (/^Digit[1-6]$/.test(e.code)) { jump(+e.code[5] - 1); on('pose'); }
        else if (e.code === 'KeyF') { cinema = !cinema; if (!cinema) { blend = 1; } on(cinema ? 'cinema' : 'free'); }
        else on(e.code);
      }
    });
    addEventListener('keyup', e => keys.delete(e.code));
    addEventListener('blur', () => keys.clear());
    dom.addEventListener('pointerdown', e => { drag = true; dom.setPointerCapture(e.pointerId); });
    dom.addEventListener('pointerup', () => { drag = false; });
    dom.addEventListener('pointermove', e => {
      if (!drag) return;
      if (blend < 1) { blend = 1; }
      if (cinema) { cinema = false; on('free'); }
      st.yaw -= e.movementX * 0.0032; st.pitch = clamp(st.pitch - e.movementY * 0.0032, -1.5, 1.5);
    });
    dom.addEventListener('wheel', e => { st.speed = clamp(st.speed * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 3, 260); on('speed'); e.preventDefault(); }, { passive: false });
  }
  function setCinema(on) { cinema = on; if (on) { blend = 1; } }
  return { st, get cinema() { return cinema; }, get t() { return clock; }, jump, apply, flyAt, update, bind, setCinema, POSES };
})();
