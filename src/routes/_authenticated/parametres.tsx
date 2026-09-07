import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Eye, Home, Save, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { AccessRightsPanel } from "@/components/settings/AccessRightsPanel";
import { BirthdayTeamSettings } from "@/components/settings/BirthdayTeamSettings";
import { HomeIdentityMedia } from "@/components/settings/HomeIdentityMedia";
import { MenuModulesPanel } from "@/components/settings/MenuModulesPanel";
import { TechnicalAdminPanel } from "@/components/settings/TechnicalAdminPanel";
import { useCurrentRole } from "@/hooks/useAuth";
import { useSettingsAccess } from "@/hooks/useSettingsAccess";
import { supabase } from "@/integrations/supabase/client";
import { membersQuery, polesQuery, settingsQuery } from "@/lib/icc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/parametres")({
  head: () => ({ meta: [{ title: "Paramètres — COM ICC Le Mans" }] }),
  component: Parametres,
});
type Verse = { ref: string; text: string };
const DEFAULT_VERSES: Verse[] = [
  {
    ref: "Matthieu 6:33",
    text: "« Cherchez premièrement le royaume et la justice de Dieu; et toutes ces choses vous seront données par-dessus. »",
  },
  {
    ref: "Hébreux 6:10",
    text: "« Car Dieu n’est pas injuste, pour oublier votre travail et l’amour que vous avez montré pour son nom, ayant rendu et rendant encore des services aux saints. »",
  },
];

