"use server";

import { classifyProviderFailure, providerFailureMessage } from "@/lib/pedagogy/provider-errors";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { revalidatePath } from "next/cache";
import { authConfig } from "@/lib/auth/config";
import { createAuthClient, requireTeacher } from "@/lib/auth/server";
import { assessmentAccess, evidenceRows, ensureOk } from "@/lib/pedagogy/server";
import {
  MAX_SCAN_BYTES,
  SCAN_BUCKET,
  extractScanStack,
  normalizedResponses,
  scanCopyIssue,
  type ScanCopyCandidate,
  type ScanQuestion,
  type ScanReviewCopy,
  type ScanRosterStudent,
} from "@/lib/scan-import";
import { teacherCheckedLegibility, type ResponseLegibility, type ScanPageReport } from "@/lib/scan-import-core";

type Failure = { ok: false; error: string };

export type PrepareScanUploadResult =
  /** url/key: the project's public Storage endpoint and publishable key, read
   * at run time (the browser must not depend on build-time inlining). */
  | { ok: true; bucket: string; path: string; token: string; url: string; key: string }
  | Failure;

export type ProcessScanImportResult =
  | {
      ok: true;
      imported: number;
      review: ScanReviewCopy[];
      unassignedPages: number[];
      warnings: string[];
      /** What the reader reported about each page (quality, orientation). */
      pages: ScanPageReport[];
      /** The assessment's questions, to label each transcribed answer. */
      questions: Array<{ id: string; position: number; prompt: string }>;
    }
  | Failure;

function safePdfName(name: string) {
  return typeof name === "string" && name.toLowerCase().endsWith(".pdf");
}

async function context(assessmentId: string) {
  const teacher = await requireTeacher();
  const supabase = await createAuthClient();
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const access = await assessmentAccess(supabase, teacher.id, assessmentId);
  if (!access.editable) throw new Error("ASSESSMENT_NOT_EDITABLE");

  const enrollments = await supabase
    .from("student_enrollments")
    .select("student_id")
    .eq("class_id", access.assessment.class_id);
  ensureOk(enrollments.error, "Inscriptions élèves");
  const ids = [...new Set((enrollments.data ?? []).map((row: { student_id: string }) => row.student_id))];

  const profiles = ids.length
    ? await supabase.from("profiles").select("id,first_name,last_name").in("id", ids)
    : { data: [], error: null };
  ensureOk(profiles.error, "Profils élèves");
  const profileById = new Map(
    ((profiles.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>).map((row) => [
      row.id,
      [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Élève",
    ]),
  );
  const roster: ScanRosterStudent[] = ids.map((id) => ({
    id,
    name: profileById.get(id) ?? "Élève",
  }));

  const { questions, responses } = await evidenceRows(supabase, [assessmentId]);
  const results = await supabase
    .from("assessment_results")
    .select("student_id")
    .eq("assessment_id", assessmentId);
  ensureOk(results.error, "Résultats de l’évaluation");
  const existingStudentIds = new Set<string>([
    ...responses.map((response) => response.student_id),
    ...((results.data ?? []) as Array<{ student_id: string }>).map(
      (row) => row.student_id,
    ),
  ]);
  const scanQuestions: ScanQuestion[] = questions
    .sort((a, b) => a.position - b.position)
    .map((question) => ({
      id: question.id,
      position: question.position,
      prompt: question.prompt,
      maxPoints:
        question.max_points === null || question.max_points === undefined
          ? null
          : Number(question.max_points),
      // Never sent to the reader: only used to flag a "corrected" transcription.
      correctionText: question.correction_text,
    }));

  return {
    teacher,
    supabase,
    access,
    roster,
    questions: scanQuestions,
    existingStudentIds,
  };
}

function friendlyError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "SUPABASE_NOT_CONFIGURED")
    return "Le stockage des copies n’est pas configuré sur cet environnement.";
  if (code === "ASSESSMENT_NOT_EDITABLE")
    return "Seul le professeur qui a créé cette évaluation peut importer ses copies.";
  if (code === "OPENAI_API_KEY_MISSING")
    return "La reconnaissance des copies n’est pas configurée sur cet environnement.";
  if (code === "NO_ASSESSMENT_QUESTIONS")
    return "Ajoutez d’abord les questions et le corrigé de l’évaluation.";
  if (code === "EMPTY_ROSTER")
    return "Aucun élève n’est inscrit dans cette classe.";
  if (code === "SCAN_FILE_SIZE")
    return "Le fichier est vide ou dépasse 50 Mo.";
  if (code.startsWith("SCAN_MODEL_"))
    // Credit, configuration, provider or unusable reading: one precise sentence.
    return providerFailureMessage(classifyProviderFailure(code), "scan");
  return "L’import des copies n’a pas abouti. Réessayez.";
}

const LEGIBILITIES = new Set<ResponseLegibility>(["lisible", "partielle", "illisible", "vide", "absente"]);

