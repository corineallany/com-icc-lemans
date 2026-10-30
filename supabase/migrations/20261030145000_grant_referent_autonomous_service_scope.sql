-- Donne aux référents le périmètre de gestion de leur seul pôle et notifie les responsables concernés.
insert into public.access_role_permissions(role_key,module_key,action_key,scope,enabled)
values('referent','service_autonome','gerer','mon_pole',true)
on conflict(role_key,module_key,action_key)
do update set scope=excluded.scope,enabled=excluded.enabled;

create or replace function public.notify_autonomous_service_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_pole_id uuid;
  v_target uuid;
  v_link text;
begin
  if tg_table_name = 'autonomous_service_assignments' then
    v_period_id := new.period_id;
    v_link := '/services-autonomes?periodId=' || v_period_id::text;
    select m.pole_id into v_pole_id
    from public.autonomous_service_periods p
    join public.autonomous_service_models m on m.id=p.model_id
    where p.id=v_period_id;
    if tg_op='INSERT' and new.status='confirmed' then
      insert into public.notifications(user_id,type,title,body,link,read,created_at,entity_type,entity_id)
      values(new.user_id,'autonomous_service_assignment','Affectation à un service autonome','Tu as été affecté(e) à un service autonome.',v_link,false,now(),'autonomous_service_period',v_period_id::text);
    elsif tg_op='UPDATE' and old.status='confirmed' and new.status='withdrawn' then
      for v_target in
        select ur.user_id from public.user_roles ur
        where ur.active=true and public.is_admin(ur.user_id)
        union
        select m.auth_user_id
        from public.members m
        join public.member_poles mp on mp.member_id=m.id and mp.is_referent=true
        where m.auth_user_id is not null
          and mp.pole_id=v_pole_id
          and public.scope_allows_pole(m.auth_user_id,'service_autonome','gerer',v_pole_id)
      loop
        insert into public.notifications(user_id,type,title,body,link,read,created_at,entity_type,entity_id)
        values(v_target,'autonomous_service_replacement','Désistement — remplacement nécessaire','Un équipier s’est désisté. Un remplacement est à organiser.',v_link,false,now(),'autonomous_service_period',v_period_id::text);
      end loop;
    end if;
  elsif tg_table_name = 'autonomous_service_replacements' and tg_op='UPDATE' and new.status='confirmed' and old.status is distinct from 'confirmed' then
    v_period_id := (select period_id from public.autonomous_service_assignments where id=new.assignment_id);
    v_link := '/services-autonomes?periodId=' || v_period_id::text;
    insert into public.notifications(user_id,type,title,body,link,read,created_at,entity_type,entity_id)
    values(new.replacement_user_id,'autonomous_service_replacement_confirmed','Remplacement confirmé','Tu as été confirmé(e) pour remplacer un équipier sur un service autonome.',v_link,false,now(),'autonomous_service_period',v_period_id::text);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
