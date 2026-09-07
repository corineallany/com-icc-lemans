-- Keep the newest/active registration for repeated inactive subscriptions from the same user/device family.
-- Active endpoints are deliberately preserved: a browser may have more than one legitimate installation/profile.
with ranked as (
  select id,
         row_number() over (
           partition by user_id, coalesce(user_agent, '')
           order by enabled desc, updated_at desc nulls last, id desc
         ) as rn
  from public.icc_push_subscriptions
)
delete from public.icc_push_subscriptions p
using ranked r
where p.id = r.id
  and r.rn > 1
  and p.enabled = false;
