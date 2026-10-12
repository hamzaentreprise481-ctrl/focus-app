// Captures the REAL FOCUS interface (running locally) for the brand film.
// Usage: node tools/capture/capture.mjs <baseUrl> <outDir>
// Produces, per screen: viewport.png (what the teacher sees, 1440x900 @3x),
// tall.png (same layout with a viewport tall enough to show all of <main>),
// and boxes.json (CSS-pixel bounding boxes of named UI elements).
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const [baseUrl = "http://localhost:3100", outDir = "captures-raw"] = process.argv.slice(2);
const DPR = 3;
const VIEW = { width: 1440, height: 900 };

// Runs in the page: named element boxes, relative to the page origin.
function collectBoxes(kind) {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  };
  const all = (sel, root = document) => [...root.querySelectorAll(sel)];
  const sectionByHeading = (t) => all("h2").find((h) => h.textContent.trim().startsWith(t))?.closest("section");
  const byText = (sel, t, root = document) => all(sel, root).find((e) => e.textContent.includes(t));
  const out = { aside: r(document.querySelector("aside")), main: r(document.querySelector("main")) };
  // main > div (max-w-6xl wrapper) > page root > [header, ...sections]
  const pageRoot = document.querySelector("main > div > div");
  out.content = r(pageRoot);
  out.header = r(pageRoot?.firstElementChild);
  if (kind === "evaluations") {
    all("main a[href^='/evaluations/']")
      .filter((a) => !a.getAttribute("href").endsWith("/nouvelle"))
      .forEach((a, i) => (out[`row${i}`] = r(a)));
    out.rowCalcul = r(byText("main a[href^='/evaluations/']", "Calcul littéral"));
    out.newButton = r(byText("main a", "Nouvelle évaluation"));
  }
  if (kind === "evaluation") {
    all("main .grid")[0].querySelectorAll(":scope > div").forEach((d, i) => (out[`kpi${i}`] = r(d)));
    out.distribution = r(sectionByHeading("Distribution des notes"));
    const skills = sectionByHeading("Difficultés fréquentes");
    out.skills = r(skills);
    all(".space-y-3 > div", skills).forEach((d, i) => (out[`skillRow${i}`] = r(d)));
    const strug = sectionByHeading("Élèves en difficulté");
    out.struggling = r(strug);
    all("li", strug).forEach((li, i) => (out[`strugRow${i}`] = r(li)));
    out.emmaRow = r(byText("li", "Emma Leroy", strug));
    out.absent = r(strug.querySelector(".bg-watch-soft"));
  }
  if (kind === "student") {
    all("main .grid")[0].querySelectorAll(":scope > div").forEach((d, i) => (out[`kpi${i}`] = r(d)));
    out.chart = r(sectionByHeading("Évolution des résultats"));
    out.chartPlot = r(sectionByHeading("Évolution des résultats").querySelector(".recharts-wrapper"));
    const skills = sectionByHeading("Compétences");
    out.skills = r(skills);
    all(".space-y-4 > div", skills).forEach((d, i) => (out[`skill${i}`] = r(d)));
    out.analysis = r(sectionByHeading("Analyse FOCUS"));
    out.actions = r(sectionByHeading("Actions recommandées"));
    out.cta = r(byText("button", "Créer un accompagnement"));
  }
  if (kind === "dashboard") {
    all("main .grid")[0].querySelectorAll(":scope > div").forEach((d, i) => (out[`kpi${i}`] = r(d)));
    const feed = sectionByHeading("Élèves nécessitant");
    out.feed = r(feed);
    all("a", feed).forEach((a, i) => (out[`feed${i}`] = r(a)));
    out.weakest = r(sectionByHeading("Compétences les moins"));
  }
  if (kind === "roster") {
    out.toolbar = r(document.querySelector("main .flex.flex-wrap.items-center.gap-3"));
    out.table = r(document.querySelector("main table")?.parentElement);
    all("main tbody tr").forEach((tr, i) => (out[`tr${i}`] = r(tr)));
    out.emmaTr = r(byText("main tbody tr", "Emma Leroy"));
  }
  if (kind === "dialog") {
    const dlg = document.querySelector("[role='dialog']");
    out.dialog = r(dlg);
    out.confirm = r(byText("button", "Confirmer", dlg));
    out.close = r(byText("button", "Fermer", dlg));
    all("li", dlg).forEach((li, i) => (out[`action${i}`] = r(li)));
  }
  return out;
}

const SCREENS = [
  { id: "evaluations", url: "/evaluations", kind: "evaluations" },
  { id: "evaluation", url: "/evaluations/eval-1", kind: "evaluation" },
  { id: "student", url: "/eleves/emma-leroy", kind: "student" },
  { id: "dashboard", url: "/", kind: "dashboard" },
  { id: "roster", url: "/classes/seconde-3", kind: "roster" },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR, locale: "fr-FR", timezoneId: "Europe/Paris" });
const page = await ctx.newPage();

async function settle() {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(VIEW.width - 2, VIEW.height - 2);
  await page.waitForTimeout(2600); // let Recharts finish its mount animation
}

const manifest = {};
for (const s of SCREENS) {
  const dir = path.join(outDir, s.id);
  fs.mkdirSync(dir, { recursive: true });
  await page.setViewportSize(VIEW);
  await page.goto(baseUrl + s.url, { waitUntil: "networkidle" });
  await settle();
  await page.screenshot({ path: path.join(dir, "viewport.png") });
  const viewportBoxes = await page.evaluate(collectBoxes, s.kind);
  const fullH = await page.evaluate(() => Math.ceil(document.querySelector("main > div").getBoundingClientRect().height + 64));
  await page.setViewportSize({ width: VIEW.width, height: Math.max(VIEW.height, fullH) });
  await settle();
  await page.screenshot({ path: path.join(dir, "tall.png") });
  const boxes = await page.evaluate(collectBoxes, s.kind);
  manifest[s.id] = { url: s.url, dpr: DPR, viewport: VIEW, tallHeight: Math.max(VIEW.height, fullH), boxes, viewportBoxes };
  console.log(s.id, "tall height", fullH);
}

// The "Créer un accompagnement" dialog (real component; the prototype itself labels this action as simulated).
for (const state of ["open", "created"]) {
  await page.setViewportSize(VIEW);
  await page.goto(baseUrl + "/eleves/emma-leroy", { waitUntil: "networkidle" });
  await settle();
  await page.getByRole("button", { name: "Créer un accompagnement" }).click();
  await page.waitForTimeout(500);
  if (state === "created") {
    await page.getByRole("button", { name: "Confirmer" }).click();
    await page.waitForTimeout(400);
  }
  await page.mouse.move(VIEW.width - 2, VIEW.height - 2);
  const dir = path.join(outDir, `dialog-${state}`);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, "viewport.png") });
  manifest[`dialog-${state}`] = { url: "/eleves/emma-leroy", dpr: DPR, viewport: VIEW, boxes: await page.evaluate(collectBoxes, "dialog") };
}

fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
await browser.close();
console.log("done");
