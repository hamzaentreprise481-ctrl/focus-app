# FOCUS — SEE BEYOND THE GRADE · production

Publicité anglaise de 55 s (1920×1080, 24 i/s, H.264 + AAC stéréo) entièrement fabriquée dans un conteneur cloud,
sans tournage, sans service payant. Voir `AUDIT.md` (environnement), `LICENSES.md` (provenance) et
`quality_control/QC_REPORT.md` (contrôle qualité).

## Livrables

| Fichier | Contenu |
|---|---|
| `output/FOCUS_CINEMATIC_FINAL.mp4` | Film final 55 s, 1080p (≈12 Mb/s) |
| `output/FOCUS_CINEMATIC_FINAL_720p_web.mp4` | Copie légère pour tablette / partage |
| `output/FOCUS_PILOT_8S.mp4` | Pilote 8 s : la copie se transforme en univers numérique 3D |
| `blender/*.blend` | Projets Blender (s'ouvrent dans Blender ≥ 5.2 ; les textures sont dans `assets/`) |
| `blender/*.py`, `scripts/*` | Tous les scripts source (scènes, musique, voix, étalonnage, montage, QC) |

## Structure du film

| Temps | Séquence | Contenu | Voix off |
|---|---|---|---|
| 0–10 s | 1 · The problem | Bureau de l'élève au soleil du matin (son ombre, sa copie), la note 11/20, l'erreur entourée ; bureau de l'enseignante le soir | « A grade shows a result. But not the whole story. » |
| 10–17,5 s | 2 · Transformation (pilote) | L'erreur s'éveille, l'encre se détache en lumière, la feuille se dissout, plongée dans l'univers 3D | « Every answer carries a signal. » |
| 17,5–32,5 s | 3 · Intelligence (*visualisation conceptuelle*) | Deux réponses, même erreur → concept (a + b)² → compétences → prochaine étape → **validation par l'enseignant** ; titres EVIDENCE / UNDERSTANDING / NEXT STEP | « FOCUS connects evidence to understanding. » |
| 32,5–45 s | 4 · Product | Le réseau devient l'écran d'un portable, puis **la vraie interface du prototype FOCUS** (données de démonstration) | « Helping teachers see what comes next. » |
| 45–50 s | 5 · Human impact | Post-it de l'enseignante (décision), reprise juste de l'élève | « And helping every student move forward. » |
| 50–55 s | 6 · Reveal | Coupure, noir, la lumière révèle FOCUS · SEE BEYOND THE GRADE. | « FOCUS. See beyond the grade. » |

## Refaire le film

```bash
python3.13 -m venv venv && . venv/bin/activate
pip install bpy==5.2.2 numpy scipy pillow soundfile OpenEXR kokoro-onnx librosa numba mido playwright
apt install ffmpeg fluidsynth musescore-general-soundfont-lossless libegl1 libgl1-mesa-dri
python scripts/make_copy_texture.py        # copies, post-it, reprise
python scripts/make_vo.py                  # voix (modèles Kokoro dans /opt/kokoro, cf. LICENSES.md)
python scripts/make_music.py               # musique + sound design
python scripts/capture_ui.py               # captures du prototype (npx next build && npx next start -p 3100)
python scripts/ui_shots.py                 # plans d'interface
bash scripts/render_queue.sh               # constructions Blender + rendus + étalonnage (long : CPU)
python scripts/assemble.py film            # montage, mixage, export
python scripts/qc.py output/FOCUS_CINEMATIC_FINAL.mp4
```

Les rendus intermédiaires (`renders/`) ne sont pas versionnés (plusieurs Go).
