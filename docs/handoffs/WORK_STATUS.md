# FOCUS Teacher V1 — UI, produit et pilote

## Git et périmètre

- Branche : `work/ui-pilot-v1`, [PR #9](https://github.com/hamzaentreprise481-ctrl/focus-app/pull/9), empilée sur `ccr-38fbcf41-7sndhr` (PR #8).
- SHA initial, enregistré avant modifications : `da19bcf8389cf4212327f0e9a17878161fc256ac`.
- Base canonique intégrée après publication de Claude : `572251323b0c32c5cd4b9b7f9a8aa3c38f6e3956`.
- `main` reste la V0. Cette branche ne constitue pas un déploiement autonome.
- Propriété : vues client, composants UI, CSS, microcopy, captures, documentation et tests UI. Aucun changement de Supabase, SQL, RLS, RPC, Auth métier, serveur, routes API, contrats, moteur IA ou CI.
- `docs/handoffs/CLAUDE_STATUS.md` est identique à la base canonique.
- Les nouvelles synthèses classe/élève, le filtre des compétences par matière et la suppression contrôlée de Claude sont conservés.

## Audit : compréhension, rapidité, confiance

Audit des écrans réellement exécutés sur la pile de tests locale existante. Les identités et sorties modèle de cette pile sont fictives ; les vues authentifiées utilisent les actions et les données persistées existantes.

| Priorité | Problème initial ou découvert en usage | Impact | Correction UI |
| --- | --- | --- | --- |
| P1 | Indicateurs avant la file de travail sur l’accueil. | Chercher ce qu’il faut traiter. | Tâches d’abord, évaluations ensuite, tendances facultatives. |
| P1 | Notes et graphiques avant le sujet et les copies. | Parcours différenciant trop éloigné. | Sujet → Copies/analyse → Décisions ; résultats repliables. |
| P1 | Liste d’évaluations titrée avec une classe et une matière fixes. | Contexte trompeur pour d’autres affectations. | Libellés issus des données, recherche et filtre de classe. |
| P1 | Preuve, interprétation et décision difficiles à lire ensemble. | Confusion entre proposition et observation confirmée. | Carte structurée, preuve avant interprétation, statut écrit et distinction visuelle. |
| P1 | Chargement des copies parfois sans erreur visible ; état sauvegardé peu clair. | Impossible de savoir si la saisie existe. | Skeletons, erreurs avec reprise, enregistré/modifié et actions concurrentes bloquées. |
| P1 | Recliquer l’élève sélectionné laisse un chargement permanent ; copie précédente visible au passage à l’élève suivant. | Temps perdu et confusion entre élèves. | Sélection identique ignorée ; état de copie remis à zéro. |
| P1 | Après modification d’une copie, ancienne analyse encore en mémoire UI. | Une hypothèse remplacée paraît courante. | Rechargement de la copie et des hypothèses après sauvegarde. Supersession serveur inchangée. |
| P1 | Fieldset trop large à 820 px. | Saisie tablette pénible. | Min-width, boutons flexibles, dialogues bornés au viewport. |
| P2 | Pas de CTA commercial actif sans URL configurée. | Pas de suite pour un directeur intéressé. | URL HTTPS existante, sinon e-mail prérempli réel. |
| P2 | E-mail effacé après mot de passe refusé. | Ressaisir l’identifiant. | Champ contrôlé UI ; Auth inchangée. |

Le libellé « hypothèse à examiner » de Claude est conservé. Une proposition IA non décidée n’est jamais renommée « erreur confirmée ».

## Écrans et composants modifiés

- Accueil : action principale, contexte de classe, file groupée avec expansion fonctionnelle et accès direct aux hypothèses.
- Classes/classe : navigation, évaluations en premier, regroupements de Claude conservés et listes extensibles.
- Évaluations : recherche, filtre, compteur/reset ; création progressive, exigences visibles, bouton désactivé expliqué, confirmation avec prochaine action.
- Évaluation : sujet/corrigé, copies et décisions au premier plan ; notes et suppression contrôlée dans le détail.
- Analyse : extrait exact, interprétation, notion, niveau de preuve, piste et décision. Sources/catalogues consultables sans encombrer la lecture.
- Élève : notions dans le temps, observations confirmées, hypothèses distinctes, synthèse déterministe de Claude et évaluations associées. Notes et décisions déjà prises repliables.
- Connexion : contact, récupération de mot de passe et e-mail conservé après échec.
- Page publique : problème, usage, contrôle professeur, limites et petit pilote ; exemple explicitement fictif.
- Système partagé : `PageHeader`, `Breadcrumbs`, `SectionNav`, `Feedback`, `EmptyState`, `SectionLoading`, boutons, dialogues, contraste, spacing, focus et réduction de mouvement.

Composants : `work-queue`, `class-overview`, `evaluation-editor`, `assessment-definition-editor`, `student-evidence-editor`, `assessment-evidence-workspace`, `assessment-review-panel`, `pedagogical-ai-panel`, `student-roster`, `login-form`, primitives UI. Dans `class-analysis-panel`, seul le libellé singulier du bouton change ; verrous et orchestration de Claude sont conservés.

## Trois passes

1. **Système visuel** : page publique, connexion, dix écrans Teacher, états d’analyse et dialogues inspectés. Corrections puis nouvelles captures : hiérarchie, contrastes, espaces, notes longues, overflow tablette, hauteur de dialogue. Tableaux à défilement local ; aucun débordement global dans les largeurs testées.
2. **Professeur pressé** : zéro résultat/reset, compte sans classe, un élève visible, évaluation incomplète, une copie, 31 copies, analyse en cours, panne et reprise, preuve illisible, hypothèse non décidée, confirmation/refus, rechargement, titre long, note de 1000 caractères, deux évaluations successives, remplacement après modification et chargement interrompu. Une réponse correcte ultérieure reste « sans erreur observée », jamais maîtrise acquise.
3. **Directeur sceptique** : différence avec les outils de vie scolaire, preuve vérifiable, professeur décisionnaire, usage quotidien, pilote limité, coût de saisie et gain non mesuré expliqués. Aucun paiement, chatbot ou faux compte créé. Script : [TEACHER_PILOT_DEMO.md](TEACHER_PILOT_DEMO.md).

## Tests et preuves

| Vérification | Résultat intégré |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Réussis |
| `npm run build` | Build de production réussi |
| `npm test` | 276 tests réussis |
| `npm run test:routes` | 31 tests d’intégration existants réussis, assertions DB/Auth inchangées |
| `npm run test:e2e` | 16 scénarios Chromium : 9 existants + 7 UI/pilote ; cinq sélecteurs UI existants suivent le libellé singulier corrigé (aucune assertion backend changée) |
| Responsive | 1920, 1366, 1024, 820, 390 px ; 10 écrans Teacher par largeur |
| Accessibilité | 50 scans axe-core WCAG 2 A/AA et 2.1 A/AA ; zéro violation automatique |
| Clavier | Lien d’évitement, focus du contenu, confinement du focus et Escape dans les dialogues aux cinq largeurs |
| Interactions | Saisie/sauvegarde, copie suivante, lot, erreurs/reprise, insuffisance, confirmer/écarter, rechargement, suivi sur deux évaluations |

[ACCESSIBILITY_AUDIT.json](ACCESSIBILITY_AUDIT.json) contient les résultats et les contrôles qu’axe ne peut pas conclure automatiquement. Ce n’est pas une certification WCAG. Chromium est réellement lancé avec Playwright ; le daemon `agent-browser` n’a pas démarré dans cet environnement.

Reproduction : `npm ci --ignore-scripts`, `npx playwright-core install chromium`, puis typecheck, lint, test, build, test:routes et `FOCUS_E2E_SCREENSHOTS=/tmp/focus-ui-proof npm run test:e2e`. Pour les tests d’intégration, `PLAYWRIGHT_BROWSERS_PATH` doit pointer vers le répertoire où Chromium est installé, ou Chrome doit être présent sur le système. Dans ce conteneur, les tests utilisent Chromium Headless Shell via un chemin de lancement temporaire compatible avec le helper existant ; celui-ci est inchangé.

Audit axe facultatif, sans dépendance produit ajoutée : installer `@axe-core/playwright` dans un répertoire temporaire ; passer son chemin absolu dans `FOCUS_UI_AXE_MODULE` et le fichier de sortie dans `FOCUS_UI_AXE_REPORT` lors de l’exécution de `tests/e2e/teacher-ui-pilot.test.ts`.

Captures sélectionnées : [screenshots/README.md](screenshots/README.md). Toutes viennent du navigateur et de la pile fictive locale. Les dates futures des évaluations initiales sont des fixtures. Aucun seed de démonstration en production, tableau JS métier de substitution ni `localStorage` métier ajouté.

## Backend transmis à Claude

La première CI distante a relevé trois incompatibilités UI : résultats encore repliés après sélection d’une compétence, suppression cachée dans le volet des résultats et libellé de démonstration changé. Corrections dans les vues : ouverture des résultats à la sélection, gestion en pied d’évaluation, mention « Données fictives de démonstration ». Aucun test d’intégration, assertion DB/Auth ou fichier CI modifié. Les 31 tests d’intégration sont réexécutés avec ces corrections.

Aucune nouvelle anomalie backend reproductible confirmée par cette passe UI. Les pannes forcées sont des tests. Les points suivants sont **hérités du statut de Claude**, et non des constats personnels sur le live.

### B1 — Analyse réelle et déploiement — P0 avant données réelles

- Pages : évaluation, analyse, fiche élève.
- Attendu : provenance moteur, migrations et analyse réelle vérifiées sur le pilote.
- Observé par Claude : live à `20260927100000` ; migrations `20261002120000_access_integrity_hardening` et `20261004090000_engine_signed_analyses` non appliquées le 4 octobre ; modèle réel non testé ici.
- Reproduction/contrôle : suivre la procédure staging de Claude, vérifier les versions et lancer une analyse réelle. Pas de reproduction live par l’agent UI.
- Impact : un parcours local réussi n’établit pas que l’analyse fonctionne sur le pilote réel.
- Pour Claude : `OPENAI_API_KEY`, `FOCUS_ANALYSIS_SIGNING_KEY` et clé moteur DB correspondante requises. Les messages sont affichés via les contrats existants. Source : `CLAUDE_STATUS.md`, migrations/bloquants.

### B2 — Accès à la Preview — P1

- Page : Preview Vercel, `/api/health`.
- Attendu : accès du présentateur, login et analyse contrôlables avant rendez-vous.
- Observé par Claude : Ready mais protection Vercel/401 ; accès d’équipe et bypass absents.
- Reproduction/contrôle : reprendre l’URL et l’accès décrits par Claude, puis vérifier login, analyse et PDF. Aucun contournement UI.
- Impact : démonstration externe ouverte non promise à ce stade.
- Pour Claude : cette PR est vérifiée en build local de production et n’est pas déployée. Source : `CLAUDE_STATUS.md`, Preview.

### B3 — Configuration Auth héritée — P1 technique

- Page : connexion, comptes pilote.
- Attendu : configuration Auth approuvée par le responsable technique.
- Observé par Claude : protection des mots de passe divulgués désactivée (advisor live, 4 octobre).
- Reproduction/contrôle : revoir cet advisor avec Claude ; aucune modification Auth/Supabase ici.
- Impact : préparation des comptes à clôturer avant pilote réel.
- Pour Claude : conserver l’e-mail après échec est indépendant des sessions et de la sécurité. Source : `CLAUDE_STATUS.md`.

## Suppositions et risques restants

- Les données et décisions serveur font autorité : vide ≠ zéro, hypothèse ≠ observation confirmée, aucune erreur ≠ maîtrise. Compétences saisies et notions analysées restent distinctes.
- Analyse limitée aux mathématiques ; autres matières en saisie/consultation selon les droits serveur.
- `FOCUS_DEMO_REQUEST_URL` garde son rôle existant. Sans HTTPS valide, le CTA utilise le contact fourni dans le contexte utilisateur : `hamzaentreprise481@gmail.com`. Il ouvre la messagerie ; aucun e-mail envoyé automatiquement. Une adresse commerciale dédiée peut le remplacer.
- **P0** : staging, migrations, signature moteur et modèle réel à vérifier avec Claude avant données réelles.
- **P1** : utilité, précision/refus et temps total à mesurer, saisie texte incluse.
- **P2** : retours utilisateurs, Safari/Firefox et sujets avec beaucoup de questions ; le bouton de suppression explique le refus d’une évaluation déjà analysée.

Prochaines actions : clôturer staging avec Claude ; jouer la démo fictive avec un professeur et un directeur ; mesurer le petit pilote une fois son cadre validé.
