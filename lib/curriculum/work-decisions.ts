// Explicit author decisions for the relationships of a Work curriculum
// document that the importer rules reject.
//
// FOCUS never picks the meaning of a disputed relationship itself. Each
// dispute is listed with the only choices that make it valid; a decision is
// applied only when a person has chosen one of those listed options and
// signed it (decidedBy). Undecided disputes are left untouched, so the
// validator keeps rejecting the document.

import { createHash } from "node:crypto";
import { RELATION_RULES, type CurriculumIssue, type CurriculumRelation } from "./types";
import type { WorkConversion } from "./work-format";

export type WorkDisputeKind =
  | "competency_support"
  | "invalid_types"
  | "support_and_prerequisite"
  | "part_of_and_prerequisite"
  | "multiple_relations";

export interface WorkDisputeEdge {
  index: number;
  from: string;
  to: string;
  relation: string;
  provenance: string | null;
}

export interface WorkDisputeOption {
  keep: number[];
  meaning: string;
}

export interface WorkDispute {
  id: string;
  kind: WorkDisputeKind;
  edges: WorkDisputeEdge[];
  options: WorkDisputeOption[];
}

export interface WorkDecision extends WorkDispute {
  keep: number[] | null;
  decidedBy: string | null;
  rationale: string | null;
}

export interface WorkDecisionsDocument {
  workFile: string;
  workFileSha256: string;
  status: "pending_author_decisions" | "decided";
  note: string;
  decisions: WorkDecision[];
}

export function sha256(content: Buffer | string) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Neutral split: an edge is disputed when its relation cannot connect those
 * node types, or when its node pair carries more than one relationship (then
 * every edge of the pair is disputed, never just the "second" one).
 */
export function listWorkDisputes(
  conversion: WorkConversion,
  document: Record<string, unknown>,
): { disputes: WorkDispute[]; undisputed: number[] } {
  const typeByCode = new Map(
    conversion.raw.nodes.map(({ value }) => {
      const node = value as { code: string; type: string };
      return [node.code, node.type];
    }),
  );
  const sourceEdges = Array.isArray(document.edges) ? (document.edges as Array<Record<string, unknown>>) : [];
  const edges: WorkDisputeEdge[] = conversion.raw.edges.map(({ value }, position) => {
    const edge = value as { from: string; to: string; relation: string };
    const index = conversion.edgeSourceIndexes[position]; // index in the Work document
    const provenance = sourceEdges[index]?.provenance;
    return { index, ...edge, provenance: typeof provenance === "string" ? provenance : null };
  });
  const pairKey = (edge: WorkDisputeEdge) => [edge.from, edge.to].sort().join("|");
  const byPair = new Map<string, WorkDisputeEdge[]>();
  for (const edge of edges) byPair.set(pairKey(edge), [...(byPair.get(pairKey(edge)) ?? []), edge]);

  const disputes: WorkDispute[] = [];
  const undisputed: number[] = [];
  // One dispute per node pair: a type-invalid edge and another edge of the
  // same pair are decided together, so signed choices can never combine into
  // an outcome no listed option describes.
  const isAllowed = (edge: WorkDisputeEdge) =>
    (RELATION_RULES[edge.relation as CurriculumRelation] ?? []).some(
      ([from, to]) => from === typeByCode.get(edge.from) && to === typeByCode.get(edge.to),
    );
  const seenPairs = new Set<string>();
  for (const edge of edges) {
    if (seenPairs.has(pairKey(edge))) continue;
    seenPairs.add(pairKey(edge));
    const pair = byPair.get(pairKey(edge)) ?? [edge];

    if (pair.length === 1) {
      if (isAllowed(edge)) {
        undisputed.push(edge.index);
        continue;
      }
      const competencies =
        typeByCode.get(edge.from) === "competency" && typeByCode.get(edge.to) === "competency";
      disputes.push({
        id: `TYPES:${edge.from}>${edge.to}:${edge.relation}`,
        kind: competencies ? "competency_support" : "invalid_types",
        edges: [edge],
        options: [
          {
            keep: [],
            meaning: competencies
              ? "Retirer ce lien : les règles actuelles n’autorisent « supports » que vers une compétence depuis une notion ou un prérequis. Garder des liens entre compétences exigerait de changer ces règles (décision produit, non proposée ici)."
              : "Retirer ce lien, non autorisé entre ces types de nœuds.",
          },
        ],
      });
      continue;
    }

    const valid = pair.filter(isAllowed);
    const relations = pair.map((item) => item.relation).sort().join("+");
    const find = (relation: string) => pair.find((item) => item.relation === relation)!;
    let kind: WorkDisputeKind = "multiple_relations";
    // Only outcomes that keep exactly one type-valid edge (or none, when no
    // edge of the pair is valid) are offered.
    const competencyPair = pair.every(
      (item) => typeByCode.get(item.from) === "competency" && typeByCode.get(item.to) === "competency",
    );
    if (!valid.length && competencyPair) kind = "competency_support";
    let options: WorkDisputeOption[] = valid.length
      ? valid.map((item) => ({
          keep: [item.index],
          meaning: `Garder seulement ${item.from} —${item.relation}→ ${item.to} ; les autres liens de cette paire sont retirés.`,
        }))
      : [
          {
            keep: [],
            meaning: competencyPair
              ? "Retirer ces liens : les règles actuelles n’autorisent pas « supports » entre deux compétences (dans un sens ou dans l’autre). Les garder exigerait de changer ces règles (décision produit, non proposée ici)."
              : "Retirer tous les liens de cette paire, aucun n’est autorisé entre ces types de nœuds.",
          },
        ];
    if (valid.length === pair.length) {
      if (relations === "prerequisite_of+supports") {
        kind = "support_and_prerequisite";
        const prerequisite = find("prerequisite_of");
        const support = find("supports");
        options = [
          {
            keep: [prerequisite.index],
            meaning: `Garder ${prerequisite.from} —prerequisite_of→ ${prerequisite.to} : dépendance forte (le prérequis doit être acquis avant), le lien « supports » est retiré.`,
          },
          {
            keep: [support.index],
            meaning: `Garder ${support.from} —supports→ ${support.to} : simple appui, pas de prérequis.`,
          },
        ];
      } else if (relations === "part_of+prerequisite_of") {
        kind = "part_of_and_prerequisite";
        const partOf = find("part_of");
        const prerequisite = find("prerequisite_of");
        options = [
          {
            keep: [partOf.index],
            meaning: `Garder ${partOf.from} —part_of→ ${partOf.to} : ${partOf.from} est une sous-notion de ${partOf.to}.`,
          },
          {
            keep: [prerequisite.index],
            meaning: `Garder ${prerequisite.from} —prerequisite_of→ ${prerequisite.to} : ${prerequisite.from} doit être acquis avant ${prerequisite.to}, sans relation de hiérarchie.`,
          },
        ];
      }
    }
    disputes.push({ id: `PAIR:${pairKey(edge)}`, kind, edges: pair, options });
  }
  return { disputes, undisputed };
}

