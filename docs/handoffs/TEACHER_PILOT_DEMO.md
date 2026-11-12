# FOCUS Teacher V1 — Démonstration de cinq minutes

## Préparer

Utiliser un environnement de démonstration identifié et des copies fictives. Dire au départ : **« Ces copies sont fictives ; nous montrons le parcours. La qualité du modèle et le gain de temps devront être mesurés pendant le pilote. »**

Préparer une classe de mathématiques, une évaluation avec sujet/corrigé et deux hypothèses non décidées. Préparer aussi une deuxième évaluation du même élève mobilisant la même notion : une erreur confirmée puis une réponse sans erreur observée permettent de montrer la continuité sans annoncer une maîtrise acquise.

Le test `teacher-ui-pilot.test.ts` reproduit le parcours avec 31 copies sauvegardées, deux hypothèses, une copie illisible, confirmation/refus, rechargement et deuxième évaluation. Il utilise le modèle scripté existant ; il ne certifie pas un modèle réel. Ne pas injecter ses fixtures dans une production non identifiée comme démonstration.

Avant rendez-vous, vérifier connexion, accès classe, analyses préparées, preuves, fiche élève et export PDF. Ne pas improviser un appel modèle non vérifié pendant les cinq minutes.

## Parcours exact

| Temps | Écran/action | Phrase | Message pour le directeur |
| --- | --- | --- | --- |
| 0:00–0:45 | `/app` : « À traiter », puis « Ouvrir ma classe ». | « Voilà ce qui nécessite mon attention : des copies manquantes, des analyses à lancer et des hypothèses qui attendent ma décision. » | Un travail quotidien organisé. |
| 0:45–1:30 | Classe → évaluation préparée → « Sujet et corrigé ». | « Voici la question, le corrigé et la notion réellement travaillée. » | Contexte pédagogique vérifiable. |
| 1:30–2:15 | `#copies` : choisir l’élève, lire sa réponse et ses points. | « FOCUS ne regarde pas seulement la note. Il travaille sur ce que l’élève a réellement écrit. La V1 demande de saisir les réponses en texte. » | Preuve concrète, coût de saisie explicite. |
| 2:15–3:00 | `#hypotheses` : citation, interprétation, notion, niveau de preuve. | « Il propose cette difficulté parce que l’élève a écrit ceci. Une seule observation donne un niveau de preuve limité. » | Proposition expliquée et contestable. |
| 3:00–3:45 | Confirmer la première, écarter l’autre, ouvrir « Décidées ». | « L’IA propose, le professeur décide. Une proposition refusée reste dans l’historique et ne compte pas comme difficulté confirmée. » | Contrôle du professeur. |
| 3:45–4:30 | « Suivi de l’élève » : observation confirmée et preuve d’origine. | « Ma décision enrichit le suivi. Je retrouve la preuve au lieu d’une simple étiquette. » | Appui pour la prochaine décision. |
| 4:30–5:00 | « Notions suivies dans le temps » : erreur confirmée puis réponse ultérieure sans erreur. | « On suit les observations au fil des évaluations. Cette réponse n’a pas d’erreur observée ; elle ne suffit pas à déclarer la notion maîtrisée. On peut commencer avec un professeur, une classe et une évaluation. » | Suivi longitudinal, pilote limité. |

Le dashboard offre aussi un lien direct vers les hypothèses en attente. Les ancres de l’évaluation et les liens datés du suivi évitent de chercher dans des pages longues.

## Répondre sobrement

| Objection | Réponse |
| --- | --- |
| Pourquoi pas PRONOTE ? | Les notes officielles restent dans les outils de l’établissement. FOCUS relie une réponse, une notion et une observation contrôlée. Pas de synchronisation automatique annoncée en V1. |
| Pourquoi faire confiance ? | Extrait, contexte, niveau de preuve et décision sont visibles. Une copie illisible peut donner « preuves insuffisantes ». Une preuve modifiée remplace l’analyse précédente. |
| Combien de temps gagne-t-on ? | Ce n’est pas mesuré. Comparer la méthode actuelle au temps total de saisie, analyse et validation, erreurs et refus inclus. |
| Peut-on commencer petit ? | Un professeur volontaire, une classe, une évaluation. Première démonstration fictive ; données réelles après validation technique et du cadre pilote. |

## Mesurer le pilote

Relever par évaluation : préparation/saisie, relecture/décision, propositions confirmées/refusées/insuffisantes et possibilité de choisir une action pédagogique utile. Comparer à la méthode actuelle sans annoncer un pourcentage d’économie.

La démo UI est vérifiée en environnement local. Le pilote réel dépend des contrôles staging, migrations, signature moteur, modèle réel et accès Preview transmis à Claude dans [WORK_STATUS.md](WORK_STATUS.md).
