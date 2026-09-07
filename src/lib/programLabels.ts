export const PROGRAM_TYPE_OPTIONS = [
  ["eglise", "Église"],
  ["corporate", "Corporate"],
  ["invite", "Autre église-Invitation"],
  ["com", "Interne Com"],
] as const;

export const PROGRAM_FORMAT_OPTIONS = [
  ["presentiel", "Présentiel"],
  ["online", "En ligne"],
  ["both", "Présentiel + En ligne"],
  ["deplacement", "Déplacement"],
  ["deplacement_connecte", "Déplacement + Connecté"],
] as const;

export const PROGRAM_AUDIENCE_OPTIONS = [
  ["ICC", "ICC"],
  ["EJP", "EJP"],
  ["Toute l'église", "Toute l'église"],
] as const;

/**
 * Options used by the Program editor and Program Models.
 * Values deliberately remain the historical labels stored by the editor so
 * existing programs keep the same data shape while both screens share one
 * source of truth.
 */
export const PROGRAM_EDITOR_TYPE_OPTIONS = PROGRAM_TYPE_OPTIONS.map(([, label]) => [label, label] as const);
export const PROGRAM_EDITOR_FORMAT_OPTIONS = PROGRAM_FORMAT_OPTIONS.map(([, label]) => [label, label] as const);
export const PROGRAM_EDITOR_AUDIENCE_OPTIONS = PROGRAM_AUDIENCE_OPTIONS;

export const PROGRAM_RECURRENCE_OPTIONS = [
  ["ponctuel", "Ponctuel"],
  ["hebdo", "Hebdomadaire"],
  ["bihebdo", "Une semaine sur 2"],
  ["bimensuel", "Bimensuel"],
  ["mensuel", "Mensuel"],
  ["trimestriel", "Trimestriel"],
  ["annuel", "Annuel"],
] as const;

export const PROGRAM_IMPORTANCE_OPTIONS = [
  ["critical", "Critique"],
  ["high", "Importante"],
  ["normal", "Normale"],
  ["low", "Faible"],
] as const;

const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

export function canonicalProgramType(value: string | null | undefined) {
  const v = normalize(value);
  if (["eglise", "église"].includes(v)) return "eglise";
  if (v === "corporate") return "corporate";
  if (["invite", "invitation", "autre église-invitation", "autre église / invitation", "autre eglise-invitation"].includes(v)) return "invite";
  if (["com", "interne com", "interne_com", "communication"].includes(v)) return "com";
  return v;
}

export function programTypeLabel(value: string | null | undefined) {
  const key = canonicalProgramType(value);
  return PROGRAM_TYPE_OPTIONS.find(([v]) => v === key)?.[1] ?? value ?? "—";
}

export function canonicalProgramFormat(value: string | null | undefined) {
  const v = normalize(value);
  if (["presentiel", "présentiel"].includes(v)) return "presentiel";
  if (["online", "en ligne"].includes(v)) return "online";
  if (["both", "présentiel + en ligne", "presentiel + en ligne"].includes(v)) return "both";
  if (["deplacement", "déplacement"].includes(v)) return "deplacement";
  if (["deplacement_connecte", "déplacement + connecté", "deplacement + connecte"].includes(v)) return "deplacement_connecte";
  return v;
}

export function programFormatLabel(value: string | null | undefined) {
  const key = canonicalProgramFormat(value);
  return PROGRAM_FORMAT_OPTIONS.find(([v]) => v === key)?.[1] ?? value ?? "—";
}

export function canonicalProgramRecurrence(value: string | null | undefined) {
  const v = normalize(value);
  if (!v || v === "ponctuel") return "ponctuel";
  if (["hebdo", "weekly", "hebdomadaire"].includes(v)) return "hebdo";
  if (["bihebdo", "biweekly", "1_semaine_sur_2", "une semaine sur 2"].includes(v)) return "bihebdo";
  if (["bimensuel", "bimonthly"].includes(v)) return "bimensuel";
  if (["mensuel", "monthly"].includes(v)) return "mensuel";
  if (["trimestriel", "quarterly"].includes(v)) return "trimestriel";
  if (["annuel", "yearly"].includes(v)) return "annuel";
  return v;
}

export function programRecurrenceLabel(value: string | null | undefined) {
  const key = canonicalProgramRecurrence(value);
  return PROGRAM_RECURRENCE_OPTIONS.find(([v]) => v === key)?.[1] ?? value ?? "Ponctuel";
}

export function canonicalProgramImportance(value: string | null | undefined) {
  const v = normalize(value);
  if (["critical", "critique"].includes(v)) return "critical";
  if (["high", "important", "importante", "haute"].includes(v)) return "high";
  if (["normal", "normale"].includes(v)) return "normal";
  if (["low", "faible", "basse"].includes(v)) return "low";
  return v;
}

export function programImportanceLabel(value: string | null | undefined) {
  const key = canonicalProgramImportance(value);
  return PROGRAM_IMPORTANCE_OPTIONS.find(([v]) => v === key)?.[1] ?? value ?? "—";
}
