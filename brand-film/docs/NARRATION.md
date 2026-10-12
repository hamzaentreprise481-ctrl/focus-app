# FOCUS — Texte de la narration

Voix off française, posée. Les timecodes sont ceux du film final (`src/timeline.json`, champ `vo`).
Le texte est celui du brief, sans modification.

| Timecode | Acte | Texte |
|---|---|---|
| 00:02.0 | I — Le problème | « Chaque jour, des millions de réponses sont corrigées. |
| 00:05.6 | I | Des notes sont attribuées. |
| 00:09.3 | I | Mais une note ne raconte jamais toute l'histoire. » |
| 00:16.1 | II — La révélation | « Et si l'intelligence artificielle aidait les enseignants à comprendre ce qui se cache derrière chaque erreur ? » |
| 00:27.4 | III — La technologie | « Voici FOCUS. |
| 00:29.1 | III | Une plateforme conçue pour transformer les réponses des élèves en informations pédagogiques exploitables. |
| 00:37.0 | III | Identifier les difficultés. |
| 00:40.0 | III | Comprendre les notions qui posent problème. |
| 00:44.4 | III | Et aider les enseignants à décider comment accompagner chaque élève. » |
| 00:54.4 | IV — L'ambition | « Parce que derrière chaque erreur, il y a quelque chose à comprendre. |
| 00:59.2 | IV | Et derrière chaque élève, un potentiel à développer. » |
| 01:10.6 | V — Signature | « FOCUS. |
| 01:11.6 | V | Comprendre les erreurs. |
| 01:13.2 | V | Accompagner les progrès. » |

## Textes à l'écran

| Timecode | Texte |
|---|---|
| 00:13.0 | ET SI ON POUVAIT / ALLER PLUS LOIN ? |
| 00:22.6 | Comprendre. — Identifier. — Accompagner. |
| 01:03.4 | CHAQUE ERREUR PEUT DEVENIR / UN POINT DE DÉPART. |
| 01:15.2 | FOCUS — Une nouvelle approche de l'accompagnement pédagogique. |

Mentions d'honnêteté incrustées : « Visualisation conceptuelle » (analyse de copie, actes II et III)
et « Interface réelle · prototype FOCUS · données fictives » (actes III).

## Voix

- Moteur : **Kokoro v1.0** (open source, Apache-2.0), voix française `ff_siwis`, exécutée localement
  (`tools/audio/tts.py`). Aucune voix clonée, aucun service en ligne.
- Chaque paragraphe est synthétisé d'un seul tenant (intonation naturelle), puis découpé aux pauses.
  Chaque phrase est vérifiée par reconnaissance vocale (Whisper small) et la meilleure prise est retenue.
- Ajustement de prononciation : « exploitables » est envoyé au moteur sous la graphie phonétique
  « explwatables » (champ `tts` de `tools/audio/narration.json`) pour obtenir une diphtongue /wa/ nette.
- **Pour une diffusion professionnelle, nous recommandons d'enregistrer une comédienne ou un comédien**
  et de remplacer les fichiers `public/audio/vo/*.flac` (mêmes noms) : tout le reste du pipeline
  (mixage, ducking, mastering) se recalcule automatiquement.
