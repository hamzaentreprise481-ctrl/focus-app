import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildSchoolReport } from "../lib/reports/school-report";
import { renderSchoolPdf } from "../lib/reports/pdf";
import { defaultDataset } from "./fixtures/demo-dataset";
import type { EvaluationDataset } from "../lib/types";

const dataset: EvaluationDataset = {
  classes: [{ id: "c", name: "Première", subject: "Mathématiques", level: "Première", teacher: "Test", studentIds: ["zero", "absent", "skills", "missing"] }],
  students: ["zero", "absent", "skills", "missing"].map((id) => ({ id, name: id, classId: "c" })),
  skills: [{ id: "s", name: "Résoudre" }],
  evaluations: [{ id: "e", name: "Évaluation", classId: "c", date: "2026-09-25", skillIds: ["s"], important: false }],
  rawGrades: [
    { studentId: "zero", evaluationId: "e", score: 0, absent: false },
    { studentId: "absent", evaluationId: "e", score: null, absent: true },
    { studentId: "skills", evaluationId: "e", score: null, absent: false, skillLevels: { s: "fragile" } },
  ],
};
test("evaluation PDF content distinguishes zero, absence, competency-only and missing", () => {
  const report = buildSchoolReport(dataset, { kind: "evaluation", id: "e" });
  const text = report.sections.flatMap((s) => s.paragraphs).join("\n");
  assert.match(text, /zero · 0 \/ 20/);
  assert.match(text, /absent · Absent\(e\)/);
  assert.match(text, /skills · Compétences uniquement\nRésoudre : Fragile/);
  assert.match(text, /missing · Non renseigné/);
});

test("student report excludes other students and reflects corrected observations", () => {
  const updated = structuredClone(dataset);
  updated.rawGrades[0].score = 14;
  const report = buildSchoolReport(updated, { kind: "student", id: "zero" });
  const text = report.sections.flatMap((s) => s.paragraphs).join("\n");
  assert.match(text, /14 \/ 20/);
  assert.doesNotMatch(text, /Compétences uniquement|Absent\(e\)/);
  assert.throws(() => buildSchoolReport(dataset, { kind: "student", id: "foreign" }));
});

test("class reports include only their class and preserve unknown averages", () => {
  const data = structuredClone(dataset);
  data.students.push({ id: "outside", name: "Do not export", classId: "other" });
  data.evaluations.push({ ...data.evaluations[0], id: "other", classId: "other", name: "Private other class" });
  const text = JSON.stringify(buildSchoolReport(data, { kind: "class", id: "c" }));
  assert.doesNotMatch(text, /Do not export|Private other class/);
  assert.match(text, /missing · Aucune note/);
});

test("PDF output is readable, multipage, A4 and carries French document metadata", async () => {
  const report = buildSchoolReport(defaultDataset, { kind: "class", id: "seconde-3" });
  report.title += " · Éléonore Cœur";
  const bytes = await renderSchoolPdf(report, readFileSync("public/fonts/DejaVuSans.ttf"), new Date("2026-09-25T10:00:00Z"));
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2);
  assert.equal(doc.getTitle(), report.title);
  assert.equal(doc.getCreator(), "FOCUS Teacher");
  for (const page of doc.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 595.28) < 0.1);
    assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);
  }
});

test("student PDF: only teacher-confirmed observations, undecided AI hypotheses are only counted", async () => {
  const view = (status: "pending" | "validated", excerpt: string, note: string | null) => ({
    id: excerpt,
    assessmentId: "e",
    assessmentTitle: "Évaluation",
    assessmentDate: "2026-09-25",
    curriculumNodeCode: "MATH.ALG.DISTRIBUTIVITE",
    curriculumNodeTitle: "Développement par distributivité",
    difficulty: "Distribuer le facteur sur chaque terme",
    evidence: [{ questionId: "q", questionLabel: "Question 1", excerpt }],
    confidence: "limitee" as const,
    explanation: "Le facteur n'est appliqué qu'au premier terme.",
    recommendedAction: "Reprendre la distributivité avec un schéma en flèches.",
    sourceLocator: "",
    sourceUrl: "",
    prerequisites: [],
    competencies: [],
    status,
    decidedAt: status === "validated" ? "2026-09-26T08:00:00Z" : null,
    teacherNote: note,
    createdAt: "2026-09-25T10:00:00Z",
    catalogue: [],
  });
  const snapshot = {
    active: [view("validated", "3x+2", "Vu en classe"), view("pending", "5x+1", null)],
    history: [],
    notions: [],
    assessments: [],
    aiConfigured: true,
  };
  const report = buildSchoolReport(dataset, { kind: "student", id: "zero" }, { ok: true, snapshot });
  const section = report.sections.find((item) => item.title === "Observations sur copies confirmées par le professeur");
  assert.ok(section);
  const text = section.paragraphs.join("\n");
  assert.match(text, /Preuve \(Question 1\) : « 3x\+2 »/);
  assert.match(text, /Note du professeur : Vu en classe/);
  assert.match(text, /confiance limitée \(une seule observation\)/);
  assert.doesNotMatch(text, /5x\+1/);
  assert.match(text, /1 hypothèse\(s\) de l'analyse automatique attendent la décision du professeur/);

  const failed = buildSchoolReport(dataset, { kind: "student", id: "zero" }, { ok: false, error: "Service indisponible." });
  assert.deepEqual(failed.sections.find((item) => item.title.startsWith("Observations sur copies"))?.paragraphs, [
    "Suivi des copies non inclus : Service indisponible.",
  ]);
  // The PDF renders these characters and line breaks.
  const bytes = await renderSchoolPdf(report, readFileSync("public/fonts/DejaVuSans.ttf"));
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 1);
});
