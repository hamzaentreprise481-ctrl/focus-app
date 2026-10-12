import { continueRender, delayRender, staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";

// Palette — graphite / off-white / metallic grey, with the real FOCUS accent
// (#333f8a, "bleu encre", from app/globals.css) as the only chromatic colour.
export const C = {
  graphite: "#0c0d10",
  graphite2: "#14161b", // = FOCUS --color-ink
  graphite3: "#1d2027",
  offWhite: "#eceae4",
  paperWarm: "#f6f3ec",
  metal: "#9a9ea7",
  metalSoft: "#5d616b",
  brand: "#333f8a", // FOCUS --color-brand
  brandInk: "#232c63",
  brandGlow: "#5b67c9",
  brandSoft: "#eef0fa",
  appPaper: "#f8f8f7", // FOCUS --color-paper
  inkBlue: "#1f2a6e",
  penRed: "#c22f2a",
  attention: "#b23b3b",
};

export const SANS = "IBM Plex Sans";
export const MONO = "IBM Plex Mono";
export const HAND = "Caveat";

const fonts: [string, string, string][] = [
  [SANS, "300", "ibm-plex-sans-latin-300-normal.woff2"],
  [SANS, "400", "ibm-plex-sans-latin-400-normal.woff2"],
  [SANS, "500", "ibm-plex-sans-latin-500-normal.woff2"],
  [SANS, "600", "ibm-plex-sans-latin-600-normal.woff2"],
  [MONO, "400", "ibm-plex-mono-latin-400-normal.woff2"],
  [MONO, "500", "ibm-plex-mono-latin-500-normal.woff2"],
  [HAND, "400", "caveat-latin-400-normal.woff2"],
  [HAND, "500", "caveat-latin-500-normal.woff2"],
  [HAND, "600", "caveat-latin-600-normal.woff2"],
];

const handle = delayRender("fonts");
Promise.all(
  fonts.map(([family, weight, file]) =>
    loadFont({
      family,
      weight,
      url: staticFile(`fonts/${file}`),
      display: "block",
    }),
  ),
)
  .then(() => continueRender(handle))
  .catch((e) => {
    console.error(e);
    continueRender(handle);
  });

// French typography: narrow no-break space before ? ! : ;
export const NNBSP = " ";
