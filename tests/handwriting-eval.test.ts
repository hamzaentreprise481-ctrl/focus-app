// The handwriting evaluation harness checked offline, without any model: an
// ideal reader scores perfectly, a reader that fills destroyed passages with
// plausible content or keeps crossed-out work is caught on every such case,
// and the runner drives the production reader and analysis end to end with a
// scripted provider.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  aggregateHandwriting,
  aggregatePedagogicalTests,
  HANDWRITING_DIR,
  PEDAGOGICAL_TESTS,
  levenshtein,
  loadManifest,
  loadSpec,
  normalizeForScore,
  runHandwritingCopy,
  scoreHandwritingRecord,
  type ManifestCopy,
} from "./helpers/handwriting-eval";

const manifest = loadManifest();
const graded = manifest.copies.filter((copy) => copy.kind !== "failure_mode");

function record(copy: ManifestCopy, text: (q: ManifestCopy["questions"][number]) => string) {
  return {
    id: copy.id,
    scan: {
      ok: true,
      copies: [
        {
          student: copy.student ?? null,
          responses: copy.questions.map((q) => ({
            q: q.key,
            text: text(q),
            legibility: !q.hidden.length ? "lisible" : q.text.replace(/\[illisible\]/g, "").trim() ? "partielle" : "illisible",
            crossedOut: "",
          })),
        },
      ],
    },
    analysis: {
      ok: true,
      outcomes: copy.questions.map((q) => {
        const value = Array.isArray(q.expect.outcome) ? q.expect.outcome[0] : q.expect.outcome;
        return { q: q.key, outcome: value === "no_error" ? "no_error_observed" : value };
      }),
      errors: [],
    },
  };
}

test("the fixtures exist and every copy has a ground truth for every question", () => {
  const spec = loadSpec();
  assert.ok(graded.length >= 15, String(graded.length));
  for (const copy of manifest.copies) {
    assert.ok(existsSync(path.join(HANDWRITING_DIR, copy.pdf ?? copy.image!)), copy.id);
    if (copy.kind !== "failure_mode" || copy.questions.length)
      assert.deepEqual(copy.questions.map((q) => q.key), spec.assessments[copy.assessment].questions.map((q) => q.key), copy.id);
  }
  // Levels A to E of the same copy, the profiles (five, plus S6: notation
  // errors and a self-correction) and three assessments of one student.
  assert.deepEqual(manifest.copies.filter((c) => c.kind === "legibility_series").map((c) => c.level), ["A", "B", "C", "D", "E"]);
  assert.deepEqual([...new Set(graded.map((c) => c.student))].sort(), ["S1", "S2", "S3", "S4", "S5", "S6"]);
  assert.deepEqual(graded.filter((c) => c.student === "S3" && c.kind === "profile").map((c) => c.assessment).sort(), ["E1", "E2", "E3"]);
});

test("an ideal reader scores perfectly", () => {
  const scores = graded.map((copy) => scoreHandwritingRecord(record(copy, (q) => q.text) as never, copy));
  for (const score of scores) {
    assert.ok("questions" in score && score.questions);
    for (const q of score.questions!) {
      assert.equal(q.cer, 0, `${score.id} ${q.key}`);
      assert.deepEqual(q.hiddenLeaks, [], `${score.id} ${q.key}`);
      assert.deepEqual(q.crossedLeaks, []);
      assert.equal(q.outcomeOk, true, `${score.id} ${q.key}`);
      if (q.hiddenPresent) assert.equal(q.uncertaintyFlagged, true);
    }
  }
  const byLevel = aggregateHandwriting(scores);
  assert.equal(byLevel.E.hiddenLeaks, 0);
  assert.ok(byLevel.E.hiddenSpans >= 4, JSON.stringify(byLevel.E));
});

test("a reader that invents what was destroyed or keeps crossed-out work is caught every time", () => {
  for (const copy of graded) {
    const invented = scoreHandwritingRecord(
      record(copy, (q) => [q.hidden.length ? q.text.replace("[illisible]", q.hidden[0]) : q.text, ...q.crossedOut].join(" ; ")) as never,
      copy,
    );
    for (const q of invented.questions ?? []) {
      const truth = copy.questions.find((item) => item.key === q.key)!;
      if (truth.hidden.length) assert.ok(q.hiddenLeaks.length > 0, `${copy.id} ${q.key} invented content not detected`);
      if (truth.crossedOut.length) assert.ok(q.crossedLeaks.length > 0, `${copy.id} ${q.key} crossed-out work not detected`);
    }
  }
});

