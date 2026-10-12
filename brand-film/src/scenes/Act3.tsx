import React from "react";
import { AbsoluteFill } from "remotion";
import {
  AppWindow,
  BuildItem,
  Lifted,
  PageLayer,
  Spotlight,
  box,
} from "../components/AppWindow";
import { Camera } from "../components/Camera";
import { Cursor } from "../components/Cursor";
import { Caption, Graphite, Vignette } from "../components/Finish";
import { LogoSquare, Wordmark } from "../components/Logo";
import { Hand, PEN, Sheet, Strokes } from "../components/Paper";
import { C, MONO, SANS } from "../theme";
import { E, TL, keys, mix, ramp, useTime, window01 } from "../lib/anim";
import { LOCK } from "./Act2";

const cues = TL.cues;
const S = TL.scenes;

type K = {
  t: number;
  fx: number;
  fy: number;
  z: number;
  rx: number;
  ry: number;
};
const k = (
  t: number,
  fx: number,
  fy: number,
  z: number,
  rx = 0,
  ry = 0,
): K => ({ t, fx, fy, z, rx, ry });

// Scroll positions of the <main> column (CSS px), like a teacher scrolling.
const EVAL_SCROLL = 400;
const STUDENT_SCROLL = 560;

const emmaRow = box("evaluation", "emmaRow");
const skillRow = box("evaluation", "skillRow0");
const kpi2 = box("student", "kpi2");
const analysis = box("student", "analysis");
const actions = box("student", "actions");
const cta = box("student", "cta");
const rowCalcul = box("evaluations", "rowCalcul");
const feedEmma = box("dashboard", "feed3");

const M = cues.matchCut; // 42.4
const D = cues.dashboardIn; // 49.0

const CAM: K[] = [
  k(28.6, 720, 450, 1.08),
  k(30.1, 720, 450, 1.08),
  k(32.0, 742, 468, 1.12),
  k(32.4, 748, 440, 1.13),
  k(35.3, 840, 400, 1.2),
  k(36.3, skillRow.x + skillRow.w / 2 - 40, skillRow.y + 16, 1.78),
  k(36.6, skillRow.x + skillRow.w / 2 - 40, skillRow.y + 16, 1.78),
  k(37.6, 860, emmaRow.y + emmaRow.h / 2 - EVAL_SCROLL, 1.56),
  k(39.2, 860, emmaRow.y + emmaRow.h / 2 - EVAL_SCROLL, 1.6),
  k(40.0, 760, 560, 1.12),
  k(M - 0.001, 750, 560, 1.1),
  k(M, kpi2.x + kpi2.w / 2, kpi2.y + kpi2.h / 2, 2.1),
  k(43.0, kpi2.x + kpi2.w / 2 - 10, kpi2.y + kpi2.h / 2, 2.04),
  k(44.0, 760, 440, 1.12),
  k(
    45.0,
    analysis.x + analysis.w / 2,
    analysis.y + analysis.h / 2 - STUDENT_SCROLL,
    1.62,
  ),
  k(
    46.5,
    analysis.x + analysis.w / 2 - 8,
    analysis.y + analysis.h / 2 - STUDENT_SCROLL,
    1.66,
  ),
  k(
    47.3,
    actions.x + actions.w / 2,
    actions.y + actions.h / 2 - STUDENT_SCROLL,
    1.66,
  ),
  k(
    D - 0.001,
    actions.x + actions.w / 2 - 30,
    actions.y + actions.h / 2 - STUDENT_SCROLL + 6,
    1.7,
  ),
  k(D, 760, 330, 1.32),
  k(51.2, 720, 390, 1.16),
  k(53.8, 730, 450, 0.9, 4, -6),
];

const at = (t: number, p: keyof Omit<K, "t">) => keys(t, CAM, p);

