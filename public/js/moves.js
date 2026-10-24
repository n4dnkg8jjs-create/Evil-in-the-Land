// Move sets. Each key gives:
//   t     time (s, at speed 1)
//   body  joint angles in degrees (overrides the weapon's stance)
//   hip   hip offset [x,y,z] (m) — crouches, lunges
//   w     the weapon in root space: p = right-hand grip, d = blade/haft direction,
//         u = the direction the striking edge faces (true edge, axe blade, hammer face)
//   l     free left hand {p, d, u} (buckler, relic) — otherwise it grips the haft
//   pr/pl elbow pole directions
// Root space: +Z forward, +Y up, +X = the knight's LEFT. Right shoulder ≈ (-0.19, 1.46, 0).
// Hits: t0..t1 window, dmg, stagger (0..1.5), cleave (targets per swing), kind,
//       aoe {t, r, dmg} for ground slams, src 'left' for buckler strikes.
// moves: root motion {t0, t1, v} in m/s along facing. spin: {t0, t1, a} body yaw (rad).

const STEP_LUNGE_R = { thighR: [-55, 0, -4], shinR: [62, 0, 0], footR: [-8, 0, 0], thighL: [32, 0, 4], shinL: [24, 0, 0], footL: [26, 0, 0] };
const STEP_LUNGE_L = { thighL: [-55, 0, 4], shinL: [62, 0, 0], footL: [-8, 0, 0], thighR: [32, 0, -4], shinR: [24, 0, 0], footR: [26, 0, 0] };
const CROUCH = { thighR: [-38, 0, -6], shinR: [66, 0, 0], footR: [-28, 0, 0], thighL: [-30, 0, 6], shinL: [58, 0, 0], footL: [-28, 0, 0] };
const PLANT = { thighR: [6, 0, -8], shinR: [16, 0, 0], footR: [-14, 0, 0], thighL: [-16, 0, 8], shinL: [18, 0, 0], footL: [-2, 0, 0] };
const NEUTRAL_LEGS = { thighR: [4, 0, -4], shinR: [10, 0, 0], footR: [-8, 0, 0], thighL: [-6, 0, 4], shinL: [10, 0, 0], footL: [-4, 0, 0] };
const merge = (...o) => Object.assign({}, ...o);

const P_R = [-0.7, -0.6, -0.4], P_L = [0.7, -0.6, -0.4], P_RH = [-0.9, 0.15, -0.5], P_LH = [0.9, 0.15, -0.5];

