create or replace function public.save_organization_settings(
  p_direction_structure text,
  p_supervisor_member_id text,
  p_adjoint_member_id text,
  p_group_leads jsonb,
  p_referents jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec record;
  v_mid text;
  v_count int;
begin
  if not public.can_manage_access_matrix() then
    raise exception 'Accès refusé';
  end if;

  update public.app_settings
  set direction_structure = p_direction_structure,
      supervisor_member_id = nullif(p_supervisor_member_id,''),
      adjoint_member_id = case when p_direction_structure='responsable_adjoint' then nullif(p_adjoint_member_id,'') else null end,
      group_leads = coalesce(p_group_leads,'{}'::jsonb),
      updated_at = now()
  where id='main';

  if not found then
    raise exception 'Configuration principale introuvable';
  end if;

  for rec in select id from public.poles where archived=false loop
    update public.member_poles set is_referent=false where pole_id=rec.id and is_referent=true;
    v_mid := nullif(p_referents ->> rec.id, '');
    if v_mid is not null then
      if not exists(select 1 from public.members m where m.id=v_mid and m.status='active' and coalesce(m.archived,false)=false) then
        raise exception 'Référent invalide pour le pôle %', rec.id;
      end if;
      insert into public.member_poles(member_id,pole_id,is_referent)
      values(v_mid,rec.id,true)
      on conflict(member_id,pole_id) do update set is_referent=true;
    end if;
  end loop;

  for rec in select id from public.poles where archived=false loop
    v_mid := nullif(p_referents ->> rec.id, '');
    if v_mid is null then
      if exists(select 1 from public.member_poles where pole_id=rec.id and is_referent=true) then
        raise exception 'La suppression du référent du pôle % n’a pas été appliquée', rec.id;
      end if;
    else
      select count(*) into v_count from public.member_poles where pole_id=rec.id and member_id=v_mid and is_referent=true;
      if v_count <> 1 then
        raise exception 'Le référent du pôle % n’a pas été enregistré', rec.id;
      end if;
      if exists(select 1 from public.member_poles where pole_id=rec.id and member_id<>v_mid and is_referent=true) then
        raise exception 'Plusieurs référents actifs détectés pour le pôle %', rec.id;
      end if;
    end if;
  end loop;

  return jsonb_build_object('success',true,'saved_at',now());
end;
$$;

revoke all on function public.save_organization_settings(text,text,text,jsonb,jsonb) from public, anon;
grant execute on function public.save_organization_settings(text,text,text,jsonb,jsonb) to authenticated;
