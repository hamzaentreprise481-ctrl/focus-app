// Pedagogical AI benchmark against the real model, on the fixed synthetic
// case set (tests/fixtures/pedagogy-benchmark.ts), through the production
// prompt, schema, curriculum projection and validators.
//
//   OPENAI_API_KEY=… npm run test:ai-live -- [--effort low|medium|high] [--model <id>] [--cases <id,id>]
//   npm run test:ai-live -- --reference     # offline: an ideal model (checks the harness)
//
// Writes benchmark-results/pedagogy-<model>-<effort>-<timestamp>.json with
// the metrics and per-case verdicts (ids, statuses, counts, rejection
// reasons, latency, tokens). It never writes answers, prompts, model text
// or provider messages.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { aggregate, scoreCase } from "../lib/pedagogy/benchmark";
import { pedagogicalReasoningEffort, requestPedagogicalAnalysisWithUsage, type ReasoningEffort } from "../lib/pedagogy/openai-client";
import { PEDAGOGY_BENCHMARK } from "../tests/fixtures/pedagogy-benchmark";
import { loadProductionCurriculum, questionIdsOf, referenceOutput, runCase, type ModelCall } from "../tests/helpers/benchmark-runner";

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const reference = process.argv.includes("--reference");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!reference && !apiKey) {
    console.error("BLOCKED: OPENAI_API_KEY is not available in this environment. Nothing was sent; no result is claimed.");
    process.exit(2);
  }
  const model = reference ? "reference-ideal" : option("model") || process.env.FOCUS_AI_MODEL || "gpt-6-astra";
  const effort: ReasoningEffort = pedagogicalReasoningEffort(option("effort") ?? process.env.FOCUS_AI_REASONING_EFFORT);
  const only = option("cases")?.split(",");
  const cases = only ? PEDAGOGY_BENCHMARK.filter((item) => only.includes(item.id)) : PEDAGOGY_BENCHMARK;

  const context = await loadProductionCurriculum();
  const scores = [];
  for (const item of cases) {
    const call: ModelCall = reference
      ? async () => ({ raw: referenceOutput(item), latencyMs: 0, totalTokens: 0 })
      : async (input) => {
          const result = await requestPedagogicalAnalysisWithUsage(input, { apiKey: apiKey!, model, reasoningEffort: effort });
          return { raw: result.analysis, latencyMs: result.latencyMs, totalTokens: result.usage.totalTokens };
        };
    const run = await runCase(item, context, call);
    const score = scoreCase(item, run, questionIdsOf(item));
    scores.push(score);
    console.log(
      `${score.statusCorrect && score.matchedErrors === score.expectedErrors && !score.falsePositives ? "PASS" : "MISS"} ${item.id}` +
        ` expected=${score.expectedStatus} actual=${score.actualStatus} matched=${score.matchedErrors}/${score.expectedErrors}` +
        ` fp=${score.falsePositives} rejected=${score.rejected.length}${score.latencyMs !== null ? ` ${score.latencyMs}ms` : ""}` +
        (score.failure ? ` failure=${score.failure}` : ""),
    );
  }

  const metrics = aggregate(scores);
  let gitSha: string | null = null;
  try {
    gitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    gitSha = null;
  }
  const report = {
    generatedAt: new Date().toISOString(),
    gitSha,
    mode: reference ? "reference (no model called)" : "live model",
    model,
    reasoningEffort: reference ? null : effort,
    caseCount: cases.length,
    metrics,
    cases: scores.map(({ rejected, ...score }) => ({ ...score, rejectedReasons: rejected.map((item) => item.reason) })),
  };
  const directory = path.join(process.cwd(), "benchmark-results");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `pedagogy-${model.replace(/[^a-zA-Z0-9.-]/g, "_")}-${reference ? "reference" : effort}-${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(metrics, null, 2));
  console.log(`Report: ${path.relative(process.cwd(), file)}`);
}

main().catch((error) => {
  console.error(`Benchmark failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
