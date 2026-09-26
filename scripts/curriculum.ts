// FOCUS curriculum knowledge-base CLI (administrators only).
//
//   npm run curriculum -- validate <package> [--with <package>]... [--json]
//   npm run curriculum -- sql <package> [--with <package>]... [--out <file>|-] [--allow-mass-deactivation]
//   npm run curriculum -- apply <package> [--with <package>]... [--commit] [--allow-mass-deactivation]
//   npm run curriculum -- export <sourceUrl> --out <directory>
//
// <package> is a JSON file or a directory with source.json + nodes.csv
// [+ edges.csv]. See curriculum/README.md.
//
// `apply` and `export` talk to Supabase with SUPABASE_SERVICE_ROLE_KEY. That
// key must only ever be set in an administrator's local shell for this
// command: never in Vercel, never in the application, never committed.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadCurriculumPackage } from "../lib/curriculum/fs";
import {
  CurriculumParseError,
  parseJsonCurriculumPackage,
  serializeCsvCurriculumPackage,
  validateCurriculumPackage,
} from "../lib/curriculum/package";
import { renderCurriculumImportMigration } from "../lib/curriculum/sql";
import type {
  CanonicalCurriculumEdge,
  CurriculumIssue,
  CurriculumValidationResult,
  ExternalCurriculumNode,
} from "../lib/curriculum/types";

interface Args {
  command: string;
  target: string;
  with: string[];
  out: string | null;
  json: boolean;
  commit: boolean;
  allowMassDeactivation: boolean;
}

