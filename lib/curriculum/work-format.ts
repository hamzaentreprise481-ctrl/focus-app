// Adapter for the rich "Work" curriculum document (schema_version 1.x), e.g.
// curriculum/work/FOCUS_Maths_Seconde_2026-2027.json.
//
// The document carries far more than the database graph can hold today
// (objectives, typical errors, remediations, coverage rows…). This adapter
// maps ONLY the graph — nodes and relationships — to the importer's raw
// package, without renaming, retyping, merging or dropping anything, so the
// normal validator and public.focus_import_curriculum judge the exact data.
// Everything that is not imported is counted in `notImported`.

import type { CurriculumIssue, RawCurriculumPackage } from "./types";

export interface WorkConversion {
  raw: RawCurriculumPackage;
  program: { id: string; title: string; status: string; dataVersion: string };
  counts: { nodes: number; edges: number; legacyNodes: number; newNodes: number };
  notImported: {
    domains: number;
    chapters: number;
    objectives: number;
    errors: number;
    remediations: number;
    coverageRows: number;
    edgeProvenance: Record<string, number>;
    teacherValidatedNodes: number;
    teacherValidatedEdges: number;
  };
  issues: CurriculumIssue[];
}

// Program id segment → importer level code. Extend deliberately, never guess.
const LEVELS: Record<string, string> = { "2DE.GT": "SECONDE_GT" };

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isWorkCurriculumDocument(value: unknown): value is Json {
  return (
    isRecord(value) &&
    typeof value.schema_version === "string" &&
    isRecord(value.program) &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    list(value.nodes).every((node) => isRecord(node) && "node_type" in node)
  );
}

export function convertWorkCurriculum(doc: Json, origin = "work.json"): WorkConversion {
  const issues: CurriculumIssue[] = [];
  const issue = (severity: CurriculumIssue["severity"], code: string, message: string, at: string) =>
    issues.push({ severity, code, message, at });

  if (!/^1\./.test(String(doc.schema_version)))
    issue("error", "WORK_SCHEMA", `schema_version ${String(doc.schema_version)} non pris en charge (1.x attendu).`, origin);

  const program = isRecord(doc.program) ? doc.program : {};
  const programId = typeof program.id === "string" ? program.id : "";
  // "FR.MATH.2DE.GT.2026-2027" → subject MATH, level segment 2DE.GT
  const segments = programId.split(".");
  const subjectCode = segments[1] ?? "";
  const levelCode = LEVELS[segments.slice(2, 4).join(".")] ?? "";
  if (!subjectCode || !levelCode)
    issue("error", "WORK_PROGRAM", `Niveau non reconnu pour le programme « ${programId} ».`, `${origin}#program`);

  const sources = list(doc.sources).filter(isRecord);
  const primaryId = list(program.source_ids)[0];
  const primary = sources.find((source) => source.id === primaryId);
  if (!primary)
    issue("error", "WORK_SOURCE", `Source principale ${String(primaryId)} introuvable.`, `${origin}#program.source_ids`);

  const nodes = list(doc.nodes).filter(isRecord);
  const edges = list(doc.edges).filter(isRecord);
  const codes = new Set(nodes.map((node) => String(node.code)));

  // Node-level lists duplicate the edge list; they must agree with it.
  const edgeKeys = new Set(
    edges.map((edge) => `${String(edge.from_code)}|${String(edge.to_code)}|${String(edge.relation)}`),
  );
  nodes.forEach((node, index) => {
    const at = `${origin}#nodes[${index}]`;
    for (const competency of list(node.competency_codes).map(String)) {
      if (competency === node.code) continue; // competency nodes tag themselves
      if (!edgeKeys.has(`${String(node.code)}|${competency}|supports`))
        issue("error", "WORK_LIST_MISMATCH", `${String(node.code)} liste ${competency} dans competency_codes sans relation supports correspondante.`, at);
    }
    for (const prerequisite of list(node.prerequisite_codes).map(String))
      if (!edgeKeys.has(`${prerequisite}|${String(node.code)}|prerequisite_of`))
        issue("error", "WORK_LIST_MISMATCH", `${String(node.code)} liste ${prerequisite} dans prerequisite_codes sans relation prerequisite_of correspondante.`, at);
    if (node.active === false)
      issue("warning", "WORK_INACTIVE_NODE", `${String(node.code)} est inactif dans le document : il ne sera pas importé (donc désactivé s’il existe).`, at);
  });
  edges.forEach((edge, index) => {
    for (const code of [edge.from_code, edge.to_code])
      if (!codes.has(String(code)))
        issue("error", "WORK_EDGE_NODE", `Relation vers un code absent du document : ${String(code)}.`, `${origin}#edges[${index}]`);
  });

  const legacyNodes = nodes.filter((node) => node.existing_node === true).length;
  const provenance: Record<string, number> = {};
  for (const edge of edges) {
    const key = String(edge.provenance ?? "non_renseignee");
    provenance[key] = (provenance[key] ?? 0) + 1;
  }

  const raw: RawCurriculumPackage = {
    origin,
    formatVersion: 1,
    sourceAt: `${origin}#sources(${String(primaryId)})`,
    source: primary
      ? {
          subjectCode,
          levelCode,
          schoolYear: program.school_year,
          title: primary.title,
          publisher: primary.publisher,
          officialReference: primary.reference,
          sourceUrl: primary.url,
          publishedOn: primary.published_on ?? null,
        }
      : null,
    nodes: nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.active !== false)
      .map(({ node, index }) => ({
        at: `${origin}#nodes[${index}] ${String(node.code)}`,
        value: {
          code: node.code,
          type: node.node_type,
          title: node.title,
          description: node.description ?? null,
          sourceLocator: node.source_locator,
        },
      })),
    edges: edges.map((edge, index) => ({
      at: `${origin}#edges[${index}]`,
      value: { from: edge.from_code, to: edge.to_code, relation: edge.relation },
    })),
  };

  const sum = (key: string) =>
    nodes.reduce((total, node) => total + list(node[key]).length, 0);

  return {
    raw,
    program: {
      id: programId,
      title: String(program.title ?? ""),
      status: String(doc.status ?? ""),
      dataVersion: String(doc.data_version ?? ""),
    },
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      legacyNodes,
      newNodes: nodes.length - legacyNodes,
    },
    notImported: {
      domains: list(doc.domains).length,
      chapters: list(doc.chapters).length,
      objectives: sum("objectives"),
      errors: sum("errors"),
      remediations: sum("remediations"),
      coverageRows: list(doc.coverage).length,
      edgeProvenance: provenance,
      teacherValidatedNodes: nodes.filter((node) => node.teacher_validated === true).length,
      teacherValidatedEdges: edges.filter((edge) => edge.teacher_validated === true).length,
    },
    issues,
  };
}
