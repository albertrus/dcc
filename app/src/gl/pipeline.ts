import { buildAtlas, glyphIndex, GLYPH_COUNT, LINE_GLYPHS, type Atlas } from './atlas';
import { CELLS_FS, MAX_PING, MAX_QUIET, MAX_TRAIL } from './cells.frag';
import { COMPOSE_FS } from './compose.frag';
import { CRT_FS } from './crt.frag';
import { createTarget, createTexture, deleteTarget, Program, type GL, type Target } from './gl';

/** Cell size in CSS px before rounding to whole device pixels. */
const CELL_CSS = { w: 7, h: 12 };

export interface Grid {
  cols: number;
  rows: number;
  /** CSS px per cell (device-pixel exact). */
  cellW: number;
  cellH: number;
  /** CSS px covered by the grid; the scene is drawn at this size. */
  viewW: number;
  viewH: number;
  /** Scene sample resolution: 2 x 3 samples per cell. */
  sampleW: number;
  sampleH: number;
}

export interface Palette {
  paper: readonly number[];
  ink: readonly number[];
  accent: readonly number[];
}

export interface FrameInput {
  now: number;
  scene: TexImageSource;
  next: TexImageSource | null;
  /** Transition progress, or -1 when no transition is running. */
  mix: number;
  cdf: Uint8Array;
  light: number;
  palette: Palette;
  trail: Float32Array;
  trailCount: number;
  trailLife: number;
  pings: Float32Array;
  pingCount: number;
  blastTime: number;
  quiet: Float32Array;
  quietCount: number;
  crt: boolean;
}

export class Pipeline {
  readonly gl: GL;
  grid!: Grid;

  private readonly cells: Program;
  private readonly compose: Program;
  private readonly crt: Program;
  private readonly vao: WebGLVertexArrayObject;
  private readonly sceneTex: WebGLTexture;
  private readonly nextTex: WebGLTexture;
  private readonly cdfTex: WebGLTexture;
  private atlasTex: WebGLTexture | null = null;
  private matchTex: WebGLTexture | null = null;
  private atlas: Atlas | null = null;
  private cellTarget: Target | null = null;
  private composeTarget: Target | null = null;
  private cellDevW = 0;
  private cellDevH = 0;

