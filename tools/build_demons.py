#!/usr/bin/env python3
"""Build the demons' bodies from the MakeHuman base mesh (CC0).

Fear lives in the almost-human, so every demon starts as a human body from
MakeHuman (http://www.makehumancommunity.org) and is twisted: starved to the bone
or bloated, limbs and fingers drawn out, ribs and spine pressed through the skin,
teeth lengthened into fangs. Each kind is then decimated with quadric edge
collapse so a horde stays cheap to draw.

Output: public/models/demons.json, one entry per kind with a skeleton (rest
offsets and bind rotations), skinned geometry and eye positions.

Usage:  python3 tools/build_demons.py /path/to/makehuman/data/files
(the folder needs base.obj, default.mhskel, default_weights.mhw and the targets
named below)
"""
import base64, heapq, json, math, os, sys
import numpy as np

SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/mh'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models', 'demons.json')

JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'jaw',
          'clavR', 'uArmR', 'fArmR', 'handR', 'clavL', 'uArmL', 'fArmL', 'handL',
          'thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL']
PARENT = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'jaw': 'head',
          'clavR': 'chest', 'uArmR': 'clavR', 'fArmR': 'uArmR', 'handR': 'fArmR',
          'clavL': 'chest', 'uArmL': 'clavL', 'fArmL': 'uArmL', 'handL': 'fArmL',
          'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR', 'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL'}
CHILD = {'hips': 'spine', 'spine': 'chest', 'chest': 'neck', 'neck': 'head',
         'clavR': 'uArmR', 'uArmR': 'fArmR', 'fArmR': 'handR', 'clavL': 'uArmL', 'uArmL': 'fArmL', 'fArmL': 'handL',
         'thighR': 'shinR', 'shinR': 'footR', 'thighL': 'shinL', 'shinL': 'footL'}
# rest direction of each bone in its own frame (the game animates from here)
REST = {'hips': [0, 1, 0], 'spine': [0, 1, 0], 'chest': [0, 1, 0], 'neck': [0, 1, 0], 'head': [0, 1, 0], 'jaw': [0, -0.5, 1],
        'clavR': [-1, 0, 0], 'clavL': [1, 0, 0], 'uArmR': [0, -1, 0], 'uArmL': [0, -1, 0], 'fArmR': [0, -1, 0], 'fArmL': [0, -1, 0],
        'handR': [0, -1, 0], 'handL': [0, -1, 0], 'thighR': [0, -1, 0], 'thighL': [0, -1, 0], 'shinR': [0, -1, 0], 'shinL': [0, -1, 0],
        'footR': [0, 0, 1], 'footL': [0, 0, 1]}
# offsets that are attachments (kept as measured) rather than along the parent bone
ATTACH = {'spine', 'chest', 'neck', 'clavR', 'clavL', 'thighR', 'thighL', 'jaw'}

