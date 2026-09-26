# Validation de l’IA pédagogique — état au 26 septembre 2026

Cette note sépare ce qui est prouvé par des tests simulés de ce qui reste à
prouver avec le vrai modèle. Branche : `claude/finish-focus-v1`.

## Ce qui est vérifié (sans le vrai modèle)

- **Contrôles de sortie** (`tests/pedagogy.test.ts`) : extrait non littéral ou
  trop court, question inconnue, notion hors programme ou sans lien avec les
  notions de la question, points maximum déjà attribués, réponse identique au
  corrigé, formulation excessive ou non pédagogique (y compris une consigne
  injectée dans la copie), doublons, « aucune erreur » contradictoire, code
  d’erreur type d’une autre notion. Les propositions refusées sont comptées,
  jamais affichées comme constats.
- **Base de données** (`tests/teacher-workflow-db.test.ts`,
  `tests/curriculum-catalogue.test.ts`, schéma réel avec RLS) : écritures IA
  uniquement par les fonctions auditées, confiance calculée par la base à
  partir de l’historique, remplacement des analyses quand la copie, une
  question ou ses notions changent, décisions et historique du professeur,
  même règle de parenté des notions en TypeScript et en SQL.
- **Parcours complet** dans Chromium sur l’environnement local
  (`scripts/local-stack.ts`) : connexion → « À traiter » → sujet et notions →
  copie → analyse → hypothèse → confirmation ou rejet, avec note → rechargement
  → modification de la copie → hypothèse remplacée → PDF. Le modèle y est un
  **double scripté** : cela prouve le câblage et les garde-fous, pas la
  qualité des analyses.
- **Client du modèle** (`tests/pedagogy-openai-client.test.ts`) : schéma JSON
  strict, aucune donnée d’élève dans les erreurs journalisées, délai maximal de
  90 s, erreurs réseau distinguées.

## Ce qui n’est pas vérifié

- **Aucun appel réel au modèle n’a réussi depuis cet environnement** : aucune
  `OPENAI_API_KEY` n’y est disponible et le réseau n’autorise pas
  `api.openai.com`. `npm run test:ai-live` s’arrête donc avec « BLOCKED ».
- Aucune Preview Vercel de cette branche n’a été testée : l’accès au projet
  Vercel est refusé (403) et `*.vercel.app` n’est pas joignable d’ici.
- La route `/api/ai-health` (Preview seulement) contrôle l’accès au modèle par
  `GET /v1/models/{model}` ; un succès ne prouve pas qu’une analyse réussit.

## À faire, dans cet ordre

1. Appliquer les migrations sur une branche ou une copie du projet Supabase
   (voir README, « Base de données »), puis sur une Preview liée à ce SHA.
2. Définir `OPENAI_API_KEY` (serveur, Preview) et exécuter
   `npm run test:ai-live` ; conserver les résultats cas par cas, échecs et
   latences compris.
3. Sur la Preview, avec un compte professeur de test et des données fictives :
   parcours complet jusqu’à la décision et au PDF.
4. Faire annoter en aveugle 20 à 50 réponses fictives ou consenties par un
   professeur ; comparer erreurs, notions, faux positifs et « preuves
   insuffisantes ». Ne jamais assouplir les contrôles pour faire passer une
   sortie du modèle.
