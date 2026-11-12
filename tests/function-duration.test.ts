// The pages whose Server Actions run an analysis allow more time than the
// model call itself, on Fluid compute (vercel.json), so a slow but valid
// answer is recorded instead of being cut off by the platform.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MODEL_TIMEOUT_MS } from "../lib/pedagogy/openai-client";

const PAGES = ["app/(teacher)/app/evaluations/[id]/page.tsx", "app/(teacher)/app/eleves/[id]/page.tsx"];

test("pages running an analysis allow the model timeout plus the database work, on Fluid compute", () => {
  for (const page of PAGES) {
    const match = readFileSync(page, "utf8").match(/^export const maxDuration = (\d+);$/m);
    assert.ok(match, `${page} exports maxDuration`);
    const seconds = Number(match[1]);
    assert.ok(seconds * 1000 >= MODEL_TIMEOUT_MS + 20_000, `${page}: ${seconds} s leaves room after ${MODEL_TIMEOUT_MS / 1000} s`);
    // Within the Hobby limit on Fluid compute (300 s).
    assert.ok(seconds <= 300, page);
  }
  assert.equal(JSON.parse(readFileSync("vercel.json", "utf8")).fluid, true);
});

test("only the components of those two pages call the analysis", () => {
  // A new caller on another page needs that page's maxDuration too.
  const callers = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return callers(file);
      const calls = /\.tsx?$/.test(entry.name) && !file.endsWith("pedagogy-actions.ts") && /generatePedagogicalAnalysis\(/.test(readFileSync(file, "utf8"));
      return calls ? [file] : [];
    });
  assert.deepEqual([...callers("components"), ...callers("app")].sort(), [
    "components/evaluations/class-analysis-panel.tsx",
    "components/evaluations/student-evidence-editor.tsx",
    "components/students/pedagogical-ai-panel.tsx",
  ]);
});
