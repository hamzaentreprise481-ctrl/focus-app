"use client";

import { FormEvent, useState } from "react";
import { Bot, Send } from "lucide-react";
import { askStudentTutor } from "@/app/(student)/student/tuteur/actions";
import type { TutorMessage } from "@/lib/student-tutor";
import { Button } from "@/components/ui/button";

export function StudentTutor() {
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = question.trim();
    if (!value || pending) return;

    const history = messages.slice(-8);
    const next = [...messages, { role: "user" as const, content: value }];
    setMessages(next);
    setQuestion("");
    setError("");
    setPending(true);

    const result = await askStudentTutor({ question: value, history });
    if (result.ok) {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: result.reply },
      ]);
    } else {
      setError(result.error);
    }
    setPending(false);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white">
      <div className="border-b border-border bg-paper p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand">
            <Bot size={20} aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold">FOCUS Tutor</h2>
            <p className="text-sm text-ink-soft">
              Explique et aide à progresser. Ne modifie jamais vos notes.
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-[360px] space-y-4 p-5 sm:p-6">
        {!messages.length && (
          <div className="mx-auto max-w-xl py-14 text-center">
            <h3 className="text-lg font-semibold">Qu’est-ce qui bloque ?</h3>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              Posez une question sur un cours, une méthode ou une erreur. Le tuteur peut utiliser uniquement votre propre contexte FOCUS.
            </p>
          </div>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "ml-auto max-w-[82%] rounded-2xl bg-brand px-4 py-3 text-sm leading-6 text-white"
                : "max-w-[88%] whitespace-pre-wrap rounded-2xl bg-paper px-4 py-3 text-sm leading-6"
            }
          >
            {message.content}
          </div>
        ))}
        {pending && (
          <div className="max-w-[88%] rounded-2xl bg-paper px-4 py-3 text-sm text-ink-soft">
            FOCUS Tutor réfléchit…
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-watch-soft p-3 text-sm text-watch">
            {error}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-border p-4 sm:p-5">
        <label htmlFor="student-tutor-question" className="sr-only">
          Question
        </label>
        <div className="flex gap-3">
          <textarea
            id="student-tutor-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="Ex. Je ne comprends pas pourquoi 2(x + 3) = 2x + 6…"
            className="min-h-12 flex-1 rounded-xl border border-border-strong bg-white px-4 py-3 text-sm outline-none focus:border-brand"
          />
          <Button type="submit" disabled={pending || !question.trim()} aria-label="Envoyer la question">
            <Send size={17} aria-hidden="true" />
          </Button>
        </div>
      </form>
    </div>
  );
}
