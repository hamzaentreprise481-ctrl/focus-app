import React from "react";
import { AbsoluteFill } from "remotion";
import { Caption, Graphite, Vignette } from "../components/Finish";
import { LogoSquare, Wordmark } from "../components/Logo";
import { C, HAND, MONO, SANS } from "../theme";
import { E, TL, mix, ramp, useTime, window01 } from "../lib/anim";

const cues = TL.cues;
const S = TL.scenes;

// ---------------------------------------------------------------- the error, analysed (conceptual)
// Caveat 500 advance widths measured at 150 px (tools/capture/measure-text.mjs).
const W150: Record<string, number> = {
  "3": 67.5,
  "(": 49.5,
  x: 51.5,
  "+": 66.9,
  "2": 67.5,
  ")": 49.5,
  "=": 66.9,
  "3x": 119,
};
const SP150 = 36.3;
const TOKENS: { s: string; space: boolean; side: "L" | "M" | "R" }[] = [
  { s: "3", space: false, side: "L" },
  { s: "(", space: false, side: "L" },
  { s: "x", space: true, side: "L" },
  { s: "+", space: true, side: "L" },
  { s: "2", space: false, side: "L" },
  { s: ")", space: true, side: "L" },
  { s: "=", space: true, side: "M" },
  { s: "3x", space: true, side: "R" },
  { s: "+", space: true, side: "R" },
  { s: "2", space: false, side: "R" },
];
const SIZE = 160;
const K = SIZE / 150;
const ERR = "#d8655d";

function layout(split: number) {
  const extra = split * 30; // LHS / RHS letter tracking opens up
  const eqGap = split * 70; // and the two sides move apart
  const xs: number[] = [];
  let x = 0;
  TOKENS.forEach((tk, i) => {
    const w = W150[tk.s] * K;
    xs.push(x + w / 2);
    x += w + (tk.space ? SP150 * K : 0);
    const next = TOKENS[i + 1];
    if (next)
      x += next.side === tk.side ? extra * (tk.side === "L" ? 1 : 0.6) : eqGap;
  });
  const total = x;
  return xs.map((c) => c - total / 2 + 960);
}

