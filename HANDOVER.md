# DCC handover

Context for whoever picks this up next. Written 2026-10-14.

## What DCC is

A data simulator with an ASCII-rendered interface. Six APIs feed a set of
datasets, each dataset carries a single completion percentage, and the user
navigates them as physical objects rather than through menus.

The visual language was inspired by labs.xbox.com. Nothing from that site has
been copied: no branding, no copy strings, no code. Keep it that way.

## The concept model

Four nested levels, each a real shape:

| Level | Object | Contains |
|---|---|---|
| 0 | Universe | solar systems |
| 1 | Solar system | clusters, on orbits |
| 2 | Cluster | a Hoberman sphere with cubes at its vertices |
| 3 | Data cube | six faces, one per API |
| 4 | API surface | the actual records. Terminal. |

The Hoberman sphere matters: it is the expanding and collapsing scissor-linkage
kind. Its breathing motion is the point, because it gives zoom as a physical
property rather than a UI control.

Every level has two simultaneous views:

1. **Spatial**, showing relationships. Orbits at level 1, the sphere at level 2.
2. **Comparison**, showing magnitude. A lineup of the current object's children
   sized by completion percentage. Modelled on an encyclopaedia planet size
   chart, where you read relative scale at a glance with no legend.

## The interaction rule

Albert's rule, and it is a good one:

- **Tap a shape, go inward.**
- **Tap empty space, go outward.**

One gesture, no back button, no chrome, works identically on touch and mouse.
At level 0 an outward tap gives a small shake so it does not feel broken. At
level 4 there is nothing further in.

## Current state

Repo: `github.com/albertrus/dcc` (public)

| URL | What it is |
|---|---|
| https://albertrus.github.io/dcc/ | The original DCC build. Three scenes, three themes, CRT pass. |
| https://albertrus.github.io/dcc/proto.html | Navigation prototype. All four levels working, ASCII rendered. |

**Important:** this repo contains only built output, not source. The original
DCC project is a Vite + TypeScript + WebGL2 app that lives on Albert's Mac at
`~/Documents/DEV/dcc` and has **not** been pushed. `index.html` here is a
single-file inlined build of it. If you need to change the main build you need
that folder.

`proto.html` is standalone and shares no code with the main build. It is the
one to extend for the simulator work.

## How proto.html renders

Deliberately simple, no WebGL:

1. Scene is drawn with ordinary canvas 2D into a small offscreen buffer sized
   `COLS*2 x ROWS*3`, so every character cell gets 6 samples in a 2 wide by 3
   tall arrangement.
2. One `getImageData` per frame. For each cell, the 6 samples become luminance.
3. Glyph choice: if the local gradient is strong the cell becomes a line glyph
   (`|` `/` `-` `\`) oriented along the edge tangent. Otherwise it is picked
   from a density ramp. This is what makes edges read as edges instead of mush.
4. Cells where green dominates are drawn in the accent colour, everything else
   in ink. Two `fillText` calls per row, not per cell, which keeps it fast.

Grid is roughly 192x73 on a laptop and about 50x72 on a phone.

Hit testing converts screen coordinates back into offscreen space, so the
clickable regions are the shapes themselves, not DOM elements.

## Known problems

1. **The Hoberman reads as a flat ring, not a sphere.** Only three ellipses are
   drawn. It needs real geodesic structure with the scissor linkage visible, and
   depth cueing so near and far vertices differ.
2. **The cube at level 3 is wireframe only** and was previously skewed. The
   projection was rewritten but has not been checked carefully at all rotations.
3. **Level 4 is a placeholder.** It draws abstract bars, not real records.
4. **No real data.** All values come from a seeded PRNG so they are stable
   between loads but meaningless.
5. In the main build, the cube scene does not read as a cube and its scene label
   never finishes its decode animation. Both live in the WebGL shader, in the
   source folder that is not in this repo.

## What is next

- Fix the Hoberman so it reads as a sphere. This is the highest value item,
  since the sphere is the level that sells the whole concept.
- Replace level 4 with a real table view.
- Wire the six faces to actual API names and real completion values.
- Decide whether the prototype's renderer replaces the main build's WebGL
  pipeline or stays separate. They currently solve the same problem twice.

## Constraints

- Albert never wants em dashes in written output.
- Do not copy Microsoft or Xbox branding, logos, copy, or code.
- The prototype must keep working on a phone. He reviews it there.
