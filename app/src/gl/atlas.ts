// Glyph atlas: every printable ASCII character rendered once into a single row, plus each
// glyph's measured ink coverage in a 2x3 grid. Pass A matches cells against that coverage,
// so glyph choice follows the real font on this machine rather than a hand-tuned table.

export const FIRST_CODE = 32;
export const GLYPH_COUNT = 95; // ' ' through '~'

export const glyphIndex = (ch: string): number => ch.charCodeAt(0) - FIRST_CODE;

/**
 * Candidates for shape matching: punctuation and density glyphs only. Letters match well
 * numerically but read as words, which turns imagery into noise.
 */
const MATCH_SET = " .,:;'`-_~^\"=+*<>!/\\|()[]{}#%@";

/** Contour strokes by edge direction: vertical, rising, horizontal, falling. */
export const LINE_GLYPHS = ['|', '/', '-', '\\'] as const;

export const MONO_STACK =
  'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace';

export interface Atlas {
  canvas: HTMLCanvasElement;
  cellW: number;
  cellH: number;
  /** RGBA bytes, width = match count, height 2: (tl, tr, ml, index) then (mr, bl, br, 0). */
  matchTable: Uint8Array;
  matchCount: number;
}

export function buildAtlas(cellW: number, cellH: number): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = cellW * GLYPH_COUNT;
  canvas.height = cellH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D context unavailable');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  const size = Math.floor(Math.min(cellH * 0.8, (cellW / 0.6) * 0.98));
  ctx.font = `${size}px ${MONO_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < GLYPH_COUNT; i++) {
    ctx.fillText(String.fromCharCode(FIRST_CODE + i), i * cellW + cellW / 2, cellH * 0.54);
  }

  // Coverage per glyph in a 2x3 grid.
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const coverage = new Float32Array(GLYPH_COUNT * 6);
  for (let g = 0; g < GLYPH_COUNT; g++) {
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 2; i++) {
        const x0 = g * cellW + Math.floor((i * cellW) / 2);
        const x1 = g * cellW + Math.floor(((i + 1) * cellW) / 2);
        const y0 = Math.floor((j * cellH) / 3);
        const y1 = Math.floor(((j + 1) * cellH) / 3);
        let sum = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) sum += data[(y * canvas.width + x) * 4];
        }
        coverage[g * 6 + j * 2 + i] = sum / (255 * (x1 - x0) * (y1 - y0));
      }
    }
  }

  // Normalize so the densest candidate means "full ink" (1.0).
  const candidates = [...new Set(MATCH_SET)].map(glyphIndex);
  let densest = 0;
  for (const g of candidates) {
    let mean = 0;
    for (let k = 0; k < 6; k++) mean += coverage[g * 6 + k];
    densest = Math.max(densest, mean / 6);
  }
  const scale = densest > 0 ? 1 / densest : 1;
  const byte = (v: number) => Math.round(Math.min(1, v * scale) * 255);

  const n = candidates.length;
  const matchTable = new Uint8Array(n * 2 * 4);
  candidates.forEach((g, k) => {
    const c = (q: number) => byte(coverage[g * 6 + q]);
    matchTable.set([c(0), c(1), c(2), g], k * 4);
    matchTable.set([c(3), c(4), c(5), 0], (n + k) * 4);
  });

  return { canvas, cellW, cellH, matchTable, matchCount: n };
}
