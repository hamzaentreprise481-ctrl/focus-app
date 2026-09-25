export const PEDAGOGICAL_SYSTEM_PROMPT = [
  "Tu es le moteur d'analyse pédagogique de FOCUS pour un professeur de mathématiques en lycée français.",
  "Tu analyses uniquement les preuves fournies : sujet, question, corrigé/barème, réponse exacte de l'élève, annotation éventuelle et graphe officiel fourni.",
  "Interdiction absolue de déduire une difficulté à partir d'une moyenne générale, d'une note globale ou d'un profil supposé de l'élève.",
  "Chaque erreur retournée doit citer mot pour mot un court extrait réellement présent dans responseText.",
  "Chaque nodeCode doit appartenir exactement à la liste curriculum fournie. N'invente jamais un point du programme.",
  "Tu dois distinguer explicitement trois issues : errors_found, no_error_observed, insufficient_evidence.",
  "Utilise insufficient_evidence si la réponse est vide, trop partielle, ambiguë ou si le corrigé/barème ne permet pas d'établir une erreur précise. Dans ce cas, errors doit être vide et insufficientReason doit expliquer brièvement ce qui manque.",
  "Utilise no_error_observed uniquement quand les preuves permettent de considérer la réponse comme correcte ou sans erreur pédagogique identifiable. Dans ce cas, errors doit être vide.",
  "Utilise errors_found uniquement si au moins une erreur précise est démontrée par la réponse de l'élève.",
  "Une action pédagogique doit cibler l'erreur observée et rester proportionnée à la preuve.",
  "Ne produis aucun diagnostic psychologique, médical, comportemental ou social.",
].join("\n");

export const PEDAGOGICAL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["errors_found", "no_error_observed", "insufficient_evidence"],
    },
    insufficientReason: { type: "string" },
    errors: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          assessmentId: { type: "string" },
          questionId: { type: "string" },
          nodeCode: { type: "string" },
          errorType: {
            type: "string",
            enum: [
              "concept",
              "calcul",
              "raisonnement",
              "representation",
              "communication",
              "methode",
              "prerequis",
            ],
          },
          difficulty: { type: "string" },
          evidenceExcerpt: { type: "string" },
          explanation: { type: "string" },
          recommendedAction: { type: "string" },
        },
        required: [
          "assessmentId",
          "questionId",
          "nodeCode",
          "errorType",
          "difficulty",
          "evidenceExcerpt",
          "explanation",
          "recommendedAction",
        ],
      },
    },
  },
  required: ["status", "insufficientReason", "errors"],
} as const;
