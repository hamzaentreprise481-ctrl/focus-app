# Compte rendu honnête — éléments réels et simulés

Ce document dit précisément ce que montre le film, ce qui existe réellement dans FOCUS aujourd'hui,
et ce qui relève de la mise en scène. Il a été rédigé après inspection complète du code
(`app/`, `components/`, `lib/analysis.ts`, `lib/data/`).

## 1. Ce que FOCUS est aujourd'hui (V0)

- Un **prototype « professeur »** Next.js : tableau de bord, liste de classe, fiche élève, liste et détail
  des évaluations, saisie d'une nouvelle évaluation, fenêtre « Créer un accompagnement ».
- **Données 100 % fictives** : 31 élèves de « Seconde 3 », 5 évaluations, 8 compétences (`lib/data/`).
- **Aucune IA réelle aujourd'hui.** L'analyse (`lib/analysis.ts`) est un ensemble de règles déterministes
  et lisibles : profils (baisse régulière, difficulté persistante, progression récente, note isolée…),
  maîtrise par compétence, niveau de preuve (limitée / modérée / solide), formulations au conditionnel.
  Le code le dit lui-même : « elle ne cherche pas à être une vraie IA ».
- **FOCUS ne lit pas les copies.** Les notes et les niveaux de maîtrise par compétence sont saisis par l'enseignant.

## 2. Ce que montre le film

| Séquence | Statut | Détail |
|---|---|---|
| Copie d'Emma, erreur 3(x + 2) = 3x + 2, note 8/20 (acte I) | **Mise en scène** (motion design) | Copie dessinée en code (papier Seyès, écriture manuscrite police Caveat, traits de stylo rouge animés). La note **8/20 est cohérente avec les données réelles** du prototype : Emma Leroy (élève fictive) a bien 8/20 au « Contrôle — Calcul littéral » (eval-1). |
| Champ de copies notées | **Mise en scène** | Métaphore visuelle « des millions de réponses ». |
| Analyse de l'erreur (arcs de distributivité, « Erreur : distributivité incomplète », « Notion : Calcul littéral · Développement ») — actes II et III | **Visualisation conceptuelle** | **N'existe pas dans le prototype.** Marquée à l'écran « Visualisation conceptuelle ». Les noms de notions sont ceux des compétences réelles de FOCUS. |
| Logo FOCUS | **Réel** | Reconstruit à la résolution du film avec les proportions exactes du logo de `components/layout/sidebar.tsx` (carré `#333f8a`, « F » blanc, mot-symbole IBM Plex Sans semibold). |
| Liste des évaluations, détail « Contrôle — Calcul littéral » (moyenne 12,2/20, distribution, « Calcul littéral : 42 % en difficulté », « Emma Leroy 8/20 — en retrait de 4.5 pts par rapport à sa moyenne habituelle ») | **Réel** | Captures Playwright de l'application réelle (`next build && next start`), 3× la résolution. Animées (caméra, apparition carte par carte, mise en lumière) mais **aucun pixel d'interface n'est inventé**. Mention à l'écran : « Interface réelle · prototype FOCUS · données fictives ». |
| Fiche d'Emma : « Compétence la plus fragile : Calcul littéral — 45 % », compétences avec niveaux de preuve, « Analyse FOCUS », « Actions recommandées » | **Réel** | Texte de diagnostic produit par `lib/analysis.ts` sur les données fictives. |
| Tableau de bord (31 / 21 / 7 / 3, élèves nécessitant votre attention, compétences les moins maîtrisées) | **Réel** | Capture. |
| Liste de classe (tableau de suivi) | **Réel** | Capture. |
| Fenêtre « Créer un accompagnement » → « Accompagnement créé » | **Réel, mais action simulée par le prototype** | Les deux états sont capturés dans l'application ; la fenêtre affiche elle-même « Cette action est simulée dans le prototype ». |
| « Exercice de renforcement » écrit à la main (3(x + 2) = 3x + 6) | **Mise en scène** | Représente « un élève qui travaille » sans personnage (voir §3). |
| Ordinateur portable | **Mise en scène** (objet 3D en CSS, sans marque) | L'écran affiche une capture réelle de la fiche d'Emma. |
| Pointeur de souris, halos, « spotlights » | **Mise en scène** | Ajoutés au montage pour guider le regard. |

