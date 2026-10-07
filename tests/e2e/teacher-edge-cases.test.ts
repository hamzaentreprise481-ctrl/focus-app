// Edge cases of the teacher flow in Chromium, against the built app and the
// local stack with a SLOW scripted model (npm run build && npm run test:e2e):
// double clicks, an analysis the model refuses (insufficient evidence), a
// model failure, a decision on a hypothesis replaced meanwhile, a database
// error while saving a copy, a refresh during the class analysis.
// Every finding comes from the script in tests/helpers/local-stack.ts.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright-core";
import {
  fixtureUuid,
  ILLEGIBLE_MARKER,
  LOCAL_TEACHER,
  MODEL_FAILURE_MARKER,
  startLocalStack,
  type LocalStack,
} from "../helpers/local-stack";

const APP_PORT = 3410;
const origin = `http://127.0.0.1:${APP_PORT}`;
let stack: LocalStack;
let app: ChildProcess;
let output = "";
let browser: Browser;

before(async () => {
  stack = await startLocalStack({ supabasePort: 54431, modelPort: 54439, modelDelayMs: 700 });
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

async function teacherPage() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`${origin}/connexion`);
  await page.getByLabel(/e-mail/i).fill(LOCAL_TEACHER.email);
  await page.getByLabel(/mot de passe/i).fill(LOCAL_TEACHER.password);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL(`${origin}/app`);
  return { page, errors };
}

/** A new assessment with one tagged question; returns its URL. */
async function assessmentWithQuestion(page: Page, title: string) {
  await page.goto(`${origin}/app/evaluations/nouvelle`);
  await page.getByLabel("Nom de l’évaluation").fill(title);
  await page.getByLabel("Date").fill("2026-10-03");
  await page.getByRole("button", { name: "Enregistrer l’évaluation" }).dblclick();
  await page.getByRole("heading", { name: "Évaluation enregistrée" }).waitFor();
  await page.getByRole("link", { name: "Ajouter le sujet et les copies" }).click();
  await page.waitForURL(/\/app\/evaluations\/[0-9a-f-]{36}/);
  const url = page.url().split("#")[0];
  await page.getByRole("button", { name: "Ajouter une question" }).click();
  await page.getByLabel("Énoncé").fill("Développer 2(x + 3).");
  // A question needs its correction: nothing is saved without it.
  await page.getByRole("button", { name: "Enregistrer le sujet et le corrigé" }).click();
  await page.getByText("Question 1 : le corrigé attendu est obligatoire.").waitFor();
  await page.getByLabel("Corrigé attendu").fill("2(x + 3) = 2x + 6");
  await page.getByLabel("Points maximum (facultatif)").fill("2");
  await page.getByLabel("Notions évaluées (recommandé)").selectOption("MATH.ALG.DISTRIBUTIVITE");
  await page.getByRole("button", { name: "Enregistrer le sujet et le corrigé" }).click();
  await page.getByRole("list", { name: "Élèves de la classe" }).waitFor();
  return url;
}

