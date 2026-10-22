import { programError } from "@/lib/program-errors";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import { toast } from "sonner";
import { Field, newId } from "@/components/admin/form-kit";
import { useCurrentRole } from "@/hooks/useAuth";
import { RecurrenceFields } from "@/components/programs/RecurrenceFields";
import { recurrenceDates, type RecurrenceRule } from "@/lib/recurrence";
import {
  canonicalProgramFormat,
  canonicalProgramRecurrence,
  PROGRAM_EDITOR_AUDIENCE_OPTIONS,
  PROGRAM_EDITOR_FORMAT_OPTIONS,
  PROGRAM_EDITOR_TYPE_OPTIONS,
} from "@/lib/programLabels";
import { supabase } from "@/integrations/supabase/client";
import {
  availabilityQuery,
  membersQuery,
  polesQuery,
  programsQuery,
  logAction,
  type ProgramWithDetails,
} from "@/lib/icc";
import { Button } from "@/components/ui/button";
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
import {
  ProgramServiceSlotsEditor,
  type ServiceSlotDraft,
} from "@/components/admin/ProgramServiceSlotsEditor";

const STATUSES = [
  ["unconfirmed", "Non confirmé"],
  ["confirmed", "Confirmé"],
  ["postponed", "Reporté"],
  ["cancelled", "Annulé"],
];
const IMPORTANCES = [
  ["critical", "Critique"],
  ["important", "Importante"],
  ["normal", "Normale"],
  ["low", "Faible"],
];
const RECURRENCES = [
  ["ponctuel", "Ponctuel"],
  ["hebdo", "Hebdomadaire"],
  ["1_semaine_sur_2", "Une semaine sur 2"],
  ["bimensuel", "Bimensuel"],
  ["mensuel", "Mensuel"],
  ["trimestriel", "Trimestriel"],
  ["annuel", "Annuel"],
];
type PoleDraft = { selected: boolean; tasks: string; memberIds: string[]; requiredBySlot: Record<string, number | "">; memberModes: Record<string, "direct" | "solicited">; memberSlotIds: Record<string, string[]> };
type Draft = {
  id: string | null;
  creation_key: string;
  title: string;
  description: string;
  program_type: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  response_deadline: string;
  response_deadline_offset_value: string;
  response_deadline_offset_unit: "hours" | "days";
  response_deadline_anchor: "program" | "slot";
  location: string;
  status: string;
  importance: string;
  format: string;
  recurrence: string;
  recurrence_until: string;
  recurrence_rule: RecurrenceRule & { source_program_id?: string };
  travel_member_ids: string[];
  audience: string;
  onsite: string;
  travel: string;
  invite_members: string;
  resource_link: string;
  general_note: string;
  poles: Record<string, PoleDraft>;
  detailed_scheduling: boolean;
  slot_selection_mode: "organizer" | "member";
  serviceSlots: ServiceSlotDraft[];
};
const emptyDraft = (): Draft => ({
  id: null,
  creation_key: crypto.randomUUID(),
  title: "",
  description: "",
  program_type: "Église",
  start_date: "",
  start_time: "",
  end_date: "",
  end_time: "",
  response_deadline: "",
  response_deadline_offset_value: "",
  response_deadline_offset_unit: "hours",
  response_deadline_anchor: "program",
  location: "",
  status: "unconfirmed",
  importance: "normal",
  format: "Présentiel",
  recurrence: "ponctuel",
  recurrence_until: "",
  recurrence_rule: {},
  travel_member_ids: [],
  audience: "ICC",
  onsite: "",
  travel: "",
  invite_members: "",
  resource_link: "",
  general_note: "",
  poles: {},
  detailed_scheduling: false,
  slot_selection_mode: "organizer",
  serviceSlots: [],
});
const todayIso = () => new Date().toISOString().slice(0, 10);
const dateRange = (start: string, end: string) => {
  const out: string[] = [];
  if (!start) return out;
  let d = new Date(`${start}T12:00:00`),
    last = new Date(`${end || start}T12:00:00`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
};

export function AdminProgrammes({ openNewOnMount = false }: { openNewOnMount?: boolean }) {
  const programs = useQuery(programsQuery),
    poles = useQuery(polesQuery),
    members = useQuery(membersQuery),
    availability = useQuery(availabilityQuery);
  const qc = useQueryClient();
  const { member: actor } = useCurrentRole();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showAllComMembers, setShowAllComMembers] = useState(false);
  const [globalPoleChoice, setGlobalPoleChoice] = useState<Record<string, string>>({});
  useEffect(() => {
    if (openNewOnMount) {
      setDraft(emptyDraft());
      setPendingFiles([]);
    }
  }, [openNewOnMount]);
  const activePrograms = useMemo(
    () => (programs.data ?? []).filter((p) => !p.archived && !p.deleted),
    [programs.data],
  );
  const activePoles = useMemo(() => (poles.data ?? []).filter((p) => !p.archived), [poles.data]);
  const links = members.data?.links ?? [],
    allMembers = members.data?.members ?? [];
  function unavailable(mid: string) {
    if (!draft?.start_date) return false;
    const s = new Date(`${draft.start_date}T${draft.start_time || "00:00"}:00`).getTime(),
      e = new Date(
        `${draft.end_date || draft.start_date}T${draft.end_time || "23:59"}:00`,
      ).getTime();
    return (availability.data ?? []).some(
      (a: any) =>
        a.member_id === mid &&
        a.status === "validated" &&
        new Date(a.validated_starts_at || a.starts_at).getTime() <= e &&
        new Date(a.validated_ends_at || a.ends_at).getTime() >= s,
    );
  }
  async function edit(p: ProgramWithDetails) {
    const map: Record<string, PoleDraft> = {};
    p.assignments.forEach(
      (a) => (map[a.pole_id] = { selected: true, tasks: a.tasks ?? "", memberIds: a.memberIds, requiredBySlot: {}, memberModes: {}, memberSlotIds: {} }),
    );
    setPendingFiles([]);
    const t = supabase as any;
    const dayRes = await t.from("program_days").select("id,service_date").eq("program_id", p.id);
    const slotRes = await t
      .from("program_service_slots")
      .select("*")
      .eq("program_id", p.id)
      .order("position");
    if (dayRes.error || slotRes.error) {
      toast.error("Impossible de charger les créneaux.");
      return;
    }
    const memberRows = p.assignments.length
      ? await t
          .from("program_assignment_members")
          .select("id,assignment_id,member_id,assignment_mode")
          .in(
            "assignment_id",
            p.assignments.map((a) => a.id),
          )
      : { data: [], error: null };
    const needRes = p.assignments.length && (slotRes.data ?? []).length
      ? await t
          .from("program_assignment_slot_needs")
          .select("assignment_id,service_slot_id,required_count")
          .in("assignment_id", p.assignments.map((a: any) => a.id))
          .in("service_slot_id", (slotRes.data ?? []).map((s: any) => s.id))
      : { data: [], error: null };
    const memberSlots = (slotRes.data ?? []).length
      ? await t
          .from("program_assignment_member_slots")
          .select("assignment_member_id,service_slot_id")
          .in(
            "service_slot_id",
            slotRes.data.map((s: any) => s.id),
          )
      : { data: [], error: null };
    if (memberRows.error || memberSlots.error || needRes.error) {
      toast.error("Impossible de charger les besoins ou affectations des créneaux.");
      return;
    }
    const dayMap = new Map((dayRes.data ?? []).map((d: any) => [d.id, d.service_date]));
    const assignmentMap = new Map(p.assignments.map((a: any) => [a.id, a.pole_id]));
    for (const memberAssignment of (memberRows.data ?? []) as any[]) {
      const poleId = assignmentMap.get(memberAssignment.assignment_id);
      if (!poleId) continue;
      const existing = map[poleId] ?? { selected: true, tasks: "", memberIds: [], requiredBySlot: {}, memberModes: {}, memberSlotIds: {} };
      map[poleId] = {
        ...existing,
        memberModes: {
          ...(existing.memberModes ?? {}),
          [memberAssignment.member_id]: memberAssignment.assignment_mode === "solicited" ? "solicited" : "direct",
        },
      };
    }
    const serviceSlots: ServiceSlotDraft[] = (slotRes.data ?? []).map((s: any) => ({
      key: s.id,
      service_date: s.actual_start_date ?? dayMap.get(s.program_day_id) ?? p.start_date ?? "",
      label: s.label ?? "",
      start_time: s.start_time ?? "",
      end_time: s.end_time ?? "",
      required_count: s.required_count ?? 1,
      deadline_override: s.response_deadline_offset_value != null,
      response_deadline_offset_value: s.response_deadline_offset_value == null ? "" : String(s.response_deadline_offset_value),
      response_deadline_offset_unit: s.response_deadline_offset_unit === "days" ? "days" : "hours",
      response_deadline_anchor: s.response_deadline_anchor === "program" ? "program" : "slot",
      // Legacy pole/member fields are intentionally no longer edited inside a slot.
      pole_id: "",
      memberIds: [],
    }));
    for (const memberSlot of (memberSlots.data ?? []) as any[]) {
      const memberAssignment = (memberRows.data ?? []).find((row: any) => row.id === memberSlot.assignment_member_id);
      const poleId = memberAssignment ? assignmentMap.get(memberAssignment.assignment_id) : null;
      const slot = serviceSlots.find((item) => item.key === memberSlot.service_slot_id);
      if (poleId && memberAssignment && slot) {
        const existing = map[poleId] ?? { selected: true, tasks: "", memberIds: [], requiredBySlot: {}, memberModes: {}, memberSlotIds: {} };
        const priorSlots = existing.memberSlotIds?.[memberAssignment.member_id] ?? [];
        map[poleId] = {
          ...existing,
          memberIds: [...new Set([...existing.memberIds, memberAssignment.member_id])],
          memberModes: {
            ...(existing.memberModes ?? {}),
            [memberAssignment.member_id]: memberAssignment.assignment_mode === "solicited" ? "solicited" : "direct",
          },
          memberSlotIds: {
            ...(existing.memberSlotIds ?? {}),
            [memberAssignment.member_id]: [...new Set([...priorSlots, slot.key])],
          },
        };
      }
    }
    for (const need of (needRes.data ?? []) as any[]) {
      const poleId = assignmentMap.get(
        p.assignments.find((a: any) => a.id === need.assignment_id)?.id ?? "",
      );
      const slot = serviceSlots.find((s) => s.key === need.service_slot_id);
      if (poleId && slot) {
        const existing = map[poleId] ?? { selected: true, tasks: "", memberIds: [], requiredBySlot: {}, memberModes: {}, memberSlotIds: {} };
        map[poleId] = {
          ...existing,
          requiredBySlot: { ...(existing.requiredBySlot ?? {}), [slot.key]: Number(need.required_count) },
        };
      }
    }
    setDraft({
      id: p.id,
      creation_key: (p as any).creation_key ?? crypto.randomUUID(),
      title: p.title,
      description: p.description ?? "",
      program_type: p.program_type ?? "Église",
      start_date: p.start_date ?? "",
      start_time: p.start_time ?? "",
      end_date: p.end_date ?? "",
      end_time: p.end_time ?? "",
      response_deadline: (p as any).response_deadline ?? "",
      response_deadline_offset_value: (p as any).response_deadline_offset_value == null ? "" : String((p as any).response_deadline_offset_value),
      response_deadline_offset_unit: (p as any).response_deadline_offset_unit === "days" ? "days" : "hours",
      response_deadline_anchor: (p as any).response_deadline_anchor === "slot" ? "slot" : "program",
      location: p.location ?? "",
      status: p.status,
      importance: p.importance ?? "normal",
      format: p.format ?? "Présentiel",
      recurrence: p.recurrence ?? "ponctuel",
      recurrence_until: p.recurrence_until ?? "",
      recurrence_rule: (p.recurrence_rule as any) ?? {},
      travel_member_ids: (p as any).travel_member_ids ?? [],
      audience: p.audience ?? "ICC",
      onsite: p.onsite ?? "",
      travel: p.travel ?? "",
      invite_members: p.invite_members ?? "",
      resource_link: p.resource_link ?? "",
      general_note: p.general_note ?? "",
      poles: map,
      detailed_scheduling: (p as any).detailed_scheduling ?? serviceSlots.length > 0,
      slot_selection_mode: (p as any).slot_selection_mode === "recipient_choice" ? "member" : "organizer",
      serviceSlots,
    });
  }
  async function uploadFiles(programId: string) {
    if (!pendingFiles.length) return;
    for (const file of pendingFiles) {
      if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} dépasse 25 Mo.`);
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const path = `programs/${programId}/${crypto.randomUUID()}-${safe}`;
      const { error } = await supabase.storage.from("icc-files").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });
      if (error) throw new Error(`Envoi de ${file.name} impossible : ${error.message}`);
      const { data } = supabase.storage.from("icc-files").getPublicUrl(path);
      const ins = await supabase.from("program_documents").insert({
        program_id: programId,
        title: file.name,
        url: data.publicUrl,
        kind: file.type || "fichier",
      });
      if (ins.error) throw new Error(`Fichier envoyé mais non enregistré : ${ins.error.message}`);
    }
  }
  const save = useMutation({
    mutationFn: async (v: Draft) => {
      if (!v.title.trim()) throw new Error("Le titre est obligatoire.");
      const dates = v.recurrence_rule.source_program_id
        ? [v.start_date]
        : recurrenceDates(
            v.start_date,
            v.recurrence_until,
            canonicalProgramRecurrence(v.recurrence),
            v.recurrence_rule,
          );
      if (!v.start_date) throw new Error("La date du programme est obligatoire.");
      const deadlineOffset = v.response_deadline_offset_value === "" ? null : Number(v.response_deadline_offset_value);
      if (deadlineOffset !== null && (!Number.isInteger(deadlineOffset) || deadlineOffset < 1))
        throw new Error("Le délai doit être un nombre entier positif d’heures ou de jours.");
      if (deadlineOffset !== null && v.response_deadline_anchor === "slot" && !v.detailed_scheduling)
        throw new Error("Pour calculer l’échéance avant chaque créneau, active les créneaux de service.");
      if (v.serviceSlots.some((slot) => slot.deadline_override && (!Number.isInteger(Number(slot.response_deadline_offset_value)) || Number(slot.response_deadline_offset_value) < 1)))
        throw new Error("Chaque délai personnalisé doit contenir un nombre entier positif d’heures ou de jours.");
      if (v.detailed_scheduling && !v.serviceSlots.length)
        throw new Error("Ajoute au moins un créneau de service.");
      if (
        v.detailed_scheduling &&
        v.serviceSlots.some(
          (s) => !s.service_date || !s.start_time || !s.end_time || s.start_time === s.end_time,
        )
      )
        throw new Error("Chaque créneau doit avoir une date, une heure de début et une heure de fin différentes. Un créneau peut se terminer après minuit.");
      if (v.detailed_scheduling) {
        for (const [poleId, poleDraft] of Object.entries(v.poles).filter(([, x]) => x.selected)) {
          const solicitedMembers = poleDraft.memberIds.filter((memberId) => (poleDraft.memberModes?.[memberId] ?? "direct") === "solicited");
          if (!solicitedMembers.length) continue;
          const neededSlots = v.serviceSlots.filter((slot) => {
            const count = poleDraft.requiredBySlot?.[slot.key];
            return count !== "" && count != null && Number(count) >= 1;
          });
          if (!neededSlots.length) {
            const poleName = activePoles.find((p) => p.id === poleId)?.name ?? "ce pôle";
            throw new Error(`Renseigne au moins un effectif nécessaire pour ${poleName} avant d’envoyer les sollicitations.`);
          }
          if (v.slot_selection_mode === "organizer") {
            for (const memberId of solicitedMembers) {
              const selectedKeys = poleDraft.memberSlotIds?.[memberId] ?? v.serviceSlots.map((slot) => slot.key);
              if (!neededSlots.some((slot) => selectedKeys.includes(slot.key))) {
                const memberName = allMembers.find((m: any) => m.id === memberId)?.full_name ?? "ce membre";
                throw new Error(`Sélectionne au moins un créneau avec un besoin renseigné pour ${memberName}.`);
              }
            }
          }
        }
      }
      const selectedPoles = { ...v.poles };
      const targetPoles = Object.entries(selectedPoles).filter(([, x]) => x.selected).map(([id]) => id);
      const check = await (supabase as any).rpc("check_program_write_access", { p_program_id: v.id ?? null, p_poles: targetPoles, p_generate: dates.length > 1 });
      if (check.error) throw check.error;
      let id = v.id ?? newId("p");
      const payload = {
        creation_key: v.creation_key,
        title: v.title.trim(),
        description: v.description.trim() || null,
        program_type: v.program_type || null,        start_date: v.start_date || null,
        start_time: v.start_time || null,
        end_date: v.end_date || null,
        end_time: v.end_time || null,
        response_deadline: (() => {
          if (deadlineOffset === null) return v.response_deadline || null;
          const starts = v.response_deadline_anchor === "slot" && v.serviceSlots.length
            ? v.serviceSlots.map((slot) => new Date(`${slot.service_date}T${slot.start_time || "00:00"}:00`).getTime() - deadlineOffset * (v.response_deadline_offset_unit === "days" ? 86400000 : 3600000))
            : [new Date(`${v.start_date}T${v.start_time || "00:00"}:00`).getTime() - deadlineOffset * (v.response_deadline_offset_unit === "days" ? 86400000 : 3600000)];
          const earliest = Math.min(...starts);
          if (!Number.isFinite(earliest)) return null;
          const d = new Date(earliest);
          return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
        })(),
        response_deadline_offset_value: deadlineOffset,
        response_deadline_offset_unit: deadlineOffset === null ? null : v.response_deadline_offset_unit,
        response_deadline_anchor: deadlineOffset === null ? null : v.response_deadline_anchor,
        response_deadline_at: (() => {
          if (deadlineOffset === null) return null;
          const starts = v.response_deadline_anchor === "slot" && v.serviceSlots.length
            ? v.serviceSlots.map((slot) => new Date(`${slot.service_date}T${slot.start_time || "00:00"}:00`).getTime() - deadlineOffset * (v.response_deadline_offset_unit === "days" ? 86400000 : 3600000))
            : [new Date(`${v.start_date}T${v.start_time || "00:00"}:00`).getTime() - deadlineOffset * (v.response_deadline_offset_unit === "days" ? 86400000 : 3600000)];
          const earliest = Math.min(...starts);
          return Number.isFinite(earliest) ? new Date(earliest).toISOString() : null;
        })(),
        location: v.location.trim() || null,
        status: v.status,
        importance: v.importance,
        format: v.format || null,
        recurrence: v.recurrence || null,
        recurrence_until: v.recurrence === "ponctuel" ? null : v.recurrence_until || null,
        recurrence_rule: v.recurrence_rule,
        travel_member_ids: canonicalProgramFormat(v.format).startsWith("deplacement")
          ? v.travel_member_ids
          : [],
        audience: v.audience || null,
        onsite: v.onsite.trim() || null,
        travel: v.travel.trim() || null,
        invite_members: v.invite_members.trim() || null,
        resource_link: v.resource_link.trim() || null,
        general_note: v.general_note.trim() || null,
        detailed_scheduling: v.detailed_scheduling,
        slot_selection_mode: v.slot_selection_mode === "member" ? "recipient_choice" : "organizer",
      };
      const table = (supabase as any).from("programs");
      if (v.id) {
        const r = await table.update(payload).eq("id", id);
        if (r.error) throw new Error(r.error.message);
      } else {
        const existing = await table.select("id").eq("creation_key", v.creation_key).maybeSingle();
        if (existing.error) throw new Error(existing.error.message);
        if (existing.data?.id) {
          id = existing.data.id;
          const r = await table.update(payload).eq("id", id);
          if (r.error) throw new Error(r.error.message);
        } else {
          const r = await table.insert({ id, ...payload });
          if (r.error) throw new Error(r.error.message);
        }
      }
      const oldAssignments =
        (programs.data ?? []).find((p) => p.id === id)?.assignments ?? [];
      const old = oldAssignments.map((a) => a.id);
      const previousParticipation = old.length
        ? await (supabase as any)
            .from("program_assignment_members")
            .select("assignment_id,member_id,assignment_mode,assigned_at,assigned_by,process_status")
            .in("assignment_id", old)
        : { data: [], error: null };
      if (previousParticipation.error) throw previousParticipation.error;
      const oldPoleByAssignment = new Map(oldAssignments.map((a) => [a.id, a.pole_id]));
      const previousByPoleMember = new Map(
        (previousParticipation.data ?? []).map((r: any) => [
          `${oldPoleByAssignment.get(r.assignment_id)}::${r.member_id}`,
          r,
        ]),
      );
      if (old.length)
        await supabase.from("program_assignment_members").delete().in("assignment_id", old);
      await supabase.from("program_assignments").delete().eq("program_id", id);
      const sel = Object.entries(selectedPoles).filter(([, x]) => x.selected),
        rows = sel.map(([pole_id, x]) => ({
          id: newId("pa"),
          program_id: id,
          pole_id,
          tasks: x.tasks.trim() || null,
        }));
      if (rows.length) {
        const x = await supabase.from("program_assignments").insert(rows);
        if (x.error) throw new Error(x.error.message);
      }
      const directByPole = new Map<string, Set<string>>();
      for (const s of v.serviceSlots)
        for (const mid of s.memberIds) {
          const poleId = s.pole_id || links.find((l: any) => l.member_id === mid && targetPoles.includes(l.pole_id))?.pole_id;
          if (poleId) {
            if (!directByPole.has(poleId)) directByPole.set(poleId, new Set());
            directByPole.get(poleId)!.add(mid);
          }
        }
      const mr = rows.flatMap((a, i) =>
        [...new Set([
          ...sel[i][1].memberIds.filter((memberId) => (sel[i][1].memberModes?.[memberId] ?? "direct") === "direct"),
          ...(directByPole.get(a.pole_id) ?? []),
        ])].map(
          (member_id) => {
            const previous: any = previousByPoleMember.get(`${a.pole_id}::${member_id}`);
            const assignment_mode = sel[i][1].memberModes?.[member_id] ?? previous?.assignment_mode ?? "direct";
            return {
              assignment_id: a.id,
              member_id,
              assignment_mode,
              process_status: previous?.process_status ?? "active",
              assigned_at:
                assignment_mode === "solicited"
                  ? null
                  : previous?.assigned_at ?? new Date().toISOString(),
              assigned_by: assignment_mode === "solicited" ? null : previous?.assigned_by ?? null,
            };
          },
        ),
      );
      let savedMembers: any[] = [];
      if (mr.length) {
        const x = await (supabase as any)
          .from("program_assignment_members")
          .insert(mr)
          .select("id,assignment_id,member_id");
        if (x.error) throw new Error(x.error.message);
        savedMembers = x.data ?? [];
      }
      // Send solicitations through the established server workflow so it creates
      // the pending response and notification with the same authorization checks.
      for (const assignment of rows) {
        const poleDraft = selectedPoles[assignment.pole_id];
        for (const memberId of poleDraft.memberIds) {
          if ((poleDraft.memberModes?.[memberId] ?? "direct") !== "solicited") continue;
          // Per-slot solicitations are sent after the new slot IDs exist, with the
          // selected slot list and its precise notification. Global solicitations
          // (and simple programmes) keep the existing programme-wide workflow.
          if (v.detailed_scheduling && v.slot_selection_mode === "organizer") continue;
          const { error } = await (supabase as any).rpc("solicit_program_member", {
            p_assignment_id: assignment.id,
            p_member_id: memberId,
          });
          if (error) throw error;
        }
      }

      // Reload member rows so both direct assignments and newly created solicitations
      // can be linked to the precise service slots selected in the pole block.
      const savedAssignmentIds = rows.map((row) => row.id);
      if (savedAssignmentIds.length) {
        const savedRows = await (supabase as any)
          .from("program_assignment_members")
          .select("id,assignment_id,member_id")
          .in("assignment_id", savedAssignmentIds);
        if (savedRows.error) throw savedRows.error;
        savedMembers = savedRows.data ?? [];
      } else {
        savedMembers = [];
      }

      const db = supabase as any;
      await db.from("program_service_slots").delete().eq("program_id", id);
      await db.from("program_days").delete().eq("program_id", id);
      if (v.detailed_scheduling) {
        // A slot after midnight can still belong to the logical service day that began the previous evening.
        // For a single overnight program, normalize early-morning slots on end_date back to start_date.
        const nextDate = (date: string) => {
          const d = new Date(`${date}T12:00:00`);
          d.setDate(d.getDate() + 1);
          return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
        };
        const isSingleOvernight = Boolean(v.start_date && v.end_date && v.end_date === nextDate(v.start_date) && v.start_time && v.end_time && v.end_time <= v.start_time);
        const logicalServiceDate = (slot: (typeof v.serviceSlots)[number]) =>
          isSingleOvernight && slot.service_date === v.end_date && slot.start_time < v.start_time
            ? v.start_date
            : slot.service_date;
        const dates = [...new Set(v.serviceSlots.map(logicalServiceDate))];
        const dayIns = await db
          .from("program_days")
          .insert(
            dates.map((service_date) => ({
              program_id: id,
              service_date,
              start_time: service_date === v.start_date ? (v.start_time || null) : (v.serviceSlots.filter((s) => logicalServiceDate(s) === service_date).map((s) => s.start_time).sort()[0] ?? null),
              end_time: service_date === v.start_date && isSingleOvernight ? (v.end_time || null) : (v.serviceSlots.filter((s) => logicalServiceDate(s) === service_date).map((s) => s.end_time).sort().slice(-1)[0] ?? null),
            })),
          )
          .select("id,service_date");
        if (dayIns.error) throw dayIns.error;
        const dayByDate = new Map((dayIns.data ?? []).map((d: any) => [d.service_date, d.id]));
        const slotRows = v.serviceSlots.map((s, position) => ({
          program_id: id,
          program_day_id: dayByDate.get(logicalServiceDate(s)),
          assignment_id: null,
          label: null,
          start_time: s.start_time,
          end_time: s.end_time,
          actual_start_date: s.service_date,
          actual_end_date: (() => { const d = new Date(`${s.service_date}T12:00:00`); if (s.end_time <= s.start_time) d.setDate(d.getDate() + 1); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"); })(),
          required_count: 1,
          response_deadline_offset_value: s.deadline_override && s.response_deadline_offset_value !== "" ? Number(s.response_deadline_offset_value) : null,
          response_deadline_offset_unit: s.deadline_override && s.response_deadline_offset_value !== "" ? s.response_deadline_offset_unit : null,
          response_deadline_anchor: s.deadline_override && s.response_deadline_offset_value !== "" ? s.response_deadline_anchor : null,
          response_deadline_at: (() => {
            if (!s.deadline_override || s.response_deadline_offset_value === "") return null;
            const anchorDate = s.response_deadline_anchor === "program" ? v.start_date : s.service_date;
            const anchorTime = s.response_deadline_anchor === "program" ? (v.start_time || "00:00") : (s.start_time || "00:00");
            const base = new Date(`${anchorDate}T${anchorTime}:00`).getTime();
            return Number.isFinite(base) ? new Date(base - Number(s.response_deadline_offset_value) * (s.response_deadline_offset_unit === "days" ? 86400000 : 3600000)).toISOString() : null;
          })(),
          position,
        }));
        const slotIns = await db
          .from("program_service_slots")
          .insert(slotRows)
          .select("id,position");
        if (slotIns.error) throw slotIns.error;

        // Staffing requirements are stored separately from the time slots:
        // one time slot can have independent headcounts for several poles.
        const needRows = rows.flatMap((assignment) => {
          const poleDraft = selectedPoles[assignment.pole_id];
          return v.serviceSlots.flatMap((slot, slotIndex) => {
            const rawCount = poleDraft?.requiredBySlot?.[slot.key];
            if (rawCount === undefined || rawCount === "" || Number(rawCount) < 1) return [];
            const savedSlot = (slotIns.data ?? []).find((saved: any) => saved.position === slotIndex);
            return savedSlot
              ? [{
                  assignment_id: assignment.id,
                  service_slot_id: savedSlot.id,
                  required_count: Math.max(1, Math.floor(Number(rawCount))),
                }]
              : [];
          });
        });
        if (needRows.length) {
          const needsInsert = await db.from("program_assignment_slot_needs").insert(needRows);
          if (needsInsert.error) throw needsInsert.error;
        }

        const memberSlots = rows.flatMap((assignment) => {
          const poleDraft = selectedPoles[assignment.pole_id];
          return v.serviceSlots.flatMap((slot, slotIndex) => {
            const savedSlot = (slotIns.data ?? []).find((saved: any) => saved.position === slotIndex);
            if (!savedSlot) return [];
            return poleDraft.memberIds.flatMap((memberId) => {
              const memberMode = poleDraft.memberModes?.[memberId] ?? "direct";
              // Global solicitations let the member choose later. In per-slot mode,
              // the server RPC below creates precise links for solicited members.
              if (memberMode === "solicited" && (v.slot_selection_mode === "member" || v.slot_selection_mode === "organizer")) return [];
              const selectedSlots = poleDraft.memberSlotIds?.[memberId] ?? v.serviceSlots.map((item) => item.key);
              if (!selectedSlots.includes(slot.key)) return [];
              const am = savedMembers.find(
                (m: any) => m.assignment_id === assignment.id && m.member_id === memberId,
              );
              return am
                ? [{
                    assignment_member_id: am.id,
                    program_day_id: dayByDate.get(logicalServiceDate(slot)),
                    service_slot_id: savedSlot.id,
                    start_time: slot.start_time,
                    end_time: slot.end_time,
                  }]
                : [];
            });
          });
        });
        if (memberSlots.length) {
          const x = await db.from("program_assignment_member_slots").insert(memberSlots);
          if (x.error) throw x.error;
        }

        if (v.slot_selection_mode === "organizer") {
          for (const assignment of rows) {
            const poleDraft = selectedPoles[assignment.pole_id];
            for (const memberId of poleDraft.memberIds) {
              if ((poleDraft.memberModes?.[memberId] ?? "direct") !== "solicited") continue;
              const selectedKeys = poleDraft.memberSlotIds?.[memberId] ?? v.serviceSlots.map((item) => item.key);
              const serviceSlotIds = v.serviceSlots.flatMap((slot, slotIndex) => {
                if (!selectedKeys.includes(slot.key)) return [];
                const savedSlot = (slotIns.data ?? []).find((saved: any) => saved.position === slotIndex);
                return savedSlot ? [savedSlot.id] : [];
              });
              if (!serviceSlotIds.length) throw new Error("Sélectionne au moins un créneau pour chaque personne sollicitée dans le mode créneau par créneau.");
              const { error } = await db.rpc("solicit_program_member_for_slots", {
                p_assignment_id: assignment.id,
                p_member_id: memberId,
                p_service_slot_ids: serviceSlotIds,
              });
              if (error) throw error;
            }
          }
        }
      }
      await uploadFiles(id);
      if (dates.length > 1) {
        const generated = await (supabase as any).rpc("generate_program_occurrences", {
          p_program_id: id,
          p_dates: dates,
        });
        if (generated.error) throw generated.error;
      }
      await logAction({
        action: v.id ? "programme_modifie" : "programme_cree",
        entity: "program",
        entityId: id,
        detail: `${v.title} · réponses avant ${v.response_deadline}`,
        actorName: actor?.full_name,
      });
    },
    onSuccess: () => {
      toast.success(
        pendingFiles.length ? "Programme et fichiers enregistrés" : "Programme enregistré",
      );
      setPendingFiles([]);
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["program-documents"] });
    },
    onError: (e: Error) =>
      toast.error(
        `Enregistrement interrompu : ${programError(e)}`,
      ),
  });
  const archive = useMutation({
    mutationFn: async (p: ProgramWithDetails) => {
      const { error } = await supabase
        .from("programs")
        .update({ archived: true, deleted: false })
        .eq("id", p.id);
      if (error) throw new Error(error.message);
      await logAction({
        action: "programme_archive",
        entity: "program",
        entityId: p.id,
        detail: p.title,
        actorName: actor?.full_name,
      });
    },
    onSuccess: () => {
      toast.success("Programme archivé — il reste disponible dans Archives & corbeille");
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["archives-programs"] });
    },
    onError: (e: Error) => toast.error(programError(e)),
  });
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => {
            setPendingFiles([]);
            setDraft(emptyDraft());
          }}
        >
          + Nouveau programme
        </Button>
      </div>
      <div className="space-y-2">
        {activePrograms.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
          >
            <div>
              <b>{p.title}</b>
              {(p as any).response_deadline ? (
                <p className="text-xs text-muted-foreground">
                  Réponses attendues avant le{" "}
                  {new Date(`${(p as any).response_deadline}T00:00:00`).toLocaleDateString("fr-FR")}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => edit(p)}>
                Modifier
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={archive.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Archiver « ${p.title} » ? Le programme quittera la liste active mais restera entièrement restaurable.`,
                    )
                  )
                    archive.mutate(p);
                }}
              >
                <Archive className="size-4" />
                Archiver
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Dialog
        open={!!draft}
        onOpenChange={(o) => {
          if (!o && !save.isPending) {
            setDraft(null);
            setPendingFiles([]);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Modifier le programme" : "Nouveau programme"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-5">
              <Field label="Titre">
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Choice
                  label="Statut"
                  value={draft.status}
                  set={(v) => setDraft({ ...draft, status: v })}
                  items={STATUSES}
                />
                <Choice
                  label="Type"
                  value={draft.program_type}
                  set={(v) => setDraft({ ...draft, program_type: v })}
                  items={PROGRAM_EDITOR_TYPE_OPTIONS}
                />
                <Choice
                  label="Format"
                  value={draft.format}
                  set={(v) => setDraft({ ...draft, format: v })}
                  items={PROGRAM_EDITOR_FORMAT_OPTIONS}
                />
                <Choice
                  label="Importance"
                  value={draft.importance}
                  set={(v) => setDraft({ ...draft, importance: v })}
                  items={IMPORTANCES}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="Date début">
                  <Input
                    type="date"
                    value={draft.start_date}
                    onChange={(e) =>                      setDraft({
                        ...draft,
                        start_date: e.target.value,
                        response_deadline:
                          draft.response_deadline && draft.response_deadline > e.target.value
                            ? e.target.value
                            : draft.response_deadline,
                      })
                    }
                  />
                </Field>
                <Field label="Heure début">
                  <Input
                    type="time"
                    value={draft.start_time}
                    onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
                  />
                </Field>
                <Field label="Date fin">
                  <Input
                    type="date"
                    value={draft.end_date}
                    onChange={(e) => setDraft({ ...draft, end_date: e.target.value })}
                  />
                </Field>
                <Field label="Heure fin">
                  <Input
                    type="time"
                    value={draft.end_time}
                    onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
                  />
                </Field>

              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Lieu">
                  <Input
                    value={draft.location}
                    onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                  />
                </Field>
                <Choice
                  label="Récurrence"
                  value={draft.recurrence}
                  set={(v) => setDraft({ ...draft, recurrence: v })}
                  items={RECURRENCES}
                />
                <Choice
                  label="Public / groupe"
                  value={draft.audience || "ICC"}
                  set={(v) => setDraft({ ...draft, audience: v })}
                  items={PROGRAM_EDITOR_AUDIENCE_OPTIONS}
                />
                <Field label="Lien / ressource">
                  <Input
                    value={draft.resource_link}
                    onChange={(e) => setDraft({ ...draft, resource_link: e.target.value })}
                  />
                </Field>
              </div>
              {!draft.recurrence_rule.source_program_id ? (
                <RecurrenceFields
                  frequency={canonicalProgramRecurrence(draft.recurrence)}
                  start={draft.start_date}
                  until={draft.recurrence_until}
                  rule={draft.recurrence_rule}
                  onChange={(recurrence_until, recurrence_rule) =>
                    setDraft({ ...draft, recurrence_until, recurrence_rule })
                  }
                />
              ) : (
                <p className="text-sm">Cette modification concerne uniquement cette occurrence.</p>
              )}
              {(draft.program_type === "Corporate" ||
                draft.program_type === "Autre église-Invitation") && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Personnes invitées / déplacement">
                    <Input
                      value={draft.invite_members}
                      onChange={(e) => setDraft({ ...draft, invite_members: e.target.value })}
                    />
                  </Field>
                </div>
              )}
              <Field label="Description / contexte">
                <Textarea
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>
              <Field label="Consignes générales du programme (tous les pôles)">
                <Textarea
                  value={draft.general_note}
                  onChange={(e) => setDraft({ ...draft, general_note: e.target.value })}
                />
                <span className="block text-[11px] text-muted-foreground">
                  Informations communes à toute l’équipe. Les missions propres à chaque pôle se renseignent plus bas.
                </span>
              </Field>
              <ProgramServiceSlotsEditor
                enabled={draft.detailed_scheduling}
                slots={draft.serviceSlots}
                dates={dateRange(draft.start_date, draft.end_date || draft.start_date)}
                onEnabledChange={(detailed_scheduling) =>
                  setDraft({ ...draft, detailed_scheduling })
                }
                onChange={(serviceSlots) => setDraft({ ...draft, serviceSlots })}
              />
              {draft.detailed_scheduling && draft.serviceSlots.length > 0 ? (
                <section className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
                  <h3 className="font-black text-icc-violet">Mode de mobilisation</h3>
                  <p className="text-sm text-muted-foreground">
                    Choisis dès maintenant comment les demandes seront organisées. Tu peux ensuite modifier ce réglage dans « Participation & besoins ».
                  </p>
                  <Select
                    value={draft.slot_selection_mode}
                    onValueChange={(value: "organizer" | "member") => setDraft({ ...draft, slot_selection_mode: value })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Mobilisation globale : les membres sollicités indiquent les créneaux où ils sont disponibles</SelectItem>
                      <SelectItem value="organizer">Créneau par créneau : le responsable sollicite ou affecte sur des horaires précis</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {draft.slot_selection_mode === "member"
                      ? "Les demandes « Solliciter » portent sur le programme et les membres choisissent leurs disponibilités. Les affectations sont confirmées ensuite dans la fiche du programme. Une affectation directe peut toujours être limitée à des créneaux précis."
                      : "Pour chaque personne sollicitée ou affectée, sélectionne les créneaux concernés ci-dessous. Les demandes sont envoyées lors de l’enregistrement du programme."}
                  </p>
                </section>
              ) : null}
              <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                Tu peux toujours sélectionner les pôles, préciser les besoins par créneau, puis choisir les personnes à solliciter ou à affecter directement. Pour un programme simple sans créneaux détaillés, le fonctionnement reste inchangé : aucun mode de mobilisation supplémentaire n’est demandé.
              </p>
              <section>
                <h3 className="mb-2 font-black text-icc-violet">Pôles et membres mobilisés</h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  Sélectionne les pôles concernés, précise la mission et le besoin pour chaque créneau, puis choisis les membres à mobiliser. Les fichiers du programme se trouvent à la fin du formulaire.
                </p>
                <div className="space-y-3">
                  <div className="rounded-xl border bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">Toute la COM</p>
                        <p className="text-xs text-muted-foreground">
                          Afficher la liste complète des membres sans ouvrir les pôles un par un.
                        </p>
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={() => setShowAllComMembers((value) => !value)}>
                        {showAllComMembers ? "Masquer la liste complète" : "Afficher toute la COM"}
                      </Button>
                    </div>
                    {showAllComMembers ? (
                      <div className="mt-3 space-y-2">
                        {allMembers.filter((m: any) => !m.deleted).slice().sort((a:any,b:any)=>{const rank=(m:any)=>m.status!=="active"?m.status==="inactive"?2:3:unavailable(m.id)?1:0;return rank(a)-rank(b)||String(a.full_name).localeCompare(String(b.full_name),"fr")}).map((m: any) => {
                          const memberPoleIds = [...new Set(links.filter((link: any) => link.member_id === m.id && activePoles.some((p) => p.id === link.pole_id)).map((link: any) => link.pole_id))];
                          const selection = Object.entries(draft.poles).find(([, value]) => value.memberIds.includes(m.id));
                          const chosenPoleId = globalPoleChoice[m.id] ?? selection?.[0] ?? memberPoleIds[0] ?? "";
                          const checked = !!selection;
                          const selectedPoleId = selection?.[0] ?? chosenPoleId;
                          const selectedPoleDraft = draft.poles[selectedPoleId] ?? { selected: false, tasks: "", memberIds: [], requiredBySlot: {}, memberModes: {}, memberSlotIds: {} };
                          const mode = selectedPoleDraft.memberModes?.[m.id] ?? "direct";
                          const inTravel = draft.travel_member_ids.includes(m.id);
                          return (
                            <div key={m.id} className="rounded-lg border bg-background p-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Checkbox
                                  checked={checked}
                                  disabled={!memberPoleIds.length || m.status!=="active" || !!m.archived}
                                  onCheckedChange={(value) => {
                                    const on = value === true;
                                    const nextPoles: Record<string, PoleDraft> = { ...draft.poles };
                                    if (!on) {
                                      for (const [poleId, poleDraft] of Object.entries(nextPoles)) {
                                        nextPoles[poleId] = {
                                          ...poleDraft,
                                          memberIds: poleDraft.memberIds.filter((id) => id !== m.id),
                                          memberModes: Object.fromEntries(Object.entries(poleDraft.memberModes ?? {}).filter(([id]) => id !== m.id)),
                                          memberSlotIds: Object.fromEntries(Object.entries(poleDraft.memberSlotIds ?? {}).filter(([id]) => id !== m.id)),
                                        };
                                      }
                                      setDraft({
                                        ...draft,
                                        poles: nextPoles,
                                        travel_member_ids: draft.travel_member_ids.filter((id) => id !== m.id),
                                      });
                                      return;
                                    }
                                    const targetPoleId = chosenPoleId;
                                    if (!targetPoleId) return;
                                    for (const [poleId, poleDraft] of Object.entries(nextPoles)) {
                                      if (poleId !== targetPoleId && poleDraft.memberIds.includes(m.id)) {
                                        nextPoles[poleId] = {
                                          ...poleDraft,
                                          memberIds: poleDraft.memberIds.filter((id) => id !== m.id),
                                        };
                                      }
                                    }
                                    const target = nextPoles[targetPoleId] ?? {
                                      selected: false, tasks: "", memberIds: [], requiredBySlot: {}, memberModes: {}, memberSlotIds: {},
                                    };
                                    nextPoles[targetPoleId] = {
                                      ...target,
                                      selected: true,
                                      memberIds: [...new Set([...target.memberIds, m.id])],
                                      memberModes: { ...(target.memberModes ?? {}), [m.id]: "direct" },
                                      memberSlotIds: { ...(target.memberSlotIds ?? {}), [m.id]: draft.serviceSlots.map((slot) => slot.key) },
                                    };
                                    setDraft({ ...draft, poles: nextPoles });
                                  }}
                                />
                                <span className={`min-w-[140px] flex-1 text-sm font-medium ${m.status==="inactive"?"text-muted-foreground opacity-60":m.status==="archived"||m.archived?"text-muted-foreground opacity-40":""}`}>{unavailable(m.id)?<span className="mr-2 font-semibold text-red-600">INDISPONIBLE</span>:null}{m.full_name}{m.status==="inactive"?" · Inactif":m.status==="archived"||m.archived?" · Archivé":""}</span>
                                <span className="text-xs text-muted-foreground">
                                  {memberPoleIds.map((id) => activePoles.find((p) => p.id === id)?.name).filter(Boolean).join(" · ") || "Aucun pôle"}
                                </span>
                                {memberPoleIds.length > 1 ? (
                                  <Select
                                    value={chosenPoleId}
                                    onValueChange={(value) => {
                                      setGlobalPoleChoice((prev) => ({ ...prev, [m.id]: value }));
                                      if (!checked) return;
                                      const nextPoles: Record<string, PoleDraft> = { ...draft.poles };
                                      for (const [poleId, poleDraft] of Object.entries(nextPoles)) {
                                        if (poleId !== value && poleDraft.memberIds.includes(m.id)) {
                                          nextPoles[poleId] = { ...poleDraft, memberIds: poleDraft.memberIds.filter((id) => id !== m.id) };
                                        }
                                      }
                                      const target = nextPoles[value] ?? { selected: false, tasks: "", memberIds: [], requiredBySlot: {}, memberModes: {}, memberSlotIds: {} };
                                      nextPoles[value] = {
                                        ...target,
                                        selected: true,
                                        memberIds: [...new Set([...target.memberIds, m.id])],
                                        memberModes: { ...(target.memberModes ?? {}), [m.id]: mode },
                                        memberSlotIds: { ...(target.memberSlotIds ?? {}), [m.id]: selectedPoleDraft.memberSlotIds?.[m.id] ?? draft.serviceSlots.map((slot) => slot.key) },
                                      };
                                      setDraft({ ...draft, poles: nextPoles });
                                    }}
                                  >
                                    <SelectTrigger className="w-[160px]"><SelectValue placeholder="Pôle à mobiliser" /></SelectTrigger>
                                    <SelectContent>
                                      {memberPoleIds.map((id) => (
                                        <SelectItem key={id} value={id}>{activePoles.find((p) => p.id === id)?.name ?? id}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : null}
                              </div>
                              {checked ? (
                                <div className="mt-2 space-y-2 pl-7">
                                  <div className="flex flex-wrap gap-2">
                                    <Button type="button" size="sm" variant={mode === "solicited" ? "default" : "outline"} onClick={() => setDraft({
                                      ...draft,
                                      poles: {
                                        ...draft.poles,
                                        [selectedPoleId]: { ...selectedPoleDraft, memberModes: { ...(selectedPoleDraft.memberModes ?? {}), [m.id]: "solicited" } },
                                      },
                                    })}>Solliciter</Button>
                                    <Button type="button" size="sm" variant={mode === "direct" ? "default" : "outline"} onClick={() => setDraft({
                                      ...draft,
                                      poles: {
                                        ...draft.poles,
                                        [selectedPoleId]: { ...selectedPoleDraft, memberModes: { ...(selectedPoleDraft.memberModes ?? {}), [m.id]: "direct" } },
                                      },
                                    })}>Affecter directement</Button>
                                    {canonicalProgramFormat(draft.format).startsWith("deplacement") ? (
                                      <label className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold">
                                        <Checkbox checked={inTravel} onCheckedChange={(value) => setDraft({
                                          ...draft,
                                          travel_member_ids: value === true
                                            ? [...new Set([...draft.travel_member_ids, m.id])]
                                            : draft.travel_member_ids.filter((id) => id !== m.id),
                                        })} />
                                        Déplacement
                                      </label>
                                    ) : null}
                                  </div>
                                  {draft.detailed_scheduling && draft.serviceSlots.length && !(draft.slot_selection_mode === "member" && mode === "solicited") ? (
                                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                                      {draft.serviceSlots.map((slot, slotIndex) => (
                                        <label key={slot.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                          <Checkbox
                                            checked={(selectedPoleDraft.memberSlotIds?.[m.id] ?? draft.serviceSlots.map((s) => s.key)).includes(slot.key)}
                                            onCheckedChange={(value) => {
                                              const current = selectedPoleDraft.memberSlotIds?.[m.id] ?? draft.serviceSlots.map((s) => s.key);
                                              const next = value === true ? [...new Set([...current, slot.key])] : current.filter((key) => key !== slot.key);
                                              setDraft({
                                                ...draft,
                                                poles: {
                                                  ...draft.poles,
                                                  [selectedPoleId]: { ...selectedPoleDraft, memberSlotIds: { ...(selectedPoleDraft.memberSlotIds ?? {}), [m.id]: next } },
                                                },
                                              });
                                            }}
                                          />
                                          {slot.service_date ? new Date(`${slot.service_date}T12:00:00`).toLocaleDateString("fr-FR") : `Créneau ${slotIndex + 1}`}
                                          {slot.start_time && slot.end_time ? ` · ${slot.start_time}–${slot.end_time}` : ""}
                                        </label>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  {activePoles.map((pole) => {
                    const x = draft.poles[pole.id] ?? { selected: false, tasks: "", memberIds: [], requiredBySlot: {}, memberModes: {}, memberSlotIds: {} };
                    const pm = allMembers.filter((m) =>
                      !m.deleted && links.some((l) => l.pole_id === pole.id && l.member_id === m.id),
                    ).slice().sort((a:any,b:any)=>{const rank=(m:any)=>m.status!=="active"?m.status==="inactive"?2:3:unavailable(m.id)?1:0;return rank(a)-rank(b)||String(a.full_name).localeCompare(String(b.full_name),"fr")});
                    const travelFormat = canonicalProgramFormat(draft.format).startsWith("deplacement");
                    return (
                      <div key={pole.id} className="rounded-xl border p-3">
                        <label className="flex gap-2 font-bold">
                          <Checkbox
                            checked={x.selected}
                            onCheckedChange={(c) =>
                              setDraft({
                                ...draft,
                                poles: {
                                  ...draft.poles,
                                  [pole.id]: { ...x, selected: c === true },
                                },
                              })
                            }
                          />
                          {pole.name}
                        </label>
                        {x.selected && (
                          <div className="mt-3 space-y-2">
                            <Input
                              placeholder={`Mission à préciser pour le pôle ${pole.name}`}
                              value={x.tasks}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  poles: {
                                    ...draft.poles,
                                    [pole.id]: { ...x, tasks: e.target.value },
                                  },
                                })
                              }
                            />
                            {draft.detailed_scheduling && draft.serviceSlots.length > 0 ? (
                              <div className="space-y-2 rounded-lg border bg-background p-3">
                                <p className="text-sm font-semibold">Effectif nécessaire par créneau</p>
                                <p className="text-xs text-muted-foreground">
                                  Indique le nombre de personnes nécessaires pour ce pôle sur chaque créneau. Les dates et horaires restent ceux définis plus haut.
                                </p>
                                {draft.serviceSlots.map((slot, slotIndex) => (
                                  <div key={slot.key} className="grid items-center gap-2 sm:grid-cols-[1fr_110px]">
                                    <label className="text-sm">
                                      <span className="font-medium">Créneau {slotIndex + 1}</span>
                                      <span className="ml-2 text-muted-foreground">
                                        {slot.service_date ? new Date(`${slot.service_date}T12:00:00`).toLocaleDateString("fr-FR") : "Date à définir"}
                                        {slot.start_time && slot.end_time ? ` · ${slot.start_time}–${slot.end_time}` : ""}
                                      </span>
                                    </label>
                                    <Input
                                      aria-label={`Effectif nécessaire pour ${pole.name}, créneau ${slotIndex + 1}`}
                                      type="number"
                                      min={1}
                                      placeholder="À définir"
                                      value={x.requiredBySlot?.[slot.key] ?? ""}
                                      onChange={(e) => setDraft({
                                        ...draft,
                                        poles: {
                                          ...draft.poles,
                                          [pole.id]: {
                                            ...x,
                                            requiredBySlot: {
                                              ...(x.requiredBySlot ?? {}),
                                              [slot.key]: e.target.value === "" ? "" : Math.max(1, Math.floor(Number(e.target.value))),
                                            },
                                          },
                                        },
                                      })}
                                    />
                                  </div>
                                ))}
                                <p className="text-xs text-muted-foreground">
                                  Le total des postes à couvrir est calculé à partir des effectifs saisis pour chaque créneau.
                                </p>
                                <p className="text-sm font-semibold">
                                  Total : {draft.serviceSlots.reduce((total, slot) => {
                                    const count = x.requiredBySlot?.[slot.key];
                                    return total + (count === "" || count == null ? 0 : Math.max(0, Number(count)));
                                  }, 0)} poste(s)-créneau
                                </p>
                              </div>
                            ) : null}
                            <label className="flex items-center gap-2 rounded-lg bg-muted/30 px-2 py-1.5 text-xs font-semibold">
                              <Checkbox
                                checked={pm.filter((m: any) => m.status === "active" && !m.archived && !m.deleted).length > 0 && pm.filter((m: any) => m.status === "active" && !m.archived && !m.deleted).every((m: any) => x.memberIds.includes(m.id))}
                                onCheckedChange={(value) => {
                                  const eligible = pm.filter((m: any) => m.status === "active" && !m.archived && !m.deleted);
                                  const ids = value === true
                                    ? [...new Set([...x.memberIds, ...eligible.map((m: any) => m.id)])]
                                    : x.memberIds.filter((id) => !eligible.some((m: any) => m.id === id));
                                  const memberModes = { ...(x.memberModes ?? {}) };
                                  const memberSlotIds = { ...(x.memberSlotIds ?? {}) };
                                  for (const person of eligible) {
                                    if (value === true) {
                                      memberModes[person.id] = memberModes[person.id] ?? "direct";
                                      memberSlotIds[person.id] = memberSlotIds[person.id] ?? draft.serviceSlots.map((slot) => slot.key);
                                    } else {
                                      delete memberModes[person.id];
                                      delete memberSlotIds[person.id];
                                    }
                                  }
                                  setDraft({
                                    ...draft,
                                    poles: {
                                      ...draft.poles,
                                      [pole.id]: { ...x, memberIds: ids, memberModes, memberSlotIds },
                                    },
                                    travel_member_ids: value === true
                                      ? draft.travel_member_ids
                                      : draft.travel_member_ids.filter((id) => !eligible.some((m: any) => m.id === id)),
                                  });
                                }}
                              />
                              Sélectionner tous les membres du pôle
                            </label>
                            {pm.map((m) => {
                              const inactive = m.status !== "active",
                                u = unavailable(m.id),
                                checked = x.memberIds.includes(m.id),
                                inTravel = draft.travel_member_ids.includes(m.id);
                              return (
                                <div
                                  key={m.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-2 text-sm"
                                >
                                  <label className="flex items-center gap-2">
                                    <Checkbox
                                      checked={checked}
                                      disabled={inactive}
                                      onCheckedChange={(c) => {
                                        const on = c === true;
                                        const nextMemberIds = on
                                          ? [...x.memberIds, m.id]
                                          : x.memberIds.filter((id) => id !== m.id);
                                        const nextMemberModes = { ...(x.memberModes ?? {}) };
                                        if (on) nextMemberModes[m.id] = nextMemberModes[m.id] ?? "direct";
                                        else delete nextMemberModes[m.id];
                                        const nextMemberSlotIds = { ...(x.memberSlotIds ?? {}) };
                                        if (on) nextMemberSlotIds[m.id] = nextMemberSlotIds[m.id] ?? draft.serviceSlots.map((slot) => slot.key);
                                        else delete nextMemberSlotIds[m.id];
                                        const selectedElsewhere = Object.entries(draft.poles).some(
                                          ([pid, pd]) => pid !== pole.id && pd.memberIds.includes(m.id),
                                        );
                                        setDraft({
                                          ...draft,
                                          travel_member_ids:
                                            on || selectedElsewhere
                                              ? draft.travel_member_ids
                                              : draft.travel_member_ids.filter((id) => id !== m.id),
                                          poles: {
                                            ...draft.poles,
                                            [pole.id]: { ...x, memberIds: nextMemberIds, memberModes: nextMemberModes, memberSlotIds: nextMemberSlotIds },
                                          },
                                        });
                                      }}
                                    />
                                    <span className={inactive?m.status==="inactive"?"text-muted-foreground opacity-60":"text-muted-foreground opacity-40":""}>{u?<span className="mr-2 font-semibold text-red-600">INDISPONIBLE</span>:null}{m.full_name}{m.status==="inactive"?" · Inactif":m.status==="archived"||m.archived?" · Archivé":""}</span>
                                  </label>
                                  {checked ? (
                                    <div className="w-full space-y-2 pl-7">
                                      <div className="flex flex-wrap gap-2">
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant={(x.memberModes?.[m.id] ?? "direct") === "solicited" ? "default" : "outline"}
                                          onClick={() => setDraft({
                                            ...draft,
                                            poles: {
                                              ...draft.poles,
                                              [pole.id]: { ...x, memberModes: { ...(x.memberModes ?? {}), [m.id]: "solicited" } },
                                            },
                                          })}
                                        >
                                          Solliciter
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant={(x.memberModes?.[m.id] ?? "direct") === "direct" ? "default" : "outline"}
                                          onClick={() => setDraft({
                                            ...draft,
                                            poles: {
                                              ...draft.poles,
                                              [pole.id]: { ...x, memberModes: { ...(x.memberModes ?? {}), [m.id]: "direct" } },
                                            },
                                          })}
                                        >
                                          Affecter directement
                                        </Button>
                                      </div>
                                      {draft.detailed_scheduling && draft.serviceSlots.length > 0 && !(draft.slot_selection_mode === "member" && (x.memberModes?.[m.id] ?? "direct") === "solicited") ? (
                                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                                          {draft.serviceSlots.map((slot, slotIndex) => (
                                            <label key={slot.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                              <Checkbox
                                                checked={(x.memberSlotIds?.[m.id] ?? draft.serviceSlots.map((s) => s.key)).includes(slot.key)}
                                                onCheckedChange={(checkedSlot) => {
                                                  const current = x.memberSlotIds?.[m.id] ?? draft.serviceSlots.map((s) => s.key);
                                                  const next = checkedSlot === true
                                                    ? [...new Set([...current, slot.key])]
                                                    : current.filter((key) => key !== slot.key);
                                                  setDraft({
                                                    ...draft,
                                                    poles: {
                                                      ...draft.poles,
                                                      [pole.id]: {
                                                        ...x,
                                                        memberSlotIds: { ...(x.memberSlotIds ?? {}), [m.id]: next },
                                                      },
                                                    },
                                                  });
                                                }}
                                              />
                                              {slot.service_date ? new Date(`${slot.service_date}T12:00:00`).toLocaleDateString("fr-FR") : `Créneau ${slotIndex + 1}`}
                                              {slot.start_time && slot.end_time ? ` · ${slot.start_time}–${slot.end_time}` : ""}
                                            </label>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  <span className="flex flex-wrap items-center gap-3">
                                    <small className={inactive || u ? "font-bold text-red-600" : "text-green-700"}>
                                      {inactive ? "Inactif" : u ? "Indisponible" : null}
                                    </small>
                                    {checked && travelFormat ? (
                                      <label className="flex items-center gap-1.5 rounded-full border bg-background px-2 py-1 text-xs font-semibold">
                                        <Checkbox
                                          checked={inTravel}
                                          onCheckedChange={(c) =>
                                            setDraft({
                                              ...draft,
                                              travel_member_ids:
                                                c === true
                                                  ? [...new Set([...draft.travel_member_ids, m.id])]
                                                  : draft.travel_member_ids.filter((id) => id !== m.id),
                                            })
                                          }
                                        />
                                        🚐 Déplacement
                                      </label>
                                    ) : null}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="rounded-xl border p-4">
                <h3 className="font-black text-icc-violet">Fichiers du programme</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ajoute plusieurs fichiers : photos, PDF, Word, Excel ou tout autre document utile.
                  25 Mo maximum par fichier.
                </p>
                <Input
                  className="mt-3"
                  type="file"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setPendingFiles((prev) => [...prev, ...files]);
                    e.currentTarget.value = "";
                  }}
                />
                {pendingFiles.length ? (
                  <div className="mt-3 space-y-2">
                    {pendingFiles.map((f, i) => (
                      <div
                        key={`${f.name}-${i}`}
                        className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">📎 {f.name}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setPendingFiles((x) => x.filter((_, j) => j !== i))}
                        >
                          Retirer
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setDraft(null);
                setPendingFiles([]);
              }}
            >
              Annuler
            </Button>
            <Button disabled={save.isPending} onClick={() => draft && save.mutate(draft)}>
              {save.isPending ? "Enregistrement en cours…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Choice({
  label,
  value,
  set,
  items,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  items: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={set}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}