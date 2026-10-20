CREATE OR REPLACE FUNCTION public.propose_for_program(p_assignment_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  mid text;
  pid text;
  pol uuid;
  rid uuid;
  req int;
  assigned int;
begin
  mid := public.current_member_id();
  if mid is null then raise exception 'Compte non lié à un membre.'; end if;

  select program_id, pole_id, required_count
    into pid, pol, req
  from public.program_assignments
  where id = p_assignment_id;
  if pid is null then raise exception 'Besoin introuvable.'; end if;

  if not exists (
    select 1 from public.member_poles
    where member_id = mid and pole_id = pol
  ) then raise exception 'Ce besoin ne concerne pas votre pôle.'; end if;

  select count(*) into assigned
  from public.program_assignment_members
  where assignment_id = p_assignment_id
    and coalesce(assignment_mode, 'solicited') in ('direct', 'proposal')
    and coalesce(process_status, '') <> 'covered';

  if coalesce(req, 0) > 0 and assigned >= req then
    raise exception 'Ce besoin est déjà couvert.';
  end if;

  insert into public.program_proposals(program_id, assignment_id, member_id, note, status)
  values (pid, p_assignment_id, mid, nullif(trim(p_note), ''), 'pending')
  on conflict (program_id, assignment_id, member_id)
  do update set
    note = excluded.note,
    status = 'pending',
    created_at = now(),
    decided_at = null,
    decided_by = null
  returning id into rid;

  insert into public.notifications(
    user_id, member_id, type, title, body, link, read,
    entity_type, entity_id, idempotency_key
  )
  select distinct
    m.auth_user_id,
    m.id,
    'proposition_programme',
    'Nouvelle proposition',
    coalesce((select full_name from public.members where id = mid), 'Un membre')
      || ' se propose pour le programme « ' || coalesce((select title from public.programs where id = pid), 'sans titre')
      || ' ». Conséquence : la proposition est en attente de décision par les responsables.',
    '/programme/' || pid || '?tab=participation#proposal-' || rid,
    false,
    'program',
    pid,
    'proposal:' || rid::text || ':' || m.id::text || ':' || gen_random_uuid()::text
  from public.member_poles mp
  join public.members m on m.id = mp.member_id
  where mp.pole_id = pol and mp.is_referent and m.auth_user_id is not null;

  return rid;
end;
$function$
;