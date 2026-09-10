"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Check, Save, Wand2 } from "lucide-react";
import { students } from "@/lib/data/students";
import { skills } from "@/lib/data/skills";
import { classes } from "@/lib/data/class-info";
import { SKILL_LEVEL_LABEL, suggestSkillLevelFromScore } from "@/lib/analysis";
import type { Evaluation, RawGrade, SkillLevel } from "@/lib/types";
import { useDemoData } from "@/lib/demo-data-context";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, formatScore } from "@/lib/utils";

const classStudents = students.filter((s) => s.classId === "seconde-3");
const LEVEL_OPTIONS: SkillLevel[] = [
  "maitrise",
  "en_cours",
  "fragile",
  "non_maitrise",
];

interface RowState {
  scoreInput: string;
  absent: boolean;
  levels: Partial<Record<string, SkillLevel>>;
}

function emptyRow(): RowState {
  return { scoreInput: "", absent: false, levels: {} };
}

function parseScoreInput(raw: string): {
  value: number | null;
  error: string | null;
} {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, error: null };
  const normalized = trimmed.replace(",", ".");
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) return { value: null, error: "Note invalide" };
  if (parsed < 0 || parsed > 20)
    return { value: null, error: "Doit être entre 0 et 20" };
  return { value: parsed, error: null };
}

