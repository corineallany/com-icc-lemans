-- Empêche qu'un même équipier soit confirmé plusieurs fois sur le même créneau autonome.
create unique index if not exists autonomous_service_unique_active_assignment
on public.autonomous_service_assignments(slot_id,user_id)
where status='confirmed';
