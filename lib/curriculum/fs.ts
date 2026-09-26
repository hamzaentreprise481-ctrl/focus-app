// File-system loading for curriculum packages. Used by scripts and tests only;
// never import this from application code.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  CurriculumParseError,
  parseCsvCurriculumPackage,
  parseJsonCurriculumPackage,
} from "./package";
import type { RawCurriculumPackage } from "./types";
import {
  convertWorkCurriculum,
  isWorkCurriculumDocument,
  type WorkConversion,
} from "./work-format";

/**
 * Loads either a JSON package file or a CSV package directory containing
 * source.json, nodes.csv and optionally edges.csv.
 */
export function loadCurriculumPackage(target: string): RawCurriculumPackage {
  return loadCurriculumInput(target).raw;
}

/**
 * Same as loadCurriculumPackage, but also accepts a rich "Work" curriculum
 * document (schema_version 1.x) and returns its conversion report.
 */
export function loadCurriculumInput(target: string): {
  raw: RawCurriculumPackage;
  work: WorkConversion | null;
} {
  if (
    existsSync(target) &&
    !statSync(target).isDirectory() &&
    target.toLowerCase().endsWith(".json")
  ) {
    const text = readFileSync(target, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch {
      parsed = null; // reported precisely by parseJsonCurriculumPackage below
    }
    if (isWorkCurriculumDocument(parsed)) {
      const work = convertWorkCurriculum(parsed, target);
      return { raw: work.raw, work };
    }
  }
  return { raw: loadPackageFile(target), work: null };
}

function loadPackageFile(target: string): RawCurriculumPackage {
  if (!existsSync(target))
    throw new CurriculumParseError("Chemin introuvable.", target);

  if (statSync(target).isDirectory()) {
    const sourcePath = path.join(target, "source.json");
    const nodesPath = path.join(target, "nodes.csv");
    const edgesPath = path.join(target, "edges.csv");
    for (const required of [sourcePath, nodesPath])
      if (!existsSync(required))
        throw new CurriculumParseError(
          "Un paquet CSV doit contenir source.json et nodes.csv.",
          required,
        );
    return parseCsvCurriculumPackage({
      sourceJson: readFileSync(sourcePath, "utf8"),
      nodesCsv: readFileSync(nodesPath, "utf8"),
      edgesCsv: existsSync(edgesPath) ? readFileSync(edgesPath, "utf8") : null,
      names: { source: sourcePath, nodes: nodesPath, edges: edgesPath },
    });
  }

  if (target.toLowerCase().endsWith(".json"))
    return parseJsonCurriculumPackage(readFileSync(target, "utf8"), target);

  throw new CurriculumParseError(
    "Attendu : un fichier .json ou un dossier (source.json + nodes.csv [+ edges.csv]).",
    target,
  );
}
