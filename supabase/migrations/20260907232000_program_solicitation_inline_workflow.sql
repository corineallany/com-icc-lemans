-- Inline program participation solicitations: distinct from general one-off solicitations.
create or replace function public.solicit_program_member(p_assignment_id uuid, p_member_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare pid text; pol uuid; ttl text; uid uuid; existing_mode text;
begin
  select program_id,pole_id into pid,pol from public.program_assignments where id=p_assignment_id;
  if pid is null then raise exception 'Besoin introuvable.'; end if;
  if not public.scope_allows_pole(auth.uid(),'programmes','affecter',pol) then raise exception 'Vous ne pouvez pas solliciter pour ce pôle.'; end if;
  if not exists(select 1 from public.members where id=p_member_id and status='active' and coalesce(deleted,false)=false) then raise exception 'Ce membre est inactif ou introuvable.'; end if;
  select assignment_mode into existing_mode from public.program_assignment_members where assignment_id=p_assignment_id and member_id=p_member_id;
  if existing_mode in ('direct','proposal') then raise exception 'Cette personne est déjà affectée à ce pôle.'; end if;
  insert into public.program_assignment_members(assignment_id,member_id,assignment_mode,assigned_at,assigned_by,process_status,process_closed_at,process_closed_reason)
  values(p_assignment_id,p_member_id,'solicited',null,null,'active',null,null)
  on conflict(assignment_id,member_id) do update set assignment_mode='solicited',assigned_at=null,assigned_by=null,process_status='active',process_closed_at=null,process_closed_reason=null;
  insert into public.program_member_responses(id,program_id,member_id,status,reason,reserve,updated_at)
  values(pid||'__'||p_member_id,pid,p_member_id,'pending',null,null,now())
  on conflict(program_id,member_id) do update set status='pending',reason=null,reserve=null,updated_at=now();
  select title into ttl from public.programs where id=pid;
  select auth_user_id into uid from public.members where id=p_member_id;
  if uid is not null then
    insert into public.notifications(user_id,member_id,type,title,body,link,read,entity_type,entity_id,idempotency_key)
    values(uid,p_member_id,'reponse_attendue','Réponse attendue — '||coalesce(ttl,'Programme'),'Vous êtes sollicité(e) pour participer au programme « '||coalesce(ttl,'Programme')||' ». Merci d’accepter, d’accepter partiellement ou de refuser.','/programme/'||pid,false,'program',pid,'program-solicit:'||pid||':'||p_assignment_id::text||':'||p_member_id||':'||extract(epoch from clock_timestamp())::text);
  end if;
end $$;

create or replace function public.cancel_program_solicitation(p_assignment_member_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r public.program_assignment_members%rowtype; pid text; pol uuid; ttl text; uid uuid;
begin
  select * into r from public.program_assignment_members where id=p_assignment_member_id;
  if not found then raise exception 'Sollicitation introuvable.'; end if;
  if r.assignment_mode <> 'solicited' then raise exception 'Cette ligne n’est pas une sollicitation.'; end if;
  select program_id,pole_id into pid,pol from public.program_assignments where id=r.assignment_id;
  if not public.scope_allows_pole(auth.uid(),'programmes','affecter',pol) then raise exception 'Vous ne pouvez pas annuler cette sollicitation.'; end if;
  delete from public.program_assignment_member_slots where assignment_member_id=r.id;
  delete from public.program_assignment_members where id=r.id;
  delete from public.program_member_responses where program_id=pid and member_id=r.member_id;
  select title into ttl from public.programs where id=pid;
  select auth_user_id into uid from public.members where id=r.member_id;
  if uid is not null then
    insert into public.notifications(user_id,member_id,type,title,body,link,read,entity_type,entity_id,idempotency_key)
    values(uid,r.member_id,'programme_retrait','Sollicitation annulée — '||coalesce(ttl,'Programme'),'La demande de participation au programme « '||coalesce(ttl,'Programme')||' » a été annulée.','/programme/'||pid,false,'program',pid,'program-solicit-cancel:'||pid||':'||r.member_id||':'||extract(epoch from clock_timestamp())::text);
  end if;
end $$;

create or replace function public.respond_to_program_solicitation(p_program_id text,p_status public.response_status,p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare mid text; clean text;
begin
  select id into mid from public.members where auth_user_id=auth.uid() and status='active' and coalesce(deleted,false)=false limit 1;
  if mid is null then raise exception 'Compte non lié à un membre actif.'; end if;
  if p_status not in ('available','partial','unavailable') then raise exception 'Réponse invalide.'; end if;
  if not exists(select 1 from public.program_assignment_members pam join public.program_assignments pa on pa.id=pam.assignment_id where pa.program_id=p_program_id and pam.member_id=mid and pam.assignment_mode='solicited' and pam.process_status='active') then raise exception 'Aucune sollicitation active ne nécessite votre réponse pour ce programme.'; end if;
  clean:=nullif(btrim(coalesce(p_note,'')),'');
  insert into public.program_member_responses(id,program_id,member_id,status,reserve,reason,updated_at)
  values(p_program_id||'__'||mid,p_program_id,mid,p_status,case when p_status='partial' then clean else null end,case when p_status='unavailable' then clean else null end,now())
  on conflict(program_id,member_id) do update set status=excluded.status,reserve=excluded.reserve,reason=excluded.reason,updated_at=now();
end $$;

create or replace function public.confirm_program_solicitation(p_assignment_member_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r public.program_assignment_members%rowtype; pid text; pol uuid; ttl text; uid uuid; rs public.response_status;
begin
  select * into r from public.program_assignment_members where id=p_assignment_member_id;
  if not found then raise exception 'Sollicitation introuvable.'; end if;
  if r.assignment_mode <> 'solicited' then raise exception 'Cette ligne n’est pas une sollicitation.'; end if;
  select program_id,pole_id into pid,pol from public.program_assignments where id=r.assignment_id;
  if not public.scope_allows_pole(auth.uid(),'programmes','affecter',pol) then raise exception 'Vous ne pouvez pas confirmer cette participation.'; end if;
  select status into rs from public.program_member_responses where program_id=pid and member_id=r.member_id;
  if rs not in ('available','partial') then raise exception 'Le membre doit d’abord accepter ou accepter partiellement.'; end if;
  update public.program_assignment_members set assignment_mode='direct',assigned_at=now(),assigned_by=auth.uid(),process_status='active',process_closed_at=null,process_closed_reason=null where id=r.id;
  select title into ttl from public.programs where id=pid;
  select auth_user_id into uid from public.members where id=r.member_id;
  if uid is not null then
    insert into public.notifications(user_id,member_id,type,title,body,link,read,entity_type,entity_id,idempotency_key)
    values(uid,r.member_id,'programme_affectation','Participation confirmée — '||coalesce(ttl,'Programme'),'Votre réponse a été validée : vous êtes maintenant affecté(e) au programme « '||coalesce(ttl,'Programme')||' ». Aucune autre réponse n’est requise.','/programme/'||pid,false,'program',pid,'program-solicit-confirm:'||pid||':'||r.member_id||':'||extract(epoch from clock_timestamp())::text);
  end if;
end $$;

grant execute on function public.solicit_program_member(uuid,text) to authenticated;
grant execute on function public.cancel_program_solicitation(uuid) to authenticated;
grant execute on function public.respond_to_program_solicitation(text,public.response_status,text) to authenticated;
grant execute on function public.confirm_program_solicitation(uuid) to authenticated;
