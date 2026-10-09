// The FOCUS demonstration school for Student and Direction: entirely
// fictitious, in its own school so that no real class, teacher or student is
// touched, and every address on the reserved .invalid domain (RFC 2606) so it
// can never reach a real mailbox. Pure: the same date gives the same plan.

export const DEMO_SCHOOL_NAME = "Établissement de démonstration FOCUS (fictif)";
export const DEMO_EMAIL_DOMAIN = "demo.focus.invalid";

export type DemoPersonKey = "studentA" | "studentB" | "teacher" | "director";
export interface DemoPerson {
  key: DemoPersonKey;
  email: string;
  firstName: string;
  lastName: string;
  role: "student" | "teacher" | "admin";
  /** Only these accounts get a password that is printed once. */
  login: boolean;
}

export interface DemoAnswer {
  text: string;
  points: number;
  annotation: string | null;
}
export interface DemoResult {
  score: number;
  comment: string;
  levels: Array<{ competency: number; level: "mastered" | "developing" | "fragile" | "not_mastered" }>;
  answers: DemoAnswer[];
}
export interface DemoAssessment {
  title: string;
  date: string;
  competencies: number[];
  questions: Array<{ prompt: string; correction: string; maxPoints: number }>;
  results: Record<"studentA" | "studentB", DemoResult>;
}

export interface DemoPlan {
  school: string;
  year: { name: string; startsAt: string; endsAt: string };
  className: string;
  classLevel: string;
  subject: { name: string; code: string };
  people: DemoPerson[];
  competencies: string[];
  assessments: DemoAssessment[];
  lessons: Array<{ date: string; summary: string; competencies: number[] }>;
  /** How many notions of the official programme the questions are tagged with. */
  notionsPerAssessment: number;
}

function addDays(date: string, days: number) {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** School year containing `today` (September → early July). */
export function schoolYear(today: string) {
  const [year, month] = today.split("-").map(Number);
  const start = month >= 8 ? year : year - 1;
  return { name: `${start}-${start + 1}`, startsAt: `${start}-09-01`, endsAt: `${start + 1}-07-04` };
}

export function demoPlan(today: string): DemoPlan {
  const year = schoolYear(today);
  // Assessment and lesson dates: spread over the weeks already elapsed.
  const date = (days: number) => {
    const value = addDays(year.startsAt, days);
    return value <= today ? value : today;
  };
  const person = (key: DemoPersonKey, local: string, firstName: string, lastName: string, role: DemoPerson["role"], login: boolean): DemoPerson => ({
    key,
    email: `${local}@${DEMO_EMAIL_DOMAIN}`,
    firstName,
    lastName,
    role,
    login,
  });
  return {
    school: DEMO_SCHOOL_NAME,
    year,
    className: "Seconde Démo (fictive)",
    classLevel: "Seconde",
    subject: { name: "Mathématiques", code: "MATH" },
    people: [
      person("studentA", "eleve.demo", "Camille", "Démo (élève fictive)", "student", true),
      person("studentB", "eleve.b.demo", "Sacha", "Démo (élève fictif)", "student", false),
      person("teacher", "professeur.demo", "Professeur", "Démo (fictif)", "teacher", false),
      person("director", "direction.demo", "Direction", "Démo (fictive)", "admin", true),
    ],
    competencies: ["Calcul littéral", "Équations du premier degré", "Fonctions affines", "Puissances"],
    assessments: [
      {
        title: "Développer et factoriser (démo)",
        date: date(17),
        competencies: [0],
        questions: [
          { prompt: "Développer 3(x + 4).", correction: "3x + 12", maxPoints: 2 },
          { prompt: "Développer (x + 2)(x + 3).", correction: "x² + 5x + 6", maxPoints: 3 },
        ],
        results: {
          studentA: {
            score: 11,
            comment: "Bonne maîtrise de la simple distributivité ; la double distributivité est à revoir.",
            levels: [{ competency: 0, level: "fragile" }],
            answers: [
              { text: "3x + 12", points: 2, annotation: null },
              { text: "x² + 6", points: 1, annotation: "Il manque les termes 2x et 3x." },
            ],
          },
          studentB: {
            score: 16,
            comment: "Travail soigné (commentaire fictif réservé à l’élève B).",
            levels: [{ competency: 0, level: "mastered" }],
            answers: [
              { text: "3x + 12", points: 2, annotation: null },
              { text: "x² + 5x + 6", points: 3, annotation: null },
            ],
          },
        },
      },
      {
        title: "Équations du premier degré (démo)",
        date: date(31),
        competencies: [1],
        questions: [
          { prompt: "Résoudre 3x + 5 = 20.", correction: "x = 5", maxPoints: 2 },
          { prompt: "Résoudre 2x − 7 = x + 1.", correction: "x = 8", maxPoints: 2 },
        ],
        results: {
          studentA: {
            score: 14,
            comment: "Méthode correcte ; attention à la vérification finale.",
            levels: [{ competency: 1, level: "developing" }],
            answers: [
              { text: "3x = 15 donc x = 5", points: 2, annotation: null },
              { text: "x = 6", points: 0.5, annotation: "Le −7 doit passer de l’autre côté avec le signe +." },
            ],
          },
          studentB: {
            score: 12,
            comment: "Commentaire fictif réservé à l’élève B.",
            levels: [{ competency: 1, level: "developing" }],
            answers: [{ text: "x = 5", points: 2, annotation: null }],
          },
        },
      },
      {
        title: "Puissances (démo)",
        date: date(38),
        competencies: [3],
        questions: [{ prompt: "Simplifier 2³ × 2⁴.", correction: "2⁷", maxPoints: 2 }],
        results: {
          studentA: {
            score: 9,
            comment: "Revoir les règles de calcul sur les puissances.",
            levels: [{ competency: 3, level: "not_mastered" }],
            answers: [{ text: "2¹²", points: 0, annotation: "On additionne les exposants : 3 + 4." }],
          },
          studentB: {
            score: 18,
            comment: "Commentaire fictif réservé à l’élève B.",
            levels: [{ competency: 3, level: "mastered" }],
            answers: [{ text: "2⁷", points: 2, annotation: null }],
          },
        },
      },
    ],
    lessons: [
      { date: date(3), summary: "Séance de démonstration : distributivité.", competencies: [0] },
      { date: date(10), summary: "Séance de démonstration : identités et factorisation.", competencies: [0] },
      { date: date(24), summary: "Séance de démonstration : équations.", competencies: [1] },
    ],
    notionsPerAssessment: 1,
  };
}
