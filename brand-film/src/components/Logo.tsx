import React from "react";
import { C, SANS } from "../theme";

/**
 * The real FOCUS mark, rebuilt at film resolution from components/layout/sidebar.tsx:
 * a bg-brand rounded square (radius 0.5rem for 28px → 0.2857) with a white
 * semibold "F" (13px for 28px → 0.464), next to the "FOCUS" wordmark
 * (15px semibold, tracking-tight). Proportions are kept identical.
 */
export const LogoSquare: React.FC<{
  size: number;
  color?: string;
  fOpacity?: number;
  sweep?: number; // 0..1 light sweep position (sober specular pass)
  style?: React.CSSProperties;
}> = ({ size, color = C.brand, fOpacity = 1, sweep = -1, style }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.2857,
      backgroundColor: color,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      overflow: "hidden",
      boxShadow: `inset 0 ${size * 0.012}px 0 rgba(255,255,255,0.10)`,
      ...style,
    }}
  >
    <span
      style={{
        fontFamily: SANS,
        fontWeight: 600,
        fontSize: size * 0.464,
        color: "white",
        opacity: fOpacity,
        lineHeight: 1,
        translate: `0 ${-size * 0.004}px`,
      }}
    >
      F
    </span>
    {sweep > -1 && sweep < 2 && (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(115deg, transparent ${(sweep - 0.25) * 100}%, rgba(255,255,255,0.46) ${sweep * 100}%, transparent ${(sweep + 0.25) * 100}%)`,
          mixBlendMode: "screen",
        }}
      />
    )}
  </div>
);

export const Wordmark: React.FC<{
  size: number;
  color?: string;
  tracking?: number;
  style?: React.CSSProperties;
}> = ({ size, color = C.offWhite, tracking = -0.025, style }) => (
  <span
    style={{
      fontFamily: SANS,
      fontWeight: 600,
      fontSize: size,
      letterSpacing: `${tracking}em`,
      color,
      lineHeight: 1,
      ...style,
    }}
  >
    FOCUS
  </span>
);
