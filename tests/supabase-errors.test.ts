import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureOk, isSchemaOutdated, SchemaOutdatedError } from "../lib/supabase-errors";

test("a missing function, table or column means pending migrations, not a refused operation", () => {
  for (const code of ["PGRST202", "PGRST204", "PGRST205", "42883", "42P01", "42703"]) assert.equal(isSchemaOutdated({ code }), true, code);
  for (const code of ["42501", "23514", "55000", "PGRST116", undefined, null]) assert.equal(isSchemaOutdated({ code }), false, String(code));
  assert.throws(() => ensureOk({ code: "PGRST202", message: "Could not find the function" }, "Copies"), SchemaOutdatedError);
  assert.throws(
    () => ensureOk({ code: "42501", message: "permission denied" }, "Copies"),
    (error: Error) => !(error instanceof SchemaOutdatedError) && error.message === "Copies: permission denied",
  );
  assert.doesNotThrow(() => ensureOk(null, "Copies"));
});
