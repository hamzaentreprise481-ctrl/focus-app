# FOCUS

FOCUS complète les outils de vie scolaire avec un suivi pédagogique. Ce dépôt contient trois espaces séparés — **FOCUS Teacher** (`/app`), **FOCUS Student** (`/student`) et **FOCUS Direction** (`/director`) — et leur vitrine publique, qui présente le produit et oriente chacun vers sa propre connexion. FOCUS Parent reste prévu dans un projet distinct.

Lire [FOCUS_PRODUCT.md](./FOCUS_PRODUCT.md) avant toute modification, puis [AGENTS.md](./AGENTS.md). Claude Code charge ces deux références via [CLAUDE.md](./CLAUDE.md).

## État réel

- **Connexion** : comptes professeurs Supabase Auth ; l’autorisation Teacher vient d’une appartenance `school_memberships` active avec le rôle `teacher`, vérifiée côté serveur et par RLS. `app_metadata` n’est plus une source d’autorisation. Aucun identifiant de démonstration ni contournement public.
- **Données** : classes, élèves, évaluations, résultats, sujets, copies et décisions sont lus et écrits dans Supabase, sous RLS, avec la session du professeur. L’application n’affiche aucun jeu fictif en secours et n’utilise pas le stockage du navigateur.
- **Parcours** : tableau de bord « À traiter » → évaluation (créée avant toute note) → sujet, questions, corrigé, barème et notions visées → import facultatif d’une pile de copies scannées en un PDF (séparation/nom/note/transcription, confirmation des cas incertains) ou saisie manuelle → analyse de toutes les copies de la classe en une action, copie par copie (mathématiques) → hypothèses de l’évaluation que le professeur confirme ou écarte sur place, avec note → dossier élève longitudinal et export PDF.
- **IA pédagogique** : l’analyse ne peut citer qu’un extrait littéral de la copie, une notion du programme de la classe liée aux notions de la question, et une erreur type du catalogue de cette notion. La confiance est calculée par la base à partir de l’historique ; rien n’entre dans le suivi sans décision du professeur. Hypothèses, notes et décisions ne sont lisibles que par les professeurs de la classe **et de la matière** et l’administrateur de l’établissement — jamais par l’élève ni par les professeurs d’autres matières. Voir [docs/PEDAGOGICAL_AI_VALIDATION.md](./docs/PEDAGOGICAL_AI_VALIDATION.md).
- **Student** (`/student`) : lecture seule de ses propres évaluations, notes, réponses enregistrées, commentaires et annotations du professeur, niveaux de compétence saisis et progression ; aucune analyse IA Teacher non validée. **Assistant FOCUS** (`/student/assistant`) : aide pédagogique (explication, exercice, révision), guidée par défaut, à partir des seules données lisibles par l’élève sous RLS ; il n’écrit rien et refuse toute demande de modification de note. Non prouvé sur modèle réel (aucune clé dans l’environnement de développement).
- **Direction** (`/director`) : rôle de base `admin` (aucune modification de l’enum) ; vue établissement en lecture seule, agrégats uniquement (aucun nom d’élève, aucune note individuelle, aucun classement d’enseignants), avancement du programme en trois dimensions séparées (enseigné déclaré, évalué, compétences documentées) et risque de retard calculé de façon déterministe (`lib/director/metrics.ts`). Le programme enseigné reste « non disponible » tant que les professeurs ne peuvent pas déclarer de séances (écriture sur `lessons` fermée ; proposition `supabase/proposals/20261010090000_teacher_lesson_declarations.sql`, non appliquée).
- **Base live** : les migrations sont appliquées jusqu’à `20261004090000`, y compris le durcissement des accès par classe + matière et la provenance signée des analyses. `supabase/staging/verify.sql` a été rejoué sur la base live le 7 octobre 2026 et retourne `FOCUS staging verification: OK`.
- **Validation de release** : des comptes professeurs se sont connectés au projet live ; la Preview de release vérifie le schéma `20261004090000`, l’accès au modèle `gpt-6-astra` et la clé de signature. Le benchmark réel du modèle et la CI de release sont documentés dans `docs/PEDAGOGICAL_AI_VALIDATION.md` et `docs/RELEASE_V1.md`. Le cadre RGPD reste à contractualiser avec chaque établissement avant toute donnée réelle d’élève.

## Développement

Node.js 22 en CI. Conserver npm et `package-lock.json`.

```bash
npm ci
cp .env.example .env.local   # URL et clé publiable du projet Supabase FOCUS
npm run dev
```

