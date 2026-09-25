import { PEDAGOGICAL_SYSTEM_PROMPT, PEDAGOGICAL_OUTPUT_SCHEMA } from "../lib/pedagogy/prompt";
import {
  confidenceForEvidence,
  validateModelAnalysis,
} from "../lib/pedagogy/analysis";
import {
  CAMPAIGN_CURRICULUM,
  PEDAGOGY_CAMPAIGN_CASES,
} from "../tests/fixtures/pedagogy-campaign";

function outputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output?: unknown[] };
  if (!Array.isArray(response.output)) return "";
  const chunks: string[] = [];
  for (const item of response.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "output_text" &&
        typeof (part as { text?: unknown }).text === "string"
      )
        chunks.push((part as { text: string }).text);
    }
  }
  return chunks.join("\n");
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("BLOCKED: OPENAI_API_KEY is not available in this environment.");
  process.exit(2);
}

const model = process.env.FOCUS_AI_MODEL || "gpt-5.6-terra";
const nodesByCode = new Map(
  CAMPAIGN_CURRICULUM.map((node) => [node.code, node.id]),
);

const results: Array<{
  id: string;
  label: string;
  expectedStatus: string;
  actualStatus: string;
  expectedNode?: string;
  actualNode?: string;
  expectedErrorType?: string;
  actualErrorType?: string;
  expectedCompetency?: string;
  actualCompetencies: string[];
  expectedPrerequisite?: string;
  actualPrerequisites: string[];
  expectedConfidence?: string;
  actualConfidence?: string;
  questionId?: string;
  evidenceVerified: boolean;
  explanationPresent: boolean;
  remediationPresent: boolean;
  pass: boolean;
  insufficientReason: string;
  latencyMs: number;
}> = [];

for (const campaignCase of PEDAGOGY_CAMPAIGN_CASES) {
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: PEDAGOGICAL_SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(campaignCase.input),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "focus_pedagogical_analysis",
          strict: true,
          schema: PEDAGOGICAL_OUTPUT_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 1200);
    console.error(
      JSON.stringify({
        id: campaignCase.id,
        apiStatus: response.status,
        body,
      }),
    );
    process.exit(3);
  }

  const payload = (await response.json()) as unknown;
  const text = outputText(payload);
  if (!text) {
    console.error(`EMPTY_OUTPUT: ${campaignCase.id}`);
    process.exit(4);
  }

  const raw = JSON.parse(text) as unknown;
  const validated = validateModelAnalysis(
    raw,
    campaignCase.input.questions.map((question) => ({
      assessmentId: question.assessmentId,
      questionId: question.questionId,
      responseText: question.responseText,
    })),
    nodesByCode,
  );

  const firstError = validated.errors[0];
  const statusOk = validated.status === campaignCase.expected.status;
  const nodeOk =
    !campaignCase.expected.nodeCode ||
    firstError?.nodeCode === campaignCase.expected.nodeCode;
  const typeOk =
    !campaignCase.expected.errorType ||
    firstError?.errorType === campaignCase.expected.errorType;
  const evidenceOk =
    validated.status !== "errors_found" ||
    validated.errors.every((error) => {
      const question = campaignCase.input.questions.find(
        (item) => item.questionId === error.questionId,
      );
      return Boolean(question?.responseText.includes(error.evidenceExcerpt));
    });
  const node = firstError
    ? CAMPAIGN_CURRICULUM.find((item) => item.code === firstError.nodeCode)
    : undefined;
  const competencyOk =
    !campaignCase.expected.competencyCode ||
    node?.competencies.includes(campaignCase.expected.competencyCode) === true;
  const prerequisiteOk =
    !campaignCase.expected.prerequisiteCode ||
    node?.prerequisites.includes(campaignCase.expected.prerequisiteCode) === true;
  const currentOccurrences = firstError
    ? validated.errors.filter((error) => error.nodeCode === firstError.nodeCode)
        .length
    : 0;
  const actualConfidence = firstError
    ? confidenceForEvidence({
        currentOccurrences,
        priorAssessmentCount: 0,
        teacherVerifiedBefore: false,
      })
    : undefined;
  const confidenceOk =
    !campaignCase.expected.confidence ||
    actualConfidence === campaignCase.expected.confidence;
  const questionOk =
    !firstError ||
    campaignCase.input.questions.some(
      (question) => question.questionId === firstError.questionId,
    );
  const explanationPresent =
    !firstError || firstError.explanation.trim().length > 0;
  const remediationPresent =
    !firstError || firstError.recommendedAction.trim().length > 0;

  results.push({
    id: campaignCase.id,
    label: campaignCase.label,
    expectedStatus: campaignCase.expected.status,
    actualStatus: validated.status,
    expectedNode: campaignCase.expected.nodeCode,
    actualNode: firstError?.nodeCode,
    expectedErrorType: campaignCase.expected.errorType,
    actualErrorType: firstError?.errorType,
    expectedCompetency: campaignCase.expected.competencyCode,
    actualCompetencies: node?.competencies ?? [],
    expectedPrerequisite: campaignCase.expected.prerequisiteCode,
    actualPrerequisites: node?.prerequisites ?? [],
    expectedConfidence: campaignCase.expected.confidence,
    actualConfidence,
    questionId: firstError?.questionId,
    evidenceVerified: evidenceOk,
    explanationPresent,
    remediationPresent,
    pass:
      statusOk &&
      nodeOk &&
      typeOk &&
      evidenceOk &&
      competencyOk &&
      prerequisiteOk &&
      confidenceOk &&
      questionOk &&
      explanationPresent &&
      remediationPresent,
    insufficientReason: validated.insufficientReason,
    latencyMs: Date.now() - started,
  });
}

const passed = results.filter((result) => result.pass).length;
const summary = {
  model,
  passed,
  total: results.length,
  passRate: results.length ? passed / results.length : 0,
  results,
};

console.log(JSON.stringify(summary, null, 2));
if (passed !== results.length) process.exit(1);
