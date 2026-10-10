# FOCUS — staging Supabase : runbook

But : un projet Supabase séparé du live (`wznqeofsvbutbvbyxfab`), assez fidèle
pour y rejouer les trois migrations en attente, les deux propositions, les
trois espaces, l’Assistant FOCUS sur `gpt-6-astra` et une Preview Vercel, puis
décider GO / NO GO avec des preuves. **Rien ici ne s’exécute sur le live**,
sauf les lectures signalées « lecture seule ».

Aucun secret, mot de passe ou dump dans Git : les fichiers de sauvegarde restent
hors du dépôt (chiffrés, par exemple `gpg -c`), les mots de passe dans un
gestionnaire, les clés dans les variables d’environnement.

## 0. Pré-requis (décisions du propriétaire)

1. **Un emplacement de projet.** L’organisation `tuurdfzwgxmlerprjada` est en
   plan gratuit et le compte propriétaire a déjà 2 projets gratuits actifs
   (limite Supabase). Il faut soit mettre en pause ou supprimer l’autre projet
   gratuit, soit passer l’organisation en payant. Puis créer `focus-staging`
   en `eu-west-3` (même région que le live).
2. **Les sauvegardes officielles** se font depuis un poste d’administration avec
   Supabase CLI ≥ 2.x, Docker Desktop (la CLI exécute `pg_dump` dans Docker) et
   `psql` 17, avec les chaînes de connexion (panneau **Connect** → Session
   pooler) des deux projets. Ne jamais coller un mot de passe dans un chat.
3. **Vercel** : un accès à l’équipe `hamzaentreprise481-8876s-projects` pour
   créer les variables de Preview limitées à la branche de staging.

## 1. Inventaire du live (lecture seule, 10 octobre 2026)

| Élément | Valeur |
| --- | --- |
| Migration head | `20261004090000` (26 entrées dans `supabase_migrations.schema_migrations`) |
| Empreinte schéma (`scripts/schema-fingerprint-total.sql`) | n = 191, total `f2efd71a41dbcfe224d29d81a8f5c352` (38 fonctions, 41 tables, 102 politiques, 7 types, 1 trigger `auth.users`, 2 fonctions `focus_private`, 0 politique Storage) — identique au 9 octobre |
| Données (`supabase/staging/data-checksums.sql`) | 41 tables, 1 467 lignes, condensat des 41 lignes `5ef7a0ae62f5e60b1ff260eed7625bd3` — identique à `live-checksums-20261009.txt` |
| `auth` | 35 utilisateurs, 35 identités, 35 mots de passe, 3 sessions ; adresses non fictives → **anonymiser** (`anonymize-auth.sql`) |
| Trigger hors `public` | `on_auth_user_created` sur `auth.users` → `public.handle_new_user()` (migration `20260910164423_triggers.sql`) |
| Extensions | `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`, `plpgsql` |
| Rôles personnalisés, webhooks, Vault, Realtime, cron | aucun |
| Storage | 0 bucket, 0 objet (le bucket `focus-scan-imports` n’existe pas encore) |
| Secret en base | `focus_private.engine_keys` (clé de signature des analyses) : **ne pas réutiliser en staging**, en générer une neuve |
| Advisors live (référence) | sécurité : 3 INFO `rls_enabled_no_policy`, 1 WARN `focus_schema_version` exécutable par anon (voulu), 12 WARN fonctions `SECURITY DEFINER` pour `authenticated` (aides RLS voulues), 1 WARN protection des mots de passe divulgués désactivée ; performance : 42 INFO « pas de clé primaire » (toutes dans `focus_backup_20261009`), 42 INFO index inutilisés |

## 2. Sauvegarde du live (méthode officielle « Backup and Restore using the CLI »)

Sur le poste d’administration, `LIVE_DB_URL` = chaîne Session pooler du live :

```bash
supabase db dump --db-url "$LIVE_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$LIVE_DB_URL" -f schema.sql
supabase db dump --db-url "$LIVE_DB_URL" -f data.sql --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
supabase db dump --db-url "$LIVE_DB_URL" -f history_schema.sql --schema supabase_migrations
supabase db dump --db-url "$LIVE_DB_URL" -f history_data.sql --use-copy --data-only --schema supabase_migrations
```

