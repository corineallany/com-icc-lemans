import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { recurrenceDates, type RecurrenceRule } from "@/lib/recurrence";

export function RecurrenceFields({
  frequency,
  start,
  until,
  rule,
  onChange,
}: {
  frequency: string;
  start: string;
  until: string;
  rule: RecurrenceRule;
  onChange: (until: string, rule: RecurrenceRule) => void;
}) {
  if (!frequency || frequency === "ponctuel") return null;
  const weekday = start ? new Date(start + "T12:00:00Z").getUTCDay() : 1;
  const days = rule.weekdays?.length ? rule.weekdays : [weekday];
  let preview = "";
  try {
    const dates = recurrenceDates(start, until, frequency, rule);
    preview =
      dates.length +
      " programme(s) dans le planning : " +
      dates
        .slice(0, 6)
        .map((x) => x.split("-").reverse().join("/"))
        .join(", ") +
      (dates.length > 6 ? "…" : "");
  } catch (e) {
    preview = (e as Error).message;
  }
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <label className="block space-y-2">
        <span className="text-sm font-semibold">Répéter jusqu’au (inclus)</span>
        <Input
          type="date"
          min={start}
          value={until}
          onChange={(e) => onChange(e.target.value, rule)}
        />
      </label>
      {["hebdo", "1_semaine_sur_2", "bihebdo"].includes(frequency) ? (
        <div className="flex flex-wrap gap-3">
          {[
            [1, "Lundi"],
            [2, "Mardi"],
            [3, "Mercredi"],
            [4, "Jeudi"],
            [5, "Vendredi"],
            [6, "Samedi"],
            [0, "Dimanche"],
          ].map(([day, label]) => (
            <label key={day} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={days.includes(Number(day))}
                onCheckedChange={(checked) =>
                  onChange(until, {
                    ...rule,
                    weekdays: checked
                      ? [...days, Number(day)]
                      : days.filter((x) => x !== Number(day)),
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      ) : null}
      {frequency === "bimensuel" ? (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <label key={i} className="text-sm">
              Jour du mois {i + 1}
              <Input
                type="number"
                min={1}
                max={28}
                value={(rule.monthDays ?? [1, 15])[i]}
                onChange={(e) => {
                  const next = [...(rule.monthDays ?? [1, 15])];
                  next[i] = Number(e.target.value);
                  onChange(until, { ...rule, monthDays: next });
                }}
              />
            </label>
          ))}
        </div>
      ) : null}
      <p className="text-sm" role="status">
        {preview}
      </p>
      <p className="text-sm text-muted-foreground">
        Les dates sont créées à l’enregistrement. Chaque programme pourra être adapté séparément.
        Une nouvelle génération ajoute uniquement les dates manquantes et ne remplace pas les
        programmes existants.
      </p>
    </div>
  );
}
