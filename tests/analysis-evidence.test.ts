// Observation, interpretation and recommendation stay distinct and
// traceable: every pattern carries the facts it rests on, a reliability
// level from sample size and consistency, and suggestions that point back
// to one of those facts. The classification itself is pinned.

import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultDataset } from "./fixtures/demo-dataset";
import { analyzeClass, analyzeStudent } from "../lib/analysis";
import type { EvaluationDataset, SkillLevel } from "../lib/types";

// Measured before the evidence and reliability layer was added; the layer
// must not move any student to another pattern or status.
const PINNED: Record<string, string> = {"lucas-bernard":"difficulte_persistante/attention","emma-leroy":"progression_recente/a_surveiller","adam-benali":"absence_sequence_importante/attention","lea-dubois":"baisse_reguliere/attention","rayan-el-amrani":"progression_recente/a_surveiller","theo-moreau":"resultats_irreguliers/a_surveiller","zoe-blanchard":"resultats_irreguliers/a_surveiller","hugo-lambert":"note_ponctuelle/a_surveiller","manon-lefevre":"leger_flechissement/a_surveiller","noah-perrin":"leger_flechissement/a_surveiller","chloe-girard":"stable/normal","nathan-petit":"stable/normal","sarah-cohen":"stable/normal","yanis-boumaaza":"stable/normal","camille-fontaine":"stable/normal","ines-dupont":"stable/normal","maxime-roux":"stable/normal","jade-simon":"stable/normal","enzo-faure":"stable/normal","lina-rousseau":"stable/normal","gabriel-muller":"stable/normal","anais-renault":"stable/normal","mathis-colin":"stable/normal","lena-vasseur":"stable/normal","ethan-marchand":"stable/normal","salome-guerin":"stable/normal","tom-barbier":"stable/normal","yasmine-chevalier":"stable/normal","arthur-meunier":"stable/normal","lou-ann-robin":"stable/normal","baptiste-noel":"stable/normal"};

function oneStudent(scores: (number | null)[], levels?: (SkillLevel | undefined)[], options: { absentAt?: number; important?: number } = {}): EvaluationDataset {
  return {
    classes: [{ id: "c", name: "Seconde 1", level: "Seconde", subject: "Mathématiques", teacher: "", studentIds: ["s"] }],
    students: [{ id: "s", name: "Alex Martin", classId: "c" }],
    skills: [{ id: "k", name: "Fractions" }, { id: "k2", name: "Équations" }],
    evaluations: scores.map((_, i) => ({
      id: `e${i}`,
      name: `Contrôle ${i + 1}`,
      date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      classId: "c",
      skillIds: levels ? ["k", "k2"] : [],
      important: options.important === i,
    })),
    rawGrades: scores.map((score, i) => ({
      studentId: "s",
      evaluationId: `e${i}`,
      score: options.absentAt === i ? null : score,
      absent: options.absentAt === i,
      ...(levels?.[i] ? { skillLevels: { k: levels[i], k2: "maitrise" as const } } : {}),
    })),
  };
}

test("the evidence layer leaves every fixture student's pattern and status unchanged", () => {
  for (const student of defaultDataset.students) {
    const analysis = analyzeStudent(student.id, defaultDataset);
    assert.equal(`${analysis.pattern}/${analysis.status}`, PINNED[student.id], student.id);
  }
});

test("every suggestion points back to an observation of the same analysis", () => {
  for (const student of defaultDataset.students) {
    const analysis = analyzeStudent(student.id, defaultDataset);
    assert.ok(analysis.evidence.length >= 1);
    for (const action of analysis.recommendedActions)
      assert.ok(analysis.evidence.some((item) => item.label === action.because), `${student.id}: ${action.label}`);
  }
});

test("a persistent difficulty cites the dated competency observations it rests on", () => {
  const analysis = analyzeStudent("s", oneStudent([12, 12, 12], ["en_cours", "fragile", "non_maitrise"]));
  assert.equal(analysis.pattern, "difficulte_persistante");
  const item = analysis.evidence.find((e) => e.label === "Fractions");
  assert.match(item!.detail, /Fragile \(« Contrôle 2 », 02\/10\/2026\) · Non maîtrisé \(« Contrôle 3 », 03\/10\/2026\)/);
  // Its reliability is that of the explicit competency observations.
  assert.equal(analysis.confidence, analysis.skillMasteries.find((m) => m.skillId === "k")!.confidence);
  assert.ok(analysis.recommendedActions.every((a) => a.because === "Fractions"));
  assert.equal(analysis.signalBasis, "3 observations de « Fractions »");
});

test("grades alone never produce a competency in the evidence", () => {
  const analysis = analyzeStudent("s", oneStudent([15, 13, 11, 9]));
  assert.equal(analysis.pattern, "baisse_reguliere");
  assert.deepEqual(analysis.evidence.map((e) => e.label), ["Notes renseignées", "Évolution"]);
  assert.match(analysis.evidence[0].detail, /^15 → 13 → 11 → 9 \(4 évaluations notées\)$/);
});

