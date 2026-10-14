// The scene layer. The ASCII pipeline only ever sees a FrameSource: something that can hand
// over a frame at the grid's sample resolution. Drawn scenes are one kind; a <video> or a
// webcam can be another (draw it into the same canvas) without touching the pipeline.

export interface FrameSource {
  /** Shown in the SOURCE telemetry block. */
  readonly title: string;
  readonly kind: string;
  /** Render the frame for time t (seconds since this source came on screen). */
  frame(t: number, viewW: number, viewH: number, sampleW: number, sampleH: number): HTMLCanvasElement;
}

/** A scene drawn with Canvas2D in CSS-pixel coordinates of the viewport. */
export interface Scene {
  readonly title: string;
  readonly kind: string;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void;
}

/**
 * Wraps a drawn Scene as a FrameSource. The canvas is the sample grid (2x3 per cell), and
 * the context is scaled so scenes draw in viewport CSS px; canvas antialiasing does the area
 * averaging that turns shapes into smooth per-sample brightness.
 */
export class DrawnSource implements FrameSource {
  readonly title: string;
  readonly kind: string;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;

  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
    this.title = scene.title;
    this.kind = scene.kind;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
  }

  frame(t: number, viewW: number, viewH: number, sampleW: number, sampleH: number) {
    if (this.canvas.width !== sampleW || this.canvas.height !== sampleH) {
      this.canvas.width = sampleW;
      this.canvas.height = sampleH;
    }
    const ctx = this.ctx;
    ctx.setTransform(sampleW / viewW, 0, 0, sampleH / viewH, 0, 0);
    this.scene.draw(ctx, viewW, viewH, t);
    return this.canvas;
  }
}

/** Where the subject goes: right of the title on wide screens, centred on narrow ones. */
export function stage(w: number, h: number) {
  const wide = w > h * 1.1;
  return {
    cx: wide ? w * 0.68 : w * 0.5,
    cy: wide ? h * 0.5 : h * 0.6,
    size: wide ? Math.min(w * 0.5, h * 0.9) : Math.min(w * 0.9, h * 0.55),
  };
}

export const rand = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
