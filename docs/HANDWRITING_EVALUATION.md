# Copies manuscrites — lecture, preuves et évaluation (9 octobre 2026)

Ce document décrit comment FOCUS lit une copie photographiée ou scannée, ce
qu’il refuse de conclure, comment c’est testé, et **ce qui n’a pas encore pu
être mesuré avec le vrai modèle**.

## Chemin complet

1. **Import** (`components/evaluations/scan-stack-import.tsx`) : un PDF de la
   pile, ou jusqu’à 12 photos (JPEG/PNG/WebP ; HEIC si le navigateur sait le
   décoder). Dans le navigateur (`lib/scan-photos.ts`) chaque photo est
   redressée selon son EXIF, réduite à 2400 px, contrôlée (luminosité,
   uniformité, netteté par variance du laplacien) puis assemblée en un PDF.
   Une photo beaucoup trop sombre ou trop floue est **refusée avec la raison**
   (seuils mesurés sur les fixtures : flou 2, sombre 26, niveau D lisible
   126–134). Le fichier part dans le bucket privé par URL signée.
2. **Lecture** (`lib/scan-transcription.ts`) : le modèle reçoit les pages, des
   clés courtes (S001, Q01), les énoncés — **jamais le corrigé** — et une
   consigne de transcription stricte : recopier sans corriger,
   `[illisible]` pour ce qui ne se lit pas, `[?x]` pour une lecture
   incertaine, ce qui est barré à part, un statut par question
   (`ecrite`, `partielle`, `illisible`, `vide`, `absente`) et un rapport par
   page (orientation, qualité, problèmes, « pas une copie »). La sortie est un
   schéma JSON strict, revérifié côté serveur.
3. **Lisibilité calculée par FOCUS** (`lib/scan-import-core.ts`) à partir du
   statut ET des marqueurs — pas d’un nombre de confiance du modèle : un texte
   annoncé « écrit » qui contient `[illisible]` est partiel.
4. **Import automatique seulement sans aucune hésitation** : nom sûr, pages
   de bonne qualité, note lue, aucune réponse partielle/illisible/absente,
   aucune transcription identique au corrigé sur une question sans tous les
   points (signe d’une lecture « corrigée »). Sinon la copie va en
   vérification, question par question, avec ce qui est barré.
5. **Provenance en base** (migration `20261009120000`) : `source` (`manual`
   ou `scan`), `legibility`, `transcription_verified`. Un import automatique
   reste une lecture non vérifiée ; le professeur la confirme (bouton dans la
   copie) ou la corrige (la réponse devient la sienne). Changer la provenance
   remplace l’analyse.
6. **Analyse** : le modèle reçoit la provenance de chaque réponse et doit
   rendre une issue par question (`error`, `no_error_observed`, `incomplete`,
   `no_answer`, `illegible`, `insufficient_evidence`). FOCUS décide seul ce
   que la preuve impose (rien d’écrit → pas de réponse ; illisible →
   illisible ; zone absente de l’image → preuves insuffisantes), refuse tout
   constat sur un passage marqué, refuse les contradictions, et ne présente
   jamais une « erreur » sans preuve validée. La base revérifie tout cela.
7. **Confiance** : toujours calculée par la base à partir de l’historique,
   puis bornée par la lecture : `limitée` si la réponse citée est
   partiellement lisible, au plus `modérée` si c’est une lecture automatique
   non vérifiée. Une erreur isolée reste `limitée` ; `forte` exige une
   répétition sur une autre évaluation déjà confirmée par le professeur.

## Fixtures (`tests/fixtures/handwriting`)

Toutes fictives, générées par `generate.py` (polices manuscrites Fontsource
téléchargées à la génération, jamais stockées) : chaque lettre a sa taille,
sa rotation, sa ligne de base, son espacement et sa pression ; fractions
écrites à la main, ratures, gribouillis, annotations rouges du professeur,
papier Seyès, puis « photo » (perspective, lumière inégale, ombre, flou,
bruit, JPEG).

| Ensemble | Contenu |
| --- | --- |
| Série de lisibilité | La même copie (Lucas, misconception (a+b)² = a²+b²) aux niveaux A propre, B moyenne, C mauvaise, D très difficile mais lisible, E avec passages détruits (tache d’encre, café, bavure) |
| Profils | Inès (maîtrise, une erreur de calcul isolée), Hugo (méthode correcte, fractions mal comprises, 2 évaluations), Lucas (misconception persistante sur 3 évaluations dont un contexte géométrique), Chloé (réponses incomplètes, une absence de réponse), Nathan (copie niveau E, réponses illisibles), Léa (niveau C : parenthèses oubliées, « = 0 » ajouté à une expression, erreur de signe dans une méthode juste, fraction raturée puis corrigée) |
| Échecs | photo floue, très sombre, tournée de 90° et 180°, coupée (questions 4 et 5 absentes de l’image : leur texte ne doit jamais apparaître, l’issue attendue est « preuves insuffisantes »), copie vierge, document qui n’est pas une copie, PDF de deux pages inversées, consigne injectée dans une copie |