# ---------------------------------------------------------------- the kinds
KINDS = {
    # tall, starved, arms to the knee, fingers like knives
    'shade':   dict(targets={'universal-male-old-minmuscle-minweight': 1.0}, height=2.08,
                    len={'uArm': 1.22, 'fArm': 1.3, 'hand': 2.0, 'neck': 1.45, 'thigh': 1.05, 'shin': 1.08, 'spine': 1.05, 'jaw': 1.35},
                    ribs=1.0, belly=-0.035, spineKnobs=1.0, fangs=1.7, gaunt=2.4, target=5200),
    # all fours, too-long limbs, will be posed belly-up in a spider-walk
    'crawler': dict(targets={'universal-male-old-minmuscle-minweight': 1.0}, height=1.78,
                    len={'uArm': 1.35, 'fArm': 1.4, 'hand': 2.2, 'neck': 1.6, 'thigh': 1.2, 'shin': 1.25, 'jaw': 1.45},
                    ribs=1.2, belly=-0.045, spineKnobs=1.3, fangs=1.9, gaunt=2.6, target=4600),
    # hunched hag under a robe; casts
    'wretch':  dict(targets={'universal-male-old-minmuscle-minweight': 0.8, 'universal-female-old-minmuscle-minweight': 0.9}, height=1.7,
                    len={'uArm': 1.15, 'fArm': 1.2, 'hand': 1.9, 'neck': 1.3},
                    ribs=0.7, belly=-0.02, spineKnobs=0.8, fangs=1.5, gaunt=2.2, target=4200),
    # bloated corpse that bursts
    'husk':    dict(targets={'universal-male-young-averagemuscle-maxweight': 1.0}, height=1.72,
                    len={'hand': 1.4, 'neck': 0.8},
                    bloat=1.0, fangs=1.4, gaunt=0.8, target=4200),
    # a giant, flayed and hunched
    'brute':   dict(targets={'universal-male-young-maxmuscle-minweight': 1.0}, height=3.0,
                    len={'uArm': 1.18, 'fArm': 1.32, 'hand': 1.6, 'neck': 0.8, 'thigh': 0.95, 'shin': 0.95},
                    ribs=0.4, spineKnobs=1.6, fangs=2.0, gaunt=1.2, girth=1.18, target=5600),
    # gaunt, winged (wings are added in game)
    'wraith':  dict(targets={'universal-male-old-minmuscle-minweight': 1.0}, height=2.2,
                    len={'uArm': 1.25, 'fArm': 1.3, 'hand': 2.2, 'neck': 1.5, 'thigh': 1.1, 'shin': 1.15, 'jaw': 1.4},
                    ribs=1.2, belly=-0.04, spineKnobs=1.2, fangs=1.8, gaunt=2.5, target=5000),
    # Him: impossibly tall and thin, arms past the knee, a long skull
    'devil':   dict(targets={'universal-male-old-minmuscle-minweight': 0.9, 'universal-male-young-maxmuscle-minweight': 0.3}, height=3.6,
                    len={'uArm': 1.45, 'fArm': 1.55, 'hand': 2.5, 'neck': 1.55, 'thigh': 1.25, 'shin': 1.3, 'spine': 1.15, 'jaw': 1.5},
                    ribs=1.3, belly=-0.05, spineKnobs=1.5, fangs=1.6, gaunt=3.0, target=6800),
    'herald':  dict(targets={'universal-male-young-maxmuscle-minweight': 0.7, 'universal-male-old-minmuscle-minweight': 0.5}, height=2.5,
                    len={'uArm': 1.15, 'fArm': 1.2, 'hand': 1.8, 'neck': 1.3, 'thigh': 1.05, 'shin': 1.1},
                    ribs=0.8, spineKnobs=1.3, fangs=1.8, gaunt=1.6, target=5400),
}


def side(s): return '.R' if s == 'R' else '.L'


def mapped(bone):
    m = {'root': 'hips', 'spine05': 'hips', 'pelvis.L': 'hips', 'pelvis.R': 'hips', 'spine04': 'spine', 'spine03': 'spine',
         'spine02': 'chest', 'spine01': 'chest', 'breast.L': 'chest', 'breast.R': 'chest',
         'neck01': 'neck', 'neck02': 'neck', 'neck03': 'neck', 'jaw': 'jaw', 'tongue00': 'jaw'}
    if bone in m: return m[bone]
    if bone.startswith('tongue'): return 'jaw'
    for s in 'RL':
        x = side(s)
        if not bone.endswith(x): continue
        b = bone[:-2]
        if b in ('clavicle', 'shoulder01'): return 'clav' + s
        if b.startswith('upperarm'): return 'uArm' + s
        if b.startswith('lowerarm'): return 'fArm' + s
        if b == 'wrist' or b.startswith('finger') or b.startswith('metacarpal'): return 'hand' + s
        if b.startswith('upperleg'): return 'thigh' + s
        if b.startswith('lowerleg'): return 'shin' + s
        if b == 'foot' or b.startswith('toe'): return 'foot' + s
    return 'head'


