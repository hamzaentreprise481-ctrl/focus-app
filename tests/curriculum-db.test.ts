// Runs the real migrations and the real SQL import function on PostgreSQL
// (PGlite). Each test runs inside a transaction that is rolled back.

import { after, before, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { loadCurriculumPackage } from "../lib/curriculum/fs";
import {
  buildCurriculumIndex,
  parseCurriculumGraphPayload,
} from "../lib/curriculum/graph";
import {
  canonicalCurriculumText,
  hashCurriculumPackage,
  parseJsonCurriculumPackage,
  validateCurriculumPackage,
  validateExportedCurriculum,
} from "../lib/curriculum/package";
import { renderCurriculumImportMigration } from "../lib/curriculum/sql";
import type { CanonicalCurriculumPackage } from "../lib/curriculum/types";
import {
  PREMIERE_URL,
  SECONDE_TEST_URL,
  clone,
  premierePackage,
  secondePackage,
  type TestPackage,
} from "./fixtures/curriculum";
import { createMigratedDatabase } from "./helpers/pg";

const SEEDED_URL = "https://www.education.gouv.fr/bo/2026/Hebdo14/MENE2602914A";
const REFERENCE_PACKAGE = path.join(
  __dirname,
  "..",
  "curriculum",
  "packages",
  "math",
  "seconde-gt-2026-2027",
);

let db: PGlite;

before(async () => {
  db = await createMigratedDatabase();
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

type Role = "postgres" | "service_role" | "authenticated" | "anon";

async function call<T = Record<string, unknown>>(
  role: Role,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.exec("savepoint focus_call");
  try {
    if (role !== "postgres") await db.exec(`set local role ${role}`);
    const result = await db.query<T>(sql, params);
    await db.exec("reset role");
    await db.exec("release savepoint focus_call");
    return result.rows;
  } catch (error) {
    await db.exec("rollback to savepoint focus_call");
    throw error;
  }
}

function canonical(pkg: TestPackage, context: CanonicalCurriculumPackage[] = []) {
  const result = validateCurriculumPackage(
    parseJsonCurriculumPackage(JSON.stringify(pkg), "test.json"),
    {
      externalNodes: context.flatMap((item) => item.nodes),
      externalEdges: context.flatMap((item) => item.edges),
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result.package as CanonicalCurriculumPackage;
}

interface ImportReport {
  dryRun: boolean;
  changed: boolean;
  sourceId: string;
  source: { created: boolean; updated: boolean };
  nodes: Record<
    "inserted" | "updated" | "reactivated" | "unchanged" | "deactivated" | "deactivatedStillReferenced",
    number
  >;
  edges: Record<"inserted" | "adopted" | "unchanged" | "released" | "deleted", number>;
}

async function importPackage(
  pkg: unknown,
  options: { dryRun?: boolean; allowMassDeactivation?: boolean; role?: Role } = {},
): Promise<ImportReport> {
  const rows = await call<{ report: ImportReport }>(
    options.role ?? "service_role",
    "select public.focus_import_curriculum($1::jsonb, $2, $3) as report",
    [JSON.stringify(pkg), options.dryRun ?? false, options.allowMassDeactivation ?? false],
  );
  return rows[0].report;
}

async function importError(pkg: unknown, options: Parameters<typeof importPackage>[1] = {}) {
  try {
    await importPackage(pkg, options);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail("the import should have been refused");
}

// Physical row identity: an UPDATE, even to identical values, creates a new
// tuple with a new ctid. Equal snapshots prove that nothing was rewritten.
async function snapshot() {
  const [row] = await call<{ value: unknown }>(
    "postgres",
    `select jsonb_build_object(
       'sources', (select jsonb_agg(jsonb_build_array(ctid::text, id, title) order by id) from public.curriculum_sources),
       'nodes', (select jsonb_agg(jsonb_build_array(ctid::text, id, code, active) order by id) from public.curriculum_nodes),
       'edges', (select jsonb_agg(jsonb_build_array(ctid::text, from_node_id, to_node_id, relation) order by from_node_id, to_node_id) from public.curriculum_edges),
       'declarations', (select jsonb_agg(jsonb_build_array(ctid::text, from_node_id, to_node_id, relation, source_id) order by from_node_id, to_node_id, source_id) from public.curriculum_edge_declarations),
       'runs', (select count(*) from public.curriculum_import_runs)
     ) as value`,
  );
  return row.value;
}

async function count(sql: string, params: unknown[] = []) {
  const [row] = await call<{ n: number }>("postgres", `select (${sql})::int as n`, params);
  return row.n;
}

async function graph(levels: string[] | null, role: Role = "authenticated") {
  const [row] = await call<{ graph: unknown }>(
    role,
    "select public.focus_curriculum_graph('MATH', $1::text[]) as graph",
    [levels],
  );
  return parseCurriculumGraphPayload(row.graph);
}

async function referenceNode(code: string) {
  // Minimal teacher-facing data pointing at a curriculum node.
  const [row] = await call<{ id: string }>(
    "postgres",
    `with u as (insert into auth.users default values returning id),
          s as (insert into public.schools(name) values ('École test') returning id),
          c as (insert into public.classes(school_id, name, level) select s.id, 'Seconde 1', 'Seconde' from s returning id, school_id),
          sub as (insert into public.subjects(name, code) values ('Mathématiques', 'MATH') returning id),
          a as (insert into public.assessments(school_id, class_id, subject_id, teacher_id, title, date)
                select c.school_id, c.id, sub.id, u.id, 'Évaluation', current_date from c, sub, u returning id),
          q as (insert into public.assessment_questions(assessment_id, position, prompt, correction_text)
                select a.id, 1, 'Question', 'Corrigé' from a returning id)
     insert into public.question_curriculum_nodes(question_id, curriculum_node_id, relation)
     select q.id, n.id, 'assesses' from q, public.curriculum_nodes n where n.code = $1
     returning curriculum_node_id as id`,
    [code],
  );
  return row.id;
}

// ---------------------------------------------------------------------------

test("all migrations apply on PostgreSQL and keep the seeded 44-node graph, each edge declared by its source", async () => {
  assert.equal(await count("select count(*) from public.curriculum_nodes where active"), 44);
  assert.equal(await count("select count(*) from public.curriculum_edges"), 68);
  assert.equal(
    await count(
      `select count(*) from public.curriculum_edges e
       join public.curriculum_nodes n on n.id = e.from_node_id
       join public.curriculum_edge_declarations d
         on d.from_node_id = e.from_node_id and d.to_node_id = e.to_node_id and d.relation = e.relation and d.source_id = n.source_id`,
    ),
    68,
  );
  assert.equal(await count("select count(*) from public.curriculum_edge_declarations"), 68);
});

test("the committed reference package is exactly the seeded graph: importing it changes nothing", async () => {
  const reference = validateCurriculumPackage(loadCurriculumPackage(REFERENCE_PACKAGE));
  assert.ok(reference.package);

  const [exported] = await call<{ pkg: unknown }>(
    "service_role",
    "select public.focus_export_curriculum($1) as pkg",
    [SEEDED_URL],
  );
  const fromDatabase = validateExportedCurriculum(exported.pkg, "export");
  assert.equal(fromDatabase.hash, reference.hash);

  const before = await snapshot();
  const report = await importPackage(reference.package);
  assert.equal(report.changed, false);
  assert.deepEqual(report.nodes, {
    inserted: 0,
    updated: 0,
    reactivated: 0,
    unchanged: 44,
    deactivated: 0,
    deactivatedStillReferenced: 0,
  });
  assert.deepEqual(report.edges, { inserted: 0, adopted: 0, unchanged: 68, released: 0, deleted: 0 });
  assert.deepEqual(await snapshot(), before);
});

test("a new package is imported, audited once, and re-importing it rewrites no row", async () => {
  const pkg = canonical(secondePackage());
  const first = await importPackage(pkg);
  assert.equal(first.changed, true);
  assert.equal(first.source.created, true);
  assert.equal(first.nodes.inserted, 7);
  assert.equal(first.edges.inserted, 9);
  assert.equal(await count("select count(*) from public.curriculum_import_runs"), 1);

  const before = await snapshot();
  const second = await importPackage(pkg);
  assert.equal(second.changed, false);
  assert.equal(second.nodes.unchanged, 7);
  assert.equal(second.edges.unchanged, 9);
  assert.deepEqual(await snapshot(), before);
});

test("dry run is the default and reports the exact diff without writing anything", async () => {
  const before = await snapshot();
  const [row] = await call<{ report: ImportReport }>(
    "service_role",
    "select public.focus_import_curriculum($1::jsonb) as report",
    [JSON.stringify(canonical(secondePackage()))],
  );
  assert.equal(row.report.dryRun, true);
  assert.equal(row.report.changed, true);
  assert.equal(row.report.nodes.inserted, 7);
  assert.equal(row.report.edges.inserted, 9);
  assert.deepEqual(await snapshot(), before);
  assert.equal(await count("select count(*) from public.curriculum_sources where source_url = $1", [SECONDE_TEST_URL]), 0);
});

test("an updated package applies only its diff and returning nodes are reactivated", async () => {
  await importPackage(canonical(secondePackage()));

  const updated = clone(secondePackage());
  updated.nodes = updated.nodes.filter((node) => node.code !== "MATH.T2.ALG.FACTORISATION");
  updated.edges = [];
  updated.nodes.find((node) => node.code === "MATH.T2.ALG.EQUATION")!.title = "Équations du premier degré";
  updated.nodes.push({
    code: "MATH.T2.ALG.INEQUATION",
    type: "notion",
    title: "Inéquation du premier degré",
    sourceLocator: "Algèbre, p. 3",
    prerequisites: ["MATH.T2.ALG.EQUATION"],
    competencies: ["MATH.T2.COMP.RAISONNER"],
  });
  const report = await importPackage(canonical(updated));
  assert.deepEqual(report.nodes, {
    inserted: 1,
    updated: 1,
    reactivated: 0,
    unchanged: 5,
    deactivated: 1,
    deactivatedStillReferenced: 0,
  });
  // FACTORISATION's part_of + supports edges and the notion→notion support go.
  assert.deepEqual(report.edges, { inserted: 2, adopted: 0, unchanged: 6, released: 0, deleted: 3 });
  assert.equal(
    await count("select count(*) from public.curriculum_nodes where code = 'MATH.T2.ALG.FACTORISATION' and not active"),
    1,
  );

  const restored = await importPackage(canonical(secondePackage()), { allowMassDeactivation: false });
  assert.equal(restored.nodes.reactivated, 1);
  assert.equal(restored.nodes.deactivated, 1); // INEQUATION is gone again
  assert.equal(await count("select count(*) from public.curriculum_nodes where code = 'MATH.T2.ALG.FACTORISATION' and active"), 1);
});

test("a truncated package cannot silently deactivate a programme", async () => {
  const reference = validateCurriculumPackage(loadCurriculumPackage(REFERENCE_PACKAGE)).package!;
  const truncated = clone(reference);
  truncated.nodes = truncated.nodes.slice(0, 20);
  const kept = new Set(truncated.nodes.map((node) => node.code));
  truncated.edges = truncated.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to));

  const before = await snapshot();
  const message = await importError(truncated);
  assert.match(message, /24 of 44 active nodes would be deactivated, above the 20 percent limit/);
  assert.deepEqual(await snapshot(), before);

  const forced = await importPackage(truncated, { allowMassDeactivation: true, dryRun: true });
  assert.equal(forced.nodes.deactivated, 24);
  assert.deepEqual(await snapshot(), before);
});

test("deactivated nodes are never deleted and still-referenced ones are reported", async () => {
  await importPackage(canonical(secondePackage()));
  const nodeId = await referenceNode("MATH.T2.ALG.FACTORISATION");

  const without = clone(secondePackage());
  without.nodes = without.nodes.filter((node) => node.code !== "MATH.T2.ALG.FACTORISATION");
  without.edges = [];
  const report = await importPackage(canonical(without));
  assert.equal(report.nodes.deactivated, 1);
  assert.equal(report.nodes.deactivatedStillReferenced, 1);
  assert.equal(await count("select count(*) from public.curriculum_nodes where id = $1 and not active", [nodeId]), 1);
  assert.equal(await count("select count(*) from public.question_curriculum_nodes where curriculum_node_id = $1", [nodeId]), 1);
});

test("a node referenced by teacher data cannot change type", async () => {
  await importPackage(canonical(secondePackage()));
  await referenceNode("MATH.T2.ALG.FACTORISATION");
  const retyped = clone(secondePackage());
  const factorisation = retyped.nodes.find((node) => node.code === "MATH.T2.ALG.FACTORISATION")!;
  factorisation.type = "domain";
  delete factorisation.partOf;
  delete factorisation.competencies;
  retyped.edges = [];
  assert.match(await importError(canonical(retyped)), /cannot change the type of referenced nodes: MATH\.T2\.ALG\.FACTORISATION/);
});

test("a package cannot take over nodes that belong to another source", async () => {
  const hijack = clone(secondePackage());
  hijack.nodes.push({
    code: "MATH.ALG.DISTRIBUTIVITE",
    type: "notion",
    title: "Autre définition",
    sourceLocator: "x",
    competencies: ["MATH.T2.COMP.CALCULER"],
  });
  const before = await snapshot();
  assert.match(await importError(canonical(hijack)), /already owned by another source: MATH\.ALG\.DISTRIBUTIVITE/);
  assert.deepEqual(await snapshot(), before);
});

test("cross-level prerequisites are imported and exposed as out-of-scope context", async () => {
  const seconde = canonical(secondePackage());
  await importPackage(seconde);
  const premiere = canonical(premierePackage(), [seconde]);
  const report = await importPackage(premiere);
  assert.equal(report.edges.inserted, 2);

  const payload = await graph(["PREMIERE_SPE"]);
  assert.deepEqual(
    payload.nodes.map((node) => [node.code, node.inScope]),
    [
      ["MATH.P1.ALG.SECOND_DEGRE", true],
      ["MATH.P1.COMP.CALCULER", true],
      ["MATH.T2.ALG.EQUATION", false],
    ],
  );
  const index = buildCurriculumIndex(payload);
  assert.deepEqual(index.summaryByCode.get("MATH.P1.ALG.SECOND_DEGRE")?.prerequisites, ["MATH.T2.ALG.EQUATION"]);
  assert.deepEqual([...index.mappableNotionIdsByCode.keys()], ["MATH.P1.ALG.SECOND_DEGRE"]);

  // Re-importing the seconde package keeps the première-owned edge.
  const again = await importPackage(seconde);
  assert.equal(again.changed, false);
  assert.equal(
    await count(
      "select count(*) from public.curriculum_edge_declarations e join public.curriculum_sources s on s.id = e.source_id where s.source_url = $1 and e.relation = 'prerequisite_of'",
      [PREMIERE_URL],
    ),
    1,
  );
});

test("the database rejects cycles and pair conflicts across sources even without client validation", async () => {
  await importPackage(canonical(secondePackage()));
  const premiere = canonical(premierePackage(), [canonical(secondePackage())]);

  const cyclic = clone(premiere);
  cyclic.edges.push({
    from: "MATH.P1.ALG.SECOND_DEGRE",
    to: "MATH.T2.ALG.DISTRIBUTIVITE",
    relation: "prerequisite_of",
  });
  const before = await snapshot();
  assert.match(await importError(cyclic), /cycle detected through/);
  assert.deepEqual(await snapshot(), before);

  const conflicting = clone(premiere);
  conflicting.edges.push({
    from: "MATH.P1.ALG.SECOND_DEGRE",
    to: "MATH.T2.ALG.EQUATION",
    relation: "supports",
  });
  assert.match(await importError(conflicting), /several relationships declared for the same node pair/);

  const reversedExisting = clone(premiere);
  reversedExisting.nodes.push({ code: "MATH.P1.ALG.X", type: "notion", title: "X", description: null, sourceLocator: "x" });
  reversedExisting.edges.push({ from: "MATH.P1.ALG.X", to: "MATH.T2.ALG.DISTRIBUTIVITE", relation: "supports" });
  await importPackage(reversedExisting);
  const clash = clone(canonical(secondePackage()));
  clash.edges.push({ from: "MATH.T2.ALG.DISTRIBUTIVITE", to: "MATH.P1.ALG.X", relation: "supports" });
  assert.match(await importError(clash), /conflicts with the existing graph/);
});

test("the database re-validates packages that bypass the TypeScript validator", async () => {
  const base = canonical(secondePackage());
  const cases: Array<[string, (pkg: CanonicalCurriculumPackage) => void, RegExp]> = [
    ["format", (pkg) => ((pkg as { formatVersion: number }).formatVersion = 2), /unsupported formatVersion/],
    ["url", (pkg) => (pkg.source.sourceUrl = "https://manuel.example.com/x"), /official domain/],
    ["school year", (pkg) => (pkg.source.schoolYear = "2026-2099"), /invalid schoolYear \(expected two consecutive years/],
    ["spoofed url", (pkg) => (pkg.source.sourceUrl = "https://education.gouv.fr.example.com/x"), /official domain/],
    ["code", (pkg) => (pkg.nodes[0].code = "math.lower"), /invalid nodes: math\.lower/],
    ["subject", (pkg) => (pkg.nodes[0].code = "PHYS.X.Y"), /invalid nodes: PHYS\.X\.Y/],
    ["title", (pkg) => (pkg.nodes[0].title = "x".repeat(161)), /invalid nodes/],
    ["duplicate node", (pkg) => pkg.nodes.push({ ...pkg.nodes[0] }), /duplicate node codes/],
    ["duplicate edge", (pkg) => pkg.edges.push({ ...pkg.edges[0] }), /duplicate edges/],
    ["self", (pkg) => pkg.edges.push({ from: pkg.nodes[0].code, to: pkg.nodes[0].code, relation: "supports" }), /invalid edges/],
    ["unknown", (pkg) => pkg.edges.push({ from: "MATH.T2.ALG.EQUATION", to: "MATH.NOPE.X", relation: "supports" }), /unknown or inactive nodes: MATH\.NOPE\.X/],
    [
      "types",
      (pkg) => pkg.edges.push({ from: "MATH.T2.ALG.FACTORISATION", to: "MATH.T2.COMP.RAISONNER", relation: "prerequisite_of" }),
      /not allowed between these node types/,
    ],
    [
      "foreign",
      (pkg) => pkg.edges.push({ from: "MATH.ALG.IDENTITES", to: "MATH.ALG.FORME_ADAPTEE", relation: "supports" }),
      /must touch at least one node of the imported source/,
    ],
  ];
  const before = await snapshot();
  for (const [label, mutate, expected] of cases) {
    const pkg = clone(base);
    mutate(pkg);
    assert.match(await importError(pkg), expected, label);
  }
  assert.deepEqual(await snapshot(), before);
});

test("only service_role can import or export; teachers can read the graph but not the audit", async () => {
  const pkg = canonical(secondePackage());
  for (const role of ["authenticated", "anon"] as const) {
    assert.match(await importError(pkg, { role }), /permission denied for function focus_import_curriculum/);
    await assert.rejects(
      call(role, "select public.focus_export_curriculum($1)", [SEEDED_URL]),
      /permission denied for function focus_export_curriculum/,
    );
  }
  await assert.rejects(call("anon", "select public.focus_curriculum_graph('MATH', null)"), /permission denied/);
  assert.equal((await graph(null, "authenticated")).nodes.length, 44);

  await importPackage(pkg);
  assert.deepEqual(await call("authenticated", "select * from public.curriculum_import_runs").catch(() => "denied"), "denied");
});

test("the graph read is deterministic, level-scoped, uncapped and exposes typed competencies", async () => {
  const seeded = await graph(["SECONDE_GT"]);
  assert.equal(seeded.nodes.length, 44);
  assert.equal(seeded.edges.length, 68);
  const codes = seeded.nodes.map((node) => node.code);
  assert.deepEqual(codes, [...codes].sort());
  assert.deepEqual(await graph(["SECONDE_GT"]), seeded);
  assert.deepEqual((await graph(["TERMINALE_SPE"])).nodes, []);

  const index = buildCurriculumIndex(seeded);
  const distributivite = index.summaryByCode.get("MATH.ALG.DISTRIBUTIVITE");
  // Before this change the AI saw notions listed as "competencies".
  assert.deepEqual(distributivite?.competencies, ["MATH.COMP.CALCULER"]);
  assert.deepEqual(distributivite?.supports, ["MATH.ALG.FACTORISATION_SIMPLE", "MATH.ALG.FORME_ADAPTEE"]);
  assert.deepEqual(distributivite?.parents, ["MATH.ALG.EXPRESSIONS"]);
  assert.deepEqual(distributivite?.prerequisites, [
    "MATH.ALG.CALCUL_LITTERAL_ELEMENTAIRE",
    "MATH.PREREQ.CYCLE4.DISTRIBUTIVITE",
  ]);
  for (const summary of index.summaries)
    for (const code of summary.competencies)
      assert.equal(index.nodeByCode.get(code)?.nodeType, "competency");
  assert.equal(index.mappableNotionIdsByCode.size, 34);

  // A deactivated node disappears from the graph and from the edges.
  await call("postgres", "update public.curriculum_nodes set active = false where code = 'MATH.ALG.FORME_ADAPTEE'");
  const after = buildCurriculumIndex(await graph(["SECONDE_GT"]));
  assert.equal(after.nodeByCode.has("MATH.ALG.FORME_ADAPTEE"), false);
  assert.deepEqual(after.summaryByCode.get("MATH.ALG.DISTRIBUTIVITE")?.supports, ["MATH.ALG.FACTORISATION_SIMPLE"]);

  // More than PostgREST's default 1000-row cap still arrives in one value.
  const big = clone(secondePackage());
  for (let i = 0; i < 1200; i++)
    big.nodes.push({
      code: `MATH.T2.GEN.N${String(i).padStart(4, "0")}`,
      type: "notion",
      title: `Notion générée ${i}`,
      sourceLocator: "test",
      competencies: ["MATH.T2.COMP.CALCULER"],
    });
  await importPackage(canonical(big));
  const large = await graph(["SECONDE_TEST"]);
  assert.equal(large.nodes.length, 1207);
  assert.equal(large.edges.length, 1209);
});

test("a generated migration applies, and applying it twice changes nothing", async () => {
  const sql = renderCurriculumImportMigration(canonical(secondePackage()));
  await call("postgres", sql);
  assert.equal(await count("select count(*) from public.curriculum_nodes where code like 'MATH.T2.%'"), 7);
  const before = await snapshot();
  await call("postgres", sql);
  assert.deepEqual(await snapshot(), before);
});

test("database constraints guard nodes and pairs even outside the importer", async () => {
  const [source] = await call<{ id: string }>(
    "postgres",
    "select id from public.curriculum_sources where source_url = $1",
    [SEEDED_URL],
  );
  await assert.rejects(
    call(
      "postgres",
      "insert into public.curriculum_nodes(source_id, code, node_type, title, source_locator) values ($1, 'math.bad', 'notion', 'x', 'x')",
      [source.id],
    ),
    /curriculum_nodes_code_format/,
  );
  await assert.rejects(
    call(
      "postgres",
      "insert into public.curriculum_nodes(source_id, code, node_type, title, source_locator) values ($1, 'MATH.OK.LONG', 'notion', $2, 'x')",
      [source.id, "x".repeat(400)],
    ),
    /curriculum_nodes_text_lengths/,
  );
  // Reverse of an existing edge (MATH.ALG.EXPRESSIONS → MATH.ALG.EQUATIONS).
  await assert.rejects(
    call(
      "postgres",
      `insert into public.curriculum_edges(from_node_id, to_node_id, relation)
       select t.id, f.id, 'supports' from public.curriculum_nodes f, public.curriculum_nodes t
       where f.code = 'MATH.ALG.EXPRESSIONS' and t.code = 'MATH.ALG.EQUATIONS'`,
    ),
    /uq_curriculum_edges_node_pair/,
  );
  // An edge nobody declares cannot be committed (checked at commit time).
  await db.exec("savepoint undeclared");
  await db.exec(
    `insert into public.curriculum_edges(from_node_id, to_node_id, relation)
     select f.id, t.id, 'supports' from public.curriculum_nodes f, public.curriculum_nodes t
     where f.code = 'MATH.NUM.INTERVALLES' and t.code = 'MATH.COMP.REPRESENTER'`,
  );
  await assert.rejects(db.exec("set constraints all immediate"), /curriculum edge has no declaring source/);
  await db.exec("rollback to savepoint undeclared");
  // Nor can the last declaration of an existing edge be removed on its own.
  await db.exec("savepoint orphan");
  await db.exec(
    `delete from public.curriculum_edge_declarations d using public.curriculum_nodes f
     where f.id = d.from_node_id and f.code = 'MATH.ALG.EXPRESSIONS' and d.relation = 'prerequisite_of'`,
  );
  await assert.rejects(db.exec("set constraints all immediate"), /curriculum edge has no declaring source/);
  await db.exec("rollback to savepoint orphan");
});

async function seededIdsByCode() {
  const rows = await call<{ code: string; id: string }>(
    "postgres",
    `select n.code, n.id from public.curriculum_nodes n
     join public.curriculum_sources s on s.id = n.source_id
     where s.source_url = $1 order by n.code`,
    [SEEDED_URL],
  );
  return new Map(rows.map((row) => [row.code, row.id]));
}

test("the 44 seeded node UUIDs are preserved through re-import, extension, edits and deactivation cycles", async () => {
  const seeded = await seededIdsByCode();
  assert.equal(seeded.size, 44);
  const nodeId = await referenceNode("MATH.ALG.DISTRIBUTIVITE");
  assert.equal(nodeId, seeded.get("MATH.ALG.DISTRIBUTIVITE"));

  const reference = validateCurriculumPackage(loadCurriculumPackage(REFERENCE_PACKAGE)).package!;
  assert.equal((await importPackage(reference)).changed, false);

  // A fuller programme: new notions, one relabelled node, new relationships.
  const extended = clone(reference);
  extended.nodes.push(
    { code: "MATH.ALG.IDENTITES_APPLICATIONS", type: "notion", title: "Applications des identités", description: null, sourceLocator: "Algèbre" },
    { code: "MATH.GEO.PYTHAGORE_REPERE", type: "notion", title: "Distance dans un repère", description: null, sourceLocator: "Géométrie" },
  );
  extended.nodes.sort((a, b) => (a.code < b.code ? -1 : 1));
  extended.nodes.find((node) => node.code === "MATH.GEO.VECTEURS")!.title = "Vecteurs du plan (coordonnées)";
  extended.edges.push(
    { from: "MATH.ALG.IDENTITES", to: "MATH.ALG.IDENTITES_APPLICATIONS", relation: "prerequisite_of" },
    { from: "MATH.ALG.IDENTITES_APPLICATIONS", to: "MATH.COMP.CALCULER", relation: "supports" },
    { from: "MATH.GEO.PYTHAGORE_REPERE", to: "MATH.COMP.REPRESENTER", relation: "supports" },
  );
  const grown = await importPackage(extended);
  assert.deepEqual(grown.nodes, {
    inserted: 2,
    updated: 1,
    reactivated: 0,
    unchanged: 43,
    deactivated: 0,
    deactivatedStillReferenced: 0,
  });
  assert.deepEqual(grown.edges, { inserted: 3, adopted: 0, unchanged: 68, released: 0, deleted: 0 });

  // Back to the reference: the two new notions are deactivated, not deleted,
  // then a second extension reactivates them under their first UUIDs.
  const [added] = await call<{ ids: string[] }>(
    "postgres",
    "select array_agg(id order by code) as ids from public.curriculum_nodes where code in ('MATH.ALG.IDENTITES_APPLICATIONS', 'MATH.GEO.PYTHAGORE_REPERE')",
  );
  const back = await importPackage(reference);
  assert.equal(back.nodes.deactivated, 2);
  assert.equal(back.nodes.updated, 1);
  const again = await importPackage(extended);
  assert.equal(again.nodes.reactivated, 2);
  assert.equal(again.nodes.inserted, 0);
  const [readded] = await call<{ ids: string[] }>(
    "postgres",
    "select array_agg(id order by code) as ids from public.curriculum_nodes where code in ('MATH.ALG.IDENTITES_APPLICATIONS', 'MATH.GEO.PYTHAGORE_REPERE')",
  );
  assert.deepEqual(readded.ids, added.ids);

  assert.deepEqual(
    [...(await seededIdsByCode())].filter(([code]) => seeded.has(code)),
    [...seeded],
  );
  assert.equal(
    await count("select count(*) from public.question_curriculum_nodes where curriculum_node_id = $1", [nodeId]),
    1,
  );
});

test("a JSON package file on disk imports end to end, then re-imports as a no-op", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "focus-curriculum-"));
  try {
    const file = path.join(dir, "seconde-test.json");
    writeFileSync(file, JSON.stringify(secondePackage(), null, 2));
    const loaded = validateCurriculumPackage(loadCurriculumPackage(file));
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));

    const first = await importPackage(loaded.package);
    assert.equal(first.nodes.inserted, 7);
    assert.equal(first.edges.inserted, 9);
    const ids = await call<{ code: string; id: string }>(
      "postgres",
      "select code, id from public.curriculum_nodes where code like 'MATH.T2.%' order by code",
    );

    const before = await snapshot();
    const second = await importPackage(validateCurriculumPackage(loadCurriculumPackage(file)).package);
    assert.equal(second.changed, false);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      await call("postgres", "select code, id from public.curriculum_nodes where code like 'MATH.T2.%' order by code"),
      ids,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applying the importer migration to the existing database keeps the 44 node rows untouched", async () => {
  const migration = "20260926120000_curriculum_import_v1.sql";
  const previous = await createMigratedDatabase({ upTo: "20260926003500_supersede_edited_analysis_runs.sql" });
  try {
    const nodes = async () =>
      (
        await previous.query<{ row: string }>(
          "select code || ' ' || id || ' ' || ctid::text || ' ' || active as row from public.curriculum_nodes order by code",
        )
      ).rows.map((item) => item.row);
    const before = await nodes();
    assert.equal(before.length, 44);
    await previous.exec(readFileSync(path.join(__dirname, "..", "supabase", "migrations", migration), "utf8"));
    assert.deepEqual(await nodes(), before);
    const [edges] = (
      await previous.query<{ total: number; declared: number }>(
        `select count(*)::int as total,
                count(*) filter (where exists (
                  select 1 from public.curriculum_edge_declarations d
                  where d.from_node_id = e.from_node_id and d.to_node_id = e.to_node_id and d.relation = e.relation))::int as declared
         from public.curriculum_edges e`,
      )
    ).rows;
    assert.deepEqual(edges, { total: 68, declared: 68 });
  } finally {
    await previous.close();
  }
});

// Codex P1 (PR #6): a relationship declared by several sources must survive
// until the last of them stops declaring it.
test("a relationship shared by two sources survives until its last declaring source removes it", async () => {
  const seconde = canonical(secondePackage());
  await importPackage(seconde);
  const premiere = canonical(premierePackage(), [seconde]);
  const shared = { from: "MATH.T2.ALG.EQUATION", to: "MATH.P1.ALG.SECOND_DEGRE", relation: "prerequisite_of" as const };
  assert.ok(premiere.edges.some((edge) => edge.from === shared.from && edge.to === shared.to));
  assert.equal((await importPackage(premiere)).edges.inserted, 2);

  // Seconde now declares the same relationship: it is adopted, not duplicated.
  const secondeWithShared = clone(seconde);
  secondeWithShared.edges.push(shared);
  const adopted = await importPackage(secondeWithShared);
  assert.deepEqual(adopted.edges, { inserted: 0, adopted: 1, unchanged: 9, released: 0, deleted: 0 });
  assert.equal((await importPackage(secondeWithShared)).changed, false);

  const sharedEdgeCount = () =>
    count(
      `select count(*) from public.curriculum_edges e
       join public.curriculum_nodes f on f.id = e.from_node_id
       join public.curriculum_nodes t on t.id = e.to_node_id
       where f.code = $1 and t.code = $2 and e.relation = 'prerequisite_of'`,
      [shared.from, shared.to],
    );
  const exported = async (url: string) => {
    const [row] = await call<{ pkg: { package: CanonicalCurriculumPackage } }>(
      "service_role",
      "select public.focus_export_curriculum($1) as pkg",
      [url],
    );
    return row.pkg.package.edges.some((edge) => edge.from === shared.from && edge.to === shared.to);
  };
  assert.equal(await exported(PREMIERE_URL), true);
  assert.equal(await exported(SECONDE_TEST_URL), true);

  // Première stops declaring it: released, but the edge stays for Seconde.
  const premiereWithout = clone(premiere);
  premiereWithout.edges = premiereWithout.edges.filter((edge) => !(edge.from === shared.from && edge.to === shared.to));
  const released = await importPackage(premiereWithout);
  assert.deepEqual(released.edges, { inserted: 0, adopted: 0, unchanged: 1, released: 1, deleted: 0 });
  assert.equal(await sharedEdgeCount(), 1);
  assert.equal(await exported(PREMIERE_URL), false);
  assert.equal(await exported(SECONDE_TEST_URL), true);
  const index = buildCurriculumIndex(await graph(["PREMIERE_SPE"]));
  assert.deepEqual(index.summaryByCode.get("MATH.P1.ALG.SECOND_DEGRE")?.prerequisites, [shared.from]);

  // The last declaring source removes it: now the edge is deleted.
  const gone = await importPackage(seconde);
  assert.deepEqual(gone.edges, { inserted: 0, adopted: 0, unchanged: 9, released: 0, deleted: 1 });
  assert.equal(await sharedEdgeCount(), 0);
});

// Codex P2 (PR #6): the 20 percent guard also protects small programmes.
test("mass-deactivation guard enforces 20 percent exactly, including small programmes", async () => {
  const small = (count: number) => {
    const pkg = clone(secondePackage());
    pkg.source.sourceUrl = "https://www.education.gouv.fr/bo/test/petit-programme";
    pkg.source.levelCode = "SECONDE_PETIT";
    pkg.nodes = Array.from({ length: count }, (_, i) => ({
      code: `MATH.S5.N${i}`,
      type: "notion",
      title: `Notion ${i}`,
      sourceLocator: "Test",
    }));
    pkg.edges = [];
    return canonical(pkg);
  };
  await importPackage(small(5));
  // 2 of 5 = 40 percent: refused (the previous floor of 2 let this through).
  assert.match(await importError(small(3)), /2 of 5 active nodes would be deactivated, above the 20 percent limit/);
  assert.equal((await importPackage(small(3), { allowMassDeactivation: true, dryRun: true })).nodes.deactivated, 2);
  // 1 of 5 = exactly 20 percent: allowed.
  assert.equal((await importPackage(small(4))).nodes.deactivated, 1);
  // 1 of 4 = 25 percent: refused.
  assert.match(await importError(small(3)), /1 of 4 active nodes would be deactivated/);
});

// ---------------------------------------------------------------------------
// Codex review of b6f16ee (PR #6)
// ---------------------------------------------------------------------------

async function secondeAndPremiere() {
  const seconde = canonical(secondePackage());
  await importPackage(seconde);
  const premiere = canonical(premierePackage(), [seconde]);
  await importPackage(premiere);
  return { seconde, premiere };
}

test("P1: a cross-level package exports and validates without extra context", async () => {
  await secondeAndPremiere();
  const [row] = await call<{ payload: { package: CanonicalCurriculumPackage; externalNodes: unknown[] } }>(
    "service_role",
    "select public.focus_export_curriculum($1) as payload",
    [PREMIERE_URL],
  );
  assert.deepEqual(row.payload.externalNodes, [{ code: "MATH.T2.ALG.EQUATION", type: "notion" }]);
  // Before: context-free validation reported EDGE_UNKNOWN_NODE and aborted the export.
  assert.deepEqual(
    validateCurriculumPackage(parseJsonCurriculumPackage(JSON.stringify(row.payload.package), "export")).errors.map((issue) => issue.code),
    ["EDGE_UNKNOWN_NODE"],
  );
  const exported = validateExportedCurriculum(row.payload, "export");
  assert.equal(exported.ok, true, JSON.stringify(exported.errors));
  assert.deepEqual(exported.package, canonical(premierePackage(), [canonical(secondePackage())]));
});

test("P1: a node used by another source's relationships cannot be deactivated", async () => {
  const { seconde, premiere } = await secondeAndPremiere();
  // Seconde drops MATH.T2.ALG.EQUATION, which Première's prerequisite uses.
  const without = clone(seconde);
  without.nodes = without.nodes.filter((node) => node.code !== "MATH.T2.ALG.EQUATION");
  without.edges = without.edges.filter((edge) => edge.from !== "MATH.T2.ALG.EQUATION" && edge.to !== "MATH.T2.ALG.EQUATION");
  const before = await snapshot();
  assert.match(
    await importError(without),
    /cannot deactivate nodes still used by relationships declared by other sources: MATH\.T2\.ALG\.EQUATION \(https:\/\/www\.education\.gouv\.fr\/bo\/test\/premiere-spe-maths\)/,
  );
  assert.match(await importError(without, { allowMassDeactivation: true }), /still used by relationships declared by other sources/);
  assert.deepEqual(await snapshot(), before);

  // Once Première stops declaring it, Seconde may deactivate the node.
  const premiereWithout = clone(premiere);
  premiereWithout.edges = premiereWithout.edges.filter((edge) => edge.from !== "MATH.T2.ALG.EQUATION");
  await importPackage(premiereWithout);
  assert.equal((await importPackage(without)).nodes.deactivated, 1);
});

test("P1: retyping a node is refused when it would invalidate another source's relationship", async () => {
  const { seconde } = await secondeAndPremiere();
  // Seconde retypes EQUATION as a domain and drops its own now-invalid links:
  // its package is valid alone, but Première's `EQUATION -prerequisite_of->
  // SECOND_DEGRE` would become domain -> notion.
  const retyped = clone(seconde);
  retyped.nodes = retyped.nodes.map((node) => (node.code === "MATH.T2.ALG.EQUATION" ? { ...node, type: "domain" as const } : node));
  retyped.edges = retyped.edges.filter(
    (edge) => !(edge.to === "MATH.T2.ALG.EQUATION" && edge.relation === "prerequisite_of") && !(edge.from === "MATH.T2.ALG.EQUATION" && edge.relation === "supports"),
  );
  const alone = validateCurriculumPackage(parseJsonCurriculumPackage(JSON.stringify(retyped), "retyped.json"));
  assert.equal(alone.ok, true, JSON.stringify(alone.errors));
  const before = await snapshot();
  assert.match(
    await importError(retyped),
    /resulting graph would contain invalid relationships .*MATH\.T2\.ALG\.EQUATION \(domain\) -prerequisite_of-> MATH\.P1\.ALG\.SECOND_DEGRE \(notion\)/,
  );
  assert.deepEqual(await snapshot(), before);
});

test("P2: validator fingerprint, migration header and audit row share one canonical hash", async () => {
  const pkg = clone(canonical(secondePackage()));
  // Characters whose JSON escaping must match: quotes, backslash, accents, ’, emoji.
  pkg.nodes[0].title = "Calculer « vite » – \"guillemets\" \\ l’élève ✓ 😀";
  pkg.source.publishedOn = null;
  assert.equal(canonicalCurriculumText(pkg), JSON.stringify(pkg));
  const expected = hashCurriculumPackage(pkg);
  assert.match(renderCurriculumImportMigration(pkg), new RegExp(`-- Package hash: ${expected}`));
  const report = (await importPackage(pkg)) as ImportReport & { packageHash: string };
  assert.equal(report.packageHash, expected);
  const [{ hash }] = await call<{ hash: string }>(
    "postgres",
    "select package_hash as hash from public.curriculum_import_runs order by imported_at desc limit 1",
  );
  assert.equal(hash, expected);
});

// Codex review of 4a8568a — server/validator parity. Every value below is
// rejected by BOTH the TypeScript validator and focus_import_curriculum, so
// nothing the database accepts can fail validation when exported.
test("P2: the database and the validator reject the same source and node values", async () => {
  const url = "https://www.education.gouv.fr/bo/test/seconde";
  const cases: Array<[string, (pkg: TestPackage) => void]> = [
    ["source URL over 300 characters", (pkg) => (pkg.source.sourceUrl = `${url}/${"a".repeat(300)}`)],
    ["source title made of Unicode spaces", (pkg) => (pkg.source.title = "  ")],
    ["control character in publisher", (pkg) => (pkg.source.publisher = "Ministère\u000b")],
    ["control character in the URL", (pkg) => (pkg.source.sourceUrl = `${url}/\u0007`)],
    ["vertical tab in a node title", (pkg) => (pkg.nodes[4].title = "Distributivité\u000b")],
    ["bell in a description", (pkg) => (pkg.nodes[4].description = "Distribuer\u0007")],
    ["unit separator in a locator", (pkg) => (pkg.nodes[4].sourceLocator = "Algèbre\u001f")],
    ["title made of Unicode spaces", (pkg) => (pkg.nodes[4].title = "   ﻿")],
    ["title of 161 characters", (pkg) => (pkg.nodes[4].title = "t".repeat(161))],
    ["description of 301 characters", (pkg) => (pkg.nodes[4].description = "d".repeat(301))],
    ["locator of 201 characters", (pkg) => (pkg.nodes[4].sourceLocator = "l".repeat(201))],
    ["non-consecutive school year", (pkg) => (pkg.source.schoolYear = "2026-2099")],
  ];
  const before = await snapshot();
  for (const [label, mutate] of cases) {
    const pkg = clone(secondePackage());
    mutate(pkg);
    const offline = validateCurriculumPackage(parseJsonCurriculumPackage(JSON.stringify(pkg), "parity.json"));
    assert.equal(offline.ok, false, `validator accepted: ${label}`);
    // The database receives the same values without client-side normalization.
    const serverPackage = {
      formatVersion: 1,
      source: pkg.source,
      nodes: pkg.nodes.map(({ code, type, title, description, sourceLocator }) => ({
        code,
        type,
        title,
        description: description ?? null,
        sourceLocator,
      })),
      edges: canonical(secondePackage()).edges,
    };
    assert.match(await importError(serverPackage), /curriculum import: (source fields|invalid nodes|invalid schoolYear)/, label);
  }
  assert.deepEqual(await snapshot(), before);

  // And what normalization makes equivalent is accepted by both.
  const spaced = clone(secondePackage());
  spaced.nodes[4].title = "  Développement   par\tdistributivité  ";
  assert.equal(validateCurriculumPackage(parseJsonCurriculumPackage(JSON.stringify(spaced), "ok.json")).ok, true);
  const accepted = await importPackage({ ...canonical(secondePackage()), nodes: canonical(secondePackage()).nodes.map((node) => (node.code === "MATH.T2.ALG.DISTRIBUTIVITE" ? { ...node, title: spaced.nodes[4].title } : node)) });
  assert.equal(accepted.nodes.inserted, 7);
});
