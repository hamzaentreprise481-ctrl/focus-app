// Measures rendered text widths with the film's real fonts (used to place
// animation anchors precisely, e.g. the full stop that becomes the FOCUS logo).
import { chromium } from "playwright-core";
import fs from "node:fs";
const f = (n) => fs.readFileSync(`public/fonts/${n}`).toString("base64");
const css = `
@font-face{font-family:Caveat;src:url(data:font/woff2;base64,${f("caveat-latin-500-normal.woff2")}) format('woff2');font-weight:500}
@font-face{font-family:Plex;src:url(data:font/woff2;base64,${f("ibm-plex-sans-latin-500-normal.woff2")}) format('woff2');font-weight:500}
@font-face{font-family:Plex;src:url(data:font/woff2;base64,${f("ibm-plex-sans-latin-600-normal.woff2")}) format('woff2');font-weight:600}
span{white-space:pre;display:inline-block}`;
const items = JSON.parse(process.argv[2]);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage();
await p.setContent(`<style>${css}</style><span id=s></span>`);
const out = await p.evaluate(async (items) => {
  await document.fonts.load("500 100px Caveat"); await document.fonts.load("500 100px Plex"); await document.fonts.load("600 100px Plex");
  const s = document.getElementById("s");
  return items.map(([family, weight, size, spacing, text]) => {
    s.style.fontFamily = family; s.style.fontWeight = weight; s.style.fontSize = size + "px"; s.style.letterSpacing = spacing;
    s.textContent = text; return [text, Math.round(s.getBoundingClientRect().width * 10) / 10];
  });
}, items);
console.log(JSON.stringify(out));
await b.close();
