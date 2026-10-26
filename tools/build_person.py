#!/usr/bin/env python3
"""Build the townsfolk (the priest and the sutler) as whole people from the MakeHuman base mesh (CC0).

Same pipeline as build_body.py (targets -> map MakeHuman's skeleton onto the game's 19-joint rig -> refit to
the rig's bone lengths in the A-pose bind), but nothing is dropped: the full head and face, the hands with every
finger, the feet. MakeHuman's low-poly eyes (CC0) are fitted on, with their iris texture. Regions mark skin,
hair (by a rule on the scalp: a monk's tonsure, a trader's crop and beard), eyebrows, shoes and eyes, for the
game's shader to colour.

Usage: python3 tools/build_person.py /home/claude/mh      -> public/models/people.json, public/models/eye.png
"""
import base64, json, math, os, shutil, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_body as B

SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/mh'
B.SRC = SRC
OUTDIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models')
VARIANTS = {
    # an old priest, thin and a little stooped by the years
    'priest': {'height': 1.74, 'targets': [('universal-male-old-minmuscle-minweight.target', 1.0)], 'hair': 'tonsure'},
    # a well-fed camp trader in his prime, cropped hair and a beard
    'sutler': {'height': 1.72, 'targets': [('universal-male-young-averagemuscle-maxweight.target', 0.75), ('male-young-averagemuscle-averageweight-idealproportions.target', 0.5)], 'hair': 'crop'},
}
# Our Lady of the Fen (statue.js): a young woman, built to lady.json so the townsfolk file stays as it was.
# python3 tools/build_person.py /home/claude/mh --lady
LADY = {'lady': {'height': 1.66, 'targets': [('universal-female-young-averagemuscle-averageweight.target', 1.0), ('female-young-averagemuscle-averageweight-idealproportions.target', 0.6)], 'hair': 'veil'}}
SKIN, HAIR, BROW, SHOE, EYE, LIP, CLOTH = 0, 1, 2, 3, 4, 5, 6


def load(targets):
    V, UV, faces, groups = [], [], [], {}
    cur = None
    for line in open(os.path.join(SRC, 'base.obj')):
        if line.startswith('v '): V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '): UV.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '): cur = line.split()[1]
        elif line.startswith('f ') and cur == 'body':
            t = [tok.split('/') for tok in line.split()[1:]]
            faces.append(([int(a[0]) - 1 for a in t], [int(a[1]) - 1 for a in t]))
    V = np.array(V, dtype=np.float64)
    for fn, w in targets:
        for line in open(os.path.join(SRC, fn)):
            p = line.split()
            if len(p) == 4 and p[0].isdigit(): V[int(p[0])] += w * np.array([float(p[1]), float(p[2]), float(p[3])])
    skel = json.load(open(os.path.join(SRC, 'default.mhskel')))
    J = {k: V[v].mean(0) for k, v in skel['joints'].items()}
    bones = {n: {'head': J[b['head']], 'tail': J[b['tail']]} for n, b in skel['bones'].items()}
    weights = json.load(open(os.path.join(SRC, 'default_weights.mhw')))['weights']
    return V, np.array(UV), faces, bones, weights


def eyes():
    """MakeHuman's low-poly eyes: each proxy vertex rides exactly on a base-mesh helper vertex."""
    ref = []; started = False
    for line in open(os.path.join(SRC, 'eyes', 'low-poly.mhclo')):
        if line.startswith('verts'): started = True; continue
        if started:
            p = line.split()
            if len(p) == 1 and p[0].isdigit(): ref.append(int(p[0]))
            elif len(p) >= 9: ref.append(int(p[0]))
    UVe, F = [], []
    for line in open(os.path.join(SRC, 'eyes', 'low-poly.obj')):
        if line.startswith('vt '): UVe.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('f '):
            t = [tok.split('/') for tok in line.split()[1:]]
            F.append(([int(a[0]) - 1 for a in t], [int(a[1]) - 1 for a in t]))
    return np.array(ref), np.array(UVe), F


