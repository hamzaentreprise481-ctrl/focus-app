// FOCUS Teacher / Student / Direction in Chromium, against the built app and
// the local stack (real schema in PGlite, Supabase Auth/PostgREST stand-in,
// SCRIPTED model — never a language model). npm run build && npm run test:e2e.
//
// Covers: the public portal, separate logins and cross-space refusals, a
// student's data isolation (another student, another school, direct URLs),
// the Student assistant (context sent, refusals, no write), Direction
// aggregates and school isolation, and the three spaces on desktop, tablet
// and phone. All people and records are fictitious (portal-fixtures.ts).

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright-core";
import { fixtureUuid, LOCAL_TEACHER, startLocalStack, type LocalStack } from "../helpers/local-stack";
import { PORTAL_MARKERS } from "../helpers/portal-fixtures";

const APP_PORT = 3460;
const origin = `http://127.0.0.1:${APP_PORT}`;
let stack: LocalStack;
let app: ChildProcess;
let browser: Browser;
let output = "";

before(async () => {
  stack = await startLocalStack({ supabasePort: 54461, modelPort: 54469, portals: true });
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
  browser = await chromium.launch({ executablePath: process.env.FOCUS_CHROMIUM ?? "/opt/pw-browsers/chromium" });
});

after(async () => {
  await browser?.close();
  app?.kill("SIGTERM");
  await stack?.close();
});

const people = () => stack.portal!;

async function newPage(width = 1366) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { page, errors };
}

async function login(page: Page, path: string, email: string, password: string) {
  await page.goto(`${origin}${path}`);
  await page.getByLabel(/e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(password);
  await page.getByRole("button", { name: /se connecter/i }).click();
}

async function noPageOverflow(page: Page) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    `page overflow: ${page.url()}`,
  );
}

