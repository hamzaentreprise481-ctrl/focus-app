// Password rules and provider error messages for the reset and invitation
// flows. Messages never reveal whether an address has an account.

export const MIN_PASSWORD_LENGTH = 12;

export function newPasswordError(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Choisissez un mot de passe d’au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  if (password.length > 128) return "Le mot de passe ne doit pas dépasser 128 caractères.";
  if (new Set(password).size < 4) return "Ce mot de passe est trop simple : variez les caractères.";
  if (password !== confirmation) return "Les deux mots de passe ne sont pas identiques.";
  return null;
}

export function passwordUpdateError(error: { code?: string; status?: number }): string {
  if (error.code === "same_password") return "Choisissez un mot de passe différent de l’ancien.";
  if (error.code === "weak_password") return "Ce mot de passe est refusé car trop faible ou déjà exposé dans une fuite de données. Choisissez-en un autre.";
  if (error.status === 429 || error.code === "over_request_rate_limit") return "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
  if (error.status === 401 || error.code === "session_not_found" || error.code === "bad_jwt")
    return "Le lien a expiré. Demandez un nouveau lien de réinitialisation.";
  return "Le mot de passe n’a pas pu être enregistré. Réessayez dans quelques instants.";
}

export function resetRequestError(error: { code?: string; status?: number }): string | null {
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit")
    return "Trop de demandes. Patientez quelques minutes avant de redemander un lien.";
  if (error.status && error.status >= 500) return "Le service est momentanément indisponible. Réessayez dans quelques instants.";
  // Anything else (unknown address included) gets the neutral confirmation.
  return null;
}

/** Where an e-mail link may lead after verification. */
export type EmailLinkType = "recovery" | "invite";
export function emailLinkType(value: unknown): EmailLinkType | null {
  return value === "recovery" || value === "invite" ? value : null;
}