Sans variables Auth, la vitrine fonctionne et toutes les routes privées (professeur, élève, direction) refusent l’accès.

### Environnement local complet, sans réseau

```bash
npm run build
node --import tsx scripts/local-stack.ts   # http://127.0.0.1:3300/connexion
```

Le schéma réel (toutes les migrations) tourne dans PGlite avec une école fictive, derrière un double Supabase Auth/PostgREST et un modèle **scripté**. Les comptes fictifs (professeur, deux élèves, direction, et la direction d’un second établissement fictif) s’affichent au démarrage. Les analyses produites ainsi sont simulées : elles vérifient le parcours et les garde-fous, jamais la qualité du modèle. `FOCUS_LOCAL_UP_TO=<migration>` arrête le schéma à une migration donnée, pour voir le comportement face à une base en retard.

## Routes et limites entre espaces

| Espace            | Routes                                                                       | Implémentation                                                                  |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Public            | `/` (portail : présentation et trois espaces), `/enseignants`, `/decouvrir`, `/fonctionnement`, `/confiance`, `/abonnements`, `/questions` | `app/(marketing)` ; aperçu issu uniquement de `lib/demo/marketing-data.ts` (fictif) |
| Connexion         | `/connexion` (professeur), `/connexion-eleve`, `/connexion-direction`, `/connexion/mot-de-passe-oublie`, `/connexion/nouveau-mot-de-passe`, `/auth/confirm` | `app/(auth)`, `app/auth/confirm` ; une connexion par espace, côté serveur ; un nouveau mot de passe ouvre l’espace du rôle actif du compte |
| Professeur privé  | `/app`, `/app/classes`, `/app/eleves`, `/app/evaluations`, `/app/parametres` | `app/(teacher)/app` ; `requireTeacher()` sur chaque page, action et le layout   |
| Élève privé       | `/student`, `/student/evaluations`, `/student/evaluations/[id]`, `/student/progression`, `/student/assistant`, `/student/profil` | `app/(student)/student` ; `requireStudent()` (appartenance `student` active) sur chaque page et action |
| Direction privée  | `/director`, `/director/classes`, `/director/classes/[id]`, `/director/professeurs`, `/director/programme`, `/director/alertes`, `/director/parametres` | `app/(director)/director` ; `requireDirector()` (appartenance `admin` active) sur chaque page et le layout |
| Liens historiques | `/classes/*`, `/eleves/*`, `/evaluations/*`, `/parametres/*`                 | Redirections permanentes définies dans `next.config.ts`                         |

Le Proxy actualise les cookies et refuse chaque espace privé sans l’appartenance active correspondante (un professeur n’entre ni dans `/student` ni dans `/director`, un élève ni dans `/app` ni dans `/director`). Chaque page et chaque Server Action revérifie l’utilisateur ; la base revérifie chaque ligne (RLS) et chaque écriture (fonctions `focus_*`).

## Base de données

`supabase/migrations/` reproduit le schéma requis par la V1 jusqu’à `20261004090000`. Le projet live est aligné sur cette version ; les versions de `supabase_migrations.schema_migrations` ont été vérifiées le 7 octobre 2026. Les migrations postérieures au 25 septembre :

