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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  loadCurriculumInput,
  loadCurriculumPackage,
  writeCsvCurriculumPackage,
} from "../lib/curriculum/fs";
import {
  CurriculumParseError,
  validateCurriculumChain,
  validateCurriculumPackage,
  validateExportedCurriculum,
} from "../lib/curriculum/package";
import { renderCurriculumImportMigration } from "../lib/curriculum/sql";
import { convertWorkCatalogue, renderCatalogueMigration } from "../lib/curriculum/work-catalogue";
import { applyWorkDecisions, deferWorkDisputes, workDecisionsTemplate } from "../lib/curriculum/work-decisions";
import type {
  CurriculumIssue,
  CurriculumValidationResult,
} from "../lib/curriculum/types";

interface Args {
  command: string;
  target: string;
  with: string[];
  decisions: string | null;
  deferDisputes: string | null;
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
      "  npm run curriculum -- work-disputes <document-work.json> [--out <fichier>|-]",
      "  (validate/sql/apply acceptent --decisions <fichier> pour un document Work)",
      "  (et --defer-disputes <paquet importé> : garde tel quel le lien déjà importé d’un litige non décidé, écarte le reste)",
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
    decisions: null,
    deferDisputes: null,
    out: null,
    json: false,
    commit: false,
    allowMassDeactivation: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--with") args.with.push(rest[++i] ?? usage("--with attend un chemin"));
    else if (flag === "--out") args.out = rest[++i] ?? usage("--out attend un chemin");
    else if (flag === "--decisions") args.decisions = rest[++i] ?? usage("--decisions attend un chemin");
    else if (flag === "--defer-disputes") args.deferDisputes = rest[++i] ?? usage("--defer-disputes attend le paquet actuellement importé");
    else if (flag === "--json") args.json = true;
    else if (flag === "--commit") args.commit = true;
    else if (flag === "--allow-mass-deactivation") args.allowMassDeactivation = true;
    else usage(`option inconnue ${flag}`);
  }
  return args;
}

// Human-readable diagnostics (stdout by default; stderr when stdout must stay
// machine-readable — see main()).
let log: (...values: unknown[]) => void = console.log;

function printIssues(issues: CurriculumIssue[]) {
  for (const issue of issues)
    log(
      `  ${issue.severity === "error" ? "✗" : "!"} [${issue.code}] ${issue.message}\n      ↳ ${issue.at}`,
    );
}

function validateWithContext(args: Args): CurriculumValidationResult {
  const input = loadCurriculumInput(args.target);
  let decisionIssues: CurriculumIssue[] = [];
  let conversion: import("../lib/curriculum/work-format").WorkConversion | null = input.work;
  if (args.decisions) {
    if (!input.work) usage("--decisions ne s’applique qu’à un document Work");
    const applied = applyWorkDecisions(
      input.work,
      input.work.document,
      JSON.parse(readFileSync(args.decisions, "utf8")),
      input.work.fileSha256,
    );
    input.raw = applied.conversion.raw;
    conversion = applied.conversion;
    decisionIssues = applied.issues;
    log(
      `Décisions ${args.decisions} : ${applied.applied} appliquée(s), ${applied.pending} en attente.`,
    );
  }
  if (args.deferDisputes) {
    if (!input.work || !conversion) usage("--defer-disputes ne s’applique qu’à un document Work");
    const current = validateCurriculumPackage(loadCurriculumPackage(args.deferDisputes));
    if (!current.package) usage(`le paquet importé ${args.deferDisputes} est invalide`);
    const deferral = deferWorkDisputes(conversion, input.work.document, current.package.edges);
    input.raw = deferral.conversion.raw;
    log(
      `Litiges non décidés : ${deferral.kept.length} relation(s) déjà importée(s) conservée(s) telles quelles, ${deferral.deferred.length} relation(s) écartée(s) en attente d’une décision d’auteur.`,
    );
    for (const item of deferral.kept) log(`  = conservée   ${item.from} —${item.relation}→ ${item.to}  (${item.disputeId})`);
    for (const item of deferral.deferred) log(`  ~ en attente ${item.from} —${item.relation}→ ${item.to}  (${item.disputeId})`);
  }
  // Context packages are validated cumulatively, in the order given.
  const chain = validateCurriculumChain(args.with.map(loadCurriculumPackage), input.raw);
  if (!chain.target) {
    const failed = chain.context.length - 1;
    const context = chain.context[failed];
    if (args.json)
      // Machine-readable failure: the context package's own issues, marked.
      return {
        ...context,
        ok: false,
        package: null,
        hash: null,
        failedContext: args.with[failed],
        errors: context.errors.map((issue) => ({
          ...issue,
          message: `[contexte ${args.with[failed]}] ${issue.message}`,
        })),
      } as CurriculumValidationResult;
    console.error(`Le paquet de contexte ${args.with[failed]} est invalide :`);
    printIssues(context.errors);
    process.exit(1);
  }
  const result = chain.target;
  if (!input.work) return result;

  // Rich Work document: report what is converted and what the schema cannot
  // hold yet, and merge the adapter's own consistency findings.
  const { program, counts, notImported, issues } = input.work;
  log(
    `Document Work « ${program.title} » (${program.id}, ${program.status}, version ${program.dataVersion}) : ${counts.nodes} nœuds dont ${counts.legacyNodes} existants et ${counts.newNodes} nouveaux, ${counts.edges} relations.`,
  );
  log(
    `  Non importé (pas de table correspondante) : ${notImported.domains} domaines, ${notImported.chapters} chapitres, ${notImported.objectives} objectifs, ${notImported.errors} erreurs types, ${notImported.remediations} remédiations, ${notImported.coverageRows} lignes de couverture, provenance des relations.`,
  );
  log(
    `  Validations enseignant : ${notImported.teacherValidatedNodes}/${counts.nodes} nœuds, ${notImported.teacherValidatedEdges}/${counts.edges} relations.`,
  );
  const errors = [
    ...decisionIssues,
    ...issues.filter((item) => item.severity === "error"),
    ...result.errors,
  ];
  const warnings = [...issues.filter((item) => item.severity === "warning"), ...result.warnings];
  return {
    ...result,
    ok: result.ok && errors.length === result.errors.length,
    errors,
    warnings,
    package: errors.length ? null : result.package,
    hash: errors.length ? null : result.hash,
  };
}

