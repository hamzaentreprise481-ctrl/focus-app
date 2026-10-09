# Connexion Teacher V1 — état de release au 7 octobre 2026

Ce document décrit l’état vérifié du parcours d’authentification de FOCUS Teacher sur le projet Supabase `wznqeofsvbutbvbyxfab` et le projet Vercel `focus-app-nhkt`.

## État vérifié

- Supabase Auth est le fournisseur d’identité.
- L’application appelle `getUser()` côté serveur puis exige une appartenance `school_memberships` active avec `role = teacher`.
- `app_metadata` et `user_metadata` ne sont pas des sources d’autorisation.
- Au 7 octobre, la base contient 3 appartenances Teacher actives et 2 comptes Teacher ont déjà une date de connexion Supabase ; le parcours de connexion n’est donc plus seulement simulé.
- Les sessions applicatives utilisent des cookies HttpOnly, Secure en HTTPS et SameSite=Lax.
- Chaque page et Server Action privée appelle `requireTeacher()`; RLS et les fonctions `focus_*` restent la frontière de données.
- Le projet Vercel canonique est `focus-app-nhkt`. Le projet Vercel doublon a été supprimé.
- La base live est migrée jusqu’à `20261004090000`.
- La Preview de release vérifie le commit déployé, Supabase, la version de schéma, l’accès à `gpt-6-astra` et la présence de la clé de signature.

## Provisionnement d’un professeur

Le provisionnement est administrateur uniquement :

1. créer ou inviter le compte Supabase Auth ;
2. créer le profil si nécessaire ;
3. créer une ligne `school_memberships` active avec `role = teacher` ;
4. créer les `teacher_assignments` classe + matière nécessaires.

Le script `scripts/admin-invite-teacher.ts` garde le mode dry-run par défaut et exige `--commit` pour écrire. Aucune inscription Teacher publique n’est disponible.

## Parcours de mot de passe

FOCUS fournit :

- `/connexion` pour la connexion ;
- `/connexion/mot-de-passe-oublie` pour demander un lien ;
- `/auth/confirm` pour vérifier côté serveur le `token_hash` Supabase ;
- `/connexion/nouveau-mot-de-passe` pour définir le nouveau mot de passe.

La réponse de demande de réinitialisation ne révèle pas si une adresse existe. Un compte authentifié sans appartenance Teacher active reste refusé.

Configuration attendue dans Supabase Auth :

- Site URL : domaine FOCUS utilisé ;
- Redirect URL : `https://<domaine>/auth/confirm` ;
- Reset Password : `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` ;
- Invite user : `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`.

## Vérification automatique

Depuis un environnement autorisé :

```bash
FOCUS_CHECK_EMAIL=<teacher> FOCUS_CHECK_PASSWORD=<password> \
FOCUS_CHECK_SUPABASE_URL=https://wznqeofsvbutbvbyxfab.supabase.co \
FOCUS_CHECK_SUPABASE_KEY=<publishable-key> \
FOCUS_CHECK_APP_URL=https://focus-app-nhkt.vercel.app \
npm run check:login -- --project-ref wznqeofsvbutbvbyxfab
```

Le contrôle doit vérifier : authentification Supabase, session vérifiée, membership Teacher actif, profil, établissement, affectations, lectures RLS, version du schéma, cookie HttpOnly, pages privées, rechargement, déconnexion et refus anonyme.

## Durcissement restant côté plateforme

Le Security Advisor Supabase signale encore **Leaked Password Protection Disabled**. Ce réglage doit être activé dans le tableau de bord Supabase Auth avant l’ouverture à un pilote avec des comptes externes. Il s’agit d’un réglage de plateforme, pas d’un contournement dans le code FOCUS.
