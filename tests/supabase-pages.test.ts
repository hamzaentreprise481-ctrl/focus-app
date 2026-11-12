import { test } from "node:test";
import assert from "node:assert/strict";
import { IN_CHUNK_SIZE, selectAll, selectAllIn } from "../lib/supabase-pages";
import { SchemaOutdatedError } from "../lib/supabase-errors";

// A server that caps every response at `maxRows`, like PostgREST.
function server(rows: number[], maxRows: number) {
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + maxRows)), error: null, count: rows.length };
  };
  return { page, calls };
}

test("every row is read even when the server caps responses below the requested page", async () => {
  const rows = Array.from({ length: 2345 }, (_, index) => index);
  for (const maxRows of [7, 1000, 5000]) {
    const { page, calls } = server(rows, maxRows);
    assert.deepEqual(await selectAll("Rows", page), rows, `maxRows ${maxRows}`);
    assert.equal(calls.length, Math.ceil(rows.length / Math.min(maxRows, 1000)));
  }
  assert.deepEqual(await selectAll("Rows", server([], 1000).page), []);
});

test("errors keep their label and schema classification", async () => {
  await assert.rejects(
    selectAll("Résultats", async () => ({ data: null, error: { message: "boom" }, count: null })),
    /Résultats: boom/,
  );
  await assert.rejects(
    selectAll("Résultats", async () => ({ data: null, error: { message: "missing", code: "PGRST205" }, count: null })),
    SchemaOutdatedError,
  );
});

test("long in-lists are split into short chunks, duplicates removed", async () => {
  const ids = Array.from({ length: IN_CHUNK_SIZE * 2 + 5 }, (_, index) => `id-${index}`);
  const seen: number[] = [];
  const rows = await selectAllIn("Rows", [...ids, ids[0]], async (chunk, from, to) => {
    seen.push(chunk.length);
    const data = chunk.slice(from, to + 1).map((id) => ({ id }));
    return { data, error: null, count: chunk.length };
  });
  assert.deepEqual(seen, [IN_CHUNK_SIZE, IN_CHUNK_SIZE, 5]);
  assert.deepEqual(rows.map((row) => row.id).sort(), [...ids].sort());
});
