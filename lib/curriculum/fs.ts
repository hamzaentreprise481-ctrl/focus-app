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

/**
 * Loads either a JSON package file or a CSV package directory containing
 * source.json, nodes.csv and optionally edges.csv.
 */
export function loadCurriculumPackage(target: string): RawCurriculumPackage {
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
