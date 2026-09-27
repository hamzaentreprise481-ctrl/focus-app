import Link from "next/link";
import { ChevronRight, ClipboardList, FileSearch, UserCheck } from "lucide-react";
import type { ClassWorkItems } from "@/lib/pedagogy/work-queue";

const LIMIT = 4;

function Row({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <li>
      <Link href={href} className="group flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-paper">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{title}</span>
          <span className="mt-0.5 block text-xs text-ink-soft">{detail}</span>
        </span>
        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

function Group({
  id,
  icon: Icon,
  title,
  hint,
  total,
  children,
}: {
  id: string;
  icon: typeof UserCheck;
  title: string;
  hint: string;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-white">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
        <div>
          <h3 id={id} className="text-sm font-semibold">
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-ink-soft">{hint}</p>
        </div>
      </div>
      <ul aria-labelledby={id} className="divide-y divide-border">
        {children}
      </ul>
      {total > LIMIT && <p className="border-t border-border px-5 py-2.5 text-xs text-ink-soft">et {total - LIMIT} autre(s)</p>}
    </div>
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

/** The next pedagogical steps of the class, most decisive first. */
export function WorkQueue({ items, aiConfigured, error }: { items: ClassWorkItems | null; aiConfigured: boolean; error?: string }) {
  if (error)
    return (
      <section aria-labelledby="queue-title">
        <h2 id="queue-title" className="text-lg font-semibold">
          À traiter
        </h2>
        <p role="alert" className="mt-3 rounded-lg border border-attention/30 bg-attention-soft p-4 text-sm text-attention">
          {error}
        </p>
      </section>
    );
  if (!items?.tracked) return null;
  const empty = !items.review.length && !items.analyse.length && !items.evidence.length;
  return (
    <section aria-labelledby="queue-title">
      <h2 id="queue-title" className="text-lg font-semibold">
        À traiter
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Les copies de mathématiques de cette classe : ce qui attend votre regard, puis ce qui reste à saisir.
      </p>
      {empty ? (
        <p className="mt-5 rounded-xl border border-border bg-white p-5 text-sm text-ink-soft">
          Rien en attente : les copies saisies sont analysées et chaque hypothèse a reçu votre décision.
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-start gap-4">
          {items.review.length > 0 && (
            <Group
              id="queue-review"
              icon={UserCheck}
              title="Hypothèses IA à examiner"
              hint="Confirmez ou écartez chaque hypothèse ; rien n’entre dans le suivi sans votre décision."
              total={items.review.length}
            >
              {items.review.slice(0, LIMIT).map((item) => (
                <Row
                  key={`${item.evaluationId}:${item.studentId}`}
                  href={`/app/eleves/${item.studentId}#suivi-pedagogique`}
                  title={item.studentName}
                  detail={`${item.evaluationName} · ${plural(item.count, "hypothèse", "hypothèses")}`}
                />
              ))}
            </Group>
          )}
          {items.analyse.length > 0 && (
            <Group
              id="queue-analyse"
              icon={FileSearch}
              title="Copies saisies, pas encore analysées"
              hint={
                aiConfigured
                  ? "L’analyse compare chaque réponse au corrigé et aux notions visées."
                  : "L’analyse IA n’est pas configurée sur cet environnement."
              }
              total={items.analyse.length}
            >
              {items.analyse.slice(0, LIMIT).map((item) => (
                <Row
                  key={item.evaluationId}
                  href={`/app/evaluations/${item.evaluationId}?eleve=${item.studentIds[0]}#copies`}
                  title={item.evaluationName}
                  detail={plural(item.studentIds.length, "copie à analyser", "copies à analyser")}
                />
              ))}
            </Group>
          )}
          {items.evidence.length > 0 && (
            <Group
              id="queue-evidence"
              icon={ClipboardList}
              title="Sujets et copies à compléter"
              hint="Sans sujet ni réponse exacte, aucune analyse n’est possible."
              total={items.evidence.length}
            >
              {items.evidence.slice(0, LIMIT).map((item) =>
                item.kind === "subject" ? (
                  <Row
                    key={item.evaluationId}
                    href={`/app/evaluations/${item.evaluationId}#sujet`}
                    title={item.evaluationName}
                    detail="Sujet, questions et corrigé à ajouter"
                  />
                ) : (
                  <Row
                    key={item.evaluationId}
                    href={`/app/evaluations/${item.evaluationId}?eleve=${item.firstMissingStudentId}#copies`}
                    title={item.evaluationName}
                    detail={`${item.entered} copie(s) saisie(s) sur ${item.expected}`}
                  />
                ),
              )}
            </Group>
          )}
        </div>
      )}
    </section>
  );
}