| Migration | Contenu |
| --- | --- |
| `20260926120000_curriculum_import_v1` | Importeur du programme (service_role, dry run, idempotent, désactivation seulement) |
| `20260926140000_curriculum_catalogue_v1` | Tables du catalogue : objectifs, erreurs types, remédiations, provenance |
| `20260926150000_teacher_evidence_review_v1` | Sujet/questions séparés des copies, points ≤ barème, remplacement des analyses si les preuves changent, écritures IA uniquement par fonctions auditées, décisions et historique du professeur |
| `20260926160000_curriculum_work_seconde_2026` | Programme de Seconde (99 nœuds, 330 relations ; 44 UUID conservés, litiges non tranchés laissés en l’état) |
| `20260926170000_curriculum_catalogue_work_seconde_2026` | Catalogue de Seconde (272 objectifs, 99 erreurs types, 99 remédiations) |
| `20260926180000_teacher_work_queue` | Lecture « À traiter » du tableau de bord (SECURITY INVOKER) |
| `20260926190000_security_performance_hardening` | Recommandations des advisors Supabase : anon sans accès aux tables, `(select auth.uid())` dans les policies, index des clés étrangères |
| `20260927090000_schema_version` | `focus_schema_version()` : version du schéma lue par `/api/health` (seule fonction SECURITY DEFINER ouverte à anon, ne renvoie qu’une version) |
| `20260927100000_ai_usage_events` | Usage IA par requête (modèle, latence, jetons, issue, réutilisation), sans contenu ni identifiant d’élève ; voir [docs/AI_USAGE.md](./docs/AI_USAGE.md) |
| `20261002120000_access_integrity_hardening` | **Appliquée sur le projet live.** Hypothèses IA, notes et décisions lisibles par les professeurs de la classe et de la matière et l’administrateur, plus par l’élève ni par les autres matières ; décision par un professeur actuellement affecté ; écritures directes soumises aux règles des fonctions `focus_*` (école et classe de l’évaluation, élèves inscrits, maximum ≥ points attribués, notions actives) ; aucune constatation IA enregistrable sur une réponse notée au maximum ou identique au corrigé (comme dans l’application) ; plus de TRUNCATE/TRIGGER/REFERENCES pour `authenticated` ; tables V0 inutilisées en lecture seule. Retour arrière testé : `supabase/rollback/20261002120000_access_integrity_hardening.down.sql` |
| `20261004090000_engine_signed_analyses` | **Appliquée sur le projet live.** Une analyse IA ne s’enregistre plus que par `focus_record_engine_analysis`, avec une enveloppe signée par le serveur FOCUS (HMAC-SHA256, clé dans `FOCUS_ANALYSIS_SIGNING_KEY` et dans `focus_private.engine_keys`, illisible par les rôles de l’API), liée au professeur connecté, valable dix minutes et à la version des preuves lue **avant** la copie : copie, sujet, corrigé, barème, notions ou consignes modifiés pendant l’analyse ⇒ refus, rien n’est enregistré. Les fonctions de persistance ne sont plus appelables par `authenticated`. Une évaluation dont des copies ont été analysées ne se supprime plus par l’API. Retour arrière testé : `supabase/rollback/20261004090000_engine_signed_analyses.down.sql` |
| `20261007090000_active_teacher_membership` | **Pas encore appliquée sur le projet.** Une affectation classe/matière ne donne accès que si l’adhésion professeur à l’établissement est active. |
| `20261007130000_scan_import_storage` | **Pas encore appliquée sur le projet.** Ajoute l’import atomique copie + note et les politiques du bucket privé de PDF ; le bucket `focus-scan-imports` est créé/mis à jour via `npm run setup:scan-storage -- --commit`, jamais par écriture SQL directe dans les tables internes de Storage. |
| `20261009120000_transcription_provenance_question_outcomes` | **Pas encore appliquée sur le projet.** Provenance de chaque réponse (`source` saisie/scan, `legibility`, `transcription_verified`) incluse dans la version des preuves ; `focus_verify_transcription` (le professeur confirme une lecture) ; une issue validée par question dans chaque analyse (`question_outcomes`), revérifiée en base ; aucune constatation sur une réponse illisible ou un passage marqué `[illisible]`/`[?…]` ; confiance bornée par la lecture (`limitée` si partiellement lisible, au plus `modérée` si lecture non vérifiée) ; une analyse signée par un serveur antérieur (sans issues par question) reste acceptée pendant la bascule, avec tous les autres contrôles. Répétée sur une copie du live : [docs/LIVE_MIGRATION_PLAN.md](./docs/LIVE_MIGRATION_PLAN.md). Retour arrière testé : `supabase/rollback/20261009120000_transcription_provenance_question_outcomes.down.sql`. Voir [docs/HANDWRITING_EVALUATION.md](./docs/HANDWRITING_EVALUATION.md) |

Le code de cette branche a besoin de **toutes** les migrations, jusqu’à `20261009120000` (entrée signée pour les analyses, adhésion professeur active, import scan atomique, provenance des transcriptions et issues par question), du bucket scan privé provisionné sur l’environnement et de la clé du moteur installée en base (voir ci-dessous) ; sans elles, l’application l’indique explicitement (« La base de données n’est pas à jour… ») au lieu d’échouer silencieusement. `20261002120000` ne change aucun appel de l’application : elle ferme des accès directs à PostgREST (tout compte Supabase Auth, y compris les comptes élèves fictifs qui ont un mot de passe, peut interroger l’API avec la clé publiable). `/api/health` réclame la dernière migration (`NOT READY` tant qu’elle manque).