test("reliability follows sample size and consistency, never severity", () => {
  assert.equal(analyzeStudent("s", oneStudent([12])).confidence, "aucune");
  assert.equal(analyzeStudent("s", oneStudent([12])).pattern, "donnees_insuffisantes");
  assert.equal(analyzeStudent("s", oneStudent([12, 12])).confidence, "limitee");
  assert.equal(analyzeStudent("s", oneStudent([12, 12, 12])).confidence, "moderee");
  assert.equal(analyzeStudent("s", oneStudent([12, 12, 12, 12, 12])).confidence, "forte");
  // A steady decline over five results is consistent by construction.
  assert.equal(analyzeStudent("s", oneStudent([16, 14, 12, 10, 8])).confidence, "forte");
  // A recent change or a single result stays "to confirm" however long the history.
  const rising = analyzeStudent("s", oneStudent([8, 8, 8, 8, 8, 12, 14]));
  assert.equal(rising.pattern, "progression_recente");
  assert.equal(rising.confidence, "moderee");
  const isolated = analyzeStudent("s", oneStudent([13, 13, 13, 5, 13, 13]));
  assert.equal(isolated.pattern, "note_ponctuelle");
  assert.equal(isolated.confidence, "moderee");
  // An important absence is a fact whose consequence is not yet observed.
  const absent = analyzeStudent("s", oneStudent([12, 12, 12], undefined, { absentAt: 1, important: 1 }));
  assert.equal(absent.pattern, "absence_sequence_importante");
  assert.equal(absent.confidence, "limitee");
  assert.match(absent.evidence.find((e) => e.label === "Absence")!.detail, /« Contrôle 2 » \(02\/10\/2026\)/);
  assert.equal(absent.scoredCount, 2);
  assert.equal(absent.signalBasis, "2 évaluations notées");
});

test("blank, absent and competency-only results stay distinct in the evidence", () => {
  const data = oneStudent([null, 11, null], ["fragile", undefined, "fragile"], { absentAt: 2 });
  const analysis = analyzeStudent("s", data);
  assert.equal(analysis.scoredCount, 1);
  assert.match(analysis.evidence[0].detail, /^11 \(1 évaluation notée, 1 absence\)$/);
  // Only the first (competency-only) observation counts for Fractions: the
  // absent one records nothing.
  assert.equal(analysis.skillMasteries.find((m) => m.skillId === "k")!.testedCount, 1);
});

test("class groups separate what to examine, follow, value and complete, without ranking", () => {
  const overview = analyzeClass("seconde-3", defaultDataset);
  const ids = (list: { studentId: string }[]) => list.map((a) => a.studentId);
  assert.deepEqual(ids(overview.groups.toExamine).sort(), ["adam-benali", "lea-dubois", "lucas-bernard"]);
  assert.ok(ids(overview.groups.improving).includes("emma-leroy"));
  assert.ok(!ids(overview.groups.toFollow).includes("emma-leroy"), "a recent improvement is not a concern");
  for (const a of overview.groups.toExamine) assert.ok(!ids(overview.groups.toFollow).includes(a.studentId));
});

test("class competency signals come from explicit levels only, with their own reliability", () => {
  const gradesOnly = oneStudent([4, 5, 6]);
  assert.deepEqual(analyzeClass("c", gradesOnly).skillSignals, []);

  const data = oneStudent([12, 12, 12], ["en_cours", "fragile", "non_maitrise"]);
  const signal = analyzeClass("c", data).skillSignals.find((s) => s.skillId === "k")!;
  assert.deepEqual(
    { evaluationCount: signal.evaluationCount, documented: signal.documented, fragileNow: signal.fragileNow, persistent: signal.persistent, confidence: signal.confidence },
    { evaluationCount: 3, documented: 1, fragileNow: 1, persistent: 1, confidence: "forte" },
  );
  const once = analyzeClass("c", oneStudent([12], ["fragile"])).skillSignals.find((s) => s.skillId === "k")!;
  assert.equal(once.confidence, "limitee");
  // The most persistent difficulty comes first.
  assert.equal(analyzeClass("c", data).skillSignals[0].skillId, "k");
});

test("analysis stays fast on a school year of results", () => {
  const classes = Array.from({ length: 5 }, (_, c) => ({ id: `c${c}`, name: `C${c}`, level: "Seconde", subject: "Maths", teacher: "", studentIds: Array.from({ length: 32 }, (_, i) => `s${c}-${i}`) }));
  const levels: SkillLevel[] = ["maitrise", "en_cours", "fragile", "non_maitrise"];
  const skills = Array.from({ length: 30 }, (_, i) => ({ id: `k${i}`, name: `K${i}` }));
  const evaluations = classes.flatMap((c) => Array.from({ length: 30 }, (_, i) => ({ id: `${c.id}-e${i}`, name: `E${i}`, date: `2026-${String(9 + Math.floor(i / 8)).padStart(2, "0")}-${String(1 + (i % 8) * 3).padStart(2, "0")}`, classId: c.id, skillIds: skills.slice(i % 27, (i % 27) + 3).map((s) => s.id), important: false })));
  const data: EvaluationDataset = {
    classes,
    students: classes.flatMap((c) => c.studentIds.map((id) => ({ id, name: `Élève ${id}`, classId: c.id }))),
    skills,
    evaluations,
    rawGrades: evaluations.flatMap((e) => classes.find((c) => c.id === e.classId)!.studentIds.map((studentId, j) => ({ studentId, evaluationId: e.id, score: (j * 7 + e.id.length) % 21, absent: false, skillLevels: Object.fromEntries(e.skillIds.map((k, x) => [k, levels[(j + x) % 4]])) }))),
  };
  const started = performance.now();
  for (const c of classes) analyzeClass(c.id, data);
  assert.ok(performance.now() - started < 3000, `${Math.round(performance.now() - started)} ms`);
});