def build(name, cfg):
    V, UV, faces, bones, mhw = load(cfg['targets'])
    eref, euv, efaces = eyes()
    used = sorted({i for f in faces for i in f[0]})
    ymin = V[used, 1].min(); ymax = V[used, 1].max()
    k = cfg['height'] / (ymax - ymin)
    V = (V - [0, ymin, 0]) * k
    for b in bones.values(): b['head'] = (b['head'] - [0, ymin, 0]) * k; b['tail'] = (b['tail'] - [0, ymin, 0]) * k
    H = lambda n: bones[n]['head']
    # (joint placement and bind exactly as for the knights)
    def on_chain(y):
        chain = [H('spine05'), H('spine04'), H('spine03'), H('spine02'), H('spine01'), H('neck01')]
        for a, b in zip(chain, chain[1:]):
            if a[1] <= y <= b[1]: t = (y - a[1]) / (b[1] - a[1]); return a + (b - a) * t
        return chain[-1]
    P = {}
    hipc = (H('upperleg01.L') + H('upperleg01.R')) / 2
    P['hips'] = np.array([0, hipc[1] + 0.06, hipc[2]]); P['spine'] = on_chain(P['hips'][1] + 0.10); P['chest'] = on_chain(P['spine'][1] + 0.22)
    P['neck'] = H('neck01'); P['head'] = H('head')
    for s in 'RL':
        x = B.side(s)
        P['clav' + s] = H('clavicle' + x); P['uArm' + s] = H('upperarm01' + x); P['fArm' + s] = H('lowerarm01' + x)
        P['hand' + s] = H('wrist' + x); P['thigh' + s] = H('upperleg01' + x); P['shin' + s] = H('lowerleg01' + x); P['foot' + s] = H('foot' + x)
    END = {'head': bones['head']['tail']}
    for s in 'RL':
        x = B.side(s); END['hand' + s] = H('finger3-1' + x); END['foot' + s] = H('toe3-1' + x)
    JOINTS, SKEL, CHILD, TD = B.JOINTS, B.SKEL, B.CHILD, B.TERMINAL_DIR
    Wd, Bp, local_q = {}, {}, {}
    FWD = np.array([0, 0, 1.0])
    for j in JOINTS:
        parent, off = SKEL[j]
        Wp = np.eye(3) if parent == 'root' else Wd[parent]
        Bp[j] = np.array(off, float) if parent == 'root' else Bp[parent] + Wp @ np.array(off, float)
        rest = np.array(SKEL[CHILD[j]][1], float) if j in CHILD else np.array(TD[j], float); rest /= np.linalg.norm(rest)
        tgt = (P[CHILD[j]] if j in CHILD else END[j]) - P[j]
        R = B.rot_between(rest, tgt); d = R @ rest
        if j.startswith('uArm') or j.startswith('thigh'):
            nxt = CHILD[CHILD[j]]; child_dir = P[nxt] - P[CHILD[j]]; bend = child_dir - d * np.dot(child_dir, d)
            want = 1 if j.startswith('uArm') else -1
            z = R @ np.array([0, 0, 1.0])
            if np.linalg.norm(bend) > 0.02 * np.linalg.norm(child_dir): ref = want * bend / np.linalg.norm(bend)
            else: ref = FWD - d * np.dot(FWD, d); ref /= np.linalg.norm(ref)
        else:
            z = R @ (np.array([0, 0, 1.0]) if abs(rest[2]) < 0.9 else np.array([0, 1.0, 0]))
            ref = (FWD if abs(rest[2]) < 0.9 else np.array([0, 1.0, 0])); ref = ref - d * np.dot(ref, d); ref /= np.linalg.norm(ref)
        zp = z - d * np.dot(z, d); zp /= np.linalg.norm(zp)
        ang = math.atan2(np.dot(np.cross(zp, ref), d), np.dot(zp, ref))
        R = B.axis_angle(d, ang) @ R
        Wd[j] = R; local_q[j] = B.quat(Wp.T @ R)
    nv = len(V)
    Wj = np.zeros((nv, len(JOINTS)))
    for bone, wmap in mhw.items():
        ji = JOINTS.index(B.mapped(bone))
        for vi, w in wmap: Wj[int(vi), ji] += w
    # the eye helpers carry no weights of their own: they ride the head
    Wj[eref, :] = 0; Wj[eref, JOINTS.index('head')] = 1
    s = Wj.sum(1, keepdims=True); s[s == 0] = 1; Wj /= s
    Vb = np.zeros_like(V)
    for ji, j in enumerate(JOINTS):
        w = Wj[:, ji]
        if not w.any(): continue
        rest = np.array(SKEL[CHILD[j]][1], float) if j in CHILD else np.array(TD[j], float)
        d = Wd[j] @ (rest / np.linalg.norm(rest))
        ratio = np.linalg.norm(SKEL[CHILD[j]][1]) / np.linalg.norm(P[CHILD[j]] - P[j]) if j in CHILD else 1.0
        if j in ('hips', 'spine', 'chest', 'neck'): ratio = 1.0 + (ratio - 1.0) * 0.5
        S = np.eye(3) + (ratio - 1) * np.outer(d, d)
        Vb += w[:, None] * (Bp[j] + (V - P[j]) @ S.T)
    # ---- triangles: the whole body, then the eyes
    tris = []
    for fv, ft in faces:
        for a in range(1, len(fv) - 1): tris.append(([fv[0], fv[a], fv[a + 1]], [ft[0], ft[a], ft[a + 1]], 'b'))
    for fv, ft in efaces:
        for a in range(1, len(fv) - 1): tris.append(([eref[fv[0]], eref[fv[a]], eref[fv[a + 1]]], [ft[0], ft[a], ft[a + 1]], 'e'))
    # normals
    TV = np.array([t[0] for t in tris])
    N = np.zeros_like(Vb); a, b, c = Vb[TV[:, 0]], Vb[TV[:, 1]], Vb[TV[:, 2]]; fn = np.cross(b - a, c - a)
    for i in range(3): np.add.at(N, TV[:, i], fn)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    # ---- regions, worked out on the head in the bind pose relative to the eyes
    eyeL = Vb[eref].mean(0)
    ec = Vb[eref]; left = ec[ec[:, 0] > 0].mean(0); right = ec[ec[:, 0] < 0].mean(0); eyeC = (left + right) / 2
    headJ = JOINTS.index('head'); dom = Wj.argmax(1)
    crown = Vb[dom == headJ, 1].max()
    reg = np.zeros(nv, np.uint8)
    # under the robe: a linen shirt and hose over everything but the head, neck, hands and feet
    bare = [JOINTS.index(n) for n in ('head', 'neck', 'handR', 'handL', 'footR', 'footL')]
    reg[~np.isin(dom, bare)] = CLOTH
    rel = Vb - eyeC
    head = (dom == headJ) | (Wj[:, headJ] > 0.4)
    # hair, beard and brows as a smooth amount (0..1) per vertex, so the hairline is soft, not stepped
    ss = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
    hw = np.clip(Wj[:, headJ] * 2.5, 0, 1)
    x_, y_, z_ = rel[:, 0], rel[:, 1], rel[:, 2]
    zf = z_ - (left[2] - eyeC[2])
    print('  head extent: crown', round(crown - eyeC[1], 3), 'z range', round(float(z_[head].min()), 3), round(float(z_[head].max()), 3), 'x', round(float(np.abs(x_[head]).max()), 3))
    front_h = 0.1 if cfg['hair'] == 'tonsure' else 0.078
    Hl = np.interp(-z_, [0.0, 0.03, 0.06, 0.1, 0.14, 0.19], [front_h, front_h - 0.012, 0.04, 0.035, -0.02, -0.1])   # the hairline: forehead, temples, over the ears, the nape
    hair = ss(Hl - 0.006, Hl + 0.01, y_) * hw
    ear = ss(0.062, 0.07, np.abs(x_)) * ss(0.045, 0.03, y_) * ss(-0.135, -0.12, z_) * ss(-0.05, -0.065, z_)
    hair *= 1 - ear
    if cfg['hair'] == 'tonsure':
        hair *= 1 - ss(crown - 0.05, crown - 0.038, Vb[:, 1])          # the shaven crown
        hair *= 1 - ss(0.07, 0.085, y_) * ss(-0.06, -0.03, z_)          # an old man's high bare brow
    elif cfg['hair'] == 'crop':
        lowf = ss(-0.032, -0.05, y_) * ss(-0.115, -0.09, z_)          # the jaw and chin, round to the ears
        mouth = np.exp(-((x_ / 0.024) ** 2 + ((y_ + 0.071) / 0.008) ** 2)) * ss(-0.02, 0.0, z_)
        tache = ss(0.032, 0.02, np.abs(x_)) * ss(-0.064, -0.058, y_) * ss(-0.05, -0.056, y_) * ss(-0.01, 0.01, z_)
        hair = np.maximum(hair, np.clip(lowf * (1 - mouth * 1.4), 0, 1) * hw * ss(-0.17, -0.13, y_))
        hair = np.maximum(hair, tache * hw)
    brow = np.zeros(nv)
    for e in (left, right):
        r2 = Vb - e
        brow = np.maximum(brow, np.exp(-((r2[:, 1] - 0.021 + 0.004 * (r2[:, 0] * np.sign(e[0]) / 0.025) ** 2) / 0.005) ** 2) * ss(0.032, 0.022, np.abs(r2[:, 0])) * ss(-0.01, 0.01, r2[:, 2]))
    hairAmt = np.clip(np.maximum(hair, brow * hw), 0, 1)
    hairAmt[eref] = 0
    for s_ in 'RL': reg[dom == JOINTS.index('foot' + s_)] = SHOE
    reg[eref] = EYE
    reg[(reg == SKIN) & False] = SKIN
    # ---- split by (vertex, uv, part)
    key = {}; ov, ouv, opart, idx = [], [], [], []
    for tv, tt, part in tris:
        for vi, ti in zip(tv, tt):
            kk = (vi, ti, part)
            if kk not in key: key[kk] = len(ov); ov.append(vi); ouv.append(euv[ti] if part == 'e' else UV[ti]); opart.append(part)
            idx.append(key[kk])
    ov = np.array(ov)
    pos = Vb[ov].astype(np.float32); nrm = N[ov]; uv = np.array(ouv, np.float32)
    W = Wj[ov]; order = np.argsort(-W, axis=1)[:, :4]; wsel = np.take_along_axis(W, order, 1); wsel /= np.maximum(wsel.sum(1, keepdims=True), 1e-9)
    wq = np.round(wsel * 255).astype(np.int32); wq[:, 0] += 255 - wq.sum(1)
    r_out = reg[ov]; h_out = np.round(hairAmt[ov] * 255).astype(np.uint8)
    b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
    nq = np.clip(np.round(nrm * 127), -127, 127).astype(np.int8)
    print(name, 'vertices', len(pos), 'tris', len(idx) // 3, 'regions', np.bincount(r_out, minlength=7))
    return {'bind': {j: [round(x, 6) for x in local_q[j]] for j in JOINTS}, 'count': int(len(pos)), 'tris': int(len(idx) // 3),
            'position': b64(pos), 'normal': b64(nq), 'uv': b64(uv), 'skinIndex': b64(order.astype(np.uint8)), 'skinWeight': b64(wq.astype(np.uint8)),
            'region': b64(r_out.astype(np.uint8)), 'hair': b64(h_out), 'index': b64(np.array(idx, np.uint32)), 'eyes': [[round(float(v), 4) for v in left], [round(float(v), 4) for v in right]]}


def main():
    out = {'about': 'Townsfolk from the MakeHuman base mesh and low-poly eyes (CC0, makehumancommunity.org). Built by tools/build_person.py.',
           'joints': B.JOINTS, 'regions': ['skin', 'hair', 'brow', 'shoe', 'eye', 'lip', 'cloth'], 'variants': {}}
    lady = '--lady' in sys.argv
    for name, cfg in (LADY if lady else VARIANTS).items(): out['variants'][name] = build(name, cfg)
    os.makedirs(OUTDIR, exist_ok=True)
    fn = os.path.join(OUTDIR, 'lady.json' if lady else 'people.json'); json.dump(out, open(fn, 'w'), separators=(',', ':'))
    shutil.copy(os.path.join(SRC, 'eyes', 'brown_eye.png'), os.path.join(OUTDIR, 'eye.png'))
    print('bytes', os.path.getsize(fn))


if __name__ == '__main__':
    main()