`manifest.json` donne, par copie et par question, le texte réellement écrit,
les passages détruits (`hidden` — ne doivent jamais apparaître dans une
transcription), ce qui est barré, les points et l’issue attendue.

### Les cinq tests de la mission (A–E)

`PEDAGOGICAL_TESTS` (`tests/helpers/handwriting-eval.ts`) regroupe les copies
par test ; le rapport live donne pour chacun : lecture (CER), invention sous
une tache ou hors de l’image, ratures recopiées, issues correctes, **erreurs
hallucinées** (constat là où il n’y en a pas), erreurs manquées, diagnostics
corrects (notion et type), latence médiane et maximale.

| Test | Copies |
| --- | --- |
| A — copie parfaite | E2-S1-B, E3-S1-B |
| B — erreurs de calcul, concept, raisonnement, notation | E1-S1-A, E1-S2-B, E2-S2-B, E2-S3-B, E1-S6-C |
| C — écriture difficile, ratures, corrections | E1-S3-C, E1-S3-series-C, E1-S3-series-D, E1-S6-C |
| D — méthode pertinente, erreur intermédiaire | E1-S1-A Q4, E1-S6-C Q4, E3-S3-B Q2 |
| E — preuves insuffisantes | E1-S5-E, E1-S3-series-E, FM-cut, FM-blank |

Ce sont des **images d’écriture simulée** (polices manuscrites déformées
lettre par lettre puis « photographiées »), jamais du texte numérique, mais
pas de vraies copies d’élèves : une validation sur de vraies copies
consenties reste nécessaire.

## Ce qui est vérifié sans le vrai modèle

- `tests/transcription-legibility.test.ts`, `tests/scan-transcription.test.ts`,
  `tests/question-outcomes.test.ts`, `tests/scan-photos.test.ts` : règles de
  lecture, schéma, refus, issues par question, quotas, délais, pannes.
- `tests/transcription-provenance-db.test.ts` (schéma réel, RLS) :
  provenance, vérification, contrôles des issues et des constats, confiance
  bornée, progression `limitée → modérée → forte` sur trois évaluations,
  hypothèse écartée non comptée, double import sans effet.
- `tests/e2e/teacher-scan-import.test.ts` (Chromium, build de production,
  pile locale avec Storage) : photo difficile → vérification → import →
  analyse dont les « constats » sur des passages illisibles sont refusés ;
  photo propre → import automatique non vérifié → constat `modérée` →
  vérification → analyse remplacée ; photos floue/sombre refusées, document
  qui n’est pas une copie, crédit épuisé, panne du fournisseur, mauvais
  fichier. **Le lecteur et le modèle y sont scriptés.**
- `tests/handwriting-eval.test.ts` : le banc d’évaluation lui-même (un
  lecteur idéal obtient 0 erreur, un lecteur qui invente sous une tache ou
  garde ce qui est barré est détecté à chaque fois).

## Banc réel — NON EXÉCUTÉ (crédit OpenAI épuisé)

Le 9 octobre 2026, depuis la Preview Vercel de ce projet (même clé, modèle
`gpt-6-astra`), **chaque appel a été refusé : HTTP 429,
`insufficient_quota` / `credit_balance_exhausted`** (09:55 puis 15:17 UTC,
pipeline corrigé ; la clé est valide et le modèle existe : seule la
génération est refusée). Aucune transcription ni
analyse réelle n’existe donc. Après recharge du crédit :

```bash
OPENAI_API_KEY=… npm run test:handwriting-live -- --input pdf
OPENAI_API_KEY=… npm run test:handwriting-live -- --input images --scan-effort medium
```

Le rapport (`benchmark-results/handwriting-*.json`) donne par niveau A→E :
taux d’erreur de caractères sur le texte visible, fuites de passages détruits
(invention), marquage de l’incertitude, fuites de texte barré, exactitude des
issues par question. Critères proposés avant toute utilisation réelle : zéro
fuite de passage détruit sur D et E ; incertitude marquée sur 100 % des
passages détruits ; CER ≤ 5 % (A, B), ≤ 15 % (C) ; issues correctes ≥ 90 %.
Comparer ensuite `--input pdf` et `images`, et l’effort de lecture, avant de
changer de modèle (`FOCUS_SCAN_MODEL`, `FOCUS_SCAN_REASONING_EFFORT`).
