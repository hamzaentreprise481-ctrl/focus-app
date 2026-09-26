# Supabase — état et mise en service (26 septembre 2026)

Projet : FOCUS (`wznqeofsvbutbvbyxfab`). Tout autre projet Supabase du compte
est hors périmètre.

## État du projet live (lecture seule, 26 septembre)

- Migrations appliquées jusqu’à `20260925214642_supersede_edited_analysis_runs`.
  Le dépôt reproduit ce schéma à l’identique (`tests/schema-live.test.ts`).
- Données fictives uniquement : 1 établissement, 1 classe (Seconde 3),
  31 élèves, 5 évaluations, 44 nœuds et 68 relations du programme ; aucune
  question, copie ni analyse (les reprises de données des migrations sont donc
  sans effet sur ce projet).
- Advisors : sécurité — six fonctions d’autorisation SECURITY DEFINER
  exécutables par `anon` et `authenticated`, protection des mots de passe
  divulgués désactivée ; performance — 40 policies réévaluant `auth.uid()` par
  ligne, 21 clés étrangères sans index. Aucune table sans RLS.

## Migrations à appliquer (dans l’ordre)

`20260926120000` → `20260926190000` (liste et contenu dans le README). Elles
ont été exécutées ensemble sur PostgreSQL (PGlite) avec les rôles Supabase et
toute la suite de tests ; la migration du programme a été rejouée sur une
réplique des identifiants live : 44 UUID conservés, 55 nœuds ajoutés, aucune
désactivation, deuxième exécution sans effet.

La dernière (`…190000_security_performance_hardening`) corrige les constats
des advisors sauf deux, qui relèvent de choix assumés ou du tableau de bord :

- les fonctions d’autorisation restent exécutables par `authenticated` : les
  policies en ont besoin et elles ne renseignent que sur l’utilisateur courant ;
- la protection des mots de passe divulgués s’active dans Auth → Providers →
  Email (réglage du tableau de bord, pas une migration).

## Procédure recommandée

1. Créer une branche Supabase (ou une copie) du projet ; y appliquer les
   migrations dans l’ordre ; relancer les advisors.
2. Pointer une Preview Vercel sur cette branche (URL et clé publiable) ; y
   définir `OPENAI_API_KEY` ; tester le parcours professeur complet.
3. Seulement ensuite, avec l’accord du propriétaire, appliquer les mêmes
   migrations au projet live, puis vérifier `supabase_migrations` et les advisors.

Le compte professeur du propriétaire n’a jamais été utilisé pour se connecter
depuis cet environnement : un mot de passe connu est nécessaire pour le test
réel.
