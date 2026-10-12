import React from "react";

/** Minimal pointer (drawn, not a screenshot) with a press animation. */
export const Cursor: React.FC<{
  x: number;
  y: number;
  press?: number;
  opacity?: number;
  scale?: number;
}> = ({ x, y, press = 0, opacity = 1, scale = 1 }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      opacity,
      pointerEvents: "none",
    }}
  >
    {/* click ripple */}
    {press > 0 && press < 1 && (
      <div
        style={{
          position: "absolute",
          left: -22 * scale,
          top: -22 * scale,
          width: 44 * scale,
          height: 44 * scale,
          borderRadius: "50%",
          border: `${1.5 * scale}px solid rgba(51,63,138,${0.5 * (1 - press)})`,
          scale: `${0.4 + press * 0.9}`,
        }}
      />
    )}
    <svg
      width={22 * scale}
      height={30 * scale}
      viewBox="0 0 22 30"
      style={{
        position: "absolute",
        left: -2 * scale,
        top: -2 * scale,
        scale: `${1 - 0.12 * Math.sin(Math.PI * Math.min(1, press * 3))}`,
        transformOrigin: "2px 2px",
        filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.28))",
        overflow: "visible",
      }}
    >
      <path
        d="M2 2 L2 24 L7.6 18.8 L11.4 27.4 L15 25.8 L11.3 17.4 L18.6 17.2 Z"
        fill="#111317"
        stroke="white"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  </div>
);
