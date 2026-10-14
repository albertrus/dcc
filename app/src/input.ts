import { MAX_PING, MAX_TRAIL } from './gl/cells.frag';

/** Seconds a trail stamp lives. */
export const TRAIL_LIFE = 1.0;
/** Seconds a click blast takes to settle. */
export const BLAST_TIME = 0.9;

const TRAIL_RADIUS = 48; // css px at rest
const TOUCH_SCALE = 1.3; // a fingertip covers more than a cursor tip
const STAMP_SPACING = 7; // css px between stamps while moving
const STAMP_HOLD = 0.08; // s between stamps while a pointer rests, so it keeps glowing
const BLAST_RADIUS = 150;
const TAP_SLOP = 12; // css px a touch may wander and still count as a tap
const TAP_TIME = 0.35; // s

interface Track {
  type: string;
  x: number;
  y: number;
  lastStamp: { x: number; y: number; t: number };
  down: { x: number; y: number; t: number; travelled: number } | null;
}

/**
 * Pointer state for the field, from Pointer Events so mouse, pen and touch share one path.
 * Each pointer (every finger on a phone) is tracked separately and leaves its own trail of
 * stamps (x, y, born, radius) that the cell shader fades and shrinks by age.
 *
 * Mouse: hovering paints the trail, pressing blasts. Touch and pen have no hover, so a drag
 * paints the trail and a tap (short, nearly still) blasts; blasting on touch-down would set
 * one off at the start of every drag.
 */
export class Pointer {
  readonly trail = new Float32Array(MAX_TRAIL * 4);
  readonly pings = new Float32Array(MAX_PING * 4);
  trailCount = 0;
  pingCount = 0;

  /** Most recently moved pointer, for telemetry. */
  x = -1;
  y = -1;
  inside = false;
  lastMove = -Infinity;

  private readonly tracks = new Map<number, Track>();
  private stamps: number[][] = [];
  private blasts: number[][] = [];
  private readonly clock: () => number;

  constructor(target: HTMLElement, clock: () => number) {
    this.clock = clock;

    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const now = this.clock();
      const track = this.track(e);
      track.down = { x: e.clientX, y: e.clientY, t: now, travelled: 0 };
      this.move(track, e.clientX, e.clientY, now);
      if (e.pointerType === 'mouse') this.blast(e.clientX, e.clientY);
    });

    target.addEventListener('pointermove', (e) => {
      const track = this.track(e);
      // getCoalescedEvents recovers the in-between points of a fast finger stroke, which a
      // phone otherwise delivers as a few widely spaced moves per frame.
      const points = e.getCoalescedEvents?.() ?? [];
      for (const p of points.length ? points : [e]) this.move(track, p.clientX, p.clientY, this.clock());
    });

    const release = (e: PointerEvent) => {
      const track = this.tracks.get(e.pointerId);
      if (!track) return;
      const d = track.down;
      if (d && e.type === 'pointerup' && track.type !== 'mouse') {
        const quick = this.clock() - d.t < TAP_TIME;
        if (quick && d.travelled < TAP_SLOP) this.blast(d.x, d.y);
      }
      track.down = null;
      // A lifted finger is gone; a mouse is still hovering.
      if (track.type !== 'mouse') this.tracks.delete(e.pointerId);
      this.inside = this.tracks.size > 0;
    };
    target.addEventListener('pointerup', release);
    target.addEventListener('pointercancel', release);
    target.addEventListener('pointerleave', (e) => {
      this.tracks.delete(e.pointerId);
      this.inside = this.tracks.size > 0;
    });
  }

  private track(e: PointerEvent): Track {
    let t = this.tracks.get(e.pointerId);
    if (!t) {
      t = {
        type: e.pointerType,
        x: e.clientX,
        y: e.clientY,
        lastStamp: { x: e.clientX, y: e.clientY, t: -Infinity },
        down: null,
      };
      this.tracks.set(e.pointerId, t);
    }
    return t;
  }

  private radius(track: Track, speed = 0): number {
    return TRAIL_RADIUS * (track.type === 'mouse' ? 1 : TOUCH_SCALE) * (1 + Math.min(speed / 160, 0.3));
  }

  private move(track: Track, x: number, y: number, now: number) {
    const speed = Math.hypot(x - track.x, y - track.y);
    if (track.down) track.down.travelled += speed;
    track.x = x;
    track.y = y;
    this.x = x;
    this.y = y;
    this.inside = true;
    this.lastMove = now;
    const last = track.lastStamp;
    if (now - last.t > STAMP_HOLD || Math.hypot(x - last.x, y - last.y) >= STAMP_SPACING) {
      this.stamp(track, x, y, now, this.radius(track, speed));
    }
  }

  private stamp(track: Track, x: number, y: number, t: number, r: number) {
    this.stamps.push([x, y, t, r]);
    if (this.stamps.length > MAX_TRAIL) this.stamps.shift();
    track.lastStamp = { x, y, t };
  }

  blast(x: number, y: number) {
    this.blasts.push([x, y, this.clock(), BLAST_RADIUS]);
    if (this.blasts.length > MAX_PING) this.blasts.shift();
  }

  /** Expire old stamps, keep resting pointers glowing, and pack arrays for the shader. */
  update(now: number) {
    for (const track of this.tracks.values()) {
      if (now - track.lastStamp.t > STAMP_HOLD) this.stamp(track, track.x, track.y, now, this.radius(track));
    }
    this.stamps = this.stamps.filter((s) => now - s[2] < TRAIL_LIFE);
    this.blasts = this.blasts.filter((b) => now - b[2] < BLAST_TIME);

    this.trailCount = this.stamps.length;
    this.stamps.forEach((s, i) => this.trail.set(s, i * 4));
    this.pingCount = this.blasts.length;
    this.blasts.forEach((b, i) => this.pings.set(b, i * 4));
  }
}
