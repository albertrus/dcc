export type GL = WebGL2RenderingContext;

/** Fullscreen triangle from gl_VertexID, so no vertex buffers are needed. */
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

function compile(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed:\n${log}`);
  }
  return shader;
}

export class Program {
  readonly handle: WebGLProgram;
  private readonly gl: GL;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  constructor(gl: GL, fragment: string) {
    this.gl = gl;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VS));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed:\n${gl.getProgramInfoLog(program)}`);
    }
    this.handle = program;
  }

  use(): this {
    this.gl.useProgram(this.handle);
    return this;
  }

  private loc(name: string): WebGLUniformLocation | null {
    let l = this.locations.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.handle, name);
      this.locations.set(name, l);
    }
    return l;
  }

  f1(name: string, x: number): this {
    this.gl.uniform1f(this.loc(name), x);
    return this;
  }
  f2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.loc(name), x, y);
    return this;
  }
  f3(name: string, v: readonly number[]): this {
    this.gl.uniform3f(this.loc(name), v[0], v[1], v[2]);
    return this;
  }
  i1(name: string, x: number): this {
    this.gl.uniform1i(this.loc(name), x);
    return this;
  }
  i2(name: string, x: number, y: number): this {
    this.gl.uniform2i(this.loc(name), x, y);
    return this;
  }
  i4(name: string, x: number, y: number, z: number, w: number): this {
    this.gl.uniform4i(this.loc(name), x, y, z, w);
    return this;
  }
  f4v(name: string, data: Float32Array): this {
    this.gl.uniform4fv(this.loc(`${name}[0]`), data);
    return this;
  }
  tex(name: string, unit: number, texture: WebGLTexture): this {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.loc(name), unit);
    return this;
  }
}

export interface TextureOptions {
  internal?: number;
  format?: number;
  type?: number;
  filter?: number;
}

export function createTexture(gl: GL, w: number, h: number, o: TextureOptions = {}): WebGLTexture {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    o.internal ?? gl.RGBA8,
    w,
    h,
    0,
    o.format ?? gl.RGBA,
    o.type ?? gl.UNSIGNED_BYTE,
    null,
  );
  const filter = o.filter ?? gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export interface Target {
  fbo: WebGLFramebuffer;
  textures: WebGLTexture[];
  width: number;
  height: number;
}

/** A framebuffer with `count` RGBA8 colour attachments (multiple render targets). */
export function createTarget(gl: GL, w: number, h: number, count: number, filter?: number): Target {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const textures: WebGLTexture[] = [];
  const buffers: number[] = [];
  for (let i = 0; i < count; i++) {
    const tex = createTexture(gl, w, h, { filter });
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
    textures.push(tex);
    buffers.push(gl.COLOR_ATTACHMENT0 + i);
  }
  gl.drawBuffers(buffers);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incomplete: ${status}`);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, textures, width: w, height: h };
}

export function deleteTarget(gl: GL, t: Target | null): void {
  if (!t) return;
  for (const tex of t.textures) gl.deleteTexture(tex);
  gl.deleteFramebuffer(t.fbo);
}
