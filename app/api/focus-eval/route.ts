// TEMPORARY — evaluation branch only (work/fiabiliser-analyse-ia-eval).
// Runs ONE fictitious handwritten copy through the scan transcription and the
// pedagogical analysis of THIS deployment's code, with the Preview's own
// model key, and returns raw and validated outputs plus provider
// diagnostics (status, rate-limit headers, error codes — never bodies).
// Preview only; the deployment itself is behind Vercel Authentication.

import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import curriculum from "@/scripts/eval/curriculum.json";
import { extractScanStack, scanImportModel } from "@/lib/scan-import";
import { normalizedResponses, scanCopyIssue, type ScanQuestion } from "@/lib/scan-import-core";
import { pedagogicalReasoningEffort, requestPedagogicalAnalysisWithUsage } from "@/lib/pedagogy/openai-client";
import { pedagogicalAiModel } from "@/lib/pedagogy/openai";
import { relatedNotionCodes, validateModelAnalysis } from "@/lib/pedagogy/analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  copyId: string;
  student: string | null;
  assessmentKey: string;
  questions: Array<{ key: string; prompt: string; correction: string; maxPoints: number; notions: string[] }>;
  roster: Array<{ key: string; name: string }>;
  file: { kind: "pdf" | "jpeg"; base64: string };
  harnessRetries?: number;
};

const uuid = async (seed: string) => {
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`focus-eval:${seed}`))).toString("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
};

