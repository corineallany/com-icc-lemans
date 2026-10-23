alter table public.tasks add column if not exists sort_order integer;
with ranked as (
  select id,
         row_number() over (
           partition by coalesce(program_id, '__general__')
           order by due_date asc nulls last, created_at asc, id asc
         ) - 1 as position
  from public.tasks
)
update public.tasks t
set sort_order = ranked.position
from ranked
where ranked.id = t.id and t.sort_order is null;
update public.tasks set sort_order = 0 where sort_order is null;
alter table public.tasks alter column sort_order set default 0;
alter table public.tasks alter column sort_order set not null;
create index if not exists tasks_program_sort_order_idx on public.tasks (program_id, sort_order, created_at);
