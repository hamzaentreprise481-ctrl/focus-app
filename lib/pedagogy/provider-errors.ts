// What went wrong when the model provider was called, in three families that
// must never be confused: the account's CREDIT (someone has to pay), the
// server's CONFIGURATION (someone has to fix a key or a model name), the
// PROVIDER itself (temporary: retry later) — and an unusable answer.
// Pure: shared by the copy reader and the analysis, tested in
// tests/provider-errors.test.ts. Messages never contain student data.

export type ProviderFailureKind =
  | "quota_exhausted"
  | "rate_limited"
  | "auth_rejected"
  | "model_unavailable"
  | "timeout"
  | "network"
  | "provider_down"
  | "invalid_output"
  | "unknown";

export type ProviderFailureFamily = "credit" | "configuration" | "provider" | "output";

export interface ProviderFailure {
  kind: ProviderFailureKind;
  family: ProviderFailureFamily;
  /** HTTP status of the provider, when there was one. */
  status: number | null;
}

const FAMILY: Record<ProviderFailureKind, ProviderFailureFamily> = {
  quota_exhausted: "credit",
  rate_limited: "provider",
  auth_rejected: "configuration",
  model_unavailable: "configuration",
  timeout: "provider",
  network: "provider",
  provider_down: "provider",
  invalid_output: "output",
  unknown: "provider",
};

/**
 * From a FOCUS code (OPENAI_REQUEST_FAILED:401, OPENAI_TIMEOUT, SCAN_MODEL_QUOTA,
 * SCAN_MODEL_HTTP_404…) and the provider's machine code, when it sent one.
 */
export function classifyProviderFailure(code: string, providerCode: string | null = null): ProviderFailure {
  const status = Number(code.match(/(?:OPENAI_REQUEST_FAILED:|SCAN_MODEL_HTTP_)(\d{3})/)?.[1] ?? NaN);
  const httpStatus = Number.isFinite(status) ? status : null;
  const kind: ProviderFailureKind =
    providerCode === "insufficient_quota" || providerCode === "credit_balance_exhausted" || code === "SCAN_MODEL_QUOTA"
      ? "quota_exhausted"
      : code === "OPENAI_TIMEOUT" || code === "SCAN_MODEL_TIMEOUT"
        ? "timeout"
        : code === "OPENAI_NETWORK_ERROR" || code === "SCAN_MODEL_NETWORK"
          ? "network"
          : /INVALID_OUTPUT|EMPTY_OUTPUT|SCAN_MODEL_EMPTY/.test(code)
            ? "invalid_output"
            : providerCode === "model_not_found" || httpStatus === 404
              ? "model_unavailable"
              : httpStatus === 401 || httpStatus === 403 || providerCode === "invalid_api_key"
                ? "auth_rejected"
                : httpStatus === 429 || code === "SCAN_MODEL_RATE_LIMITED"
                  ? "rate_limited"
                  : httpStatus !== null && httpStatus >= 500
                    ? "provider_down"
                    : "unknown";
  return { kind, family: FAMILY[kind], status: httpStatus };
}

const NOTHING = { analysis: "Rien n’a été enregistré.", scan: "Aucune copie n’a été importée." } as const;

/** The teacher-facing sentence: what happened, that nothing was saved, and who can act. */
export function providerFailureMessage(failure: ProviderFailure, context: "analysis" | "scan"): string {
  const service = context === "analysis" ? "le service d’analyse" : "le service de lecture des copies";
  const Service = service.charAt(0).toUpperCase() + service.slice(1);
  const nothing = NOTHING[context];
  switch (failure.kind) {
    case "quota_exhausted":
      return `Le crédit du fournisseur d’IA (OpenAI) est épuisé : ${service} ne peut pas fonctionner tant qu’il n’est pas rechargé. ${nothing} Prévenez l’administrateur de FOCUS.`;
    case "auth_rejected":
      return `${Service} refuse la clé configurée sur ce serveur (erreur de configuration, pas de votre fait). ${nothing} Prévenez l’administrateur de FOCUS.`;
    case "model_unavailable":
      return `Le modèle d’IA configuré sur ce serveur n’est pas disponible (erreur de configuration). ${nothing} Prévenez l’administrateur de FOCUS.`;
    case "rate_limited":
      return `${Service} est momentanément saturé. ${nothing} Réessayez dans quelques minutes.`;
    case "timeout":
      return context === "analysis"
        ? `${Service} n’a pas répondu à temps. ${nothing} Réessayez.`
        : `La lecture des copies a dépassé le délai prévu. ${nothing} Réessayez avec moins de pages à la fois.`;
    case "network":
    case "provider_down":
      return `${Service} est injoignable ou en panne pour le moment. ${nothing} Réessayez plus tard.`;
    case "invalid_output":
      return `${Service} a renvoyé une réponse inexploitable ; FOCUS l’a refusée plutôt que de deviner. ${nothing} Réessayez.`;
    default:
      return `${Service} n’a pas abouti. ${nothing} Réessayez plus tard.`;
  }
}

/**
 * One JSON line for the server logs: enough to tell credit, configuration,
 * provider and application apart, and NOTHING about the student (no text,
 * no name, no identifier) nor the provider's message (it may echo input).
 */
export function providerFailureLog(
  stage: "analysis" | "scan",
  failure: ProviderFailure,
  details: { code: string; providerCode?: string | null; model: string; attempts?: number | null; latencyMs?: number | null },
) {
  return JSON.stringify({
    event: "focus.ai_failure",
    stage,
    kind: failure.kind,
    family: failure.family,
    status: failure.status,
    code: details.code.slice(0, 64),
    providerCode: details.providerCode ?? null,
    model: details.model,
    attempts: details.attempts ?? null,
    latencyMs: details.latencyMs ?? null,
  });
}
