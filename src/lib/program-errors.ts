export function programError(error: any): string {
  const message = String(error?.message ?? error ?? "");
  if (/row.level|permission denied|42501|accès refusé/i.test(message)) return "Vous n’avez pas les droits nécessaires pour cette action ou ce pôle. Contactez la responsable pour vérifier vos accès.";
  return message || "L’enregistrement a échoué. Réessayez.";
}
