import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

const dayLabel = (value?: string | null) =>
  value ? new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR") : "Jour à préciser";

type Props = {
  programId: string;
  memberId?: string | null;
  canChoose: boolean;
  isStaff: boolean;
  members: Array<{ id: string; full_name: string }>;
};

export function ProgramMemberSlotChooser({ programId, memberId, canChoose, isStaff, members }: Props) {
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: ["program-member-slot-chooser", programId, memberId],
    queryFn: async () => {
      const db = supabase as any;
      const [slotRes, dayRes, assignmentRes, choiceRes, membershipRes] = await Promise.all([
        db
          .from("program_service_slots")
          .select("id,label,start_time,end_time,required_count,assignment_id,program_day_id,position")
          .eq("program_id", programId)
          .order("position"),
        db.from("program_days").select("id,service_date").eq("program_id", programId),
        db.from("program_assignments").select("id,pole_id").eq("program_id", programId),
        db
          .from("program_member_slot_choices")
          .select("id,member_id,service_slot_id,created_at")
          .eq("program_id", programId),
        memberId
          ? db.from("member_poles").select("pole_id").eq("member_id", memberId)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const error = slotRes.error || dayRes.error || assignmentRes.error || choiceRes.error || membershipRes.error;
      if (error) throw error;
      return {
        slots: slotRes.data ?? [],
        days: dayRes.data ?? [],
        assignments: assignmentRes.data ?? [],
        choices: choiceRes.data ?? [],
        memberships: membershipRes.data ?? [],
      };
    },
  });

  const selectedIds = useMemo(
    () =>
      new Set(
        (data.data?.choices ?? [])
          .filter((x: any) => x.member_id === memberId)
          .map((x: any) => x.service_slot_id),
      ),
    [data.data?.choices, memberId],
  );

  const toggle = useMutation({
    mutationFn: async ({ slotId, checked }: { slotId: string; checked: boolean }) => {
      if (!memberId) throw new Error("Compte non lié à un membre.");
      const db = supabase as any;
      if (checked) {
        const { error } = await db.from("program_member_slot_choices").insert({
          program_id: programId,
          member_id: memberId,
          service_slot_id: slotId,
        });
        if (error && !String(error.code ?? "").includes("23505")) throw error;
      } else {
        const { error } = await db
          .from("program_member_slot_choices")
          .delete()
          .eq("program_id", programId)
          .eq("member_id", memberId)
          .eq("service_slot_id", slotId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program-member-slot-chooser", programId] });
      toast.success("Choix de créneau enregistré");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (data.isLoading || !data.data?.slots.length) return null;

  const dayById = new Map(data.data.days.map((d: any) => [d.id, d.service_date]));
  const poleByAssignment = new Map(data.data.assignments.map((a: any) => [a.id, a.pole_id]));
  const myPoles = new Set(data.data.memberships.map((x: any) => x.pole_id));
  const eligibleSlots = data.data.slots.filter((slot: any) => {
    if (!slot.assignment_id) return true;
    const poleId = poleByAssignment.get(slot.assignment_id);
    return !!poleId && myPoles.has(poleId);
  });
  const nameById = new Map(members.map((m) => [m.id, m.full_name]));

  return (
    <div className="space-y-4">
      {memberId && canChoose ? (
        <section className="rounded-xl border border-violet-200 bg-violet-50/30 p-4">
          <div className="mb-3">
            <h3 className="font-black text-icc-violet">Mes créneaux</h3>
            <p className="text-sm text-muted-foreground">
              Le responsable a choisi de laisser les membres indiquer leurs créneaux. Coche ceux qui te conviennent : ton choix est enregistré immédiatement et reste modifiable tant que le programme est ouvert.
            </p>
          </div>
          {eligibleSlots.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {eligibleSlots.map((slot: any) => {
                const checked = selectedIds.has(slot.id);
                return (
                  <label key={slot.id} className="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3">
                    <Checkbox
                      checked={checked}
                      disabled={toggle.isPending}
                      onCheckedChange={(v) => toggle.mutate({ slotId: slot.id, checked: v === true })}
                    />
                    <span className="min-w-0">
                      <b className="block">{slot.label || "Créneau"}</b>
                      <span className="text-sm text-muted-foreground">
                        {dayLabel(dayById.get(slot.program_day_id))} · {slot.start_time}–{slot.end_time}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun créneau correspondant à ton pôle pour le moment.</p>
          )}
          {selectedIds.size ? (
            <p className="mt-3 text-xs font-semibold text-icc-violet">
              {selectedIds.size} créneau{selectedIds.size > 1 ? "x" : ""} sélectionné{selectedIds.size > 1 ? "s" : ""}.
            </p>
          ) : null}
        </section>
      ) : null}

      {isStaff ? (
        <section className="rounded-xl border p-4">
          <div className="mb-3">
            <h3 className="font-black text-icc-violet">Choix de créneaux reçus</h3>
            <p className="text-xs text-muted-foreground">
              Ces choix sont des disponibilités exprimées par les membres ; ils ne remplacent pas l’affectation finale du responsable.
            </p>
          </div>
          <div className="space-y-2">
            {data.data.slots.map((slot: any) => {
              const choices = data.data!.choices.filter((x: any) => x.service_slot_id === slot.id);
              return (
                <div key={slot.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 p-3 text-sm">
                  <span>
                    <b>{slot.label || "Créneau"}</b>
                    <span className="block text-xs text-muted-foreground">
                      {dayLabel(dayById.get(slot.program_day_id))} · {slot.start_time}–{slot.end_time}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {choices.length ? choices.map((choice: any) => (
                      <Badge key={choice.id} variant="secondary">{nameById.get(choice.member_id) ?? choice.member_id}</Badge>
                    )) : <span className="text-xs text-muted-foreground">Aucun choix reçu</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
