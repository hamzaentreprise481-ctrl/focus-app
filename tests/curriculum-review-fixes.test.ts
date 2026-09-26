// Regression tests for the Codex review findings on PR #6 that do not need a
// database (the P1 shared-declaration and P2 mass-deactivation tests live in
// curriculum-db.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCurriculumPackage, writeCsvCurriculumPackage } from "../lib/curriculum/fs";
import {
  parseCsvCurriculumPackage,
  parseJsonCurriculumPackage,
  validateCurriculumChain,
  validateCurriculumPackage,
} from "../lib/curriculum/package";
import { writeCsv } from "../lib/curriculum/csv";
import { clone, premierePackage, secondePackage, type TestPackage } from "./fixtures/curriculum";

const ROOT = path.join(__dirname, "..");

function raw(pkg: TestPackage, name: string) {
  return parseJsonCurriculumPackage(JSON.stringify(pkg), name);
}

function terminalePackage(): TestPackage {
  return {
    formatVersion: 1,
    source: {
      subjectCode: "MATH",
      levelCode: "TERMINALE_SPE",
      schoolYear: "2026-2027",
      title: "Programme de spécialité mathématiques de terminale (test)",
      publisher: "Ministère de l’Éducation nationale",
      officialReference: "BO test — terminale",
      sourceUrl: "https://www.education.gouv.fr/bo/test/terminale-spe-maths",
      publishedOn: null,
    },
    nodes: [
      { code: "MATH.TL.COMP.CALCULER", type: "competency", title: "Calculer (terminale)", sourceLocator: "Préambule" },
      {
        code: "MATH.TL.ANA.POLYNOMES",
        type: "notion",
        title: "Polynômes et racines",
        sourceLocator: "Analyse",
        prerequisites: ["MATH.P1.ALG.SECOND_DEGRE"], // defined by the première package
        competencies: ["MATH.TL.COMP.CALCULER"],
      },
    ],
    edges: [],
  };
}

// ---------------------------------------------------------------------------
// P2 — repeated --with packages are validated cumulatively
// ---------------------------------------------------------------------------

test("context packages are validated cumulatively: seconde → première → terminale", () => {
  const chain = validateCurriculumChain(
    [raw(secondePackage(), "seconde.json"), raw(premierePackage(), "premiere.json")],
    raw(terminalePackage(), "terminale.json"),
  );
  assert.deepEqual(chain.context.map((result) => result.ok), [true, true]);
  assert.ok(chain.target);
  assert.equal(chain.target.ok, true, JSON.stringify(chain.target.errors));
  assert.equal(chain.target.stats.externalReferences, 1);

  // Before the fix each context package was validated alone: première failed.
  assert.equal(validateCurriculumPackage(raw(premierePackage(), "premiere.json")).ok, false);

  // Order matters: a context package may only use the ones given before it.
  const reversed = validateCurriculumChain(
    [raw(premierePackage(), "premiere.json"), raw(secondePackage(), "seconde.json")],
    raw(terminalePackage(), "terminale.json"),
  );
  assert.equal(reversed.target, null);
  assert.deepEqual(reversed.context[0].errors.map((issue) => issue.code), ["EDGE_UNKNOWN_NODE"]);
});

