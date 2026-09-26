import { toAiCurriculum } from "../lib/curriculum/graph";
import { requestPedagogicalAnalysis } from "../lib/pedagogy/openai-client";
import {
  confidenceForEvidence,
  validateModelAnalysis,
} from "../lib/pedagogy/analysis";
import {
  CAMPAIGN_CURRICULUM,
  PEDAGOGY_CAMPAIGN_CASES,
} from "../tests/fixtures/pedagogy-campaign";

async function main() {
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
    questionIds: string[];
    expectedQuestionIds: string[];
    modelCalled: boolean;
    evidenceVerified: boolean;
    explanationPresent: boolean;
    remediationPresent: boolean;
    pass: boolean;
    insufficientReason: string;
    latencyMs: number;
  }> = [];

  for (const campaignCase of PEDAGOGY_CAMPAIGN_CASES) {
    const started = Date.now();
    const modelCalled = campaignCase.input.questions.some(
      (question) => question.responseText.trim().length > 0,
    );
    let raw: unknown;
    try {
      raw = modelCalled
        ? await requestPedagogicalAnalysis(
            {
              ...campaignCase.input,
              // Same compact projection as production (no ids, no URLs).
              curriculum: toAiCurriculum(campaignCase.input.curriculum),
            },
            { apiKey, model },
          )
        : {
            status: "insufficient_evidence",
            insufficientReason: "Aucune réponse exploitable n’est fournie.",
            errors: [],
          };
    } catch (error) {
      // Do not print a provider payload or a student response in CI logs.
      const code =
        error instanceof Error && error.message.startsWith("OPENAI_")
          ? error.message
          : "OPENAI_INVALID_OUTPUT_OR_NETWORK_ERROR";
      console.error(`${campaignCase.id}: ${code}`);
      process.exit(3);
    }
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
    const questionIds = [...new Set(validated.errors.map((error) => error.questionId))].sort();
    const expectedQuestionIds =
      campaignCase.expected.status === "errors_found"
        ? campaignCase.input.questions.map((question) => question.questionId).sort()
        : [];
    const questionOk =
      JSON.stringify(questionIds) === JSON.stringify(expectedQuestionIds);
    const reasonOk =
      validated.status !== "insufficient_evidence" ||
      validated.insufficientReason.trim().length > 0;
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
      questionIds,
      expectedQuestionIds,
      modelCalled,
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
        reasonOk &&
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
}

void main().catch(() => {
  console.error("OPENAI_CAMPAIGN_FAILED");
  process.exitCode = 1;
});
