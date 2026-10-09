// Real end-to-end check of a deployed FOCUS Preview: real sign-in, real
// Supabase, real copy reader and real model. Run by
// .github/workflows/preview-e2e.yml once the Preview reports ready.
//
//   node scripts/preview-e2e.mjs <deployment-url> <out-dir>
//   env: FOCUS_E2E_EMAIL, FOCUS_E2E_PASSWORD (a FICTITIOUS test teacher),
//        VERCEL_AUTOMATION_BYPASS_SECRET (protected Previews),
//        FOCUS_E2E_CHROMIUM (browser executable, optional)
//
// It creates ONE clearly labelled fictitious assessment, imports ONE
// fictitious handwritten photo (tests/fixtures/handwriting/images/E1-S6-C.jpg)
// for the first student of the class, analyses it, decides on a hypothesis
// if there is one, and opens the student file. It prints and writes
// result.json: each step PASS/FAIL with its duration, the per-question
// legibility and outcomes as displayed — never a password, a cookie, a
// student name or a transcription.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const [base, outDir = "preview-e2e-results"] = process.argv.slice(2);
const email = process.env.FOCUS_E2E_EMAIL;
const password = process.env.FOCUS_E2E_PASSWORD;
if (!base || !email || !password) {
  console.error("usage: node scripts/preview-e2e.mjs <deployment-url> <out-dir> with FOCUS_E2E_EMAIL and FOCUS_E2E_PASSWORD");
  process.exit(2);
}
const origin = base.replace(/\/$/, "");
mkdirSync(outDir, { recursive: true });
const spec = JSON.parse(readFileSync(path.join("tests", "fixtures", "handwriting", "spec.json"), "utf8"));
const questions = spec.assessments.E1.questions;
const photo = path.join("tests", "fixtures", "handwriting", "images", "E1-S6-C.jpg");

const steps = [];
const result = { origin, startedAt: new Date().toISOString(), steps, verdict: "FAIL" };
async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    steps.push({ name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) });
    return detail;
  } catch (error) {
    steps.push({ name, ok: false, ms: Date.now() - started, error: String(error instanceof Error ? error.message : error).slice(0, 300) });
    throw error;
  }
}

