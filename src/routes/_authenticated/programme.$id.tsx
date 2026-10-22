import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, EmptyState } from "@/components/AppShell";
import { ProgramFullExport } from "@/components/programs/ProgramFullExport";
import { ProgramParticipationPanel } from "@/components/programs/ProgramParticipationPanel";
import { CopyProgramLinkButton } from "@/components/programs/CopyProgramLinkButton";
import { useCurrentRole } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { canonicalProgramFormat } from "@/lib/programLabels";
import { detectConflicts } from "@/lib/conflicts";
import {
  availabilityQuery,
  formatDate,
  formatDateTime,
  internalNotesQuery,
  logAction,
  membersQuery,
  polesQuery,
  programDocumentsQuery,
  programModelsQuery,
  programsQuery,
  recurrenceLabel,
  STATUS_LABEL,
  timelineQuery,
  tasksQuery,
  TASK_STATUS_LABEL,
  type ResponseStatus,
  type Task,
} from "@/lib/icc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
export const Route = createFileRoute("/_authenticated/programme/$id")({
  head: () => ({
    meta: [
      { title: "Fiche programme — COM ICC Le Mans" },
      {
        name: "description",
        content: "Fiche programme complète : équipe, tâches, documents et historique.",
      },
    ],
  }),
  component: ProgramSheet,
});
const RESPONSES: ResponseStatus[] = ["available", "partial", "unavailable"];
const RESPONSE_TEXT: Record<string, string> = {
  available: "Accepté",
  partial: "Accepté partiellement",
  unavailable: "Refusé",
  pending: "En attente",
};
const responseLabel = (s: string | null | undefined) =>
  s ? (RESPONSE_TEXT[s] ?? s) : "En attente";
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
function ProgramSheet() {
  const { id } = Route.useParams();
  const [activeTab, setActiveTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("tab") ?? "infos";
    return ["infos", "participation", "taches", "equipe", "documents", "timeline", "sur-place", "deplacement"].includes(requested) ? requested : "infos";
  });
  const { member, isStaff } = useCurrentRole();
  const qc = useQueryClient();
  const programs = useQuery(programsQuery),
    poles = useQuery(polesQuery),
    members = useQuery(membersQuery),
    availability = useQuery(availabilityQuery),
    documents = useQuery(programDocumentsQuery),
    notes = useQuery(internalNotesQuery),
    timeline = useQuery(timelineQuery("program", id)),
    tasks = useQuery(tasksQuery),
    models = useQuery(programModelsQuery);
  const responses = useQuery({
    queryKey: ["program-responses", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("program_member_responses")
        .select("*")
        .eq("program_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });
  const program = (programs.data ?? []).find((p) => p.id === id);
  const participationModes = useQuery({
    queryKey: [
      "program-sheet-participation-modes",
      id,
      (program?.assignments ?? []).map((a) => a.id).sort().join(","),
    ],
    enabled: !!program,
    queryFn: async () => {
      const assignmentIds = (program?.assignments ?? []).map((a) => a.id);
      if (!assignmentIds.length) return [];
      const { data, error } = await (supabase as any)
        .from("program_assignment_members")
        .select("id,assignment_id,member_id,assignment_mode,process_status")
        .in("assignment_id", assignmentIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const programDays = useQuery({
    queryKey: ["program-days-sheet", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("program_days")
        .select("*")
        .eq("program_id", id)
        .order("service_date");
      if (error) throw error;
      return data ?? [];
    },
  });
  const serviceSlots = useQuery({
    queryKey: ["program-service-slots", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("program_service_slots")
        .select("*")
        .eq("program_id", id)
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
  });
  const assignmentMemberSlots = useQuery({
    queryKey: ["program-assignment-member-slots-sheet", id, (participationModes.data ?? []).map((x: any) => x.id).sort().join(",")],
    enabled: (participationModes.data ?? []).length > 0,
    queryFn: async () => {
      const ids = (participationModes.data ?? []).map((x: any) => x.id);
      const { data, error } = await (supabase as any)
        .from("program_assignment_member_slots")
        .select("assignment_member_id,service_slot_id")
        .in("assignment_member_id", ids);
      if (error) throw error;
      return data ?? [];
    },
  });
  const poleName = new Map((poles.data ?? []).map((p) => [p.id, p.name]));
  const memberName = new Map((members.data?.members ?? []).map((m) => [m.id, m.full_name]));
  const programTasks = (tasks.data ?? []).filter((t) => t.program_id === id);
  const assignedIds = [...new Set((program?.assignments ?? []).flatMap((a) => a.memberIds))];
  const teamLocation = (mid: string) =>
    ((program as any)?.travel_member_ids ?? []).includes(mid) ? "travel" : "onsite";
  const responseOf = (mid: string) => (responses.data ?? []).find((r: any) => r.member_id === mid);
  const participationRows = participationModes.data ?? [];
  const participationModeOf = (mid: string) =>
    participationRows.find((r: any) => r.member_id === mid && r.process_status !== "covered")?.assignment_mode;
  const requiresResponse =
    !!member?.id &&
    participationRows.some(
      (r: any) =>
        r.member_id === member.id &&
        r.assignment_mode === "solicited" &&
        r.process_status !== "covered",
    );
  const participationLabel = (mid: string) => {
    const mode = participationModeOf(mid);
    if (mode === "direct") return "Affecté directement";
    if (mode === "proposal") return "Proposition acceptée";
    if (mode === "solicited") return responseLabel(responseOf(mid)?.status);
    return responseLabel(responseOf(mid)?.status);
  };
  const conflicts =
    programs.data && availability.data && members.data
      ? detectConflicts(programs.data, members.data.members, availability.data).filter(
          (c) => c.programId === id,
        )
      : [];
  const [editor, setEditor] = useState<ResponseStatus | null>(null),
    [responseNote, setResponseNote] = useState("");
  const respond = useMutation({
    mutationFn: async ({ status, note }: { status: ResponseStatus; note?: string }) => {
      if (!member?.id) throw new Error("Compte non lié à un équipier.");
      const clean = note?.trim() || null;
      const { error } = await (supabase as any).rpc("respond_to_program_solicitation", {
        p_program_id: id,
        p_status: status,
        p_note: clean,
      });
      if (error) throw error;
      await logAction({
        action: "reponse_affectation",
        entity: "program",
        entityId: id,
        detail: responseLabel(status),
        actorName: member.full_name,
      });
    },
    onSuccess: async () => {
      setEditor(null);
      setResponseNote("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["program-responses", id] }),
        qc.invalidateQueries({ queryKey: ["program-sheet-participation-modes", id] }),
        qc.invalidateQueries({ queryKey: ["program-assignment-modes", id] }),
        qc.invalidateQueries({ queryKey: ["programs"] }),
        qc.invalidateQueries({ queryKey: ["program-staffing-needs", id] }),
      ]);
      toast.success("Réponse enregistrée et actualisée");
    },
    onError: (error: any) => {
      toast.error(error?.message || "Impossible d’enregistrer ta réponse. Réessaie.");
    },
  });
  const setTeamLocation = useMutation({
    mutationFn: async ({
      memberId,
      location,
    }: {
      memberId: string;
      location: "travel" | "onsite" | null;
    }) => {
      if (!isStaff) throw new Error("Action réservée aux responsables autorisés.");
      const ids: string[] = (program as any)?.travel_member_ids ?? [];
      const next =
        location === "travel"
          ? [...new Set([...ids, memberId])]
          : ids.filter((x) => x !== memberId);
      const { error } = await (supabase as any)
        .from("programs")
        .update({ travel_member_ids: next })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["programs"] });
      toast.success("Répartition mise à jour");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleTask = useMutation({
    mutationFn: async (t: Task) => {
      const status = t.status === "done" ? "todo" : "done";
      const { error } = await supabase.from("tasks").update({ status }).eq("id", t.id);
      if (error) throw error;
      await logAction({
        action: "tache_statut",
        entity: "program",
        entityId: id,
        detail: `${t.title} → ${TASK_STATUS_LABEL[status]}`,
        actorName: member?.full_name,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["timeline", "program", id] });
      toast.success("Statut de la tâche mis à jour");
    },
    onError: (e: any) => toast.error(e.message || "Impossible de modifier la tâche."),
  });
  const [taskTitle, setTaskTitle] = useState("");
  const addTask = useMutation({
    mutationFn: async () => {
      if (!taskTitle.trim()) throw new Error("Saisis le titre de la tâche.");
      const { error } = await supabase
        .from("tasks")
        .insert({ title: taskTitle.trim(), program_id: id, status: "todo", priority: "normale" });
      if (error) throw error;
    },
    onSuccess: () => {
      setTaskTitle("");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Tâche ajoutée");
    },
    onError: (e: any) => toast.error(e.message || "Impossible d’ajouter la tâche."),
  });
  const [bulkOpen, setBulkOpen] = useState(false),
    [bulkText, setBulkText] = useState("");
  const addBulk = useMutation({
    mutationFn: async () => {
      const lines = [
        ...new Set(
          bulkText
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ];
      const existing = new Set(programTasks.map((t) => t.title.trim().toLowerCase()));
      const fresh = lines.filter((x) => !existing.has(x.toLowerCase()));
      if (!fresh.length) throw new Error("Aucune nouvelle tâche à ajouter.");
      const { error } = await supabase
        .from("tasks")
        .insert(
          fresh.map((title) => ({ title, program_id: id, status: "todo", priority: "normale" })),
        );
      if (error) throw error;
      return fresh.length;
    },
    onSuccess: (n) => {
      setBulkOpen(false);
      setBulkText("");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(`${n} tâche(s) ajoutée(s)`);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [importOpen, setImportOpen] = useState(false),
    [selectedModel, setSelectedModel] = useState(""),
    [selectedTitles, setSelectedTitles] = useState<string[]>([]);
  const chosenModel = (models.data ?? []).find((m) => m.id === selectedModel);
  const chooseModel = (mid: string) => {
    setSelectedModel(mid);
    const m = (models.data ?? []).find((x) => x.id === mid);
    setSelectedTitles(arr(m?.checklist));
  };
  const importTasks = useMutation({
    mutationFn: async () => {
      if (!chosenModel) throw new Error("Choisissez un modèle.");
      const existing = new Set(programTasks.map((t) => t.title.trim().toLowerCase()));
      const fresh = selectedTitles.filter((x) => !existing.has(x.trim().toLowerCase()));
      if (!fresh.length)
        throw new Error("Toutes les tâches choisies existent déjà dans ce programme.");
      const modelPoles = arr(chosenModel.poles);
      const { error } = await supabase
        .from("tasks")
        .insert(
          fresh.map((title) => ({
            title,
            program_id: id,
            pole_id: modelPoles.length === 1 ? modelPoles[0] : null,
            status: "todo",
            priority: "normale",
          })),
        );
      if (error) throw error;
      return fresh.length;
    },
    onSuccess: (n) => {
      setImportOpen(false);
      setSelectedModel("");
      setSelectedTitles([]);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(`${n} tâche(s) importée(s) depuis le modèle`);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [saveModelOpen, setSaveModelOpen] = useState(false),
    [modelMode, setModelMode] = useState<"new" | "existing">("new"),
    [newModelName, setNewModelName] = useState(""),
    [targetModel, setTargetModel] = useState("");
  const saveTasksToModel = useMutation({
    mutationFn: async () => {
      const titles = [...new Set(programTasks.map((t) => t.title.trim()).filter(Boolean))];
      if (!titles.length) throw new Error("Le programme n'a aucune tâche à enregistrer.");
      if (modelMode === "new") {
        if (!newModelName.trim()) throw new Error("Donnez un nom au nouveau modèle.");
        const payload = {
          id: `mdl_${crypto.randomUUID()}`,
          name: newModelName.trim(),
          description: program?.description ?? null,
          program_type: program?.program_type ?? null,
          format: program?.format ?? null,
          audience: program?.audience ?? null,
          tasks: program?.general_note ?? null,
          poles: (program?.assignments ?? []).map((a) => a.pole_id),
          checklist: titles,
        };
        const { error } = await supabase.from("program_models").insert(payload);
        if (error) throw error;
        return "Nouveau modèle créé";
      }
      const target = (models.data ?? []).find((m) => m.id === targetModel);
      if (!target) throw new Error("Choisissez un modèle existant.");
      const merged = [...new Set([...arr(target.checklist), ...titles])];
      const { error } = await supabase
        .from("program_models")
        .update({ checklist: merged })
        .eq("id", target.id);
      if (error) throw error;
      return "Modèle enrichi";
    },
    onSuccess: (msg) => {
      setSaveModelOpen(false);
      setNewModelName("");
      setTargetModel("");
      qc.invalidateQueries({ queryKey: ["program-models"] });
      toast.success(msg);
    },
    onError: (e: any) => toast.error(e.message),
  });
  if (programs.isLoading)
    return (
      <AppShell title="Fiche programme">
        <Skeleton className="h-40" />
      </AppShell>
    );
  if (!program)
    return (
      <AppShell title="Fiche programme">
        <EmptyState title="Programme introuvable" />
      </AppShell>
    );
  const mine = member?.id ? responseOf(member.id) : null;
  // L'équipe réelle ne comprend que les affectations confirmées, jamais les simples sollicitations.
  const actualAssignments = participationRows.filter(
    (r: any) =>
      ["direct", "proposal"].includes(r.assignment_mode) &&
      !["covered", "withdrawn", "refused"].includes(r.process_status),
  );
  const actualTeamMembers = [...new Set(actualAssignments.map((r: any) => r.member_id))] as string[];
  const hasTravel = canonicalProgramFormat(program.format).startsWith("deplacement");
  const slotById = new Map((serviceSlots.data ?? []).map((slot: any) => [slot.id, slot]));
  const slotsForAssignmentMember = (assignmentMemberId: string) =>
    (assignmentMemberSlots.data ?? [])
      .filter((x: any) => x.assignment_member_id === assignmentMemberId)
      .map((x: any) => slotById.get(x.service_slot_id))
      .filter(Boolean);
  const slotLabel = (slot: any) =>
    [slot.service_date ?? slot.date ?? (programDays.data ?? []).find((day: any) => day.id === slot.program_day_id)?.service_date, slot.start_time && slot.end_time ? `${String(slot.start_time).slice(0,5)}–${String(slot.end_time).slice(0,5)}` : slot.start_time ?? slot.end_time]
      .filter(Boolean)
      .join(" · ") || "Créneau du programme";
  return (
    <AppShell
      title={program.title}
      subtitle={`${formatDate(program.start_date)}${program.location ? ` · ${program.location}` : ""}`}
      actions={
        <>
          <CopyProgramLinkButton programId={id} />
          <ProgramFullExport
            program={program}
            tasks={programTasks}
            documents={documents.data ?? []}
            notes={notes.data ?? []}
            responses={responses.data ?? []}
            memberName={memberName}
            poleName={poleName}
          />
        </>
      }
    >
      <div className="mb-4 flex gap-2">
        <Badge>{STATUS_LABEL[program.status] ?? program.status}</Badge>
        {program.archived ? <Badge variant="destructive">Archivé</Badge> : null}
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="infos">Informations</TabsTrigger>
          <TabsTrigger value="participation">Participation & besoins</TabsTrigger>
          <TabsTrigger value="taches">Tâches / checklist</TabsTrigger>
          <TabsTrigger value="equipe">Équipe du jour</TabsTrigger>
          <TabsTrigger value="documents">Documents & notes</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>
        <TabsContent value="infos" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Informations générales</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Info label="Date de début" value={formatDate(program.start_date)} />
              <Info label="Date de fin" value={formatDate(program.end_date ?? program.start_date)} />
              <Info
                label="Horaires généraux"
                value={`${program.start_time ?? "—"} → ${program.end_time ?? "—"}`}
              />
              <Info label="Lieu" value={program.location ?? "—"} />
              <Info label="Public" value={program.audience ?? "—"} />
              <Info label="Récurrence" value={recurrenceLabel(program.recurrence)} />
              <Info
                label="Pôles mobilisés"
                value={
                  program.assignments.map((a) => poleName.get(a.pole_id) ?? "?").join(", ") || "—"
                }
              />
              {program.description ? (
                <Info label="Description" value={program.description} />
              ) : null}
            </CardContent>
          </Card>
          {(programDays.data ?? []).length || (serviceSlots.data ?? []).length ? (
            <Card>
              <CardHeader><CardTitle>Déroulé détaillé et créneaux</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {(programDays.data ?? []).length ? (programDays.data ?? []).map((day: any) => {
                  const daySlots = (serviceSlots.data ?? []).filter((slot: any) => slot.program_day_id === day.id);
                  return (
                    <div key={day.id} className="rounded-lg border p-3">
                      <b>{formatDate(day.service_date)}</b>
                      <p className="text-sm text-muted-foreground">
                        {day.start_time || program.start_time || "—"} → {day.end_time || program.end_time || "—"}
                      </p>
                      {day.note ? <p className="mt-1 text-sm">{day.note}</p> : null}
                      {daySlots.length ? <div className="mt-2 space-y-2">{daySlots.map((slot: any) => (
                        <div key={slot.id} className="rounded-md bg-muted/60 p-2 text-sm">
                          <b>{slot.label || "Créneau"}</b> · {slot.actual_start_date && slot.actual_start_date !== day.service_date ? `${formatDate(slot.actual_start_date)} · ` : ""}{slot.start_time || "—"} → {slot.end_time || "—"}{slot.actual_end_date && slot.actual_start_date && slot.actual_end_date !== slot.actual_start_date ? <span className="text-muted-foreground"> · fin le {formatDate(slot.actual_end_date)}</span> : null}
                          {slot.required_count ? <span> · Besoin : {slot.required_count} personne(s)</span> : null}
                        </div>
                      ))}</div> : null}
                    </div>
                  );
                }) : (serviceSlots.data ?? []).map((slot: any) => (
                  <div key={slot.id} className="rounded-lg border p-3 text-sm">
                    <b>{slot.label || "Créneau"}</b> · {formatDate(program.start_date)} · {slot.start_time || "—"} → {slot.end_time || "—"}
                    {slot.required_count ? <span> · Besoin : {slot.required_count} personne(s)</span> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
          {requiresResponse ? (
            <Card id="program-response">
              <CardHeader>
                <CardTitle>Ma réponse à la sollicitation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-2">
                  {RESPONSES.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={mine?.status === s ? "default" : "outline"}
                      disabled={respond.isPending}
                      onClick={() =>
                        s === "available" ? respond.mutate({ status: s }) : setEditor(s)
                      }
                    >
                      {s === "available"
                        ? "Accepter"
                        : s === "partial"
                          ? "Accepter partiellement"
                          : "Refuser"}
                    </Button>
                  ))}
                </div>
                {editor ? (
                  <>
                    <Textarea
                      value={responseNote}
                      onChange={(e) => setResponseNote(e.target.value)}
                    />
                    <Button
                      size="sm"
                      onClick={() => respond.mutate({ status: editor, note: responseNote })}
                    >
                      Enregistrer
                    </Button>
                  </>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          {conflicts.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Conflits et alertes</CardTitle>
              </CardHeader>
              <CardContent>
                {conflicts.map((c, i) => (
                  <p key={i}>{c.message}</p>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
        <TabsContent value="participation" className="space-y-4">
          <ProgramParticipationPanel
            programId={id}
            programTitle={program.title}
            assignments={program.assignments as any}
            members={(members.data?.members ?? []) as any}
            poles={(poles.data ?? []) as any}
          />
        </TabsContent>
        <TabsContent value="taches">
          <Card>
            <CardHeader>
              <CardTitle>Tâches / checklist du programme</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {programTasks.length === 0 ? (
                <EmptyState title="Aucune tâche" />
              ) : (
                <div className="space-y-2">
                  {programTasks.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => toggleTask.mutate(t)}
                      className="flex w-full items-start gap-3 rounded-lg border p-3 text-left"
                    >
                      <span>{t.status === "done" ? "☑" : "☐"}</span>
                      <span>
                        <b className={t.status === "done" ? "line-through" : ""}>{t.title}</b>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {isStaff ? (
                <>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ajouter une tâche…"
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                    />
                    <Button onClick={() => addTask.mutate()}>Ajouter</Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
                      Ajouter plusieurs tâches
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                      Importer depuis un modèle
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!programTasks.length}
                      onClick={() => setSaveModelOpen(true)}
                    >
                      Enregistrer ces tâches comme modèle
                    </Button>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="equipe" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Seules les personnes effectivement affectées apparaissent ici. Les membres simplement sollicités restent dans « Participation & besoins » jusqu’à confirmation.
          </p>
          <Card>
            <CardHeader>
              <CardTitle>Équipe affectée ({actualTeamMembers.length})</CardTitle>
              <p className="text-sm text-muted-foreground">
                Le pôle de service et les créneaux associés sont indiqués pour chaque personne. La mention « En déplacement » apparaît uniquement si un déplacement est prévu et que la personne y participe.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {actualTeamMembers.length ? actualTeamMembers.map((mid) => {
                const memberAssignments = actualAssignments.filter((r: any) => r.member_id === mid);
                const poleIds = [...new Set(memberAssignments.map((r: any) => (program.assignments ?? []).find((a) => a.id === r.assignment_id)?.pole_id).filter(Boolean))] as string[];
                const poleLabels = poleIds.map((poleId) => poleName.get(poleId) ?? "Pôle");
                const linkedSlots = [...new Map(memberAssignments.flatMap((r: any) => slotsForAssignmentMember(r.id)).map((slot: any) => [slot.id, slot])).values()];
                const tasks = [...new Set(memberAssignments.map((r: any) => (program.assignments ?? []).find((a) => a.id === r.assignment_id)?.tasks).filter(Boolean))];
                const modes = [...new Set(memberAssignments.map((r: any) => r.assignment_mode === "direct" ? "Affectation directe" : "Proposition acceptée"))];
                const isTravelling = hasTravel && teamLocation(mid) === "travel";
                return (
                  <div key={mid} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <b>{memberName.get(mid) ?? mid}</b>
                        <p className="text-sm text-muted-foreground">{poleLabels.join(", ") || "Pôle non précisé"}</p>
                        <p className="text-xs text-muted-foreground">{modes.join(" · ")}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {isTravelling ? <Badge>🚐 En déplacement</Badge> : null}
                        {isStaff && hasTravel ? (
                          <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              checked={isTravelling}
                              onChange={(e) => setTeamLocation.mutate({ memberId: mid, location: e.target.checked ? "travel" : null })}
                            />
                            En déplacement
                          </label>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {linkedSlots.length ? linkedSlots.map((slot: any) => (
                        <Badge key={slot.id} variant="secondary">{slotLabel(slot)}</Badge>
                      )) : <span className="text-xs text-muted-foreground">{(serviceSlots.data ?? []).length ? "Créneau individuel non renseigné" : "Besoin du programme"}</span>}
                    </div>
                    {tasks.length ? <p className="mt-2 text-sm">{tasks.join(" · ")}</p> : null}
                  </div>
                );
              }) : <EmptyState title="Aucune affectation confirmée" />}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Documents & notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(documents.data ?? [])
                .filter((d) => d.program_id === id)
                .map((d) => (
                  <a
                    id={`program-document-${d.id}`}
                    key={d.id}
                    href={d.url}
                    className="block font-semibold text-icc-violet underline"
                  >
                    {d.title}
                  </a>
                ))}
              {(notes.data ?? [])
                .filter((n) => n.entity === "program" && n.entity_id === id)
                .map((n) => (
                  <div key={n.id} className="rounded-lg bg-muted p-3 text-sm">
                    {n.body}
                    <p className="text-xs text-muted-foreground">
                      {n.author_name} · {formatDateTime(n.created_at)}
                    </p>
                  </div>
                ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="timeline">
          <Card>
            <CardHeader>
              <CardTitle>Histoire du programme</CardTitle>
            </CardHeader>
            <CardContent>
              {(timeline.data ?? []).map((e) => (
                <p key={e.id} className="mb-2 text-sm">
                  <b>{e.action}</b>
                  {e.detail ? ` — ${e.detail}` : ""}
                  <span className="block text-xs text-muted-foreground">
                    {e.actor_name ?? "Système"} · {formatDateTime(e.occurred_at)}
                  </span>
                </p>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter plusieurs tâches</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={10}
            placeholder="Une tâche par ligne"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>
              Annuler
            </Button>
            <Button onClick={() => addBulk.mutate()}>Ajouter les tâches</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importer les tâches d’un modèle</DialogTitle>
          </DialogHeader>
          <Select value={selectedModel} onValueChange={chooseModel}>
            <SelectTrigger>
              <SelectValue placeholder="Choisir un modèle" />
            </SelectTrigger>
            <SelectContent>
              {(models.data ?? [])
                .filter((m) => !m.archived)
                .map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {chosenModel ? (
            <div className="space-y-2">
              {arr(chosenModel.checklist).map((title) => (
                <label key={title} className="flex items-center gap-3 rounded-lg border p-3">
                  <input
                    type="checkbox"
                    checked={selectedTitles.includes(title)}
                    onChange={(e) =>
                      setSelectedTitles((x) =>
                        e.target.checked ? [...x, title] : x.filter((v) => v !== title),
                      )
                    }
                  />
                  <span>{title}</span>
                </label>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Annuler
            </Button>
            <Button onClick={() => importTasks.mutate()}>Importer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={saveModelOpen} onOpenChange={setSaveModelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réutiliser les tâches de ce programme</DialogTitle>
          </DialogHeader>
          <Select value={modelMode} onValueChange={(v) => setModelMode(v as "new" | "existing")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">Créer un nouveau modèle</SelectItem>
              <SelectItem value="existing">Ajouter à un modèle existant</SelectItem>
            </SelectContent>
          </Select>
          {modelMode === "new" ? (
            <Input
              placeholder="Nom du nouveau modèle"
              value={newModelName}
              onChange={(e) => setNewModelName(e.target.value)}
            />
          ) : (
            <Select value={targetModel} onValueChange={setTargetModel}>
              <SelectTrigger>
                <SelectValue placeholder="Choisir le modèle" />
              </SelectTrigger>
              <SelectContent>
                {(models.data ?? [])
                  .filter((m) => !m.archived)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveModelOpen(false)}>
              Annuler
            </Button>
            <Button onClick={() => saveTasksToModel.mutate()}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    
</AppShell>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
