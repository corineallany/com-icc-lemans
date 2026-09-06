import type { ReactNode } from "react";

import { FinanceCorrectionShortcut } from "@/components/FinanceCorrectionShortcut";
import { FinanceSettingsShortcut } from "@/components/FinanceSettingsShortcut";
import { IccHeader } from "@/components/IccHeader";

/**
 * Coquille unique de l'application : en-tête violet ICC, contenu centré,
 * titre de page violet et bouton « ← Retour ».
 * Le retour suit l'historique réel de navigation au lieu de renvoyer systématiquement à l'accueil.
 */
export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  function goBack() {
    if (typeof window === "undefined") return;
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.assign(`${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, "/tableau-de-bord")}`);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <IccHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-icc-violet">{title}</h2>
            {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {title === "Caisse fraternelle" ? <FinanceSettingsShortcut /> : null}
            {title === "Caisse fraternelle" ? <FinanceCorrectionShortcut /> : null}
            <button type="button" onClick={goBack} className="text-xs font-bold text-icc-violet hover:underline">
              ← Retour
            </button>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <p className="text-base font-black">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
