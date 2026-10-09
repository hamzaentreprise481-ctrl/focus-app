// TEMPORARY — evaluation branch only. Run by .github/workflows/focus-eval-collect.yml
// after a Preview of this branch is ready: sends each planned fictitious copy
// to the deployment's /api/focus-eval endpoint (one copy per request) and
// stores each JSON answer in a git worktree of the focus-eval-results branch,
// committing after every copy so partial runs are kept.
//
//   node scripts/eval/drive.mjs <deployment-url> <results-worktree> <sha>

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [url, worktree, sha] = process.argv.slice(2);
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const root = process.cwd();
const fixtures = path.join(root, "tests", "fixtures", "handwriting");
const spec = JSON.parse(readFileSync(path.join(fixtures, "spec.json"), "utf8"));
const manifest = JSON.parse(readFileSync(path.join(fixtures, "manifest.json"), "utf8"));
const plan = JSON.parse(readFileSync(path.join(root, "scripts", "eval", "PLAN.json"), "utf8"));
const outDir = path.join(worktree, sha);
mkdirSync(outDir, { recursive: true });

const git = (...args) => execFileSync("git", ["-C", worktree, ...args], { stdio: "pipe" }).toString();
function commit(message) {
  try {
    git("add", "-A");
    git("commit", "-qm", message);
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      git("push", "-q", "origin", "HEAD:refs/heads/focus-eval-results");
      return;
    } catch {
      try {
        git("pull", "-q", "--rebase", "origin", "focus-eval-results");
      } catch {
        /* first push of the branch */
      }
    }
  }
}

const runs = plan.runs ?? [];
writeFileSync(path.join(outDir, "plan.json"), JSON.stringify(plan, null, 2));
// Spend nothing unless the deployment's own health check says the model answers.
let health = null;
try {
  health = JSON.parse(readFileSync(path.join(outDir, "health.json"), "utf8"));
} catch {
  /* unreadable health */
}
if (health?.ai?.ok !== true) {
  writeFileSync(path.join(outDir, "STOPPED.txt"), `Not run: /api/health ai=${JSON.stringify(health?.ai ?? null)}\n`);
  commit(`eval ${sha.slice(0, 7)} not run: model not answering`);
  process.exit(0);
}
for (const run of runs) {
  const copies = run.copies === "all" ? manifest.copies : manifest.copies.filter((c) => run.copies.includes(c.id));
  for (const copy of copies) {
    const name = `${run.name}__${copy.id}.json`;
    if (existsSync(path.join(outDir, name))) continue;
    const file = copy.pdf ?? copy.image;
    const body = {
      copy,
      spec,
      fileBase64: readFileSync(path.join(fixtures, file)).toString("base64"),
      ...(run.options ?? {}),
    };
    const started = Date.now();
    let record;
    try {
      const response = await fetch(`${url}/api/focus-eval`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vercel-protection-bypass": bypass },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(330_000),
      });
      const text = await response.text();
      try {
        record = { httpStatus: response.status, ...JSON.parse(text) };
      } catch {
        record = { httpStatus: response.status, nonJson: text.slice(0, 300) };
      }
    } catch (error) {
      record = { driverError: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
    record.wallMs = Date.now() - started;
    record.run = run.name;
    record.level = copy.level ?? null;
    record.kind = copy.kind;
    writeFileSync(path.join(outDir, name), `${JSON.stringify(record, null, 2)}\n`);
    console.log(`${name}: http=${record.httpStatus ?? "-"} scan=${record.scan?.ok ? "ok" : record.scan?.error} analysis=${record.analysis?.ok ?? "-"} ${record.wallMs}ms`);
    commit(`eval ${sha.slice(0, 7)} ${name}`);
    // An exhausted credit is not temporary: stop instead of sending the rest.
    if (record.scan?.error === "SCAN_MODEL_QUOTA" || /OPENAI_REQUEST_FAILED/.test(String(record.analysis?.error ?? "")) && record.providerLog?.some((e) => e.errorType === "insufficient_quota")) {
      writeFileSync(path.join(outDir, "STOPPED.txt"), `Stopped after ${name}: OpenAI credit exhausted (insufficient_quota).\n`);
      commit(`eval ${sha.slice(0, 7)} stopped: credit exhausted`);
      process.exit(0);
    }
  }
}
commit(`eval ${sha.slice(0, 7)} done`);