/**
 * Saves a scanned copy with its provenance. An automatic import stays an
 * unverified machine reading; a copy the teacher confirmed in the review is
 * verified, and only the markers the teacher left in the text count.
 */
async function persistCopy(
  assessmentId: string,
  copy: ScanCopyCandidate,
  questions: ScanQuestion[],
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthClient>>>,
  clearScore = false,
  teacherChecked = false,
) {
  if (!copy.studentId) throw new Error("MISSING_STUDENT");
  const responses = normalizedResponses(copy, questions);
  const saved = await supabase.rpc("focus_import_scanned_copy", {
    p_assessment_id: assessmentId,
    p_student_id: copy.studentId,
    p_responses: responses.map((response) => {
      const read = LEGIBILITIES.has(response.legibility) ? response.legibility : "partielle";
      return {
        questionId: response.questionId,
        responseText: response.responseText,
        awardedPoints: response.awardedPoints,
        teacherAnnotation: response.teacherAnnotation,
        transcription: {
          source: "scan",
          legibility: teacherChecked ? teacherCheckedLegibility(read, response.responseText) : read,
          verified: teacherChecked,
        },
      };
    }),
    p_score: copy.score,
    p_clear_score: clearScore,
  });
  if (saved.error) {
    console.error("FOCUS scanned copy persistence failed", {
      code: saved.error.code,
      message: saved.error.message,
    });
    throw new Error(
      /point|score/i.test(saved.error.message)
        ? "SCAN_RESPONSE_SAVE_FAILED"
        : "SCAN_COPY_SAVE_FAILED",
    );
  }
}

export async function prepareScanUploadAction(
  assessmentId: string,
  filename: string,
  size: number,
): Promise<PrepareScanUploadResult> {
  try {
    if (!safePdfName(filename) || !Number.isFinite(size) || size <= 0 || size > MAX_SCAN_BYTES)
      return { ok: false, error: "Choisissez un PDF de 50 Mo maximum." };
    const { teacher, supabase } = await context(assessmentId);
    const path = `${teacher.id}/${assessmentId}/${randomUUID()}.pdf`;
    const signed = await supabase.storage.from(SCAN_BUCKET).createSignedUploadUrl(path);
    if (signed.error || !signed.data?.token)
      return {
        ok: false,
        error:
          "Le stockage temporaire des scans n’est pas encore configuré. Appliquez la migration FOCUS Scan sur l’environnement.",
      };
    const config = authConfig();
    if (!config) return { ok: false, error: friendlyError(new Error("SUPABASE_NOT_CONFIGURED")) };
    return { ok: true, bucket: SCAN_BUCKET, path, token: signed.data.token, url: config.url, key: config.key };
  } catch (error) {
    console.error("FOCUS scan upload preparation failed", error instanceof Error ? error.message : error);
    return { ok: false, error: friendlyError(error) };
  }
}

