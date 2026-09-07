import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL, useCurrentRole } from "@/hooks/useAuth";
import { settingsQuery } from "@/lib/icc";
import { PERIOD_LABELS, type DashboardPeriod } from "@/lib/period";
import { NotificationBell } from "@/components/NotificationBell";

function readPeriod():DashboardPeriod{
  if(typeof window==="undefined")return"month";
  try{
    const saved=window.localStorage.getItem("icc-dashboard-period") as DashboardPeriod|null;
    return saved&&Object.keys(PERIOD_LABELS).includes(saved)?saved:"month";
  }catch{
    return"month";
  }
}

export function IccHeader() {
  const { role, member, isStaff } = useCurrentRole();
  const settings = useQuery(settingsQuery);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dashboardOpen,setDashboardOpen]=useState(false);
  const [period,setPeriod]=useState<DashboardPeriod>(readPeriod);
  const rawBrand = (settings.data?.brand ?? "").trim();
  const brand = rawBrand && rawBrand.toUpperCase() !== "ICC" ? rawBrand : "LE MANS";
  const subtitle = settings.data?.subtitle ?? "Communication • Organisation • Service";
  const icon = settings.data?.icon_url ?? null;
  const initials = (member?.full_name ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const roleLabel = role ? ROLE_LABEL[role] : "Sans rôle";
  async function signOut() { setOpen(false); await supabase.auth.signOut(); await router.navigate({ to: "/auth" }); }
  function changePeriod(value:DashboardPeriod){
    setPeriod(value);
    if(typeof window!=="undefined"){
      try{window.localStorage.setItem("icc-dashboard-period",value);}catch{}
      window.dispatchEvent(new Event("icc-dashboard-period-change"));
    }
  }
  return <header className="sticky top-0 z-50 bg-icc-violet text-white shadow-lg"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
    <Link to="/tableau-de-bord" className="flex items-center gap-3 text-left">{icon ? <span className="flex size-9 items-center justify-center overflow-hidden rounded-xl border border-white/20 bg-white/10 md:size-10"><img src={icon} alt="Logo" className="size-full object-contain" /></span> : null}<span className="rounded-xl bg-icc-yellow px-3 py-2 text-lg font-black tracking-wide text-icc-violet shadow md:text-xl">ICC</span><span className="leading-none"><span className="block text-lg font-black tracking-[.08em] text-white md:text-xl">{brand}</span><span className="mt-1 block text-[8px] font-semibold tracking-wide text-white/75 md:text-[9px]">{subtitle}</span></span></Link>
    <div className="flex items-center gap-2"><NotificationBell />{isStaff ? <Link to="/parametres" title="Paramètres" aria-label="Paramètres" className="rounded-lg p-2 text-base leading-none transition-colors hover:bg-icc-violet-hover">⚙️</Link> : null}
      <div className="relative"><button type="button" onClick={() => setOpen((o) => !o)} title="Mon compte" className="flex items-center gap-2 rounded-lg border border-white/30 bg-icc-violet-hover py-1.5 pl-1.5 pr-3 transition-colors hover:bg-white/10"><span className="flex size-6 items-center justify-center overflow-hidden rounded-full bg-white/20 text-[10px] font-black">{member?.photo_url ? <img src={member.photo_url} alt="" className="size-full object-cover" /> : initials}</span><span className="text-left leading-tight"><span className="block text-[10px] font-bold">{member?.full_name ?? "Mon compte"}</span><span className="mt-0.5 block text-[8px] font-semibold text-white/70">{roleLabel}</span></span></button>
      {open ? <div className="absolute right-0 z-[80] mt-2 w-72 overflow-hidden rounded-xl border border-border bg-white p-3 text-slate-800 shadow-2xl"><div className="px-2 pb-2"><p className="text-sm font-black text-icc-violet">{member?.full_name ?? "Compte"}</p><p className="mt-0.5 text-xs text-muted-foreground">{roleLabel}</p></div><div className="space-y-1 border-t border-border pt-2 text-sm">
        <div className="rounded-lg border border-transparent hover:border-border"><button type="button" onClick={()=>setDashboardOpen(v=>!v)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-semibold hover:bg-muted"><span>📊 Tableau de bord</span><ChevronDown className={`size-4 transition-transform ${dashboardOpen?"rotate-180":""}`}/></button>{dashboardOpen?<div className="mx-2 mb-2 rounded-lg bg-muted/45 p-2"><Link to="/tableau-de-bord" onClick={() => setOpen(false)} className="mb-2 block rounded-md px-2 py-1.5 text-xs font-bold text-icc-violet hover:bg-background">Ouvrir le tableau de bord</Link><label className="block px-2"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-muted-foreground">Période</span><select aria-label="Période du tableau de bord" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-semibold" value={period} onChange={e=>changePeriod(e.target.value as DashboardPeriod)}>{Object.entries(PERIOD_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>:null}</div>
        <Link to="/mon-profil" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 font-semibold hover:bg-muted">👤 Voir mon profil</Link><Link to="/preferences-notifications" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 font-semibold hover:bg-muted">🔔 Préférences & notifications</Link><Link to="/mes-appareils" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 font-semibold hover:bg-muted">📱 Mes appareils / Push</Link></div><button type="button" onClick={signOut} className="mt-2 w-full rounded-lg bg-icc-violet px-3 py-2 text-xs font-bold text-white">Se déconnecter</button></div> : null}</div>
    </div></div></header>;
}
