import type { ReactNode } from "react";

function appHref(path = "/tableau-de-bord") {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${base}${path}`;
}

/**
 * Coquille volontairement autonome des pages internes.
 * IMPORTANT: ne pas importer ici de composants métier, hooks Supabase ou modules
 * optionnels. AppShell est chargé par presque toutes les routes; une dépendance
 * défaillante à ce niveau rendrait toute l'application interne inaccessible.
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
    window.location.assign(appHref());
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-icc-violet text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <a href={appHref()} className="flex items-center gap-3 text-left">
            <span className="rounded-xl bg-icc-yellow px-3 py-2 text-lg font-black tracking-wide text-icc-violet shadow md:text-xl">ICC</span>
            <span className="leading-none">
              <span className="block text-lg font-black tracking-[.08em] text-white md:text-xl">LE MANS</span>
              <span className="mt-1 block text-[8px] font-semibold tracking-wide text-white/75 md:text-[9px]">Communication • Organisation • Service</span>
            </span>
          </a>
          <a href={appHref()} className="rounded-lg border border-white/30 px-3 py-2 text-xs font-bold hover:bg-white/10">Accueil</a>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-icc-violet">{title}</h2>
            {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <button type="button" onClick={goBack} className="text-xs font-bold text-icc-violet hover:underline">← Retour</button>
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