function report(result: CurriculumValidationResult, json: boolean) {
  if (json) {
    // The only thing written to stdout with --json.
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          ...("failedContext" in result ? { failedContext: result.failedContext } : {}),
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

let jsonOutput = false;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  jsonOutput = args.json && args.command === "validate";
  // Diagnostics go to stderr except for a human-readable `validate`, so that
  // `sql --out -` and `validate --json` keep stdout machine-readable.
  if (args.command !== "validate" || args.json) log = console.error;

  if (args.command === "export") {
    if (!args.out) usage("export attend --out <dossier>");
    const { data, error } = await serviceClient().rpc("focus_export_curriculum", {
      p_source_url: args.target,
    });
    if (error) throw new Error(`Export refusé : ${error.message}`);
    if (!data) throw new Error("Aucune source ne correspond à cette URL.");
    const result = validateExportedCurriculum(data, "export");
    report(result, false);
    if (!result.package) process.exit(1);
    writeCsvCurriculumPackage(args.out, result.package);
    console.log(`\nExporté dans ${args.out}`);
    return;
  }

  if (args.command === "catalogue-sql") {
    const input = loadCurriculumInput(args.target);
    if (!input.work) usage("catalogue-sql attend un document Work");
    const { catalogue, issues, counts } = convertWorkCatalogue(input.work.document, path.basename(args.target));
    printIssues(issues);
    if (!catalogue) process.exit(1);
    const sql = renderCatalogueMigration(catalogue, `npm run curriculum -- catalogue-sql ${args.target}`);
    if (!args.out || args.out === "-") process.stdout.write(sql);
    else writeFileSync(args.out, sql);
    console.error(
      `Catalogue : ${counts.nodes} nœuds, ${counts.objectives} objectifs, ${counts.errors} erreurs types, ${counts.remediations} remédiations${args.out && args.out !== "-" ? ` → ${args.out}` : ""}.`,
    );
    return;
  }

  if (args.command === "work-disputes") {
    const input = loadCurriculumInput(args.target);
    if (!input.work) usage("work-disputes attend un document Work");
    const template = workDecisionsTemplate(
      input.work,
      input.work.document,
      path.basename(args.target),
      input.work.fileSha256,
    );
    const json = JSON.stringify(template, null, 2) + "\n";
    if (args.out === "-" || !args.out) process.stdout.write(json);
    else writeFileSync(args.out, json);
    console.error(`${template.decisions.length} litige(s) listé(s), tous en attente de décision.`);
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
      generatedBy: ["npm run curriculum -- sql", args.target, ...args.with.flatMap((item) => ["--with", item]), ...(args.decisions ? ["--decisions", args.decisions] : []), ...(args.deferDisputes ? ["--defer-disputes", args.deferDisputes] : [])].join(" "),
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
  if (jsonOutput) {
    // --json always yields a JSON document on stdout, even for unreadable input.
    console.log(
      JSON.stringify(
        {
          ok: false,
          hash: null,
          errors: [
            {
              severity: "error",
              code: error instanceof CurriculumParseError ? "PARSE_ERROR" : "INTERNAL_ERROR",
              message: error instanceof Error ? error.message : String(error),
              at: error instanceof CurriculumParseError ? error.at : "",
            },
          ],
          warnings: [],
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (error instanceof CurriculumParseError)
    console.error(`✗ ${error.message}\n    ↳ ${error.at}`);
  else console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