### Écart entre la voix off et le produit actuel

La narration (texte du brief) parle d'intelligence artificielle et d'une plateforme « conçue pour
transformer les réponses des élèves en informations pédagogiques exploitables ». La question de
l'acte II est formulée au conditionnel (« Et si l'intelligence artificielle aidait… »), ce qui est juste.
En revanche, **le prototype actuel ne contient pas d'IA et n'analyse pas de copies** : si le film est
diffusé publiquement en l'état, il serait honnête d'ajouter un carton du type « Prototype — certaines
fonctionnalités présentées sont en cours de conception » ou d'adapter la phrase de l'acte III.

## 3. Ce qui n'a pas pu être produit (et pourquoi)

| Demandé | Résultat | Raison |
|---|---|---|
| Plans humains photoréalistes (professeur qui corrige, élève qui travaille) | **Non produits.** Remplacés par un motion design « macro » (papier, encre, lumière, profondeur de champ). | Aucun outil de génération vidéo disponible dans l'environnement ; les banques d'images (Pexels, Pixabay, Wikimedia) étaient inaccessibles (réseau filtré). Conformément au brief : « préfère un motion design minimaliste impeccable » plutôt que des images médiocres. |
| Voix ElevenLabs ou équivalent | **Voix open source locale** (Kokoro, `ff_siwis`) | Aucun service de synthèse vocale en ligne accessible. La voix est vérifiée automatiquement (Whisper), mais elle reste une voix de synthèse : un enregistrement professionnel est recommandé pour une diffusion. |
| Musique premium | **Partition originale composée en code** (piano et cordes par FluidSynth + soundfont MuseScore General ; nappes, pulsation, basse, percussions synthétisées) | Pas d'accès à une bibliothèque musicale. Avantage : droits entièrement maîtrisés. |

Limites connues de la voix (détectées par la reconnaissance vocale) : « aidait » peut être entendu
« aidaient », « exploitables » est parfois entendu « exploatables ». Les phrases complètes sont
reconnues correctement dans le mix final (similarité ≥ 0,94).

## 4. Droits et licences des ressources

| Ressource | Licence |
|---|---|
| Interface FOCUS (captures) | Votre propre produit ; données fictives. |
| IBM Plex Sans / Mono (police de FOCUS) | SIL Open Font License 1.1 |
| Caveat (écriture manuscrite) | SIL Open Font License 1.1 |
| Kokoro v1.0 (synthèse vocale) | Apache-2.0 (voix `ff_siwis` entraînée sur le corpus SIWIS — vérifier les conditions du corpus avant diffusion commerciale) |
| MuseScore General soundfont (piano, cordes) | MIT ; piano « Splendid Grand » domaine public |
| Musique, effets sonores, textures, animations | Créés pour ce projet (code dans `tools/` et `src/`) |
| Remotion | Licence Remotion (gratuite pour les équipes jusqu'à 3 personnes ; licence entreprise au-delà) |

## 5. Défauts de l'interface FOCUS remarqués pendant le tournage

Non corrigés (le brief interdit de modifier le fonctionnement de FOCUS), mais à signaler :

1. **Graphiques : étiquettes de l'axe Y tronquées.** Dans « Distribution des notes » et « Évolution des résultats »,
   la marge gauche négative (`margin={{ left: -18 }}`, `components/evaluations/distribution-chart.tsx` et
   `components/students/grade-chart.tsx`) coupe les graduations : on lit « 0, 5, 0, 5, 0 » au lieu de « 20, 15, 10, 5, 0 ».
   Le film cadre ces graphiques de façon à ne pas mettre ce défaut en avant.
2. **Séparateur décimal incohérent** : « en retrait de 4.5 pts » (point) alors que le reste de l'interface
   affiche « 8,5 / 20 » (virgule) — `lib/analysis.ts`, `round1(gap)` non passé par `formatScore`.