export function workDecisionsTemplate(
  conversion: WorkConversion,
  document: Record<string, unknown>,
  workFile: string,
  workFileSha256: string,
): WorkDecisionsDocument {
  return {
    workFile,
    workFileSha256,
    status: "pending_author_decisions",
    note:
      "Pour chaque litige, recopier dans « keep » le tableau « keep » de l’option choisie et renseigner « decidedBy » (et si utile « rationale »). Un litige laissé à null reste bloquant. FOCUS n’applique aucune option par défaut.",
    decisions: listWorkDisputes(conversion, document).disputes.map((dispute) => ({
      ...dispute,
      keep: null,
      decidedBy: null,
      rationale: null,
    })),
  };
}

/**
 * Applies signed decisions to the conversion. Returns the conversion with the
 * edges removed by decided disputes, the counts, and blocking issues for a
 * stale or malformed decisions document.
 */
export function applyWorkDecisions(
  conversion: WorkConversion,
  document: Record<string, unknown>,
  decisions: unknown,
  workFileSha256: string,
): { conversion: WorkConversion; applied: number; pending: number; issues: CurriculumIssue[] } {
  const issues: CurriculumIssue[] = [];
  const at = "décisions";
  const fail = (code: string, message: string) =>
    issues.push({ severity: "error", code, message, at });

  const value = decisions as Partial<WorkDecisionsDocument> | null;
  if (!value || typeof value !== "object" || !Array.isArray(value.decisions)) {
    fail("WORK_DECISIONS", "Document de décisions invalide.");
    return { conversion, applied: 0, pending: 0, issues };
  }
  if (value.workFileSha256 !== workFileSha256) {
    fail(
      "WORK_DECISIONS_STALE",
      "Les décisions ont été établies pour une autre version du fichier Work (empreinte SHA-256 différente) : régénérez le modèle de décisions.",
    );
    return { conversion, applied: 0, pending: 0, issues };
  }

  const current = new Map(listWorkDisputes(conversion, document).disputes.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const drop = new Set<number>();
  let applied = 0;
  let pending = 0;
  for (const decision of value.decisions as WorkDecision[]) {
    const dispute = current.get(decision?.id);
    if (!dispute) {
      fail("WORK_DECISIONS", `Litige inconnu : ${String(decision?.id)}.`);
      continue;
    }
    if (seen.has(dispute.id)) {
      fail("WORK_DECISIONS", `${dispute.id} : décision en double — une seule entrée par litige.`);
      continue;
    }
    seen.add(dispute.id);
    if (decision.keep === null || decision.keep === undefined) {
      pending++;
      continue;
    }
    if (!Array.isArray(decision.keep) || !decision.keep.every((index) => Number.isInteger(index))) {
      fail("WORK_DECISIONS", `${dispute.id} : « keep » doit être null ou une liste d'indices de relations.`);
      continue;
    }
    const chosen = dispute.options.find(
      (option) => JSON.stringify([...option.keep].sort()) === JSON.stringify([...(decision.keep as number[])].sort()),
    );
    if (!chosen) {
      fail("WORK_DECISIONS", `${dispute.id} : « keep » ne correspond à aucune option proposée.`);
      continue;
    }
    if (typeof decision.decidedBy !== "string" || !decision.decidedBy.trim()) {
      fail("WORK_DECISIONS", `${dispute.id} : « decidedBy » est obligatoire pour appliquer une décision.`);
      continue;
    }
    applied++;
    for (const edge of dispute.edges) if (!chosen.keep.includes(edge.index)) drop.add(edge.index);
  }
  for (const id of current.keys())
    if (!seen.has(id)) fail("WORK_DECISIONS", `Litige sans entrée dans le document de décisions : ${id}.`);
  // Any problem in the decisions document: apply nothing at all.
  if (issues.length) return { conversion, applied: 0, pending: current.size, issues };

  const keepPositions = conversion.edgeSourceIndexes
    .map((index, position) => ({ index, position }))
    .filter(({ index }) => !drop.has(index));
  return {
    conversion: {
      ...conversion,
      raw: { ...conversion.raw, edges: keepPositions.map(({ position }) => conversion.raw.edges[position]) },
      edgeSourceIndexes: keepPositions.map(({ index }) => index),
    },
    applied,
    pending,
    issues,
  };
}

export interface DeferredRelationship {
  disputeId: string;
  kind: WorkDisputeKind;
  index: number;
  from: string;
  to: string;
  relation: string;
  provenance: string | null;
}

/**
 * Status quo for disputes nobody has decided yet — never a semantic choice:
 * when exactly one relationship of a disputed pair already exists in the
 * graph currently imported for this source (`existingEdges`) and keeping it
 * alone is one of the dispute's valid options, it is kept unchanged; every
 * other relationship of every remaining dispute is left out of the import.
 * Nothing new is asserted and nothing existing is removed. Author decisions
 * (applyWorkDecisions) always take precedence: apply them first.
 */
export function deferWorkDisputes(
  conversion: WorkConversion,
  document: Record<string, unknown>,
  existingEdges: Iterable<{ from: string; to: string; relation: string }>,
): { conversion: WorkConversion; kept: DeferredRelationship[]; deferred: DeferredRelationship[] } {
  const existing = new Set([...existingEdges].map((edge) => `${edge.from}|${edge.relation}|${edge.to}`));
  const { disputes } = listWorkDisputes(conversion, document);
  const kept: DeferredRelationship[] = [];
  const deferred: DeferredRelationship[] = [];
  const describe = (dispute: WorkDispute, edge: WorkDisputeEdge): DeferredRelationship => ({
    disputeId: dispute.id,
    kind: dispute.kind,
    index: edge.index,
    from: edge.from,
    to: edge.to,
    relation: edge.relation,
    provenance: edge.provenance,
  });
  for (const dispute of disputes) {
    const live = dispute.edges.filter((edge) => existing.has(`${edge.from}|${edge.relation}|${edge.to}`));
    const statusQuo =
      live.length === 1 && dispute.options.some((option) => option.keep.length === 1 && option.keep[0] === live[0].index)
        ? live[0]
        : null;
    for (const edge of dispute.edges)
      (edge === statusQuo ? kept : deferred).push(describe(dispute, edge));
  }
  const drop = new Set(deferred.map((item) => item.index));
  const positions = conversion.edgeSourceIndexes
    .map((index, position) => ({ index, position }))
    .filter(({ index }) => !drop.has(index));
  return {
    conversion: {
      ...conversion,
      raw: { ...conversion.raw, edges: positions.map(({ position }) => conversion.raw.edges[position]) },
      edgeSourceIndexes: positions.map(({ index }) => index),
    },
    kept,
    deferred,
  };
}
