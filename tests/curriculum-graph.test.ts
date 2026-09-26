import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCurriculumIndex,
  parseCurriculumGraphPayload,
  resolveCurriculumScope,
  toAiCurriculum,
  type CurriculumGraphPayload,
} from "../lib/curriculum/graph";

const SOURCE = {
  id: "src-2",
  subjectCode: "MATH",
  levelCode: "SECONDE_GT",
  schoolYear: "2026-2027",
  title: "Programme",
  officialReference: "BO",
  sourceUrl: "https://www.education.gouv.fr/bo/x",
};

function node(code: string, nodeType: string, extra: Record<string, unknown> = {}) {
  return {
    id: `id-${code}`,
    sourceId: "src-2",
    code,
    nodeType,
    title: `Titre ${code}`,
    description: null,
    sourceLocator: "p. 1",
    inScope: true,
    ...extra,
  };
}

function payload(): CurriculumGraphPayload {
  return parseCurriculumGraphPayload({
    sources: [SOURCE],
    nodes: [
      node("MATH.FONC.VARIATIONS", "notion"),
      node("MATH.ALG.DISTRIBUTIVITE", "notion"),
      node("MATH.COMP.CALCULER", "competency"),
      node("MATH.ALG.EXPRESSIONS", "notion"),
      node("MATH.ALG.FACTORISATION", "notion"),
      node("MATH.PREREQ.CYCLE4", "prerequisite"),
      node("MATH.C4.PRIOR", "notion", { inScope: false }),
    ],
    edges: [
      { from: "MATH.ALG.DISTRIBUTIVITE", to: "MATH.COMP.CALCULER", relation: "supports" },
      { from: "MATH.ALG.DISTRIBUTIVITE", to: "MATH.ALG.FACTORISATION", relation: "supports" },
      { from: "MATH.ALG.DISTRIBUTIVITE", to: "MATH.ALG.EXPRESSIONS", relation: "part_of" },
      { from: "MATH.PREREQ.CYCLE4", to: "MATH.ALG.DISTRIBUTIVITE", relation: "prerequisite_of" },
      { from: "MATH.C4.PRIOR", to: "MATH.ALG.DISTRIBUTIVITE", relation: "prerequisite_of" },
      // Edge to a node outside the payload (inactive): ignored, not dangling.
      { from: "MATH.ALG.DISTRIBUTIVITE", to: "MATH.ALG.RETIRED", relation: "supports" },
    ],
  });
}

test("competencies only list competency nodes; notion-to-notion support is separate", () => {
  const index = buildCurriculumIndex(payload());
  const summary = index.summaryByCode.get("MATH.ALG.DISTRIBUTIVITE");
  assert.ok(summary);
  assert.deepEqual(summary.competencies, ["MATH.COMP.CALCULER"]);
  assert.deepEqual(summary.supports, ["MATH.ALG.FACTORISATION"]);
  assert.deepEqual(summary.parents, ["MATH.ALG.EXPRESSIONS"]);
  assert.deepEqual(summary.prerequisites, ["MATH.C4.PRIOR", "MATH.PREREQ.CYCLE4"]);
  assert.equal(summary.sourceUrl, SOURCE.sourceUrl);
});

test("summaries are ordered by code whatever the database order", () => {
  const a = buildCurriculumIndex(payload());
  const reversed = payload();
  reversed.nodes.reverse();
  reversed.edges.reverse();
  const b = buildCurriculumIndex(reversed);
  assert.deepEqual(
    a.summaries.map((summary) => summary.code),
    [
      "MATH.ALG.DISTRIBUTIVITE",
      "MATH.ALG.EXPRESSIONS",
      "MATH.ALG.FACTORISATION",
      "MATH.C4.PRIOR",
      "MATH.COMP.CALCULER",
      "MATH.FONC.VARIATIONS",
      "MATH.PREREQ.CYCLE4",
    ],
  );
  // Identical AI input => identical analysis hash => cache reuse works.
  assert.equal(
    JSON.stringify(toAiCurriculum(a.summaries)),
    JSON.stringify(toAiCurriculum(b.summaries)),
  );
});

test("only in-scope notions can carry a recommendation", () => {
  const index = buildCurriculumIndex(payload());
  assert.deepEqual(
    [...index.mappableNotionIdsByCode.keys()],
    [
      "MATH.ALG.DISTRIBUTIVITE",
      "MATH.ALG.EXPRESSIONS",
      "MATH.ALG.FACTORISATION",
      "MATH.FONC.VARIATIONS",
    ],
  );
  assert.equal(index.mappableNotionIdsByCode.get("MATH.ALG.DISTRIBUTIVITE"), "id-MATH.ALG.DISTRIBUTIVITE");
});

test("the model receives a compact projection without database ids or URLs", () => {
  const [first] = toAiCurriculum(buildCurriculumIndex(payload()).summaries);
  assert.deepEqual(Object.keys(first).sort(), [
    "code",
    "competencies",
    "description",
    "inScope",
    "nodeType",
    "parents",
    "prerequisites",
    "supports",
    "title",
  ]);
});

