// The exact Work curriculum document (curriculum/work/FOCUS_Maths_Seconde_2026-2027.json)
// against the importer and an exact replica of the live curriculum tables.

import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { loadCurriculumInput, loadCurriculumPackage } from "../lib/curriculum/fs";
import { buildCurriculumIndex, parseCurriculumGraphPayload } from "../lib/curriculum/graph";
import { validateCurriculumPackage } from "../lib/curriculum/package";
import {
  applyWorkDecisions,
  listWorkDisputes,
  workDecisionsTemplate,
} from "../lib/curriculum/work-decisions";
import { convertWorkCurriculum } from "../lib/curriculum/work-format";
import { createMigratedDatabase } from "./helpers/pg";
import {
  LEGACY_CODES,
  LIVE,
  WORK_FILE,
  WORK_FILE_SHA256,
  legacyFingerprint,
  splitWorkEdges,
  useLiveIdentifiers,
  workDocument,
  workServerPackage,
} from "./helpers/work-curriculum";

const REFERENCE_PACKAGE = path.join(__dirname, "..", "curriculum", "packages", "math", "seconde-gt-2026-2027");

let db: PGlite;
before(async () => {
  db = await createMigratedDatabase();
  await useLiveIdentifiers(db);
});
after(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback");
});

interface ImportReport {
  changed: boolean;
  source: { created: boolean; updated: boolean };
  nodes: Record<string, number>;
  edges: Record<string, number>;
}

interface WorkNodeRecord {
  code: string;
  node_type: string;
  title: string;
  existing_node: boolean;
  legacy_record: { node_type: string; title: string; description: string | null; source_locator: string };
}

async function serverImport(pkg: unknown, dryRun: boolean) {
  await db.exec("savepoint work_import");
  try {
    await db.exec("set local role service_role");
    const { rows } = await db.query<{ report: ImportReport }>(
      "select public.focus_import_curriculum($1::jsonb, $2, false) as report",
      [JSON.stringify(pkg), dryRun],
    );
    await db.exec("reset role");
    await db.exec("release savepoint work_import");
    return rows[0].report;
  } catch (error) {
    await db.exec("rollback to savepoint work_import");
    throw error;
  }
}

async function tableSnapshot() {
  const { rows } = await db.query<{ value: unknown }>(
    `select jsonb_build_object(
       'sources', (select jsonb_agg(jsonb_build_array(ctid::text, id, title, official_reference) order by id) from public.curriculum_sources),
       'nodes', (select jsonb_agg(jsonb_build_array(ctid::text, id, code, title, active) order by id) from public.curriculum_nodes),
       'edges', (select jsonb_agg(jsonb_build_array(ctid::text, from_node_id, to_node_id, relation) order by from_node_id, to_node_id) from public.curriculum_edges),
       'declarations', (select jsonb_agg(jsonb_build_array(ctid::text, from_node_id, to_node_id, relation, source_id) order by from_node_id, to_node_id, source_id) from public.curriculum_edge_declarations),
       'runs', (select count(*) from public.curriculum_import_runs)) as value`,
  );
  return rows[0].value;
}