async function enterCopy(page: Page, name: string, text: string, points: string) {
  await page.getByRole("list", { name: "Élèves de la classe" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("heading", { name: `Copie de ${name}` }).waitFor();
  await page.getByLabel("Réponse de l’élève").fill(text);
  await page.getByLabel("Points attribués").fill(points);
  await page.getByRole("button", { name: "Enregistrer la copie" }).click();
  await page.getByText(/^Copie enregistrée\./).waitFor();
}

test("a double click analyses the whole class; refused, insufficient and failed copies are reported as such", async () => {
  const { page, errors } = await teacherPage();
  // A double click on save created one assessment, not two.
  await assessmentWithQuestion(page, "Cas limites — classe");
  await page.goto(`${origin}/app/evaluations`);
  assert.equal(await page.getByText("Cas limites — classe").count(), 1);
  await page.getByText("Cas limites — classe").click();
  await page.getByRole("list", { name: "Élèves de la classe" }).waitFor();

  await enterCopy(page, "Adam Benali", "2(x + 3) = 2x + 3", "0,5");
  await enterCopy(page, "Anaïs Renault", `${ILLEGIBLE_MARKER} 2x`, "0");
  await enterCopy(page, "Arthur Meunier", `2x + 6 ${MODEL_FAILURE_MARKER}`, "2");
  await enterCopy(page, "Baptiste Noël", "2(x + 3) = 2x + 6", "2");

  const calls = stack.model.calls.length;
  await page.getByRole("button", { name: "Analyser les 4 copies non analysées" }).dblclick();
  // The slow model leaves time to see the progress, and the run is not stopped by the second click.
  await page.getByText(/^Analyse 1 \/ 4 : /).waitFor();
  const summary = page.getByText(/^\d copies? analysées? : /);
  await summary.waitFor({ timeout: 60_000 });
  assert.equal(
    await summary.textContent(),
    "3 copies analysées : 1 copie avec erreur(s) observée(s) (1 hypothèse à examiner) ; 1 copie sans erreur observée — ce n’est pas une preuve de maîtrise ; 1 copie : preuves insuffisantes ; 1 échec, à relancer.",
  );
  assert.equal(stack.model.calls.length - calls, 4, "one model call per copy, none twice");
  // Each request carries one student's copy only (Baptiste's answer is the
  // correction, present in every request, so it marks nobody).
  const distinctive = ["2x + 3", ILLEGIBLE_MARKER, MODEL_FAILURE_MARKER];
  const found = stack.model.calls.slice(calls).map((call) => distinctive.filter((answer) => JSON.stringify(call).includes(answer)));
  assert.ok(found.every((answers) => answers.length <= 1), JSON.stringify(found));
  assert.deepEqual(found.flat().sort(), [...distinctive].sort());
  assert.equal(await page.getByText("Analyse arrêtée à votre demande").count(), 0);
  await page.getByText("Arthur Meunier : L’analyse IA a échoué. Aucune recommandation n’a été enregistrée ; réessayez plus tard.").waitFor();
  // The failed copy stays queued; nothing was recorded for it.
  await page.getByRole("button", { name: "Analyser la copie non analysée" }).waitFor();

  // Insufficient evidence is said as such on the copy, never as "no error".
  await page.getByRole("list", { name: "Élèves de la classe" }).getByRole("button", { name: /^Anaïs Renault/ }).click();
  await page.getByText("Analyse actuelle : preuves insuffisantes").waitFor();

  // Only the copy with a quoted error produced a hypothesis.
  await page.locator("#hypotheses").getByRole("button", { name: "À examiner (1)" }).waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("a hypothesis replaced meanwhile cannot be decided, and the list says so and refreshes", async () => {
  const { page } = await teacherPage();
  await assessmentWithQuestion(page, "Cas limites — remplacement");
  await enterCopy(page, "Adam Benali", "2(x + 3) = 2x + 3", "0,5");
  await page.getByRole("button", { name: "Analyser la copie non analysée" }).click();
  const review = page.locator("#hypotheses");
  await review.getByRole("button", { name: "À examiner (1)" }).waitFor({ timeout: 30_000 });

  // The copy is corrected elsewhere (another tab): the analysis is superseded.
  await stack.db.query(
    `update public.student_responses r set response_text = '2(x + 3) = 2x + 6'
     from public.assessments a where a.id = r.assessment_id and a.title = 'Cas limites — remplacement'`,
  );
  await review.getByRole("button", { name: "Confirmer l’observation" }).click();
  await review.getByRole("button", { name: "À examiner (0)" }).waitFor();
  // The explanation stays on screen once the list is empty, and the copy is offered again.
  await review.getByText(/Cette recommandation a été remplacée/).waitFor();
  await page.getByRole("button", { name: "Analyser la copie non analysée" }).waitFor();
  const decided = await stack.db.query<{ n: number }>(
    `select count(*)::int as n from public.pedagogical_recommendations p join public.assessments a on a.id = p.assessment_id
     where a.title = 'Cas limites — remplacement' and p.teacher_decision is not null`,
  );
  assert.equal(decided.rows[0].n, 0, "nothing was decided on the replaced hypothesis");
  await page.context().close();
});

test("a database error while saving a copy keeps the teacher's text and says so", async () => {
  const { page } = await teacherPage();
  await assessmentWithQuestion(page, "Cas limites — panne");
  await stack.db.query("revoke execute on function public.focus_save_student_responses(uuid, uuid, jsonb) from authenticated");
  try {
    await page.getByRole("list", { name: "Élèves de la classe" }).getByRole("button", { name: /^Adam Benali/ }).click();
    await page.getByLabel("Réponse de l’élève").fill("2(x + 3) = 2x + 3");
    await page.getByRole("button", { name: "Enregistrer la copie" }).click();
    await page.getByRole("alert").filter({ hasText: /droits|Enregistrement impossible/ }).waitFor();
    assert.equal(await page.getByLabel("Réponse de l’élève").inputValue(), "2(x + 3) = 2x + 3");
  } finally {
    await stack.db.query("grant execute on function public.focus_save_student_responses(uuid, uuid, jsonb) to authenticated");
  }
  // Once the database answers again, the same click saves it.
  await page.getByRole("button", { name: "Enregistrer la copie" }).click();
  await page.getByText(/^Copie enregistrée\./).waitFor();
  await page.context().close();
});

test("a refresh during the class analysis keeps what is done and offers the rest", async () => {
  const { page } = await teacherPage();
  const url = await assessmentWithQuestion(page, "Cas limites — rechargement");
  await enterCopy(page, "Adam Benali", "2(x + 3) = 2x + 3", "0,5");
  await enterCopy(page, "Baptiste Noël", "2(x + 3) = 2x + 6", "2");
  await enterCopy(page, "Lucas Bernard", "2(x + 3) = 2x + 6", "2");
  await page.getByRole("button", { name: "Analyser les 3 copies non analysées" }).click();
  await page.getByText(/^Analyse 2 \/ 3 : /).waitFor({ timeout: 30_000 });
  await page.reload();
  await page.getByRole("list", { name: "Élèves de la classe" }).waitFor();
  // The first copy is analysed; whatever is left is offered again, nothing is lost.
  const remaining = page.getByRole("button", { name: /^Analyser les [12] copies? non analysées?$/ });
  await remaining.waitFor();
  await remaining.click();
  await page.getByText("Toutes les copies enregistrées ont une analyse à jour.").waitFor({ timeout: 30_000 });
  assert.equal(page.url().split("#")[0], url);
  await page.context().close();
});

test("a copy edited while the model reads it is not recorded with the old text", async () => {
  const { page, errors } = await teacherPage();
  const title = "Cas limites — copie modifiée";
  await assessmentWithQuestion(page, title);
  await enterCopy(page, "Adam Benali", "2(x + 3) = 2x + 3", "0,5");
  const calls = stack.model.calls.length;
  await page.getByRole("button", { name: "Analyser la copie non analysée" }).click();
  // The model has the copy; meanwhile it is corrected elsewhere (another tab).
  while (stack.model.calls.length === calls) await delay(20);
  await stack.db.query(
    `update public.student_responses r set response_text = '2(x + 3) = 2x + 6'
     from public.assessments a where a.id = r.assessment_id and a.title = $1`,
    [title],
  );
  await page
    .getByText("Adam Benali : La copie, le sujet ou le corrigé a changé pendant l’analyse : rien n’a été enregistré. Relancez l’analyse de cette copie.")
    .waitFor({ timeout: 30_000 });
  const recorded = await stack.db.query<{ n: number }>(
    `select count(*)::int as n from public.ai_analysis_runs r join public.assessments a on a.id = r.assessment_id where a.title = $1`,
    [title],
  );
  assert.equal(recorded.rows[0].n, 0, "nothing was recorded for the text the model read");
  // Relaunched, the analysis reads the corrected copy: no error, no hypothesis.
  await page.getByRole("button", { name: "Analyser la copie non analysée" }).click();
  await page.getByText("1 copie analysée : 1 copie sans erreur observée — ce n’est pas une preuve de maîtrise.").waitFor({ timeout: 30_000 });
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("a teacher of two subjects in the class chooses the subject of a grade-free assessment", async () => {
  // Codex review on #8: without competencies the server could not tell which
  // of the teacher's subjects the new assessment belongs to.
  const physics = fixtureUuid("subject:physics-two-subjects");
  const title = "Cas limites — deux matières";
  await stack.db.query("insert into public.subjects(id, school_id, name, code) values ($1, $2, 'Physique-chimie', 'PC')", [physics, stack.ids.school]);
  await stack.db.query("insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)", [
    stack.ids.school, LOCAL_TEACHER.id, stack.ids.classId, physics,
  ]);
  try {
    const { page, errors } = await teacherPage();
    await page.goto(`${origin}/app/evaluations/nouvelle`);
    await page.getByLabel("Nom de l’évaluation").fill(title);
    await page.getByLabel("Date").fill("2026-10-07");
    const save = page.getByRole("button", { name: "Enregistrer l’évaluation" });
    assert.equal(await save.isDisabled(), true, "nothing is saved before the subject is chosen");
    await page.getByLabel("Matière", { exact: true }).selectOption({ label: "Physique-chimie" });
    await save.click();
    await page.getByRole("heading", { name: "Évaluation enregistrée" }).waitFor();
    const { rows } = await stack.db.query<{ code: string }>(
      "select s.code from public.assessments a join public.subjects s on s.id = a.subject_id where a.title = $1",
      [title],
    );
    assert.deepEqual(rows, [{ code: "PC" }]);
    assert.deepEqual(errors, []);
    await page.context().close();
  } finally {
    await stack.db.query("delete from public.assessments where title = $1", [title]);
    await stack.db.query("delete from public.teacher_assignments where teacher_id = $1 and subject_id = $2", [LOCAL_TEACHER.id, physics]);
    await stack.db.query("delete from public.subjects where id = $1", [physics]);
  }
});

test("direct URLs to missing or foreign records answer plainly", async () => {
  const { page } = await teacherPage();
  for (const [path, text] of [
    ["/app/evaluations/not-a-uuid", "Évaluation introuvable dans votre espace"],
    ["/app/evaluations/00000000-0000-4000-8000-000000000000", "Évaluation introuvable dans votre espace"],
    [`/app/eleves/${stack.ids.otherStudentIds[0]}`, "Page introuvable"],
    ["/app/classes/nope", "Page introuvable"],
  ] as const) {
    await page.goto(origin + path);
    await page.getByText(text).first().waitFor();
  }
  await page.context().close();
});
