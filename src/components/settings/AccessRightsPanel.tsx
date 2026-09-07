import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettingsAccess } from "@/hooks/useSettingsAccess";
import { membersQuery } from "@/lib/icc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

const ROLES = [
  ["equipier", "Équipier"],
  ["referent", "Référent"],
  ["direction", "Direction"],
] as const;
const SCOPES = [
  ["interdit", "Interdit"],
  ["moi", "Moi"],
  ["mon_pole", "Mon pôle"],
  ["tous", "Tous"],
] as const;

type RoleKey = (typeof ROLES)[number][0];
type Scope = (typeof SCOPES)[number][0];
type Row = {
  id?: string;
  role_key: RoleKey;
  module_key: string;
  action_key: string;
  scope: Scope;
  enabled: boolean;
};
type ExceptionRow = {
  id?: string;
  member_id: string;
  module_key: string;
  action_key: string;
  scope: Scope | null;
  enabled: boolean | null;
};

type ModuleDef = {
  key: string;
  label: string;
  description: string;
  actions: Array<[string, string]>;
};
const MODULES: ModuleDef[] = [
  {
    key: "membres",
    label: "Membres / Trombinoscope",
    description:
      "Consultation des fiches, données personnelles et gestion du cycle de vie des membres.",
    actions: [
      ["consulter", "Consulter"],
      ["modifier", "Modifier"],
      ["ajouter", "Ajouter"],
      ["inactiver", "Inactiver / réactiver"],
      ["corbeille", "Déplacer vers la corbeille"],
      ["exporter", "Exporter"],
    ],
  },
  {
    key: "poles",
    label: "Pôles",
    description: "Consultation, composition des pôles et gestion structurelle.",
    actions: [
      ["consulter", "Consulter"],
      ["gerer_membres", "Gérer les membres du pôle"],
      ["gerer_structure", "Créer / renommer / archiver un pôle"],
    ],
  },
  {
    key: "structure",
    label: "Structure / Organisation",
    description: "Fonctions de direction et structure organisationnelle.",
    actions: [
      ["consulter", "Consulter"],
      ["modifier", "Modifier la structure"],
    ],
  },
  {
    key: "programmes",
    label: "Programmes",
    description: "Création, modification, affectations, archivage et export des programmes.",
    actions: [
      ["consulter", "Consulter"],
      ["creer", "Créer"],
      ["modifier", "Modifier"],
      ["affecter", "Affecter des membres"],
      ["archiver", "Archiver"],
      ["exporter", "Exporter"],
    ],
  },
  {
    key: "planning",
    label: "Planning",
    description: "Planning général et exports de calendrier.",
    actions: [
      ["consulter", "Consulter"],
      ["exporter", "Exporter"],
    ],
  },
  {
    key: "sollicitations",
    label: "Demandes ponctuelles",
    description: "Demandes, réponses, modification et suivi des renforts/remplacements.",
    actions: [
      ["consulter", "Consulter"],
      ["creer", "Créer"],
      ["modifier", "Modifier / annuler"],
      ["repondre", "Répondre à ses demandes reçues"],
      ["repondre_autrui", "Répondre à la place d’autrui"],
      ["exporter", "Exporter"],
    ],
  },
  {
    key: "indisponibilites",
    label: "Indisponibilités",
    description: "Déclaration et validation des périodes d’indisponibilité.",
    actions: [
      ["consulter", "Consulter"],
      ["declarer", "Déclarer"],
      ["traiter", "Valider / réserver / refuser"],
    ],
  },
  {
    key: "modeles",
    label: "Modèles",
    description: "Modèles de programmes et paramètres réutilisables.",
    actions: [
      ["consulter", "Consulter"],
      ["gerer", "Autoriser la création / modification / archivage"],
    ],
  },
  {
    key: "formation",
    label: "Formation",
    description: "Suivi du parcours des membres en formation.",
    actions: [
      ["consulter", "Consulter"],
      ["gerer", "Gérer le suivi"],
    ],
  },
  {
    key: "evaluations",
    label: "Évaluations",
    description: "Workflow spécifique de création, révision, validation et confidentialité.",
    actions: [
      ["creer", "Créer une évaluation"],
      ["evaluer_pole", "Évaluer son pôle"],
      ["evaluer_referent", "Évaluer un Référent"],
      ["evaluer_responsable", "Évaluer le Responsable"],
      ["reviser", "Réviser"],
      ["valider", "Valider définitivement"],
      ["voir_avant_validation", "Voir avant validation"],
      ["resultats_agreges", "Voir les résultats agrégés"],
      ["identite_evaluateurs", "Voir l’identité des évaluateurs"],
      ["rouvrir", "Rouvrir une évaluation validée"],
    ],
  },
  {
    key: "post_service",
    label: "Post-service",
    description: "Clôture des programmes et constat du service réellement effectué.",
    actions: [
      ["consulter", "Consulter"],
      ["completer", "Compléter / valider"],
    ],
  },
  {
    key: "pilotage",
    label: "Pilotage",
    description: "Statistiques et aide à la décision selon le périmètre autorisé.",
    actions: [["consulter", "Consulter les indicateurs"]],
  },
  {
    key: "notifications",
    label: "Notifications / À faire",
    description: "Accès aux notifications et relances manuelles.",
    actions: [
      ["consulter", "Consulter"],
      ["relancer", "Relancer les personnes en attente"],
    ],
  },
  {
    key: "archives",
    label: "Archives / Corbeille",
    description: "Cycle Actif → Archivé → Corbeille → Suppression définitive.",
    actions: [
      ["consulter", "Consulter"],
      ["restaurer", "Restaurer"],
      ["supprimer_definitivement", "Supprimer définitivement"],
    ],
  },
  {
    key: "historique",
    label: "Historique / Audit",
    description: "Traçabilité des actions et événements accessibles au profil.",
    actions: [["consulter", "Consulter"]],
  },
  {
    key: "exports",
    label: "Exports",
    description: "Droit transversal d’utiliser le moteur d’export sur les données autorisées.",
    actions: [["utiliser", "Utiliser le moteur d’export"]],
  },
  {
    key: "parametres",
    label: "Paramètres",
    description: "Accès aux différentes familles de configuration.",
    actions: [
      ["identite", "Identité & accueil"],
      ["organisation", "Organisation"],
      ["acces", "Accès & droits"],
      ["menus", "Menus & modules"],
    ],
  },
  {
    key: "technique",
    label: "Administration technique",
    description: "Droits techniques, indépendants du rôle métier.",
    actions: [["administrer", "Administrer la couche technique"]],
  },
];