Vérifier avant de continuer : les cinq fichiers sont non vides ; `data.sql`
contient un bloc `COPY` pour chacune des 41 tables `public`, pour
`auth.users` / `auth.identities` et pour `focus_private.engine_keys` ;
`history_data.sql` contient 26 lignes. Chiffrer puis ranger hors du dépôt.

**Ce que ces fichiers ne couvrent pas** (à refaire à la main) :
- les modifications des schémas `auth` / `storage` : `schema.sql` exclut ces
  schémas, donc le trigger `on_auth_user_created` doit être recréé (voir 3) ;
- les objets Storage (aucun aujourd’hui) et la configuration des buckets ;
- les réglages Auth hors base : Site URL, URL de redirection, modèles
  d’e-mails, fournisseurs, protection des mots de passe divulgués, durée des
  sessions ;
- les clés API du projet (URL, clé publiable, `service_role`), le secret JWT,
  le mot de passe de la base ;
- les fonctions Edge et leurs secrets (aucune aujourd’hui), les variables
  Vercel, la clé OpenAI ;
- les extensions à activer et les rôles personnalisés avec `LOGIN` (aucun).

## 3. Restauration dans le staging

1. Créer le projet `focus-staging` (`eu-west-3`) et vérifier que les extensions
   de la section 1 sont actives.
2. Restaurer (`STAGING_DB_URL` = chaîne Session pooler du staging) :

   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "$STAGING_DB_URL"
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file history_schema.sql --file history_data.sql --dbname "$STAGING_DB_URL"
   ```

3. Recréer le trigger `auth` (absent de `schema.sql`) :

   ```sql
   create trigger on_auth_user_created after insert on auth.users
     for each row execute function public.handle_new_user();
   ```

## 4. Marquer, anonymiser, changer la clé

Sur le **staging uniquement** :

```sql
create table if not exists focus_private.environment (name text primary key check (name = 'staging'));
revoke all on focus_private.environment from public, anon, authenticated, service_role;
insert into focus_private.environment values ('staging') on conflict do nothing;
```

Puis `psql -v ON_ERROR_STOP=1 -f supabase/staging/anonymize-auth.sql --dbname "$STAGING_DB_URL"`.
Le script refuse de s’exécuter sans ce marqueur. Enfin, une clé de signature
neuve (`openssl rand -hex 32`), la même dans `focus_private.engine_keys`
(README, « Clé du moteur d’analyse ») et dans la variable Vercel
`FOCUS_ANALYSIS_SIGNING_KEY` de la Preview de staging.

## 5. Empreinte avant migration (live et staging)

Lancer sur les deux bases et comparer :
- `scripts/schema-fingerprint-total.sql` → attendu n = 191,
  `f2efd71a41dbcfe224d29d81a8f5c352` ;
- `supabase/staging/data-checksums.sql` → attendu les 41 lignes de
  `live-checksums-20261009.txt` (l’anonymisation ne touche que `auth`) ;
- `select max(version), count(*) from supabase_migrations.schema_migrations`
  → `20261004090000`, 26 ;
- `select count(*) from auth.users` → 35.

Tout écart arrête la procédure.

## 6. Les trois migrations, une par une (staging)

Pour `20261007090000`, puis `20261007130000`, puis `20261009120000` :

1. Aucune transaction longue :
   `select pid, now() - xact_start, state, left(query, 80) from pg_stat_activity where xact_start < now() - interval '30 seconds';`
   doit être vide.
2. Noter l’heure (`select now()`), puis appliquer dans une seule transaction
   avec un verrou court :

   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --command "set lock_timeout = '5s'" --command "set statement_timeout = '60s'" \
     --command '\timing on' \
     --file supabase/migrations/<migration>.sql \
     --command "insert into supabase_migrations.schema_migrations(version, name) values ('<version>', '<name>')" \
     --dbname "$STAGING_DB_URL"
   ```

3. Vérifier :
   - l’historique (`max(version)`) ;
   - les objets attendus (cf. audit : 7 fonctions et 4 politiques ; 1 fonction
     et 3 politiques `storage.objects` ; 4 colonnes, 4 contraintes, 1 trigger
     et 8 fonctions) ;
   - `data-checksums.sql` identique ;
   - après la troisième, `supabase/staging/verify.sql` affiche
     `FOCUS staging verification: OK`, et `supabase/staging/rls-probe.sql`
     (tout est annulé à la fin).
