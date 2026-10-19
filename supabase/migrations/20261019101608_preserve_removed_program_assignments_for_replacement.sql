create or replace function public.remove_direct_program_assignment(p_assignment_member_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.program_assignment_members%rowtype;
  pid text;
  pol uuid;
  ttl text;
  uid uuid;
begin
  select * into r
  from public.program_assignment_members
  where id = p_assignment_member_id;

  if not found then
    raise exception 'Affectation introuvable.';
  end if;

  select program_id, pole_id into pid, pol
  from public.program_assignments
  where id = r.assignment_id;

  if not public.scope_allows_pole(auth.uid(), 'programmes', 'affecter', pol) then
    raise exception 'Vous ne pouvez pas retirer cette affectation.';
  end if;

  if coalesce(r.assignment_mode, '') not in ('direct', 'proposal') then
    raise exception 'Cette ligne est une sollicitation : traitez-la comme une sollicitation.';
  end if;

  -- Keep the closed row and slot links as history so the programme can
  -- distinguish a never-filled need (renfort) from a released place (replacement).
  update public.program_assignment_members
  set process_status = 'covered',
      process_closed_at = now(),
      process_closed_reason = 'Affectation retirée'
  where id = r.id;

  select title into ttl from public.programs where id = pid;
  select auth_user_id into uid from public.members where id = r.member_id;

  if uid is not null then
    insert into public.notifications(
      user_id, member_id, type, title, body, link, read, entity_type, entity_id, idempotency_key
    )
    values(
      uid, r.member_id, 'programme_retrait',
      'Affectation retirée — ' || coalesce(ttl, 'Programme'),
      'Votre affectation au programme « ' || coalesce(ttl, 'Programme') || ' » a été retirée.',
      '/programme/' || pid, false, 'program', pid,
      'direct-remove:' || pid || ':' || r.member_id || ':' || extract(epoch from clock_timestamp())::text
    );
  end if;
end
$function$;
