import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Inbox as InboxIcon } from "lucide-react";

import { getNotifications, markNotificationRead, markAllNotificationsRead } from "@/lib/push.functions";
import { formatDateTime } from "@/lib/icc";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: rawNotifications } = useQuery({ queryKey: ["notifications"], queryFn: getNotifications, refetchInterval: 30_000 });
  const notifications = (rawNotifications ?? []).filter((n:any) => !n.archived_at && !n.deleted_at).slice(0, 12);

  useEffect(() => {
    const channel = supabase.channel("notification-bell-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => queryClient.invalidateQueries({ queryKey: ["notifications"] }))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  const unread = (rawNotifications ?? []).filter((n:any) => !n.read && !n.archived_at && !n.deleted_at).length;
  const markReadMut = useMutation({ mutationFn: (id: string) => markNotificationRead({ data: { id } }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }) });
  const markAllMut = useMutation({ mutationFn: () => markAllNotificationsRead(), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }) });
  function handleClick(id: string, link: string | null) { markReadMut.mutate(id); setOpen(false); if (link) navigate({ to: link }); }

  return <div className="relative"><button type="button" aria-label="Notifications" onClick={() => setOpen((o) => !o)} className="relative flex size-10 items-center justify-center rounded-lg text-inherit transition-colors hover:bg-white/15"><Bell className="size-5" />{unread > 0 && <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[0.6rem] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}</button>
    {open && <><div className="fixed inset-0 z-40" onClick={() => setOpen(false)} /><div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-lg lg:w-96"><div className="flex items-center justify-between border-b border-border px-4 py-3"><p className="font-display text-sm font-semibold">Notifications</p>{unread > 0 && <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => markAllMut.mutate()}><CheckCheck className="size-3.5" /> Tout marquer lu</Button>}</div><div className="max-h-80 overflow-y-auto">{notifications.length === 0 ? <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground"><InboxIcon className="size-8 opacity-40" />Aucune notification récente</div> : notifications.map((n:any) => <button key={n.id} type="button" onClick={() => handleClick(n.id, n.link)} className={cn("flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent/50", !n.read && "bg-primary/5")}><div className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} /><div className="min-w-0 flex-1"><p className={cn("text-sm", !n.read && "font-semibold")}>{n.title}</p>{n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}<p className="mt-1 text-[0.65rem] text-muted-foreground">{formatDateTime(n.created_at)}</p></div></button>)}</div><div className="border-t p-2"><Button asChild variant="ghost" className="w-full" onClick={()=>setOpen(false)}><Link to="/notifications">Voir toutes les notifications</Link></Button></div></div></>}
  </div>;
}
