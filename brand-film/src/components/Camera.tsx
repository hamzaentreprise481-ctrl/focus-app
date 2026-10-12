import React from "react";
import { AbsoluteFill } from "remotion";

export type Cam = {
  fx: number;
  fy: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
};

/**
 * Virtual camera: brings world point (fx, fy) to the centre of the 1920×1080
 * frame, zoomed by z, with optional 3D tilt. Children live in world space.
 */
export const Camera: React.FC<{
  cam: Cam;
  perspective?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ cam, perspective = 2600, children, style }) => {
  const { fx, fy, z, rx = 0, ry = 0, rz = 0 } = cam;
  return (
    <AbsoluteFill
      style={{
        perspective,
        perspectiveOrigin: "50% 50%",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          transformStyle: "preserve-3d",
          transform: `translate(960px, 540px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${z}) translate(${-fx}px, ${-fy}px)`,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** Optical depth of field: a blurred copy underneath, the sharp copy masked to the focus zone. */
export const DepthOfField: React.FC<{
  blur: number;
  mask: string; // CSS mask-image, in screen space (white = in focus)
  children: React.ReactNode;
}> = ({ blur, mask, children }) => (
  <AbsoluteFill>
    <AbsoluteFill style={{ filter: `blur(${blur}px)` }}>
      {children}
    </AbsoluteFill>
    <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask }}>
      {children}
    </AbsoluteFill>
  </AbsoluteFill>
);