test("the CLI accepts chained --with packages", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "focus-chain-"));
  try {
    const files = {
      seconde: path.join(dir, "seconde.json"),
      premiere: path.join(dir, "premiere.json"),
      terminale: path.join(dir, "terminale.json"),
    };
    writeFileSync(files.seconde, JSON.stringify(secondePackage()));
    writeFileSync(files.premiere, JSON.stringify(premierePackage()));
    writeFileSync(files.terminale, JSON.stringify(terminalePackage()));
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ["--import", "tsx", "scripts/curriculum.ts", "validate", ...args], {
        cwd: ROOT,
        encoding: "utf8",
      });
    const ok = run(files.terminale, "--with", files.seconde, "--with", files.premiere);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /Paquet valide/);
    const wrongOrder = run(files.terminale, "--with", files.premiere, "--with", files.seconde);
    assert.equal(wrongOrder.status, 1);
    assert.match(wrongOrder.stderr, /paquet de contexte .*premiere\.json est invalide/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// P2 — the 25,000 limit applies to the complete canonical edge set
// ---------------------------------------------------------------------------

function inlineOnlyCsvPackage(notions: number, competencies: number) {
  const pkg = secondePackage();
  const competencyCodes = Array.from({ length: competencies }, (_, i) => `MATH.T2.C.C${String(i).padStart(3, "0")}`);
  const rows = [
    ...competencyCodes.map((code) => [code, "competency", `Compétence ${code}`, "", "Préambule", "", "", ""]),
    ...Array.from({ length: notions }, (_, i) => [
      `MATH.T2.N.N${String(i).padStart(3, "0")}`,
      "notion",
      `Notion ${i}`,
      "",
      "Test",
      "",
      "",
      competencyCodes.join("|"),
    ]),
  ];
  return parseCsvCurriculumPackage({
    sourceJson: JSON.stringify({ formatVersion: 1, source: pkg.source }),
    nodesCsv: writeCsv(
      ["code", "type", "title", "description", "source_locator", "part_of", "prerequisites", "competencies"],
      rows,
    ),
    edgesCsv: null,
  });
}

test("inline relationships count toward the 25,000 edge limit (no edges.csv at all)", () => {
  const over = inlineOnlyCsvPackage(251, 100); // 25,100 inline relationships
  assert.equal(over.edges.length, 0);
  const rejected = validateCurriculumPackage(over);
  assert.equal(rejected.ok, false);
  assert.deepEqual(rejected.errors.map((issue) => issue.code), ["TOO_MANY_EDGES"]);
  assert.match(rejected.errors[0].message, /25100 relations/);

  const atLimit = validateCurriculumPackage(inlineOnlyCsvPackage(250, 100)); // exactly 25,000
  assert.equal(atLimit.ok, true, JSON.stringify(atLimit.errors.slice(0, 3)));
  assert.equal(atLimit.package?.edges.length, 25_000);
});

// ---------------------------------------------------------------------------
// P2 — export never leaves a stale edges.csv behind
// ---------------------------------------------------------------------------

test("writing a package over an existing export removes a now-empty edges.csv", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "focus-export-"));
  try {
    const withEdges = validateCurriculumPackage(raw(secondePackage(), "a.json")).package!;
    writeCsvCurriculumPackage(dir, withEdges);
    assert.ok(existsSync(path.join(dir, "edges.csv")));
    assert.match(readFileSync(path.join(dir, "edges.csv"), "utf8"), /MATH\.T2\.ALG\.FACTORISATION,supports/);

    // The notion → notion relationship was removed from the database.
    const without = clone(secondePackage());
    without.edges = [];
    const withoutEdges = validateCurriculumPackage(raw(without, "b.json")).package!;
    writeCsvCurriculumPackage(dir, withoutEdges);
    assert.equal(existsSync(path.join(dir, "edges.csv")), false);

    const reloaded = validateCurriculumPackage(loadCurriculumPackage(dir));
    assert.deepEqual(reloaded.package, withoutEdges);
    assert.ok(!reloaded.package?.edges.some((edge) => edge.to === "MATH.T2.ALG.FACTORISATION" && edge.relation === "supports"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// P2 (review of b6f16ee) — node codes cannot overlap across a --with chain
// ---------------------------------------------------------------------------

test("a package that redeclares a node of an earlier context package is rejected offline", () => {
  const overlapping = premierePackage();
  overlapping.nodes.push({ code: "MATH.T2.ALG.EQUATION", type: "notion", title: "Redéfinition", sourceLocator: "x" });
  const chain = validateCurriculumChain([raw(secondePackage(), "seconde.json")], raw(overlapping, "premiere.json"));
  assert.ok(chain.target);
  assert.equal(chain.target.ok, false);
  assert.deepEqual(chain.target.errors.map((issue) => issue.code), ["NODE_OWNED_ELSEWHERE"]);
  assert.match(chain.target.errors[0].message, /MATH\.T2\.ALG\.EQUATION est déjà déclaré/);

  const midChain = validateCurriculumChain(
    [raw(secondePackage(), "seconde.json"), raw(overlapping, "premiere.json")],
    raw(terminalePackage(), "terminale.json"),
  );
  assert.equal(midChain.target, null);
  assert.deepEqual(midChain.context[1].errors.map((issue) => issue.code), ["NODE_OWNED_ELSEWHERE"]);
});

// Codex review of 1a2162a — `validate --json` always prints a JSON result.
test("`validate --json` returns JSON when a context package is invalid or unreadable", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "focus-json-"));
  try {
    const premiere = path.join(dir, "premiere.json");
    const terminale = path.join(dir, "terminale.json");
    const broken = path.join(dir, "broken.json");
    writeFileSync(premiere, JSON.stringify(premierePackage()));
    writeFileSync(terminale, JSON.stringify(terminalePackage()));
    writeFileSync(broken, "{ not json");
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ["--import", "tsx", "scripts/curriculum.ts", "validate", ...args, "--json"], {
        cwd: ROOT,
        encoding: "utf8",
      });

    // Première as context without Seconde: invalid context.
    const invalidContext = run(terminale, "--with", premiere);
    assert.equal(invalidContext.status, 1);
    const result = JSON.parse(invalidContext.stdout);
    assert.equal(result.ok, false);
    assert.equal(result.failedContext, premiere);
    assert.deepEqual(result.errors.map((issue: { code: string }) => issue.code), ["EDGE_UNKNOWN_NODE"]);
    assert.match(result.errors[0].message, /^\[contexte .*premiere\.json\]/);

    // Unreadable context file: still JSON on stdout.
    const unreadable = run(terminale, "--with", broken);
    assert.equal(unreadable.status, 1);
    const parsed = JSON.parse(unreadable.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.errors[0].code, "PARSE_ERROR");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