# ---------------------------------------------------------------- MakeHuman
_BASE = None
def load_base():
    global _BASE
    if _BASE: return _BASE
    V, faces = [], []
    cur = None
    keep = {'body', 'helper-upper-teeth', 'helper-lower-teeth'}
    groups = {}
    for line in open(os.path.join(SRC, 'base.obj')):
        if line.startswith('v '): V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('g '): cur = line.split()[1]
        elif line.startswith('f '):
            idx = [int(t.split('/')[0]) - 1 for t in line.split()[1:]]
            groups.setdefault(cur, []).append(idx)
            if cur in keep: faces.append((cur, idx))
    skel = json.load(open(os.path.join(SRC, 'default.mhskel')))
    weights = json.load(open(os.path.join(SRC, 'default_weights.mhw')))['weights']
    eyes = {s: sorted({i for f in groups['helper-%s-eye' % s] for i in f}) for s in 'lr'}
    _BASE = (np.array(V), faces, skel, weights, eyes)
    return _BASE


def apply_targets(V, targets):
    V = V.copy()
    for name, w in targets.items():
        for line in open(os.path.join(SRC, name + '.target')):
            p = line.split()
            if len(p) == 4 and p[0].isdigit(): V[int(p[0])] += w * np.array([float(p[1]), float(p[2]), float(p[3])])
    return V


def rot_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = float(np.dot(a, b))
    if c < -0.9999:
        ax = np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0]); ax /= np.linalg.norm(ax)
        return 2 * np.outer(ax, ax) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def axis_angle(axis, ang):
    axis = np.asarray(axis, float); axis = axis / np.linalg.norm(axis)
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * K @ K


