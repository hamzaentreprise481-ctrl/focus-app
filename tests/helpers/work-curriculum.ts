// Helpers for tests that run the exact Work curriculum document against an
// exact local replica of the live curriculum tables (same 44 node UUIDs and
// source UUID as Supabase, read-only snapshot in fixtures/live-curriculum-ids.json).

import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { convertWorkCurriculum } from "../../lib/curriculum/work-format";
import { RELATION_RULES, type CurriculumRelation } from "../../lib/curriculum/types";

export const WORK_FILE = path.join(
  __dirname,
  "..",
  "..",
  "curriculum",
  "work",
  "FOCUS_Maths_Seconde_2026-2027.json",
);
export const WORK_FILE_SHA256 =
  "7a7a49ac2a380a0dbcc0e397148da6a8df1f34e63c3bd5e98c617a5abbd37fe3";

export const LIVE = JSON.parse(
  readFileSync(path.join(__dirname, "..", "fixtures", "live-curriculum-ids.json"), "utf8"),
) as {
  fingerprint: string;
  edgesFingerprint: string;
  source: { id: string; sourceUrl: string };
  nodes: Array<{ code: string; id: string }>;
};
export const LEGACY_CODES = LIVE.nodes.map((node) => node.code);

export function workDocument() {
  return JSON.parse(readFileSync(WORK_FILE, "utf8")) as Record<string, unknown>;
}

export function workConversion() {
  return convertWorkCurriculum(workDocument(), "FOCUS_Maths_Seconde_2026-2027.json");
}

export interface WorkEdge {
  index: number;
  from: string;
  to: string;
  relation: string;
}

/**
 * Neutral split of the document's relationships. An edge is "disputed" when
 * its relation cannot connect those node types, or when its node pair carries
 * more than one relationship — in which case EVERY edge of the pair is
 * disputed, so no editorial choice is made on the author's behalf.
 */
export function splitWorkEdges() {
  const conversion = workConversion();
  const typeByCode = new Map(
    conversion.raw.nodes.map(({ value }) => {
      const node = value as { code: string; type: string };
      return [node.code, node.type];
    }),
  );
  const edges: WorkEdge[] = conversion.raw.edges.map(({ value }, index) => {
    const edge = value as { from: string; to: string; relation: string };
    return { index, ...edge };
  });
  const pairKey = (edge: WorkEdge) => [edge.from, edge.to].sort().join("|");
  const pairCount = new Map<string, number>();
  for (const edge of edges) pairCount.set(pairKey(edge), (pairCount.get(pairKey(edge)) ?? 0) + 1);

  const disputed: Array<WorkEdge & { reason: "types" | "pair" }> = [];
  const undisputed: WorkEdge[] = [];
  for (const edge of edges) {
    const allowed = (RELATION_RULES[edge.relation as CurriculumRelation] ?? []).some(
      ([from, to]) => from === typeByCode.get(edge.from) && to === typeByCode.get(edge.to),
    );
    if (!allowed) disputed.push({ ...edge, reason: "types" });
    else if ((pairCount.get(pairKey(edge)) ?? 0) > 1) disputed.push({ ...edge, reason: "pair" });
    else undisputed.push(edge);
  }
  return { conversion, disputed, undisputed };
}

/** Rewrites the migrated database's curriculum identifiers to the live ones. */
export async function useLiveIdentifiers(db: PGlite) {
  const values = LIVE.nodes.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2}::uuid)`).join(",");
  const params = LIVE.nodes.flatMap((node) => [node.code, node.id]);
  await db.exec("set session_replication_role = replica");
  try {
    await db.query(
      `create temp table focus_live_ids as
       select n.id as old_id, live.id as new_id
       from public.curriculum_nodes n
       join (values ${values}) as live(code, id) on live.code = n.code`,
      params,
    );
    await db.exec(`
      update public.curriculum_edges e set from_node_id = m.new_id from focus_live_ids m where e.from_node_id = m.old_id;
      update public.curriculum_edges e set to_node_id = m.new_id from focus_live_ids m where e.to_node_id = m.old_id;
      update public.curriculum_nodes n set id = m.new_id from focus_live_ids m where n.id = m.old_id;
      drop table focus_live_ids;
    `);
    const [{ id: oldSource }] = (
      await db.query<{ id: string }>(
        "select id from public.curriculum_sources where source_url = $1",
        [LIVE.source.sourceUrl],
      )
    ).rows;
    await db.query("update public.curriculum_sources set id = $1 where id = $2", [LIVE.source.id, oldSource]);
    await db.query("update public.curriculum_nodes set source_id = $1 where source_id = $2", [LIVE.source.id, oldSource]);
    await db.query("update public.curriculum_edges set source_id = $1 where source_id = $2", [LIVE.source.id, oldSource]);
  } finally {
    await db.exec("set session_replication_role = origin");
  }
}

/** The live check, restricted to the 44 original codes so it stays valid after new nodes exist. */
export const LEGACY_FINGERPRINT_SQL = `
  select count(*)::int as nodes,
         md5(string_agg(code || ':' || id::text, ',' order by code collate "C")) as fingerprint
  from public.curriculum_nodes
  where code = any($1::text[])`;

export async function legacyFingerprint(db: PGlite) {
  const [row] = (
    await db.query<{ nodes: number; fingerprint: string }>(LEGACY_FINGERPRINT_SQL, [LEGACY_CODES])
  ).rows;
  return row;
}

/** Exact server payload for the document's graph (no client-side validation). */
export function workServerPackage(edges: WorkEdge[]) {
  const { conversion } = splitWorkEdges();
  return {
    formatVersion: 1,
    source: conversion.raw.source,
    nodes: conversion.raw.nodes.map(({ value }) => value),
    edges: edges.map(({ from, to, relation }) => ({ from, to, relation })),
  };
}