function Parametres() {
  const canEdit = useSettingsAccess();
  const qc = useQueryClient(),
    settings = useQuery(settingsQuery),
    members = useQuery(membersQuery),
    poles = useQuery(polesQuery);
  const s: any = settings.data ?? {};
  const activeMembers = useMemo(
    () => (members.data?.members ?? []).filter((m: any) => m.status === "active" && !m.archived),
    [members.data],
  );
  const activePoles = useMemo(
    () => (poles.data ?? []).filter((p: any) => !p.archived),
    [poles.data],
  );
  const [homeTitle, setHomeTitle] = useState(""),
    [brand, setBrand] = useState(""),
    [subtitle, setSubtitle] = useState(""),
    [iconUrl, setIconUrl] = useState(""),
    [coverUrl, setCoverUrl] = useState(""),
    [coverCrop, setCoverCrop] = useState<any>({ x: 50, y: 50, zoom: 1 }),
    [verses, setVerses] = useState<Verse[]>(DEFAULT_VERSES);
  const [structure, setStructure] = useState("responsable_adjoint"),
    [responsable, setResponsable] = useState(""),
    [adjoint, setAdjoint] = useState(""),
    [commLead, setCommLead] = useState(""),
    [avLead, setAvLead] = useState("");
  const [referents, setReferents] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!settings.data) return;
    const x: any = settings.data;
    setHomeTitle(x.home_title ?? "COM ICC Le Mans");
    setBrand(x.brand ?? "LE MANS");
    setSubtitle(x.subtitle ?? "Communication • Organisation • Service");
    setIconUrl(x.icon_url ?? "");
    setCoverUrl(x.cover_url ?? "");
    setCoverCrop({ x: 50, y: 50, zoom: 1, ...(x.cover_crop ?? {}) });
    setVerses(Array.isArray(x.verses) && x.verses.length ? x.verses : DEFAULT_VERSES);
    setStructure(x.direction_structure ?? "responsable_adjoint");
    setResponsable(x.supervisor_member_id ?? "");
    setAdjoint(x.adjoint_member_id ?? "");
    setCommLead(x.group_leads?.communication ?? "");
    setAvLead(x.group_leads?.audiovisuel ?? "");
  }, [settings.data]);
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const l of members.data?.links ?? [])
      if (l.is_referent && !next[l.pole_id]) next[l.pole_id] = l.member_id;
    setReferents(next);
  }, [members.data]);
  const saveIdentity = useMutation({
    mutationFn: async () => {
      if (!canEdit) throw new Error("Consultation uniquement.");
      const { error } = await supabase
        .from("app_settings")
        .upsert({
          id: "main",
          home_title: homeTitle.trim() || "COM ICC Le Mans",
          brand: brand.trim() || "LE MANS",
          subtitle: subtitle.trim() || null,
          icon_url: iconUrl.trim() || null,
          cover_url: coverUrl.trim() || null,
          cover_crop: coverCrop,
          cover_enabled: !!coverUrl.trim(),
          verses,
          updated_at: new Date().toISOString(),
        } as any);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Identité et accueil enregistrés");
      await qc.invalidateQueries({ queryKey: ["app-settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const saveOrg = useMutation({
    mutationFn: async () => {
      if (!canEdit) throw new Error("Consultation uniquement.");
      const group_leads =
        structure === "responsable_general_grands_groupes"
          ? { communication: commLead || null, audiovisuel: avLead || null }
          : {};
      const { data, error } = await (supabase as any).rpc("save_organization_settings", {
        p_direction_structure: structure,
        p_supervisor_member_id: responsable || "",
        p_adjoint_member_id: structure === "responsable_adjoint" ? adjoint || "" : "",
        p_group_leads: group_leads,
        p_referents: referents,
      });
      if (error) throw error;
      if (!data?.success) throw new Error("L’organisation n’a pas été confirmée par le serveur.");

      const { data: savedLinks, error: verifyError } = await supabase
        .from("member_poles")
        .select("pole_id,member_id,is_referent")
        .eq("is_referent", true);
      if (verifyError) throw verifyError;
      for (const pole of activePoles) {
        const expected = referents[pole.id] || "";
        const actual = (savedLinks ?? []).find((l: any) => l.pole_id === pole.id)?.member_id || "";
        if (actual !== expected) throw new Error(`Vérification échouée pour ${pole.name}. Aucun message de succès n’a été validé.`);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["app-settings"] }),
        qc.invalidateQueries({ queryKey: ["members"] }),
        qc.invalidateQueries({ queryKey: ["current-role"] }),
      ]);
      toast.success("Organisation réellement enregistrée et vérifiée");
    },
    onError: (e: any) => toast.error("Enregistrement impossible", { description: e.message }),
  });
  if (!canEdit)
    return <ReadOnlySettings settings={s} members={activeMembers} poles={activePoles} />;
  const memberSelect = (label: string, value: string, setter: (v: string) => void) => (
    <Field label={label}>
      <select
        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        value={value}
        onChange={(e) => setter(e.target.value)}
      >
        <option value="">Non défini</option>
        {activeMembers.map((m: any) => (
          <option key={m.id} value={m.id}>
            {m.full_name}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <AppShell title="Paramètres" subtitle="Configuration générale de l’espace COM ICC Le Mans">
      <Tabs defaultValue="identite" className="space-y-5">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="identite">
            <Home className="mr-2 size-4" />
            Identité & accueil
          </TabsTrigger>
          <TabsTrigger value="organisation">
            <Users className="mr-2 size-4" />
            Organisation
          </TabsTrigger>
          <TabsTrigger value="droits">
            <ShieldCheck className="mr-2 size-4" />
            Accès & droits
          </TabsTrigger>
          <TabsTrigger value="menus">
            <SlidersHorizontal className="mr-2 size-4" />
            Menus & modules
          </TabsTrigger>
          <TabsTrigger value="technique">
            <Building2 className="mr-2 size-4" />
            Administration technique
          </TabsTrigger>
        </TabsList>
        <TabsContent value="identite" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Identité de l’espace</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Nom de l’application">
                <Input value={homeTitle} onChange={(e) => setHomeTitle(e.target.value)} />
              </Field>
              <Field label="Marque / localisation">
                <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
              </Field>
              <Field label="Sous-titre">
                <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
              </Field>
              <HomeIdentityMedia
                iconUrl={iconUrl}
                setIconUrl={setIconUrl}
                coverUrl={coverUrl}
                setCoverUrl={setCoverUrl}
                coverCrop={coverCrop}
                setCoverCrop={setCoverCrop}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Versets d’accueil</CardTitle>
              <CardDescription>Références et textes affichés sur l’accueil.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i} className="space-y-3 rounded-xl border p-4">
                  <Field label={`Référence ${i + 1}`}>
                    <Input
                      value={verses[i]?.ref ?? ""}
                      onChange={(e) =>
                        setVerses((v) => {
                          const n = [...v];
                          n[i] = { ...(n[i] ?? { text: "" }), ref: e.target.value };
                          return n;
                        })
                      }
                    />
                  </Field>
                  <Field label="Texte">
                    <Textarea
                      rows={4}
                      value={verses[i]?.text ?? ""}
                      onChange={(e) =>
                        setVerses((v) => {
                          const n = [...v];
                          n[i] = { ...(n[i] ?? { ref: "" }), text: e.target.value };
                          return n;
                        })
                      }
                    />
                  </Field>
                </div>
              ))}
            </CardContent>
          </Card>
          <Button onClick={() => saveIdentity.mutate()} disabled={saveIdentity.isPending}>
            <Save className="size-4" />
            Enregistrer Identité & accueil
          </Button>
        </TabsContent>
        <TabsContent value="organisation" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Direction</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Structure de direction">
                <select
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={structure}
                  onChange={(e) => setStructure(e.target.value)}
                >
                  <option value="responsable_adjoint">Responsable + Adjoint + Référents</option>
                  <option value="responsable_general_grands_groupes">
                    Responsable général + 2 Responsables Grands Groupes + Référents
                  </option>
                </select>
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                {memberSelect(
                  structure === "responsable_adjoint" ? "Responsable" : "Responsable général",
                  responsable,
                  setResponsable,
                )}
                {structure === "responsable_adjoint" ? (
                  memberSelect("Adjoint", adjoint, setAdjoint)
                ) : (
                  <>
                    {memberSelect("Responsable Communication / Média", commLead, setCommLead)}
                    {memberSelect("Responsable Audiovisuel", avLead, setAvLead)}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Référents par pôle</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {activePoles.map((p: any) => (
                <div key={p.id} className="rounded-xl border p-4">
                  <Label>{p.name}</Label>
                  <select
                    className="mt-2 h-10 w-full rounded-md border bg-background px-3"
                    value={referents[p.id] ?? ""}
                    onChange={(e) => setReferents((r) => ({ ...r, [p.id]: e.target.value }))}
                  >
                    <option value="">Aucun référent</option>
                    {activeMembers.map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </CardContent>
          </Card>
          <BirthdayTeamSettings />
          <Button onClick={() => saveOrg.mutate()} disabled={saveOrg.isPending}>
            <Save className="size-4" />
            Enregistrer l’organisation
          </Button>
        </TabsContent>
        <TabsContent value="droits">
          <AccessRightsPanel />
        </TabsContent>
        <TabsContent value="menus">
          <MenuModulesPanel settings={settings.data} />
        </TabsContent>
        <TabsContent value="technique">
          <TechnicalAdminPanel settings={settings.data} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
function ReadOnlySettings({
  settings,
  members,
  poles,
}: {
  settings: any;
  members: any[];
  poles: any[];
}) {
  const links = useQuery(membersQuery).data?.links ?? [];
  const memberName = (id: string) => members.find((m) => m.id === id)?.full_name || "Non défini";
  return (
    <AppShell title="Paramètres" subtitle="Configuration générale de l’espace COM ICC Le Mans">
      <Card className="mb-5 border-violet-200 bg-violet-50">
        <CardContent className="flex gap-3 p-4">
          <Eye className="mt-0.5 size-5 text-icc-violet" />
          <div>
            <b>Mode consultation</b>
            <p className="text-sm text-muted-foreground">
              Vous pouvez parcourir les véritables familles de paramètres et comprendre ce que
              l’application permet de configurer. Les valeurs sensibles et toutes les modifications
              restent protégées.
            </p>
          </div>
        </CardContent>
      </Card>
      <Tabs defaultValue="identite" className="space-y-5">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="identite">Identité & accueil</TabsTrigger>
          <TabsTrigger value="organisation">Organisation</TabsTrigger>
          <TabsTrigger value="droits">Accès & droits</TabsTrigger>
          <TabsTrigger value="menus">Menus & modules</TabsTrigger>
          <TabsTrigger value="technique">Administration technique</TabsTrigger>
        </TabsList>
        <TabsContent value="identite">
          <div className="grid gap-3 md:grid-cols-2">
            <Info title="Nom de l’application" value={settings.home_title || "COM ICC Le Mans"} />
            <Info title="Marque / localisation" value={settings.brand || "LE MANS"} />
            <Info
              title="Sous-titre"
              value={settings.subtitle || "Communication • Organisation • Service"}
            />
            <Info
              title="Accueil"
              value="Logo, couverture, cadrage et versets peuvent être administrés ici."
            />
          </div>
        </TabsContent>
        <TabsContent value="organisation" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Direction</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <Info
                title="Structure"
                value={
                  settings.direction_structure === "responsable_general_grands_groupes"
                    ? "Responsable général + Grands Groupes + Référents"
                    : "Responsable + Adjoint + Référents"
                }
              />
              <Info title="Responsable" value={memberName(settings.supervisor_member_id)} />
              <Info title="Adjoint" value={memberName(settings.adjoint_member_id)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Référents par pôle</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              {poles.map((p) => (
                <div key={p.id} className="rounded-xl border p-3">
                  <b>{p.name}</b>
                  <p className="text-xs text-muted-foreground">
                    {links
                      .filter((l) => l.pole_id === p.id && l.is_referent)
                      .map((l) => memberName(l.member_id))
                      .join(", ") || "Aucun référent désigné"}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="droits">
          <AccessRightsPanel />
        </TabsContent>
        <TabsContent value="menus">
          <MenuModulesPanel settings={settings} />
        </TabsContent>
        <TabsContent value="technique">
          <Preview
            title="Administration technique"
            text="Outils de maintenance, diagnostic et administration technique. Cette couche est indépendante des responsabilités métier."
          />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
function ReadOnlyRights() {
  const modules = [
    "Membres / Trombinoscope",
    "Pôles",
    "Structure / Organisation",
    "Programmes",
    "Planning",
    "Demandes ponctuelles",
    "Indisponibilités",
    "Modèles",
    "Formation",
    "Évaluations",
    "Post-service",
    "Pilotage",
    "Notifications / À faire",
    "Archives / Corbeille",
    "Historique / Audit",
    "Exports",
    "Paramètres",
    "Administration technique",
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Matrice des droits</CardTitle>
        <CardDescription>
          Lecture du fonctionnement des habilitations, sans afficher les exceptions individuelles
          sensibles.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {modules.map((x) => (
          <div key={x} className="rounded-xl border p-3">
            <b>{x}</b>
            <p className="text-xs text-muted-foreground">
              Équipier · Référent · Direction — périmètres possibles : Interdit, Moi, Mon pôle ou
              Tous. Des responsabilités complémentaires peuvent s’ajouter au rôle de base.
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
function Preview({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}
function Info({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <b>{title}</b>
        <p className="mt-1 text-sm text-muted-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
