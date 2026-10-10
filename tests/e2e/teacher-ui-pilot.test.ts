// UI verification only. Uses the existing fictitious school + scripted model
// on loopback. No production account, seed or model call. Run after `npm run
// build`, via `npm run test:e2e`. Screenshots are optional (same variable as
// Claude's existing tests); they are test evidence, never product data.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright-core";
import {
  ILLEGIBLE_MARKER,
  MODEL_FAILURE_MARKER,
  LOCAL_TEACHER,
  OTHER_TEACHER,
  startLocalStack,
  type LocalStack,
} from "../helpers/local-stack";

const origin = "http://127.0.0.1:3420";
let stack: LocalStack;
let app: ChildProcess;
let browser: Browser;
let output = "";
const accessibilityResults: unknown[] = [];

// Optional local accessibility audit. No extra dependency is installed in the
// product. Set both FOCUS_UI_AXE_MODULE and FOCUS_UI_AXE_REPORT to reproduce it.
async function accessibilityCheck(page: Page, name: string) {
  if (!process.env.FOCUS_UI_AXE_MODULE) return;
  const AxeBuilder = createRequire(import.meta.url)(
    process.env.FOCUS_UI_AXE_MODULE,
  ).default;
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  accessibilityResults.push({
    name,
    width: page.viewportSize()?.width,
    violations: result.violations,
    incomplete: result.incomplete.map(
      (item: { id: string; nodes: unknown[] }) => ({
        id: item.id,
        nodes: item.nodes.length,
      }),
    ),
  });
  assert.deepEqual(
    result.violations.map((item: { id: string }) => item.id),
    [],
    `accessibility violations: ${name}`,
  );
}

before(async () => {
  stack = await startLocalStack({
    supabasePort: 54441,
    modelPort: 54449,
    modelDelayMs: 60,
  });
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      "3420",
      "-H",
      "127.0.0.1",
    ],
    {
      env: { ...process.env, ...stack.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  app.stdout?.on("data", (chunk) => (output += chunk));
  app.stderr?.on("data", (chunk) => (output += chunk));
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${origin}/connexion`)).ok) break;
    } catch {
      /* starting */
    }
    if (attempt > 120)
      throw new Error(`UI QA server did not answer: ${output}`);
    await delay(250);
  }
  browser = await chromium.launch(
    process.env.FOCUS_E2E_CHROMIUM
      ? { executablePath: process.env.FOCUS_E2E_CHROMIUM }
      : {},
  );
});
after(async () => {
  if (process.env.FOCUS_UI_AXE_REPORT)
    await writeFile(
      process.env.FOCUS_UI_AXE_REPORT,
      JSON.stringify(
        {
          environment:
            "local fictitious school and scripted model; not production",
          tool: "axe-core WCAG 2 A/AA and 2.1 A/AA; keyboard and overflow assertions in the UI suite",
          results: accessibilityResults,
        },
        null,
        2,
      ),
    );
  await browser?.close();
  app?.kill("SIGTERM");
  await stack?.close();
});

async function teacherPage(
  account: { email: string; password: string } = LOCAL_TEACHER,
) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/connexion`);
  await page.getByLabel(/e-mail/i).fill(account.email);
  await page.getByLabel(/mot de passe/i).fill(account.password);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL(`${origin}/app`);
  return { page, errors };
}

async function noPageOverflow(page: Page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    `page overflow: ${page.url()}`,
  );
}

