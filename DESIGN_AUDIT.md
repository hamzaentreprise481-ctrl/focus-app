# Audit visuel FOCUS — septembre 2026

## Périmètre observé

L'audit couvre le tableau de bord, la navigation latérale, les listes de classes et d'élèves, le profil élève, les évaluations et leur formulaire de saisie, ainsi que les états vides et de confirmation présents dans la démonstration. Les vues ont été examinées dans le code et via le serveur de développement aux largeurs desktop, tablette et mobile.

## Points solides conservés

- IBM Plex Sans est une base typographique crédible et lisible pour un outil institutionnel.
- La palette existante est déjà contenue, avec des statuts désaturés plutôt que des aplats alarmistes.
- Les composants de bouton, champ, carte, badge et dialogue forment une bonne base réutilisable.
- Les tableaux sont compacts, les libellés de formulaire explicites et les états vides sont rédigés avec sobriété.
- Les analyses prennent soin d'indiquer leurs limites et de préserver la décision de l'enseignant.

## Problèmes identifiés

- Il n'existait aucune page publique permettant à un décideur de comprendre le positionnement, le fonctionnement ou les garanties de FOCUS.
- La navigation du produit ne proposait aucun accès à une présentation claire de la plateforme.
- La liste de classe donnait le même poids visuel à la moyenne, à la trajectoire et au signal pédagogique, alors que le niveau de preuve n'était pas visible dans la vue de scan.
- Les en-têtes de tableaux n'étaient pas persistants et devenaient difficiles à rattacher aux lignes sur les listes longues.
- Le fond, les bordures et le bleu de marque manquaient légèrement de contraste structurel entre navigation, contenu et surfaces.
- La plupart des écrans reposent sur des cartes de même poids. Le profil élève est fonctionnel, mais gagnerait encore à regrouper chronologie, interventions et mesure d'effet dans une hiérarchie longitudinale plus affirmée.
- Aucun état de chargement ou d'erreur dédié n'est présent. Cela reste acceptable avec les données locales instantanées, mais devra être traité avant une connexion à des services distants.
- Sur téléphone, l'application enseignante reste utilisable grâce au rail compact et aux tableaux défilants, mais elle est volontairement optimisée pour tablette et ordinateur.

## Décisions de conception

- La nouvelle présentation publique est isolée sous `/decouvrir`, avec sa propre navigation et ses styles locaux.
- Le langage visuel utilise un bleu encre, des neutres froids, des bordures fines, des rayons contenus et très peu d'effets.
- L'aperçu produit reprend les concepts et libellés réellement présents dans l'application ; il ne présente ni logo client, ni témoignage, ni fonctionnalité inventée.
- Les fonctionnalités élève non disponibles sont explicitement signalées « en développement ».
- Les formulations de confiance restent prudentes : orientation RGPD plutôt que conformité revendiquée, décision humaine et limites visibles.
