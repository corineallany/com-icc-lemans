import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The legacy fields remain in the draft type temporarily so existing saved
 * programmes can be edited safely. The UI for a service slot intentionally
 * exposes only its date and hours; staffing is configured by pole below.
 */
export type ServiceSlotDraft = {
  key: string;
  service_date: string;
  label: string;
  start_time: string;
  end_time: string;
  required_count: number | "";
  pole_id: string;
  memberIds: string[];
};

type Props = {
  enabled: boolean;
  selectionMode: "organizer" | "member";
  slots: ServiceSlotDraft[];
  dates: string[];
  poles: Array<{ id: string; name: string }>;
  members: Array<{ id: string; full_name: string }>;
  links: Array<{ member_id: string; pole_id: string }>;
  onEnabledChange: (enabled: boolean) => void;
  onSelectionModeChange: (mode: "organizer" | "member") => void;
  onChange: (slots: ServiceSlotDraft[]) => void;
};

const makeSlot = (date = ""): ServiceSlotDraft => ({
  key: crypto.randomUUID(),
  service_date: date,
  label: "",
  start_time: "",
  end_time: "",
  required_count: 1,
  pole_id: "",
  memberIds: [],
});

export function ProgramServiceSlotsEditor(props: Props) {
  const update = (key: string, patch: Partial<ServiceSlotDraft>) =>
    props.onChange(props.slots.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)));

  // Copy hours only. Never change the target slot's date.
  const copyPreviousHours = (target: ServiceSlotDraft) => {
    const previous = props.slots
      .filter((slot) => slot.key !== target.key && slot.service_date < target.service_date)
      .sort((a, b) => b.service_date.localeCompare(a.service_date))[0];
    if (!previous) return;
    const sourceOnPreviousDate = props.slots
      .filter((slot) => slot.service_date === previous.service_date)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    const source = sourceOnPreviousDate.find((slot) => slot.start_time && slot.end_time);
    if (source) update(target.key, { start_time: source.start_time, end_time: source.end_time });
  };

  const copyHoursForward = (source: ServiceSlotDraft) => {
    if (!source.start_time || !source.end_time) return;
    props.onChange(
      props.slots.map((slot) =>
        slot.key !== source.key && slot.service_date > source.service_date
          ? { ...slot, start_time: source.start_time, end_time: source.end_time }
          : slot,
      ),
    );
  };

  return (
    <section className="space-y-4 rounded-xl border border-violet-200 p-4">
      <label className="flex items-start gap-3">
        <Checkbox
          checked={props.enabled}
          onCheckedChange={(v) => props.onEnabledChange(v === true)}
        />
        <span>
          <b>Programme avec plusieurs créneaux de service</b>
          <small className="block text-muted-foreground">
            À utiliser même pour un programme d’une seule journée lorsque plusieurs horaires sont nécessaires.
          </small>
        </span>
      </label>
      {props.enabled ? (
        <>
          <div className="rounded-xl bg-muted/40 p-3">
            <p className="text-sm font-semibold">Lors d’une sollicitation</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="flex gap-2 rounded-lg border bg-background p-3 text-sm">
                <Checkbox
                  checked={props.selectionMode === "organizer"}
                  onCheckedChange={() => props.onSelectionModeChange("organizer")}
                />
                <span>
                  <b>Créneaux attribués par l’organisateur</b>
                  <small className="block text-muted-foreground">
                    La personne sollicitée répond pour les créneaux qui lui sont proposés.
                  </small>
                </span>
              </label>
              <label className="flex gap-2 rounded-lg border bg-background p-3 text-sm">
                <Checkbox
                  checked={props.selectionMode === "member"}
                  onCheckedChange={() => props.onSelectionModeChange("member")}
                />
                <span>
                  <b>Laisser le membre choisir ses créneaux</b>
                  <small className="block text-muted-foreground">
                    Le membre choisira dans la fiche du programme, dans « Mes créneaux ».
                  </small>
                </span>
              </label>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-black text-icc-violet">Créneaux du programme</h3>
              <p className="text-xs text-muted-foreground">
                Ici, on définit uniquement la date et les horaires. Les besoins et les membres se règlent par pôle plus bas.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => props.onChange([...props.slots, makeSlot(props.dates[0] ?? "")])}
            >
              <Plus className="size-4" />
              Ajouter
            </Button>
          </div>
          {props.slots.length === 0 ? (
            <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
              Ajoute au moins un créneau.
            </p>
          ) : (
            props.slots.map((slot, index) => (
              <div key={slot.key} className="space-y-3 rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <b>Créneau {index + 1}</b>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => props.onChange(props.slots.filter((s) => s.key !== slot.key))}
                  >
                    <Trash2 className="size-4" />
                    Retirer
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-xs font-semibold">
                    Date
                    <Select
                      value={slot.service_date || undefined}
                      onValueChange={(v) => update(slot.key, { service_date: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choisir une date" />
                      </SelectTrigger>
                      <SelectContent>
                        {props.dates.map((d) => (
                          <SelectItem key={d} value={d}>
                            {new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="text-xs font-semibold">
                    Heure de début
                    <Input
                      type="time"
                      value={slot.start_time}
                      onChange={(e) => update(slot.key, { start_time: e.target.value })}
                    />
                  </label>
                  <label className="text-xs font-semibold">
                    Heure de fin
                    <Input
                      type="time"
                      value={slot.end_time}
                      onChange={(e) => update(slot.key, { end_time: e.target.value })}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!slot.service_date || !props.slots.some((s) => s.service_date < slot.service_date && s.start_time && s.end_time)}
                    onClick={() => copyPreviousHours(slot)}
                  >
                    <Copy className="mr-1 size-3.5" />
                    Mêmes horaires que la veille
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!slot.service_date || !slot.start_time || !slot.end_time || !props.slots.some((s) => s.service_date > slot.service_date)}
                    onClick={() => copyHoursForward(slot)}
                  >
                    <Copy className="mr-1 size-3.5" />
                    Mêmes horaires pour les jours suivants
                  </Button>
                </div>
              </div>
            ))
          )}
        </>
      ) : null}
    </section>
  );
}
