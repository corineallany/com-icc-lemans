import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell, EmptyState } from "@/components/AppShell";
import { MyBirthdayPrivacy } from "@/components/profile/MyBirthdayPrivacy";
import { PersonalProfileEditor } from "@/components/profile/PersonalProfileEditor";
import { MyTrainingStatus } from "@/components/profile/MyTrainingStatus";
import { ROLE_LABEL, useCurrentRole } from "@/hooks/useAuth";
import {
  auditQuery,
  availabilityQuery,
  AVAILABILITY_STATUS_LABEL,
  evaluationsQuery,
  formatDate,
  formatDateTime,
  membersQuery,
  polesQuery,
  programsQuery,
  RESPONSE_LABEL,
} from "@/lib/icc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/mon-profil")({
  head: () => ({
    meta: [
      { title: "Mon profil — COM ICC Le Mans" },
      { name: "description", content: "Votre fiche personnelle au pôle Communication ICC Le Mans : profil, planning, services, indisponibilités, formation, évaluations et activité." },
      { property: "og:title", content: "Mon profil — COM ICC Le Mans" },
      { property: "og:description", content: "Profil, planning personnel, services, formation, évaluations et activité." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MonProfil,
});

function MonProfil() {
  const { member, role, isTechAdmin, userId } = useCurrentRole();
  const programs = useQuery(programsQuery);
  const poles = useQuery(polesQuery);
  const members = useQuery(membersQuery);
  const availability = useQuery(availabilityQuery);
  const evaluations = useQuery(evaluationsQuery);
  const audit = useQuery(auditQuery);

  const memberId = member?.id ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const myPrograms = memberId ? (programs.data ?? []).filter((p) => p.assignments.some((a) => a.memberIds.includes(memberId))) : [];
  const upcoming = myPrograms.filter((p) => (p.start_date ?? "9999") >= today);
  const past = myPrograms.filter((p) => (p.start_date ?? "9999") < today);
  const myAvailability = (availability.data ?? []).filter((a) => a.member_id === memberId);
  const myEvaluations = (evaluations.data ?? []).filter((e) => e.subject_member_id === memberId && e.status === "validated");
  const myPoles = (members.data?.links ?? []).filter((l) => l.member_id === memberId);
  const referentPoles = myPoles.filter((l) => l.is_referent);
  const poleName = (id: string) => poles.data?.find((p) => p.id === id)?.name ?? "Pôle";
  const myActivity = (audit.data ?? []).filter((a) => a.actor_id === userId || a.actor_name === member?.full_name);

  if (!member) {
    return <AppShell title="Mon profil"><EmptyState title="Compte non relié à un équipier" description="Demandez à la responsable ou à l'administrateur technique de relier votre compte à votre fiche membre." /></AppShell>;
  }

  return (
    <AppShell title="Mon profil" subtitle={role ? ROLE_LABEL[role] : "Sans rôle attribué"}>
      <Tabs defaultValue="profil">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="profil">Profil</TabsTrigger><TabsTrigger value="planning">Planning</TabsTrigger><TabsTrigger value="services">Services</TabsTrigger><TabsTrigger value="indispos">Indisponibilités</TabsTrigger><TabsTrigger value="formation">Formation</TabsTrigger><TabsTrigger value="evaluations">Évaluations</TabsTrigger><TabsTrigger value="activite">Activité</TabsTrigger>
        </TabsList>
        <TabsContent value="profil">
          <Card><CardHeader className="flex flex-row items-center gap-4"><span className="flex size-16 items-center justify-center overflow-hidden rounded-full bg-muted text-lg font-black text-icc-violet">{member.photo_url ? <img src={member.photo_url} alt="" className="size-full object-cover" /> : member.full_name.slice(0, 2).toUpperCase()}</span><div><CardTitle>{member.full_name}</CardTitle><div className="mt-1 flex flex-wrap gap-1">{role ? <Badge variant="secondary">{ROLE_LABEL[role]}</Badge> : null}{isTechAdmin ? <Badge variant="outline">🛡️ Admin technique</Badge> : null}</div></div></CardHeader><CardContent className="space-y-2 text-sm"><p><b>Pôles :</b> {myPoles.length ? myPoles.map((l) => poleName(l.pole_id)).join(", ") : "Aucun pôle"}</p>{referentPoles.length ? <p><b>Référent :</b> {referentPoles.map((l) => poleName(l.pole_id)).join(", ")}</p> : null}<p className="text-muted-foreground">Complétez vos informations personnelles ci-dessous. Les rôles et habilitations restent gérés par la responsable.</p></CardContent></Card>
          {userId && members.data?.members.find((m: any) => m.id === memberId) ? <PersonalProfileEditor member={members.data.members.find((m: any) => m.id === memberId)} userId={userId} /> : null}
          <MyBirthdayPrivacy />
        </TabsContent>
        <TabsContent value="planning"><Card><CardHeader><CardTitle className="text-base">Mes prochains engagements</CardTitle></CardHeader><CardContent className="space-y-2">{upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Aucun service à venir.</p> : upcoming.map((p) => <Link key={p.id} to="/programme/$id" params={{ id: p.id }} className="block rounded-lg border border-border p-3 text-sm hover:bg-muted/60"><b>{p.title}</b> — {formatDate(p.start_date)}</Link>)}</CardContent></Card></TabsContent>
        <TabsContent value="services"><Card><CardHeader><CardTitle className="text-base">Historique de mes services</CardTitle></CardHeader><CardContent className="space-y-2">{past.length === 0 ? <p className="text-sm text-muted-foreground">Aucun service passé.</p> : past.map((p) => { const r = p.responses.find((x) => x.member_id === memberId); return <Link key={p.id} to="/programme/$id" params={{ id: p.id }} className="block rounded-lg border border-border p-3 text-sm hover:bg-muted/60"><b>{p.title}</b> — {formatDate(p.start_date)}{r ? ` · ${RESPONSE_LABEL[r.status]}` : ""}</Link>; })}<Link to="/mes-services" className="mt-2 inline-block text-xs font-bold text-icc-violet">Ouvrir « Mes services » →</Link></CardContent></Card></TabsContent>
        <TabsContent value="indispos"><Card><CardHeader><CardTitle className="text-base">Mes indisponibilités</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{myAvailability.length === 0 ? <p className="text-muted-foreground">Aucune indisponibilité déclarée.</p> : myAvailability.map((a) => <p key={a.id}>{new Date(a.starts_at).toLocaleDateString("fr-FR")} → {new Date(a.ends_at).toLocaleDateString("fr-FR")} · <Badge variant="outline">{AVAILABILITY_STATUS_LABEL[a.status] ?? a.status}</Badge></p>)}<Link to="/disponibilites" className="inline-block text-xs font-bold text-icc-violet">Déclarer une indisponibilité →</Link></CardContent></Card></TabsContent>
        <TabsContent value="formation"><Card><CardHeader><CardTitle className="text-base">Mon parcours de formation</CardTitle></CardHeader><CardContent className="space-y-1 text-sm"><MyTrainingStatus memberId={member.id} /></CardContent></Card></TabsContent>
        <TabsContent value="evaluations"><Card><CardHeader><CardTitle className="text-base">Mes évaluations validées</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{myEvaluations.length === 0 ? <p className="text-muted-foreground">Aucune évaluation validée. Une évaluation n'est visible qu'après validation du Responsable.</p> : myEvaluations.map((e) => <div key={e.id} className="rounded-lg border border-border p-3"><b>{e.period_label ?? "Évaluation"}</b>{e.comment ? <p className="mt-1 whitespace-pre-wrap">{e.comment}</p> : null}<p className="mt-1 text-xs text-muted-foreground">Validée le {formatDateTime(e.validated_at)}</p></div>)}</CardContent></Card></TabsContent>
        <TabsContent value="activite"><Card><CardHeader><CardTitle className="text-base">Mon activité récente</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">{myActivity.length === 0 ? <p className="text-muted-foreground">Aucune action enregistrée.</p> : myActivity.slice(0, 30).map((a) => <p key={a.id}><b>{a.action}</b>{a.detail ? ` — ${a.detail}` : ""} <span className="text-xs text-muted-foreground">{formatDateTime(a.occurred_at)}</span></p>)}</CardContent></Card></TabsContent>
      </Tabs>
    </AppShell>
  );
}
