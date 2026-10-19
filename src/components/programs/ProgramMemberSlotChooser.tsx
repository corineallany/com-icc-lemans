import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const dayLabel = (value?: string | null) =>
  value ? new Date(value + "T12:00:00").toLocaleDateString("fr-FR") : "Jour à préciser";

type Props = {
  programId: string;
  memberId?: string | null;
  canChoose: boolean;
  isStaff: boolean;
  members: Array<{ id: string; full_name: string }>;
  poles: Array<{ id: string; name: string }>;
};

export function ProgramMemberSlotChooser({ programId, memberId, canChoose, isStaff, members, poles }: Props) {
  const qc = useQueryClient();
  const [assignmentByChoice, setAssignmentByChoice] = useState<Record<string, string>>({});
  const data = useQuery({
    queryKey: ["program-member-slot-chooser", programId, memberId],
    queryFn: async () => {
      const db = supabase as any;
      const [slotRes, dayRes, assignmentRes, choiceRes, membershipRes] = await Promise.all([
        db.from("program_service_slots").select("id,label,start_time,end_time,required_count,assignment_id,program_day_id,position").eq("program_id", programId).order("position"),
        db.from("program_days").select("id,service_date").eq("program_id", programId),
        db.from("program_assignments").select("id,pole_id").eq("program_id", programId),
        db.from("program_member_slot_choices").select("id,member_id,service_slot_id,created_at").eq("program_id", programId),
        db.from("member_poles").select("member_id,pole_id"),
      ]);
      const assignmentIds = (assignmentRes.data ?? []).map((x: any) => x.id);
      const [needRes, participationRes, linkRes] = assignmentIds.length ? await Promise.all([
        db.from("program_assignment_slot_needs").select("assignment_id,service_slot_id,required_count").in("assignment_id", assignmentIds),
        db.from("program_assignment_members").select("id,assignment_id,member_id,assignment_mode,process_status").in("assignment_id", assignmentIds),
        db.from("program_assignment_member_slots").select("assignment_member_id,service_slot_id"),
      ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
      const error = slotRes.error || dayRes.error || assignmentRes.error || choiceRes.error || membershipRes.error || needRes.error || participationRes.error || linkRes.error;
      if (error) throw error;
      return {
        slots: slotRes.data ?? [],
        days: dayRes.data ?? [],
        assignments: assignmentRes.data ?? [],
        choices: choiceRes.data ?? [],
        memberships: membershipRes.data ?? [],
        needs: needRes.data ?? [],
        participation: participationRes.data ?? [],
        slotLinks: linkRes.data ?? [],
      };
    },
  });

  const selectedIds = useMemo(
    () => new Set((data.data?.choices ?? []).filter((x: any) => x.member_id === memberId).map((x: any) => x.service_slot_id)),
    [data.data?.choices, memberId],
  );

  const toggle = useMutation({
    mutationFn: async ({ slotId, checked }: { slotId: string; checked: boolean }) => {
      if (!memberId) throw new Error("Compte non lié à un membre.");
      const db = supabase as any;
      if (checked) {
        const { error } = await db.from("program_member_slot_choices").insert({ program_id: programId, member_id: memberId, service_slot_id: slotId });
        if (error && !String(error.code ?? "").includes("23505")) throw error;
      } else {
        const { error } = await db.from("program_member_slot_choices").delete().eq("program_id", programId).eq("member_id", memberId).eq("service_slot_id", slotId);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["program-member-slot-chooser", programId] });
      toast.success("Choix de créneau enregistré");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const submitAvailability = useMutation({
    mutationFn: async () => {
      if (!memberId || !selectedIds.size) throw new Error("Sélectionne au moins un créneau avant d’envoyer tes disponibilités.");
      const { error } = await (supabase as any).rpc("respond_to_program_solicitation", {
        p_program_id: programId,
        p_status: "partial",
        p_note: "Créneaux sélectionnés : " + data.data!.slots
          .filter((slot: any) => selectedIds.has(slot.id))
          .map((slot: any) => {
            const date = dayLabel(data.data!.days.find((d: any) => d.id === slot.program_day_id)?.service_date);
            return date + " " + slot.start_time + "–" + slot.end_time;
          }).join(", "),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      for (const key of ["program-member-slot-chooser", "program-responses", "program-sheet-participation-modes", "program-responses-summary", "notifications"]) {
        await qc.invalidateQueries({ queryKey: [key, programId] });
      }
      toast.success("Tes disponibilités ont été envoyées au responsable.");
    },
    onError: (e: any) => toast.error(e.message || "Impossible d’envoyer tes disponibilités."),
  });

  const assignChoice = useMutation({
    mutationFn: async ({ choice, assignmentId }: { choice: any; assignmentId: string }) => {
      if (!isStaff || !data.data) throw new Error("Action réservée aux responsables autorisés.");
      const db = supabase as any;
      const slot = data.data.slots.find((s: any) => s.id === choice.service_slot_id);
      const assignment = data.data.assignments.find((a: any) => a.id === assignmentId);
      const need = data.data.needs.find((n: any) => n.assignment_id === assignmentId && n.service_slot_id === choice.service_slot_id);
      if (!slot || !assignment || !need) throw new Error("Aucun besoin enregistré pour ce pôle et ce créneau.");
      const isMemberOfPole = data.data.memberships.some((m: any) => m.member_id === choice.member_id && m.pole_id === assignment.pole_id);
      if (!isMemberOfPole) throw new Error("Cette personne n’est pas rattachée au pôle choisi.");
      const linkedIds = new Set(data.data.slotLinks.filter((l: any) => l.service_slot_id === slot.id).map((l: any) => l.assignment_member_id));
      const activeRows = data.data.participation.filter((p: any) =>
        p.assignment_id === assignmentId &&
        ["direct", "proposal"].includes(p.assignment_mode) &&
        p.process_status !== "covered" &&
        linkedIds.has(p.id)
      );
      if (activeRows.length >= Number(need.required_count)) throw new Error("Le besoin de ce créneau est déjà couvert.");
      const existing = data.data.participation.find((p: any) => p.assignment_id === assignmentId && p.member_id === choice.member_id);
      let assignmentMemberId = existing?.id;
      if (existing?.assignment_mode === "solicited" && existing.process_status !== "covered") {
        const { error } = await db.rpc("confirm_program_solicitation", { p_assignment_member_id: existing.id });
        if (error) throw error;
      } else if (!existing) {
        const { error } = await db.rpc("direct_assign_program_member", { p_assignment_id: assignmentId, p_member_id: choice.member_id, p_source: "direct" });
        if (error) throw error;
        const { data: created, error: readError } = await db.from("program_assignment_members").select("id").eq("assignment_id", assignmentId).eq("member_id", choice.member_id).maybeSingle();
        if (readError) throw readError;
        assignmentMemberId = created?.id;
      } else if (existing.process_status === "covered") {
        throw new Error("Cette participation est déjà clôturée. Vérifie son statut avant de l’affecter.");
      }
      if (!assignmentMemberId) throw new Error("Impossible de retrouver la participation créée.");
      const alreadyLinked = data.data.slotLinks.some((l: any) => l.assignment_member_id === assignmentMemberId && l.service_slot_id === slot.id);
      if (!alreadyLinked) {
        const { error } = await db.from("program_assignment_member_slots").insert({
          assignment_member_id: assignmentMemberId,
          service_slot_id: slot.id,
          program_day_id: slot.program_day_id,
          start_time: slot.start_time,
          end_time: slot.end_time,
        });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["program-member-slot-chooser", programId] });
      for (const key of ["program-assignment-modes", "program-proposals", "program-responses", "program-sheet-participation-modes", "program-staffing-slots", "programs", "notifications"]) {
        await qc.invalidateQueries({ queryKey: [key, programId] });
      }
      toast.success("Affectation du créneau confirmée.");
    },
    onError: (e: any) => toast.error(e.message || "Impossible de confirmer cette affectation."),
  });

  if (data.isLoading || !data.data?.slots.length) return null;

  const dayById = new Map(data.data.days.map((d: any) => [d.id, d.service_date]));
  const poleByAssignment = new Map(data.data.assignments.map((a: any) => [a.id, a.pole_id]));
  const myPoles = new Set(data.data.memberships.filter((x: any) => x.member_id === memberId).map((x: any) => x.pole_id));
  const invitedAssignments = new Set(data.data.participation.filter((p: any) => p.member_id === memberId && p.process_status !== "covered").map((p: any) => p.assignment_id));
  const eligibleSlots = data.data.slots.filter((slot: any) =>
    data.data!.needs.some((need: any) => {
      const poleId = poleByAssignment.get(need.assignment_id);
      return need.service_slot_id === slot.id && invitedAssignments.has(need.assignment_id) && !!poleId && myPoles.has(poleId);
    })
  );
  const nameById = new Map(members.map((m) => [m.id, m.full_name]));

  return (
    <div className="space-y-4">
      {memberId && canChoose ? (
        <section className="rounded-xl border border-violet-200 bg-violet-50/30 p-4">
          <div className="mb-3">
            <h3 className="font-black text-icc-violet">Mes créneaux</h3>
            <p className="text-sm text-muted-foreground">
              Coche les créneaux où tu es disponible. Ton choix est enregistré immédiatement et reste modifiable tant que le programme est ouvert. Il s’agit d’une disponibilité, pas encore d’une affectation confirmée.
            </p>
          </div>
          {eligibleSlots.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {eligibleSlots.map((slot: any) => {
                const checked = selectedIds.has(slot.id);
                return (
                  <label key={slot.id} className="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3">
                    <Checkbox checked={checked} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate({ slotId: slot.id, checked: v === true })} />
                    <span className="min-w-0">
                      <b className="block">{slot.label || "Créneau"}</b>
                      <span className="text-sm text-muted-foreground">{dayLabel(dayById.get(slot.program_day_id))} · {slot.start_time}–{slot.end_time}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun créneau correspondant à un pôle pour lequel tu es sollicité ou mobilisé n’est disponible pour le moment.</p>
          )}
          {selectedIds.size ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold text-icc-violet">{selectedIds.size} créneau(x) sélectionné(s).</p>
              <Button size="sm" disabled={submitAvailability.isPending} onClick={() => submitAvailability.mutate()}>
                {submitAvailability.isPending ? "Envoi…" : "Envoyer mes disponibilités"}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {isStaff ? (
        <section className="rounded-xl border p-4">
          <div className="mb-3">
            <h3 className="font-black text-icc-violet">Choix de créneaux reçus</h3>
            <p className="text-xs text-muted-foreground">Ces choix sont des disponibilités. Sélectionne le pôle à couvrir puis confirme l’affectation : la personne ne sera comptée comme affectée qu’après cette confirmation.</p>
          </div>
          <div className="space-y-2">
            {data.data.slots.map((slot: any) => {
              const choices = data.data!.choices.filter((x: any) => x.service_slot_id === slot.id);
              return (
                <div key={slot.id} className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
                  <div>
                    <b>{slot.label || "Créneau"}</b>
                    <span className="block text-xs text-muted-foreground">{dayLabel(dayById.get(slot.program_day_id))} · {slot.start_time}–{slot.end_time}</span>
                  </div>
                  {choices.length ? choices.map((choice: any) => {
                    const invitedAssignmentIds = new Set(data.data!.participation.filter((p: any) => p.member_id === choice.member_id && p.process_status !== "covered").map((p: any) => p.assignment_id));
                    const eligibleAssignments = data.data!.needs
                      .filter((need: any) => need.service_slot_id === slot.id && invitedAssignmentIds.has(need.assignment_id))
                      .map((need: any) => data.data!.assignments.find((a: any) => a.id === need.assignment_id))
                      .filter((a: any) => a && data.data!.memberships.some((m: any) => m.member_id === choice.member_id && m.pole_id === a.pole_id));
                    const selectedAssignment = assignmentByChoice[choice.id] ?? eligibleAssignments[0]?.id ?? "";
                    return (
                      <div key={choice.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
                        <Badge variant="secondary">{nameById.get(choice.member_id) ?? choice.member_id}</Badge>
                        {eligibleAssignments.length ? (
                          <>
                            <Select value={selectedAssignment} onValueChange={(value) => setAssignmentByChoice((prev) => ({ ...prev, [choice.id]: value }))}>
                              <SelectTrigger className="h-8 min-w-[180px] flex-1"><SelectValue placeholder="Choisir le pôle à affecter" /></SelectTrigger>
                              <SelectContent>
                                {eligibleAssignments.map((a: any) => <SelectItem key={a.id} value={a.id}>{poles.find((p) => p.id === a.pole_id)?.name ?? "Pôle"}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button size="sm" disabled={assignChoice.isPending || !selectedAssignment} onClick={() => assignChoice.mutate({ choice, assignmentId: selectedAssignment })}>Confirmer l’affectation</Button>
                          </>
                        ) : <span className="text-xs text-muted-foreground">Aucun besoin de ce créneau correspondant aux pôles mobilisés de cette personne.</span>}
                      </div>
                    );
                  }) : <span className="text-xs text-muted-foreground">Aucun choix reçu</span>}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