test("malformed graph payloads fail loudly instead of silently shrinking the graph", () => {
  assert.throws(() => parseCurriculumGraphPayload(null), /Graphe du programme invalide/);
  assert.throws(
    () => parseCurriculumGraphPayload({ sources: [], nodes: [node("MATH.A.B", "chapter")], edges: [] }),
    /type chapter/,
  );
  assert.throws(
    () =>
      parseCurriculumGraphPayload({
        sources: [],
        nodes: [],
        edges: [{ from: "A", to: "B", relation: "related" }],
      }),
    /relation related/,
  );
});

test("class levels resolve to imported programme levels", () => {
  const levels = ["SECONDE_GT", "PREMIERE_SPE", "PREMIERE_TC", "TERMINALE_SPE"];
  assert.deepEqual(resolveCurriculumScope("Seconde", levels), {
    levelCodes: ["SECONDE_GT"],
    resolution: "class_level",
  });
  assert.deepEqual(resolveCurriculumScope("2nde GT", levels).levelCodes, ["SECONDE_GT"]);
  assert.deepEqual(resolveCurriculumScope("Première", levels).levelCodes, [
    "PREMIERE_SPE",
    "PREMIERE_TC",
  ]);
  assert.deepEqual(resolveCurriculumScope("1re", levels).levelCodes, ["PREMIERE_SPE", "PREMIERE_TC"]);
  assert.deepEqual(resolveCurriculumScope("Tle", levels).levelCodes, ["TERMINALE_SPE"]);
  assert.deepEqual(resolveCurriculumScope("premiere_spe", levels).levelCodes, ["PREMIERE_SPE"]);
});

test("unmatched class levels fall back to the whole subject and say so", () => {
  assert.deepEqual(resolveCurriculumScope("Seconde", ["SECONDE_GT"]), {
    levelCodes: ["SECONDE_GT"],
    resolution: "class_level",
  });
  assert.deepEqual(resolveCurriculumScope(null, ["SECONDE_GT"]), {
    levelCodes: null,
    resolution: "single_level",
  });
  assert.deepEqual(resolveCurriculumScope("BTS", ["SECONDE_GT", "PREMIERE_SPE"]), {
    levelCodes: null,
    resolution: "subject_fallback",
  });
  assert.deepEqual(resolveCurriculumScope("Terminale", ["SECONDE_GT"]), {
    levelCodes: null,
    resolution: "single_level",
  });
});

// Codex review of f3bc46a — keep the track qualifier when resolving aliases.
test("class levels keep their track qualifier when several tracks share a grade", () => {
  const levels = ["SECONDE_GT", "SECONDE_PRO", "PREMIERE_SPE_MATHS", "PREMIERE_TC"];
  assert.deepEqual(resolveCurriculumScope("2nde GT", levels).levelCodes, ["SECONDE_GT"]);
  assert.deepEqual(resolveCurriculumScope("Seconde générale et technologique", ["SECONDE_GT", "SECONDE_PRO"]).levelCodes, ["SECONDE_GT"]);
  assert.deepEqual(resolveCurriculumScope("Seconde professionnelle", levels).levelCodes, ["SECONDE_PRO"]);
  assert.deepEqual(resolveCurriculumScope("Première spécialité mathématiques", levels).levelCodes, ["PREMIERE_SPE_MATHS"]);
  assert.deepEqual(resolveCurriculumScope("Seconde pro", levels).levelCodes, ["SECONDE_PRO"]);
  assert.deepEqual(resolveCurriculumScope("1re spé", levels).levelCodes, ["PREMIERE_SPE_MATHS"]);
  assert.deepEqual(resolveCurriculumScope("Première TC", levels).levelCodes, ["PREMIERE_TC"]);
  // No track given, or a class number: every programme of the grade.
  assert.deepEqual(resolveCurriculumScope("Seconde", levels).levelCodes, ["SECONDE_GT", "SECONDE_PRO"]);
  assert.deepEqual(resolveCurriculumScope("Seconde 3", levels).levelCodes, ["SECONDE_GT", "SECONDE_PRO"]);
  // Codex review of 3fab0aa — the short "générale" label and a class number
  // after the track keep the track.
  for (const label of ["Seconde générale", "Seconde Generale", "2nde générale 3", "Seconde GT 2", "Seconde générale et technologique 4"])
    assert.deepEqual(resolveCurriculumScope(label, ["SECONDE_GT", "SECONDE_PRO"]).levelCodes, ["SECONDE_GT"], label);
  for (const label of ["Seconde professionnelle 1", "2nde pro B", "Seconde professionnel"])
    assert.deepEqual(resolveCurriculumScope(label, ["SECONDE_GT", "SECONDE_PRO"]).levelCodes, ["SECONDE_PRO"], label);
  // The live class level with the live programme.
  assert.deepEqual(resolveCurriculumScope("Seconde", ["SECONDE_GT"]), { levelCodes: ["SECONDE_GT"], resolution: "class_level" });
});
