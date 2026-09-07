import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AppShell, EmptyState } from "@/components/AppShell";
import {
  availabilityQuery,
  formatDate,
  logAction,
  membersQuery,
  polesQuery,
  programDocumentsQuery,
  programsQuery,
  solicitationsQuery,
  STATUS_LABEL,
} from "@/lib/icc";
import { useCurrentRole } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/sollicitations")({
  component: Sollicitations,
});

type Recipient = {
  id: string;
  solicitation_id: string;
  member_id: string;
  response: string;
  reserve: string | null;
  refusal_reason: string | null;
  responded_at: string | null;
  selected?: boolean | null;
  selected_at?: string | null;
  selected_by?: string | null;
};
type Target = {
  id: string;
  solicitation_id: string;
  target_type: "member" | "pole" | "all";
  target_id: string | null;
  target_name: string;
  need: string | null;
  required_count?: number | null;
};
type MapRow = { solicitation_id: string; member_id: string; target_id: string };
type TargetDraft = {
  key: string;
  type: "member" | "pole" | "all";
  ids: string[];
  need: string;
  required_count: number;
};
type FormState = {
  id: string | null;
  nature: "reinforcement" | "replacement";
  requester_member_id: string;
  program_id: string;
  response_deadline: string;
  message: string;
  slot_selection_mode: "organizer" | "member";
  service_slot_ids: string[];
  targets: TargetDraft[];
};
type ServiceSlot = {
  id: string;
  program_id: string;
  program_day_id: string;
  label: string | null;
  start_time: string;
  end_time: string;
  required_count: number;
  service_date?: string;
};
type SlotChoice = { recipient_id: string; service_slot_id: string };

