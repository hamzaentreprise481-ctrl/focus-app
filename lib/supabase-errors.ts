// Errors that mean the database is behind the code (a FOCUS migration has
// not been applied yet), as opposed to a refused or invalid operation.

const MISSING_OBJECT_CODES = new Set([
  "PGRST202", // function not found in the schema cache
  "PGRST204", // column not found
  "PGRST205", // table not found
  "42883", // undefined function
  "42P01", // undefined table
  "42703", // undefined column
]);

export const SCHEMA_OUTDATED_MESSAGE =
  "La base de données n’est pas à jour : des migrations FOCUS restent à appliquer sur ce serveur. Rien n’a été modifié.";

export function isSchemaOutdated(error: { code?: string | null } | null | undefined) {
  return Boolean(error?.code && MISSING_OBJECT_CODES.has(error.code));
}

export class SchemaOutdatedError extends Error {}

/** Throws with the step's label; missing schema objects get their own error type. */
export function ensureOk(error: { message: string; code?: string | null } | null, label: string) {
  if (!error) return;
  if (isSchemaOutdated(error)) throw new SchemaOutdatedError(`${label}: ${error.code} ${error.message}`);
  throw new Error(`${label}: ${error.message}`);
}
