import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
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
  const [direct, setDirect] = useState<Record<string, string>>({});
  const [solicit, setSolicit] = useState<Record<string, string>>({});

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

  const names = useMemo(() => new Map(members.map((m) => [m.id, m.full_name])), [members]);
  const poleNames = useMemo(() => new Map(poles.map((p) => [p.id, p.name])), [poles]);
  const responseMap = useMemo(
    () => new Map((responses.data ?? []).map((r: any) => [r.member_id, r.status])),
    [responses.data],
  );
  const membershipKeys = useMemo(
    () => new Set((poleMemberships.data ?? []).map((x: any) => `${x.pole_id}::${x.member_id}`)),
    [poleMemberships.data],
  );

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

            {isStaff && !covered ? (
              <div className="mt-3 grid gap-3 border-t pt-3 lg:grid-cols-2">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs font-black">Affecter directement</p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Membre du pôle uniquement. Participation immédiate, aucune réponse demandée.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="h-9 min-w-48 rounded-md border bg-background px-2 text-sm"
                      value={direct[a.id] ?? ""}
                      onChange={(e) => setDirect((v) => ({ ...v, [a.id]: e.target.value }))}
                    >
                      <option value="">Choisir un membre du pôle…</option>
                      {directCandidates.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!direct[a.id]}
                      onClick={() => assign.mutate({ aid: a.id, mid: direct[a.id] })}
                    >
                      Affecter sans réponse
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs font-black">Solliciter</p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Demande liée à ce programme et à ce besoin. Le membre doit répondre. Un renfort
                    d’un autre pôle est possible ici.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="h-9 min-w-48 rounded-md border bg-background px-2 text-sm"
                      value={solicit[a.id] ?? ""}
                      onChange={(e) => setSolicit((v) => ({ ...v, [a.id]: e.target.value }))}
                    >
                      <option value="">Choisir un membre à solliciter…</option>
                      {solicitationCandidates.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!solicit[a.id]}
                      onClick={() =>
                        solicitProgram.mutate({ aid: a.id, mid: solicit[a.id] })
                      }
                    >
                      Envoyer la sollicitation
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
