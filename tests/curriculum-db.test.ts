// Runs the real migrations and the real SQL import function on PostgreSQL
// (PGlite). Each test runs inside a transaction that is rolled back.

import { after, before, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { loadCurriculumPackage } from "../lib/curriculum/fs";
import {
  buildCurriculumIndex,
  parseCurriculumGraphPayload,
} from "../lib/curriculum/graph";
import {
  parseJsonCurriculumPackage,
  validateCurriculumPackage,
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
  edges: Record<"inserted" | "deleted" | "unchanged" | "sharedWithOtherSources", number>;
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
       'edges', (select jsonb_agg(jsonb_build_array(ctid::text, from_node_id, to_node_id, relation, source_id) order by from_node_id, to_node_id) from public.curriculum_edges),
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

test("all migrations apply on PostgreSQL and keep the seeded 44-node graph with owned edges", async () => {
  assert.equal(await count("select count(*) from public.curriculum_nodes where active"), 44);
  assert.equal(await count("select count(*) from public.curriculum_edges"), 68);
  assert.equal(
    await count(
      "select count(*) from public.curriculum_edges e join public.curriculum_nodes n on n.id = e.from_node_id where e.source_id = n.source_id",
    ),
    68,
  );
});

test("the committed reference package is exactly the seeded graph: importing it changes nothing", async () => {
  const reference = validateCurriculumPackage(loadCurriculumPackage(REFERENCE_PACKAGE));
  assert.ok(reference.package);

  const [exported] = await call<{ pkg: unknown }>(
    "service_role",
    "select public.focus_export_curriculum($1) as pkg",
    [SEEDED_URL],
  );
  const fromDatabase = validateCurriculumPackage(
    parseJsonCurriculumPackage(JSON.stringify(exported.pkg), "export"),
  );
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
  assert.deepEqual(report.edges, { inserted: 0, deleted: 0, unchanged: 68, sharedWithOtherSources: 0 });
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
  assert.deepEqual(report.edges, { inserted: 2, deleted: 3, unchanged: 6, sharedWithOtherSources: 0 });
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
  assert.match(message, /24 of 44 active nodes would be deactivated \(limit 8\)/);
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
      "select count(*) from public.curriculum_edges e join public.curriculum_sources s on s.id = e.source_id where s.source_url = $1 and e.relation = 'prerequisite_of'",
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
  // Legacy inserts without source_id still get an owner.
  await call(
    "postgres",
    `insert into public.curriculum_edges(from_node_id, to_node_id, relation)
     select f.id, t.id, 'supports' from public.curriculum_nodes f, public.curriculum_nodes t
     where f.code = 'MATH.NUM.INTERVALLES' and t.code = 'MATH.COMP.REPRESENTER'`,
  );
  assert.equal(
    await count(
      "select count(*) from public.curriculum_edges e join public.curriculum_nodes f on f.id = e.from_node_id where f.code = 'MATH.NUM.INTERVALLES' and e.source_id = $1",
      [source.id],
    ),
    2,
  );
});
