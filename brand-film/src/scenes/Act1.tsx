import React from "react";
import { AbsoluteFill } from "remotion";
import { Camera, DepthOfField } from "../components/Camera";
import { EmmaCopy, ROWS, SPOTS } from "../components/EmmaCopy";
import { KeyLight, Vignette } from "../components/Finish";
import { Hand, Sheet } from "../components/Paper";
import { C, NNBSP, SANS } from "../theme";
import { E, TL, keys, mix, ramp, rand, useTime } from "../lib/anim";

const cues = TL.cues;
const S = TL.scenes;

// ---------------------------------------------------------------- S2 — macro on the copy
export const MacroCopy: React.FC = () => {
  const t = useTime(S.macro[0]);
  const cam = {
    fx: keys(
      t,
      [
        { t: 1.4, v: 1480 },
        { t: 5.0, v: 1820 },
      ],
      "v",
      E.soft,
    ),
    fy: keys(
      t,
      [
        { t: 1.4, v: ROWS.a - 10 },
        { t: 5.0, v: ROWS.b - 60 },
      ],
      "v",
      E.soft,
    ),
    z: keys(
      t,
      [
        { t: 1.4, v: 0.9 },
        { t: 5.0, v: 1.0 },
      ],
      "v",
      E.soft,
    ),
    rx: 14,
    rz: -3.5,
  };
  const fadeIn = ramp(t, 1.4, 2.5, E.soft);
  return (
    <AbsoluteFill style={{ background: "#0b0b0c" }}>
      <AbsoluteFill style={{ opacity: fadeIn }}>
        <DepthOfField
          blur={9}
          mask="linear-gradient(to bottom, transparent 6%, black 36%, black 66%, transparent 96%)"
        >
          <Camera cam={cam} perspective={1800}>
            <EmmaCopy
              tickA={ramp(t, cues.tickA[0], cues.tickA[1], E.inOut)}
              tickB={ramp(t, cues.tickB[0], cues.tickB[1], E.inOut)}
            />
          </Camera>
        </DepthOfField>
        <KeyLight x="16%" y="8%" />
      </AbsoluteFill>
      <Vignette strength={0.6} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- S2b — many copies, many grades
const LINES = [
  "A = 4(x + 3) = 4x + 12",
  "f(x) = 3x − 5",
  "2x + 6 = 0 donc x = −3",
  "E = 5(x − 2) + 3",
  "(a + b)² = a² + 2ab + b²",
  "B = 2x(x − 1)",
  "S = { −3 ; 2 }",
  "x = 7/2",
  "g(4) = 11",
];
const NAMES = [
  "Lucas B.",
  "Léa D.",
  "Adam B.",
  "Zoé B.",
  "Théo M.",
  "Hugo L.",
  "Inès D.",
  "Noah P.",
  "Jade S.",
  "Tom B.",
  "Lina R.",
  "Enzo F.",
];
const GRADES = [
  "14/20",
  "11/20",
  "16/20",
  "9/20",
  "12/20",
  "15/20",
  "10/20",
  "13/20",
  "17/20",
  "8/20",
  "12/20",
  "11/20",
  "15/20",
];
const SW = 840;
const SH = 1188;
const COLS = 7;
const ROWS_N = 5;
const GAP = 90;

export const CopiesField: React.FC = () => {
  const t = useTime(S.copies[0]);
  const cx = (COLS * (SW + GAP)) / 2;
  const cy = (ROWS_N * (SH + GAP)) / 2;
  const cam = {
    fx: cx + mix(-220, 180, ramp(t, 5.0, 8.3, E.soft)),
    fy: cy + mix(520, 140, ramp(t, 5.0, 8.3, E.soft)),
    z: mix(0.5, 0.43, ramp(t, 5.0, 8.3, E.soft)),
    rx: 50,
    rz: mix(-7, -4, ramp(t, 5.0, 8.3, E.soft)),
  };
  // order sheets by distance to the frame centre so grades cascade outward
  const sheets = Array.from({ length: COLS * ROWS_N }, (_, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * (SW + GAP) + (rand(i * 3) - 0.5) * 160;
    const y = row * (SH + GAP) + (rand(i * 5) - 0.5) * 160;
    const d = Math.hypot(x + SW / 2 - cx, (y + SH / 2 - cy - 300) * 1.4);
    return { i, x, y, d, rot: (rand(i * 7) - 0.5) * 11 };
  });
  const order = [...sheets].sort((a, b) => a.d - b.d).map((s) => s.i);
  return (
    <AbsoluteFill style={{ background: "#08090a" }}>
      <AbsoluteFill style={{ opacity: ramp(t, 5.0, 5.35, E.soft) }}>
        <DepthOfField
          blur={10}
          mask="linear-gradient(to bottom, transparent 10%, black 48%, black 82%, transparent 100%)"
        >
          <Camera cam={cam} perspective={1500}>
            {sheets.map((s) => {
              const rank = order.indexOf(s.i);
              const gAt = cues.gradesStart + rank * cues.gradesStep;
              const g =
                rank < cues.gradesCount
                  ? ramp(t, gAt, gAt + 0.28, E.inOut)
                  : rank < 22
                    ? 1
                    : 0;
              return (
                <div
                  key={s.i}
                  style={{
                    position: "absolute",
                    left: s.x,
                    top: s.y,
                    rotate: `${s.rot}deg`,
                  }}
                >
                  <Sheet
                    w={SW}
                    h={SH}
                    scale={0.25}
                    marginX={34 * 4}
                    tone="#ece8df"
                    style={{ boxShadow: "0 10px 40px rgba(0,0,0,0.55)" }}
                  >
                    <Hand
                      text={NAMES[s.i % NAMES.length]}
                      x={160}
                      y={110}
                      size={34}
                      seed={s.i + 1}
                    />
                    {[0, 1, 2, 3, 4, 5].map((l) => (
                      <Hand
                        key={l}
                        text={LINES[(s.i * 3 + l) % LINES.length]}
                        x={170 + (l === 0 ? 0 : 30)}
                        y={246 + l * 64 + (l > 2 ? 64 : 0)}
                        size={30}
                        seed={s.i * 10 + l}
                      />
                    ))}
                    <Hand
                      text={GRADES[(rank + s.i) % GRADES.length]}
                      x={8}
                      y={150}
                      size={78}
                      color={C.penRed}
                      progress={g}
                      seed={s.i + 40}
                      weight={600}
                    />
                  </Sheet>
                </div>
              );
            })}
          </Camera>
        </DepthOfField>
        <KeyLight x="52%" y="62%" strength={1.1} />
      </AbsoluteFill>
      <Vignette strength={0.75} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- S3 — the error, then 8/20
export const ErrorShot: React.FC = () => {
  const t = useTime(S.error[0]);
  const lineMid = SPOTS.lineCStartX + SPOTS.lineCW / 2;
  const rhsMid = SPOTS.errorRhsX + 120;
  const grade = { fx: SPOTS.gradeX + 260, fy: SPOTS.gradeY + 120, z: 1.62 };
  const ks = [
    { t: 8.3, fx: lineMid, fy: ROWS.c - 40, z: 1.3, rz: -2.5 },
    { t: 9.35, fx: rhsMid - 60, fy: ROWS.c - 30, z: 1.62, rz: -2.2 },
    { t: 10.05, fx: grade.fx, fy: grade.fy, z: grade.z, rz: -1.5 },
    { t: 11.3, fx: grade.fx + 10, fy: grade.fy + 4, z: 1.7, rz: -1.2 },
    { t: 12.7, fx: grade.fx + 20, fy: grade.fy + 8, z: 1.86, rz: -1.0 },
  ];
  const cam = {
    fx: keys(t, ks, "fx"),
    fy: keys(t, ks, "fy"),
    z: keys(t, ks, "z"),
    rz: keys(t, ks, "rz"),
    rx: 10,
  };
  return (
    <AbsoluteFill style={{ background: "#0b0b0c" }}>
      <DepthOfField
        blur={11}
        mask="radial-gradient(ellipse 46% 40% at 50% 50%, black 40%, transparent 100%)"
      >
        <Camera cam={cam} perspective={1800}>
          <EmmaCopy
            tickA={1}
            tickB={1}
            underline={ramp(t, cues.underline[0], cues.underline[1], E.inOut)}
            grade={ramp(t, cues.grade8[0], cues.grade8[1], E.linear)}
            circle={ramp(t, cues.gradeCircle[0], cues.gradeCircle[1], E.inOut)}
          />
        </Camera>
      </DepthOfField>
      <KeyLight x="22%" y="12%" />
      <Vignette strength={0.6} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- S4 — title card
export const TitleCard: React.FC = () => {
  const t = useTime(S.title[0]);
  const a =
    ramp(t, cues.titleIn, cues.titleIn + 1.1, E.out) *
    (1 - ramp(t, cues.titleOut, cues.titleOut + 0.55, E.inOut));
  return (
    <AbsoluteFill
      style={{
        background: "#000",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 118,
          fontWeight: 600,
          lineHeight: 1.08,
          letterSpacing: `${mix(0.05, 0.01, ramp(t, cues.titleIn, cues.titleIn + 2.2, E.out))}em`,
          whiteSpace: "nowrap",
          color: C.offWhite,
          opacity: a,
          filter: `blur(${(1 - ramp(t, cues.titleIn, cues.titleIn + 0.9, E.out)) * 8}px)`,
          textAlign: "center",
        }}
      >
        ET SI ON POUVAIT
        <br />
        ALLER PLUS LOIN{NNBSP}?
      </div>
    </AbsoluteFill>
  );
};
