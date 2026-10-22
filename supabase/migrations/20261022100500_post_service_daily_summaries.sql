create table if not exists public.program_day_debriefs (
  id uuid primary key default gen_random_uuid(),
  program_id text not null references public.programs(id) on delete cascade,
  service_date date not null,
  summary text,
  went_well text,
  difficulties text,
  to_improve text,
  needs text,
  rating integer check (rating between 1 and 5),
  status text not null default 'draft' check (status in ('draft','closed')),
  author_member_id text references public.members(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(program_id, service_date)
);

create index if not exists program_day_debriefs_program_day_idx
  on public.program_day_debriefs(program_id, service_date);

alter table public.program_day_debriefs enable row level security;

drop policy if exists program_day_debriefs_select on public.program_day_debriefs;
create policy program_day_debriefs_select on public.program_day_debriefs
  for select to authenticated
  using (public.can_contribute_post_service(program_id) or public.can_finalize_post_service(program_id));

drop policy if exists program_day_debriefs_insert on public.program_day_debriefs;
create policy program_day_debriefs_insert on public.program_day_debriefs
  for insert to authenticated
  with check (public.can_finalize_post_service(program_id) and created_by=auth.uid());

drop policy if exists program_day_debriefs_update on public.program_day_debriefs;
create policy program_day_debriefs_update on public.program_day_debriefs
  for update to authenticated
  using (public.can_finalize_post_service(program_id))
  with check (public.can_finalize_post_service(program_id));

grant select,insert,update on public.program_day_debriefs to authenticated;
