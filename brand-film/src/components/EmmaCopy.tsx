import React from "react";
import { C } from "../theme";
import { Hand, LINE, MM, PEN, Sheet, Strokes } from "./Paper";

// Emma's (fictional) test — "Contrôle — Calcul littéral", 12/09, Seconde 3.
// In FOCUS's mock data Emma Leroy indeed scored 8/20 on this evaluation (eval-1).
export const COPY_W = 210 * MM;
export const COPY_H = 200 * MM;
export const MARGIN = 34 * MM;
const top = LINE * 0.5; // first ruling offset used by <Sheet>
export const baseline = (n: number) => top + n * LINE - 10;

export const ROWS = {
  name: baseline(2),
  title: baseline(4),
  exo: baseline(6),
  a: baseline(8),
  b: baseline(10),
  c: baseline(12),
  d: baseline(14),
};

/** x positions of interesting things on the copy (paper px). */
export const SPOTS = {
  errorRhsX: MARGIN + 210 + 568, // "3x + 2" on line C (measured, tools/capture/measure-text.mjs)
  lineCStartX: MARGIN + 210,
  lineCW: 807,
  gradeX: 110,
  gradeY: baseline(2) - 150,
  tickX: MARGIN + 2160,
};

const Tick: React.FC<{ p: number }> = ({ p }) => (
  <span
    style={{
      display: "inline-block",
      position: "relative",
      width: 70,
      height: 10,
      marginLeft: 90,
    }}
  >
    <Strokes
      paths={PEN.tick}
      x={0}
      y={-62}
      w={64}
      h={64}
      progress={p}
      width={6.5}
      viewBox="0 0 50 50"
    />
  </span>
);

export const EmmaCopy: React.FC<{
  tickA?: number;
  tickB?: number;
  underline?: number;
  grade?: number;
  circle?: number;
  errorGlow?: number;
}> = ({
  tickA = 0,
  tickB = 0,
  underline = 0,
  grade = 0,
  circle = 0,
  errorGlow = 0,
}) => {
  const x0 = MARGIN + 90;
  return (
    <Sheet w={COPY_W} h={COPY_H} marginX={MARGIN}>
      <Hand text="Emma Leroy" x={x0} y={ROWS.name} size={96} seed={3} />
      <Hand
        text="2nde 3"
        x={x0 + 40}
        y={ROWS.name + LINE * 0.75}
        size={78}
        seed={5}
        weight={400}
      />
      <Hand
        text="12/09"
        x={COPY_W - 30 * MM}
        y={ROWS.name}
        size={86}
        seed={8}
      />
      <Hand
        text="Contrôle — Calcul littéral"
        x={MARGIN + 620}
        y={ROWS.title}
        size={108}
        seed={11}
      />
      <div
        style={{
          position: "absolute",
          left: MARGIN + 620,
          top: ROWS.title + 16,
          width: 1220,
          height: 5,
          borderRadius: 3,
          background: C.inkBlue,
          opacity: 0.8,
          rotate: "-0.6deg",
        }}
      />
      <Hand
        text="Exercice 2 : développer et réduire."
        x={x0}
        y={ROWS.exo}
        size={98}
        seed={13}
      />
      <Hand
        text="A = 2(x − 4) = 2x − 8"
        x={x0 + 120}
        y={ROWS.a}
        size={110}
        seed={17}
        trail={<Tick p={tickA} />}
      />
      <Hand
        text="B = 5(2x + 1) = 10x + 5"
        x={x0 + 120}
        y={ROWS.b}
        size={110}
        seed={19}
        trail={<Tick p={tickB} />}
      />
      {/* The error: 3(x + 2) = 3x + 2 */}
      {errorGlow > 0 && (
        <div
          style={{
            position: "absolute",
            left: SPOTS.errorRhsX - 40,
            top: ROWS.c - 120,
            width: 520,
            height: 170,
            borderRadius: 40,
            background: `rgba(194,47,42,${0.08 * errorGlow})`,
          }}
        />
      )}
      <Hand
        text="C = 3(x + 2) = 3x + 2"
        x={x0 + 120}
        y={ROWS.c}
        size={110}
        seed={23}
        markFrom={15}
        mark={
          <span
            style={{
              position: "absolute",
              left: -18,
              top: 4,
              width: 330,
              height: 20,
            }}
          >
            <Strokes
              paths={PEN.underline}
              x={0}
              y={0}
              w={330}
              h={14}
              progress={underline}
              width={6.5}
              viewBox="0 0 420 14"
            />
          </span>
        }
      />
      <Hand
        text="D = −(x − 7) = −x + 7"
        x={x0 + 120}
        y={ROWS.d}
        size={110}
        seed={29}
      />
      {/* Teacher's grade, top-left margin */}
      <div
        style={{
          position: "absolute",
          left: SPOTS.gradeX,
          top: SPOTS.gradeY,
          width: 460,
          height: 230,
        }}
      >
        <div
          style={{
            scale: "1.85",
            transformOrigin: "0 0",
            width: 240,
            height: 110,
          }}
        >
          <Strokes
            paths={PEN.grade}
            x={14}
            y={6}
            w={230}
            h={100}
            progress={grade}
            width={4.6}
            viewBox="0 0 230 100"
          />
          <Strokes
            paths={PEN.circle}
            x={14}
            y={6}
            w={230}
            h={100}
            progress={circle}
            width={4}
            viewBox="0 0 230 100"
          />
        </div>
      </div>
    </Sheet>
  );
};
