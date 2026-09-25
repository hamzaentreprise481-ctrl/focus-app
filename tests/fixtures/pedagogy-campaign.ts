import type { CurriculumNodeSummary } from "../../lib/pedagogy/types";

export const CAMPAIGN_CURRICULUM: CurriculumNodeSummary[] = [
  {
    id: "node-fractions",
    nodeType: "notion",
    code: "MATH.NUM.FRACTIONS.OPERATIONS",
    title: "Opérations sur les fractions",
    description: "Effectuer et contrôler des opérations sur des fractions simples.",
    sourceLocator: "BO 2026 Seconde — Automatismes / Nombres et calculs",
    sourceUrl: "https://www.education.gouv.fr/bo/2026/Hebdo14/MENE2602914A",
    prerequisites: ["MATH.PREREQ.CYCLE4.FRACTIONS"],
    competencies: ["MATH.COMP.CALCULER"],
  },
  {
    id: "node-distributivite",
    nodeType: "notion",
    code: "MATH.ALG.DISTRIBUTIVITE",
    title: "Développement par distributivité",
    description: "Distribuer correctement un facteur et réduire une expression.",
    sourceLocator: "BO 2026 Seconde — Automatismes / algèbre",
    sourceUrl: "https://www.education.gouv.fr/bo/2026/Hebdo14/MENE2602914A",
    prerequisites: ["MATH.PREREQ.CYCLE4.DISTRIBUTIVITE"],
    competencies: ["MATH.COMP.CALCULER"],
  },
  {
    id: "node-equation",
    nodeType: "notion",
    code: "MATH.ALG.EQUATION_PREMIER_DEGRE",
    title: "Équation du premier degré",
    description: "Résoudre et interpréter une équation du premier degré.",
    sourceLocator: "BO 2026 Seconde — Algèbre",
    sourceUrl: "https://www.education.gouv.fr/bo/2026/Hebdo14/MENE2602914A",
    prerequisites: [
      "MATH.PREREQ.CYCLE4.EQUATIONS",
      "MATH.ALG.DISTRIBUTIVITE",
    ],
    competencies: ["MATH.COMP.RAISONNER"],
  },
  {
    id: "node-fonction-image",
    nodeType: "notion",
    code: "MATH.FONC.IMAGE_ANTECEDENT",
    title: "Images et antécédents",
    description: "Déterminer et interpréter images et antécédents.",
    sourceLocator: "BO 2026 Seconde — Fonctions",
    sourceUrl: "https://www.education.gouv.fr/bo/2026/Hebdo14/MENE2602914A",
    prerequisites: ["MATH.FONC.NOTION"],
    competencies: ["MATH.COMP.REPRESENTER"],
  },
  {
    id: "node-fonction-notion",
    nodeType: "notion",
    code: "MATH.FONC.NOTION",
    title: "Notion de fonction",
    description: "Comprendre la dépendance d’une variable par rapport à une autre.",
    sourceLocator: "BO 2026 Seconde — Fonctions",
    sourceUrl: "https://www.education.gouv.fr/bo/2026/Hebdo14/MENE2602914A",
    prerequisites: ["MATH.PREREQ.CYCLE4.FONCTIONS"],
    competencies: ["MATH.COMP.MODELISER"],
  },
];

export type CampaignExpectedStatus =
  | "errors_found"
  | "no_error_observed"
  | "insufficient_evidence";

export interface PedagogyCampaignCase {
  id: string;
  label: string;
  input: {
    assessment: {
      id: string;
      title: string;
      contextText: string;
      instructionsText: string;
    };
    questions: Array<{
      assessmentId: string;
      questionId: string;
      prompt: string;
      correctionText: string;
      rubricText: string;
      maxPoints: number | null;
      responseText: string;
      awardedPoints: number | null;
      teacherAnnotation: string | null;
    }>;
    curriculum: CurriculumNodeSummary[];
  };
  expected: {
    status: CampaignExpectedStatus;
    nodeCode?: string;
    errorType?: string;
  };
  syntheticModelOutput: Record<string, unknown>;
}

