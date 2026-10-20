import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useCurrentRole } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/priere")({
  head: () => ({ meta: [{ title: "Prière — COM ICC Le Mans" }] }),
  component: PrayerPage,
});
const db = () => supabase as any;
const CATEGORIES: Record<string, string> = {
  personnel: "Vie personnelle", professionnel: "Vie professionnelle", vie_de_groupe: "Vie de la COM",
  famille: "Famille", sante: "Santé", spirituel: "Vie spirituelle", autre: "Autre",
};
const today = () => new Date().toISOString().slice(0, 10);
function escapeExportCell(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function exportExcel(filename: string, sheets: { title: string; rows: unknown[][] }[]) {
  const xml = '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    sheets.map(sheet => '<Worksheet ss:Name="' + escapeExportCell(sheet.title.slice(0,31)) + '"><Table>' +
      sheet.rows.map((row,i) => '<Row>' + row.map(cell => '<Cell' + (i===0 ? ' ss:StyleID="header"' : '') + '><Data ss:Type="String">' + escapeExportCell(cell) + '</Data></Cell>').join("") + '</Row>').join("") +
      '</Table></Worksheet>').join("") + '</Workbook>';
  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename + ".xls"; a.click(); URL.revokeObjectURL(url);
}
function exportPdf(title: string, rows: { heading: string; entries: string[][] }[]) {
  const body = rows.map(section => '<h2>' + escapeExportCell(section.heading) + '</h2><table><tr><th>Information</th><th>Détail</th></tr>' +
    section.entries.map(entry => '<tr><td>' + escapeExportCell(entry[0]) + '</td><td>' + escapeExportCell(entry[1]).replace(/\n/g, '<br>') + '</td></tr>').join("") + '</table>').join("");
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>' + escapeExportCell(title) + '</title><style>body{font:12px Arial;margin:24px;color:#222}h1{color:#49336d}h2{margin-top:24px;border-bottom:1px solid #bbb}table{width:100%;border-collapse:collapse;margin:10px 0 18px}td,th{border:1px solid #ccc;padding:7px;text-align:left;vertical-align:top}th{background:#eee}@media print{body{margin:12mm}tr{break-inside:avoid}}</style></head><body><h1>' + escapeExportCell(title) + '</h1><p>Édité le ' + new Date().toLocaleString("fr-FR") + '</p>' + body + '<script>window.onload=function(){window.print()}</script></body></html>';
  const win = window.open("", "_blank"); if (!win) { toast.error("Autorisez les fenêtres contextuelles pour exporter en PDF."); return; } win.document.write(html); win.document.close();
}

type SlotDraft = { date: string; start: string; end: string; conductors: string[]; attendanceManagers: string[] };
function PrayerPage() {
  const { role, isTechAdmin, member } = useCurrentRole();
  const canManage = role === "responsable" || isTechAdmin;
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("autre");
  const [description, setDescription] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [programTitle, setProgramTitle] = useState("");
  const [programDescription, setProgramDescription] = useState("");
  const [programDate, setProgramDate] = useState(today());
  const [slots, setSlots] = useState<SlotDraft[]>([{ date: today(), start: "19:00", end: "20:00", conductors: [], attendanceManagers: [] }]);
  const [selectedProgram, setSelectedProgram] = useState<any>(null);
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const [attendanceDraft, setAttendanceDraft] = useState<Record<string, { status: string; reason: string; observation: string }>>({});
  const [prayerTab, setPrayerTab] = useState<"deposer" | "creer" | "temps" | "sujets">("deposer");

  const subjects = useQuery({
    queryKey: ["prayer-subjects"],
    enabled: !!member?.id,
    queryFn: async () => {
      const source = canManage ? "prayer_subjects" : "prayer_subjects_public";
      let query = db().from(source).select("*");
      if (canManage) query = query.is("archived_at", null).is("deleted_at", null);
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const programs = useQuery({
    queryKey: ["prayer-programs"],
    enabled: !!member?.id,
    queryFn: async () => {
      const { data, error } = await db().from("prayer_programs").select("*").is("archived_at", null).is("deleted_at", null).order("program_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const members = useQuery({
    queryKey: ["prayer-members"],
    queryFn: async () => {
      const { data, error } = await db().from("members").select("id,full_name,status,deleted").eq("deleted", false).order("full_name");
      if (error) throw error;
      return (data ?? []).filter((m: any) => m.status === "active" || m.status === "training" || !m.status);
    },
  });
  const programSlots = useQuery({
    queryKey: ["prayer-program-slots", selectedProgram?.id],
    enabled: !!selectedProgram?.id,
    queryFn: async () => {
      const { data, error } = await db().from("prayer_program_slots").select("*").eq("program_id", selectedProgram.id).order("position");
      if (error) throw error;
      return data ?? [];
    },
  });
  const attendance = useQuery({
    queryKey: ["prayer-attendance", selectedProgram?.id, selectedSlot?.id],
    enabled: !!selectedSlot?.id,
    queryFn: async () => {
      const { data, error } = await db().from("prayer_program_attendance").select("*").eq("slot_id", selectedSlot.id);
      if (error) throw error;
      return data ?? [];
    },
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["prayer-subjects"] }),
      qc.invalidateQueries({ queryKey: ["prayer-programs"] }),
      qc.invalidateQueries({ queryKey: ["prayer-program-slots"] }),
      qc.invalidateQueries({ queryKey: ["prayer-attendance"] }),
    ]);
  };
  const submitSubject = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Ajoutez un titre au sujet de prière.");
      if (!description.trim()) throw new Error("Décrivez le sujet pour aider l’équipe à prier.");
      if (!anonymous && !displayName.trim()) throw new Error("Indiquez le nom à afficher ou cochez l’anonymat.");
      const { error } = await db().from("prayer_subjects").insert({
        title: title.trim(), category, description: description.trim(),
        is_anonymous: anonymous, display_name: anonymous ? null : displayName.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle(""); setCategory("autre"); setDescription(""); setAnonymous(true); setDisplayName("");
      toast.success("Sujet de prière déposé. Merci pour ta confiance.");
      if (canManage) refresh();
    },
    onError: (e: any) => toast.error(e.message ?? "Impossible d’enregistrer le sujet."),
  });
  const createProgram = useMutation({
    mutationFn: async () => {
      if (!programTitle.trim()) throw new Error("Le thème du programme de prière est obligatoire.");
      if (!programDate) throw new Error("Choisissez la date du programme.");
      if (!slots.length || slots.some(s => !s.date || !s.start || !s.end || s.end <= s.start)) {
        throw new Error("Chaque créneau doit avoir une date, une heure de début et une heure de fin valides.");
      }
      if (slots.some(s => s.conductors.length > 2)) throw new Error("Deux conducteurs maximum par créneau.");
      const { data, error } = await db().from("prayer_programs").insert({
        title: programTitle.trim(), description: programDescription.trim() || null, program_date: programDate,
      }).select("id").single();
      if (error) throw error;
      const { error: slotError } = await db().from("prayer_program_slots").insert(
        slots.map((s, i) => ({ program_id: data.id, slot_date: s.date, start_time: s.start, end_time: s.end, conductor_member_ids: s.conductors, attendance_manager_member_ids: s.attendanceManagers, position: i })),
      );
      if (slotError) throw slotError;
      return data.id;
    },
    onSuccess: async (id: string) => {
      setProgramTitle(""); setProgramDescription(""); setProgramDate(today());
      setSlots([{ date: today(), start: "19:00", end: "20:00", conductors: [], attendanceManagers: [] }]);
      await refresh();
      const created = (await db().from("prayer_programs").select("*").eq("id", id).single()).data;
      if (created) setSelectedProgram(created);
      toast.success("Programme de prière créé.");
    },
    onError: (e: any) => toast.error(e.message ?? "Impossible de créer le programme."),
  });
  const saveAttendance = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error("Choisissez un créneau.");
      if (!canManage && !(selectedSlot.attendance_manager_member_ids ?? []).includes(member?.id)) throw new Error("Vous n’êtes pas désigné(e) pour renseigner les présences de ce créneau.");
      const rows = (members.data ?? []).map((m: any) => {
        const d = attendanceDraft[m.id] ?? (attendance.data ?? []).find((a: any) => a.member_id === m.id) ?? {};
        if (!d.status) return null;
        return {
          slot_id: selectedSlot.id, member_id: m.id, attendance_status: d.status,
          absence_reason: d.status === "absent" ? (d.reason?.trim() || null) : null,
          observation: d.observation?.trim() || null,
        };
      }).filter(Boolean);
      if (!rows.length) throw new Error("Renseignez au moins une présence.");
      const { error } = await db().from("prayer_program_attendance").upsert(rows, { onConflict: "slot_id,member_id" });
      if (error) throw error;
    },
    onSuccess: async () => { await refresh(); toast.success("Feuille de présence enregistrée."); },
    onError: (e: any) => toast.error(e.message ?? "Impossible d’enregistrer les présences."),
  });
  const archivePrayer = useMutation({
    mutationFn: async ({ kind, id, destination }: { kind: "subject" | "program"; id: string; destination: "archived" | "deleted" | "active" }) => {
      if (!canManage) throw new Error("Seuls le responsable et l’admin technique peuvent archiver ces éléments.");
      const rpc = kind === "subject" ? "prayer_archive_subject" : "prayer_archive_program";
      const { error } = await db().rpc(rpc, { p_id: id, p_destination: destination });
      if (error) throw error;
    },
    onSuccess: async () => { await refresh(); toast.success("Élément archivé."); },
    onError: (e: any) => toast.error(e.message ?? "Impossible d’archiver cet élément."),
  });
  const memberName = new Map((members.data ?? []).map((m: any) => [m.id, m.full_name]));
  const canEditSelectedAttendance = canManage || (!!member?.id && (selectedSlot?.attendance_manager_member_ids ?? []).includes(member.id));
  const savedAttendance = attendance.data ?? [];
  const statusOf = (memberId: string) => attendanceDraft[memberId]?.status ?? savedAttendance.find((a: any) => a.member_id === memberId)?.attendance_status ?? "";
  const reasonOf = (memberId: string) => attendanceDraft[memberId]?.reason ?? savedAttendance.find((a: any) => a.member_id === memberId)?.absence_reason ?? "";
  const observationOf = (memberId: string) => attendanceDraft[memberId]?.observation ?? savedAttendance.find((a: any) => a.member_id === memberId)?.observation ?? "";
  const patchAttendance = (memberId: string, key: string, value: string) => setAttendanceDraft(prev => ({ ...prev, [memberId]: { status: prev[memberId]?.status ?? statusOf(memberId), reason: prev[memberId]?.reason ?? reasonOf(memberId), observation: prev[memberId]?.observation ?? observationOf(memberId), [key]: value } }));
  return (
    <AppShell title="Vie d’équipe" subtitle="Deux espaces distincts : COM’Frat et Prière.">
      <div className="mb-6 grid grid-cols-2 gap-3">
        <Link to="/vie-equipe" className="flex min-h-16 items-center justify-center rounded-xl border-2 border-muted bg-background px-3 py-4 text-center font-bold hover:border-icc-violet">COM’Frat</Link>
        <Link to="/priere" aria-current="page" className="flex min-h-16 items-center justify-center rounded-xl border-2 border-icc-violet bg-icc-violet px-3 py-4 text-center font-bold text-white">Prière</Link>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button variant={prayerTab === "deposer" ? "default" : "outline"} className="min-h-12 whitespace-normal" onClick={() => setPrayerTab("deposer")}>Déposer un sujet</Button>
        <Button variant={prayerTab === "creer" ? "default" : "outline"} className="min-h-12 whitespace-normal" onClick={() => setPrayerTab("creer")}>Programmes de prière</Button>
        <Button variant={prayerTab === "temps" ? "default" : "outline"} className="min-h-12 whitespace-normal" onClick={() => setPrayerTab("temps")}>Temps de prière</Button>
        <Button variant={prayerTab === "sujets" ? "default" : "outline"} className="min-h-12 whitespace-normal" onClick={() => setPrayerTab("sujets")}>Sujets de prière</Button>
      </div>
      {prayerTab === "deposer" ? <Card id="deposer-sujet" className="mb-6">
        <CardHeader><CardTitle>Corbeille à sujets de prière</CardTitle><p className="text-sm text-muted-foreground">Le sujet est transmis à la responsable et à l’administrateur technique. Tu peux le déposer sans indiquer ton identité.</p></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Titre du sujet"><Input maxLength={180} value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex. : Orientation professionnelle" /></Field>
            <Field label="Thème"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={category} onChange={e => setCategory(e.target.value)}>{Object.entries(CATEGORIES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          <Field label="Description du sujet"><Textarea rows={6} value={description} onChange={e => setDescription(e.target.value)} placeholder="Décris ce pour quoi tu aimerais que nous priions, avec les détails que tu souhaites partager." /></Field>
          <div className="rounded-lg border p-3">
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={anonymous} onChange={e => { setAnonymous(e.target.checked); if (e.target.checked) setDisplayName(""); }} className="mt-1" /><span><b>Déposer anonymement</b><span className="mt-1 block text-muted-foreground">Aucun nom ni identifiant de compte ne sera enregistré dans le sujet. La responsable verra le contenu, mais pas l’identité de l’auteur à partir de cet enregistrement.</span></span></label>
            {!anonymous ? <div className="mt-3"><Field label="Nom à afficher"><Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Prénom et nom" /></Field></div> : null}
          </div>
          <Button onClick={() => submitSubject.mutate()} disabled={submitSubject.isPending}>{submitSubject.isPending ? "Enregistrement…" : "Déposer le sujet de prière"}</Button>
        </CardContent>
      </Card> : null}

      {true ? <>
        <section id="programmes-priere" className="space-y-5">
          {prayerTab === "creer" ? <div><h2 className="text-xl font-black text-icc-violet">Programmes de prière</h2><p className="text-sm text-muted-foreground">Ces rencontres sont indépendantes du planning opérationnel.</p></div> : null}
          {canManage && prayerTab === "creer" ? <Card>
            <CardHeader><CardTitle>Créer un programme de prière</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Thème / titre"><Input value={programTitle} onChange={e => setProgramTitle(e.target.value)} placeholder="Ex. : Prière pour la COM et les projets à venir" /></Field>
              <Field label="Description détaillée (facultative)"><Textarea rows={5} value={programDescription} onChange={e => setProgramDescription(e.target.value)} placeholder="Intentions, objectifs et déroulé souhaité…" /></Field>
              <Field label="Date de référence"><Input type="date" value={programDate} onChange={e => setProgramDate(e.target.value)} /></Field>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2"><h3 className="font-bold">Créneaux et conducteurs</h3><Button type="button" variant="outline" size="sm" onClick={() => setSlots(s => [...s, { date: programDate || today(), start: "19:00", end: "20:00", conductors: [], attendanceManagers: [] }])}>+ Ajouter un créneau</Button></div>
                {slots.map((s, i) => <div key={i} className="space-y-3 rounded-xl border p-3">
                  <div className="flex items-center justify-between"><b>Créneau {i + 1}</b>{slots.length > 1 ? <Button variant="ghost" size="sm" onClick={() => setSlots(x => x.filter((_, j) => j !== i))}>Retirer</Button> : null}</div>
                  <div className="grid gap-3 sm:grid-cols-3"><Field label="Date"><Input type="date" value={s.date} onChange={e => setSlots(x => x.map((z,j) => j===i ? {...z,date:e.target.value}:z))}/></Field><Field label="Heure de début"><Input type="time" value={s.start} onChange={e => setSlots(x => x.map((z,j) => j===i ? {...z,start:e.target.value}:z))}/></Field><Field label="Heure de fin"><Input type="time" value={s.end} onChange={e => setSlots(x => x.map((z,j) => j===i ? {...z,end:e.target.value}:z))}/></Field></div>
                  <p className="text-sm font-semibold">Conducteurs (maximum 2, toute la COM)</p>
                  <div className="grid gap-2 sm:grid-cols-2">{(members.data ?? []).map((m:any) => <label key={m.id} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={s.conductors.includes(m.id)} disabled={!s.conductors.includes(m.id) && s.conductors.length >= 2} onChange={e => setSlots(x => x.map((z,j) => j!==i ? z : {...z,conductors:e.target.checked ? [...z.conductors,m.id] : z.conductors.filter(id => id!==m.id)}))}/>{m.full_name}</label>)}</div>
                <div className="rounded-lg bg-muted/50 p-3"><p className="mb-2 text-sm font-semibold">Personne(s) autorisée(s) à saisir les présences (sans accès aux sujets de prière)</p><div className="grid gap-2 sm:grid-cols-2">{(members.data ?? []).map((m:any) => <label key={m.id} className="flex items-center gap-2 rounded-md border bg-background p-2 text-sm"><input type="checkbox" checked={s.attendanceManagers.includes(m.id)} onChange={e => setSlots(x => x.map((z,j) => j!==i ? z : {...z,attendanceManagers:e.target.checked ? [...z.attendanceManagers,m.id] : z.attendanceManagers.filter(id => id!==m.id)}))}/>{m.full_name}</label>)}</div></div>
                </div>)}
              </div>
              <Button onClick={() => createProgram.mutate()} disabled={createProgram.isPending}>{createProgram.isPending ? "Création…" : "Enregistrer le programme de prière"}</Button>
            </CardContent>
          </Card> : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {prayerTab === "sujets" ? <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Sujets de prière enregistrés ({(subjects.data ?? []).length})</CardTitle><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => exportExcel("corbeille-sujets-priere", [{title:"Sujets",rows:[["Date","Titre","Catégorie","Anonymat","Nom affiché","Description","Statut"],...(subjects.data ?? []).map((s:any)=>[new Date(s.created_at).toLocaleString("fr-FR"),s.title,CATEGORIES[s.category]??s.category,s.is_anonymous?"Oui":"Non",s.is_anonymous?"":s.display_name,s.description,s.status])]}])}>Exporter Excel</Button><Button size="sm" variant="outline" onClick={() => exportPdf("Corbeille à sujets de prière", [{heading:"Sujets déposés",entries:(subjects.data ?? []).map((s:any)=>[s.title,"Date : "+new Date(s.created_at).toLocaleString("fr-FR")+" | Catégorie : "+(CATEGORIES[s.category]??s.category)+" | Auteur : "+(s.is_anonymous?"Anonyme":s.display_name)+" | Statut : "+s.status+" | "+s.description])}])}>Exporter PDF</Button></div></div></CardHeader><CardContent className="space-y-3">
              {subjects.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : (subjects.data ?? []).length ? (subjects.data ?? []).map((s:any) => <article key={s.id} className="rounded-xl border p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><Badge>{CATEGORIES[s.category] ?? "Autre"}</Badge><h3 className="mt-2 font-bold">{s.title}</h3><p className="text-xs text-muted-foreground">{canManage ? (s.is_anonymous ? "Anonyme" : (s.display_name || "Identité non renseignée")) : "Sujet partagé par un membre"} · {new Date(s.created_at).toLocaleDateString("fr-FR")}</p></div>{canManage ? <Button size="sm" variant="outline" onClick={() => archivePrayer.mutate({kind:"subject",id:s.id,destination:"archived"})}>Archiver</Button> : null}</div><p className="mt-3 whitespace-pre-wrap text-sm">{s.description}</p></article>) : <EmptyState title="Aucun sujet pour le moment"/>}
            </CardContent></Card> : null}
            {prayerTab === "temps" || prayerTab === "creer" ? <Card><CardHeader><CardTitle>Temps de prière enregistrés ({(programs.data ?? []).length})</CardTitle></CardHeader><CardContent className="space-y-2">
              {(programs.data ?? []).length ? (programs.data ?? []).map((p:any) => <div key={p.id} className={"rounded-lg border p-3 "+(selectedProgram?.id===p.id?"border-icc-violet bg-icc-violet/5":"")}><button onClick={() => {setSelectedProgram(p);setSelectedSlot(null);setAttendanceDraft({});}} className="w-full text-left"><b>{p.title}</b><span className="block text-sm text-muted-foreground">{new Date(p.program_date+"T12:00:00").toLocaleDateString("fr-FR")} · {p.status==="termine"?"Terminé":p.status==="annule"?"Annulé":"Planifié"}</span>{p.description ? <span className="mt-1 block text-sm">{p.description}</span> : null}</button>{canManage ? <Button size="sm" variant="outline" className="mt-2" onClick={() => archivePrayer.mutate({kind:"program",id:p.id,destination:"archived"})}>Archiver ce temps de prière</Button> : null}</div>) : <EmptyState title="Aucun programme de prière créé"/>}
            </CardContent></Card> : null}
          </div>
          {(prayerTab === "temps" || prayerTab === "creer") && selectedProgram ? <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Feuille de présence — {selectedProgram.title}</CardTitle><p className="text-sm text-muted-foreground">Choisissez un créneau, puis renseignez les présences.</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={async()=>{const {data:ss,error:se}=await db().from("prayer_program_slots").select("*").eq("program_id",selectedProgram.id).order("position");if(se){toast.error(se.message);return;}const ids=(ss??[]).map((x:any)=>x.id);const {data:aa,error:ae}=ids.length?await db().from("prayer_program_attendance").select("*").in("slot_id",ids):{data:[],error:null};if(ae){toast.error(ae.message);return;}exportExcel("rapport-priere-"+selectedProgram.program_date,[{title:"Programme",rows:[["Thème","Date","Description"],[selectedProgram.title,selectedProgram.program_date,selectedProgram.description??""]]},{title:"Présences",rows:[["Date","Début","Fin","Conducteurs","Membre","Statut","Motif d’absence","Observation"],...(ss??[]).flatMap((sl:any)=>(aa??[]).filter((a:any)=>a.slot_id===sl.id).map((a:any)=>[sl.slot_date,sl.start_time,sl.end_time,(sl.conductor_member_ids??[]).map((id:string)=>memberName.get(id)??id).join(", "),memberName.get(a.member_id)??a.member_id,a.attendance_status,a.absence_reason??"",a.observation??""]))]}]);}}>Exporter Excel</Button><Button size="sm" variant="outline" onClick={async()=>{const {data:ss,error:se}=await db().from("prayer_program_slots").select("*").eq("program_id",selectedProgram.id).order("position");if(se){toast.error(se.message);return;}const ids=(ss??[]).map((x:any)=>x.id);const {data:aa,error:ae}=ids.length?await db().from("prayer_program_attendance").select("*").in("slot_id",ids):{data:[],error:null};if(ae){toast.error(ae.message);return;}exportPdf("Rapport du programme de prière : "+selectedProgram.title,[{heading:"Informations du programme",entries:[["Thème",selectedProgram.title],["Date de référence",selectedProgram.program_date],["Description",selectedProgram.description??""]]},...(ss??[]).map((sl:any)=>({heading:"Créneau du "+sl.slot_date+" ("+sl.start_time+"–"+sl.end_time+")",entries:[["Conducteurs",(sl.conductor_member_ids??[]).map((id:string)=>memberName.get(id)??id).join(", ")||"Non renseignés"],...(aa??[]).filter((a:any)=>a.slot_id===sl.id).map((a:any)=>[memberName.get(a.member_id)??a.member_id,(a.attendance_status==="present"?"Présent(e)":a.attendance_status==="absent"?"Absent(e)":"Présence partielle")+" | Motif : "+(a.absence_reason??"—")+" | Observation : "+(a.observation??"—")])] }))]);}}>Exporter PDF</Button></div></div></CardHeader><CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">{(programSlots.data ?? []).map((s:any) => <Button key={s.id} variant={selectedSlot?.id===s.id?"default":"outline"} size="sm" onClick={() => {setSelectedSlot(s);setAttendanceDraft({});}}>{new Date(s.slot_date+"T12:00:00").toLocaleDateString("fr-FR")} · {s.start_time}–{s.end_time}</Button>)}</div>
            {selectedSlot ? <>
              <div className="rounded-lg bg-muted p-3 text-sm"><b>Conducteurs :</b> {(selectedSlot.conductor_member_ids ?? []).map((id:string) => memberName.get(id) ?? id).join(", ") || "À définir"}</div>
              <div className="grid gap-3">{(members.data ?? []).map((m:any) => <div key={m.id} className="rounded-lg border p-3"><div className="font-semibold">{m.full_name}</div><div className="mt-2 grid gap-2 sm:grid-cols-3"><Field label="Présence"><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={statusOf(m.id)} disabled={!canEditSelectedAttendance} onChange={e => patchAttendance(m.id,"status",e.target.value)}><option value="">À renseigner</option><option value="present">Présent(e)</option><option value="absent">Absent(e)</option><option value="partiel">Présence partielle</option></select></Field>{statusOf(m.id)==="absent" ? <Field label="Motif d’absence"><Input value={reasonOf(m.id)} disabled={!canEditSelectedAttendance} onChange={e => patchAttendance(m.id,"reason",e.target.value)} placeholder="Motif, si communiqué"/></Field> : null}<Field label="Observation"><Input value={observationOf(m.id)} disabled={!canEditSelectedAttendance} onChange={e => patchAttendance(m.id,"observation",e.target.value)} placeholder="Ex. : arrivé(e) à mi-parcours"/></Field></div></div>)}</div>
              <Button onClick={() => saveAttendance.mutate()} disabled={saveAttendance.isPending || !canEditSelectedAttendance}>{saveAttendance.isPending?"Enregistrement…":"Enregistrer les présences et le rapport"}</Button>
              <div className="rounded-xl border p-3"><h3 className="font-bold">Synthèse du créneau</h3><p className="mt-1 text-sm">Présents : {savedAttendance.filter((a:any)=>a.attendance_status==="present").length} · Absents : {savedAttendance.filter((a:any)=>a.attendance_status==="absent").length} · Présences partielles : {savedAttendance.filter((a:any)=>a.attendance_status==="partiel").length}</p>{savedAttendance.filter((a:any)=>a.attendance_status==="absent"&&a.absence_reason).map((a:any)=><p key={a.id} className="mt-1 text-sm">{memberName.get(a.member_id)} — motif : {a.absence_reason}</p>)}{savedAttendance.filter((a:any)=>a.observation).map((a:any)=><p key={a.id} className="mt-1 text-sm">{memberName.get(a.member_id)} — {a.observation}</p>)}</div>
            </> : <EmptyState title="Sélectionnez un créneau"/>}
          </CardContent></Card> : null}
        </section>
      </> : <>{prayerTab === "temps" ? <><p className="mt-4 text-xs text-muted-foreground">Vous n’avez pas accès à la corbeille de sujets ni à la création des programmes. Les programmes pour lesquels vous êtes désigné(e) pour les présences apparaîtront ci-dessous.</p><section className="mt-6 space-y-4"><h2 className="text-xl font-bold">Feuilles de présence qui me sont confiées</h2>{(programs.data??[]).map((p:any)=><Card key={p.id}><CardHeader><CardTitle>{p.title}</CardTitle><p className="text-sm text-muted-foreground">{p.program_date} · {p.description??""}</p></CardHeader><CardContent className="space-y-3"><Button variant="outline" size="sm" onClick={()=>{setSelectedProgram(p);setSelectedSlot(null);setAttendanceDraft({});}}>Ouvrir la feuille de présence</Button>{selectedProgram?.id===p.id?<><div className="flex flex-wrap gap-2">{(programSlots.data??[]).filter((sl:any)=>(sl.attendance_manager_member_ids??[]).includes(member?.id)).map((sl:any)=><Button key={sl.id} size="sm" variant={selectedSlot?.id===sl.id?"default":"outline"} onClick={()=>{setSelectedSlot(sl);setAttendanceDraft({});}}>{sl.slot_date} · {sl.start_time}–{sl.end_time}</Button>)}</div>{selectedSlot&&(selectedSlot.attendance_manager_member_ids??[]).includes(member?.id)?<><div className="space-y-3">{(members.data??[]).map((m:any)=><div key={m.id} className="rounded-lg border p-3"><b>{m.full_name}</b><div className="mt-2 grid gap-2 sm:grid-cols-3"><Field label="Présence"><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={statusOf(m.id)} onChange={e=>patchAttendance(m.id,"status",e.target.value)}><option value="">À renseigner</option><option value="present">Présent(e)</option><option value="absent">Absent(e)</option><option value="partiel">Présence partielle</option></select></Field>{statusOf(m.id)==="absent"?<Field label="Motif d’absence"><Input value={reasonOf(m.id)} onChange={e=>patchAttendance(m.id,"reason",e.target.value)} placeholder="Motif, si communiqué"/></Field>:null}<Field label="Observation"><Input value={observationOf(m.id)} onChange={e=>patchAttendance(m.id,"observation",e.target.value)} placeholder="Observation"/></Field></div></div>)}</div><Button onClick={()=>saveAttendance.mutate()} disabled={saveAttendance.isPending || !canEditSelectedAttendance}>Enregistrer les présences</Button></>:null}</>:null}</CardContent></Card>)}</section></> : null}</>}
    </AppShell>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-1"><Label>{label}</Label>{children}</div>;
}
