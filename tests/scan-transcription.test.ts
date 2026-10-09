// The reading of scanned/photographed copies with a SCRIPTED provider (no
// language model here): what is sent, what is accepted back, how legibility
// is computed, and how provider failures are reported.

import { test } from "node:test";
import assert from "node:assert/strict";
import { transcribeScan, extractionSchema, SCAN_INSTRUCTIONS } from "../lib/scan-transcription";
import type { ScanQuestion } from "../lib/scan-import-core";

const roster = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Lucas Bernard" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Inès Morel" },
];
const questions: ScanQuestion[] = [
  { id: "11111111-1111-4111-8111-111111111111", position: 1, prompt: "Développer B = (x + 5)².", maxPoints: 2, correctionText: "SECRET-CORRIGE-1" },
  { id: "22222222-2222-4222-8222-222222222222", position: 2, prompt: "Factoriser C = x² − 9.", maxPoints: 2, correctionText: "SECRET-CORRIGE-2" },
];

function reading(patch: Record<string, unknown> = {}, responses?: unknown[]) {
  return {
    pageCount: 1,
    isStudentWork: true,
    pages: [{ page: 1, orientation: 0, quality: "bonne", issues: [] }],
    copies: [
      {
        studentKey: "S001",
        studentNameRead: "Lucas Bernard",
        identificationConfidence: 0.99,
        groupingConfidence: 0.99,
        startPage: 1,
        endPage: 1,
        score: 11,
        scoreConfidence: 0.98,
        responses: responses ?? [
          { questionKey: "Q01", status: "ecrite", responseText: "B = x² + [ illisible ] + 25", crossedOut: "x² + 5²", awardedPoints: "0", teacherAnnotation: "(a+b)² ?" },
          { questionKey: "Q02", status: "illisible", responseText: "", crossedOut: "", awardedPoints: "0", teacherAnnotation: "" },
        ],
        warnings: [],
      },
    ],
    unassignedPages: [],
    warnings: [],
    ...patch,
  };
}

