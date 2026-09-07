create table if not exists public.program_member_slot_choices (
  id uuid primary key default gen_random_uuid(),
  program_id text not null references public.programs(id) on delete cascade,
  member_id text not null references public.members(id) on delete cascade,
  service_slot_id uuid not null references public.program_service_slots(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, member_id, service_slot_id)
);

create index if not exists idx_program_member_slot_choices_program on public.program_member_slot_choices(program_id);
create index if not exists idx_program_member_slot_choices_member on public.program_member_slot_choices(member_id);
create index if not exists idx_program_member_slot_choices_slot on public.program_member_slot_choices(service_slot_id);

alter table public.program_member_slot_choices enable row level security;

drop policy if exists program_member_slot_choices_select on public.program_member_slot_choices;
create policy program_member_slot_choices_select on public.program_member_slot_choices
for select to authenticated
using (
  exists (
    select 1 from public.members m
    where m.id = program_member_slot_choices.member_id and m.auth_user_id = auth.uid()
  )
  or public.scope_allows_program(auth.uid(), 'programmes', 'modifier', program_member_slot_choices.program_id)
  or exists (
    select 1
    from public.program_service_slots pss
    join public.program_assignments pa on pa.id = pss.assignment_id
    where pss.id = program_member_slot_choices.service_slot_id
      and public.scope_allows_pole(auth.uid(), 'programmes', 'affecter', pa.pole_id)
  )
);

drop policy if exists program_member_slot_choices_insert on public.program_member_slot_choices;
create policy program_member_slot_choices_insert on public.program_member_slot_choices
for insert to authenticated
with check (
  exists (
    select 1 from public.members m
    where m.id = program_member_slot_choices.member_id
      and m.auth_user_id = auth.uid()
      and m.status = 'active'
      and not m.deleted
  )
  and exists (
    select 1
    from public.programs p
    where p.id = program_member_slot_choices.program_id
      and p.detailed_scheduling = true
      and p.slot_selection_mode = 'member'
      and not p.deleted
  )
  and exists (
    select 1
    from public.program_service_slots pss
    left join public.program_assignments pa on pa.id = pss.assignment_id
    where pss.id = program_member_slot_choices.service_slot_id
      and pss.program_id = program_member_slot_choices.program_id
      and (
        pss.assignment_id is null
        or exists (
          select 1 from public.member_poles mp
          where mp.member_id = program_member_slot_choices.member_id and mp.pole_id = pa.pole_id
        )
      )
  )
  and (
    exists (
      select 1
      from public.program_assignment_members pam
      join public.program_assignments pa on pa.id = pam.assignment_id
      where pa.program_id = program_member_slot_choices.program_id
        and pam.member_id = program_member_slot_choices.member_id
        and coalesce(pam.process_status, 'active') <> 'covered'
    )
    or exists (
      select 1
      from public.solicitation_recipients sr
      join public.solicitations s on s.id = sr.solicitation_id
      where s.program_id = program_member_slot_choices.program_id
        and sr.member_id = program_member_slot_choices.member_id
        and coalesce(s.deleted, false) = false
        and coalesce(s.archived, false) = false
        and s.cancelled_at is null
    )
  )
);

drop policy if exists program_member_slot_choices_delete on public.program_member_slot_choices;
create policy program_member_slot_choices_delete on public.program_member_slot_choices
for delete to authenticated
using (
  exists (
    select 1 from public.members m
    where m.id = program_member_slot_choices.member_id and m.auth_user_id = auth.uid()
  )
);

grant select, insert, delete on public.program_member_slot_choices to authenticated;
