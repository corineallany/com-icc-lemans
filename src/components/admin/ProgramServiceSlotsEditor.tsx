import { Plus, Trash2 } from "lucide-react";
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
            À utiliser même pour un programme d’une seule journée lorsque plusieurs équipes ou
            horaires sont nécessaires.
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
                    Le membre choisira directement dans la fiche du programme, dans le bloc « Mes créneaux ». Le responsable verra ensuite tous les choix reçus avant l’affectation finale.
                  </small>
                </span>
              </label>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-black text-icc-violet">Créneaux du programme</h3>
              <p className="text-xs text-muted-foreground">
                Jour, horaires, besoin et affectations directes éventuelles.
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
            props.slots.map((slot, index) => {
              const candidates = props.members.filter(
                (m) =>
                  !slot.pole_id ||
                  props.links.some((l) => l.member_id === m.id && l.pole_id === slot.pole_id),
              );
              return (
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
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                    <label className="text-xs font-semibold">
                      Jour
                      <Select
                        value={slot.service_date || undefined}
                        onValueChange={(v) => update(slot.key, { service_date: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choisir" />
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
                    <label className="text-xs font-semibold lg:col-span-2">
                      Nom du créneau
                      <Input
                        placeholder="Installation, accueil…"
                        value={slot.label}
                        onChange={(e) => update(slot.key, { label: e.target.value })}
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      Début
                      <Input
                        type="time"
                        value={slot.start_time}
                        onChange={(e) => update(slot.key, { start_time: e.target.value })}
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      Fin
                      <Input
                        type="time"
                        value={slot.end_time}
                        onChange={(e) => update(slot.key, { end_time: e.target.value })}
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      Personnes souhaitées
                      <Input
                        type="number"
                        min={1}
                        value={slot.required_count}
                        onChange={(e) =>
                          update(slot.key, {
                            required_count: e.target.value === "" ? "" : Number(e.target.value),
                          })
                        }
                        onBlur={() => {
                          if (slot.required_count === "" || slot.required_count < 1)
                            update(slot.key, { required_count: 1 });
                        }}
                      />
                    </label>
                  </div>
                  <label className="block text-xs font-semibold">
                    Équipe / pôle (optionnel)
                    <Select
                      value={slot.pole_id || "all"}
                      onValueChange={(v) =>
                        update(slot.key, { pole_id: v === "all" ? "" : v, memberIds: [] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Tous les pôles</SelectItem>
                        {props.poles.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <div>
                    <p className="text-xs font-semibold">Affectation directe (optionnelle)</p>
                    <div className="mt-1 grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
                      {candidates.map((m) => (
                        <label
                          key={m.id}
                          className="flex items-center gap-2 rounded-lg bg-muted/40 p-2 text-sm"
                        >
                          <Checkbox
                            checked={slot.memberIds.includes(m.id)}
                            onCheckedChange={(v) =>
                              update(slot.key, {
                                memberIds:
                                  v === true
                                    ? [...slot.memberIds, m.id]
                                    : slot.memberIds.filter((id) => id !== m.id),
                              })
                            }
                          />
                          {m.full_name}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </>
      ) : null}
    </section>
  );
}
