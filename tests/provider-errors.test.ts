// Credit, configuration, provider, unusable answer: the four families of a
// failed model call are never confused, in the teacher's message or in the
// server log, and the log never carries student data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyProviderFailure, providerFailureLog, providerFailureMessage } from "../lib/pedagogy/provider-errors";

test("each provider failure lands in its own family", () => {
  const cases: Array<[string, string | null, string, string]> = [
    ["OPENAI_REQUEST_FAILED:429", "insufficient_quota", "quota_exhausted", "credit"],
    ["SCAN_MODEL_QUOTA", "insufficient_quota", "quota_exhausted", "credit"],
    ["OPENAI_REQUEST_FAILED:429", "rate_limit_exceeded", "rate_limited", "provider"],
    ["SCAN_MODEL_RATE_LIMITED", null, "rate_limited", "provider"],
    ["OPENAI_REQUEST_FAILED:401", "invalid_api_key", "auth_rejected", "configuration"],
    ["SCAN_MODEL_HTTP_403", null, "auth_rejected", "configuration"],
    ["OPENAI_REQUEST_FAILED:404", "model_not_found", "model_unavailable", "configuration"],
    ["OPENAI_REQUEST_FAILED:400", "model_not_found", "model_unavailable", "configuration"],
    ["OPENAI_REQUEST_FAILED:503", null, "provider_down", "provider"],
    ["SCAN_MODEL_HTTP_500", null, "provider_down", "provider"],
    ["OPENAI_TIMEOUT", null, "timeout", "provider"],
    ["SCAN_MODEL_NETWORK", null, "network", "provider"],
    ["OPENAI_INVALID_OUTPUT", null, "invalid_output", "output"],
    ["SCAN_MODEL_INVALID_OUTPUT", null, "invalid_output", "output"],
    ["SCAN_MODEL_EMPTY", null, "invalid_output", "output"],
  ];
  for (const [code, providerCode, kind, family] of cases) {
    const failure = classifyProviderFailure(code, providerCode);
    assert.deepEqual([failure.kind, failure.family], [kind, family], `${code} / ${providerCode}`);
  }
});

test("the teacher is told who can act, and that nothing was saved", () => {
  const quota = providerFailureMessage(classifyProviderFailure("OPENAI_REQUEST_FAILED:429", "insufficient_quota"), "analysis");
  assert.match(quota, /crédit du fournisseur d’IA \(OpenAI\) est épuisé/);
  assert.match(quota, /Rien n’a été enregistré/);
  assert.match(quota, /administrateur/);
  const config = providerFailureMessage(classifyProviderFailure("OPENAI_REQUEST_FAILED:401", null), "scan");
  assert.match(config, /erreur de configuration/);
  assert.match(config, /Aucune copie n’a été importée/);
  const busy = providerFailureMessage(classifyProviderFailure("SCAN_MODEL_RATE_LIMITED"), "scan");
  assert.match(busy, /Réessayez dans quelques minutes/);
  assert.doesNotMatch(busy, /administrateur/, "a temporary saturation is not the administrator's problem");
  const invalid = providerFailureMessage(classifyProviderFailure("OPENAI_INVALID_OUTPUT"), "analysis");
  assert.match(invalid, /refusée plutôt que de deviner/);
});

test("the log line is structured and carries no student data", () => {
  const line = providerFailureLog("analysis", classifyProviderFailure("OPENAI_REQUEST_FAILED:429", "insufficient_quota"), {
    code: "OPENAI_REQUEST_FAILED:429",
    providerCode: "insufficient_quota",
    model: "gpt-6-astra",
    attempts: 1,
    latencyMs: 1077,
  });
  assert.deepEqual(JSON.parse(line), {
    event: "focus.ai_failure",
    stage: "analysis",
    kind: "quota_exhausted",
    family: "credit",
    status: 429,
    code: "OPENAI_REQUEST_FAILED:429",
    providerCode: "insufficient_quota",
    model: "gpt-6-astra",
    attempts: 1,
    latencyMs: 1077,
  });
});
