// The core teacher flow in a real browser (Chromium through playwright-core)
// against the built app and the local backend (every migration, RLS, the
// Supabase Auth/PostgREST stand-in, fictitious school): sign in, read the
// class and a student, create an evaluation with a score, an absence and a
// competency-only result, check what was persisted, see the analysis
// update, edit it, delete it, and stay confined to one's own classes.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { Browser, Page } from "playwright-core";
import { launchBrowser } from "../helpers/browser";
import { LOCAL_TEACHER, startLocalStack, type LocalStack } from "../helpers/local-stack";

const PORT = 3140;
const BASE = `http://127.0.0.1:${PORT}`;
let stack: LocalStack;
let app: ChildProcess;
let browser: Browser;

before(async () => {
  stack = await startLocalStack({ supabasePort: 54391, modelPort: 54399 });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    env: { ...process.env, ...stack.env },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(`${BASE}/connexion`);
      break;
    } catch {
      await delay(250);
    }
  }
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  app?.kill("SIGTERM");
  await stack?.close();
});

async function signIn(page: Page, password = LOCAL_TEACHER.password) {
  await page.goto(`${BASE}/connexion`);
  await page.getByLabel(/adresse|e-mail|courriel/i).first().fill(LOCAL_TEACHER.email);
  await page.getByLabel(/mot de passe/i).first().fill(password);
  await page.getByRole("button", { name: /se connecter/i }).click();
}

const TITLE = "Contrôle E2E — Vecteurs";
const LUCAS = "Lucas Bernard";
const EMMA = "Emma Leroy";
const ADAM = "Adam Benali";

