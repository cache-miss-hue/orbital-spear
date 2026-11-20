'use strict';

const Debris = (() => {
  let inst, data = [], glow;
  const _v = V3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
  function build(scene) {
    const N = 140;
    const base = new THREE.IcosahedronGeometry(1, 1), P = base.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), d = 0.62 + 0.55 * hash2(Math.round(x * 31), Math.round(y * 29 + z * 17), 5);
      P.setXYZ(i, x * d, y * d * 0.72, z * d);
    }
    base.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a424a, metalness: 0.55, roughness: 0.72, flatShading: true });
    inst = new THREE.InstancedMesh(base, mat, N);
    inst.castShadow = false; inst.receiveShadow = true;
    const r = rng(SEED + 404), c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      let x, y, z, guard = 0;
      do {
        const a = r() * TAU, rad = 90 + Math.pow(r(), 0.6) * 520;
        x = Math.cos(a) * rad; z = Math.sin(a) * rad * 0.9; y = (r() - 0.5) * 220;
      } while (Math.abs(x) < 265 && Math.abs(y) < 55 && Math.abs(z) < 80 && guard++ < 40);
      const sc = 0.3 + Math.pow(r(), 2.6) * 3.6;
      data.push({ p: V3(x, y, z), axis: V3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), sp: 0.03 + r() * 0.12, sc: V3(sc, sc * (0.6 + r() * 0.8), sc * (0.7 + r() * 0.6)), ph: r() * TAU });
      const t = 0.55 + r() * 0.5; c.setRGB(t * 0.55, t * 0.62, t * 0.70); inst.setColorAt(i, c);
    }
    scene.add(inst);
  }
  function update(t) {
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      _q.setFromAxisAngle(d.axis, d.ph + t * d.sp);
      _v.copy(d.p); _v.x += Math.sin(t * 0.05 + d.ph) * 2.0; _v.y += Math.cos(t * 0.04 + d.ph * 1.7) * 1.2;
      _m.compose(_v, _q, d.sc); inst.setMatrixAt(i, _m);
    }
    inst.instanceMatrix.needsUpdate = true;
  }
  return { build, update };
})();
