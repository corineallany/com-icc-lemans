import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Save, ShieldCheck, UserRoundCog, Crown } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { membersQuery } from "@/lib/icc";

export const Route = createFileRoute("/_authenticated/parametres-finances")({
  head: () => ({ meta: [{ title: "Paramètres Finance — COM ICC Le Mans" }] }),
  component: FinanceSettings,
});

const db = () => supabase as any;
const ROLES = [["equipier", "Équipier"], ["referent", "Référent"], ["direction", "Direction"]] as const;
const SCOPES = [["interdit", "Interdit"], ["moi", "Moi"], ["mon_pole", "Mon pôle"], ["tous", "Tous"]] as const;
const ACTIONS = [
  ["consulter_collectif", "Voir le solde et le journal collectif"],
  ["declarer_cotisation", "Déclarer sa cotisation"],
  ["voir_detail_cotisations", "Voir les montants et membres individuellement"],
  ["confirmer_cotisations", "Confirmer / refuser les cotisations"],
  ["enregistrer_depense", "Enregistrer une dépense"],
  ["valider_depense", "Valider / refuser une dépense"],
  ["voir_justificatifs", "Voir les justificatifs et détails privés"],
  ["administrer", "Administrer la caisse / corrections / annulations"],
] as const;

type Role = typeof ROLES[number][0];
type Scope = typeof SCOPES[number][0];
type Row = { id?: string; role_key: Role; module_key: string; action_key: string; scope: Scope; enabled: boolean };
type Ex = { id?: string; member_id: string; module_key: string; action_key: string; scope: Scope | null; enabled: boolean | null };
type Manager = { member_id: string; active: boolean; granted_by?: string | null; granted_at?: string | null };

