// What a Preview deployment can prove about its own configuration, without
// revealing any value: booleans, the model name, the environment, the git
// commit it was built from, and the database's schema version.

import { authConfig } from "@/lib/auth/config";

/** The last migration this code needs; tests pin it to the newest file. */
export const REQUIRED_SCHEMA_VERSION = "20260927100000";

export interface DeploymentHealth {
  service: "focus-teacher";
  environment: string;
  gitSha: string | null;
  gitRef: string | null;
  supabase: {
    configured: boolean;
    authReachable: boolean | null;
    schemaVersion: string | null;
    schemaUpToDate: boolean | null;
    requiredSchemaVersion: string;
  };
  ai: {
    configured: boolean;
    ok: boolean;
    model: string;
    apiStatus: number | null;
    error: string | null;
  };
  /** Everything the teacher flow needs is configured and reachable. */
  ready: boolean;
}

type Fetch = typeof fetch;

async function supabaseState(fetchImpl: Fetch) {
  const config = authConfig();
  if (!config) return { configured: false, authReachable: null, schemaVersion: null };
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}` };
  const base = config.url.replace(/\/+$/, "");
  let authReachable = false;
  try {
    const response = await fetchImpl(`${base}/auth/v1/health`, { headers, cache: "no-store", signal: AbortSignal.timeout(5000) });
    authReachable = response.ok;
  } catch {
    authReachable = false;
  }
  let schemaVersion: string | null = null;
  try {
    const response = await fetchImpl(`${base}/rest/v1/rpc/focus_schema_version`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const value: unknown = await response.json();
      schemaVersion = typeof value === "string" && /^\d{14}$/.test(value) ? value : null;
    }
  } catch {
    schemaVersion = null;
  }
  return { configured: true, authReachable, schemaVersion };
}

export async function deploymentHealth(
  probeAi: () => Promise<DeploymentHealth["ai"]>,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: Fetch = fetch,
): Promise<DeploymentHealth> {
  const [supabase, ai] = await Promise.all([supabaseState(fetchImpl), probeAi()]);
  const schemaUpToDate = supabase.schemaVersion === null ? (supabase.configured ? false : null) : supabase.schemaVersion >= REQUIRED_SCHEMA_VERSION;
  const sha = env.VERCEL_GIT_COMMIT_SHA ?? "";
  return {
    service: "focus-teacher",
    environment: env.VERCEL_ENV || "local",
    gitSha: /^[0-9a-f]{40}$/.test(sha) ? sha : null,
    gitRef: env.VERCEL_GIT_COMMIT_REF ? env.VERCEL_GIT_COMMIT_REF.slice(0, 200) : null,
    supabase: { ...supabase, schemaUpToDate, requiredSchemaVersion: REQUIRED_SCHEMA_VERSION },
    ai,
    ready: supabase.configured && supabase.authReachable === true && schemaUpToDate === true && ai.configured && ai.ok,
  };
}
