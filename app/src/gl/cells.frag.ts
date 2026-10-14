// Pass A: one fragment per character cell. Decides which glyph the cell shows, how strongly,
// and in what colour. Everything interactive (pointer trail, click blast, scene-change
// decode) and every mask (screen edges, quiet zones under the HUD) is resolved here, so the
// compose pass only has to draw what this pass decided.

export const MAX_TRAIL = 48;
export const MAX_PING = 6;
export const MAX_QUIET = 8;
export const MAX_MATCH = 96;

export const CELLS_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

#define MAX_TRAIL ${MAX_TRAIL}
#define MAX_PING ${MAX_PING}
#define MAX_QUIET ${MAX_QUIET}
#define MAX_MATCH ${MAX_MATCH}
#define SPARKS 18

uniform sampler2D uScene;       // current scene at 2x3 samples per cell
uniform sampler2D uSceneNext;   // incoming scene during a transition
uniform float uMix;             // < 0: no transition; 0..1: share of cells switched over
uniform sampler2D uCdf;         // 256x1 equalization curve for the current scene
uniform sampler2D uMatch;       // glyph table, 2 rows: (tl, tr, ml, index) and (mr, bl, br, -)
uniform int uMatchN;
uniform ivec4 uLines;           // glyph indices for | / - and backslash
uniform int uGlyphCount;

uniform ivec2 uGrid;            // cols, rows
uniform vec2 uCell;             // css px per cell
uniform vec2 uView;             // css px covered by the grid
uniform float uNow;             // seconds
uniform float uLight;           // 1: light paper, darks print as ink. 0: dark paper, brights glow
uniform vec3 uAccent;

uniform vec4 uTrail[MAX_TRAIL]; // x, y, born, radius
uniform int uTrailN;
uniform float uTrailLife;
uniform vec4 uPing[MAX_PING];   // x, y, born, radius
uniform int uPingN;
uniform float uBlastTime;
uniform vec4 uQuiet[MAX_QUIET]; // x0, y0, x1, y1 rectangles the field stays out of
uniform int uQuietN;
uniform float uFeather;

layout(location = 0) out vec4 outCell;  // glyph / 255, glyph alpha, colour share, 1
layout(location = 1) out vec4 outTint;  // tint rgb, tile (background) alpha

float hash(ivec2 p) {
  uvec2 q = uvec2(p) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) / 4294967295.0;
}

float valueNoise(vec2 p) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + ivec2(1, 0)), f.x),
             mix(hash(i + ivec2(0, 1)), hash(i + ivec2(1, 1)), f.x), f.y);
}

// Each cell's own dropout threshold, half white noise and half clumped noise, so masked
// edges fray in irregular clusters instead of a square cut or a salt-and-pepper fringe.
float dropout(ivec2 cell) {
  return 0.55 * hash(cell + ivec2(17, 3)) + 0.45 * valueNoise(vec2(cell) * vec2(0.17, 0.31));
}

