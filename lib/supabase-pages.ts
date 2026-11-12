// PostgREST caps every response at the project's max-rows (1000 by default
// on Supabase) without an error: a plain select silently loses the rest.
// These helpers read every row, whatever that setting is, and keep `in`
// filters short enough for the gateway's URL limit.

import { ensureOk } from "@/lib/supabase-errors";

type Page<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string; code?: string | null } | null;
  count?: number | null;
}>;

/** Ids per `in` filter: about 3.7 kB of URL for UUIDs. */
export const IN_CHUNK_SIZE = 100;
const REQUESTED_PAGE = 1000;

/**
 * Every row of one query. `page(from, to)` must build a fresh query with
 * `{ count: "exact" }` and a total order, ending with `.range(from, to)`.
 * Pages advance by what the server actually returned, so a max-rows lower
 * than the requested page size still reads everything.
 */
export async function selectAll<T>(label: string, page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error, count } = await page(rows.length, rows.length + REQUESTED_PAGE - 1);
    ensureOk(error, label);
    const batch = data ?? [];
    rows.push(...batch);
    if (!batch.length || count == null || rows.length >= count) return rows;
  }
}

/** selectAll for an `in` filter, split into short chunks read in parallel. */
export async function selectAllIn<T>(
  label: string,
  values: readonly string[],
  page: (chunk: string[], from: number, to: number) => Page<T>,
): Promise<T[]> {
  const unique = [...new Set(values)];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += IN_CHUNK_SIZE) chunks.push(unique.slice(index, index + IN_CHUNK_SIZE));
  const parts = await Promise.all(chunks.map((chunk) => selectAll(label, (from, to) => page(chunk, from, to))));
  return parts.flat();
}