**Clé du moteur d’analyse.** Générer 32 octets aléatoires (`openssl rand -hex 32`), les enregistrer dans la variable serveur `FOCUS_ANALYSIS_SIGNING_KEY` (Vercel, Production et Preview) et, une seule fois par base, dans l’éditeur SQL Supabase : `insert into focus_private.engine_keys (id, secret) values (1, decode('<la même valeur hex>', 'hex')) on conflict (id) do update set secret = excluded.secret, rotated_at = now();`. La même valeur des deux côtés ; sans elle aucune analyse n’est enregistrée et l’application l’explique. Changer de clé = mettre à jour les deux puis redéployer. L’appliquer d’abord sur une branche Supabase ou une copie, relancer les advisors, `supabase/staging/verify.sql` et `supabase/staging/rls-probe.sql` (sonde en lecture seule : tout est annulé à la fin ; elle rejoue en base réelle les accès élève, autre matière, autre établissement, anon et écritures directes), puis le parcours professeur. Le retour arrière (`supabase/rollback/…down.sql`, puis `supabase migration repair --status reverted 20261002120000`) rend le schéma identique, objet pour objet, à celui d’avant (`tests/migration-rollback.test.ts`) ; il rouvre les accès que la migration ferme, il ne sert qu’à annuler un déploiement défectueux. Ne rien appliquer en production sans l’accord du propriétaire.

## Configuration Supabase Auth

Utiliser le projet Supabase réservé à FOCUS ; ne jamais réutiliser les ressources d’un autre produit.

1. Activer la connexion e-mail/mot de passe ; désactiver les inscriptions publiques et les connexions anonymes. Activer la protection contre les mots de passe divulgués (advisor Supabase) et « Secure password change » (réauthentification exigée pour changer le mot de passe d’une session ancienne : la page /connexion/nouveau-mot-de-passe accepte aussi une session ouverte normalement).
2. **URL Configuration** : *Site URL* = l’URL du déploiement FOCUS ; ajouter aux *Redirect URLs* `https://<domaine>/auth/confirm` (et l’URL des Previews utilisées pour la recette).
3. **Email Templates** : les liens doivent passer par `/auth/confirm` avec un `token_hash` (vérifié côté serveur, à usage unique) :
   - *Reset Password* : `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
   - *Invite user* : `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
4. Inviter les professeurs avec `scripts/admin-invite-teacher.ts` (ci-dessous) ou les outils d’administration Supabase. L’accès Teacher est accordé par une ligne `school_memberships` active avec `role = teacher`, créée côté administrateur ; ni `user_metadata` ni `app_metadata` n’autorisent l’accès. `user_metadata.display_name` reste uniquement de l’affichage.
5. Créer l’appartenance à l’établissement et les affectations classe/matière (`school_memberships`, `teacher_assignments`) : un professeur ne voit que ses classes. Le script d’invitation le fait.

Parcours de compte dans FOCUS :

- `/connexion/mot-de-passe-oublie` : demande de lien ; la réponse est identique qu’un compte existe ou non (seuls la limite de débit et une panne sont signalées).
- `/auth/confirm` : vérifie le lien (`verifyOtp` ou échange de code), ouvre la session et redirige vers `/connexion/nouveau-mot-de-passe` ; un lien invalide, expiré ou déjà utilisé renvoie vers la demande de nouveau lien, sans session.
- `/connexion/nouveau-mot-de-passe` : 12 à 128 caractères, confirmation ; un professeur arrive ensuite dans `/app`. Un compte sans rôle `teacher` peut enregistrer son mot de passe mais reste refusé et déconnecté.

Invitation d’un compte (fictif pour la recette : utiliser une adresse que vous contrôlez), **depuis un shell d’administrateur uniquement** :

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… FOCUS_SITE_URL=https://<déploiement> \
node --import tsx scripts/admin-invite-teacher.ts --project-ref <ref> --email prof@example.test \
  --school <uuid> --class <uuid> --subject <uuid>            # affiche le plan, n’écrit rien
