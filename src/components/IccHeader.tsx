import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL, useCurrentRole } from "@/hooks/useAuth";
import { settingsQuery } from "@/lib/icc";
import { NotificationBell } from "@/components/NotificationBell";

export function IccHeader() {
  const { role, member, isStaff } = useCurrentRole();
  const settings = useQuery(settingsQuery);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rawBrand = (settings.data?.brand ?? "").trim();
  const brand = rawBrand && rawBrand.toUpperCase() !== "ICC" ? rawBrand : "LE MANS";
  const subtitle = settings.data?.subtitle ?? "Communication • Organisation • Service";
  const icon = settings.data?.icon_url ?? null;
  const initials = (member?.full_name ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const roleLabel = role ? ROLE_LABEL[role] : "Sans rôle";
  async function signOut() { setOpen(false); await supabase.auth.signOut(); await router.navigate({ to: "/auth" }); }
  return <header className="sticky top-0 z-50 bg-icc-violet text-white shadow-lg"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
    <Link to="/tableau-de-bord" className="flex items-center gap-3 text-left">{icon ? <span className="flex size-9 items-center justify-center overflow-hidden rounded-xl border border-white/20 bg-white/10 md:size-10"><img src={icon} alt="Logo" className="size-full object-contain" /></span> : null}<span className="rounded-xl bg-icc-yellow px-3 py-2 text-lg font-black tracking-wide text-icc-violet shadow md:text-xl">ICC</span><span className="leading-none"><span className="block text-lg font-black tracking-[.08em] text-white md:text-xl">{brand}</span><span className="mt-1 block text-[8px] font-semibold tracking-wide text-white/75 md:text-[9px]">{subtitle}</span></span></Link>
    <div className="flex items-center gap-2"><NotificationBell />{isStaff ? <Link to="/parametres" title="Paramètres" aria-label="Paramètres" className="rounded-lg p-2 text-base leading-none transition-colors hover:bg-icc-violet-hover">⚙️</Link> : null}
      <div className="relative"><button type="button" onClick={() => setOpen((o) => !o)} title="Mon compte" className="flex items-center gap-2 rounded-lg border border-white/30 bg-icc-violet-hover py-1.5 pl-1.5 pr-3 transition-colors hover:bg-white/10"><span className="flex size-6 items-center justify-center overflow-hidden rounded-full bg-white/20 text-[10px] font-black">{member?.photo_url ? <img src={member.photo_url} alt="" className="size-full object-cover" /> : initials}</span><span className="text-left leading-tight"><span className="block text-[10px] font-bold">{member?.full_name ?? "Mon compte"}</span><span className="mt-0.5 block text-[8px] font-semibold text-white/70">{roleLabel}</span></span></button>
      {open ? <div className="absolute right-0 z-[80] mt-2 w-72 overflow-hidden rounded-xl border border-border bg-white p-3 text-slate-800 shadow-2xl"><div className="px-2 pb-2"><p className="text-sm font-black text-icc-violet">{member?.full_name ?? "Compte"}</p><p className="mt-0.5 text-xs text-muted-foreground">{roleLabel}</p></div><div className="space-y-1 border-t border-border pt-2 text-sm"><Link to="/tableau-de-bord" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 font-semibold hover:bg-muted">📊 Tableau de bord</Link><Link to="/mon-profil" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 font-semibold hover:bg-muted">👤 Voir mon profil</Link><Link to="/preferences-notifications" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 font-semibold hover:bg-muted">🔔 Préférences & notifications</Link><Link to="/mes-appareils" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 font-semibold hover:bg-muted">📱 Mes appareils / Push</Link></div><button type="button" onClick={signOut} className="mt-2 w-full rounded-lg bg-icc-violet px-3 py-2 text-xs font-bold text-white">Se déconnecter</button></div> : null}</div>
    </div></div></header>;
}
