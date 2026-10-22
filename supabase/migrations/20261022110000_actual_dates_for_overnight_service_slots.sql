alter table public.program_service_slots
  add column if not exists actual_start_date date,
  add column if not exists actual_end_date date;

update public.program_service_slots s
set actual_start_date = d.service_date,
    actual_end_date = case when s.end_time <= s.start_time then d.service_date + 1 else d.service_date end
from public.program_days d
where d.id = s.program_day_id
  and (s.actual_start_date is null or s.actual_end_date is null);

update public.program_service_slots s
set actual_start_date = p.start_date,
    actual_end_date = case when s.end_time <= s.start_time then p.start_date + 1 else p.start_date end
from public.programs p
where p.id = s.program_id
  and s.program_day_id is null
  and p.start_date is not null
  and (s.actual_start_date is null or s.actual_end_date is null);

update public.program_service_slots
set actual_start_date = coalesce(actual_start_date, current_date),
    actual_end_date = coalesce(actual_end_date, actual_start_date, current_date)
where actual_start_date is null or actual_end_date is null;

alter table public.program_service_slots
  alter column actual_start_date set not null,
  alter column actual_end_date set not null;