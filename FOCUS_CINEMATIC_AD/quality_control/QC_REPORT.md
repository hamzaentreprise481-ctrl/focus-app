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

## Film final — `output/FOCUS_CINEMATIC_FINAL.mp4`

| Contrôle | Résultat |
|---|---|
| Durée réelle | **55,00 s** (1320 images) ✅ |
| Format | 1920×1080, 24 i/s, H.264 High@4.1, yuv420p, BT.709, ~12 Mb/s, 84,5 Mo ✅ |
| Audio | AAC 320 kb/s stéréo 48 kHz · **−14,0 LUFS** intégré · LRA 8,5 LU · crête vraie **−1,0 dBTP** ✅ |
| Images noires | Une seule plage : 50,00 → 50,71 s = **la coupure voulue** (musique coupée, écran noir, puis la lumière révèle FOCUS) ✅ |
| Images figées | Aucune ✅ |
| Voix off (transcription Whisper sur l'audio du MP4) | 3,15 s « A grade shows a result. » · 5,05 s « But not the whole story. » · 11,25 s « Every answer carries a signal. » · 18,4 s « Focus connects evidence to understanding. » · 35,6 s « Helping teachers see what comes next. » · 45,45 s « And helping every student move forward. » · 51,0 s « Focus, see beyond the grade. » — **toutes exactes** ✅ |
| Ouverture silencieuse | 0–3 s : aucune voix (tic-tac, crayon, ambiance) ✅ |
| Copie web | `FOCUS_CINEMATIC_FINAL_720p_web.mp4` : 1280×720, 55,0 s, 22,6 Mo ✅ |

Revue visuelle de 31 images extraites de la vidéo finale (`quality_control/frames/`, planche `contact_FOCUS_CINEMATIC_FINAL.jpg`) :

| Temps | Observé | Verdict |
|---|---|---|
| 0,5–2 s | Copie non corrigée au soleil du matin, ombre de l'élève | ✅ crédible |
| 3,5 s | Gros plan « 11/20 » | ✅ |
| 5,8 s | Erreur entourée « x² + 9 » | ✅ |
| 7,5 s | Pile de copies chez l'enseignante, lumière chaude | ✅ |
| 9,8–10,1 s | Fondu de lumière sur cadrage identique (bureau → pilote) | ✅ sans saut |
| 12,5–16,8 s | Éveil lumineux, dissolution, réseau | ✅ |
| 18,5–31 s | Preuves, concept, compétences, prochaine étape, validation enseignant ; titres lisibles ; mention « Conceptual visualization » | ✅ · ⚠️ à 26 s le flux lumineux passe derrière « NEXT STEP » (reste lisible) |
| 32,2–34,8 s | Le réseau devient l'écran d'un portable, puis l'interface réelle ; recul sur le bureau | ✅ (repose-poignets corrigé) |
| 37–43,5 s | Vraie interface du prototype + sous-titres traduits + mention « prototype · demonstration data » | ✅ |
| 45–49,9 s | Post-it de l'enseignante, reprise juste de l'élève | ✅ |
| 50,2 s | Noir (coupure) | ✅ voulu |
| 51,5–54,8 s | FOCUS en métal révélé par la lumière, « SEE BEYOND THE GRADE. » | ✅ |

Autres vérifications :
- **Visages / mains déformés** : aucun (aucun humain n'est représenté ; seules des ombres portées).
- **Faux éléments d'interface** : aucun. Toutes les vues d'interface sont des captures du prototype ; la séquence 3 est signalée « Conceptual visualization ».
- **Cohérence des couleurs** : étalonnage commun (noirs bleu nuit, bloom, grain) sur tous les plans 3D ; interface légèrement teintée pour s'intégrer.
- **Licences** : voir `LICENSES.md` (aucune ressource sous licence incompatible).

## Limites connues (non masquées)

1. **Pas de plans humains photoréalistes** (voir `AUDIT.md`) : présence humaine par point de vue, ombres, lumière et objets.
2. Rendu CPU : la séquence 3 est calculée en 1600×900 puis agrandie en 1080p (Lanczos) ; tous les autres plans 3D sont en 1920×1080 natif.
3. L'interface du prototype est en français ; les phrases clés sont sous-titrées en anglais (traductions fidèles).
4. Le prototype FOCUS actuel fonctionne avec des données fictives et une analyse par règles ; la séquence 3 est une visualisation conceptuelle, signalée comme telle à l'écran.
5. Musique : composée par programme avec des échantillons libres — soignée, mais pas l'équivalent d'une partition de compositeur professionnel.
6. Voix : synthèse Kokoro (naturelle, mais une oreille attentive peut reconnaître une voix de synthèse).
