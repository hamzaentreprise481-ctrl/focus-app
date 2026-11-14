import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Execute the actual workflow gate with HTTP replaced by a local stub. No
// network, credentials, database writes or application server are involved.
const workflow = readFileSync(path.join(__dirname, "../.github/workflows/preview-e2e.yml"), "utf8");
const gate = workflow.split("        run: |\n")[1].split("      - uses:")[0]
  .split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");

function runGate(health: unknown, credentials = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "focus-preview-gate-"));
  try {
    writeFileSync(path.join(dir, "curl"), `#!/bin/bash
if [[ "$*" == *"-X POST"* ]]; then
  cat > "$MOCK_STATUS"
else
  printf '%s' "$MOCK_HEALTH"
fi
`, { mode: 0o755 });
    writeFileSync(path.join(dir, "output"), "");
    writeFileSync(path.join(dir, "status"), "null");
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", gate], {
      encoding: "utf8",
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        URL: "https://fixture.invalid", SHA: "fixture",
        GITHUB_SERVER_URL: "https://github.invalid", GITHUB_REPOSITORY: "fixture/focus",
        GITHUB_RUN_ID: "1", GITHUB_OUTPUT: path.join(dir, "output"),
        GH_TOKEN: "fake", VERCEL_AUTOMATION_BYPASS_SECRET: "fake",
        FOCUS_E2E_EMAIL: credentials ? "teacher@example.test" : "",
        FOCUS_E2E_PASSWORD: credentials ? "fake" : "",
        MOCK_HEALTH: typeof health === "string" ? health : JSON.stringify(health),
        MOCK_STATUS: path.join(dir, "status"),
      },
    });
    assert.ifError(result.error);
    return {
      code: result.status,
      output: readFileSync(path.join(dir, "output"), "utf8"),
      status: JSON.parse(readFileSync(path.join(dir, "status"), "utf8")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const branch of ["work/fiabiliser-analyse-ia", "work/student-director-portals", "work/verify-v1-20261113"]) {
  test(`real E2E gate permits ready ${branch}`, () => {
    const result = runGate({ gitRef: branch, ready: true });
    assert.equal(result.code, 0);
    assert.equal(result.output, "run=1\n");
    assert.equal(result.status, null); // Passing the gate is not an E2E success.
  });
}

for (const [name, health, credentials] of [
  ["unsupported branch", { gitRef: "main", ready: true }, true],
  ["unreachable Preview", "<html>Vercel authentication required</html>", true],
  ["missing test teacher", { gitRef: "work/student-director-portals", ready: true }, false],
  ["old schema", { gitRef: "work/student-director-portals", ready: false, supabase: { schemaUpToDate: false } }, true],
] as const) {
  test(`real E2E gate reports failure, never green, for ${name}`, () => {
    const result = runGate(health, credentials);
    assert.equal(result.code, 1);
    assert.equal(result.output, "run=0\n");
    assert.equal(result.status.state, "error");
    assert.match(result.status.description, /^Not run:/);
  });
}
