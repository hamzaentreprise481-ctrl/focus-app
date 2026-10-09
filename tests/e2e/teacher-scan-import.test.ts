// End-to-end PHOTO/SCAN path in Chromium, against the built app and the local
// stack (real schema with RLS in PGlite, Auth/PostgREST/Storage stand-in):
// teacher signs in → opens an assessment → sends a PHOTO of a handwritten
// copy (a fictitious fixture, tests/fixtures/handwriting) → the browser
// prepares it (orientation, quality, PDF) and uploads it to private Storage →
// the server reads it → review or automatic import → analysis → what the
// teacher sees, question by question → what the database holds.
//
// The READER and the MODEL here are scripted stand-ins: they return the
// readings and analyses written below, not what a language model would read.
// This proves the product path and FOCUS's own guards (no conclusion on an
// unread passage, confidence bounded by the reading, clean failures), NOT
// the quality of a real model's reading — see docs/HANDWRITING_EVALUATION.md.
//
// The local Storage stand-in is http://127.0.0.1, which the production CSP
// (connect-src https://*.supabase.co) does not list: the browser context
// bypasses CSP for this test only.
//
//   npm run build && npm run test:e2e

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright-core";
import { LOCAL_TEACHER, startLocalStack, type LocalStack } from "../helpers/local-stack";

const APP_PORT = 3420;
const origin = `http://127.0.0.1:${APP_PORT}`;
const FIXTURES = path.join(__dirname, "..", "fixtures", "handwriting", "images");
let stack: LocalStack;
let app: ChildProcess;
let output = "";
let browser: Browser;

const QUESTIONS = [
  { prompt: "Développer A = 3(x + 4).", correctionText: "A = 3x + 12", maxPoints: "2", nodeCodes: ["MATH.ALG.DISTRIBUTIVITE"] },
  { prompt: "Développer B = (x + 5)².", correctionText: "B = x² + 10x + 25", maxPoints: "2", nodeCodes: ["MATH.ALG.IDENTITES"] },
  { prompt: "Calculer 2/3 + 1/4.", correctionText: "8/12 + 3/12 = 11/12", maxPoints: "2", nodeCodes: ["MATH.NUM.FRACTIONS.OPERATIONS"] },
  { prompt: "Résoudre 4x − 7 = 13.", correctionText: "4x = 20 donc x = 5", maxPoints: "2", nodeCodes: ["MATH.ALG.EQUATION_PREMIER_DEGRE"] },
  { prompt: "Factoriser C = x² − 9.", correctionText: "C = (x − 3)(x + 3)", maxPoints: "2", nodeCodes: ["MATH.ALG.FACTORISATION_SIMPLE", "MATH.ALG.IDENTITES"] },
];

type Reading = Parameters<NonNullable<Parameters<typeof startLocalStack>[0]["scan"]>>[0];
let nextReading: (request: Reading) => unknown = () => ({ __status: 500, __body: {} });
const analyses = new Map<string, (input: { questions: Array<{ questionId: string; assessmentId: string; responseText: string }> }) => unknown>();
let partialAssessment = "";
let cleanAssessment = "";
let failuresAssessment = "";

const response = (questionKey: string, status: string, responseText: string, awardedPoints: string, extra: Record<string, string> = {}) => ({
  questionKey, status, responseText, crossedOut: "", awardedPoints, teacherAnnotation: "", ...extra,
});
const copy = (request: Reading, responses: unknown[], patch: Record<string, unknown> = {}) => ({
  studentKey: request.keyOf("Lucas Bernard"),
  studentNameRead: "Lucas Bernard",
  identificationConfidence: 0.99,
  groupingConfidence: 0.99,
  startPage: 1,
  endPage: request.pages,
  score: 11,
  scoreConfidence: 0.99,
  responses,
  warnings: [],
  ...patch,
});
const reading = (request: Reading, copies: unknown[], pageQuality = "bonne", issues: string[] = []) => ({
  pageCount: request.pages,
  isStudentWork: copies.length > 0,
  pages: Array.from({ length: request.pages }, (_, index) => ({ page: index + 1, orientation: 0, quality: pageQuality, issues })),
  copies,
  unassignedPages: [],
  warnings: [],
});

async function asTeacher<T>(fn: () => Promise<T>) {
  await stack.db.exec("begin");
  try {
    await stack.db.query("select set_config('request.jwt.claim.sub', $1, true)", [LOCAL_TEACHER.id]);
    await stack.db.exec("set local role authenticated");
    const result = await fn();
    await stack.db.exec("commit");
    return result;
  } catch (error) {
    await stack.db.exec("rollback");
    throw error;
  }
}

