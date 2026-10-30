-- Sécurise le désistement personnel et les bilans par pôle du module Service autonome.
create or replace function public.guard_autonomous_assignment_withdrawal()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() = old.user_id
     and not public.can_manage_autonomous_service(
       (select m.pole_id from public.autonomous_service_periods p
        join public.autonomous_service_models m on m.id = p.model_id
        where p.id = old.period_id)
     ) then
    if old.status <> 'confirmed' or new.status <> 'withdrawn'
       or new.id is distinct from old.id
       or new.period_id is distinct from old.period_id
       or new.slot_id is distinct from old.slot_id
       or new.user_id is distinct from old.user_id
       or new.assignment_source is distinct from old.assignment_source
       or new.confirmed_by is distinct from old.confirmed_by
       or new.confirmed_at is distinct from old.confirmed_at
       or new.created_at is distinct from old.created_at then
      raise exception 'Un équipier peut uniquement se désister de sa propre affectation confirmée.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_autonomous_assignment_withdrawal on public.autonomous_service_assignments;
create trigger trg_guard_autonomous_assignment_withdrawal
before update on public.autonomous_service_assignments
for each row execute function public.guard_autonomous_assignment_withdrawal();

drop policy if exists autonomous_assignments_self_withdraw on public.autonomous_service_assignments;
create policy autonomous_assignments_self_withdraw
on public.autonomous_service_assignments
for update to authenticated
using (user_id = auth.uid() and status = 'confirmed')
with check (user_id = auth.uid() and status = 'withdrawn');

drop policy if exists autonomous_contributions_read on public.autonomous_service_contributions;
create policy autonomous_contributions_read
on public.autonomous_service_contributions
for select to authenticated
using (
  user_id = auth.uid()
  or public.can_review_autonomous_service_debrief()
  or exists (
    select 1 from public.autonomous_service_debriefs d
    join public.autonomous_service_periods p on p.id = d.period_id
    join public.autonomous_service_models m on m.id = p.model_id
    where d.id = autonomous_service_contributions.debrief_id
      and public.can_manage_autonomous_service(m.pole_id)
  )
);

drop policy if exists autonomous_debriefs_manage on public.autonomous_service_debriefs;
create policy autonomous_debriefs_manage
on public.autonomous_service_debriefs
for all to authenticated
using (
  public.can_review_autonomous_service_debrief()
  or exists (
    select 1 from public.autonomous_service_periods p
    join public.autonomous_service_models m on m.id = p.model_id
    where p.id = autonomous_service_debriefs.period_id
      and public.can_manage_autonomous_service(m.pole_id)
  )
)
with check (
  public.can_review_autonomous_service_debrief()
  or exists (
    select 1 from public.autonomous_service_periods p
    join public.autonomous_service_models m on m.id = p.model_id
    where p.id = autonomous_service_debriefs.period_id
      and public.can_manage_autonomous_service(m.pole_id)
  )
);