export default function NouvelleEvaluationPage() {
  const { addEvaluation } = useDemoData();

  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [savedEvaluation, setSavedEvaluation] = useState<Evaluation | null>(
    null,
  );

  const toggleSkill = (skillId: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skillId)
        ? prev.filter((id) => id !== skillId)
        : [...prev, skillId],
    );
  };

  const rowFor = (studentId: string) => rows[studentId] ?? emptyRow();

  const setScore = (studentId: string, value: string) => {
    setRows((prev) => ({
      ...prev,
      [studentId]: { ...rowFor(studentId), scoreInput: value, absent: false },
    }));
  };

  const setAbsent = (studentId: string, absent: boolean) => {
    setRows((prev) => ({
      ...prev,
      [studentId]: {
        ...rowFor(studentId),
        absent,
        scoreInput: absent ? "" : rowFor(studentId).scoreInput,
        levels: absent ? {} : rowFor(studentId).levels,
      },
    }));
  };

  const setLevel = (studentId: string, skillId: string, level: SkillLevel) => {
    setRows((prev) => ({
      ...prev,
      [studentId]: {
        ...rowFor(studentId),
        levels: { ...rowFor(studentId).levels, [skillId]: level },
      },
    }));
  };

  const suggestLevelsFromScores = () => {
    setRows((prev) => {
      const next = { ...prev };
      classStudents.forEach((student) => {
        const row = next[student.id] ?? emptyRow();
        if (row.absent) return;
        const { value } = parseScoreInput(row.scoreInput);
        if (value === null) return;
        const levels = { ...row.levels };
        selectedSkills.forEach((skillId) => {
          if (!levels[skillId])
            levels[skillId] = suggestSkillLevelFromScore(value);
        });
        next[student.id] = { ...row, levels };
      });
      return next;
    });
  };

  const parsedRows = useMemo(() => {
    return classStudents.map((student) => {
      const row = rowFor(student.id);
      const parsed = row.absent
        ? { value: null, error: null }
        : parseScoreInput(row.scoreInput);
      return { student, row, parsed };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const gradedCount = parsedRows.filter(
    (r) => r.row.absent || r.parsed.value !== null,
  ).length;
  const hasErrors = parsedRows.some(
    (r) => !r.row.absent && r.parsed.error !== null,
  );

  const liveAverage = useMemo(() => {
    const values = parsedRows
      .filter((r) => !r.row.absent && r.parsed.value !== null)
      .map((r) => r.parsed.value as number);
    if (!values.length) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }, [parsedRows]);

  const readyToGrade =
    name.trim() !== "" && date !== "" && selectedSkills.length > 0;
  const canSave = readyToGrade && gradedCount > 0 && !hasErrors;

  const handleSave = () => {
    if (!canSave) return;
    const evaluationId = `demo-${Date.now()}`;
    const evaluation: Evaluation = {
      id: evaluationId,
      name: name.trim(),
      date,
      classId: "seconde-3",
      skillIds: selectedSkills,
      important: false,
    };
    const grades: RawGrade[] = parsedRows
      .filter((r) => r.row.absent || r.parsed.value !== null)
      .map(({ student, row, parsed }) => ({
        studentId: student.id,
        evaluationId,
        score: row.absent ? null : parsed.value,
        absent: row.absent,
        skillLevels: row.absent ? undefined : row.levels,
      }));
    addEvaluation(evaluation, grades);
    setSavedEvaluation(evaluation);
  };

  const resetForm = () => {
    setName("");
    setDate("");
    setSelectedSkills([]);
    setRows({});
    setSavedEvaluation(null);
  };

  if (savedEvaluation) {
    return (
      <div className="mx-auto max-w-lg space-y-6 py-10 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-normal-soft text-normal">
          <Check className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-ink">
            Évaluation enregistrée
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            « {savedEvaluation.name} » a été ajoutée. Les statistiques de la
            classe, le tableau de bord et les fiches élèves concernées sont à
            jour. La conservation sur cet appareil dépend de la disponibilité du
            stockage du navigateur.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <Link href={`/app/evaluations/${savedEvaluation.id}`}>
              Voir l&rsquo;évaluation
            </Link>
          </Button>
          <Button variant="secondary" onClick={resetForm}>
            Ajouter une autre évaluation
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/app/evaluations"
          className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" />
          Évaluations
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
          Nouvelle évaluation
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Utilisez uniquement des données fictives. Vos essais restent sur cet
          appareil ; ils ne sont pas synchronisés.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-5 rounded-[var(--radius-lg)] border border-border bg-surface p-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="eval-name">Nom de l&rsquo;évaluation</Label>
          <Input
            id="eval-name"
            placeholder="Ex. Contrôle — Probabilités"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="eval-date">Date</Label>
          <Input
            id="eval-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <Label>Classe</Label>
          <div className="flex h-10 items-center rounded-[var(--radius-sm)] border border-border-strong bg-paper px-3 text-sm text-ink-soft">
            {classes[0].name} · {classes[0].subject}
          </div>
        </div>
        <div className="sm:col-span-2">
          <Label>Compétences évaluées</Label>
          <div className="flex flex-wrap gap-2">
            {skills.map((skill) => {
              const active = selectedSkills.includes(skill.id);
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => toggleSkill(skill.id)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "border-brand bg-brand-soft text-brand-ink"
                      : "border-border-strong text-ink-soft hover:bg-paper",
                  )}
                >
                  {skill.name}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {readyToGrade && (
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">
                Saisie des notes
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                {gradedCount} / {classStudents.length} élève
                {classStudents.length > 1 ? "s" : ""} renseigné(s)
                {hasErrors && (
                  <span className="ml-2 text-attention">
                    · corrigez les notes invalides
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={suggestLevelsFromScores}
              >
                <Wand2 className="h-4 w-4" />
                Suggérer les niveaux depuis les notes
              </Button>
              <div className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-2 text-right">
                <p className="text-xs text-muted">Moyenne actuelle</p>
                <p className="text-lg font-semibold text-ink">
                  {liveAverage !== null
                    ? `${formatScore(liveAverage)} / 20`
                    : "—"}
                </p>
              </div>
            </div>
          </div>

          <div
            role="region"
            aria-label="Saisie des élèves, défilement horizontal et vertical"
            tabIndex={0}
            className="table-scroll rounded-[var(--radius-lg)] border border-border bg-surface"
          >
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Élève
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Absent
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Note / 20
                  </th>
                  {selectedSkills.map((skillId) => (
                    <th
                      scope="col"
                      key={skillId}
                      className="px-4 py-3 font-medium"
                    >
                      {skills.find((s) => s.id === skillId)?.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedRows.map(({ student, row, parsed }) => (
                  <tr
                    key={student.id}
                    className="border-b border-border last:border-0 align-top"
                  >
                    <th
                      scope="row"
                      className="px-5 py-2.5 text-left font-medium text-ink"
                    >
                      {student.name}
                    </th>
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={row.absent}
                        onChange={(e) =>
                          setAbsent(student.id, e.target.checked)
                        }
                        className="h-4 w-4 accent-brand"
                        aria-label={`${student.name} absent(e)`}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      {row.absent ? (
                        <span className="text-xs text-muted">Absent(e)</span>
                      ) : (
                        <>
                          <input
                            inputMode="decimal"
                            aria-label={`Note de ${student.name} sur 20`}
                            aria-invalid={!!parsed.error}
                            placeholder="—"
                            value={row.scoreInput}
                            onChange={(e) =>
                              setScore(student.id, e.target.value)
                            }
                            className={cn(
                              "h-8 w-20 rounded-[var(--radius-sm)] border bg-surface px-2 text-sm tabular-nums focus:outline-none focus:ring-2",
                              parsed.error
                                ? "border-attention focus:border-attention focus:ring-attention-soft"
                                : "border-border-strong focus:border-brand focus:ring-brand-soft",
                            )}
                          />
                          {parsed.error && (
                            <p className="mt-1 text-xs text-attention">
                              {parsed.error}
                            </p>
                          )}
                        </>
                      )}
                    </td>
                    {selectedSkills.map((skillId) => (
                      <td key={skillId} className="px-4 py-2.5">
                        {row.absent ? (
                          <span className="text-xs text-muted">—</span>
                        ) : (
                          <select
                            aria-label={`${skills.find((s) => s.id === skillId)?.name} — ${student.name}`}
                            value={row.levels[skillId] ?? ""}
                            onChange={(e) =>
                              setLevel(
                                student.id,
                                skillId,
                                e.target.value as SkillLevel,
                              )
                            }
                            className="h-8 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-sm text-ink-soft focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft"
                          >
                            <option value="">Non renseigné</option>
                            {LEVEL_OPTIONS.map((level) => (
                              <option key={level} value={level}>
                                {SKILL_LEVEL_LABEL[level]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex items-center justify-end gap-3">
            <Button variant="primary" onClick={handleSave} disabled={!canSave}>
              <Save className="h-4 w-4" />
              Enregistrer l&rsquo;évaluation
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