# … puis la même commande avec --commit
```

`--project-ref` doit correspondre à l’URL (garde-fou contre une erreur de projet). Sans `--commit`, rien n’est envoyé.

### « Connexion impossible » : diagnostic

Ce message reprend la réponse de Supabase Auth (`invalid_credentials`) : l’adresse n’a pas de compte dans le projet, ou le mot de passe est différent. Les anciens identifiants de démonstration (`prof@focus.fr`) n’existent pas dans Supabase Auth et ne fonctionneront jamais. Depuis une machine qui atteint Supabase :

```bash
FOCUS_CHECK_SUPABASE_URL=https://<ref>.supabase.co FOCUS_CHECK_SUPABASE_KEY=<clé publiable> \
FOCUS_CHECK_EMAIL=<adresse du professeur> FOCUS_CHECK_PASSWORD=<mot de passe> \
npm run check:login -- --project-ref <ref>
```

Avec `FOCUS_CHECK_APP_URL=<déploiement>` (et `VERCEL_AUTOMATION_BYPASS_SECRET` si la Preview est protégée), le même contrôle passe aussi par le vrai formulaire du déploiement : cookie HttpOnly, rechargement, pages classe/élèves/évaluations, déconnexion. État et étapes restantes : [docs/GO_LIVE_LOGIN.md](./docs/GO_LIVE_LOGIN.md).

Une ligne PASS/FAIL par étape du parcours de l’application : connexion, session vérifiée, appartenance Teacher active, profil, établissement, affectations, lectures sous RLS, version du schéma, renouvellement, déconnexion, refus anonyme. Aucun mot de passe, jeton ni contenu n’est affiché ; une clé secrète est refusée.

Sessions : cookies HttpOnly, SameSite=Lax, Secure en HTTPS ; `getUser()` côté serveur ; redirections de retour limitées à `/app`.

### Comptes élève et direction de démonstration

Aucun compte de démonstration n’existe sur le projet live : c’est le seul environnement Supabase (ni branche ni staging) et créer une connexion demande la clé `service_role`. Le script d’administration crée, dans un **établissement de démonstration séparé** et entièrement fictif, un compte élève et un compte direction (adresses `@demo.focus.invalid`, aucun e-mail envoyé, mots de passe générés et affichés une fois), avec classe, évaluations, notes, réponses, commentaires, niveaux de compétence et séances :

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
  node --import tsx scripts/admin-create-demo-portals.ts --project-ref <ref>            # lecture seule : plan
# … puis la même commande avec --commit (de préférence sur un projet de staging)
```

Il n’écrit que des insertions dans l’établissement qu’il crée et refuse de s’exécuter deux fois ; la même séquence est rejouée en test sur le schéma live (`tests/demo-portals-seed.test.ts`). Pour l’essayer sans réseau, `scripts/local-stack.ts` fournit les mêmes espaces avec des comptes fictifs.

## Variables d’environnement

| Variable | Portée | Rôle |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production et Preview | Projet Supabase FOCUS ; clé publiable, jamais `service_role` |
| `OPENAI_API_KEY` | Serveur uniquement | Analyse pédagogique ; jamais en `NEXT_PUBLIC_` |
| `FOCUS_ANALYSIS_SIGNING_KEY` | Serveur uniquement | 32 à 64 octets en hexadécimal ; signe chaque analyse enregistrée (la même valeur que `focus_private.engine_keys`) ; jamais en `NEXT_PUBLIC_` |
| `FOCUS_AI_MODEL` | Serveur | Modèle d’analyse (défaut `gpt-6-astra` ; l’ancien override `gpt-5.6-terra` est routé vers Astra par compatibilité) |
| `FOCUS_AI_HOURLY_LIMIT` | Serveur | Appels au modèle par professeur et par heure (défaut 150) |
| `FOCUS_AI_REASONING_EFFORT` | Serveur | `low` (défaut), `medium` ou `high` |
| `FOCUS_SCAN_MODEL` | Serveur | Modèle de lecture des copies scannées ou photographiées (défaut : `FOCUS_AI_MODEL`) |
| `FOCUS_STUDENT_AI_MODEL` | Serveur | Modèle de l’Assistant FOCUS côté élève (défaut : le modèle de `FOCUS_AI_MODEL`, soit `gpt-6-astra`) ; utilise `OPENAI_API_KEY` |
| `FOCUS_SCAN_REASONING_EFFORT` | Serveur | Effort de lecture des copies : `high` (défaut), `medium` ou `low` ; à ne baisser qu’après mesure (`npm run test:handwriting-live`) |
| `FOCUS_SITE_URL` | Serveur, recommandé | Origine HTTPS utilisée dans les liens de réinitialisation ; sinon l’hôte de la requête |
| `FOCUS_DEMO_REQUEST_URL` | Facultatif | Formulaire HTTPS vérifié ; sinon la vitrine indique que les demandes ne sont pas ouvertes |