const RLABEL: Record<string, string> = {
  pending: "En attente",
  accepted: "Accepté",
  partial: "Accepté partiellement",
  refused: "Refusé",
};
const NLABEL: Record<string, string> = {
  reinforcement: "Renfort ponctuel",
  replacement: "Remplacement",
  renfort: "Renfort ponctuel",
  remplacement: "Remplacement",
};
const uid = (prefix = "s") => `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const newTarget = (): TargetDraft => ({
  key: uid("t"),
  type: "member",
  ids: [],
  need: "",
  required_count: 1,
});
const blankForm = (requester = ""): FormState => ({
  id: null,
  nature: "reinforcement",
  requester_member_id: requester,
  program_id: "",
  response_deadline: "",
  message: "",
  slot_selection_mode: "organizer",
  service_slot_ids: [],
  targets: [newTarget()],
});
const todayIso = () => new Date().toISOString().slice(0, 10);
const overlap = (a1: string, a2: string, b1: string, b2: string) =>
  new Date(a1) < new Date(b2) && new Date(b1) < new Date(a2);

function Sollicitations() {
  const solicitations = useQuery(solicitationsQuery);
  const members = useQuery(membersQuery);
  const poles = useQuery(polesQuery);
  const programs = useQuery(programsQuery);
  const availability = useQuery(availabilityQuery);
  const programDocuments = useQuery(programDocumentsQuery);
  const { isStaff, isAdmin, member, userId } = useCurrentRole();
  const qc = useQueryClient();

  const recipients = useQuery({
    queryKey: ["solicitation-recipients"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("solicitation_recipients").select("*");
      if (error) throw error;
      return (data ?? []) as Recipient[];
    },
  });
  const targets = useQuery({
    queryKey: ["solicitation-targets"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("solicitation_targets").select("*");
      if (error) throw error;
      return (data ?? []) as Target[];
    },
  });
  const recipientTargets = useQuery({
    queryKey: ["solicitation-recipient-targets"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("solicitation_recipient_targets")
        .select("*");
      if (error) throw error;
      return (data ?? []) as MapRow[];
    },
  });
  const serviceSlots = useQuery({
    queryKey: ["program-service-slots"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("program_service_slots")
        .select("*,program_days(service_date)")
        .order("position");
      if (error) throw error;
      return (data ?? []).map((s: any) => ({
        ...s,
        service_date: s.program_days?.service_date,
      })) as ServiceSlot[];
    },
  });
  const slotChoices = useQuery({
    queryKey: ["solicitation-slot-choices"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("solicitation_recipient_slot_choices")
        .select("*");
      if (error) throw error;
      return (data ?? []) as SlotChoice[];
    },
  });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [nature, setNature] = useState("all");
  const [program, setProgram] = useState("all");
  const [sort, setSort] = useState("recent");
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [form, setForm] = useState<FormState>(() => blankForm(member?.id ?? ""));
  const [answerSlots, setAnswerSlots] = useState<Record<string, string[]>>({});

  const allMembers = members.data?.members ?? [];
  const activeMembers = allMembers.filter((m: any) => m.status === "active" && !m.archived);
  const links = members.data?.links ?? [];
  const activePoles = (poles.data ?? []).filter((p) => !p.archived);
  const allActivePrograms = (programs.data ?? []).filter((p) => !p.archived && !p.deleted);
  const selectablePrograms = allActivePrograms.filter(
    (p: any) => !!p.start_date && p.start_date >= todayIso() && p.status !== "cancelled",
  );
  const selectedProgram =
    selectablePrograms.find((p: any) => p.id === form.program_id) ??
    allActivePrograms.find((p: any) => p.id === form.program_id);
  const selectedProgramSlots = (serviceSlots.data ?? []).filter(
    (s) => s.program_id === form.program_id,
  );
  const slotsForProgram = (programId?: string | null) =>
    (serviceSlots.data ?? []).filter((s) => s.program_id === programId);
  const slotLabel = (s: ServiceSlot) =>
    `${s.service_date ? formatDate(s.service_date) + " · " : ""}${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}${s.label ? ` · ${s.label}` : ""}`;

  const rows = useMemo(() => {
    let data = (solicitations.data ?? []).filter((s: any) => !s.archived);
    const needle = search.trim().toLowerCase();
    if (needle)
      data = data.filter((s: any) =>
        `${s.event_name ?? ""} ${s.requester ?? ""} ${s.message ?? ""} ${s.target_name ?? ""}`
          .toLowerCase()
          .includes(needle),
      );
    if (status !== "all") data = data.filter((s: any) => s.status === status);
    if (nature !== "all") data = data.filter((s: any) => NLABEL[s.nature ?? ""] === NLABEL[nature]);
    if (program !== "all") data = data.filter((s: any) => s.program_id === program);
    return [...data].sort((a: any, b: any) =>
      sort === "old"
        ? String(a.event_date ?? a.created_at).localeCompare(String(b.event_date ?? b.created_at))
        : String(b.event_date ?? b.created_at).localeCompare(String(a.event_date ?? a.created_at)),
    );
  }, [solicitations.data, search, status, nature, program, sort]);

  const recs = (id: string) => (recipients.data ?? []).filter((r) => r.solicitation_id === id);
  const tgts = (id: string) => (targets.data ?? []).filter((t) => t.solicitation_id === id);
  const maps = (id: string) =>
    (recipientTargets.data ?? []).filter((m) => m.solicitation_id === id);
  const memberName = (id?: string | null) =>
    allMembers.find((m: any) => m.id === id)?.full_name ?? "—";
  const poleName = (id?: string | null) =>
    activePoles.find((p: any) => p.id === id)?.name ?? "Pôle";
  const programName = (id?: string | null) =>
    allActivePrograms.find((p: any) => p.id === id)?.title ?? "—";
  const docsForProgram = (id?: string | null) =>
    (programDocuments.data ?? []).filter((d) => d.program_id === id);

  function deadlineText(date?: string | null) {
    if (!date) return "—";
    if (date < todayIso()) return `Échéance dépassée · ${formatDate(date)}`;
    if (date === todayIso()) return `À répondre aujourd'hui · ${formatDate(date)}`;
    return `Réponse attendue avant le ${formatDate(date)}`;
  }
  function aggregate(rs: Recipient[]) {
    if (!rs.length || rs.every((r) => r.response === "pending")) return "pending";
    if (rs.every((r) => r.response === "accepted")) return "accepted";
    if (rs.every((r) => r.response === "refused")) return "refused";
    if (rs.some((r) => r.response === "pending")) return "pending";
    return "partial";
  }
  function programWindow(p: any) {
    const day = p?.start_date;
    if (!day) return null;
    return {
      start: `${day}T${p.start_time || "00:00"}:00`,
      end: `${p.end_date ?? day}T${p.end_time || "23:59"}:00`,
    };
  }
  function availabilityState(memberId: string, programId?: string | null) {
    const p = allActivePrograms.find((x: any) => x.id === programId);
    const w = programWindow(p);
    if (!w) return { level: "ok", label: "" };
    const blocked = (availability.data ?? []).some(
      (a: any) =>
        a.member_id === memberId &&
        a.status !== "refused" &&
        overlap(w.start, w.end, a.starts_at, a.ends_at),
    );
    if (blocked) return { level: "danger", label: "Indisponible sur ce créneau" };
    const other = allActivePrograms.find(
      (x: any) =>
        x.id !== p.id &&
        x.status !== "cancelled" &&
        x.assignments?.some((a: any) => a.memberIds.includes(memberId)) &&
        (() => {
          const ow = programWindow(x);
          return ow ? overlap(w.start, w.end, ow.start, ow.end) : false;
        })(),
    );
    if (other) return { level: "warning", label: `Conflit avec ${other.title}` };
    if (p.assignments?.some((a: any) => a.memberIds.includes(memberId)))
      return { level: "info", label: "Déjà affecté à ce programme" };
    return { level: "ok", label: "" };
  }
  function resolveTargetMembers(t: TargetDraft) {
    if (t.type === "all") return activeMembers.map((m: any) => m.id);
    if (t.type === "member") return t.ids;
    return activeMembers
      .filter((m: any) =>
        t.ids.some((poleId) =>
          links.some((l: any) => l.member_id === m.id && l.pole_id === poleId),
        ),
      )
      .map((m: any) => m.id);
  }
  function targetDisplay(t: TargetDraft) {
    if (t.type === "all") return "Toute la COM";
    if (t.type === "member") return t.ids.map(memberName).join(", ");
    return t.ids.map(poleName).join(", ");
  }
  async function notifyMembers(
    memberIds: string[],
    title: string,
    body: string,
    solicitationId: string,
  ) {
    const payload = [...new Set(memberIds)]
      .map((mid) => {
        const m: any = allMembers.find((x: any) => x.id === mid);
        if (!m?.auth_user_id) return null;
        return {
          user_id: m.auth_user_id,
          member_id: mid,
          type: "sollicitation",
          title,
          body,
          link: "/sollicitations",
          read: false,
          entity_type: "solicitation",
          entity_id: solicitationId,
          idempotency_key: `sol:${solicitationId}:${mid}:${Date.now()}`,
        };
      })
      .filter(Boolean);
    if (payload.length) await (supabase as any).from("notifications").insert(payload);
  }
  async function notifyManagers(s: any, r: Recipient, label: string) {
    const mids = new Set<string>();
    if (s.requester_member_id) mids.add(s.requester_member_id);
    const targetIds = maps(s.id)
      .filter((x) => x.member_id === r.member_id)
      .map((x) => x.target_id);
    for (const t of tgts(s.id).filter(
      (x) => targetIds.includes(x.id) && x.target_type === "pole" && x.target_id,
    )) {
      links
        .filter((l: any) => l.pole_id === t.target_id && l.is_referent)
        .forEach((l: any) => mids.add(l.member_id));
    }
    mids.delete(r.member_id);
    await notifyMembers(
      [...mids],
      "Réponse à une sollicitation",
      `${memberName(r.member_id)} : ${label} · ${programName(s.program_id)}`,
      s.id,
    );
  }

  function openNew() {
    setForm(blankForm(member?.id ?? ""));
    setFormOpen(true);
  }
  function openEdit(s: any) {
    const grouped: TargetDraft[] = [];
    for (const t of tgts(s.id)) {
      const same = grouped.find(
        (x) =>
          x.type === t.target_type &&
          x.need === (t.need ?? "") &&
          x.required_count === (t.required_count ?? 1),
      );
      if (same && t.target_type !== "all" && t.target_id) same.ids.push(t.target_id);
      else
        grouped.push({
          key: uid("t"),
          type: t.target_type,
          ids: t.target_id ? [t.target_id] : [],
          need: t.need ?? "",
          required_count: t.required_count ?? 1,
        });
    }
    const program: any = allActivePrograms.find((p: any) => p.id === s.program_id);
    setForm({
      id: s.id,
      nature:
        s.nature === "replacement" || s.nature === "remplacement" ? "replacement" : "reinforcement",
      requester_member_id: s.requester_member_id ?? member?.id ?? "",
      program_id: s.program_id ?? "",
      response_deadline: s.response_deadline ?? "",
      message: s.message ?? "",
      slot_selection_mode:
        s.slot_selection_mode === "member"
          ? "member"
          : program?.slot_selection_mode === "member"
            ? "member"
            : "organizer",
      service_slot_ids:
        Array.isArray(s.offered_slot_ids) && s.offered_slot_ids.length
          ? s.offered_slot_ids
          : slotsForProgram(s.program_id).map((x) => x.id),
      targets: grouped.length ? grouped : [newTarget()],
    });
    setFormOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!form.requester_member_id) throw new Error("Choisis la personne à l'origine du besoin.");
      if (!form.program_id) throw new Error("Choisis le programme concerné.");
      const p: any = allActivePrograms.find((x: any) => x.id === form.program_id);
      if (!p?.start_date || p.start_date < todayIso())
        throw new Error("Choisis un programme à venir.");
      if (
        !form.response_deadline ||
        form.response_deadline < todayIso() ||
        form.response_deadline > p.start_date
      )
        throw new Error(
          "La date limite doit être comprise entre aujourd'hui et la date du programme.",
        );
      const usableTargets = form.targets.filter((t) => t.type === "all" || t.ids.length > 0);
      if (!usableTargets.length) throw new Error("Ajoute au moins une cible.");
      const id = form.id ?? uid();
      const requester: any = allMembers.find((m: any) => m.id === form.requester_member_id);
      if (p.detailed_scheduling && !form.service_slot_ids.length)
        throw new Error("Choisis au moins un créneau à proposer.");
      const payload: any = {
        nature: form.nature,
        requester_member_id: form.requester_member_id,
        requester: requester?.full_name ?? null,
        program_id: p.id,
        event_name: p.title,
        event_date: p.start_date,
        response_deadline: form.response_deadline,
        message: form.message.trim() || null,
        target_type: "mixed",
        target_name: usableTargets.map(targetDisplay).join(" · "),
        slot_selection_mode: form.slot_selection_mode,
        offered_slot_ids: form.service_slot_ids,
        updated_at: new Date().toISOString(),
      };
      if (!form.id) Object.assign(payload, { id, status: "pending", created_by: userId ?? null });
      const wr = form.id
        ? await (supabase as any).from("solicitations").update(payload).eq("id", id)
        : await (supabase as any).from("solicitations").insert(payload);
      if (wr.error) throw wr.error;

      const existing = recs(id);
      await (supabase as any)
        .from("solicitation_recipient_targets")
        .delete()
        .eq("solicitation_id", id);
      await (supabase as any).from("solicitation_targets").delete().eq("solicitation_id", id);
      const targetRows: any[] = [];
      const memberMap = new Map<string, string[]>();
      for (const t of usableTargets) {
        const entityIds = t.type === "all" ? [null] : t.ids;
        for (const entityId of entityIds) {
          const tid = uid("st");
          const name =
            t.type === "all"
              ? "Toute la COM"
              : t.type === "member"
                ? memberName(entityId)
                : poleName(entityId);
          targetRows.push({
            id: tid,
            solicitation_id: id,
            target_type: t.type,
            target_id: entityId,
            target_name: name,
            need: t.need.trim() || null,
            required_count: Math.max(1, Number(t.required_count) || 1),
          });
          const mids =
            t.type === "all"
              ? resolveTargetMembers(t)
              : t.type === "member"
                ? [entityId as string]
                : activeMembers
                    .filter((m: any) =>
                      links.some((l: any) => l.member_id === m.id && l.pole_id === entityId),
                    )
                    .map((m: any) => m.id);
          mids.forEach((mid) => memberMap.set(mid, [...(memberMap.get(mid) ?? []), tid]));
        }
      }
      const tr = await (supabase as any).from("solicitation_targets").insert(targetRows);
      if (tr.error) throw tr.error;
      const newIds = [...memberMap.keys()];
      const oldIds = existing.map((r) => r.member_id);
      const removed = oldIds.filter((x) => !newIds.includes(x));
      if (removed.length)
        await (supabase as any)
          .from("solicitation_recipients")
          .delete()
          .eq("solicitation_id", id)
          .in("member_id", removed);
      const added = newIds.filter((x) => !oldIds.includes(x));
      if (added.length) {
        const rr = await (supabase as any).from("solicitation_recipients").insert(
          added.map((member_id) => ({
            solicitation_id: id,
            recipient_type: "member",
            member_id,
            response: "pending",
          })),
        );
        if (rr.error) throw rr.error;
      }
      const mapRows = [...memberMap.entries()].flatMap(([member_id, tids]) =>
        tids.map((target_id) => ({ solicitation_id: id, member_id, target_id })),
      );
      if (mapRows.length) {
        const mr = await (supabase as any).from("solicitation_recipient_targets").insert(mapRows);
        if (mr.error) throw mr.error;
      }
      const currentRecipients = await (supabase as any)
        .from("solicitation_recipients")
        .select("id")
        .eq("solicitation_id", id);
      if (currentRecipients.error) throw currentRecipients.error;
      const recipientIds = (currentRecipients.data ?? []).map((r: any) => r.id);
      if (recipientIds.length)
        await (supabase as any)
          .from("solicitation_recipient_slot_choices")
          .delete()
          .in("recipient_id", recipientIds);
      if (
        form.slot_selection_mode === "organizer" &&
        form.service_slot_ids.length &&
        recipientIds.length
      ) {
        const choices = recipientIds.flatMap((recipient_id: string) =>
          form.service_slot_ids.map((service_slot_id) => ({ recipient_id, service_slot_id })),
        );
        const cr = await (supabase as any)
          .from("solicitation_recipient_slot_choices")
          .insert(choices);
        if (cr.error) throw cr.error;
      }
      if (!form.id && newIds.length)
        await notifyMembers(
          newIds,
          "Nouvelle sollicitation",
          `${p.title} · réponse avant le ${formatDate(form.response_deadline)}`,
          id,
        );
      await logAction({
        action: form.id ? "sollicitation_modifiee" : "sollicitation_creee",
        entity: "solicitation",
        entityId: id,
        detail: `${p.title} · ${newIds.length} destinataire(s)`,
        actorName: member?.full_name,
      });
    },
    onSuccess: async () => {
      toast.success(form.id ? "Sollicitation modifiée" : "Sollicitation créée et envoyée");
      setFormOpen(false);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const answer = useMutation({
    mutationFn: async ({
      s,
      r,
      response,
      note,
      chosenSlots,
    }: {
      s: any;
      r: Recipient;
      response: string;
      note?: string;
      chosenSlots?: string[];
    }) => {
      if (s.response_deadline && s.response_deadline < todayIso() && !isStaff)
        throw new Error("La date limite de réponse est dépassée.");
      if (
        s.slot_selection_mode === "member" &&
        (response === "accepted" || response === "partial") &&
        !chosenSlots?.length
      )
        throw new Error("Choisis au moins un créneau qui te convient.");
      const old = r.response;
      const patch: any = {
        response,
        responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        reserve: response === "partial" ? note || null : null,
        refusal_reason: response === "refused" ? note || null : null,
      };
      const { error } = await (supabase as any)
        .from("solicitation_recipients")
        .update(patch)
        .eq("id", r.id);
      if (error) throw error;
      if (s.slot_selection_mode === "member") {
        await (supabase as any)
          .from("solicitation_recipient_slot_choices")
          .delete()
          .eq("recipient_id", r.id);
        if (chosenSlots?.length) {
          const cr = await (supabase as any)
            .from("solicitation_recipient_slot_choices")
            .insert(
              chosenSlots.map((service_slot_id) => ({ recipient_id: r.id, service_slot_id })),
            );
          if (cr.error) throw cr.error;
        }
      }
      const next = recs(r.solicitation_id).map((x) => (x.id === r.id ? { ...x, ...patch } : x));
      await (supabase as any)
        .from("solicitations")
        .update({ status: aggregate(next), decision_at: new Date().toISOString() })
        .eq("id", r.solicitation_id);
      await logAction({
        action: old === "pending" ? "reponse_sollicitation" : "reponse_sollicitation_modifiee",
        entity: "solicitation",
        entityId: s.id,
        detail: `${memberName(r.member_id)} : ${RLABEL[old] ?? old} → ${RLABEL[response] ?? response}`,
        actorName: member?.full_name,
      });
      await notifyManagers(s, r, RLABEL[response] ?? response);
    },
    onSuccess: async () => {
      toast.success("Réponse enregistrée");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function applyOperationalEffect(s: any, r: Recipient) {
    if (!s.program_id) return;
    const memberId = r.member_id;
    if (s.nature === "replacement" || s.nature === "remplacement") {
      const replacedId = s.requester_member_id;
      const { data: assignments } = await (supabase as any)
        .from("program_assignments")
        .select("id")
        .eq("program_id", s.program_id);
      const ids = (assignments ?? []).map((a: any) => a.id);
      if (ids.length && replacedId) {
        const { data: oldLinks } = await (supabase as any)
          .from("program_assignment_members")
          .select("assignment_id")
          .in("assignment_id", ids)
          .eq("member_id", replacedId);
        for (const link of oldLinks ?? [])
          await (supabase as any)
            .from("program_assignment_members")
            .upsert(
              { assignment_id: link.assignment_id, member_id: memberId },
              { onConflict: "assignment_id,member_id" },
            );
        await (supabase as any)
          .from("program_assignment_members")
          .delete()
          .in("assignment_id", ids)
          .eq("member_id", replacedId);
      }
    } else {
      const tids = maps(s.id)
        .filter((x) => x.member_id === memberId)
        .map((x) => x.target_id);
      const poleTarget = tgts(s.id).find(
        (t) => tids.includes(t.id) && t.target_type === "pole" && t.target_id,
      );
      const poleId =
        poleTarget?.target_id ?? links.find((l: any) => l.member_id === memberId)?.pole_id;
      if (poleId) {
        const { data: existing } = await (supabase as any)
          .from("program_assignments")
          .select("id")
          .eq("program_id", s.program_id)
          .eq("pole_id", poleId)
          .maybeSingle();
        let assignmentId = existing?.id;
        if (!assignmentId) {
          const ins = await (supabase as any)
            .from("program_assignments")
            .insert({
              program_id: s.program_id,
              pole_id: poleId,
              tasks: poleTarget?.need ?? "Renfort ponctuel",
            })
            .select("id")
            .single();
          assignmentId = ins.data?.id;
        }
        if (assignmentId)
          await (supabase as any)
            .from("program_assignment_members")
            .upsert(
              { assignment_id: assignmentId, member_id: memberId },
              { onConflict: "assignment_id,member_id" },
            );
      }
    }
    const chosenIds = (slotChoices.data ?? [])
      .filter((c) => c.recipient_id === r.id)
      .map((c) => c.service_slot_id);
    if (chosenIds.length) {
      const slotRes = await (supabase as any)
        .from("program_service_slots")
        .select("id,program_day_id,assignment_id,start_time,end_time")
        .in("id", chosenIds);
      if (slotRes.error) throw slotRes.error;
      const assignmentIds = [
        ...new Set((slotRes.data ?? []).map((x: any) => x.assignment_id).filter(Boolean)),
      ];
      const allAssignments = await (supabase as any)
        .from("program_assignments")
        .select("id")
        .eq("program_id", s.program_id);
      if (allAssignments.error) throw allAssignments.error;
      const candidateIds = assignmentIds.length
        ? assignmentIds
        : (allAssignments.data ?? []).map((a: any) => a.id);
      const amRes = candidateIds.length
        ? await (supabase as any)
            .from("program_assignment_members")
            .select("id,assignment_id")
            .in("assignment_id", candidateIds)
            .eq("member_id", memberId)
        : { data: [], error: null };
      if (amRes.error) throw amRes.error;
      const rows = (slotRes.data ?? [])
        .map((slot: any) => {
          const am =
            (amRes.data ?? []).find((x: any) => x.assignment_id === slot.assignment_id) ??
            (amRes.data ?? [])[0];
          return am
            ? {
                assignment_member_id: am.id,
                program_day_id: slot.program_day_id,
                service_slot_id: slot.id,
                start_time: slot.start_time,
                end_time: slot.end_time,
              }
            : null;
        })
        .filter(Boolean);
      if (rows.length) {
        await (supabase as any)
          .from("program_assignment_member_slots")
          .delete()
          .in("service_slot_id", chosenIds)
          .in(
            "assignment_member_id",
            (amRes.data ?? []).map((x: any) => x.id),
          );
        const ins = await (supabase as any).from("program_assignment_member_slots").insert(rows);
        if (ins.error) throw ins.error;
      }
    }
    await (supabase as any).from("program_member_responses").upsert(
      {
        id: `${s.program_id}__${memberId}`,
        program_id: s.program_id,
        member_id: memberId,
        status: "available",
        reason: s.nature === "replacement" ? "Remplacement retenu" : "Renfort retenu",
      },
      { onConflict: "program_id,member_id" },
    );
  }

  const selectRecipient = useMutation({
    mutationFn: async ({ s, r }: { s: any; r: Recipient }) => {
      if (r.response !== "accepted" && r.response !== "partial")
        throw new Error("Seules les personnes ayant accepté peuvent être retenues.");
      if (r.selected) throw new Error("Cette personne est déjà retenue.");
      await applyOperationalEffect(s, r);
      const { error } = await (supabase as any)
        .from("solicitation_recipients")
        .update({
          selected: true,
          selected_at: new Date().toISOString(),
          selected_by: member?.id ?? null,
        })
        .eq("id", r.id);
      if (error) throw error;
      await notifyMembers(
        [r.member_id],
        "Vous êtes retenu(e)",
        `Vous avez été retenu(e) pour ${programName(s.program_id)}.`,
        s.id,
      );
      await logAction({
        action: "sollicitation_personne_retenue",
        entity: "solicitation",
        entityId: s.id,
        detail: memberName(r.member_id),
        actorName: member?.full_name,
      });
    },
    onSuccess: async () => {
      toast.success("Personne retenue et affectée au programme");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async (s: any) => {
      const note = window.prompt("Motif de l'annulation (facultatif) :") ?? "";
      const { error } = await (supabase as any)
        .from("solicitations")
        .update({
          status: "cancelled",
          cancellation_note: note || null,
          cancelled_at: new Date().toISOString(),
          cancelled_by: member?.full_name ?? null,
        })
        .eq("id", s.id);
      if (error) throw error;
      await notifyMembers(
        recs(s.id).map((r) => r.member_id),
        "Sollicitation annulée",
        `${programName(s.program_id)} · ${note || "La demande a été annulée."}`,
        s.id,
      );
    },
    onSuccess: async () => {
      toast.success("Sollicitation annulée");
      setDetail(null);
      await refresh();
    },
  });
  const archive = useMutation({
    mutationFn: async (s: any) => {
      const { error } = await (supabase as any)
        .from("solicitations")
        .update({ archived: true, archived_at: new Date().toISOString() })
        .eq("id", s.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      setDetail(null);
      await refresh();
    },
  });

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["solicitations"] }),
      qc.invalidateQueries({ queryKey: ["solicitation-recipients"] }),
      qc.invalidateQueries({ queryKey: ["solicitation-targets"] }),
      qc.invalidateQueries({ queryKey: ["solicitation-recipient-targets"] }),
      qc.invalidateQueries({ queryKey: ["solicitation-slot-choices"] }),
      qc.invalidateQueries({ queryKey: ["programs"] }),
      qc.invalidateQueries({ queryKey: ["member-availability"] }),
    ]);
  }
  function respond(s: any, r: Recipient, response: string) {
    let note = "";
    if (response === "partial") note = window.prompt("Indique ta réserve :", r.reserve ?? "") ?? "";
    if (response === "refused")
      note = window.prompt("Indique le motif du refus :", r.refusal_reason ?? "") ?? "";
    if ((response === "partial" || response === "refused") && !note.trim()) return;
    answer.mutate({ s, r, response, note, chosenSlots: answerSlots[r.id] ?? [] });
  }
  function targetProgress(s: any) {
    const out = tgts(s.id).map((t) => {
      const mids = maps(s.id)
        .filter((m) => m.target_id === t.id)
        .map((m) => m.member_id);
      const accepted = recs(s.id).filter(
        (r) =>
          mids.includes(r.member_id) && (r.response === "accepted" || r.response === "partial"),
      ).length;
      const selected = recs(s.id).filter((r) => mids.includes(r.member_id) && r.selected).length;
      const needed = t.required_count ?? 1;
      return { ...t, accepted, selected, needed, remaining: Math.max(0, needed - selected) };
    });
    return out;
  }

  return (
    <AppShell
      title="Sollicitations ponctuelles"
      subtitle="Renforts, remplacements et sélection opérationnelle"
    >
      <div className="space-y-4">
        <div className="flex justify-end">
          {isStaff ? <Button onClick={openNew}>+ Nouvelle sollicitation</Button> : null}
        </div>
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Input
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Filter
            value={status}
            set={setStatus}
            all="Tous les statuts"
            items={[
              ["pending", "En attente"],
              ["accepted", "Acceptée"],
              ["partial", "Réponses mixtes"],
              ["refused", "Refusée"],
              ["cancelled", "Annulée"],
            ]}
          />
          <Filter
            value={nature}
            set={setNature}
            all="Toutes les natures"
            items={[
              ["reinforcement", "Renfort ponctuel"],
              ["replacement", "Remplacement"],
            ]}
          />
          <Filter
            value={program}
            set={setProgram}
            all="Tous les programmes"
            items={allActivePrograms.map((p: any) => [p.id, p.title])}
          />
          <Filter
            value={sort}
            set={setSort}
            all="Tri"
            items={[
              ["recent", "Plus récentes"],
              ["old", "Plus anciennes"],
            ]}
          />
        </div>
        {!rows.length ? (
          <EmptyState title="Aucune sollicitation" />
        ) : (
          <div className="space-y-4">
            {rows.map((s: any) => {
              const rs = recs(s.id);
              const agg = s.status === "cancelled" ? "cancelled" : aggregate(rs);
              const progress = targetProgress(s);
              const remaining = progress.reduce((n, p) => n + p.remaining, 0);
              return (
                <Card
                  key={s.id}
                  className="cursor-pointer transition hover:border-icc-violet/40"
                  onClick={() => setDetail(s)}
                >
                  <CardHeader>
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <CardTitle className="text-lg">{programName(s.program_id)}</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {NLABEL[s.nature] ?? "Sollicitation"} · {formatDate(s.event_date)}
                        </p>
                      </div>
                      <Badge variant={agg === "pending" ? "outline" : "secondary"}>
                        {agg === "partial"
                          ? "Réponses mixtes"
                          : (STATUS_LABEL[agg] ?? RLABEL[agg] ?? agg)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p>
                      <b>Date limite :</b> {deadlineText(s.response_deadline)}
                    </p>
                    <p>
                      <b>{rs.length}</b> personne(s) sollicitée(s) ·{" "}
                      <b>{rs.filter((r) => r.selected).length}</b> retenue(s)
                    </p>
                    {remaining > 0 ? (
                      <p className="font-semibold text-amber-700">
                        Encore {remaining} place(s) à couvrir
                      </p>
                    ) : progress.length ? (
                      <p className="font-semibold text-emerald-700">Besoin couvert</p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Modifier la sollicitation" : "Nouvelle sollicitation ponctuelle"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nature">
                <Filter
                  value={form.nature}
                  set={(v) => setForm({ ...form, nature: v as FormState["nature"] })}
                  all="Nature"
                  items={[
                    ["reinforcement", "Renfort ponctuel"],
                    ["replacement", "Remplacement"],
                  ]}
                />
              </Field>
              <Field
                label={
                  form.nature === "replacement"
                    ? "Personne à remplacer"
                    : "Personne à l'origine du besoin"
                }
              >
                <Filter
                  value={form.requester_member_id || "none"}
                  set={(v) => setForm({ ...form, requester_member_id: v === "none" ? "" : v })}
                  all="Choisir"
                  items={activeMembers.map((m: any) => [m.id, m.full_name])}
                />
              </Field>
              <Field label="Programme lié *">
                <Select
                  value={form.program_id || undefined}
                  onValueChange={(pid) => {
                    const p: any = selectablePrograms.find((x: any) => x.id === pid);
                    const ids = slotsForProgram(pid).map((s) => s.id);
                    setForm({
                      ...form,
                      program_id: pid,
                      response_deadline: p?.response_deadline ?? "",
                      slot_selection_mode:
                        p?.slot_selection_mode === "member" ? "member" : "organizer",
                      service_slot_ids: ids,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un programme" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectablePrograms.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title} · {formatDate(p.start_date)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Date limite de réponse *">
                <Input
                  type="date"
                  min={todayIso()}
                  max={selectedProgram?.start_date || undefined}
                  value={form.response_deadline}
                  onChange={(e) => setForm({ ...form, response_deadline: e.target.value })}
                />
              </Field>
            </div>
            {form.program_id ? <ProgramFiles files={docsForProgram(form.program_id)} /> : null}
            {selectedProgram?.detailed_scheduling ? (
              <section className="space-y-3 rounded-2xl border border-violet-200 p-4">
                <div>
                  <h3 className="font-black text-icc-violet">Créneaux proposés</h3>
                  <p className="text-xs text-muted-foreground">
                    La sollicitation peut attribuer des créneaux précis ou laisser chaque membre
                    choisir parmi ceux-ci.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex gap-2 rounded-xl border p-3 text-sm">
                    <Checkbox
                      checked={form.slot_selection_mode === "organizer"}
                      onCheckedChange={() => setForm({ ...form, slot_selection_mode: "organizer" })}
                    />
                    <span>
                      <b>Créneaux attribués</b>
                      <small className="block text-muted-foreground">
                        Le responsable définit les créneaux proposés.
                      </small>
                    </span>
                  </label>
                  <label className="flex gap-2 rounded-xl border p-3 text-sm">
                    <Checkbox
                      checked={form.slot_selection_mode === "member"}
                      onCheckedChange={() => setForm({ ...form, slot_selection_mode: "member" })}
                    />
                    <span>
                      <b>Choix laissé au membre</b>
                      <small className="block text-muted-foreground">
                        Le membre coche ce qui lui convient.
                      </small>
                    </span>
                  </label>
                </div>
                <Checks
                  items={selectedProgramSlots.map((s) => [s.id, slotLabel(s)])}
                  values={form.service_slot_ids}
                  set={(service_slot_ids) => setForm({ ...form, service_slot_ids })}
                />
              </section>
            ) : null}
            <Field label="Contexte général">
              <Textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </Field>
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-black text-icc-violet">Cibles et besoins</h3>
                  <p className="text-xs text-muted-foreground">
                    Le système affiche les conflits avant l'envoi et suit le nombre de personnes à
                    retenir.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setForm({ ...form, targets: [...form.targets, newTarget()] })}
                >
                  + Ajouter une cible
                </Button>
              </div>
              {form.targets.map((t, index) => (
                <div key={t.key} className="rounded-2xl border p-4">
                  <div className="flex justify-between">
                    <b>Cible {index + 1}</b>
                    {form.targets.length > 1 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setForm({ ...form, targets: form.targets.filter((x) => x.key !== t.key) })
                        }
                      >
                        Retirer
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <Field label="Type">
                      <Filter
                        value={t.type}
                        set={(v) =>
                          setForm({
                            ...form,
                            targets: form.targets.map((x) =>
                              x.key === t.key
                                ? { ...x, type: v as TargetDraft["type"], ids: [] }
                                : x,
                            ),
                          })
                        }
                        all="Type"
                        items={[
                          ["member", "Personne(s)"],
                          ["pole", "Pôle(s)"],
                          ["all", "Toute la COM"],
                        ]}
                      />
                    </Field>
                    <Field label="Besoin spécifique">
                      <Input
                        value={t.need}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            targets: form.targets.map((x) =>
                              x.key === t.key ? { ...x, need: e.target.value } : x,
                            ),
                          })
                        }
                        placeholder="Ex. prise de photos"
                      />
                    </Field>
                    <Field label="Nombre à retenir">
                      <Input
                        type="number"
                        min={1}
                        value={t.required_count}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            targets: form.targets.map((x) =>
                              x.key === t.key
                                ? { ...x, required_count: Math.max(1, Number(e.target.value) || 1) }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>
                  {t.type === "member" ? (
                    <Checks
                      items={activeMembers.map((m: any) => [
                        m.id,
                        `${m.full_name} · ${availabilityState(m.id, form.program_id).label}`,
                      ])}
                      values={t.ids}
                      set={(ids) =>
                        setForm({
                          ...form,
                          targets: form.targets.map((x) => (x.key === t.key ? { ...x, ids } : x)),
                        })
                      }
                    />
                  ) : null}
                  {t.type === "pole" ? (
                    <Checks
                      items={activePoles.map((p: any) => [p.id, p.name])}
                      values={t.ids}
                      set={(ids) =>
                        setForm({
                          ...form,
                          targets: form.targets.map((x) => (x.key === t.key ? { ...x, ids } : x)),
                        })
                      }
                    />
                  ) : null}
                  {t.type === "all" ? (
                    <p className="mt-3 rounded-xl bg-muted/50 p-3 text-sm">
                      Tous les membres actifs seront destinataires. Les conflits seront visibles
                      dans la fiche avant sélection.
                    </p>
                  ) : null}
                </div>
              ))}
            </section>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Annuler
            </Button>
            <Button disabled={save.isPending || !form.program_id} onClick={() => save.mutate()}>
              {form.id ? "Enregistrer" : "Créer et envoyer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle>{programName(detail.program_id)}</DialogTitle>
              </DialogHeader>
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Info label="Nature" value={NLABEL[detail.nature] ?? "Sollicitation"} />
                  <Info label="Date" value={formatDate(detail.event_date)} />
                  <Info label="Date limite" value={deadlineText(detail.response_deadline)} />
                  <Info
                    label="Statut"
                    value={
                      detail.status === "partial"
                        ? "Réponses mixtes"
                        : (STATUS_LABEL[detail.status] ?? detail.status)
                    }
                  />
                </div>
                <div className="rounded-2xl border p-4">
                  <h3 className="font-black text-icc-violet">Couverture du besoin</h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {targetProgress(detail).map((t) => (
                      <div key={t.id} className="rounded-xl bg-muted/40 p-3">
                        <div className="flex justify-between gap-2">
                          <b>{t.target_name}</b>
                          <Badge variant={t.remaining ? "outline" : "secondary"}>
                            {t.selected}/{t.needed} retenu(s)
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm">{t.need || "Besoin non précisé"}</p>
                        {t.remaining ? (
                          <p className="mt-1 text-xs font-semibold text-amber-700">
                            Encore {t.remaining} place(s)
                          </p>
                        ) : (
                          <p className="mt-1 text-xs font-semibold text-emerald-700">
                            Besoin couvert
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <ProgramFiles files={docsForProgram(detail.program_id)} />
                <div className="rounded-2xl border p-4">
                  <div className="flex justify-between">
                    <h3 className="font-black text-icc-violet">Réponses individuelles</h3>
                    <span className="text-sm text-muted-foreground">
                      Réponse modifiable jusqu'à l'échéance
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {recs(detail.id).map((r) => {
                      const av = availabilityState(r.member_id, detail.program_id);
                      const offeredIds: string[] = Array.isArray(detail.offered_slot_ids)
                        ? detail.offered_slot_ids
                        : [];
                      const offered = slotsForProgram(detail.program_id).filter(
                        (s) => !offeredIds.length || offeredIds.includes(s.id),
                      );
                      const storedChoices = (slotChoices.data ?? [])
                        .filter((c) => c.recipient_id === r.id)
                        .map((c) => c.service_slot_id);
                      const chosen = answerSlots[r.id] ?? storedChoices;
                      const canAnswer =
                        member?.id === r.member_id &&
                        detail.status !== "cancelled" &&
                        (!detail.response_deadline || detail.response_deadline >= todayIso());
                      return (
                        <div key={r.id} className="rounded-xl border p-3 text-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <b>{memberName(r.member_id)}</b>
                              <p
                                className={
                                  av.level === "danger"
                                    ? "text-xs font-semibold text-red-600"
                                    : av.level === "warning"
                                      ? "text-xs font-semibold text-amber-700"
                                      : "text-xs text-muted-foreground"
                                }
                              >
                                {av.label}
                              </p>
                            </div>
                            <div className="flex gap-1">
                              <Badge variant={r.response === "pending" ? "outline" : "secondary"}>
                                {RLABEL[r.response] ?? r.response}
                              </Badge>
                              {r.selected ? <Badge>Retenu</Badge> : null}
                            </div>
                          </div>
                          {r.reserve ? (
                            <p className="mt-2">
                              <b>Réserve :</b> {r.reserve}
                            </p>
                          ) : null}
                          {r.refusal_reason ? (
                            <p className="mt-2">
                              <b>Motif :</b> {r.refusal_reason}
                            </p>
                          ) : null}
                          {offered.length ? (
                            <div className="mt-3 rounded-xl bg-muted/40 p-2">
                              <p className="text-xs font-semibold">
                                {detail.slot_selection_mode === "member"
                                  ? "Créneaux qui te conviennent"
                                  : "Créneaux proposés"}
                              </p>
                              <div className="mt-1 space-y-1">
                                {offered.map((slot) => (
                                  <label
                                    key={slot.id}
                                    className="flex items-center gap-2 rounded-lg bg-background p-2 text-xs"
                                  >
                                    <Checkbox
                                      checked={chosen.includes(slot.id)}
                                      disabled={
                                        detail.slot_selection_mode !== "member" || !canAnswer
                                      }
                                      onCheckedChange={(v) =>
                                        setAnswerSlots({
                                          ...answerSlots,
                                          [r.id]:
                                            v === true
                                              ? [...chosen, slot.id]
                                              : chosen.filter((id) => id !== slot.id),
                                        })
                                      }
                                    />
                                    {slotLabel(slot)}
                                  </label>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {canAnswer ? (
                            <div className="mt-3 flex flex-wrap gap-1">
                              <Button
                                size="sm"
                                variant={r.response === "accepted" ? "default" : "outline"}
                                onClick={() => respond(detail, r, "accepted")}
                              >
                                Accepter
                              </Button>
                              <Button
                                size="sm"
                                variant={r.response === "partial" ? "default" : "outline"}
                                onClick={() => respond(detail, r, "partial")}
                              >
                                Partiellement
                              </Button>
                              <Button
                                size="sm"
                                variant={r.response === "refused" ? "default" : "outline"}
                                onClick={() => respond(detail, r, "refused")}
                              >
                                Refuser
                              </Button>
                            </div>
                          ) : member?.id === r.member_id &&
                            detail.response_deadline &&
                            detail.response_deadline < todayIso() ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Échéance dépassée : réponse verrouillée.
                            </p>
                          ) : null}
                          {isStaff &&
                          !r.selected &&
                          (r.response === "accepted" || r.response === "partial") ? (
                            <Button
                              className="mt-3"
                              size="sm"
                              onClick={() => selectRecipient.mutate({ s: detail, r })}
                            >
                              Retenir et affecter
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {isStaff ? (
                  <div className="rounded-2xl border p-4">
                    <h3 className="font-black text-icc-violet">Actions</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {detail.status !== "cancelled" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDetail(null);
                            openEdit(detail);
                          }}
                        >
                          Modifier
                        </Button>
                      ) : null}
                      {detail.status !== "cancelled" ? (
                        <Button size="sm" variant="outline" onClick={() => cancel.mutate(detail)}>
                          Annuler la demande
                        </Button>
                      ) : null}
                      {isAdmin ? (
                        <Button size="sm" variant="ghost" onClick={() => archive.mutate(detail)}>
                          Archiver
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function ProgramFiles({ files }: { files: Array<{ id: string; title: string; url: string }> }) {
  return (
    <div className="rounded-2xl border p-4">
      <h3 className="font-black text-icc-violet">Fichiers liés au programme</h3>
      {files.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {files.map((f) => (
            <a
              key={f.id}
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl bg-muted/50 p-3 text-sm font-semibold text-icc-violet hover:underline"
            >
              📎 {f.title}
            </a>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Aucun fichier joint à ce programme.</p>
      )}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
function Filter({
  value,
  set,
  all,
  items,
}: {
  value: string;
  set: (v: string) => void;
  all: string;
  items: string[][];
}) {
  return (
    <Select value={value} onValueChange={set}>
      <SelectTrigger>
        <SelectValue placeholder={all} />
      </SelectTrigger>
      <SelectContent>
        {value === "all" || !items.some((i) => i[0] === "all") ? (
          <SelectItem value="all">{all}</SelectItem>
        ) : null}
        {items.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Checks({
  items,
  values,
  set,
}: {
  items: string[][];
  values: string[];
  set: (v: string[]) => void;
}) {
  return (
    <div className="mt-3 max-h-60 space-y-1 overflow-y-auto rounded-xl border p-2">
      {items.map(([id, label]) => (
        <label key={id} className="flex items-center gap-2 rounded-lg p-2 hover:bg-muted">
          <Checkbox
            checked={values.includes(id)}
            onCheckedChange={(c) => set(c ? [...values, id] : values.filter((x) => x !== id))}
          />
          <span className="text-sm">{label}</span>
        </label>
      ))}
    </div>
  );
}