function baseCase(params: {
  id: string;
  label: string;
  prompt: string;
  correction: string;
  rubric: string;
  response: string;
  expected: PedagogyCampaignCase["expected"];
  syntheticModelOutput: Record<string, unknown>;
}): PedagogyCampaignCase {
  const assessmentId = `assessment-${params.id}`;
  const questionId = `question-${params.id}`;
  return {
    id: params.id,
    label: params.label,
    input: {
      assessment: {
        id: assessmentId,
        title: params.label,
        contextText: "Campagne de validation FOCUS — mathématiques seconde.",
        instructionsText: "Répondre et justifier lorsque la question le demande.",
      },
      questions: [
        {
          assessmentId,
          questionId,
          prompt: params.prompt,
          correctionText: params.correction,
          rubricText: params.rubric,
          maxPoints: 2,
          responseText: params.response,
          awardedPoints: null,
          teacherAnnotation: null,
        },
      ],
      curriculum: CAMPAIGN_CURRICULUM,
    },
    expected: params.expected,
    syntheticModelOutput: params.syntheticModelOutput,
  };
}

export const PEDAGOGY_CAMPAIGN_CASES: PedagogyCampaignCase[] = [
  baseCase({
    id: "correct-distributivity",
    label: "Réponse correcte — distributivité",
    prompt: "Développer 3(x + 2).",
    correction: "3x + 6.",
    rubric: "1 point pour la distributivité, 1 point pour le résultat.",
    response: "3(x + 2) = 3x + 6",
    expected: { status: "no_error_observed" },
    syntheticModelOutput: {
      status: "no_error_observed",
      insufficientReason: "",
      errors: [],
    },
  }),
  baseCase({
    id: "calculation-distributivity",
    label: "Erreur de calcul — distributivité",
    prompt: "Développer 3(x + 2).",
    correction: "3x + 6.",
    rubric: "1 point pour la distributivité, 1 point pour le résultat.",
    response: "3(x + 2) = 3x + 2",
    expected: {
      status: "errors_found",
      nodeCode: "MATH.ALG.DISTRIBUTIVITE",
      errorType: "calcul",
    },
    syntheticModelOutput: {
      status: "errors_found",
      insufficientReason: "",
      errors: [
        {
          assessmentId: "assessment-calculation-distributivity",
          questionId: "question-calculation-distributivity",
          nodeCode: "MATH.ALG.DISTRIBUTIVITE",
          errorType: "calcul",
          difficulty: "Le facteur 3 n’est pas distribué au terme constant.",
          evidenceExcerpt: "3(x + 2) = 3x + 2",
          explanation:
            "La distributivité est appliquée à x mais pas au terme 2.",
          recommendedAction:
            "Faire verbaliser a(b+c)=ab+ac puis reprendre deux développements courts.",
        },
      ],
    },
  }),
  baseCase({
    id: "reasoning-equation",
    label: "Erreur de raisonnement — équation identité",
    prompt: "Résoudre dans R : 3(x - 2) = 3x - 6 et justifier.",
    correction:
      "Après développement, on obtient 3x - 6 = 3x - 6 : l’égalité est vraie pour tout réel x.",
    rubric: "1 point transformation, 1 point ensemble des solutions.",
    response: "3x - 6 = 3x - 6 donc x = 0",
    expected: {
      status: "errors_found",
      nodeCode: "MATH.ALG.EQUATION_PREMIER_DEGRE",
      errorType: "raisonnement",
    },
    syntheticModelOutput: {
      status: "errors_found",
      insufficientReason: "",
      errors: [
        {
          assessmentId: "assessment-reasoning-equation",
          questionId: "question-reasoning-equation",
          nodeCode: "MATH.ALG.EQUATION_PREMIER_DEGRE",
          errorType: "raisonnement",
          difficulty:
            "Une identité vraie pour tout x est interprétée comme une équation à solution unique.",
          evidenceExcerpt: "3x - 6 = 3x - 6 donc x = 0",
          explanation:
            "Les deux membres sont identiques après développement ; aucune valeur unique de x ne doit être isolée.",
          recommendedAction:
            "Comparer une équation à solution unique, une identité et une équation sans solution sur trois exemples.",
        },
      ],
    },
  }),
  baseCase({
    id: "prerequisite-fractions",
    label: "Mauvais prérequis — addition de fractions",
    prompt: "Calculer 1/2 + 1/3 et donner une fraction irréductible.",
    correction: "1/2 + 1/3 = 3/6 + 2/6 = 5/6.",
    rubric: "1 point dénominateur commun, 1 point résultat.",
    response: "1/2 + 1/3 = 2/5",
    expected: {
      status: "errors_found",
      nodeCode: "MATH.NUM.FRACTIONS.OPERATIONS",
      errorType: "prerequis",
    },
    syntheticModelOutput: {
      status: "errors_found",
      insufficientReason: "",
      errors: [
        {
          assessmentId: "assessment-prerequisite-fractions",
          questionId: "question-prerequisite-fractions",
          nodeCode: "MATH.NUM.FRACTIONS.OPERATIONS",
          errorType: "prerequis",
          difficulty:
            "Les numérateurs et dénominateurs sont additionnés terme à terme.",
          evidenceExcerpt: "1/2 + 1/3 = 2/5",
          explanation:
            "L’addition de fractions nécessite un dénominateur commun ; le résultat 2/5 révèle que cette règle n’est pas mobilisée.",
          recommendedAction:
            "Reprendre la construction d’un dénominateur commun sur trois fractions simples avant de revenir au calcul littéral fractionnaire.",
        },
      ],
    },
  }),
  baseCase({
    id: "function-image",
    label: "Erreur sur une image de fonction",
    prompt: "Soit f(x)=2x-3. Calculer f(4).",
    correction: "f(4)=2×4-3=5.",
    rubric: "1 point substitution, 1 point calcul.",
    response: "f(4) = 2 + 4 - 3 = 3",
    expected: {
      status: "errors_found",
      nodeCode: "MATH.FONC.IMAGE_ANTECEDENT",
      errorType: "calcul",
    },
    syntheticModelOutput: {
      status: "errors_found",
      insufficientReason: "",
      errors: [
        {
          assessmentId: "assessment-function-image",
          questionId: "question-function-image",
          nodeCode: "MATH.FONC.IMAGE_ANTECEDENT",
          errorType: "calcul",
          difficulty:
            "La valeur 4 est ajoutée au coefficient 2 au lieu de le multiplier.",
          evidenceExcerpt: "f(4) = 2 + 4 - 3 = 3",
          explanation:
            "Dans 2x-3, remplacer x par 4 donne 2×4-3 et non 2+4-3.",
          recommendedAction:
            "Faire écrire explicitement f(a)=2×a-3 sur plusieurs valeurs avant le calcul mental.",
        },
      ],
    },
  }),
  baseCase({
    id: "partial-response",
    label: "Réponse partielle",
    prompt: "Résoudre 5x + 2 = 17 et détailler les étapes.",
    correction: "5x=15 puis x=3.",
    rubric: "1 point transformation, 1 point solution.",
    response: "5x = 15 donc",
    expected: { status: "insufficient_evidence" },
    syntheticModelOutput: {
      status: "insufficient_evidence",
      insufficientReason:
        "La réponse s’interrompt avant la valeur de x ; elle ne permet pas d’établir une erreur précise.",
      errors: [],
    },
  }),
  baseCase({
    id: "empty-response",
    label: "Réponse vide",
    prompt: "Résoudre 2x - 4 = 10.",
    correction: "2x=14 puis x=7.",
    rubric: "2 points.",
    response: "",
    expected: { status: "insufficient_evidence" },
    syntheticModelOutput: {
      status: "insufficient_evidence",
      insufficientReason: "Aucune réponse exploitable n’est fournie.",
      errors: [],
    },
  }),
  baseCase({
    id: "ambiguous-response",
    label: "Réponse ambiguë / transcription incomplète",
    prompt: "Résoudre 2x + 1 = 7 en justifiant.",
    correction: "2x=6 puis x=3.",
    rubric: "1 point démarche, 1 point solution.",
    response: "2x = 6 donc x = 3 [suite illisible]",
    expected: { status: "insufficient_evidence" },
    syntheticModelOutput: {
      status: "insufficient_evidence",
      insufficientReason:
        "La transcription signale une partie illisible ; il serait risqué d’inférer la démarche complète.",
      errors: [],
    },
  }),
];
