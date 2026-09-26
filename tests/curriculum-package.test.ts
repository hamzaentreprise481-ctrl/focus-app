import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { loadCurriculumPackage } from "../lib/curriculum/fs";
import {
  CurriculumParseError,
  isOfficialSourceUrl,
  parseCsvCurriculumPackage,
  parseJsonCurriculumPackage,
  serializeCsvCurriculumPackage,
  validateCurriculumPackage,
} from "../lib/curriculum/package";
import { formatCurriculumPackageJson } from "../lib/curriculum/sql";
import {
  clone,
  premierePackage,
  secondePackage,
  type TestPackage,
} from "./fixtures/curriculum";

const REFERENCE_PACKAGE = path.join(
  __dirname,
  "..",
  "curriculum",
  "packages",
  "math",
  "seconde-gt-2026-2027",
);

function validate(pkg: TestPackage, options?: Parameters<typeof validateCurriculumPackage>[1]) {
  return validateCurriculumPackage(
    parseJsonCurriculumPackage(JSON.stringify(pkg), "test.json"),
    options,
  );
}

function errorCodes(pkg: TestPackage, options?: Parameters<typeof validateCurriculumPackage>[1]) {
  return validate(pkg, options).errors.map((issue) => issue.code);
}

test("a well-formed package normalizes inline relations into sorted canonical edges", () => {
  const result = validate(secondePackage());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.package);
  assert.deepEqual(
    result.package.nodes.map((node) => node.code),
    [...result.package.nodes.map((node) => node.code)].sort(),
  );
  assert.deepEqual(result.package.edges, [
    { from: "MATH.T2.ALG.DISTRIBUTIVITE", to: "MATH.T2.ALG.EQUATION", relation: "prerequisite_of" },
    { from: "MATH.T2.ALG.DISTRIBUTIVITE", to: "MATH.T2.ALG.FACTORISATION", relation: "supports" },
    { from: "MATH.T2.ALG.DISTRIBUTIVITE", to: "MATH.T2.COMP.CALCULER", relation: "supports" },
    { from: "MATH.T2.ALG.DISTRIBUTIVITE", to: "MATH.T2.DOM.ALGEBRE", relation: "part_of" },
    { from: "MATH.T2.ALG.EQUATION", to: "MATH.T2.COMP.RAISONNER", relation: "supports" },
    { from: "MATH.T2.ALG.EQUATION", to: "MATH.T2.DOM.ALGEBRE", relation: "part_of" },
    { from: "MATH.T2.ALG.FACTORISATION", to: "MATH.T2.COMP.CALCULER", relation: "supports" },
    { from: "MATH.T2.ALG.FACTORISATION", to: "MATH.T2.DOM.ALGEBRE", relation: "part_of" },
    { from: "MATH.T2.PREREQ.DISTRIBUTIVITE", to: "MATH.T2.ALG.DISTRIBUTIVITE", relation: "prerequisite_of" },
  ]);
  assert.deepEqual(result.stats.nodes, { domain: 1, notion: 3, competency: 2, prerequisite: 1 });
  assert.match(result.hash ?? "", /^[0-9a-f]{64}$/);
});

test("the same content in another order, spacing or Unicode form has the same hash", () => {
  const a = validate(secondePackage());
  const shuffled = clone(secondePackage());
  shuffled.nodes.reverse();
  shuffled.nodes[0].title = `  ${shuffled.nodes[0].title.replace(" ", "   ")}  `;
  // "É" as E + combining acute accent (NFD) instead of the precomposed form.
  const equation = shuffled.nodes.find((node) => node.code === "MATH.T2.ALG.EQUATION");
  assert.ok(equation);
  equation.title = equation.title.normalize("NFD");
  const b = validate(shuffled);
  assert.equal(b.ok, true);
  assert.equal(a.hash, b.hash);
  assert.deepEqual(a.package, b.package);
});