test("the five mission tests A–E: an ideal analysis is perfect, an alarmist one is caught as hallucinating", () => {
  const withQuestions = manifest.copies.filter((copy) => copy.questions.length);
  const ids = new Set(withQuestions.map((copy) => copy.id));
  for (const definition of Object.values(PEDAGOGICAL_TESTS))
    for (const id of definition.copies) assert.ok(ids.has(id), `${id} is a fixture with a ground truth`);
  const errorsFor = (copy: ManifestCopy, all: boolean) =>
    copy.questions
      .filter((q) => (all ? q.text.trim() : !Array.isArray(q.expect.outcome) && q.expect.outcome === "error"))
      .map((q) => ({ q: q.key, nodeCode: q.expect.notions?.[0] ?? "MATH.ALG.IDENTITES", errorType: q.expect.errorTypes?.[0] ?? "concept" }));
  const ideal = aggregatePedagogicalTests(
    withQuestions.map((copy) => {
      const base = record(copy, (q) => q.text);
      return scoreHandwritingRecord({ ...base, analysis: { ...base.analysis, errors: errorsFor(copy, false) } } as never, copy);
    }),
  );
  for (const [test, result] of Object.entries(ideal)) {
    assert.equal(result.copiesRead, result.copies, test);
    assert.equal(result.hallucinatedErrors, 0, test);
    assert.equal(result.missedErrors, 0, test);
    assert.equal(result.inventedUnderDestroyedOrAbsent, 0, test);
    assert.equal(result.outcomesCorrect, result.outcomes, test);
    assert.equal(result.diagnosesCorrect, result.diagnosesChecked, test);
  }
  assert.ok(ideal.B.diagnosesChecked >= 5 && ideal.D.diagnosesChecked >= 2, JSON.stringify(ideal.D));
  const alarmist = aggregatePedagogicalTests(
    withQuestions.map((copy) => {
      const base = record(copy, (q) => q.text);
      return scoreHandwritingRecord({ ...base, analysis: { ...base.analysis, errors: errorsFor(copy, true) } } as never, copy);
    }),
  );
  assert.ok(alarmist.A.hallucinatedErrors >= 5, "errors asserted on a perfect copy are counted as hallucinations");
});

test("scoring normalises notation, not content", () => {
  assert.equal(normalizeForScore("B = x^2 + 25"), normalizeForScore("B=x² +25"));
  assert.equal(normalizeForScore("x = [?7]"), "x=7");
  assert.notEqual(normalizeForScore("x = 4"), normalizeForScore("x = 5"));
  assert.equal(levenshtein("kitten", "sitting"), 3);
});

test("the runner drives the production reader and analysis (scripted provider, no model)", async () => {
  const copy = manifest.copies.find((item) => item.id === "E1-S3-series-E")!;
  const spec = loadSpec();
  const ideal = {
    pageCount: 1,
    isStudentWork: true,
    pages: [{ page: 1, orientation: 0, quality: "degradee", issues: ["floue"] }],
    copies: [
      {
        studentKey: "S003",
        studentNameRead: "Lucas Bernard",
        identificationConfidence: 0.99,
        groupingConfidence: 0.99,
        startPage: 1,
        endPage: 1,
        score: 11,
        scoreConfidence: 0.9,
        responses: copy.questions.map((q, index) => ({
          questionKey: `Q0${index + 1}`,
          status: q.hidden.length ? (q.text.replace(/\[illisible\]/g, "").trim() ? "partielle" : "illisible") : "ecrite",
          responseText: q.text.replace(/^\[illisible\]$/, ""),
          crossedOut: q.crossedOut.join(" ; "),
          awardedPoints: q.points ?? "",
          teacherAnnotation: "",
        })),
        warnings: [],
      },
    ],
    unassignedPages: [],
    warnings: [],
  };
  const answer = (body: unknown) =>
    new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(body) }] }], usage: { total_tokens: 5 } }));
  let call = 0;
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    call++;
    const body = JSON.parse(String(init?.body));
    if (body.text.format.name === "focus_scan_stack") return answer(ideal);
    const input = JSON.parse(body.input[1].content[0].text) as { questions: Array<{ questionId: string; responseText: string }> };
    return answer({
      status: "insufficient_evidence",
      insufficientReason: "Passages illisibles.",
      errors: [],
      questionOutcomes: input.questions.map((q) => ({ questionId: q.questionId, outcome: q.responseText.includes("[illisible]") ? "illegible" : "no_error_observed", observedExcerpt: "", note: "" })),
    });
  }) as typeof fetch;
  const curriculum = { aiCurriculum: [], mappable: {}, summaries: [], catalogue: {} };
  const result = (await runHandwritingCopy(copy, spec, curriculum, {
    apiKey: "fictional", scanModel: "m", scanEffort: "high", analysisModel: "m", analysisEffort: "low", input: "images", analyse: true, fetchImpl,
  })) as { scan: { ok: boolean; copies: Array<{ autoImportIssue: string | null }> }; analysis: { ok: boolean; outcomes: Array<{ outcome: string }> } };
  assert.equal(call, 2);
  assert.equal(result.scan.ok, true);
  assert.match(result.scan.copies[0].autoImportIssue!, /Qualité de l’image/);
  assert.equal(result.analysis.ok, true);
  assert.deepEqual(result.analysis.outcomes.map((o) => o.outcome), ["no_error_observed", "illegible", "no_error_observed", "no_error_observed", "illegible"]);
});