const browser = await chromium.launch(process.env.FOCUS_E2E_CHROMIUM ? { executablePath: process.env.FOCUS_E2E_CHROMIUM } : {});
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  // Only for the local dry run: the local Storage stand-in is plain http,
  // which the app's CSP (https://*.supabase.co) rightly blocks.
  bypassCSP: process.env.FOCUS_E2E_BYPASS_CSP === "1",
  extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" } : {},
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 200)));
page.on("dialog", (dialog) => void dialog.accept());
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true }).catch(() => undefined);
const title = `E2E Preview — test automatique fictif ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
let studentName = null;

try {
  await step("sign-in", async () => {
    await page.goto(`${origin}/connexion`);
    await page.getByLabel(/e-mail/i).fill(email);
    await page.getByLabel(/mot de passe/i).fill(password);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await page.waitForURL(`${origin}/app`, { timeout: 30_000 });
  });

  await step("create-assessment", async () => {
    await page.goto(`${origin}/app/evaluations/nouvelle`);
    await page.getByLabel("Nom de l’évaluation").fill(title);
    await page.getByLabel("Date").fill(spec.assessments.E1.date);
    await page.getByRole("button", { name: "Enregistrer l’évaluation" }).click();
    await page.getByRole("heading", { name: "Évaluation enregistrée" }).waitFor({ timeout: 30_000 });
    await page.getByRole("link", { name: "Ajouter le sujet et les copies" }).click();
    await page.waitForURL(/\/app\/evaluations\/[0-9a-f-]{36}/);
  });

  await step("subject-and-correction", async () => {
    for (const [index, question] of questions.entries()) {
      await page.getByRole("button", { name: "Ajouter une question" }).click();
      await page.getByLabel("Énoncé").nth(index).fill(question.prompt);
      await page.getByLabel("Corrigé attendu").nth(index).fill(question.correction);
      await page.getByLabel("Points maximum (facultatif)").nth(index).fill(String(question.maxPoints));
      await page.getByLabel("Notions évaluées (recommandé)").nth(index).selectOption(question.notions[0]);
    }
    await page.getByRole("button", { name: "Enregistrer le sujet et le corrigé" }).click();
    await page.getByRole("list", { name: "Élèves de la classe" }).waitFor({ timeout: 30_000 });
    return { questions: questions.length };
  });

  const reading = await step("import-photo-real-reader", async () => {
    await page.getByRole("heading", { name: "Importer des copies (scan ou photos)" }).waitFor();
    await page.getByLabel("PDF ou photos des copies").setInputFiles(photo);
    // The reader may take minutes; an error message ends the wait at once.
    const review = page.getByText("Vérifications nécessaires");
    const failure = page.getByText(/crédit du fournisseur|erreur de configuration|injoignable|saturé|dépassé le délai|n’a pas abouti|inexploitable|stockage temporaire|n’est pas configuré|n’ont pas pu être préparées|Aucune copie d’élève/);
    await Promise.race([review.waitFor({ timeout: 290_000 }), failure.first().waitFor({ timeout: 290_000 }).then(async () => { throw new Error(await failure.first().textContent()); })]);
    await shot("1-review");
    const legibility = [];
    for (let q = 0; q < questions.length; q++) {
      const badge = page.getByTestId(`scan-legibility-0-${q}`);
      legibility.push((await badge.count()) ? (await badge.textContent())?.trim() : null);
    }
    const select = page.locator("#scan-student-0");
    const options = await select.locator("option").evaluateAll((nodes) => nodes.map((node) => ({ value: node.value, label: node.textContent })));
    const first = options.find((option) => option.value);
    if (!first) throw new Error("no student in the class roster");
    await select.selectOption(first.value);
    studentName = first.label;
    await page.getByRole("button", { name: "J’ai vérifié — importer cette copie" }).click();
    await page.getByText("Importée", { exact: true }).waitFor({ timeout: 60_000 });
    return { legibility };
  });

  const analysis = await step("analyse-real-model", async () => {
    await page.reload();
    await page.getByRole("list", { name: "Élèves de la classe" }).getByRole("button", { name: new RegExp(`^${studentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
    await page.getByRole("button", { name: "Analyser cette copie" }).click();
    const outcome = page.getByTestId("outcome-1");
    const failure = page.getByText(/crédit du fournisseur|erreur de configuration|injoignable|saturé|pas répondu à temps|n’a pas abouti|inexploitable/);
    await Promise.race([outcome.waitFor({ timeout: 120_000 }), failure.first().waitFor({ timeout: 120_000 }).then(async () => { throw new Error(await failure.first().textContent()); })]);
    await shot("2-analysis");
    const outcomes = [];
    for (let q = 1; q <= questions.length; q++) {
      const item = page.getByTestId(`outcome-${q}`);
      // Outcome label only (the excerpt may quote the fictitious answer).
      outcomes.push((await item.count()) ? ((await item.textContent()) ?? "").replace(/^Analyse : /, "").split(/ · |[«—]/)[0].trim().slice(0, 60) : null);
    }
    return { outcomes };
  });

  await step("teacher-decision-and-student-file", async () => {
    await page.goto(page.url().split("#")[0] + "#hypotheses");
    const review = page.locator("#hypotheses");
    const pending = await review.getByRole("button", { name: /À examiner \(\d+\)/ }).textContent();
    const count = Number(pending?.match(/\((\d+)\)/)?.[1] ?? 0);
    if (!count) return { hypotheses: 0, decided: false };
    await review.getByRole("article").first().getByRole("button", { name: "Confirmer l’observation" }).click();
    await review.getByText("Observation confirmée : elle entre dans le suivi de l’élève.").waitFor({ timeout: 30_000 });
    await review.getByRole("link", { name: "Suivi de l’élève" }).first().click();
    await page.waitForURL(/\/app\/eleves\/[0-9a-f-]{36}/);
    await page.getByText("Observation confirmée par le professeur").first().waitFor({ timeout: 30_000 });
    await shot("3-student-file");
    return { hypotheses: count, decided: true };
  });

  result.reading = reading;
  result.analysis = analysis;
  result.verdict = pageErrors.length ? "FAIL" : "PASS";
} catch {
  await shot("failure");
} finally {
  result.pageErrors = pageErrors;
  result.finishedAt = new Date().toISOString();
  writeFileSync(path.join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(result.verdict === "PASS" ? 0 : 1);
}
