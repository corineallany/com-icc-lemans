-- Allow authenticated users to manage only the user-facing state of their own notifications.
-- Ownership remains enforced by notif_own_update RLS (user_id = auth.uid()).
grant update (read, read_at, archived_at, updated_at) on table public.notifications to authenticated;

-- Delivery/content fields remain server-controlled.
revoke update (user_id, member_id, type, title, body, link, created_at, entity_type, entity_id, idempotency_key, in_app_visible, push_status, push_attempts, push_error, push_next_attempt, push_sent_at, deleted_at) on table public.notifications from authenticated;
