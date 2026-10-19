import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ProgramMemberSlotChooser } from "@/components/programs/ProgramMemberSlotChooser";

type Assignment = {
  id: string;
  pole_id: string;
  required_count?: number | null;
  memberIds: string[];
};

type Props = {
  programId: string;
  programTitle: string;
  assignments: Assignment[];
  members: any[];
  poles: any[];
};

const stamp = (v: string) =>
  new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v));

const proposalLabel: Record<string, string> = {
  pending: "En attente",
  assigned: "Affectée",
  refused: "Refusée",
  withdrawn: "Retirée",
  covered: "Besoin comblé",
};

export function ProgramParticipationPanel({ programId, assignments, members, poles }: Props) {
  const { member, isStaff } = useCurrentRole();
  const qc = useQueryClient();
  const [note, setNote] = useState<Record<string, string>>({});
  const [direct, setDirect] = useState<Record<string, string[]>>({});
  const [solicit, setSolicit] = useState<Record<string, string[]>>({});
  const [requestDraft, setRequestDraft] = useState<{
    assignmentId: string;
    nature: "reinforcement" | "replacement";
    slotId: string;
    memberIds: string[];
    mission: string;
    count: string;
    deadlineAt: string;
    replacementMemberId: string;
  } | null>(null);
  const [requestPoleId, setRequestPoleId] = useState("");
  const [needEdits, setNeedEdits] = useState<Record<string, string>>({});

  const programConfig = useQuery({
    queryKey: ["program-slot-config", programId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("programs")
        .select("detailed_scheduling,slot_selection_mode")
        .eq("id", programId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const programInfo = useQuery({
    queryKey: ["program-staffing-info", programId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("programs")
        .select("id,title,start_date,start_time,response_deadline,response_deadline_at,response_deadline_offset_value,response_deadline_offset_unit,response_deadline_anchor")
        .eq("id", programId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const serviceSlots = useQuery({
    queryKey: ["program-staffing-slots", programId],
    queryFn: async () => {
      const t = supabase as any;
      const { data: slots, error } = await t.from("program_service_slots")
        .select("id,program_day_id,label,start_time,end_time,response_deadline_at,response_deadline_offset_value,response_deadline_offset_unit,response_deadline_anchor")
        .eq("program_id", programId).order("position");
      if (error) throw error;
      const dayIds = [...new Set((slots ?? []).map((s: any) => s.program_day_id))];
      const { data: days, error: dayError } = dayIds.length
        ? await t.from("program_days").select("id,service_date").in("id", dayIds)
        : { data: [], error: null };
      if (dayError) throw dayError;
      const dayById = new Map((days ?? []).map((d: any) => [d.id, d.service_date]));
      return (slots ?? []).map((s: any) => ({ ...s, service_date: dayById.get(s.program_day_id) ?? null }));
    },
  });

  const slotNeeds = useQuery({
    queryKey: ["program-staffing-needs", programId, assignments.map((a) => a.id).sort().join(",")],
    enabled: assignments.length > 0,
    queryFn: async () => {
      const slotIds = (serviceSlots.data ?? []).map((s: any) => s.id);
      if (!slotIds.length) return [];
      const { data, error } = await (supabase as any).from("program_assignment_slot_needs")
        .select("assignment_id,service_slot_id,required_count")
        .in("assignment_id", assignments.map((a) => a.id)).in("service_slot_id", slotIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const proposals = useQuery({
    queryKey: ["program-proposals", programId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("program_proposals")
        .select("*")
        .eq("program_id", programId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const responses = useQuery({
    queryKey: ["program-responses", programId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("program_member_responses")
        .select("member_id,status,updated_at")
        .eq("program_id", programId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const memberships = useQuery({
    queryKey: ["my-program-poles", member?.id],
    enabled: !!member?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("member_poles")
        .select("pole_id")
        .eq("member_id", member!.id);
      if (error) throw error;
      return new Set((data ?? []).map((x: any) => x.pole_id));
    },
  });

  const poleMemberships = useQuery({
    queryKey: [
      "program-pole-memberships",
      programId,
      assignments.map((a) => a.pole_id).sort().join(","),
    ],
    enabled: assignments.length > 0,
    queryFn: async () => {
      const ids = [...new Set(assignments.map((a) => a.pole_id))];
      const { data, error } = await (supabase as any)
        .from("member_poles")
        .select("member_id,pole_id")
        .in("pole_id", ids);
      if (error) throw error;
      return data ?? [];
    },
  });

  const modes = useQuery({
    queryKey: ["program-assignment-modes", programId],
    queryFn: async () => {
      const ids = assignments.map((a) => a.id);
      if (!ids.length) return [];
      const { data, error } = await (supabase as any)
        .from("program_assignment_members")
        .select(
          "id,assignment_id,member_id,assignment_mode,assigned_at,process_status,process_closed_at,process_closed_reason",
        )
        .in("assignment_id", ids);
      if (error) throw error;
      return data ?? [];
    },
  });

  const assignmentMemberSlots = useQuery({
    queryKey: ["program-staffing-member-slots", programId, (modes.data ?? []).map((x: any) => x.id).sort().join(",")],
    enabled: (modes.data ?? []).length > 0,
    queryFn: async () => {
      const ids = (modes.data ?? []).map((x: any) => x.id);
      if (!ids.length) return [];
      const { data, error } = await (supabase as any).from("program_assignment_member_slots")
        .select("assignment_member_id,service_slot_id")
        .in("assignment_member_id", ids);
      if (error) throw error;
      return data ?? [];
    },
  });

  const names = useMemo(() => new Map(members.map((m) => [m.id, m.full_name])), [members]);
  const activeMembers = useMemo(() => members.filter((m) => m.status === "active" && !m.deleted && !m.archived), [members]);
  const poleNames = useMemo(() => new Map(poles.map((p) => [p.id, p.name])), [poles]);
  const responseMap = useMemo(
    () => new Map((responses.data ?? []).map((r: any) => [r.member_id, r.status])),
    [responses.data],
  );
  const membershipKeys = useMemo(
    () => new Set((poleMemberships.data ?? []).map((x: any) => `${x.pole_id}::${x.member_id}`)),
    [poleMemberships.data],
  );

  const coveredCountForNeed = (need: any, slotId: string) => {
    const rows = (modes.data ?? []).filter((x: any) =>
      x.assignment_id === need.assignment_id &&
      ["direct", "proposal"].includes(x.assignment_mode) &&
      !["covered", "withdrawn", "refused"].includes(x.process_status)
    );
    return rows.filter((row: any) =>
      (assignmentMemberSlots.data ?? []).some((link: any) =>
        link.assignment_member_id === row.id && link.service_slot_id === slotId
      )
    ).length;
  };
  const totalRequired = (slotNeeds.data ?? []).reduce((sum: number, need: any) => sum + Number(need.required_count || 0), 0);
  const totalCovered = (slotNeeds.data ?? []).reduce((sum: number, need: any) => sum + coveredCountForNeed(need, need.service_slot_id), 0);

  const deadlineForSlot = (slotId: string) => {
    const slot = (serviceSlots.data ?? []).find((s: any) => s.id === slotId);
    if (slot?.response_deadline_at) return slot.response_deadline_at;
    const program = programInfo.data;
    if (!program) return "";
    const offset = program.response_deadline_offset_value;
    const unit = program.response_deadline_offset_unit === "days" ? 86400000 : 3600000;
    if (offset == null || !program.response_deadline_anchor) return program.response_deadline_at ?? "";
    const date = program.response_deadline_anchor === "slot" && slot?.service_date ? slot.service_date : program.start_date;
    const time = program.response_deadline_anchor === "slot" && slot?.start_time ? slot.start_time : (program.start_time || "00:00");
    const base = new Date(`${date}T${time}:00`).getTime();
    return Number.isFinite(base) ? new Date(base - Number(offset) * unit).toISOString() : "";
  };

  const canChooseSlots =
    !!member?.id &&
    (modes.data ?? []).some(
      (x: any) => x.member_id === member.id && x.process_status !== "covered",
    );

  const refresh = () => {
    for (const queryKey of [
      ["program-proposals", programId],
      ["program-assignment-modes", programId],
      ["program-responses", programId],
      ["program-pole-memberships", programId],
      ["program-sheet-participation-modes", programId],
      ["programs"],
      ["notifications"],
    ]) {
      qc.invalidateQueries({ queryKey });
    }
  };

  const propose = useMutation({
    mutationFn: async (aid: string) => {
      const { error } = await (supabase as any).rpc("propose_for_program", {
        p_assignment_id: aid,
        p_note: note[aid]?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Proposition envoyée");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: async ({ id, d }: { id: string; d: string }) => {
      const { error } = await (supabase as any).rpc("decide_program_proposal", {
        p_proposal_id: id,
        p_decision: d,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Proposition traitée");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const assign = useMutation({
    mutationFn: async ({ aid, mid }: { aid: string; mid: string }) => {
      const assignment = assignments.find((x) => x.id === aid);
      if (!assignment || !membershipKeys.has(`${assignment.pole_id}::${mid}`)) {
        throw new Error(
          "Ce membre n’est pas rattaché à ce pôle. Pour un renfort d’un autre pôle, utilisez Solliciter.",
        );
      }
      if (
        responseMap.get(mid) === "unavailable" &&
        !window.confirm(
          "Cette personne avait refusé. Confirmer tout de même l’affectation directe ?",
        )
      ) {
        throw new Error("ANNULÉ");
      }
      const { error } = await (supabase as any).rpc("direct_assign_program_member", {
        p_assignment_id: aid,
        p_member_id: mid,
        p_source: "direct",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Affectation directe confirmée");
    },
    onError: (e: any) => {
      if (e.message !== "ANNULÉ") toast.error(e.message);
    },
  });

  const solicitProgram = useMutation({
    mutationFn: async ({ aid, mid }: { aid: string; mid: string }) => {
      const { error } = await (supabase as any).rpc("solicit_program_member", {
        p_assignment_id: aid,
        p_member_id: mid,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Sollicitation de participation envoyée");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancelSolicitation = useMutation({
    mutationFn: async (id: string) => {
      if (!window.confirm("Annuler cette sollicitation de participation ?")) {
        throw new Error("ANNULÉ");
      }
      const { error } = await (supabase as any).rpc("cancel_program_solicitation", {
        p_assignment_member_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Sollicitation annulée");
    },
    onError: (e: any) => {
      if (e.message !== "ANNULÉ") toast.error(e.message);
    },
  });

  const confirmSolicitation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("confirm_program_solicitation", {
        p_assignment_member_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Participation confirmée");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeAssignment = useMutation({
    mutationFn: async (id: string) => {
      if (!window.confirm("Retirer cette affectation ? La place redeviendra disponible.")) {
        throw new Error("ANNULÉ");
      }
      const { error } = await (supabase as any).rpc("remove_direct_program_assignment", {
        p_assignment_member_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Affectation retirée");
    },
    onError: (e: any) => {
      if (e.message !== "ANNULÉ") toast.error(e.message);
    },
  });

  const updateStaffingNeed = useMutation({
    mutationFn: async ({ assignmentId, slotId, count }: { assignmentId: string; slotId: string; count: number }) => {
      if (!isStaff) throw new Error("Action réservée aux responsables autorisés.");
      if (!Number.isInteger(count) || count < 1) throw new Error("Le besoin doit être au moins égal à une personne.");
      const { error } = await (supabase as any).from("program_assignment_slot_needs")
        .update({ required_count: count, updated_at: new Date().toISOString() })
        .eq("assignment_id", assignmentId).eq("service_slot_id", slotId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program-staffing-needs", programId] });
      qc.invalidateQueries({ queryKey: ["programs"] });
      toast.success("Besoin du créneau mis à jour.");
    },
    onError: (e: any) => toast.error(e.message || "Impossible de modifier le besoin."),
  });

  const createSupportRequest = useMutation({
    mutationFn: async () => {
      const draft = requestDraft;
      if (!draft) throw new Error("Choisis un besoin à traiter.");
      if (!member?.id) throw new Error("Ton compte doit être lié à un membre.");
      if (!requestPoleId) throw new Error("Choisis le pôle qui recevra le renfort.");
      if (!draft.mission.trim()) throw new Error("Précise la mission à réaliser.");
      if (!draft.memberIds.length) throw new Error("Sélectionne au moins un membre à solliciter.");
      const slot = (serviceSlots.data ?? []).find((s: any) => s.id === draft.slotId);
      const program = programInfo.data;
      if (!program) throw new Error("Impossible de retrouver le programme.");
      const deadlineAt = draft.deadlineAt ? new Date(draft.deadlineAt) : null;
      if (deadlineAt && Number.isNaN(deadlineAt.getTime())) throw new Error("La date limite est invalide.");
      const id = `sp_${crypto.randomUUID()}`;
      const targetId = `target_${crypto.randomUUID()}`;
      const targetName = poleNames.get(requestPoleId) ?? "Pôle";
      const deadlineIso = deadlineAt?.toISOString() ?? null;
      const deadlineDate = deadlineAt ? [deadlineAt.getFullYear(), String(deadlineAt.getMonth() + 1).padStart(2, "0"), String(deadlineAt.getDate()).padStart(2, "0")].join("-") : (slot?.service_date ?? program.start_date ?? null);
      const payload: any = {
        id,
        requester: member.full_name,
        requester_member_id: member.id,
        created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        event_name: program.title,
        event_date: slot?.service_date ?? program.start_date,
        message: draft.mission.trim(),
        mode: "programme",
        status: "pending",
        target_type: "pole",
        target_name: targetName,
        target_pole_id: requestPoleId,
        requested_pole_id: requestPoleId,
        program_id: programId,
        replacement_member_id: draft.nature === "replacement" ? (draft.replacementMemberId || null) : null,
        nature: draft.nature,
        response_deadline: deadlineDate,
        response_deadline_at: deadlineIso,
        request_mission: draft.mission.trim(),
        request_count: draft.nature === "replacement" ? 1 : Math.max(1, Number(draft.count) || 1),
        request_slot_id: slot?.id ?? null,
        slot_selection_mode: "organizer",
        offered_slot_ids: slot?.id ? [slot.id] : [],
      };
      const { error: insertError } = await (supabase as any).from("solicitations").insert(payload);
      if (insertError) throw insertError;
      const { error: targetError } = await (supabase as any).from("solicitation_targets").insert({
        id: targetId, solicitation_id: id, target_type: "pole", target_id: requestPoleId,
        target_name: targetName, need: draft.mission.trim(),
        required_count: draft.nature === "replacement" ? 1 : Math.max(1, Number(draft.count) || 1),
      });
      if (targetError) throw targetError;
      const recipientRows = draft.memberIds.map((member_id) => ({
        solicitation_id: id, recipient_type: "member", member_id, response: "pending", target_id: targetId,
      }));
      const { error: recipientsError } = await (supabase as any).from("solicitation_recipients").insert(recipientRows);
      if (recipientsError) throw recipientsError;
      const { error: mappingError } = await (supabase as any).from("solicitation_recipient_targets").insert(
        draft.memberIds.map((member_id) => ({ solicitation_id: id, member_id, target_id: targetId })),
      );
      if (mappingError) throw mappingError;
      return id;
    },
    onSuccess: async () => {
      setRequestDraft(null);
      setRequestPoleId("");
      for (const queryKey of [["solicitations"], ["solicitation-targets"], ["solicitation-recipients"], ["programs"], ["notifications"]]) {
        await qc.invalidateQueries({ queryKey });
      }
      toast.success("Demande créée dans Demandes ponctuelles avec les informations du programme.");
    },
    onError: (e: any) => toast.error(e.message || "Impossible de créer la demande."),
  });

  const openSupportRequest = (assignmentId: string, nature: "reinforcement" | "replacement", slotId = "", replacementMemberId = "") => {
    const slot = (serviceSlots.data ?? []).find((s: any) => s.id === slotId);
    const program = programInfo.data;
    const initialDeadline = deadlineForSlot(slotId) || slot?.response_deadline_at || program?.response_deadline_at || "";
    const deadlineLocal = initialDeadline ? new Date(initialDeadline).toISOString().slice(0, 16) : "";
    setRequestPoleId(assignments.find((a) => a.id === assignmentId)?.pole_id ?? "");
    setRequestDraft({
      assignmentId, nature, slotId, memberIds: [], mission: "",
      count: "1", deadlineAt: deadlineLocal, replacementMemberId,
    });
  };

  const withdraw = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("withdraw_program_proposal", {
        p_proposal_id: id,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return (
    <div className="mt-4 space-y-3 rounded-xl border bg-muted/10 p-4">
      <div>
        <h3 className="font-black text-icc-violet">Participation & besoins</h3>
        <p className="text-xs text-muted-foreground">
          Affectation directe = aucune réponse demandée. Sollicitation = demande de participation
          liée à ce programme, avec réponse du membre. Le choix des créneaux reste indépendant.
        </p>
      </div>

      {programConfig.data?.detailed_scheduling &&
      programConfig.data?.slot_selection_mode === "member" ? (
        <ProgramMemberSlotChooser
          programId={programId}
          memberId={member?.id}
          canChoose={canChooseSlots}
          isStaff={isStaff}
          members={members}
        />
      ) : null}

      {isStaff ? (
        <div className="grid gap-3 rounded-lg border bg-background p-3 sm:grid-cols-2 xl:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Besoin initial par créneau</p><p className="text-xl font-black">{totalRequired}</p></div>
          <div><p className="text-xs text-muted-foreground">Places couvertes</p><p className="text-xl font-black">{totalCovered}</p></div>
          <div><p className="text-xs text-muted-foreground">À couvrir</p><p className="text-xl font-black">{Math.max(0, totalRequired - totalCovered)}</p></div>
          <div><p className="text-xs text-muted-foreground">Réponses en attente</p><p className="text-xl font-black">{(modes.data ?? []).filter((x: any) => x.assignment_mode === "solicited" && x.process_status !== "covered" && !["available", "partial", "unavailable"].includes(responseMap.get(x.member_id))).length + (proposals.data ?? []).filter((p: any) => p.status === "pending").length}</p></div>
        </div>
      ) : null}

      {isStaff && (serviceSlots.data ?? []).length ? (
        <div className="space-y-2 rounded-lg border bg-background p-3">
          <h4 className="font-bold">Besoins par créneau</h4>
          {(serviceSlots.data ?? []).map((slot: any) => {
            const needs = (slotNeeds.data ?? []).filter((n: any) => n.service_slot_id === slot.id);
            if (!needs.length) return null;
            return <div key={slot.id} className="rounded-md bg-muted/30 p-2">
              <div className="font-semibold text-sm">{slot.service_date ? new Date(`${slot.service_date}T12:00:00`).toLocaleDateString("fr-FR") : "Date à préciser"} · {slot.label || `${slot.start_time}–${slot.end_time}`}</div>
              {needs.map((need: any) => {
                const assignment = assignments.find((x) => x.id === need.assignment_id);
                if (!assignment) return null;
                const slotCount = coveredCountForNeed(need, slot.id);
                const pendingCount = (modes.data ?? []).filter((m: any) => m.assignment_id === need.assignment_id && m.assignment_mode === "solicited" && m.process_status !== "covered").length;
                return <div key={need.assignment_id} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{poleNames.get(assignment.pole_id) ?? "Pôle"} : <b>{slotCount}/{need.required_count}</b> affecté(s) · {Math.max(0, Number(need.required_count) - slotCount)} à couvrir{pendingCount ? ` · ${pendingCount} sollicitation(s) en attente` : ""}</span>
                  <div className="flex items-center gap-1">
                    <Input className="h-8 w-20" aria-label={`Besoin ${poleNames.get(assignment.pole_id) ?? "du pôle"}`} type="number" min={1} step={1} value={needEdits[`${need.assignment_id}::${slot.id}`] ?? String(need.required_count)} onChange={(e) => setNeedEdits((v) => ({ ...v, [`${need.assignment_id}::${slot.id}`]: e.target.value }))} />
                    <Button size="sm" variant="outline" disabled={updateStaffingNeed.isPending || Number(needEdits[`${need.assignment_id}::${slot.id}`] ?? need.required_count) === Number(need.required_count)} onClick={() => updateStaffingNeed.mutate({ assignmentId: need.assignment_id, slotId: slot.id, count: Number(needEdits[`${need.assignment_id}::${slot.id}`] ?? need.required_count) })}>Enregistrer</Button>
                    {slotCount < Number(need.required_count) ? <Button size="sm" variant="outline" onClick={() => openSupportRequest(assignment.id, "reinforcement", slot.id)}>Demander un renfort</Button> : null}
                  </div>
                </div>;
              })}
            </div>;
          })}
        </div>
      ) : null}

      {assignments.map((a) => {
        const required = a.required_count || 0;
        const rows = (modes.data ?? []).filter((x: any) => x.assignment_id === a.id);
        const confirmed = rows.filter(
          (x: any) =>
            ["direct", "proposal"].includes(x.assignment_mode) && x.process_status !== "covered",
        );
        const solicited = rows.filter((x: any) => x.assignment_mode === "solicited");
        const props = (proposals.data ?? []).filter((p: any) => p.assignment_id === a.id);
        const pending = props.filter((p: any) => p.status === "pending");
        const covered = required > 0 && confirmed.length >= required;
        const mine = pending.find((p: any) => p.member_id === member?.id);
        const myPole = !!memberships.data?.has(a.pole_id);
        const confirmedIds = new Set(confirmed.map((x: any) => x.member_id));
        const activeRowIds = new Set(
          rows.filter((x: any) => x.process_status !== "covered").map((x: any) => x.member_id),
        );

        const directCandidates = members.filter(
          (m) =>
            m.status === "active" &&
            !m.deleted &&
            !m.archived &&
            !confirmedIds.has(m.id) &&
            membershipKeys.has(`${a.pole_id}::${m.id}`),
        );

        const solicitationCandidates = members.filter(
          (m) =>
            m.status === "active" &&
            !m.deleted &&
            !m.archived &&
            !activeRowIds.has(m.id),
        );

        return (
          <div key={a.id} className="rounded-lg border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>{poleNames.get(a.pole_id) ?? "Pôle"}</b>
              {required > 0 ? (
                <Badge variant={covered ? "secondary" : "destructive"}>
                  {covered
                    ? `Besoin comblé · ${confirmed.length}/${required}`
                    : `${confirmed.length}/${required} confirmé${confirmed.length > 1 ? "s" : ""}`}
                </Badge>
              ) : null}
            </div>

            <div className="mt-2 space-y-1 text-sm">
              {confirmed.map((x: any) => (
                <div
                  key={x.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md py-1"
                >
                  <span>
                    ✓ <b>{names.get(x.member_id) ?? x.member_id}</b> ·{" "}
                    {x.assignment_mode === "direct"
                      ? "Affecté directement · aucune réponse requise"
                      : "Proposition acceptée"}
                  </span>
                  {isStaff ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeAssignment.mutate(x.id)}
                    >
                      Retirer l’affectation
                    </Button>
                  ) : null}
                </div>
              ))}

              {solicited.map((x: any) => {
                const response = responseMap.get(x.member_id);
                const closed = x.process_status === "covered";
                const label = closed
                  ? "Besoin comblé · sollicitation clôturée"
                  : response === "available"
                    ? "A accepté · confirmation du responsable attendue"
                    : response === "partial"
                      ? "A accepté partiellement · à traiter"
                      : response === "unavailable"
                        ? "A refusé"
                        : "En attente de réponse";
                return (
                  <div
                    key={x.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-md py-1 ${closed ? "text-muted-foreground" : ""}`}
                  >
                    <span>
                      {closed ? "○" : "⏳"} <b>{names.get(x.member_id) ?? x.member_id}</b> · {label}
                    </span>
                    {isStaff && !closed ? (
                      <span className="flex flex-wrap gap-1">
                        {response === "available" || response === "partial" ? (
                          <Button size="sm" onClick={() => confirmSolicitation.mutate(x.id)}>
                            Confirmer l’affectation
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => cancelSolicitation.mutate(x.id)}
                        >
                          Annuler la sollicitation
                        </Button>
                      </span>
                    ) : null}
                  </div>
                );
              })}

              {props.map((p: any) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5"
                >
                  <span>
                    🙋 <b>{names.get(p.member_id) ?? p.member_id}</b> · proposition {stamp(p.created_at)} ·{" "}
                    {proposalLabel[p.status] ?? p.status}
                  </span>
                  {isStaff && p.status === "pending" ? (
                    <span className="flex items-center gap-1">
                      {p.note ? (
                        <span className="mr-2 text-xs text-muted-foreground">Note : {p.note}</span>
                      ) : null}
                      <Button size="sm" onClick={() => decide.mutate({ id: p.id, d: "assigned" })}>
                        Affecter
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decide.mutate({ id: p.id, d: "refused" })}
                      >
                        Refuser
                      </Button>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            {myPole && !covered && !confirmedIds.has(member?.id ?? "") && !mine ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Textarea
                  className="min-h-9"
                  placeholder="Note facultative (visible uniquement par le Référent/Direction)"
                  value={note[a.id] ?? ""}
                  onChange={(e) => setNote((v) => ({ ...v, [a.id]: e.target.value }))}
                />
                <Button onClick={() => propose.mutate(a.id)}>🙋 Je me propose</Button>
              </div>
            ) : null}

            {mine ? (
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={() => withdraw.mutate(mine.id)}>
                  Retirer ma proposition
                </Button>
              </div>
            ) : null}

            {isStaff && (!covered || confirmed.length > 0) ? (
              <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                {!covered ? <Button size="sm" onClick={() => openSupportRequest(a.id, "reinforcement")}>Demander un renfort</Button> : null}
                {confirmed.map((x: any) => (
                  <Button key={`replace-${x.id}`} size="sm" variant="outline" onClick={() => openSupportRequest(a.id, "replacement", "", x.member_id)}>
                    Demander le remplacement de {names.get(x.member_id) ?? "la personne affectée"}
                  </Button>
                ))}
              </div>
            ) : null}
            {isStaff && !covered ? (
              <div className="mt-3 grid gap-3 border-t pt-3 lg:grid-cols-2">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs font-black">Affecter directement</p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Membre du pôle uniquement. Participation immédiate, aucune réponse demandée.
                  </p>
                  <div className="space-y-2">
                    <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border bg-background p-2">
                      {directCandidates.map((m) => <label key={m.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={(direct[a.id] ?? []).includes(m.id)} onChange={(e) => setDirect((v) => ({ ...v, [a.id]: e.target.checked ? [...(v[a.id] ?? []), m.id] : (v[a.id] ?? []).filter((id) => id !== m.id) }))} />
                        {m.full_name}
                      </label>)}
                      {!directCandidates.length ? <p className="text-xs text-muted-foreground">Aucun membre disponible dans ce pôle.</p> : null}
                    </div>
                    <Button size="sm" disabled={!(direct[a.id] ?? []).length} onClick={() => (direct[a.id] ?? []).forEach((mid) => assign.mutate({ aid: a.id, mid }))}>
                      Affecter les { (direct[a.id] ?? []).length || "" } membre(s) sélectionné(s) sans réponse
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs font-black">Solliciter</p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Demande liée à ce programme et à ce besoin. Le membre doit répondre. Un renfort
                    d’un autre pôle est possible ici.
                  </p>
                  <div className="space-y-2">
                    <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border bg-background p-2">
                      {solicitationCandidates.map((m) => <label key={m.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={(solicit[a.id] ?? []).includes(m.id)} onChange={(e) => setSolicit((v) => ({ ...v, [a.id]: e.target.checked ? [...(v[a.id] ?? []), m.id] : (v[a.id] ?? []).filter((id) => id !== m.id) }))} />
                        {m.full_name}
                      </label>)}
                      {!solicitationCandidates.length ? <p className="text-xs text-muted-foreground">Aucun autre membre disponible à solliciter.</p> : null}
                    </div>
                    <Button size="sm" variant="outline" disabled={!(solicit[a.id] ?? []).length} onClick={() => (solicit[a.id] ?? []).forEach((mid) => solicitProgram.mutate({ aid: a.id, mid }))}>
                      Solliciter les { (solicit[a.id] ?? []).length || "" } membre(s) sélectionné(s)
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      <Dialog open={!!requestDraft} onOpenChange={(open) => { if (!open) setRequestDraft(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{requestDraft?.nature === "replacement" ? "Demander un remplacement" : "Demander un renfort"}</DialogTitle>
            <DialogDescription>
              Les informations du programme sont reprises automatiquement. La demande sera créée dans « Demandes ponctuelles ».
            </DialogDescription>
          </DialogHeader>
          {requestDraft ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium">Pôle dans lequel aider
                  <select className="h-10 w-full rounded-md border bg-background px-3" value={requestPoleId} onChange={(e) => setRequestPoleId(e.target.value)}>
                    {poles.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium">Créneau concerné
                  <select className="h-10 w-full rounded-md border bg-background px-3" value={requestDraft.slotId} onChange={(e) => {
                    const slot = (serviceSlots.data ?? []).find((s: any) => s.id === e.target.value);
                    const deadline = deadlineForSlot(e.target.value) || slot?.response_deadline_at || programInfo.data?.response_deadline_at || "";
                    setRequestDraft({ ...requestDraft, slotId: e.target.value, deadlineAt: deadline ? new Date(deadline).toISOString().slice(0,16) : requestDraft.deadlineAt });
                  }}>
                    <option value="">Tout le programme / aucun créneau précis</option>
                    {(serviceSlots.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.service_date ? new Date(`${s.service_date}T12:00:00`).toLocaleDateString("fr-FR") : ""} · {s.label || `${s.start_time}–${s.end_time}`}</option>)}
                  </select>
                </label>
              </div>
              {requestDraft.nature === "replacement" ? (
                <div className="rounded-md bg-muted/40 p-3 text-sm">Personne à remplacer : <b>{names.get(requestDraft.replacementMemberId) ?? "Personne affectée"}</b></div>
              ) : (
                <label className="block space-y-1 text-sm font-medium">Nombre de personnes recherchées
                  <Input type="number" min={1} value={requestDraft.count} onChange={(e) => setRequestDraft({ ...requestDraft, count: e.target.value })} />
                </label>
              )}
              <label className="block space-y-1 text-sm font-medium">Mission à réaliser
                <Textarea value={requestDraft.mission} onChange={(e) => setRequestDraft({ ...requestDraft, mission: e.target.value })} placeholder="Précise les tâches, le rôle attendu et les informations utiles." />
              </label>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2"><b className="text-sm">Membres à solliciter</b><span className="text-xs text-muted-foreground">{requestDraft.memberIds.length} sélectionné(s)</span></div>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                  {activeMembers.map((m: any) => <label key={m.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50">
                    <input type="checkbox" checked={requestDraft.memberIds.includes(m.id)} onChange={(e) => setRequestDraft({ ...requestDraft, memberIds: e.target.checked ? [...requestDraft.memberIds, m.id] : requestDraft.memberIds.filter((id) => id !== m.id) })} />
                    <span>{m.full_name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{(m.poles ?? []).map((id: string) => poleNames.get(id)).filter(Boolean).join(", ")}</span>
                  </label>)}
                </div>
              </div>
              <label className="block space-y-1 text-sm font-medium">Date et heure limite de réponse
                <Input type="datetime-local" value={requestDraft.deadlineAt} onChange={(e) => setRequestDraft({ ...requestDraft, deadlineAt: e.target.value })} />
                <span className="text-xs font-normal text-muted-foreground">Préremplie depuis la règle du programme ou du créneau si elle existe ; modifiable ici.</span>
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestDraft(null)}>Annuler</Button>
            <Button disabled={createSupportRequest.isPending} onClick={() => createSupportRequest.mutate()}>
              {createSupportRequest.isPending ? "Création…" : "Créer la demande ponctuelle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
