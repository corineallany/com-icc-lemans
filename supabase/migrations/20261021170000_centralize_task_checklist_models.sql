create table if not exists public.task_template_models (
  id text primary key default ('ttm_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  description text,
  tasks jsonb not null default '[]'::jsonb,
  poles jsonb not null default '[]'::jsonb,
  archived boolean not null default false,
  deleted boolean not null default false,
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_template_models_tasks_array check (jsonb_typeof(tasks) = 'array'),
  constraint task_template_models_poles_array check (jsonb_typeof(poles) = 'array')
);
create index if not exists task_template_models_active_idx on public.task_template_models (deleted, archived, name);
create table if not exists public.task_template_model_program_links (
  task_template_model_id text not null references public.task_template_models(id) on delete cascade,
  program_model_id text not null references public.program_models(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_template_model_id, program_model_id)
);
alter table public.task_template_models enable row level security;
alter table public.task_template_model_program_links enable row level security;
drop policy if exists task_template_models_select_authenticated on public.task_template_models;
create policy task_template_models_select_authenticated on public.task_template_models for select to authenticated using (true);
drop policy if exists task_template_models_insert_managers on public.task_template_models;
create policy task_template_models_insert_managers on public.task_template_models for insert to authenticated with check (public.can_manage_program_model(poles));
drop policy if exists task_template_models_update_managers on public.task_template_models;
create policy task_template_models_update_managers on public.task_template_models for update to authenticated using (public.can_manage_program_model(poles) or public.has_archive_permission('restaurer') or public.has_archive_permission('corbeille')) with check (public.can_manage_program_model(poles) or public.has_archive_permission('restaurer') or public.has_archive_permission('corbeille'));
drop policy if exists task_template_models_delete_permission on public.task_template_models;
create policy task_template_models_delete_permission on public.task_template_models for delete to authenticated using (public.has_archive_permission('supprimer_definitivement'));
drop policy if exists task_template_links_select_authenticated on public.task_template_model_program_links;
create policy task_template_links_select_authenticated on public.task_template_model_program_links for select to authenticated using (true);
drop policy if exists task_template_links_insert_managers on public.task_template_model_program_links;
create policy task_template_links_insert_managers on public.task_template_model_program_links for insert to authenticated with check (exists (select 1 from public.task_template_models t where t.id = task_template_model_id and public.can_manage_program_model(t.poles)) and exists (select 1 from public.program_models p where p.id = program_model_id and public.can_manage_program_model(p.poles)));
drop policy if exists task_template_links_delete_managers on public.task_template_model_program_links;
create policy task_template_links_delete_managers on public.task_template_model_program_links for delete to authenticated using (exists (select 1 from public.task_template_models t where t.id = task_template_model_id and public.can_manage_program_model(t.poles)) and exists (select 1 from public.program_models p where p.id = program_model_id and public.can_manage_program_model(p.poles)));
create or replace function public.set_task_template_model_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists task_template_models_updated_at on public.task_template_models;
create trigger task_template_models_updated_at before update on public.task_template_models for each row execute function public.set_task_template_model_updated_at();
