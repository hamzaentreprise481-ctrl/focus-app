# FOCUS Teacher

FOCUS complète les outils de vie scolaire avec un espace de suivi pédagogique pour les enseignants. Ce dépôt contient **FOCUS Teacher** et sa vitrine publique. FOCUS Student et FOCUS Parent sont prévus dans des projets distincts.

Lire [FOCUS_PRODUCT.md](./FOCUS_PRODUCT.md) avant toute modification, puis [AGENTS.md](./AGENTS.md). Claude Code charge ces deux références via [CLAUDE.md](./CLAUDE.md).

## État réel

- **Connexion** : comptes professeurs Supabase Auth, rôle `app_metadata.role = "teacher"` attribué par l’administrateur. Aucun identifiant de démonstration, aucune session simulée.
- **Données** : classes, élèves, évaluations, résultats, sujets, copies et décisions sont lus et écrits dans Supabase, sous RLS, avec la session du professeur. L’application n’affiche aucun jeu fictif en secours et n’utilise pas le stockage du navigateur.
- **Parcours** : tableau de bord « À traiter » → évaluation → sujet, questions, corrigé, barème et notions visées → copies (réponse exacte, points, annotation) → analyse (mathématiques) → hypothèses que le professeur confirme ou écarte, avec note → dossier élève longitudinal et export PDF.
- **IA pédagogique** : l’analyse ne peut citer qu’un extrait littéral de la copie, une notion du programme de la classe liée aux notions de la question, et une erreur type du catalogue de cette notion. La confiance est calculée par la base à partir de l’historique ; rien n’entre dans le suivi sans décision du professeur. Voir [docs/PEDAGOGICAL_AI_VALIDATION.md](./docs/PEDAGOGICAL_AI_VALIDATION.md).
- **Pas encore validé en conditions réelles** : les migrations de cette branche ne sont pas appliquées sur le projet Supabase, l’analyse n’a jamais été exécutée avec le vrai modèle (aucune clé disponible dans l’environnement de développement), et le cadre RGPD de l’établissement n’est pas établi. Ne saisir aucune donnée réelle d’élève avant ces validations.

## Développement

Node.js 22 en CI. Conserver npm et `package-lock.json`.

```bash
npm ci
cp .env.example .env.local   # URL et clé publiable du projet Supabase FOCUS
npm run dev
```

Sans variables Auth, la vitrine fonctionne et toutes les routes professeur refusent l’accès.

### Environnement local complet, sans réseau

```bash
npm run build
node --import tsx scripts/local-stack.ts   # http://127.0.0.1:3300/connexion
```

Le schéma réel (toutes les migrations) tourne dans PGlite avec une école fictive, derrière un double Supabase Auth/PostgREST et un modèle **scripté**. Les comptes fictifs s’affichent au démarrage. Les analyses produites ainsi sont simulées : elles vérifient le parcours et les garde-fous, jamais la qualité du modèle. `FOCUS_LOCAL_UP_TO=<migration>` arrête le schéma à une migration donnée, pour voir le comportement face à une base en retard.

## Routes et limites entre espaces

| Espace            | Routes                                                                       | Implémentation                                                                  |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Public            | `/`                                                                          | `app/(marketing)` ; aperçu issu uniquement de `lib/demo/marketing-data.ts` (fictif) |
| Connexion         | `/connexion`, `/connexion/mot-de-passe-oublie`, `/connexion/nouveau-mot-de-passe`, `/auth/confirm` | `app/(auth)`, `app/auth/confirm` ; connexion, déconnexion, réinitialisation et invitation côté serveur |
| Professeur privé  | `/app`, `/app/classes`, `/app/eleves`, `/app/evaluations`, `/app/parametres` | `app/(teacher)/app` ; `requireTeacher()` sur chaque page, action et le layout   |
| Liens historiques | `/classes/*`, `/eleves/*`, `/evaluations/*`, `/parametres/*`, `/decouvrir`   | Redirections permanentes définies dans `next.config.ts`                         |

Le Proxy actualise les cookies et refuse les requêtes privées sans professeur. Chaque page et chaque Server Action revérifie l’utilisateur ; la base revérifie chaque ligne (RLS) et chaque écriture (fonctions `focus_*`).

## Base de données

`supabase/migrations/` reproduit exactement le schéma du projet live jusqu’à `20260925214642` (empreinte vérifiée par `tests/schema-live.test.ts`, mêmes versions que `supabase_migrations.schema_migrations`). Les migrations suivantes sont **dans le dépôt, pas encore sur le projet** :

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

Le code de cette branche a besoin de ces migrations. Sans elles, l’application l’indique explicitement (« La base de données n’est pas à jour… ») au lieu d’échouer silencieusement. Les appliquer **dans l’ordre**, d’abord sur une branche Supabase ou une copie, puis relancer les advisors et le parcours professeur. Ne rien appliquer en production sans l’accord du propriétaire.

## Configuration Supabase Auth

Utiliser le projet Supabase réservé à FOCUS ; ne jamais réutiliser les ressources d’un autre produit.

1. Activer la connexion e-mail/mot de passe ; désactiver les inscriptions publiques et les connexions anonymes. Activer la protection contre les mots de passe divulgués (advisor Supabase) et « Secure password change » (réauthentification exigée pour changer le mot de passe d’une session ancienne : la page /connexion/nouveau-mot-de-passe accepte aussi une session ouverte normalement).
2. **URL Configuration** : *Site URL* = l’URL du déploiement FOCUS ; ajouter aux *Redirect URLs* `https://<domaine>/auth/confirm` (et l’URL des Previews utilisées pour la recette).
3. **Email Templates** : les liens doivent passer par `/auth/confirm` avec un `token_hash` (vérifié côté serveur, à usage unique) :
   - *Reset Password* : `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
   - *Invite user* : `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
