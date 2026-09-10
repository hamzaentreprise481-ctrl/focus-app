# FOCUS Teacher

FOCUS complète les outils de vie scolaire avec un espace de suivi pédagogique pour les enseignants. Ce dépôt contient **FOCUS Teacher** et sa vitrine publique. FOCUS Student et FOCUS Parent sont prévus dans des projets distincts.

**État réel :** authentification professeur implémentée, parcours pédagogique en démonstration sur une classe fictive. Aucune donnée réelle d’élève ne doit être saisie. Ce n’est pas encore un service prêt pour une utilisation scolaire réelle.

Lire [FOCUS_PRODUCT.md](./FOCUS_PRODUCT.md) avant toute modification, puis [AGENTS.md](./AGENTS.md). Claude Code charge ces deux références via [CLAUDE.md](./CLAUDE.md).

## Développement

Node.js 20.9+ ; versions de dépendances et lockfile dans le dépôt.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Sans variables Auth, la vitrine fonctionne et toutes les routes professeur refusent l’accès. La connexion affiche un état de préparation, sans simuler une session.

## Routes et limites entre espaces

| Espace            | Routes                                                                       | Implémentation                                                                  |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Public            | `/`                                                                          | `app/(marketing)` ; preview exclusivement issue de `lib/demo/marketing-data.ts` |
| Connexion         | `/connexion`                                                                 | `app/(auth)` ; actions de connexion/déconnexion côté serveur                    |
| Professeur privé  | `/app`, `/app/classes`, `/app/eleves`, `/app/evaluations`, `/app/parametres` | `app/(teacher)/app` ; `requireTeacher()` sur chaque page et dans le layout      |
| Liens historiques | `/classes/*`, `/eleves/*`, `/evaluations/*`, `/parametres/*`, `/decouvrir`   | Redirections permanentes définies dans `next.config.ts`                         |

Le Proxy actualise les cookies et contrôle les requêtes privées. La protection est répétée dans les pages ; chaque futur accès à des données et chaque mutation devra vérifier à nouveau l’utilisateur et ses droits sur la ressource. Il n’existe pas de contournement public de l’authentification.

## Configuration extérieure nécessaire

Utiliser un projet Supabase réservé à FOCUS. Ne jamais réutiliser les ressources d’un autre produit.

1. Dans Supabase Auth, activer la connexion e-mail/mot de passe et désactiver les inscriptions publiques et les connexions anonymes.
2. Créer/administrer les comptes professeurs via les outils d’administration sécurisés de Supabase. Les comptes doivent avoir une adresse confirmée et un mot de passe défini. Il n’existe pas encore de parcours d’acceptation d’invitation ou de réinitialisation autonome dans FOCUS.
3. Affecter **côté administrateur** `app_metadata: { "role": "teacher" }` via l’Admin API. Ne pas mettre le rôle dans `user_metadata` : cette valeur est modifiable par l’utilisateur. Les utilisateurs sans ce rôle, parents, élèves et comptes anonymes sont refusés. Le champ facultatif `user_metadata.display_name` sert uniquement à l’affichage.
4. Définir `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` dans `.env.local` et dans l’environnement **Preview** du projet Vercel FOCUS. La clé est la clé publiable, jamais `service_role` ou une secret key. Les opérations administratives ne s’exécutent pas dans cette application.
5. Vérifier les limites de tentatives Auth et les réglages d’e-mail du projet. Tester un vrai compte professeur, un compte sans autorisation, l’expiration, la déconnexion et les erreurs réseau avant un pilote.
6. Facultatif : `FOCUS_DEMO_REQUEST_URL` doit désigner un formulaire/contact HTTPS vérifié et suivi. Sans valeur, le site indique que les demandes ne sont pas encore ouvertes et propose son aperçu ; il ne collecte ni n’envoie de demandes.
7. Redéployer **la Preview** après modification des variables. Ne pas publier en production ni fusionner la PR sans instruction explicite.

Sessions persistantes via cookies HttpOnly, SameSite=Lax, Secure en HTTPS/Vercel. Le serveur vérifie l’identité et le rôle à jour avec `getUser()`. Les redirections de retour sont restreintes à `/app`. L’inscription et la récupération de mot de passe sont administrées hors application pour cette version.

Documentation fournisseur : [clients SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [administration des utilisateurs](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).

## Données et analyses

- `lib/data/` : 31 élèves fictifs, 5 évaluations, 8 compétences, une classe de mathématiques.
- `lib/analysis.ts` : règles existantes, transparentes et prudentes. Aucune IA distante. Les scores globaux et les compétences sont distincts ; aucune compétence n’est silencieusement inférée d’une note. Pas de règle universelle « note < 10 = difficulté ».
- `lib/demo-data-context.tsx`, `lib/demo-store.ts` : ajouts d’évaluations dans le navigateur, avec clé par identifiant professeur. Pas de synchronisation, de chiffrement ni de véritable isolation multiétablissement. Le stockage historique `focus-demo-overlay-v1` reste intact mais n’est pas repris automatiquement, car son propriétaire n’est pas identifié.
- L’accompagnement reste simulé. La mesure de l’effet des interventions et les intégrations PRONOTE/ÉcoleDirecte/ENT ne sont pas implémentées.
- Les fixtures métier sont encore dans les bundles client. Avant de brancher des données réelles, les remplacer par des lectures serveur autorisées, avec contrôle de propriété/établissement sur chaque ressource et règles de base de données appropriées.

Aucune conformité RGPD ni isolation des établissements n’est revendiquée. Le stockage métier sécurisé, les droits sur les données, les règles de conservation/suppression et les vérifications opérationnelles restent nécessaires.

## Validation

```bash
npm run typecheck       # next typegen + tsc --noEmit
npm run lint            # ESLint
npm run test            # tests réels : analyse, rôle, redirects, frontière des imports
npm run build           # production build, sans déploiement
npm run test:routes     # après build ; lance un serveur local et un double Auth HTTP
```

`test:routes` réserve les ports locaux 3100 et 3101. Il exécute les vraies routes et Server Actions contre un double du protocole Supabase : refus sans session, cookies falsifiés, rôle révoqué, connexion, persistance, renouvellement et déconnexion. Il ne vérifie pas les paramètres d’un véritable projet Supabase.

Le rapport [DESIGN_AUDIT.md](./DESIGN_AUDIT.md) distingue les validations réalisées de celles encore bloquées. La mention historique « pnpm test passed » de la première version de PR #1 était inexacte : aucun script test n’existait à ce commit. Les scripts et tests ci-dessus ont été ajoutés dans cette révision.

## Git / Preview

Dépôt existant uniquement : `hamzaentreprise481-ctrl/focus-app`.
PR de travail : [#1](https://github.com/hamzaentreprise481-ctrl/focus-app/pull/1).
Branche : `codex/effectuer-un-audit-visuel-de-focus`.
Les pushes sur cette branche doivent produire une Vercel Preview via l’intégration existante. Vérifier le statut lié au commit exact. Ne pas fusionner dans `main`, déployer en production, ni toucher à un autre projet.
