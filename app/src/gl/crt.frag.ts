// Pass C (optional): CRT scanlines, bloom and shadow mask.
//
// Ported to WebGL2 from "PUBLIC DOMAIN CRT STYLED SCAN-LINE SHADER" by Timothy Lottes, as
// distributed in libretro/glsl-shaders (crt/shaders/crt-lottes.glsl). The original is public
// domain ("Please take and use, change, or whatever."). Changes for DCC:
//   - RetroArch parameter plumbing replaced with constants; warp set to 0 so the field stays
//     aligned with the HTML laid over it.
//   - SourceSize is a virtual resolution (full width, one emulated line per uScanPitch device
//     px) rather than an emulated console's framebuffer.
//   - GLSL ES 3.00 syntax. The filter, scanline, bloom and mask math is unchanged.

export const CRT_FS = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uSource;
uniform vec2 uOutput;      // device px
uniform float uScanPitch;  // device px per emulated scanline

out vec4 outColor;

const float hardScan = -8.0;
const float hardPix = -3.0;
const float maskDark = 0.5;
const float maskLight = 1.5;
const float shadowMask = 3.0;
const float brightBoost = 1.0;
const float hardBloomPix = -1.5;
const float hardBloomScan = -2.0;
const float bloomAmount = 0.15;
const float shape = 2.0;

vec2 SourceSize;

float ToLinear1(float c) { return (c <= 0.04045) ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
vec3 ToLinear(vec3 c) { return vec3(ToLinear1(c.r), ToLinear1(c.g), ToLinear1(c.b)); }
float ToSrgb1(float c) { return (c < 0.0031308 ? c * 12.92 : 1.055 * pow(c, 0.41666) - 0.055); }
vec3 ToSrgb(vec3 c) { return vec3(ToSrgb1(c.r), ToSrgb1(c.g), ToSrgb1(c.b)); }

// Nearest emulated sample given floating point position and texel offset.
vec3 Fetch(vec2 pos, vec2 off) {
  pos = (floor(pos * SourceSize + off) + vec2(0.5, 0.5)) / SourceSize;
  return ToLinear(brightBoost * texture(uSource, pos).rgb);
}

// Distance in emulated pixels to nearest texel.
vec2 Dist(vec2 pos) {
  pos = pos * SourceSize;
  return -((pos - floor(pos)) - vec2(0.5));
}

// 1D Gaussian.
float Gaus(float pos, float scale) { return exp2(scale * pow(abs(pos), shape)); }

// 3-tap Gaussian filter along horz line.
vec3 Horz3(vec2 pos, float off) {
  vec3 b = Fetch(pos, vec2(-1.0, off));
  vec3 c = Fetch(pos, vec2(0.0, off));
  vec3 d = Fetch(pos, vec2(1.0, off));
  float dst = Dist(pos).x;
  float scale = hardPix;
  float wb = Gaus(dst - 1.0, scale);
  float wc = Gaus(dst + 0.0, scale);
  float wd = Gaus(dst + 1.0, scale);
  return (b * wb + c * wc + d * wd) / (wb + wc + wd);
}

// 5-tap Gaussian filter along horz line.
vec3 Horz5(vec2 pos, float off) {
  vec3 a = Fetch(pos, vec2(-2.0, off));
  vec3 b = Fetch(pos, vec2(-1.0, off));
  vec3 c = Fetch(pos, vec2(0.0, off));
  vec3 d = Fetch(pos, vec2(1.0, off));
  vec3 e = Fetch(pos, vec2(2.0, off));
  float dst = Dist(pos).x;
  float scale = hardPix;
  float wa = Gaus(dst - 2.0, scale);
  float wb = Gaus(dst - 1.0, scale);
  float wc = Gaus(dst + 0.0, scale);
  float wd = Gaus(dst + 1.0, scale);
  float we = Gaus(dst + 2.0, scale);
  return (a * wa + b * wb + c * wc + d * wd + e * we) / (wa + wb + wc + wd + we);
}

// 7-tap Gaussian filter along horz line.
vec3 Horz7(vec2 pos, float off) {
  vec3 a = Fetch(pos, vec2(-3.0, off));
  vec3 b = Fetch(pos, vec2(-2.0, off));
  vec3 c = Fetch(pos, vec2(-1.0, off));
  vec3 d = Fetch(pos, vec2(0.0, off));
  vec3 e = Fetch(pos, vec2(1.0, off));
  vec3 f = Fetch(pos, vec2(2.0, off));
  vec3 g = Fetch(pos, vec2(3.0, off));
  float dst = Dist(pos).x;
  float scale = hardBloomPix;
  float wa = Gaus(dst - 3.0, scale);
  float wb = Gaus(dst - 2.0, scale);
  float wc = Gaus(dst - 1.0, scale);
  float wd = Gaus(dst + 0.0, scale);
  float we = Gaus(dst + 1.0, scale);
  float wf = Gaus(dst + 2.0, scale);
  float wg = Gaus(dst + 3.0, scale);
  return (a * wa + b * wb + c * wc + d * wd + e * we + f * wf + g * wg) /
         (wa + wb + wc + wd + we + wf + wg);
}

// Return scanline weight.
float Scan(vec2 pos, float off) { return Gaus(Dist(pos).y + off, hardScan); }

// Return scanline weight for bloom.
float BloomScan(vec2 pos, float off) { return Gaus(Dist(pos).y + off, hardBloomScan); }

// Allow nearest three lines to effect pixel.
vec3 Tri(vec2 pos) {
  vec3 a = Horz3(pos, -1.0);
  vec3 b = Horz5(pos, 0.0);
  vec3 c = Horz3(pos, 1.0);
  float wa = Scan(pos, -1.0);
  float wb = Scan(pos, 0.0);
  float wc = Scan(pos, 1.0);
  return a * wa + b * wb + c * wc;
}

// Small bloom.
vec3 Bloom(vec2 pos) {
  vec3 a = Horz5(pos, -2.0);
  vec3 b = Horz7(pos, -1.0);
  vec3 c = Horz7(pos, 0.0);
  vec3 d = Horz7(pos, 1.0);
  vec3 e = Horz5(pos, 2.0);
  float wa = BloomScan(pos, -2.0);
  float wb = BloomScan(pos, -1.0);
  float wc = BloomScan(pos, 0.0);
  float wd = BloomScan(pos, 1.0);
  float we = BloomScan(pos, 2.0);
  return a * wa + b * wb + c * wc + d * wd + e * we;
}

// Stretched VGA style shadow mask (shadowMask 3 in the original).
vec3 Mask(vec2 pos) {
  vec3 mask = vec3(maskDark, maskDark, maskDark);
  pos.x += pos.y * 3.0;
  pos.x = fract(pos.x * 0.166666666);
  if (pos.x < 0.333) mask.r = maskLight;
  else if (pos.x < 0.666) mask.g = maskLight;
  else mask.b = maskLight;
  return mask;
}

void main() {
  SourceSize = vec2(uOutput.x, uOutput.y / uScanPitch);
  vec2 pos = gl_FragCoord.xy / uOutput;
  vec3 colour = Tri(pos);
  colour += Bloom(pos) * bloomAmount;
  colour *= Mask(gl_FragCoord.xy * 1.000001);
  outColor = vec4(ToSrgb(colour), 1.0);
}
`;
