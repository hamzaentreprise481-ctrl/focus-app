/** Provider errors are translated without exposing payloads or account existence. */
export function loginError(error: { code?: string; status?: number }): string {
  if (error.status === 429 || error.code === "over_request_rate_limit")
    return "Trop de tentatives de connexion. Patientez quelques minutes avant de réessayer.";
  if (error.status && error.status >= 500)
    return "Le service de connexion est momentanément indisponible. Réessayez dans quelques instants.";
  return "Connexion impossible. Vérifiez votre adresse e-mail et votre mot de passe. Si le problème persiste, contactez la personne qui vous a invité.";
}