export const Analysis: React.FC = () => {
  const t = useTime(S.analysis[0]);
  const split = ramp(t, cues.split[0], cues.split[1], E.inOut);
  const xs = layout(split);
  const baseY = 520 + split * 30;
  const write = ramp(t, cues.handLine[0], cues.handLine[1], E.linear);
  const arcGood = ramp(t, cues.arcGood[0], cues.arcGood[1], E.inOut);
  const arcBad = ramp(t, cues.arcBad[0], cues.arcBad[1], E.inOut);
  const lab = (i: number) =>
    ramp(t, cues.labels[0] + i * 0.45, cues.labels[0] + i * 0.45 + 0.6, E.out);
  const out = 1 - ramp(t, 22.15, 22.6, E.inOut);
  const sceneIn = ramp(t, 15.9, 16.4, E.soft);
  const push = mix(1, 1.035, ramp(t, 15.9, 22.6, E.soft));
  const topY = baseY - SIZE * 0.62; // top of glyphs
  const arc = (x0: number, x1: number, h: number) =>
    `M ${x0} ${topY} Q ${(x0 + x1) / 2} ${topY - h} ${x1} ${topY}`;
  const n = TOKENS.length;
  return (
    <AbsoluteFill style={{ opacity: sceneIn * out }}>
      <Graphite glow={0.35 * split} glowAt="50% 46%" />
      <AbsoluteFill style={{ scale: `${push}` }}>
        {TOKENS.map((tk, i) => {
          const f = Math.max(0, Math.min(1, write * n - i));
          const isWrong = i === 9;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: xs[i] - 100,
                width: 200,
                top: baseY - SIZE * 0.8,
                textAlign: "center",
                fontFamily: HAND,
                fontWeight: 500,
                fontSize: SIZE,
                lineHeight: 1,
                color: isWrong
                  ? mixColor(
                      C.offWhite,
                      ERR,
                      ramp(t, cues.arcBad[1], cues.arcBad[1] + 0.4),
                    )
                  : C.offWhite,
                opacity: f * (tk.side === "M" ? 1 - 0.45 * split : 1),
                clipPath:
                  f >= 1
                    ? undefined
                    : `inset(-20% ${(1 - f) * 100}% -20% -20%)`,
                translate: `0 ${tk.s === "3" && i === 0 ? -split * 10 : 0}px`,
              }}
            >
              {tk.s}
            </div>
          );
        })}
        {/* distributivity arcs: 3·x (applied) and 3·2 (forgotten) */}
        <svg
          width={1920}
          height={1080}
          style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
        >
          <path
            d={arc(xs[0], xs[2], 150)}
            fill="none"
            stroke={C.metal}
            strokeWidth={2.4}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - arcGood}
            strokeLinecap="round"
          />
          <path
            d={arc(xs[0], xs[4], 270)}
            fill="none"
            stroke={ERR}
            strokeWidth={2.4}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - arcBad}
            strokeLinecap="round"
          />
          {/* ring around the student's "+ 2" */}
          <ellipse
            cx={(xs[8] + xs[9]) / 2}
            cy={baseY - SIZE * 0.3}
            rx={118}
            ry={86}
            fill="none"
            stroke={ERR}
            strokeWidth={2.2}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={
              1 - ramp(t, cues.arcBad[1], cues.arcBad[1] + 0.5, E.inOut)
            }
          />
        </svg>
        <ArcLabel
          x={(xs[0] + xs[2]) / 2}
          y={topY - 75 - 70}
          text="3 × x = 3x"
          color={C.metal}
          o={ramp(t, cues.arcGood[1] - 0.1, cues.arcGood[1] + 0.4)}
        />
        <ArcLabel
          x={(xs[0] + xs[4]) / 2}
          y={topY - 135 - 70}
          text="3 × 2 = 6"
          color={ERR}
          o={ramp(t, cues.arcBad[1] - 0.1, cues.arcBad[1] + 0.4)}
        />
        <ArcLabel
          x={(xs[8] + xs[9]) / 2}
          y={baseY + 96}
          text="attendu : + 6"
          color={ERR}
          o={ramp(t, cues.arcBad[1] + 0.3, cues.arcBad[1] + 0.8)}
        />
      </AbsoluteFill>
      {/* diagnosis labels */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 790,
          display: "flex",
          justifyContent: "center",
          gap: 28,
        }}
      >
        <Tag o={lab(0)} k="Erreur" v="Distributivité incomplète" accent={ERR} />
        <Tag
          o={lab(1)}
          k="Notion"
          v="Calcul littéral · Développement"
          accent={C.brandGlow}
        />
      </div>
      <Caption
        text="Visualisation conceptuelle"
        opacity={window01(t, 16.4, 17.2, 22.0, 22.4)}
      />
      <Vignette strength={0.5} />
    </AbsoluteFill>
  );
};

const ArcLabel: React.FC<{
  x: number;
  y: number;
  text: string;
  color: string;
  o: number;
}> = ({ x, y, text, color, o }) => (
  <div
    style={{
      position: "absolute",
      left: x - 200,
      width: 400,
      top: y,
      textAlign: "center",
      fontFamily: MONO,
      fontSize: 28,
      fontWeight: 500,
      letterSpacing: "0.04em",
      color,
      opacity: o,
      translate: `0 ${(1 - o) * 8}px`,
    }}
  >
    <span
      style={{
        background: "rgba(20,22,27,0.92)",
        borderRadius: 8,
        padding: "4px 12px",
      }}
    >
      {text}
    </span>
  </div>
);

