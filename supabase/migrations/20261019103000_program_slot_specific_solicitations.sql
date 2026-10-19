create or replace function public.solicit_program_member_for_slots(
  p_assignment_id uuid,
  p_member_id text,
  p_service_slot_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  pid text;
  pol uuid;
  ttl text;
  uid uuid;
  participant_id uuid;
  slot_labels text;
begin
  select program_id, pole_id into pid, pol
  from public.program_assignments
  where id = p_assignment_id;

  if pid is null then
    raise exception 'Besoin introuvable.';
  end if;

  if not public.scope_allows_pole(auth.uid(), 'programmes', 'affecter', pol) then
    raise exception 'Vous ne pouvez pas solliciter pour ce pôle.';
  end if;

  if p_service_slot_ids is null or cardinality(p_service_slot_ids) = 0 then
    raise exception 'Sélectionne au moins un créneau à solliciter.';
  end if;

  if exists (
    select 1
    from unnest(p_service_slot_ids) requested(slot_id)
    left join public.program_service_slots s
      on s.id = requested.slot_id and s.program_id = pid
    where s.id is null
  ) then
    raise exception 'Un des créneaux sélectionnés ne correspond pas à ce programme.';
  end if;

  if not exists (
    select 1 from public.members
    where id = p_member_id and status = 'active' and coalesce(deleted, false) = false
  ) then
    raise exception 'Ce membre est inactif ou introuvable.';
  end if;

  if exists (
    select 1 from public.program_assignment_members
    where assignment_id = p_assignment_id
      and member_id = p_member_id
      and assignment_mode in ('direct', 'proposal')
  ) then
    raise exception 'Cette personne est déjà affectée à ce pôle.';
  end if;

  insert into public.program_assignment_members(
    assignment_id, member_id, assignment_mode, assigned_at, assigned_by,
    process_status, process_closed_at, process_closed_reason
  )
  values (p_assignment_id, p_member_id, 'solicited', null, null, 'active', null, null)
  on conflict (assignment_id, member_id) do update
    set assignment_mode = 'solicited',
        assigned_at = null,
        assigned_by = null,
        process_status = 'active',
        process_closed_at = null,
        process_closed_reason = null
  returning id into participant_id;

  delete from public.program_assignment_member_slots
  where assignment_member_id = participant_id;

  insert into public.program_assignment_member_slots(
    assignment_member_id, program_day_id, service_slot_id, start_time, end_time
  )
  select participant_id, s.program_day_id, s.id, s.start_time, s.end_time
  from public.program_service_slots s
  where s.program_id = pid and s.id = any(p_service_slot_ids);

  insert into public.program_member_responses(id, program_id, member_id, status, reason, reserve, updated_at)
  values (pid || '__' || p_member_id, pid, p_member_id, 'pending', null, null, now())
  on conflict (program_id, member_id) do update
    set status = 'pending', reason = null, reserve = null, updated_at = now();

  select title into ttl from public.programs where id = pid;
  select auth_user_id into uid from public.members where id = p_member_id;

  select string_agg(
    to_char(d.service_date, 'DD/MM/YYYY') || ' · ' || s.start_time::text || '–' || s.end_time::text,
    ', ' order by d.service_date, s.start_time
  )
  into slot_labels
  from public.program_service_slots s
  join public.program_days d on d.id = s.program_day_id
  where s.program_id = pid and s.id = any(p_service_slot_ids);

  if uid is not null then
    insert into public.notifications(
      user_id, member_id, type, title, body, link, read, entity_type, entity_id, idempotency_key
    )
    values (
      uid, p_member_id, 'reponse_attendue',
      'Réponse attendue — ' || coalesce(ttl, 'Programme'),
      'Vous êtes sollicité(e) pour le programme « ' || coalesce(ttl, 'Programme') ||
      ' » sur le(s) créneau(x) suivant(s) : ' || coalesce(slot_labels, 'créneaux sélectionnés') ||
      '. Merci de répondre dans la fiche du programme.',
      '/programme/' || pid, false, 'program', pid,
      'program-solicit-slots:' || pid || ':' || p_assignment_id::text || ':' || p_member_id || ':' || extract(epoch from clock_timestamp())::text
    );
  end if;
end;
$$;

revoke all on function public.solicit_program_member_for_slots(uuid, text, uuid[]) from public;
grant execute on function public.solicit_program_member_for_slots(uuid, text, uuid[]) to authenticated;
