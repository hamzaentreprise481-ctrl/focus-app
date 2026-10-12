import React from "react";
import { AbsoluteFill } from "remotion";
import { Graphite, Vignette } from "../components/Finish";
import { LogoSquare, Wordmark } from "../components/Logo";
import { C, SANS } from "../theme";
import { E, TL, mix, ramp, useTime } from "../lib/anim";
import { LOCK } from "./Act2";

const cues = TL.cues;
const S = TL.scenes;

// Statement geometry (IBM Plex Sans 600, line-height 1.1, tracking 0.01em) — measured at 96 px
// with tools/capture/measure-text.mjs ("UN POINT DE DÉPART" = 1000 px, baseline at 88 px), scaled.
const SIZE = 106;
const K = SIZE / 96;
const LH = SIZE * 1.1;
const L2_W = 1000 * K;
const DOT = Math.round(11 * K);
const DOT_GAP = 4 * K;
const L2_BASELINE = 540 + 88 * K;
const DOT_CX = 960 - (L2_W + DOT_GAP + DOT) / 2 + L2_W + DOT_GAP + DOT / 2;
const DOT_CY = L2_BASELINE - DOT / 2;

const Line: React.FC<{
  top: number;
  p: number;
  out: number;
  children: React.ReactNode;
}> = ({ top, p, out, children }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      top,
      height: LH,
      display: "flex",
      justifyContent: "center",
      alignItems: "baseline",
      fontFamily: SANS,
      fontWeight: 600,
      fontSize: SIZE,
      lineHeight: 1.1,
      letterSpacing: "0.01em",
      color: C.offWhite,
      opacity: p * (1 - out),
      filter: `blur(${(1 - p) * 10 + out * 8}px)`,
      translate: `0 ${(1 - p) * 26}px`,
    }}
  >
    {children}
  </div>
);

/** "CHAQUE ERREUR PEUT DEVENIR UN POINT DE DÉPART." — whose full stop becomes FOCUS. */
export const StatementToSignature: React.FC = () => {
  const t = useTime(S.statement[0]);
  const l1 = ramp(t, cues.statementIn, cues.statementIn + 0.8, E.out);
  const l2 = ramp(t, cues.statementLine2, cues.statementLine2 + 0.8, E.out);
  const textOut = ramp(t, 68.2, 68.75, E.inOut);
  const glow = ramp(t, cues.dotGlow, cues.dotGlow + 0.6, E.out);
  // brief, soft bloom as the square completes — then it settles
  const bloom =
    ramp(t, cues.square[1] - 0.15, cues.square[1] + 0.1, E.out) *
    (1 - ramp(t, cues.square[1] + 0.1, cues.square[1] + 1.3, E.soft));
  const travel = ramp(t, cues.square[0], cues.square[1], E.inOut);
  const grow = ramp(t, cues.square[0] + 0.25, cues.square[1] + 0.15, E.out);
  const size = mix(DOT, LOCK.sq, grow);
  const lift = ramp(t, 74.9, 75.9, E.inOut) * 46;
  const cx = mix(DOT_CX, LOCK.sqCx, travel);
  const cy = mix(DOT_CY, LOCK.cy, travel) - lift;
  const wm = ramp(t, cues.sigWordmark[0], cues.sigWordmark[1], E.out);
  const sweep = mix(
    -0.4,
    1.5,
    ramp(t, cues.lightSweep[0], cues.lightSweep[1], E.inOut),
  );
  const tag = ramp(t, cues.tagline, cues.tagline + 1.1, E.out);
  const fade = ramp(t, cues.fadeOut[0], cues.fadeOut[1], E.inOut);
  const settle = ramp(t, 68.2, 70.6, E.soft);
  const push = 1 + 0.035 * ramp(t, 70.2, 79.4, E.soft);
  const breath =
    1 +
    0.08 *
      Math.sin(((t - 70) / 4.2) * Math.PI * 2) *
      ramp(t, 70.2, 71.5, E.soft);
  return (
    <AbsoluteFill style={{ opacity: 1 - fade }}>
      <Graphite
        glow={
          (mix(0.15, 0.9, glow) * (1 - 0.35 * settle) + 0.35 * bloom) * breath
        }
        glowAt={`${(cx / 1920) * 100}% ${(cy / 1080) * 100}%`}
      />
      <AbsoluteFill style={{ scale: `${push}` }}>
        <Line top={540 - LH} p={l1} out={textOut}>
          <span>CHAQUE ERREUR PEUT DEVENIR</span>
        </Line>
        <Line top={540} p={l2} out={textOut}>
          <span>UN POINT DE DÉPART</span>
          <span style={{ width: DOT_GAP + DOT }} />
        </Line>
        {/* the full stop (our own element) */}
        <div
          style={{
            position: "absolute",
            left: cx - size / 2,
            top: cy - size / 2,
            opacity: l2,
            filter: `blur(${(1 - l2) * 10}px)`,
            translate: `0 ${(1 - l2) * 26}px`,
          }}
        >
          <LogoSquare
            size={size}
            fOpacity={ramp(
              t,
              cues.square[1] - 0.1,
              cues.square[1] + 0.4,
              E.out,
            )}
            sweep={sweep}
            color={mixRgb(
              [236, 234, 228],
              [51, 63, 138],
              Math.min(1, grow * 1.5),
            )}
            style={{
              borderRadius: mix(1.6, size * 0.2857, grow),
              boxShadow: `0 0 ${mix(18, 70, grow) * glow + 40 * bloom}px rgba(120,132,230,${0.55 * glow * (1 - 0.5 * grow) + 0.25 * bloom})`,
            }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            left: LOCK.wordLeft,
            top: LOCK.cy - LOCK.word / 2 - lift,
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
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: LOCK.cy + LOCK.sq / 2 - lift + 54,
            textAlign: "center",
            fontFamily: SANS,
            fontWeight: 400,
            fontSize: 38,
            letterSpacing: "0.005em",
            color: C.metal,
            opacity: tag,
            translate: `0 ${(1 - tag) * 14}px`,
            filter: `blur(${(1 - tag) * 6}px)`,
          }}
        >
          Une nouvelle approche de l’accompagnement pédagogique.
        </div>
      </AbsoluteFill>
      <Vignette strength={0.5} />
    </AbsoluteFill>
  );
};

function mixRgb(a: number[], b: number[], p: number) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * p)).join(",")})`;
}
