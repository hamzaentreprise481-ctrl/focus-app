import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// The server-only readers under a 3-row PostgREST cap (see tests/scripts/low-row-cap.ts).
test("server reads return every row when the API caps responses at 3 rows", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "tests/scripts/low-row-cap.ts"], {
    timeout: 120_000,
  });
  assert.match(stdout, /low-row-cap: OK/);
});