export async function processScanImportAction(
  assessmentId: string,
  path: string,
): Promise<ProcessScanImportResult> {
  let cleanup:
    | { supabase: NonNullable<Awaited<ReturnType<typeof createAuthClient>>>; path: string }
    | null = null;
  try {
    const { teacher, supabase, roster, questions, existingStudentIds } =
      await context(assessmentId);
    const prefix = `${teacher.id}/${assessmentId}/`;
    if (
      typeof path !== "string" ||
      !path.startsWith(prefix) ||
      !/^[0-9a-f-]+\.pdf$/i.test(path.slice(prefix.length))
    )
      return { ok: false, error: "Fichier de scan invalide." };

    cleanup = { supabase, path };
    const downloaded = await supabase.storage.from(SCAN_BUCKET).download(path);
    if (downloaded.error || !downloaded.data)
      return { ok: false, error: "Le PDF temporaire n’a pas pu être récupéré." };
    if (downloaded.data.size <= 0 || downloaded.data.size > MAX_SCAN_BYTES)
      return { ok: false, error: "Le PDF est vide ou dépasse 50 Mo." };

    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const signature = new TextDecoder().decode(bytes.slice(0, 5));
    if (signature !== "%PDF-")
      return { ok: false, error: "Le fichier envoyé n’est pas un PDF valide." };

    let actualPageCount: number;
    try {
      actualPageCount = (await PDFDocument.load(bytes)).getPageCount();
    } catch {
      return { ok: false, error: "Le PDF est corrompu, chiffré ou illisible." };
    }
    if (actualPageCount < 1)
      return { ok: false, error: "Le PDF ne contient aucune page." };

    const extraction = await extractScanStack(bytes, roster, questions);
    const pageCountMismatch = extraction.pageCount !== actualPageCount;
    const rosterIds = new Set(roster.map((student) => student.id));
    const seenStudents = new Set<string>();
    const pageOwners = new Map<number, number[]>();
    extraction.copies.forEach((copy, index) => {
      if (
        Number.isInteger(copy.startPage) &&
        Number.isInteger(copy.endPage) &&
        copy.startPage >= 1 &&
        copy.endPage >= copy.startPage &&
        copy.endPage <= actualPageCount
      ) {
        for (let page = copy.startPage; page <= copy.endPage; page += 1) {
          const owners = pageOwners.get(page) ?? [];
          owners.push(index);
          pageOwners.set(page, owners);
        }
      }
    });
    const overlappingCopies = new Set<number>();
    for (const owners of pageOwners.values())
      if (owners.length > 1) owners.forEach((index) => overlappingCopies.add(index));

    const review: ScanReviewCopy[] = [];
    let imported = 0;

    for (const [index, copy] of extraction.copies.entries()) {
      let issue = scanCopyIssue(copy, rosterIds, questions, extraction.pages);
      if (pageCountMismatch)
        issue = "Le nombre de pages détecté par l’IA ne correspond pas au PDF.";
      if (copy.endPage > actualPageCount)
        issue = "La plage de pages détectée dépasse le PDF.";
      if (overlappingCopies.has(index))
        issue = "Des pages ont été attribuées à plusieurs copies.";
      if (copy.studentId && seenStudents.has(copy.studentId))
        issue = "Plusieurs blocs du PDF semblent appartenir au même élève.";
      if (copy.studentId && existingStudentIds.has(copy.studentId))
        issue = "Une copie ou une note existe déjà pour cet élève : remplacement à confirmer.";
      if (copy.studentId) seenStudents.add(copy.studentId);

      if (issue) {
        review.push({
          ...copy,
          responses: normalizedResponses(copy, questions),
          autoImportReason: issue,
        });
        continue;
      }
      try {
        await persistCopy(assessmentId, copy, questions, supabase);
        imported += 1;
      } catch {
        review.push({
          ...copy,
          responses: normalizedResponses(copy, questions),
          autoImportReason:
            "FOCUS a reconnu cette copie mais n’a pas pu l’enregistrer automatiquement.",
        });
      }
    }

    const computedUnassignedPages = Array.from(
      { length: actualPageCount },
      (_, index) => index + 1,
    ).filter((page) => !(pageOwners.get(page)?.length));
    const unassignedPages = [
      ...new Set([...computedUnassignedPages, ...extraction.unassignedPages]),
    ]
      .filter((page) => page >= 1 && page <= actualPageCount)
      .sort((a, b) => a - b);
    const warnings = [
      ...(pageCountMismatch
        ? ["Le modèle n’a pas compté le même nombre de pages que le PDF : aucune copie concernée n’est auto-validée."]
        : []),
      ...extraction.warnings,
    ];

    revalidatePath(`/app/evaluations/${assessmentId}`);
    revalidatePath("/app", "layout");
    return {
      ok: true,
      imported,
      review,
      unassignedPages,
      warnings,
      pages: extraction.pages,
      questions: questions.map(({ id, position, prompt }) => ({ id, position, prompt })),
    };
  } catch (error) {
    console.error("FOCUS scan import failed", error instanceof Error ? error.message : error);
    return { ok: false, error: friendlyError(error) };
  } finally {
    if (cleanup) {
      const removed = await cleanup.supabase.storage.from(SCAN_BUCKET).remove([cleanup.path]);
      if (removed.error)
        console.error("FOCUS temporary scan cleanup failed", { path: cleanup.path, message: removed.error.message });
    }
  }
}

export async function confirmScanCopyAction(
  assessmentId: string,
  candidate: ScanCopyCandidate,
  overwrite = false,
): Promise<
  | { ok: true }
  | (Failure & { needsOverwrite?: boolean })
> {
  try {
    const { supabase, roster, questions, existingStudentIds } =
      await context(assessmentId);
    if (!candidate || typeof candidate !== "object")
      return { ok: false, error: "Copie invalide." };
    const rosterIds = new Set(roster.map((student) => student.id));
    if (!candidate.studentId || !rosterIds.has(candidate.studentId))
      return { ok: false, error: "Choisissez l’élève correspondant à cette copie." };
    if (
      candidate.score !== null &&
      (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 20)
    )
      return { ok: false, error: "La note doit être comprise entre 0 et 20." };
    if (existingStudentIds.has(candidate.studentId) && !overwrite)
      return {
        ok: false,
        needsOverwrite: true,
        error:
          "Une copie ou une note existe déjà pour cet élève. Confirmez explicitement son remplacement.",
      };

    if (!Array.isArray(candidate.responses) || candidate.responses.length > questions.length)
      return { ok: false, error: "Copie invalide." };
    await persistCopy(
      assessmentId,
      candidate,
      questions,
      supabase,
      overwrite && candidate.score === null,
      true,
    );
    revalidatePath(`/app/evaluations/${assessmentId}`);
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (error) {
    console.error("FOCUS scan confirmation failed", error instanceof Error ? error.message : error);
    return {
      ok: false,
      error:
        error instanceof Error && error.message === "SCAN_RESPONSE_SAVE_FAILED"
          ? "Les réponses reconnues ne sont pas compatibles avec le barème. Vérifiez les points."
          : "Cette copie n’a pas pu être enregistrée.",
    };
  }
}
