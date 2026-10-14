// Per-scene contrast normalization and signal telemetry, computed on a small CPU copy of the
// current frame. Cheap at this size (about 5k pixels) and it keeps the numbers on screen real.

const W = 96;
const H = 54;
const BINS = 256;
/** Contrast limit: no brightness bin may hold more than this multiple of an even share. */
const CLIP = 3.0;
/** Per-frame easing toward the new curve, so scene changes do not pump. */
const EASE = 0.08;

export class Analysis {
  /** Equalization curve as bytes, ready to upload as a 256x1 texture. */
  readonly cdf = new Uint8Array(BINS);
  /** Mean brightness of the frame, 0..1. */
  luma = 0;
  /** Mean absolute brightness change since the previous frame, 0..1. */
  motion = 0;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly smooth = new Float32Array(BINS).map((_, i) => i / (BINS - 1));
  private readonly hist = new Float32Array(BINS);
  private prev: Float32Array | null = null;
  private readonly cur = new Float32Array(W * H);

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
  }

  update(source: CanvasImageSource): void {
    this.ctx.drawImage(source, 0, 0, W, H);
    const px = this.ctx.getImageData(0, 0, W, H).data;

    this.hist.fill(0);
    let total = 0;
    let moved = 0;
    for (let i = 0; i < W * H; i++) {
      const l = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
      this.cur[i] = l;
      total += l;
      if (this.prev) moved += Math.abs(l - this.prev[i]);
      this.hist[Math.min(BINS - 1, Math.floor(l * BINS))]++;
    }
    const n = W * H;
    this.luma = total / n;
    this.motion = this.prev ? moved / n : 0;
    this.prev = this.prev ?? new Float32Array(n);
    this.prev.set(this.cur);

    // Contrast-limited equalization: clip tall bins and spread the excess evenly, so a big
    // flat backdrop cannot swallow the whole glyph range.
    const limit = (CLIP * n) / BINS;
    let excess = 0;
    for (let i = 0; i < BINS; i++) {
      if (this.hist[i] > limit) {
        excess += this.hist[i] - limit;
        this.hist[i] = limit;
      }
    }
    const share = excess / BINS;
    let run = 0;
    for (let i = 0; i < BINS; i++) {
      run += this.hist[i] + share;
      const target = run / n;
      this.smooth[i] += (target - this.smooth[i]) * EASE;
      this.cdf[i] = Math.round(Math.min(1, Math.max(0, this.smooth[i])) * 255);
    }
  }
}
