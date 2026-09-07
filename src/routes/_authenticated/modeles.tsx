import { programError } from "@/lib/program-errors";
import { useProgramEditorPermissions } from "@/hooks/useProgramEditorPermissions";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Copy, Pencil, Plus, Files } from "lucide-react";
import { toast } from "sonner";
import { RecurrenceFields } from "@/components/programs/RecurrenceFields";
import { recurrenceDates, type RecurrenceRule } from "@/lib/recurrence";
import {
  PROGRAM_EDITOR_AUDIENCE_OPTIONS,
  PROGRAM_EDITOR_FORMAT_OPTIONS,
  PROGRAM_EDITOR_TYPE_OPTIONS,
  PROGRAM_RECURRENCE_OPTIONS,
} from "@/lib/programLabels";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Field, newId } from "@/components/admin/form-kit";
import { useCurrentRole } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { logAction, polesQuery, programModelsQuery, type ProgramModel } from "@/lib/icc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/modeles")({
  head: () => ({
    meta: [
      { title: "Modèles de programme — COM ICC Le Mans" },
      {
        name: "description",
        content: "Modèles réutilisables : besoins humains, échéances, pôles et tâches enrichies.",
      },
    ],
  }),
  component: Modeles,
});

type RichTask = {
  title: string;
  pole_id?: string | null;
  priority?: string;
  due_offset_days?: number | null;
};
type Draft = {
  id: string | null;
  name: string;
  description: string;
  program_type: string;
  format: string;
  audience: string;
  schedule: {
    frequency: string;
    start: string;
    until: string;
    start_time: string;
    end_time: string;
    rule: RecurrenceRule;
  };
  tasks: string;
  poles: string[];
  checklist: string;
  response_deadline_days: string;
  staffing: Record<string, number>;
  assignment_rules: string;
  notification_rules: string[];
};
const EMPTY: Draft = {
  id: null,
  schedule: { frequency: "ponctuel", start: "", until: "", start_time: "", end_time: "", rule: {} },
  name: "",
  description: "",
  program_type: "",
  format: "",
  audience: "",
  tasks: "",
  poles: [],
  checklist: "",
  response_deadline_days: "",
  staffing: {},
  assignment_rules: "",
  notification_rules: [],
};
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const obj = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
const modelAny = (m: ProgramModel) => m as any;

function parseTasks(text: string, poles: Array<{ id: string; name: string }>): RichTask[] {
  const byName = new Map(poles.map((p) => [p.name.trim().toLowerCase(), p.id]));
  return text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((line) => {
      const [titleRaw, poleRaw, priorityRaw, offsetRaw] = line.split("|").map((x) => x?.trim());
      const title = titleRaw || line;
      const pole_id = poleRaw ? (byName.get(poleRaw.toLowerCase()) ?? poleRaw) : null;
      const priority = ["basse", "normale", "haute"].includes((priorityRaw || "").toLowerCase())
        ? priorityRaw!.toLowerCase()
        : "normale";
      const m = (offsetRaw || "").match(/^J([+-]\d+|0)$/i);
      const due_offset_days = m ? Number(m[1]) : null;
      return { title, pole_id, priority, due_offset_days };
    });
}

