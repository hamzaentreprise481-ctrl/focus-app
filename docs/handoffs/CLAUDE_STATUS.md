# CLAUDE_STATUS — FOCUS Teacher V1 (technique)

Fichier tenu par Claude (CTO / lead engineer technique). Ne pas modifier
`docs/handoffs/WORK_STATUS.md` (GPT Work). Dernière mise à jour : octobre 2026,
mission « Student / Direction » ci-dessous ; la section suivante (Teacher V1)
date du 7 octobre (branche `ccr-38fbcf41-7sndhr`, PR #10).

## Mission Student / Direction (branche `work/student-director-portals`)

| | |
| --- | --- |
| Base | `work/student-v0` (`3b5f3bf`, PR #16), qui contient toute la ligne Teacher (`work/fiabiliser-analyse-ia`). |
| PR #17 (`work/portals-v0`) | Travail parallèle (portail, Director sur `admin`, tuteur IA, écran « Séances »). Lu et audité, **non modifié**. Repris : la logique de connexion/garde Direction (citée dans le commit). Non repris : invitations d’élèves via `SUPABASE_SECRET_KEY` (clé secrète côté serveur, hors mission), programme mesuré sur les 8 compétences de l’établissement, modèle `gpt-6-luna` jamais validé ici, écran « Séances » — il ne peut pas fonctionner : `authenticated` n’a que SELECT sur `lessons`/`lesson_competencies` (fermé par `20261002120000`, vérifié sur le live). |
| Base live | Lecture seule uniquement : tête `20261004090000`, 1 établissement, 1 classe, 31 élèves, 3 professeurs, 1 admin, 5 évaluations, 0 résultat, 0 séance. Aucune écriture, aucune migration appliquée. |

Ajouts : portail public (3 espaces, présentation Teacher déplacée vers
`/enseignants`) ; connexion et garde Direction sur le rôle `admin` (aucune
migration) ; Student complété (niveaux de compétence par évaluation, garde
sur chaque page, UUID vérifié) ; **Assistant FOCUS** (`/student/assistant`) ;
**FOCUS Direction** en lecture seule (7 pages, calculs déterministes
`lib/director/metrics.ts`) ; script d’administration du compte élève/direction
de démonstration (non exécuté : seul le live existe, et il faut la clé
`service_role`) ; proposition `supabase/proposals/20261010090000_teacher_lesson_declarations.sql`
(fonction auditée de déclaration de séances, non appliquée).

Preuves (local) : tests RLS Student/Direction sur PGlite **sur toutes les
migrations ET sur la tête live** (`tests/portals-rls-db.test.ts`), seed de
démonstration rejoué en `service_role` puis relu sous RLS
(`tests/demo-portals-seed.test.ts`), proposition de séances testée sur les deux
têtes, E2E Chromium des trois espaces (`tests/e2e/portals.test.ts`, modèle
**scripté**), gardes statiques (aucune écriture Student/Direction).

Non prouvé : **Assistant FOCUS NON PROUVÉ SUR MODÈLE RÉEL** (aucune clé
OpenAI dans l’environnement) ; Preview non vérifiable (401, secret de
contournement absent) ; aucun compte élève/direction réel ou de démonstration
sur le live.

## Branche canonique

| | |
| --- | --- |
| Base `main` | `6a88301` — V0 (données fictives, `localStorage`, aucun Supabase). Rien n’y a été fusionné. |
| **Branche canonique** | **`claude/finish-focus-v1` (PR #7 → `main`)**, tête `7109600` : le propriétaire y a fusionné PR #8 le 7 octobre (`4a48c19`), qui contenait la ligne `work/fix-professor-login → claude/zealous-bell-rmg2r0` (`30af47b`), le travail technique de Claude et l’UI de GPT Work (PR #9). |
| Base canonique, 7 octobre après-midi | tête `a96e60f` : une autre session y a poussé deux commits (`611293b` inscription lue par classe, rechargements de copie périmés ignorés ; `a96e60f` migration `20261007090000_active_teacher_membership` — une affectation ne donne accès qu’avec une adhésion active). Fusionnés dans la suite (`6860da8`), sans conflit ; ce travail n’a pas été modifié. |
| Suite en cours | `ccr-38fbcf41-7sndhr` → `claude/finish-focus-v1` (PR #10, brouillon) : filtre de la raison « preuves insuffisantes », ce statut, et les deux retours Codex sur #8 (ci-dessous). |
| Branches obsolètes (toutes contenues dans la branche canonique) | `codex/connect-supabase-v1`, `codex/effectuer-un-audit-visuel-de-focus`, `codex/focus-v1-supabase-20260925`, `codex/focus-live-supabase-20260925`, `codex/pedagogical-ai-math-v1`, `codex/connect-login-test-professor` (PR #4), `claude/curriculum-importer` (PR #6), `work/fix-professor-login`, `claude/zealous-bell-rmg2r0`. |

Ordre de fusion proposé (décision du propriétaire) : la PR de suite dans
`claude/finish-focus-v1`, puis #7 dans `main` une fois staging, migrations et
modèle réel vérifiés sur une Preview.

## Ce que cette session a changé (côté technique)

1. **Une seule ligne V1** : fusion de `claude/zealous-bell-rmg2r0` (portée de
   l’espace par (classe, matière), diagnostic de connexion, suppression
   d’évaluation, preuves et fiabilité dans `lib/analysis.ts` sans changement
   de seuil, aperçu de classe).
2. **Provenance des analyses IA** — migration
   `20261004090000_engine_signed_analyses` :
   - `focus_persist_pedagogical_analysis` et `focus_persist_no_evidence` ne sont
     plus appelables par `authenticated` ;
   - seule entrée : `focus_record_engine_analysis(p_envelope text,
     p_signature text)`, enveloppe signée HMAC-SHA256 par le serveur
     (`FOCUS_ANALYSIS_SIGNING_KEY` ↔ `focus_private.engine_keys`), liée au
     professeur connecté, valable 10 min ;
   - version des preuves (`focus_analysis_evidence_versions`) lue **avant** la
     copie et signée ; refus (40001) si copie, sujet, corrigé, barème, notions
     ou consignes ont changé pendant l’analyse ; verrou par évaluation partagé
     avec la supersession ;
   - une évaluation dont des copies ont été analysées ne se supprime plus par
     l’API (trigger).
3. **Durée des fonctions** : `vercel.json` (`fluid: true`), `maxDuration = 120`
   sur `/app/evaluations/[id]` et `/app/eleves/[id]` (délai modèle 90 s).
4. Raison « preuves insuffisantes » rédigée par le modèle soumise aux mêmes
   filtres de formulation que les constats (`lib/pedagogy/analysis.ts`) : une
   copie ne peut plus faire écrire « l’élève est dyslexique » à l’écran.
5. Tests, sonde RLS automatisée, retours arrière testés, documentation.
6. **Retour Codex 1 sur #8 — professeur de plusieurs matières dans une
   classe** (`0d82d20`) : sans compétence, le serveur ne pouvait pas savoir à
   quelle matière rattacher une évaluation ; une évaluation sans note ni
   compétence était impossible à créer (et à modifier). L’éditeur envoie
   désormais la matière ; le serveur ne l’accepte que si elle fait partie des
   affectations du professeur dans la classe ; la base refuse toujours un
   changement de matière d’une évaluation existante.
7. **Retour Codex 2 sur #8 — titre de l’évaluation** (`9229a4b`) : le modèle
   recevait le titre, que la version des preuves ne couvre pas (et dont la
   modification ne remplace pas l’analyse). Le titre n’est plus envoyé : ce
   n’est pas une preuve, et l’inclure dans l’empreinte figerait toutes les
   décisions du professeur pour un simple renommage. Le programme de la classe
   (`curriculum`) n’est pas non plus dans l’empreinte : il ne change que par
   import `service_role`, et la base revérifie à l’enregistrement que la notion
   est active et liée à la question.
8. **Test E2E intermittent** (`1513e12`) : après un rechargement pendant
   l’analyse de classe, la copie en cours peut déjà être enregistrée ; il reste
   alors une copie et le bouton dit « Analyser la copie non analysée », que
   l’expression du test (« les 1 copie ») ne reconnaissait jamais. Reproduit à
   coup sûr en attendant l’enregistrement avant le rechargement ; corrigé dans
   le test (aucun défaut produit).

## Migrations ajoutées (non appliquées sur le projet live)

| Version | Retour arrière |
| --- | --- |
| `20261002120000_access_integrity_hardening` | `supabase/rollback/20261002120000_access_integrity_hardening.down.sql` |
| `20261004090000_engine_signed_analyses` | `supabase/rollback/20261004090000_engine_signed_analyses.down.sql` |
| `20261007090000_active_teacher_membership` (autre session, sur la base canonique) | `supabase/rollback/20261007090000_active_teacher_membership.down.sql` |

Live (lecture seule, 4 octobre) : 24 migrations, tête `20260927100000`.
Avant de déployer ce code : appliquer les trois migrations (staging d’abord),
installer la clé moteur en base **et** dans Vercel (README, « Clé du moteur
d’analyse »).

## Contrats modifiés (à connaître pour l’UI)

- `generatePedagogicalAnalysis` (server action) : nouveaux messages d’échec
  possibles — copie modifiée pendant l’analyse ; clé de signature absente ou
  différente de la base (code `ai_not_configured`, arrête l’analyse de classe) ;
  enveloppe expirée. Formes inchangées (`{ ok: false, error, code? }`).
- `pedagogicalAiConfigured()` exige maintenant `OPENAI_API_KEY` **et**
  `FOCUS_ANALYSIS_SIGNING_KEY` : sans la seconde, l’UI n’offre plus l’analyse.
- `/api/health` : `ai.signingKeyConfigured` (booléen) ; `ready` en dépend.
- `deleteEvaluationAction` : le refus en base (évaluation analysée) donne le
  même message que la vérification préalable.
- `saveEvaluationAction` : `evaluation.subjectId` facultatif ; refus « Cette
  matière ne vous est pas affectée dans cette classe. » s’il n’est pas une
  affectation du professeur ; sans matière et avec plusieurs matières sans
  compétence : « Plusieurs matières vous sont affectées dans cette classe :
  choisissez la matière de l’évaluation. ».
- `ClassInfo.subjects` (id, nom, triés) et `Evaluation.subjectId` lus en base
  (`lib/school-data-reader.ts`).
- `PedagogicalAiInput.assessment` n’a plus de `title`.

## Points pour GPT Work (UI, sans urgence technique)

- ~~Connexion : e-mail vidé après un mot de passe refusé~~ — corrigé par GPT Work
  (PR #9).
- À trancher par le propriétaire (pas par Claude) : sans
  `FOCUS_DEMO_REQUEST_URL`, la page publique ouvre désormais un e-mail vers
  l’adresse Gmail personnelle du propriétaire, alors que `FOCUS_PRODUCT.md`
  demande d’indiquer que les demandes ne sont pas ouvertes ; adresse
  personnelle publiée sur une page publique.
- Évaluation analysée : le bouton « Supprimer l’évaluation » reste affiché ; la
  suppression est refusée avec une explication (comportement correct, affichage
  à revoir éventuellement).
- Modification d’interface faite par Claude, nécessaire à la frontière IA :
  `components/students/pedagogical-ai-panel.tsx`, frise des notions du dossier
  élève : « erreur à examiner » → « hypothèse à examiner » (une hypothèse IA non
  décidée n’est jamais présentée comme une erreur établie). Un mot, aucun style.
- Modification d’interface faite par Claude, nécessaire pour débloquer la
  création d’évaluation (retour Codex 1) :
  `components/evaluations/evaluation-editor.tsx` — un `<select>` « Matière »
  (option vide « Choisir la matière »), avec les mêmes classes que le choix de
  la classe, affiché **uniquement** à la création quand le professeur a
  plusieurs matières dans la classe ; l’enregistrement reste désactivé tant
  qu’aucune matière n’est choisie ; changer de classe ou de matière vide les
  compétences choisies. Libellés et placement à revoir librement par GPT Work.
- Fichiers d’interface touchés par la branche canonique depuis #7 (logique,
  pas de refonte visuelle) : `components/evaluations/class-analysis-panel.tsx`
  (double clic), `assessment-review-panel.tsx` (hypothèse remplacée),
  `student-evidence-editor.tsx`, `delete-evaluation-button.tsx`,
  `components/classes/class-overview.tsx`, `components/students/student-synthesis.tsx`
  (ligne fusionnée), pages `app/(teacher)/app/**/page.tsx` (`maxDuration`).

## Tests (commandes exécutées le 7 octobre sur `1513e12`, local)

| Commande | Résultat |
| --- | --- |
| `npm run typecheck`, `npm run lint` | 0 erreur, 0 avertissement |
| `npm test` (unitaires + base PGlite, dont RLS, provenance, retours arrière, sonde, adhésion active) | 280/280 |
| `npm run build` | OK |
| `npm run test:routes` (dont parcours navigateur de la ligne fusionnée) | 31/31 |
| `npm run test:e2e` (Chromium : 10 Claude + 7 GPT Work) | 17/17 |
| Témoin négatif : titre remis dans l’entrée du modèle | E2E en échec, clé `'title'` signalée |
| CI GitHub `FOCUS checks / verify` sur `4c5f941` (avant ces commits) | vert |
| Preview Vercel `focus-app-nhkt` sur `4c5f941` et `5722513` | « Ready » (build accepté avec `vercel.json` et `maxDuration`) |

Vérifications hors suite :

- **Concurrence, PostgreSQL 16 réel, deux sessions** (`scratchpad`, non commité) :
  édition en cours pendant l’enregistrement → enregistrement en attente du
  verrou (3,06 s) puis refusé, 0 analyse ; enregistrement en cours pendant
  l’édition → édition en attente (3,07 s) puis analyse remplacée, 0 courante ;
  édition validée avant → refus. **Témoin sans verrou** : l’analyse reste
  « courante » sur un texte qui n’existe plus — le verrou est nécessaire.
- **Parcours professeur réel dans Chromium** (pile locale, modèle scripté) :
  16 étapes de la connexion refusée à la déconnexion, PDF élève lu avec
  `pdftotext` (seules les observations confirmées, avec preuve, confiance et
  note ; hypothèse écartée absente ; PDF d’évaluation sans hypothèse IA),
  0 erreur console, 0 réponse 5xx.
- **Live, lecture seule** : 24 migrations (tête `20260927100000`) ; advisors :
  `focus_persist_*` encore exécutables par `authenticated` (fermé par
  `20261004090000`), protection des mots de passe divulgués désactivée.
- Les deux agents de revue (correctness, sécurité) lancés le 4 octobre se sont
  arrêtés sur une limite d’usage sans rendre de résultat ; les passes 1 et 2 ont
  été faites par Claude directement (constat corrigé : point 4 ci-dessus).

## Bloquants / non prouvé

- **NON PROUVÉ SUR MODÈLE RÉEL** : aucune clé OpenAI dans cet environnement ;
  toutes les analyses testées viennent du modèle scripté.
- Migrations non appliquées sur un vrai projet Supabase (staging à créer :
  décision du propriétaire).
- Preview Vercel : déploiement « Ready », mais `/api/health` inaccessible
  (Vercel Authentication, secret `VERCEL_AUTOMATION_BYPASS_SECRET` absent) ;
  connecteur Vercel sans accès à l’équipe.
- Protection contre les mots de passe divulgués désactivée sur le projet live
  (advisor Supabase, 4 octobre).
