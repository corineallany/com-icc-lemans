import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Copy, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Field } from "@/components/admin/form-kit";
import { useProgramEditorPermissions } from "@/hooks/useProgramEditorPermissions";
import { useCurrentRole } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { logAction, polesQuery, programModelsQuery } from "@/lib/icc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/modeles-taches")({
  head: () => ({ meta: [{ title: "Modèles de tâches et checklists — COM ICC Le Mans" }] }),
  component: TaskTemplateLibrary,
});

type TemplateTask = { title: string; pole_id: string | null; priority: string; due_offset_days: number | null };
type TemplateRow = { id: string; name: string; description: string | null; tasks: TemplateTask[]; poles: string[]; archived: boolean; deleted: boolean; version: number };
type Draft = { id: string | null; name: string; description: string; taskText: string; poles: string[]; programModelIds: string[] };
const EMPTY: Draft = { id: null, name: "", description: "", taskText: "", poles: [], programModelIds: [] };
const objArray = (v: unknown): any[] => Array.isArray(v) ? v : [];
const strArray = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const priorityLabel: Record<string, string> = { basse: "Basse", normale: "Normale", haute: "Haute" };

function TaskTemplateLibrary() {
  const templates = useQuery({ queryKey: ["task-template-models"], queryFn: async () => {
    const { data, error } = await (supabase as any).from("task_template_models").select("*").order("name");
    if (error) throw error;
    return (data ?? []) as TemplateRow[];
  }});
  const links = useQuery({ queryKey: ["task-template-model-links"], queryFn: async () => {
    const { data, error } = await (supabase as any).from("task_template_model_program_links").select("task_template_model_id,program_model_id");
    if (error) throw error;
    return (data ?? []) as Array<{task_template_model_id:string;program_model_id:string}>;
  }});
  const poles = useQuery(polesQuery);
  const programModels = useQuery(programModelsQuery);
  const permissions = useProgramEditorPermissions();
  const { member } = useCurrentRole();
  const qc = useQueryClient();
  const [view, setView] = useState<"active" | "archive" | "trash">("active");
  const [draft, setDraft] = useState<Draft | null>(null);
  const canManage = !!permissions.data && permissions.data.model_scope !== "interdit" &&
    (["tous", "all"].includes(permissions.data.model_scope) || permissions.data.model_poles.length > 0);
  const poleNames = useMemo(() => new Map((poles.data ?? []).map(p => [p.id, p.name])), [poles.data]);
  const programModelMap = useMemo(() => new Map((programModels.data ?? []).map(m => [m.id, m.name])), [programModels.data]);
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["task-template-models"] }),
      qc.invalidateQueries({ queryKey: ["task-template-model-links"] }),
    ]);
  };
  const parseText = (text: string): TemplateTask[] => text.split("\n").map(x => x.trim()).filter(Boolean).map(line => {
    const [titleRaw, poleRaw, priorityRaw, offsetRaw] = line.split("|").map(x => x?.trim());
    const foundPole = poleRaw ? [...poleNames.entries()].find(([id, name]) => id === poleRaw || name.toLowerCase() === poleRaw.toLowerCase())?.[0] ?? null : null;
    const prio = (priorityRaw ?? "").toLowerCase();
    const offset = (offsetRaw ?? "").match(/^J([+-]\d+|0)$/i);
    return { title: titleRaw || line, pole_id: foundPole, priority: ["basse", "normale", "haute"].includes(prio) ? prio : "normale", due_offset_days: offset ? Number(offset[1]) : null };
  });
  const toDraft = async (row: TemplateRow): Promise<Draft> => {
    const rowLinks = (links.data ?? []).filter(x => x.task_template_model_id === row.id).map(x => x.program_model_id);
    const tasks = objArray(row.tasks).map((t: TemplateTask) => [
      t.title,
      t.pole_id ? (poleNames.get(t.pole_id) ?? t.pole_id) : "",
      t.priority !== "normale" ? t.priority : "",
      t.due_offset_days != null ? `J${t.due_offset_days >= 0 ? "+" : ""}${t.due_offset_days}` : "",
    ].join(" | ")).join("\n");
    return { id: row.id, name: row.name, description: row.description ?? "", taskText: tasks, poles: strArray(row.poles), programModelIds: rowLinks };
  };
  const save = useMutation({
    mutationFn: async (v: Draft) => {
      const name = v.name.trim();
      if (!name) throw new Error("Le nom du modèle est obligatoire.");
      const allowed = await (supabase as any).rpc("can_manage_program_model", { p_poles: v.poles });
      if (allowed.error) throw allowed.error;
      if (!allowed.data) throw new Error("Vous n’avez pas les droits pour gérer un modèle avec ces pôles. Vérifiez vos accès aux modèles.");
      const { data: sessionData } = await supabase.auth.getSession();
      const payload = { name, description: v.description.trim() || null, tasks: parseText(v.taskText), poles: v.poles, version: v.id ? ((templates.data ?? []).find(m => m.id === v.id)?.version ?? 1) + 1 : 1 };
      let id = v.id;
      if (id) {
        const { error } = await (supabase as any).from("task_template_models").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        id = `ttm_${crypto.randomUUID().replace(/-/g, "")}`;
        const { error } = await (supabase as any).from("task_template_models").insert({ id, ...payload, created_by: sessionData.session?.user.id ?? null });
        if (error) throw error;
      }
      const { error: deleteLinksError } = await (supabase as any).from("task_template_model_program_links").delete().eq("task_template_model_id", id);
      if (deleteLinksError) throw deleteLinksError;
      if (v.programModelIds.length) {
        const { error } = await (supabase as any).from("task_template_model_program_links").insert(v.programModelIds.map(program_model_id => ({ task_template_model_id: id, program_model_id })));
        if (error) throw error;
      }
      await logAction({ action: v.id ? "modele_taches_modifie" : "modele_taches_cree", entity: "task_template_model", entityId: id, detail: name, actorName: member?.full_name });
    },
    onSuccess: async () => { toast.success("Modèle de tâches enregistré"); setDraft(null); await refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const setLifecycle = useMutation({
    mutationFn: async ({ row, action }: { row: TemplateRow; action: "archive" | "restore" | "trash" | "untrash" | "delete" }) => {
      if (action === "delete") {
        const { error } = await (supabase as any).from("task_template_models").delete().eq("id", row.id);
        if (error) throw error;
      } else {
        const patch = action === "archive" ? { archived: true } :
          action === "restore" ? { archived: false, deleted: false } :
          action === "trash" ? { deleted: true } : { deleted: false, archived: false };
        const { error } = await (supabase as any).from("task_template_models").update(patch).eq("id", row.id);
        if (error) throw error;
      }
      await logAction({ action: `modele_taches_${action}`, entity: "task_template_model", entityId: row.id, detail: row.name, actorName: member?.full_name });
    },
    onSuccess: async (_, vars) => { toast.success(vars.action === "delete" ? "Modèle supprimé définitivement" : "Modèle mis à jour"); await refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const duplicate = useMutation({
    mutationFn: async (row: TemplateRow) => {
      const id = `ttm_${crypto.randomUUID().replace(/-/g, "")}`;
      const { error } = await (supabase as any).from("task_template_models").insert({ id, name: `${row.name} — copie`, description: row.description, tasks: row.tasks, poles: row.poles, version: 1, created_by: (await supabase.auth.getUser()).data.user?.id ?? null });
      if (error) throw error;
      const rowLinks = (links.data ?? []).filter(x => x.task_template_model_id === row.id);
      if (rowLinks.length) {
        const { error: linkError } = await (supabase as any).from("task_template_model_program_links").insert(rowLinks.map(x => ({ task_template_model_id: id, program_model_id: x.program_model_id })));
        if (linkError) throw linkError;
      }
    },
    onSuccess: async () => { toast.success("Modèle dupliqué"); await refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = (templates.data ?? []).filter(row => view === "trash" ? row.deleted : !row.deleted && (view === "archive" ? row.archived : !row.archived));
  const loading = templates.isLoading || links.isLoading || poles.isLoading || programModels.isLoading;

  return <AppShell title="Modèles de tâches et checklists" subtitle="Une bibliothèque centralisée : modèles indépendants ou associés à un ou plusieurs modèles de programme." actions={<div className="flex flex-wrap gap-2">
    <Button size="sm" variant={view === "active" ? "default" : "outline"} onClick={() => setView("active")}>Modèles actifs</Button>
    <Button size="sm" variant={view === "archive" ? "default" : "outline"} onClick={() => setView("archive")}><Archive className="mr-1 size-4"/>Archives</Button>
    <Button size="sm" variant={view === "trash" ? "default" : "outline"} onClick={() => setView("trash")}><Trash2 className="mr-1 size-4"/>Corbeille</Button>
    {canManage ? <Button size="sm" onClick={() => setDraft({ ...EMPTY, poles: permissions.data?.model_poles ?? [] })}><Plus className="mr-1 size-4"/>Nouveau modèle</Button> : null}
  </div>}>
    <div className="mb-4 flex items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">Chaque modèle peut être modifié sans changer rétroactivement les tâches déjà créées dans un programme.</p>
      <Button size="sm" variant="outline" onClick={() => window.location.assign((import.meta.env.BASE_URL || "/") + "taches")}>Retour aux tâches</Button>
    </div>
    {loading ? <Skeleton className="h-52 rounded-xl"/> : rows.length === 0 ? <EmptyState title={view === "trash" ? "Corbeille vide" : view === "archive" ? "Aucun modèle archivé" : "Aucun modèle de tâches"} description={view === "active" ? "Créez un modèle indépendant ou associez-le à un ou plusieurs modèles de programme." : undefined}/> :
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map(row => {
        const rowLinks = (links.data ?? []).filter(x => x.task_template_model_id === row.id).map(x => programModelMap.get(x.program_model_id) ?? x.program_model_id);
        return <Card key={row.id}><CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2"><div><h3 className="font-bold">{row.name}</h3><p className="text-xs text-muted-foreground">Version {row.version || 1} · {objArray(row.tasks).length} tâche(s)</p></div>{row.archived ? <Badge variant="secondary">Archivé</Badge> : row.deleted ? <Badge variant="destructive">Corbeille</Badge> : <Badge variant="outline">Actif</Badge>}</div>
          {row.description ? <p className="text-sm text-muted-foreground">{row.description}</p> : null}
          {strArray(row.poles).length ? <div className="flex flex-wrap gap-1">{strArray(row.poles).map(id => <Badge key={id} variant="outline">{poleNames.get(id) ?? id}</Badge>)}</div> : <p className="text-xs text-muted-foreground">Modèle sans pôle prédéfini</p>}
          <div className="space-y-1">{objArray(row.tasks).slice(0, 5).map((task: TemplateTask, i) => <p key={i} className="text-sm">□ {task.title}<span className="text-xs text-muted-foreground"> {task.pole_id ? `· ${poleNames.get(task.pole_id) ?? task.pole_id}` : ""}{task.priority && task.priority !== "normale" ? ` · ${priorityLabel[task.priority] ?? task.priority}` : ""}{task.due_offset_days != null ? ` · J${task.due_offset_days >= 0 ? "+" : ""}${task.due_offset_days}` : ""}</span></p>)}</div>
          {objArray(row.tasks).length > 5 ? <p className="text-xs text-muted-foreground">+ {objArray(row.tasks).length - 5} autre(s)</p> : null}
          <div className="border-t pt-2"><p className="mb-1 text-xs font-semibold">Modèles de programme associés</p>{rowLinks.length ? <div className="flex flex-wrap gap-1">{rowLinks.map(name => <Badge key={name} variant="secondary">{name}</Badge>)}</div> : <p className="text-xs text-muted-foreground">Aucune association — utilisable indépendamment</p>}</div>
          <div className="flex flex-wrap gap-1">
            {canManage && !row.deleted ? <Button size="sm" variant="outline" onClick={async () => setDraft(await toDraft(row))}><Pencil className="mr-1 size-3"/>Modifier</Button> : null}
            {canManage && !row.deleted ? <Button size="sm" variant="outline" onClick={() => duplicate.mutate(row)}><Copy className="mr-1 size-3"/>Dupliquer</Button> : null}
            {canManage && !row.deleted ? <Button size="sm" variant="ghost" onClick={() => setLifecycle.mutate({row,action:row.archived ? "restore" : "archive"})}>{row.archived ? <ArchiveRestore className="mr-1 size-3"/> : <Archive className="mr-1 size-3"/>}{row.archived ? "Restaurer" : "Archiver"}</Button> : null}
            {canManage && !row.deleted ? <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setLifecycle.mutate({row,action:"trash"})}><Trash2 className="mr-1 size-3"/>Corbeille</Button> : null}
            {view === "trash" && canManage ? <Button size="sm" variant="outline" onClick={() => setLifecycle.mutate({row,action:"untrash"})}><RotateCcw className="mr-1 size-3"/>Restaurer</Button> : null}
            {view === "trash" && canManage ? <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (window.confirm("Supprimer définitivement ce modèle ? Cette action est irréversible.")) setLifecycle.mutate({row,action:"delete"}); }}><X className="mr-1 size-3"/>Supprimer définitivement</Button> : null}
          </div>
        </CardContent></Card>;
      })}</div>}
    <Dialog open={!!draft} onOpenChange={open => { if (!open) setDraft(null); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{draft?.id ? "Modifier le modèle de tâches" : "Créer un modèle de tâches"}</DialogTitle></DialogHeader>
        {draft ? <div className="space-y-4">
          <Field label="Nom du modèle"><Input value={draft.name} onChange={e => setDraft({...draft,name:e.target.value})} placeholder="Ex. Checklist communication d’un programme"/></Field>
          <Field label="Description (facultatif)"><Textarea value={draft.description} onChange={e => setDraft({...draft,description:e.target.value})} placeholder="À quoi sert ce modèle ?"/></Field>
          <Field label="Tâches et checklist"><Textarea rows={9} value={draft.taskText} onChange={e => setDraft({...draft,taskText:e.target.value})} placeholder={"Une tâche par ligne\nPréparer le visuel | Photo | haute | J-2\nRédiger la légende | Rédaction | normale | J-1"}/><p className="text-xs text-muted-foreground">Format : <b>Titre | Pôle | priorité | échéance relative</b>. Le pôle, la priorité et l’échéance sont facultatifs. Priorités : basse, normale, haute. Échéance : J-2, J+1, J0…</p></Field>
          <Field label="Pôles concernés (facultatif)"><div className="grid gap-2 sm:grid-cols-2">{(poles.data ?? []).filter(p => !p.archived).map(p => <label key={p.id} className="flex items-center gap-2 rounded-lg border p-2 text-sm"><input type="checkbox" checked={draft.poles.includes(p.id)} onChange={e => setDraft({...draft,poles:e.target.checked ? [...draft.poles,p.id] : draft.poles.filter(x=>x!==p.id)})}/>{p.name}</label>)}</div><p className="text-xs text-muted-foreground">Vous pouvez garder un modèle indépendant de tout pôle et de tout modèle de programme.</p></Field>
          <Field label="Associer à un ou plusieurs modèles de programme (facultatif)"><div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border p-3">{(programModels.data ?? []).filter(m => !m.archived && !m.deleted).map(m => <label key={m.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={draft.programModelIds.includes(m.id)} onChange={e => setDraft({...draft,programModelIds:e.target.checked ? [...draft.programModelIds,m.id] : draft.programModelIds.filter(x=>x!==m.id)})}/><span>{m.name}<span className="block text-xs text-muted-foreground">{m.program_type ?? "Type non précisé"} · {m.format ?? "Format non précisé"}</span></span></label>)}</div><p className="text-xs text-muted-foreground">L’association centralise le lien sans modifier automatiquement les modèles de programme ni les programmes déjà créés.</p></Field>
        </div> : null}
        <DialogFooter><Button variant="ghost" onClick={() => setDraft(null)}>Annuler</Button><Button disabled={save.isPending} onClick={() => draft && save.mutate(draft)}>{save.isPending ? "Enregistrement…" : "Enregistrer le modèle"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </AppShell>;
}
