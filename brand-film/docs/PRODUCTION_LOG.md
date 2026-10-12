# Journal de production — trois passes

## Préparation

- **Inspection du produit** : lecture de tout le code FOCUS ; exécution de `lib/analysis.ts` sur les données
  fictives pour trouver l'histoire la plus juste. Choix d'**Emma Leroy** (fictive) : 8/20 au
  « Contrôle — Calcul littéral », signalée « en retrait de 4.5 pts par rapport à sa moyenne habituelle »,
  compétence la plus fragile « Calcul littéral (45 %) », puis « progression récente » détectée par l'analyse.
  L'erreur de distributivité 3(x + 2) = 3x + 2 relève exactement de cette compétence.
- **Captures réelles** : `next build && next start`, Playwright (Chromium), viewport 1440 × 900 à 3× ;
  barre latérale fixe et colonne principale capturées séparément (comme dans l'application, où seul
  `<main>` défile), plus les boîtes englobantes de chaque carte pour reconstruire les écrans élément par élément.
- **Outils réellement disponibles** : Remotion 4.0.535, FFmpeg 6.1, Playwright/Chromium, FluidSynth,
  Kokoro (TTS open source), Whisper small (contrôle). Indisponibles : génération vidéo, banques d'images,
  ElevenLabs (réseau filtré, pas de clé).
- **Choix de la voix** : comparaison Kokoro `ff_siwis` / Piper `fr_FR-tom` sur les 14 phrases :
  reconnaissance (Whisper), variation de hauteur (3,1 vs 2,0 demi-tons d'écart-type → Kokoro plus expressive),
  spectrogrammes (harmoniques nettes pour Kokoro, souffle de vocodeur pour Piper). Kokoro retenue.

## Passe 1 — réalisation

Film complet : 81 s, 1920 × 1080, 30 i/s, 5 actes, partition originale, design sonore, voix off, mix
(−15,0 LUFS intégrés, −1,5 dBTP). Fichier : `out/FOCUS_BRAND_FILM_pass1.mp4` (non versionné).
Calage visuel pendant la construction par planches d'images fixes (tics de correction trop loin des réponses,
moiré sur les petites copies, notes illisibles, cadrages d'Act II…).

## Passe 2 — critique (sur le film rendu, image par image) et corrections

Revue du film à 1 image/s (planches contact), puis image par image autour de chaque raccord ;
contrôle audio par reconnaissance vocale **dans le mix** et courbe de niveau.

| # | Défaut constaté | Correction |
|---|---|---|
| 1 | Gros plan de l'erreur cadré sur du papier vide (position de « 3x + 2 » estimée) | Mesure réelle des glyphes dans Chromium (`measure-text.mjs`) ; la ligne entière puis poussée sur « 3x + 2 » |
| 2 | Carton « ET SI ON POUVAIT ALLER PLUS LOIN ? » plus large que l'image (retour à la ligne puis débordement) | Titre monumental sur deux lignes |
| 3 | Étiquettes « 3 × x = 3x » posées sur les arcs | Dégagement + fond graphite |
| 4 | Double exposition liste → détail d'évaluation | La liste s'efface avant que le détail ne se construise |
| 5 | Fenêtre décentrée pendant le déplacement du pointeur | Caméra recentrée |
| 6 | Panneau conceptuel collé au bord droit | Repositionné dans la zone de sécurité |
| 7 | Raccord sur une fiche élève à moitié construite | Fiche complète au moment du raccord |
| 8 | « Pop » du halo du logo au passage Acte II → III (1 image) | Continuité de la lueur |
| 9 | Recul final du tableau de bord trop incliné | Mouvement plus sobre |
| 10 | Réponse corrigée « + 6 » écrite trop tard | Écriture terminée plus tôt, plan tenu |
| 11 | Ordinateur portable mal cadré (le clavier domine) | L'écran devient le sujet |
| 12–14 | Signature statique 5 s ; énoncé final un peu petit ; page vide avant la liste | Poussée lente + lueur respirante ; 106 px ; liste plus tôt |
| 15 | Textures en `background-image` (Remotion ne peut pas attendre leur chargement → risque d'images incomplètes) | Textures pré-générées (`tools/textures.py`) chargées par `<Img>` |
| 16 | Musique aussi forte que la voix pendant tout l'acte III (≈ −17 dB RMS constant), pas de montée | Courbe d'automation : discrète sous la démonstration, montée jusqu'à l'apogée, retour au silence |
| 17 | Bruits de stylo masquant « corrigées » et « chaque élève » (Whisper : « origées », « Chatilève ») | Effets sonores atténués sous la voix (−6 dB), coche décalée, écriture plus douce |
| 18 | « exploitables » prononcé « exploatables » | Graphie phonétique « explwatables » pour le moteur + sélection de la meilleure prise parmi 7 vitesses |
| 19 | Notes de piano de l'acte V posées pile sur les attaques de la voix | Le piano répond entre les phrases |

Fichier : `out/FOCUS_BRAND_FILM_pass2.mp4` (non versionné).

## Passe 3 — finition premium

- **Fluidité** : rendu final à **60 i/s** (tous les temps sont exprimés en secondes, le grain reste à 15 i/s
  comme une pellicule) ; images intermédiaires PNG sans perte.
- **Colorimétrie** : sortie `yuv420p`, BT.709 (primaires, transfert, matrice) et plage TV correctement
  marquées — le bleu FOCUS `#333f8a` s'affiche fidèlement (la passe 1 était marquée BT.601 plage pleine).
- **Raccords** : barre latérale tenue pendant les transitions (plus de baisse d'opacité de 2 images),
  contour de survol effacé avec la liste.
- **Révélation finale** : balayage lumineux plus lisible, brève floraison de lumière quand le point
  devient le carré FOCUS, souffle inversé (« inspiration ») dans le son juste avant.
- **Encodage de livraison** : x264 High, preset slow, AAC 320 kb/s 48 kHz, `faststart`.

## Contrôles techniques du livrable

Voir la section « Vérification finale » ajoutée en fin de production (durée, flux, décodage complet,
loudness EBU R128, true peak, intelligibilité des phrases).