function provider(answers: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ body: Record<string, unknown> }> = [];
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)) });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    const payload =
      next.status && next.status >= 400
        ? next.body
        : { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(next.body) }] }], usage: { total_tokens: 10 } };
    return new Response(JSON.stringify(payload), { status: next.status ?? 200, headers: { "retry-after": "0" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const options = (fetchImpl: typeof fetch) => ({ apiKey: "fictional-key", model: "fictional-model", fetchImpl, baseUrl: "https://example.invalid/v1" });

test("the reader gets the photos page by page, short keys and the questions — never the correction or an id", async () => {
  const { calls, fetchImpl } = provider([{ body: reading() }]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  await transcribeScan({ kind: "images", images: [{ bytes: jpeg, mime: "image/jpeg" }, { bytes: jpeg, mime: "image/jpeg" }] }, roster, questions, options(fetchImpl));
  const sent = JSON.stringify(calls[0].body);
  assert.doesNotMatch(sent, /SECRET-CORRIGE/);
  assert.doesNotMatch(sent, /aaaaaaaa-aaaa|11111111-1111/);
  assert.match(sent, /S001 \| Lucas Bernard/);
  const content = (calls[0].body.input as Array<{ content: Array<{ type: string; text?: string; detail?: string }> }>)[0].content;
  assert.deepEqual(content.filter((part) => part.type !== "input_text" || /^Page \d$/.test(part.text ?? "")).map((part) => part.type + (part.text ? `:${part.text}` : "")), [
    "input_text:Page 1",
    "input_image",
    "input_text:Page 2",
    "input_image",
  ]);
  assert.equal(content.find((part) => part.type === "input_image")?.detail, "high");
  assert.equal((calls[0].body.text as { format: { strict: boolean } }).format.strict, true);
  assert.match(SCAN_INSTRUCTIONS, /\[illisible\]/);
  assert.match(SCAN_INSTRUCTIONS, /Ne devine jamais/);
});

test("legibility is computed from the markers; crossed-out text is kept apart, never in the answer", async () => {
  const { fetchImpl } = provider([{ body: reading() }]);
  const result = await transcribeScan(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), roster, questions, options(fetchImpl));
  const [first, second] = result.copies[0].responses;
  assert.equal(first.responseText, "B = x² + [illisible] + 25", "marker spelling normalised");
  assert.equal(first.legibility, "partielle", "status said 'ecrite' but a marker is there");
  assert.equal(first.crossedOut, "x² + 5²");
  assert.equal(second.legibility, "illisible");
  assert.equal(result.copies[0].studentId, roster[0].id);
  assert.deepEqual(result.pages, [{ page: 1, orientation: 0, quality: "bonne", issues: [] }]);
});

test("an output that breaks the schema is refused, not repaired", async () => {
  const broken = [
    reading({}, [{ questionKey: "Q01", status: "ecrite", responseText: "x", crossedOut: "", awardedPoints: "", teacherAnnotation: "" }]),
    reading({}, [
      { questionKey: "Q01", status: "lisible", responseText: "x", crossedOut: "", awardedPoints: "", teacherAnnotation: "" },
      { questionKey: "Q02", status: "vide", responseText: "", crossedOut: "", awardedPoints: "", teacherAnnotation: "" },
    ]),
    reading({ pages: [{ page: 1, orientation: 45, quality: "bonne", issues: [] }] }),
    { ...reading(), copies: [{ ...reading().copies[0], studentKey: "S999" }] },
    { ...reading(), copies: [{ ...reading().copies[0], score: 27 }] },
  ];
  for (const body of broken) {
    const { fetchImpl } = provider([{ body }]);
    await assert.rejects(transcribeScan(new Uint8Array([1]), roster, questions, options(fetchImpl)), /SCAN_MODEL_INVALID_OUTPUT/);
  }
});

test("a document that is not a student's copy yields no copy, only a warning", async () => {
  const { fetchImpl } = provider([{ body: reading({ isStudentWork: false }) }]);
  const result = await transcribeScan(new Uint8Array([1]), roster, questions, options(fetchImpl));
  assert.equal(result.copies.length, 0);
  assert.match(result.warnings[0], /ne ressemble pas à une copie/);
  assert.ok(result.pages[0].issues.includes("pas_une_copie"));
});

test("an exhausted credit is reported at once; a temporary rate limit is retried", async () => {
  const quota = provider([{ status: 429, body: { error: { type: "insufficient_quota", code: "credit_balance_exhausted" } } }]);
  await assert.rejects(transcribeScan(new Uint8Array([1]), roster, questions, options(quota.fetchImpl)), /SCAN_MODEL_QUOTA/);
  assert.equal(quota.calls.length, 1, "never retried");

  const busy = provider([{ status: 429, body: { error: { type: "requests", code: "rate_limit_exceeded" } } }, { body: reading() }]);
  const result = await transcribeScan(new Uint8Array([1]), roster, questions, options(busy.fetchImpl));
  assert.equal(busy.calls.length, 2);
  assert.equal(result.attempts, 2);

  const down = provider([{ status: 503, body: {} }]);
  await assert.rejects(transcribeScan(new Uint8Array([1]), roster, questions, options(down.fetchImpl)), /SCAN_MODEL_HTTP_503/);
  assert.equal(down.calls.length, 3);
});

test("the schema keeps the reader's statuses and page reports closed", () => {
  const schema = extractionSchema(["S001"], ["Q01", "Q02"]) as unknown as {
    properties: { copies: { items: { properties: { responses: { items: { properties: { status: { enum: string[] } } } } } } }; pages: { items: { properties: { orientation: { enum: number[] } } } } };
  };
  assert.deepEqual(schema.properties.copies.items.properties.responses.items.properties.status.enum, ["ecrite", "partielle", "illisible", "vide", "absente"]);
  assert.deepEqual(schema.properties.pages.items.properties.orientation.enum, [0, 90, 180, 270]);
});

test("a stuck or unreachable reader fails cleanly within the time budget", async () => {
  const stuck = (async (_url: string | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }))))) as typeof fetch;
  const started = Date.now();
  // AbortSignal.timeout's timer does not keep Node's event loop alive on its own.
  const keepAlive = setInterval(() => undefined, 50);
  await assert.rejects(transcribeScan(new Uint8Array([1]), roster, questions, { ...options(stuck), timeoutMs: 300 }), /SCAN_MODEL_TIMEOUT/);
  clearInterval(keepAlive);
  assert.ok(Date.now() - started < 5_000);
  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(transcribeScan(new Uint8Array([1]), roster, questions, options(offline)), /SCAN_MODEL_NETWORK/);
  const empty = provider([{ body: "" }]);
  await assert.rejects(transcribeScan(new Uint8Array([1]), roster, questions, options(empty.fetchImpl)), /SCAN_MODEL_INVALID_OUTPUT|SCAN_MODEL_EMPTY/);
});
