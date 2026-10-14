import { rand, type Scene } from './source';

// Phoenix at dusk: a low sun, layered ridges with a camel-backed mountain, saguaros, and
// terrain contour lines rolling toward the viewer. Painted in mid tones with dark structure
// and bright light sources, so it reads both as a print (light paper inks the darks) and as
// a glow (dark paper lights the brights).

const SAGUAROS = (() => {
  const r = rand(91);
  return Array.from({ length: 5 }, () => ({
    x: 0.08 + r() * 0.9,
    depth: 0.35 + r() * 0.65,
    arms: [r() < 0.8 ? 0.35 + r() * 0.25 : -1, r() < 0.7 ? 0.45 + r() * 0.25 : -1],
  })).sort((a, b) => a.depth - b.depth);
})();

function ridge(
  ctx: CanvasRenderingContext2D,
  w: number,
  base: number,
  height: (u: number) => number,
  fill: string | CanvasGradient,
  bottom: number,
) {
  ctx.beginPath();
  ctx.moveTo(0, bottom);
  for (let x = 0; x <= w; x += 4) ctx.lineTo(x, base - height(x / w));
  ctx.lineTo(w, bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function saguaro(ctx: CanvasRenderingContext2D, x: number, ground: number, hgt: number, arms: number[]) {
  const trunk = hgt * 0.13;
  ctx.fillStyle = '#0d0a0c';
  ctx.beginPath();
  ctx.roundRect(x - trunk / 2, ground - hgt, trunk, hgt, trunk / 2);
  ctx.fill();
  arms.forEach((at, i) => {
    if (at < 0) return;
    const dir = i === 0 ? -1 : 1;
    const ay = ground - hgt * at;
    const reach = hgt * 0.22;
    const up = hgt * 0.3;
    const arm = trunk * 0.75;
    ctx.beginPath();
    ctx.roundRect(Math.min(x, x + dir * reach), ay - arm / 2, reach, arm, arm / 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x + dir * reach - arm / 2, ay - up, arm, up, arm / 2);
    ctx.fill();
  });
}

export const desertScene: Scene = {
  title: 'PHOENIX TERRAIN',
  kind: 'LANDSCAPE',
  draw(ctx, w, h, t) {
    const horizon = h * 0.6;

    // Dusk sky.
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#5f7596');
    sky.addColorStop(0.6, '#b98278');
    sky.addColorStop(1, '#dcaa7c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    // Low sun with a soft halo, cut by horizontal bands near the horizon.
    const sx = w * 0.7;
    const sr = Math.min(w, h) * 0.13;
    const sy = horizon - sr * (0.55 + 0.1 * Math.sin(t * 0.15));
    const halo = ctx.createRadialGradient(sx, sy, sr * 0.8, sx, sy, sr * 3);
    halo.addColorStop(0, 'rgba(255,214,140,0.3)');
    halo.addColorStop(1, 'rgba(255,214,140,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, horizon);
    ctx.fillStyle = '#fffbea';
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9c5a46';
    ctx.lineWidth = sr * 0.12;
    ctx.stroke();
    ctx.fillStyle = '#8a3a28';
    for (let i = 0; i < 4; i++) {
      const by = sy + sr * (0.15 + i * 0.22);
      ctx.fillRect(sx - sr, by, sr * 2, sr * (0.05 + i * 0.03));
    }

    // Far range, the camel-backed mountain, a near ridge.
    ridge(ctx, w, horizon, (u) => h * (0.06 + 0.03 * Math.sin(u * 9) + 0.02 * Math.sin(u * 23)), '#a07c8c', horizon);
    const camel = (u: number) => {
      const hump = Math.exp(-(((u - 0.34) / 0.07) ** 2)) * 0.17;
      const head = Math.exp(-(((u - 0.47) / 0.035) ** 2)) * 0.1;
      const body = Math.exp(-(((u - 0.4) / 0.16) ** 2)) * 0.06;
      return h * (hump + head + body + 0.015);
    };
    ridge(ctx, w, horizon, camel, '#3b2534', horizon);
    ridge(ctx, w, horizon + h * 0.02, (u) => h * (0.025 + 0.02 * Math.sin(u * 5 + 1)), '#22161f', horizon + h * 0.03);

    // Desert floor with contour lines rolling toward the viewer.
    const floor = ctx.createLinearGradient(0, horizon, 0, h);
    floor.addColorStop(0, '#e0b98c');
    floor.addColorStop(1, '#b98a62');
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon + h * 0.02, w, h);

    ctx.strokeStyle = '#3a2620';
    const scroll = (t * 0.12) % 1;
    for (let k = 0; k < 14; k++) {
      const z = (k + scroll) / 14;
      const y = horizon + h * 0.03 + (h - horizon) * z * z;
      ctx.lineWidth = 1 + z * 5;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const bump = Math.sin(x * 0.012 + k * 1.7) * z * h * 0.012;
        ctx.lineTo(x, y + bump);
      }
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(sx + i * w * 0.02, horizon + h * 0.03);
      ctx.lineTo(sx + i * w * 0.2, h);
      ctx.stroke();
    }

    for (const c of SAGUAROS) {
      const ground = horizon + h * 0.03 + (h - horizon) * c.depth * c.depth;
      saguaro(ctx, c.x * w, ground, h * 0.32 * c.depth, c.arms);
    }
  },
};
