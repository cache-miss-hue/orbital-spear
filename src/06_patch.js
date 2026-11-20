'use strict';

function patch(mat, fn, key, shared = {}) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, shared);
    const api = {
      sh,
      v: (a, b) => { if (!sh.vertexShader.includes(a)) console.warn('patch miss (v)', key, a); sh.vertexShader = sh.vertexShader.replace(a, b); },
      f: (a, b) => { if (!sh.fragmentShader.includes(a)) console.warn('patch miss (f)', key, a); sh.fragmentShader = sh.fragmentShader.replace(a, b); },
      vHead: s => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + s); },
      fHead: s => { sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + s); },
    };
    fn(api);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

if (typeof module !== 'undefined') module.exports = { patch };