float boxDistance(vec2 p, vec4 r) {
  vec2 c = 0.5 * (r.xy + r.zw);
  vec2 h = 0.5 * (r.zw - r.xy);
  vec2 d = abs(p - c) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// The cell's hue at full strength with saturation pushed up; grey falls back to the accent.
vec3 vivid(vec3 rgb, float sat) {
  float peak = max(max(rgb.r, rgb.g), rgb.b);
  if (peak < 1e-3 || sat < 0.12) return uAccent;
  vec3 hue = rgb / peak;
  return clamp(mix(vec3(luma(hue)), hue, 1.7), 0.0, 1.0);
}

// Equalized brightness to ink. Light paper prints the darkest half like a print; dark paper
// lights the brightest ~58% like an engraving. uLight crossfades during a theme change.
float inkFor(float eq) {
  float print = pow(1.0 - smoothstep(0.0, 0.46, eq), 1.4);
  float glow = smoothstep(0.4, 0.92, eq);
  return mix(glow, print, uLight);
}

vec3 sampleScene(vec2 p, bool next) {
  vec2 uv = clamp(p / uView, vec2(0.0), vec2(1.0));
  return next ? textureLod(uSceneNext, uv, 0.0).rgb : textureLod(uScene, uv, 0.0).rgb;
}

void main() {
  ivec2 frag = ivec2(gl_FragCoord.xy);
  ivec2 cell = ivec2(frag.x, uGrid.y - 1 - frag.y);
  vec2 px = (vec2(cell) + 0.5) * uCell;

  // ---- Masks: screen edges and quiet zones dissolve per cell -------------------------
  float m = 1.0;
  vec2 edge = min(px, uView - px);
  m *= smoothstep(0.0, uFeather * 1.6, min(edge.x, edge.y * 1.4));
  for (int k = 0; k < MAX_QUIET; k++) {
    if (k >= uQuietN) break;
    m *= smoothstep(0.0, uFeather, boxDistance(px, uQuiet[k]));
  }
  float th = dropout(cell);
  bool keep = m > th * 0.98 + 0.01;
  float fringe = smoothstep(th, th + 0.3, m); // survivors near a mask print lighter

  // ---- Click blasts: fragments thrown outward, broken cells, sparks ------------------
  float brk = 0.0;
  float spark = 0.0;
  vec2 push = vec2(0.0);
  for (int k = 0; k < MAX_PING; k++) {
    if (k >= uPingN) break;
    vec4 p = uPing[k];
    float t = (uNow - p.z) / uBlastTime;
    if (t < 0.0 || t > 1.0) continue;
    int seed = int(fract(p.z * 13.37) * 10000.0);
    vec2 d = px - p.xy;
    float dist = length(d);
    vec2 dir = dist > 1e-3 ? d / dist : vec2(0.0);
    float travel = 1.0 - pow(1.0 - t, 3.0);
    float ragged = 0.7 + 0.6 * hash(cell + ivec2(seed, 41));
    float front = p.w * (0.35 + 0.9 * travel) * ragged;
    float hit = 1.0 - smoothstep(front * 0.55, front, dist);
    float settle = (1.0 - t) * (1.0 - t);
    brk = max(brk, hit * settle);
    push += dir * p.w * 0.5 * travel * hit * (1.0 - t);
    for (int s = 0; s < SPARKS; s++) {
      if (t > mix(0.4, 1.0, hash(ivec2(seed + s * 7, 5)))) continue;
      float a = 6.2831853 * hash(ivec2(s * 13 + 1, seed));
      float reach = mix(1.0, 2.8, hash(ivec2(seed + 3, s * 5)));
      vec2 at = p.xy + vec2(cos(a), sin(a)) * p.w * reach * travel;
      if (ivec2(floor(at / uCell)) == cell) spark = 1.0;
    }
  }

  // ---- Six samples per cell (2 wide, 3 tall), equalized, mapped to ink ---------------
  bool next = uMix >= 0.0 && uMix > th;
  float decode = uMix >= 0.0 ? 1.0 - smoothstep(0.0, 0.035, abs(uMix - th)) : 0.0;

  float s[6];
  vec3 rgb = vec3(0.0);
  vec2 sub = uCell / vec2(2.0, 3.0);
  vec2 origin = px - push - 0.5 * uCell + 0.5 * sub;
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 2; i++) {
      vec3 c = sampleScene(origin + vec2(float(i), float(j)) * sub, next);
      rgb += c;
      float l = clamp(luma(c), 0.0, 1.0);
      float eq = textureLod(uCdf, vec2(l * (255.0 / 256.0) + 0.5 / 256.0, 0.5), 0.0).r;
      s[j * 2 + i] = inkFor(eq);
    }
  }
  rgb /= 6.0;

  // ---- Pointer trail: fading, shrinking stamps merged as a soft union ----------------
  float clear = 1.0;
  for (int k = 0; k < MAX_TRAIL; k++) {
    if (k >= uTrailN) break;
    vec4 g = uTrail[k];
    float life = clamp(1.0 - (uNow - g.z) / uTrailLife, 0.0, 1.0);
    if (life <= 0.0) continue;
    float r = g.w * mix(0.35, 1.0, life);
    float w = 1.0 - smoothstep(r * 0.35, r, length(px - g.xy));
    clear *= 1.0 - w * life;
  }
  float glow = (1.0 - clear) * smoothstep(0.0, 0.4, m);

  float mean = 0.0;
  float mx = 0.0;
  for (int k = 0; k < 6; k++) {
    s[k] = min(1.0, s[k] + glow * 0.55); // density boost where the trail passes
    mean += s[k];
    mx = max(mx, s[k]);
  }
  mean /= 6.0;

  // ---- Glyph choice -------------------------------------------------------------------
  int glyph = 0;
  float gx = ((s[1] + s[3] + s[5]) - (s[0] + s[2] + s[4])) / 3.0;
  float gy = ((s[4] + s[5]) - (s[0] + s[1])) * 0.5;
  float grad = length(vec2(gx, gy));

  if (grad > 0.3 && mx > 0.3 && glow < 0.15) {
    // Contour: a stroke along the edge tangent, picked from the gradient angle.
    float a = mod(atan(gy, gx), 3.14159265);
    int q = int(floor(a / 0.78539816 + 0.5)) % 4;
    glyph = q == 0 ? uLines.x : q == 1 ? uLines.y : q == 2 ? uLines.z : uLines.w;
  } else {
    // Shape match against each glyph's measured 2x3 coverage. Under the trail, match the
    // flat mean instead, so the lift reads as solid fill rather than shape.
    float v[6];
    for (int k = 0; k < 6; k++) v[k] = glow > 0.15 ? mean : s[k];
    float best = 1e9;
    for (int k = 0; k < MAX_MATCH; k++) {
      if (k >= uMatchN) break;
      vec4 a = texelFetch(uMatch, ivec2(k, 0), 0);
      vec4 b = texelFetch(uMatch, ivec2(k, 1), 0);
      vec3 d0 = vec3(v[0], v[1], v[2]) - a.xyz;
      vec3 d1 = vec3(v[3], v[4], v[5]) - b.xyz;
      float e = dot(d0, d0) + dot(d1, d1);
      if (e < best) {
        best = e;
        glyph = int(a.w * 255.0 + 0.5);
      }
    }
  }

  float alpha = glyph == 0 ? 0.0 : mix(0.4, 1.0, mx) * mix(0.55, 1.0, fringe);

  // ---- Colour -------------------------------------------------------------------------
  float peak = max(max(rgb.r, rgb.g), rgb.b);
  float low = min(min(rgb.r, rgb.g), rgb.b);
  float sat = peak > 1e-3 ? (peak - low) / peak : 0.0;
  vec3 tint = vivid(rgb, sat);
  // Emissive detail (status lights, the sun) keeps its colour; the trail recolours whatever
  // it crosses with the scene's own hue, or the accent over grey.
  float share = max(smoothstep(0.35, 0.7, sat) * smoothstep(0.3, 0.7, peak), glow);
  float tile = glow * mix(0.36, 0.26, uLight);

  // ---- Scene change: cells flicker through random glyphs as they cross over ------------
  if (decode > 0.0) {
    int tick = int(uNow * 24.0);
    if (hash(cell + ivec2(tick * 5, 211)) < decode * 0.6) {
      glyph = 1 + int(hash(cell + ivec2(tick * 3, 77)) * float(uGlyphCount - 1));
      alpha = 0.9;
      share = 1.0;
      tint = uAccent;
    }
  }

  // ---- Blast overrides --------------------------------------------------------------
  if (brk > 0.02 || spark > 0.0) {
    int tick = int(uNow * 20.0);
    float roll = hash(cell + ivec2(tick * 13, 517));
    if (spark > 0.0 || roll < brk * 0.7) {
      glyph = 1 + int(hash(cell + ivec2(tick * 7, 99)) * float(uGlyphCount - 1));
      alpha = 1.0;
      share = 1.0;
      tint = vivid(rgb, sat);
      tile = max(tile, 0.2 * brk + 0.3 * spark);
    } else if (roll < brk * 0.9) {
      glyph = 0; // knocked out: empty cell, tile and all
      alpha = 0.0;
      tile = 0.0;
    }
  }

  if (!keep) {
    glyph = 0;
    alpha = 0.0;
    tile = 0.0;
  }

  outCell = vec4(float(glyph) / 255.0, alpha, share, 1.0);
  outTint = vec4(tint, tile);
}
`;
