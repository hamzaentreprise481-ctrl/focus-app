import test from "node:test";
import assert from "node:assert/strict";
import { requestPedagogicalAnalysis } from "../lib/pedagogy/openai-client";
import { PEDAGOGY_CAMPAIGN_CASES } from "./fixtures/pedagogy-campaign";

test("the live campaign sends the same structured request as the teacher action", async () => {
  const campaignCase = PEDAGOGY_CAMPAIGN_CASES.find(
    (item) => item.id === "calculation-distributivity",
  );
  assert.ok(campaignCase);
  let request: { url: string; init: RequestInit } | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    request = { url: String(url), init: init ?? {} };
    return Response.json({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify(campaignCase.syntheticModelOutput),
            },
          ],
        },
      ],
    });
  };
  const result = await requestPedagogicalAnalysis(campaignCase.input, {
    apiKey: "fictional-test-key",
    model: "fictional-model",
    fetchImpl,
  });

  assert.deepEqual(result, campaignCase.syntheticModelOutput);
  assert.equal(request?.url, "https://api.openai.com/v1/responses");
  assert.equal(request?.init.method, "POST");
  const body = JSON.parse(String(request?.init.body));
  assert.equal(body.model, "fictional-model");
  assert.equal(body.text.format.type, "json_schema");
  assert.deepEqual(JSON.parse(body.input[1].content[0].text), campaignCase.input);
});

test("provider failures never expose the response body or the student's answer", async () => {
  const privateAnswer = "Student private answer: 1/2 + 1/3 = 2/5";
  const fetchImpl: typeof fetch = async () =>
    new Response(privateAnswer, { status: 403 });
  await assert.rejects(
    requestPedagogicalAnalysis(
      { responseText: privateAnswer },
      { apiKey: "fictional-test-key", model: "fictional-model", fetchImpl },
    ),
    (error: Error) => {
      assert.equal(error.message, "OPENAI_REQUEST_FAILED:403");
      assert.ok(!error.message.includes(privateAnswer));
      return true;
    },
  );
});

test("malformed model text cannot leak a student answer through a parser error", async () => {
  const privateAnswer = "Student private answer: 1/2 + 1/3 = 2/5";
  const fetchImpl: typeof fetch = async () =>
    Response.json({
      output: [{ content: [{ type: "output_text", text: privateAnswer }] }],
    });
  await assert.rejects(
    requestPedagogicalAnalysis(
      { responseText: privateAnswer },
      { apiKey: "fictional-test-key", model: "fictional-model", fetchImpl },
    ),
    (error: Error) => {
      assert.equal(error.message, "OPENAI_INVALID_OUTPUT");
      assert.ok(!error.message.includes(privateAnswer));
      return true;
    },
  );
});

test("malformed provider JSON is also reported without its body", async () => {
  const privateAnswer = "Student private answer: 1/2 + 1/3 = 2/5";
  const fetchImpl: typeof fetch = async () =>
    new Response(privateAnswer, { status: 200 });
  await assert.rejects(
    requestPedagogicalAnalysis(
      { responseText: privateAnswer },
      { apiKey: "fictional-test-key", model: "fictional-model", fetchImpl },
    ),
    (error: Error) => {
      assert.equal(error.message, "OPENAI_INVALID_OUTPUT");
      assert.ok(!error.message.includes(privateAnswer));
      return true;
    },
  );
});

test("the API base defaults to the provider and only accepts HTTPS or local loopback", async () => {
  const { openAiBaseUrl } = await import("../lib/pedagogy/openai-client");
  const vercel = process.env.VERCEL;
  try {
    delete process.env.VERCEL;
    assert.equal(openAiBaseUrl(undefined), "https://api.openai.com/v1");
    assert.equal(openAiBaseUrl("https://gateway.example/v1/"), "https://gateway.example/v1");
    assert.equal(openAiBaseUrl("http://127.0.0.1:54329/v1"), "http://127.0.0.1:54329/v1");
    assert.equal(openAiBaseUrl("http://evil.example/v1"), "https://api.openai.com/v1");
    assert.equal(openAiBaseUrl("not a url"), "https://api.openai.com/v1");
    process.env.VERCEL = "1";
    assert.equal(openAiBaseUrl("http://127.0.0.1:54329/v1"), "https://api.openai.com/v1");
  } finally {
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
  }
});

test("a provider that does not answer in time fails with a timeout, not a hang", async () => {
  const fetchImpl: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    });
  const started = Date.now();
  // The timeout's timer does not keep the test process alive by itself.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await assert.rejects(
      requestPedagogicalAnalysis({}, { apiKey: "fictional-test-key", model: "fictional-model", fetchImpl, timeoutMs: 50 }),
      /OPENAI_TIMEOUT/,
    );
  } finally {
    clearTimeout(keepAlive);
  }
  assert.ok(Date.now() - started < 2000);
  const offline: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    requestPedagogicalAnalysis({}, { apiKey: "fictional-test-key", model: "fictional-model", fetchImpl: offline }),
    /OPENAI_NETWORK_ERROR/,
  );
});

test("the hourly analysis limit is a positive integer, 150 by default", async () => {
  const { pedagogicalAiHourlyLimit } = await import("../lib/pedagogy/openai-client");
  assert.equal(pedagogicalAiHourlyLimit(undefined), 150);
  assert.equal(pedagogicalAiHourlyLimit("40"), 40);
  for (const invalid of ["0", "-3", "2.5", "many"]) assert.equal(pedagogicalAiHourlyLimit(invalid), 150);
});
