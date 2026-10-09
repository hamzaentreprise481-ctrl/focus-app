"use client";

import { createClient } from "@supabase/supabase-js";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmScanCopyAction,
  prepareScanUploadAction,
  processScanImportAction,
} from "@/app/(teacher)/app/scan-actions";
import {
  LEGIBILITY_LABEL,
  MAX_SCAN_IMAGES,
  type ScanPageReport,
  type ScanReviewCopy,
} from "@/lib/scan-import-core";
import { photosToPdf } from "@/lib/scan-photos";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { Input, Label } from "@/components/ui/input";

type ReviewState = ScanReviewCopy & {
  saving?: boolean;
  saved?: boolean;
  error?: string | null;
  overwriteRequired?: boolean;
};

const PAGE_ISSUE_LABEL: Record<string, string> = {
  floue: "floue",
  sombre: "sombre",
  faible_contraste: "peu contrastée",
  coupee: "coupée",
  reflet: "avec un reflet",
  pas_une_copie: "ne ressemble pas à une copie",
};

const isPdf = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
const isImage = (file: File) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);

function pageWarnings(pages: ScanPageReport[]) {
  return pages
    .filter((page) => page.quality !== "bonne" || page.issues.length || page.orientation !== 0)
    .map((page) => {
      const issues = page.issues.map((issue) => PAGE_ISSUE_LABEL[issue] ?? issue);
      if (page.orientation !== 0) issues.push(`tournée de ${page.orientation}°`);
      const quality = page.quality === "inutilisable" ? "inutilisable" : page.quality === "degradee" ? "difficile à lire" : "lisible";
      return `Page ${page.page} : ${quality}${issues.length ? ` (${issues.join(", ")})` : ""}.`;
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [review, setReview] = useState<ReviewState[]>([]);
  const [questions, setQuestions] = useState<Array<{ id: string; position: number; prompt: string }>>([]);
  const [unassignedPages, setUnassignedPages] = useState<number[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function processFiles(files: File[]) {
    setError(null);
    setImported(null);
    setReview([]);
    setWarnings([]);
    setUnassignedPages([]);
    if (!files.length) return;
    const pdfs = files.filter(isPdf);
    const photos = files.filter(isImage);
    if (pdfs.length + photos.length !== files.length || (pdfs.length && photos.length) || pdfs.length > 1) {
      setError("Choisissez soit un PDF, soit une ou plusieurs photos (JPEG, PNG) des pages, dans l’ordre.");
      return;
    }
    if (photos.length > MAX_SCAN_IMAGES) {
      setError(`${MAX_SCAN_IMAGES} photos au maximum par import. Pour une pile plus longue, utilisez un PDF.`);
      return;
    }

    setBusy(true);
    const localWarnings: string[] = [];
    try {
      let upload: Blob = pdfs[0];
      let name = pdfs[0]?.name ?? "photos.pdf";
      if (photos.length) {
        setProgress("Préparation des photos (orientation, netteté, luminosité)…");
        try {
          const prepared = await photosToPdf(photos);
          upload = prepared.pdf;
          name = "photos.pdf";
          localWarnings.push(...prepared.warnings);
        } catch (failure) {
          const reason = (failure as { reason?: string }).reason;
          setError(
            reason ??
              ((failure as Error).message === "PHOTO_FORMAT"
                ? "Une photo n’a pas pu être ouverte par le navigateur (format HEIC ?). Exportez-la en JPEG puis réessayez."
                : "Les photos n’ont pas pu être préparées. Réessayez."),
          );
          return;
        }
      }

      setProgress("Préparation de l’import…");
      const prepared = await prepareScanUploadAction(assessmentId, name, upload.size);
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      const client = createClient(prepared.url, prepared.key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });

      setProgress(photos.length ? "Envoi sécurisé des photos…" : "Envoi sécurisé du PDF…");
      const sent = await client.storage
        .from(prepared.bucket)
        .uploadToSignedUrl(prepared.path, prepared.token, upload, { contentType: "application/pdf", cacheControl: "0" });
      if (sent.error) {
        setError("Le fichier n’a pas pu être envoyé au stockage temporaire.");
        return;
      }

      setProgress("FOCUS lit les copies : noms, notes, réponses et passages illisibles… (jusqu’à quelques minutes)");
      const result = await processScanImportAction(assessmentId, prepared.path);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setImported(result.imported);
      setReview(result.review);
      setQuestions(result.questions);
      setWarnings([...localWarnings, ...pageWarnings(result.pages), ...result.warnings]);
      setUnassignedPages(result.unassignedPages);
      if (result.imported > 0) onImported?.();
      if (result.imported > 0 && result.review.length === 0) router.refresh();
    } catch {
      setError("L’import a échoué. Réessayez.");
    } finally {
      setBusy(false);
      setProgress("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function patchReview(index: number, patch: Partial<ReviewState>) {
    setReview((current) => current.map((copy, i) => (i === index ? { ...copy, ...patch } : copy)));
  }

  function patchResponse(copyIndex: number, responseIndex: number, patch: Partial<ReviewState["responses"][number]>) {
    setReview((current) =>
      current.map((copy, index) =>
        index !== copyIndex
          ? copy
          : { ...copy, error: null, responses: copy.responses.map((response, i) => (i === responseIndex ? { ...response, ...patch } : response)) },
      ),
    );
  }

  async function confirm(index: number, overwrite = false) {
    const copy = review[index];
    if (!copy || copy.saved || copy.saving) return;
    if (!copy.studentId) {
      patchReview(index, { error: "Choisissez d’abord l’élève." });
      return;
    }
    patchReview(index, { saving: true, error: null });
    const result = await confirmScanCopyAction(assessmentId, copy, overwrite);
    if (!result.ok) {
      patchReview(index, { saving: false, error: result.error, overwriteRequired: result.needsOverwrite === true });
      return;
    }
    patchReview(index, { saving: false, saved: true, error: null, overwriteRequired: false });
    setImported((value) => (value ?? 0) + 1);
    onImported?.();
    if (review.filter((item, i) => i !== index && !item.saved).length === 0) router.refresh();
  }

  const pending = review.filter((copy) => !copy.saved).length;
  const questionOf = new Map(questions.map((question) => [question.id, question]));

  return (
    <section
      id="scan-import"
      aria-labelledby="scan-import-title"
      className="scroll-mt-6 rounded-[var(--radius-lg)] border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2 id="scan-import-title" className="text-[17px] font-semibold text-ink">
            Importer des copies (scan ou photos)
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Un PDF de toute la pile, ou les photos des pages prises au téléphone.
            FOCUS sépare les élèves, lit nom, note, réponses et annotations, et
            n’importe automatiquement que les copies lues sans aucune hésitation :
            un passage illisible est marqué <strong>[illisible]</strong>, jamais
            deviné, et la copie vous est soumise.
          </p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Traitement en cours…" : "Choisir le PDF ou les photos"}
        </Button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          multiple
          accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
          aria-label="PDF ou photos des copies"
          disabled={busy}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) void processFiles(files);
          }}
        />
      </div>

      <p className="mt-3 text-xs text-muted">
        Fichier temporaire privé (PDF de 50 Mo ou {MAX_SCAN_IMAGES} photos au maximum), supprimé
        du stockage FOCUS après la lecture ; seules les données reconnues et
        confirmées sont conservées dans l’évaluation. Photos : page entière, à
        plat, bien éclairée, sans ombre ni reflet.
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

      {imported === 0 && review.length === 0 && (
        <div className="mt-4">
          <Feedback tone="error">Aucune copie d’élève n’a été reconnue dans ce document : rien n’a été importé.</Feedback>
        </div>
      )}
      {imported !== null && (imported > 0 || review.length > 0) && (
        <div className="mt-4">
          <Feedback tone={pending ? "info" : "success"}>
            {imported} copie{imported > 1 ? "s" : ""} importée{imported > 1 ? "s" : ""} automatiquement
            {pending ? ` · ${pending} copie${pending > 1 ? "s" : ""} à vérifier` : " · aucune vérification restante"}.
          </Feedback>
        </div>
      )}

      {(warnings.length > 0 || unassignedPages.length > 0) && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-border bg-paper p-4 text-sm text-ink-soft" data-testid="scan-warnings">
          {unassignedPages.length > 0 && (
            <p>Pages non rattachées : {unassignedPages.join(", ")}. Elles ne sont enregistrées pour aucun élève.</p>
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
          <h3 className="text-sm font-semibold text-ink">Vérifications nécessaires</h3>
          {review.map((copy, index) => (
            <article key={`${copy.startPage}-${copy.endPage}-${index}`} className="rounded-[var(--radius-md)] border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">
                    Pages {copy.startPage}
                    {copy.endPage !== copy.startPage ? `–${copy.endPage}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Lu sur la copie : {copy.studentNameRead || "nom illisible"} · note{" "}
                    {copy.score === null ? "non détectée" : `${copy.score}/20`}
                  </p>
                  <p className="mt-1 text-xs text-watch">{copy.autoImportReason}</p>
                </div>
                {copy.saved && (
                  <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-ink">Importée</span>
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
                        onChange={(event) => patchReview(index, { studentId: event.target.value || null, error: null, overwriteRequired: false })}
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
                          patchReview(index, { score: value === "" ? null : Number(value), error: null });
                        }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg bg-paper p-3">
                    <p className="text-sm font-medium text-ink">Transcription à vérifier</p>
                    <p className="mt-1 text-xs text-ink-soft">
                      Comparez avec la copie papier. Remplacez <strong>[illisible]</strong> par ce que vous lisez, ou laissez-le :
                      FOCUS ne tirera aucune conclusion d’un passage non lu. <strong>[?…]</strong> signale une lecture incertaine.
                    </p>
                    <div className="mt-4 space-y-5">
                      {copy.responses.map((response, responseIndex) => {
                        const question = questionOf.get(response.questionId);
                        const uncertain = response.legibility !== "lisible" && response.legibility !== "vide";
                        return (
                          <div key={response.questionId} className="rounded-[var(--radius-sm)] border border-border bg-surface p-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <Label htmlFor={`scan-response-${index}-${responseIndex}`}>
                                Question {question?.position ?? responseIndex + 1}
                                {question ? ` — ${question.prompt.slice(0, 70)}${question.prompt.length > 70 ? "…" : ""}` : ""}
                              </Label>
                              <span
                                className={`text-xs font-medium ${uncertain ? "text-watch" : "text-ink-soft"}`}
                                data-testid={`scan-legibility-${index}-${responseIndex}`}
                              >
                                {LEGIBILITY_LABEL[response.legibility]}
                              </span>
                            </div>
                            <textarea
                              id={`scan-response-${index}-${responseIndex}`}
                              className="min-h-20 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft"
                              value={response.responseText}
                              placeholder={response.legibility === "absente" ? "Zone absente de l’image" : "Pas de réponse"}
                              onChange={(event) => patchResponse(index, responseIndex, { responseText: event.target.value })}
                            />
                            {response.crossedOut && (
                              <p className="mt-1 text-xs text-muted">Barré par l’élève (non pris en compte) : {response.crossedOut}</p>
                            )}
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <div>
                                <Label htmlFor={`scan-points-${index}-${responseIndex}`}>Points attribués</Label>
                                <Input
                                  id={`scan-points-${index}-${responseIndex}`}
                                  inputMode="decimal"
                                  value={response.awardedPoints}
                                  onChange={(event) => patchResponse(index, responseIndex, { awardedPoints: event.target.value })}
                                />
                              </div>
                              <div>
                                <Label htmlFor={`scan-annotation-${index}-${responseIndex}`}>Annotation du professeur</Label>
                                <Input
                                  id={`scan-annotation-${index}-${responseIndex}`}
                                  value={response.teacherAnnotation}
                                  onChange={(event) => patchResponse(index, responseIndex, { teacherAnnotation: event.target.value })}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {copy.error && (
                    <p role="alert" className="mt-3 text-sm text-danger">
                      {copy.error}
                    </p>
                  )}
                  <div className="mt-4">
                    <Button disabled={copy.saving} onClick={() => void confirm(index, copy.overwriteRequired === true)}>
                      {copy.saving
                        ? "Enregistrement…"
                        : copy.overwriteRequired
                          ? "Remplacer la copie existante"
                          : "J’ai vérifié — importer cette copie"}
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
