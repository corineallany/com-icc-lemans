import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, MessageSquareText, Pencil, Users } from "lucide-react";
import { toast } from "sonner";

import { AppShell, EmptyState } from "@/components/AppShell";
import { Field } from "@/components/admin/form-kit";
import { useCurrentRole } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  attendanceQuery,
  COMPLETION_LABEL,
  debriefsQuery,
  formatDate,
  INCIDENT_TYPES,
  logAction,
  membersQuery,
  polesQuery,
  PRESENCE_LABEL,
  programsQuery,
  RESPONSE_LABEL,
  tasksQuery,
  type ProgramDebrief,
} from "@/lib/icc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/post-service")({
  head: () => ({
    meta: [
      { title: "Post-service — COM ICC Le Mans" },
      { name: "description", content: "Retour d'expérience participatif : contributions des personnes affectées, synthèse et suites." },
    ],
  }),
  component: PostService,
});

type PresenceDraft = { member_id: string; presence: string; arrival_time: string; departure_time: string; justified: boolean | null; justification_reason: string; note: string };
type IncidentDraft = {
  type: string;
  detail: string;
  impact: "mineur" | "modere" | "important" | "critique";
  action: string;
  affected_member_id: string;
  follow_up: boolean;
  task_title: string;
};
type GlobalDraft = {
  id: string | null;
  program_id: string;
  summary: string;
  went_well: string;
  to_improve: string;
  attendance_note: string;
  rating: number;
  actual_start: string;
  actual_end: string;
  completion: string;
  difficulties: string;
  needs: string;
  to_direction: boolean;
  incidents: IncidentDraft[];
  presences: PresenceDraft[];
  status: string;
};
type Contribution = {
  id: string;
  program_id: string;
  author_member_id: string;
  pole_id: string | null;
  rating: number | null;
  went_well: string | null;
  difficulties: string | null;
  to_improve: string | null;
  needs: string | null;
  incident_note: string | null;
  proposed_action: string | null;
  to_direction: boolean;
  created_at: string;
  updated_at: string;
  service_date: string;
  service_slot_ids: string[];
  assignment_ids: string[];
};
type ContributionDraft = {
  program_id: string;
  service_date: string;
  service_slot_ids: string[];
  assignment_ids: string[];
  pole_id: string;
  rating: number;
  went_well: string;
  difficulties: string;
  to_improve: string;
  needs: string;
  incident_note: string;
  proposed_action: string;
  to_direction: boolean;
};
type AccessRow = { contribute: boolean; finalize: boolean };
type DayDebrief = { id: string; program_id: string; service_date: string; summary: string | null; went_well: string | null; difficulties: string | null; to_improve: string | null; needs: string | null; rating: number | null; status: string }; 
type DayDebriefDraft = { program_id: string; service_date: string; summary: string; went_well: string; difficulties: string; to_improve: string; needs: string; rating: number; status: string; id: string | null };

const INCIDENT_JSON_PREFIX = "__ICC_INCIDENTS_V2__";
const IMPACT_LABEL: Record<string, string> = { mineur: "Mineur", modere: "Modéré", important: "Important", critique: "Critique" };
const presentLike = new Set(["present", "retard", "partiel", "renfort"]);
const db = () => supabase as any;

function blankIncident(type: string): IncidentDraft {
  return { type, detail: "", impact: "mineur", action: "", affected_member_id: "", follow_up: false, task_title: "" };
}
function encodeIncidents(items: IncidentDraft[]) {
  if (!items.length) return null;
  return `${INCIDENT_JSON_PREFIX}${JSON.stringify(items)}`;
}
function decodeIncidents(type?: string | null, detail?: string | null): IncidentDraft[] {
  if (detail?.startsWith(INCIDENT_JSON_PREFIX)) {
    try {
      const parsed = JSON.parse(detail.slice(INCIDENT_JSON_PREFIX.length));
      if (Array.isArray(parsed)) return parsed.map((x) => ({ ...blankIncident(String(x.type ?? "Autre")), ...x }));
    } catch { /* ancien format conservé */ }
  }
  return type ? [{ ...blankIncident(type), detail: detail ?? "" }] : [];
}