export const MOVESETS = {
  // ================================================================ LONGSWORD
  longsword: {
    stance: { body: { spine: [6, -8, 0], chest: [4, -10, 0], neck: [-3, 9, 0], head: [-2, 8, 0] }, w: { p: [-0.06, 1.06, 0.3], d: [0.04, 0.62, 0.78], u: [0, -0.78, 0.62] }, pr: P_R, pl: P_L },
    carry: { body: { spine: [12, 0, 0], chest: [4, -6, 0] }, w: { p: [-0.18, 1.2, 0.14], d: [0.05, 0.95, -0.28], u: [0, 0.28, 0.95] } },
    block: { body: { spine: [2, -6, 0], chest: [-4, -6, 0] }, w: { p: [-0.04, 1.4, 0.32], d: [0.97, 0.2, 0.12], u: [0, 1, 0] }, pr: P_RH, pl: P_LH },
    light: [
      { name: 'Oberhau', dur: 0.82, chain: 0.4, cancel: 0.52, stamina: 12, sfx: [{ t: 0.19, k: 'swing' }],
        keys: [
          { t: 0.16, body: { chest: [-2, -28, 0], spine: [0, -10, 0], head: [-6, 22, 0] }, w: { p: [-0.24, 1.52, 0.02], d: [-0.3, 0.85, -0.43], u: [0.2, 0.4, 0.9] }, pr: P_RH },
          { t: 0.27, body: { chest: [10, 8, 0], spine: [10, 4, 0], head: [-8, -6, 0] }, w: { p: [-0.06, 1.32, 0.46], d: [0.32, 0.42, 0.85], u: [0.55, -0.8, 0.1] } },
          { t: 0.36, body: { chest: [16, 28, 0], spine: [14, 10, 0], head: [-10, -20, 0] }, w: { p: [0.18, 0.94, 0.44], d: [0.6, -0.45, 0.62], u: [0.55, -0.55, -0.5] } },
          { t: 0.56, body: { chest: [8, 18, 0], spine: [8, 6, 0] }, w: { p: [0.12, 0.98, 0.36], d: [0.35, -0.05, 0.93], u: [0.2, -0.9, 0.2] } },
        ],
        hits: [{ t0: 0.22, t1: 0.37, dmg: 32, stagger: 0.45, cleave: 3 }], moves: [{ t0: 0.12, t1: 0.32, v: 2.6 }] },
      { name: 'Zwerchhau', dur: 0.8, chain: 0.4, cancel: 0.5, stamina: 12, sfx: [{ t: 0.17, k: 'swing' }],
        keys: [
          { t: 0.15, body: { chest: [0, 32, 0], spine: [0, 12, 0], head: [0, -20, 0] }, w: { p: [0.26, 1.42, 0.12], d: [0.62, 0.3, -0.72], u: [-0.3, 0, 1] }, pl: P_LH },
          { t: 0.27, body: { chest: [6, 0, 0], spine: [4, 0, 0] }, w: { p: [0.0, 1.42, 0.5], d: [0.0, 0.08, 1], u: [-1, 0, 0] } },
          { t: 0.37, body: { chest: [8, -32, 0], spine: [4, -12, 0], head: [0, 22, 0] }, w: { p: [-0.24, 1.32, 0.36], d: [-0.86, 0.02, 0.5], u: [-0.45, 0, -0.9] } },
          { t: 0.56, body: { chest: [4, -16, 0] }, w: { p: [-0.14, 1.12, 0.3], d: [-0.35, 0.45, 0.82], u: [-0.2, -0.8, 0.5] } },
        ],
        hits: [{ t0: 0.2, t1: 0.38, dmg: 28, stagger: 0.35, cleave: 4 }], moves: [{ t0: 0.1, t1: 0.3, v: 2.0 }] },
      { name: 'Stich', dur: 0.95, chain: 0.5, cancel: 0.62, stamina: 13, fullBody: true, sfx: [{ t: 0.26, k: 'thrust' }],
        keys: [
          { t: 0.2, body: merge({ chest: [-4, -22, 0], spine: [-2, -8, 0], head: [0, 18, 0] }, CROUCH), hip: [0, -0.06, -0.06], w: { p: [-0.2, 1.46, 0.14], d: [0.16, -0.12, 0.98], u: [0, -1, 0] }, pr: P_RH },
          { t: 0.32, body: merge({ chest: [16, -4, 0], spine: [14, 0, 0], head: [-14, 4, 0] }, STEP_LUNGE_R), hip: [0, -0.16, 0.12], w: { p: [-0.02, 1.32, 0.8], d: [0.02, -0.08, 1], u: [0, -1, 0] } },
          { t: 0.44, body: merge({ chest: [18, -4, 0], spine: [15, 0, 0], head: [-14, 4, 0] }, STEP_LUNGE_R), hip: [0, -0.17, 0.13], w: { p: [0.0, 1.3, 0.84], d: [0.02, -0.1, 1], u: [0, -1, 0] } },
          { t: 0.72, body: merge({ chest: [6, -8, 0] }, NEUTRAL_LEGS), hip: [0, -0.03, 0], w: { p: [-0.08, 1.12, 0.4], d: [0.04, 0.4, 0.92], u: [0, -0.9, 0.4] } },
        ],
        hits: [{ t0: 0.26, t1: 0.42, dmg: 40, stagger: 0.6, cleave: 2, kind: 'pierce' }], moves: [{ t0: 0.2, t1: 0.38, v: 3.8 }] },
    ],
    heavy: { name: 'Zornhau', dur: 1.4, chain: 1.1, cancel: 1.0, stamina: 28, fullBody: true, sfx: [{ t: 0.0, k: 'grunt' }, { t: 0.46, k: 'heavy' }],
      keys: [
        { t: 0.38, body: merge({ spine: [-12, -6, 0], chest: [-14, -8, 0], head: [12, 6, 0] }, CROUCH), hip: [0, -0.1, -0.04], w: { p: [-0.06, 1.72, -0.08], d: [0, 0.42, -0.9], u: [0, 1, 0.2] }, pr: P_RH, pl: P_LH },
        { t: 0.52, body: merge({ spine: [6, 0, 0], chest: [10, 0, 0] }, { thighR: [-34, 0, -4], shinR: [10, 0, 0], thighL: [20, 0, 4], shinL: [14, 0, 0] }), hip: [0, 0.04, 0.1], w: { p: [0, 1.5, 0.5], d: [0, 0.62, 0.78], u: [0, -0.78, 0.62] } },
        { t: 0.62, body: merge({ spine: [24, 0, 0], chest: [22, 0, 0], head: [-14, 0, 0] }, STEP_LUNGE_R), hip: [0, -0.2, 0.16], w: { p: [0, 0.96, 0.64], d: [0, -0.56, 0.83], u: [0, -0.83, -0.56] } },
        { t: 0.74, body: merge({ spine: [26, 0, 0], chest: [22, 0, 0], head: [-14, 0, 0] }, STEP_LUNGE_R), hip: [0, -0.22, 0.16], w: { p: [0, 0.82, 0.56], d: [0, -0.86, 0.5], u: [0, -0.5, -0.86] } },
        { t: 1.05, body: merge({ spine: [8, -4, 0], chest: [6, -6, 0] }, NEUTRAL_LEGS), hip: [0, -0.04, 0], w: { p: [-0.06, 1.0, 0.36], d: [0.04, 0.4, 0.92], u: [0, -0.9, 0.4] } },
      ],
      hits: [{ t0: 0.52, t1: 0.7, dmg: 85, stagger: 1.25, cleave: 4, aoe: { t: 0.64, r: 2.2, dmg: 28 } }], moves: [{ t0: 0.38, t1: 0.6, v: 5.0 }] },
  },

  // ================================================================ ZWEIHÄNDER
  zweihander: {
    stance: { body: { spine: [4, -10, 0], chest: [2, -14, 0], head: [0, 12, 0] }, w: { p: [-0.08, 1.1, 0.26], d: [-0.2, 0.88, 0.42], u: [0, -0.4, 0.9] }, pr: P_R, pl: P_L },
    carry: { body: { spine: [12, 0, 0] }, w: { p: [-0.2, 1.28, 0.05], d: [-0.15, 0.8, -0.58], u: [0, 0.6, 0.8] } },
    block: { body: { chest: [-4, -6, 0] }, w: { p: [-0.04, 1.4, 0.34], d: [0.97, 0.2, 0.08], u: [0, 1, 0] }, pr: P_RH, pl: P_LH },
    light: [
      { name: 'Mittelhau', dur: 1.15, chain: 0.62, cancel: 0.75, stamina: 16, sfx: [{ t: 0.36, k: 'heavySwing' }],
        keys: [
          { t: 0.3, body: { chest: [0, -40, 0], spine: [0, -15, 0], head: [0, 30, 0] }, hip: [0, -0.05, 0], w: { p: [-0.34, 1.24, -0.02], d: [-0.82, 0.28, -0.5], u: [0.2, 0, 1] }, pr: P_RH },
          { t: 0.46, body: { chest: [6, 0, 0], spine: [6, 0, 0] }, hip: [0, -0.08, 0.04], w: { p: [0.0, 1.16, 0.52], d: [0, 0.04, 1], u: [1, 0, 0] } },
          { t: 0.58, body: { chest: [8, 42, 0], spine: [4, 16, 0], head: [0, -30, 0] }, hip: [0, -0.06, 0.04], w: { p: [0.3, 1.1, 0.26], d: [0.9, 0, -0.35], u: [0.35, 0, -0.9] }, pl: P_LH },
          { t: 0.9, body: { chest: [4, 20, 0] }, w: { p: [0.16, 1.05, 0.3], d: [0.45, 0.45, 0.75], u: [0, -0.8, 0.5] } },
        ],
        hits: [{ t0: 0.4, t1: 0.6, dmg: 46, stagger: 0.6, cleave: 6 }], moves: [{ t0: 0.25, t1: 0.5, v: 2.2 }] },
      { name: 'Unterhau', dur: 1.12, chain: 0.6, cancel: 0.72, stamina: 16, sfx: [{ t: 0.34, k: 'heavySwing' }],
        keys: [
          { t: 0.28, body: { chest: [0, 40, 0], spine: [0, 14, 0], head: [0, -26, 0] }, w: { p: [0.3, 1.2, 0.04], d: [0.85, 0.22, -0.48], u: [-0.2, 0, 1] }, pl: P_LH },
          { t: 0.44, body: { chest: [8, 0, 0], spine: [8, 0, 0] }, hip: [0, -0.08, 0.04], w: { p: [0, 1.02, 0.52], d: [0, -0.06, 1], u: [-1, 0, 0] } },
          { t: 0.56, body: { chest: [8, -42, 0], spine: [4, -16, 0], head: [0, 28, 0] }, w: { p: [-0.3, 1.02, 0.26], d: [-0.9, -0.1, -0.35], u: [-0.35, 0, -0.9] }, pr: P_RH },
          { t: 0.9, body: { chest: [4, -20, 0] }, w: { p: [-0.14, 1.04, 0.28], d: [-0.3, 0.6, 0.7], u: [0, -0.8, 0.6] } },
        ],
        hits: [{ t0: 0.38, t1: 0.58, dmg: 44, stagger: 0.6, cleave: 6 }], moves: [{ t0: 0.24, t1: 0.48, v: 2.2 }] },
      { name: 'Scheitelhau', dur: 1.25, chain: 0.72, cancel: 0.85, stamina: 18, fullBody: true, sfx: [{ t: 0.44, k: 'heavySwing' }],
        keys: [
          { t: 0.32, body: merge({ spine: [-14, -4, 0], chest: [-10, -6, 0], head: [12, 0, 0] }, NEUTRAL_LEGS), w: { p: [-0.08, 1.72, -0.12], d: [-0.1, 0.3, -0.95], u: [0, 1, 0] }, pr: P_RH, pl: P_LH },
          { t: 0.5, body: merge({ spine: [8, 0, 0], chest: [8, 0, 0] }, STEP_LUNGE_R), hip: [0, -0.12, 0.1], w: { p: [0, 1.5, 0.52], d: [0, 0.6, 0.8], u: [0, -0.8, 0.6] } },
          { t: 0.62, body: merge({ spine: [24, 0, 0], chest: [20, 0, 0], head: [-12, 0, 0] }, STEP_LUNGE_R), hip: [0, -0.2, 0.14], w: { p: [0, 0.95, 0.62], d: [0, -0.6, 0.8], u: [0, -0.8, -0.6] } },
          { t: 0.98, body: merge({ spine: [8, -6, 0] }, NEUTRAL_LEGS), w: { p: [-0.06, 1.02, 0.34], d: [-0.1, 0.6, 0.8], u: [0, -0.8, 0.6] } },
        ],
        hits: [{ t0: 0.5, t1: 0.68, dmg: 62, stagger: 1.0, cleave: 3 }], moves: [{ t0: 0.32, t1: 0.56, v: 3.0 }] },
    ],
    heavy: { name: 'Whirlwind', dur: 1.6, chain: 1.35, cancel: 1.25, stamina: 34, fullBody: true, sfx: [{ t: 0.3, k: 'grunt' }, { t: 0.4, k: 'heavySwing' }, { t: 0.72, k: 'heavySwing' }],
      keys: [
        { t: 0.3, body: merge({ chest: [6, 40, 0], spine: [6, 16, 0] }, CROUCH), hip: [0, -0.12, 0], w: { p: [0.3, 1.2, 0.0], d: [0.9, 0.1, -0.4], u: [-0.3, 0, 1] }, pl: P_LH },
        { t: 0.42, body: merge({ chest: [8, 10, 0], spine: [8, 4, 0] }, PLANT), hip: [0, -0.1, 0], w: { p: [0.12, 1.15, 0.5], d: [0.75, 0.05, 0.65], u: [-0.65, 0, 0.75] } },
        { t: 1.05, body: merge({ chest: [8, 10, 0], spine: [8, 4, 0] }, PLANT), hip: [0, -0.1, 0], w: { p: [0.12, 1.15, 0.5], d: [0.75, 0.05, 0.65], u: [-0.65, 0, 0.75] } },
        { t: 1.3, body: merge({ chest: [4, -10, 0] }, NEUTRAL_LEGS), w: { p: [-0.06, 1.08, 0.3], d: [-0.1, 0.8, 0.55], u: [0, -0.5, 0.85] } },
      ],
      spin: [{ t0: 0.36, t1: 1.08, a: -Math.PI * 2 }],
      hits: [{ t0: 0.38, t1: 1.06, dmg: 55, stagger: 1.0, cleave: 99, aoe: { t: 0.7, r: 2.6, dmg: 0 }, sweep: true }], moves: [{ t0: 0.35, t1: 1.0, v: 1.6 }] },
  },

  // ================================================================ MACE & BUCKLER
  mace: {
    stance: { body: { spine: [5, -10, 0], chest: [2, -12, 0], head: [-2, 10, 0] }, w: { p: [-0.24, 1.14, 0.22], d: [-0.12, 0.92, 0.36], u: [0, -0.36, 0.92] }, l: { p: [0.1, 1.18, 0.4], d: [0, 1, 0], u: [0, 0, 1] }, pr: P_R, pl: [0.8, -0.6, -0.2] },
    carry: { body: { spine: [10, 0, 0] }, w: { p: [-0.28, 1.0, 0.1], d: [0, 0.6, 0.8], u: [0, -0.8, 0.6] }, l: { p: [0.24, 1.04, 0.18], d: [0, 1, 0.3], u: [0.3, 0, 1] } },
    block: { body: { chest: [-2, -4, 0] }, w: { p: [-0.26, 1.22, 0.14], d: [-0.1, 0.9, 0.4], u: [0, -0.4, 0.9] }, l: { p: [0.02, 1.38, 0.46], d: [0, 1, 0], u: [0, 0.2, 1] }, pl: [0.9, -0.3, -0.2] },
    light: [
      { name: 'Overhand', dur: 0.72, chain: 0.34, cancel: 0.44, stamina: 9, sfx: [{ t: 0.16, k: 'swing' }],
        keys: [
          { t: 0.14, body: { chest: [-4, -24, 0], spine: [0, -8, 0], head: [-4, 18, 0] }, w: { p: [-0.3, 1.56, -0.04], d: [-0.25, 0.45, -0.85], u: [0, 1, 0.4] }, l: { p: [0.15, 1.12, 0.38], d: [0, 1, 0], u: [0, 0, 1] }, pr: P_RH },
          { t: 0.23, body: { chest: [10, 6, 0], spine: [8, 2, 0] }, w: { p: [-0.06, 1.32, 0.5], d: [0.1, 0.52, 0.85], u: [0, -0.85, 0.52] } },
          { t: 0.31, body: { chest: [16, 22, 0], spine: [12, 8, 0], head: [-8, -14, 0] }, w: { p: [0.12, 0.96, 0.42], d: [0.3, -0.55, 0.75], u: [0.2, -0.75, -0.6] } },
          { t: 0.5, body: { chest: [6, 4, 0] }, w: { p: [-0.1, 1.05, 0.32], d: [0, 0.4, 0.92], u: [0, -0.9, 0.4] } },
        ],
        hits: [{ t0: 0.19, t1: 0.32, dmg: 30, stagger: 0.7, cleave: 2, kind: 'blunt' }], moves: [{ t0: 0.1, t1: 0.28, v: 2.2 }] },
      { name: 'Backhand', dur: 0.74, chain: 0.36, cancel: 0.46, stamina: 9, sfx: [{ t: 0.16, k: 'swing' }],
        keys: [
          { t: 0.14, body: { chest: [0, 26, 0], spine: [0, 10, 0] }, w: { p: [0.16, 1.36, 0.18], d: [0.72, 0.38, -0.58], u: [-0.3, 0, 1] }, l: { p: [0.26, 1.0, 0.1], d: [0, 1, 0], u: [0.4, 0, 0.9] } },
          { t: 0.24, body: { chest: [6, 0, 0] }, w: { p: [-0.12, 1.3, 0.55], d: [-0.5, 0.22, 0.84], u: [-0.86, 0, -0.5] } },
          { t: 0.32, body: { chest: [8, -30, 0], spine: [4, -10, 0] }, w: { p: [-0.4, 1.22, 0.25], d: [-0.95, 0.05, -0.25], u: [0.2, 0, -1] }, pr: P_RH },
          { t: 0.52, body: { chest: [4, -14, 0] }, w: { p: [-0.26, 1.12, 0.26], d: [-0.2, 0.8, 0.5], u: [0, -0.5, 0.86] } },
        ],
        hits: [{ t0: 0.19, t1: 0.33, dmg: 28, stagger: 0.6, cleave: 2, kind: 'blunt' }], moves: [{ t0: 0.1, t1: 0.28, v: 2.0 }] },
      { name: 'Buckler & Smash', dur: 1.0, chain: 0.6, cancel: 0.7, stamina: 14, fullBody: true, sfx: [{ t: 0.06, k: 'swing' }, { t: 0.4, k: 'heavySwing' }],
        keys: [
          { t: 0.12, body: merge({ chest: [6, 20, 0], spine: [4, 8, 0] }, STEP_LUNGE_L), hip: [0, -0.08, 0.08], w: { p: [-0.32, 1.3, 0.0], d: [-0.2, 0.8, -0.5], u: [0, 0.5, 0.8] }, l: { p: [0.04, 1.3, 0.72], d: [0, 1, 0], u: [0, 0, 1] }, pl: [0.6, -0.8, 0] },
          { t: 0.26, body: merge({ chest: [-6, -10, 0], spine: [-6, -4, 0] }, NEUTRAL_LEGS), w: { p: [-0.2, 1.78, -0.02], d: [-0.1, 0.3, -0.95], u: [0, 1, 0] }, l: { p: [0.14, 1.15, 0.35], d: [0, 1, 0], u: [0, 0, 1] }, pr: P_RH },
          { t: 0.44, body: merge({ spine: [8, 0, 0], chest: [8, 0, 0] }, STEP_LUNGE_R), hip: [0, -0.1, 0.1], w: { p: [0, 1.45, 0.5], d: [0, 0.6, 0.8], u: [0, -0.8, 0.6] } },
          { t: 0.52, body: merge({ spine: [22, 0, 0], chest: [10, 0, 0] }, STEP_LUNGE_R), hip: [0, -0.18, 0.12], w: { p: [0, 0.92, 0.58], d: [0, -0.55, 0.83], u: [0, -0.83, -0.55] } },
          { t: 0.78, body: merge({ chest: [6, -6, 0] }, NEUTRAL_LEGS), w: { p: [-0.16, 1.08, 0.3], d: [-0.1, 0.7, 0.7], u: [0, -0.7, 0.7] } },
        ],
        hits: [{ t0: 0.08, t1: 0.16, dmg: 10, stagger: 1.1, cleave: 2, kind: 'blunt', src: 'left' }, { t0: 0.42, t1: 0.55, dmg: 44, stagger: 1.0, cleave: 2, kind: 'blunt' }],
        moves: [{ t0: 0.04, t1: 0.14, v: 3 }, { t0: 0.36, t1: 0.5, v: 2 }] },
    ],
    heavy: { name: 'Leaping Smash', dur: 1.35, chain: 1.05, cancel: 0.98, stamina: 26, fullBody: true, sfx: [{ t: 0.0, k: 'grunt' }, { t: 0.5, k: 'heavySwing' }],
      keys: [
        { t: 0.36, body: merge({ spine: [-10, -10, 0], chest: [-12, -12, 0], head: [12, 8, 0] }, CROUCH), hip: [0, -0.14, -0.04], w: { p: [-0.26, 1.8, -0.06], d: [-0.1, 0.35, -0.93], u: [0, 1, 0] }, l: { p: [0.3, 1.5, 0.2], d: [0, 1, 0], u: [0.6, 0, 0.8] }, pr: P_RH, pl: P_LH },
        { t: 0.52, body: merge({ spine: [4, 0, 0] }, { thighR: [-50, 0, -6], shinR: [70, 0, 0], thighL: [-30, 0, 6], shinL: [50, 0, 0] }), hip: [0, 0.32, 0.2], w: { p: [-0.04, 1.62, 0.4], d: [0, 0.75, 0.66], u: [0, -0.66, 0.75] } },
        { t: 0.64, body: merge({ spine: [26, 0, 0], chest: [14, 0, 0], head: [-14, 0, 0] }, STEP_LUNGE_R), hip: [0, -0.24, 0.16], w: { p: [0, 0.82, 0.62], d: [0, -0.7, 0.71], u: [0, -0.71, -0.7] } },
        { t: 1.0, body: merge({ chest: [6, -6, 0] }, NEUTRAL_LEGS), w: { p: [-0.16, 1.06, 0.3], d: [-0.1, 0.7, 0.7], u: [0, -0.7, 0.7] } },
      ],
      hits: [{ t0: 0.58, t1: 0.7, dmg: 72, stagger: 1.3, cleave: 3, kind: 'blunt', aoe: { t: 0.64, r: 2.8, dmg: 36 } }], moves: [{ t0: 0.36, t1: 0.62, v: 5.2 }] },
  },

  // ================================================================ HALBERD
  halberd: {
    stance: { body: { spine: [6, -14, 0], chest: [2, -16, 0], head: [-2, 18, 0] }, w: { p: [-0.16, 1.0, -0.04], d: [0.1, 0.36, 0.93], u: [0, 0.93, -0.36] }, pr: [-0.6, -0.8, -0.3], pl: [0.6, -0.8, 0] },
    carry: { body: { spine: [10, 0, 0] }, w: { p: [-0.2, 1.12, 0.0], d: [0.05, 0.95, 0.3], u: [0, -0.3, 0.95] } },
    block: { body: { chest: [-4, -4, 0] }, w: { p: [-0.3, 1.36, 0.3], d: [1, 0.1, 0], u: [0, 1, 0] }, pr: P_RH, pl: P_LH },
    light: [
      { name: 'Sweep', dur: 1.0, chain: 0.56, cancel: 0.66, stamina: 15, sfx: [{ t: 0.3, k: 'heavySwing' }],
        keys: [
          { t: 0.26, body: { chest: [0, -38, 0], spine: [0, -14, 0], head: [0, 26, 0] }, w: { p: [-0.26, 1.1, -0.12], d: [-0.75, 0.25, 0.62], u: [0.62, 0, 0.75] } },
          { t: 0.4, body: { chest: [6, 0, 0], spine: [4, 0, 0] }, hip: [0, -0.06, 0], w: { p: [-0.06, 1.08, 0.14], d: [0.05, 0.08, 1], u: [1, 0, 0] } },
          { t: 0.52, body: { chest: [8, 38, 0], spine: [4, 14, 0], head: [0, -20, 0] }, w: { p: [0.08, 1.04, 0.08], d: [0.82, 0.0, 0.57], u: [0.57, 0, -0.82] } },
          { t: 0.8, body: { chest: [4, 10, 0] }, w: { p: [-0.06, 1.0, 0.0], d: [0.3, 0.3, 0.9], u: [0, 0.95, -0.3] } },
        ],
        hits: [{ t0: 0.33, t1: 0.54, dmg: 44, stagger: 0.6, cleave: 4 }], moves: [{ t0: 0.2, t1: 0.4, v: 1.8 }] },
      { name: 'Chop', dur: 1.1, chain: 0.62, cancel: 0.72, stamina: 16, fullBody: true, sfx: [{ t: 0.42, k: 'heavySwing' }],
        keys: [
          { t: 0.32, body: merge({ spine: [-10, -6, 0], chest: [-8, -8, 0], head: [10, 8, 0] }, NEUTRAL_LEGS), w: { p: [-0.18, 1.52, -0.18], d: [0, 0.92, -0.38], u: [0, 0.38, 0.92] }, pr: P_RH, pl: P_LH },
          { t: 0.48, body: merge({ spine: [8, 0, 0], chest: [6, 0, 0] }, STEP_LUNGE_R), hip: [0, -0.1, 0.08], w: { p: [-0.06, 1.36, 0.16], d: [0, 0.32, 0.95], u: [0, -0.95, 0.32] } },
          { t: 0.58, body: merge({ spine: [22, 0, 0], chest: [14, 0, 0], head: [-10, 0, 0] }, STEP_LUNGE_R), hip: [0, -0.16, 0.1], w: { p: [-0.06, 1.02, 0.26], d: [0, -0.32, 0.95], u: [0, -0.95, -0.32] } },
          { t: 0.9, body: merge({ chest: [4, -8, 0] }, NEUTRAL_LEGS), w: { p: [-0.12, 1.0, 0.0], d: [0.05, 0.4, 0.92], u: [0, 0.92, -0.4] } },
        ],
        hits: [{ t0: 0.46, t1: 0.62, dmg: 56, stagger: 1.0, cleave: 3 }], moves: [{ t0: 0.3, t1: 0.5, v: 2.4 }] },
      { name: 'Thrust', dur: 0.9, chain: 0.5, cancel: 0.6, stamina: 12, fullBody: true, sfx: [{ t: 0.26, k: 'thrust' }],
        keys: [
          { t: 0.2, body: merge({ chest: [0, -22, 0] }, CROUCH), hip: [0, -0.06, -0.06], w: { p: [-0.22, 1.0, -0.22], d: [0.06, 0.1, 0.99], u: [0, 1, 0] } },
          { t: 0.34, body: merge({ chest: [12, -8, 0], spine: [10, 0, 0] }, STEP_LUNGE_L), hip: [0, -0.14, 0.12], w: { p: [-0.06, 1.06, 0.36], d: [0.04, 0.04, 1], u: [0, 1, 0] } },
          { t: 0.46, body: merge({ chest: [12, -8, 0], spine: [10, 0, 0] }, STEP_LUNGE_L), hip: [0, -0.14, 0.12], w: { p: [-0.05, 1.06, 0.4], d: [0.04, 0.04, 1], u: [0, 1, 0] } },
          { t: 0.7, body: merge({}, NEUTRAL_LEGS), w: { p: [-0.14, 1.0, 0.0], d: [0.08, 0.3, 0.95], u: [0, 0.95, -0.3] } },
        ],
        hits: [{ t0: 0.28, t1: 0.44, dmg: 38, stagger: 0.5, cleave: 3, kind: 'pierce' }], moves: [{ t0: 0.2, t1: 0.36, v: 3.2 }] },
    ],
    heavy: { name: 'Reaping Circle', dur: 1.55, chain: 1.3, cancel: 1.2, stamina: 32, fullBody: true, sfx: [{ t: 0.3, k: 'grunt' }, { t: 0.38, k: 'heavySwing' }, { t: 0.7, k: 'heavySwing' }],
      keys: [
        { t: 0.3, body: merge({ chest: [6, -40, 0], spine: [6, -14, 0] }, CROUCH), hip: [0, -0.12, 0], w: { p: [-0.3, 1.1, -0.1], d: [-0.85, 0.15, 0.5], u: [0.5, 0, 0.86] } },
        { t: 0.4, body: merge({ chest: [8, -6, 0] }, PLANT), hip: [0, -0.1, 0], w: { p: [-0.06, 1.08, 0.12], d: [0.6, 0.06, 0.8], u: [0.8, 0, -0.6] } },
        { t: 1.05, body: merge({ chest: [8, -6, 0] }, PLANT), hip: [0, -0.1, 0], w: { p: [-0.06, 1.08, 0.12], d: [0.6, 0.06, 0.8], u: [0.8, 0, -0.6] } },
        { t: 1.3, body: merge({}, NEUTRAL_LEGS), w: { p: [-0.16, 1.0, -0.02], d: [0.1, 0.36, 0.93], u: [0, 0.93, -0.36] } },
      ],
      spin: [{ t0: 0.36, t1: 1.08, a: Math.PI * 2 }],
      hits: [{ t0: 0.38, t1: 1.06, dmg: 62, stagger: 1.2, cleave: 99, sweep: true }], moves: [{ t0: 0.35, t1: 1.0, v: 1.2 }] },
  },

  // ================================================================ PIKE
  pike: {
    stance: { body: { spine: [6, -20, 0], chest: [2, -18, 0], head: [0, 24, 0] }, w: { p: [-0.27, 1.02, -0.08], d: [0.09, 0.06, 0.99], u: [0, 1, 0] }, pr: [-0.8, -0.6, -0.1], pl: [0.5, -0.9, 0.1] },
    carry: { body: { spine: [10, 0, 0] }, w: { p: [-0.22, 1.28, -0.05], d: [0.03, 0.95, -0.3], u: [0, 0.3, 0.95] } },
    block: { body: { chest: [-2, -6, 0] }, w: { p: [-0.32, 1.32, 0.1], d: [1, 0.1, 0.15], u: [0, 1, 0] }, pr: P_RH, pl: P_LH },
    light: [
      { name: 'Thrust', dur: 0.7, chain: 0.34, cancel: 0.42, stamina: 10, sfx: [{ t: 0.16, k: 'thrust' }],
        keys: [
          { t: 0.14, body: { chest: [0, -24, 0], spine: [-2, -8, 0] }, w: { p: [-0.3, 1.04, -0.34], d: [0.1, 0.05, 0.99], u: [0, 1, 0] } },
          { t: 0.24, body: { chest: [10, -6, 0], spine: [8, 0, 0] }, hip: [0, -0.05, 0.06], w: { p: [-0.04, 1.12, 0.34], d: [0.04, 0.02, 1], u: [0, 1, 0] } },
          { t: 0.34, body: { chest: [10, -6, 0], spine: [8, 0, 0] }, hip: [0, -0.05, 0.06], w: { p: [-0.03, 1.12, 0.38], d: [0.04, 0.02, 1], u: [0, 1, 0] } },
          { t: 0.52, body: { chest: [2, -16, 0] }, w: { p: [-0.25, 1.03, -0.06], d: [0.09, 0.06, 0.99], u: [0, 1, 0] } },
        ],
        hits: [{ t0: 0.18, t1: 0.34, dmg: 34, stagger: 0.5, cleave: 5, kind: 'pierce' }], moves: [{ t0: 0.1, t1: 0.26, v: 2.6 }] },
      { name: 'High Thrust', dur: 0.76, chain: 0.38, cancel: 0.46, stamina: 11, sfx: [{ t: 0.2, k: 'thrust' }],
        keys: [
          { t: 0.16, body: { chest: [-6, -20, 0], spine: [-4, -6, 0] }, w: { p: [-0.3, 1.5, -0.24], d: [0.06, -0.08, 1], u: [0, 1, 0] }, pr: P_RH, pl: P_LH },
          { t: 0.28, body: { chest: [12, -4, 0], spine: [10, 0, 0] }, hip: [0, -0.06, 0.08], w: { p: [-0.04, 1.52, 0.36], d: [0.02, -0.12, 1], u: [0, 1, 0] } },
          { t: 0.38, body: { chest: [12, -4, 0], spine: [10, 0, 0] }, hip: [0, -0.06, 0.08], w: { p: [-0.03, 1.5, 0.4], d: [0.02, -0.12, 1], u: [0, 1, 0] } },
          { t: 0.56, body: { chest: [2, -14, 0] }, w: { p: [-0.25, 1.08, -0.06], d: [0.08, 0.04, 1], u: [0, 1, 0] } },
        ],
        hits: [{ t0: 0.22, t1: 0.38, dmg: 36, stagger: 0.5, cleave: 5, kind: 'pierce' }], moves: [{ t0: 0.12, t1: 0.3, v: 2.6 }] },
      { name: 'Haft Sweep', dur: 1.0, chain: 0.56, cancel: 0.66, stamina: 14, sfx: [{ t: 0.3, k: 'heavySwing' }],
        keys: [
          { t: 0.25, body: { chest: [0, -36, 0], spine: [0, -14, 0] }, w: { p: [-0.26, 1.1, -0.1], d: [-0.6, 0.15, 0.78], u: [0.78, 0, 0.6] } },
          { t: 0.4, body: { chest: [6, 0, 0] }, w: { p: [-0.04, 1.06, 0.12], d: [0.2, 0.05, 0.98], u: [1, 0, 0] } },
          { t: 0.52, body: { chest: [8, 36, 0], spine: [4, 14, 0] }, w: { p: [0.06, 1.02, 0.08], d: [0.8, 0, 0.6], u: [0.6, 0, -0.8] } },
          { t: 0.8, body: { chest: [2, -6, 0] }, w: { p: [-0.25, 1.03, -0.08], d: [0.12, 0.05, 0.99], u: [0, 1, 0] } },
        ],
        hits: [{ t0: 0.33, t1: 0.53, dmg: 24, stagger: 1.2, cleave: 8, kind: 'blunt', seg: [0.9, 3.0] }], moves: [{ t0: 0.2, t1: 0.4, v: 1.4 }] },
    ],
    heavy: { name: 'Charge', dur: 1.5, chain: 1.3, cancel: 1.2, stamina: 30, legs: 'run', sfx: [{ t: 0.0, k: 'grunt' }, { t: 0.95, k: 'thrust' }],
      keys: [
        { t: 0.15, body: { chest: [10, -10, 0], spine: [16, -4, 0], head: [-14, 10, 0] }, w: { p: [-0.24, 1.1, -0.12], d: [0.05, 0.0, 1], u: [0, 1, 0] } },
        { t: 0.9, body: { chest: [10, -10, 0], spine: [16, -4, 0], head: [-14, 10, 0] }, w: { p: [-0.24, 1.1, -0.1], d: [0.05, 0.0, 1], u: [0, 1, 0] } },
        { t: 1.02, body: { chest: [16, -2, 0], spine: [16, 0, 0] }, w: { p: [-0.02, 1.14, 0.4], d: [0.03, 0.0, 1], u: [0, 1, 0] } },
        { t: 1.3, body: { chest: [4, -12, 0] }, w: { p: [-0.26, 1.03, -0.08], d: [0.09, 0.06, 0.99], u: [0, 1, 0] } },
      ],
      hits: [{ t0: 0.2, t1: 1.08, dmg: 70, stagger: 1.4, cleave: 8, kind: 'pierce' }], moves: [{ t0: 0.12, t1: 0.95, v: 7.2 }, { t0: 0.95, t1: 1.05, v: 3 }] },
  },

  // ================================================================ POLLAXE
  pollaxe: {
    stance: { body: { spine: [6, -12, 0], chest: [2, -14, 0], head: [0, 14, 0] }, w: { p: [-0.18, 1.02, -0.02], d: [0.15, 0.55, 0.82], u: [0, -0.82, 0.55] }, pr: [-0.6, -0.8, -0.3], pl: [0.6, -0.8, 0] },
    carry: { body: { spine: [10, 0, 0] }, w: { p: [-0.2, 1.2, 0.02], d: [0.05, 0.95, 0.3], u: [0, -0.3, 0.95] } },
    block: { body: { chest: [-4, -4, 0] }, w: { p: [-0.28, 1.36, 0.3], d: [1, 0.12, 0], u: [0, 1, 0] }, pr: P_RH, pl: P_LH },
    light: [
      { name: 'Hammer Blow', dur: 1.0, chain: 0.56, cancel: 0.66, stamina: 15, sfx: [{ t: 0.34, k: 'heavySwing' }],
        keys: [
          { t: 0.28, body: { chest: [-4, -30, 0], spine: [-2, -10, 0], head: [0, 20, 0] }, w: { p: [-0.28, 1.5, -0.1], d: [-0.35, 0.75, -0.55], u: [0.3, 0.5, 0.8] }, pr: P_RH, pl: P_LH },
          { t: 0.42, body: { chest: [8, 0, 0], spine: [8, 0, 0] }, w: { p: [-0.06, 1.3, 0.2], d: [0.2, 0.4, 0.9], u: [0.45, -0.85, 0.25] } },
          { t: 0.52, body: { chest: [14, 26, 0], spine: [12, 8, 0], head: [-10, -14, 0] }, hip: [0, -0.06, 0.04], w: { p: [0.08, 0.98, 0.22], d: [0.45, -0.4, 0.8], u: [0.5, -0.7, -0.5] } },
          { t: 0.8, body: { chest: [4, 8, 0] }, w: { p: [-0.1, 1.0, 0.04], d: [0.2, 0.5, 0.85], u: [0, -0.85, 0.5] } },
        ],
        hits: [{ t0: 0.38, t1: 0.54, dmg: 44, stagger: 1.0, cleave: 2, kind: 'blunt' }], moves: [{ t0: 0.2, t1: 0.4, v: 2.0 }] },
      { name: 'Spike Thrust', dur: 0.85, chain: 0.46, cancel: 0.56, stamina: 12, fullBody: true, sfx: [{ t: 0.22, k: 'thrust' }],
        keys: [
          { t: 0.18, body: merge({ chest: [0, -20, 0] }, CROUCH), hip: [0, -0.06, -0.05], w: { p: [-0.24, 1.05, -0.25], d: [0.08, 0.2, 0.97], u: [0, -0.97, 0.2] } },
          { t: 0.3, body: merge({ chest: [12, -6, 0], spine: [10, 0, 0] }, STEP_LUNGE_L), hip: [0, -0.14, 0.12], w: { p: [-0.06, 1.15, 0.32], d: [0.04, 0.1, 1], u: [0, -1, 0.1] } },
          { t: 0.42, body: merge({ chest: [12, -6, 0], spine: [10, 0, 0] }, STEP_LUNGE_L), hip: [0, -0.14, 0.12], w: { p: [-0.05, 1.15, 0.36], d: [0.04, 0.1, 1], u: [0, -1, 0.1] } },
          { t: 0.66, body: merge({}, NEUTRAL_LEGS), w: { p: [-0.16, 1.02, 0.0], d: [0.15, 0.55, 0.82], u: [0, -0.82, 0.55] } },
        ],
        hits: [{ t0: 0.24, t1: 0.4, dmg: 36, stagger: 0.5, cleave: 2, kind: 'pierce' }], moves: [{ t0: 0.15, t1: 0.3, v: 3.0 }] },
      { name: 'Rising Strike', dur: 1.0, chain: 0.56, cancel: 0.66, stamina: 14, sfx: [{ t: 0.32, k: 'heavySwing' }],
        keys: [
          { t: 0.26, body: { chest: [6, 30, 0], spine: [6, 10, 0] }, hip: [0, -0.08, 0], w: { p: [0.1, 0.85, 0.0], d: [0.6, -0.5, 0.62], u: [-0.6, 0.7, 0.3] }, pl: P_L },
          { t: 0.42, body: { chest: [2, 0, 0] }, w: { p: [-0.06, 1.12, 0.22], d: [-0.1, 0.25, 0.96], u: [-0.6, 0.75, -0.1] } },
          { t: 0.52, body: { chest: [-6, -30, 0], spine: [-4, -10, 0] }, w: { p: [-0.24, 1.42, 0.16], d: [-0.55, 0.75, 0.35], u: [-0.5, 0.0, 0.86] }, pr: P_RH },
          { t: 0.8, body: { chest: [2, -10, 0] }, w: { p: [-0.18, 1.06, 0.0], d: [0.15, 0.55, 0.82], u: [0, -0.82, 0.55] } },
        ],
        hits: [{ t0: 0.36, t1: 0.54, dmg: 40, stagger: 1.2, cleave: 2, kind: 'blunt' }], moves: [{ t0: 0.2, t1: 0.4, v: 1.8 }] },
    ],
    heavy: { name: 'Crushing Blow', dur: 1.5, chain: 1.2, cancel: 1.12, stamina: 30, fullBody: true, sfx: [{ t: 0.0, k: 'grunt' }, { t: 0.54, k: 'heavySwing' }],
      keys: [
        { t: 0.42, body: merge({ spine: [-14, -6, 0], chest: [-12, -8, 0], head: [12, 6, 0] }, CROUCH), hip: [0, -0.12, -0.04], w: { p: [-0.1, 1.76, -0.14], d: [-0.05, 0.35, -0.94], u: [0, 1, 0.3] }, pr: P_RH, pl: P_LH },
        { t: 0.58, body: merge({ spine: [6, 0, 0] }, { thighR: [-44, 0, -6], shinR: [60, 0, 0], thighL: [-24, 0, 6], shinL: [40, 0, 0] }), hip: [0, 0.26, 0.16], w: { p: [-0.04, 1.6, 0.36], d: [0, 0.78, 0.62], u: [0, -0.62, 0.78] } },
        { t: 0.7, body: merge({ spine: [28, 0, 0], chest: [16, 0, 0], head: [-14, 0, 0] }, STEP_LUNGE_R), hip: [0, -0.24, 0.16], w: { p: [-0.02, 0.86, 0.5], d: [0, -0.6, 0.8], u: [0, -0.8, -0.6] } },
        { t: 1.12, body: merge({ chest: [6, -6, 0] }, NEUTRAL_LEGS), w: { p: [-0.16, 1.02, 0.0], d: [0.15, 0.55, 0.82], u: [0, -0.82, 0.55] } },
      ],
      hits: [{ t0: 0.64, t1: 0.76, dmg: 100, stagger: 1.5, cleave: 3, kind: 'blunt', aoe: { t: 0.7, r: 3.2, dmg: 42 } }], moves: [{ t0: 0.42, t1: 0.68, v: 5.0 }] },
  },
};

