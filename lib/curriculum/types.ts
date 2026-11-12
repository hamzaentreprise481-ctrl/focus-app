// Curriculum knowledge-base package, format version 1.
//
// A package describes ONE official source (a programme published in the
// Bulletin officiel, for instance) with its nodes and the relationships it
// declares. The package is the complete declaration for that source: importing
// it again is a no-op, and nodes it no longer lists are deactivated (never
// deleted, because teacher-visible observations may still reference them).
//
// Only short labels, descriptions written by FOCUS and source locators are
// stored. Never paste textbook or programme text into a package.

export const CURRICULUM_FORMAT_VERSION = 1 as const;

export const CURRICULUM_NODE_TYPES = [
  "domain",
  "notion",
  "competency",
  "prerequisite",
] as const;
export type CurriculumNodeType = (typeof CURRICULUM_NODE_TYPES)[number];

export const CURRICULUM_RELATIONS = [
  "prerequisite_of",
  "supports",
  "part_of",
] as const;
export type CurriculumRelation = (typeof CURRICULUM_RELATIONS)[number];

// Which node types each relation may connect (from → to). Kept identical to
// the checks performed by public.focus_import_curriculum.
export const RELATION_RULES: Record<
  CurriculumRelation,
  ReadonlyArray<readonly [CurriculumNodeType, CurriculumNodeType]>
> = {
  prerequisite_of: [
    ["notion", "notion"],
    ["prerequisite", "notion"],
  ],
  supports: [
    ["notion", "competency"],
    ["notion", "notion"],
    ["prerequisite", "competency"],
  ],
  part_of: [
    ["notion", "notion"],
    ["notion", "domain"],
    ["domain", "domain"],
    ["competency", "competency"],
  ],
};

export const CURRICULUM_LIMITS = {
  maxNodes: 5_000,
  maxEdges: 25_000,
  codeLength: 120,
  titleLength: 160,
  descriptionLength: 300,
  sourceLocatorLength: 200,
  sourceTextLength: 300,
} as const;

export const NODE_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:\.[A-Z0-9][A-Z0-9_]*)+$/;
export const SCOPE_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export interface CurriculumSourceMetadata {
  subjectCode: string;
  levelCode: string;
  schoolYear: string;
  title: string;
  publisher: string;
  officialReference: string;
  sourceUrl: string;
  publishedOn: string | null;
}

export interface CanonicalCurriculumNode {
  code: string;
  type: CurriculumNodeType;
  title: string;
  description: string | null;
  sourceLocator: string;
}

export interface CanonicalCurriculumEdge {
  from: string;
  to: string;
  relation: CurriculumRelation;
}

// The exact payload sent to public.focus_import_curriculum. Nodes are sorted by
// code and edges by (from, to, relation), so equal packages serialize equally.
export interface CanonicalCurriculumPackage {
  formatVersion: typeof CURRICULUM_FORMAT_VERSION;
  source: CurriculumSourceMetadata;
  nodes: CanonicalCurriculumNode[];
  edges: CanonicalCurriculumEdge[];
}

// A package as read from disk, before validation. `at` locates each item in
// the original file ("nodes[3]", "nodes.csv:12") for precise error messages.
export interface RawCurriculumPackage {
  origin: string;
  formatVersion: unknown;
  source: unknown;
  sourceAt: string;
  nodes: Array<{ value: unknown; at: string }>;
  edges: Array<{ value: unknown; at: string }>;
}

export type CurriculumIssueSeverity = "error" | "warning";

export interface CurriculumIssue {
  severity: CurriculumIssueSeverity;
  code: string;
  message: string;
  at: string;
}

// Nodes that live in another package / source and may be referenced by edges.
export interface ExternalCurriculumNode {
  code: string;
  type: CurriculumNodeType;
}

export interface CurriculumValidationStats {
  nodes: Record<CurriculumNodeType, number>;
  edges: Record<CurriculumRelation, number>;
  externalReferences: number;
}

export interface CurriculumValidationResult {
  ok: boolean;
  errors: CurriculumIssue[];
  warnings: CurriculumIssue[];
  package: CanonicalCurriculumPackage | null;
  hash: string | null;
  stats: CurriculumValidationStats;
}
