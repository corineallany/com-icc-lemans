grant select, update, delete on table public.icc_push_subscriptions to authenticated;

drop policy if exists icc_push_update_self on public.icc_push_subscriptions;
create policy icc_push_update_self on public.icc_push_subscriptions
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
