// Work curriculum document → the catalogue imported by
// public.focus_import_curriculum_catalogue: typical errors, remediations
// (steps and check exercise), objectives, with their provenance and source
// locators. Only active nodes; entries keep the document's own identifiers.

import { createHash } from "node:crypto";
import type { CurriculumIssue } from "./types";

type Json = Record<string, unknown>;

export interface CatalogueObjective {
  code: string;
  text: string;
  provenance: string;
  sourceLocator: string | null;
}
export interface CatalogueError {
  code: string;
  description: string;
  evidenceRequired: string | null;
  alternativeExplanations: string[];
  frequencyStatus: string | null;
  provenance: string;
}
export interface CatalogueRemediation {
  code: string;
  title: string;
  steps: string[];
  durationMinutes: number | null;
  durationIsOfficial: boolean;
  check: { prompt: string | null; expectedAnswer: string | null; successCriterion: string | null };
  provenance: string;
  sourceLocator: string | null;
  targetErrorCodes: string[];
}
export interface CurriculumCatalogue {
  sourceUrl: string;
  nodes: Array<{
    code: string;
    objectives: CatalogueObjective[];
    errors: CatalogueError[];
    remediations: CatalogueRemediation[];
  }>;
}

const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

export function convertWorkCatalogue(doc: Json, origin = "work.json"): { catalogue: CurriculumCatalogue | null; issues: CurriculumIssue[]; counts: Record<string, number> } {
  const issues: CurriculumIssue[] = [];
  const program = isRecord(doc.program) ? doc.program : {};
  const sources = list(doc.sources).filter(isRecord);
  const primary = sources.find((source) => source.id === list(program.source_ids)[0]);
  const sourceUrl = text(primary?.url);
  if (!sourceUrl) issues.push({ severity: "error", code: "WORK_SOURCE", message: "Source principale introuvable.", at: `${origin}#program` });
  const shortTitle = new Map(
    sources.map((source) => [String(source.id), source.id === "S02" ? "Annexe du programme" : String(source.title ?? source.id).slice(0, 60)]),
  );
  const locator = (ref: unknown) => {
    if (!isRecord(ref)) return null;
    const parts = [shortTitle.get(String(ref.source_id)) ?? String(ref.source_id ?? ""), ref.pages ? `p. ${String(ref.pages)}` : "", text(ref.section) ?? ""].filter(Boolean);
    return parts.join(" — ").slice(0, 200) || null;
  };

  const nodes: CurriculumCatalogue["nodes"] = [];
  const counts = { nodes: 0, objectives: 0, errors: 0, remediations: 0 };
  for (const [index, node] of list(doc.nodes).entries()) {
    if (!isRecord(node) || node.active === false || typeof node.code !== "string") continue;
    const at = `${origin}#nodes[${index}] ${node.code}`;
    const objectives = list(node.objectives).filter(isRecord).map((objective) => ({
      code: String(objective.id),
      text: text(objective.text) ?? "",
      provenance: text(objective.provenance) ?? "non_renseignee",
      sourceLocator: locator(objective.source_ref),
    }));
    const errors = list(node.errors).filter(isRecord).map((error) => ({
      code: String(error.id),
      description: text(error.description) ?? "",
      evidenceRequired: text(error.evidence_required),
      alternativeExplanations: list(error.alternative_explanations).map((item) => text(item)).filter((item): item is string => !!item),
      frequencyStatus: text(error.frequency_status),
      provenance: text(error.provenance) ?? "non_renseignee",
    }));
    const errorCodes = new Set(errors.map((error) => error.code));
    const remediations = list(node.remediations).filter(isRecord).map((remediation) => {
      const check = isRecord(remediation.check) ? remediation.check : {};
      const targets = list(remediation.target_error_ids).map(String);
      for (const target of targets)
        if (!errorCodes.has(target))
          issues.push({ severity: "error", code: "WORK_CATALOGUE", message: `${String(remediation.id)} vise l’erreur ${target} absente de ${node.code}.`, at });
      const duration = remediation.duration_minutes_suggested;
      return {
        code: String(remediation.id),
        title: "",
        steps: list(remediation.steps).map((step) => text(step)).filter((step): step is string => !!step),
        durationMinutes: typeof duration === "number" && Number.isInteger(duration) ? duration : null,
        durationIsOfficial: remediation.duration_is_official === true,
        check: { prompt: text(check.prompt), expectedAnswer: text(check.expected_answer), successCriterion: text(check.success_criterion) },
        provenance: text(remediation.provenance) ?? "non_renseignee",
        sourceLocator: locator(list(remediation.source_refs)[0]),
        targetErrorCodes: targets,
      };
    });
    for (const entry of [...objectives, ...errors, ...remediations])
      if (!entry.code.startsWith(`${node.code}.`))
        issues.push({ severity: "error", code: "WORK_CATALOGUE", message: `${entry.code} n’appartient pas à ${node.code}.`, at });
    if (!objectives.length && !errors.length && !remediations.length) continue;
    counts.nodes++;
    counts.objectives += objectives.length;
    counts.errors += errors.length;
    counts.remediations += remediations.length;
    nodes.push({ code: node.code, objectives, errors, remediations });
  }
  nodes.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return {
    catalogue: sourceUrl && !issues.some((issue) => issue.severity === "error") ? { sourceUrl, nodes } : null,
    issues,
    counts,
  };
}

const TAG = "$focus_curriculum_catalogue$";

export function renderCatalogueMigration(catalogue: CurriculumCatalogue, generatedBy: string) {
  const json = JSON.stringify(catalogue);
  if (json.includes(TAG)) throw new Error("Le catalogue contient le délimiteur SQL réservé.");
  const counts = catalogue.nodes.reduce(
    (total, node) => ({
      objectives: total.objectives + node.objectives.length,
      errors: total.errors + node.errors.length,
      remediations: total.remediations + node.remediations.length,
    }),
    { objectives: 0, errors: 0, remediations: 0 },
  );
  return [
    `-- Curriculum catalogue generated by ${generatedBy.replace(/[\r\n]+/g, " ")} — do not edit by hand.`,
    `-- Source: ${catalogue.sourceUrl}`,
    `-- Content hash: ${createHash("sha256").update(json).digest("hex")}`,
    `-- ${catalogue.nodes.length} nodes: ${counts.objectives} objectives, ${counts.errors} typical errors, ${counts.remediations} remediations.`,
    `-- Editorial FOCUS proposals, none teacher-validated: see provenance columns. Idempotent.`,
    `select public.focus_import_curriculum_catalogue(`,
    `${TAG}${json}${TAG}::jsonb,`,
    `  false -- p_dry_run`,
    `);`,
    ``,
  ].join("\n");
}