async function shot(page: Page, name: string, fullPage = false) {
  const dir = process.env.FOCUS_E2E_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/ui-${name}.png`, fullPage });
}

test("visual system: every Teacher screen fits desktop, laptop, tablet and phone; dialog traps focus", async () => {
  const { page, errors } = await teacherPage();
  const assessmentId = [...stack.ids.assessmentIds.values()][0];
  const studentId = [...stack.ids.studentIds.values()][0];
  const routes = [
    ["dashboard", "/app"],
    ["classes", "/app/classes"],
    ["classe", `/app/classes/${stack.ids.classId}`],
    ["evaluations", "/app/evaluations"],
    ["evaluation", `/app/evaluations/${assessmentId}`],
    ["nouvelle", "/app/evaluations/nouvelle"],
    ["resultats", `/app/evaluations/${assessmentId}/modifier`],
    ["eleves", "/app/eleves"],
    ["eleve", `/app/eleves/${studentId}`],
    ["parametres", "/app/parametres"],
  ];
  for (const width of [1920, 1366, 1024, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path] of routes) {
      await page.goto(origin + path);
      await page.getByRole("heading", { level: 1 }).waitFor();
      if (name === "evaluation")
        await page
          .getByRole("heading", { name: "Sujet, questions et corrigé" })
          .waitFor();
      if (name === "eleve")
        await page
          .getByText("Aucune copie détaillée pour cet élève.", { exact: false })
          .waitFor();
      await noPageOverflow(page);
      const unlabelled = await page
        .locator("input:not([type=hidden]),select,textarea")
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const field = node as HTMLInputElement;
              return (
                !field.disabled &&
                !field.labels?.length &&
                !field.getAttribute("aria-label") &&
                !field.getAttribute("aria-labelledby")
              );
            })
            .map((node) => node.outerHTML),
        );
      assert.deepEqual(unlabelled, [], `unlabelled fields on ${path}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      if ([1366, 820, 390].includes(width))
        await shot(page, `${name}-${width}`);
      if ([1366, 820, 390].includes(width))
        await accessibilityCheck(page, name);
    }
    await page.goto(`${origin}/app/evaluations/${assessmentId}`);
    await page.locator("#resultats > summary").click();
    await page.getByRole("button", { name: "Supprimer l’évaluation" }).click();
    await page.getByRole("dialog").waitFor();
    await noPageOverflow(page);
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      ),
    );
    await shot(page, `dialog-${width}`);
    await accessibilityCheck(page, "delete-dialog");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
  }
  // Skip link and keyboard focus remain usable with the compact navigation.
  await page.goto(`${origin}/app`);
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    "Aller au contenu",
  );
  await page.keyboard.press("Enter");
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "main-content",
  );
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("UX: zero results, one visible student and incomplete assessment give a usable next action", async () => {
  const { page, errors } = await teacherPage();
  await page.goto(`${origin}/app/evaluations`);
  await page
    .getByLabel("Rechercher une évaluation")
    .fill("aucune-evaluation-de-ce-nom");
  await page
    .getByRole("heading", { name: "Aucune évaluation ne correspond" })
    .waitFor();
  await shot(page, "aucun-resultat");
  await page
    .getByRole("button", { name: "Afficher toutes les évaluations" })
    .click();
  assert.ok(
    (await page.locator('main a[href^="/app/evaluations/"]').count()) > 1,
  );
  await page.goto(`${origin}/app/eleves`);
  await page.getByLabel("Rechercher un élève").fill("Adam Benali");
  await page
    .getByRole("status")
    .filter({ hasText: /^1 élève$/ })
    .waitFor();
  await page.getByLabel("Rechercher un élève").fill("personne-introuvable");
  await page
    .getByText("Aucun élève ne correspond à cette recherche.")
    .last()
    .waitFor();
  await page.getByRole("button", { name: "Réinitialiser les filtres" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /^31 élèves$/ })
    .waitFor();
  const id = [...stack.ids.assessmentIds.values()][0];
  await page.goto(`${origin}/app/evaluations/${id}#hypotheses`);
  await page.getByRole("button", { name: "À examiner (0)" }).waitFor();
  await page.getByRole("link", { name: "Consulter l’état des copies" }).click();
  await page.getByRole("link", { name: "Compléter le sujet" }).click();
  assert.ok(
    await page
      .getByRole("button", { name: "Ajouter une question" })
      .isVisible(),
  );
  await shot(page, "evaluation-incomplete");
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("UX: a 31-copy batch stays readable; pending, confirmed, insufficient and refused outcomes remain distinct after reload", async () => {
  const { page, errors } = await teacherPage();
  await page.goto(`${origin}/app/evaluations/nouvelle`);
  await page
    .getByLabel("Nom de l’évaluation")
    .fill(
      "Pilote UI — Distributivité, justification des étapes du calcul littéral et relecture des réponses détaillées : 31 copies et décisions professeur",
    );
  await page.getByLabel("Date").fill("2026-10-04");
  await page.getByRole("button", { name: "Enregistrer l’évaluation" }).click();
  await page
    .getByRole("link", { name: "Ajouter le sujet et les copies" })
    .click();
  await page.waitForURL(/\/app\/evaluations\/[0-9a-f-]{36}/);
  const url = page.url().split("#")[0];
  await page.getByRole("button", { name: "Ajouter une question" }).click();
  await page.getByLabel("Énoncé").fill("Développer 2(x + 3).");
  await page.getByLabel("Corrigé attendu").fill("2(x + 3) = 2x + 6");
  await page.getByLabel("Points maximum (facultatif)").fill("2");
  await page
    .getByLabel("Notions évaluées (recommandé)")
    .selectOption("MATH.ALG.DISTRIBUTIVITE");
  await page
    .getByRole("button", { name: "Enregistrer le sujet et le corrigé" })
    .click();
  const roster = page.getByRole("list", { name: "Élèves de la classe" });
  await roster.waitFor();
  const names = await roster
    .locator("button > span:first-child")
    .allTextContents();
  assert.equal(names.length, 31);
  for (const [index, name] of names.entries()) {
    await roster.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await page.getByRole("heading", { name: `Copie de ${name}` }).waitFor();
    const answer =
      index < 2
        ? "2(x + 3) = 2x + 3"
        : index === 2
          ? `${ILLEGIBLE_MARKER} 2x`
          : "2(x + 3) = 2x + 6";
    await page.getByLabel("Réponse de l’élève").fill(answer);
    await page.getByLabel("Points attribués").fill(index < 3 ? "0,5" : "2");
    if (index === 0) {
      await page
        .getByRole("button", {
          name: "Enregistrer et passer à l’élève suivant",
        })
        .click();
      await page
        .getByRole("heading", { name: `Copie de ${names[1]}` })
        .waitFor();
      assert.equal(
        await page.getByLabel("Réponse de l’élève").inputValue(),
        "",
        "the previous student's answer is not shown in the next copy",
      );
    } else {
      await page.getByRole("button", { name: "Enregistrer la copie" }).click();
      await page.getByText(/^Copie enregistrée\./).waitFor();
    }
  }
  const calls = stack.model.calls.length;
  await page
    .getByRole("button", { name: "Analyser les 31 copies non analysées" })
    .click();
  await page.getByText(/^Analyse \d+ \/ 31 : /).waitFor();
  await shot(page, "31-copies-en-cours");
  await page.getByText(/^31 copies analysées : /).waitFor({ timeout: 120_000 });
  assert.equal(stack.model.calls.length - calls, 31);
  const review = page.locator("#hypotheses");
  await review.getByRole("button", { name: "À examiner (2)" }).waitFor();
  assert.equal(await review.locator(".recommendation-pending").count(), 2);
  assert.equal(await review.locator(".recommendation-validated").count(), 0);
  for (const width of [1366, 1024, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await noPageOverflow(page);
    await page.evaluate(() => {
      const section = document.getElementById("hypotheses");
      if (section)
        window.scrollTo(
          0,
          window.scrollY + section.getBoundingClientRect().top - 24,
        );
    });
    await shot(page, `hypotheses-${width}`);
    await accessibilityCheck(page, "pending-hypotheses");
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${origin}/app`);
  await page
    .getByRole("list", { name: "Hypothèses IA à examiner" })
    .getByRole("link", { name: /Pilote UI — Distributivité/ })
    .waitFor();
  await shot(page, "dashboard-a-decider-1366");
  await page.goto(url + "#hypotheses");
  await review.getByRole("button", { name: "À examiner (2)" }).waitFor();
  const studentLink = await review
    .getByRole("link", { name: "Suivi de l’élève" })
    .first()
    .getAttribute("href");
  await review
    .getByLabel(/Note \(facultatif\)/)
    .first()
    .fill(
      "Observation du professeur : revoir la distribution à chaque terme et vérifier sur un nouvel exemple. "
        .repeat(10)
        .slice(0, 1000),
    );
  await review
    .getByRole("button", { name: "Confirmer l’observation" })
    .first()
    .click();
  await review.getByRole("button", { name: "À examiner (1)" }).waitFor();
  await review.getByRole("button", { name: "Écarter", exact: true }).click();
  await review.getByRole("button", { name: "À examiner (0)" }).waitFor();
  await page.reload();
  await review.getByRole("button", { name: "Décidées (2)" }).click();
  await review
    .getByText("Observation confirmée par le professeur", { exact: true })
    .waitFor();
  await review
    .getByText("Écartée par le professeur", { exact: true })
    .waitFor();
  await shot(page, "decisions-rechargees");
  await roster
    .getByRole("button", { name: new RegExp(`^${names[2]}`) })
    .click();
  await page.getByText("Analyse actuelle : preuves insuffisantes").waitFor();
  await shot(page, "preuves-insuffisantes");
  await page.goto(origin + studentLink);
  await page
    .getByRole("heading", { name: "Notions suivies dans le temps" })
    .waitFor();
  await page
    .getByText("Observation confirmée par le professeur", { exact: true })
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "suivi-confirme");
  const confirmedStudentName = await page
    .getByRole("heading", { level: 1 })
    .innerText();
  // A second, correctly answered copy provides an actual longitudinal view.
  // It must say "no error observed", never declare mastery automatically.
  await page.goto(`${origin}/app/evaluations/nouvelle`);
  await page
    .getByLabel("Nom de l’évaluation")
    .fill("Vérification — Distributivité après reprise");
  await page.getByLabel("Date").fill("2026-10-05");
  await page.getByRole("button", { name: "Enregistrer l’évaluation" }).click();
  await page
    .getByRole("link", { name: "Ajouter le sujet et les copies" })
    .click();
  await page.getByRole("button", { name: "Ajouter une question" }).click();
  await page.getByLabel("Énoncé").fill("Développer 2(x + 3).");
  await page.getByLabel("Corrigé attendu").fill("2(x + 3) = 2x + 6");
  await page.getByLabel("Points maximum (facultatif)").fill("2");
  await page
    .getByLabel("Notions évaluées (recommandé)")
    .selectOption("MATH.ALG.DISTRIBUTIVITE");
  await page
    .getByRole("button", { name: "Enregistrer le sujet et le corrigé" })
    .click();
  await page
    .getByRole("list", { name: "Élèves de la classe" })
    .getByRole("button", { name: new RegExp(`^${confirmedStudentName}`) })
    .click();
  await page
    .getByRole("heading", { name: `Copie de ${confirmedStudentName}` })
    .waitFor();
  await page.getByLabel("Réponse de l’élève").fill("2(x + 3) = 2x + 6");
  await page.getByLabel("Points attribués").fill("2");
  await page.getByRole("button", { name: "Enregistrer la copie" }).click();
  await page.getByText(/^Copie enregistrée\./).waitFor();
  await page.getByRole("button", { name: "Analyser cette copie" }).click();
  await page.getByText("Analyse actuelle : aucune erreur observée").waitFor();
  await page.goto(origin + studentLink);
  const longitudinal = page.locator("#notions-suivies");
  await longitudinal
    .locator("ol li")
    .filter({ hasText: "sans erreur observée" })
    .waitFor();
  assert.equal(await longitudinal.locator("ol li").count(), 2);
  assert.equal(
    await longitudinal
      .locator("ol li")
      .filter({ hasText: "erreur confirmée" })
      .count(),
    1,
  );
  for (const width of [1366, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await noPageOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, `longitudinal-${width}`);
    await accessibilityCheck(page, "longitudinal-confirmed");
  }
  assert.ok(url.includes("/app/evaluations/"));
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("UX: a failed analysis preserves the saved copy and offers a working retry", async () => {
  const { page, errors } = await teacherPage();
  await page.goto(`${origin}/app/evaluations/nouvelle`);
  await page
    .getByLabel("Nom de l’évaluation")
    .fill("Analyse indisponible — reprise");
  await page.getByLabel("Date").fill("2026-10-06");
  await page.getByRole("button", { name: "Enregistrer l’évaluation" }).click();
  await page
    .getByRole("link", { name: "Ajouter le sujet et les copies" })
    .click();
  await page.waitForURL(/\/app\/evaluations\/[0-9a-f-]{36}/);
  const savedUrl = page.url();
  await page.getByRole("button", { name: "Ajouter une question" }).click();
  await page.getByLabel("Énoncé").fill("Développer 2(x + 3).");
  await page.getByLabel("Corrigé attendu").fill("2(x + 3) = 2x + 6");
  await page.getByLabel("Points maximum (facultatif)").fill("2");
  await page
    .getByLabel("Notions évaluées (recommandé)")
    .selectOption("MATH.ALG.DISTRIBUTIVITE");
  await page
    .getByRole("button", { name: "Enregistrer le sujet et le corrigé" })
    .click();
  await page
    .getByRole("list", { name: "Élèves de la classe" })
    .getByRole("button", { name: /^Adam Benali/ })
    .click();
  const failedAnswer = `${MODEL_FAILURE_MARKER} 2(x + 3) = 2x + 3`;
  await page.getByLabel("Réponse de l’élève").fill(failedAnswer);
  await page.getByLabel("Points attribués").fill("0,5");
  await page.getByRole("button", { name: "Enregistrer la copie" }).click();
  await page.getByText(/^Copie enregistrée\./).waitFor();
  await page.getByRole("button", { name: "Analyser cette copie" }).click();
  await page.locator("#copies").getByRole("alert").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Analyser cette copie" })
      .isEnabled(),
    true,
  );
  assert.equal(await page.locator(".recommendation-pending").count(), 0);
  await shot(page, "erreur-analyse");
  await accessibilityCheck(page, "analysis-error");
  await page.goto(savedUrl);
  await page.getByRole("heading", { name: "Copie de Adam Benali" }).waitFor();
  assert.equal(
    await page.getByLabel("Réponse de l’élève").inputValue(),
    failedAnswer,
  );
  await page.getByLabel("Réponse de l’élève").fill("2(x + 3) = 2x + 3");
  await page.getByRole("button", { name: "Enregistrer la copie" }).click();
  await page.getByText(/^Copie enregistrée\./).waitFor();
  await page.getByRole("button", { name: "Analyser cette copie" }).click();
  await page
    .locator("#hypotheses")
    .getByRole("button", { name: "À examiner (1)" })
    .waitFor();
  // A replaced proof must clear the earlier analysis and review immediately.
  await page.getByLabel("Réponse de l’élève").fill("2(x + 3) = 2x + 6");
  await page.getByLabel("Points attribués").fill("2");
  await page.getByRole("button", { name: "Enregistrer la copie" }).click();
  await page
    .getByText(/L’analyse précédente de cette copie est remplacée/)
    .waitFor();
  await page
    .locator("#hypotheses")
    .getByRole("button", { name: "À examiner (0)" })
    .waitFor();
  assert.equal(
    await page.getByText("Analyse actuelle : erreur(s) observée(s)").count(),
    0,
  );
  await page.getByRole("button", { name: "Analyser cette copie" }).click();
  await page.getByText("Analyse actuelle : aucune erreur observée").waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("UX: failed sign-in keeps the teacher email and password recovery is reachable", async () => {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(`${origin}/connexion`);
  await page.getByLabel(/e-mail/i).fill(LOCAL_TEACHER.email);
  await page.getByLabel(/mot de passe/i).fill("wrong-password-ui-test");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page.getByLabel(/e-mail/i).inputValue(),
    LOCAL_TEACHER.email,
  );
  await accessibilityCheck(page, "sign-in-error");
  await page.getByRole("link", { name: "Mot de passe oublié ?" }).click();
  await page.getByRole("heading", { name: "Mot de passe oublié" }).waitFor();
  await accessibilityCheck(page, "password-recovery");
  await context.close();
});

test("UX: interrupted loading shows an error and retry, then restores saved evidence", async () => {
  const { page, errors } = await teacherPage();
  const id = [...stack.ids.assessmentIds.values()][0];
  let failedRequests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/app/evaluations/${id}`, async (route) => {
    if (route.request().method() === "POST") {
      await gate;
      failedRequests++;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.goto(`${origin}/app/evaluations/${id}`);
  await page
    .getByRole("status", { name: "Chargement du sujet et du corrigé…" })
    .waitFor();
  await shot(page, "chargement");
  release();
  await page
    .getByRole("alert")
    .filter({ hasText: "Le sujet n’a pas pu être chargé" })
    .waitFor();
  await shot(page, "erreur-chargement");
  const failedBeforeRetry = failedRequests;
  await page
    .getByRole("button", { name: "Réessayer", exact: true })
    .first()
    .click();
  for (
    let attempt = 0;
    attempt < 20 && failedRequests <= failedBeforeRetry;
    attempt++
  )
    await delay(50);
  assert.ok(
    failedRequests > failedBeforeRetry,
    "retry performs a fresh request even while unavailable",
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "Le sujet n’a pas pu être chargé" })
    .waitFor();
  await page.unroute(`**/app/evaluations/${id}`);
  await page
    .getByRole("button", { name: "Réessayer", exact: true })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Sujet, questions et corrigé" })
    .waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("sellability: honest demo contact, measurable pilot and unassigned teacher are actionable", async () => {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  for (const width of [1920, 1366, 1024, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // The detailed Teacher presentation moved from the portal home.
    await page.goto(`${origin}/enseignants`);
    await noPageOverflow(page);
    await accessibilityCheck(page, "marketing");
    await page.getByText("Données fictives de démonstration").waitFor();
    const contact = await page
      .getByRole("link", { name: /^Demander une démonstration/ })
      .first()
      .getAttribute("href");
    assert.ok(contact?.startsWith("mailto:") || contact?.startsWith("https:"));
    await page
      .getByText("Combien de temps cela fait-il gagner ?", { exact: true })
      .click();
    await page
      .getByText("Le gain de temps n’est pas encore mesuré.", { exact: false })
      .waitFor();
    if ([1366, 820, 390].includes(width)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `pilote-${width}`);
    }
  }
  await context.close();
  // Fixture-only missing-assignment state; the production permissions are not
  // changed by this test or the UI implementation.
  await stack.db.query(
    "delete from public.teacher_assignments where teacher_id = $1",
    [OTHER_TEACHER.id],
  );
  const { page: teacher, errors } = await teacherPage(OTHER_TEACHER);
  await teacher
    .getByRole("heading", { name: "Votre compte attend une classe" })
    .waitFor();
  await teacher.getByRole("link", { name: "Voir mes affectations" }).click();
  await teacher.getByRole("heading", { name: "Paramètres" }).waitFor();
  await teacher
    .getByText("Aucune classe n’est encore affectée à ce compte.", {
      exact: false,
    })
    .waitFor();
  assert.deepEqual(errors, []);
  await teacher.context().close();
});
