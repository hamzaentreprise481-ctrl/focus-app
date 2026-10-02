// End-to-end teacher flow in Chromium, against the built app (`npm run build`
// first) and the local stack: the real schema with RLS in PGlite, the
// Supabase Auth/PostgREST stand-in and the SCRIPTED model stand-in.
//
// It proves the product path — sign-in, assessment, subject and notions,
// copies, class analysis, review, student file, PDF, isolation — not the
// quality of a real model: every finding here comes from the script in
// tests/helpers/local-stack.ts.
//
//   npm run build && npm run test:e2e
//
// FOCUS_E2E_CHROMIUM=<path> overrides the browser executable;
// FOCUS_E2E_SCREENSHOTS=<dir> saves a full-page screenshot at each step.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright-core";
import { LOCAL_TEACHER, OTHER_TEACHER, startLocalStack, type LocalStack } from "../helpers/local-stack";

const APP_PORT = 3400;
const origin = `http://127.0.0.1:${APP_PORT}`;
let stack: LocalStack;
let app: ChildProcess;
let output = "";
let browser: Browser;

before(async () => {
  stack = await startLocalStack({ supabasePort: 54421, modelPort: 54429 });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    env: { ...process.env, ...stack.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout?.on("data", (chunk) => (output += chunk));
  app.stderr?.on("data", (chunk) => (output += chunk));
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${origin}/connexion`)).ok) break;
    } catch {
      /* not listening yet */
    }
    if (attempt > 120) throw new Error(`next start did not answer:\n${output}`);
    await delay(250);
  }
  browser = await chromium.launch(process.env.FOCUS_E2E_CHROMIUM ? { executablePath: process.env.FOCUS_E2E_CHROMIUM } : {});
});

after(async () => {
  await browser?.close();
  app?.kill("SIGTERM");
  await stack?.close();
});

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.goto(`${origin}/connexion`);
  await page.getByLabel(/e-mail/i).fill(account.email);
  await page.getByLabel(/mot de passe/i).fill(account.password);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL(`${origin}/app`);
}

async function shot(page: Page, name: string) {
  const dir = process.env.FOCUS_E2E_SCREENSHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { page, errors };
}

let assessmentUrl = "";

test("a teacher creates an assessment, enters the subject and copies, analyses the class and decides", async () => {
  const { page, errors } = await newPage();
  await signIn(page, LOCAL_TEACHER);
  await assert.doesNotReject(page.getByRole("heading", { name: "Bonjour Claire Martin." }).waitFor());

  // 1. A new assessment, saved before any grade.
  await page.goto(`${origin}/app/evaluations/nouvelle`);
  await page.getByLabel("Nom de l’évaluation").fill("Contrôle — Développements (E2E)");
  await page.getByLabel("Date").fill("2026-10-02");
  await page.getByRole("button", { name: "Enregistrer l’évaluation" }).click();
  await page.getByRole("heading", { name: "Évaluation enregistrée" }).waitFor();
  await page.getByRole("link", { name: "Ajouter le sujet et les copies" }).click();
  await page.waitForURL(/\/app\/evaluations\/[0-9a-f-]{36}/);
  assessmentUrl = page.url().split("#")[0];

  // 2. Subject: one question, its correction, maximum and assessed notion.
  await page.getByRole("button", { name: "Ajouter une question" }).click();
  await page.getByLabel("Énoncé").fill("Développer 2(x + 3).");
  await page.getByLabel("Corrigé attendu").fill("2(x + 3) = 2x + 6");
  await page.getByLabel("Points maximum (facultatif)").fill("2");
  await page.getByLabel("Notions évaluées (recommandé)").selectOption("MATH.ALG.DISTRIBUTIVITE");
  await page.getByText("Développement par distributivité").first().waitFor();
  await page.getByRole("button", { name: "Enregistrer le sujet et le corrigé" }).click();

  // 3. Two copies: one with the classic error, one correct.
  const roster = page.getByRole("list", { name: "Élèves de la classe" });
  await roster.getByRole("button", { name: /^Adam Benali/ }).click();
  await page.getByRole("heading", { name: "Copie de Adam Benali" }).waitFor();
  await page.getByLabel("Réponse de l’élève").fill("2(x + 3) = 2x + 3");
  await page.getByLabel("Points attribués").fill("0,5");
  await page.getByRole("button", { name: "Enregistrer la copie" }).click();
  await page.getByText("Copie enregistrée.").waitFor();

  await roster.getByRole("button", { name: /^Anaïs Renault/ }).click();
  await page.getByRole("heading", { name: "Copie de Anaïs Renault" }).waitFor();
  await page.getByLabel("Réponse de l’élève").fill("2(x + 3) = 2x + 6");
  await page.getByLabel("Points attribués").fill("2");
  await page.getByRole("button", { name: "Enregistrer la copie" }).click();
  await page.getByText("Copie enregistrée.").waitFor();

  // Points above the question's maximum are refused, and nothing is saved.
  await page.getByLabel("Points attribués").fill("3");
  await page.getByRole("button", { name: "Enregistrer la copie" }).click();
  await page.getByText("Des points dépassent le maximum de la question.").waitFor();
  await page.getByLabel("Points attribués").fill("2");

  // 4. The whole class in one action.
  await page.getByRole("button", { name: "Analyser les 2 copies non analysées" }).click();
  const summary = page.getByText(/^2 copies analysées : /);
  await summary.waitFor({ timeout: 60_000 });
  assert.equal(
    await summary.textContent(),
    "2 copies analysées : 1 copie avec erreur(s) observée(s) (1 hypothèse à examiner) ; 1 copie sans erreur observée — ce n’est pas une preuve de maîtrise.",
  );
  assert.equal(stack.model.calls.length, 2, "one model call per copy");
  await page.getByText("Toutes les copies enregistrées ont une analyse à jour.").waitFor();
  await shot(page, "1-class-analysed");

  // 5. Review: the hypothesis quotes the copy; the teacher confirms it.
  const review = page.locator("#hypotheses");
  await review.getByRole("button", { name: "À examiner (1)" }).waitFor();
  const card = review.getByRole("article");
  assert.match((await card.textContent()) ?? "", /« 2x \+ 3 »/);
  assert.match((await card.textContent()) ?? "", /Développement par distributivité/);
  await card.getByLabel(/Note \(facultatif\)/).fill("Revu en classe le 2 octobre.");
  await card.getByRole("button", { name: "Confirmer l’observation" }).click();
  await review.getByText("Observation confirmée : elle entre dans le suivi de l’élève.").waitFor();
  await review.getByRole("button", { name: "À examiner (0)" }).waitFor();
  await review.getByRole("button", { name: "Décidées (1)" }).click();
  await review.getByText("Observation confirmée par vous").waitFor();
  await shot(page, "2-decided");

  // 6. The student file shows the confirmed observation, and its PDF downloads.
  await review.getByRole("link", { name: "Suivi de l’élève" }).click();
  await page.waitForURL(/\/app\/eleves\/[0-9a-f-]{36}/);
  await page.getByText("Observation confirmée par vous").first().waitFor();
  await page.getByText("« 2x + 3 »").first().waitFor();
  await shot(page, "3-student-file");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exporter en PDF" }).click()]);
  const pdf = await download.createReadStream().then(async (stream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 2_000);

  assert.deepEqual(errors, [], "no uncaught error in the page");
  await page.context().close();
});

test("another teacher cannot open that assessment, and signed-out visitors are sent to sign-in", async () => {
  assert.ok(assessmentUrl, "the previous test created the assessment");
  const { page } = await newPage();
  await page.goto(`${origin}/app`);
  await page.waitForURL(/\/connexion\?next=%2Fapp/);

  await signIn(page, OTHER_TEACHER);
  await page.goto(assessmentUrl);
  await page.getByRole("heading", { name: "Évaluation introuvable dans votre espace" }).waitFor();
  await page.goto(`${origin}/app/evaluations`);
  assert.equal(await page.getByText("Contrôle — Développements (E2E)").count(), 0);
  await page.context().close();
});