`SUPABASE_SERVICE_ROLE_KEY` ne sert qu’aux commandes d’administration (`npm run curriculum -- apply|export`, `scripts/admin-invite-teacher.ts`, `scripts/admin-create-demo-portals.ts`) dans un shell local ; jamais dans Vercel ni dans l’application (un test le vérifie). Redéployer après toute modification des variables `NEXT_PUBLIC_`.

## Programme officiel et catalogue

Le graphe du programme et le catalogue changent uniquement par `curriculum/` et `npm run curriculum`. Voir [curriculum/README.md](./curriculum/README.md), y compris les 15 litiges du document Work qui attendent une décision d’auteur.

## Validation

```bash
npm run typecheck       # next typegen + tsc --noEmit
npm run lint
npm run test            # unitaires, schéma réel (PGlite) avec RLS, parcours, programme, sécurité
npm run build
npm run test:routes     # après build ; vraies routes contre un double Supabase Auth
npm run test:e2e        # après build ; parcours professeur complet dans Chromium (stack locale, modèle scripté)
npm run curriculum:check
npm run test:ai-live    # opt-in : 47 copies synthétiques, vrai modèle, nécessite OPENAI_API_KEY (--reference : auto-test hors ligne)
npm run check:deployment -- https://votre-domaine-focus
```

Les tests de base de données exécutent toutes les migrations sur PostgreSQL (PGlite) avec les rôles `anon`, `authenticated` et `service_role` : ils prouvent le comportement du schéma du dépôt, pas la configuration d’un projet Supabase réel. `check:deployment` ne fait que des lectures anonymes.

### Vérification d’une Preview

Pour chaque déploiement Vercel, le workflow **FOCUS Preview verification** (`.github/workflows/preview-verify.yml`) lit `/api/health` sur l’URL de **ce** déploiement et publie un statut « FOCUS Preview verified (…) » sur le commit :

- `VERIFIED` : le déploiement exécute exactement ce commit ; Supabase est configuré et joignable, le schéma est à jour (`focus_schema_version()` ≥ la version requise par le code), la clé OpenAI est présente, le modèle accessible et la clé de signature du moteur définie (que la base détienne la même n’est vérifiable qu’à la première analyse) ;
- `NOT READY` : bon commit, mais l’un de ces éléments manque (le détail est dans le résumé du job) ;
- `UNVERIFIED` : rien n’est prouvé (protection Vercel, autre commit, URL injoignable). Avec Vercel Authentication, créer un secret « Protection Bypass for Automation » et l’enregistrer comme secret GitHub `VERCEL_AUTOMATION_BYPASS_SECRET`.

`/api/health` n’existe pas en production et ne renvoie que des booléens, des versions, le nom du modèle et le commit — jamais une valeur de variable. À la main : `node scripts/verify-preview.mjs <url> <sha>`.

Ce statut prouve la configuration, pas le parcours : la connexion réelle et l’analyse d’une copie restent à tester sur la Preview.

## Limites connues

- Mot de passe oublié et invitation testés contre le double Supabase local, pas encore avec les modèles d’e-mail d’un vrai projet ; pas d’inscription libre. Pas d’import depuis PRONOTE, ÉcoleDirecte ou l’ENT.
- L’analyse IA couvre les mathématiques de Seconde ; sa qualité n’est pas mesurée (revue en aveugle à faire).
- Le catalogue (erreurs types, remédiations) est une proposition éditoriale FOCUS, validée par aucun enseignant ; 15 litiges du programme attendent leur auteur.
- La mesure de l’effet des remédiations n’est pas implémentée.
- Provenance des analyses : depuis `20261004090000`, seule une enveloppe signée par le serveur FOCUS s’enregistre. La signature prouve que le serveur l’a produite, pas que chaque mot vient du modèle : le serveur reste le point de confiance (qui détient la clé peut signer).
- Supprimer une question du sujet (ou vider une réponse) efface les observations IA rattachées (`error_observations`, en cascade) ; les hypothèses et décisions du professeur (`pedagogical_recommendations`) restent dans l’historique.
- Projet live : la protection contre les mots de passe divulgués est désactivée (Auth → Providers → Email, réglage du tableau de bord).
- Aucune conformité RGPD n’est revendiquée : hébergement, durée de conservation, registre et analyse d’impact restent à établir avec l’établissement.

Historique des audits : [AUDIT_2026-09-11.md](./docs/history/AUDIT_2026-09-11.md), [AUDIT_2026-09-13.md](./docs/history/AUDIT_2026-09-13.md), [DESIGN_AUDIT.md](./docs/history/DESIGN_AUDIT.md).
