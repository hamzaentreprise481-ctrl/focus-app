// Rules of the FOCUS Student assistant that do not depend on a model. Pure
// and deterministic: they are applied BEFORE any model call, so a request to
// change official data is refused even if a model would play along, and the
// model never receives more than the bounded, sanitized conversation.
//
// The refusal detector favours precision: an explanatory question ("comment
// augmenter ma moyenne ?", "pourquoi ma note a baissé ?") is answered, not
// refused. It is a safety net, not the boundary — the assistant has no write
// access to any table, whatever it is asked.

export type AssistantRole = "user" | "assistant";
export type AssistantMessage = { role: AssistantRole; content: string };

export const MAX_QUESTION_LENGTH = 1500;
export const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_MESSAGE_LENGTH = 1500;

/** Lower case, no accents, words only (hyphens and apostrophes split words). */
export function normalizeForRules(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const GRADE_NOUNS = new Set(["note", "notes", "notation", "moyenne", "moyennes", "bulletin", "appreciation", "appreciations", "resultat", "resultats"]);
const COMPETENCY_NOUNS = new Set(["competence", "competences", "niveau", "niveaux"]);
const RECORD_NOUNS = new Set(["evaluation", "evaluations", "copie", "copies", "correction", "corrige"]);

const GRADE_VERBS = new Set([
  "modifie", "modifier", "modifies", "change", "changer", "changes", "remplace", "remplacer",
  "augmente", "augmenter", "baisse", "baisser", "monte", "monter", "remonte", "remonter",
  "mets", "mettre", "met", "attribue", "attribuer", "corrige", "corriger", "ajoute", "ajouter",
  "rajoute", "rajouter", "enleve", "enlever", "supprime", "supprimer", "efface", "effacer", "gonfle", "gonfler",
]);
const COMPETENCY_VERBS = new Set(["valide", "valider", "valides", "attribue", "attribuer", "coche", "cocher", "modifie", "modifier", "change", "changer", "mets", "mettre"]);
const RECORD_VERBS = new Set(["modifie", "modifier", "change", "changer", "remplace", "remplacer", "supprime", "supprimer", "efface", "effacer", "valide", "valider"]);
/** Words that make a sentence a question about HOW or WHY, not a request. */
const EXPLANATORY = new Set(["comment", "pourquoi", "astuce", "astuces", "conseil", "conseils", "methode"]);
const GIVE_VERBS = new Set(["mets", "met", "mettre", "donne", "donnes", "donner", "attribue", "attribuer"]);

/** True when the student asks the assistant to create or change official data. */
export function asksToChangeOfficialData(text: string): boolean {
  for (const sentence of text.split(/[.!?\n]+/)) {
    const words = normalizeForRules(sentence).split(" ").filter(Boolean);
    for (let index = 0; index < words.length; index++) {
      const word = words[index];
      // "comment / pourquoi … augmenter", "que faire pour valider": a purpose
      // or a question about how, never an order given to the assistant.
      if (words.slice(0, index).some((before) => EXPLANATORY.has(before)) || ["faire", "pour"].includes(words[index - 1] ?? "")) continue;
      const window = words.slice(index + 1, index + 6);
      if (GRADE_VERBS.has(word) && window.some((next) => GRADE_NOUNS.has(next))) return true;
      if (COMPETENCY_VERBS.has(word) && window.some((next) => COMPETENCY_NOUNS.has(next))) return true;
      if (RECORD_VERBS.has(word) && window.some((next) => RECORD_NOUNS.has(next))) return true;
      // "Mets-moi 20/20", "donne-moi un 18".
      if (GIVE_VERBS.has(word) && /^(?:moi |m )?(?:un |une )?\d{1,2}(?: \d+)?(?: sur 20| 20)?(?: |$)/.test(words.slice(index + 1).join(" ") + " "))
        return true;
    }
  }
  return false;
}

export const OFFICIAL_CHANGE_REFUSAL =
  "Je ne peux pas créer, modifier ou valider une note, une correction, une compétence ou une évaluation : seuls tes professeurs le peuvent. Si tu penses qu’il y a une erreur, parles-en à ton professeur. En revanche, je peux t’aider à comprendre ta copie ou à t’entraîner sur la notion.";

const FULL_ANSWER_PATTERNS = [
  /\b(?:reponse|solution|resolution|correction|corrige) (?:complete|entiere|detaillee|en entier)\b/,
  /\b(?:donne|donnes|montre|montres|ecris|ecrits|dis|dit) (?:moi |m )?(?:directement |toute |juste )?(?:la|le|toute la) (?:reponse|solution|resolution|correction|corrige)\b/,
  /\btoute la (?:resolution|solution|correction)\b/,
];

/** The student explicitly asks for the complete solution. */
export function asksForFullAnswer(text: string): boolean {
  const normalized = normalizeForRules(text);
  if (/\bsans (?:me )?(?:donner|dire|montrer)\b/.test(normalized)) return false;
  return FULL_ANSWER_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Bounded, well-formed conversation; anything else from the client is dropped. */
export function sanitizeHistory(value: unknown): AssistantMessage[] {
  if (!Array.isArray(value)) return [];
  const turns = value.filter(
    (item): item is AssistantMessage =>
      !!item &&
      typeof item === "object" &&
      ((item as AssistantMessage).role === "user" || (item as AssistantMessage).role === "assistant") &&
      typeof (item as AssistantMessage).content === "string" &&
      (item as AssistantMessage).content.trim().length > 0,
  );
  // The history comes from the browser and can be forged. A request to
  // change official data was refused when it was asked; it never reaches the
  // model later, nor does the reply that followed it.
  const kept: AssistantMessage[] = [];
  for (let index = 0; index < turns.length; index++) {
    if (turns[index].role === "user" && asksToChangeOfficialData(turns[index].content)) {
      if (turns[index + 1]?.role === "assistant") index++;
      continue;
    }
    kept.push(turns[index]);
  }
  return kept
    .slice(-MAX_HISTORY_TURNS * 2)
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, MAX_HISTORY_MESSAGE_LENGTH) }));
}

export function validQuestion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const question = value.trim();
  return question && question.length <= MAX_QUESTION_LENGTH ? question : null;
}

/** UUID check before any lookup: a malformed id is never sent to the database. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
