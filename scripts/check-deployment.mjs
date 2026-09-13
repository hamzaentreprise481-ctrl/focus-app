// Read-only anonymous checks. A pass does not certify real teacher login or RLS.
const supplied = process.argv[2];
if (!supplied) {
  console.error("Usage: npm run check:deployment -- https://your-focus-domain");
  process.exit(2);
}
let origin;
try {
  const url = new URL(supplied);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) {
    throw new Error("Invalid origin");
  }
  origin = url.origin;
} catch {
  console.error("Supply an HTTPS origin (or loopback HTTP), without credentials, path or query.");
  process.exit(2);
}
let failures = 0;
async function check(label, route, verify) {
  try {
    const response = await fetch(origin + route, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    if (!await verify(response)) throw new Error("Check failed");
    console.log(`PASS ${label}`);
  } catch {
    // Do not log response bodies, cookies, headers, or provider error payloads.
    console.error(`FAIL ${label}`);
    failures++;
  }
}
await check("public homepage and teacher login CTA", "/", async response => {
  if (response.status !== 200) return false;
  const html = await response.text();
  return /href="\/connexion"/.test(html) && /PRONOTE/.test(html) &&
    !/Bonjour Mme Martin|Se déconnecter/.test(html);
});
await check("FOCUS login page", "/connexion", async response => {
  if (response.status !== 200) return false;
  const html = await response.text();
  return /name="email"/.test(html) && /name="password"/.test(html);
});
await check("login configuration is enabled", "/connexion", async response => {
  if (response.status !== 200) return false;
  const html = await response.text();
  const email = html.match(/<input\b[^>]*name="email"[^>]*>/)?.[0];
  return !!email && !/\bdisabled(?:[\s=>])/.test(email);
});
for (const route of ["/app", "/app/classes", "/app/eleves", "/app/evaluations/nouvelle", "/app/parametres"]) {
  await check(`anonymous access denied: ${route}`, route, response => {
    const location = response.headers.get("location");
    if (response.status !== 307 || !location) return false;
    const target = new URL(location, origin);
    return target.origin === origin && target.pathname === "/connexion" &&
      /no-store/.test(response.headers.get("cache-control") ?? "");
  });
}
console.log("Real password login, refresh/logout, teacher workflows and database policies require separate QA.");
process.exitCode = failures ? 1 : 0;