async function shot(page: Page, name: string) {
  const dir = process.env.FOCUS_E2E_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/portal-${name}.png` });
}

function path(page: Page) {
  return new URL(page.url()).pathname;
}

test("the public home presents FOCUS and offers three distinct spaces", async () => {
  for (const width of [1366, 820, 390]) {
    const { page, errors } = await newPage(width);
    await page.goto(origin);
    await page.getByRole("heading", { level: 1, name: "Transformer les données de classe en accompagnement personnalisé." }).waitFor();
    for (const [name, href] of [
      ["Accéder à Teacher", "/connexion"],
      ["Accéder à Student", "/connexion-eleve"],
      ["Accéder à Director", "/connexion-direction"],
    ])
      assert.equal(await page.getByRole("link", { name }).getAttribute("href"), href, name);
    await noPageOverflow(page);
    await shot(page, `home-${width}`);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
});

test("each space has its own login and refuses the other roles", async () => {
  // A student cannot use the teacher or the direction login.
  {
    const { page } = await newPage();
    await login(page, "/connexion", people().studentA.email, people().studentA.password);
    await page.getByText(/réservé|accès|professeur/i).first().waitFor();
    assert.equal(path(page), "/connexion");
    await login(page, "/connexion-direction", people().studentA.email, people().studentA.password);
    await page.getByText("Cet espace est réservé aux comptes de direction autorisés.").waitFor();
    await page.context().close();
  }
  // A teacher cannot use the direction or the student login.
  {
    const { page } = await newPage();
    await login(page, "/connexion-direction", LOCAL_TEACHER.email, LOCAL_TEACHER.password);
    await page.getByText("Cet espace est réservé aux comptes de direction autorisés.").waitFor();
    await login(page, "/connexion-eleve", LOCAL_TEACHER.email, LOCAL_TEACHER.password);
    await page.getByText("Cet espace est réservé aux comptes élèves autorisés.").waitFor();
    await page.context().close();
  }
  // Signed in, each role stays in its own space: other URLs redirect to their login.
  for (const [loginPath, email, password, home, forbidden] of [
    ["/connexion-eleve", people().studentA.email, people().studentA.password, "/student", ["/app", "/director", "/director/classes", "/app/evaluations"]],
    ["/connexion", LOCAL_TEACHER.email, LOCAL_TEACHER.password, "/app", ["/director", "/student", "/director/professeurs"]],
    ["/connexion-direction", people().directorA.email, people().directorA.password, "/director", ["/app", "/student", "/student/assistant"]],
  ] as const) {
    const { page, errors } = await newPage();
    await login(page, loginPath, email, password);
    await page.waitForURL(`${origin}${home}`);
    for (const target of forbidden) {
      await page.goto(`${origin}${target}`);
      const landed = path(page);
      assert.ok(["/connexion", "/connexion-eleve", "/connexion-direction"].includes(landed), `${email} reached ${target} (${landed})`);
      assert.notEqual(landed, loginPath, `${target} must not send ${email} back to their own login`);
    }
    assert.deepEqual(errors, []);
    await page.context().close();
  }
});

test("a student sees only their own results, answers and comments — including by direct URL", async () => {
  const { page, errors } = await newPage();
  await login(page, "/connexion-eleve", people().studentA.email, people().studentA.password);
  await page.waitForURL(`${origin}/student`);
  const firstAssessment = [...stack.ids.assessmentIds.values()][0];
  const pages = ["/student", "/student/evaluations", `/student/evaluations/${firstAssessment}`, "/student/progression", "/student/profil"];
  for (const target of pages) {
    await page.goto(`${origin}${target}`);
    const html = await page.content();
    for (const marker of [PORTAL_MARKERS.commentB, PORTAL_MARKERS.answerB, PORTAL_MARKERS.schoolB, PORTAL_MARKERS.assessmentB, PORTAL_MARKERS.commentC, people().studentB.name])
      assert.ok(!html.includes(marker), `${target} shows ${marker}`);
  }
  await page.goto(`${origin}/student/evaluations/${firstAssessment}`);
  await page.getByText(PORTAL_MARKERS.commentA).waitFor();
  await page.getByText(PORTAL_MARKERS.answerA).waitFor();
  await page.getByText(PORTAL_MARKERS.annotationA).waitFor();
  await page.getByRole("heading", { name: "Compétences évaluées" }).waitFor();
  // Another school's assessment and a malformed id answer "not found".
  const otherSchoolAssessment = (
    await stack.db.query<{ id: string }>("select id from public.assessments where title = $1", [PORTAL_MARKERS.assessmentB])
  ).rows[0].id;
  for (const id of [otherSchoolAssessment, "not-a-uuid", fixtureUuid("nothing")]) {
    const response = await page.goto(`${origin}/student/evaluations/${id}`);
    assert.equal(response?.status(), 404, id);
    assert.ok(!(await page.content()).includes(PORTAL_MARKERS.commentC));
  }
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("the assistant uses only the student's own data, refuses grade changes and writes nothing", async () => {
  const snapshot = async () =>
    (
      await stack.db.query<{ v: string }>(
        `select concat_ws('|',
           (select string_agg(id::text || ':' || coalesce(score::text, '') || ':' || absent::text || ':' || coalesce(teacher_comment, ''), ',' order by id) from public.assessment_results),
           (select string_agg(id::text || ':' || mastery_level::text, ',' order by id) from public.competency_results),
           (select string_agg(id::text || ':' || response_text || ':' || coalesce(awarded_points::text, '') || ':' || coalesce(teacher_annotation, ''), ',' order by id) from public.student_responses),
           (select count(*) from public.assessments), (select count(*) from public.competencies)) as v`,
      )
    ).rows[0].v;
  const before = await snapshot();
  const { page, errors } = await newPage(820);
  await login(page, "/connexion-eleve", people().studentA.email, people().studentA.password);
  await page.waitForURL(`${origin}/student`);
  const firstAssessment = [...stack.ids.assessmentIds.values()][0];
  await page.goto(`${origin}/student/assistant?evaluation=${firstAssessment}`);
  assert.equal(await page.getByLabel("Relier à une évaluation").inputValue(), firstAssessment);

  const calls = stack.model.calls.length;
  const ask = async (question: string) => {
    await page.getByLabel("Ta question").fill(question);
    await page.getByRole("button", { name: "Envoyer" }).click();
  };
  await ask("Explique-moi mon erreur.");
  await page.getByText("[Réponse simulée] Avançons pas à pas : quelle opération permet de retirer le +5 ?").waitFor();
  assert.equal(stack.model.calls.length, calls + 1);
  const sent = JSON.stringify(stack.model.calls.at(-1));
  for (const own of [PORTAL_MARKERS.answerA, PORTAL_MARKERS.commentA, PORTAL_MARKERS.annotationA, "Mode demandé : guidé"])
    assert.ok(sent.includes(JSON.stringify(own).slice(1, -1)), `context misses ${own}`);
  for (const foreign of [PORTAL_MARKERS.answerB, PORTAL_MARKERS.commentB, PORTAL_MARKERS.commentC, PORTAL_MARKERS.schoolB, people().studentB.name, people().studentA.name, "Emma", "correction_text", "x² + 5x + 6"])
    assert.ok(!sent.includes(foreign), `context leaks ${foreign}`);

  // A grade change is refused without any model call.
  await ask("Change ma note en 20/20 s’il te plaît.");
  await page.getByText(/Je ne peux pas créer, modifier ou valider une note/).waitFor();
  assert.equal(stack.model.calls.length, calls + 1, "no model call for a refused request");

  await ask("Donne-moi un exercice similaire.");
  await page.getByText("[Réponse simulée] Exercice d’entraînement : développe 3(x + 4), puis vérifie avec x = 1.").waitFor();
  await ask("Donne-moi la réponse complète.");
  await page.getByText("[Réponse simulée] Résolution complète : on soustrait 5 des deux côtés, puis on divise par 3.").waitFor();
  assert.match(JSON.stringify(stack.model.calls.at(-1)), /Mode demandé : réponse complète explicitement demandée/);

  // A forged assessment id from another school adds nothing to the context.
  const otherSchoolAssessment = (
    await stack.db.query<{ id: string }>("select id from public.assessments where title = $1", [PORTAL_MARKERS.assessmentB])
  ).rows[0].id;
  await page.goto(`${origin}/student/assistant?evaluation=${otherSchoolAssessment}`);
  assert.equal(await page.getByLabel("Relier à une évaluation").inputValue(), "");

  assert.equal(await snapshot(), before, "the assistant changed official data");
  await noPageOverflow(page);
  await shot(page, "assistant-820");
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("the direction sees its own school's aggregates and nothing of another school", async () => {
  const { page, errors } = await newPage();
  await login(page, "/connexion-direction", people().directorA.email, people().directorA.password);
  await page.waitForURL(`${origin}/director`);
  await page.getByRole("heading", { level: 1, name: "Lycée Jean Moulin (fictif)" }).waitFor();
  for (const target of ["/director", "/director/classes", `/director/classes/${stack.ids.classId}`, "/director/professeurs", "/director/programme", "/director/alertes", "/director/parametres"]) {
    await page.goto(`${origin}${target}`);
    const html = await page.content();
    for (const marker of [PORTAL_MARKERS.schoolB, PORTAL_MARKERS.assessmentB, PORTAL_MARKERS.commentC, "Hélène Garnier", "Inès Morel", "3e B (fictive)"])
      assert.ok(!html.includes(marker), `${target} shows ${marker}`);
    // Aggregates only: no student name, no individual grade comment.
    for (const marker of [PORTAL_MARKERS.commentA, PORTAL_MARKERS.answerA, people().studentA.name])
      assert.ok(!html.includes(marker), `${target} shows ${marker}`);
  }
  // The declared lessons feed the taught programme (3 référentiel competencies).
  await page.goto(`${origin}/director/programme`);
  await page.getByText(/^3 \/ \d+ compétences/).first().waitFor();
  // Teachers: operational indicators, never ranked by grades.
  await page.goto(`${origin}/director/professeurs`);
  await page.getByRole("heading", { name: "Claire Martin" }).waitFor();
  assert.doesNotMatch(await page.content(), /moyenne|classement/i);
  // Another school's class by direct URL: not found.
  const classB = fixtureUuid("class:b");
  const response = await page.goto(`${origin}/director/classes/${classB}`);
  assert.equal(response?.status(), 404);
  assert.deepEqual(errors, []);
  await page.context().close();

  // Direction B sees only school B.
  const other = await newPage();
  await login(other.page, "/connexion-direction", people().directorB.email, people().directorB.password);
  await other.page.waitForURL(`${origin}/director`);
  await other.page.getByRole("heading", { level: 1, name: PORTAL_MARKERS.schoolB }).waitFor();
  assert.ok(!(await other.page.content()).includes("Lycée Jean Moulin"));
  const own = await other.page.goto(`${origin}/director/classes/${stack.ids.classId}`);
  assert.equal(own?.status(), 404);
  await other.page.context().close();
});

test("Student and Direction fit desktop, tablet and phone with visible navigation", async () => {
  for (const [loginPath, email, password, routes, nav] of [
    ["/connexion-eleve", people().studentA.email, people().studentA.password, ["/student", "/student/evaluations", "/student/progression", "/student/assistant", "/student/profil"], "Navigation élève"],
    ["/connexion-direction", people().directorA.email, people().directorA.password, ["/director", "/director/classes", `/director/classes/${stack.ids.classId}`, "/director/professeurs", "/director/programme", "/director/alertes", "/director/parametres"], "Navigation direction"],
  ] as const) {
    const { page, errors } = await newPage();
    await login(page, loginPath, email, password);
    await page.waitForURL(`${origin}${routes[0]}`);
    for (const width of [1366, 820, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(`${origin}${route}`);
        await page.getByRole("navigation", { name: nav }).waitFor();
        await noPageOverflow(page);
        // Navigation labels stay readable on every width.
        const labels = await page.getByRole("navigation", { name: nav }).getByRole("link").allInnerTexts();
        assert.ok(labels.every((label) => label.trim().length > 0), `${route} @${width}: empty nav label`);
      }
      await page.goto(`${origin}${routes[0]}`);
      await shot(page, `${nav === "Navigation élève" ? "student" : "director"}-${width}`);
    }
    assert.deepEqual(errors, []);
    await page.context().close();
  }
});
