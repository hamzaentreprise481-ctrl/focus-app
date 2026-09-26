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
