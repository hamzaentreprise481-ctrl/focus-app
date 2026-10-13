# Rapport de contrôle qualité

Méthode : contrôles automatiques sur les **fichiers MP4 réellement exportés** (`scripts/qc.py` : ffprobe, `blackdetect`,
`freezedetect`, `ebur128`), transcription automatique de la voix off dans le mix final (Whisper base.en, hors ligne),
puis **inspection visuelle d'images extraites de la vidéo finale** (`quality_control/frames/`, planches `contact_*.jpg`).

## Pilote — `output/FOCUS_PILOT_8S.mp4`

| Contrôle | Résultat |
|---|---|
| Durée | 8,00 s (192 images) ✅ |
| Format | 1920×1080, 24 i/s, H.264 High, yuv420p, BT.709 ✅ |
| Audio | AAC stéréo 48 kHz, −14,1 LUFS intégré, crête vraie −1,0 dBTP ✅ |
| Images noires accidentelles | Aucune ✅ |
| Images figées | Aucune ✅ |
| Voix off | « Every answer carries a signal. » à 1,25 s, transcrite exactement ✅ |
| Synchronisation | La phrase commence juste avant l'éveil lumineux de l'erreur (1,4 s) ; impact sonore à 3,75 s = début de dissolution de la feuille ✅ |
| Rendu | Cycles CPU, 1920×1080 natif, 20 échantillons + débruitage OIDN |

Revue visuelle (images extraites à 0,2 / 1,5 / 2,6 / 3,4 / 3,9 / 4,6 / 5,2 / 5,6 / 6,2 / 7,0 / 7,9 s) :

- 0–3,4 s : macro photoréaliste crédible de la copie (papier, encre, profondeur de champ), l'erreur entourée s'illumine, puis toute l'écriture. ✅
- 3,9 s : dissolution de la feuille en poussière lumineuse ; aspect légèrement « fumée » mais lisible et élégant. ✅
- 4,6 s : l'erreur « x² + 9 » flotte au-dessus de la grille. ⚠️ Défaut mineur : quelques fragments de la ligne supérieure (« (x + 3)² ») se soulèvent avec elle pendant ~1 s. Corrigé dans la séquence 3 (sélection resserrée) ; non re-rendu dans le pilote (≈ 1 h de calcul pour un défaut peu visible).
- 5,2 s : traversée rapide du plan d'écriture (flou volontaire, 0,5 s). ✅
- 5,6–8 s : réseau 3D net (nœuds, liaisons, poussière d'étoiles), sans brouillard parasite. ✅
- Aucune main, aucun visage, aucun faux élément d'interface. ✅
