"""Quick offline preview of the supplied GLB (no materials/UVs). For inspection only."""
import json, struct, math, sys
from PIL import Image, ImageDraw

PATH = sys.argv[1] if len(sys.argv) > 1 else '机器人.glb'
b = open(PATH, 'rb').read()
jlen = struct.unpack_from('<I', b, 12)[0]
j = json.loads(b[20:20+jlen])
binoff = 20 + jlen + 8

def acc_data(i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    off = binoff + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    ct = a['componentType']
    fmt = {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B', 5122: 'h', 5120: 'b'}[ct]
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    size = struct.calcsize('<' + fmt)
    stride = bv.get('byteStride', size * ncomp)
    out = []
    for k in range(a['count']):
        vals = struct.unpack_from('<' + fmt * ncomp, b, off + k * stride)
        out.append(vals)
    return out

parts = []
for mi, m in enumerate(j['meshes']):
    p = m['primitives'][0]
    pos = acc_data(p['attributes']['POSITION'])
    col = acc_data(p['attributes']['COLOR_0'])
    idx = [v[0] for v in acc_data(p['indices'])]
    c = tuple(col[0][:3])
    parts.append((mi, pos, c, idx))


allx = [p[0] for _, pos, _, _ in parts for p in pos]
ally = [p[1] for _, pos, _, _ in parts for p in pos]
allz = [p[2] for _, pos, _, _ in parts for p in pos]
cx = (min(allx) + max(allx)) / 2
cy = (min(ally) + max(ally)) / 2
cz = (min(allz) + max(allz)) / 2
scale = 1.0 / max(max(allx) - min(allx), max(ally) - min(ally), max(allz) - min(allz))

def rot_y(v, a):
    x, y, z = v
    return (x * math.cos(a) + z * math.sin(a), y, -x * math.sin(a) + z * math.cos(a))

def rot_x(v, a):
    x, y, z = v
    return (x, y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a))

VIEWS = {
    'front': lambda v: (v[0], v[1], v[2]),
    'back': lambda v: (-v[0], v[1], -v[2]),
    'side': lambda v: (v[2], v[1], v[0]),
    'iso': lambda v: rot_x(rot_y(v, -0.62), -0.24),
}

W = H = 900
SS = 2
for name, tf in VIEWS.items():
    img = Image.new('RGB', (W * SS, H * SS), (214, 216, 218))
    dr = ImageDraw.Draw(img)
    tris = []
    for mi, pos, c, idx in parts:
        wp = [tf((p[0] - cx, p[1] - cy, p[2] - cz)) for p in pos]
        for t in range(0, len(idx), 3):
            a, b_, cc = idx[t], idx[t+1], idx[t+2]
            v0, v1, v2 = wp[a], wp[b_], wp[cc]

            ux, uy, uz = v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2]
            vx, vy, vz = v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2]
            nx, ny, nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
            ln = math.sqrt(nx*nx+ny*ny+nz*nz) or 1
            nx, ny, nz = nx/ln, ny/ln, nz/ln
            l = max(0.0, 0.42*nx + 0.78*ny + 0.46*nz)
            sh = 0.38 + 0.62 * l
            col = tuple(max(0, min(255, int((c[k]/255.0) ** 1.0 * 255 * sh))) for k in range(3))
            depth = (v0[2]+v1[2]+v2[2]) / 3
            def sx(v): return (v[0] / scale * 0.42 + 0.5) * W * SS
            def sy(v): return (0.5 - v[1] / scale * 0.42) * H * SS
            tris.append((depth, [(sx(v0), sy(v0)), (sx(v1), sy(v1)), (sx(v2), sy(v2))], col))
    tris.sort(key=lambda t: t[0])
    for _, pts, col in tris:
        dr.polygon(pts, fill=col)
    img = img.resize((W, H), Image.LANCZOS)
    out = 'qa/robot_%s.png' % name
    img.save(out)
    print(out)
