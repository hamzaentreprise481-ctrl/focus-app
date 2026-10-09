// TEMPORARY — evaluation branch only (work/fiabiliser-analyse-ia-eval).
// Runs ONE fictitious handwritten copy (tests/fixtures/handwriting) through
// the FIXED pipeline of this deployment — the production reader
// (lib/scan-transcription) and analysis, via runHandwritingCopy, the same
// code as `npm run test:handwriting-live` — with the Preview's own model key.
// Returns the record (transcription of the FICTITIOUS copy, legibility,
// outcomes, findings) plus provider diagnostics (status, rate-limit headers,
// error codes — never bodies). Preview only; behind Vercel Authentication.

import { NextResponse } from "next/server";
import curriculum from "@/scripts/eval/curriculum.json";
import { scanImportModel } from "@/lib/scan-import";
import { scanReasoningEffort } from "@/lib/scan-transcription";
import { pedagogicalReasoningEffort, type ReasoningEffort } from "@/lib/pedagogy/openai-client";
import { pedagogicalAiModel } from "@/lib/pedagogy/openai";
import { runHandwritingCopy, type CurriculumProjection, type HandwritingSpec, type ManifestCopy } from "@/tests/helpers/handwriting-eval";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  copy: ManifestCopy;
  spec: HandwritingSpec;
  fileBase64: string;
  input?: "pdf" | "images";
  scanEffort?: ReasoningEffort;
  analyse?: boolean;
};

const effortOf = (value: unknown, fallback: ReasoningEffort): ReasoningEffort =>
  value === "low" || value === "medium" || value === "high" ? value : fallback;

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview" || !process.env.OPENAI_API_KEY) return new NextResponse(null, { status: 404 });
  const body = (await request.json()) as Body;
  const providerLog: Array<Record<string, unknown>> = [];
  const realFetch = globalThis.fetch;
  // Diagnostics only (no retry here: the production client's own bounded
  // retries are what is measured).
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = Date.now();
    const response = await realFetch(input, init);
    const headers = Object.fromEntries([...response.headers.entries()].filter(([k]) => k.startsWith("x-ratelimit") || k === "retry-after"));
    const entry: Record<string, unknown> = { status: response.status, ms: Date.now() - started, headers };
    if (!response.ok) {
      try {
        const err = (await response.clone().json()) as { error?: { code?: string; type?: string } };
        entry.errorCode = err.error?.code ?? null;
        entry.errorType = err.error?.type ?? null;
      } catch {
        entry.errorCode = "unparsable";
      }
    }
    providerLog.push(entry);
    return response;
  }) as typeof fetch;
  try {
    const analysisModel = pedagogicalAiModel();
    const record = await runHandwritingCopy(
      body.copy,
      body.spec,
      curriculum as unknown as CurriculumProjection,
      {
        apiKey: process.env.OPENAI_API_KEY,
        scanModel: scanImportModel(),
        scanEffort: effortOf(body.scanEffort, scanReasoningEffort()),
        analysisModel,
        analysisEffort: pedagogicalReasoningEffort(),
        input: body.input === "images" ? "images" : "pdf",
        analyse: body.analyse !== false,
        fetchImpl,
      },
      new Uint8Array(Buffer.from(body.fileBase64, "base64")),
    );
    return NextResponse.json({ ...record, providerLog });
  } catch (error) {
    return NextResponse.json({ id: body.copy?.id, harnessError: error instanceof Error ? error.message : String(error), providerLog }, { status: 500 });
  }
}
