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
| Connexion         | `/connexion`                                                                 | `app/(auth)` ; actions de connexion/déconnexion côté serveur                    |
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

Le code de cette branche a besoin de ces migrations. Sans elles, l’application l’indique explicitement (« La base de données n’est pas à jour… ») au lieu d’échouer silencieusement. Les appliquer **dans l’ordre**, d’abord sur une branche Supabase ou une copie, puis relancer les advisors et le parcours professeur. Ne rien appliquer en production sans l’accord du propriétaire.

## Configuration Supabase Auth

Utiliser le projet Supabase réservé à FOCUS ; ne jamais réutiliser les ressources d’un autre produit.

1. Activer la connexion e-mail/mot de passe ; désactiver les inscriptions publiques et les connexions anonymes. Activer la protection contre les mots de passe divulgués (advisor Supabase).
2. Créer les comptes professeurs avec les outils d’administration Supabase (adresse confirmée, mot de passe défini). Il n’existe pas encore de parcours d’invitation ni de réinitialisation dans FOCUS.
3. Affecter **côté administrateur** `app_metadata: { "role": "teacher" }`. Jamais dans `user_metadata`, modifiable par l’utilisateur. `user_metadata.display_name` sert uniquement à l’affichage si le profil n’a pas de nom.
4. Créer l’appartenance à l’établissement et les affectations classe/matière (`school_memberships`, `teacher_assignments`) : un professeur ne voit que ses classes.

Sessions : cookies HttpOnly, SameSite=Lax, Secure en HTTPS ; `getUser()` côté serveur ; redirections de retour limitées à `/app`.

## Variables d’environnement

| Variable | Portée | Rôle |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production et Preview | Projet Supabase FOCUS ; clé publiable, jamais `service_role` |
| `OPENAI_API_KEY` | Serveur uniquement | Analyse pédagogique ; jamais en `NEXT_PUBLIC_` |
| `FOCUS_AI_MODEL` | Serveur | Modèle d’analyse (défaut `gpt-5.6-terra`) |
| `FOCUS_AI_HOURLY_LIMIT` | Serveur | Analyses par professeur et par heure (défaut 150) |
| `FOCUS_DEMO_REQUEST_URL` | Facultatif | Formulaire HTTPS vérifié ; sinon la vitrine indique que les demandes ne sont pas ouvertes |

`SUPABASE_SERVICE_ROLE_KEY` ne sert qu’aux commandes d’administration du programme (`npm run curriculum -- apply|export`) dans un shell local ; jamais dans Vercel ni dans l’application (un test le vérifie). Redéployer après toute modification des variables `NEXT_PUBLIC_`.

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
npm run test:ai-live    # opt-in : vrai modèle, nécessite OPENAI_API_KEY
npm run check:deployment -- https://votre-domaine-focus
```

Les tests de base de données exécutent toutes les migrations sur PostgreSQL (PGlite) avec les rôles `anon`, `authenticated` et `service_role` : ils prouvent le comportement du schéma du dépôt, pas la configuration d’un projet Supabase réel. `check:deployment` ne fait que des lectures anonymes.

## Limites connues

- Pas d’invitation ni de réinitialisation de mot de passe dans l’application ; pas d’import depuis PRONOTE, ÉcoleDirecte ou l’ENT.
- L’analyse IA couvre les mathématiques de Seconde ; sa qualité n’est pas mesurée (revue en aveugle à faire).
- Le catalogue (erreurs types, remédiations) est une proposition éditoriale FOCUS, validée par aucun enseignant ; 15 litiges du programme attendent leur auteur.
- La mesure de l’effet des remédiations n’est pas implémentée.
- Aucune conformité RGPD n’est revendiquée : hébergement, durée de conservation, registre et analyse d’impact restent à établir avec l’établissement.

Historique des audits : [AUDIT_2026-09-11.md](./AUDIT_2026-09-11.md), [AUDIT_2026-09-13.md](./AUDIT_2026-09-13.md), [DESIGN_AUDIT.md](./DESIGN_AUDIT.md).