// ---------------------------------------------------------------- shared clips (arm angles, no weapon IK)
export const COMMON = {
  roll: { dur: 0.72, ikOff: true, fullBody: true, iframes: [0.04, 0.46], stamina: 18, moves: [{ t0: 0.02, t1: 0.56, v: 6.6 }], sfx: [{ t: 0.05, k: 'roll' }, { t: 0.5, k: 'land' }],
    keys: [
      { t: 0.08, body: merge({ spine: [30, 0, 0], chest: [20, 0, 0], head: [30, 0, 0], uArmR: [-60, 0, -10], fArmR: [-90, 0, 0], uArmL: [-60, 0, 10], fArmL: [-90, 0, 0] }, CROUCH), hip: [0, -0.3, 0.06] },
      { t: 0.24, body: { hips: [150, 0, 0], spine: [40, 0, 0], chest: [30, 0, 0], head: [40, 0, 0], uArmR: [-70, 0, -10], fArmR: [-110, 0, 0], uArmL: [-70, 0, 10], fArmL: [-110, 0, 0], thighR: [-110, 0, -6], shinR: [130, 0, 0], thighL: [-110, 0, 6], shinL: [130, 0, 0] }, hip: [0, -0.52, 0.0] },
      { t: 0.42, body: { hips: [300, 0, 0], spine: [40, 0, 0], chest: [30, 0, 0], head: [30, 0, 0], uArmR: [-60, 0, -10], fArmR: [-100, 0, 0], uArmL: [-60, 0, 10], fArmL: [-100, 0, 0], thighR: [-100, 0, -6], shinR: [130, 0, 0], thighL: [-100, 0, 6], shinL: [130, 0, 0] }, hip: [0, -0.48, 0.0] },
      { t: 0.56, body: merge({ hips: [360, 0, 0], spine: [24, 0, 0], chest: [10, 0, 0], uArmR: [-30, 0, -10], fArmR: [-60, 0, 0], uArmL: [-30, 0, 10], fArmL: [-60, 0, 0] }, CROUCH), hip: [0, -0.24, 0.0] },
      { t: 0.72, body: { hips: [360, 0, 0] }, hip: [0, 0, 0] },
    ] },
  stagger: { dur: 0.55, keepWeapon: true, moves: [{ t0: 0, t1: 0.2, v: -1.6 }], keys: [
    { t: 0.1, body: { spine: [-14, 6, 8], chest: [-10, 6, 6], head: [-22, 10, 0] }, hip: [0, -0.04, -0.06] },
    { t: 0.3, body: { spine: [-6, 2, 4], chest: [-4, 2, 2], head: [-8, 4, 0] }, hip: [0, -0.02, -0.02] } ] },
  knockdown: { dur: 2.0, ikOff: true, fullBody: true, iframes: [0.1, 1.7], moves: [{ t0: 0, t1: 0.35, v: -3.2 }], sfx: [{ t: 0.42, k: 'land' }], keys: [
    { t: 0.14, body: { spine: [-20, 0, 0], chest: [-20, 0, 0], head: [-20, 0, 0], uArmR: [-80, 0, -40], uArmL: [-80, 0, 40], thighR: [-30, 0, 0], thighL: [-20, 0, 0] }, hip: [0, -0.2, -0.1] },
    { t: 0.42, body: { hips: [-82, 0, 0], spine: [-6, 0, 0], head: [20, 0, 0], uArmR: [-10, 0, -50], fArmR: [-20, 0, 0], uArmL: [-10, 0, 50], fArmL: [-20, 0, 0], thighR: [-10, 0, -10], shinR: [20, 0, 0], thighL: [-30, 0, 10], shinL: [40, 0, 0] }, hip: [0, -0.84, -0.3] },
    { t: 1.1, body: { hips: [-80, 0, 0], spine: [-4, 0, 0], head: [30, 0, 0], uArmR: [-10, 0, -50], fArmR: [-30, 0, 0], uArmL: [-10, 0, 50], fArmL: [-30, 0, 0], thighR: [-40, 0, -10], shinR: [80, 0, 0], thighL: [-30, 0, 10], shinL: [60, 0, 0] }, hip: [0, -0.84, -0.3] },
    { t: 1.5, body: merge({ hips: [-10, 0, 0], spine: [40, 0, 0], chest: [20, 0, 0], uArmR: [-40, 0, -20], uArmL: [-20, 0, 20] }, { thighR: [-90, 0, -8], shinR: [140, 0, 0], footR: [-50, 0, 0], thighL: [-60, 0, 8], shinL: [100, 0, 0], footL: [-40, 0, 0] }), hip: [0, -0.5, -0.1] },
    { t: 1.85, body: merge({ spine: [10, 0, 0] }, NEUTRAL_LEGS), hip: [0, -0.04, 0] } ] },
  relicThrow: { dur: 0.85, keepWeapon: true, freeLeft: true, keys: [
    { t: 0.22, body: { chest: [-6, 30, 0], spine: [-4, 10, 0], head: [-4, -10, 0] }, l: { p: [0.32, 1.66, -0.22], d: [0, 1, 0], u: [0, 0, -1] }, pl: [0.8, 0.2, -0.6] },
    { t: 0.4, body: { chest: [10, -14, 0], spine: [8, -6, 0] }, l: { p: [0.12, 1.5, 0.62], d: [0, 0.6, 0.8], u: [0, 0.8, -0.6] } },
    { t: 0.62, body: { chest: [4, -6, 0] }, l: { p: [0.18, 1.2, 0.4], d: [0, 1, 0], u: [0, 0, 1] } } ], release: 0.38 },
  relicRaise: { dur: 1.3, keepWeapon: true, freeLeft: true, keys: [
    { t: 0.35, body: { chest: [-8, 6, 0], spine: [-6, 0, 0], head: [-26, 0, 0] }, l: { p: [0.1, 2.0, 0.3], d: [0, 0.3, -0.95], u: [0, 0.95, 0.3] }, pl: [0.9, 0, -0.3] },
    { t: 0.95, body: { chest: [-8, 6, 0], spine: [-6, 0, 0], head: [-26, 0, 0] }, l: { p: [0.1, 2.02, 0.32], d: [0, 0.3, -0.95], u: [0, 0.95, 0.3] } } ], release: 0.45 },
  salute: { dur: 2.4, keepWeapon: false, keys: [
    { t: 0.5, body: { spine: [-4, 0, 0], chest: [-10, 0, 0], head: [-24, 0, 0] }, w: { p: [-0.12, 1.8, 0.24], d: [0.02, 1, 0.08], u: [0, 0, 1] }, pr: P_RH, pl: P_LH },
    { t: 2.0, body: { spine: [-4, 0, 0], chest: [-10, 0, 0], head: [-28, 0, 0] }, w: { p: [-0.12, 1.84, 0.24], d: [0.02, 1, 0.08], u: [0, 0, 1] } } ] },
};
