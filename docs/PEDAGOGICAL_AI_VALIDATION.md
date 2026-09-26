# Validation de l’IA pédagogique — état au 26 septembre 2026

Cette note permet de reprendre la validation sans confondre les tests simulés et
une analyse réelle d’une copie sur Vercel. La branche de travail est
`codex/pedagogical-ai-math-v1` ; aucune modification de production n’a été faite
pour cette note.

## Vérifications locales

- `npm run test` exerce les copies fictives avec des sorties de modèle simulées :
  réponse correcte, calcul, raisonnement, prérequis, fonctions, erreur répétée,
  copie partielle, vide et ambiguë, ainsi que preuve ou notion inventée.
- `npm run test:routes` démarre le serveur de production : exécuter
  `npm run build` **avant** cette commande.
- `npm run test:ai-live` est le test opt-in qui envoie les copies fictives au
  véritable modèle si `OPENAI_API_KEY` est présent. Le script emprunte le même
  client Responses API que l’action professeur. Il ne sollicite pas le modèle
  pour une copie entièrement vide, comme le parcours professeur.
- Les preuves textuelles sont contrôlées littéralement. Cela ne valide pas, à
  lui seul, l’exactitude pédagogique d’une explication : une revue humaine
  en aveugle reste nécessaire.

## Ce qui reste à démontrer

La clé `OPENAI_API_KEY` n’est **pas vérifiée** : elle n’est pas disponible dans
l’environnement de cette validation. Le projet Vercel et ses Previews ne sont
pas accessibles via la connexion actuelle : le projet sous le scope
`hamzaentreprise481-8876s-projects` répond avec une erreur d’autorisation 403.
Les anciennes Previews ne prouvent pas l’exécution des derniers commits.

La route Preview `/api/ai-health` contrôle l’accès à un modèle par `GET
/v1/models/{model}`. Un résultat positif sur cette route ne démontre **pas**
que la génération Responses API réussit. Il faut ensuite exécuter la campagne
live avec une clé autorisée, puis tester, sur une Preview correspondant au SHA
de la branche, le parcours professeur authentifié, l’analyse et la
recommandation avec une évaluation fictive. Les identifiants professeur n’ont
pas été essayés dans cette validation ; les tests de routes utilisent des
fournisseurs simulés. Ne placer aucun secret ni aucune vraie copie dans les
fixtures ou les journaux.

## À reprendre après rétablissement des accès

1. Vérifier le SHA de la Preview et réautoriser la connexion Vercel au bon
   scope ; ne pas déployer en production.
2. Exécuter `npm run test:ai-live` dans un environnement disposant de la clé
   et conserver les résultats, cas par cas, avec les échecs et latences.
3. Utiliser un compte professeur de test et des données fictives sur Preview ;
   vérifier connexion → classe → élève → évaluation → analyse → recommandation.
4. Faire annoter en aveugle 20 à 50 réponses fictives ou consenties par un
   professeur, puis comparer erreur, notion, prérequis, faux positifs et
   réponses « preuves insuffisantes ».
