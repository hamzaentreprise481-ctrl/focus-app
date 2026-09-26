// Read-side of the curriculum knowledge base: turns the payload returned by
// public.focus_curriculum_graph into the summaries used by the pedagogical AI
// and the teacher views. Pure and deterministic: the same graph always yields
// the same summaries in the same order, which keeps analysis input hashes
// stable (and therefore re-analysis caching reliable).

import type { CurriculumNodeSummary } from "@/lib/pedagogy/types";
import {
  CURRICULUM_NODE_TYPES,
  CURRICULUM_RELATIONS,
  type CurriculumNodeType,
  type CurriculumRelation,
} from "./types";

export interface CurriculumGraphSource {
  id: string;
  subjectCode: string;
  levelCode: string;
  schoolYear: string;
  title: string;
  officialReference: string;
  sourceUrl: string;
}

export interface CurriculumGraphNode {
  id: string;
  sourceId: string;
  code: string;
  nodeType: CurriculumNodeType;
  title: string;
  description: string | null;
  sourceLocator: string;
  inScope: boolean;
}

export interface CurriculumGraphEdge {
  from: string;
  to: string;
  relation: CurriculumRelation;
}

export interface CurriculumGraphPayload {
  sources: CurriculumGraphSource[];
  nodes: CurriculumGraphNode[];
  edges: CurriculumGraphEdge[];
}

