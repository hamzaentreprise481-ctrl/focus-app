import React from "react";
import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C } from "../theme";

/** Graphite backdrop with a very soft key light (top-left) and a faint brand tint. */
export const Graphite: React.FC<{ glow?: number; glowAt?: string }> = ({
  glow = 0,
  glowAt = "50% 48%",
}) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 90% at 30% 20%, ${C.graphite3} 0%, ${C.graphite2} 38%, ${C.graphite} 100%)`,
    }}
  >
    {glow > 0 && (
      <AbsoluteFill
        style={{
          background: `radial-gradient(38% 34% at ${glowAt}, rgba(91,103,201,${0.22 * glow}) 0%, rgba(51,63,138,${0.08 * glow}) 45%, transparent 75%)`,
        }}
      />
    )}
  </AbsoluteFill>
);

/** Lens vignette (multiply-like darkening of the edges). */
export const Vignette: React.FC<{ strength?: number }> = ({
  strength = 0.55,
}) => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background: `radial-gradient(ellipse 75% 70% at 50% 48%, transparent 55%, rgba(5,6,8,${strength}) 100%)`,
    }}
  />
);

/** Fine animated film grain — kept very low so it adds texture, not noise. */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.05 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seed = Math.floor((frame / fps) * 15) % 8; // grain refreshes at 15 fps, like film, whatever the render rate
  const src = staticFile(`textures/grain_${seed}.png`);
  const T = 256;
  return (
    <AbsoluteFill
      style={{ pointerEvents: "none", opacity, mixBlendMode: "overlay" }}
    >
      {Array.from(
        { length: Math.ceil(1920 / T) * Math.ceil(1080 / T) },
        (_, i) => (
          <Img
            key={i}
            src={src}
            style={{
              position: "absolute",
              left: (i % 8) * T,
              top: Math.floor(i / 8) * T,
              width: T,
              height: T,
            }}
          />
        ),
      )}
    </AbsoluteFill>
  );
};

/** Warm window light falling across a desk (for the paper shots). */
export const KeyLight: React.FC<{
  x?: string;
  y?: string;
  strength?: number;
}> = ({ x = "18%", y = "10%", strength = 1 }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill
      style={{
        background: `radial-gradient(70% 80% at ${x} ${y}, rgba(255,246,228,${0.16 * strength}) 0%, transparent 60%)`,
        mixBlendMode: "screen",
      }}
    />
    <AbsoluteFill
      style={{
        background: `radial-gradient(90% 95% at ${x} ${y}, transparent 30%, rgba(8,8,10,${0.62 * strength}) 100%)`,
      }}
    />
  </AbsoluteFill>
);

/** Small technical caption (used to label conceptual sequences honestly). */
export const Caption: React.FC<{
  text: string;
  opacity: number;
  dark?: boolean;
  style?: React.CSSProperties;
}> = ({ text, opacity, dark = true, style }) => (
  <div
    style={{
      position: "absolute",
      left: 96,
      bottom: 72,
      fontFamily: "IBM Plex Mono",
      fontSize: 16,
      fontWeight: 500,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: dark ? "rgba(236,234,228,0.72)" : "rgba(20,22,27,0.6)",
      opacity,
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 16px",
      borderRadius: 999,
      background: "rgba(12,13,16,0.62)",
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
      ...style,
    }}
  >
    <span style={{ width: 18, height: 1, background: "currentColor" }} />
    {text}
  </div>
);
