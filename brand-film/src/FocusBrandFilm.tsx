import React from "react";
import { AbsoluteFill, Sequence, staticFile, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import "./theme";
import { TL } from "./lib/anim";
import { Grain } from "./components/Finish";
import { CopiesField, ErrorShot, MacroCopy, TitleCard } from "./scenes/Act1";
import { Analysis, WordsToLogo } from "./scenes/Act2";
import { AppScene } from "./scenes/Act3";
import { DialogShot, LaptopShot, RosterShot, WriteShot } from "./scenes/Act4";
import { StatementToSignature } from "./scenes/Act5";

type SceneId = keyof typeof TL.scenes;

/** A shot placed on the master timeline (src/timeline.json). */
const Shot: React.FC<{
  from: SceneId;
  to?: SceneId;
  children: React.ReactNode;
}> = ({ from, to, children }) => {
  const { fps } = useVideoConfig();
  const a = TL.scenes[from][0];
  const b = TL.scenes[to ?? from][1];
  return (
    <Sequence
      name={to ? `${from} → ${to}` : from}
      from={Math.round(a * fps)}
      durationInFrames={Math.round((b - a) * fps)}
      premountFor={fps}
    >
      {children}
    </Sequence>
  );
};

export const FocusBrandFilm: React.FC<{ withAudio?: boolean }> = ({
  withAudio = false,
}) => {
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* ACTE I — LE PROBLÈME */}
      <Shot from="macro">
        <MacroCopy />
      </Shot>
      <Shot from="copies">
        <CopiesField />
      </Shot>
      <Shot from="error">
        <ErrorShot />
      </Shot>
      <Shot from="title">
        <TitleCard />
      </Shot>

      {/* ACTE II — LA RÉVÉLATION */}
      <Shot from="analysis">
        <Analysis />
      </Shot>
      <Shot from="words" to="logo">
        <WordsToLogo />
      </Shot>

      {/* ACTE III — LA TECHNOLOGIE (interface réelle) */}
      <Shot from="app">
        <AppScene />
      </Shot>

      {/* ACTE IV — L'AMBITION */}
      <Shot from="roster">
        <RosterShot />
      </Shot>
      <Shot from="dialog">
        <DialogShot />
      </Shot>
      <Shot from="write">
        <WriteShot />
      </Shot>
      <Shot from="laptop">
        <LaptopShot />
      </Shot>

      {/* ACTE V — SIGNATURE */}
      <Shot from="statement" to="signature">
        <StatementToSignature />
      </Shot>

      <Grain opacity={0.04} />
      {withAudio && <Audio src={staticFile("audio/FOCUS_mix.m4a")} />}
    </AbsoluteFill>
  );
};