function compareCodes(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Graphe du programme invalide : ${label}.`);
  return value as Record<string, unknown>;
}
function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value)
    throw new Error(`Graphe du programme invalide : ${label}.`);
  return value;
}
function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value))
    throw new Error(`Graphe du programme invalide : ${label}.`);
  return value;
}

/** Strictly parses the RPC payload; throws instead of silently dropping data. */
export function parseCurriculumGraphPayload(raw: unknown): CurriculumGraphPayload {
  const payload = asRecord(raw, "réponse");
  const sources = asArray(payload.sources, "sources").map((item, index) => {
    const value = asRecord(item, `sources[${index}]`);
    return {
      id: asString(value.id, `sources[${index}].id`),
      subjectCode: asString(value.subjectCode, `sources[${index}].subjectCode`),
      levelCode: asString(value.levelCode, `sources[${index}].levelCode`),
      schoolYear: asString(value.schoolYear, `sources[${index}].schoolYear`),
      title: asString(value.title, `sources[${index}].title`),
      officialReference: asString(value.officialReference, `sources[${index}].officialReference`),
      sourceUrl: asString(value.sourceUrl, `sources[${index}].sourceUrl`),
    };
  });
  const nodes = asArray(payload.nodes, "nodes").map((item, index) => {
    const value = asRecord(item, `nodes[${index}]`);
    const nodeType = asString(value.nodeType, `nodes[${index}].nodeType`);
    if (!(CURRICULUM_NODE_TYPES as readonly string[]).includes(nodeType))
      throw new Error(`Graphe du programme invalide : type ${nodeType}.`);
    return {
      id: asString(value.id, `nodes[${index}].id`),
      sourceId: asString(value.sourceId, `nodes[${index}].sourceId`),
      code: asString(value.code, `nodes[${index}].code`),
      nodeType: nodeType as CurriculumNodeType,
      title: asString(value.title, `nodes[${index}].title`),
      description:
        typeof value.description === "string" && value.description
          ? value.description
          : null,
      sourceLocator: asString(value.sourceLocator, `nodes[${index}].sourceLocator`),
      inScope: value.inScope !== false,
    };
  });
  const edges = asArray(payload.edges, "edges").map((item, index) => {
    const value = asRecord(item, `edges[${index}]`);
    const relation = asString(value.relation, `edges[${index}].relation`);
    if (!(CURRICULUM_RELATIONS as readonly string[]).includes(relation))
      throw new Error(`Graphe du programme invalide : relation ${relation}.`);
    return {
      from: asString(value.from, `edges[${index}].from`),
      to: asString(value.to, `edges[${index}].to`),
      relation: relation as CurriculumRelation,
    };
  });
  return { sources, nodes, edges };
}

export interface CurriculumIndex {
  /** Sorted by code (code-point order), whatever order the database used. */
  summaries: CurriculumNodeSummary[];
  summaryByCode: Map<string, CurriculumNodeSummary>;
  nodeById: Map<string, CurriculumGraphNode>;
  nodeByCode: Map<string, CurriculumGraphNode>;
  /** Codes the AI may use as the main difficulty: in-scope notion nodes only. */
  mappableNotionIdsByCode: Map<string, string>;
}

export function buildCurriculumIndex(payload: CurriculumGraphPayload): CurriculumIndex {
  const sourceById = new Map(payload.sources.map((source) => [source.id, source]));
  const nodes = [...payload.nodes].sort((a, b) => compareCodes(a.code, b.code));
  const nodeByCode = new Map(nodes.map((node) => [node.code, node]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const prerequisites = new Map<string, Set<string>>();
  const competencies = new Map<string, Set<string>>();
  const supports = new Map<string, Set<string>>();
  const parents = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, value: string) => {
    const set = map.get(key) ?? new Set<string>();
    set.add(value);
    map.set(key, set);
  };

  for (const edge of payload.edges) {
    const from = nodeByCode.get(edge.from);
    const to = nodeByCode.get(edge.to);
    // Edges to nodes outside the payload (inactive, other subjects) are
    // ignored rather than exposed as dangling codes to the model.
    if (!from || !to) continue;
    if (edge.relation === "prerequisite_of") add(prerequisites, to.code, from.code);
    else if (edge.relation === "part_of") add(parents, from.code, to.code);
    else if (to.nodeType === "competency") add(competencies, from.code, to.code);
    else add(supports, from.code, to.code);
  }

  const sorted = (set: Set<string> | undefined) => [...(set ?? [])].sort(compareCodes);
  const summaries: CurriculumNodeSummary[] = nodes.map((node) => ({
    id: node.id,
    code: node.code,
    nodeType: node.nodeType,
    title: node.title,
    description: node.description,
    sourceLocator: node.sourceLocator,
    sourceUrl: sourceById.get(node.sourceId)?.sourceUrl ?? "",
    inScope: node.inScope,
    parents: sorted(parents.get(node.code)),
    prerequisites: sorted(prerequisites.get(node.code)),
    competencies: sorted(competencies.get(node.code)),
    supports: sorted(supports.get(node.code)),
  }));

  return {
    summaries,
    summaryByCode: new Map(summaries.map((summary) => [summary.code, summary])),
    nodeById,
    nodeByCode,
    mappableNotionIdsByCode: new Map(
      nodes
        .filter((node) => node.inScope && node.nodeType === "notion")
        .map((node) => [node.code, node.id]),
    ),
  };
}

/** Compact projection sent to the model: no database ids, no URLs. */
export interface AiCurriculumNode {
  /** Catalogue typical errors (in-scope notions only, when provided). */
  typicalErrors?: Array<{ code: string; description: string }>;
  code: string;
  nodeType: CurriculumNodeType;
  title: string;
  description: string | null;
  inScope: boolean;
  parents: string[];
  prerequisites: string[];
  competencies: string[];
  supports: string[];
}

export function toAiCurriculum(
  summaries: CurriculumNodeSummary[],
  typicalErrors: Map<string, Array<{ code: string; description: string }>> = new Map(),
): AiCurriculumNode[] {
  return summaries.map((summary) => ({
    ...(summary.inScope && summary.nodeType === "notion" && typicalErrors.get(summary.code)?.length
      ? { typicalErrors: typicalErrors.get(summary.code) }
      : {}),
    code: summary.code,
    nodeType: summary.nodeType,
    title: summary.title,
    description: summary.description,
    inScope: summary.inScope,
    parents: summary.parents,
    prerequisites: summary.prerequisites,
    competencies: summary.competencies,
    supports: summary.supports,
  }));
}

export type CurriculumScopeResolution =
  | "class_level"
  | "single_level"
  | "subject_fallback";

export interface CurriculumScope {
  /** null means every level imported for the subject. */
  levelCodes: string[] | null;
  resolution: CurriculumScopeResolution;
}

function normalizeLevel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Spelled-out tracks → the qualifier used in level codes.
const TRACK_SYNONYMS: Record<string, string> = {
  GENERALE_ET_TECHNOLOGIQUE: "GT",
  GENERALE_TECHNOLOGIQUE: "GT",
  GENERALE: "GT",
  GENERAL: "GT",
  PROFESSIONNELLE: "PRO",
  PROFESSIONNEL: "PRO",
  SPECIALITE: "SPE",
  SPECIALITE_MATHEMATIQUES: "SPE_MATHS",
  SPE_MATHEMATIQUES: "SPE_MATHS",
  TRONC_COMMUN: "TC",
};

const LEVEL_ALIASES: Array<{ pattern: RegExp; prefix: string }> = [
  { pattern: /^(seconde|2nde|2de|2nd)\b/, prefix: "SECONDE" },
  { pattern: /^(premiere|1re|1ere)\b/, prefix: "PREMIERE" },
  { pattern: /^(terminale|tle|term)\b/, prefix: "TERMINALE" },
];

/**
 * Chooses which imported programme levels apply to a class. Classes store a
 * free-text level ("Seconde", "2nde GT", "Première"); sources store codes
 * such as SECONDE_GT. When the class level cannot be matched the whole
 * subject is used — the pre-importer behaviour — and the resolution says so.
 */
export function resolveCurriculumScope(
  classLevel: string | null | undefined,
  availableLevelCodes: string[],
): CurriculumScope {
  const levels = [...new Set(availableLevelCodes)].sort(compareCodes);
  const normalized = classLevel ? normalizeLevel(classLevel) : "";
  if (normalized) {
    const exact = levels.filter((code) => normalizeLevel(code) === normalized);
    if (exact.length) return { levelCodes: exact, resolution: "class_level" };
    const alias = LEVEL_ALIASES.find(({ pattern }) => pattern.test(normalized));
    if (alias) {
      // Keep the track qualifier ("2nde GT" → SECONDE_GT, "Première spé" →
      // PREMIERE_SPE…): a general-track class must not receive a
      // professional-track programme that shares the grade prefix.
      // The longest leading words that name a track win, so a class number
      // after the track ("Seconde générale 3") does not hide it.
      const words = normalized.replace(alias.pattern, "").trim().split(" ").filter(Boolean);
      for (let count = words.length; count > 0; count--) {
        const spelled = words.slice(0, count).join("_").toUpperCase();
        const withQualifier = `${alias.prefix}_${TRACK_SYNONYMS[spelled] ?? spelled}`;
        const tracked = levels.filter(
          (code) => code === withQualifier || code.startsWith(`${withQualifier}_`),
        );
        if (tracked.length) return { levelCodes: tracked, resolution: "class_level" };
      }
      // No (matching) qualifier, e.g. "Seconde" or "Seconde 3": every
      // programme of that grade.
      const matches = levels.filter(
        (code) => code === alias.prefix || code.startsWith(`${alias.prefix}_`),
      );
      if (matches.length) return { levelCodes: matches, resolution: "class_level" };
    }
  }
  return {
    levelCodes: null,
    resolution: levels.length <= 1 ? "single_level" : "subject_fallback",
  };
}
