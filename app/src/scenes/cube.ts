import { stage, type Scene } from './source';

// The data cube: one dataset, one API per face, each face a 4x4 grid of records lit by how
// complete that API is. Same grades as the simulator prototype.

type V3 = [number, number, number];

const FACES: { normal: V3; u: V3; v: V3; completion: number; hue: string; lit: string }[] = [
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], completion: 0.94, hue: '#4f6f8f', lit: '#7fd4ff' },
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], completion: 0.81, hue: '#6a6f86', lit: '#a9b8ff' },
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], completion: 0.67, hue: '#6c7a6a', lit: '#9cff9a' },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], completion: 0.45, hue: '#7f705c', lit: '#ffc46b' },
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], completion: 0.22, hue: '#80625f', lit: '#ff8d72' },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], completion: 0, hue: '#55585e', lit: '#55585e' },
];

const LIGHT: V3 = (() => {
  const l: V3 = [-0.45, 0.7, 0.55];
  const m = Math.hypot(...l);
  return [l[0] / m, l[1] / m, l[2] / m];
})();

function rotate([x, y, z]: V3, a: number, b: number): V3 {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const y1 = y * ca - z * sa;
  const z1 = y * sa + z * ca;
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  return [x * cb + z1 * sb, y1, -x * sb + z1 * cb];
}

const cellHash = (f: number, i: number, j: number) => {
  const n = Math.sin(f * 127.1 + i * 311.7 + j * 74.7) * 43758.5453;
  return n - Math.floor(n);
};

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.round(Math.min(255, ((n >> s) & 255) * k));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

export const cubeScene: Scene = {
  title: 'DATA CUBE',
  kind: 'DATASET',
  draw(ctx, w, h, t) {
    const bg = ctx.createRadialGradient(w * 0.6, h * 0.45, 0, w * 0.6, h * 0.45, Math.max(w, h) * 0.75);
    // Backdrop sits near the median brightness so neither theme prints it: light paper inks
    // the darkest parts of the cube, dark paper lights the brightest.
    bg.addColorStop(0, '#7a7e85');
    bg.addColorStop(1, '#6a6e74');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const s = stage(w, h);
    const size = s.size * 0.27;
    const a = 0.45 + Math.sin(t * 0.23) * 0.25;
    const b = t * 0.35;

    // Floor shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(s.cx, s.cy + size * 1.55, size * 1.4, size * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    const project = (p: V3): [number, number] => {
      const r = rotate(p, a, b);
      const k = 4 / (4 - r[2]);
      return [s.cx + r[0] * size * k, s.cy - r[1] * size * k];
    };

    const visible = FACES.map((f, index) => ({ f, index, n: rotate(f.normal, a, b) }))
      .filter(({ n }) => n[2] > 0.02)
      .sort((p, q) => p.n[2] - q.n[2]);

    for (const { f, index, n } of visible) {
      const light = 0.25 + 0.75 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const at = (u: number, v: number): V3 => [
        f.normal[0] + f.u[0] * u + f.v[0] * v,
        f.normal[1] + f.u[1] * u + f.v[1] * v,
        f.normal[2] + f.u[2] * u + f.v[2] * v,
      ];
      const quad = (u0: number, v0: number, u1: number, v1: number) => {
        ctx.beginPath();
        for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) {
          const [x, y] = project(at(u, v));
          ctx.lineTo(x, y);
        }
        ctx.closePath();
      };

      quad(-1, -1, 1, 1);
      ctx.fillStyle = shade(f.hue, light * 1.1);
      ctx.fill();

      // 4x4 records: lit if this API has them, dark if it does not.
      const g = 4;
      const inset = 0.08;
      for (let i = 0; i < g; i++) {
        for (let j = 0; j < g; j++) {
          const u0 = -1 + (2 * i) / g + inset;
          const v0 = -1 + (2 * j) / g + inset;
          const u1 = -1 + (2 * (i + 1)) / g - inset;
          const v1 = -1 + (2 * (j + 1)) / g - inset;
          quad(u0, v0, u1, v1);
          const on = cellHash(index, i, j) < f.completion;
          ctx.fillStyle = on ? shade(f.lit, 0.55 + 0.45 * light) : shade(f.hue, light * 0.45);
          ctx.fill();
        }
      }
    }

    // Edges as a wide dark stroke under a narrow bright one: light paper prints the dark
    // outline, dark paper lights the bright core, so the silhouette survives either way.
    ctx.lineJoin = 'round';
    const strokes = [
      ['#111315', Math.max(7, size * 0.07)],
      ['#f4f4f4', Math.max(2.5, size * 0.022)],
    ] as const;
    for (const [colour, width] of strokes) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      for (const { f } of visible) {
        ctx.beginPath();
        for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const p: V3 = [
            f.normal[0] + f.u[0] * u + f.v[0] * v,
            f.normal[1] + f.u[1] * u + f.v[1] * v,
            f.normal[2] + f.u[2] * u + f.v[2] * v,
          ];
          const [x, y] = project(p);
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  },
};
