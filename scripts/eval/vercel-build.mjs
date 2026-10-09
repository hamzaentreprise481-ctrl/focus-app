// TEMPORARY — evaluation branch only (work/fiabiliser-analyse-ia-eval).
//
// The development container cannot reach api.openai.com. The Vercel Preview
// build of this branch can, with the Preview's own server environment. This
// build step runs the live evaluation harness BEFORE `next build`, writes
// only metrics, fictitious transcriptions and statuses into
// public/__focus-eval/, then builds the app normally. The deployment is
// protected by Vercel Authentication; the collector workflow reads it with
// the automation bypass secret. Never printed: keys, secrets.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const out = "public/__focus-eval";
mkdirSync(out, { recursive: true });

const key = process.env.OPENAI_API_KEY;
const probe = {
  generatedAt: new Date().toISOString(),
  sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  vercelEnv: process.env.VERCEL_ENV ?? null,
  node: process.version,
  hasOpenAiKey: Boolean(key),
  hasSigningKey: Boolean(process.env.FOCUS_ANALYSIS_SIGNING_KEY),
  hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  focusAiModelEnv: process.env.FOCUS_AI_MODEL ?? null,
  focusScanModelEnv: process.env.FOCUS_SCAN_MODEL ?? null,
  reasoningEffortEnv: process.env.FOCUS_AI_REASONING_EFFORT ?? null,
  modelStatus: {},
  availableModels: null,
};

if (key) {
  const candidates = [...new Set(["gpt-6-astra", "gpt-5.6-terra", process.env.FOCUS_AI_MODEL, process.env.FOCUS_SCAN_MODEL].filter(Boolean))];
  for (const model of candidates) {
    try {
      const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      });
      probe.modelStatus[model] = response.status;
    } catch (error) {
      probe.modelStatus[model] = `network:${error instanceof Error ? error.name : "error"}`;
    }
  }
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) {
      const payload = await response.json();
      probe.availableModels = (payload.data ?? []).map((item) => item.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id)).sort();
    } else probe.availableModels = `http:${response.status}`;
  } catch (error) {
    probe.availableModels = `network:${error instanceof Error ? error.name : "error"}`;
  }
}
writeFileSync(`${out}/probe.json`, `${JSON.stringify(probe, null, 2)}\n`);
console.log(`[focus-eval] probe written (key present: ${probe.hasOpenAiKey})`);

if (key && existsSync("scripts/eval/run-live-eval.ts")) {
  try {
    execSync("node --conditions=react-server --import tsx scripts/eval/run-live-eval.ts", { stdio: "inherit", timeout: 35 * 60_000 });
  } catch (error) {
    writeFileSync(
      `${out}/harness-error.json`,
      `${JSON.stringify({ failed: true, status: error?.status ?? null, signal: error?.signal ?? null }, null, 2)}\n`,
    );
  }
}

execSync("npx next build", { stdio: "inherit" });
