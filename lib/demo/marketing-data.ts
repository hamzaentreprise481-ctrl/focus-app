/** Public-only immutable fixture. No imports, application IDs, queries or personal data. */
export const marketingDemo = Object.freeze({
  className: "Seconde A",
  subject: "Mathématiques",
  teacher: "Camille",
  evaluations: Object.freeze([
    Object.freeze({
      name: "Fonctions affines",
      date: "12 novembre",
      skills: 2,
    }),
    Object.freeze({ name: "Calcul littéral", date: "5 novembre", skills: 3 }),
  ]),
  observation: Object.freeze({
    name: "Élève A",
    skill: "Résoudre une équation",
    observations: 4,
    context:
      "Une difficulté semble persister sur cette notion. Un échange pourrait aider à préciser le besoin.",
    action: "Reprendre un exercice ensemble",
    reliability: "Signal fiable",
  }),
});
