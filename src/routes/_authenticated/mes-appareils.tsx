import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Laptop, MonitorSmartphone, RefreshCw, Smartphone, Trash2 } from "lucide-react";
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
type DeviceInfo={title:string;brand:string;model:string;browser:string;kind:"phone"|"tablet"|"computer"|"device"};

function deviceInfo(ua:string|null):DeviceInfo{
  const s=ua??"";
  let brand="";let model="";let kind:DeviceInfo["kind"]="device";
  if(/iPhone/i.test(s)){brand="Apple";model="iPhone";kind="phone"}
  else if(/iPad/i.test(s)){brand="Apple";model="iPad";kind="tablet"}
  else if(/Android/i.test(s)){
    kind=/Mobile/i.test(s)?"phone":"tablet";
    const raw=(s.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|;|\))/i)?.[1]??"").trim();
    model=raw||"Android";
    brand=/^SM-|^GT-|SAMSUNG/i.test(model)?"Samsung":/Pixel/i.test(model)?"Google":/^CPH|OPPO/i.test(model)?"OPPO":/^RMX|realme/i.test(model)?"realme":/^V\d|vivo/i.test(model)?"vivo":/HUAWEI|^ANA-|^ELS-|^VOG-/i.test(model)?"Huawei":/Xiaomi|Redmi|POCO|^M\d/i.test(model)?"Xiaomi":"Android";
  }else if(/Windows/i.test(s)){brand="PC";model="Windows";kind="computer"}
  else if(/Macintosh|Mac OS X/i.test(s)){brand="Apple";model="Mac";kind="computer"}
  else if(/CrOS/i.test(s)){brand="Chromebook";model="ChromeOS";kind="computer"}
  else {brand="Appareil";model="inconnu"}
  const browser=/Edg\//i.test(s)?"Edge":/OPR\//i.test(s)?"Opera":/CriOS|Chrome\//i.test(s)?"Chrome":/FxiOS|Firefox\//i.test(s)?"Firefox":/Safari\//i.test(s)?"Safari":"Navigateur";
  const title=brand==="PC"?`${model} • ${browser}`:brand===model?`${brand} • ${browser}`:`${brand} ${model} • ${browser}`;
  return{title,brand,model,browser,kind};
}
function formatDate(value:string){return new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value))}

function DeviceIcon({kind}:{kind:DeviceInfo["kind"]}){return kind==="computer"?<Laptop className="size-4 text-icc-violet"/>:<Smartphone className="size-4 text-icc-violet"/>}

