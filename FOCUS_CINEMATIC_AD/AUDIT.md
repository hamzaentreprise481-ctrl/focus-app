# Phase A — Audit technique (environnement Claude Code Cloud, 13 oct. 2026)

Le travail a été fait **dans un conteneur Linux cloud**, pas sur votre Dell XPS 13 ni votre tablette.
Le Blender installé sur votre PC n'a pas été utilisé (inaccessible depuis le cloud).

| Élément | Résultat |
|---|---|
| Processeur | 4 vCPU Intel Xeon @ 2,1 GHz (AVX-512) |
| GPU | **Aucun** (pas de CUDA/OptiX ; rendu 100 % CPU) |
| RAM | 15 Go |
| Disque libre | ~31 Go |
| Blender | Pas installé au départ → **bpy 5.2.2 LTS** (Blender officiel en module Python, PyPI) installé et **testé en rendu réel** |
| Cycles (CPU) | Fonctionne : ~55–120 s/image en 1080p pour les scènes photoréalistes, ~20 s pour les scènes « réseau » |
| EEVEE | Fonctionne via Mesa/llvmpipe (rendu logiciel) : ~17 s/image sur une scène triviale → pas plus rapide que Cycles ici, non retenu |
| FFmpeg | 6.1.1 (x264, AAC, loudnorm, rubberband) |
| Python | 3.13 (+ numpy, scipy, Pillow, numba, librosa, OpenEXR…) |
| Réseau | PyPI, npm, apt, releases GitHub, Docker Hub : OK. **Bloqués** par la politique réseau : huggingface.co, download.blender.org, freesound, pixabay, archive.org, ccmixter, incompetech… |
| Fichiers FOCUS | Prototype Next.js « FOCUS teacher V0 » (données fictives). **`FOCUS_ONE_DAY_FINAL.mp4` introuvable** dans le dépôt et le conteneur. |
| Générateur d'images IA | **Aucun accessible** (voir LICENSES.md) |
| Génération vidéo IA | Impossible (pas de GPU, pas de poids) |
| Voix | **Kokoro-82M** (Apache 2.0) fonctionne sur CPU |
| Musique | Pas de modèle musical libre accessible → composition programmée + SoundFont MuseScore (MIT/CC0) |

## Pipeline retenu

1. Blender (Cycles CPU) piloté à 100 % par Python : scènes, matériaux, nœuds de shaders, Geometry Nodes (particules), lumières, caméras, rendus EXR.
2. Étalonnage commun (`scripts/post.py`) : bloom, courbe filmique, teinte bleu nuit, vignettage, grain.
3. Interface réelle filmée par caméra virtuelle sur des captures Playwright du vrai prototype.
4. Voix Kokoro + musique/sound design générés localement, mixage et normalisation −14 LUFS.
5. Montage image par image et encodage H.264 2 passes (`scripts/assemble.py`).

## Ce qui bloque le photoréalisme humain (précisément)

- Aucun modèle d'images téléchargeable : HuggingFace bloqué ; l'alternative Docker (Z-Image-Turbo, Apache 2.0) a été refusée par la sécurité de la session.
- Même avec un modèle, sans GPU : ~5–20 min par image fixe sur 4 cœurs, et **pas d'animation humaine crédible** possible (pas de modèle vidéo).
- Choix fait : aucun humain de synthèse (votre consigne : pas d'humains 3D artificiels). L'élève et l'enseignante sont présents par le
  **point de vue caméra, leurs ombres portées, leur lumière (matin / soir) et leurs objets**.

**Pour obtenir de vrais plans humains photoréalistes** : autoriser `huggingface.co` dans les paramètres réseau de l'environnement cloud
(Network access → Allowed domains), ou approuver le téléchargement de l'image Docker refusé ; les rendus resteraient des images fixes animées en 2.5D sur CPU.
