import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// The workspace reader under RLS (see tests/scripts/school-data-scope.ts).
test("the workspace keeps only the teacher's own class and subject assessments", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "tests/scripts/school-data-scope.ts"], {
    timeout: 120_000,
  });
  assert.match(stdout, /school-data-scope: OK/);
});
