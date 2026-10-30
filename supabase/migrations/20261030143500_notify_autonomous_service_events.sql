-- Notifications in-app pour affectations, désistements et remplacements du Service autonome.
create or replace function public.notify_autonomous_service_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_pole_id uuid;
  v_title text;
  v_body text;
  v_target uuid;
  v_link text;
begin
  if tg_table_name = 'autonomous_service_assignments' then
    v_period_id := new.period_id;
    select m.pole_id into v_pole_id
    from public.autonomous_service_periods p
    join public.autonomous_service_models m on m.id=p.model_id
    where p.id=v_period_id;
    if tg_op='INSERT' and new.status='confirmed' then
      insert into public.notifications(user_id,type,title,body,link,read,created_at,entity_type,entity_id)
      values(new.user_id,'autonomous_service_assignment','Affectation à un service autonome','Tu as été affecté(e) à un service autonome.','/services-autonomes',false,now(),'autonomous_service_period',v_period_id::text);
    elsif tg_op='UPDATE' and old.status='confirmed' and new.status='withdrawn' then
      for v_target in
        select distinct ur.user_id
        from public.user_roles ur
        join public.role_permissions rp on rp.role=ur.role
        where ur.active=true and rp.permission='service_autonome_gerer'
          and (public.is_admin(ur.user_id) or public.scope_allows_pole(ur.user_id,'service_autonome','gerer',v_pole_id))
      loop
        insert into public.notifications(user_id,type,title,body,link,read,created_at,entity_type,entity_id)
        values(v_target,'autonomous_service_replacement','Désistement — remplacement nécessaire','Un équipier s’est désisté. Un remplacement est à organiser.','/services-autonomes',false,now(),'autonomous_service_period',v_period_id::text);
      end loop;
    end if;
  elsif tg_table_name = 'autonomous_service_replacements' and tg_op='UPDATE' and new.status='confirmed' and old.status is distinct from 'confirmed' then
    v_period_id := (select period_id from public.autonomous_service_assignments where id=new.assignment_id);
    insert into public.notifications(user_id,type,title,body,link,read,created_at,entity_type,entity_id)
    values(new.replacement_user_id,'autonomous_service_replacement_confirmed','Remplacement confirmé','Tu as été confirmé(e) pour remplacer un équipier sur un service autonome.','/services-autonomes',false,now(),'autonomous_service_period',v_period_id::text);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists trg_notify_autonomous_assignment on public.autonomous_service_assignments;
create trigger trg_notify_autonomous_assignment
after insert or update of status on public.autonomous_service_assignments
for each row execute function public.notify_autonomous_service_event();

drop trigger if exists trg_notify_autonomous_replacement on public.autonomous_service_replacements;
create trigger trg_notify_autonomous_replacement
after update of status on public.autonomous_service_replacements
for each row execute function public.notify_autonomous_service_event();
