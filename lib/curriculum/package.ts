import { createHash } from "node:crypto";
import { CsvSyntaxError, parseCsvTable, writeCsv } from "./csv";
import {
  CURRICULUM_FORMAT_VERSION,
  CURRICULUM_LIMITS,
  CURRICULUM_NODE_TYPES,
  CURRICULUM_RELATIONS,
  NODE_CODE_PATTERN,
  RELATION_RULES,
  SCOPE_CODE_PATTERN,
  type CanonicalCurriculumEdge,
  type CanonicalCurriculumNode,
  type CanonicalCurriculumPackage,
  type CurriculumIssue,
  type CurriculumNodeType,
  type CurriculumRelation,
  type CurriculumSourceMetadata,
  type CurriculumValidationResult,
  type ExternalCurriculumNode,
  type RawCurriculumPackage,
} from "./types";

export class CurriculumParseError extends Error {
  constructor(
    message: string,
    public readonly at: string,
  ) {
    super(message);
    this.name = "CurriculumParseError";
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function parseJsonText(text: string, at: string): unknown {
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    throw new CurriculumParseError(
      `JSON invalide : ${error instanceof Error ? error.message : "erreur inconnue"}.`,
      at,
    );
  }
}

/** Reads a JSON package: { formatVersion, source, nodes: [...], edges?: [...] }. */
export function parseJsonCurriculumPackage(
  text: string,
  origin = "package.json",
): RawCurriculumPackage {
  const value = parseJsonText(text, origin);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CurriculumParseError("Le paquet doit être un objet JSON.", origin);
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (key) => !["formatVersion", "source", "nodes", "edges"].includes(key),
  );
  if (unknownKeys.length)
    throw new CurriculumParseError(
      `Champ(s) inconnu(s) au niveau racine : ${unknownKeys.join(", ")}.`,
      origin,
    );
  if (!Array.isArray(record.nodes))
    throw new CurriculumParseError("« nodes » doit être un tableau.", `${origin}#nodes`);
  if (record.edges !== undefined && !Array.isArray(record.edges))
    throw new CurriculumParseError("« edges » doit être un tableau.", `${origin}#edges`);

  return {
    origin,
    formatVersion: record.formatVersion,
    source: record.source,
    sourceAt: `${origin}#source`,
    nodes: (record.nodes as unknown[]).map((item, index) => ({
      value: item,
      at: `${origin}#nodes[${index}]`,
    })),
    edges: ((record.edges as unknown[] | undefined) ?? []).map((item, index) => ({
      value: item,
      at: `${origin}#edges[${index}]`,
    })),
  };
}

const NODE_COLUMNS: Record<string, string> = {
  code: "code",
  type: "type",
  node_type: "type",
  title: "title",
  description: "description",
  source_locator: "sourceLocator",
  part_of: "partOf",
  prerequisites: "prerequisites",
  competencies: "competencies",
};
const REQUIRED_NODE_COLUMNS = ["code", "type", "title", "sourceLocator"];
const EDGE_COLUMNS: Record<string, string> = {
  from: "from",
  from_code: "from",
  to: "to",
  to_code: "to",
  relation: "relation",
};
const LIST_SEPARATOR = "|";

