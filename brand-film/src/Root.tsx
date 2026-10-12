import { Composition } from "remotion";
import { FocusBrandFilm } from "./FocusBrandFilm";
import timeline from "./timeline.json";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="FocusBrandFilm"
      component={FocusBrandFilm}
      durationInFrames={Math.round(timeline.duration * timeline.fps)}
      fps={timeline.fps}
      width={1920}
      height={1080}
    />
  );
};
