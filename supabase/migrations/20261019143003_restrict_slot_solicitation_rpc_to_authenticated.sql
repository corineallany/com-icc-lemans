revoke all on function public.solicit_program_member_for_slots(uuid, text, uuid[]) from anon;
revoke all on function public.solicit_program_member_for_slots(uuid, text, uuid[]) from public;
grant execute on function public.solicit_program_member_for_slots(uuid, text, uuid[]) to authenticated;
