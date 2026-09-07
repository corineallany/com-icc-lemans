import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Bell, CheckCheck, Eye, EyeOff, Trash2, Undo2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/icc";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/notifications")({ component: NotificationsPage });
type Filter = "all"|"unread"|"archived"|"program"|"task"|"solicitation";

function NotificationsPage(){
 const qc=useQueryClient();
 const navigate=useNavigate();
 const [filter,setFilter]=useState<Filter>("all");
 const [selected,setSelected]=useState<Set<string>>(new Set());
 const q=useQuery({
  queryKey:["notification-center"],
  queryFn:async()=>{
   const {data:{user}}=await supabase.auth.getUser();
   if(!user)return[];
   const {data,error}=await (supabase as any).from("notifications").select("*")
    .eq("user_id",user.id).eq("in_app_visible",true).is("deleted_at",null)
    .order("created_at",{ascending:false}).limit(500);
   if(error)throw error;
   return data??[];
  },
  refetchOnWindowFocus:true,
  refetchOnReconnect:true,
 });
 const rows=useMemo(()=> (q.data??[]).filter((n:any)=>{if(filter==="unread")return !n.read&&!n.archived_at;if(filter==="archived")return !!n.archived_at;if(filter==="program")return !n.archived_at&&(n.entity_type==="program"||String(n.type).includes("programme"));if(filter==="task")return !n.archived_at&&String(n.type).includes("task");if(filter==="solicitation")return !n.archived_at&&String(n.type).includes("sollicit");return !n.archived_at;}),[q.data,filter]);
 const refresh=()=>{void qc.invalidateQueries({queryKey:["notification-center"]});void qc.invalidateQueries({queryKey:["notifications"]});};
 function updateCaches(ids:string[],values:any){
  const apply=(old:any)=>Array.isArray(old)?old.map((n:any)=>ids.includes(n.id)?{...n,...values}:n):old;
  qc.setQueryData(["notification-center"],apply);
  qc.setQueryData(["notifications"],apply);
 }
 async function patch(ids:string[], values:any){
  if(!ids.length)return true;
  const {data:{user}}=await supabase.auth.getUser();
  if(!user){toast.error("Session absente");return false;}
  const payload={...values,updated_at:new Date().toISOString()};
  const {error}=await (supabase as any).from("notifications").update(payload).eq("user_id",user.id).in("id",ids);
  if(error){toast.error(error.message);return false;}
  updateCaches(ids,payload);
  setSelected(new Set());
  refresh();
  return true;
 }
 async function remove(ids:string[]){
  if(!ids.length||!confirm(`Supprimer ${ids.length>1?"ces notifications":"cette notification"} ? Cette action ne supprime pas l’élément concerné.`))return;
  const {data:{user}}=await supabase.auth.getUser();
  if(!user){toast.error("Session absente");return;}
  const {error}=await (supabase as any).from("notifications").delete().eq("user_id",user.id).in("id",ids);
  if(error){toast.error(error.message);return;}
  setSelected(new Set());refresh();toast.success("Notification supprimée");
 }
 async function openNotification(n:any){
  if(!n.read){
   const ok=await patch([n.id],{read:true,read_at:new Date().toISOString()});
   if(!ok)return;
  }
  if(n.link)navigate({to:n.link});
 }
 const ids=[...selected];
 const toggle=(id:string)=>setSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
 return <AppShell title="Notifications"><div className="mx-auto max-w-4xl space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-xl font-black"><Bell className="size-5"/>Centre de notifications</h1><p className="text-sm text-muted-foreground">Retrouvez, suivez et archivez vos notifications.</p></div><Button variant="outline" onClick={()=>patch((q.data??[]).filter((n:any)=>!n.read&&!n.archived_at).map((n:any)=>n.id),{read:true,read_at:new Date().toISOString()})}><CheckCheck className="mr-1 size-4"/>Tout marquer lu</Button></div>
  <div className="flex flex-wrap gap-2">{([['all','Toutes'],['unread','Non lues'],['archived','Archivées'],['program','Programmes'],['task','Tâches'],['solicitation','Sollicitations']] as [Filter,string][]).map(([k,l])=><Button key={k} size="sm" variant={filter===k?"default":"outline"} onClick={()=>setFilter(k)}>{l}</Button>)}</div>
  {ids.length>0&&<div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 shadow"><b className="text-xs">{ids.length} sélectionnée{ids.length>1?'s':''}</b><Button size="sm" variant="outline" onClick={()=>patch(ids,{read:true,read_at:new Date().toISOString()})}><Eye className="mr-1 size-3.5"/>Lues</Button><Button size="sm" variant="outline" onClick={()=>patch(ids,{read:false,read_at:null})}><EyeOff className="mr-1 size-3.5"/>Non lues</Button>{filter==='archived'?<Button size="sm" variant="outline" onClick={()=>patch(ids,{archived_at:null})}><Undo2 className="mr-1 size-3.5"/>Désarchiver</Button>:<Button size="sm" variant="outline" onClick={()=>patch(ids,{archived_at:new Date().toISOString()})}><Archive className="mr-1 size-3.5"/>Archiver</Button>}<Button size="sm" variant="destructive" onClick={()=>remove(ids)}><Trash2 className="mr-1 size-3.5"/>Supprimer</Button></div>}
  <div className="overflow-hidden rounded-xl border bg-card">{rows.length===0?<div className="p-10 text-center text-sm text-muted-foreground">Aucune notification dans cette vue.</div>:rows.map((n:any)=><div key={n.id} className={`flex gap-3 border-b p-4 last:border-0 ${!n.read?'bg-primary/5':''}`}><input type="checkbox" className="mt-1" checked={selected.has(n.id)} onChange={()=>toggle(n.id)}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className={!n.read?'font-bold':'font-medium'}>{n.title}</p>{n.body&&<p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}<p className="mt-1 text-xs text-muted-foreground">{formatDateTime(n.created_at)}</p></div><div className="flex flex-wrap gap-1">{n.link&&<Button size="sm" variant="outline" onClick={()=>void openNotification(n)}>Ouvrir</Button>}<Button size="icon" variant="ghost" title={n.read?'Remettre en non lu':'Marquer comme lu'} onClick={()=>patch([n.id],n.read?{read:false,read_at:null}:{read:true,read_at:new Date().toISOString()})}>{n.read?<EyeOff className="size-4"/>:<Eye className="size-4"/>}</Button>{n.archived_at?<Button size="icon" variant="ghost" title="Désarchiver" onClick={()=>patch([n.id],{archived_at:null})}><Undo2 className="size-4"/></Button>:<Button size="icon" variant="ghost" title="Archiver" onClick={()=>patch([n.id],{archived_at:new Date().toISOString()})}><Archive className="size-4"/></Button>}<Button size="icon" variant="ghost" title="Supprimer" onClick={()=>remove([n.id])}><Trash2 className="size-4"/></Button></div></div></div></div>)}</div>
 </div></AppShell>;
}
