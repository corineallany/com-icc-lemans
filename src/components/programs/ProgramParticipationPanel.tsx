import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type Assignment = { id: string; pole_id: string; required_count?: number | null; memberIds: string[] };
type Props = { programId: string; programTitle: string; assignments: Assignment[]; members: any[]; poles: any[] };

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

  // Single source of truth for staff candidate lists: a member only appears under
  // a pole if member_poles explicitly links that member to that pole.
  const programPoleMemberships = useQuery({
    queryKey: ["program-pole-memberships", programId, assignments.map((a) => a.pole_id).sort().join(",")],
    enabled: assignments.length > 0,
    queryFn: async () => {
      const poleIds = [...new Set(assignments.map((a) => a.pole_id))];
      const { data, error } = await (supabase as any)
        .from("member_poles")
        .select("member_id,pole_id")
        .in("pole_id", poleIds);
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
        .select("id,assignment_id,member_id,assignment_mode,assigned_at,process_status,process_closed_at,process_closed_reason")
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
    () => new Set((programPoleMemberships.data ?? []).map((x: any) => `${x.pole_id}::${x.member_id}`)),
    [programPoleMemberships.data],
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["program-proposals", programId] });
    qc.invalidateQueries({ queryKey: ["program-assignment-modes", programId] });
    qc.invalidateQueries({ queryKey: ["program-responses", programId] });
    qc.invalidateQueries({ queryKey: ["program-pole-memberships", programId] });
    qc.invalidateQueries({ queryKey: ["programs"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
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
      const assignment = assignments.find((a) => a.id === aid);
      if (!assignment || !membershipKeys.has(`${assignment.pole_id}::${mid}`)) {
        throw new Error("Ce membre n’est pas rattaché à ce pôle. Utilisez une sollicitation pour un renfort d’un autre pôle.");
      }
      if (responseMap.get(mid) === "unavailable") {
        const ok = window.confirm(
          "Cette personne a refusé cette sollicitation. Confirmer tout de même l’affectation directe ?",
        );
        if (!ok) throw new Error("Affectation annulée.");
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
      if (e.message !== "Affectation annulée.") toast.error(e.message);
    },
  });

  const withdraw = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("withdraw_program_proposal", { p_proposal_id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return (
    <div className="mt-4 space-y-3 rounded-xl border bg-muted/10 p-4">
      <div>
        <h3 className="font-black text-icc-violet">Participation & besoins</h3>
        <p className="text-xs text-muted-foreground">
          Transparence : affectations, sollicitations et propositions horodatées sont visibles par l’équipe. Les notes de proposition restent réservées aux responsables.
        </p>
      </div>

      {assignments.map((a) => {
        const required = a.required_count || 0;
        const rows = (modes.data ?? []).filter((x: any) => x.assignment_id === a.id);
        const confirmed = rows.filter(
          (x: any) => ["direct", "proposal"].includes(x.assignment_mode) && x.process_status !== "covered",
        );
        const solicited = rows.filter((x: any) => x.assignment_mode === "solicited");
        const allProposals = (proposals.data ?? []).filter((p: any) => p.assignment_id === a.id);
        const pending = allProposals.filter((p: any) => p.status === "pending");
        const covered = required > 0 && confirmed.length >= required;
        const mine = pending.find((p: any) => p.member_id === member?.id);
        const myPole = !!memberships.data?.has(a.pole_id);
        const confirmedIds = new Set(confirmed.map((x: any) => x.member_id));
        const candidates = members.filter(
          (m) =>
            m.status === "active" &&
            !m.deleted &&
            !m.archived &&
            !confirmedIds.has(m.id) &&
            membershipKeys.has(`${a.pole_id}::${m.id}`),
        );

        return (
          <div key={a.id} className="rounded-lg border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>{poleNames.get(a.pole_id) ?? "Pôle"}</b>
              {required > 0 ? (
                <Badge variant={covered ? "secondary" : "destructive"}>
                  {covered ? `Besoin comblé · ${confirmed.length}/${required}` : `${confirmed.length}/${required} confirmé${confirmed.length > 1 ? "s" : ""}`}
                </Badge>
              ) : null}
            </div>

            <div className="mt-2 space-y-1 text-sm">
              {confirmed.map((x: any) => (
                <div key={x.id}>
                  ✓ <b>{names.get(x.member_id) ?? x.member_id}</b> · {x.assignment_mode === "direct" ? "Affecté directement" : "Proposition acceptée"}
                </div>
              ))}

              {solicited.map((x: any) => {
                const response = responseMap.get(x.member_id);
                const closed = x.process_status === "covered";
                const label = closed
                  ? "Besoin comblé · sollicitation clôturée"
                  : response === "available"
                    ? "Réponse reçue · à affecter"
                    : response === "partial"
                      ? "Réponse partielle · à traiter"
                      : response === "unavailable"
                        ? "A refusé la sollicitation"
                        : "En attente de réponse";
                return (
                  <div key={x.id} className={closed ? "text-muted-foreground" : ""}>
                    {closed ? "○" : "⏳"} <b>{names.get(x.member_id) ?? x.member_id}</b> · {label}
                  </div>
                );
              })}

              {allProposals.map((p: any) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5"
                >
                  <span>
                    🙋 <b>{names.get(p.member_id) ?? p.member_id}</b> · proposition {stamp(p.created_at)} · {proposalLabel[p.status] ?? p.status}
                  </span>
                  {isStaff && p.status === "pending" ? (
                    <span className="flex items-center gap-1">
                      {p.note ? <span className="mr-2 text-xs text-muted-foreground">Note : {p.note}</span> : null}
                      <Button size="sm" onClick={() => decide.mutate({ id: p.id, d: "assigned" })}>Affecter</Button>
                      <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: p.id, d: "refused" })}>Refuser</Button>
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
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                <span className="text-xs font-bold">Affecter directement :</span>
                <select
                  className="h-9 min-w-48 rounded-md border bg-background px-2 text-sm"
                  value={direct[a.id] ?? ""}
                  onChange={(e) => setDirect((v) => ({ ...v, [a.id]: e.target.value }))}
                >
                  <option value="">Choisir un membre du pôle…</option>
                  {candidates.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!direct[a.id]}
                  onClick={() => assign.mutate({ aid: a.id, mid: direct[a.id] })}
                >
                  Affecter sans réponse
                </Button>
                {!programPoleMemberships.isLoading && candidates.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Aucun autre membre actif dans ce pôle.</span>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
