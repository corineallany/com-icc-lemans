import { Checkbox } from "@/components/ui/checkbox";
export function TravelMembers({
  members,
  selected,
  onChange,
}: {
  members: Array<{ id: string; full_name: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">Membres en déplacement</h3>
      <p className="text-sm text-muted-foreground">
        Coche les personnes qui se déplacent. Les autres restent sur place par défaut. Cette
        répartition ne remplace pas les affectations aux pôles et créneaux.
      </p>
      <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
        {members.map((m) => (
          <label key={m.id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
            <Checkbox
              checked={selected.includes(m.id)}
              onCheckedChange={(on) =>
                onChange(on ? [...selected, m.id] : selected.filter((x) => x !== m.id))
              }
            />
            {m.full_name}
          </label>
        ))}
      </div>
      <p className="text-sm">
        {selected.length} en déplacement · {members.filter((m) => !selected.includes(m.id)).length}{" "}
        sur place
      </p>
    </div>
  );
}