export const AppScene: React.FC = () => {
  const t = useTime(S.app[0]);
  const cam = {
    fx: at(t, "fx"),
    fy: at(t, "fy"),
    z: at(t, "z"),
    rx: at(t, "rx"),
    ry: at(t, "ry"),
  };

  // ---- which real screen is on display
  const evalScroll = mix(
    0,
    EVAL_SCROLL,
    ramp(t, cues.scrollToStruggling[0], cues.scrollToStruggling[1], E.inOut),
  );
  const studScroll = mix(0, STUDENT_SCROLL, ramp(t, 44.0, 44.95, E.inOut));
  const pages: PageLayer[] = [];
  if (t < 32.36)
    pages.push({
      screen: "evaluations",
      build: [
        { key: "header", at: cues.listIn },
        ...[0, 1, 2, 3, 4].map((i) => ({
          key: `row${i}`,
          at: cues.listIn + 0.12 + i * 0.07,
        })),
      ],
      holdSidebar: true,
      // the list clears before the detail page builds (no double exposure)
      opacity: 1 - ramp(t, cues.clickRow + 0.02, cues.detailIn - 0.03, E.inOut),
    });
  if (t >= cues.detailIn - 0.05 && t < M)
    pages.push({
      screen: "evaluation",
      scroll: evalScroll,
      opacity: ramp(t, cues.detailIn - 0.08, cues.detailIn + 0.06, E.inOut),
      build: seq(
        cues.detailIn,
        [
          "header",
          "kpi0",
          "kpi1",
          "kpi2",
          "distribution",
          "skills",
          "struggling",
        ],
        0.1,
      ),
    });
  if (t >= M && t < D)
    pages.push({
      screen: "student",
      scroll: studScroll,
      // the match cut lands on the complete, real profile page
      build: [
        "kpi2",
        "header",
        "kpi0",
        "kpi1",
        "chart",
        "skills",
        "analysis",
        "actions",
      ].map((key) => ({ key, at: M - 1, dur: 0.01 })),
    });
  if (t >= D)
    pages.push({
      screen: "dashboard",
      build: seq(
        D,
        ["header", "kpi0", "kpi1", "kpi2", "kpi3", "feed", "weakest"],
        0.08,
      ),
    });

  // ---- window-space overlays (spotlights, cursor)
  const scroll = t < M ? evalScroll : t < D ? studScroll : 0;
  const winBox = (b: { x: number; y: number; w: number; h: number }) => ({
    ...b,
    y: b.y - scroll,
  });
  const spot = (() => {
    if (t < cues.skillHighlight - 0.1) return null;
    if (t < cues.scrollToStruggling[0] + 0.3)
      return (
        <Spotlight
          b={winBox(skillRow)}
          pad={12}
          amount={window01(
            t,
            cues.skillHighlight,
            cues.skillHighlight + 0.4,
            36.55,
            36.85,
          )}
        />
      );
    if (t < M)
      return (
        <Spotlight
          b={winBox(emmaRow)}
          pad={6}
          amount={window01(
            t,
            cues.emmaSpotlight,
            cues.emmaSpotlight + 0.45,
            M - 0.25,
            M,
          )}
        />
      );
    if (t < 43.6)
      return (
        <Spotlight
          b={winBox(kpi2)}
          pad={0}
          radius={18}
          amount={window01(t, M + 0.15, M + 0.5, 43.0, 43.5)}
        />
      );
    if (t < 46.6)
      return (
        <Spotlight
          b={winBox(analysis)}
          pad={0}
          radius={18}
          ring={0}
          amount={window01(t, 44.85, 45.25, 46.4, 46.8)}
        />
      );
    if (t < D)
      return (
        <Spotlight
          b={winBox(actions)}
          pad={0}
          radius={18}
          amount={window01(t, 46.8, 47.2, D - 0.2, D)}
        />
      );
    return (
      <Spotlight
        b={feedEmma}
        pad={0}
        radius={12}
        amount={window01(t, 49.75, 50.15, 50.9, 51.4)}
      />
    );
  })();

  const cursor1 = t >= 30.5 && t < 33.0 && (
    <Cursor
      x={mix(
        1010,
        rowCalcul.x + 420,
        ramp(t, cues.cursorToRow[0], cues.cursorToRow[1], E.inOut),
      )}
      y={mix(
        780,
        rowCalcul.y + 50,
        ramp(t, cues.cursorToRow[0], cues.cursorToRow[1], E.inOut),
      )}
      press={ramp(t, cues.clickRow, cues.clickRow + 0.45, E.out)}
      opacity={window01(t, 30.55, 30.85, 32.55, 32.9)}
    />
  );
  const rowHover = window01(
    t,
    31.65,
    31.95,
    cues.clickRow + 0.02,
    cues.detailIn - 0.03,
  );
  const cursor2 = t >= 47.2 && t < D && (
    <Cursor
      x={mix(1230, cta.x + 150, ramp(t, 47.5, 48.4, E.inOut))}
      y={mix(620, cta.y + 26 - STUDENT_SCROLL, ramp(t, 47.5, 48.4, E.inOut))}
      opacity={window01(t, 47.3, 47.6, D - 0.25, D)}
    />
  );

  // ---- logo dock: the centred lockup from Act II glides into the real sidebar logo
  const dock = ramp(t, cues.dock[0], cues.dock[1], E.inOut);
  const winIn = ramp(t, 28.8, 29.45, E.soft);
  const z0 = 1.08;
  const sbSq = {
    x: 960 + z0 * (20 - 720),
    y: 540 + z0 * (18 - 450),
    s: 28 * z0,
  };
  const sbWord = { x: 960 + z0 * (56 - 720), s: 15 * z0 };
  const sqSize = mix(LOCK.sq, sbSq.s, dock);
  const sqX = mix(LOCK.left, sbSq.x, dock);
  const sqY = mix(LOCK.cy - LOCK.sq / 2, sbSq.y, dock);
  const wSize = mix(LOCK.word, sbWord.s, dock);
  const wX = mix(LOCK.wordLeft, sbWord.x, dock);
  const lockOpacity =
    1 - ramp(t, cues.dock[1] - 0.05, cues.dock[1] + 0.25, E.soft);

  // ---- conceptual copy-analysis panel (NOT in the V0 product — labelled on screen)
  const panel = window01(t, cues.conceptIn, cues.conceptIn + 0.7, M - 0.3, M);

  const end = ramp(t, 53.0, 53.8, E.soft);

  return (
    <AbsoluteFill>
      <Graphite
        glow={mix(1, 0.35, dock)}
        glowAt={`${mix((LOCK.sqCx / 1920) * 100, 50, dock)}% ${mix(50, 48, dock)}%`}
      />
      <AbsoluteFill style={{ opacity: winIn * (1 - end * 0.45) }}>
        <Camera cam={cam} perspective={2400}>
          <AppWindow
            t={t}
            pages={pages}
            overlay={
              <>
                {rowHover > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      left: rowCalcul.x,
                      top: rowCalcul.y,
                      width: rowCalcul.w,
                      height: rowCalcul.h,
                      borderRadius: 18,
                      background: `rgba(20,22,27,${0.035 * rowHover})`,
                      boxShadow: `inset 0 0 0 1px rgba(215,212,205,${rowHover})`,
                    }}
                  />
                )}
                {spot}
                {cursor1}
                {cursor2}
              </>
            }
          />
          {t >= 44.8 && t < 47.0 && (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 1440,
                height: 900,
                overflow: "visible",
              }}
            >
              <Lifted
                screen="student"
                k="analysis"
                scroll={STUDENT_SCROLL}
                lift={window01(t, 44.95, 45.5, 46.35, 46.85)}
                scaleTo={1.06}
              />
            </div>
          )}
        </Camera>
      </AbsoluteFill>

      {/* docking lockup */}
      {lockOpacity > 0.001 && (
        <AbsoluteFill style={{ opacity: lockOpacity }}>
          <div style={{ position: "absolute", left: sqX, top: sqY }}>
            <LogoSquare
              size={sqSize}
              style={{
                boxShadow: `0 0 ${60 * (1 - dock)}px rgba(91,103,201,${0.35 * (1 - dock)})`,
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: wX,
              top: mix(LOCK.cy, sbSq.y + sbSq.s / 2, dock) - wSize / 2,
              height: wSize,
              display: "flex",
              alignItems: "center",
            }}
          >
            <Wordmark
              size={wSize}
              color={mixRgb(
                [236, 234, 228],
                [20, 22, 27],
                ramp(t, cues.dock[0] + 0.5, cues.dock[1], E.inOut),
              )}
            />
          </div>
        </AbsoluteFill>
      )}

      {panel > 0.001 && <ConceptPanel t={t} o={panel} />}
      <Caption text="Visualisation conceptuelle" opacity={panel} />
      <Caption
        text="Interface réelle · prototype FOCUS · données fictives"
        opacity={
          window01(t, 30.2, 31.0, 36.0, 36.6) +
          window01(t, 43.4, 44.0, 45.0, 45.6)
        }
      />
      <Vignette strength={0.3} />
    </AbsoluteFill>
  );
};

