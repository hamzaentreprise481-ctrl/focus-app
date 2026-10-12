# FOCUS — Brand film 2026

Film publicitaire de FOCUS (81 s, 1920 × 1080, 60 i/s, H.264 + AAC, voix off française).
Projet **indépendant** de l'application : rien dans `brand-film/` n'est importé par FOCUS, et
FOCUS n'a pas été modifié (seuls `tsconfig.json` et `eslint.config.mjs` à la racine excluent ce dossier).

**Livrable principal : [`FOCUS_BRAND_FILM_2026.mp4`](./FOCUS_BRAND_FILM_2026.mp4)**

| Document | Contenu |
|---|---|
| [`docs/NARRATION.md`](docs/NARRATION.md) | Texte de la narration et des cartons, avec timecodes |
| [`docs/STORYBOARD.md`](docs/STORYBOARD.md) | Storyboard plan par plan, images extraites du film final |
| [`docs/RAPPORT_REEL_SIMULE.md`](docs/RAPPORT_REEL_SIMULE.md) | Compte rendu honnête : réel / conceptuel / simulé, limites, licences |
| [`docs/PRODUCTION_LOG.md`](docs/PRODUCTION_LOG.md) | Les trois passes (réalisation, critique, finition) et les contrôles techniques |

## Principe

Une seule source de vérité pour le temps : **`src/timeline.json`**. Les scènes Remotion *et* les
scripts audio (partition, effets sonores, placement de la voix) lisent ce fichier ; image et son
restent donc synchronisés par construction. Modifier un timecode → re-rendre l'image et le son.

```
src/
  timeline.json          scènes, timecodes de la voix, repères (cues) partagés image/son
  FocusBrandFilm.tsx     montage (les 5 actes)
  scenes/Act1..Act5.tsx  les plans
  components/            AppWindow (interface réelle reconstruite depuis les captures), Camera,
                         Paper / EmmaCopy (copie Seyès, écriture, stylo), Logo, Laptop, Finish…
public/
  captures/              captures Playwright de FOCUS (WebP sans perte, 3×) + manifest.json (boîtes des éléments)
  audio/vo/              voix off (FLAC 48 kHz, une phrase par fichier)
  audio/FOCUS_mix.m4a    mix final (prévisualisation dans Remotion Studio)
  fonts/ textures/       IBM Plex Sans/Mono, Caveat ; grain et fibre papier
tools/
  capture/capture.mjs    captures de l'interface réelle (Playwright)
  capture/optimize.py    PNG → WebP + manifest
  capture/measure-text.mjs  mesure des textes avec les vraies polices (ancrages d'animation)
  textures.py            génération des textures
  audio/tts.py           voix off (Kokoro, vérification Whisper)
  audio/score.py         partition originale (FluidSynth + synthèse)
  audio/sfx.py           design sonore procédural
  audio/mix.py           mixage, ducking, mastering (−15 LUFS, −1,5 dBTP)
  audio/qa.py            contrôle : intelligibilité de chaque phrase dans le mix, loudness, courbe
  build_final.sh         rendu final + mux + vérifications
```

## Régénérer le film

Prérequis : Node 22, Python 3.11+, `ffmpeg`, `fluidsynth` + `musescore-general-soundfont`,
un Chromium (Remotion le télécharge, ou `REMOTION_BROWSER=/chemin/vers/chrome-headless-shell`).

```bash
cd brand-film
npm install
python3 -m venv .venv && .venv/bin/pip install -r tools/audio/requirements.txt

# (optionnel) recapturer l'interface : lancer FOCUS (npm run build && npx next start -p 3100 à la racine)
node tools/capture/capture.mjs http://localhost:3100 /tmp/captures-raw
.venv/bin/python tools/capture/optimize.py /tmp/captures-raw public/captures

# (optionnel) régénérer la voix — modèles Kokoro + Whisper (sherpa-onnx), voir tools/audio/tts.py
.venv/bin/python tools/audio/tts.py <models_dir> tools/audio/narration.json public/audio/vo

# prévisualiser
npm run dev            # Remotion Studio (prop withAudio pour entendre le mix)

# rendu final complet (partition + mix + image 60 i/s + mux + contrôles)
./tools/build_final.sh
```

Remplacer la voix de synthèse par un enregistrement humain : déposer les fichiers dans
`public/audio/vo/` sous les mêmes noms (`vo1a.flac`…, 48 kHz), puis relancer `tools/build_final.sh`.
