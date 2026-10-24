#!/usr/bin/env python3
"""Build the knight's anatomical body from the MakeHuman base mesh.

The MakeHuman base mesh, its targets, skeleton and skin weights were released
as CC0 by the MakeHuman project (http://www.makehumancommunity.org). This tool:

  1. applies body targets (young adult male, strong build, ideal proportions),
  2. maps MakeHuman's 163-bone skeleton onto the game's 19-joint rig and merges
     the skin weights,
  3. refits the mesh to the rig's bone lengths in MakeHuman's own A-pose, which
     becomes the bind pose of the in-game SkinnedMesh,
  4. drops the head, hands and feet (helmet, gauntlets and sabatons replace them),
  5. slices the torso and limbs into cross-sections so every armour plate can be
     shaped around the real body.

Output: public/models/body.json

Usage: put base.obj, default.mhskel, default_weights.mhw and the two .target
files from makehuman/data in a folder, then
    python3 tools/build_body.py /path/to/that/folder
"""
import base64, json, math, os, sys
import numpy as np

SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/mh'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models', 'body.json')
HEIGHT = 1.78           # crown height in metres, barefoot
MUSCLE = 0.55           # weight of the max-muscle target
PROPORTION = 1.0        # weight of the ideal-proportions target
INFLATE = 0.006         # padding: the arming clothes sit just outside the skin

# ---------------------------------------------------------------- the game's rig (keep in sync with rig.js)
JOINTS = ['hips', 'spine', 'chest', 'neck', 'head',
          'clavR', 'uArmR', 'fArmR', 'handR', 'clavL', 'uArmL', 'fArmL', 'handL',
          'thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL']
SKEL = {
    'hips': ('root', [0, 1.0, 0]), 'spine': ('hips', [0, 0.10, -0.01]), 'chest': ('spine', [0, 0.22, 0.0]),
    'neck': ('chest', [0, 0.20, -0.01]), 'head': ('neck', [0, 0.10, 0.02]),
    'clavR': ('chest', [-0.035, 0.13, 0.035]), 'uArmR': ('clavR', [-0.165, 0, 0]), 'fArmR': ('uArmR', [0, -0.30, 0]), 'handR': ('fArmR', [0, -0.265, 0]),
    'clavL': ('chest', [0.035, 0.13, 0.035]), 'uArmL': ('clavL', [0.165, 0, 0]), 'fArmL': ('uArmL', [0, -0.30, 0]), 'handL': ('fArmL', [0, -0.265, 0]),
    'thighR': ('hips', [-0.10, -0.06, 0]), 'shinR': ('thighR', [0, -0.45, 0]), 'footR': ('shinR', [0, -0.43, 0]),
    'thighL': ('hips', [0.10, -0.06, 0]), 'shinL': ('thighL', [0, -0.45, 0]), 'footL': ('shinL', [0, -0.43, 0]),
}
CHILD = {'hips': 'spine', 'spine': 'chest', 'chest': 'neck', 'neck': 'head',
         'clavR': 'uArmR', 'uArmR': 'fArmR', 'fArmR': 'handR', 'clavL': 'uArmL', 'uArmL': 'fArmL', 'fArmL': 'handL',
         'thighR': 'shinR', 'shinR': 'footR', 'thighL': 'shinL', 'shinL': 'footL'}
# rest direction of terminal joints (local)
TERMINAL_DIR = {'head': [0, 1, 0], 'handR': [0, -1, 0], 'handL': [0, -1, 0], 'footR': [0, 0, 1], 'footL': [0, 0, 1]}


def side(s):  # game side letter -> MakeHuman suffix (MakeHuman .L is +X, the character's left, as in the game)
    return '.R' if s == 'R' else '.L'


def bone_map():
    m = {}
    for b in ['root', 'spine05', 'pelvis.L', 'pelvis.R']: m[b] = 'hips'
    for b in ['spine04', 'spine03']: m[b] = 'spine'
    for b in ['spine02', 'spine01', 'breast.L', 'breast.R']: m[b] = 'chest'
    for b in ['neck01', 'neck02', 'neck03']: m[b] = 'neck'
    for s in 'RL':
        x = side(s)
        m['clavicle' + x] = 'clav' + s; m['shoulder01' + x] = 'clav' + s
        m['upperarm01' + x] = 'uArm' + s; m['upperarm02' + x] = 'uArm' + s
        m['lowerarm01' + x] = 'fArm' + s; m['lowerarm02' + x] = 'fArm' + s
        m['wrist' + x] = 'hand' + s
        m['upperleg01' + x] = 'thigh' + s; m['upperleg02' + x] = 'thigh' + s
        m['lowerleg01' + x] = 'shin' + s; m['lowerleg02' + x] = 'shin' + s
        m['foot' + x] = 'foot' + s
    return m