function splitList(value: string) {
  return value
    .split(LIST_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapColumns(
  header: string[],
  mapping: Record<string, string>,
  required: string[],
  at: string,
) {
  const unknown = header.filter((name) => !(name in mapping));
  if (unknown.length)
    throw new CurriculumParseError(
      `Colonne(s) inconnue(s) : ${unknown.join(", ")}. Colonnes acceptées : ${Object.keys(mapping).join(", ")}.`,
      at,
    );
  const targets = header.map((name) => mapping[name]);
  const duplicated = targets.filter((name, index) => targets.indexOf(name) !== index);
  if (duplicated.length)
    throw new CurriculumParseError(
      `Colonnes redondantes pour : ${[...new Set(duplicated)].join(", ")}.`,
      at,
    );
  const missing = required.filter((name) => !targets.includes(name));
  if (missing.length)
    throw new CurriculumParseError(
      `Colonne(s) obligatoire(s) absente(s) : ${missing.join(", ")}.`,
      at,
    );
}

function readTable(text: string, name: string) {
  try {
    return parseCsvTable(text);
  } catch (error) {
    if (error instanceof CsvSyntaxError)
      throw new CurriculumParseError(error.message, `${name}:${error.line}`);
    throw error;
  }
}

/**
 * Reads a CSV package: source.json ({ formatVersion, source }), nodes.csv and
 * an optional edges.csv. List cells (part_of, prerequisites, competencies) use
 * "|" as separator.
 */
export function parseCsvCurriculumPackage(files: {
  sourceJson: string;
  nodesCsv: string;
  edgesCsv?: string | null;
  names?: { source?: string; nodes?: string; edges?: string };
}): RawCurriculumPackage {
  const sourceName = files.names?.source ?? "source.json";
  const nodesName = files.names?.nodes ?? "nodes.csv";
  const edgesName = files.names?.edges ?? "edges.csv";

  const manifest = parseJsonText(files.sourceJson, sourceName);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw new CurriculumParseError("source.json doit être un objet JSON.", sourceName);
  const manifestRecord = manifest as Record<string, unknown>;
  const unknownKeys = Object.keys(manifestRecord).filter(
    (key) => !["formatVersion", "source"].includes(key),
  );
  if (unknownKeys.length)
    throw new CurriculumParseError(
      `Champ(s) inconnu(s) : ${unknownKeys.join(", ")} (attendu : formatVersion, source).`,
      sourceName,
    );

  const nodesTable = readTable(files.nodesCsv, nodesName);
  mapColumns(nodesTable.header, NODE_COLUMNS, REQUIRED_NODE_COLUMNS, `${nodesName}:1`);

  const nodes = nodesTable.rows.map((row) => {
    const node: Record<string, unknown> = {};
    for (const [column, raw] of Object.entries(row.values)) {
      const key = NODE_COLUMNS[column];
      if (key === "partOf" || key === "prerequisites" || key === "competencies")
        node[key] = splitList(raw);
      else if (key === "description") node[key] = raw.trim() ? raw : null;
      else node[key] = raw;
    }
    return { value: node, at: `${nodesName}:${row.line}` };
  });

  let edges: RawCurriculumPackage["edges"] = [];
  if (files.edgesCsv && files.edgesCsv.trim()) {
    const edgesTable = readTable(files.edgesCsv, edgesName);
    mapColumns(edgesTable.header, EDGE_COLUMNS, ["from", "to", "relation"], `${edgesName}:1`);
    edges = edgesTable.rows.map((row) => {
      const edge: Record<string, unknown> = {};
      for (const [column, raw] of Object.entries(row.values))
        edge[EDGE_COLUMNS[column]] = raw;
      return { value: edge, at: `${edgesName}:${row.line}` };
    });
  }

  return {
    origin: nodesName,
    formatVersion: manifestRecord.formatVersion,
    source: manifestRecord.source,
    sourceAt: `${sourceName}#source`,
    nodes,
    edges,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Lengths are counted in Unicode code points, like PostgreSQL char_length
// (UTF-16 .length would count an emoji twice).
export function codePointLength(value: string) {
  let count = 0;
  for (const _ of value) count++; // eslint-disable-line @typescript-eslint/no-unused-vars
  return count;
}

// NFC + collapsed whitespace: two spellings of the same label must not look
// like a change to the importer (idempotency) nor like two different nodes.
export function normalizeCurriculumText(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// An unpaired UTF-16 surrogate survives JSON.parse but not PostgreSQL's
// jsonb cast, so a package containing one could never be imported.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;


// The exact expression used by public.focus_import_curriculum, so both sides
// accept the same URLs (https, official host, no user info, no explicit port).
export const OFFICIAL_SOURCE_URL_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)*(gouv|education)\.fr([/?#]|$)/i;

export function isOfficialSourceUrl(value: string) {
  return OFFICIAL_SOURCE_URL_PATTERN.test(value);
}

function isIsoDate(value: string) {
  // Year 0000 parses in JavaScript but not as a PostgreSQL date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

interface EdgeCandidate extends CanonicalCurriculumEdge {
  at: string;
  expectCompetency: boolean;
}

export interface ValidateCurriculumOptions {
  /** Nodes declared by other packages/sources that edges may reference. */
  externalNodes?: Iterable<ExternalCurriculumNode>;
  /** Edges declared by other packages, used for cross-package cycle detection. */
  externalEdges?: Iterable<CanonicalCurriculumEdge>;
}

function edgeKey(edge: CanonicalCurriculumEdge) {
  return `${edge.from}\u0000${edge.to}\u0000${edge.relation}`;
}
function pairKey(a: string, b: string) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

// Code-point order: independent of the ICU version or database collation.
export function compareCodes(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareEdges(a: CanonicalCurriculumEdge, b: CanonicalCurriculumEdge) {
  return (
    compareCodes(a.from, b.from) ||
    compareCodes(a.to, b.to) ||
    compareCodes(a.relation, b.relation)
  );
}

// Returns one representative cycle (as a code path) per strongly connected
// problem found, using an iterative DFS with colors.
function findCycles(codes: Iterable<string>, adjacency: Map<string, string[]>) {
  const color = new Map<string, 0 | 1 | 2>();
  const cycles: string[][] = [];
  for (const start of codes) {
    if (color.get(start)) continue;
    const stack: Array<{ node: string; next: number }> = [{ node: start, next: 0 }];
    const path: string[] = [start];
    color.set(start, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const targets = adjacency.get(frame.node) ?? [];
      if (frame.next >= targets.length) {
        color.set(frame.node, 2);
        stack.pop();
        path.pop();
        continue;
      }
      const target = targets[frame.next++];
      const state = color.get(target) ?? 0;
      if (state === 1) {
        cycles.push([...path.slice(path.indexOf(target)), target]);
      } else if (state === 0) {
        color.set(target, 1);
        stack.push({ node: target, next: 0 });
        path.push(target);
      }
    }
  }
  return cycles;
}

export function validateCurriculumPackage(
  raw: RawCurriculumPackage,
  options: ValidateCurriculumOptions = {},
): CurriculumValidationResult {
  const errors: CurriculumIssue[] = [];
  const warnings: CurriculumIssue[] = [];
  const error = (code: string, message: string, at: string) =>
    errors.push({ severity: "error", code, message, at });
  const warn = (code: string, message: string, at: string) =>
    warnings.push({ severity: "warning", code, message, at });

  const stats: CurriculumValidationResult["stats"] = {
    nodes: { domain: 0, notion: 0, competency: 0, prerequisite: 0 },
    edges: { prerequisite_of: 0, supports: 0, part_of: 0 },
    externalReferences: 0,
  };

  // -- format & source ------------------------------------------------------
  if (raw.formatVersion !== CURRICULUM_FORMAT_VERSION)
    error(
      "FORMAT_VERSION",
      `formatVersion doit valoir ${CURRICULUM_FORMAT_VERSION} (reçu : ${JSON.stringify(raw.formatVersion) ?? "absent"}).`,
      raw.sourceAt,
    );

  let source: CurriculumSourceMetadata | null = null;
  if (!raw.source || typeof raw.source !== "object" || Array.isArray(raw.source)) {
    error("SOURCE_MISSING", "L’objet « source » est obligatoire.", raw.sourceAt);
  } else {
    const value = raw.source as Record<string, unknown>;
    const allowed = [
      "subjectCode",
      "levelCode",
      "schoolYear",
      "title",
      "publisher",
      "officialReference",
      "sourceUrl",
      "publishedOn",
    ];
    for (const key of Object.keys(value))
      if (!allowed.includes(key))
        error("UNKNOWN_FIELD", `Champ inconnu « ${key} » dans la source.`, raw.sourceAt);

    const text = (key: string, max: number = CURRICULUM_LIMITS.sourceTextLength) => {
      const field = value[key];
      if (typeof field !== "string" || !normalizeCurriculumText(field)) {
        error("SOURCE_FIELD", `source.${key} est obligatoire.`, raw.sourceAt);
        return "";
      }
      if (CONTROL_CHARS.test(field))
        error("CONTROL_CHARACTER", `source.${key} contient un caractère de contrôle.`, raw.sourceAt);
      if (LONE_SURROGATE.test(field))
        error("INVALID_UNICODE", `source.${key} contient un caractère Unicode invalide (surrogate isolé).`, raw.sourceAt);
      const normalized = normalizeCurriculumText(field);
      if (codePointLength(normalized) > max)
        error("SOURCE_FIELD", `source.${key} dépasse ${max} caractères.`, raw.sourceAt);
      return normalized;
    };

    const subjectCode = text("subjectCode");
    const levelCode = text("levelCode");
    const schoolYear = text("schoolYear");
    const sourceUrl = text("sourceUrl");
    const candidate: CurriculumSourceMetadata = {
      subjectCode,
      levelCode,
      schoolYear,
      title: text("title"),
      publisher: text("publisher"),
      officialReference: text("officialReference"),
      sourceUrl,
      publishedOn: null,
    };
    if (subjectCode && !SCOPE_CODE_PATTERN.test(subjectCode))
      error("SOURCE_FIELD", "source.subjectCode doit être en majuscules (ex. MATH).", raw.sourceAt);
    if (levelCode && !SCOPE_CODE_PATTERN.test(levelCode))
      error("SOURCE_FIELD", "source.levelCode doit être en majuscules (ex. SECONDE_GT).", raw.sourceAt);
    if (schoolYear) {
      const match = /^(\d{4})-(\d{4})$/.exec(schoolYear);
      if (!match || Number(match[2]) !== Number(match[1]) + 1)
        error("SOURCE_FIELD", "source.schoolYear doit avoir la forme 2026-2027.", raw.sourceAt);
    }
    if (sourceUrl && !isOfficialSourceUrl(sourceUrl))
      error(
        "SOURCE_NOT_OFFICIAL",
        "source.sourceUrl doit être une URL https d’un domaine officiel (*.gouv.fr, *.education.fr).",
        raw.sourceAt,
      );
    if (value.publishedOn !== undefined && value.publishedOn !== null) {
      if (typeof value.publishedOn !== "string" || !isIsoDate(value.publishedOn))
        error("SOURCE_FIELD", "source.publishedOn doit être une date AAAA-MM-JJ.", raw.sourceAt);
      else candidate.publishedOn = value.publishedOn;
    }
    source = candidate;
  }

  // -- nodes ----------------------------------------------------------------
  if (raw.nodes.length === 0)
    error("NODES_EMPTY", "Le paquet ne contient aucun nœud.", raw.origin);
  if (raw.nodes.length > CURRICULUM_LIMITS.maxNodes)
    error("TOO_MANY_NODES", `Plus de ${CURRICULUM_LIMITS.maxNodes} nœuds.`, raw.origin);

  const nodes = new Map<string, CanonicalCurriculumNode & { at: string }>();
  const candidates: EdgeCandidate[] = [];
  const allowedNodeKeys = [
    "code",
    "type",
    "title",
    "description",
    "sourceLocator",
    "partOf",
    "prerequisites",
    "competencies",
  ];

  const readCodeList = (
    value: unknown,
    key: string,
    at: string,
  ): string[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      error("NODE_FIELD", `${key} doit être une liste de codes.`, at);
      return [];
    }
    return (value as string[]).map((item) => item.trim()).filter(Boolean);
  };

  for (const { value, at } of raw.nodes) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      error("NODE_FIELD", "Chaque nœud doit être un objet.", at);
      continue;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record))
      if (!allowedNodeKeys.includes(key))
        error("UNKNOWN_FIELD", `Champ inconnu « ${key} ».`, at);

    const code = typeof record.code === "string" ? record.code.trim() : "";
    if (!code) {
      error("NODE_CODE", "Code de nœud manquant.", at);
      continue;
    }
    let valid = true;
    if (code.length > CURRICULUM_LIMITS.codeLength || !NODE_CODE_PATTERN.test(code)) {
      error(
        "NODE_CODE",
        `Code « ${code} » invalide : segments en MAJUSCULES séparés par des points (ex. MATH.ALG.EQUATIONS), ${CURRICULUM_LIMITS.codeLength} caractères max.`,
        at,
      );
      valid = false;
    } else if (source?.subjectCode && !code.startsWith(`${source.subjectCode}.`)) {
      error(
        "NODE_CODE",
        `Le code « ${code} » doit commencer par « ${source.subjectCode}. ».`,
        at,
      );
      valid = false;
    }

    const type = record.type;
    if (typeof type !== "string" || !(CURRICULUM_NODE_TYPES as readonly string[]).includes(type)) {
      error(
        "NODE_TYPE",
        `Type « ${String(type)} » invalide pour ${code} (attendu : ${CURRICULUM_NODE_TYPES.join(", ")}).`,
        at,
      );
      valid = false;
    }

    const readText = (key: string, max: number, required: boolean) => {
      const field = record[key];
      if (field === undefined || field === null || (typeof field === "string" && !field.trim())) {
        if (required) {
          error("NODE_FIELD", `${key} est obligatoire pour ${code}.`, at);
          valid = false;
        }
        return null;
      }
      if (typeof field !== "string") {
        error("NODE_FIELD", `${key} doit être du texte pour ${code}.`, at);
        valid = false;
        return null;
      }
      if (CONTROL_CHARS.test(field)) {
        error("CONTROL_CHARACTER", `${key} contient un caractère de contrôle (${code}).`, at);
        valid = false;
      }
      if (LONE_SURROGATE.test(field)) {
        error("INVALID_UNICODE", `${key} contient un caractère Unicode invalide (surrogate isolé) (${code}).`, at);
        valid = false;
      }
      const normalized = normalizeCurriculumText(field);
      if (codePointLength(normalized) > max) {
        error(
          "TEXT_TOO_LONG",
          `${key} de ${code} dépasse ${max} caractères : stockez un libellé court et un localisateur, jamais le texte du programme ou d’un manuel.`,
          at,
        );
        valid = false;
      }
      return normalized;
    };

    const title = readText("title", CURRICULUM_LIMITS.titleLength, true);
    const description = readText("description", CURRICULUM_LIMITS.descriptionLength, false);
    const sourceLocator = readText("sourceLocator", CURRICULUM_LIMITS.sourceLocatorLength, true);

    const existing = nodes.get(code);
    if (existing) {
      error("NODE_DUPLICATE", `Le code ${code} est déclaré deux fois (voir aussi ${existing.at}).`, at);
      continue;
    }
    if (!valid || !title || !sourceLocator) continue;

    nodes.set(code, {
      code,
      type: type as CurriculumNodeType,
      title,
      description,
      sourceLocator,
      at,
    });

    for (const parent of readCodeList(record.partOf, "partOf", at))
      candidates.push({ from: code, to: parent, relation: "part_of", at: `${at} (partOf)`, expectCompetency: false });
    for (const prerequisite of readCodeList(record.prerequisites, "prerequisites", at))
      candidates.push({ from: prerequisite, to: code, relation: "prerequisite_of", at: `${at} (prerequisites)`, expectCompetency: false });
    for (const competency of readCodeList(record.competencies, "competencies", at))
      candidates.push({ from: code, to: competency, relation: "supports", at: `${at} (competencies)`, expectCompetency: true });
  }

  // -- explicit edges -------------------------------------------------------
  for (const { value, at } of raw.edges) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      error("EDGE_FIELD", "Chaque relation doit être un objet.", at);
      continue;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record))
      if (!["from", "to", "relation"].includes(key))
        error("UNKNOWN_FIELD", `Champ inconnu « ${key} ».`, at);
    const from = typeof record.from === "string" ? record.from.trim() : "";
    const to = typeof record.to === "string" ? record.to.trim() : "";
    const relation = typeof record.relation === "string" ? record.relation.trim() : "";
    if (!from || !to) {
      error("EDGE_FIELD", "Une relation doit avoir « from » et « to ».", at);
      continue;
    }
    if (!(CURRICULUM_RELATIONS as readonly string[]).includes(relation)) {
      error(
        "EDGE_RELATION",
        `Relation « ${relation} » invalide (attendu : ${CURRICULUM_RELATIONS.join(", ")}).`,
        at,
      );
      continue;
    }
    candidates.push({ from, to, relation: relation as CurriculumRelation, at, expectCompetency: false });
  }

  // The database limit applies to the canonical edge set, which includes the
  // inline partOf / prerequisites / competencies relationships.
  if (candidates.length > CURRICULUM_LIMITS.maxEdges)
    error(
      "TOO_MANY_EDGES",
      `${candidates.length} relations déclarées (liens en ligne partOf, prerequisites, competencies compris) : plus de ${CURRICULUM_LIMITS.maxEdges}.`,
      raw.origin,
    );

  // -- edge semantics -------------------------------------------------------
  // A code declared by a context package belongs to that package's source:
  // redeclaring it here would be refused by the database as a takeover, so it
  // is an error offline too (never silently masked).
  const external = new Map<string, ExternalCurriculumNode>();
  for (const node of options.externalNodes ?? []) {
    const local = nodes.get(node.code);
    if (local)
      error(
        "NODE_OWNED_ELSEWHERE",
        `${node.code} est déjà déclaré par un paquet de contexte (autre source) : un code n’appartient qu’à une seule source.`,
        local.at,
      );
    else external.set(node.code, node);
  }
  const typeOf = (code: string) => nodes.get(code)?.type ?? external.get(code)?.type;

  const edgesByKey = new Map<string, EdgeCandidate>();
  const edgesByPair = new Map<string, EdgeCandidate>();
  const externalCodesUsed = new Set<string>();

  for (const edge of candidates) {
    const label = `${edge.from} —${edge.relation}→ ${edge.to}`;
    if (edge.from === edge.to) {
      error("EDGE_SELF", `Relation d’un nœud vers lui-même : ${label}.`, edge.at);
      continue;
    }
    const fromType = typeOf(edge.from);
    const toType = typeOf(edge.to);
    let resolvable = true;
    for (const code of [edge.from, edge.to]) {
      if (!typeOf(code)) {
        error(
          "EDGE_UNKNOWN_NODE",
          `Code inconnu « ${code} » dans ${label} : déclarez le nœud ou fournissez le paquet qui le contient.`,
          edge.at,
        );
        resolvable = false;
      }
    }
    if (!resolvable) continue;
    if (!nodes.has(edge.from) && !nodes.has(edge.to)) {
      error(
        "EDGE_FOREIGN",
        `${label} relie deux nœuds d’autres sources : une relation doit toucher au moins un nœud de ce paquet.`,
        edge.at,
      );
      continue;
    }
    for (const code of [edge.from, edge.to])
      if (!nodes.has(code)) externalCodesUsed.add(code);

    if (edge.expectCompetency && toType !== "competency") {
      error(
        "COMPETENCY_TARGET",
        `${edge.to} est listé dans « competencies » de ${edge.from} mais son type est « ${toType} ».`,
        edge.at,
      );
      continue;
    }
    const allowed = RELATION_RULES[edge.relation].some(
      ([from, to]) => from === fromType && to === toType,
    );
    if (!allowed) {
      error(
        "EDGE_TYPES",
        `${label} : « ${edge.relation} » ne peut pas relier ${fromType} → ${toType} (autorisé : ${RELATION_RULES[edge.relation].map(([a, b]) => `${a} → ${b}`).join(", ")}).`,
        edge.at,
      );
      continue;
    }

    const key = edgeKey(edge);
    const duplicate = edgesByKey.get(key);
    if (duplicate) {
      error("EDGE_DUPLICATE", `${label} est déclarée deux fois (voir aussi ${duplicate.at}).`, edge.at);
      continue;
    }
    const pair = pairKey(edge.from, edge.to);
    const conflicting = edgesByPair.get(pair);
    if (conflicting) {
      error(
        "EDGE_CONFLICT",
        `${label} contredit ${conflicting.from} —${conflicting.relation}→ ${conflicting.to} (${conflicting.at}) : une seule relation par paire de nœuds.`,
        edge.at,
      );
      continue;
    }
    edgesByKey.set(key, edge);
    edgesByPair.set(pair, edge);
  }
  stats.externalReferences = externalCodesUsed.size;

  // Pair conflicts with relations declared by other packages.
  const externalEdges = [...(options.externalEdges ?? [])];
  for (const other of externalEdges) {
    const mine = edgesByPair.get(pairKey(other.from, other.to));
    if (!mine) continue;
    if (edgeKey(mine) !== edgeKey(other))
      error(
        "EDGE_CONFLICT",
        `${mine.from} —${mine.relation}→ ${mine.to} contredit ${other.from} —${other.relation}→ ${other.to}, déclarée par un autre paquet.`,
        mine.at,
      );
  }

  // -- cycles ---------------------------------------------------------------
  for (const relation of ["prerequisite_of", "part_of"] as const) {
    const adjacency = new Map<string, string[]>();
    const add = (edge: CanonicalCurriculumEdge) => {
      if (edge.relation !== relation) return;
      const list = adjacency.get(edge.from) ?? [];
      if (!list.includes(edge.to)) list.push(edge.to);
      adjacency.set(edge.from, list);
    };
    edgesByKey.forEach(add);
    externalEdges.forEach(add);
    for (const list of adjacency.values()) list.sort();
    const cycles = findCycles([...adjacency.keys()].sort(), adjacency);
    for (const cycle of cycles)
      error(
        relation === "prerequisite_of" ? "PREREQUISITE_CYCLE" : "PART_OF_CYCLE",
        `Cycle « ${relation} » : ${cycle.join(" → ")}.`,
        nodes.get(cycle[0])?.at ?? raw.origin,
      );
  }

  // -- quality warnings -----------------------------------------------------
  const edges = [...edgesByKey.values()];
  const touched = new Set<string>();
  const competencyLinked = new Set<string>();
  const prerequisiteSources = new Set<string>();
  const directPrerequisites = new Map<string, Set<string>>();
  for (const edge of edges) {
    touched.add(edge.from);
    touched.add(edge.to);
    if (edge.relation === "supports" && typeOf(edge.to) === "competency")
      competencyLinked.add(edge.from);
    if (edge.relation === "prerequisite_of") {
      prerequisiteSources.add(edge.from);
      const set = directPrerequisites.get(edge.to) ?? new Set<string>();
      set.add(edge.from);
      directPrerequisites.set(edge.to, set);
    }
  }
  for (const node of nodes.values()) {
    stats.nodes[node.type]++;
    if (!touched.has(node.code))
      warn("NODE_ISOLATED", `${node.code} n’est relié à aucun autre nœud.`, node.at);
    else if (node.type === "notion" && !competencyLinked.has(node.code))
      warn(
        "NOTION_WITHOUT_COMPETENCY",
        `${node.code} ne soutient aucune compétence : les recommandations n’afficheront pas de compétence associée.`,
        node.at,
      );
    if (node.type === "prerequisite" && touched.has(node.code) && !prerequisiteSources.has(node.code))
      warn("PREREQUISITE_UNUSED", `${node.code} n’est prérequis d’aucune notion.`, node.at);
  }
  // Transitive redundancy: A → C is redundant when A → B → … → C exists.
  if (!errors.some((issue) => issue.code === "PREREQUISITE_CYCLE")) {
    const ancestors = new Map<string, Set<string>>();
    const collect = (code: string, visiting: Set<string>): Set<string> => {
      const cached = ancestors.get(code);
      if (cached) return cached;
      const result = new Set<string>();
      visiting.add(code);
      for (const parent of directPrerequisites.get(code) ?? []) {
        if (visiting.has(parent)) continue;
        result.add(parent);
        for (const grand of collect(parent, visiting)) result.add(grand);
      }
      visiting.delete(code);
      ancestors.set(code, result);
      return result;
    };
    for (const [target, direct] of directPrerequisites) {
      for (const candidate of direct) {
        const viaOther = [...direct].some(
          (other) => other !== candidate && collect(other, new Set()).has(candidate),
        );
        if (viaOther)
          warn(
            "PREREQUISITE_REDUNDANT",
            `${candidate} → ${target} est déjà impliquée par une chaîne de prérequis.`,
            edgesByKey.get(edgeKey({ from: candidate, to: target, relation: "prerequisite_of" }))?.at ??
              raw.origin,
          );
      }
    }
  }
  for (const edge of edges) stats.edges[edge.relation]++;

  const ok = errors.length === 0 && source !== null;
  if (!ok)
    return { ok: false, errors, warnings, package: null, hash: null, stats };

  const canonical: CanonicalCurriculumPackage = {
    formatVersion: CURRICULUM_FORMAT_VERSION,
    source: source as CurriculumSourceMetadata,
    nodes: [...nodes.values()]
      .map(({ code, type, title, description, sourceLocator }) => ({
        code,
        type,
        title,
        description,
        sourceLocator,
      }))
      .sort((a, b) => compareCodes(a.code, b.code)),
    edges: edges
      .map(({ from, to, relation }) => ({ from, to, relation }))
      .sort(compareEdges),
  };
  return {
    ok: true,
    errors,
    warnings,
    package: canonical,
    hash: hashCurriculumPackage(canonical),
    stats,
  };
}

export interface CurriculumChainResult {
  /** Results of the context packages, in order; stops at the first invalid one. */
  context: CurriculumValidationResult[];
  /** null when a context package is invalid. */
  target: CurriculumValidationResult | null;
}

/**
 * Validates `--with` context packages cumulatively — each one may reference
 * nodes and relationships of the packages before it — then the target with
 * all of them as context.
 */
export function validateCurriculumChain(
  context: RawCurriculumPackage[],
  target: RawCurriculumPackage,
): CurriculumChainResult {
  const externalNodes: ExternalCurriculumNode[] = [];
  const externalEdges: CanonicalCurriculumEdge[] = [];
  const results: CurriculumValidationResult[] = [];
  for (const raw of context) {
    const result = validateCurriculumPackage(raw, {
      externalNodes: [...externalNodes],
      externalEdges: [...externalEdges],
    });
    results.push(result);
    if (!result.package) return { context: results, target: null };
    externalNodes.push(...result.package.nodes);
    externalEdges.push(...result.package.edges);
  }
  return {
    context: results,
    target: validateCurriculumPackage(target, { externalNodes, externalEdges }),
  };
}

/**
 * Canonical serialization — fixed key order, arrays in package order. The
 * database hashes the exact same text (focus_import_curriculum), so the
 * validator fingerprint, the "-- Package hash" of a generated migration and
 * the packageHash of the import audit row are identical.
 */
export function canonicalCurriculumText(pkg: CanonicalCurriculumPackage) {
  const s = (value: string | null) => (value === null ? "null" : JSON.stringify(value));
  const source = pkg.source;
  return (
    `{"formatVersion":${pkg.formatVersion},"source":{` +
    `"subjectCode":${s(source.subjectCode)},"levelCode":${s(source.levelCode)},` +
    `"schoolYear":${s(source.schoolYear)},"title":${s(source.title)},` +
    `"publisher":${s(source.publisher)},"officialReference":${s(source.officialReference)},` +
    `"sourceUrl":${s(source.sourceUrl)},"publishedOn":${s(source.publishedOn)}},"nodes":[` +
    pkg.nodes
      .map(
        (node) =>
          `{"code":${s(node.code)},"type":${s(node.type)},"title":${s(node.title)},` +
          `"description":${s(node.description)},"sourceLocator":${s(node.sourceLocator)}}`,
      )
      .join(",") +
    `],"edges":[` +
    pkg.edges
      .map((edge) => `{"from":${s(edge.from)},"to":${s(edge.to)},"relation":${s(edge.relation)}}`)
      .join(",") +
    `]}`
  );
}

export function hashCurriculumPackage(pkg: CanonicalCurriculumPackage) {
  return createHash("sha256").update(canonicalCurriculumText(pkg)).digest("hex");
}

/**
 * Validates the payload of public.focus_export_curriculum, i.e.
 * { package, externalNodes }: relationships to nodes of other sources are
 * resolved with the types the database returned, so a cross-level package
 * can be exported without extra context.
 */
export function validateExportedCurriculum(payload: unknown, origin = "export") {
  const value = payload as { package?: unknown; externalNodes?: unknown } | null;
  if (!value || typeof value !== "object" || !value.package || !Array.isArray(value.externalNodes))
    throw new CurriculumParseError("Réponse d’export inattendue.", origin);
  const externalNodes = (value.externalNodes as Array<{ code?: unknown; type?: unknown }>).map((node) => {
    if (typeof node.code !== "string" || !(CURRICULUM_NODE_TYPES as readonly string[]).includes(String(node.type)))
      throw new CurriculumParseError("Nœud externe invalide dans l’export.", origin);
    return { code: node.code, type: node.type as CurriculumNodeType };
  });
  return validateCurriculumPackage(
    parseJsonCurriculumPackage(JSON.stringify(value.package), origin),
    { externalNodes },
  );
}

// ---------------------------------------------------------------------------
// Writing (CSV directory form)
// ---------------------------------------------------------------------------

/**
 * Serializes a canonical package to the CSV directory form. part_of,
 * prerequisite and node → competency relations are written inline in
 * nodes.csv; the remaining relations (supports between notions, external
 * endpoints) go to edges.csv.
 */
export function serializeCsvCurriculumPackage(pkg: CanonicalCurriculumPackage) {
  const nodeCodes = new Map(pkg.nodes.map((node) => [node.code, node]));
  const inline = {
    partOf: new Map<string, string[]>(),
    prerequisites: new Map<string, string[]>(),
    competencies: new Map<string, string[]>(),
  };
  const push = (map: Map<string, string[]>, key: string, value: string) =>
    map.set(key, [...(map.get(key) ?? []), value]);
  const remaining: CanonicalCurriculumEdge[] = [];

  for (const edge of pkg.edges) {
    if (edge.relation === "part_of" && nodeCodes.has(edge.from))
      push(inline.partOf, edge.from, edge.to);
    else if (edge.relation === "prerequisite_of" && nodeCodes.has(edge.to))
      push(inline.prerequisites, edge.to, edge.from);
    else if (
      edge.relation === "supports" &&
      nodeCodes.has(edge.from) &&
      nodeCodes.get(edge.to)?.type === "competency"
    )
      push(inline.competencies, edge.from, edge.to);
    else remaining.push(edge);
  }

  const nodesCsv = writeCsv(
    [
      "code",
      "type",
      "title",
      "description",
      "source_locator",
      "part_of",
      "prerequisites",
      "competencies",
    ],
    pkg.nodes.map((node) => [
      node.code,
      node.type,
      node.title,
      node.description ?? "",
      node.sourceLocator,
      (inline.partOf.get(node.code) ?? []).join(LIST_SEPARATOR),
      (inline.prerequisites.get(node.code) ?? []).join(LIST_SEPARATOR),
      (inline.competencies.get(node.code) ?? []).join(LIST_SEPARATOR),
    ]),
  );
  const edgesCsv = remaining.length
    ? writeCsv(
        ["from", "to", "relation"],
        remaining.map((edge) => [edge.from, edge.to, edge.relation]),
      )
    : null;
  const sourceJson =
    JSON.stringify(
      { formatVersion: pkg.formatVersion, source: pkg.source },
      null,
      2,
    ) + "\n";
  return { sourceJson, nodesCsv, edgesCsv };
}
