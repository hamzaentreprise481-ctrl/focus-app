"use client";

import { useRef, useState } from "react";
import { askStudentAssistant } from "@/app/(student)/student/assistant/actions";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { Label } from "@/components/ui/input";

type Message = { role: "user" | "assistant"; content: string; refused?: boolean };

const SUGGESTIONS = [
  "Je n’ai pas compris les équations.",
  "Explique-moi mon erreur.",
  "Donne-moi un exercice similaire.",
  "Pourquoi ma réponse est fausse ?",
  "Fais-moi réviser les puissances.",
  "Aide-moi sans me donner directement la réponse.",
];

export function StudentAssistant({
  assessments,
  configured,
  initialAssessmentId = "",
}: {
  assessments: Array<{ id: string; label: string }>;
  configured: boolean;
  initialAssessmentId?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [assessmentId, setAssessmentId] = useState(initialAssessmentId);
  const [full, setFull] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const lock = useRef(false);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: text }]);
    setQuestion("");
    try {
      const result = await askStudentAssistant({
        question: text,
        history,
        assessmentId: assessmentId || null,
        full,
      });
      if (result.ok)
        setMessages((current) => [...current, { role: "assistant", content: result.reply, refused: result.refused }]);
      else {
        setError(result.error);
        // Keep the question so the student can send it again.
        setMessages((current) => current.slice(0, -1));
        setQuestion(text);
      }
    } catch {
      setError("L’assistant n’a pas pu répondre. Vérifie ta connexion et réessaie.");
      setMessages((current) => current.slice(0, -1));
      setQuestion(text);
    } finally {
      lock.current = false;
      setPending(false);
      field.current?.focus();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-5">
        <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <Label htmlFor="assistant-assessment">Relier à une évaluation</Label>
          <select
            id="assistant-assessment"
            value={assessmentId}
            onChange={(event) => setAssessmentId(event.target.value)}
            disabled={pending}
            className="mt-1 h-10 w-full rounded-[var(--radius-sm)] border border-border-strong bg-white px-3 text-sm"
          >
            <option value="">Aucune (question générale)</option>
            {assessments.map((assessment) => (
              <option key={assessment.id} value={assessment.id}>
                {assessment.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs leading-5 text-ink-soft">
            L’assistant lit alors tes réponses enregistrées et les commentaires
            de ton professeur pour cette évaluation.
          </p>
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={full}
              onChange={(event) => setFull(event.target.checked)}
              disabled={pending}
              className="mt-1"
            />
            <span>
              Je veux la résolution complète
              <span className="block text-xs text-ink-soft">
                Sinon, l’assistant t’aide étape par étape sans donner
                directement le résultat.
              </span>
            </span>
          </label>
        </div>
        <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <p className="text-sm font-medium">Exemples de questions</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => {
                    setQuestion(suggestion);
                    field.current?.focus();
                  }}
                  disabled={pending || !configured}
                  className="rounded-full border border-border-strong px-3 py-1.5 text-left text-xs text-ink-soft hover:bg-paper disabled:opacity-50"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section aria-label="Conversation avec l’Assistant FOCUS" className="min-w-0 space-y-4">
        <div
          className="min-h-[320px] space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <p className="text-sm leading-6 text-ink-soft">
              Pose ta question : une notion à revoir, une erreur à comprendre,
              un exercice pour t’entraîner. L’assistant t’aide à comprendre ; il
              ne note pas et ne remplace pas ton professeur.
            </p>
          ) : (
            messages.map((message, index) => (
              <article
                key={index}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand p-4 text-sm leading-6 text-white shadow-sm"
                    : "max-w-[95%] rounded-2xl rounded-bl-md border border-border bg-paper/70 p-4 text-sm leading-6"
                }
              >
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  {message.role === "user" ? "Toi" : message.refused ? "Assistant FOCUS · règle" : "Assistant FOCUS"}
                </p>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </article>
            ))
          )}
          {pending && (
            <p role="status" className="text-sm text-ink-soft">
              L’assistant prépare sa réponse…
            </p>
          )}
        </div>
        {error && <Feedback tone="error">{error}</Feedback>}
        {!configured && (
          <Feedback tone="info">
            L’assistant n’est pas encore disponible sur ce serveur : aucune
            question ne peut être envoyée pour l’instant.
          </Feedback>
        )}
        <form onSubmit={send} className="space-y-3">
          <Label htmlFor="assistant-question">Ta question</Label>
          <textarea
            id="assistant-question"
            ref={field}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={1500}
            rows={3}
            required
            disabled={!configured}
            className="w-full rounded-xl border border-border-strong bg-white p-4 text-sm shadow-sm"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-soft">
              Aide pédagogique, pas une correction officielle. La conversation
              n’est pas enregistrée.
            </p>
            <div className="flex gap-2">
              {messages.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMessages([]);
                    setError(null);
                  }}
                  disabled={pending}
                >
                  Nouvelle conversation
                </Button>
              )}
              <Button type="submit" disabled={pending || !configured || !question.trim()}>
                {pending ? "Envoi…" : "Envoyer"}
              </Button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