const keyOf = (r: Pick<Row, "role_key" | "module_key" | "action_key">) =>
  `${r.role_key}|${r.module_key}|${r.action_key}`;
const exKey = (r: Pick<ExceptionRow, "member_id" | "module_key" | "action_key">) =>
  `${r.member_id}|${r.module_key}|${r.action_key}`;

export function AccessRightsPanel() {
  const canEdit = useSettingsAccess();
  const qc = useQueryClient();
  const members = useQuery(membersQuery);
  const query = useQuery({
    queryKey: ["access-role-permissions"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("access_role_permissions")
        .select("*")
        .order("module_key");
      if (error) throw error;
      return data as Row[];
    },
  });
  const exceptionsQuery = useQuery({
    queryKey: ["access-user-exceptions"],
    enabled: canEdit,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("access_user_exceptions").select("*");
      if (error) throw error;
      return data as ExceptionRow[];
    },
  });
  const [role, setRole] = useState<RoleKey>("equipier");
  const [draft, setDraft] = useState<Record<string, Row>>({});
  const [dirty, setDirty] = useState(false);
  const [exceptionMember, setExceptionMember] = useState("");
  const [exceptionDraft, setExceptionDraft] = useState<Record<string, ExceptionRow>>({});
  const [exceptionDirty, setExceptionDirty] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    const next: Record<string, Row> = {};
    query.data.forEach((r) => (next[keyOf(r)] = r));
    setDraft(next);
    setDirty(false);
  }, [query.data]);
  useEffect(() => {
    if (!exceptionsQuery.data) return;
    const next: Record<string, ExceptionRow> = {};
    exceptionsQuery.data.forEach((r) => (next[exKey(r)] = r));
    setExceptionDraft(next);
    setExceptionDirty(false);
  }, [exceptionsQuery.data]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty || exceptionDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, exceptionDirty]);

  const activeMembers = useMemo(
    () => (members.data?.members ?? []).filter((m: any) => m.status === "active" && !m.archived),
    [members.data],
  );
  const getRow = (module_key: string, action_key: string): Row =>
    draft[`${role}|${module_key}|${action_key}`] ?? {
      role_key: role,
      module_key,
      action_key,
      scope: "interdit",
      enabled: false,
    };
  const change = (module_key: string, action_key: string, scope: Scope) => {
    const current = getRow(module_key, action_key);
    setDraft((d) => ({
      ...d,
      [keyOf(current)]: { ...current, scope, enabled: scope !== "interdit" },
    }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!canEdit) throw new Error("Consultation uniquement.");
      const rows = Object.values(draft);
      const { error } = await (supabase as any).from("access_role_permissions").upsert(
        rows.map(({ id, ...r }) => ({ ...r, updated_at: new Date().toISOString() })),
        { onConflict: "role_key,module_key,action_key" },
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Droits enregistrés");
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["access-role-permissions"] });
      await qc.invalidateQueries({ queryKey: ["program-editor-permissions"] });
    },
    onError: (e: any) => toast.error("Enregistrement impossible", { description: e.message }),
  });

  const reset = () => {
    if (!query.data) return;
    const next: Record<string, Row> = {};
    query.data.forEach((r) => (next[keyOf(r)] = r));
    setDraft(next);
    setDirty(false);
    toast.message("Modifications locales annulées");
  };

  const saveExceptions = useMutation({
    mutationFn: async () => {
      if (!canEdit) throw new Error("Consultation uniquement.");
      const all = Object.values(exceptionDraft);
      const changed = all.filter((x) => x.member_id && x.module_key && x.action_key);
      if (changed.length) {
        const { error } = await (supabase as any).from("access_user_exceptions").upsert(
          changed.map(({ id, ...r }) => ({ ...r, updated_at: new Date().toISOString() })),
          { onConflict: "member_id,module_key,action_key" },
        );
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success("Exceptions individuelles enregistrées");
      setExceptionDirty(false);
      await qc.invalidateQueries({ queryKey: ["access-user-exceptions"] });
    },
    onError: (e: any) => toast.error("Enregistrement impossible", { description: e.message }),
  });

  const selectedMember = activeMembers.find((m: any) => m.id === exceptionMember);
  const exceptionFor = (module_key: string, action_key: string) =>
    exceptionDraft[`${exceptionMember}|${module_key}|${action_key}`];
  const setException = (module_key: string, action_key: string, value: string) => {
    if (!exceptionMember) return;
    const k = `${exceptionMember}|${module_key}|${action_key}`;
    if (value === "inherit") {
      setExceptionDraft((d) => {
        const n = { ...d };
        delete n[k];
        return n;
      });
      setExceptionDirty(true);
      return;
    }
    const scope = value as Scope;
    setExceptionDraft((d) => ({
      ...d,
      [k]: {
        ...(d[k] ?? {}),
        member_id: exceptionMember,
        module_key,
        action_key,
        scope,
        enabled: scope !== "interdit",
      },
    }));
    setExceptionDirty(true);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" />
            Matrice des droits par rôle
          </CardTitle>
          <CardDescription>
            Les fonctions de direction restent dans Organisation. Ici, on règle uniquement les
            permissions métier par rôle de base. Admin technique reste indépendant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {ROLES.map(([k, l]) => (
              <Button
                key={k}
                type="button"
                variant={role === k ? "default" : "outline"}
                onClick={() => setRole(k)}
              >
                {l}
              </Button>
            ))}
          </div>
          <div className="rounded-xl border bg-muted/30 p-3 text-sm">
            <b>Périmètres :</b> Moi = uniquement les données/actions personnelles · Mon pôle =
            périmètre des pôles concernés · Tous = ensemble de la COM · Interdit = aucun accès.
          </div>
          {dirty ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              Modifications non enregistrées pour la matrice.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {MODULES.map((mod) => (
          <details
            key={mod.key}
            className="group rounded-2xl border bg-card"
            open={mod.key === "membres"}
          >
            <summary className="cursor-pointer list-none p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-black text-icc-violet">{mod.label}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{mod.description}</p>
                </div>
                <Badge variant="outline">{mod.actions.length} droit(s)</Badge>
              </div>
            </summary>
            <div className="border-t p-4">
              <div className="space-y-3">
                {mod.actions.map(([action, label]) => {
                  const r = getRow(mod.key, action);
                  return (
                    <div
                      key={action}
                      className="grid gap-2 rounded-xl bg-muted/30 p-3 md:grid-cols-[1fr_220px] md:items-center"
                    >
                      <div>
                        <p className="font-semibold">{label}</p>
                        {action === "repondre_autrui" ||
                        action === "supprimer_definitivement" ||
                        action === "identite_evaluateurs" ? (
                          <p className="text-xs text-muted-foreground">
                            Permission sensible — désactivée par défaut.
                          </p>
                        ) : null}
                      </div>
                      <select
                        disabled={!canEdit}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={r.scope}
                        onChange={(e) => change(mod.key, action, e.target.value as Scope)}
                      >
                        {SCOPES.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          </details>
        ))}
      </div>

      <div className="sticky bottom-3 z-10 flex flex-wrap gap-2 rounded-2xl border bg-background/95 p-3 shadow-lg backdrop-blur">
        <Button onClick={() => save.mutate()} disabled={!canEdit || !dirty || save.isPending}>
          <Save className="size-4" />
          {save.isPending ? "Enregistrement…" : "Enregistrer les droits"}
        </Button>
        <Button variant="outline" onClick={reset} disabled={!canEdit || !dirty}>
          <RotateCcw className="size-4" />
          Annuler les changements
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Exceptions individuelles</CardTitle>
          <CardDescription>
            Ajoute ou retire ponctuellement un droit à une personne sans modifier son rôle de base.
            L’exception prend le dessus sur la matrice.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-md">
            <Label className="mb-2 block">Membre</Label>
            <select
              disabled={!canEdit}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={exceptionMember}
              onChange={(e) => setExceptionMember(e.target.value)}
            >
              <option value="">Choisir un membre</option>
              {activeMembers.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </div>
          {selectedMember ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Exceptions pour <b>{selectedMember.full_name}</b>. « Hériter du rôle » supprime
                l’exception.
              </p>
              {MODULES.map((mod) => (
                <details key={mod.key} className="rounded-xl border">
                  <summary className="cursor-pointer list-none p-3 font-bold text-icc-violet">
                    {mod.label}
                  </summary>
                  <div className="space-y-2 border-t p-3">
                    {mod.actions.map(([action, label]) => {
                      const ex = exceptionFor(mod.key, action);
                      return (
                        <div
                          key={action}
                          className="grid gap-2 md:grid-cols-[1fr_220px] md:items-center"
                        >
                          <span className="text-sm">{label}</span>
                          <select
                            disabled={!canEdit}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            value={ex?.scope ?? "inherit"}
                            onChange={(e) => setException(mod.key, action, e.target.value)}
                          >
                            <option value="inherit">Hériter du rôle</option>
                            {SCOPES.map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))}
              {exceptionDirty ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                  Exceptions non enregistrées.
                </div>
              ) : null}
              <Button
                onClick={() => saveExceptions.mutate()}
                disabled={!canEdit || !exceptionDirty || saveExceptions.isPending}
              >
                <Save className="size-4" />
                {saveExceptions.isPending ? "Enregistrement…" : "Enregistrer les exceptions"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sélectionne un membre pour gérer ses exceptions.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
