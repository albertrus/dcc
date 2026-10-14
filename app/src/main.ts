import './style.css';
import { Analysis } from './gl/analysis';
import { Pipeline, type Palette } from './gl/pipeline';
import { BLAST_TIME, Pointer, TRAIL_LIFE } from './input';
import { cubeScene } from './scenes/cube';
import { desertScene } from './scenes/desert';
import { rackScene } from './scenes/rack';
import { DrawnSource, type FrameSource } from './scenes/source';

type Theme = 'light' | 'dark' | 'green';

const SCENE_SECONDS = 14;
const TRANSITION_SECONDS = 1.4;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const PALETTES: Record<Theme, Palette & { light: number }> = {
  light: { paper: hex('#efe8d9'), ink: hex('#080808'), accent: hex('#9bf00b'), light: 1 },
  dark: { paper: hex('#080808'), ink: hex('#e7efe8'), accent: hex('#90f910'), light: 0 },
  green: { paper: hex('#082b0b'), ink: hex('#d9f5d2'), accent: hex('#90f910'), light: 0 },
};

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`dcc.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`dcc.${key}`, value);
    } catch {
      /* private mode: preferences just do not persist */
    }
  },
};

const root = document.documentElement;
const canvas = document.getElementById('field') as HTMLCanvasElement;
const t = (name: string) => document.querySelector<HTMLElement>(`[data-t="${name}"]`)!;

let pipeline: Pipeline;
try {
  pipeline = new Pipeline(canvas);
} catch (err) {
  console.error(err);
  document.querySelector<HTMLElement>('.fallback')!.hidden = false;
  throw err;
}

const start = performance.now() / 1000;
const clock = () => performance.now() / 1000 - start;
const pointer = new Pointer(canvas, clock);
const analysis = new Analysis();

const sources: FrameSource[] = [rackScene, cubeScene, desertScene].map((s) => new DrawnSource(s));
let current = 0;
let sceneStart = 0;
let transition: { to: number; start: number } | null = null;

// ---- Theme and CRT ----------------------------------------------------------------------

let theme: Theme = (['light', 'dark', 'green'] as const).find((x) => x === store.get('theme')) ?? 'light';
let crt = store.get('crt') !== 'off';
const shown = { light: PALETTES[theme].light, palette: structuredClone(PALETTES[theme]) as Palette };

function applyTheme(next: Theme) {
  theme = next;
  root.dataset.theme = next;
  store.set('theme', next);
  syncKeys();
}

function applyCrt(on: boolean) {
  crt = on;
  root.classList.toggle('crt', on);
  store.set('crt', on ? 'on' : 'off');
  syncKeys();
}

function syncKeys() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.keys button')) {
    const k = b.dataset.key;
    const pressed =
      (k === 'l' && theme === 'light') ||
      (k === 'd' && theme === 'dark') ||
      (k === 'g' && theme === 'green') ||
      (k === 'r' && crt);
    if (k === 'n') b.removeAttribute('aria-pressed');
    else b.setAttribute('aria-pressed', String(pressed));
  }
}

function nextScene() {
  if (transition) return;
  transition = { to: (current + 1) % sources.length, start: clock() };
}

function handleKey(key: string) {
  switch (key) {
    case 'l':
      return applyTheme('light');
    case 'd':
      return applyTheme('dark');
    case 'g':
      return applyTheme('green');
    case 'r':
      return applyCrt(!crt);
    case 'n':
      return nextScene();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  handleKey(e.key.toLowerCase());
});
for (const b of document.querySelectorAll<HTMLButtonElement>('.keys button')) {
  b.addEventListener('click', () => handleKey(b.dataset.key ?? ''));
}
applyTheme(theme);
applyCrt(crt);

// ---- Layout: grid size and the quiet zones the field keeps clear of ---------------------

const quiet = new Float32Array(8 * 4);
let quietCount = 0;

// Dev hooks: ?dpr=N forces the render pixel ratio, ?perf exposes GPU ms per frame.
const params = new URLSearchParams(location.search);
const forcedDpr = Number(params.get('dpr')) || 0;
if (params.has('perf')) {
  const timing = pipeline.enableTiming();
  Object.assign(window, { dccPerf: () => ({ timing, gpuMs: +pipeline.gpuMs.toFixed(2) }) });
}

function layout() {
  const dpr = forcedDpr || Math.min(window.devicePixelRatio || 1, 2);
  const grid = pipeline.resize(window.innerWidth, window.innerHeight, dpr);
  t('grid').textContent = `${grid.cols}x${grid.rows}`;
  const pad = 12;
  const zones = [...document.querySelectorAll<HTMLElement>('[data-quiet]')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .slice(0, 8);
  quietCount = zones.length;
  zones.forEach((r, i) => quiet.set([r.left - pad, r.top - pad, r.right + pad, r.bottom + pad], i * 4));
}

window.addEventListener('resize', layout);
document.fonts.ready.then(layout);
layout();

// ---- Telemetry ---------------------------------------------------------------------------

const zone = (() => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  return (tz.split('/').pop() ?? tz).replace(/_/g, ' ').toUpperCase();
})();
t('zone').textContent = zone;

const timeFormat = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});
const dateFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: '2-digit', month: 'short' });

const pad = (n: number, width: number) => String(Math.floor(n)).padStart(width, '0');
const hms = (s: number) => `${pad(s / 3600, 2)}:${pad((s / 60) % 60, 2)}:${pad(s % 60, 2)}`;

/** Decode a new label in: random glyphs resolve left to right. */
function decodeText(el: HTMLElement, text: string) {
  const startAt = performance.now();
  const glyphs = '#%@*+=-:/\\|<>';
  const step = () => {
    const p = Math.min(1, (performance.now() - startAt) / 450);
    const fixed = Math.floor(text.length * p);
    el.textContent =
      text.slice(0, fixed) +
      [...text.slice(fixed)].map((c) => (c === ' ' ? ' ' : glyphs[Math.floor(Math.random() * glyphs.length)])).join('');
    if (p < 1) requestAnimationFrame(step);
  };
  step();
}

function showSource(index: number) {
  decodeText(t('scene'), sources[index].title);
  decodeText(t('kind'), sources[index].kind);
}
showSource(current);

let frame = 0;
let fps = 60;
let fpsFrames = 0;
let fpsSince = clock();
let lastText = 0;

function writeTelemetry(now: number) {
  fpsFrames++;
  if (now - fpsSince >= 0.5) {
    fps = fpsFrames / (now - fpsSince);
    fpsFrames = 0;
    fpsSince = now;
  }
  if (now - lastText < 0.1) return;
  lastText = now;

  const live = pointer.inside && now - pointer.lastMove < 3;
  t('fps').textContent = pad(fps + 0.5, 2);
  t('input').textContent = live ? 'LIVE' : 'IDLE';
  t('elapsed').textContent = hms(now - sceneStart);
  t('frame').textContent = pad(frame, 6);
  t('luma').textContent = analysis.luma.toFixed(2);
  t('motion').textContent = `${(analysis.motion * 100).toFixed(1).padStart(4, '0')}%`;
  t('x').textContent = pointer.inside ? pad(pointer.x, 4) : '----';
  t('y').textContent = pointer.inside ? pad(pointer.y, 4) : '----';

  const d = new Date();
  const parts = timeFormat.formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  t('time').textContent = `${part('hour')}:${part('minute')}:${part('second')} ${part('timeZoneName')}`;

  const rotation = [
    `DATE ${dateFormat.format(d).replace(',', '').toUpperCase()}`,
    `SESSION ${hms(now)}`,
    `SCENE ${current + 1}/${sources.length}`,
  ];
  t('rotate').textContent = rotation[Math.floor(now / 4) % rotation.length];
}

// ---- Frame loop --------------------------------------------------------------------------

let lastNow = clock();

function tick() {
  const now = clock();
  const dt = Math.min(0.1, now - lastNow);
  lastNow = now;
  const g = pipeline.grid;

  // Scene rotation, with a per-cell dissolve between scenes.
  if (!transition && now - sceneStart > SCENE_SECONDS) nextScene();
  let mix = -1;
  let next: HTMLCanvasElement | null = null;
  const scene = sources[current].frame(now - sceneStart, g.viewW, g.viewH, g.sampleW, g.sampleH);
  if (transition) {
    mix = (now - transition.start) / TRANSITION_SECONDS;
    next = sources[transition.to].frame(now - transition.start, g.viewW, g.viewH, g.sampleW, g.sampleH);
    if (mix >= 1.05) {
      current = transition.to;
      sceneStart = transition.start;
      transition = null;
      mix = -1;
      next = null;
      showSource(current);
    }
  }
  // Normalize contrast to whichever scene holds most of the screen.
  analysis.update(next && mix > 0.5 ? next : scene);

  // Ease the palette toward the theme so changes crossfade.
  const target = PALETTES[theme];
  const k = 1 - Math.exp(-dt * 8);
  shown.light += (target.light - shown.light) * k;
  for (const key of ['paper', 'ink', 'accent'] as const) {
    shown.palette[key] = shown.palette[key].map((v, i) => v + (target[key][i] - v) * k);
  }

  pointer.update(now);
  pipeline.render({
    now,
    scene,
    next,
    mix,
    cdf: analysis.cdf,
    light: shown.light,
    palette: shown.palette,
    trail: pointer.trail,
    trailCount: pointer.trailCount,
    trailLife: TRAIL_LIFE,
    pings: pointer.pings,
    pingCount: pointer.pingCount,
    blastTime: BLAST_TIME,
    quiet,
    quietCount,
    crt,
  });

  frame++;
  writeTelemetry(now);
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