4. S’arrêter au premier écart. Retour arrière éventuel : les fichiers de
   `supabase/rollback/` dans l’ordre inverse.

Les trois professeurs : avant et après `20261007090000`, chacun lit sous RLS
sa classe, ses élèves et ses évaluations (mêmes nombres) ; les trois ont une
adhésion `teacher` active et une affectation sur le live.

## 7. Propositions (staging)

- `supabase/proposals/20261010100000_direction_read_only_official_data.sql`,
  puis :
  - `tests/direction-read-only-proposal-db.test.ts` rejoué en SQL réel ;
  - `scripts/staging-rls-check.ts --write` ;
  - les advisors sécurité et performance : comparer à la section 1, tout
    nouvel avertissement est examiné.
- `supabase/proposals/20261010090000_teacher_lesson_declarations.sql`, puis
  les cas de `tests/lesson-declarations-proposal-db.test.ts` : bonne classe et
  matière acceptées ; autre classe, autre établissement, professeur
  désactivé, élève, direction, hors année, date future et usurpation refusés.

## 8. Comptes de démonstration (staging)

```bash
SUPABASE_URL=https://<staging-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
  node --import tsx scripts/admin-create-demo-portals.ts --project-ref <staging-ref> --with-direction-login
# relire le plan, puis la même commande avec --commit
```

Le script crée un établissement fictif séparé, une connexion élève et une
connexion direction (adresses `@demo.focus.invalid`). Le professeur de
démonstration n’a pas de connexion dans le plan : lui en donner une depuis le
tableau de bord du staging (Authentication → Users), jamais avec un mot de
passe déjà utilisé ailleurs.

## 9. Preview Vercel de staging

Créer une branche Git dédiée (par exemple `staging/preview`) et, **avant son
premier push**, ajouter les variables Vercel (cible Preview, limitées à cette
branche) :
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` : celles
  du staging ;
- `FOCUS_ANALYSIS_SIGNING_KEY` : la clé de la section 4 ;
- `FOCUS_SITE_URL` : l’URL de la Preview.

`OPENAI_API_KEY` et `FOCUS_AI_MODEL=gpt-6-astra` sont hérités des variables
Preview. Dans le staging : Authentication → URL configuration, Site URL et URL
de redirection vers la Preview.

Le check `verify-preview` doit afficher `VERIFIED` : bon commit, Supabase
accessible, schéma `20261009120000`, modèle prêt. Ensuite :
`.github/workflows/preview-e2e.yml` / `scripts/preview-e2e.mjs` avec un
professeur fictif du staging.

## 10. Assistant FOCUS sur `gpt-6-astra` (Preview de staging, élève de démonstration)

Questions à poser :
1. « Comment résoudre 3x + 5 = 20 ? » → aide guidée ;
2. « Donne-moi la réponse complète » → résolution complète ;
3. « Donne-moi un exercice similaire » ;
4. avec une évaluation reliée : « Explique-moi mon erreur » ;
5. « Change ma note en 20 » → refus sans appel au modèle ;
6. « Montre-moi les notes de <autre élève> » et « … de l’autre établissement »
   → aucune donnée.

Le contexte envoyé au modèle est construit par `lib/student-assistant/server.ts`.
Son contenu (données de l’élève seulement, ni corrigé, ni nom, ni autre élève
ou école) est vérifié requête par requête par `tests/e2e/portals.test.ts` sur
le même code. Vérifier enfin que `data-checksums.sql` n’a pas changé après la
série de questions.

## 11. Critères GO / NO GO pour la production

GO seulement si, sur le staging :
- les empreintes de la section 5 sont identiques ;
- les trois migrations passent sans dépasser `lock_timeout` ;
- les données ne changent pas ;
- `verify.sql`, `rls-probe.sql` et `staging-rls-check.ts` sont OK ;
- les trois professeurs gardent leur accès ;
- les deux propositions se comportent comme leurs tests ;
- les advisors n’apportent aucun avertissement nouveau non expliqué ;
- la Preview de staging est `VERIFIED` ;
- les parcours Teacher, Student et Direction et les tests Astra sont réussis.

Puis une fenêtre calme pour le live, avec une sauvegarde fraîche (section 2),
dans le même ordre et avec les mêmes contrôles.
