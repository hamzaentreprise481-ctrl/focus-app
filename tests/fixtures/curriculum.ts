// Small synthetic curriculum packages for importer tests. Labels are short
// FOCUS-written descriptions; no programme or textbook text.

export const SECONDE_TEST_URL = "https://www.education.gouv.fr/bo/test/seconde";
export const PREMIERE_URL = "https://www.education.gouv.fr/bo/test/premiere-spe-maths";

export interface TestNode {
  code: string;
  type: string;
  title: string;
  sourceLocator: string;
  description?: string | null;
  partOf?: string[];
  prerequisites?: string[];
  competencies?: string[];
  [key: string]: unknown;
}

export interface TestPackage {
  formatVersion: unknown;
  source: Record<string, unknown>;
  nodes: TestNode[];
  edges: Array<{ from: string; to: string; relation: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export function secondePackage(): TestPackage {
  return {
    formatVersion: 1,
    source: {
      subjectCode: "MATH",
      levelCode: "SECONDE_TEST",
      schoolYear: "2026-2027",
      title: "Programme de mathématiques de seconde (test)",
      publisher: "Ministère de l’Éducation nationale",
      officialReference: "BO test — seconde",
      sourceUrl: SECONDE_TEST_URL,
      publishedOn: "2026-04-02",
    },
    nodes: [
      { code: "MATH.T2.COMP.CALCULER", type: "competency", title: "Calculer", sourceLocator: "Préambule" },
      { code: "MATH.T2.COMP.RAISONNER", type: "competency", title: "Raisonner", sourceLocator: "Préambule" },
      { code: "MATH.T2.DOM.ALGEBRE", type: "domain", title: "Algèbre", sourceLocator: "Algèbre" },
      {
        code: "MATH.T2.PREREQ.DISTRIBUTIVITE",
        type: "prerequisite",
        title: "Distributivité (acquis antérieurs)",
        sourceLocator: "Objectifs",
      },
      {
        code: "MATH.T2.ALG.DISTRIBUTIVITE",
        type: "notion",
        title: "Développement par distributivité",
        description: "Distribuer un facteur et réduire.",
        sourceLocator: "Algèbre, p. 2",
        partOf: ["MATH.T2.DOM.ALGEBRE"],
        prerequisites: ["MATH.T2.PREREQ.DISTRIBUTIVITE"],
        competencies: ["MATH.T2.COMP.CALCULER"],
      },
      {
        code: "MATH.T2.ALG.EQUATION",
        type: "notion",
        title: "Équation du premier degré",
        sourceLocator: "Algèbre, p. 3",
        partOf: ["MATH.T2.DOM.ALGEBRE"],
        prerequisites: ["MATH.T2.ALG.DISTRIBUTIVITE"],
        competencies: ["MATH.T2.COMP.RAISONNER"],
      },
      {
        code: "MATH.T2.ALG.FACTORISATION",
        type: "notion",
        title: "Factorisation simple",
        sourceLocator: "Algèbre, p. 3",
        partOf: ["MATH.T2.DOM.ALGEBRE"],
        competencies: ["MATH.T2.COMP.CALCULER"],
      },
    ],
    edges: [
      { from: "MATH.T2.ALG.DISTRIBUTIVITE", to: "MATH.T2.ALG.FACTORISATION", relation: "supports" },
    ],
  };
}

export function premierePackage(): TestPackage {
  return {
    formatVersion: 1,
    source: {
      subjectCode: "MATH",
      levelCode: "PREMIERE_SPE",
      schoolYear: "2026-2027",
      title: "Programme de spécialité mathématiques de première (test)",
      publisher: "Ministère de l’Éducation nationale",
      officialReference: "BO test — première",
      sourceUrl: PREMIERE_URL,
      publishedOn: null,
    },
    nodes: [
      { code: "MATH.P1.COMP.CALCULER", type: "competency", title: "Calculer (première)", sourceLocator: "Préambule" },
      {
        code: "MATH.P1.ALG.SECOND_DEGRE",
        type: "notion",
        title: "Équations du second degré",
        sourceLocator: "Algèbre, p. 4",
        // Cross-level prerequisite declared by the première package.
        prerequisites: ["MATH.T2.ALG.EQUATION"],
        competencies: ["MATH.P1.COMP.CALCULER"],
      },
    ],
    edges: [],
  };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
