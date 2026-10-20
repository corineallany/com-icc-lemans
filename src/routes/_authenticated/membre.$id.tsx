import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell, EmptyState } from "@/components/AppShell";
import { ImageCropper, cropStyle, DEFAULT_CROP, type ImageCrop } from "@/components/ImageCropper";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentRole } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { logAction, membersQuery, polesQuery } from "@/lib/icc";

export const Route = createFileRoute("/_authenticated/membre/$id")({ component: MemberPage });

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const ROLES = [
  { value: "equipier", label: "Équipier" },
  { value: "referent", label: "Référent" },
  { value: "formation", label: "En formation" },
];

type Draft = {
  first_name: string;
  last_name: string;
  base_role: string;
  login_email: string;
  photo_url: string;
  photo_crop: ImageCrop;
  affiliations: string;
  arrival_month: string;
  arrival_year: string;
  birthday_day: string;
  birthday_month: string;
  training_start: string;
  training_end_planned: string;
  training_end_effective: string;
  training_done: boolean;
  is_icc: boolean;
  is_ejp: boolean;
  inactive_note: string;
  poles: Record<string, { selected: boolean; referent: boolean }>;
};

const blank = (): Draft => ({
  first_name: "",
  last_name: "",
  base_role: "equipier",
  login_email: "",
  photo_url: "",
  photo_crop: DEFAULT_CROP,
  affiliations: "",
  arrival_month: "",
  arrival_year: "",
  birthday_day: "",
  birthday_month: "",
  training_start: "",
  training_end_planned: "",
  training_end_effective: "",
  training_done: false,
  is_icc: false,
  is_ejp: false,
  inactive_note: "",
  poles: {},
});

const initials = (n: string) => n.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1"><span className="text-xs font-semibold text-muted-foreground">{label}</span>{children}</label>;
}