4. Inviter les professeurs avec `scripts/admin-invite-teacher.ts` (ci-dessous) ou les outils d’administration Supabase, puis affecter **côté administrateur** `app_metadata: { "role": "teacher" }`. Jamais dans `user_metadata`, modifiable par l’utilisateur. `user_metadata.display_name` sert uniquement à l’affichage si le profil n’a pas de nom.
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

Une ligne PASS/FAIL par étape du parcours de l’application : connexion, session vérifiée, `app_metadata.role`, profil, établissement, affectations, lectures sous RLS, version du schéma, renouvellement, déconnexion, refus anonyme. Aucun mot de passe, jeton ni contenu n’est affiché ; une clé secrète est refusée.

Sessions : cookies HttpOnly, SameSite=Lax, Secure en HTTPS ; `getUser()` côté serveur ; redirections de retour limitées à `/app`.

## Variables d’environnement

| Variable | Portée | Rôle |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production et Preview | Projet Supabase FOCUS ; clé publiable, jamais `service_role` |
| `OPENAI_API_KEY` | Serveur uniquement | Analyse pédagogique ; jamais en `NEXT_PUBLIC_` |
| `FOCUS_AI_MODEL` | Serveur | Modèle d’analyse (défaut `gpt-5.6-terra`) |
| `FOCUS_AI_HOURLY_LIMIT` | Serveur | Appels au modèle par professeur et par heure (défaut 150) |
| `FOCUS_AI_REASONING_EFFORT` | Serveur | `low` (défaut), `medium` ou `high` |
| `FOCUS_SITE_URL` | Serveur, recommandé | Origine HTTPS utilisée dans les liens de réinitialisation ; sinon l’hôte de la requête |
| `FOCUS_DEMO_REQUEST_URL` | Facultatif | Formulaire HTTPS vérifié ; sinon la vitrine indique que les demandes ne sont pas ouvertes |

`SUPABASE_SERVICE_ROLE_KEY` ne sert qu’aux commandes d’administration (`npm run curriculum -- apply|export`, `scripts/admin-invite-teacher.ts`) dans un shell local ; jamais dans Vercel ni dans l’application (un test le vérifie). Redéployer après toute modification des variables `NEXT_PUBLIC_`.

## Programme officiel et catalogue

Le graphe du programme et le catalogue changent uniquement par `curriculum/` et `npm run curriculum`. Voir [curriculum/README.md](./curriculum/README.md), y compris les 15 litiges du document Work qui attendent une décision d’auteur.

## Validation

```bash
npm run typecheck       # next typegen + tsc --noEmit
npm run lint
npm run test            # unitaires, schéma réel (PGlite) avec RLS, parcours, programme, sécurité
npm run build
npm run test:routes     # après build ; vraies routes contre un double Supabase Auth
npm run curriculum:check
npm run test:ai-live    # opt-in : 47 copies synthétiques, vrai modèle, nécessite OPENAI_API_KEY (--reference : auto-test hors ligne)
npm run check:deployment -- https://votre-domaine-focus
```

Les tests de base de données exécutent toutes les migrations sur PostgreSQL (PGlite) avec les rôles `anon`, `authenticated` et `service_role` : ils prouvent le comportement du schéma du dépôt, pas la configuration d’un projet Supabase réel. `check:deployment` ne fait que des lectures anonymes.

### Vérification d’une Preview

Pour chaque déploiement Vercel, le workflow **FOCUS Preview verification** (`.github/workflows/preview-verify.yml`) lit `/api/health` sur l’URL de **ce** déploiement et publie un statut « FOCUS Preview verified (…) » sur le commit :

- `VERIFIED` : le déploiement exécute exactement ce commit ; Supabase est configuré et joignable, le schéma est à jour (`focus_schema_version()` ≥ la version requise par le code), la clé OpenAI est présente et le modèle accessible ;
- `NOT READY` : bon commit, mais l’un de ces éléments manque (le détail est dans le résumé du job) ;
- `UNVERIFIED` : rien n’est prouvé (protection Vercel, autre commit, URL injoignable). Avec Vercel Authentication, créer un secret « Protection Bypass for Automation » et l’enregistrer comme secret GitHub `VERCEL_AUTOMATION_BYPASS_SECRET`.

`/api/health` n’existe pas en production et ne renvoie que des booléens, des versions, le nom du modèle et le commit — jamais une valeur de variable. À la main : `node scripts/verify-preview.mjs <url> <sha>`.

Ce statut prouve la configuration, pas le parcours : la connexion réelle et l’analyse d’une copie restent à tester sur la Preview.

## Limites connues

- Mot de passe oublié et invitation testés contre le double Supabase local, pas encore avec les modèles d’e-mail d’un vrai projet ; pas d’inscription libre. Pas d’import depuis PRONOTE, ÉcoleDirecte ou l’ENT.
- L’analyse IA couvre les mathématiques de Seconde ; sa qualité n’est pas mesurée (revue en aveugle à faire).
- Le catalogue (erreurs types, remédiations) est une proposition éditoriale FOCUS, validée par aucun enseignant ; 15 litiges du programme attendent leur auteur.
- La mesure de l’effet des remédiations n’est pas implémentée.
- Aucune conformité RGPD n’est revendiquée : hébergement, durée de conservation, registre et analyse d’impact restent à établir avec l’établissement.

Historique des audits : [AUDIT_2026-09-11.md](./docs/history/AUDIT_2026-09-11.md), [AUDIT_2026-09-13.md](./docs/history/AUDIT_2026-09-13.md), [DESIGN_AUDIT.md](./docs/history/DESIGN_AUDIT.md).