function undisputedPackage() {
  const { conversion, undisputed } = splitWorkEdges();
  const keep = new Set(undisputed.map((edge) => edge.index));
  const result = validateCurriculumPackage({
    ...conversion.raw,
    edges: conversion.raw.edges.filter((_, index) => keep.has(index)),
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result.package!;
}

test("the committed Work file is byte-identical to the attached one and converts without loss of graph data", () => {
  assert.equal(createHash("sha256").update(readFileSync(WORK_FILE)).digest("hex"), WORK_FILE_SHA256);
  const input = loadCurriculumInput(WORK_FILE);
  assert.ok(input.work);
  assert.deepEqual(input.work.issues, []);
  assert.equal(input.work.program.status, "draft_for_teacher_review");
  assert.deepEqual(input.work.counts, { nodes: 99, edges: 348, legacyNodes: 44, newNodes: 55 });
  assert.equal(input.raw.nodes.length, 99);
  assert.equal(input.raw.edges.length, 348);
  assert.deepEqual(
    {
      objectives: input.work.notImported.objectives,
      errors: input.work.notImported.errors,
      remediations: input.work.notImported.remediations,
      teacherValidatedNodes: input.work.notImported.teacherValidatedNodes,
      teacherValidatedEdges: input.work.notImported.teacherValidatedEdges,
    },
    { objectives: 272, errors: 99, remediations: 99, teacherValidatedNodes: 0, teacherValidatedEdges: 0 },
  );
  assert.equal(input.raw.source && (input.raw.source as { sourceUrl: string }).sourceUrl, LIVE.source.sourceUrl);
});

test("the 44 existing codes keep their type, and each legacy_record matches the current graph exactly", () => {
  const reference = validateCurriculumPackage(loadCurriculumPackage(REFERENCE_PACKAGE)).package!;
  const current = new Map(reference.nodes.map((node) => [node.code, node]));
  const nodes = (workDocument().nodes as WorkNodeRecord[]).filter((node) => node.existing_node);
  assert.deepEqual(nodes.map((node) => node.code).sort(), [...LEGACY_CODES].sort());
  let relabelled = 0;
  for (const node of nodes) {
    const legacy = current.get(node.code)!;
    assert.equal(node.node_type, legacy.type, node.code);
    assert.deepEqual(
      [node.legacy_record.node_type, node.legacy_record.title, node.legacy_record.description, node.legacy_record.source_locator],
      [legacy.type, legacy.title, legacy.description, legacy.sourceLocator],
      node.code,
    );
    if (node.title !== legacy.title) relabelled++;
  }
  assert.equal(relabelled, 20);
});

test("the exact file does not pass validation: all 99 nodes are valid, 16 relationships are blocking", () => {
  const result = validateCurriculumPackage(loadCurriculumPackage(WORK_FILE));
  assert.equal(result.ok, false);
  assert.equal(result.package, null);
  assert.deepEqual(result.stats.nodes, { domain: 0, notion: 89, competency: 6, prerequisite: 4 });
  const codes = result.errors.map((issue) => issue.code);
  assert.equal(codes.filter((code) => code === "EDGE_TYPES").length, 6);
  assert.equal(codes.filter((code) => code === "EDGE_CONFLICT").length, 10);
  assert.equal(codes.length, 16);
  assert.ok(!codes.some((code) => code.startsWith("NODE_") || code === "TEXT_TOO_LONG" || code.startsWith("SOURCE")));

  const { disputed, undisputed } = splitWorkEdges();
  assert.equal(disputed.filter((edge) => edge.reason === "types").length, 6);
  assert.equal(disputed.filter((edge) => edge.reason === "pair").length, 20); // 10 pairs, both sides
  assert.equal(undisputed.length, 322);
  // Every error the validator reports points at a disputed edge.
  const disputedIndexes = new Set(disputed.map((edge) => edge.index));
  for (const issue of result.errors) {
    const index = Number(/#edges\[(\d+)\]/.exec(issue.at)?.[1]);
    assert.ok(disputedIndexes.has(index), issue.at);
  }
});

test("dry run of the exact file on the live replica is refused and writes nothing; fingerprint unchanged", async () => {
  assert.deepEqual(await legacyFingerprint(db), { nodes: 44, fingerprint: LIVE.fingerprint });
  const before = await tableSnapshot();
  const { conversion } = splitWorkEdges();
  const exact = workServerPackage(
    conversion.raw.edges.map(({ value }, index) => ({ index, ...(value as { from: string; to: string; relation: string }) })),
  );
  await assert.rejects(serverImport(exact, true), /several relationships declared for the same node pair/);
  await assert.rejects(serverImport(exact, false), /several relationships declared for the same node pair/);
  assert.deepEqual(await tableSnapshot(), before);
  assert.deepEqual(await legacyFingerprint(db), { nodes: 44, fingerprint: LIVE.fingerprint });
});

test("diagnostic: the undisputed 99-node graph imports in place, keeps the 44 live UUIDs, and re-imports as a no-op", async () => {
  const pkg = undisputedPackage();
  assert.equal(pkg.nodes.length, 99);
  assert.equal(pkg.edges.length, 322);

  const before = await tableSnapshot();
  const dry = await serverImport(pkg, true);
  assert.deepEqual(await tableSnapshot(), before);
  assert.deepEqual(dry.source, { created: false, updated: true });
  assert.deepEqual(dry.nodes, {
    inserted: 55,
    updated: 44,
    reactivated: 0,
    unchanged: 0,
    deactivated: 0,
    deactivatedStillReferenced: 0,
  });
  // The 8 legacy relationships involved in a disputed pair are not in the
  // undisputed subset, so the importer would remove them.
  assert.deepEqual(dry.edges, { inserted: 262, adopted: 0, unchanged: 60, released: 0, deleted: 8 });

  const committed = await serverImport(pkg, false);
  assert.deepEqual(committed.nodes, dry.nodes);
  assert.deepEqual(committed.edges, dry.edges);
  assert.deepEqual(await legacyFingerprint(db), { nodes: 44, fingerprint: LIVE.fingerprint });
  const { rows } = await db.query<{ total: number; active: number }>(
    "select count(*)::int as total, count(*) filter (where active)::int as active from public.curriculum_nodes",
  );
  assert.deepEqual(rows[0], { total: 99, active: 99 });

  const settled = await tableSnapshot();
  const again = await serverImport(pkg, false);
  assert.equal(again.changed, false);
  assert.deepEqual(await tableSnapshot(), settled);
});

test("diagnostic: after import the AI graph read exposes the 99 nodes with typed relationships", async () => {
  await serverImport(undisputedPackage(), false);
  await db.exec("savepoint graph_read");
  await db.exec("set local role authenticated");
  const { rows } = await db.query<{ graph: unknown }>(
    "select public.focus_curriculum_graph('MATH', array['SECONDE_GT']) as graph",
  );
  await db.exec("release savepoint graph_read");
  await db.exec("reset role");
  const index = buildCurriculumIndex(parseCurriculumGraphPayload(rows[0].graph));
  assert.equal(index.summaries.length, 99);
  assert.equal(index.mappableNotionIdsByCode.size, 89);
  for (const summary of index.summaries)
    for (const code of summary.competencies)
      assert.equal(index.nodeByCode.get(code)?.nodeType, "competency", `${summary.code} → ${code}`);

  // Every undisputed prerequisite and competency link of the document is readable.
  const { undisputed } = splitWorkEdges();
  for (const edge of undisputed) {
    const target = index.summaryByCode.get(edge.to)!;
    const source = index.summaryByCode.get(edge.from)!;
    if (edge.relation === "prerequisite_of") assert.ok(target.prerequisites.includes(edge.from));
    if (edge.relation === "part_of") assert.ok(source.parents.includes(edge.to));
    if (edge.relation === "supports")
      assert.ok((target.nodeType === "competency" ? source.competencies : source.supports).includes(edge.to));
  }
  assert.equal(index.nodeById.get(LIVE.nodes.find((node) => node.code === "MATH.ALG.DISTRIBUTIVITE")!.id)?.code, "MATH.ALG.DISTRIBUTIVITE");
});

// ---------------------------------------------------------------------------
// Disputed relationships: explicit, signed author decisions only
// ---------------------------------------------------------------------------

const DECISIONS_FILE = path.join(__dirname, "..", "curriculum", "work", "FOCUS_Maths_Seconde_2026-2027.decisions.json");

function loadedWork() {
  const input = loadCurriculumInput(WORK_FILE);
  assert.ok(input.work);
  return input.work;
}

test("the committed decisions file lists the 16 disputes of the exact file, all pending", () => {
  const work = loadedWork();
  assert.equal(work.fileSha256, WORK_FILE_SHA256);
  const committed = JSON.parse(readFileSync(DECISIONS_FILE, "utf8"));
  const regenerated = workDecisionsTemplate(work, work.document, "FOCUS_Maths_Seconde_2026-2027.json", work.fileSha256);
  assert.deepEqual(committed, JSON.parse(JSON.stringify(regenerated)));
  assert.equal(committed.status, "pending_author_decisions");
  const kinds: Record<string, number> = {};
  for (const decision of committed.decisions) kinds[decision.kind] = (kinds[decision.kind] ?? 0) + 1;
  assert.deepEqual(kinds, { support_and_prerequisite: 7, competency_support: 6, part_of_and_prerequisite: 3 });
  assert.ok(committed.decisions.every((decision: { keep: unknown; decidedBy: unknown }) => decision.keep === null && decision.decidedBy === null));
  // Same neutral split as the diagnostic helper used by the dry-run tests.
  assert.deepEqual(listWorkDisputes(work, work.document).undisputed, splitWorkEdges().undisputed.map((edge) => edge.index));
});

test("pending decisions change nothing: the exact file is still rejected on the same 16 relationships", () => {
  const work = loadedWork();
  const applied = applyWorkDecisions(work, work.document, JSON.parse(readFileSync(DECISIONS_FILE, "utf8")), work.fileSha256);
  assert.deepEqual(applied.issues, []);
  assert.deepEqual([applied.applied, applied.pending], [0, 16]);
  assert.equal(applied.conversion.raw.edges.length, 348);
  const result = validateCurriculumPackage(applied.conversion.raw);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 16);
});

test("decisions must match this exact file, a listed option, and be signed", () => {
  const work = loadedWork();
  const template = workDecisionsTemplate(work, work.document, "x.json", work.fileSha256);
  const stale = applyWorkDecisions(work, work.document, { ...template, workFileSha256: "0".repeat(64) }, work.fileSha256);
  assert.deepEqual(stale.issues.map((issue) => issue.code), ["WORK_DECISIONS_STALE"]);

  const invented = JSON.parse(JSON.stringify(template));
  invented.decisions[0].keep = invented.decisions[0].edges.map((edge: { index: number }) => edge.index); // keep both: not an option
  invented.decisions[0].decidedBy = "Professeur";
  assert.match(applyWorkDecisions(work, work.document, invented, work.fileSha256).issues[0].message, /aucune option proposée/);

  const unsigned = JSON.parse(JSON.stringify(template));
  unsigned.decisions[0].keep = unsigned.decisions[0].options[0].keep;
  assert.match(applyWorkDecisions(work, work.document, unsigned, work.fileSha256).issues[0].message, /decidedBy/);

  const missing = JSON.parse(JSON.stringify(template));
  missing.decisions.pop();
  assert.match(applyWorkDecisions(work, work.document, missing, work.fileSha256).issues[0].message, /Litige sans entrée/);
});

test("mechanism only — TEST-ONLY decisions (first option everywhere, not a curriculum choice) make the 99-node file importable on the live replica", async () => {
  const work = loadedWork();
  const decisions = JSON.parse(
    JSON.stringify(workDecisionsTemplate(work, work.document, "x.json", work.fileSha256)),
  );
  for (const decision of decisions.decisions) {
    decision.keep = decision.options[0].keep;
    decision.decidedBy = "test automatique — pas une décision pédagogique";
  }
  const applied = applyWorkDecisions(work, work.document, decisions, work.fileSha256);
  assert.deepEqual([applied.issues, applied.applied, applied.pending], [[], 16, 0]);
  const result = validateCurriculumPackage(applied.conversion.raw);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.package!.nodes.length, 99);
  assert.equal(result.package!.edges.length, 332);

  const before = await tableSnapshot();
  const dry = await serverImport(result.package, true);
  assert.deepEqual(await tableSnapshot(), before);
  assert.deepEqual(dry.nodes, { inserted: 55, updated: 44, reactivated: 0, unchanged: 0, deactivated: 0, deactivatedStillReferenced: 0 });
  assert.deepEqual(dry.edges, { inserted: 271, adopted: 0, unchanged: 61, released: 0, deleted: 7 });
  await serverImport(result.package, false);
  assert.deepEqual(await legacyFingerprint(db), { nodes: 44, fingerprint: LIVE.fingerprint });
  assert.equal((await serverImport(result.package, false)).changed, false);
});

// ---------------------------------------------------------------------------
// Codex review of 68c681d
// ---------------------------------------------------------------------------

test("P1: malformed Work entries are blocking errors, never silently dropped, and indexes stay aligned", () => {
  const document = workDocument();
  const edges = [...(document.edges as unknown[])];
  const nodes = [...(document.nodes as unknown[])];
  edges[5] = 42;
  nodes[3] = "pas un objet";
  const conversion = convertWorkCurriculum({ ...document, edges, nodes }, "malformed.json");
  assert.deepEqual(
    conversion.issues.filter((issue) => issue.code === "WORK_MALFORMED").map((issue) => issue.at),
    ["malformed.json#nodes[3]", "malformed.json#edges[5]"],
  );
  assert.equal(conversion.raw.edges.length, 347);
  assert.equal(conversion.raw.edges[5].at, "malformed.json#edges[6]");
  assert.equal(conversion.edgeSourceIndexes[5], 6);
  // Dispute indexes still point at the document's own positions (edge only
  // corrupted here, so that every competency node still exists).
  const edgeOnly = { ...document, edges };
  const competencyDisputes = listWorkDisputes(convertWorkCurriculum(edgeOnly, "malformed.json"), edgeOnly)
    .disputes.filter((dispute) => dispute.kind === "competency_support")
    .map((dispute) => dispute.edges[0].index);
  assert.deepEqual(competencyDisputes, [68, 69, 70, 71, 72, 73]);
});

test("P2: a decisions file cannot decide the same dispute twice", () => {
  const work = loadedWork();
  const decisions = JSON.parse(JSON.stringify(workDecisionsTemplate(work, work.document, "x.json", work.fileSha256)));
  const pair = decisions.decisions.find((decision: { kind: string }) => decision.kind === "support_and_prerequisite");
  pair.keep = pair.options[0].keep;
  pair.decidedBy = "Professeur A";
  decisions.decisions.push({ ...pair, keep: pair.options[1].keep, decidedBy: "Professeur B" });
  const applied = applyWorkDecisions(work, work.document, decisions, work.fileSha256);
  assert.match(applied.issues.map((issue) => issue.message).join("\n"), /décision en double/);
  assert.equal(applied.applied, 0);
  assert.equal(applied.conversion.raw.edges.length, 348); // nothing removed
});

test("P2: `validate --json` keeps stdout pure JSON for Work documents", () => {
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/curriculum.ts", "validate", WORK_FILE, "--json", "--decisions", DECISIONS_FILE],
    { cwd: path.join(__dirname, ".."), encoding: "utf8" },
  );
  assert.equal(run.status, 1);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errors.length, 16);
  assert.match(run.stderr, /Document Work/);
  assert.match(run.stderr, /Décisions .* 0 appliquée\(s\), 16 en attente/);
});
