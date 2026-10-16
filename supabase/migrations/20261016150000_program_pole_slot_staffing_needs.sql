-- Store staffing needs independently from service slots so one time slot can
-- have different headcounts for multiple communication poles.
create table if not exists public.program_assignment_slot_needs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.program_assignments(id) on delete cascade,
  service_slot_id uuid not null references public.program_service_slots(id) on delete cascade,
  required_count integer not null check (required_count >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, service_slot_id)
);

-- A member may cover more than one service slot on the same day. The older
-- day-level uniqueness must not block the new slot-level associations.
alter table public.program_assignment_member_slots
  drop constraint if exists program_assignment_member_slots_assignment_member_id_program_day_id_key,
  drop constraint if exists program_assignment_member_slo_assignment_member_id_program__key;

create unique index if not exists program_assignment_member_slots_legacy_day_unique
  on public.program_assignment_member_slots (assignment_member_id, program_day_id)
  where service_slot_id is null;

create index if not exists program_assignment_slot_needs_slot_idx
  on public.program_assignment_slot_needs(service_slot_id);
create index if not exists program_assignment_slot_needs_assignment_idx
  on public.program_assignment_slot_needs(assignment_id);

alter table public.program_assignment_slot_needs enable row level security;

drop policy if exists program_assignment_slot_needs_select on public.program_assignment_slot_needs;
create policy program_assignment_slot_needs_select
on public.program_assignment_slot_needs
for select to authenticated
using (true);

drop policy if exists program_assignment_slot_needs_insert on public.program_assignment_slot_needs;
create policy program_assignment_slot_needs_insert
on public.program_assignment_slot_needs
for insert to authenticated
with check (
  exists (
    select 1
    from public.program_assignments pa
    join public.program_service_slots pss on pss.id = program_assignment_slot_needs.service_slot_id
    where pa.id = program_assignment_slot_needs.assignment_id
      and pa.program_id = pss.program_id
      and (
        public.scope_allows_program(auth.uid(), 'programmes', 'modifier', pa.program_id)
        or public.scope_allows_pole(auth.uid(), 'programmes', 'affecter', pa.pole_id)
      )
  )
);

drop policy if exists program_assignment_slot_needs_update on public.program_assignment_slot_needs;
create policy program_assignment_slot_needs_update
on public.program_assignment_slot_needs
for update to authenticated
using (
  exists (
    select 1
    from public.program_assignments pa
    join public.program_service_slots pss on pss.id = program_assignment_slot_needs.service_slot_id
    where pa.id = program_assignment_slot_needs.assignment_id
      and pa.program_id = pss.program_id
      and (
        public.scope_allows_program(auth.uid(), 'programmes', 'modifier', pa.program_id)
        or public.scope_allows_pole(auth.uid(), 'programmes', 'affecter', pa.pole_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.program_assignments pa
    join public.program_service_slots pss on pss.id = program_assignment_slot_needs.service_slot_id
    where pa.id = program_assignment_slot_needs.assignment_id
      and pa.program_id = pss.program_id
      and (
        public.scope_allows_program(auth.uid(), 'programmes', 'modifier', pa.program_id)
        or public.scope_allows_pole(auth.uid(), 'programmes', 'affecter', pa.pole_id)
      )
  )
);

drop policy if exists program_assignment_slot_needs_delete on public.program_assignment_slot_needs;
create policy program_assignment_slot_needs_delete
on public.program_assignment_slot_needs
for delete to authenticated
using (
  exists (
    select 1
    from public.program_assignments pa
    join public.program_service_slots pss on pss.id = program_assignment_slot_needs.service_slot_id
    where pa.id = program_assignment_slot_needs.assignment_id
      and pa.program_id = pss.program_id
      and (
        public.scope_allows_program(auth.uid(), 'programmes', 'modifier', pa.program_id)
        or public.scope_allows_pole(auth.uid(), 'programmes', 'affecter', pa.pole_id)
      )
  )
);

grant select, insert, update, delete on public.program_assignment_slot_needs to authenticated;
