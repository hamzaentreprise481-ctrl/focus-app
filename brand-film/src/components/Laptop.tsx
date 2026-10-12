import React from "react";
import { Img, staticFile } from "remotion";
import { ScreenId } from "./AppWindow";

/**
 * A minimal, brand-neutral laptop built in CSS 3D (no logos), showing a real
 * FOCUS capture on its screen. World origin = middle of the hinge.
 */
export const Laptop: React.FC<{ screen: ScreenId; glare?: number }> = ({
  screen,
  glare = 0.5,
}) => {
  const LW = 1240;
  const LH = 800;
  const BW = 1340;
  const BD = 880;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transformStyle: "preserve-3d",
      }}
    >
      {/* floor shadow */}
      <div
        style={{
          position: "absolute",
          left: -BW * 0.62,
          top: 0,
          width: BW * 1.24,
          height: BD * 1.15,
          transformOrigin: "50% 0",
          transform: "rotateX(90deg) translateZ(-4px)",
          background:
            "radial-gradient(closest-side, rgba(0,0,0,0.75), rgba(0,0,0,0.0))",
          filter: "blur(18px)",
        }}
      />
      {/* base deck */}
      <div
        style={{
          position: "absolute",
          left: -BW / 2,
          top: 0,
          width: BW,
          height: BD,
          transformOrigin: "50% 0",
          transform: "rotateX(90deg)",
          borderRadius: "10px 10px 36px 36px",
          background:
            "linear-gradient(180deg, #33363d 0%, #26292f 55%, #1e2025 100%)",
          boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 70,
            right: 70,
            top: 60,
            height: 420,
            borderRadius: 14,
            background: "#16181c",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
            backgroundImage:
              "repeating-linear-gradient(to right, rgba(255,255,255,0.035) 0 2px, transparent 2px 84px), repeating-linear-gradient(to bottom, rgba(255,255,255,0.035) 0 2px, transparent 2px 84px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: BW / 2 - 260,
            width: 520,
            top: 520,
            height: 300,
            borderRadius: 18,
            background: "linear-gradient(180deg, #2c2f35, #24262b)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
          }}
        />
      </div>
      {/* front lip of the base */}
      <div
        style={{
          position: "absolute",
          left: -BW / 2,
          top: 0,
          width: BW,
          height: 22,
          transform: `translateZ(${BD}px)`,
          borderRadius: "0 0 18px 18px",
          background: "linear-gradient(180deg, #4a4e57, #1a1c20)",
        }}
      />
      {/* lid, opened ~100° */}
      <div
        style={{
          position: "absolute",
          left: -LW / 2,
          top: -LH,
          width: LW,
          height: LH,
          transformOrigin: "50% 100%",
          transform: "rotateX(10deg)",
          borderRadius: "30px 30px 8px 8px",
          background: "#0a0b0d",
          boxShadow:
            "inset 0 0 0 2px #3a3e46, inset 0 0 0 4px #0a0b0d, 0 0 60px rgba(91,103,201,0.12)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 26,
            top: 26,
            right: 26,
            bottom: 34,
            borderRadius: 8,
            overflow: "hidden",
            background: "#f8f8f7",
          }}
        >
          <Img
            src={staticFile(`captures/${screen}/viewport.webp`)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "0 0",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(118deg, rgba(255,255,255,${0.16 * glare}) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 70%, rgba(255,255,255,${0.05 * glare}) 100%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
};