def quat(R):
    t = np.trace(R)
    if t > 0:
        s = math.sqrt(t + 1) * 2; return [(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, 0.25 * s]
    if R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = math.sqrt(1 + R[0, 0] - R[1, 1] - R[2, 2]) * 2; return [0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s, (R[2, 1] - R[1, 2]) / s]
    if R[1, 1] > R[2, 2]:
        s = math.sqrt(1 + R[1, 1] - R[0, 0] - R[2, 2]) * 2; return [(R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s, (R[0, 2] - R[2, 0]) / s]
    s = math.sqrt(1 + R[2, 2] - R[0, 0] - R[1, 1]) * 2; return [(R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s, (R[1, 0] - R[0, 1]) / s]


# ---------------------------------------------------------------- quadric decimation
def decimate(V, F, target, W, protect):
    """Garland-Heckbert edge collapse. V (n,3), F (m,3) int, W (n,k) skin weights.
    protect (n,) multiplies the cost of moving a vertex (faces, hands)."""
    n = len(V); V = V.copy(); W = W.copy()
    Q = np.zeros((n, 4, 4))
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    nrm = np.cross(b - a, c - a); area = np.linalg.norm(nrm, axis=1) + 1e-12; nrm /= area[:, None]
    d = -np.einsum('ij,ij->i', nrm, a)
    P = np.concatenate([nrm, d[:, None]], 1)
    K = np.einsum('ij,ik->ijk', P, P) * area[:, None, None]
    for i in range(3): np.add.at(Q, F[:, i], K)
    # boundary edges: a perpendicular plane keeps open edges (eye sockets, mouth) in place
    from collections import defaultdict
    ecount = defaultdict(int); eface = {}
    for fi, f in enumerate(F):
        for i in range(3):
            e = tuple(sorted((f[i], f[(i + 1) % 3]))); ecount[e] += 1; eface[e] = fi
    for e, cnt in ecount.items():
        if cnt != 1: continue
        p0, p1 = V[e[0]], V[e[1]]; fn = nrm[eface[e]]
        en = np.cross(p1 - p0, fn); L = np.linalg.norm(en)
        if L < 1e-12: continue
        en /= L; pl = np.append(en, -en @ p0); Kb = np.outer(pl, pl) * 50 * np.linalg.norm(p1 - p0) ** 2
        Q[e[0]] += Kb; Q[e[1]] += Kb
    Q *= protect[:, None, None]
    faces = [list(f) for f in F]
    vf = [set() for _ in range(n)]
    for fi, f in enumerate(faces):
        for v in f: vf[v].add(fi)
    alive = np.ones(n, bool); falive = np.ones(len(faces), bool)
    ver = np.zeros(n, int)

    def cost(u, v):
        Qs = Q[u] + Q[v]
        A = Qs.copy(); A[3] = [0, 0, 0, 1]
        try:
            x = np.linalg.solve(A, [0, 0, 0, 1])
            if np.linalg.norm(x[:3] - (V[u] + V[v]) / 2) > np.linalg.norm(V[u] - V[v]) * 2: raise np.linalg.LinAlgError
        except np.linalg.LinAlgError:
            x = np.append((V[u] + V[v]) / 2, 1)
        return float(x @ Qs @ x), x[:3]

    heap = []
    for e in ecount:
        cst, _ = cost(*e); heapq.heappush(heap, (cst, e[0], e[1], 0, 0))
    count = n
    while count > target and heap:
        cst, u, v, vu, vv = heapq.heappop(heap)
        if not (alive[u] and alive[v]) or ver[u] != vu or ver[v] != vv: continue
        _, x = cost(u, v)
        # reject collapses that fold a face over
        bad = False
        for fi in vf[u] | vf[v]:
            if not falive[fi]: continue
            f = faces[fi]
            if u in f and v in f: continue
            pts = [V[q] for q in f]; new = [x if q in (u, v) else V[q] for q in f]
            n0 = np.cross(pts[1] - pts[0], pts[2] - pts[0]); n1 = np.cross(new[1] - new[0], new[2] - new[0])
            if n0 @ n1 <= 0.2 * np.linalg.norm(n0) * np.linalg.norm(n1): bad = True; break
        if bad:
            ver[u] += 1; ver[v] += 1
            continue
        V[u] = x; Q[u] += Q[v]; W[u] = (W[u] + W[v]) / 2; alive[v] = False; count -= 1
        for fi in list(vf[v]):
            if not falive[fi]: continue
            f = faces[fi]
            if u in f: falive[fi] = False; [vf[q].discard(fi) for q in f]; continue
            f[f.index(v)] = u; vf[u].add(fi)
        vf[v] = set()
        ver[u] += 1
        nb = {q for fi in vf[u] if falive[fi] for q in faces[fi] if q != u}
        for q in nb:
            c2, _ = cost(u, q); heapq.heappush(heap, (c2, u, q, ver[u], ver[q]) if u < q else (c2, q, u, ver[q], ver[u]))
    remap = -np.ones(n, int); keep = np.where(alive)[0]; remap[keep] = np.arange(len(keep))
    F2 = np.array([[remap[q] for q in faces[fi]] for fi in range(len(faces)) if falive[fi]])
    return V[keep], F2, W[keep], keep


# ---------------------------------------------------------------- build one kind
def build(kind, K):
    V0, faces, skel, mhw, eyes = load_base()
    V = apply_targets(V0, K['targets'])
    J = {k: V[v].mean(0) for k, v in skel['joints'].items()}
    bones = {nm: {'head': J[b['head']], 'tail': J[b['tail']]} for nm, b in skel['bones'].items()}
    used = sorted({i for _, f in faces for i in f})
    ymin = V[used, 1].min(); ymax = V[used, 1].max()
    k = K['height'] / (ymax - ymin) / max(0.6, np.mean(list(K['len'].values())) ** 0.25 if K['len'] else 1)
    V = (V - [0, ymin, 0]) * k
    for b in bones.values(): b['head'] = (b['head'] - [0, ymin, 0]) * k; b['tail'] = (b['tail'] - [0, ymin, 0]) * k
    H = lambda nm: bones[nm]['head']
    P = {}
    hipc = (H('upperleg01.L') + H('upperleg01.R')) / 2
    P['hips'] = np.array([0, hipc[1] + 0.06 * k * 10 / 1.07, hipc[2]])
    P['spine'] = H('spine03'); P['chest'] = H('spine01'); P['neck'] = H('neck01'); P['head'] = H('head'); P['jaw'] = H('jaw')
    for s in 'RL':
        x = side(s)
        P['clav' + s] = H('clavicle' + x); P['uArm' + s] = H('upperarm01' + x); P['fArm' + s] = H('lowerarm01' + x)
        P['hand' + s] = H('wrist' + x); P['thigh' + s] = H('upperleg01' + x); P['shin' + s] = H('lowerleg01' + x); P['foot' + s] = H('foot' + x)
    END = {'head': bones['head']['tail'], 'jaw': bones['jaw']['tail']}
    for s in 'RL':
        x = side(s); END['hand' + s] = H('finger3-3' + x) if 'finger3-3' + x in bones else H('finger3-1' + x); END['foot' + s] = H('toe3-1' + x)
    lenmul = lambda j: K['len'].get(j.rstrip('RL') if j not in ('chest',) else j, 1.0)

    # rest skeleton: offsets in the parent's frame; limbs hang straight, attachments as measured
    off = {}
    for j in JOINTS:
        p = PARENT[j]
        if p is None: off[j] = P[j].copy(); continue
        L = np.linalg.norm(P[j] - P[p]) * lenmul(p)
        if j in ATTACH:
            v = (P[j] - P[p]) * (lenmul(p) if j in ('chest', 'neck', 'spine') else 1)
            off[j] = v
        else:
            off[j] = np.array(REST[p], float) / np.linalg.norm(REST[p]) * L
    # bind rotations: each bone points along MakeHuman's
    Wd, Bp, local_q = {}, {}, {}
    FWD = np.array([0, 0, 1.0])
    for j in JOINTS:
        p = PARENT[j]
        Wp = np.eye(3) if p is None else Wd[p]
        Bp[j] = off[j] if p is None else Bp[p] + Wp @ off[j]
        rest = np.array(REST[j], float); rest /= np.linalg.norm(rest)
        tgt = (P[CHILD[j]] if j in CHILD else END[j]) - P[j]
        R = rot_between(rest, tgt); d = R @ rest
        if j.startswith('uArm') or j.startswith('thigh'):
            nxt = CHILD[CHILD[j]]; cd = P[nxt] - P[CHILD[j]]; bend = cd - d * (cd @ d)
            want = 1 if j.startswith('uArm') else -1
            ref = want * bend / np.linalg.norm(bend) if np.linalg.norm(bend) > 0.02 * np.linalg.norm(cd) else (FWD - d * (FWD @ d)) / np.linalg.norm(FWD - d * (FWD @ d))
            z = R @ np.array([0, 0, 1.0])
        else:
            base = np.array([0, 0, 1.0]) if abs(rest[2]) < 0.9 else np.array([0, 1.0, 0])
            z = R @ base; ref = base - d * (base @ d); ref /= np.linalg.norm(ref)
        zp = z - d * (z @ d); zp /= np.linalg.norm(zp)
        R = axis_angle(d, math.atan2(np.cross(zp, ref) @ d, zp @ ref)) @ R
        Wd[j] = R; local_q[j] = quat(Wp.T @ R)

    # skin weights
    n = len(V); Wj = np.zeros((n, len(JOINTS)))
    for bone, wl in mhw.items():
        ji = JOINTS.index(mapped(bone))
        for vi, w in wl: Wj[int(vi), ji] += w
    s_ = Wj.sum(1, keepdims=True); s_[s_ == 0] = 1; Wj /= s_
    # teeth: upper on the head, lower on the jaw
    tu = sorted({i for g, f in faces if g == 'helper-upper-teeth' for i in f}); tl = sorted({i for g, f in faces if g == 'helper-lower-teeth' for i in f})
    Wj[tu] = 0; Wj[tu, JOINTS.index('head')] = 1; Wj[tl] = 0; Wj[tl, JOINTS.index('jaw')] = 1

    # ---- deformations in MakeHuman space, before the refit
    JI = {j: i for i, j in enumerate(JOINTS)}
    # normals
    tri = []
    for g, f in faces:
        for a in range(1, len(f) - 1): tri.append([f[0], f[a], f[a + 1]])
    tri = np.array(tri)
    def normals(X):
        N = np.zeros_like(X); a, b, c = X[tri[:, 0]], X[tri[:, 1]], X[tri[:, 2]]; fn = np.cross(b - a, c - a)
        for i in range(3): np.add.at(N, tri[:, i], fn)
        return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    N = normals(V)
    chestW = Wj[:, JI['chest']] + Wj[:, JI['spine']] * 0.6
    torsoC = (P['chest'] + P['spine']) / 2
    if K.get('ribs'):
        # ribs pressed through the skin: bands around the rib cage, strongest on the flanks
        y = V[:, 1]; rel = V - torsoC
        lat = np.clip(np.abs(rel[:, 0]) / 0.12, 0, 1)
        band = np.sin((y - P['spine'][1]) / (0.026 * k * 10 / 1.07) * math.pi)
        inrib = (y > P['spine'][1] + 0.02) & (y < P['chest'][1] + 0.05)
        amt = K['ribs'] * 0.006 * band * lat * chestW * inrib
        V += N * amt[:, None]
        # hollow under the ribs, sternum ridge
        V -= N * (K['ribs'] * 0.008 * chestW * inrib * np.exp(-((rel[:, 0] / 0.06) ** 2)) * (rel[:, 2] > 0) * (1 - np.abs(band)))[:, None]
    if K.get('belly'):
        bw = Wj[:, JI['spine']] + Wj[:, JI['hips']] * 0.5
        front = np.clip((V[:, 2] - P['spine'][2]) / 0.08, 0, 1)
        V += N * (K['belly'] * bw * front)[:, None]
    if K.get('spineKnobs'):
        back = np.clip(-(V[:, 2] - torsoC[2] + 0.02) / 0.06, 0, 1) * np.exp(-((V[:, 0] / 0.02) ** 2))
        knob = np.maximum(0, np.sin((V[:, 1] - P['hips'][1]) / 0.035 * math.pi)) ** 2
        tors = Wj[:, JI['chest']] + Wj[:, JI['spine']] + Wj[:, JI['hips']] * 0.5 + Wj[:, JI['neck']]
        V += N * (K['spineKnobs'] * 0.011 * back * knob * tors)[:, None]
    if K.get('gaunt'):
        # sunken cheeks and temples, deep eye sockets
        hw = Wj[:, JI['head']]
        for s in 'lr':
            ec = V[eyes[s]].mean(0)
            dd = np.linalg.norm(V - ec, axis=1)
            V -= N * (K['gaunt'] * 0.0055 * hw * np.exp(-((dd / 0.03) ** 2)))[:, None]
        ey = np.mean([V[eyes[s]].mean(0) for s in 'lr'], axis=0)
        # hollow cheeks below the cheekbones, a heavy brow above the sockets
        cheek = np.exp(-(((V[:, 1] - (ey[1] - 0.045)) / 0.022) ** 2)) * np.clip((np.abs(V[:, 0]) - 0.02) / 0.02, 0, 1) * (V[:, 2] > ey[2] - 0.06)
        V -= N * (K['gaunt'] * 0.006 * hw * cheek)[:, None]
        brow = np.exp(-(((V[:, 1] - (ey[1] + 0.022)) / 0.01) ** 2)) * np.exp(-((V[:, 0] / 0.05) ** 2)) * (V[:, 2] > ey[2] - 0.01)
        V += N * (K['gaunt'] * 0.0035 * hw * brow)[:, None]
        bone = np.exp(-(((V[:, 1] - (ey[1] - 0.02)) / 0.012) ** 2)) * np.exp(-(((np.abs(V[:, 0]) - 0.045) / 0.015) ** 2))
        V += N * (K['gaunt'] * 0.003 * hw * bone)[:, None]
    if K.get('bloat'):
        # swollen belly and chest, skin tight
        c = P['spine'] + np.array([0, 0.02, 0.06])
        dd = np.linalg.norm((V - c) * [1, 0.8, 1], axis=1)
        tw = Wj[:, JI['spine']] + Wj[:, JI['hips']] * 0.6 + Wj[:, JI['chest']] * 0.5
        V += N * (K['bloat'] * 0.14 * tw * np.exp(-((dd / 0.22) ** 2)))[:, None]
    if K.get('girth'):
        V[:, [0, 2]] *= 1.0  # girth is applied per joint below
    if K.get('fangs'):
        for grp, up in ((tu, 1), (tl, -1)):
            T = V[grp]; gum = T[:, 1].max() if up > 0 else T[:, 1].min()
            # stretch each tooth away from the gum, narrowing to a point
            t = np.abs(T[:, 1] - gum) / max(1e-6, np.ptp(T[:, 1]))
            T[:, 1] = gum - up * np.abs(T[:, 1] - gum) * K['fangs']
            V[grp] = T

    # ---- refit to the demon skeleton: per-joint translation + stretch along the bone (+ girth)
    Vb = np.zeros_like(V)
    for j in JOINTS:
        w = Wj[:, JI[j]]
        if not w.any(): continue
        rest = np.array(REST[j], float); rest /= np.linalg.norm(rest)
        d = Wd[j] @ rest
        ratio = lenmul(j)
        S = np.eye(3) + (ratio - 1) * np.outer(d, d)
        if K.get('girth') and j not in ('head', 'jaw', 'handR', 'handL', 'footR', 'footL'):
            S = S @ (np.eye(3) * K['girth'] + (1 - K['girth']) * np.outer(d, d))
        Vb += w[:, None] * (Bp[j] + (V - P[j]) @ S.T)
    # eyes: centre of each MakeHuman eyeball, in the head's bind frame
    eyeW = []
    for s in 'rl':
        e = Vb[eyes[s]].mean(0); r = np.linalg.norm(Vb[eyes[s]] - e, axis=1).mean()
        eyeW.append((Wd['head'].T @ (e - Bp['head'])).tolist() + [float(r)])

    # ---- decimate (faces and hands keep more detail)
    used = sorted({i for t in tri for i in t})
    remap = -np.ones(len(Vb), int); remap[used] = np.arange(len(used))
    Vu = Vb[used]; Fu = remap[tri]; Wu = Wj[used]
    protect = 1 + 6 * Wu[:, JI['head']] + 6 * Wu[:, JI['jaw']] + 3 * (Wu[:, JI['handR']] + Wu[:, JI['handL']])
    Vd, Fd, Wd_, keep = decimate(Vu, Fu, K['target'], Wu, protect)
    # normals on the final mesh
    Nd = np.zeros_like(Vd); a, b, c = Vd[Fd[:, 0]], Vd[Fd[:, 1]], Vd[Fd[:, 2]]; fn = np.cross(b - a, c - a)
    for i in range(3): np.add.at(Nd, Fd[:, i], fn)
    Nd /= np.maximum(np.linalg.norm(Nd, axis=1, keepdims=True), 1e-9)
    order = np.argsort(-Wd_, axis=1)[:, :4]
    ws = np.take_along_axis(Wd_, order, 1); ws /= np.maximum(ws.sum(1, keepdims=True), 1e-9)
    wq = np.round(ws * 255).astype(np.int32); wq[:, 0] += 255 - wq.sum(1)
    # a per-vertex "region" for the skin shader: 1 = teeth
    region = np.zeros(len(Vd), np.uint8)
    tset = set(remap[tu].tolist() + remap[tl].tolist())
    kmap = {old: new for new, old in enumerate(keep)}
    for old in tset:
        if old in kmap: region[kmap[old]] = 1
    b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
    return {
        'joints': [{'name': j, 'parent': PARENT[j], 'pos': [round(float(x), 5) for x in off[j]]} for j in JOINTS],
        'bind': {j: [round(x, 6) for x in local_q[j]] for j in JOINTS},
        'eyes': [[round(x, 5) for x in e] for e in eyeW],
        'height': K['height'],
        'count': int(len(Vd)), 'tris': int(len(Fd)),
        'pscale': 8000, 'position': b64(np.clip(np.round(Vd * 8000), -32767, 32767).astype(np.int16)), 'normal': b64(np.clip(np.round(Nd * 127), -127, 127).astype(np.int8)),
        'skinIndex': b64(order.astype(np.uint8)), 'skinWeight': b64(wq.astype(np.uint8)), 'region': b64(region),
        'index': b64(Fd.astype(np.uint16)),
    }


def main():
    out = {'about': 'Demon bodies twisted from the MakeHuman base mesh (CC0, makehumancommunity.org). Built by tools/build_demons.py.', 'joints': JOINTS, 'kinds': {}}
    only = sys.argv[2:] if len(sys.argv) > 2 else list(KINDS)
    for kind in only:
        d = build(kind, KINDS[kind]); out['kinds'][kind] = d
        print(f'{kind:8s} vertices {d["count"]:6d} triangles {d["tris"]:6d}')
    if len(only) < len(KINDS) and os.path.exists(OUT):
        old = json.load(open(OUT)); old['kinds'].update(out['kinds']); out = old
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('bytes', os.path.getsize(OUT))


if __name__ == '__main__':
    main()
