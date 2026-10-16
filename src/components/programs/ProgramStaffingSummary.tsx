import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { solicitationsQuery } from "@/lib/icc";

type Assignment = { id: string; pole_id: string; memberIds: string[]; required_count?: number | null };

export function ProgramStaffingSummary({
  programId,
  assignments,
  poleName,
  isStaff = false,
}: {
  programId: string;
  assignments: Assignment[];
  poleName: Map<string, string>;
  isStaff?: boolean;
}) {
  const solicitations = useQuery(solicitationsQuery);
  const staffing = useQuery({
    queryKey: ["program-staffing", programId, assignments.map((a) => a.id).sort().join(",")],
    enabled: assignments.length > 0,
    queryFn: async () => {
      const db = supabase as any;
      const assignmentIds = assignments.map((a) => a.id);
      const { data: needs, error: needsError } = await db
        .from("program_assignment_slot_needs")
        .select("assignment_id,service_slot_id,required_count")
        .in("assignment_id", assignmentIds);
      if (needsError) throw needsError;

      const slotIds = [...new Set((needs ?? []).map((n: any) => n.service_slot_id))];
      const { data: slots, error: slotsError } = slotIds.length
        ? await db.from("program_service_slots").select("id,program_day_id,start_time,end_time").in("id", slotIds)
        : { data: [], error: null };
      if (slotsError) throw slotsError;

      const dayIds = [...new Set((slots ?? []).map((s: any) => s.program_day_id).filter(Boolean))];
      const { data: days, error: daysError } = dayIds.length
        ? await db.from("program_days").select("id,service_date").in("id", dayIds)
        : { data: [], error: null };
      if (daysError) throw daysError;

      const { data: memberRows, error: memberError } = await db
        .from("program_assignment_members")
        .select("id,assignment_id,member_id,assignment_mode,process_status")
        .in("assignment_id", assignmentIds);
      if (memberError) throw memberError;

      const { data: responses, error: responsesError } = await db
        .from("program_member_responses")
        .select("member_id,status")
        .eq("program_id", programId);
      if (responsesError) throw responsesError;

      const memberIds = (memberRows ?? []).map((m: any) => m.id);
      const { data: memberSlots, error: memberSlotsError } = memberIds.length
        ? await db
            .from("program_assignment_member_slots")
            .select("assignment_member_id,service_slot_id")
            .in("assignment_member_id", memberIds)
            .not("service_slot_id", "is", null)
        : { data: [], error: null };
      if (memberSlotsError) throw memberSlotsError;

      return { needs: needs ?? [], slots: slots ?? [], days: days ?? [], memberRows: memberRows ?? [], memberSlots: memberSlots ?? [], responses: responses ?? [] };
    },
  });

  const open = (solicitations.data ?? []).filter(
    (s: any) => s.program_id === programId && !s.archived && s.status !== "cancelled" && s.status !== "done",
  );
  const data = staffing.data;
  const dayById = new Map((data?.days ?? []).map((day: any) => [day.id, day.service_date]));
  const slotById = new Map((data?.slots ?? []).map((slot: any) => [slot.id, slot]));
  const memberById = new Map((data?.memberRows ?? []).map((member: any) => [member.id, member]));
  const responseByMember = new Map((data?.responses ?? []).map((response: any) => [response.member_id, response.status]));
  const assignedBySlot = new Map<string, Set<string>>();
  for (const row of data?.memberSlots ?? []) {
    const member = memberById.get(row.assignment_member_id);
    if (!member || member.process_status === "covered") continue;
    const response = responseByMember.get(member.member_id);
    const confirmed = member.assignment_mode !== "solicited" || ["available", "accepted", "confirmed"].includes(String(response));
    if (!confirmed) continue;
    const key = `${member.assignment_id}::${row.service_slot_id}`;
    if (!assignedBySlot.has(key)) assignedBySlot.set(key, new Set());
    assignedBySlot.get(key)!.add(member.member_id);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Besoins humains & couverture</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Le besoin est défini par pôle et par créneau. Une personne présente sur plusieurs créneaux couvre un poste sur chacun d’eux, sans être comptée deux fois sur le même créneau.
        </p>
        {assignments.length === 0 ? <p className="text-sm">Aucun pôle mobilisé.</p> : assignments.map((assignment) => {
          const poleNeeds = (data?.needs ?? []).filter((need: any) => need.assignment_id === assignment.id);
          const detailed = poleNeeds.length > 0;
          const required = detailed
            ? poleNeeds.reduce((sum: number, need: any) => sum + Number(need.required_count ?? 0), 0)
            : Number(assignment.required_count ?? 0);
          const covered = detailed
            ? poleNeeds.reduce((sum: number, need: any) => sum + Math.min(
                Number(need.required_count ?? 0),
                assignedBySlot.get(`${assignment.id}::${need.service_slot_id}`)?.size ?? 0,
              ), 0)
            : assignment.memberIds.length;
          const remaining = Math.max(0, required - covered);
          return (
            <div key={assignment.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b>{poleName.get(assignment.pole_id) ?? "Pôle"}</b>
                <Badge variant={required > 0 && remaining > 0 ? "destructive" : "secondary"}>
                  {required > 0 ? `${covered}/${required} postes couverts` : `${covered} membre(s) affecté(s)`}
                </Badge>
              </div>
              {detailed ? (
                <div className="mt-2 space-y-2">
                  {poleNeeds.map((need: any) => {
                    const slot = slotById.get(need.service_slot_id);
                    const date = slot ? dayById.get(slot.program_day_id) : null;
                    const slotCovered = assignedBySlot.get(`${assignment.id}::${need.service_slot_id}`)?.size ?? 0;
                    const slotRequired = Number(need.required_count ?? 0);
                    return (
                      <div key={need.service_slot_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5 text-sm">
                        <span>
                          {date ? new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR") : "Créneau"}
                          {slot?.start_time && slot?.end_time ? ` · ${slot.start_time}–${slot.end_time}` : ""}
                        </span>
                        <span className={slotCovered < slotRequired ? "font-semibold text-destructive" : "font-semibold"}>
                          {slotCovered}/{slotRequired}
                        </span>
                      </div>
                    );
                  })}
                  <p className="text-sm">
                    {remaining ? `⚠️ Il reste ${remaining} poste(s)-créneau à couvrir.` : "✅ Tous les besoins chiffrés sont couverts."}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Besoin détaillé par créneau non renseigné.
                </p>
              )}
              {isStaff && remaining > 0 ? (
                <div className="mt-2 flex gap-2">
                  <Button asChild size="sm"><Link to="/sollicitations">Rechercher {remaining} renfort{remaining > 1 ? "s" : ""}</Link></Button>
                </div>
              ) : null}
            </div>
          );
        })}
        {open.length ? (
          <div className="rounded-xl bg-muted/50 p-3">
            <b>📣 {open.length} sollicitation{open.length > 1 ? "s" : ""} liée{open.length > 1 ? "s" : ""} à ce programme</b>
            <p className="text-sm text-muted-foreground">Renforts et remplacements restent visibles et pilotables dans Sollicitations ponctuelles.</p>
            <Button asChild variant="outline" size="sm" className="mt-2"><Link to="/sollicitations">Voir les sollicitations</Link></Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
