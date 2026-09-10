# FOCUS — Prototype professeur (V0)

Plateforme scolaire assistée par IA : ce prototype montre la partie **professeur**
de FOCUS, avec des données 100 % fictives (aucune donnée réelle d'élève).

## Lancer le projet

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:3000

## Stack

Next.js (App Router, composants client) · TypeScript · Tailwind CSS v4 · Radix UI · Recharts

Aucune base de données, aucune IA réelle. Les données de départ sont mockées dans
`lib/data/`. Les évaluations créées depuis l'interface sont conservées dans le
`localStorage` du navigateur (voir `lib/demo-data-context.tsx`) — aucun serveur.

## Fichiers principaux

- `lib/data/students.ts`, `lib/data/evaluations.ts`, `lib/data/skills.ts`,
  `lib/data/grades.ts` — les données mockées de départ (31 élèves, 5 évaluations,
  8 compétences). **Le score /20 et le niveau de maîtrise par compétence sont
  saisis séparément** : aucune compétence n'est jamais déduite de la note globale.
- `lib/analysis.ts` — toute la logique d'analyse (classification des profils,
  maîtrise des compétences, niveau de preuve, agrégats classe/évaluation). Toutes
  les fonctions acceptent un `EvaluationDataset` explicite (données mockées +
  évaluations ajoutées en démo). C'est le cœur du prototype : modifier les seuils
  ou les règles se fait uniquement ici.
- `lib/demo-data-context.tsx` / `lib/demo-store.ts` — le hook `useDemoData()` et
  la persistance localStorage des évaluations ajoutées pendant la démo.
- `app/page.tsx` — Dashboard professeur (Page 1).
- `app/classes/`, `app/eleves/` — Liste de classe et fiche élève (Pages 2 et 3).
- `app/evaluations/` — Liste, détail et création d'évaluation (Pages 4 et 5),
  avec validation des notes (0–20, décimales, gestion des absences).
- `components/ui/` — primitives d'interface (bouton, carte, badge, etc.).
- `components/students/`, `components/dashboard/`, `components/evaluations/` —
  composants métier spécifiques à chaque page.

## Ce que FOCUS ne fait jamais (garde-fous du modèle)

- Ne déduit jamais le niveau de maîtrise d'une compétence à partir de la note
  globale : si rien n'a été saisi, l'interface affiche "Données insuffisantes".
- N'utilise pas de seuil universel type "note < 10" : un élève en difficulté sur
  une évaluation est identifié par rapport à **sa propre moyenne habituelle**
  et/ou à ses compétences fragiles ce jour-là.
- N'affirme jamais une conclusion catégorique : le langage reste au conditionnel
  ("suggèrent", "semble", "à confirmer"), avec un niveau de preuve explicite
  (limitée / modérée / solide) selon le nombre d'observations disponibles.

## Limites connues de cette V0

- Une seule classe (Seconde 3), une seule matière (Mathématiques).
- Persistance en `localStorage` uniquement (par navigateur/appareil) : pas de
  synchronisation entre appareils, pas de backend.
- Le bouton "Créer un accompagnement" ouvre une modal de simulation.
- Optimisé desktop / laptop / tablette (iPad et similaires) ; le très petit
  écran de smartphone n'est pas encore la priorité de cette itération.
