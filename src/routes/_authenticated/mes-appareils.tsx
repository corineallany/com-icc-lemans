import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, MonitorSmartphone, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCurrentRole } from "@/hooks/useAuth";
import { usePush } from "@/hooks/usePush";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/mes-appareils")({ component: MesAppareils });
const db = () => supabase as any;

type DeviceRow = { id:number; endpoint:string; user_agent:string|null; enabled:boolean; created_at:string; updated_at:string };

function deviceLabel(ua:string|null){
  const s=ua??"";
  const os=/iPhone/i.test(s)?"iPhone":/iPad/i.test(s)?"iPad":/Android/i.test(s)?"Android":/Windows/i.test(s)?"Windows":/Macintosh|Mac OS X/i.test(s)?"Mac":"Appareil";
  const browser=/Edg\//i.test(s)?"Edge":/OPR\//i.test(s)?"Opera":/CriOS|Chrome\//i.test(s)?"Chrome":/Firefox\//i.test(s)?"Firefox":/Safari\//i.test(s)?"Safari":"Navigateur";
  return `${os} • ${browser}`;
}
function formatDate(value:string){return new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value))}

function MesAppareils() {
  const { userId } = useCurrentRole();
  const push = usePush(userId);
  const qc=useQueryClient();
  const devices=useQuery({queryKey:["my-push-devices",userId],enabled:!!userId,queryFn:async()=>{const{data,error}=await db().from("icc_push_subscriptions").select("id,endpoint,user_agent,enabled,created_at,updated_at").eq("user_id",userId).order("updated_at",{ascending:false});if(error)throw error;return(data??[]) as DeviceRow[]}});
  const remove=useMutation({mutationFn:async(row:DeviceRow)=>{if(row.endpoint===push.currentEndpoint)await push.disable();const{error}=await db().from("icc_push_subscriptions").delete().eq("id",row.id).eq("user_id",userId);if(error)throw error},onSuccess:()=>qc.invalidateQueries({queryKey:["my-push-devices",userId]})});
  const refresh=()=>qc.invalidateQueries({queryKey:["my-push-devices",userId]});
  const enableCurrent=async()=>{await push.enable();await qc.invalidateQueries({queryKey:["my-push-devices",userId]})};
  const rows=devices.data??[];
  return <AppShell title="Mes appareils / Push" subtitle="Tous vos appareils enregistrés restent ici jusqu’à ce que vous les supprimiez">
    <div className="space-y-4">
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><MonitorSmartphone className="size-5"/> Appareil actuel</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-lg border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><b>{deviceLabel(typeof navigator!=="undefined"?navigator.userAgent:null)}</b><Badge variant={push.subscribed ? "default" : "secondary"}>{push.subscribed ? "Push activé" : "Push désactivé"}</Badge></div><p className="mt-2 break-words text-xs text-muted-foreground">{typeof navigator!=="undefined"?navigator.userAgent:"Cet appareil"}</p></div>
          {push.state === "unsupported" ? <p className="text-muted-foreground">Les notifications push ne sont pas supportées sur ce navigateur.</p> : push.state === "denied" ? <p className="text-destructive">Les notifications sont bloquées dans les réglages du navigateur.</p> : push.subscribed ? <Button variant="outline" onClick={push.disable}><BellOff className="size-4"/> Désactiver sur cet appareil</Button> : <Button onClick={enableCurrent} disabled={push.state === "loading"}><Bell className="size-4"/> Activer les notifications sur cet appareil</Button>}
          {push.error ? <p className="text-xs text-destructive">{push.error}</p> : null}
        </CardContent>
      </Card>

      <Card><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle className="text-base">Appareils enregistrés</CardTitle><p className="mt-1 text-xs text-muted-foreground">Un appareil reste enregistré même si vous utilisez ensuite un autre téléphone ou ordinateur.</p></div><Button size="sm" variant="outline" onClick={refresh}><RefreshCw className="size-4"/> Actualiser</Button></div></CardHeader>
        <CardContent className="space-y-3">
          {devices.isLoading?<p className="text-sm text-muted-foreground">Chargement des appareils…</p>:devices.isError?<p className="text-sm text-destructive">Impossible de charger vos appareils enregistrés.</p>:rows.length===0?<p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aucun appareil enregistré pour le moment.</p>:rows.map(row=>{const current=row.endpoint===push.currentEndpoint;return <div key={row.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 gap-3"><span className="mt-0.5 rounded-lg bg-muted p-2"><Smartphone className="size-4 text-icc-violet"/></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b>{deviceLabel(row.user_agent)}</b>{current?<Badge>Appareil actuel</Badge>:null}<Badge variant={row.enabled?"default":"secondary"}>{row.enabled?"Push actif":"Push désactivé"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Enregistré le {formatDate(row.created_at)} · Mis à jour le {formatDate(row.updated_at)}</p><p className="mt-1 break-words text-[11px] text-muted-foreground">{row.user_agent||"Informations navigateur indisponibles"}</p></div></div><Button size="sm" variant="destructive" disabled={remove.isPending} onClick={()=>remove.mutate(row)}><Trash2 className="size-4"/> Supprimer</Button></div></div>})}
          {remove.error?<p className="text-xs text-destructive">Impossible de supprimer cet appareil.</p>:null}
        </CardContent>
      </Card>
    </div>
  </AppShell>;
}
