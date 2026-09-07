create or replace function icc_private.trg_enforce_member_base_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.base_role := case
    when exists(select 1 from public.member_poles mp where mp.member_id = new.id and mp.is_referent)
      then 'referent'::public.app_role
    else 'equipier'::public.app_role
  end;
  return new;
end;
$$;
revoke all on function icc_private.trg_enforce_member_base_role() from public, anon, authenticated;

drop trigger if exists trg_enforce_member_base_role on public.members;
create trigger trg_enforce_member_base_role
before insert or update of base_role on public.members
for each row execute function icc_private.trg_enforce_member_base_role();

drop trigger if exists trg_sync_member_auth_role on public.members;
create trigger trg_sync_member_auth_role
after insert or update of auth_user_id on public.members
for each row execute function icc_private.trg_sync_member_auth_role();