async function seedAssessment(title: string) {
  const id = randomUUID();
  await asTeacher(async () => {
    await stack.db.query("select public.focus_save_assessment($1, $2, '2026-09-14'::date, $3, $4, '{}'::uuid[], '[]'::jsonb, false)", [
      id, title, stack.ids.classId, stack.ids.subject,
    ]);
    await stack.db.query("select public.focus_save_assessment_questions($1, '', '', $2::jsonb)", [id, JSON.stringify(QUESTIONS)]);
  });
  return id;
}

const questionIds = async (assessmentId: string) =>
  (await stack.db.query<{ id: string }>("select id from public.assessment_questions where assessment_id = $1 order by position", [assessmentId])).rows.map((row) => row.id);

before(async () => {
  stack = await startLocalStack({
    supabasePort: 54451,
    modelPort: 54459,
    scan: (request) => nextReading(request),
    analysis: (input) => {
      const scripted = analyses.get(input.questions[0]?.assessmentId);
      if (!scripted) throw new Error("no scripted analysis for this assessment");
      return scripted(input);
    },
  });
  partialAssessment = await seedAssessment("Scan — copie difficile");
  cleanAssessment = await seedAssessment("Scan — copie propre");
  failuresAssessment = await seedAssessment("Scan — cas d’échec");
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
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, bypassCSP: true });
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