def mapped(bone):
    m = bone_map()
    if bone in m: return m[bone]
    for s in 'RL':
        x = side(s)
        if bone.endswith(x) and (bone.startswith('finger') or bone.startswith('metacarpal')): return 'hand' + s
        if bone.endswith(x) and bone.startswith('toe'): return 'foot' + s
    return 'head'  # face, eyes, jaw, tongue


# ---------------------------------------------------------------- load MakeHuman
def load():
    V, UV, faces = [], [], []
    cur = None
    for line in open(os.path.join(SRC, 'base.obj')):
        if line.startswith('v '): V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '): UV.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '): cur = line.split()[1]
        elif line.startswith('f ') and cur == 'body':
            t = [tok.split('/') for tok in line.split()[1:]]
            faces.append(([int(a[0]) - 1 for a in t], [int(a[1]) - 1 for a in t]))
    V = np.array(V, dtype=np.float64)

    def target(fn, w):
        for line in open(os.path.join(SRC, fn)):
            p = line.split()
            if len(p) == 4 and p[0].isdigit(): V[int(p[0])] += w * np.array([float(p[1]), float(p[2]), float(p[3])])
    target('universal-male-young-maxmuscle-averageweight.target', MUSCLE)
    target('male-young-averagemuscle-averageweight-idealproportions.target', PROPORTION)
    skel = json.load(open(os.path.join(SRC, 'default.mhskel')))
    J = {k: V[v].mean(0) for k, v in skel['joints'].items()}
    bones = {n: {'head': J[b['head']], 'tail': J[b['tail']]} for n, b in skel['bones'].items()}
    weights = json.load(open(os.path.join(SRC, 'default_weights.mhw')))['weights']
    return V, np.array(UV), faces, bones, weights


def rot_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = float(np.dot(a, b))
    if c < -0.9999:
        axis = np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0])
        axis /= np.linalg.norm(axis)
        return 2 * np.outer(axis, axis) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def axis_angle(axis, ang):
    axis = np.asarray(axis, float); axis = axis / np.linalg.norm(axis)
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * K @ K


