"use client";

import { createClient } from "@supabase/supabase-js";
import { useMemo, useRef, useState } from "react";
import {
  confirmScanCopyAction,
  prepareScanUploadAction,
  processScanImportAction,
} from "@/app/(teacher)/app/scan-actions";
import type { ScanReviewCopy } from "@/lib/scan-import-core";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { Input, Label } from "@/components/ui/input";

type ReviewState = ScanReviewCopy & { saving?: boolean; saved?: boolean; error?: string | null };

function uploadClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function ScanStackImport({
  assessmentId,
  students,
  onImported,
}: {
  assessmentId: string;
  students: { id: string; name: string }[];
  onImported?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const client = useMemo(uploadClient, []);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [review, setReview] = useState<ReviewState[]>([]);
  const [unassignedPages, setUnassignedPages] = useState<number[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function processFile(file: File) {
    setError(null);
    setImported(null);
    setReview([]);
    setWarnings([]);
    setUnassignedPages([]);
    if (!client) {
      setError("Supabase n’est pas configuré sur cet environnement.");
      return;
    }
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("Choisissez un fichier PDF.");
      return;
    }

    setBusy(true);
    try {
      setProgress("Préparation de l’import…");
      const prepared = await prepareScanUploadAction(
        assessmentId,
        file.name,
        file.size,
      );
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }

      setProgress("Envoi sécurisé du PDF…");
      const upload = await client.storage
        .from(prepared.bucket)
        .uploadToSignedUrl(prepared.path, prepared.token, file, {
          contentType: "application/pdf",
          cacheControl: "0",
        });
      if (upload.error) {
        setError("Le PDF n’a pas pu être envoyé au stockage temporaire.");
        return;
      }

      setProgress("FOCUS sépare les copies et lit les écritures…");
      const result = await processScanImportAction(assessmentId, prepared.path);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setImported(result.imported);
      setReview(result.review);
      setWarnings(result.warnings);
      setUnassignedPages(result.unassignedPages);
      if (result.imported > 0) onImported?.();
    } catch {
      setError("L’import du PDF a échoué. Réessayez.");
    } finally {
      setBusy(false);
      setProgress("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function patchReview(index: number, patch: Partial<ReviewState>) {
    setReview((current) =>
      current.map((copy, i) => (i === index ? { ...copy, ...patch } : copy)),
    );
  }

  async function confirm(index: number) {
    const copy = review[index];
    if (!copy || copy.saved || copy.saving) return;
    if (!copy.studentId) {
      patchReview(index, { error: "Choisissez d’abord l’élève." });
      return;
    }
    patchReview(index, { saving: true, error: null });
    const result = await confirmScanCopyAction(assessmentId, copy);
    if (!result.ok) {
      patchReview(index, { saving: false, error: result.error });
      return;
    }
    patchReview(index, { saving: false, saved: true, error: null });
    setImported((value) => (value ?? 0) + 1);
    onImported?.();
  }

  const pending = review.filter((copy) => !copy.saved).length;

  return (
    <section
      id="scan-import"
      aria-labelledby="scan-import-title"
      className="scroll-mt-6 rounded-[var(--radius-lg)] border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2 id="scan-import-title" className="text-[17px] font-semibold text-ink">
            Importer une pile de copies scannées
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Scannez toute la pile en un seul PDF. FOCUS tente de séparer les
            élèves, lire nom, note, réponses et annotations, puis n’envoie en
            vérification que les cas incertains.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Traitement en cours…" : "Importer le PDF"}
        </Button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void processFile(file);
          }}
        />
      </div>

      <p className="mt-3 text-xs text-muted">
        PDF temporaire privé, 50 Mo maximum. Le fichier est supprimé du stockage
        FOCUS après extraction ; seules les données reconnues et confirmées sont
        conservées dans l’évaluation.
      </p>

      {progress && (
        <div className="mt-4">
          <Feedback tone="info">{progress}</Feedback>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Feedback tone="error">{error}</Feedback>
        </div>
      )}

      {imported !== null && (
        <div className="mt-4">
          <Feedback tone={pending ? "info" : "success"}>
            {imported} copie{imported > 1 ? "s" : ""} importée
            {imported > 1 ? "s" : ""} automatiquement
            {pending
              ? ` · ${pending} copie${pending > 1 ? "s" : ""} à confirmer`
              : " · aucune confirmation restante"}.
          </Feedback>
        </div>
      )}

      {(warnings.length > 0 || unassignedPages.length > 0) && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-border bg-paper p-4 text-sm text-ink-soft">
          {unassignedPages.length > 0 && (
            <p>
              Pages non rattachées : {unassignedPages.join(", ")}. Elles ne sont
              enregistrées pour aucun élève.
            </p>
          )}
          {warnings.map((warning, index) => (
            <p key={index} className={index || unassignedPages.length ? "mt-2" : ""}>
              {warning}
            </p>
          ))}
        </div>
      )}

      {review.length > 0 && (
        <div className="mt-5 space-y-4">
          <h3 className="text-sm font-semibold text-ink">
            Vérifications nécessaires
          </h3>
          {review.map((copy, index) => (
            <article
              key={`${copy.startPage}-${copy.endPage}-${index}`}
              className="rounded-[var(--radius-md)] border border-border p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">
                    Pages {copy.startPage}
                    {copy.endPage !== copy.startPage ? `–${copy.endPage}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Lu sur la copie : {copy.studentNameRead || "nom illisible"} ·
                    note {copy.score === null ? "non détectée" : `${copy.score}/20`}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {copy.autoImportReason}
                  </p>
                </div>
                {copy.saved && (
                  <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-ink">
                    Importée
                  </span>
                )}
              </div>

              {!copy.saved && (
                <>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={`scan-student-${index}`}>Élève</Label>
                      <select
                        id={`scan-student-${index}`}
                        className="h-10 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm"
                        value={copy.studentId ?? ""}
                        onChange={(event) =>
                          patchReview(index, {
                            studentId: event.target.value || null,
                            error: null,
                          })
                        }
                      >
                        <option value="">Choisir l’élève</option>
                        {students.map((student) => (
                          <option key={student.id} value={student.id}>
                            {student.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor={`scan-score-${index}`}>Note sur 20</Label>
                      <Input
                        id={`scan-score-${index}`}
                        inputMode="decimal"
                        placeholder="Laisser vide si aucune note"
                        value={copy.score ?? ""}
                        onChange={(event) => {
                          const value = event.target.value.trim().replace(",", ".");
                          patchReview(index, {
                            score: value === "" ? null : Number(value),
                            error: null,
                          });
                        }}
                      />
                    </div>
                  </div>

                  <details className="mt-4 rounded-lg bg-paper p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Vérifier la transcription ({copy.responses.length} question
                      {copy.responses.length > 1 ? "s" : ""})
                    </summary>
                    <div className="mt-3 space-y-3">
                      {copy.responses.map((response) => (
                        <div key={response.questionId} className="text-sm">
                          <p className="font-medium text-ink">
                            Réponse reconnue
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-ink-soft">
                            {response.responseText || "—"}
                          </p>
                          {(response.awardedPoints || response.teacherAnnotation) && (
                            <p className="mt-1 text-xs text-muted">
                              Points : {response.awardedPoints || "—"} · Annotation :
                              {" "}
                              {response.teacherAnnotation || "—"}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>

                  {copy.error && (
                    <p role="alert" className="mt-3 text-sm text-danger">
                      {copy.error}
                    </p>
                  )}
                  <div className="mt-4">
                    <Button
                      disabled={copy.saving}
                      onClick={() => void confirm(index)}
                    >
                      {copy.saving ? "Enregistrement…" : "Confirmer et importer"}
                    </Button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
