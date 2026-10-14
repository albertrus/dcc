import { rand, stage, type Scene } from './source';

// Two server racks in a data hall: racked units with vents, drive bays and status lights,
// and a provisioning sweep running down the front rack.

interface Unit {
  y: number; // in U from the top
  u: number; // height in U
  kind: 'server' | 'storage' | 'switch' | 'blank';
  leds: { color: string; rate: number; phase: number; duty: number }[];
}

const LED = { green: '#3cff6b', amber: '#ffb21e', red: '#ff3b2f', blue: '#38a6ff' };

function layout(seed: number, total: number): Unit[] {
  const r = rand(seed);
  const units: Unit[] = [];
  let y = 1;
  while (y < total - 1) {
    const roll = r();
    const u = roll < 0.15 ? 1 : roll < 0.6 ? 2 : roll < 0.85 ? 3 : 4;
    if (y + u > total - 1) break;
    const kindRoll = r();
    const kind: Unit['kind'] =
      u === 1 ? (kindRoll < 0.6 ? 'switch' : 'blank') : kindRoll < 0.2 ? 'blank' : kindRoll < 0.5 ? 'storage' : 'server';
    const leds =
      kind === 'blank'
        ? []
        : Array.from({ length: kind === 'switch' ? 6 : 3 }, (_, i) => {
            const c = r();
            const color = i === 0 ? LED.green : c < 0.08 ? LED.red : c < 0.25 ? LED.amber : c < 0.35 ? LED.blue : LED.green;
            return { color, rate: 0.6 + r() * 3, phase: r(), duty: 0.3 + r() * 0.6 };
          });
    units.push({ y, u, kind, leds });
    y += u;
  }
  return units;
}

const FRONT = layout(7, 42);
const SIDE = layout(23, 42);

function drawRack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  units: Unit[],
  t: number,
  sweep: boolean,
) {
  const unitH = (h - w * 0.08) / 42;
  const railX = x + w * 0.07;
  const railW = w * 0.86;
  const top = y + w * 0.04;

  // Frame and dark interior.
  ctx.fillStyle = '#121418';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#07080a';
  ctx.fillRect(railX, top, railW, unitH * 42);

  for (const unit of units) {
    const uy = top + unit.y * unitH;
    const uh = unit.u * unitH - 1.5;
    if (unit.kind === 'blank') {
      ctx.fillStyle = '#23262b';
      ctx.fillRect(railX, uy, railW, uh);
      continue;
    }
    // Face plate with a lit top edge.
    ctx.fillStyle = unit.kind === 'switch' ? '#5e646c' : '#6c727a';
    ctx.fillRect(railX, uy, railW, uh);
    ctx.fillStyle = '#a7adb5';
    ctx.fillRect(railX, uy, railW, Math.max(1.5, unitH * 0.12));

    if (unit.kind === 'server') {
      // Vent slots on the left, drive bays on the right.
      ctx.fillStyle = '#15171a';
      for (let vx = railX + railW * 0.05; vx < railX + railW * 0.42; vx += 7) {
        ctx.fillRect(vx, uy + uh * 0.25, 3.5, uh * 0.6);
      }
      ctx.fillStyle = '#8e959e';
      const bays = 4;
      for (let b = 0; b < bays; b++) {
        const bx = railX + railW * (0.48 + b * 0.1);
        ctx.fillRect(bx, uy + uh * 0.22, railW * 0.085, uh * 0.62);
      }
    } else if (unit.kind === 'storage') {
      ctx.fillStyle = '#9aa1aa';
      const cols = 12;
      const rows = Math.max(1, unit.u - 1);
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          ctx.fillRect(
            railX + railW * (0.05 + c * 0.075),
            uy + uh * (0.2 + (r * 0.7) / rows),
            railW * 0.06,
            (uh * 0.6) / rows,
          );
        }
      }
    } else {
      // Switch: a row of ports.
      ctx.fillStyle = '#0d0f12';
      for (let p = 0; p < 24; p++) {
        ctx.fillRect(railX + railW * (0.08 + p * 0.032), uy + uh * 0.3, railW * 0.022, uh * 0.45);
      }
    }

    // Status lights with a soft glow so they cover a few samples.
    unit.leds.forEach((led, i) => {
      const on = (t * led.rate + led.phase) % 1 < led.duty;
      if (!on) return;
      const lx = railX + railW * (0.93 - i * 0.035);
      const ly = uy + uh * 0.5;
      const r = Math.max(3, unitH * 0.45);
      const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, r * 2.2);
      glow.addColorStop(0, led.color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(lx - r * 2.2, ly - r * 2.2, r * 4.4, r * 4.4);
    });
  }

  // Provisioning sweep: a bright band travelling down the rack every 6 s.
  if (sweep) {
    const p = (t % 6) / 6;
    const sy = top + p * unitH * 42;
    const band = ctx.createLinearGradient(0, sy - unitH * 3, 0, sy + unitH * 3);
    band.addColorStop(0, 'rgba(255,255,255,0)');
    band.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    band.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = band;
    ctx.fillRect(railX, sy - unitH * 3, railW, unitH * 6);
  }
}

export const rackScene: Scene = {
  title: 'SERVER RACK',
  kind: 'HARDWARE',
  draw(ctx, w, h, t) {
    // Data hall. The wall sits near the median brightness so neither theme prints it: light
    // paper inks the racks' darks, dark paper lights their bezels, bays and status lights.
    // Flat on purpose: one brightness lands in one histogram bin, mid-curve.
    ctx.fillStyle = '#585c62';
    ctx.fillRect(0, 0, w, h);

    const floorY = h * 0.9;
    ctx.fillStyle = '#2a2d31';
    ctx.fillRect(0, floorY, w, h - floorY);
    ctx.strokeStyle = '#4b5057';
    ctx.lineWidth = 2;
    for (let i = -10; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + i * w * 0.06, floorY);
      ctx.lineTo(w / 2 + i * w * 0.16, h);
      ctx.stroke();
    }

    // Overhead cable tray.
    ctx.fillStyle = '#2e3136';
    ctx.fillRect(0, h * 0.03, w, h * 0.025);

    const s = stage(w, h);
    const rackH = h * 0.84;
    const rackW = Math.min(rackH * 0.34, s.size * 0.42);
    const drift = Math.sin(t * 0.25) * rackW * 0.04;
    const x = s.cx - rackW * 0.75 + drift;
    const y = h * 0.06;

    // Side rack first (further back), then the front rack over it.
    ctx.save();
    ctx.globalAlpha = 0.85;
    drawRack(ctx, x + rackW * 1.1, y + rackH * 0.03, rackW * 0.92, rackH * 0.94, SIDE, t + 3, false);
    ctx.restore();
    drawRack(ctx, x, y, rackW, rackH, FRONT, t, true);
  },
};
