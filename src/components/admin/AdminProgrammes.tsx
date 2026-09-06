import { programError } from "@/lib/program-errors";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import { toast } from "sonner";
import { Field, newId } from "@/components/admin/form-kit";
import { useCurrentRole } from "@/hooks/useAuth";
import { RecurrenceFields } from "@/components/programs/RecurrenceFields";
import { TravelMembers } from "@/components/programs/TravelMembers";
import { recurrenceDates, type RecurrenceRule } from "@/lib/recurrence";
import { canonicalProgramFormat, canonicalProgramRecurrence } from "@/lib/programLabels";
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
const TYPES = ["Église", "Corporate", "Autre église-Invitation", "Interne Com"];
const FORMATS = [
  "Présentiel",
  "En ligne",
  "Présentiel + En ligne",
  "Déplacement",
  "Déplacement + Connecté",
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
const AUDIENCES = [
  ["ICC", "ICC"],
  ["EJP", "EJP"],
  ["Toute l'église", "Toute l'église"],
];
type PoleDraft = { selected: boolean; tasks: string; memberIds: string[] };
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
      (a) => (map[a.pole_id] = { selected: true, tasks: a.tasks ?? "", memberIds: a.memberIds }),
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
          .select("id,member_id")
          .in(
            "assignment_id",
            p.assignments.map((a) => a.id),
          )
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
    if (memberRows.error || memberSlots.error) {
      toast.error("Impossible de charger les affectations des créneaux.");
      return;
    }
    const dayMap = new Map((dayRes.data ?? []).map((d: any) => [d.id, d.service_date]));
    const assignmentMap = new Map(p.assignments.map((a: any) => [a.id, a.pole_id]));
    const serviceSlots: ServiceSlotDraft[] = (slotRes.data ?? []).map((s: any) => ({
      key: s.id,
      service_date: dayMap.get(s.program_day_id) ?? p.start_date ?? "",
      label: s.label ?? "",
      start_time: s.start_time ?? "",
      end_time: s.end_time ?? "",
      required_count: s.required_count ?? 1,
      pole_id: s.assignment_id ? (assignmentMap.get(s.assignment_id) ?? "") : "",
      memberIds: (memberSlots.data ?? [])
        .filter((m: any) => m.service_slot_id === s.id)
        .map(
          (m: any) => memberRows.data.find((a: any) => a.id === m.assignment_member_id)?.member_id,
        )
        .filter(Boolean),
    }));
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
      slot_selection_mode: (p as any).slot_selection_mode === "member" ? "member" : "organizer",
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
      if (!v.response_deadline) throw new Error("La date limite de réponse est obligatoire.");
      if (v.response_deadline < todayIso())
        throw new Error("La date limite de réponse ne peut pas être dans le passé.");
      if (v.response_deadline > v.start_date)
        throw new Error("La date limite de réponse ne peut pas dépasser la date du programme.");
      if (v.detailed_scheduling && !v.serviceSlots.length)
        throw new Error("Ajoute au moins un créneau de service.");
      if (
        v.detailed_scheduling &&
        v.serviceSlots.some(
          (s) => !s.service_date || !s.start_time || !s.end_time || s.start_time >= s.end_time,
        )
      )
        throw new Error("Chaque créneau doit avoir un jour et des horaires valides.");
      const slotPoleIds = new Set(v.serviceSlots.map((s) => s.pole_id).filter(Boolean));
      const selectedPoles = { ...v.poles };
      for (const poleId of slotPoleIds)
        selectedPoles[poleId] = {
          ...(selectedPoles[poleId] ?? { tasks: "", memberIds: [] }),
          selected: true,
        };
      const targetPoles = Object.entries(selectedPoles).filter(([, x]) => x.selected).map(([id]) => id);
      const check = await (supabase as any).rpc("check_program_write_access", { p_program_id: v.id ?? null, p_poles: targetPoles, p_generate: dates.length > 1 });
      if (check.error) throw check.error;
      let id = v.id ?? newId("p");
      const payload = {
        creation_key: v.creation_key,
        title: v.title.trim(),
        description: v.description.trim() || null,
        program_type: v.program_type || null,
        start_date: v.start_date || null,
        start_time: v.start_time || null,
        end_date: v.end_date || null,
        end_time: v.end_time || null,
        response_deadline: v.response_deadline || null,
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
        slot_selection_mode: v.slot_selection_mode,
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
      const old =
        (programs.data ?? []).find((p) => p.id === id)?.assignments.map((a) => a.id) ?? [];
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
        [...new Set([...sel[i][1].memberIds, ...(directByPole.get(a.pole_id) ?? [])])].map(
          (member_id) => ({ assignment_id: a.id, member_id }),
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
      const db = supabase as any;
      await db.from("program_service_slots").delete().eq("program_id", id);
      await db.from("program_days").delete().eq("program_id", id);
      if (v.detailed_scheduling) {
        const dates = [...new Set(v.serviceSlots.map((s) => s.service_date))];
        const dayIns = await db
          .from("program_days")
          .insert(
            dates.map((service_date) => ({
              program_id: id,
              service_date,
              start_time: null,
              end_time: null,
            })),
          )
          .select("id,service_date");
        if (dayIns.error) throw dayIns.error;
        const dayByDate = new Map((dayIns.data ?? []).map((d: any) => [d.service_date, d.id]));
        const slotRows = v.serviceSlots.map((s, position) => ({
          program_id: id,
          program_day_id: dayByDate.get(s.service_date),
          assignment_id: rows.find((r) => r.pole_id === s.pole_id)?.id ?? null,
          label: s.label.trim() || null,
          start_time: s.start_time,
          end_time: s.end_time,
          required_count: Math.max(1, Number(s.required_count) || 1),
          position,
        }));
        const slotIns = await db
          .from("program_service_slots")
          .insert(slotRows)
          .select("id,position");
        if (slotIns.error) throw slotIns.error;
        const memberSlots = v.serviceSlots.flatMap((s, slotIndex) =>
          s.memberIds
            .map((memberId) => {
              const assignment = rows.find(
                (r) =>
                  r.pole_id ===
                  (s.pole_id || links.find((l: any) => l.member_id === memberId)?.pole_id),
              );
              const am = savedMembers.find(
                (m) => m.assignment_id === assignment?.id && m.member_id === memberId,
              );
              return am
                ? {
                    assignment_member_id: am.id,
                    program_day_id: dayByDate.get(s.service_date),
                    service_slot_id: (slotIns.data ?? []).find(
                      (saved: any) => saved.position === slotIndex,
                    )?.id,
                    start_time: s.start_time,
                    end_time: s.end_time,
                  }
                : null;
            })
            .filter(Boolean),
        );
        if (memberSlots.length) {
          const x = await db.from("program_assignment_member_slots").insert(memberSlots);
          if (x.error) throw x.error;
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
                  items={TYPES.map((x) => [x, x])}
                />
                <Choice
                  label="Format"
                  value={draft.format}
                  set={(v) => setDraft({ ...draft, format: v })}
                  items={FORMATS.map((x) => [x, x])}
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
                    onChange={(e) =>
                      setDraft({
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
                <Field label="Date limite de réponse *">
                  <Input
                    type="date"
                    min={todayIso()}
                    max={draft.start_date || undefined}
                    value={draft.response_deadline}
                    onChange={(e) => setDraft({ ...draft, response_deadline: e.target.value })}
                  />
                  <span className="block text-[11px] text-muted-foreground">
                    Utilisée comme échéance de référence pour les réponses et les sollicitations
                    liées à ce programme.
                  </span>
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
                  items={AUDIENCES}
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
              {canonicalProgramFormat(draft.format).startsWith("deplacement") ? (
                <TravelMembers
                  members={allMembers.filter((m) => m.status === "active" && !m.archived)}
                  selected={draft.travel_member_ids}
                  onChange={(travel_member_ids) => setDraft({ ...draft, travel_member_ids })}
                />
              ) : null}
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
              <Field label="Note générale">
                <Textarea
                  value={draft.general_note}
                  onChange={(e) => setDraft({ ...draft, general_note: e.target.value })}
                />
              </Field>
              <ProgramServiceSlotsEditor
                enabled={draft.detailed_scheduling}
                selectionMode={draft.slot_selection_mode}
                slots={draft.serviceSlots}
                dates={dateRange(draft.start_date, draft.end_date || draft.start_date)}
                poles={activePoles}
                members={allMembers.filter((m: any) => m.status === "active" && !m.archived)}
                links={links as any}
                onEnabledChange={(detailed_scheduling) =>
                  setDraft({ ...draft, detailed_scheduling })
                }
                onSelectionModeChange={(slot_selection_mode) =>
                  setDraft({ ...draft, slot_selection_mode })
                }
                onChange={(serviceSlots) => setDraft({ ...draft, serviceSlots })}
              />
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
              <section>
                <h3 className="mb-2 font-black text-icc-violet">Pôles et membres mobilisés</h3>
                <div className="space-y-3">
                  {activePoles.map((pole) => {
                    const x = draft.poles[pole.id] ?? { selected: false, tasks: "", memberIds: [] };
                    const pm = allMembers.filter((m) =>
                      links.some((l) => l.pole_id === pole.id && l.member_id === m.id),
                    );
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
                              placeholder="Tâches confiées à ce pôle"
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
                            {pm.map((m) => {
                              const inactive = m.status !== "active",
                                u = unavailable(m.id),
                                checked = x.memberIds.includes(m.id);
                              return (
                                <label
                                  key={m.id}
                                  className="flex items-center justify-between rounded-lg bg-muted/50 p-2 text-sm"
                                >
                                  <span className="flex gap-2">
                                    <Checkbox
                                      checked={checked}
                                      disabled={inactive}
                                      onCheckedChange={(c) =>
                                        setDraft({
                                          ...draft,
                                          poles: {
                                            ...draft.poles,
                                            [pole.id]: {
                                              ...x,
                                              memberIds:
                                                c === true
                                                  ? [...x.memberIds, m.id]
                                                  : x.memberIds.filter((id) => id !== m.id),
                                            },
                                          },
                                        })
                                      }
                                    />
                                    {m.full_name}
                                  </span>
                                  <small
                                    className={
                                      inactive || u ? "font-bold text-red-600" : "text-green-700"
                                    }
                                  >
                                    {inactive ? "Inactif" : u ? "Indisponible" : "Disponible"}
                                  </small>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
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
  items: string[][];
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