  /** Optional GPU timing (dev only): mean GPU ms per frame over recent frames. */
  gpuMs = 0;
  private timer: { ext: object; pending: WebGLQuery[]; samples: number[] } | null = null;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.cells = new Program(gl, CELLS_FS);
    this.compose = new Program(gl, COMPOSE_FS);
    this.crt = new Program(gl, CRT_FS);
    this.vao = gl.createVertexArray();
    this.sceneTex = createTexture(gl, 1, 1, { filter: gl.LINEAR });
    this.nextTex = createTexture(gl, 1, 1, { filter: gl.LINEAR });
    this.cdfTex = createTexture(gl, 256, 1, {
      internal: gl.R8,
      format: gl.RED,
      filter: gl.LINEAR,
    });
  }

  /** Turn on GPU frame timing, if the browser exposes EXT_disjoint_timer_query_webgl2. */
  enableTiming(): boolean {
    const ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (ext) this.timer = { ext, pending: [], samples: [] };
    return !!ext;
  }

  private readTimers(): void {
    const gl = this.gl;
    const t = this.timer;
    if (!t) return;
    const GPU_DISJOINT = 0x8fbb; // GPU_DISJOINT_EXT
    while (t.pending.length) {
      const q = t.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      t.pending.shift();
      if (!gl.getParameter(GPU_DISJOINT)) {
        t.samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        if (t.samples.length > 60) t.samples.shift();
        this.gpuMs = t.samples.reduce((a, b) => a + b, 0) / t.samples.length;
      }
      gl.deleteQuery(q);
    }
  }

  /** Size everything to the viewport. Returns the new grid. */
  resize(cssW: number, cssH: number, dpr: number): Grid {
    const gl = this.gl;
    const cellDevW = Math.max(4, Math.round(CELL_CSS.w * dpr));
    const cellDevH = Math.max(7, Math.round(CELL_CSS.h * dpr));
    const devW = Math.round(cssW * dpr);
    const devH = Math.round(cssH * dpr);
    this.canvas.width = devW;
    this.canvas.height = devH;

    const cellW = cellDevW / dpr;
    const cellH = cellDevH / dpr;
    const cols = Math.ceil(cssW / cellW);
    const rows = Math.ceil(cssH / cellH);
    this.grid = {
      cols,
      rows,
      cellW,
      cellH,
      viewW: cols * cellW,
      viewH: rows * cellH,
      sampleW: cols * 2,
      sampleH: rows * 3,
    };

    if (cellDevW !== this.cellDevW || cellDevH !== this.cellDevH || !this.atlas) {
      this.cellDevW = cellDevW;
      this.cellDevH = cellDevH;
      this.uploadAtlas(buildAtlas(cellDevW, cellDevH));
    }

    deleteTarget(gl, this.cellTarget);
    deleteTarget(gl, this.composeTarget);
    this.cellTarget = createTarget(gl, cols, rows, 2);
    this.composeTarget = createTarget(gl, devW, devH, 1, gl.LINEAR);
    return this.grid;
  }

  private uploadAtlas(atlas: Atlas): void {
    const gl = this.gl;
    this.atlas = atlas;
    if (this.atlasTex) gl.deleteTexture(this.atlasTex);
    if (this.matchTex) gl.deleteTexture(this.matchTex);

    this.atlasTex = createTexture(gl, atlas.canvas.width, atlas.canvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);

    this.matchTex = createTexture(gl, atlas.matchCount, 2);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, atlas.matchCount, 2, gl.RGBA, gl.UNSIGNED_BYTE, atlas.matchTable);
  }

  render(f: FrameInput): void {
    const gl = this.gl;
    const g = this.grid;
    const atlas = this.atlas;
    const cellTarget = this.cellTarget;
    const composeTarget = this.composeTarget;
    if (!atlas || !cellTarget || !composeTarget || !this.atlasTex || !this.matchTex) return;

    gl.bindVertexArray(this.vao);
    let query: WebGLQuery | null = null;
    if (this.timer) {
      this.readTimers();
      query = gl.createQuery();
      gl.beginQuery(0x88bf /* TIME_ELAPSED_EXT */, query);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, f.scene);
    if (f.next) {
      gl.bindTexture(gl.TEXTURE_2D, this.nextTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, f.next);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.cdfTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.UNSIGNED_BYTE, f.cdf);

    // Pass A: one fragment per cell.
    gl.bindFramebuffer(gl.FRAMEBUFFER, cellTarget.fbo);
    gl.viewport(0, 0, g.cols, g.rows);
    this.cells
      .use()
      .tex('uScene', 0, this.sceneTex)
      .tex('uSceneNext', 1, f.next ? this.nextTex : this.sceneTex)
      .tex('uCdf', 2, this.cdfTex)
      .tex('uMatch', 3, this.matchTex)
      .f1('uMix', f.mix)
      .i1('uMatchN', atlas.matchCount)
      .i4('uLines', ...(LINE_GLYPHS.map(glyphIndex) as [number, number, number, number]))
      .i1('uGlyphCount', GLYPH_COUNT)
      .i2('uGrid', g.cols, g.rows)
      .f2('uCell', g.cellW, g.cellH)
      .f2('uView', g.viewW, g.viewH)
      .f1('uNow', f.now)
      .f1('uLight', f.light)
      .f3('uAccent', f.palette.accent)
      .f4v('uTrail', f.trail.subarray(0, MAX_TRAIL * 4))
      .i1('uTrailN', Math.min(f.trailCount, MAX_TRAIL))
      .f1('uTrailLife', f.trailLife)
      .f4v('uPing', f.pings.subarray(0, MAX_PING * 4))
      .i1('uPingN', Math.min(f.pingCount, MAX_PING))
      .f1('uBlastTime', f.blastTime)
      .f4v('uQuiet', f.quiet.subarray(0, MAX_QUIET * 4))
      .i1('uQuietN', Math.min(f.quietCount, MAX_QUIET))
      .f1('uFeather', 56);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Pass B: glyphs onto paper, straight to the screen or into the CRT input.
    const devW = this.canvas.width;
    const devH = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.crt ? composeTarget.fbo : null);
    gl.viewport(0, 0, devW, devH);
    this.compose
      .use()
      .tex('uCells', 0, cellTarget.textures[0])
      .tex('uTint', 1, cellTarget.textures[1])
      .tex('uAtlas', 2, this.atlasTex)
      .i2('uGrid', g.cols, g.rows)
      .i2('uCellDev', this.cellDevW, this.cellDevH)
      .i2('uDev', devW, devH)
      .f3('uPaper', f.palette.paper)
      .f3('uInk', f.palette.ink)
      .f1('uLight', f.light);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Pass C: CRT.
    if (f.crt) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.crt
        .use()
        .tex('uSource', 0, composeTarget.textures[0])
        .f2('uOutput', devW, devH)
        .f1('uScanPitch', Math.max(2, Math.round(1.5 * (devW / this.canvas.clientWidth || 1))));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    if (query && this.timer) {
      gl.endQuery(0x88bf);
      this.timer.pending.push(query);
    }
  }
}
