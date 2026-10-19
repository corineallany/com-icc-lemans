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
  deadline_override: boolean;
  response_deadline_offset_value: string;
  response_deadline_offset_unit: "hours" | "days";
  response_deadline_anchor: "program" | "slot";
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
  deadline_override: false,
  response_deadline_offset_value: "",
  response_deadline_offset_unit: "hours",
  response_deadline_anchor: "slot",
  pole_id: "",
  memberIds: [],
});

export function ProgramServiceSlotsEditor(props: Props) {
  const update = (key: string, patch: Partial<ServiceSlotDraft>) =>
    props.onChange(props.slots.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)));

  // Copy hours only. Never change the target slot's date.
  const copyPreviousHours = (target: ServiceSlotDraft) => {
    const targetDate = new Date(`${target.service_date}T12:00:00`);
    targetDate.setDate(targetDate.getDate() - 1);
    const previousDate = [
      targetDate.getFullYear(),
      String(targetDate.getMonth() + 1).padStart(2, "0"),
      String(targetDate.getDate()).padStart(2, "0"),
    ].join("-");
    const targetDaySlots = props.slots.filter((slot) => slot.service_date === target.service_date);
    const targetIndex = targetDaySlots.findIndex((slot) => slot.key === target.key);
    const previousDaySlots = props.slots.filter((slot) => slot.service_date === previousDate);
    const source = previousDaySlots[targetIndex];
    if (source?.start_time && source?.end_time) {
      update(target.key, { start_time: source.start_time, end_time: source.end_time });
    }
  };

  const copyHoursForward = (source: ServiceSlotDraft) => {
    if (!source.start_time || !source.end_time) return;
    const sourceDaySlots = props.slots.filter((slot) => slot.service_date === source.service_date);
    const sourceIndex = sourceDaySlots.findIndex((slot) => slot.key === source.key);
    const futureDates = [...new Set(props.slots
      .filter((slot) => slot.service_date > source.service_date)
      .map((slot) => slot.service_date))].sort();
    const targets = new Set(
      futureDates
        .map((date) => props.slots.filter((slot) => slot.service_date === date)[sourceIndex]?.key)
        .filter((key): key is string => !!key),
    );
    props.onChange(
      props.slots.map((slot) =>
        targets.has(slot.key)
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
                    disabled={!slot.service_date || (() => {
                      const d = new Date(`${slot.service_date}T12:00:00`);
                      d.setDate(d.getDate() - 1);
                      const previousDate = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
                      const sameDaySlots = props.slots.filter((s) => s.service_date === slot.service_date);
                      const slotIndex = sameDaySlots.findIndex((s) => s.key === slot.key);
                      const previousSlot = props.slots.filter((s) => s.service_date === previousDate)[slotIndex];
                      return !previousSlot?.start_time || !previousSlot?.end_time;
                    })()}
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
