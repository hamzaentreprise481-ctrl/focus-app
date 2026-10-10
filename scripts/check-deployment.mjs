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
// The portal's invariants, not its wording: each space is named and has its
// own login link, labelled with that space, and nothing private is rendered.
await check("public homepage with the three spaces", "/", async response => {
  if (response.status !== 200) return false;
  const html = await response.text();
  const links = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(([, href, inner]) => ({ href, text: inner.replace(/<[^>]*>/g, " ") }));
  const leadsTo = (href, space) => links.some(link => link.href === href && space.test(link.text));
  return leadsTo("/connexion", /Teacher/) && leadsTo("/connexion-eleve", /Student/) &&
    leadsTo("/connexion-direction", /Direct(?:ion|or)/) &&
    /Teacher/.test(html) && /Student/.test(html) && /Direction/.test(html) &&
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
for (const [label, route] of [["student login page", "/connexion-eleve"], ["direction login page", "/connexion-direction"]]) {
  await check(label, route, async response => {
    if (response.status !== 200) return false;
    const html = await response.text();
    return /name="email"/.test(html) && /name="password"/.test(html);
  });
}
for (const [route, login] of [["/student", "/connexion-eleve"], ["/director", "/connexion-direction"]]) {
  await check(`anonymous access denied: ${route}`, route, response => {
    const location = response.headers.get("location");
    if (response.status !== 307 || !location) return false;
    const target = new URL(location, origin);
    return target.origin === origin && target.pathname === login &&
      /no-store/.test(response.headers.get("cache-control") ?? "");
  });
}
for (const route of ["/app", "/app/classes", "/app/eleves", "/app/evaluations/nouvelle", "/app/parametres"]) {
  await check(`anonymous access denied: ${route}`, route, response => {
    const location = response.headers.get("location");
    if (response.status !== 307 || !location) return false;
    const target = new URL(location, origin);
    return target.origin === origin && target.pathname === "/connexion" &&
      /no-store/.test(response.headers.get("cache-control") ?? "");
  });
}
console.log("Real password login, refresh/logout, teacher/student/direction workflows and database policies require separate QA.");
process.exitCode = failures ? 1 : 0;