test("a teacher goes from sign-in to an updated analysis, and back out", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // Protected routes send an anonymous visitor to the login page.
  await page.goto(`${BASE}/app/classes`);
  await page.waitForURL(/\/connexion/);

  // A wrong password keeps the visitor out, with a message.
  await signIn(page, "not-the-password");
  await page.getByText(/connexion impossible/i).first().waitFor();
  assert.match(page.url(), /\/connexion/);

  // Real sign-in: the teacher's own workspace.
  await signIn(page);
  await page.waitForURL(`${BASE}/app`);
  await page.getByRole("heading", { name: /Bonjour Claire Martin/ }).waitFor();
  const cookies = await context.cookies();
  const session = cookies.filter((cookie) => /-auth-token/.test(cookie.name));
  assert.ok(session.length > 0 && session.every((cookie) => cookie.httpOnly && cookie.sameSite === "Lax"));

  // The class overview: groups with reasons, competency signals, evaluations.
  await page.getByRole("link", { name: /Ouvrir ma classe/ }).click();
  await page.waitForURL(/\/app\/classes\//);
  const classUrl = page.url();
  await page.getByRole("heading", { name: "Seconde 3" }).waitFor();
  await page.getByRole("heading", { name: "Où porter son attention" }).waitFor();
  assert.ok(await page.locator('[data-group="toExamine"]').getByText(LUCAS).isVisible());
  await page.getByRole("heading", { name: "Points à travailler dans la classe" }).waitFor();

  // A student record: what was entered, a reading, next steps, reliability.
  await page.locator('[data-group="toExamine"]').getByRole("link", { name: new RegExp(LUCAS) }).click();
  await page.waitForURL(/\/app\/eleves\//);
  const lucasUrl = page.url();
  await page.getByRole("heading", { name: new RegExp(`^${LUCAS}$`) }).waitFor();
  await page.getByText("Ce qui a été saisi").waitFor();
  assert.match(await page.getByTestId("signal-reliability").innerText(), /Fiabilité du signal : .+ · Basé sur \d+ observations? de « Vecteurs »/);

  // A new evaluation from the class page.
  await page.goto(classUrl);
  await page.getByRole("link", { name: "Ajouter une évaluation" }).first().click();
  await page.waitForURL(/\/app\/evaluations\/nouvelle\?classe=/);
  await page.getByLabel("Nom de l’évaluation").fill(TITLE);
  await page.getByLabel("Date").fill("2026-12-15");
  await page.getByLabel("Séquence charnière").check();
  await page.getByRole("button", { name: "Vecteurs", exact: true }).click();
  await page.getByLabel(`Note de ${LUCAS} sur 20`).fill("7,5");
  await page.getByLabel(`Vecteurs — ${LUCAS}`).selectOption("non_maitrise");
  await page.getByLabel(`${EMMA} absent(e)`).check();
  // Competency only, no grade.
  await page.getByLabel(`Vecteurs — ${ADAM}`).selectOption("en_cours");
  // An invalid grade blocks saving until corrected.
  await page.getByLabel("Note de Léa Dubois sur 20").fill("25");
  assert.equal(await page.getByRole("button", { name: /Enregistrer l’évaluation/ }).isDisabled(), true);
  await page.getByLabel("Note de Léa Dubois sur 20").fill("");
  await page.getByRole("button", { name: /Enregistrer l’évaluation/ }).click();
  await page.getByRole("heading", { name: "Évaluation enregistrée" }).waitFor();

  // Persisted exactly as entered: a score, an absence, a competency-only row.
  const { rows: saved } = await stack.db.query<{ id: string; important: boolean; date: string }>(
    "select id, important, date::text as date from public.assessments where title = $1",
    [TITLE],
  );
  assert.equal(saved.length, 1, "exactly one evaluation, no duplicate");
  assert.deepEqual({ important: saved[0].important, date: saved[0].date }, { important: true, date: "2026-12-15" });
  const assessmentId = saved[0].id;
  const { rows: results } = await stack.db.query<{ name: string; score: string | null; absent: boolean; level: string | null }>(
    `select p.first_name || ' ' || p.last_name as name, r.score::text as score, r.absent, cr.mastery_level::text as level
       from public.assessment_results r
       join public.profiles p on p.id = r.student_id
       left join public.competency_results cr on cr.assessment_result_id = r.id
      where r.assessment_id = $1
      order by name`,
    [assessmentId],
  );
  assert.deepEqual(results, [
    { name: ADAM, score: null, absent: false, level: "developing" },
    { name: EMMA, score: null, absent: true, level: null },
    { name: LUCAS, score: "7.50", absent: false, level: "not_mastered" },
  ]);

  // The class page lists it with its entry completion; the analysis updated.
  await page.goto(classUrl);
  const row = page
    .locator("section", { has: page.getByRole("heading", { name: "Évaluations de la classe" }) })
    .getByRole("link", { name: new RegExp(TITLE) });
  await row.waitFor();
  assert.match(await row.innerText(), /2 saisies sur 31 · 1 absence · 28 élèves sans saisie · compétences renseignées pour 2 élèves/);
  // Emma missed a key sequence: her reading now says so.
  await page.goto(`${BASE}/app/eleves/${stack.ids.studentIds.get("emma-leroy")}`);
  await page.getByText(new RegExp(`Absence : « ${TITLE} » \\(15/12/2026\\), séquence marquée importante`)).waitFor();
  // Lucas's record shows the new dated observation.
  await page.goto(lucasUrl);
  await page.getByText(new RegExp(`Non maîtrisé \\(« ${TITLE} », 15/12/2026\\)`)).first().waitFor();

  // Editing: the same evaluation is updated, not duplicated.
  await page.goto(`${BASE}/app/evaluations/${assessmentId}/modifier`);
  await page.getByLabel(`Note de ${LUCAS} sur 20`).fill("9");
  await page.getByRole("button", { name: /Enregistrer l’évaluation/ }).click();
  await page.getByRole("heading", { name: "Évaluation mise à jour" }).waitFor();
  const { rows: edited } = await stack.db.query<{ n: number; score: string }>(
    `select (select count(*)::int from public.assessments where title = $1) as n,
            (select r.score::text from public.assessment_results r join public.profiles p on p.id = r.student_id
              where r.assessment_id = $2 and p.last_name = 'Bernard') as score`,
    [TITLE, assessmentId],
  );
  assert.deepEqual(edited[0], { n: 1, score: "9.00" });

  // The session survives a reload.
  await page.reload();
  await page.getByRole("heading", { name: "Évaluation mise à jour" }).or(page.getByRole("heading", { name: "Compléter les résultats" })).waitFor();
  assert.match(page.url(), /\/modifier$/);

  // Deleting an evaluation created by mistake, after confirmation.
  await page.goto(`${BASE}/app/evaluations/${assessmentId}`);
  await page.getByRole("button", { name: "Supprimer l’évaluation" }).click();
  await page.getByRole("button", { name: "Supprimer définitivement" }).click();
  await page.waitForURL(`${BASE}/app/evaluations`);
  const { rows: gone } = await stack.db.query("select 1 from public.assessments where id = $1", [assessmentId]);
  assert.equal(gone.length, 0);
  assert.equal((await stack.db.query("select 1 from public.assessment_results where assessment_id = $1", [assessmentId])).rows.length, 0);

  // Another teacher's class and student stay out of reach by URL.
  await page.goto(`${BASE}/app/classes/${stack.ids.otherClassId}`);
  await page.getByText(/introuvable|n’existe pas|404/i).first().waitFor();
  assert.equal(await page.getByText("Iris Vidal").count(), 0);
  await page.goto(`${BASE}/app/eleves/${stack.ids.otherStudentIds[0]}`);
  await page.getByText(/introuvable|n’existe pas|404/i).first().waitFor();
  assert.equal(await page.getByText("Iris Vidal").count(), 0);

  // Signing out ends the session.
  await page.goto(`${BASE}/app`);
  await page.getByRole("button", { name: /Se déconnecter/ }).click();
  await page.waitForURL(/\/connexion/);
  await page.goto(`${BASE}/app/eleves`);
  await page.waitForURL(/\/connexion/);

  assert.deepEqual(errors, [], "no client-side exception");
  await context.close();
});

test("an evaluation whose copies were analysed cannot be deleted", async () => {
  const page = await browser.newPage();
  await signIn(page);
  await page.waitForURL(`${BASE}/app`);
  const assessmentId = [...stack.ids.assessmentIds.values()][0];
  // A recorded analysis run (written directly: the audited function is
  // exercised by the pedagogy tests).
  await stack.db.query(
    `insert into public.ai_analysis_runs(school_id, teacher_id, student_id, assessment_id, model, input_hash, status, completed_at)
     values ($1, $2, $3, $4, 'scripted-stand-in', 'e2e', 'no_evidence', now())`,
    [stack.ids.school, LOCAL_TEACHER.id, [...stack.ids.studentIds.values()][0], assessmentId],
  );
  await page.goto(`${BASE}/app/evaluations/${assessmentId}`);
  await page.getByRole("button", { name: "Supprimer l’évaluation" }).click();
  await page.getByRole("button", { name: "Supprimer définitivement" }).click();
  await page.getByRole("alert").getByText(/historique du suivi/).waitFor();
  assert.equal((await stack.db.query("select 1 from public.assessments where id = $1", [assessmentId])).rows.length, 1);
  await page.close();
});

test("class and student pages fit a phone screen without horizontal scrolling", async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page);
  await page.waitForURL(`${BASE}/app`);
  for (const path of [
    "/app",
    `/app/classes/${stack.ids.classId}`,
    `/app/eleves/${stack.ids.studentIds.get("lucas-bernard")}`,
    "/app/evaluations/nouvelle",
  ]) {
    await page.goto(BASE + path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${path} overflows by ${overflow}px`);
  }
  await context.close();
});
