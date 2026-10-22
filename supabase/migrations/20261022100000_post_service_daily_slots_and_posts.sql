alter table public.program_debrief_contributions
  add column if not exists service_date date,
  add column if not exists service_slot_ids uuid[] not null default '{}'::uuid[],
  add column if not exists assignment_ids uuid[] not null default '{}'::uuid[];

update public.program_debrief_contributions c
set service_date = p.start_date
from public.programs p
where p.id = c.program_id and c.service_date is null;

alter table public.program_debrief_contributions
  alter column service_date set not null;

alter table public.program_debrief_contributions
  drop constraint if exists program_debrief_contributions_program_id_author_member_id_key;

alter table public.program_debrief_contributions
  add constraint program_debrief_contributions_program_author_day_key
  unique (program_id, author_member_id, service_date);

create index if not exists program_debrief_contributions_program_day_idx
  on public.program_debrief_contributions(program_id, service_date);