def quat(R):
    t = np.trace(R)
    if t > 0:
        s = math.sqrt(t + 1) * 2; w = 0.25 * s; x = (R[2, 1] - R[1, 2]) / s; y = (R[0, 2] - R[2, 0]) / s; z = (R[1, 0] - R[0, 1]) / s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = math.sqrt(1 + R[0, 0] - R[1, 1] - R[2, 2]) * 2; w = (R[2, 1] - R[1, 2]) / s; x = 0.25 * s; y = (R[0, 1] + R[1, 0]) / s; z = (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = math.sqrt(1 + R[1, 1] - R[0, 0] - R[2, 2]) * 2; w = (R[0, 2] - R[2, 0]) / s; x = (R[0, 1] + R[1, 0]) / s; y = 0.25 * s; z = (R[1, 2] + R[2, 1]) / s
    else:
        s = math.sqrt(1 + R[2, 2] - R[0, 0] - R[1, 1]) * 2; w = (R[1, 0] - R[0, 1]) / s; x = (R[0, 2] + R[2, 0]) / s; y = (R[1, 2] + R[2, 1]) / s; z = 0.25 * s
    return [x, y, z, w]


def main():
    V, UV, faces, bones, mhw = load()
    used = sorted({i for f in faces for i in f[0]})
    ymin = V[used, 1].min(); ymax = V[used, 1].max()
    k = HEIGHT / (ymax - ymin)
    V = (V - [0, ymin, 0]) * k
    for b in bones.values(): b['head'] = (b['head'] - [0, ymin, 0]) * k; b['tail'] = (b['tail'] - [0, ymin, 0]) * k
    H = lambda n: bones[n]['head']

    # --- where each game joint sits on the MakeHuman body
    def on_chain(y):  # point on the MakeHuman spine at height y
        chain = [H('spine05'), H('spine04'), H('spine03'), H('spine02'), H('spine01'), H('neck01')]
        for a, b in zip(chain, chain[1:]):
            if a[1] <= y <= b[1]: t = (y - a[1]) / (b[1] - a[1]); return a + (b - a) * t
        return chain[-1]
    P = {}
    hipc = (H('upperleg01.L') + H('upperleg01.R')) / 2
    P['hips'] = np.array([0, hipc[1] + 0.06, hipc[2]])
    P['spine'] = on_chain(P['hips'][1] + 0.10)
    P['chest'] = on_chain(P['spine'][1] + 0.22)
    P['neck'] = H('neck01'); P['head'] = H('head')
    for s in 'RL':
        x = side(s)
        P['clav' + s] = H('clavicle' + x); P['uArm' + s] = H('upperarm01' + x); P['fArm' + s] = H('lowerarm01' + x)
        P['hand' + s] = H('wrist' + x); P['thigh' + s] = H('upperleg01' + x); P['shin' + s] = H('lowerleg01' + x); P['foot' + s] = H('foot' + x)
    END = {'head': bones['head']['tail']}
    for s in 'RL':
        x = side(s)
        END['hand' + s] = H('finger3-1' + x); END['foot' + s] = H('toe3-1' + x)

    # --- bind pose: each game bone points where MakeHuman's does
    Wd = {}   # world rotation of each joint in the bind pose
    Bp = {}   # world position of each joint in the bind pose
    local_q = {}
    FWD = np.array([0, 0, 1.0])
    for j in JOINTS:
        parent, off = SKEL[j]
        Wp = np.eye(3) if parent == 'root' else Wd[parent]
        Bp[j] = np.array(off, float) if parent == 'root' else Bp[parent] + Wp @ np.array(off, float)
        rest = np.array(SKEL[CHILD[j]][1], float) if j in CHILD else np.array(TERMINAL_DIR[j], float)
        rest /= np.linalg.norm(rest)
        tgt = (P[CHILD[j]] if j in CHILD else END[j]) - P[j]
        R = rot_between(rest, tgt)
        d = R @ rest
        # twist about the bone: elbows and knees must hinge in the bone's YZ plane; otherwise keep +Z forward
        if j.startswith('uArm') or j.startswith('thigh'):
            nxt = CHILD[CHILD[j]]
            child_dir = P[nxt] - P[CHILD[j]]
            bend = child_dir - d * np.dot(child_dir, d)
            want = 1 if j.startswith('uArm') else -1     # forearm bends to +Z, shin to -Z
            if np.linalg.norm(bend) > 0.02 * np.linalg.norm(child_dir):
                z = R @ np.array([0, 0, 1.0])
                ref = want * bend / np.linalg.norm(bend)
            else:
                z = R @ np.array([0, 0, 1.0]); ref = FWD - d * np.dot(FWD, d); ref /= np.linalg.norm(ref)
        else:
            z = R @ (np.array([0, 0, 1.0]) if abs(rest[2]) < 0.9 else np.array([0, 1.0, 0]))
            ref = (FWD if abs(rest[2]) < 0.9 else np.array([0, 1.0, 0]))
            ref = ref - d * np.dot(ref, d); ref /= np.linalg.norm(ref)
        zp = z - d * np.dot(z, d); zp /= np.linalg.norm(zp)
        ang = math.atan2(np.dot(np.cross(zp, ref), d), np.dot(zp, ref))
        R = axis_angle(d, ang) @ R
        # forearm and shin: pure hinge relative to the parent, as the game's IK expects
        Wd[j] = R
        local_q[j] = quat(Wp.T @ R)

    # --- skin weights onto the game joints
    nv = len(V)
    Wj = np.zeros((nv, len(JOINTS)))
    for bone, wmap in mhw.items():
        ji = JOINTS.index(mapped(bone))
        for vi, w in wmap: Wj[int(vi), ji] += w
    s = Wj.sum(1, keepdims=True); s[s == 0] = 1; Wj /= s

    # --- refit the mesh to the game's bone lengths (linear blend of per-joint scalings along each bone)
    Vb = np.zeros_like(V)
    for ji, j in enumerate(JOINTS):
        w = Wj[:, ji]
        if not w.any(): continue
        rest = np.array(SKEL[CHILD[j]][1], float) if j in CHILD else np.array(TERMINAL_DIR[j], float)
        d = Wd[j] @ (rest / np.linalg.norm(rest))
        if j in CHILD:
            ratio = np.linalg.norm(SKEL[CHILD[j]][1]) / np.linalg.norm(P[CHILD[j]] - P[j])
        else:
            ratio = 1.0
        if j in ('hips', 'spine', 'chest', 'neck'): ratio = 1.0 + (ratio - 1.0) * 0.5   # keep the torso's own proportions
        S = np.eye(3) + (ratio - 1) * np.outer(d, d)
        Vb += w[:, None] * (Bp[j] + (V - P[j]) @ S.T)

    # --- triangles kept (no head/face, hands, feet)
    drop = {JOINTS.index(j) for j in ['head', 'handR', 'handL', 'footR', 'footL']}
    dom = Wj.argmax(1)
    tris_v, tris_t = [], []
    for fv, ft in faces:
        for a in range(1, len(fv) - 1):
            tv = [fv[0], fv[a], fv[a + 1]]; tt = [ft[0], ft[a], ft[a + 1]]
            if sum(Wj[i, list(drop)].sum() > 0.5 for i in tv) >= 2: continue
            tris_v.append(tv); tris_t.append(tt)
    tris_v = np.array(tris_v); tris_t = np.array(tris_t)

    # normals on the refitted mesh
    N = np.zeros_like(Vb)
    a, b, c = Vb[tris_v[:, 0]], Vb[tris_v[:, 1]], Vb[tris_v[:, 2]]
    fn = np.cross(b - a, c - a)
    for i in range(3): np.add.at(N, tris_v[:, i], fn)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    Vb_out = Vb + N * INFLATE

    # --- split by (vertex, uv) pairs
    key = {}
    out_v, out_uv, idx = [], [], []
    for tv, tt in zip(tris_v, tris_t):
        for vi, ti in zip(tv, tt):
            kk = (vi, ti)
            if kk not in key: key[kk] = len(out_v); out_v.append(vi); out_uv.append(ti)
            idx.append(key[kk])
    out_v = np.array(out_v); out_uv = np.array(out_uv)
    pos = Vb_out[out_v].astype(np.float32)
    nrm = N[out_v]
    uv = UV[out_uv].astype(np.float32)
    # four strongest joints
    W = Wj[out_v]
    order = np.argsort(-W, axis=1)[:, :4]
    wsel = np.take_along_axis(W, order, 1)
    wsel /= np.maximum(wsel.sum(1, keepdims=True), 1e-9)
    wq = np.round(wsel * 255).astype(np.int32)
    wq[:, 0] += 255 - wq.sum(1)
    # cloth regions: 0 arming doublet, 1 hose, 2 mail
    J = {j: i for i, j in enumerate(JOINTS)}
    reg = np.zeros(len(out_v), np.uint8)
    d0 = dom[out_v]
    legs = np.isin(d0, [J['hips'], J['thighR'], J['thighL'], J['shinR'], J['shinL'], J['footR'], J['footL']])
    reg[legs] = 1
    reg[d0 == J['neck']] = 2
    # mail gussets where the arm meets the body (armpits) and inside the elbow
    for s_ in 'RL':
        u = W[:, J['uArm' + s_]]; t = W[:, J['chest']] + W[:, J['clav' + s_]]
        reg[(u > 0.2) & (t > 0.2) & (nrm[:, 1] < 0.3)] = 2
        e1 = W[:, J['uArm' + s_]]; e2 = W[:, J['fArm' + s_]]
        reg[(e1 > 0.25) & (e2 > 0.25)] = 2

    # --- cross-sections for the armourer: in each joint's local frame (bind pose)
    def sections(joint_names, frame, y0, y1, dy=0.01, nth=48):
        jset = [J[n] for n in joint_names]
        keep = np.isin(dom, jset)
        tri = tris_v[keep[tris_v].all(1)]
        R = Wd[frame]; O = Bp[frame]
        L = (Vb - O) @ R      # world -> local
        ys = np.arange(y0, y1 + 1e-9, dy)
        rows, cents = [], []
        for y in ys:
            pa, pb, pc = L[tri[:, 0]], L[tri[:, 1]], L[tri[:, 2]]
            pts = []
            for p, q in ((pa, pb), (pb, pc), (pc, pa)):
                m = (p[:, 1] - y) * (q[:, 1] - y) < 0
                if not m.any(): continue
                t = (y - p[m, 1]) / (q[m, 1] - p[m, 1])
                pts.append(p[m][:, [0, 2]] + (q[m][:, [0, 2]] - p[m][:, [0, 2]]) * t[:, None])
            if not pts: rows.append(None); cents.append(None); continue
            pts = np.concatenate(pts)
            # convex hull (plates bridge hollows), then radius at each angle from the hull's centre
            hull = convex_hull(pts)
            c = hull.mean(0)
            r = np.zeros(nth)
            for i in range(nth):
                th = 2 * math.pi * i / nth
                dirv = np.array([math.sin(th), math.cos(th)])
                r[i] = ray_poly(c, dirv, hull)
            rows.append(r); cents.append(c)
        # fill gaps at the ends, smooth along y
        good = [i for i, r in enumerate(rows) if r is not None]
        for i in range(len(rows)):
            if rows[i] is None:
                g = min(good, key=lambda q: abs(q - i)); rows[i] = rows[g]; cents[i] = cents[g]
        R_ = np.array(rows); C_ = np.array(cents)
        R_ = smooth_rows(R_, 2); C_ = smooth_rows(C_, 2)
        R_ = smooth_cols(R_, 1)
        return {'y0': round(float(ys[0]), 4), 'dy': dy, 'ny': len(ys), 'nth': nth,
                'r': [round(float(v), 4) for v in R_.ravel()], 'c': [round(float(v), 4) for v in C_.ravel()]}

    fields = {}
    fields['torso'] = sections(['hips', 'spine', 'chest', 'clavR', 'clavL'], 'chest', -0.42, 0.22)
    fields['neck'] = sections(['neck'], 'neck', -0.03, 0.10)
    for s_ in 'RL':
        fields['uArm' + s_] = sections(['uArm' + s_], 'uArm' + s_, -0.31, 0.04)
        fields['fArm' + s_] = sections(['fArm' + s_], 'fArm' + s_, -0.27, 0.02)
        fields['thigh' + s_] = sections(['thigh' + s_], 'thigh' + s_, -0.46, 0.04)
        fields['shin' + s_] = sections(['shin' + s_], 'shin' + s_, -0.43, 0.02)

    b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
    nq = np.clip(np.round(nrm * 127), -127, 127).astype(np.int8)
    asset = {
        'about': 'Knight body refitted from the MakeHuman base mesh (CC0, makehumancommunity.org). Built by tools/build_body.py.',
        'joints': JOINTS,
        'bind': {j: [round(x, 6) for x in local_q[j]] for j in JOINTS},
        'count': int(len(pos)), 'tris': int(len(idx) // 3),
        'position': b64(pos), 'normal': b64(nq), 'uv': b64(uv),
        'skinIndex': b64(order.astype(np.uint8)), 'skinWeight': b64(wq.astype(np.uint8)),
        'region': b64(reg), 'index': b64(np.array(idx, np.uint16 if len(pos) < 65536 else np.uint32)),
        'fields': fields,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(asset, open(OUT, 'w'), separators=(',', ':'))
    print('vertices', len(pos), 'triangles', len(idx) // 3, 'bytes', os.path.getsize(OUT))
    # report on fit
    for j in JOINTS:
        print(f'{j:7s} bind', np.round(Bp[j], 3), 'mh', np.round(P[j], 3))


def convex_hull(pts):
    pts = np.unique(np.round(pts, 6), axis=0)
    pts = pts[np.lexsort((pts[:, 1], pts[:, 0]))]
    if len(pts) < 3: return pts
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0: lower.pop()
        lower.append(tuple(p))
    for p in pts[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0: upper.pop()
        upper.append(tuple(p))
    return np.array(lower[:-1] + upper[:-1])


def ray_poly(c, d, poly):
    best = 0.0
    n = len(poly)
    for i in range(n):
        a = poly[i]; b = poly[(i + 1) % n]
        e = b - a; den = d[0] * (-e[1]) - d[1] * (-e[0])
        if abs(den) < 1e-12: continue
        w = a - c
        t = (w[0] * (-e[1]) - w[1] * (-e[0])) / den
        u = (d[0] * w[1] - d[1] * w[0]) / den
        if t > 0 and -1e-9 <= u <= 1 + 1e-9: best = max(best, t)
    return best


def smooth_rows(A, r):
    out = A.copy()
    for i in range(len(A)):
        lo, hi = max(0, i - r), min(len(A), i + r + 1)
        out[i] = A[lo:hi].mean(0)
    return out


def smooth_cols(A, r):
    out = A.copy(); n = A.shape[1]
    for i in range(n):
        out[:, i] = np.mean([A[:, (i + k) % n] for k in range(-r, r + 1)], axis=0)
    return out


if __name__ == '__main__':
    main()