test("duplicate node codes are rejected with both locations", () => {
  const pkg = clone(secondePackage());
  pkg.nodes.push({ ...pkg.nodes[0] });
  const result = validate(pkg);
  const issue = result.errors.find((item) => item.code === "NODE_DUPLICATE");
  assert.ok(issue);
  assert.match(issue.message, /test\.json#nodes\[0\]/);
  assert.equal(issue.at, `test.json#nodes[${pkg.nodes.length - 1}]`);
  assert.equal(result.package, null);
});

test("a relationship declared twice (inline and explicit) is a duplicate", () => {
  const pkg = clone(secondePackage());
  pkg.edges.push({
    from: "MATH.T2.ALG.DISTRIBUTIVITE",
    to: "MATH.T2.ALG.EQUATION",
    relation: "prerequisite_of",
  });
  assert.deepEqual(errorCodes(pkg), ["EDGE_DUPLICATE"]);
});

test("two different relationships between the same pair are a conflict, in either direction", () => {
  const sameDirection = clone(secondePackage());
  sameDirection.edges.push({
    from: "MATH.T2.ALG.DISTRIBUTIVITE",
    to: "MATH.T2.ALG.EQUATION",
    relation: "supports",
  });
  assert.deepEqual(errorCodes(sameDirection), ["EDGE_CONFLICT"]);

  const reversed = clone(secondePackage());
  reversed.edges.push({
    from: "MATH.T2.ALG.FACTORISATION",
    to: "MATH.T2.ALG.DISTRIBUTIVITE",
    relation: "supports",
  });
  assert.deepEqual(errorCodes(reversed), ["EDGE_CONFLICT"]);
});

test("prerequisite cycles are rejected and the cycle path is reported", () => {
  const pkg = clone(secondePackage());
  const distributivite = pkg.nodes.find((node) => node.code === "MATH.T2.ALG.DISTRIBUTIVITE");
  assert.ok(distributivite);
  pkg.nodes.push({
    code: "MATH.T2.ALG.IDENTITES",
    type: "notion",
    title: "Identités remarquables",
    sourceLocator: "Algèbre",
    prerequisites: ["MATH.T2.ALG.EQUATION"],
    competencies: ["MATH.T2.COMP.CALCULER"],
  });
  distributivite.prerequisites = ["MATH.T2.PREREQ.DISTRIBUTIVITE", "MATH.T2.ALG.IDENTITES"];
  const result = validate(pkg);
  const cycle = result.errors.find((item) => item.code === "PREREQUISITE_CYCLE");
  assert.ok(cycle, JSON.stringify(result.errors));
  assert.match(cycle.message, /MATH\.T2\.ALG\.DISTRIBUTIVITE → MATH\.T2\.ALG\.EQUATION → MATH\.T2\.ALG\.IDENTITES → MATH\.T2\.ALG\.DISTRIBUTIVITE/);
});

test("part_of cycles are rejected (two-node loops are already pair conflicts)", () => {
  const pkg = clone(secondePackage());
  pkg.nodes.push(
    { code: "MATH.T2.DOM.NOMBRES", type: "domain", title: "Nombres", sourceLocator: "x", partOf: ["MATH.T2.DOM.CALCUL"] },
    { code: "MATH.T2.DOM.CALCUL", type: "domain", title: "Calcul", sourceLocator: "x", partOf: ["MATH.T2.DOM.ALGEBRE"] },
  );
  const algebre = pkg.nodes.find((node) => node.code === "MATH.T2.DOM.ALGEBRE");
  assert.ok(algebre);
  algebre.partOf = ["MATH.T2.DOM.NOMBRES"];
  assert.deepEqual(errorCodes(pkg), ["PART_OF_CYCLE"]);

  const twoNodes = clone(secondePackage());
  twoNodes.nodes.push({ code: "MATH.T2.DOM.NOMBRES", type: "domain", title: "Nombres", sourceLocator: "x", partOf: ["MATH.T2.DOM.ALGEBRE"] });
  twoNodes.nodes[2].partOf = ["MATH.T2.DOM.NOMBRES"];
  assert.deepEqual(errorCodes(twoNodes), ["EDGE_CONFLICT"]);
});

test("relationship types are enforced: competencies, prerequisites and hierarchy", () => {
  const competencyIsNotion = clone(secondePackage());
  competencyIsNotion.nodes[4].competencies = ["MATH.T2.ALG.EQUATION"];
  assert.ok(errorCodes(competencyIsNotion).includes("COMPETENCY_TARGET"));

  const prerequisiteOfCompetency = clone(secondePackage());
  prerequisiteOfCompetency.edges.push({
    from: "MATH.T2.ALG.FACTORISATION",
    to: "MATH.T2.COMP.RAISONNER",
    relation: "prerequisite_of",
  });
  assert.deepEqual(errorCodes(prerequisiteOfCompetency), ["EDGE_TYPES"]);

  const domainPrerequisite = clone(secondePackage());
  domainPrerequisite.nodes[5].prerequisites = ["MATH.T2.ALG.DISTRIBUTIVITE", "MATH.T2.DOM.ALGEBRE"];
  assert.ok(errorCodes(domainPrerequisite).includes("EDGE_TYPES"));

  const selfLoop = clone(secondePackage());
  selfLoop.edges.push({ from: "MATH.T2.ALG.EQUATION", to: "MATH.T2.ALG.EQUATION", relation: "supports" });
  assert.deepEqual(errorCodes(selfLoop), ["EDGE_SELF"]);
});

test("unknown codes are rejected unless another package provides them", () => {
  const premiere = premierePackage();
  assert.deepEqual(errorCodes(premiere), ["EDGE_UNKNOWN_NODE"]);

  const seconde = validate(secondePackage());
  assert.ok(seconde.package);
  const withContext = validate(premiere, {
    externalNodes: seconde.package.nodes,
    externalEdges: seconde.package.edges,
  });
  assert.equal(withContext.ok, true, JSON.stringify(withContext.errors));
  assert.equal(withContext.stats.externalReferences, 1);
  assert.deepEqual(withContext.package?.edges[1], {
    from: "MATH.T2.ALG.EQUATION",
    to: "MATH.P1.ALG.SECOND_DEGRE",
    relation: "prerequisite_of",
  });
});

test("a package cannot declare relationships between two nodes it does not own", () => {
  const seconde = validate(secondePackage());
  assert.ok(seconde.package);
  const premiere = premierePackage();
  premiere.edges.push({
    from: "MATH.T2.ALG.FACTORISATION",
    to: "MATH.T2.ALG.EQUATION",
    relation: "supports",
  });
  assert.deepEqual(
    errorCodes(premiere, { externalNodes: seconde.package.nodes, externalEdges: seconde.package.edges }),
    ["EDGE_FOREIGN"],
  );
});

test("cross-package cycles and pair conflicts are detected with --with context", () => {
  const seconde = validate(secondePackage());
  assert.ok(seconde.package);
  const context = { externalNodes: seconde.package.nodes, externalEdges: seconde.package.edges };

  const cyclic = premierePackage();
  cyclic.edges.push({ from: "MATH.P1.ALG.SECOND_DEGRE", to: "MATH.T2.ALG.DISTRIBUTIVITE", relation: "prerequisite_of" });
  assert.ok(errorCodes(cyclic, context).includes("PREREQUISITE_CYCLE"));

  const conflicting = premierePackage();
  conflicting.nodes.push({ code: "MATH.P1.ALG.X", type: "notion", title: "X", sourceLocator: "x" });
  conflicting.edges.push({ from: "MATH.T2.ALG.EQUATION", to: "MATH.P1.ALG.X", relation: "supports" });
  conflicting.edges.push({ from: "MATH.P1.ALG.X", to: "MATH.T2.ALG.EQUATION", relation: "prerequisite_of" });
  assert.ok(errorCodes(conflicting, context).includes("EDGE_CONFLICT"));
});

test("node codes, types and required fields are validated", () => {
  const pkg = clone(secondePackage());
  pkg.nodes.push(
    { code: "math.t2.lower", type: "notion", title: "x", sourceLocator: "x" },
    { code: "PHYS.T2.WRONG_SUBJECT", type: "notion", title: "x", sourceLocator: "x" },
    { code: "MATH.T2.BAD_TYPE", type: "chapter", title: "x", sourceLocator: "x" },
    { code: "MATH.T2.NO_LOCATOR", type: "notion", title: "x", sourceLocator: "  " },
    { code: "MATH.T2.TYPO", type: "notion", title: "x", sourceLocator: "x", prerequisite: ["MATH.T2.ALG.EQUATION"] },
  );
  const codes = errorCodes(pkg);
  assert.equal(codes.filter((code) => code === "NODE_CODE").length, 2);
  assert.ok(codes.includes("NODE_TYPE"));
  assert.ok(codes.includes("NODE_FIELD"));
  assert.ok(codes.includes("UNKNOWN_FIELD"));
});

test("long texts are refused so that programme or textbook text is never stored", () => {
  const pkg = clone(secondePackage());
  pkg.nodes[4].description = "Lorem ipsum ".repeat(40);
  const result = validate(pkg);
  const issue = result.errors.find((item) => item.code === "TEXT_TOO_LONG");
  assert.ok(issue);
  assert.match(issue.message, /jamais le texte du programme/);
});

test("control characters are refused", () => {
  const pkg = clone(secondePackage());
  pkg.nodes[4].title = "Distributivité\u0000";
  assert.ok(errorCodes(pkg).includes("CONTROL_CHARACTER"));
});

test("the source must be official, dated correctly and complete", () => {
  assert.equal(isOfficialSourceUrl("https://www.education.gouv.fr/bo/2026/Hebdo14/X"), true);
  assert.equal(isOfficialSourceUrl("https://eduscol.education.fr/document/1"), true);
  assert.equal(isOfficialSourceUrl("http://www.education.gouv.fr/bo"), false);
  assert.equal(isOfficialSourceUrl("https://education.gouv.fr.example.com/bo"), false);
  assert.equal(isOfficialSourceUrl("https://user@education.gouv.fr/bo"), false);
  assert.equal(isOfficialSourceUrl("https://manuel-editeur.fr/chapitre-3"), false);
  assert.equal(isOfficialSourceUrl("https://www.education.gouv.fr:443/bo"), false); // same rule as the database
  assert.equal(isOfficialSourceUrl("https://Education.Gouv.FR/bo"), true);

  const pkg = clone(secondePackage());
  pkg.source.sourceUrl = "https://manuel-editeur.fr/chapitre-3";
  pkg.source.schoolYear = "2026-2028";
  pkg.source.publishedOn = "2026-02-30";
  pkg.source.levelCode = "seconde";
  delete pkg.source.publisher;
  const codes = errorCodes(pkg);
  assert.ok(codes.includes("SOURCE_NOT_OFFICIAL"));
  assert.equal(codes.filter((code) => code === "SOURCE_FIELD").length, 4);

  const version = clone(secondePackage());
  version.formatVersion = 2;
  assert.deepEqual(errorCodes(version), ["FORMAT_VERSION"]);
});

test("quality warnings do not block the import", () => {
  const pkg = clone(secondePackage());
  pkg.nodes.push(
    { code: "MATH.T2.ALG.ISOLEE", type: "notion", title: "Notion isolée", sourceLocator: "x" },
    {
      code: "MATH.T2.ALG.SANS_COMPETENCE",
      type: "notion",
      title: "Sans compétence",
      sourceLocator: "x",
      prerequisites: ["MATH.T2.ALG.EQUATION", "MATH.T2.ALG.DISTRIBUTIVITE"],
    },
  );
  const result = validate(pkg);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.warnings.map((issue) => issue.code).sort(),
    ["NODE_ISOLATED", "NOTION_WITHOUT_COMPETENCY", "PREREQUISITE_REDUNDANT"],
  );
});

