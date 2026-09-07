import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";
import { ProgramFilters, DEFAULT_PROGRAM_FILTERS } from "@/components/programs/ProgramFilters";
import { formatDate, membersQuery, polesQuery, programsQuery, STATUS_LABEL } from "@/lib/icc";
import { canonicalProgramFormat, canonicalProgramImportance, canonicalProgramRecurrence, canonicalProgramType } from "@/lib/programLabels";
import { PERIOD_LABELS, rangesOverlap, type DashboardPeriod } from "@/lib/period";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/programmes")({ component: Programmes });
type View = "all" | "upcoming" | "past" | "archives";

const statusClass: Record<string, string> = {
  confirmed: "bg-green-100 text-green-800 border-green-200",
  unconfirmed: "bg-amber-100 text-amber-800 border-amber-200",
  postponed: "bg-blue-100 text-blue-800 border-blue-200",
  cancelled: "bg-red-100 text-red-800 border-red-200",
};

function programDateLabel(program: any) {
  if (!program.start_date) return "Date à définir";
  if (program.end_date && program.end_date !== program.start_date) return `${formatDate(program.start_date)} → ${formatDate(program.end_date)}`;
  return formatDate(program.start_date);
}

function Programmes() {
  const programs = useQuery(programsQuery), poles = useQuery(polesQuery), members = useQuery(membersQuery);
  const [view, setView] = useState<View>("upcoming"), [search, setSearch] = useState(""), [filters, setFilters] = useState(DEFAULT_PROGRAM_FILTERS), [period, setPeriod] = useState<DashboardPeriod>("month");
  const today = new Date().toISOString().slice(0, 10);
  const poleName = useMemo(() => new Map((poles.data ?? []).map(p => [p.id, p.name])), [poles.data]);
  const memberName = useMemo(() => new Map((members.data?.members ?? []).map(m => [m.id, m.full_name])), [members.data]);
  const all = programs.data ?? [];

  const inView = (p: any) => view === "all" ? true : view === "archives" ? p.archived : view === "upcoming" ? !p.archived && (p.status === "postponed" || (p.end_date || p.start_date) >= today) : !p.archived && p.status !== "postponed" && (p.end_date || p.start_date) < today;
  const counts = {
    all: all.length,
    upcoming: all.filter(p => !p.archived && (p.status === "postponed" || (p.end_date || p.start_date) >= today)).length,
    past: all.filter(p => !p.archived && p.status !== "postponed" && (p.end_date || p.start_date) < today).length,
    archives: all.filter(p => p.archived).length,
  };

  const filtered = all.filter(p => {
    const q = search.trim().toLowerCase();
    return inView(p) && rangesOverlap(p.start_date, p.end_date, period) && (!q || [p.title, p.location, p.description].some(v => v?.toLowerCase().includes(q))) && (filters.status === "all" || p.status === filters.status) && (filters.type === "all" || canonicalProgramType(p.program_type) === filters.type) && (filters.format === "all" || canonicalProgramFormat(p.format) === filters.format) && (filters.recurrence === "all" || canonicalProgramRecurrence(p.recurrence) === filters.recurrence) && (filters.importance === "all" || canonicalProgramImportance(p.importance) === filters.importance);
  }).sort((a, b) => (view === "past" || view === "archives" ? b.start_date.localeCompare(a.start_date) : a.start_date.localeCompare(b.start_date)));

  if (programs.isLoading) return <AppShell title="Programmes"><Skeleton className="h-40 rounded-xl" /></AppShell>;

  return <AppShell title="Programmes" subtitle="Vue compacte : ouvrez uniquement le programme, puis le pôle dont vous avez besoin." actions={<Button asChild size="sm"><Link to="/administration" search={{ newProgram: "1" } as any}>+ Nouveau programme</Link></Button>}>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {([['all', 'Tous'], ['upcoming', 'À venir'], ['past', 'Passés'], ['archives', 'Archives']] as [View, string][]).map(([k, l]) => <Button key={k} size="sm" variant={view === k ? "default" : "outline"} onClick={() => setView(k)}>{l}<Badge variant="secondary" className="ml-2">{counts[k]}</Badge></Button>)}
      <div className="ml-auto flex items-center gap-2"><span className="text-xs font-semibold text-muted-foreground">Période</span><select aria-label="Période des programmes" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={period} onChange={e => setPeriod(e.target.value as DashboardPeriod)}>{Object.entries(PERIOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    </div>

    <div className="mb-5 space-y-3"><Input className="max-w-md" placeholder="Rechercher un programme…" value={search} onChange={e => setSearch(e.target.value)} /><ProgramFilters value={filters} onChange={setFilters} /></div>

    {filtered.length === 0 ? <EmptyState title="Aucun programme sur cette période" description="Changez la période ou les filtres pour afficher d’autres programmes." /> : <div className="space-y-2">
      {filtered.map(program => {
        const pp: any = program;
        const totalRequired = program.assignments.reduce((n, a) => n + (a.required_count || 0), 0);
        const totalAssigned = program.assignments.reduce((n, a) => n + a.memberIds.length, 0);
        const missing = program.assignments.reduce((n, a) => n + Math.max(0, (a.required_count || 0) - a.memberIds.length), 0);
        return <details key={program.id} className="group rounded-xl border bg-card shadow-sm open:shadow-md">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <p className="truncate font-black text-icc-violet">{program.title}</p>
              <p className="mt-0.5 text-xs font-semibold text-muted-foreground">📅 {programDateLabel(program)}</p>
            </div>
            <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>

          <div className="border-t px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge className={statusClass[program.status] ?? ""}>{STATUS_LABEL[program.status] ?? program.status}</Badge>
                  {program.archived ? <Badge variant="outline">Archivé</Badge> : null}
                  {totalRequired > 0 ? <Badge variant={missing ? "destructive" : "secondary"}>{missing ? `⚠️ ${missing} place${missing > 1 ? "s" : ""} à couvrir` : `✅ Équipe couverte ${totalAssigned}/${totalRequired}`}</Badge> : null}
                </div>
                {program.location ? <p className="text-sm text-muted-foreground">📍 {program.location}</p> : null}
                {program.status === "postponed" ? <p className="text-sm font-semibold text-blue-700">Nouvelle date prévue : {pp.postponed_new_date_known && pp.postponed_new_start_date ? formatDate(pp.postponed_new_start_date) : "à renseigner ultérieurement"}</p> : null}
              </div>
              <Button asChild size="sm" variant="outline"><Link to="/programme/$id" params={{ id: program.id }}>Ouvrir la fiche complète</Link></Button>
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Pôles / services affectés</p>
              {program.assignments.length === 0 ? <p className="rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">Aucun pôle affecté.</p> : program.assignments.map(a => {
                const required = a.required_count || 0, assigned = a.memberIds.length, remaining = Math.max(0, required - assigned);
                return <details key={a.id} className="group/pole rounded-lg border bg-muted/20">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                    <div className="min-w-0"><b className="text-sm text-icc-violet">{poleName.get(a.pole_id) ?? "Pôle"}</b><p className="text-xs text-muted-foreground">{required ? `${assigned}/${required} affecté${assigned > 1 ? "s" : ""}${remaining ? ` · ${remaining} à couvrir` : " · besoin couvert"}` : `${assigned} affecté${assigned > 1 ? "s" : ""}`}</p></div>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/pole:rotate-180" />
                  </summary>
                  <div className="border-t px-3 py-3">
                    {a.memberIds.length ? <div className="flex flex-wrap gap-2">{a.memberIds.map(mid => <span key={mid} className="rounded-lg bg-background px-3 py-2 text-sm font-semibold">{memberName.get(mid) ?? mid}</span>)}</div> : <p className="text-sm text-muted-foreground">Aucun membre encore affecté.</p>}
                    {a.tasks ? <p className="mt-3 text-sm"><b>Service / tâches :</b> {a.tasks}</p> : null}
                  </div>
                </details>;
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {missing > 0 && !program.archived ? <Button asChild size="sm"><Link to="/sollicitations">📣 Rechercher {missing} renfort{missing > 1 ? "s" : ""}</Link></Button> : null}
              {!program.archived ? <Button asChild size="sm" variant="outline"><Link to="/reporter-programme/$id" params={{ id: program.id }}>{program.status === "postponed" ? "Nouvelle date" : "Reporter"}</Link></Button> : null}
            </div>
          </div>
        </details>;
      })}
    </div>}
  </AppShell>;
}
