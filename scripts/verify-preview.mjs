// Verifies ONE deployment: that it serves the expected commit and that its
// Supabase, database schema and model are usable. It reads /api/health,
// prints only booleans, versions and the model name, and exits:
//   0  VERIFIED     — the deployment runs EXPECTED_SHA and is ready
//   1  NOT READY    — reachable, right commit, but something is missing
//   2  UNVERIFIED   — could not prove anything (protection, wrong commit,
//                      unreachable, not JSON); never treat this as a pass
//
//   node scripts/verify-preview.mjs <deployment-url> <expected-sha>
//
// A Vercel-protected deployment needs VERCEL_AUTOMATION_BYPASS_SECRET (a
// "Protection Bypass for Automation" secret); it is sent as a header and
// never printed.

const [supplied, expectedSha] = process.argv.slice(2);
function finish(code, verdict, details = {}) {
  console.log(JSON.stringify({ verdict, ...details }, null, 2));
  process.exit(code);
}
if (!supplied || !/^[0-9a-f]{40}$/.test(expectedSha ?? "")) {
  console.error("Usage: node scripts/verify-preview.mjs <https-deployment-url> <40-char-git-sha>");
  process.exit(2);
}
let origin;
try {
  const url = new URL(supplied);
  const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.username || url.password || !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) throw new Error();
  origin = url.origin;
} catch {
  finish(2, "UNVERIFIED", { reason: "invalid deployment URL" });
}

const headers = { Accept: "application/json" };
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (bypass) headers["x-vercel-protection-bypass"] = bypass;

let response;
try {
  response = await fetch(`${origin}/api/health`, { headers, redirect: "manual", signal: AbortSignal.timeout(30000) });
} catch {
  finish(2, "UNVERIFIED", { reason: "deployment unreachable", origin });
}
const type = response.headers.get("content-type") ?? "";
if ([301, 302, 303, 307, 308, 401, 403].includes(response.status) || !type.includes("application/json")) {
  finish(2, "UNVERIFIED", {
    reason: bypass
      ? "the deployment did not return the health JSON (protection bypass refused, old deployment without /api/health, or error page)"
      : "the deployment is protected (Vercel Authentication) or has no /api/health; set VERCEL_AUTOMATION_BYPASS_SECRET to verify it",
    httpStatus: response.status,
    origin,
  });
}
let health;
try {
  health = await response.json();
} catch {
  finish(2, "UNVERIFIED", { reason: "health response is not valid JSON", httpStatus: response.status, origin });
}
const summary = {
  origin,
  httpStatus: response.status,
  environment: health.environment,
  expectedSha,
  deployedSha: health.gitSha,
  gitRef: health.gitRef,
  supabase: health.supabase,
  ai: health.ai,
};
if (health.gitSha !== expectedSha)
  finish(2, "UNVERIFIED", { reason: "the deployment does not run the expected commit", ...summary });
if (health.ready !== true) finish(1, "NOT READY", summary);
finish(0, "VERIFIED", summary);
