"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
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

type Failure = { ok: false; error: string };

export type PrepareScanUploadResult =
  | { ok: true; bucket: string; path: string; token: string }
  | Failure;

export type ProcessScanImportResult =
  | {
      ok: true;
      imported: number;
      review: ScanReviewCopy[];
      unassignedPages: number[];
      warnings: string[];
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

  const { questions } = await evidenceRows(supabase, [assessmentId]);
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
    }));

  return { teacher, supabase, access, roster, questions: scanQuestions };
}

function friendlyError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "ASSESSMENT_NOT_EDITABLE")
    return "Seul le professeur qui a créé cette évaluation peut importer ses copies.";
  if (code === "OPENAI_API_KEY_MISSING")
    return "La reconnaissance des copies n’est pas configurée sur cet environnement.";
  if (code === "NO_ASSESSMENT_QUESTIONS")
    return "Ajoutez d’abord les questions et le corrigé de l’évaluation.";
  if (code === "EMPTY_ROSTER")
    return "Aucun élève n’est inscrit dans cette classe.";
  if (code === "SCAN_FILE_SIZE")
    return "Le PDF est vide ou dépasse 50 Mo.";
  if (code === "SCAN_MODEL_TIMEOUT")
    return "La reconnaissance du PDF a dépassé le délai prévu. Réessayez avec un PDF plus court.";
  if (code.startsWith("SCAN_MODEL_"))
    return "La reconnaissance du PDF n’a pas abouti. Le fichier est conservé uniquement le temps du traitement ; réessayez.";
  return "L’import des copies n’a pas abouti. Réessayez.";
}

async function persistCopy(
  assessmentId: string,
  copy: ScanCopyCandidate,
  questions: ScanQuestion[],
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthClient>>>,
) {
  if (!copy.studentId) throw new Error("MISSING_STUDENT");
  const responses = normalizedResponses(copy, questions);
  const saved = await supabase.rpc("focus_import_scanned_copy", {
    p_assessment_id: assessmentId,
    p_student_id: copy.studentId,
    p_responses: responses.map((response) => ({
      questionId: response.questionId,
      responseText: response.responseText,
      awardedPoints: response.awardedPoints,
      teacherAnnotation: response.teacherAnnotation,
    })),
    p_score: copy.score,
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
    return { ok: true, bucket: SCAN_BUCKET, path, token: signed.data.token };
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
    const { teacher, supabase, roster, questions } = await context(assessmentId);
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
    const extraction = await extractScanStack(bytes, roster, questions);
    const rosterIds = new Set(roster.map((student) => student.id));
    const seenStudents = new Set<string>();
    const review: ScanReviewCopy[] = [];
    let imported = 0;

    for (const copy of extraction.copies) {
      let issue = scanCopyIssue(copy, rosterIds, questions);
      if (copy.studentId && seenStudents.has(copy.studentId))
        issue = "Plusieurs blocs du PDF semblent appartenir au même élève.";
      if (copy.studentId) seenStudents.add(copy.studentId);

      if (issue) {
        review.push({ ...copy, autoImportReason: issue });
        continue;
      }
      try {
        await persistCopy(assessmentId, copy, questions, supabase);
        imported += 1;
      } catch {
        review.push({
          ...copy,
          autoImportReason:
            "FOCUS a reconnu cette copie mais n’a pas pu l’enregistrer automatiquement.",
        });
      }
    }

    revalidatePath(`/app/evaluations/${assessmentId}`);
    revalidatePath("/app", "layout");
    return {
      ok: true,
      imported,
      review,
      unassignedPages: extraction.unassignedPages,
      warnings: extraction.warnings,
    };
  } catch (error) {
    console.error("FOCUS scan import failed", error instanceof Error ? error.message : error);
    return { ok: false, error: friendlyError(error) };
  } finally {
    if (cleanup) {
      const removed = await cleanup.supabase.storage.from(SCAN_BUCKET).remove([cleanup.path]);
      if (removed.error)
        console.error("FOCUS temporary scan cleanup failed", { path: cleanup.path, code: removed.error.code });
    }
  }
}

export async function confirmScanCopyAction(
  assessmentId: string,
  candidate: ScanCopyCandidate,
): Promise<{ ok: true } | Failure> {
  try {
    const { supabase, roster, questions } = await context(assessmentId);
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

    await persistCopy(assessmentId, candidate, questions, supabase);
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
