import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("disposable Supabase test rejects hosted and non-HTTP URLs before creating clients", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "focus-local-guard-"));
  try {
    for (const API_URL of ["https://project.supabase.co", "http://127.0.0.1.attacker.invalid", "https://localhost"]) {
      const status = path.join(dir, "status.json");
      writeFileSync(status, JSON.stringify({ API_URL }));
      const result = spawnSync(process.execPath, ["scripts/test-local-supabase.mjs"], {
        cwd: path.join(__dirname, ".."), encoding: "utf8",
        env: { NODE_ENV: "test", FOCUS_LOCAL_STATUS: status },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /AssertionError/);
      assert.doesNotMatch(result.stderr, /supabaseKey is required|fetch failed/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