function PostService() {
  const programs = useQuery(programsQuery);
  const debriefs = useQuery(debriefsQuery);
  const attendance = useQuery(attendanceQuery);
  const membersData = useQuery(membersQuery);
  const poles = useQuery(polesQuery);
  const tasks = useQuery(tasksQuery);
  const qc = useQueryClient();
  const { member, userId } = useCurrentRole();
  const [globalDraft, setGlobalDraft] = useState<GlobalDraft | null>(null);
  const [contributionDraft, setContributionDraft] = useState<ContributionDraft | null>(null);
  const serviceDays = useQuery({ queryKey: ["post-service-program-days"], queryFn: async () => { const { data, error } = await db().from("program_days").select("id,program_id,service_date,start_time,end_time,note").order("service_date"); if (error) throw new Error(error.message); return data ?? []; } });
  const serviceSlots = useQuery({ queryKey: ["post-service-service-slots"], queryFn: async () => { const { data, error } = await db().from("program_service_slots").select("id,program_id,program_day_id,assignment_id,label,start_time,end_time,actual_start_date,actual_end_date,position").order("position"); if (error) throw new Error(error.message); return data ?? []; } });
  const dayDebriefs = useQuery({ queryKey: ["program-day-debriefs"], queryFn: async () => { const { data, error } = await db().from("program_day_debriefs").select("*").order("service_date", { ascending: false }); if (error) throw new Error(error.message); return (data ?? []) as DayDebrief[]; } });
  const [dayDebriefDraft, setDayDebriefDraft] = useState<DayDebriefDraft | null>(null);
  useEffect(()=>{const id=new URLSearchParams(window.location.search).get("programId");if(!id)return;const node=document.getElementById(`post-service-${id}`);if(node)node.scrollIntoView({behavior:"smooth",block:"center"})},[programs.data]);

  const memberName = (id: string) => membersData.data?.members.find((m) => m.id === id)?.full_name ?? "Membre";
  const poleName = (id?: string | null) => id ? (poles.data?.find((p) => p.id === id)?.name ?? "Pôle") : "Transversal";
  const today = new Date().toISOString().slice(0, 10);
  const past = useMemo(() => (programs.data ?? [])
    .filter((p) => !p.archived && !p.deleted && (p.start_date ?? "9999") <= today)
    .sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""))
    .slice(0, 30), [programs.data, today]);
  const programIds = past.map((p) => p.id);

  const contributions = useQuery({
    queryKey: ["program-debrief-contributions", programIds.join("|")],
    enabled: programIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db().from("program_debrief_contributions").select("*").in("program_id", programIds).order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Contribution[];
    },
  });

  const access = useQuery({
    queryKey: ["post-service-access", userId, programIds.join("|")],
    enabled: !!userId && programIds.length > 0,
    queryFn: async () => {
      const pairs = await Promise.all(programIds.map(async (programId) => {
        const [a, b] = await Promise.all([
          db().rpc("can_contribute_post_service", { p_program_id: programId }),
          db().rpc("can_finalize_post_service", { p_program_id: programId }),
        ]);
        if (a.error) throw new Error(a.error.message);
        if (b.error) throw new Error(b.error.message);
        return [programId, { contribute: Boolean(a.data), finalize: Boolean(b.data) } as AccessRow] as const;
      }));
      return new Map<string, AccessRow>(pairs);
    },
  });

  const byProgram = new Map<string, ProgramDebrief>();
  for (const d of debriefs.data ?? []) if (!byProgram.has(d.program_id)) byProgram.set(d.program_id, d);
  const contributionByProgram = (programId: string) => (contributions.data ?? []).filter((c) => c.program_id === programId);
  const mineFor = (programId: string, serviceDate: string) => contributionByProgram(programId).find((c) => c.author_member_id === member?.id && c.service_date === serviceDate);
  const allDaysForProgram = (program: any) => {
    const rows = (serviceDays.data ?? [])
      .filter((d: any) => d.program_id === program.id)
      .map((d: any) => ({ ...d, slots: (serviceSlots.data ?? []).filter((s: any) => s.program_day_id === d.id) }))
      .sort((a: any, b: any) => String(a.service_date).localeCompare(String(b.service_date)));
    if (rows.length) return rows;
    if (program.start_date) {
      const endDate = program.end_date ?? program.start_date;
      const startTime = String(program.start_time ?? "00:00").slice(0, 5);
      const endTime = String(program.end_time ?? "23:59").slice(0, 5);
      const start = new Date(`${program.start_date}T12:00:00`);
      const end = new Date(`${endDate}T12:00:00`);
      const nextDate = new Date(start);
      nextDate.setDate(nextDate.getDate() + 1);
      const nextIso = [nextDate.getFullYear(), String(nextDate.getMonth() + 1).padStart(2, "0"), String(nextDate.getDate()).padStart(2, "0")].join("-");
      const isSingleOvernight = endDate === nextIso && endTime <= startTime;
      const dates: string[] = [];
      if (isSingleOvernight) dates.push(program.start_date);
      else {
        const cursor = new Date(start);
        while (cursor <= end && dates.length < 90) {
          dates.push([cursor.getFullYear(), String(cursor.getMonth() + 1).padStart(2, "0"), String(cursor.getDate()).padStart(2, "0")].join("-"));
          cursor.setDate(cursor.getDate() + 1);
        }
      }
      return dates.map((service_date, index) => ({
        id: `legacy-${program.id}-${service_date}`,
        program_id: program.id,
        service_date,
        start_time: index === 0 ? (program.start_time ?? null) : "00:00",
        end_time: isSingleOvernight ? endTime : service_date === endDate ? endTime : "23:59",
        slots: index === 0 ? (serviceSlots.data ?? []).filter((s: any) => s.program_id === program.id) : [],
      }));
    }
    return [];
  };

  const dayHasFinished = (day: any) => {
    const startDate = String(day.service_date ?? "");
    if (!startDate) return false;
    const startTime = String(day.start_time ?? "00:00").slice(0, 5);
    const endTime = String(day.end_time ?? day.slots?.reduce((last: string | null, s: any) => s.end_time ?? last, null) ?? "23:59").slice(0, 5);
    const crossesMidnight = /^\\d{2}:\\d{2}$/.test(startTime) && /^\\d{2}:\\d{2}$/.test(endTime) && endTime <= startTime;
    const endDate = new Date(startDate + "T" + endTime + ":00");
    if (crossesMidnight) endDate.setDate(endDate.getDate() + 1);
    return endDate.getTime() <= Date.now();
  };

  const daysForProgram = (program: any) => allDaysForProgram(program).filter(dayHasFinished);
  const isMultiDayProgram = (program: any) => allDaysForProgram(program).length > 1;
  const needsSlotPostSelection = (program: any) => {
    if (!program) return false;
    const days = allDaysForProgram(program);
    return days.some((day: any) => (day.slots?.length ?? 0) > 1) || (program.assignments ?? []).length > 1;
  };
  const isAdvancedProgram = (program: any) => isMultiDayProgram(program);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["program-day-debriefs"] });
    qc.invalidateQueries({ queryKey: ["program-debriefs"] });
    qc.invalidateQueries({ queryKey: ["program-debrief-contributions"] });
    qc.invalidateQueries({ queryKey: ["program-attendance"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["post-service-access"] });
  }

  const saveContribution = useMutation({
    mutationFn: async (value: ContributionDraft) => {
      if (!member?.id || !userId) throw new Error("Profil membre introuvable.");
      const existing = mineFor(value.program_id, value.service_date);
      const payload = {
        program_id: value.program_id,
        service_date: value.service_date,
        service_slot_ids: value.service_slot_ids,
        assignment_ids: value.assignment_ids,
        author_member_id: member.id,
        pole_id: value.pole_id || null,
        rating: value.rating || null,
        went_well: value.went_well.trim() || null,
        difficulties: value.difficulties.trim() || null,
        to_improve: value.to_improve.trim() || null,
        needs: value.needs.trim() || null,
        incident_note: value.incident_note.trim() || null,
        proposed_action: value.proposed_action.trim() || null,
        to_direction: value.to_direction,
        created_by: userId,
        updated_at: new Date().toISOString(),
      };
      const res = existing
        ? await db().from("program_debrief_contributions").update(payload).eq("id", existing.id)
        : await db().from("program_debrief_contributions").insert(payload);
      if (res.error) throw new Error(res.error.message);
      await logAction({
        action: existing ? "post_service_contribution_modifiee" : "post_service_contribution_creee",
        entity: "program_debrief_contribution",
        entityId: value.program_id,
        detail: `Retour terrain · ${poleName(value.pole_id)}`,
        actorName: member.full_name,
      });
    },
    onSuccess: () => { toast.success("Ton retour a été enregistré"); setContributionDraft(null); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveDayDebrief = useMutation({
    mutationFn: async (value: DayDebriefDraft) => {
      if (!value.id && !userId) throw new Error("Compte utilisateur introuvable.");
      const payload = { program_id: value.program_id, service_date: value.service_date, summary: value.summary.trim() || null, went_well: value.went_well.trim() || null, difficulties: value.difficulties.trim() || null, to_improve: value.to_improve.trim() || null, needs: value.needs.trim() || null, rating: value.rating || null, status: value.status, author_member_id: member?.id ?? null, created_by: userId ?? null, updated_at: new Date().toISOString() };
      const { error } = await db().from("program_day_debriefs").upsert(payload, { onConflict: "program_id,service_date" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Synthèse de la journée enregistrée"); setDayDebriefDraft(null); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveGlobal = useMutation({
    mutationFn: async (value: GlobalDraft) => {
      const payload = {
        program_id: value.program_id,
        author_member_id: member?.id ?? null,
        created_by: userId ?? null,
        summary: value.summary.trim() || null,
        went_well: value.went_well.trim() || null,
        to_improve: value.to_improve.trim() || null,
        attendance_note: value.attendance_note.trim() || null,
        rating: value.rating || null,
        actual_start: value.actual_start.trim() || null,
        actual_end: value.actual_end.trim() || null,
        completion: value.completion,
        difficulties: value.difficulties.trim() || null,
        needs: value.needs.trim() || null,
        to_direction: value.to_direction,
        incident_type: value.incidents.length === 1 ? value.incidents[0].type : value.incidents.length > 1 ? "Multiple" : null,
        incident_detail: encodeIncidents(value.incidents),
        status: value.status || "draft",
      };
      if (value.id) {
        const { error } = await db().from("program_debriefs").update(payload).eq("id", value.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await db().from("program_debriefs").insert(payload);
        if (error) throw new Error(error.message);
      }

      for (const p of value.presences) {
        if (p.presence === "retard" && !p.arrival_time) throw new Error(`Renseigne l’heure d’arrivée de ${memberName(p.member_id)}.`);
        if (["retard","absent","partiel"].includes(p.presence) && p.justified === null) throw new Error(`Précise si la situation de ${memberName(p.member_id)} est justifiée.`);
        if (["retard","absent","partiel"].includes(p.presence) && !p.justification_reason.trim()) throw new Error(`Renseigne le motif / l’explication de ${memberName(p.member_id)}.`);
      }
      const { error: delError } = await db().from("program_attendance").delete().eq("program_id", value.program_id);
      if (delError) throw new Error(delError.message);
      const rows = value.presences.filter((p) => p.presence).map((p) => ({
        program_id: value.program_id,
        member_id: p.member_id,
        presence: p.presence,
        is_reinforcement: p.presence === "renfort",
        arrival_time: p.arrival_time || null,
        departure_time: p.departure_time || null,
        justified: ["retard","absent","partiel"].includes(p.presence) ? p.justified : null,
        justification_reason: ["retard","absent","partiel"].includes(p.presence) ? (p.justification_reason.trim() || null) : null,
        note: p.note.trim() || null,
        recorded_by: userId ?? null,
      }));
      if (rows.length) {
        const { error } = await db().from("program_attendance").insert(rows);
        if (error) throw new Error(error.message);
      }

      const existingTitles = new Set((tasks.data ?? []).filter((t) => t.program_id === value.program_id).map((t) => t.title.trim().toLowerCase()));
      const followUps = value.incidents
        .filter((i) => i.follow_up)
        .map((i) => (i.task_title.trim() || `Suivi incident ${i.type}`).trim())
        .filter((title) => !existingTitles.has(title.toLowerCase()));
      if (followUps.length) {
        const { error } = await db().from("tasks").insert(followUps.map((title) => ({ title, program_id: value.program_id, status: "todo", priority: "haute" })));
        if (error) throw new Error(error.message);
      }
      await logAction({
        action: value.status === "closed" ? "post_service_cloture" : value.id ? "post_service_modifie" : "post_service_cree",
        entity: "program_debrief",
        entityId: value.program_id,
        detail: `Synthèse globale · ${value.completion}`,
        actorName: member?.full_name,
      });
    },
    onSuccess: (_d, vars) => { toast.success(vars.status === "closed" ? "Post-service clôturé" : "Synthèse enregistrée"); setGlobalDraft(null); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  function openContribution(program: any, serviceDate: string) {
    const current = mineFor(program.id, serviceDate);
    const assignedPole = (program.assignments ?? []).find((a: any) => (a.memberIds ?? []).includes(member?.id))?.pole_id ?? "";
    setContributionDraft({
      program_id: program.id,
      service_date: serviceDate,
      service_slot_ids: current?.service_slot_ids ?? [],
      assignment_ids: current?.assignment_ids ?? [],
      pole_id: current?.pole_id ?? assignedPole,
      rating: current?.rating ?? 0,
      went_well: current?.went_well ?? "",
      difficulties: current?.difficulties ?? "",
      to_improve: current?.to_improve ?? "",
      needs: current?.needs ?? "",
      incident_note: current?.incident_note ?? "",
      proposed_action: current?.proposed_action ?? "",
      to_direction: current?.to_direction ?? false,
    });
  }

  function autoSynthesis(programId: string) {
    const items = contributionByProgram(programId);
    const dayItems = (dayDebriefs.data ?? []).filter((d) => d.program_id === programId);
    const clean = (values: Array<string | null | undefined>) => {
      const seen = new Set<string>();
      return values.map((v) => (v ?? "").trim()).filter((v) => {
        if (!v) return false;
        const key = v.toLocaleLowerCase("fr").replace(/[^a-zà-ÿ0-9]+/gi, " ").trim();
        if (!key || seen.has(key)) return false;
        seen.add(key); return true;
      });
    };
    const render = (values: Array<string | null | undefined>) => clean(values).map((v) => `• ${v}`).join("\n");
    const ratings = items.map((c) => Number(c.rating)).filter((n) => n > 0);
    const avg = ratings.length ? Math.round((ratings.reduce((a,b)=>a+b,0) / ratings.length) * 10) / 10 : 0;
    const actions = clean(items.map((c) => c.proposed_action));
    const incidents = clean(items.map((c) => c.incident_note)).map((detail) => ({ ...blankIncident("Autre"), detail }));
    const polesCount = new Set(items.map((c) => c.pole_id).filter(Boolean)).size;
    return {
      summary: [items.length ? `${items.length} retour(s) terrain consolidé(s)${polesCount ? ` · ${polesCount} pôle(s)` : ""}${actions.length ? ` · ${actions.length} action(s) proposée(s)` : ""}` : "", ...clean(dayItems.map((d) => d.summary))].filter(Boolean).join("\n"),
      went_well: render([...items.map((c) => c.went_well), ...dayItems.map((d) => d.went_well)]),
      difficulties: render([...items.map((c) => c.difficulties), ...dayItems.map((d) => d.difficulties)]),
      to_improve: render([...items.map((c) => c.to_improve), ...dayItems.map((d) => d.to_improve)]),
      needs: render([...items.map((c) => c.needs), ...dayItems.map((d) => d.needs)]),
      rating: avg ? Math.max(1, Math.min(5, Math.round(avg))) : 0,
      to_direction: items.some((c) => c.to_direction),
      incidents,
      actions,
    };
  }

  function openGlobal(programId: string, debrief: ProgramDebrief | undefined) {
    const program = past.find((p) => p.id === programId);
    const assigned = Array.from(new Set((program?.assignments ?? []).flatMap((a: any) => a.memberIds ?? []))) as string[];
    const rows = (attendance.data ?? []).filter((a) => a.program_id === programId);
    const presences: PresenceDraft[] = assigned.map((id) => {
      const row = rows.find((r) => r.member_id === id);
      const r:any=row;
      return { member_id: id, presence: r?.presence ?? "present", arrival_time: r?.arrival_time ?? "", departure_time: r?.departure_time ?? "", justified: r?.justified ?? null, justification_reason: r?.justification_reason ?? "", note: r?.note ?? "" };
    });
    for (const row of rows) if (!presences.some((p) => p.member_id === row.member_id)) { const r:any=row; presences.push({ member_id: r.member_id, presence: r.presence, arrival_time: r.arrival_time ?? "", departure_time: r.departure_time ?? "", justified: r.justified ?? null, justification_reason: r.justification_reason ?? "", note: r.note ?? "" }); }
    const auto = autoSynthesis(programId);
    setGlobalDraft({
      id: debrief?.id ?? null,
      program_id: programId,
      summary: debrief?.summary ?? auto.summary,
      went_well: debrief?.went_well ?? auto.went_well,
      to_improve: debrief?.to_improve ?? auto.to_improve,
      attendance_note: debrief?.attendance_note ?? "",
      rating: debrief?.rating ?? auto.rating,
      actual_start: debrief?.actual_start ?? "",
      actual_end: debrief?.actual_end ?? "",
      completion: debrief?.completion ?? "total",
      difficulties: debrief?.difficulties ?? auto.difficulties,
      needs: debrief?.needs ?? auto.needs,
      to_direction: debrief?.to_direction ?? auto.to_direction,
      incidents: debrief ? decodeIncidents(debrief.incident_type, debrief.incident_detail) : auto.incidents,
      presences,
      status: (debrief as any)?.status ?? "draft",
    });
  }

  function toggleIncident(type: string) {
    if (!globalDraft) return;
    const exists = globalDraft.incidents.some((i) => i.type === type);
    setGlobalDraft({ ...globalDraft, incidents: exists ? globalDraft.incidents.filter((i) => i.type !== type) : [...globalDraft.incidents, blankIncident(type)] });
  }
  function patchIncident(type: string, patch: Partial<IncidentDraft>) {
    if (!globalDraft) return;
    setGlobalDraft({ ...globalDraft, incidents: globalDraft.incidents.map((i) => i.type === type ? { ...i, ...patch } : i) });
  }

  const loading = programs.isLoading || debriefs.isLoading || contributions.isLoading || access.isLoading || serviceDays.isLoading || serviceSlots.isLoading || dayDebriefs.isLoading;

  return <AppShell title="Post-service" subtitle="Un retour d’expérience collectif : chaque personne affectée peut contribuer, puis une synthèse unique est consolidée">
    {loading ? <div className="space-y-3">{[0,1,2].map((i)=><Skeleton key={i} className="h-32 rounded-2xl" />)}</div> : past.length === 0 ? <EmptyState title="Aucun programme passé" description="Le post-service s'ouvre après la date du programme." /> : <div className="space-y-4">
      {past.map((program) => {
        const debrief = byProgram.get(program.id);
        const rights = access.data?.get(program.id) ?? { contribute: false, finalize: false };
        const contribs = contributionByProgram(program.id);
        const assignedIds = Array.from(new Set((program.assignments ?? []).flatMap((a: any) => a.memberIds ?? [])));
        const counts = program.responses.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});
        const rows = (attendance.data ?? []).filter((a) => a.program_id === program.id);
        const planned = program.assignments.reduce((n, a: any) => n + (Number(a.required_count) > 0 ? Number(a.required_count) : a.memberIds.length), 0);
        const actual = rows.filter((r) => presentLike.has(r.presence)).length;
        const incidents = debrief ? decodeIncidents(debrief.incident_type, debrief.incident_detail) : [];
        const closed = (debrief as any)?.status === "closed";
        return <Card id={`post-service-${program.id}`} key={program.id} className="scroll-mt-24">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><CardTitle className="text-base">{program.title}</CardTitle><p className="text-xs text-muted-foreground">{formatDate(program.start_date)}</p></div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(counts).map(([status,count])=><Badge key={status} variant="outline">{RESPONSE_LABEL[status as keyof typeof RESPONSE_LABEL] ?? status} : {count}</Badge>)}
                <Badge variant="secondary"><Users className="mr-1 size-3"/>{new Set(contribs.map((c) => c.author_member_id)).size}/{assignedIds.length} personne(s ayant contribué)</Badge>
                {closed?<Badge>Post-service clôturé</Badge>:<Badge variant="outline">Ouvert aux retours</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isAdvancedProgram(program) ? <div className="grid gap-2 sm:grid-cols-3"><div className="rounded-lg bg-muted p-2 text-sm"><b>Prévu</b><p>{planned} personne(s)</p></div><div className="rounded-lg bg-muted p-2 text-sm"><b>Réel</b><p>{rows.length ? `${actual} présent(s) / ${rows.length} relevé(s)` : "À renseigner dans la synthèse"}</p></div><div className="rounded-lg bg-muted p-2 text-sm"><b>Contributions</b><p>{contribs.length} retour(s) terrain</p></div></div> : null}

            <div className="flex flex-wrap gap-2">
              {rights.finalize ? <Button size="sm" variant="outline" onClick={()=>openGlobal(program.id,debrief)}><Pencil className="size-4"/>{debrief?"Ouvrir la synthèse":"Créer la synthèse"}</Button> : null}
            </div>

            {isAdvancedProgram(program) ? <div className="space-y-3"><p className="text-sm font-bold text-icc-violet">Retours par journée de service</p>{daysForProgram(program).map((day: any) => { const dayContribs = contribs.filter((c) => c.service_date === day.service_date); const own = mineFor(program.id, day.service_date); const dayDebrief = (dayDebriefs.data ?? []).find((d) => d.program_id === program.id && d.service_date === day.service_date); return <details key={day.id} className="rounded-xl border p-3"><summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2"><span><b>{formatDate(day.service_date)}</b><span className="ml-2 text-xs text-muted-foreground">{day.slots?.length ? day.slots.length + " créneau(x)" : "Journée de service"}</span></span><span className="text-xs text-muted-foreground">Ouvrir / réduire</span></summary><div className="mt-3 space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><b>{formatDate(day.service_date)}</b><p className="text-xs text-muted-foreground">{day.slots?.length ? day.slots.length + " créneau(x) prévu(s)" : "Journée de service"}</p></div>{rights.contribute ? <Button size="sm" variant={own?"outline":"default"} disabled={closed} onClick={()=>openContribution(program,day.service_date)}><MessageSquareText className="size-4"/>{own?"Modifier mon retour":"Ajouter mon retour"}</Button> : null}</div>{day.slots?.length ? <div className="flex flex-wrap gap-1">{day.slots.map((s:any)=><Badge key={s.id} variant="outline">{s.label || "Créneau"} {s.actual_start_date && s.actual_start_date !== day.service_date ? formatDate(s.actual_start_date) + " · " : ""}{s.start_time || s.end_time ? (s.start_time || "?").slice(0,5) + "–" + (s.end_time || "?").slice(0,5) + (s.actual_end_date && s.actual_start_date && s.actual_end_date !== s.actual_start_date ? " · fin " + formatDate(s.actual_end_date) : "") : ""}</Badge>)}</div> : <p className="text-xs text-muted-foreground">Aucun créneau détaillé enregistré pour cette journée.</p>}{dayContribs.length ? <div className="grid gap-2 md:grid-cols-2">{dayContribs.map((c)=><div key={c.id} className="rounded-xl border p-3 text-sm"><b>{memberName(c.author_member_id)}</b>{c.service_slot_ids?.length ? <p className="text-xs text-muted-foreground">Créneaux sélectionnés : {c.service_slot_ids.map((sid)=>day.slots?.find((s:any)=>s.id===sid)?.label || day.slots?.find((s:any)=>s.id===sid)?.start_time || "Créneau").join(", ")}</p> : null}{c.assignment_ids?.length ? <p className="text-xs text-muted-foreground">Postes sélectionnés : {(program.assignments??[]).filter((a:any)=>c.assignment_ids.includes(a.id)).map((a:any)=>a.tasks || poleName(a.pole_id)).join(", ")}</p> : null}{c.went_well ? <p className="mt-1"><b>Bien :</b> {c.went_well}</p> : null}{c.difficulties ? <p><b>Difficultés :</b> {c.difficulties}</p> : null}{c.to_improve ? <p><b>À améliorer :</b> {c.to_improve}</p> : null}{c.needs ? <p><b>Besoins :</b> {c.needs}</p> : null}</div>)}</div> : <p className="text-xs text-muted-foreground">Aucun retour pour cette journée.</p>}{rights.finalize ? <Button size="sm" variant="outline" onClick={() => setDayDebriefDraft({id: dayDebrief?.id ?? null,program_id:program.id,service_date:day.service_date,summary:dayDebrief?.summary ?? "",went_well:dayDebrief?.went_well ?? "",difficulties:dayDebrief?.difficulties ?? "",to_improve:dayDebrief?.to_improve ?? "",needs:dayDebrief?.needs ?? "",rating:dayDebrief?.rating ?? 0,status:dayDebrief?.status ?? "draft"})}><Pencil className="size-4"/>{dayDebrief ? "Modifier la synthèse du jour" : "Créer la synthèse du jour"}</Button> : null}{dayDebrief ? <div className="rounded-lg bg-muted/30 p-3 text-sm"><b>Synthèse du jour</b>{dayDebrief.rating ? <Badge className="ml-2">{dayDebrief.rating}/5</Badge> : null}{dayDebrief.summary ? <p className="mt-1">{dayDebrief.summary}</p> : null}{dayDebrief.went_well ? <p><b>Bien :</b> {dayDebrief.went_well}</p> : null}{dayDebrief.difficulties ? <p><b>Difficultés :</b> {dayDebrief.difficulties}</p> : null}{dayDebrief.to_improve ? <p><b>À améliorer :</b> {dayDebrief.to_improve}</p> : null}{dayDebrief.needs ? <p><b>Besoins :</b> {dayDebrief.needs}</p> : null}</div> : null}</div></details>})}</div> : <div className="space-y-3 rounded-xl border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-bold text-icc-violet">Retour post-service</p><p className="text-xs text-muted-foreground">Un retour unique pour ce programme.</p></div>{rights.contribute ? <Button size="sm" variant={mineFor(program.id, program.start_date)?"outline":"default"} disabled={closed} onClick={()=>openContribution(program,program.start_date)}><MessageSquareText className="size-4"/>{mineFor(program.id, program.start_date)?"Modifier mon retour":"Ajouter mon retour"}</Button> : null}</div>{contribs.filter((c)=>c.service_date===program.start_date).length ? <div className="grid gap-2 md:grid-cols-2">{contribs.filter((c)=>c.service_date===program.start_date).map((c)=><div key={c.id} className="rounded-lg bg-muted/30 p-3 text-sm"><b>{memberName(c.author_member_id)}</b>{c.service_slot_ids?.length ? <p className="text-xs text-muted-foreground">Créneaux : {c.service_slot_ids.map((sid)=> (serviceSlots.data ?? []).find((s:any)=>s.id===sid)?.label || (serviceSlots.data ?? []).find((s:any)=>s.id===sid)?.start_time || "Créneau").join(", ")}</p> : null}{c.assignment_ids?.length ? <p className="text-xs text-muted-foreground">Postes : {(program.assignments??[]).filter((a:any)=>c.assignment_ids.includes(a.id)).map((a:any)=>a.tasks || poleName(a.pole_id)).join(", ")}</p> : null}{c.went_well?<p className="mt-1"><b>Bien :</b> {c.went_well}</p>:null}{c.difficulties?<p><b>Difficultés :</b> {c.difficulties}</p>:null}{c.to_improve?<p><b>À améliorer :</b> {c.to_improve}</p>:null}{c.needs?<p><b>Besoins :</b> {c.needs}</p>:null}</div>)}</div> : <p className="text-xs text-muted-foreground">Aucun retour pour ce programme.</p>}</div>}
            {debrief ? <div className="rounded-xl border bg-muted/20 p-3 text-sm"><div className="mb-2 flex items-center justify-between"><b className="text-icc-violet">Synthèse globale</b>{debrief.rating?<Badge variant="secondary">{debrief.rating}/5</Badge>:null}</div><p className="text-xs text-muted-foreground">{COMPLETION_LABEL[debrief.completion] ?? debrief.completion}{debrief.actual_start || debrief.actual_end ? ` · Horaires réels ${debrief.actual_start ?? "?"} → ${debrief.actual_end ?? "?"}` : ""}</p>{debrief.summary?<p className="mt-1">{debrief.summary}</p>:null}{debrief.went_well?<p><b>A bien fonctionné :</b> {debrief.went_well}</p>:null}{debrief.to_improve?<p><b>À améliorer :</b> {debrief.to_improve}</p>:null}{debrief.difficulties?<p><b>Difficultés :</b> {debrief.difficulties}</p>:null}{debrief.needs?<p><b>Besoins :</b> {debrief.needs}</p>:null}{incidents.length?<p><b>Incidents consolidés :</b> {incidents.length}</p>:null}{debrief.to_direction?<Badge className="mt-2">Remonté à la Direction</Badge>:null}</div> : null}
          </CardContent>
        </Card>
      })}
    </div>}

    <Dialog open={!!dayDebriefDraft} onOpenChange={(o)=>!o&&setDayDebriefDraft(null)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Synthèse du jour — {dayDebriefDraft ? formatDate(dayDebriefDraft.service_date) : ""}</DialogTitle></DialogHeader>
        {dayDebriefDraft ? <div className="space-y-3"><Field label="Synthèse de la journée"><Textarea value={dayDebriefDraft.summary} onChange={(e)=>setDayDebriefDraft({...dayDebriefDraft,summary:e.target.value})}/></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Ce qui a bien fonctionné"><Textarea value={dayDebriefDraft.went_well} onChange={(e)=>setDayDebriefDraft({...dayDebriefDraft,went_well:e.target.value})}/></Field><Field label="Difficultés"><Textarea value={dayDebriefDraft.difficulties} onChange={(e)=>setDayDebriefDraft({...dayDebriefDraft,difficulties:e.target.value})}/></Field><Field label="À améliorer"><Textarea value={dayDebriefDraft.to_improve} onChange={(e)=>setDayDebriefDraft({...dayDebriefDraft,to_improve:e.target.value})}/></Field><Field label="Besoins / suites"><Textarea value={dayDebriefDraft.needs} onChange={(e)=>setDayDebriefDraft({...dayDebriefDraft,needs:e.target.value})}/></Field></div><Field label="Appréciation de la journée /5"><Input type="number" min="1" max="5" value={dayDebriefDraft.rating || ""} onChange={(e)=>setDayDebriefDraft({...dayDebriefDraft,rating:Number(e.target.value)||0})}/></Field></div> : null}
        <DialogFooter><Button variant="ghost" onClick={()=>setDayDebriefDraft(null)}>Annuler</Button><Button disabled={saveDayDebrief.isPending} onClick={()=>dayDebriefDraft&&saveDayDebrief.mutate(dayDebriefDraft)}>Enregistrer la synthèse du jour</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={!!contributionDraft} onOpenChange={(o)=>!o&&setContributionDraft(null)}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Mon retour post-service</DialogTitle></DialogHeader>
        {contributionDraft ? <div className="space-y-4">
          <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">Ton retour est personnel et identifié. Il contribue au bilan collectif sans remplacer les retours des autres personnes affectées.</p>
          <div className="rounded-lg bg-muted/40 p-3 text-sm">{needsSlotPostSelection(past.find(p=>p.id===contributionDraft.program_id)) ? <><b>Service :</b> {formatDate(contributionDraft.service_date)}. Sélectionne les créneaux et postes réellement effectués ; un seul retour est enregistré pour cette date de service.</> : <>Un seul retour pour le programme, comme auparavant.</> }</div>
          <section className={needsSlotPostSelection(past.find(p=>p.id===contributionDraft.program_id)) ? "space-y-2" : "hidden"}><p className="text-sm font-semibold">Créneaux effectués</p>{(serviceSlots.data ?? []).filter((s:any)=>s.program_id===contributionDraft.program_id && ((serviceDays.data ?? []).some((d:any)=>d.program_id===contributionDraft.program_id) ? (serviceDays.data ?? []).some((d:any)=>d.id===s.program_day_id && d.service_date===contributionDraft.service_date) : !s.program_day_id)).map((s:any)=><label key={s.id} className="flex items-center gap-2 text-sm"><Checkbox checked={contributionDraft.service_slot_ids.includes(s.id)} onCheckedChange={(v)=>setContributionDraft({...contributionDraft,service_slot_ids:v===true?[...new Set([...contributionDraft.service_slot_ids,s.id])]:contributionDraft.service_slot_ids.filter((id)=>id!==s.id)})}/>{s.label || "Créneau"} {s.start_time || s.end_time ? (s.start_time || "?").slice(0,5) + "–" + (s.end_time || "?").slice(0,5) + (s.start_time && s.end_time && String(s.end_time).slice(0,5) <= String(s.start_time).slice(0,5) ? " (lendemain)" : "") : ""}</label>)}</section>
          <section className={isAdvancedProgram(past.find(p=>p.id===contributionDraft.program_id)) ? "space-y-2" : "hidden"}><p className="text-sm font-semibold">Postes / affectations effectués</p>{(past.find(p=>p.id===contributionDraft.program_id)?.assignments ?? []).map((a:any)=><label key={a.id} className="flex items-center gap-2 text-sm"><Checkbox checked={contributionDraft.assignment_ids.includes(a.id)} onCheckedChange={(v)=>setContributionDraft({...contributionDraft,assignment_ids:v===true?[...new Set([...contributionDraft.assignment_ids,a.id])]:contributionDraft.assignment_ids.filter((id)=>id!==a.id)})}/>{poleName(a.pole_id)} — {a.tasks || "Poste"}</label>)}</section>
          <Field label="Pôle concerné"><Select value={contributionDraft.pole_id||"transversal"} onValueChange={(v)=>setContributionDraft({...contributionDraft,pole_id:v==="transversal"?"":v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="transversal">Transversal / général</SelectItem>{Array.from(new Set((past.find(p=>p.id===contributionDraft.program_id)?.assignments??[]).map((a:any)=>a.pole_id))).map((pid:any)=><SelectItem key={pid} value={pid}>{poleName(pid)}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Appréciation personnelle /5"><Input type="number" min="1" max="5" value={contributionDraft.rating||""} onChange={(e)=>setContributionDraft({...contributionDraft,rating:Number(e.target.value)||0})}/></Field>
          <Field label="Ce qui a bien fonctionné"><Textarea value={contributionDraft.went_well} onChange={(e)=>setContributionDraft({...contributionDraft,went_well:e.target.value})}/></Field>
          <Field label="Difficultés rencontrées"><Textarea value={contributionDraft.difficulties} onChange={(e)=>setContributionDraft({...contributionDraft,difficulties:e.target.value})}/></Field>
          <Field label="Ce qu'on pourrait améliorer"><Textarea value={contributionDraft.to_improve} onChange={(e)=>setContributionDraft({...contributionDraft,to_improve:e.target.value})}/></Field>
          <Field label="Besoins identifiés"><Textarea value={contributionDraft.needs} onChange={(e)=>setContributionDraft({...contributionDraft,needs:e.target.value})}/></Field>
          <Field label="Incident / alerte éventuelle"><Textarea value={contributionDraft.incident_note} onChange={(e)=>setContributionDraft({...contributionDraft,incident_note:e.target.value})}/></Field>
          <Field label="Action ou solution proposée"><Textarea value={contributionDraft.proposed_action} onChange={(e)=>setContributionDraft({...contributionDraft,proposed_action:e.target.value})}/></Field>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={contributionDraft.to_direction} onCheckedChange={(v)=>setContributionDraft({...contributionDraft,to_direction:v===true})}/>Je recommande une remontée à la Direction</label>
        </div> : null}
        <DialogFooter><Button variant="ghost" onClick={()=>setContributionDraft(null)}>Annuler</Button><Button disabled={saveContribution.isPending} onClick={()=>contributionDraft&&saveContribution.mutate(contributionDraft)}>Enregistrer mon retour</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={!!globalDraft} onOpenChange={(o)=>!o&&setGlobalDraft(null)}>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto">
        <DialogHeader><DialogTitle>Synthèse du Post-service</DialogTitle></DialogHeader>
        {globalDraft ? <div className="space-y-5">
          <div className="rounded-xl bg-muted/40 p-3 text-sm"><b>Contributions reçues : </b>{contributionByProgram(globalDraft.program_id).length}. La synthèse est unique pour le programme et vient consolider les retours terrain.</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="Réalisation"><Select value={globalDraft.completion} onValueChange={(v)=>setGlobalDraft({...globalDraft,completion:v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{Object.entries(COMPLETION_LABEL).map(([v,l])=><SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></Field><Field label="Heure réelle début"><Input value={globalDraft.actual_start} onChange={(e)=>setGlobalDraft({...globalDraft,actual_start:e.target.value})}/></Field><Field label="Heure réelle fin"><Input value={globalDraft.actual_end} onChange={(e)=>setGlobalDraft({...globalDraft,actual_end:e.target.value})}/></Field><Field label="Note globale /5"><Input type="number" min="1" max="5" value={globalDraft.rating||""} onChange={(e)=>setGlobalDraft({...globalDraft,rating:Number(e.target.value)||0})}/></Field></div>
          <Field label="Synthèse générale"><Textarea value={globalDraft.summary} onChange={(e)=>setGlobalDraft({...globalDraft,summary:e.target.value})}/></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Ce qui a bien fonctionné"><Textarea value={globalDraft.went_well} onChange={(e)=>setGlobalDraft({...globalDraft,went_well:e.target.value})}/></Field><Field label="À améliorer"><Textarea value={globalDraft.to_improve} onChange={(e)=>setGlobalDraft({...globalDraft,to_improve:e.target.value})}/></Field><Field label="Difficultés"><Textarea value={globalDraft.difficulties} onChange={(e)=>setGlobalDraft({...globalDraft,difficulties:e.target.value})}/></Field><Field label="Besoins / suites"><Textarea value={globalDraft.needs} onChange={(e)=>setGlobalDraft({...globalDraft,needs:e.target.value})}/></Field></div>
          <section className="space-y-3"><div><h3 className="font-bold text-icc-violet">Présence réelle de l’équipe</h3><p className="text-xs text-muted-foreground">Chaque personne affectée est préremplie « Présent ». Modifie uniquement les exceptions. Les retards, absences et présences partielles restent des faits distincts de leur justification.</p></div>{globalDraft.presences.map((p,i)=>{const exceptional=["retard","absent","partiel"].includes(p.presence);const patch=(changes:Partial<PresenceDraft>)=>setGlobalDraft({...globalDraft,presences:globalDraft.presences.map((x,j)=>j===i?{...x,...changes}:x)});return <div key={p.member_id} className="space-y-3 rounded-xl border p-3"><div className="grid gap-2 sm:grid-cols-[1fr_220px]"><div className="text-sm font-semibold">{memberName(p.member_id)}</div><Select value={p.presence} onValueChange={(v)=>patch({presence:v,justified:["retard","absent","partiel"].includes(v)?p.justified:null,justification_reason:["retard","absent","partiel"].includes(v)?p.justification_reason:"",arrival_time:["retard","partiel"].includes(v)?p.arrival_time:"",departure_time:v==="partiel"?p.departure_time:""})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{Object.entries(PRESENCE_LABEL).map(([v,l])=><SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>{p.presence==="retard"?<div className="grid gap-2 sm:grid-cols-2"><Field label="Heure d’arrivée constatée *"><Input type="time" value={p.arrival_time} onChange={(e)=>patch({arrival_time:e.target.value})}/></Field><div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">L’heure d’arrivée permet de constater le retard sans préjuger de sa justification.</div></div>:null}{p.presence==="partiel"?<div className="grid gap-2 sm:grid-cols-2"><Field label="Heure d’arrivée"><Input type="time" value={p.arrival_time} onChange={(e)=>patch({arrival_time:e.target.value})}/></Field><Field label="Heure de départ"><Input type="time" value={p.departure_time} onChange={(e)=>patch({departure_time:e.target.value})}/></Field></div>:null}{exceptional?<div className="space-y-2"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Justification *</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant={p.justified===true?"default":"outline"} onClick={()=>patch({justified:true})}>Oui, justifié</Button><Button type="button" size="sm" variant={p.justified===false?"destructive":"outline"} onClick={()=>patch({justified:false})}>Non justifié</Button></div><Field label={"Motif / explication *"}><Textarea placeholder={p.presence==="retard"?"Ex. transport, urgence familiale, incident sur le trajet…":p.presence==="absent"?"Préciser la raison de l’absence…":"Préciser la raison de la présence partielle…"} value={p.justification_reason} onChange={(e)=>patch({justification_reason:e.target.value})}/></Field></div>:null}<Field label="Note complèmentaire"><Input placeholder="Observation facultative" value={p.note} onChange={(e)=>patch({note:e.target.value})}/></Field></div>})}</section>
          <Field label="Note générale sur les présences"><Textarea value={globalDraft.attendance_note} onChange={(e)=>setGlobalDraft({...globalDraft,attendance_note:e.target.value})}/></Field>
          <section className="space-y-3"><h3 className="font-bold text-icc-violet">Incidents consolidés</h3><div className="flex flex-wrap gap-2">{INCIDENT_TYPES.map((type)=><Button key={type} type="button" size="sm" variant={globalDraft.incidents.some(i=>i.type===type)?"default":"outline"} onClick={()=>toggleIncident(type)}>{type}</Button>)}</div>{globalDraft.incidents.map((inc)=><div key={inc.type} className="space-y-2 rounded-xl border p-3"><div className="flex items-center justify-between"><b>{inc.type}</b><Badge variant="outline">{IMPACT_LABEL[inc.impact]}</Badge></div><div className="grid gap-2 sm:grid-cols-2"><Field label="Impact"><Select value={inc.impact} onValueChange={(v)=>patchIncident(inc.type,{impact:v as any})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{Object.entries(IMPACT_LABEL).map(([v,l])=><SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></Field><Field label="Personne concernée"><Select value={inc.affected_member_id||"none"} onValueChange={(v)=>patchIncident(inc.type,{affected_member_id:v==="none"?"":v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">Non précisé</SelectItem>{membersData.data?.members.map(m=><SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}</SelectContent></Select></Field></div><Field label="Détail"><Textarea value={inc.detail} onChange={(e)=>patchIncident(inc.type,{detail:e.target.value})}/></Field><Field label="Action prise sur place"><Textarea value={inc.action} onChange={(e)=>patchIncident(inc.type,{action:e.target.value})}/></Field><label className="flex items-center gap-2 text-sm"><Checkbox checked={inc.follow_up} onCheckedChange={(v)=>patchIncident(inc.type,{follow_up:v===true})}/>Créer un suivi dans À faire</label>{inc.follow_up?<Field label="Titre de la tâche"><Input value={inc.task_title} onChange={(e)=>patchIncident(inc.type,{task_title:e.target.value})}/></Field>:null}</div>)}</section>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={globalDraft.to_direction} onCheckedChange={(v)=>setGlobalDraft({...globalDraft,to_direction:v===true})}/>Remonter la synthèse à la Direction</label>
        </div> : null}
        <DialogFooter className="flex-wrap"><Button variant="ghost" onClick={()=>setGlobalDraft(null)}>Fermer</Button>{globalDraft?.status!=="closed"?<><Button variant="outline" disabled={saveGlobal.isPending} onClick={()=>globalDraft&&saveGlobal.mutate({...globalDraft,status:"draft"})}>Enregistrer sans clôturer</Button><Button disabled={saveGlobal.isPending} onClick={()=>globalDraft&&saveGlobal.mutate({...globalDraft,status:"closed"})}><CheckCircle2 className="size-4"/>Clôturer le Post-service</Button></>:<Badge>Clôturé — retours verrouillés</Badge>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </AppShell>;
}
