create policy "icc_push_delete_self"
on public.icc_push_subscriptions
for delete
to authenticated
using ((select auth.uid()) = user_id);
