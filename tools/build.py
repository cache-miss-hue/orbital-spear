#!/usr/bin/env python3
"""把 vendor 里的 three.js（内联成一个暴露 window.THREE 的经典脚本）和 src/*.js 按文件名顺序拼成【一个】HTML。

  python tools/build.py              ->  src/*.js + src/shell.html  ->  dist/index.html
  python tools/build.py --out a.html ->  同上，写到 dist/a.html

每个模块先单独 `node --check`，再整体检查一次（抓"同一个顶层名字在两个模块里声明"）。语法错误会点名文件并停止构建。
约定：src/ 下是普通全局脚本（不是 ES module），文件名前缀数字决定拼接顺序；shell.html 里放 {{THREE}} 和 {{APP}} 两个占位符。
（显式 UTF-8，Windows 可用。）
"""
import glob, os, re, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
a = sys.argv[1:]
NAME = a[a.index("--out") + 1] if "--out" in a else "index.html"
SRC = os.path.join(ROOT, "src"); OUT = os.path.join(ROOT, "dist", NAME); V = os.path.join(ROOT, "vendor")
rd = lambda p: open(p, encoding="utf-8").read()
shell = rd(os.path.join(SRC, "shell.html"))
core = rd(os.path.join(V, "three.core.min.js")); mod = rd(os.path.join(V, "three.module.min.js"))
def pairs(body):
    out = []
    for it in body.split(","):
        it = it.strip()
        if not it: continue
        if " as " in it: x, y = [s.strip() for s in it.split(" as ")]; out.append((x, y))
        else: out.append((it, it))
    return out
mc = re.search(r'export\s*\{([^}]*)\}\s*;?\s*$', core.strip()); core_body = core.strip()[:mc.start()]; core_exports = pairs(mc.group(1))
mi = re.search(r'import\s*\{([^}]*)\}\s*from\s*"\./three\.core\.min\.js"\s*;?', mod); imports = pairs(mi.group(1))
reexp = re.search(r'export\s*\{([^}]*)\}\s*from\s*"\./three\.core\.min\.js"\s*;?', mod)
mod_body = mod.replace(mi.group(0), "", 1)
if reexp: mod_body = mod_body.replace(reexp.group(0), "", 1)
mo = re.search(r'export\s*\{([^}]*)\}\s*;?\s*$', mod_body.strip()); own = pairs(mo.group(1)); mod_body = mod_body.strip()[:mo.start()]
reexported = [n for _, n in pairs(reexp.group(1))] if reexp else []
three = ("var THREE=(function(){'use strict';var __core=(function(){'use strict';" + core_body + ";return{" + ",".join(f"{n}:{l}" for l, n in core_exports) + "};})();" +
  "var __mod=(function(__core){'use strict';var{" + ",".join(f"{n}:{l}" for n, l in imports) + "}=__core;" + mod_body +
  ";return{" + ",".join([f"{n}:__core.{n}" for n in reexported] + [f"{n}:{l}" for l, n in own]) + "};})(__core);return Object.freeze(Object.assign({},__core,__mod));})();")
def check(path):
    return subprocess.run(["node", "--check", path], capture_output=True, text=True, encoding="utf-8", errors="replace")
app = []; ok = True
for f in sorted(glob.glob(os.path.join(SRC, "*.js"))):
    src = rd(f); assert "</script" not in src.lower(), f"{f}: 源码里不能出现 </script"
    r = check(f)
    if r.returncode != 0:
        ok = False; print(f"SYNTAX ERROR in {os.path.relpath(f, ROOT)}:\n{r.stderr.strip()[:1500]}")
    app.append(f"// ===== {os.path.basename(f)} =====\n" + src.replace("'use strict';", "", 1))
if not ok:
    print("构建停止：先修上面的语法错误"); sys.exit(1)
joined = "'use strict';\n" + "\n".join(app)
with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as tf: tf.write(joined)
r = check(tf.name); os.unlink(tf.name)
if r.returncode != 0:
    print("拼接后的整体有语法错误（多半是同一个顶层名字在两个模块里声明了）:\n" + r.stderr.strip()[:1500]); sys.exit(1)

import base64
glb_path = os.path.join(ROOT, "机器人.glb")
glb_b64 = base64.b64encode(open(glb_path, "rb").read()).decode("ascii")
joined = joined.replace("{{ROBOT_GLB_B64}}", glb_b64)
import datetime
joined = joined.replace("{{BUILD_TIME}}", datetime.datetime.now().strftime("%m-%d %H:%M"))
notices = rd(os.path.join(ROOT, "LICENSE")).strip() + "\n\n" + rd(os.path.join(V, "LICENSE")).strip()
out = shell.replace("{{THREE}}", f"/*\n{notices}\n*/\n" + three).replace("{{APP}}", joined)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
tmp = OUT + ".tmp"; open(tmp, "w", encoding="utf-8", newline="\n").write(out); os.replace(tmp, OUT)
print(f"built {os.path.relpath(OUT, ROOT)}  {len(out.encode('utf-8'))/1024:.0f} KB  ({len(app)} modules)")
