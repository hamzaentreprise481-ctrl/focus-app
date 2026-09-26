// File-system loading for curriculum packages. Used by scripts and tests only;
// never import this from application code.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CurriculumParseError,
  parseCsvCurriculumPackage,
  parseJsonCurriculumPackage,
  serializeCsvCurriculumPackage,
} from "./package";
import type { CanonicalCurriculumPackage, RawCurriculumPackage } from "./types";
import { sha256 } from "./work-decisions";
import {
  convertWorkCurriculum,
  isWorkCurriculumDocument,
  type WorkConversion,
} from "./work-format";

export type LoadedWorkDocument = WorkConversion & {
  document: Record<string, unknown>;
  fileSha256: string;
};

/**
 * Loads either a JSON package file or a CSV package directory containing
 * source.json, nodes.csv and optionally edges.csv.
 */
export function loadCurriculumPackage(target: string): RawCurriculumPackage {
  const input = loadCurriculumInput(target);
  // A Work document whose conversion has blocking issues (malformed entries,
  // unknown level, list mismatches…) is never handed out as a plain package:
  // the raw form would silently lack what the adapter could not convert.
  const blocking = input.work?.issues.filter((issue) => issue.severity === "error") ?? [];
  if (blocking.length)
    throw new CurriculumParseError(
      `Document Work non convertible (${blocking.length} erreur(s)) : ${blocking
        .slice(0, 5)
        .map((issue) => `[${issue.code}] ${issue.message}`)
        .join(" ; ")}`,
      target,
    );
  return input.raw;
}

/**
 * Same as loadCurriculumPackage, but also accepts a rich "Work" curriculum
 * document (schema_version 1.x) and returns its conversion report.
 */
export function loadCurriculumInput(target: string): {
  raw: RawCurriculumPackage;
  work: LoadedWorkDocument | null;
} {
  if (
    existsSync(target) &&
    !statSync(target).isDirectory() &&
    target.toLowerCase().endsWith(".json")
  ) {
    const bytes = readFileSync(target);
    const text = bytes.toString("utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch {
      parsed = null; // reported precisely by parseJsonCurriculumPackage below
    }
    if (isWorkCurriculumDocument(parsed)) {
      const work = convertWorkCurriculum(parsed, target);
      return { raw: work.raw, work: { ...work, document: parsed, fileSha256: sha256(bytes) } };
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

/**
 * Writes a package as a CSV directory. The directory ends up containing
 * exactly the package: a previous edges.csv is removed when the package has
 * no relationship left for it, so stale relationships can never be reloaded.
 * Each file is written to a temporary name first, then renamed.
 */
export function writeCsvCurriculumPackage(dir: string, pkg: CanonicalCurriculumPackage) {
  const files = serializeCsvCurriculumPackage(pkg);
  mkdirSync(dir, { recursive: true });
  const write = (name: string, content: string) => {
    const target = path.join(dir, name);
    const temporary = `${target}.tmp-${process.pid}`;
    writeFileSync(temporary, content);
    renameSync(temporary, target);
  };
  write("source.json", files.sourceJson);
  write("nodes.csv", files.nodesCsv);
  if (files.edgesCsv) write("edges.csv", files.edgesCsv);
  else rmSync(path.join(dir, "edges.csv"), { force: true });
  return files;
}
