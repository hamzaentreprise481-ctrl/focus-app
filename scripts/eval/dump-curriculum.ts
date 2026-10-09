// TEMPORARY — evaluation branch only. Dumps the production curriculum
// projection (migrated schema in PGlite) that the analysis receives, so the
// Preview evaluation endpoint needs no database.
import { writeFileSync } from "node:fs";
import { loadProductionCurriculum } from "../../tests/helpers/benchmark-runner";

loadProductionCurriculum().then((context) => {
  const out = {
    aiCurriculum: context.aiCurriculum,
    mappable: Object.fromEntries(context.graph.mappableNotionIdsByCode),
    summaries: context.graph.summaries.map((s) => ({ code: s.code, parents: s.parents, prerequisites: s.prerequisites })),
    catalogue: Object.fromEntries([...context.catalogueCodes].map(([code, set]) => [code, [...set]])),
  };
  writeFileSync(process.argv[2], JSON.stringify(out));
  console.log("written", Object.keys(out.mappable).length, "notions");
});
