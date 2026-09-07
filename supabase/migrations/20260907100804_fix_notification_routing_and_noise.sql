do $$
declare
  ddl text;
  before_ddl text;
begin
  select pg_get_functiondef('icc_private.event_notification()'::regprocedure) into ddl;
  before_ddl := ddl;

  ddl := replace(
    ddl,
    'pid:=j->>''id''; members:=icc_private.program_members(pid);typ:=''programme_modification'';title:=''Programme modifié'';link:=''/programme/''||pid;',
    'pid:=j->>''id''; members:=icc_private.program_members(pid); SELECT coalesce(array_agg(DISTINCT x),''{}'') INTO members FROM (SELECT unnest(coalesce(members,''{}'')) x UNION SELECT unnest(icc_private.managers(a.pole_id)) x FROM public.program_assignments a WHERE a.program_id=pid) q WHERE x IS NOT NULL; typ:=''programme_modification'';title:=''Programme modifié'';link:=''/programme/''||pid;'
  );

  if ddl = before_ddl then
    raise exception 'event_notification source did not match expected version';
  end if;
  execute ddl;
end $$;

revoke all on function public.notification_worker_token() from public, anon, authenticated;
revoke all on function public.claim_notification_push(uuid) from public, anon, authenticated;
revoke all on function public.dispatch_notification_push() from public, anon, authenticated;
revoke all on function public.notify_solicitation_recipient() from public, anon, authenticated;
