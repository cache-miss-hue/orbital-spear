#!/usr/bin/env node

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const FLAGS = new Set(['--probe', '--allow-software', '--webgpu', '--live']);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const has = k => argv.includes(k);
let target = null;
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { if (!FLAGS.has(a)) i++; } else if (!target) target = a; }
const PROBE = has('--probe'), LIVE = has('--live');
if (!PROBE && !target) { console.error('用法见文件头部注释：node shoot.mjs <html 或 url> --out <目录> [...]'); process.exit(1); }

const W = +opt('--w', 1920), H = +opt('--h', 1080), DPR = +opt('--dpr', 1);
const FMT = opt('--fmt', 'png') === 'jpg' ? 'jpeg' : opt('--fmt', 'png');
const EXT = FMT === 'jpeg' ? 'jpg' : 'png';
const OUT = path.resolve(opt('--out', 'qa/shots'));
const READY_MS = +opt('--timeout', 180) * 1000;
const log = (...a) => console.log(...a);

function findChrome() {
  const c = [opt('--chrome'), process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return c.find(p => p && fs.existsSync(p));
}
const CHROME = findChrome();
if (!CHROME) { console.error('找不到 Chrome/Edge：用 --chrome 或环境变量 CHROME_PATH 指定'); process.exit(3); }

const isUrl = target && /^https?:/.test(target);
const htmlAbs = target && !isUrl ? path.resolve(target) : null;
if (htmlAbs && !fs.existsSync(htmlAbs)) { console.error('文件不存在: ' + htmlAbs); process.exit(1); }
const ROOT = htmlAbs ? path.dirname(htmlAbs) : process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream' };
const PROBE_HTML = `<!doctype html><meta charset="utf-8"><canvas id="c" width="64" height="64"></canvas><script>(async()=>{const o={};
try{const gl=document.getElementById('c').getContext('webgl2');const e=gl.getExtension('WEBGL_debug_renderer_info');
o.webgl2=String(gl.getParameter(e?e.UNMASKED_RENDERER_WEBGL:gl.RENDERER));o.floatTargets=!!gl.getExtension('EXT_color_buffer_float');
o.maxTexture=gl.getParameter(gl.MAX_TEXTURE_SIZE);o.timerQuery=!!gl.getExtension('EXT_disjoint_timer_query_webgl2');}catch(e){o.webgl2='ERR '+e.message}
try{if(!navigator.gpu)o.webgpu='navigator.gpu 不存在';else{const a=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
if(!a)o.webgpu='无 adapter';else{const i=a.info||{};o.webgpu=[i.vendor,i.architecture,i.device,i.description].filter(Boolean).join(' | ')||'adapter ok';
o.webgpuFallback=!!(i.isFallbackAdapter||a.isFallbackAdapter);o.webgpuTimestamp=a.features.has('timestamp-query');}}}catch(e){o.webgpu='ERR '+e.message}
window.__PROBE=o;})()</script>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__probe') { res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(PROBE_HTML); return; }
  const p = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const PROF = fs.mkdtempSync(path.join(os.tmpdir(), 'three-shoot-'));
const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'default';
const cargs = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + PROF, '--enable-gpu', '--ignore-gpu-blocklist',
  '--use-angle=' + angle, '--enable-unsafe-webgpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', `--window-size=${W},${H}`];
if (has('--webgpu') && process.platform === 'linux') cargs.push('--enable-features=Vulkan');
const chrome = spawn(CHROME, cargs, { stdio: ['ignore', 'ignore', 'pipe'] });
let exitCode = 0, closing = false;
function cleanup(code) {
  if (closing) return; closing = true;
  try { chrome.kill(); } catch {}
  server.close();
  setTimeout(() => { try { fs.rmSync(PROF, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} process.exit(code); }, 600);
}
chrome.on('exit', () => { if (!closing) { console.error('Chrome 意外退出'); cleanup(1); } });
const wsUrl = await new Promise((res, rej) => {
  let buf = ''; const to = setTimeout(() => rej(new Error('Chrome 启动超时')), 30000);
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(to); res(m[1]); } });
}).catch(e => { console.error(String(e)); cleanup(1); });
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r));
let nextId = 1; const pending = new Map(), listeners = new Set();
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.to); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  else for (const l of listeners) l(m);
});
const send = (method, params = {}, sessionId, ms = 180000) => new Promise((res, rej) => {
  const id = nextId++; const to = setTimeout(() => { pending.delete(id); rej(new Error('CDP 超时 ' + method)); }, ms);
  pending.set(id, { res, rej, to }); ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SOFT = /swiftshader|llvmpipe|software|basic render|softpipe/i;

const report = { ok: false, chrome: CHROME, width: W, height: H, dpr: DPR, shots: [], console: [] };
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
  listeners.add(m => {
    if (m.sessionId !== S) return;
    if (m.method === 'Runtime.consoleAPICalled' && /error|warning/.test(m.params.type)) report.console.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 500));
    if (m.method === 'Runtime.exceptionThrown') report.console.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 800));
  });
  await send('Runtime.enable', {}, S); await send('Page.enable', {}, S);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false }, S);
  const ev = async (expression, ms) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, S, ms);
    if (r.exceptionDetails) throw new Error('页面求值出错: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 600) + '\n  表达式: ' + expression.slice(0, 160));
    return r.result.value;
  };
  const waitFor = async (expr, ms, what) => { const end = Date.now() + ms; for (;;) { if (await ev(expr)) return; if (Date.now() > end) throw new Error('等待超时: ' + what); await sleep(150); } };

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/__probe` }, S);
  await waitFor('!!window.__PROBE', 30000, 'GPU 探测');
  report.gpu = await ev('window.__PROBE');
  report.software = SOFT.test(report.gpu.webgl2 || '');
  log('GPU  WebGL2 :', report.gpu.webgl2, report.software ? '  ← 软件渲染！' : '');
  log('GPU  WebGPU :', report.gpu.webgpu, report.gpu.webgpuFallback ? '(fallback adapter)' : '');

  if (!PROBE) {

    const q = [LIVE ? '' : 'capture', DPR !== 1 ? 'dpr=' + DPR : '', opt('--query', '')].filter(Boolean).join('&');
    const url = isUrl ? target + (target.includes('?') ? '&' : '?') + q : `http://127.0.0.1:${PORT}/${encodeURIComponent(path.basename(htmlAbs))}?${q}`;
    report.url = isUrl ? url : path.basename(htmlAbs) + '?' + q;
    const t0 = Date.now();
    await send('Page.navigate', { url }, S);
    await waitFor('!!(window.__READY||window.__ERR)', READY_MS, 'window.__READY（页面没实现截图契约，或构建卡住）');
    const err = await ev('window.__ERR||""'); if (err) throw new Error('页面启动失败: ' + String(err).slice(0, 800));
    report.loadMs = Date.now() - t0;
    report.info = await ev('JSON.parse(JSON.stringify(window.__INFO||{}))');
    if (opt('--eval')) report.evalResult = await ev(opt('--eval'));
    fs.mkdirSync(OUT, { recursive: true });
    const nPose = await ev('(window.__POSES||[]).length');
    const names = await ev('(window.__POSES||[]).map((p,i)=>p&&p.name||("pose"+(i+1)))');
    const pOpt = opt('--poses', 'all');
    const poses = opt('--fly') && !has('--poses') ? [] : pOpt === 'all' ? [...Array(nPose).keys()] : pOpt.split(',').map(Number);
    const times = opt('--t', '0').split(',').map(Number);
    const jobs = [];
    for (const i of poses) for (const t of times) jobs.push({ kind: 'pose', pose: i, name: names[i], t, expr: `window.__pose(${i},${t})`,
      file: `p${i + 1}${times.length > 1 ? '_t' + t.toFixed(2).padStart(6, '0') : ''}.${EXT}` });
    if (opt('--fly')) { const [a, b, st] = opt('--fly').split(':').map(Number);
      for (let t = a; t <= b + 1e-9; t += st) jobs.push({ kind: 'fly', t: +t.toFixed(4), expr: `window.__renderFrame(${t})`, file: `fly_t${t.toFixed(2).padStart(6, '0')}.${EXT}` }); }
    if (LIVE) { jobs.length = 0; jobs.push({ kind: 'live', t: 0, expr: `new Promise(r=>setTimeout(r,${+opt('--wait', 1500)}))`, file: `${opt('--name', 'live')}.${EXT}` }); }
    if (!jobs.length) throw new Error('没有可拍的帧：页面未提供 window.__POSES，也没有 --fly');
    for (const j of jobs) {
      const a = Date.now();
      j.ret = await ev(j.expr);
      await ev('new Promise(r=>setTimeout(r,60))');
      const shot = await send('Page.captureScreenshot', { format: FMT, quality: FMT === 'jpeg' ? +opt('--quality', 90) : undefined, fromSurface: true, captureBeyondViewport: false }, S);
      fs.writeFileSync(path.join(OUT, j.file), Buffer.from(shot.data, 'base64'));
      j.ms = Date.now() - a; delete j.expr; report.shots.push(j);
      log('shot', j.file, j.kind === 'pose' ? `机位${j.pose + 1}(${j.name})` : j.kind === 'live' ? '实时模式整页' : '脚本镜头', 't=' + j.t, j.ms + 'ms', j.ret && typeof j.ret === 'object' ? JSON.stringify(j.ret) : '');
    }
    if (opt('--perf')) {
      const n = +opt('--perf'); report.perf = [];
      for (const i of poses.length ? poses : [0]) {
        const ms = await ev(`(()=>{const S=window.__sync||(()=>{});for(let k=0;k<8;k++)__pose(${i},k/60);S();const a=performance.now();for(let k=0;k<${n};k++)__pose(${i},k/60);S();return (performance.now()-a)/${n};})()`);
        report.perf.push({ pose: i, msPerFrame: +ms.toFixed(2) }); log(`perf 机位${i + 1}: ${ms.toFixed(2)} ms/帧（连续 ${n} 帧，含 CPU 提交；读作相对值）`);
      }
    }
    report.info2 = await ev('JSON.parse(JSON.stringify(window.__INFO||{}))');
  }
  report.ok = true;
  await send('Target.closeTarget', { targetId }).catch(() => {});
} catch (e) { report.error = String(e && e.message || e); exitCode = 1; console.error('失败:', report.error); }

if (report.console.length) { log('CONSOLE（' + report.console.length + ' 条）:'); for (const l of report.console.slice(0, 20)) log('  ' + l); }
if (report.console.some(l => /^(error|EXCEPTION)/.test(l))) exitCode = exitCode || 1;
if (report.software && !has('--allow-software')) { exitCode = exitCode || 2; console.error('软件渲染：截图不能作为画面验收依据（确认显卡驱动，或显式加 --allow-software）'); }
if (!PROBE) {
  fs.mkdirSync(OUT, { recursive: true }); const rp = path.join(OUT, 'report.json');

  try { const prev = JSON.parse(fs.readFileSync(rp, 'utf8')); const mine = new Set(report.shots.map(x => x.file));
    report.shots = [...(prev.shots || []).filter(x => !mine.has(x.file)), ...report.shots]; report.console = [...new Set([...(prev.console || []), ...report.console])];
    if (!report.perf && prev.perf) report.perf = prev.perf; } catch {}
  fs.writeFileSync(rp, JSON.stringify(report, null, 1)); log('report', rp);
}
else log(JSON.stringify(report.gpu, null, 1));
cleanup(exitCode);
