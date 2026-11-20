#!/usr/bin/env python3
"""把 shoot.mjs 拍的一轮截图整理成【评审包】：总览拼图 + 原生分辨率裁切 + 连续帧条带 + 体检数字。

  python tools/sheet.py qa/r01 [--cols 3] [--tile 640] [--crops 2] [--crop 960x540]

产出（都写回同一目录）：
  sheet.jpg            所有帧的带标签拼图（给人和评审员看整体）
  pN_cropK.png         每个机位 K 张原生分辨率裁切，自动挑边缘最密的区域（评审员看大图会被缩小，锯齿/色带/闪点只有原生裁切看得见）
  pN_strip.jpg         同一机位多个时刻（shoot.mjs --t 0,0.5,1）的横向条带，并打印相邻帧的变化量（查闪烁、popping、死画面）
  stats.json           每张图的平均亮度/对比度/过曝欠曝占比；近乎全黑、近乎纯色会被标成 SUSPECT（先修这个，别送评审）
需要 Pillow。
"""
import glob, json, os, re, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageStat
a = sys.argv[1:]
if not a: print(__doc__); sys.exit(1)
D = a[0]
def opt(k, d): return a[a.index(k) + 1] if k in a else d
COLS, TILE, NCROP = int(opt("--cols", 3)), int(opt("--tile", 640)), int(opt("--crops", 2))
CW, CH = (int(v) for v in opt("--crop", "960x540").split("x"))
def font(sz):
    for p in ("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf", "/System/Library/Fonts/PingFang.ttc",
              "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(p):
            try: return ImageFont.truetype(p, sz)
            except Exception: pass
    return ImageFont.load_default()
F = font(16)
files = sorted(f for f in glob.glob(os.path.join(D, "*.png")) + glob.glob(os.path.join(D, "*.jpg"))
               if re.match(r"(p\d+(_t[\d.]+)?|fly_t[\d.]+)\.(png|jpg)$", os.path.basename(f)))
if not files: print("没有找到 pN.png / fly_t*.png：先跑 shoot.mjs"); sys.exit(1)
labels = {}
try:
    for s in json.load(open(os.path.join(D, "report.json"), encoding="utf-8")).get("shots", []):
        labels[s["file"]] = (f"机位{s['pose'] + 1} {s.get('name', '')}" if s.get("kind") == "pose" else "脚本镜头") + f"  t={s['t']}s"
except Exception: pass
stats, suspect = {}, []
ims = []
for f in files:
    im = Image.open(f).convert("RGB"); ims.append(im); g = im.convert("L"); st = ImageStat.Stat(g); h = g.histogram(); n = im.size[0] * im.size[1]
    s = {"size": list(im.size), "mean": round(st.mean[0], 1), "contrast": round(st.stddev[0], 1),
         "crushed%": round(100 * sum(h[:4]) / n, 1), "clipped%": round(100 * sum(h[252:]) / n, 1)}
    if s["mean"] < 4: s["SUSPECT"] = "近乎全黑"
    elif s["contrast"] < 3: s["SUSPECT"] = "近乎纯色"
    elif s["clipped%"] > 25: s["SUSPECT"] = "大面积过曝"
    elif s["crushed%"] > 45: s["SUSPECT"] = "大面积死黑"
    if "SUSPECT" in s: suspect.append((os.path.basename(f), s["SUSPECT"]))
    stats[os.path.basename(f)] = s

th = int(TILE * ims[0].height / ims[0].width); rows = (len(ims) + COLS - 1) // COLS
sh = Image.new("RGB", (COLS * (TILE + 6) + 6, rows * (th + 28) + 6), (16, 16, 18)); d = ImageDraw.Draw(sh)
for k, (im, f) in enumerate(zip(ims, files)):
    x, y = 6 + (k % COLS) * (TILE + 6), 6 + (k // COLS) * (th + 28); b = os.path.basename(f)
    sh.paste(im.resize((TILE, th), Image.LANCZOS), (x, y + 24)); d.text((x + 2, y + 1), labels.get(b, b), fill=(255, 205, 90), font=F)
sh.save(os.path.join(D, "sheet.jpg"), quality=90); print("SHEET", os.path.join(D, "sheet.jpg"), sh.size)

for im, f in zip(ims, files):
    b = os.path.basename(f)
    if not re.match(r"p\d+\.(png|jpg)$", b) or NCROP <= 0 or im.width < CW or im.height < CH: continue
    e = im.convert("L").filter(ImageFilter.FIND_EDGES); gx, gy = 4, 3; cells = []
    for j in range(gy):
        for i in range(gx):
            box = (i * im.width // gx, j * im.height // gy, (i + 1) * im.width // gx, (j + 1) * im.height // gy)
            cells.append((ImageStat.Stat(e.crop(box)).mean[0], i, j))
    cells.sort(reverse=True); picked = []
    for _, i, j in cells:
        if all(abs(i - pi) + abs(j - pj) > 1 for pi, pj in picked): picked.append((i, j))
        if len(picked) == NCROP: break
    for k, (i, j) in enumerate(picked):
        cx, cy = int((i + 0.5) * im.width / gx), int((j + 0.5) * im.height / gy)
        x0, y0 = min(max(cx - CW // 2, 0), im.width - CW), min(max(cy - CH // 2, 0), im.height - CH)
        im.crop((x0, y0, x0 + CW, y0 + CH)).save(os.path.join(D, f"{b.split('.')[0]}_crop{k + 1}.png"))
    print("CROPS", b, picked)

groups = {}
for im, f in zip(ims, files):
    m = re.match(r"(p\d+)_t([\d.]+)\.", os.path.basename(f))
    if m: groups.setdefault(m.group(1), []).append((float(m.group(2)), im))
for key, seq in sorted(groups.items()):
    seq.sort(key=lambda s: s[0]); w = 480; h = int(w * seq[0][1].height / seq[0][1].width)
    st = Image.new("RGB", (len(seq) * (w + 4) + 4, h + 30), (16, 16, 18)); d = ImageDraw.Draw(st)
    for k, (t, im) in enumerate(seq):
        st.paste(im.resize((w, h), Image.LANCZOS), (4 + k * (w + 4), 26)); d.text((6 + k * (w + 4), 2), f"{key}  t={t}s", fill=(255, 205, 90), font=F)
    st.save(os.path.join(D, f"{key}_strip.jpg"), quality=90)
    line = []
    for (t0, A), (t1, B) in zip(seq, seq[1:]):
        A8, B8 = (im.resize((im.width // 8, im.height // 8), Image.BOX) for im in (A, B))
        dd = ImageChops.difference(A8, B8).convert("L"); hh = dd.histogram(); nn = sum(hh)
        fine = ImageStat.Stat(ImageChops.difference(A, B).convert("L")).mean[0]
        line.append(f"{t0}→{t1}s: 动了 {100 * sum(hh[7:]) / nn:.1f}% 像素, 粗差 {sum(i * v for i, v in enumerate(hh)) / nn:.2f}, 细差 {fine:.2f}")
    print("MOTION", key, " | ".join(line))
    stats[key + "_motion"] = line
json.dump(stats, open(os.path.join(D, "stats.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for b, s in stats.items():
    if isinstance(s, dict): print(f"  {b:22s} 亮度 {s['mean']:5.1f}  对比 {s['contrast']:5.1f}  死黑 {s['crushed%']:4.1f}%  过曝 {s['clipped%']:4.1f}%  {s.get('SUSPECT', '')}")
if suspect: print("SUSPECT:", suspect, "← 先修这些再送评审"); sys.exit(4)
