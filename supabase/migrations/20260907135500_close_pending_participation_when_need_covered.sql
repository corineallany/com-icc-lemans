alter table public.program_proposals drop constraint if exists program_proposals_status_check;
alter table public.program_proposals add constraint program_proposals_status_check check (status in ('pending','assigned','refused','withdrawn','covered'));

alter table public.program_assignment_members add column if not exists process_status text not null default 'active';
alter table public.program_assignment_members add column if not exists process_closed_at timestamptz;
alter table public.program_assignment_members add column if not exists process_closed_reason text;
alter table public.program_assignment_members drop constraint if exists program_assignment_members_process_status_check;
alter table public.program_assignment_members add constraint program_assignment_members_process_status_check check (process_status in ('active','covered'));

create or replace function public.close_program_need_pending_participation(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_program_id text;
  v_program_title text;
  v_pole_id uuid;
  v_pole_name text;
  v_required int;
  v_confirmed int;
  r record;
begin
  select pa.program_id, pa.pole_id, pa.required_count, p.title, po.name
    into v_program_id, v_pole_id, v_required, v_program_title, v_pole_name
  from public.program_assignments pa
  join public.programs p on p.id=pa.program_id
  left join public.poles po on po.id=pa.pole_id
  where pa.id=p_assignment_id;

  if v_program_id is null or coalesce(v_required,0) <= 0 then return; end if;

  select count(*) into v_confirmed
  from public.program_assignment_members pam
  where pam.assignment_id=p_assignment_id
    and pam.assignment_mode in ('direct','proposal')
    and coalesce(pam.process_status,'active')='active';

  if v_confirmed < v_required then return; end if;

  for r in
    update public.program_proposals pp
       set status='covered', decided_at=now(), decided_by=null
     where pp.assignment_id=p_assignment_id
       and pp.status='pending'
     returning pp.id, pp.member_id
  loop
    insert into public.notifications(user_id,member_id,type,title,body,link,read,entity_type,entity_id,idempotency_key)
    select m.auth_user_id,m.id,'besoin_comble','Besoin désormais comblé',
           'Le besoin pour '||coalesce(v_pole_name,'votre pôle')||' sur '||coalesce(v_program_title,'ce programme')||' est désormais comblé. Aucune action supplémentaire n’est nécessaire.',
           '/programme/'||v_program_id,false,'program',v_program_id,'need-covered:proposal:'||r.id::text
      from public.members m
     where m.id=r.member_id and m.auth_user_id is not null
    on conflict (idempotency_key) do nothing;
  end loop;

  for r in
    update public.program_assignment_members pam
       set process_status='covered', process_closed_at=now(), process_closed_reason='need_covered'
     where pam.assignment_id=p_assignment_id
       and pam.assignment_mode='solicited'
       and coalesce(pam.process_status,'active')='active'
       and coalesce((select pmr.status::text from public.program_member_responses pmr where pmr.program_id=v_program_id and pmr.member_id=pam.member_id limit 1),'pending') in ('pending','available','partial')
     returning pam.id, pam.member_id
  loop
    insert into public.notifications(user_id,member_id,type,title,body,link,read,entity_type,entity_id,idempotency_key)
    select m.auth_user_id,m.id,'besoin_comble','Besoin désormais comblé',
           'Le besoin pour '||coalesce(v_pole_name,'votre pôle')||' sur '||coalesce(v_program_title,'ce programme')||' est désormais comblé. Votre sollicitation est clôturée et aucune réponse/action supplémentaire n’est nécessaire.',
           '/programme/'||v_program_id,false,'program',v_program_id,'need-covered:solicitation:'||r.id::text
      from public.members m
     where m.id=r.member_id and m.auth_user_id is not null
    on conflict (idempotency_key) do nothing;
  end loop;
end;
$$;

create or replace function public.trg_close_program_need_when_covered()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
begin
  if tg_table_name='program_assignment_members' then
    if new.assignment_mode in ('direct','proposal') and coalesce(new.process_status,'active')='active' then
      perform public.close_program_need_pending_participation(new.assignment_id);
    end if;
  elsif tg_table_name='program_assignments' then
    perform public.close_program_need_pending_participation(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_close_program_need_after_member on public.program_assignment_members;
create trigger trg_close_program_need_after_member
after insert or update of assignment_mode, process_status on public.program_assignment_members
for each row execute function public.trg_close_program_need_when_covered();

drop trigger if exists trg_close_program_need_after_requirement on public.program_assignments;
create trigger trg_close_program_need_after_requirement
after update of required_count on public.program_assignments
for each row execute function public.trg_close_program_need_when_covered();

do $$ declare r record; begin
  for r in select id from public.program_assignments where coalesce(required_count,0)>0 loop
    perform public.close_program_need_pending_participation(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