function seq(start: number, ks: string[], step: number): BuildItem[] {
  return ks.map((key, i) => ({ key, at: start + i * step }));
}

function mixRgb(a: number[], b: number[], p: number) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * p)).join(",")})`;
}

// ------------------------------------------------------------------ conceptual panel
const ConceptPanel: React.FC<{ t: number; o: number }> = ({ t, o }) => {
  const underline = ramp(
    t,
    cues.conceptError,
    cues.conceptError + 0.45,
    E.inOut,
  );
  const err = ramp(t, cues.conceptError + 0.3, cues.conceptError + 0.8, E.out);
  const tag1 = ramp(t, cues.notionTags[0], cues.notionTags[0] + 0.5, E.out);
  const tag2 = ramp(t, cues.notionTags[1], cues.notionTags[1] + 0.5, E.out);
  return (
    <div
      style={{
        position: "absolute",
        left: 900,
        top: 372,
        width: 840,
        boxSizing: "border-box",
        opacity: o,
        translate: `0 ${(1 - o) * 36}px`,
        filter: `blur(${(1 - o) * 6}px)`,
        background: "#ffffff",
        borderRadius: 22,
        padding: 30,
        boxShadow:
          "0 0 0 1px rgba(230,228,224,1), 0 40px 120px rgba(0,0,0,0.55), 0 10px 30px rgba(0,0,0,0.25)",
        fontFamily: SANS,
        color: C.graphite2,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div
            style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.01em" }}
          >
            Copie d’Emma L.
          </div>
          <div style={{ fontSize: 18, color: "#4b4f58", marginTop: 4 }}>
            Contrôle — Calcul littéral · Exercice 2
          </div>
        </div>
        <div
          style={{
            fontSize: 19,
            fontWeight: 500,
            color: C.attention,
            background: "#fbeaea",
            borderRadius: 999,
            padding: "6px 14px",
          }}
        >
          8 / 20
        </div>
      </div>
      <div
        style={{
          position: "relative",
          height: 150,
          marginTop: 20,
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "inset 0 0 0 1px #e6e4e0",
        }}
      >
        <Sheet w={720} h={150} scale={0.5} marginX={52} tone="#f7f4ee">
          <Hand
            text="C = 3(x + 2) = 3x + 2"
            x={96}
            y={100}
            size={66}
            seed={23}
            markFrom={15}
            mark={
              <span
                style={{
                  position: "absolute",
                  left: -10,
                  top: 2,
                  width: 170,
                  height: 12,
                }}
              >
                <Strokes
                  paths={PEN.underline}
                  x={0}
                  y={0}
                  w={170}
                  h={10}
                  progress={underline}
                  width={4.5}
                  viewBox="0 0 420 14"
                />
              </span>
            }
          />
        </Sheet>
      </div>
      <Row label="Erreur identifiée" o={err}>
        Distributivité incomplète : le facteur 3 n’est appliqué qu’au premier
        terme.
      </Row>
      <Row label="Notion associée" o={tag1}>
        <span style={{ display: "flex", gap: 10 }}>
          <Pill o={tag1}>Calcul littéral</Pill>
          <Pill o={tag2}>Développement</Pill>
        </span>
      </Row>
      <div
        style={{ marginTop: 18, fontSize: 15, color: "#8b8f99", opacity: tag2 }}
      >
        Suggestion à confirmer par l’enseignant.
      </div>
    </div>
  );
};

const Row: React.FC<{
  label: string;
  o: number;
  children: React.ReactNode;
}> = ({ label, o, children }) => (
  <div style={{ marginTop: 20, opacity: o, translate: `0 ${(1 - o) * 10}px` }}>
    <div
      style={{
        fontFamily: MONO,
        fontSize: 14,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "#8b8f99",
      }}
    >
      {label}
    </div>
    <div
      style={{
        marginTop: 6,
        fontSize: 21,
        lineHeight: 1.35,
        color: C.graphite2,
      }}
    >
      {children}
    </div>
  </div>
);

const Pill: React.FC<{ o: number; children: React.ReactNode }> = ({
  o,
  children,
}) => (
  <span
    style={{
      opacity: o,
      scale: `${0.92 + 0.08 * o}`,
      display: "inline-block",
      fontSize: 19,
      fontWeight: 500,
      color: C.brandInk,
      background: C.brandSoft,
      borderRadius: 999,
      padding: "7px 16px",
      boxShadow: `inset 0 0 0 1px rgba(51,63,138,0.35)`,
    }}
  >
    {children}
  </span>
);
