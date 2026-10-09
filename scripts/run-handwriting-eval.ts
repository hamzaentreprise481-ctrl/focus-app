// Live evaluation of handwritten copies (fictitious fixtures,
// tests/fixtures/handwriting) through the REAL reader and analysis.
//
//   OPENAI_API_KEY=… npm run test:handwriting-live -- [--scan-model m] [--scan-effort low|medium|high]
//       [--analysis-model m] [--analysis-effort low|medium|high] [--input pdf|images] [--no-analysis]
//       [--copies id,id]
//   npm run test:handwriting-live -- --score <dir-of-records>   # offline: scores stored records
//
// Writes benchmark-results/handwriting-<scan-model>-<input>-<timestamp>.json:
// per copy and question, the transcription of the FICTITIOUS copy, its
// legibility, leaks of destroyed or crossed-out passages, the outcomes and
// findings, and per-level aggregates. Never a key or a provider message.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pedagogicalReasoningEffort, type ReasoningEffort } from "../lib/pedagogy/openai-client";
import { loadProductionCurriculum } from "../tests/helpers/benchmark-runner";
import {
  aggregateHandwriting,
  loadManifest,
  loadSpec,
  runHandwritingCopy,
  scoreHandwritingRecord,
  type CurriculumProjection,
} from "../tests/helpers/handwriting-eval";

const option = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

async function main() {
  const manifest = loadManifest();
  const byId = new Map(manifest.copies.map((copy) => [copy.id, copy]));
  const scoreDir = option("score");
  let records: Array<{ id: string } & Record<string, unknown>> = [];
  let settings: Record<string, unknown> = { mode: "offline scoring of stored records", source: scoreDir };

  if (scoreDir) {
    records = readdirSync(scoreDir)
      .filter((name) => name.endsWith(".json") && name.includes("__"))
      .map((name) => JSON.parse(readFileSync(path.join(scoreDir, name), "utf8")))
      .map((record) => ({ ...record, id: record.id ?? record.copyId }));
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("BLOCKED: OPENAI_API_KEY is not available in this environment. Nothing was sent; no result is claimed.");
      process.exit(2);
    }
    const analysisModel = option("analysis-model") || process.env.FOCUS_AI_MODEL || "gpt-6-astra";
    const effort = (value: string | undefined, fallback: ReasoningEffort): ReasoningEffort =>
      value === "low" || value === "medium" || value === "high" ? value : fallback;
    const run = {
      apiKey,
      scanModel: option("scan-model") || process.env.FOCUS_SCAN_MODEL || analysisModel,
      scanEffort: effort(option("scan-effort"), "high"),
      analysisModel,
      analysisEffort: effort(option("analysis-effort"), pedagogicalReasoningEffort()),
      input: option("input") === "images" ? ("images" as const) : ("pdf" as const),
      analyse: !process.argv.includes("--no-analysis"),
    };
    settings = { mode: "live model", ...run, apiKey: undefined };
    const context = await loadProductionCurriculum();
    const curriculum: CurriculumProjection = {
      aiCurriculum: context.aiCurriculum,
      mappable: Object.fromEntries(context.graph.mappableNotionIdsByCode),
      summaries: context.graph.summaries.map((s) => ({ code: s.code, parents: s.parents, prerequisites: s.prerequisites })),
      catalogue: Object.fromEntries([...context.catalogueCodes].map(([code, set]) => [code, [...set]])),
    };
    const only = option("copies")?.split(",");
    const spec = loadSpec();
    for (const copy of manifest.copies.filter((item) => !only || only.includes(item.id))) {
      const record = (await runHandwritingCopy(copy, spec, curriculum, run)) as { id: string } & Record<string, unknown>;
      records.push(record);
      const scan = record.scan as { ok: boolean; error?: string } | undefined;
      console.log(`${copy.id}: scan=${scan?.ok ? "ok" : scan?.error} analysis=${(record.analysis as { ok?: boolean; status?: string } | undefined)?.status ?? "-"}`);
    }
  }

  const scores = records.filter((record) => byId.has(record.id)).map((record) => scoreHandwritingRecord(record as never, byId.get(record.id)!));
  const report = { generatedAt: new Date().toISOString(), ...settings, byLevel: aggregateHandwriting(scores), scores, records };
  const directory = path.join(process.cwd(), "benchmark-results");
  mkdirSync(directory, { recursive: true });
  const label = scoreDir ? "scored" : `${String(settings.scanModel).replace(/[^a-zA-Z0-9.-]/g, "_")}-${settings.input}`;
  const file = path.join(directory, `handwriting-${label}-${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.byLevel, null, 2));
  console.log(`Report: ${path.relative(process.cwd(), file)}`);
}

main().catch((error) => {
  console.error(`Handwriting evaluation failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