function FinanceSettings() {
  const qc = useQueryClient();
  const members = useQuery(membersQuery);
  const rows = useQuery({
    queryKey: ["finance-settings-role"],
    queryFn: async () => {
      const { data, error } = await db().from("access_role_permissions").select("*").eq("module_key", "finances_equipe");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const exs = useQuery({
    queryKey: ["finance-settings-exceptions"],
    queryFn: async () => {
      const { data, error } = await db().from("access_user_exceptions").select("*").eq("module_key", "finances_equipe");
      if (error) throw error;
      return (data ?? []) as Ex[];
    },
  });
  const managers = useQuery({
    queryKey: ["finance-managers"],
    queryFn: async () => {
      const { data, error } = await db().from("team_finance_managers").select("*").order("granted_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Manager[];
    },
  });

  const [role, setRole] = useState<Role>("equipier");
  const [draft, setDraft] = useState<Record<string, Row>>({});
  const [memberId, setMemberId] = useState("");
  const [exDraft, setExDraft] = useState<Record<string, Ex>>({});
  const [managerMemberId, setManagerMemberId] = useState("");

  useEffect(() => {
    const n: Record<string, Row> = {};
    for (const r of rows.data ?? []) n[`${r.role_key}|${r.action_key}`] = r;
    setDraft(n);
  }, [rows.data]);
  useEffect(() => {
    const n: Record<string, Ex> = {};
    for (const r of exs.data ?? []) n[`${r.member_id}|${r.action_key}`] = r;
    setExDraft(n);
  }, [exs.data]);

  const active = useMemo(() => (members.data?.members ?? []).filter((m: any) => m.status === "active" && !m.archived), [members.data]);
  const managerIds = new Set((managers.data ?? []).filter((m) => m.active).map((m) => m.member_id));
  const memberName = (id: string) => active.find((m: any) => m.id === id)?.full_name ?? "Membre";

  const save = useMutation({
    mutationFn: async () => {
      const values = Object.values(draft);
      const { error } = await db().from("access_role_permissions").upsert(values.map(({ id, ...r }) => ({ ...r, module_key: "finances_equipe", updated_at: new Date().toISOString() })), { onConflict: "role_key,module_key,action_key" });
      if (error) throw error;
    },
    onSuccess: async () => { toast.success("Droits Finance enregistrés"); await qc.invalidateQueries({ queryKey: ["finance-settings-role"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const saveEx = useMutation({
    mutationFn: async () => {
      const values = Object.values(exDraft).filter((x) => x.member_id);
      if (!values.length) return;
      const { error } = await db().from("access_user_exceptions").upsert(values.map(({ id, ...r }) => ({ ...r, module_key: "finances_equipe", updated_at: new Date().toISOString() })), { onConflict: "member_id,module_key,action_key" });
      if (error) throw error;
    },
    onSuccess: async () => { toast.success("Exception Finance enregistrée"); await qc.invalidateQueries({ queryKey: ["finance-settings-exceptions"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const addManager = useMutation({
    mutationFn: async () => {
      if (!managerMemberId) throw new Error("Choisis un membre.");
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await db().from("team_finance_managers").upsert({ member_id: managerMemberId, active: true, granted_by: user?.id ?? null, granted_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "member_id" });
      if (error) throw error;
    },
    onSuccess: async () => { toast.success("Gestionnaire de caisse ajouté"); setManagerMemberId(""); await qc.invalidateQueries({ queryKey: ["finance-managers"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const removeManager = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db().from("team_finance_managers").update({ active: false, updated_at: new Date().toISOString() }).eq("member_id", id);
      if (error) throw error;
    },
    onSuccess: async () => { toast.success("Droit de gestionnaire retiré"); await qc.invalidateQueries({ queryKey: ["finance-managers"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  function get(a: string): Row { return draft[`${role}|${a}`] ?? { role_key: role, module_key: "finances_equipe", action_key: a, scope: "interdit", enabled: false }; }
  function set(a: string, s: Scope) { const r = get(a); setDraft((d) => ({ ...d, [`${role}|${a}`]: { ...r, scope: s, enabled: s !== "interdit" } })); }
  function getEx(a: string) { return exDraft[`${memberId}|${a}`]; }
  function setEx(a: string, v: string) {
    if (!memberId) return;
    const k = `${memberId}|${a}`;
    if (v === "inherit") { setExDraft((d) => { const n = { ...d }; delete n[k]; return n; }); return; }
    const s = v as Scope;
    setExDraft((d) => ({ ...d, [k]: { ...(d[k] ?? {}), member_id: memberId, module_key: "finances_equipe", action_key: a, scope: s, enabled: s !== "interdit" } }));
  }

  return <AppShell title="Paramètres Finance" subtitle="Droits de la Caisse fraternelle — rôle de base + responsabilités complémentaires.">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Crown className="size-5" />Accès de secours</CardTitle>
        <CardDescription>L’Admin technique conserve volontairement un accès total et transversal à la caisse. Ce droit est indépendant de son rôle métier et sert de filet de sécurité.</CardDescription>
      </CardHeader>
      <CardContent><Badge>Admin technique · accès total permanent</Badge></CardContent>
    </Card>

    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><UserRoundCog className="size-5" />Trésorier·ère(s) / gestionnaires de caisse</CardTitle>
        <CardDescription>C’est ici que la Direction désigne le ou les trésoriers de la Caisse fraternelle. La personne reçoit les droits de gestion financière sans changer son rôle de base ; un Équipier ou un Référent peut donc être désigné.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <select className="h-10 rounded-md border bg-background px-3 text-sm" value={managerMemberId} onChange={(e) => setManagerMemberId(e.target.value)}>
            <option value="">Choisir un membre</option>
            {active.filter((m: any) => !managerIds.has(m.id)).map((m: any) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
          <Button onClick={() => addManager.mutate()} disabled={!managerMemberId || addManager.isPending}>+ Désigner comme trésorier·ère</Button>
        </div>
        {(managers.data ?? []).filter((m) => m.active).length ? <div className="space-y-2">{(managers.data ?? []).filter((m) => m.active).map((m) => <div key={m.member_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><b>{memberName(m.member_id)}</b><p className="text-xs text-muted-foreground">Gestion complète : détails, confirmations, entrées, dépenses, justificatifs, corrections et annulations.</p></div><Button size="sm" variant="outline" onClick={() => removeManager.mutate(m.member_id)}>Retirer la gestion</Button></div>)}</div> : <p className="text-sm text-muted-foreground">Aucun trésorier·ère supplémentaire n’est désigné pour le moment. La Direction et l’Admin technique conservent leurs accès prévus.</p>}
      </CardContent>
    </Card>

    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" />Droits par profil</CardTitle>
        <CardDescription>Direction dispose des droits de gestion par défaut. Les Gestionnaires de caisse et l’Admin technique s’ajoutent à cette matrice.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">{ROLES.map(([k, l]) => <Button key={k} variant={role === k ? "default" : "outline"} onClick={() => setRole(k)}>{l}</Button>)}</div>
        {ACTIONS.map(([a, l]) => <div key={a} className="grid gap-2 rounded-xl bg-muted/30 p-3 md:grid-cols-[1fr_220px] md:items-center"><div><p className="font-semibold">{l}</p>{["voir_detail_cotisations", "confirmer_cotisations", "valider_depense", "voir_justificatifs", "administrer"].includes(a) ? <p className="text-xs text-muted-foreground">Permission sensible.</p> : null}</div><select className="h-10 rounded-md border bg-background px-3 text-sm" value={get(a).scope} onChange={(e) => set(a, e.target.value as Scope)}>{SCOPES.map(([s, l2]) => <option key={s} value={s}>{l2}</option>)}</select></div>)}
        <Button onClick={() => save.mutate()} disabled={save.isPending}><Save className="size-4" />Enregistrer les droits Finance</Button>
      </CardContent>
    </Card>

    <Card className="mt-4">
      <CardHeader><CardTitle>Exception individuelle avancée</CardTitle><CardDescription>Pour donner seulement certains droits à une personne sans en faire un Gestionnaire de caisse complet.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-md"><Label className="mb-2 block">Membre</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">Choisir un membre</option>{active.map((m: any) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></div>
        {memberId ? <>{ACTIONS.map(([a, l]) => <div key={a} className="grid gap-2 rounded-xl bg-muted/30 p-3 md:grid-cols-[1fr_220px] md:items-center"><div className="flex items-center gap-2"><span className="font-semibold">{l}</span>{getEx(a) ? <Badge variant="outline">Exception</Badge> : null}</div><select className="h-10 rounded-md border bg-background px-3 text-sm" value={getEx(a)?.scope ?? "inherit"} onChange={(e) => setEx(a, e.target.value)}><option value="inherit">Hériter du profil</option>{SCOPES.map(([s, l2]) => <option key={s} value={s}>{l2}</option>)}</select></div>)}<Button onClick={() => saveEx.mutate()}><Save className="size-4" />Enregistrer l’exception</Button></> : null}
      </CardContent>
    </Card>
  </AppShell>;
}
