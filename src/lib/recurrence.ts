export type RecurrenceRule = { weekdays?: number[]; monthDays?: number[] };
export function recurrenceDates(
  start: string,
  until: string,
  frequency: string,
  rule: RecurrenceRule = {},
): string[] {
  if (!start) throw new Error("Choisis la première date.");
  if (!frequency || frequency === "ponctuel") return [start];
  if (!until || until < start)
    throw new Error("Choisis une fin de récurrence après la première date.");
  const first = new Date(start + "T12:00:00Z"),
    last = new Date(until + "T12:00:00Z");
  if (!Number.isFinite(+first) || !Number.isFinite(+last)) throw new Error("Dates invalides.");
  if (+last - +first > 366 * 10 * 86400000) throw new Error("La période est limitée à 10 ans.");
  const supported = [
    "hebdo",
    "1_semaine_sur_2",
    "bihebdo",
    "bimensuel",
    "mensuel",
    "trimestriel",
    "annuel",
  ];
  if (!supported.includes(frequency)) throw new Error("Fréquence non reconnue.");
  const days = rule.weekdays?.length ? rule.weekdays : [first.getUTCDay()];
  const monthDays = rule.monthDays?.length ? rule.monthDays : [1, 15];
  if (
    frequency === "bimensuel" &&
    (monthDays.length !== 2 ||
      new Set(monthDays).size !== 2 ||
      monthDays.some((x) => !Number.isInteger(x) || x < 1 || x > 28))
  )
    throw new Error("Choisis deux jours différents entre 1 et 28.");
  const output: string[] = [];
  for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const offset = Math.round((+d - +first) / 86400000);
    const months =
      (d.getUTCFullYear() - first.getUTCFullYear()) * 12 + d.getUTCMonth() - first.getUTCMonth();
    const monthLength = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    let match = false;
    if (["hebdo", "1_semaine_sur_2", "bihebdo"].includes(frequency)) {
      const week = Math.floor((offset + ((first.getUTCDay() + 6) % 7)) / 7);
      match = days.includes(d.getUTCDay()) && (frequency === "hebdo" || week % 2 === 0);
    } else if (frequency === "bimensuel") match = monthDays.includes(d.getUTCDate());
    else {
      const interval = frequency === "mensuel" ? 1 : frequency === "trimestriel" ? 3 : 12;
      match =
        months % interval === 0 && d.getUTCDate() === Math.min(first.getUTCDate(), monthLength);
    }
    if (match) output.push(d.toISOString().slice(0, 10));
    if (output.length > 104) throw new Error("Limite de 104 occurrences : réduis la période.");
  }
  if (!output.length || output[0] !== start)
    throw new Error("La première date doit correspondre aux jours sélectionnés.");
  return output;
}
