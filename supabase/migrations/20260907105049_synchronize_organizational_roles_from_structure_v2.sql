create or replace function icc_private.sync_member_organizational_role(p_member_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_is_referent boolean := false;
  v_is_supervisor boolean := false;
  v_is_adjoint boolean := false;
begin
  select auth_user_id into v_user_id from public.members where id = p_member_id;

  select exists(select 1 from public.member_poles mp where mp.member_id=p_member_id and mp.is_referent)
    into v_is_referent;

  update public.members
     set base_role = (case when v_is_referent then 'referent'::public.app_role else 'equipier'::public.app_role end)
   where id=p_member_id;

  if v_user_id is null then return; end if;

  select exists(select 1 from public.app_settings s where s.id='main' and s.supervisor_member_id=p_member_id)
    into v_is_supervisor;
  select exists(select 1 from public.app_settings s where s.id='main' and s.adjoint_member_id=p_member_id)
    into v_is_adjoint;

  insert into public.user_roles(user_id,role,active,updated_at)
  values (v_user_id,'equipier'::public.app_role,true,now())
  on conflict (user_id,role) do update set active=true, updated_at=now();

  insert into public.user_roles(user_id,role,active,updated_at)
  values (v_user_id,'referent'::public.app_role,v_is_referent,now())
  on conflict (user_id,role) do update set active=excluded.active, updated_at=now();

  insert into public.user_roles(user_id,role,active,updated_at)
  values (v_user_id,'responsable'::public.app_role,v_is_supervisor,now())
  on conflict (user_id,role) do update set active=excluded.active, updated_at=now();

  insert into public.user_roles(user_id,role,active,updated_at)
  values (v_user_id,'adjoint'::public.app_role,v_is_adjoint,now())
  on conflict (user_id,role) do update set active=excluded.active, updated_at=now();
end;
$$;
revoke all on function icc_private.sync_member_organizational_role(text) from public, anon, authenticated;

create or replace function icc_private.sync_all_organizational_roles()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record;
begin
  for r in select id from public.members loop
    perform icc_private.sync_member_organizational_role(r.id);
  end loop;
end;
$$;
revoke all on function icc_private.sync_all_organizational_roles() from public, anon, authenticated;

create or replace function icc_private.trg_sync_member_pole_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op='DELETE' then
    perform icc_private.sync_member_organizational_role(old.member_id);
    return old;
  end if;
  perform icc_private.sync_member_organizational_role(new.member_id);
  if tg_op='UPDATE' and old.member_id is distinct from new.member_id then
    perform icc_private.sync_member_organizational_role(old.member_id);
  end if;
  return new;
end;
$$;
revoke all on function icc_private.trg_sync_member_pole_role() from public, anon, authenticated;

drop trigger if exists trg_sync_member_pole_role on public.member_poles;
create trigger trg_sync_member_pole_role
after insert or update of member_id,is_referent or delete on public.member_poles
for each row execute function icc_private.trg_sync_member_pole_role();

create or replace function icc_private.trg_sync_direction_roles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.supervisor_member_id is distinct from new.supervisor_member_id then
    if old.supervisor_member_id is not null then perform icc_private.sync_member_organizational_role(old.supervisor_member_id); end if;
    if new.supervisor_member_id is not null then perform icc_private.sync_member_organizational_role(new.supervisor_member_id); end if;
  end if;
  if old.adjoint_member_id is distinct from new.adjoint_member_id then
    if old.adjoint_member_id is not null then perform icc_private.sync_member_organizational_role(old.adjoint_member_id); end if;
    if new.adjoint_member_id is not null then perform icc_private.sync_member_organizational_role(new.adjoint_member_id); end if;
  end if;
  return new;
end;
$$;
revoke all on function icc_private.trg_sync_direction_roles() from public, anon, authenticated;

drop trigger if exists trg_sync_direction_roles on public.app_settings;
create trigger trg_sync_direction_roles
after update of supervisor_member_id,adjoint_member_id on public.app_settings
for each row execute function icc_private.trg_sync_direction_roles();

create or replace function icc_private.trg_sync_member_auth_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.auth_user_id is distinct from old.auth_user_id then
    perform icc_private.sync_member_organizational_role(new.id);
  end if;
  return new;
end;
$$;
revoke all on function icc_private.trg_sync_member_auth_role() from public, anon, authenticated;

drop trigger if exists trg_sync_member_auth_role on public.members;
create trigger trg_sync_member_auth_role
after update of auth_user_id on public.members
for each row execute function icc_private.trg_sync_member_auth_role();

select icc_private.sync_all_organizational_roles();