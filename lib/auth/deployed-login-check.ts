// End-to-end check of a deployed FOCUS: the real login form (server action),
// the session cookies, a reload, the teacher pages, logout and anonymous
// denial, exactly as a browser does it. Reports each step; never returns a
// password, cookie value, token or page content.

import type { DiagnosisStep } from "./login-diagnosis";
import { SCHEMA_OUTDATED_MESSAGE } from "../supabase-errors";

export interface DeployedCheckInput {
  origin: string;
  email: string;
  password: string;
  /** Vercel "Protection Bypass for Automation" secret, for protected Previews. */
  bypassSecret?: string;
  fetchImpl?: typeof fetch;
}

const PAGE_FAILED = "Cette page n’a pas pu être chargée";
const TEACHER_PAGES = ["/app/classes", "/app/eleves", "/app/evaluations"];

class Browser {
  private jar = new Map<string, string>();
  constructor(
    private readonly origin: string,
    private readonly fetchImpl: typeof fetch,
    private readonly bypassSecret?: string,
  ) {}
  forget() {
    this.jar.clear();
  }
  get hasSession() {
    return [...this.jar.keys()].some((name) => /-auth-token(\.\d+)?$/.test(name));
  }
  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.jar.size) headers.set("Cookie", [...this.jar].map(([name, value]) => `${name}=${value}`).join("; "));
    if (this.bypassSecret) headers.set("x-vercel-protection-bypass", this.bypassSecret);
    const response = await this.fetchImpl(new URL(path, this.origin), { ...init, headers, redirect: "manual" });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";")[0];
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      if (!value || /max-age=0/i.test(header) || /expires=Thu, 01 Jan 1970/i.test(header)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return response;
  }
}

/** The fields of the server-action form that contains `needle`. */
export function formFields(html: string, needle: string) {
  const form = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((match) => match[0]).find((candidate) => candidate.includes(needle));
  if (!form) return null;
  const body = new FormData();
  for (const match of form.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1];
    const value = (match[0].match(/value="([^"]*)"/)?.[1] ?? "")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    if (name) body.set(name, value);
  }
  return body;
}

const pathOf = (response: Response, origin: string) => {
  const location = response.headers.get("location");
  return location ? new URL(location, origin).pathname : null;
};

export async function checkDeployedLogin(input: DeployedCheckInput): Promise<DiagnosisStep[]> {
  const steps: DiagnosisStep[] = [];
  const add = (step: string, ok: boolean, detail: string) => {
    steps.push({ step, ok, detail });
    return ok;
  };
  const origin = new URL(input.origin).origin;
  const browser = new Browser(origin, input.fetchImpl ?? fetch, input.bypassSecret);

  let loginPage: Response;
  try {
    loginPage = await browser.request("/connexion");
  } catch {
    add("app_reachable", false, `${origin} est injoignable depuis cette machine.`);
    return steps;
  }
  const loginHtml = await loginPage.text();
  if (loginPage.status === 401 || loginPage.status === 403 || (loginPage.status >= 300 && loginPage.status < 400)) {
    add("app_reachable", false, `Réponse ${loginPage.status} : le déploiement est protégé (Vercel Authentication). Fournir le secret « Protection Bypass for Automation ».`);
    return steps;
  }
  const loginForm = loginPage.ok ? formFields(loginHtml, "Se connecter") : null;
  if (!add("login_page", !!loginForm && !/disabled=""[^>]*name="email"|name="email"[^>]*disabled=""/.test(loginHtml), loginForm ? "La page de connexion s’affiche." : `La page de connexion ne s’affiche pas (${loginPage.status}).`))
    return steps;

  loginForm!.set("email", input.email);
  loginForm!.set("password", input.password);
  const submitted = await browser.request("/connexion", { method: "POST", headers: { Origin: origin }, body: loginForm! });
  const landed = pathOf(submitted, origin);
  if (!add("login_submit", submitted.status === 303 && !!landed?.startsWith("/app") && browser.hasSession, submitted.status === 303 && landed?.startsWith("/app") ? "Connexion acceptée, redirection vers l’espace professeur." : "Connexion refusée par l’application (voir npm run check:login pour l’étape Supabase)."))
    return steps;
  const cookies = submitted.headers.getSetCookie().filter((header) => /-auth-token/.test(header));
  add(
    "session_cookie",
    cookies.length > 0 && cookies.every((header) => /HttpOnly/i.test(header) && /SameSite=Lax/i.test(header) && (origin.startsWith("http:") || /Secure/i.test(header))),
    "Cookie de session HttpOnly, SameSite=Lax" + (origin.startsWith("https:") ? ", Secure." : "."),
  );

  for (const [step, path] of [["teacher_home", "/app"], ["reload", "/app"]] as const) {
    const page = await browser.request(path);
    const html = page.status === 200 ? await page.text() : "";
    add(
      step,
      page.status === 200 && !html.includes(PAGE_FAILED) && !html.includes(SCHEMA_OUTDATED_MESSAGE) && /no-store/.test(page.headers.get("cache-control") ?? ""),
      page.status !== 200
        ? `${path} répond ${page.status}.`
        : html.includes(SCHEMA_OUTDATED_MESSAGE)
          ? "Connecté, mais la base n’est pas à jour : migrations FOCUS à appliquer."
          : step === "reload"
            ? "Après rechargement, la session est toujours valide."
            : "L’espace professeur s’affiche (privé, no-store).",
    );
    if (/service_role|sb_secret_/.test(html)) add("no_secret_in_page", false, "Une clé secrète apparaît dans la page.");
  }

  for (const path of TEACHER_PAGES) {
    const page = await browser.request(path);
    const html = page.status === 200 ? await page.text() : "";
    add(
      `page ${path}`,
      page.status === 200 && !html.includes(PAGE_FAILED) && !html.includes(SCHEMA_OUTDATED_MESSAGE),
      page.status !== 200 ? `répond ${page.status}.` : html.includes(SCHEMA_OUTDATED_MESSAGE) ? "base pas à jour." : html.includes(PAGE_FAILED) ? "lecture des données en échec." : "données chargées.",
    );
  }

  const home = await browser.request("/app");
  const logoutForm = home.status === 200 ? formFields(await home.text(), "Se déconnecter") : null;
  if (add("logout_form", !!logoutForm, logoutForm ? "Bouton de déconnexion présent." : "Bouton de déconnexion introuvable.")) {
    const out = await browser.request("/app", { method: "POST", headers: { Origin: origin }, body: logoutForm! });
    add("logout", out.status === 303 && pathOf(out, origin) === "/connexion" && !browser.hasSession, "Déconnexion : cookies de session supprimés.");
    const after = await browser.request("/app");
    add("after_logout", after.status === 307 && pathOf(after, origin) === "/connexion", "Après déconnexion, /app renvoie vers la connexion.");
  }

  browser.forget();
  const anonymous = await browser.request("/app/eleves");
  add("anonymous_denied", anonymous.status === 307 && pathOf(anonymous, origin) === "/connexion", "Sans session, /app/eleves renvoie vers la connexion.");
  return steps;
}