async function shot(page: Page, name: string) {
  const dir = process.env.FOCUS_E2E_SCREENSHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function upload(page: Page, ...files: string[]) {
  await page.getByLabel("PDF ou photos des copies").setInputFiles(files.map((file) => path.join(FIXTURES, file)));
}

async function openCopy(page: Page, name: string) {
  await page.getByRole("list", { name: "Élèves de la classe" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("heading", { name: `Copie de ${name}` }).waitFor();
}

test("a photo of a hard-to-read copy: nothing unread is imported silently, nothing unread is diagnosed", async () => {
  const { page, errors } = await teacherPage();
  // What a careful reader would return for the level-E photo: Q2 partly under
  // an ink blot, Q5 under a coffee stain, a crossed-out first attempt.
  nextReading = (request) =>
    reading(
      request,
      [
        copy(request, [
          response("Q01", "ecrite", "A = 3x + 12", "2"),
          response("Q02", "partielle", "B = x² + [illisible]", "0", { crossedOut: "x² + 5²", teacherAnnotation: "(a+b)² ?" }),
          response("Q03", "ecrite", "2/3 + 1/4 = 8/12 + 3/12 = 11/12", "2"),
          response("Q04", "ecrite", "4x = 13 + 7 = 20 ; x = 5", "2"),
          response("Q05", "illisible", "", "0"),
        ], { scoreConfidence: 0.9 }),
      ],
      "degradee",
      ["floue"],
    );
  // A model that "guesses" under the blots (what FOCUS must refuse).
  const ids = await questionIds(partialAssessment);
  analyses.set(partialAssessment, (input) => ({
    status: "errors_found",
    insufficientReason: "",
    errors: [
      { assessmentId: partialAssessment, questionId: ids[1], nodeCode: "MATH.ALG.IDENTITES", errorType: "concept", difficulty: "Carré d’une somme", evidenceExcerpt: "x² + [illisible]", explanation: "Le double produit manque.", recommendedAction: "Reprendre (a+b)².", catalogueErrorCode: "" },
      { assessmentId: partialAssessment, questionId: ids[4], nodeCode: "MATH.ALG.IDENTITES", errorType: "concept", difficulty: "Factorisation", evidenceExcerpt: "[illisible]", explanation: "Identité mal utilisée.", recommendedAction: "Revoir a²−b².", catalogueErrorCode: "" },
    ],
    questionOutcomes: input.questions.map((question, index) => ({
      questionId: question.questionId,
      outcome: index === 1 || index === 4 ? "error" : "no_error_observed",
      observedExcerpt: "",
      note: "",
    })),
  }));

  await page.goto(`${origin}/app/evaluations/${partialAssessment}`);
  await page.getByRole("heading", { name: "Importer des copies (scan ou photos)" }).waitFor();
  await upload(page, "E1-S3-series-E.jpg");
  await page.getByText("Vérifications nécessaires").waitFor({ timeout: 60_000 });
  await page.getByText(/1 copie à vérifier/).waitFor();
  await page.getByText("Page 1 : difficile à lire (floue).").waitFor();
  await page.getByText(/Qualité de l’image insuffisante/).waitFor();
  assert.equal(await page.getByTestId("scan-legibility-0-1").textContent(), "Partiellement lisible");
  assert.equal(await page.getByTestId("scan-legibility-0-4").textContent(), "Illisible");
  await page.getByText("Barré par l’élève (non pris en compte) : x² + 5²").waitFor();
  await page.getByText(/Question 2 — Développer B = \(x \+ 5\)²/).waitFor();
  assert.equal(stack.supabase.storedObjects().size, 0, "the temporary file is removed after the reading");
  await shot(page, "scan-1-review");
  await page.getByRole("button", { name: "J’ai vérifié — importer cette copie" }).click();
  await page.getByText("Importée", { exact: true }).waitFor();

  const lucas = stack.ids.studentIds.get("lucas-bernard")!;
  const stored = (
    await stack.db.query<{ position: number; response_text: string; source: string; legibility: string; transcription_verified: boolean }>(
      `select q.position, r.response_text, r.source, r.legibility, r.transcription_verified
       from public.student_responses r join public.assessment_questions q on q.id = r.question_id
       where r.assessment_id = $1 and r.student_id = $2 order by q.position`,
      [partialAssessment, lucas],
    )
  ).rows;
  assert.deepEqual(
    stored.map((row) => [row.position, row.response_text, row.source, row.legibility, row.transcription_verified]),
    [
      [1, "A = 3x + 12", "scan", "lisible", true],
      [2, "B = x² + [illisible]", "scan", "partielle", true],
      [3, "2/3 + 1/4 = 8/12 + 3/12 = 11/12", "scan", "lisible", true],
      [4, "4x = 13 + 7 = 20 ; x = 5", "scan", "lisible", true],
      [5, "[illisible]", "scan", "illisible", true],
    ],
  );

  // The copy, then its analysis, question by question.
  await page.reload();
  await openCopy(page, "Lucas Bernard");
  assert.match((await page.getByTestId("provenance-2").textContent()) ?? "", /Lu sur la copie · Partiellement lisible · vérifié par vous/);
  await page.getByRole("button", { name: "Analyser cette copie" }).click();
  await page.getByText(/preuves insuffisantes/).first().waitFor({ timeout: 60_000 });
  assert.match((await page.getByTestId("outcome-2").textContent()) ?? "", /Preuves insuffisantes/);
  assert.match((await page.getByTestId("outcome-5").textContent()) ?? "", /Passage manuscrit insuffisamment lisible pour conclure/);
  assert.match((await page.getByTestId("outcome-1").textContent()) ?? "", /Aucune erreur observée/);
  await shot(page, "scan-2-outcomes");
  const [run] = (
    await stack.db.query<{ status: string; outcomes: Array<{ outcome: string }> }>(
      "select status, question_outcomes as outcomes from public.ai_analysis_runs where assessment_id = $1 and student_id = $2 and superseded_at is null",
      [partialAssessment, lucas],
    )
  ).rows;
  assert.equal(run.status, "no_evidence", "no finding was recorded");
  assert.deepEqual(run.outcomes.map((item) => item.outcome), ["no_error_observed", "insufficient_evidence", "no_error_observed", "no_error_observed", "illegible"]);
  const recommendations = await stack.db.query("select 1 from public.pedagogical_recommendations where assessment_id = $1", [partialAssessment]);
  assert.equal(recommendations.rows.length, 0);
  assert.deepEqual(errors, []);
});

test("a clean photo is imported automatically but stays an unverified reading until the teacher checks it", async () => {
  const { page, errors } = await teacherPage();
  nextReading = (request) =>
    reading(request, [
      copy(request, [
        response("Q01", "ecrite", "A = 3x + 12", "2"),
        response("Q02", "ecrite", "B = x² + 25", "0", { crossedOut: "x² + 5²" }),
        response("Q03", "ecrite", "2/3 + 1/4 = 8/12 + 3/12 = 11/12", "2"),
        response("Q04", "ecrite", "4x = 13 + 7 = 20 ; x = 5", "2"),
        response("Q05", "ecrite", "C = (x − 3)²", "0"),
      ]),
    ]);
  const ids = await questionIds(cleanAssessment);
  const misconception = (questionId: string, evidenceExcerpt: string) => ({
    assessmentId: cleanAssessment, questionId, nodeCode: "MATH.ALG.IDENTITES", errorType: "concept",
    difficulty: "Développer ou factoriser avec les identités remarquables",
    evidenceExcerpt, explanation: "Le carré d’une somme est écrit comme la somme des carrés.",
    recommendedAction: "Faire développer (a+b)(a+b) terme à terme puis comparer.", catalogueErrorCode: "",
  });
  analyses.set(cleanAssessment, (input) => ({
    status: "errors_found",
    insufficientReason: "",
    errors: [misconception(ids[1], "x² + 25"), misconception(ids[4], "(x − 3)²")],
    questionOutcomes: input.questions.map((question, index) => ({
      questionId: question.questionId,
      outcome: index === 1 || index === 4 ? "error" : "no_error_observed",
      observedExcerpt: index === 1 ? "x² + 25" : "",
      note: "",
    })),
  }));

  await page.goto(`${origin}/app/evaluations/${cleanAssessment}`);
  await upload(page, "E1-S3-series-A.jpg");
  await page.getByText(/1 copie importée automatiquement · aucune vérification restante/).waitFor({ timeout: 60_000 });
  await page.reload();
  await openCopy(page, "Lucas Bernard");
  assert.match((await page.getByTestId("provenance-2").textContent()) ?? "", /Lu sur la copie · Lisible · lecture non vérifiée/);
  await page.getByRole("button", { name: "Analyser cette copie" }).click();
  await page.getByText(/1 hypothèse\(s\) fondée\(s\) sur des extraits de la copie/).waitFor({ timeout: 60_000 });
  assert.match((await page.getByTestId("outcome-2").textContent()) ?? "", /Erreur observée \(hypothèse à examiner\) · extrait « x² \+ 25 »/);
  assert.match((await page.getByTestId("outcome-5").textContent()) ?? "", /Erreur observée/);
  const lucas = stack.ids.studentIds.get("lucas-bernard")!;
  const confidence = async () =>
    (await stack.db.query<{ confidence: string; evidence: Array<{ excerpt: string }> }>(
      "select confidence, evidence from public.pedagogical_recommendations where assessment_id = $1 and student_id = $2 and superseded_at is null",
      [cleanAssessment, lucas],
    )).rows;
  const first = await confidence();
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].evidence.map((item) => item.excerpt).sort(), ["(x − 3)²", "x² + 25"]);
  assert.equal(first[0].confidence, "moderee", "two occurrences in one unverified copy: never more than modérée");

  // The teacher confirms the reading: the analysis that used it is replaced.
  await page.getByRole("button", { name: "J’ai vérifié : la transcription est conforme à la copie" }).click();
  await page.getByText(/Transcription confirmée telle quelle/).waitFor();
  await page.getByText("Copie non analysée depuis la dernière saisie").waitFor();
  assert.match((await page.getByTestId("provenance-2").textContent()) ?? "", /vérifié par vous/);
  assert.equal((await confidence()).length, 0, "the previous hypothesis is superseded");
  await page.getByRole("button", { name: "Analyser cette copie" }).click();
  await page.getByText(/1 hypothèse\(s\) fondée\(s\) sur des extraits de la copie/).waitFor({ timeout: 60_000 });
  assert.equal((await confidence())[0].confidence, "moderee");
  await shot(page, "scan-3-clean");
  assert.deepEqual(errors, []);
});

test("unusable photos, documents that are not copies and an exhausted credit fail cleanly", async () => {
  const { page, errors } = await teacherPage();
  await page.goto(`${origin}/app/evaluations/${failuresAssessment}`);
  const calls = stack.model.calls.length;

  await upload(page, "FM-blur.jpg");
  await page.getByText(/Photo 1 : trop floue pour être lue de façon fiable/).waitFor();
  await upload(page, "FM-dark.jpg");
  await page.getByText(/Photo 1 : beaucoup trop sombre/).waitFor();
  assert.equal(stack.model.calls.length, calls, "a refused photo never reaches the reader");

  nextReading = (request) => reading(request, [], "inutilisable", ["pas_une_copie"]);
  await upload(page, "FM-not-a-copy.jpg");
  await page.getByText("Aucune copie d’élève n’a été reconnue dans ce document : rien n’a été importé.").waitFor({ timeout: 60_000 });
  await page.getByText(/ne ressemble pas à une copie d’élève/).first().waitFor();

  nextReading = () => ({ __status: 429, __body: { error: { type: "insufficient_quota", code: "credit_balance_exhausted", message: "fictional" } } });
  await upload(page, "E1-S2-B.jpg");
  await page.getByText(/Le crédit du fournisseur d’IA \(OpenAI\) est épuisé : le service de lecture des copies ne peut pas fonctionner/).waitFor({ timeout: 60_000 });

  const before = stack.model.calls.length;
  nextReading = () => ({ __status: 503, __body: {} });
  await upload(page, "E1-S2-B.jpg");
  await page.getByText(/Le service de lecture des copies est injoignable ou en panne pour le moment\. Aucune copie n’a été importée\./).waitFor({ timeout: 90_000 });
  assert.equal(stack.model.calls.length - before, 3, "a provider outage is retried, within the time budget");

  const rows = await stack.db.query("select 1 from public.student_responses where assessment_id = $1", [failuresAssessment]);
  assert.equal(rows.rows.length, 0, "nothing was written for any failed import");
  assert.equal(stack.supabase.storedObjects().size, 0, "no temporary file left behind");
  await page.getByLabel("PDF ou photos des copies").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("pas une copie") });
  await page.getByText("Choisissez soit un PDF, soit une ou plusieurs photos (JPEG, PNG) des pages, dans l’ordre.").waitFor();
  assert.deepEqual(errors, []);
});