test("JSON structure errors are reported as parse errors", () => {
  assert.throws(() => parseJsonCurriculumPackage("{", "x.json"), CurriculumParseError);
  assert.throws(
    () => parseJsonCurriculumPackage(JSON.stringify({ ...secondePackage(), extra: 1 }), "x.json"),
    /extra/,
  );
  assert.throws(
    () => parseJsonCurriculumPackage(JSON.stringify({ formatVersion: 1, source: {}, nodes: {} }), "x.json"),
    /nodes/,
  );
});

test("CSV packages are equivalent to JSON packages and round-trip exactly", () => {
  const json = validate(secondePackage());
  assert.ok(json.package);
  const files = serializeCsvCurriculumPackage(json.package);
  const csv = validateCurriculumPackage(
    parseCsvCurriculumPackage({
      sourceJson: files.sourceJson,
      nodesCsv: files.nodesCsv,
      edgesCsv: files.edgesCsv,
    }),
  );
  assert.equal(csv.ok, true, JSON.stringify(csv.errors));
  assert.equal(csv.hash, json.hash);
  assert.deepEqual(csv.package, json.package);
});

test("CSV headers are checked and errors point to file and line", () => {
  const files = serializeCsvCurriculumPackage(validate(secondePackage()).package!);
  assert.throws(
    () =>
      parseCsvCurriculumPackage({
        sourceJson: files.sourceJson,
        nodesCsv: files.nodesCsv.replace("source_locator", "locator"),
      }),
    /locator/,
  );
  const semicolons = files.nodesCsv
    .split("\n")
    .map((line, index) =>
      index === 0 ? line.replace(/,/g, ";") : line ? `${line.split(",")[0]};notion;Titre;;Loc;;;` : line,
    )
    .join("\n");
  const raw = parseCsvCurriculumPackage({ sourceJson: files.sourceJson, nodesCsv: semicolons });
  assert.equal(raw.nodes.length, 7);
  assert.equal(raw.nodes[2].at, "nodes.csv:4");
});

test("the committed reference package (current 44-node graph) is valid", () => {
  const result = validateCurriculumPackage(loadCurriculumPackage(REFERENCE_PACKAGE));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.package?.nodes.length, 44);
  assert.equal(result.package?.edges.length, 68);
  assert.deepEqual(result.stats.nodes, { domain: 0, notion: 34, competency: 6, prerequisite: 4 });
  assert.deepEqual(result.stats.edges, { prerequisite_of: 20, supports: 39, part_of: 9 });
});

test("diff-friendly migration JSON parses back to the canonical package", () => {
  const result = validate(secondePackage());
  assert.ok(result.package);
  const text = formatCurriculumPackageJson(result.package);
  assert.deepEqual(JSON.parse(text), result.package);
  assert.equal(text.split("\n").length, result.package.nodes.length + result.package.edges.length + 6);
});
