revoke execute on function public.set_technical_admin(text,boolean) from anon;
revoke execute on function public.technical_diagnostics() from anon;
revoke execute on function public.technical_export_configuration() from anon;
revoke execute on function public.technical_export_data() from anon;
revoke execute on function public.technical_system_status() from anon;
revoke execute on function public.merge_poles_future(uuid,uuid[]) from anon;
revoke execute on function public.undo_pole_merge(uuid) from anon;
revoke execute on function public.sync_direction_roles_from_settings() from anon;
