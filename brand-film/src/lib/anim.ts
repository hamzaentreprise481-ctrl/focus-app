import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import timeline from "../timeline.json";

export const TL = timeline;
export type Cues = typeof timeline.cues;

/** Easing vocabulary used across the film (kept small on purpose). */
export const E = {
  // Entrances: fast start, long silky settle.
  out: Easing.bezier(0.16, 1, 0.3, 1),
  // Camera moves: symmetrical, no visible acceleration edges.
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  // Gentle in-out for long drifts.
  soft: Easing.bezier(0.45, 0, 0.55, 1),
  in: Easing.bezier(0.7, 0, 0.84, 0),
  linear: (t: number) => t,
};

/** Absolute film time (seconds) for the current frame, given a Sequence offset. */
export const useTime = (offsetSeconds = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps + offsetSeconds;
};

/** 0→1 progress between t0 and t1 (clamped, eased). */
export const ramp = (
  t: number,
  t0: number,
  t1: number,
  easing: (x: number) => number = E.out,
) =>
  interpolate(t, [t0, t1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

export const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** Fade in at [in0,in1], fade out at [out0,out1]. */
export const window01 = (
  t: number,
  in0: number,
  in1: number,
  out0: number,
  out1: number,
) => Math.min(ramp(t, in0, in1, E.out), 1 - ramp(t, out0, out1, E.inOut));

export type Key<T extends string> = { t: number } & Record<T, number>;

/** Piecewise keyframes with a per-segment in-out easing (camera paths). */
export function keys<T extends string>(
  t: number,
  ks: Key<T>[],
  prop: T,
  easing = E.inOut,
): number {
  if (t <= ks[0].t) return ks[0][prop];
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    if (t <= b.t) {
      const p = easing((t - a.t) / Math.max(1e-6, b.t - a.t));
      return mix(a[prop], b[prop], p);
    }
  }
  return ks[ks.length - 1][prop];
}

/** Deterministic pseudo-random in [0,1). */
export const rand = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
