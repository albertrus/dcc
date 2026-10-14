// Pass B: draw every cell's glyph from the atlas onto the paper, with its tile behind it.

export const COMPOSE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uCells;  // from pass A: glyph, alpha, colour share
uniform sampler2D uTint;   // from pass A: tint rgb, tile alpha
uniform sampler2D uAtlas;  // one row of glyphs, uCellDev pixels each
uniform ivec2 uGrid;
uniform ivec2 uCellDev;    // device px per cell, integral so glyph texels map 1:1
uniform ivec2 uDev;        // canvas size in device px
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uLight;

out vec4 outColor;

void main() {
  ivec2 p = ivec2(int(gl_FragCoord.x), uDev.y - 1 - int(gl_FragCoord.y));
  ivec2 cell = p / uCellDev;
  if (cell.x >= uGrid.x || cell.y >= uGrid.y) {
    outColor = vec4(uPaper, 1.0);
    return;
  }
  ivec2 local = p - cell * uCellDev;
  ivec2 tc = ivec2(cell.x, uGrid.y - 1 - cell.y);
  vec4 c = texelFetch(uCells, tc, 0);
  vec4 t = texelFetch(uTint, tc, 0);
  int g = int(c.x * 255.0 + 0.5);
  float coverage = texelFetch(uAtlas, ivec2(g * uCellDev.x + local.x, local.y), 0).r;

  vec3 background = mix(uPaper, t.rgb, t.a);
  // On light paper a tint prints as a deeper shade so it still reads as ink.
  vec3 glyphColour = mix(uInk, t.rgb * mix(1.0, 0.5, uLight), c.z);
  outColor = vec4(mix(background, glyphColour, coverage * c.y), 1.0);
}
`;
