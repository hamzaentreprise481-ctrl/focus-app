// The exact Work curriculum document (curriculum/work/FOCUS_Maths_Seconde_2026-2027.json)
// against the importer and an exact replica of the live curriculum tables.

import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { loadCurriculumInput, loadCurriculumPackage } from "../lib/curriculum/fs";
import { buildCurriculumIndex, parseCurriculumGraphPayload } from "../lib/curriculum/graph";
import { validateCurriculumPackage } from "../lib/curriculum/package";
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
  assert.deepEqual(dry.edges, { inserted: 262, deleted: 8, unchanged: 60, sharedWithOtherSources: 0 });

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
