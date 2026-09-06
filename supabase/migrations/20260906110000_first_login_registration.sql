create or replace function public.link_new_auth_user_to_member()
returns trigger language plpgsql security definer set search_path = '' as $$
declare linked_member public.members%rowtype;
begin
  select * into linked_member from public.members
  where lower(btrim(login_email)) = lower(btrim(new.email))
    and auth_user_id is null and deleted = false and status = 'active'
  limit 1 for update;
  if linked_member.id is null then raise exception 'Adresse non autorisée ou compte déjà rattaché'; end if;
  update public.members set auth_user_id=new.id,updated_at=now() where id=linked_member.id;
  insert into public.profiles(id,email,display_name,member_id) values(new.id,new.email,linked_member.full_name,linked_member.id)
  on conflict(id) do update set email=excluded.email,display_name=excluded.display_name,member_id=excluded.member_id,updated_at=now();
  insert into public.user_roles(user_id,role,active) values(new.id,linked_member.base_role,true)
  on conflict(user_id,role) do update set active=true,updated_at=now();
  return new;
end; $$;
revoke all on function public.link_new_auth_user_to_member() from public,anon,authenticated;
drop trigger if exists on_auth_user_created_link_member on auth.users;
create trigger on_auth_user_created_link_member after insert on auth.users for each row execute function public.link_new_auth_user_to_member();
