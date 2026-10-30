-- Autorise l'équipier à créer uniquement sa demande de remplacement après son propre désistement.
drop policy if exists autonomous_replacements_self_request on public.autonomous_service_replacements;
create policy autonomous_replacements_self_request
on public.autonomous_service_replacements
for insert to authenticated
with check (
  original_user_id = auth.uid()
  and requested_by = auth.uid()
  and status = 'needed'
  and replacement_user_id is null
  and exists (
    select 1 from public.autonomous_service_assignments a
    where a.id = assignment_id
      and a.user_id = auth.uid()
      and a.status = 'withdrawn'
  )
);
