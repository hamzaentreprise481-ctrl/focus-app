# Validation de l’IA pédagogique — état au 26 septembre 2026

Cette note sépare ce qui est prouvé par des tests simulés de ce qui reste à
prouver avec le vrai modèle. Branche : `claude/finish-focus-v1`.

## Mise à jour du 9 octobre 2026 (branche `work/fiabiliser-analyse-ia`)

- **Le vrai modèle n’a toujours produit aucune analyse mesurable.** Depuis la
  Preview Vercel (même clé, `gpt-6-astra`), chaque appel a été refusé :
  HTTP 429 `insufficient_quota` / `credit_balance_exhausted`. Ce n’est pas une
  limite de débit : le crédit OpenAI du compte est épuisé. FOCUS le dit
  désormais tel quel au professeur (« quota épuisé »), ne le réessaie pas, et
  `/api/health` le détecte par une génération minimale (et plus seulement
  `GET /v1/models/{model}`).
- **Nouvelles garanties testées sans le modèle** : provenance de chaque
  réponse (saisie ou lecture d’un scan, lisibilité, vérifiée ou non) ; une
  issue par question (`error`, `no_error_observed`, `incomplete`,
  `no_answer`, `illegible`, `insufficient_evidence`) revérifiée en TypeScript
  et en base ; refus de tout constat sur une réponse illisible ou un passage
  marqué `[illisible]`/`[?…]` ; confiance bornée par la qualité de lecture ;
  réessais bornés des erreurs 429/5xx temporaires dans un même délai.
- **Échecs du fournisseur classés en quatre familles** (`lib/pedagogy/provider-errors.ts`) :
  crédit (quelqu’un doit payer), configuration (clé refusée, modèle
  indisponible), fournisseur (saturation, panne, délai, réseau) et réponse
  inexploitable. Chaque famille a son message pour le professeur (rien
  n’est enregistré, qui peut agir) et une ligne de log JSON
  `focus.ai_failure` sans aucune donnée d’élève.
- **Copies manuscrites** : chemin, fixtures (niveaux A→E, cinq profils, cas
  d’échec) et banc réel prêt mais non exécuté — voir
  [HANDWRITING_EVALUATION.md](./HANDWRITING_EVALUATION.md).

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
- `/api/health` (Preview et local seulement) indique le commit déployé, la
  présence des variables Supabase et OpenAI, la version du schéma de la base
  et un accès au modèle par `GET /v1/models/{model}` puis (depuis le
  9 octobre) une génération minimale qui révèle un crédit épuisé ; un succès
  ne prouve pas qu’une analyse réussit. Le workflow `FOCUS Preview verification` le lit
  pour chaque déploiement Vercel et n’est vert que si ce déploiement exécute
  exactement ce commit et est prêt.

## Benchmark du modèle réel (prêt, non exécuté)

`npm run test:ai-live` exécute 47 copies synthétiques de Seconde
(`tests/fixtures/pedagogy-benchmark.ts`, rédigées pour FOCUS, sans manuel)
à travers exactement le chemin de production : le programme tel que le
modèle le reçoit (`focus_curriculum_graph` du schéma migré + erreurs types
du catalogue), le même prompt et schéma strict, puis les validateurs FOCUS.
Catégories : copies justes, erreurs évidentes, erreurs de calcul subtiles,
de raisonnement, de prérequis, réponses incomplètes ou ambiguës, points
maximum avec formulation inhabituelle, réponse identique au corrigé,
restriction aux notions évaluées, plusieurs erreurs, erreur répétée,
injection de consignes dans la copie, cas où seul « preuves insuffisantes »
est acceptable, cas où « aucune erreur observée » est le verdict le plus
sûr, notion proche mais inexacte, erreur réelle absente du catalogue.

Mesures séparées : exactitude du statut, taux de faux positifs et de faux
négatifs (par copie), précision et rappel des constats, exactitude de la
question, de la notion et du type d’erreur, validité littérale des extraits
bruts du modèle, validité et exactitude du code d’erreur type, rappel et
précision de « preuves insuffisantes », latence (médiane, p90, max) et
jetons. Options : `--effort low|medium|high`, `--model`, `--cases`.
Le rapport (`benchmark-results/…json`) ne contient que des identifiants,
statuts, compteurs, motifs de rejet, latences et jetons — jamais de copie,
de prompt ni de texte du modèle.

Vérifié hors ligne (`tests/pedagogy-benchmark.test.ts`) : les cas sont
cohérents avec le programme réel ; un modèle idéal obtient 100 % à travers
les validateurs ; un modèle qui ne signale jamais rien a un taux de faux
négatifs de 100 % ; les sorties adverses (extrait inventé, mauvaise
question, notion sans rapport ou hors programme, formulation excessive,
points maximum, code d’erreur type d’une autre notion, erreurs listées sous
« aucune erreur ») sont refusées sur tous les cas. Ce banc a révélé une
faiblesse réelle, corrigée : « ne comprend absolument rien » échappait au
filtre des formulations excessives.

**Aucun résultat du modèle réel n’existe encore** : il faut une clé.

## À faire, dans cet ordre

1. Appliquer les migrations sur une branche ou une copie du projet Supabase
   (voir README, « Base de données »), puis sur une Preview liée à ce SHA.
2. Définir `OPENAI_API_KEY` (serveur, Preview) et exécuter
   `npm run test:ai-live` avec le même modèle et le même effort que la
   Preview ; committer le rapport `benchmark-results/…json`. En cas de
   qualité insuffisante, analyser d’abord les catégories et motifs de rejet
   avant de toucher au prompt ; ne comparer `--effort low` et `medium` que si
   nécessaire, sur ce même jeu de cas.
3. Sur la Preview, avec un compte professeur de test et des données fictives :
   parcours complet jusqu’à la décision et au PDF.
4. Faire annoter en aveugle 20 à 50 réponses fictives ou consenties par un
   professeur ; comparer erreurs, notions, faux positifs et « preuves
   insuffisantes ». Ne jamais assouplir les contrôles pour faire passer une
   sortie du modèle.
