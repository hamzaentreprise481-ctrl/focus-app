// Forgotten password, reset link, invitation and the new-password page, on
// the built app against the Supabase stand-in (real schema in PGlite).

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { LOCAL_TEACHER, NON_TEACHER, OTHER_TEACHER, startLocalStack, type LocalStack } from "../helpers/local-stack";

const origin = "http://127.0.0.1:3120";
let stack: LocalStack;
let app: ChildProcess;
let jar = "";

function keep(response: Response) {
  const map = new Map(jar.split("; ").filter(Boolean).map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)]));
  for (const header of response.headers.getSetCookie()) {
    const part = header.split(";")[0];
    const name = part.slice(0, part.indexOf("="));
    const value = part.slice(part.indexOf("=") + 1);
    if (!value || /max-age=0/i.test(header)) map.delete(name);
    else map.set(name, value);
  }
  jar = [...map].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(origin + path, { redirect: "manual", ...init, headers: { Cookie: jar, ...init.headers } });
  keep(response);
  return response;
}
function actionForm(html: string, needle: string) {
  const form = html.match(new RegExp(`<form[^>]*>[\\s\\S]*?${needle}[\\s\\S]*?<\\/form>`))?.[0];
  assert.ok(form, `form with ${needle}`);
  const body = new FormData();
  for (const match of form.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1];
    const value = (match[0].match(/value="([^"]*)"/)?.[1] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
    if (name) body.set(name, value);
  }
  return body;
}
async function submit(path: string, needle: string, fields: Record<string, string>) {
  const body = actionForm(await (await request(path)).text(), needle);
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return request(path, { method: "POST", headers: { Origin: origin }, body });
}
async function login(email: string, password: string) {
  jar = "";
  return submit("/connexion", "Se connecter", { email, password });
}

before(async () => {
  stack = await startLocalStack({ supabasePort: 54331, modelPort: 54339 });
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3120", "-H", "127.0.0.1"], {
    env: { ...process.env, ...stack.env, FOCUS_SITE_URL: origin },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(origin);
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error("app did not start");
});
after(async () => {
  app?.kill("SIGTERM");
  await stack?.close();
});

test("the login page offers the forgotten-password path", async () => {
  jar = "";
  assert.match(await (await request("/connexion")).text(), /href="\/connexion\/mot-de-passe-oublie"/);
});

test("a reset request answers the same for a known and an unknown address", async () => {
  jar = "";
  const unknown = await submit("/connexion/mot-de-passe-oublie", "Recevoir un lien", { email: "nobody@example.test" });
  const known = await submit("/connexion/mot-de-passe-oublie", "Recevoir un lien", { email: LOCAL_TEACHER.email });
  for (const response of [unknown, known]) {
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Si un compte correspond à cette adresse/);
  }
  assert.ok(stack.supabase.emailToken(LOCAL_TEACHER.email, "recovery"), "a link was issued for the known address");
});

test("reset link → new password → teacher space; the old password stops working", async () => {
  jar = "";
  await submit("/connexion/mot-de-passe-oublie", "Recevoir un lien", { email: LOCAL_TEACHER.email });
  const token = stack.supabase.emailToken(LOCAL_TEACHER.email, "recovery")!;
  const confirm = await request(`/auth/confirm?token_hash=${token}&type=recovery`);
  assert.equal(confirm.status, 307);
  assert.equal(new URL(confirm.headers.get("location")!, origin).pathname, "/connexion/nouveau-mot-de-passe");
  assert.match(jar, /-auth-token/);

  // The link works once.
  const saved = jar;
  jar = "";
  const reused = await request(`/auth/confirm?token_hash=${token}&type=recovery`);
  assert.equal(new URL(reused.headers.get("location")!, origin).search, "?lien=invalide");
  jar = saved;

  for (const [password, confirmation, message] of [
    ["court", "court", /au moins 12 caractères/],
    ["une phrase assez longue", "une autre phrase longue", /pas identiques/],
    ["aaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaa", /trop simple/],
  ] as const) {
    const response = await submit("/connexion/nouveau-mot-de-passe", "Enregistrer le mot de passe", { password, confirmation });
    assert.equal(response.status, 200);
    assert.match(await response.text(), message);
  }
  const done = await submit("/connexion/nouveau-mot-de-passe", "Enregistrer le mot de passe", {
    password: "nouvelle phrase de passe 2026",
    confirmation: "nouvelle phrase de passe 2026",
  });
  assert.equal(done.status, 303);
  assert.equal(new URL(done.headers.get("location")!, origin).pathname, "/app");
  assert.equal(stack.supabase.passwordOf(LOCAL_TEACHER.email), "nouvelle phrase de passe 2026");

  assert.match(await (await login(LOCAL_TEACHER.email, LOCAL_TEACHER.password)).text(), /Connexion impossible/);
  assert.equal((await login(LOCAL_TEACHER.email, "nouvelle phrase de passe 2026")).status, 303);
});

test("an invitation lets the invited teacher choose a password and enter", async () => {
  jar = "";
  const token = stack.supabase.emailToken(OTHER_TEACHER.email, "invite")!;
  const confirm = await request(`/auth/confirm?token_hash=${token}&type=invite`);
  assert.equal(new URL(confirm.headers.get("location")!, origin).search, "?bienvenue=1");
  assert.match(await (await request("/connexion/nouveau-mot-de-passe?bienvenue=1")).text(), /Bienvenue sur FOCUS/);
  const done = await submit("/connexion/nouveau-mot-de-passe?bienvenue=1", "Enregistrer le mot de passe", {
    password: "phrase choisie à l’invitation",
    confirmation: "phrase choisie à l’invitation",
  });
  assert.equal(done.status, 303);
  assert.equal((await request("/app")).status, 200);
});

test("a non-teacher account can set a password but still cannot enter", async () => {
  jar = "";
  const token = stack.supabase.emailToken(NON_TEACHER.email, "invite")!;
  await request(`/auth/confirm?token_hash=${token}&type=invite`);
  const response = await submit("/connexion/nouveau-mot-de-passe", "Enregistrer le mot de passe", {
    password: "mot de passe du parent fictif",
    confirmation: "mot de passe du parent fictif",
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /n’a pas encore accès à l’espace professeur/);
  assert.equal((await request("/app")).status, 307);
});

test("invalid, forged or missing links never open a session", async () => {
  for (const query of ["token_hash=forged&type=recovery", "token_hash=forged&type=signup", "type=recovery", "code=forged", ""]) {
    jar = "";
    const response = await request(`/auth/confirm?${query}`);
    assert.equal(response.status, 307, query);
    assert.equal(new URL(response.headers.get("location")!, origin).search, "?lien=invalide", query);
    assert.doesNotMatch(jar, /-auth-token/, query);
  }
  jar = "";
  assert.match(await (await request("/connexion/nouveau-mot-de-passe")).text(), /Ce lien n’est plus valable/);
});
