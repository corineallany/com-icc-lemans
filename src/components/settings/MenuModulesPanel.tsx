import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, RotateCcw, Save } from "lucide-react";
import { useSettingsAccess } from "@/hooks/useSettingsAccess";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
export type MenuModule = {
  key: string;
  label: string;
  enabled: boolean;
  menuVisible: boolean;
  order: number;
};
export const DEFAULT_MENU_MODULES: MenuModule[] = [
  { key: "planning", label: "Planning", enabled: true, menuVisible: true, order: 10 },
  { key: "programmes", label: "Programmes", enabled: true, menuVisible: true, order: 20 },
  { key: "trombinoscope", label: "Trombinoscope", enabled: true, menuVisible: true, order: 30 },
  { key: "formations", label: "Formations", enabled: true, menuVisible: true, order: 40 },
  {
    key: "sollicitations",
    label: "Demandes ponctuelles",
    enabled: true,
    menuVisible: true,
    order: 50,
  },
  { key: "poles", label: "Pôles", enabled: true, menuVisible: true, order: 60 },
  { key: "materiel_com", label: "Matériel COM", enabled: true, menuVisible: true, order: 70 },
  { key: "pilotage", label: "Pilotage", enabled: true, menuVisible: true, order: 80 },
  { key: "disponibilites", label: "Disponibilités", enabled: true, menuVisible: true, order: 90 },
  { key: "taches", label: "Tâches", enabled: true, menuVisible: true, order: 100 },
  { key: "modeles", label: "Modèles de programme", enabled: true, menuVisible: true, order: 110 },
  {
    key: "indisponibilites",
    label: "Indisponibilités",
    enabled: true,
    menuVisible: true,
    order: 120,
  },
  { key: "post_service", label: "Post-service", enabled: true, menuVisible: true, order: 130 },
  { key: "evaluations", label: "Évaluations", enabled: true, menuVisible: true, order: 140 },
  { key: "recherche", label: "Recherche", enabled: true, menuVisible: true, order: 150 },
  { key: "historique", label: "Historique", enabled: true, menuVisible: true, order: 160 },
  { key: "archives", label: "Archives & corbeille", enabled: true, menuVisible: true, order: 170 },
  { key: "exports", label: "Exports", enabled: true, menuVisible: true, order: 180 },
  {
    key: "nouveau_programme",
    label: "Nouveau programme",
    enabled: true,
    menuVisible: true,
    order: 190,
  },
  { key: "parametres", label: "Paramètres", enabled: true, menuVisible: true, order: 200 },
];
export function normalizeMenuModules(raw: any): MenuModule[] {
  const saved = Array.isArray(raw) ? raw : [];
  const byKey = new Map(saved.map((x: any) => [x.key, x]));
  return DEFAULT_MENU_MODULES.map((d) => {
    const s: any = byKey.get(d.key);
    return {
      ...d,
      ...s,
      key: d.key,
      order: Number.isFinite(Number(s?.order)) ? Number(s.order) : d.order,
    };
  })
    .sort((a, b) => a.order - b.order)
    .map((x, i) => ({ ...x, order: (i + 1) * 10 }));
}
export function MenuModulesPanel({ settings }: { settings: any }) {
  const canEdit = useSettingsAccess();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<MenuModule[]>(() => normalizeMenuModules(settings?.menus));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setDraft(normalizeMenuModules(settings?.menus));
    setDirty(false);
  }, [settings?.menus]);
  const update = (key: string, patch: Partial<MenuModule>) => {
    setDraft((x) => x.map((m) => (m.key === key ? { ...m, ...patch } : m)));
    setDirty(true);
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    setDraft((x) => {
      const n = [...x];
      [n[index], n[target]] = [n[target], n[index]];
      return n.map((m, i) => ({ ...m, order: (i + 1) * 10 }));
    });
    setDirty(true);
  };
  const reset = () => {
    setDraft(normalizeMenuModules(settings?.menus));
    setDirty(false);
    toast.message("Modifications locales annulées");
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!canEdit) throw new Error("Consultation uniquement.");
      const payload = draft.map((m, i) => ({
        ...m,
        label: m.label.trim() || DEFAULT_MENU_MODULES.find((d) => d.key === m.key)?.label || m.key,
        order: (i + 1) * 10,
      }));
      const { error } = await supabase
        .from("app_settings")
        .update({ menus: payload, updated_at: new Date().toISOString() } as any)
        .eq("id", "main");
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Menus & modules enregistrés");
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["app-settings"] });
    },
    onError: (e: any) => toast.error("Enregistrement impossible", { description: e.message }),
  });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Menus & modules</CardTitle>
          <CardDescription>
            Activez les fonctionnalités, choisissez celles affichées sur l’accueil, leur nom et leur
            ordre. Désactiver un module ne supprime aucune donnée.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 rounded-xl bg-muted/40 px-3 py-2 text-xs font-bold md:grid-cols-[1fr_110px_140px_110px]">
            <span>Module / nom affiché</span>
            <span className="text-center">Actif</span>
            <span className="hidden text-center md:block">Dans le menu</span>
            <span className="text-center">Ordre</span>
          </div>
          {draft.map((m, i) => (
            <div
              key={m.key}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl border p-3 md:grid-cols-[1fr_110px_140px_110px]"
            >
              <div>
                <Input
                  disabled={!canEdit}
                  value={m.label}
                  onChange={(e) => update(m.key, { label: e.target.value })}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">{m.key}</p>
                <div className="mt-2 flex items-center gap-2 md:hidden">
                  <span className="text-xs">Afficher dans le menu</span>
                  <Switch
                    checked={m.menuVisible}
                    disabled={!canEdit || !m.enabled}
                    onCheckedChange={(v) => update(m.key, { menuVisible: v })}
                  />
                </div>
              </div>
              <div className="flex justify-center">
                <Switch
                  disabled={!canEdit}
                  checked={m.enabled}
                  onCheckedChange={(v) =>
                    update(m.key, { enabled: v, menuVisible: v ? m.menuVisible : false })
                  }
                />
              </div>
              <div className="hidden justify-center md:flex">
                <Switch
                  checked={m.menuVisible}
                  disabled={!canEdit || !m.enabled}
                  onCheckedChange={(v) => update(m.key, { menuVisible: v })}
                />
              </div>
              <div className="flex justify-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  disabled={!canEdit || i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  disabled={!canEdit || i === draft.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          {dirty ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              Modifications non enregistrées.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save.mutate()} disabled={!canEdit || !dirty || save.isPending}>
              <Save className="size-4" />
              {save.isPending ? "Enregistrement…" : "Enregistrer les menus & modules"}
            </Button>
            <Button variant="outline" onClick={reset} disabled={!canEdit || !dirty}>
              <RotateCcw className="size-4" />
              Annuler les changements
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