function MesAppareils() {
  const { userId } = useCurrentRole();
  const push = usePush(userId);
  const qc=useQueryClient();
  const router=useRouter();
  const devices=useQuery({queryKey:["my-push-devices",userId],enabled:!!userId,queryFn:async()=>{const{data,error}=await db().from("icc_push_subscriptions").select("id,endpoint,user_agent,enabled,created_at,updated_at").eq("user_id",userId).order("updated_at",{ascending:false});if(error)throw error;return(data??[]) as DeviceRow[]}});
  const toggle=useMutation({mutationFn:async({row,enabled}:{row:DeviceRow;enabled:boolean})=>{if(enabled&&row.endpoint===push.currentEndpoint&&!push.subscribed){await push.enable();return}const{error}=await db().from("icc_push_subscriptions").update({enabled,updated_at:new Date().toISOString()}).eq("id",row.id).eq("user_id",userId);if(error)throw error},onSuccess:()=>qc.invalidateQueries({queryKey:["my-push-devices",userId]})});
  const remove=useMutation({mutationFn:async(row:DeviceRow)=>{const current=row.endpoint===push.currentEndpoint;if(current)await push.disable();const{error}=await db().from("icc_push_subscriptions").delete().eq("id",row.id).eq("user_id",userId);if(error)throw error;if(current){await supabase.auth.signOut();await router.navigate({to:"/auth"})}},onSuccess:()=>qc.invalidateQueries({queryKey:["my-push-devices",userId]})});
  const refresh=()=>qc.invalidateQueries({queryKey:["my-push-devices",userId]});
  const enableCurrent=async()=>{await push.enable();await qc.invalidateQueries({queryKey:["my-push-devices",userId]})};
  const rows=devices.data??[];
  const currentRow=rows.find(r=>r.endpoint===push.currentEndpoint);
  const currentInfo=deviceInfo(typeof navigator!=="undefined"?navigator.userAgent:null);
  return <AppShell title="Mes appareils / Push" subtitle="Gérez les notifications Push de chaque appareil enregistré">
    <div className="space-y-4">
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><MonitorSmartphone className="size-5"/> Appareil actuel</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><b className="text-base">{currentInfo.title}</b><p className="mt-1 text-xs text-muted-foreground">Marque : {currentInfo.brand} · Modèle : {currentInfo.model} · Navigateur : {currentInfo.browser}</p></div><Badge variant={currentRow?.enabled&&push.subscribed?"default":"secondary"}>{currentRow?.enabled&&push.subscribed?"Push activé":"Push désactivé"}</Badge></div></div>
          {push.state === "unsupported" ? <p className="text-muted-foreground">Les notifications push ne sont pas supportées sur ce navigateur.</p> : push.state === "denied" ? <p className="text-destructive">Les notifications sont bloquées dans les réglages du navigateur.</p> : currentRow?.enabled&&push.subscribed ? <Button variant="outline" onClick={()=>toggle.mutate({row:currentRow,enabled:false})} disabled={toggle.isPending}><BellOff className="size-4"/> Désactiver les Push</Button> : <Button onClick={currentRow?()=>toggle.mutate({row:currentRow,enabled:true}):enableCurrent} disabled={push.state === "loading"||toggle.isPending}><Bell className="size-4"/> Activer les Push</Button>}
          {push.error ? <p className="text-xs text-destructive">{push.error}</p> : null}
        </CardContent>
      </Card>

      <Card><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle className="text-base">Appareils enregistrés</CardTitle><p className="mt-1 text-xs text-muted-foreground">Tous les appareils restent enregistrés jusqu’à leur suppression.</p></div><Button size="sm" variant="outline" onClick={refresh}><RefreshCw className="size-4"/> Actualiser</Button></div></CardHeader>
        <CardContent className="space-y-3">
          {devices.isLoading?<p className="text-sm text-muted-foreground">Chargement des appareils…</p>:devices.isError?<p className="text-sm text-destructive">Impossible de charger vos appareils enregistrés.</p>:rows.length===0?<p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aucun appareil enregistré pour le moment.</p>:rows.map(row=>{const current=row.endpoint===push.currentEndpoint;const info=deviceInfo(row.user_agent);return <div key={row.id} className="rounded-xl border p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 gap-3"><span className="mt-0.5 rounded-lg bg-muted p-2"><DeviceIcon kind={info.kind}/></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b>{info.title}</b>{current?<Badge>Appareil actuel</Badge>:null}<Badge variant={row.enabled?"default":"secondary"}>{row.enabled?"Push actif":"Push désactivé"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Marque : {info.brand} · Modèle : {info.model} · Navigateur : {info.browser}</p><p className="mt-1 text-xs text-muted-foreground">Enregistré le {formatDate(row.created_at)} · Mis à jour le {formatDate(row.updated_at)}</p></div></div><div className="flex flex-wrap gap-2 sm:justify-end">{row.enabled?<Button size="sm" variant="outline" disabled={toggle.isPending} onClick={()=>toggle.mutate({row,enabled:false})}><BellOff className="size-4"/> Désactiver</Button>:<Button size="sm" variant="outline" disabled={toggle.isPending} onClick={()=>toggle.mutate({row,enabled:true})}><Bell className="size-4"/> Activer</Button>}<Button size="sm" variant="destructive" disabled={remove.isPending} onClick={()=>remove.mutate(row)}><Trash2 className="size-4"/> {current?"Supprimer / me déconnecter":"Supprimer"}</Button></div></div></div>})}
          {toggle.error?<p className="text-xs text-destructive">Impossible de modifier l’état Push de cet appareil.</p>:null}
          {remove.error?<p className="text-xs text-destructive">Impossible de supprimer cet appareil. Réessayez après actualisation.</p>:null}
          <p className="text-[11px] text-muted-foreground">Pour des raisons de confidentialité du navigateur, certains modèles exacts (notamment certains iPhone et ordinateurs) ne sont pas transmis au site ; la marque, la famille d’appareil et le navigateur restent affichés.</p>
        </CardContent>
      </Card>
    </div>
  </AppShell>;
}