function Modeles() {
  const models = useQuery(programModelsQuery),
    poles = useQuery(polesQuery),
    qc = useQueryClient();
  const { member } = useCurrentRole();
  const permissions = useProgramEditorPermissions();
  const isStaff = !!permissions.data && permissions.data.model_scope !== "interdit" && (['tous', 'all'].includes(permissions.data.model_scope) || permissions.data.model_poles.length > 0);
  const [draft, setDraft] = useState<Draft | null>(null),
    [arch, setArch] = useState(false);
  const [generation, setGeneration] = useState<{
    model: ProgramModel;
    start: string;
    until: string;
  } | null>(null);
  const poleName = new Map((poles.data ?? []).map((p) => [p.id, p.name]));
  const activePoles = (poles.data ?? []).filter((p) => !p.archived);
  const rows = (models.data ?? []).filter((m) => (arch ? m.archived : !m.archived));
  const refresh = () => qc.invalidateQueries({ queryKey: ["program-models"] });

  const save = useMutation({
    mutationFn: async (v: Draft) => {
      const name = v.name.trim();
      if (!name) throw new Error("Le nom du modèle est obligatoire.");
      const dates =
        v.schedule.frequency !== "ponctuel"
          ? recurrenceDates(
              v.schedule.start,
              v.schedule.until,
              v.schedule.frequency,
              v.schedule.rule,
            )
          : [];
      const modelId = v.id ?? newId("mdl");
      const rich = parseTasks(v.checklist, activePoles);
      const allowed = await (supabase as any).rpc("can_manage_program_model", { p_poles: v.poles });
      if (allowed.error) throw allowed.error;
      if (!allowed.data) throw new Error("Vous ne pouvez pas gérer les modèles de ces pôles. Contactez la responsable pour vérifier vos accès aux modèles.");
      if (dates.length) {
        const check = await (supabase as any).rpc("check_program_write_access", { p_program_id: null, p_poles: v.poles, p_task_poles: rich.map(t => t.pole_id || (v.poles.length === 1 ? v.poles[0] : null)), p_generate: true });
        if (check.error) throw check.error;
      }
      const checklist = rich.map((t) => t.title);
      const payload: any = {
        schedule: v.schedule,
        name,
        description: v.description.trim() || null,
        program_type: v.program_type.trim() || null,
        format: v.format.trim() || null,
        audience: v.audience.trim() || null,
        tasks: v.tasks.trim() || null,
        poles: v.poles,
        checklist,
        task_templates: rich,
        response_deadline_days:
          v.response_deadline_days === "" ? null : Math.max(0, Number(v.response_deadline_days)),
        staffing_requirements: v.staffing,
        assignment_rules: v.assignment_rules.trim() || null,
        notification_rules: v.notification_rules,
      };
      const table: any = supabase.from("program_models");
      if (v.id) {
        const current = modelAny((models.data ?? []).find((m) => m.id === v.id)!);
        payload.version = Number(current?.version || 1) + 1;
        const { error } = await table.update(payload).eq("id", v.id);
        if (error) throw error;
      } else {
        const { error } = await table.insert({ id: modelId, version: 1, ...payload });
        if (error) throw error;
      }
      setDraft((current) => (current ? { ...current, id: modelId } : current));
      if (dates.length) {
        const { error } = await (supabase as any).rpc("generate_model_programs", {
          p_model_id: modelId,
          p_dates: dates,
        });
        if (error) throw error;
      }
      await logAction({
        action: v.id ? "modele_modifie" : "modele_cree",
        entity: "program_model",
        entityId: v.id ?? name,
        detail: name,
        actorName: member?.full_name,
      });
    },
    onSuccess: () => {
      toast.success("Modèle enregistré et planning actualisé");
      setDraft(null);
      refresh();
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(programError(e)),
  });

  const toggle = useMutation({
    mutationFn: async (m: ProgramModel) => {
      const { error } = await supabase
        .from("program_models")
        .update({ archived: !m.archived })
        .eq("id", m.id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const duplicate = useMutation({
    mutationFn: async (m: ProgramModel) => {
      const mm = modelAny(m);
      const id = newId("mdl");
      const payload: any = {
        ...mm,
        id,
        name: `${m.name} — copie`,
        archived: false,
        version: 1,
        created_at: undefined,
        updated_at: undefined,
      };
      delete payload.created_at;
      delete payload.updated_at;
      const { error } = await (supabase.from("program_models") as any).insert(payload);
      if (error) throw error;
      await logAction({
        action: "modele_duplique",
        entity: "program_model",
        entityId: id,
        detail: m.name,
        actorName: member?.full_name,
      });
    },
    onSuccess: () => {
      toast.success("Modèle dupliqué");
      refresh();
    },
    onError: (e: Error) => toast.error(programError(e)),
  });

  const instantiate = useMutation({
    mutationFn: async () => {
      if (!generation) throw new Error("Choisis une date.");
      const schedule = (generation.model as any).schedule ?? EMPTY.schedule;
      const dates = recurrenceDates(
        generation.start,
        generation.until,
        schedule.frequency ?? "ponctuel",
        schedule.rule ?? {},
      );
      const { data, error } = await (supabase as any).rpc("generate_model_programs", {
        p_model_id: generation.model.id,
        p_dates: dates,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setGeneration(null);
      toast.success("Programmes ajoutés au planning");
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(programError(e)),
  });

  const editDraft = (m: ProgramModel): Draft => {
    const mm = modelAny(m);
    const rich: RichTask[] =
      Array.isArray(mm.task_templates) && mm.task_templates.length
        ? mm.task_templates
        : arr(m.checklist).map((title) => ({ title }));
    return {
      schedule: { ...EMPTY.schedule, ...(mm.schedule ?? {}) },
      id: m.id,
      name: m.name,
      description: m.description ?? "",
      program_type: m.program_type ?? "",
      format: m.format ?? "",
      audience: m.audience ?? "",
      tasks: m.tasks ?? "",
      poles: arr(m.poles),
      checklist: rich
        .map((t) =>
          [
            t.title,
            t.pole_id ? (poleName.get(t.pole_id) ?? t.pole_id) : "",
            t.priority && t.priority !== "normale" ? t.priority : "",
            t.due_offset_days != null
              ? `J${t.due_offset_days >= 0 ? "+" : ""}${t.due_offset_days}`
              : "",
          ]
            .join(" | "),
        )
        .join("\n"),
      response_deadline_days:
        mm.response_deadline_days == null ? "" : String(mm.response_deadline_days),
      staffing: obj(mm.staffing_requirements),
      assignment_rules: mm.assignment_rules ?? "",
      notification_rules: arr(mm.notification_rules),
    };
  };

  return (
    <AppShell
      title="Modèles de programme"
      subtitle="Préparez besoins humains, échéances, affectations et tâches avant la création du programme"
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => setArch((v) => !v)}>
            {arch ? "Voir les modèles actifs" : "Voir les archives"}
          </Button>
          {isStaff ? (
            <Button size="sm" onClick={() => setDraft({ ...EMPTY })}>
              <Plus className="mr-1 size-4" />
              Nouveau modèle
            </Button>
          ) : null}
        </>
      }
    >
      {models.isLoading ? (
        <Skeleton className="h-60 rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyState title={arch ? "Aucun modèle archivé" : "Aucun modèle"} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((m) => {
            const mm = modelAny(m);
            const staffing = obj(mm.staffing_requirements);
            return (
              <Card key={m.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex justify-between gap-2">
                    <div>
                      <b>{m.name}</b>
                      <p className="text-[11px] text-muted-foreground">Version {mm.version ?? 1}</p>
                    </div>
                    {m.program_type ? <Badge variant="secondary">{m.program_type}</Badge> : null}
                  </div>
                  {m.description ? (
                    <p className="text-sm text-muted-foreground">{m.description}</p>
                  ) : null}
                  <div>
                    <p className="mb-1 text-xs font-semibold">Pôles mobilisés / besoins</p>
                    <div className="flex flex-wrap gap-1">
                      {arr(m.poles).map((pid) => (
                        <Badge key={pid} variant="outline">
                          {poleName.get(pid) ?? pid}
                          {staffing[pid] ? ` · ${staffing[pid]} pers.` : ""}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {mm.response_deadline_days != null ? (
                    <p className="text-xs"><b>Réponse :</b> J-{mm.response_deadline_days}</p>
                  ) : null}
                  {mm.assignment_rules ? (
                    <p className="text-xs"><b>Règle d’affectation :</b> {mm.assignment_rules}</p>
                  ) : null}
                  {arr(m.checklist).length ? (
                    <div>
                      <p className="mb-1 text-xs font-semibold">Tâches générées</p>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {arr(m.checklist).slice(0, 6).map((x) => <li key={x}>□ {x}</li>)}
                      </ul>
                      {arr(m.checklist).length > 6 ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">+ {arr(m.checklist).length - 6} autre(s)</p>
                      ) : null}
                    </div>
                  ) : null}
                  {isStaff ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={instantiate.isPending || m.archived}
                        onClick={() => setGeneration({ model: m, start: mm.schedule?.start ?? "", until: mm.schedule?.until ?? "" })}
                      >
                        <Copy className="mr-1 size-4" /> Ajouter au planning
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => duplicate.mutate(m)}>
                        <Files className="mr-1 size-4" /> Dupliquer
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDraft(editDraft(m))}>
                        <Pencil className="mr-1 size-4" /> Modifier
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggle.mutate(m)}>
                        {m.archived ? <ArchiveRestore className="mr-1 size-4" /> : <Archive className="mr-1 size-4" />}
                        {m.archived ? "Restaurer" : "Archiver"}
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!generation} onOpenChange={(o) => { if (!o) setGeneration(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ajouter au planning</DialogTitle></DialogHeader>
          {generation ? (
            <div className="space-y-3">
              <p>{generation.model.name}</p>
              <Field label="Première date">
                <Input type="date" value={generation.start} onChange={(e) => setGeneration({ ...generation, start: e.target.value })} />
              </Field>
              {((generation.model as any).schedule?.frequency ?? "ponctuel") !== "ponctuel" ? (
                <Field label="Répéter jusqu’au">
                  <Input type="date" min={generation.start} value={generation.until} onChange={(e) => setGeneration({ ...generation, until: e.target.value })} />
                </Field>
              ) : null}
              <p className="text-sm">Chaque programme pourra être adapté individuellement.</p>
            </div>
          ) : null}
          <DialogFooter><Button disabled={instantiate.isPending} onClick={() => instantiate.mutate()}>Ajouter au planning</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!draft} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{draft?.id ? "Modifier le modèle" : "Nouveau modèle"}</DialogTitle></DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nom du modèle">
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </Field>
                <Field label="Réponse attendue (jours avant)">
                  <Input type="number" min="0" placeholder="Ex. 3" value={draft.response_deadline_days} onChange={(e) => setDraft({ ...draft, response_deadline_days: e.target.value })} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Récurrence">
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3"
                    value={draft.schedule.frequency}
                    onChange={(e) => setDraft({ ...draft, schedule: { ...draft.schedule, frequency: e.target.value } })}
                  >
                    {PROGRAM_RECURRENCE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Première date">
                  <Input type="date" value={draft.schedule.start} onChange={(e) => setDraft({ ...draft, schedule: { ...draft.schedule, start: e.target.value } })} />
                </Field>
                <Field label="Heure de début">
                  <Input type="time" value={draft.schedule.start_time} onChange={(e) => setDraft({ ...draft, schedule: { ...draft.schedule, start_time: e.target.value } })} />
                </Field>
                <Field label="Heure de fin">
                  <Input type="time" value={draft.schedule.end_time} onChange={(e) => setDraft({ ...draft, schedule: { ...draft.schedule, end_time: e.target.value } })} />
                </Field>
              </div>
              <RecurrenceFields
                frequency={draft.schedule.frequency}
                start={draft.schedule.start}
                until={draft.schedule.until}
                rule={draft.schedule.rule}
                onChange={(until, rule) => setDraft({ ...draft, schedule: { ...draft.schedule, until, rule } })}
              />
              <Field label="Description">
                <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>

              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Type">
                  <Select value={draft.program_type || "__none"} onValueChange={(v) => setDraft({ ...draft, program_type: v === "__none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Non renseigné" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Non renseigné</SelectItem>
                      {PROGRAM_EDITOR_TYPE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Format">
                  <Select value={draft.format || "__none"} onValueChange={(v) => setDraft({ ...draft, format: v === "__none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Non renseigné" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Non renseigné</SelectItem>
                      {PROGRAM_EDITOR_FORMAT_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Public">
                  <Select value={draft.audience || "__none"} onValueChange={(v) => setDraft({ ...draft, audience: v === "__none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Non renseigné" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Non renseigné</SelectItem>
                      {PROGRAM_EDITOR_AUDIENCE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">Ces trois listes utilisent exactement les mêmes valeurs que la fiche Programme.</p>

              <Field label="Consignes générales du programme (tous les pôles)">
                <Textarea value={draft.tasks} onChange={(e) => setDraft({ ...draft, tasks: e.target.value })} />
              </Field>
              <Field label="Pôles mobilisés et besoin humain">
                <div className="space-y-2">
                  {activePoles.map((p) => {
                    const on = draft.poles.includes(p.id);
                    return (
                      <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border p-2">
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, poles: on ? draft.poles.filter((x) => x !== p.id) : [...draft.poles, p.id] })}
                          className={on ? "rounded-full bg-icc-violet px-3 py-1 text-xs font-bold text-white" : "rounded-full border px-3 py-1 text-xs"}
                        >
                          {p.name}
                        </button>
                        {on ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Personnes nécessaires</span>
                            <Input className="w-20" type="number" min="0" value={draft.staffing[p.id] ?? 0} onChange={(e) => setDraft({ ...draft, staffing: { ...draft.staffing, [p.id]: Number(e.target.value) } })} />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Field>
              <Field label="Règles d’affectation">
                <Textarea rows={2} placeholder="Ex. au moins 1 référent Photo ; 1 autonome + 1 personne en formation" value={draft.assignment_rules} onChange={(e) => setDraft({ ...draft, assignment_rules: e.target.value })} />
              </Field>
              <Field label="Tâches modèles enrichies par pôle">
                <Textarea rows={7} value={draft.checklist} onChange={(e) => setDraft({ ...draft, checklist: e.target.value })} />
                <p className="mt-1 text-xs text-muted-foreground">
                  Une ligne par tâche. Format optionnel : <b>Titre | Pôle | priorité | J-2</b>. Exemple : “Préparer les visuels | Stories | haute | J-2”.
                </p>
              </Field>
              <Field label="Notifications par défaut">
                <div className="flex flex-wrap gap-2">
                  {[
                    { k: "response_deadline", l: "Rappel date limite" },
                    { k: "program_reminder", l: "Rappel avant programme" },
                    { k: "staffing_alert", l: "Alerte sous-effectif" },
                  ].map((x) => {
                    const on = draft.notification_rules.includes(x.k);
                    return (
                      <button
                        key={x.k}
                        type="button"
                        onClick={() => setDraft({ ...draft, notification_rules: on ? draft.notification_rules.filter((v) => v !== x.k) : [...draft.notification_rules, x.k] })}
                        className={on ? "rounded-full bg-icc-violet px-3 py-1 text-xs font-bold text-white" : "rounded-full border px-3 py-1 text-xs"}
                      >
                        {x.l}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                Les modifications du modèle ne changent jamais rétroactivement les programmes déjà créés. Elles s’appliquent uniquement aux prochains programmes.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>Annuler</Button>
            <Button disabled={save.isPending} onClick={() => draft && save.mutate(draft)}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
