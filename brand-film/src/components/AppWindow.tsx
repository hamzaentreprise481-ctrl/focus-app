import React from "react";
import { Img, staticFile } from "remotion";
import manifestJson from "../../public/captures/manifest.json";
import { C } from "../theme";
import { E, ramp } from "../lib/anim";

export type Box = { x: number; y: number; w: number; h: number };
type Shot = {
  url: string;
  dpr: number;
  viewport: { width: number; height: number };
  tallHeight?: number;
  boxes: Record<string, Box | null>;
};
export const MANIFEST = manifestJson as unknown as Record<string, Shot>;
export type ScreenId =
  | "evaluations"
  | "evaluation"
  | "student"
  | "dashboard"
  | "roster"
  | "dialog-open"
  | "dialog-created";

export const WIN_W = 1440;
export const WIN_H = 900;
export const SIDEBAR_W = 240;

export const box = (screen: ScreenId, key: string): Box => {
  const b = MANIFEST[screen].boxes[key];
  if (!b) throw new Error(`Missing box ${screen}.${key}`);
  return b;
};

/** A rectangular crop of a capture, positioned in its own page coordinates. */
const Crop: React.FC<{
  src: string;
  imgH: number;
  b: Box;
  dx?: number;
  dy?: number;
  style?: React.CSSProperties;
}> = ({ src, imgH, b, dx = 0, dy = 0, style }) => (
  <div
    style={{
      position: "absolute",
      left: b.x + dx,
      top: b.y + dy,
      width: b.w,
      height: b.h,
      overflow: "hidden",
      ...style,
    }}
  >
    <Img
      src={src}
      style={{
        position: "absolute",
        left: -b.x,
        top: -b.y,
        width: WIN_W,
        height: imgH,
        maxWidth: "none",
      }}
    />
  </div>
);

export type BuildItem = { key: string; at: number; dy?: number; dur?: number };

export type PageLayer = {
  screen: ScreenId;
  scroll?: number;
  opacity?: number;
  /** When set, the main area is rebuilt element by element (real crops) instead of shown whole. */
  build?: BuildItem[];
  /** Static viewport image (dialogs): no scroll, no build. */
  viewportOnly?: boolean;
  /** Keep this layer's sidebar opaque while its main column fades (identical sidebars). */
  holdSidebar?: boolean;
};

/**
 * The FOCUS app window, reconstructed from real Playwright captures:
 * fixed sidebar (viewport capture) + scrollable main column (tall capture),
 * exactly like the real layout (<aside> + overflow-y <main>).
 */
export const AppWindow: React.FC<{
  t: number;
  pages: PageLayer[];
  pageOverlay?: (scroll: number) => React.ReactNode; // drawn in page space of the top layer
  overlay?: React.ReactNode; // drawn in window space
  radius?: number;
}> = ({ t, pages, pageOverlay, overlay, radius = 16 }) => {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: WIN_W,
        height: WIN_H,
        borderRadius: radius,
        overflow: "hidden",
        background: C.appPaper,
        boxShadow:
          "0 0 0 1px rgba(255,255,255,0.10), 0 2px 6px rgba(0,0,0,0.25), 0 30px 80px rgba(0,0,0,0.45), 0 80px 200px rgba(0,0,0,0.55)",
      }}
    >
      {pages.map((p, i) => {
        const shot = MANIFEST[p.screen];
        const op = p.opacity ?? 1;
        if (op <= 0.001) return null;
        if (p.viewportOnly) {
          return (
            <Img
              key={i}
              src={staticFile(`captures/${p.screen}/viewport.webp`)}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: WIN_W,
                height: WIN_H,
                opacity: op,
              }}
            />
          );
        }
        const tallSrc = staticFile(`captures/${p.screen}/tall.webp`);
        const vpSrc = staticFile(`captures/${p.screen}/viewport.webp`);
        const imgH = shot.tallHeight ?? WIN_H;
        const scroll = p.scroll ?? 0;
        return (
          <div key={i} style={{ position: "absolute", inset: 0 }}>
            {/* main column */}
            <div
              style={{
                position: "absolute",
                opacity: op,
                left: SIDEBAR_W,
                top: 0,
                width: WIN_W - SIDEBAR_W,
                height: WIN_H,
                overflow: "hidden",
                background: C.appPaper,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: -SIDEBAR_W,
                  top: -scroll,
                  width: WIN_W,
                  height: imgH,
                }}
              >
                {p.build ? (
                  p.build.map((it) => {
                    const pr = ramp(t, it.at, it.at + (it.dur ?? 0.7), E.out);
                    if (pr <= 0) return null;
                    return (
                      <Crop
                        key={it.key}
                        src={tallSrc}
                        imgH={imgH}
                        b={box(p.screen, it.key)}
                        dy={(1 - pr) * (it.dy ?? 16)}
                        style={{ opacity: pr }}
                      />
                    );
                  })
                ) : (
                  <Img
                    src={tallSrc}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      width: WIN_W,
                      height: imgH,
                      maxWidth: "none",
                    }}
                  />
                )}
                {i === pages.length - 1 && pageOverlay?.(scroll)}
              </div>
            </div>
            {/* fixed sidebar */}
            <div
              style={{
                position: "absolute",
                opacity: p.holdSidebar ? 1 : op,
                left: 0,
                top: 0,
                width: SIDEBAR_W,
                height: WIN_H,
                overflow: "hidden",
              }}
            >
              <Img
                src={vpSrc}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: WIN_W,
                  height: WIN_H,
                  maxWidth: "none",
                }}
              />
            </div>
          </div>
        );
      })}
      {overlay}
    </div>
  );
};

/** Dims everything except a rounded rectangle (window-space box), with a fine brand ring. */
export const Spotlight: React.FC<{
  b: Box;
  amount: number;
  pad?: number;
  radius?: number;
  ring?: number;
}> = ({ b, amount, pad = 8, radius = 14, ring = 1 }) => {
  if (amount <= 0.001) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: b.x - pad,
        top: b.y - pad,
        width: b.w + pad * 2,
        height: b.h + pad * 2,
        borderRadius: radius,
        boxShadow: `0 0 0 4000px rgba(14,15,19,${0.5 * amount}), 0 0 0 ${2}px rgba(51,63,138,${0.85 * amount * ring}), 0 0 32px rgba(91,103,201,${0.45 * amount * ring})`,
        pointerEvents: "none",
      }}
    />
  );
};

/** A real UI element lifted off the page (rendered in world space above the window). */
export const Lifted: React.FC<{
  screen: ScreenId;
  k: string;
  scroll: number;
  lift: number; // 0..1
  scaleTo?: number;
}> = ({ screen, k, scroll, lift, scaleTo = 1.07 }) => {
  if (lift <= 0.001) return null;
  const b = box(screen, k);
  const shot = MANIFEST[screen];
  const s = 1 + (scaleTo - 1) * lift;
  return (
    <div
      style={{
        position: "absolute",
        left: b.x,
        top: b.y - scroll,
        width: b.w,
        height: b.h,
        borderRadius: 18,
        overflow: "hidden",
        scale: `${s}`,
        boxShadow: `0 ${30 * lift}px ${90 * lift}px rgba(0,0,0,${0.35 * lift}), 0 0 0 1px rgba(51,63,138,${0.25 * lift})`,
      }}
    >
      <Img
        src={staticFile(`captures/${screen}/tall.webp`)}
        style={{
          position: "absolute",
          left: -b.x,
          top: -b.y,
          width: WIN_W,
          height: shot.tallHeight ?? WIN_H,
          maxWidth: "none",
        }}
      />
    </div>
  );
};
