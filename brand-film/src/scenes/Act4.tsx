import React from "react";
import { AbsoluteFill } from "remotion";
import { AppWindow, Spotlight, box } from "../components/AppWindow";
import { Camera, DepthOfField } from "../components/Camera";
import { Cursor } from "../components/Cursor";
import { Graphite, KeyLight, Vignette } from "../components/Finish";
import { Laptop } from "../components/Laptop";
import { Hand, LINE, MM, Sheet } from "../components/Paper";
import { E, TL, keys, mix, ramp, useTime, window01 } from "../lib/anim";

const cues = TL.cues;
const S = TL.scenes;

// ---------------------------------------------------------------- tableau de suivi (real class roster)
export const RosterShot: React.FC = () => {
  const t = useTime(S.roster[0]);
  const p = ramp(t, cues.rosterScroll[0], cues.rosterScroll[1], E.soft);
  const scroll = mix(40, 560, p);
  const emma = box("roster", "emmaTr");
  return (
    <AbsoluteFill>
      <Graphite glow={0.4} />
      <Camera
        cam={{
          fx: mix(880, 820, p),
          fy: mix(430, 470, p),
          z: mix(1.3, 1.42, p),
          rx: mix(5, 3, p),
          ry: mix(13, 8, p),
        }}
        perspective={2200}
      >
        <AppWindow
          t={t}
          pages={[{ screen: "roster", scroll }]}
          overlay={
            <Spotlight
              b={{ ...emma, y: emma.y - scroll }}
              pad={2}
              radius={8}
              ring={0.6}
              amount={0.55 * window01(t, 54.25, 54.6, 55.5, 55.9)}
            />
          }
        />
      </Camera>
      <Vignette strength={0.3} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- préparer un accompagnement (real dialog)
export const DialogShot: React.FC = () => {
  const t = useTime(S.dialog[0]);
  const dlg = box("dialog-open", "dialog");
  const confirm = box("dialog-open", "confirm");
  const p = ramp(t, 56.2, 58.6, E.soft);
  const move = ramp(t, 56.55, 57.25, E.inOut);
  return (
    <AbsoluteFill>
      <Graphite glow={0.4} />
      <Camera
        cam={{
          fx: dlg.x + dlg.w / 2 + mix(30, 10, p),
          fy: dlg.y + dlg.h / 2,
          z: mix(1.86, 1.98, p),
          ry: mix(-6, -2, p),
          rx: 2,
        }}
        perspective={2200}
      >
        <AppWindow
          t={t}
          pages={[
            { screen: "dialog-open", viewportOnly: true },
            {
              screen: "dialog-created",
              viewportOnly: true,
              opacity: ramp(
                t,
                cues.dialogClick + 0.12,
                cues.dialogClick + 0.35,
                E.inOut,
              ),
            },
          ]}
          overlay={
            <Cursor
              x={mix(1020, confirm.x + confirm.w / 2, move)}
              y={mix(640, confirm.y + confirm.h / 2 + 4, move)}
              press={ramp(t, cues.dialogClick, cues.dialogClick + 0.45, E.out)}
              opacity={window01(t, 56.4, 56.7, 57.9, 58.3)}
            />
          }
        />
      </Camera>
      <Vignette strength={0.3} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- un élève qui travaille (the line, rewritten)
const LINE_TEXT = "C = 3(x + 2) = 3x + 6";
const LINE_W = 807; // Caveat 500 @110px, measured
export const WriteShot: React.FC = () => {
  const t = useTime(S.write[0]);
  const w = ramp(t, cues.writeLine[0], cues.writeLine[1], E.linear);
  const x0 = 46 * MM;
  const y0 = 0.5 * LINE + 4 * LINE - 10;
  const head = x0 + LINE_W * w; // where the pen is
  const cam = {
    fx: keys(
      t,
      [
        { t: 58.6, v: x0 + 260 },
        { t: 61.0, v: x0 + 640 },
      ],
      "v",
      E.soft,
    ),
    fy: y0 - 70,
    z: mix(1.32, 1.4, ramp(t, 58.6, 61.0, E.soft)),
    rx: 13,
    rz: -2.5,
  };
  const penShadow = window01(t, 58.9, 59.1, 60.7, 61.0);
  return (
    <AbsoluteFill style={{ background: "#0b0b0c" }}>
      <DepthOfField
        blur={10}
        mask="linear-gradient(to bottom, transparent 10%, black 38%, black 64%, transparent 92%)"
      >
        <Camera cam={cam} perspective={1800}>
          <Sheet w={210 * MM} h={110 * MM} marginX={34 * MM}>
            <Hand
              text="Exercice de renforcement"
              x={x0 - 6 * MM}
              y={0.5 * LINE + 2 * LINE - 10}
              size={100}
              seed={41}
            />
            <Hand
              text={LINE_TEXT}
              x={x0}
              y={y0}
              size={110}
              seed={43}
              progress={w}
            />
            {/* the pen's soft shadow travelling with the writing head */}
            <div
              style={{
                position: "absolute",
                left: head + 30,
                top: y0 - 40,
                width: 520,
                height: 70,
                borderRadius: 60,
                rotate: "28deg",
                transformOrigin: "0 50%",
                background: "rgba(10,10,14,0.22)",
                filter: "blur(22px)",
                opacity: penShadow,
              }}
            />
          </Sheet>
        </Camera>
      </DepthOfField>
      <KeyLight x="30%" y="8%" />
      <Vignette strength={0.6} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- the software, on a laptop
export const LaptopShot: React.FC = () => {
  const t = useTime(S.laptop[0]);
  const p = ramp(t, 61.0, 63.4, E.soft);
  return (
    <AbsoluteFill>
      <Graphite glow={0.7} glowAt="50% 40%" />
      <Camera
        cam={{
          fx: mix(40, 70, p),
          fy: mix(-330, -350, p),
          z: mix(0.9, 0.98, p),
          rx: mix(-9, -6, p),
          ry: mix(-20, -11, p),
        }}
        perspective={2600}
      >
        <Laptop screen="student" glare={mix(0.8, 0.4, p)} />
      </Camera>
      <Vignette strength={0.6} />
    </AbsoluteFill>
  );
};
