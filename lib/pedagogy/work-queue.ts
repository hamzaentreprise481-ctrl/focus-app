// What the dashboard asks the teacher to do next, for one class. Pure: the
// counts come from focus_teacher_work_queue (evidence and analyses) and the
// class roster and absences from the school data already loaded.

import type { EvaluationDataset } from "@/lib/types";
import type { TeacherWorkQueue } from "@/lib/pedagogy/types";

export type WorkItem =
  | {
      kind: "review";
      studentId: string;
      studentName: string;
      evaluationId: string;
      evaluationName: string;
      count: number;
    }
  | {
      kind: "analyse";
      evaluationId: string;
      evaluationName: string;
      studentIds: string[];
    }
  | {
      kind: "subject";
      evaluationId: string;
      evaluationName: string;
    }
  | {
      kind: "copies";
      evaluationId: string;
      evaluationName: string;
      entered: number;
      expected: number;
      firstMissingStudentId: string;
    };

export interface ClassWorkItems {
  review: Extract<WorkItem, { kind: "review" }>[];
  analyse: Extract<WorkItem, { kind: "analyse" }>[];
  evidence: Extract<WorkItem, { kind: "subject" | "copies" }>[];
  /** At least one mathematics assessment of this class is in the queue. */
  tracked: boolean;
}

export function classWorkItems(queue: TeacherWorkQueue, classId: string, dataset: EvaluationDataset): ClassWorkItems {
  const byId = new Map(queue.assessments.map((row) => [row.assessmentId, row]));
  const classInfo = dataset.classes.find((item) => item.id === classId);
  const roster = classInfo?.studentIds ?? [];
  const names = new Map(dataset.students.map((student) => [student.id, student.name]));
  const evaluations = dataset.evaluations
    .filter((evaluation) => evaluation.classId === classId && byId.has(evaluation.id))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  const items: ClassWorkItems = { review: [], analyse: [], evidence: [], tracked: evaluations.length > 0 };
  for (const evaluation of evaluations) {
    const row = byId.get(evaluation.id)!;
    for (const pending of row.pendingReviews)
      items.review.push({
        kind: "review",
        studentId: pending.studentId,
        studentName: names.get(pending.studentId) ?? "Élève",
        evaluationId: evaluation.id,
        evaluationName: evaluation.name,
        count: pending.count,
      });
    if (row.needsAnalysisStudentIds.length)
      items.analyse.push({
        kind: "analyse",
        evaluationId: evaluation.id,
        evaluationName: evaluation.name,
        studentIds: row.needsAnalysisStudentIds,
      });
    if (row.questionCount === 0) {
      items.evidence.push({ kind: "subject", evaluationId: evaluation.id, evaluationName: evaluation.name });
      continue;
    }
    // Students marked absent have no copy to enter.
    const absent = new Set(
      dataset.rawGrades
        .filter((grade) => grade.evaluationId === evaluation.id && grade.absent)
        .map((grade) => grade.studentId),
    );
    const answered = new Set(row.answeredStudentIds);
    const expected = roster.filter((studentId) => !absent.has(studentId));
    const missing = expected.filter((studentId) => !answered.has(studentId));
    if (missing.length)
      items.evidence.push({
        kind: "copies",
        evaluationId: evaluation.id,
        evaluationName: evaluation.name,
        entered: expected.length - missing.length,
        expected: expected.length,
        firstMissingStudentId: missing[0],
      });
  }
  return items;
}
