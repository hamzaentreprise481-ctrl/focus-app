import React from "react";
import { Img, staticFile } from "remotion";
import { C, HAND } from "../theme";
import { rand } from "../lib/anim";

/** px per millimetre in "paper space" (the camera zooms on top of this). */
export const MM = 16;
export const LINE = 8 * MM; // Seyès main line (8 mm)
export const SUB = 2 * MM; // Seyès sub line (2 mm)

/** A French "copie double" sheet with Seyès ruling (grands carreaux) and a red margin. */
export const Sheet: React.FC<{
  w: number;
  h: number;
  marginX?: number;
  scale?: number; // ruling scale (1 = MM px/mm)
  tone?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({
  w,
  h,
  marginX = 34 * MM,
  scale = 1,
  tone = C.paperWarm,
  style,
  children,
}) => {
  const L = LINE * scale;
  const S = SUB * scale;
  const t = Math.max(1, 1.6 * scale);
  return (
    <div
      style={{
        position: "absolute",
        width: w,
        height: h,
        backgroundColor: tone,
        backgroundImage: (scale >= 0.5
          ? [
              `repeating-linear-gradient(to bottom, rgba(110,120,196,0.55) 0 ${t * 1.3}px, transparent ${t * 1.3}px ${L}px)`,
              `repeating-linear-gradient(to bottom, rgba(150,170,215,0.42) 0 ${t * 0.8}px, transparent ${t * 0.8}px ${S}px)`,
              `repeating-linear-gradient(to right, rgba(150,170,215,0.38) 0 ${t * 0.8}px, transparent ${t * 0.8}px ${L}px)`,
            ]
          : [
              `repeating-linear-gradient(to bottom, rgba(110,120,196,0.32) 0 ${L * 0.06}px, transparent ${L * 0.06}px ${L}px)`,
              `repeating-linear-gradient(to right, rgba(150,170,215,0.18) 0 ${L * 0.04}px, transparent ${L * 0.04}px ${L}px)`,
            ]
        ).join(","),
        backgroundPosition: `0 ${L * 0.5}px, 0 ${L * 0.5}px, ${marginX % L}px 0`,
        overflow: "hidden",
        ...style,
      }}
    >
      {/* red margin rule */}
      <div
        style={{
          position: "absolute",
          left: marginX,
          top: 0,
          width: 2.4 * scale,
          height: h,
          background: "rgba(214,92,92,0.75)",
        }}
      />
      {/* paper fibres (pre-generated texture, see tools/textures.py) */}
      {scale >= 0.5 && (
        <Img
          src={staticFile("textures/paper.webp")}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: w,
            height: h,
            objectFit: "cover",
            opacity: 0.6,
            mixBlendMode: "multiply",
          }}
        />
      )}
      {children}
    </div>
  );
};

/**
 * Handwritten line (ballpoint). `progress` 0→1 writes it left to right,
 * glyph by glyph, with a soft per-glyph wipe so it reads as being written.
 */
export const Hand: React.FC<{
  text: string;
  x: number;
  y: number; // baseline
  size?: number;
  color?: string;
  progress?: number;
  seed?: number;
  weight?: number;
  rotate?: number;
  style?: React.CSSProperties;
  spanStyle?: (i: number, ch: string) => React.CSSProperties | undefined;
  /** Rendered inline right after the text (e.g. the teacher's tick). */
  trail?: React.ReactNode;
  /** Characters from this index on are wrapped so `mark` can be drawn under them. */
  markFrom?: number;
  mark?: React.ReactNode;
}> = ({
  text,
  x,
  y,
  size = 104,
  color = C.inkBlue,
  progress = 1,
  seed = 1,
  weight = 500,
  rotate = -0.6,
  style,
  spanStyle,
  trail,
  markFrom,
  mark,
}) => {
  const chars = [...text];
  const visibleChars = chars.filter((c) => c !== " ").length;
  let k = 0;
  const pos = progress * visibleChars;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y - size * 0.78,
        fontFamily: HAND,
        fontWeight: weight,
        fontSize: size,
        lineHeight: 1,
        color,
        whiteSpace: "pre",
        rotate: `${rotate}deg`,
        transformOrigin: "0 80%",
        ...style,
      }}
    >
      {(() => {
        const nodes = chars.map((ch, i) => {
          if (ch === " ") return <span key={i}> </span>;
          const idx = k++;
          const f = Math.max(0, Math.min(1, pos - idx));
          const r1 = rand(seed * 101 + i);
          const r2 = rand(seed * 37 + i * 7);
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                translate: `0 ${(r1 - 0.5) * size * 0.045}px`,
                rotate: `${(r2 - 0.5) * 3.2}deg`,
                opacity: 0.84 + r2 * 0.12,
                clipPath:
                  f >= 1
                    ? undefined
                    : `inset(-20% ${(1 - f) * 100}% -20% -20%)`,
                textShadow: `0 0 ${size * 0.008}px ${color}`,
                ...spanStyle?.(i, ch),
              }}
            >
              {ch}
            </span>
          );
        });
        if (markFrom === undefined) return nodes;
        return [
          ...nodes.slice(0, markFrom),
          <span
            key="mark"
            style={{ position: "relative", display: "inline-block" }}
          >
            {nodes.slice(markFrom)}
            <span
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "100%",
                height: 0,
              }}
            >
              {mark}
            </span>
          </span>,
        ];
      })()}
      {trail}
    </div>
  );
};

/** One or more pen strokes drawn progressively (SVG pathLength trick). */
export const Strokes: React.FC<{
  paths: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  progress: number; // 0..1 over all strokes, in order
  color?: string;
  width?: number;
  viewBox?: string;
}> = ({
  paths,
  x,
  y,
  w,
  h,
  progress,
  color = C.penRed,
  width = 6,
  viewBox,
}) => {
  const n = paths.length;
  return (
    <svg
      width={w}
      height={h}
      viewBox={viewBox ?? `0 0 ${w} ${h}`}
      style={{ position: "absolute", left: x, top: y, overflow: "visible" }}
    >
      {paths.map((d, i) => {
        const p = Math.max(0, Math.min(1, progress * n - i));
        if (p <= 0) return null;
        return (
          <path
            key={i}
            d={d}
            pathLength={1}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1 1"
            strokeDashoffset={1 - p}
            opacity={0.93}
          />
        );
      })}
    </svg>
  );
};

// Hand-drawn glyph paths (teacher's red pen), designed on small grids.
export const PEN = {
  tick: ["M2 30 C 8 36, 12 42, 15 47 C 22 30, 32 14, 48 2"],
  underline: ["M0 8 C 60 2, 140 12, 230 5 C 300 0, 360 9, 420 4"],
  // "8/20" — four strokes, 0..230 x 0..100
  grade: [
    "M42 20 C 38 6, 12 6, 12 22 C 12 38, 44 44, 46 64 C 48 86, 16 92, 10 74 C 6 58, 30 48, 38 40 C 46 32, 48 24, 42 20",
    "M66 92 L 92 6",
    "M104 28 C 106 10, 138 6, 140 26 C 142 44, 118 62, 100 88 C 116 86, 132 84, 150 86",
    "M186 10 C 164 10, 158 44, 162 68 C 166 92, 194 94, 200 64 C 206 34, 200 8, 182 12",
  ],
  circle: [
    "M228 36 C 226 4, 150 -10, 92 -6 C 30 -2, -12 26, -4 62 C 4 98, 92 112, 168 104 C 222 98, 246 74, 236 44 C 232 32, 222 24, 210 20",
  ],
};