async function jpegToPdf(jpeg: Uint8Array) {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedJpg(jpeg);
  const page = pdf.addPage([image.width * 0.6, image.height * 0.6]);
  page.drawImage(image, { x: 0, y: 0, width: image.width * 0.6, height: image.height * 0.6 });
  return pdf.save();
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview" || !process.env.OPENAI_API_KEY) return new NextResponse(null, { status: 404 });
  const body = (await request.json()) as Body;
  const providerLog: Array<Record<string, unknown>> = [];
  const realFetch = globalThis.fetch;
  const retries = Math.min(Math.max(body.harnessRetries ?? 0, 0), 4);
  // Diagnostics only around /responses; the harness may retry 429/5xx itself
  // (counted) so that a rate limit is measured, not mistaken for a result.
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/responses")) return realFetch(input, init);
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      const response = await realFetch(input, init);
      const headers = Object.fromEntries([...response.headers.entries()].filter(([k]) => k.startsWith("x-ratelimit") || k === "retry-after"));
      const entry: Record<string, unknown> = { status: response.status, ms: Date.now() - started, attempt, headers };
      if (!response.ok) {
        try {
          const err = (await response.clone().json()) as { error?: { code?: string; type?: string; param?: string } };
          entry.errorCode = err.error?.code ?? null;
          entry.errorType = err.error?.type ?? null;
          entry.errorParam = err.error?.param ?? null;
        } catch {
          entry.errorCode = "unparsable";
        }
      }
      providerLog.push(entry);
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await new Promise((r) => setTimeout(r, Math.min(8_000 * 2 ** attempt, 30_000)));
        continue;
      }
      return response;
    }
  }) as typeof fetch;
  globalThis.fetch = fetchImpl;
  try {
    const questions: ScanQuestion[] = await Promise.all(
      body.questions.map(async (q, index) => ({ id: await uuid(`question:${body.assessmentKey}:${q.key}`), position: index + 1, prompt: q.prompt, maxPoints: q.maxPoints })),
    );
    const roster = await Promise.all(body.roster.map(async (s) => ({ id: await uuid(`student:${s.key}`), name: s.name, key: s.key })));
    const keyById = new Map(questions.map((q, i) => [q.id, body.questions[i].key]));
    const raw = new Uint8Array(Buffer.from(body.file.base64, "base64"));
    const bytes = body.file.kind === "pdf" ? raw : await jpegToPdf(raw);
    const result: Record<string, unknown> = { copyId: body.copyId, scanModel: scanImportModel(), analysisModel: pedagogicalAiModel(), analysisEffort: pedagogicalReasoningEffort() };
    const started = Date.now();
    let extraction;
    try {
      extraction = await extractScanStack(bytes, roster.map(({ id, name }) => ({ id, name })), questions);
    } catch (error) {
      result.scan = { ok: false, error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - started };
      return NextResponse.json({ ...result, providerLog });
    }
    const rosterIds = new Set(roster.map((s) => s.id));
    result.scan = {
      ok: true,
      latencyMs: Date.now() - started,
      pageCount: extraction.pageCount,
      warnings: extraction.warnings,
      unassignedPages: extraction.unassignedPages,
      copies: extraction.copies.map((c) => ({
        student: roster.find((s) => s.id === c.studentId)?.key ?? null,
        studentNameRead: c.studentNameRead,
        identificationConfidence: c.identificationConfidence,
        groupingConfidence: c.groupingConfidence,
        transcriptionConfidence: (c as unknown as { transcriptionConfidence?: number }).transcriptionConfidence ?? null,
        score: c.score,
        scoreConfidence: c.scoreConfidence,
        pages: [c.startPage, c.endPage],
        warnings: c.warnings,
        autoImportIssue: scanCopyIssue(c, rosterIds, questions),
        responses: normalizedResponses(c, questions).map((r) => ({ q: keyById.get(r.questionId), text: r.responseText, points: r.awardedPoints, annotation: r.teacherAnnotation })),
      })),
    };
    const target = extraction.copies.find((c) => roster.find((s) => s.id === c.studentId)?.key === body.student) ?? extraction.copies[0];
    if (!target) return NextResponse.json({ ...result, providerLog });
    const responses = normalizedResponses(target, questions);
    const assessmentId = await uuid(`assessment:${body.assessmentKey}`);
    const num = (value: string) => {
      const n = Number(value.replace(",", "."));
      return value.trim() && Number.isFinite(n) ? n : null;
    };
    const aiInput = {
      assessment: { id: assessmentId, contextText: null, instructionsText: null },
      questions: body.questions.map((q, index) => ({
        assessmentId, questionId: questions[index].id, prompt: q.prompt, correctionText: q.correction, rubricText: "",
        maxPoints: q.maxPoints, responseText: responses[index].responseText, awardedPoints: num(responses[index].awardedPoints),
        teacherAnnotation: responses[index].teacherAnnotation || null, assessedNotions: [...q.notions].sort(),
      })),
      curriculum: curriculum.aiCurriculum,
    };
    const analysisStarted = Date.now();
    try {
      const analysis = await requestPedagogicalAnalysisWithUsage(aiInput, { apiKey: process.env.OPENAI_API_KEY!, model: pedagogicalAiModel(), reasoningEffort: pedagogicalReasoningEffort() });
      const cache = new Map<string, Set<string>>();
      const validated = validateModelAnalysis(
        analysis.analysis,
        aiInput.questions.map((q) => ({ assessmentId, questionId: q.questionId, responseText: q.responseText, correctionText: q.correctionText, maxPoints: q.maxPoints, awardedPoints: q.awardedPoints, assessedCodes: q.assessedNotions })),
        new Map(Object.entries(curriculum.mappable)),
        {
          relatedCodes: (assessed) => {
            const key = [...assessed].sort().join("|");
            let set = cache.get(key);
            if (!set) cache.set(key, (set = relatedNotionCodes(curriculum.summaries, assessed)));
            return set;
          },
          catalogueCodes: new Map(Object.entries(curriculum.catalogue).map(([code, codes]) => [code, new Set(codes as string[])])),
        },
      );
      result.analysis = {
        ok: true, latencyMs: analysis.latencyMs, tokens: analysis.usage.totalTokens,
        raw: { status: analysis.analysis.status, insufficientReason: analysis.analysis.insufficientReason,
          errors: analysis.analysis.errors.map((e) => ({ q: keyById.get(e.questionId) ?? e.questionId, nodeCode: e.nodeCode, errorType: e.errorType, excerpt: e.evidenceExcerpt, difficulty: e.difficulty, explanation: e.explanation })) },
        validated: { status: validated.status, insufficientReason: validated.insufficientReason,
          errors: validated.errors.map((e) => ({ q: keyById.get(e.questionId), nodeCode: e.nodeCode, errorType: e.errorType, excerpt: e.evidenceExcerpt })),
          rejected: validated.rejected.map((r) => ({ q: keyById.get(r.questionId) ?? r.questionId, nodeCode: r.nodeCode, reason: r.reason })) },
      };
    } catch (error) {
      result.analysis = { ok: false, error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - analysisStarted };
    }
    return NextResponse.json({ ...result, providerLog });
  } catch (error) {
    return NextResponse.json({ copyId: body.copyId, harnessError: error instanceof Error ? error.message : String(error), providerLog }, { status: 500 });
  } finally {
    globalThis.fetch = realFetch;
  }
}