function MemberPage() {
  const { id } = Route.useParams();
  const isNew = id === "nouveau";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin, member: actor } = useCurrentRole();
  const members = useQuery(membersQuery);
  const poles = useQuery(polesQuery);
  const row = isNew ? null : (members.data?.members ?? []).find((m) => m.id === id) as any;
  const links = (members.data?.links ?? []).filter((l) => l.member_id === id);
  const [editing, setEditing] = useState(isNew);
  const [draft, setDraft] = useState<Draft>(blank());
  const [uploading, setUploading] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusValue, setStatusValue] = useState<"active" | "inactive" | "archived">("active");
  const [statusReason, setStatusReason] = useState("");

  const poleNames = useMemo(() => new Map((poles.data ?? []).map((p) => [p.id, p.name])), [poles.data]);
  const activePoles = useMemo(() => (poles.data ?? []).filter((p) => !p.archived), [poles.data]);

  useEffect(() => {
    if (!row) return;
    const pm: Draft["poles"] = {};
    for (const l of links) pm[l.pole_id] = { selected: true, referent: l.is_referent };
    setDraft({
      first_name: row.first_name ?? "",
      last_name: row.last_name ?? "",
      base_role: row.training_start && !row.training_done ? "formation" : Object.values(pm).some((p) => p.referent) ? "referent" : "equipier",
      login_email: row.login_email ?? "",
      photo_url: row.photo_url ?? "",
      photo_crop: { ...DEFAULT_CROP, ...(row.photo_crop ?? {}) },
      affiliations: row.affiliations ?? "",
      arrival_month: row.arrival_month ? String(row.arrival_month) : "",
      arrival_year: row.arrival_year ? String(row.arrival_year) : "",
      birthday_day: row.birthday_day ? String(row.birthday_day) : "",
      birthday_month: row.birthday_month ? String(row.birthday_month) : "",
      training_start: row.training_start ?? "",
      training_end_planned: row.training_end_planned ?? "",
      training_end_effective: row.training_end_effective ?? "",
      training_done: !!row.training_done,
      is_icc: !!row.is_icc,
      is_ejp: !!row.is_ejp,
      inactive_note: row.inactive_note ?? "",
      poles: pm,
    });
  }, [row?.id, members.data?.links]);

  async function uploadPhoto(file: File) {
    if (!isAdmin) return;
    if (!file.type.startsWith("image/")) return void toast.error("Choisis un fichier image.");
    if (file.size > 5 * 1024 * 1024) return void toast.error("La photo ne doit pas dépasser 5 Mo.");
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${isNew ? "nouveaux" : id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("member-photos").upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from("member-photos").getPublicUrl(path);
      setDraft((c) => ({ ...c, photo_url: data.publicUrl, photo_crop: DEFAULT_CROP }));
      setCropOpen(true);
      toast.success("Photo ajoutée — ajuste maintenant son cadrage.");
    } catch (e: any) {
      toast.error("Impossible d'ajouter la photo", { description: e?.message });
    } finally {
      setUploading(false);
    }
  }

  function poleSnapshotFromDraft(isReferent: boolean) {
    return Object.entries(draft.poles)
      .filter(([, value]) => value.selected)
      .map(([pole_id, value]) => ({ pole_id, is_referent: isReferent ? value.referent : false }))
      .sort((a, b) => a.pole_id.localeCompare(b.pole_id));
  }

  const changeStatus = useMutation({
    mutationFn: async () => {
      if (!isAdmin || !row) throw Error("Action non autorisée.");
      const reason = statusReason.trim();
      const previousStatus = row.status as string;
      const payload: Record<string, unknown> = {
        status: statusValue,
        inactive_note: reason || (statusValue === "inactive" ? row.inactive_note || null : null),
      };
      const { error } = await (supabase as any).from("members").update(payload).eq("id", row.id);
      if (error) throw Error(error.message);
      await logAction({
        action: "member_status_changed",
        entity: "member",
        entityId: row.id,
        detail: `${row.full_name} · ${previousStatus} → ${statusValue}${reason ? ` · Motif : ${reason}` : ""}`,
        actorName: actor?.full_name,
      });
    },
    onSuccess: () => {
      toast.success(statusValue === "active" ? "Membre réactivé manuellement" : statusValue === "inactive" ? "Membre rendu inactif" : "Membre archivé");
      setStatusOpen(false);
      setStatusReason("");
      qc.setQueryData(["members"], (old: any) => old ? ({ ...old, members: (old.members ?? []).map((m: any) => m.id === row?.id ? { ...m, status: statusValue, inactive_note: statusReason.trim() || (statusValue === "inactive" ? m.inactive_note : null) } : m) }) : old);
      void qc.invalidateQueries({ queryKey: ["members"] });
      void qc.invalidateQueries({ queryKey: ["archives-members"] });
      void qc.invalidateQueries({ queryKey: ["programs"] });
      void qc.invalidateQueries({ queryKey: ["current-role"] });
    },
    onError: (e: Error) => toast.error("Changement de statut impossible", { description: e.message }),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw Error("Action non autorisée.");
      const full_name = `${draft.first_name.trim()} ${draft.last_name.trim()}`.trim();
      if (!full_name) throw Error("Le nom du membre est obligatoire.");

      const arrivalMonth = draft.arrival_month ? Number(draft.arrival_month) : null;
      const arrivalYear = draft.arrival_year ? Number(draft.arrival_year) : null;
      if (arrivalMonth !== null && (arrivalMonth < 1 || arrivalMonth > 12)) throw Error("Le mois d'intégration doit être compris entre 1 et 12.");
      if (arrivalYear !== null && (arrivalYear < 1900 || arrivalYear > 2100)) throw Error("L'année d'intégration n'est pas valide.");
      const birthdayDay = draft.birthday_day ? Number(draft.birthday_day) : null;
      const birthdayMonth = draft.birthday_month ? Number(draft.birthday_month) : null;
      if (birthdayDay !== null && (birthdayDay < 1 || birthdayDay > 31)) throw Error("Le jour d'anniversaire doit être compris entre 1 et 31.");
      if (birthdayMonth !== null && (birthdayMonth < 1 || birthdayMonth > 12)) throw Error("Le mois d'anniversaire doit être compris entre 1 et 12.");

      const memberId = isNew ? crypto.randomUUID() : id;
      const isFormation = draft.base_role === "formation";
      const wasFormation = !!row?.training_start && !row?.training_done;
      const leavingFormation = !isFormation && wasFormation;
      const isReferent = draft.base_role === "referent";
      if (isReferent && !Object.values(draft.poles).some((p) => p.selected && p.referent)) throw Error("Sélectionne au moins un pôle Référent.");

      const payload: any = {
        first_name: draft.first_name.trim() || null,
        last_name: draft.last_name.trim() || null,
        full_name,
        base_role: isReferent ? "referent" : "equipier",
        login_email: draft.login_email.trim() || null,
        photo_url: draft.photo_url || null,
        photo_crop: draft.photo_crop,
        affiliations: draft.affiliations.trim() || null,
        arrival_month: arrivalMonth,
        arrival_year: arrivalYear,
        birthday_day: birthdayDay,
        birthday_month: birthdayMonth,
        training_start: isFormation ? (draft.training_start || new Date().toISOString().slice(0, 10)) : leavingFormation ? null : (draft.training_start || null),
        training_end_planned: leavingFormation ? null : (draft.training_end_planned || null),
        training_end_effective: leavingFormation ? null : (draft.training_end_effective || null),
        training_done: isFormation ? false : leavingFormation ? false : draft.training_done,
        is_icc: draft.is_icc,
        is_ejp: draft.is_ejp,
      };

      const w: any = supabase.from("members");
      const res = isNew ? await w.insert({ id: memberId, ...payload, status: "active" }) : await w.update(payload).eq("id", memberId);
      if (res.error) throw Error(res.error.message);

      const desiredPoles = poleSnapshotFromDraft(isReferent);
      const existingPoles = links
        .map((l) => ({ pole_id: l.pole_id, is_referent: !!l.is_referent }))
        .sort((a, b) => a.pole_id.localeCompare(b.pole_id));
      const polesChanged = isNew || JSON.stringify(desiredPoles) !== JSON.stringify(existingPoles);

      // Important: do not delete/reinsert member_poles when only profile information changed.
      // This prevents an unrelated RLS failure after the member row has already been saved.
      if (polesChanged) {
        const { error: delError } = await supabase.from("member_poles").delete().eq("member_id", memberId);
        if (delError) throw new Error(`La fiche a été enregistrée, mais les rattachements aux pôles n'ont pas pu être modifiés : ${delError.message}`);
        if (desiredPoles.length) {
          const rowsToInsert = desiredPoles.map((p) => ({ member_id: memberId, pole_id: p.pole_id, is_referent: p.is_referent }));
          const x = await supabase.from("member_poles").insert(rowsToInsert);
          if (x.error) throw Error(`La fiche a été enregistrée, mais les rattachements aux pôles n'ont pas pu être finalisés : ${x.error.message}`);
        }
      }

      await logAction({ action: isNew ? "membre_cree" : "membre_modifie", entity: "member", entityId: memberId, detail: full_name, actorName: actor?.full_name });
      return memberId;
    },
    onSuccess: async (mid) => {
      toast.success("Fiche membre enregistrée");
      await qc.invalidateQueries({ queryKey: ["members"] });
      if (isNew) navigate({ to: "/membre/$id", params: { id: mid } });
      else setEditing(false);
    },
    onError: (e: Error) => toast.error("Enregistrement incomplet", { description: e.message }),
  });

  if (!isNew && members.isLoading) return <AppShell title="Fiche membre">Chargement…</AppShell>;
  if (!isNew && !row) return <AppShell title="Fiche membre"><EmptyState title="Membre introuvable" /></AppShell>;
  if (isNew && !isAdmin) return <AppShell title="Nouveau membre"><EmptyState title="Accès réservé" /></AppShell>;

  const memberPoles = links.map((l) => ({ ...l, name: poleNames.get(l.pole_id) ?? "Pôle" }));
  const refs = memberPoles.filter((p) => p.is_referent);
  const arrivalLabel = row?.arrival_year ? `${row.arrival_month ? `${MONTHS[row.arrival_month - 1]} ` : ""}${row.arrival_year}` : "—";

  return <AppShell
    title={isNew ? "Nouveau membre" : row.full_name}
    subtitle={isNew ? "Créer une fiche membre" : "Fiche membre"}
    actions={!isNew && isAdmin ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>{editing ? "Fermer la modification" : "Modifier"}</Button><Button size="sm" variant="secondary" onClick={() => { setStatusValue(row.status ?? "active"); setStatusReason(""); setStatusOpen(true); }}>Gérer le statut</Button></div> : undefined}
  >
    {!editing && row ? <div className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap gap-4">
        <Avatar className="size-24">
          {row.photo_url ? <AvatarImage src={row.photo_url} className="object-cover" style={cropStyle(row.photo_crop)} /> : null}
          <AvatarFallback>{initials(row.full_name)}</AvatarFallback>
        </Avatar>
        <div>
          <h2 className="text-xl font-black text-icc-violet">{row.full_name}</h2>
          <div className="mt-2 flex flex-wrap gap-1">
            {row.status ? <Badge variant={row.status === "active" ? "default" : "secondary"}>{row.status === "active" ? "Actif" : row.status === "inactive" ? "Inactif" : "Archivé"}</Badge> : null}
            {refs.length ? <><Badge variant="outline">🏅 Référent</Badge><b className="text-sm">{refs.map((p) => p.name).join(" · ")}</b></> : null}
            {row.is_icc ? <Badge>ICC</Badge> : null}
            {row.is_ejp ? <Badge>EJP</Badge> : null}
          </div>
          {row.login_email ? <p className="mt-2 text-sm text-muted-foreground">{row.login_email}</p> : null}
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-muted/40 p-3"><small>Pôles</small><p className="font-semibold">{memberPoles.map((p) => p.name).join(" · ") || "—"}</p></div>
        <div className="rounded-xl bg-muted/40 p-3"><small>Date d'intégration</small><p className="font-semibold">{arrivalLabel}</p></div>
        <div className="rounded-xl bg-muted/40 p-3"><small>Anniversaire</small><p className="font-semibold">{row.birthday_day && row.birthday_month ? `${row.birthday_day} ${MONTHS[row.birthday_month - 1]}` : "—"}</p></div>
      </div>
    </div> : <div className="space-y-5 rounded-2xl border bg-card p-5">
      <div className="rounded-xl border border-dashed p-4">
        <p className="mb-3 text-xs font-semibold text-muted-foreground">Photo du membre</p>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar className="size-24">
            {draft.photo_url ? <AvatarImage src={draft.photo_url} className="object-cover" style={cropStyle(draft.photo_crop)} /> : null}
            <AvatarFallback>{initials(`${draft.first_name} ${draft.last_name}`.trim() || "Membre")}</AvatarFallback>
          </Avatar>
          <div>
            <Input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.currentTarget.value = ""; }} />
            <div className="mt-2 flex gap-2">
              {draft.photo_url ? <Button type="button" size="sm" variant="outline" onClick={() => setCropOpen(true)}>Ajuster le cadrage</Button> : null}
              {draft.photo_url ? <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ ...draft, photo_url: "", photo_crop: DEFAULT_CROP })}>Retirer</Button> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Prénom"><Input value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} /></Field>
        <Field label="Nom"><Input value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} /></Field>
        <Field label="Rôle"><Select value={draft.base_role} onValueChange={(v) => setDraft({ ...draft, base_role: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="E-mail"><Input type="email" value={draft.login_email} onChange={(e) => setDraft({ ...draft, login_email: e.target.value })} /></Field>
      </div>

      <div className="rounded-xl border p-4">
        <h3 className="mb-3 font-black text-icc-violet">Intégration</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mois d'intégration"><Select value={draft.arrival_month || "none"} onValueChange={(v) => setDraft({ ...draft, arrival_month: v === "none" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Non renseigné</SelectItem>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Année d'intégration"><Input type="number" min="1900" max="2100" placeholder="Ex. 2024" value={draft.arrival_year} onChange={(e) => setDraft({ ...draft, arrival_year: e.target.value })} /></Field>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Anniversaire - jour"><Input type="number" min="1" max="31" value={draft.birthday_day} onChange={(e) => setDraft({ ...draft, birthday_day: e.target.value })} /></Field>
        <Field label="Anniversaire - mois"><Select value={draft.birthday_month || "none"} onValueChange={(v) => setDraft({ ...draft, birthday_month: v === "none" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Non renseigné</SelectItem>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent></Select></Field>
      </div>

      <Field label="Informations"><Textarea value={draft.affiliations} onChange={(e) => setDraft({ ...draft, affiliations: e.target.value })} /></Field>
      <div className="flex gap-4">
        <label className="flex items-center gap-2"><Checkbox checked={draft.is_icc} onCheckedChange={(v) => setDraft({ ...draft, is_icc: v === true })} /> ICC</label>
        <label className="flex items-center gap-2"><Checkbox checked={draft.is_ejp} onCheckedChange={(v) => setDraft({ ...draft, is_ejp: v === true })} /> EJP</label>
      </div>

      <div>
        <h3 className="mb-2 font-black text-icc-violet">Pôles et responsabilités</h3>
        {activePoles.map((p) => {
          const s = draft.poles[p.id] ?? { selected: false, referent: false };
          return <div key={p.id} className="mb-2 flex items-center justify-between rounded-xl border p-3">
            <label className="flex items-center gap-2"><Checkbox checked={s.selected} onCheckedChange={(v) => setDraft({ ...draft, poles: { ...draft.poles, [p.id]: { selected: v === true, referent: v === true ? s.referent : false } } })} /> {p.name}</label>
            <Button type="button" size="sm" variant={s.referent ? "default" : "outline"} disabled={!s.selected || draft.base_role !== "referent"} onClick={() => setDraft({ ...draft, poles: { ...draft.poles, [p.id]: { selected: true, referent: !s.referent } } })}>Référent</Button>
          </div>;
        })}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => isNew ? navigate({ to: "/trombinoscope" }) : setEditing(false)}>Annuler</Button>
        <Button disabled={save.isPending || uploading} onClick={() => save.mutate()}>Enregistrer</Button>
      </div>
    </div>}

    <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Gérer le statut de {row?.full_name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Les indisponibilités datées restent gérées séparément. Un membre inactif ne sera jamais réactivé automatiquement : seule une action manuelle peut le rendre actif.</p>
          <Field label="Statut du membre">
            <Select value={statusValue} onValueChange={(v) => setStatusValue(v as "active" | "inactive" | "archived")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Actif</SelectItem>
                <SelectItem value="inactive">Inactif</SelectItem>
                <SelectItem value="archived">Archivé</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="rounded-lg bg-muted/40 p-3 text-sm">
            {statusValue === "active" ? "Le membre est dans l’effectif actif et peut être mobilisé selon ses disponibilités." : statusValue === "inactive" ? "Le membre reste dans la COM, mais il est exclu des nouvelles propositions et affectations jusqu’à sa réactivation manuelle." : "Le membre sort de la gestion courante. Sa fiche et son historique sont conservés dans les archives."}
          </div>
          <Field label="Motif / précision (facultatif)">
            <Textarea rows={3} value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder="Ex. déménagement, suspension, situation temporaire sans date de fin…"/>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setStatusOpen(false)}>Annuler</Button>
          <Button disabled={changeStatus.isPending || (statusValue === row?.status && !statusReason.trim())} onClick={() => changeStatus.mutate()}>{changeStatus.isPending ? "Enregistrement…" : "Confirmer le statut"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {draft.photo_url ? <ImageCropper open={cropOpen} onOpenChange={setCropOpen} src={draft.photo_url} value={draft.photo_crop} aspect="1 / 1" title="Ajuster la photo du trombinoscope" onSave={(photo_crop) => setDraft({ ...draft, photo_crop })} /> : null}
  </AppShell>;
}
