# Mise à jour de la base live — plan, preuves et retour arrière (9 octobre 2026)

**Rien de ce document n’a été appliqué.** Le projet Supabase `focus-app`
(`wznqeofsvbutbvbyxfab`) est le seul projet FOCUS de l’organisation : la
Preview **et** la production Vercel l’utilisent. Le propriétaire décide.

## 1. État mesuré (lecture seule)

| Point | Mesure |
| --- | --- |
| Dernière migration appliquée | `20261004090000_engine_signed_analyses` |
| Migrations du dépôt manquantes | `20261007090000_active_teacher_membership`, `20261007130000_scan_import_storage`, `20261009120000_transcription_provenance_question_outcomes` |
| Dérive du schéma | **Aucune** : `scripts/schema-fingerprint-total.sql` donne sur le live `n=191, total=f2efd71a41dbcfe224d29d81a8f5c352`, identique aux migrations du dépôt jusqu’à `20261004090000` (`tests/live-upgrade-rehearsal.test.ts`) |
| Données | Fictives : 1 établissement, 1 classe, 35 comptes (1 admin, 3 professeurs, 31 élèves), 5 évaluations ; aucune question, copie ni analyse. Empreinte table par table : `supabase/staging/live-checksums-20261009.txt` |
| Professeurs | Les 3 affectations ont une adhésion professeur **active** : `20261007090000` ne coupe l’accès de personne |
| Clé du moteur | Installée en base (`focus_private.engine_keys`, 1 ligne) ; la Preview déclare la sienne (`signingKeyConfigured: true`). L’égalité des deux ne peut être prouvée que par une analyse réelle |
| Bucket des scans | Absent (`storage.buckets` vide) |
| Branches Supabase | Aucune ; plan gratuit : pas de branche, et 2 projets actifs (dont Metrik, hors périmètre) |

## 2. Répétition isolée (faite)

Sur une base PostgreSQL (PGlite) reconstruite à partir des migrations du
dépôt, prouvée identique au live objet par objet, avec des données écrites
par les **anciennes** fonctions (évaluation, questions, copies saisies, une
analyse signée par l’ancien serveur, une décision du professeur) :

- les trois migrations s’appliquent dans l’ordre ;
- `supabase/staging/data-checksums.sql` donne **exactement** les mêmes lignes
  avant et après : aucune donnée perdue ni modifiée ;
- les lignes existantes reçoivent les bons défauts (`source = manual`,
  `legibility = null`, `transcription_verified = true`,
  `question_outcomes = []`) ;
- le professeur lit toujours copies, analyse et décision sous RLS ;
- une analyse signée par le serveur **actuellement en production**
  (`621f779`, sans issues par question) est encore enregistrée : la
  production continue de fonctionner tant qu’elle n’est pas promue ;
- les trois retours arrière, dans l’ordre inverse, rendent **exactement** le
  schéma live (même empreinte) avec les mêmes données ; les migrations se
  réappliquent ensuite.

Non couvert par la répétition : les trois politiques sur `storage.objects`
(PGlite n’a pas de Storage). Sur Supabase, `postgres` n’est pas membre du
propriétaire de `storage.objects` ; la documentation Supabase crée pourtant
ces politiques en SQL. Si la création échoue, la migration entière est
annulée (transaction) : rien n’est appliqué à moitié ; on crée alors les
trois politiques depuis Dashboard → Storage → Policies et on relance.

## 3. Application (après accord explicite)

Ordre imposé : sauvegarde → migrations → bucket → vérifications → Preview.

```bash
# 0. Sauvegarde (le plan gratuit n’offre pas de restauration à un instant donné)
supabase link --project-ref wznqeofsvbutbvbyxfab
supabase db dump -f focus-live-schema-20261009.sql
supabase db dump --data-only -f focus-live-data-20261009.sql

# 1. Les trois migrations, avec les versions du dépôt
supabase db push --dry-run     # doit lister exactement les 3 migrations ci-dessus
supabase db push
supabase migration list        # doit finir par 20261009120000
```

(Variante sans CLI : Claude les applique une par une par le connecteur
Supabase, puis vérifie que l’historique porte exactement les versions du
dépôt.)

```bash
# 2. Bucket privé des scans (PDF seulement, 50 Mo), shell administrateur
SUPABASE_URL=https://wznqeofsvbutbvbyxfab.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<clé service_role, jamais dans Vercel> \
npm run setup:scan-storage            # simulation
npm run setup:scan-storage -- --commit
```

ou, à la main : Dashboard → Storage → New bucket `focus-scan-imports`,
privé, taille max 50 Mo, type `application/pdf`.

## 4. Vérifications après application

1. `supabase/staging/data-checksums.sql` → **identique** à
   `supabase/staging/live-checksums-20261009.txt` (si personne n’a écrit
   entre-temps).
2. `scripts/schema-fingerprint-total.sql` en excluant les lignes
   `storage policy` → `n=195, total=52e3df8798159edf0dd39160177e2324`
   (valeur d’une base migrée de zéro), et 3 politiques
   `focus_scan_imports_*` sur `storage.objects`.
3. `supabase/staging/verify.sql` → `FOCUS staging verification: OK`.
4. `supabase/staging/rls-probe.sql` (tout est annulé à la fin) : élève et
   professeur d’une autre matière à 0, écritures refusées.
5. Advisors Supabase (sécurité, performance) : rien de nouveau.
6. Relancer la vérification de la Preview : `schemaUpToDate: true`. Elle ne
   sera **VERIFIED** que lorsque le crédit OpenAI sera rechargé.

## 5. Retour arrière

Dans l’ordre inverse, chacun dans une transaction :

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollback/20261009120000_transcription_provenance_question_outcomes.down.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollback/20261007130000_scan_import_storage.down.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollback/20261007090000_active_teacher_membership.down.sql
supabase migration repair --status reverted 20261009120000 20261007130000 20261007090000
```

Effet : schéma identique au live du 9 octobre (prouvé en répétition). Perdu :
la provenance des réponses importées par scan et les issues par question
enregistrées depuis (aucune aujourd’hui). Le bucket, s’il a été créé, reste
(il est vide et privé) ; le supprimer depuis le Dashboard si besoin.