function usage(message?: string): never {
  if (message) console.error(`Erreur : ${message}\n`);
  console.error(
    [
      "Usage :",
      "  npm run curriculum -- validate <paquet> [--with <paquet>]... [--json]",
      "  npm run curriculum -- sql <paquet> [--with <paquet>]... [--out <fichier>|-] [--allow-mass-deactivation]",
      "  npm run curriculum -- apply <paquet> [--with <paquet>]... [--commit] [--allow-mass-deactivation]",
      "  npm run curriculum -- export <sourceUrl> --out <dossier>",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const [command, target, ...rest] = argv;
  if (!command || !target) usage();
  const args: Args = {
    command,
    target,
    with: [],
    out: null,
    json: false,
    commit: false,
    allowMassDeactivation: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--with") args.with.push(rest[++i] ?? usage("--with attend un chemin"));
    else if (flag === "--out") args.out = rest[++i] ?? usage("--out attend un chemin");
    else if (flag === "--json") args.json = true;
    else if (flag === "--commit") args.commit = true;
    else if (flag === "--allow-mass-deactivation") args.allowMassDeactivation = true;
    else usage(`option inconnue ${flag}`);
  }
  return args;
}

// Diagnostics go to stderr except for `validate`, so that `sql --out -` can
// be piped safely.
let log: (...values: unknown[]) => void = console.log;

function printIssues(issues: CurriculumIssue[]) {
  for (const issue of issues)
    log(
      `  ${issue.severity === "error" ? "✗" : "!"} [${issue.code}] ${issue.message}\n      ↳ ${issue.at}`,
    );
}

function validateWithContext(args: Args): CurriculumValidationResult {
  const externalNodes: ExternalCurriculumNode[] = [];
  const externalEdges: CanonicalCurriculumEdge[] = [];
  for (const other of args.with) {
    const result = validateCurriculumPackage(loadCurriculumPackage(other));
    if (!result.package) {
      console.error(`Le paquet de contexte ${other} est invalide :`);
      printIssues(result.errors);
      process.exit(1);
    }
    externalNodes.push(...result.package.nodes);
    externalEdges.push(...result.package.edges);
  }
  return validateCurriculumPackage(loadCurriculumPackage(args.target), {
    externalNodes,
    externalEdges,
  });
}

function report(result: CurriculumValidationResult, json: boolean) {
  if (json) {
    log(
      JSON.stringify(
        {
          ok: result.ok,
          hash: result.hash,
          stats: result.stats,
          errors: result.errors,
          warnings: result.warnings,
        },
        null,
        2,
      ),
    );
    return;
  }
  const { nodes, edges, externalReferences } = result.stats;
  log(
    `${result.ok ? "✓ Paquet valide" : "✗ Paquet invalide"} — ${nodes.notion} notions, ${nodes.competency} compétences, ${nodes.prerequisite} prérequis, ${nodes.domain} domaines ; ${edges.prerequisite_of} prerequisite_of, ${edges.supports} supports, ${edges.part_of} part_of ; ${externalReferences} référence(s) externe(s).`,
  );
  if (result.hash) log(`  empreinte : ${result.hash}`);
  if (result.errors.length) {
    log(`\n${result.errors.length} erreur(s) :`);
    printIssues(result.errors);
  }
  if (result.warnings.length) {
    log(`\n${result.warnings.length} avertissement(s) :`);
    printIssues(result.warnings);
  }
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "BLOQUÉ : définissez NEXT_PUBLIC_SUPABASE_URL (ou SUPABASE_URL) et SUPABASE_SERVICE_ROLE_KEY dans votre terminal local uniquement.",
    );
    process.exit(2);
  }
  if (new URL(url).protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname)) {
    console.error("BLOQUÉ : l’URL Supabase doit être en https.");
    process.exit(2);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function defaultMigrationPath(result: CurriculumValidationResult) {
  const pkg = result.package!;
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const slug = `${pkg.source.subjectCode}_${pkg.source.levelCode}`.toLowerCase();
  return path.join("supabase", "migrations", `${stamp}_curriculum_${slug}.sql`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== "validate") log = console.error;

  if (args.command === "export") {
    if (!args.out) usage("export attend --out <dossier>");
    const { data, error } = await serviceClient().rpc("focus_export_curriculum", {
      p_source_url: args.target,
    });
    if (error) throw new Error(`Export refusé : ${error.message}`);
    if (!data) throw new Error("Aucune source ne correspond à cette URL.");
    const result = validateCurriculumPackage(
      parseJsonCurriculumPackage(JSON.stringify(data), "export"),
    );
    report(result, false);
    if (!result.package) process.exit(1);
    const files = serializeCsvCurriculumPackage(result.package);
    mkdirSync(args.out, { recursive: true });
    writeFileSync(path.join(args.out, "source.json"), files.sourceJson);
    writeFileSync(path.join(args.out, "nodes.csv"), files.nodesCsv);
    if (files.edgesCsv) writeFileSync(path.join(args.out, "edges.csv"), files.edgesCsv);
    console.log(`\nExporté dans ${args.out}`);
    return;
  }

  if (!["validate", "sql", "apply"].includes(args.command))
    usage(`commande inconnue ${args.command}`);

  const result = validateWithContext(args);
  report(result, args.json && args.command === "validate");
  if (!result.ok || !result.package) process.exit(1);
  if (args.command === "validate") return;

  if (args.command === "sql") {
    const sql = renderCurriculumImportMigration(result.package, {
      allowMassDeactivation: args.allowMassDeactivation,
      generatedBy: `npm run curriculum -- sql ${args.target}`,
    });
    if (args.out === "-") {
      process.stdout.write(sql);
      return;
    }
    const out = args.out ?? defaultMigrationPath(result);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, sql);
    console.log(`\nMigration écrite : ${out}`);
    return;
  }

  // apply
  const { data, error } = await serviceClient().rpc("focus_import_curriculum", {
    p_package: result.package,
    p_dry_run: !args.commit,
    p_allow_mass_deactivation: args.allowMassDeactivation,
  });
  if (error) {
    console.error(`\nImport refusé par la base (aucune modification) : ${error.message}`);
    process.exit(1);
  }
  console.log(`\n${args.commit ? "Import appliqué" : "Simulation (rien n’a été écrit ; ajoutez --commit pour appliquer)"} :`);
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => {
  if (error instanceof CurriculumParseError)
    console.error(`✗ ${error.message}\n    ↳ ${error.at}`);
  else console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