const Tag: React.FC<{ o: number; k: string; v: string; accent: string }> = ({
  o,
  k,
  v,
  accent,
}) => (
  <div
    style={{
      opacity: o,
      translate: `0 ${(1 - o) * 12}px`,
      display: "flex",
      alignItems: "center",
      gap: 16,
      padding: "18px 30px",
      borderRadius: 999,
      background: "rgba(255,255,255,0.04)",
      boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.10)`,
    }}
  >
    <span
      style={{ width: 9, height: 9, borderRadius: 9, background: accent }}
    />
    <span
      style={{
        fontFamily: MONO,
        fontSize: 22,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: C.metal,
      }}
    >
      {k}
    </span>
    <span
      style={{
        fontFamily: SANS,
        fontSize: 36,
        fontWeight: 500,
        color: C.offWhite,
        letterSpacing: "-0.01em",
      }}
    >
      {v}
    </span>
  </div>
);

function mixColor(a: string, b: string, p: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * p)).join(",")})`;
}

// ---------------------------------------------------------------- three words, then the point becomes FOCUS
const WORD_SIZE = 150;
const WORD_BASELINE = 540 - 75 + 131; // line-height 1 box centred on 540, Plex baseline at 131 px
const ACC_W = 913.1; // "Accompagner" at 150 px, -0.02em
const DOT = 17;
const DOT_GAP = 6;
const DOT_X = 960 - (ACC_W + DOT_GAP + DOT) / 2 + ACC_W + DOT_GAP; // left edge of the full stop

// Final lockup geometry (same proportions as the sidebar logo: 28px square, 8px gap, 15px wordmark)
export const LOCK = (() => {
  const sq = 132;
  const gap = sq * (8 / 28);
  const word = sq * (15 / 28);
  const wordW = 308 * (word / 100);
  const total = sq + gap + wordW;
  const left = 960 - total / 2;
  return {
    sq,
    gap,
    word,
    left,
    sqCx: left + sq / 2,
    wordLeft: left + sq + gap,
    cy: 540,
  };
})();

const Word: React.FC<{
  text: string;
  t: number;
  at: number;
  until?: number;
  dot?: boolean;
}> = ({ text, t, at, until, dot }) => {
  const i = ramp(t, at, at + 0.55, E.out);
  const o = until ? ramp(t, until - 0.32, until, E.inOut) : 0;
  const a = i * (1 - o);
  if (a <= 0.001) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 540 - WORD_SIZE / 2,
        display: "flex",
        justifyContent: "center",
        alignItems: "baseline",
        fontFamily: SANS,
        fontWeight: 500,
        fontSize: WORD_SIZE,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        color: C.offWhite,
        opacity: a,
        filter: `blur(${(1 - i) * 10 + o * 8}px)`,
        translate: `0 ${(1 - i) * 22 - o * 16}px`,
      }}
    >
      <span>{text}</span>
      {dot && <span style={{ width: DOT + DOT_GAP }} />}
    </div>
  );
};

export const WordsToLogo: React.FC = () => {
  const t = useTime(S.words[0]);
  const [w1, w2, w3] = cues.words;
  // the full stop of "Accompagner." is our own element: it glides and grows into the FOCUS square
  const lettersOut = ramp(t, 25.85, 26.25, E.inOut);
  const travel = ramp(t, 26.0, 26.62, E.out);
  const grow = ramp(t, 26.12, 26.7, E.out);
  const size = mix(DOT, LOCK.sq, grow);
  const cx = mix(DOT_X + DOT / 2, LOCK.sqCx, travel);
  const cy = mix(WORD_BASELINE - DOT / 2, LOCK.cy, travel);
  const dotIn = ramp(t, w3, w3 + 0.55, E.out);
  const fIn = ramp(t, 26.45, 26.9, E.out);
  const wm = ramp(t, cues.wordmark, cues.wordmark + 0.8, E.out);
  const glow = ramp(t, 26.15, 27.0, E.out);
  return (
    <AbsoluteFill>
      <Graphite glow={glow} glowAt={`${(LOCK.sqCx / 1920) * 100}% 50%`} />
      <Word text="Comprendre." t={t} at={w1} until={w2} />
      <Word text="Identifier." t={t} at={w2} until={w3} />
      <AbsoluteFill
        style={{ opacity: 1 - lettersOut, filter: `blur(${lettersOut * 6}px)` }}
      >
        <Word text="Accompagner" t={t} at={w3} dot />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: cx - size / 2,
          top: cy - size / 2,
          opacity: dotIn,
          translate: `0 ${(1 - dotIn) * 22}px`,
        }}
      >
        <LogoSquare
          size={size}
          fOpacity={fIn}
          color={mixHex(C.offWhite, C.brand, Math.min(1, grow * 1.6))}
          style={{
            borderRadius: mix(2.5, size * 0.2857, grow),
            boxShadow: `0 0 ${60 * glow}px rgba(91,103,201,${0.35 * glow})`,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: LOCK.wordLeft,
          top: LOCK.cy - LOCK.word / 2,
          height: LOCK.word,
          display: "flex",
          alignItems: "center",
          opacity: wm,
          clipPath: `inset(-20% ${(1 - wm) * 100}% -20% 0)`,
          translate: `${(1 - wm) * -18}px 0`,
        }}
      >
        <Wordmark size={LOCK.word} tracking={mix(0.08, -0.025, wm)} />
      </div>
      <Vignette strength={0.45} />
    </AbsoluteFill>
  );
};

function mixHex(a: string, b: string, p: number) {
  return mixColor(a, b, p);
}
