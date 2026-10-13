# Licences et provenance des ressources — FOCUS « See beyond the grade »

Aucun achat, aucun abonnement, aucune API payante, aucun crédit de génération n'a été utilisé.
Aucun contenu tiers protégé (banque d'images, musique de librairie, Artlist, etc.) n'est présent dans le film.

## Ce qui apparaît à l'écran ou s'entend dans le film

| Élément | Origine | Licence / statut | Usage commercial |
|---|---|---|---|
| Toutes les images 3D (copie, bureaux, réseau, ordinateur, logo typographique) | Calculées dans ce conteneur avec **Blender 5.2.2** (module `bpy`, moteur Cycles CPU) à partir des scripts `blender/*.py` | Rendus produits pour vous ; la licence GPL de Blender ne s'applique pas aux images produites | Oui |
| Copies manuscrites, post-it, reprise | Générées par `scripts/make_copy_texture.py` (texte et calculs écrits pour le film) | Créations originales | Oui |
| Captures d'interface FOCUS | Le prototype de **ce dépôt**, lancé localement sans modification, avec ses **données fictives de démonstration** (`scripts/capture_ui.py`) | Votre propre produit | Oui |
| Voix off anglaise | **Kokoro-82M** (hexgrad), voix `am_michael`, via `kokoro-onnx` ; fichiers modèle téléchargés depuis la release GitHub officielle `thewh1teagle/kokoro-onnx` (`model-files-v1.0`) | Poids : **Apache 2.0** ; `kokoro-onnx` : MIT | Oui |
| Musique originale | Composée par programme (`scripts/make_music.py`) : MIDI rendu par **FluidSynth** avec la **MuseScore General SoundFont** + synthèse Python | SoundFont : **MIT** (échantillons cordes VSCO2 CE en **CC0**, piano en domaine public, Fluid R3 Mono en MIT) ; FluidSynth : LGPL-2.1 (outil) | Oui |
| Sound design (impacts, whooshes, tic-tac, crayon, blips) | Synthétisé en Python (numpy/scipy) | Création originale | Oui |
| Typographies | **Inter / Inter Display** (titres, sous-titres, logo typographique), **Caveat** (écriture de l'élève), **Kalam** (écriture de l'enseignante) — paquets `@fontsource` (npm) et paquet système Inter | **SIL Open Font License 1.1** | Oui (l'OFL autorise l'usage dans des vidéos) |

Copie des polices utilisées : `assets/fonts/`.

## Outils (n'imposent aucune restriction sur le film)

Blender/bpy 5.2.2 (GPL-3.0), FFmpeg 6.1 (LGPL/GPL), FluidSynth 2.3 (LGPL-2.1), espeak-ng via `espeakng-loader` (GPL-3.0, phonémisation pour Kokoro),
Python 3.13, numpy, scipy, Pillow, numba, librosa, mido, OpenEXR, Playwright + Chromium (Apache 2.0 / BSD), Mesa.
Contrôle qualité uniquement : Whisper base.en (MIT) via sherpa-onnx (Apache 2.0) pour transcrire la voix off.

## Ce qui n'a PAS été utilisé (et pourquoi)

- **Générateur d'images photoréalistes** : HuggingFace est bloqué par la politique réseau de cet environnement cloud. Une copie du modèle
  **Z-Image-Turbo** (Apache 2.0) existe dans une image Docker publique, mais son téléchargement a été **refusé par le contrôle de sécurité
  de la session** ; il n'a pas été contourné. Le film ne contient donc **aucun visage ni corps humain généré**.
- **Génération vidéo IA** : impossible ici (aucun GPU, aucun poids accessible).
- **ChatGPT Pro / API OpenAI, Artlist** : non utilisés (l'abonnement ChatGPT ne donne pas accès à l'API ; l'essai Artlist ne garantit pas une licence commerciale).
