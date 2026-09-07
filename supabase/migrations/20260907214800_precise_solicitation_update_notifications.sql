create or replace function icc_private.refine_solicitation_update_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text;
  v_title text;
  v_body text;
  v_event text;
  v_changes text[] := '{}';
  v_only_archive boolean;
begin
  v_key := 'solicitations:' || new.id || ':UPDATE:' || txid_current()::text;
  v_event := coalesce(nullif(btrim(new.event_name), ''), 'Sollicitation');

  v_only_archive :=
    (new.archived is distinct from old.archived or new.archived_at is distinct from old.archived_at)
    and (to_jsonb(new) - array['archived','archived_at','updated_at','seen'])
        is not distinct from
        (to_jsonb(old) - array['archived','archived_at','updated_at','seen']);

  if v_only_archive then
    delete from public.notifications where idempotency_key = v_key;
    return new;
  end if;

  if new.cancelled_at is not null and old.cancelled_at is null then
    v_title := 'Sollicitation annulée — ' || v_event;
    v_body := case
      when new.event_date is not null then 'La sollicitation du ' || to_char(new.event_date, 'DD/MM/YYYY') || ' a été annulée.'
      else 'Cette sollicitation a été annulée.'
    end;
    if nullif(btrim(new.cancellation_note), '') is not null then
      v_body := v_body || ' Motif : ' || left(btrim(new.cancellation_note), 180);
    end if;
  else
    if new.event_name is distinct from old.event_name then v_changes := array_append(v_changes, 'intitulé'); end if;
    if new.event_date is distinct from old.event_date then v_changes := array_append(v_changes, 'date'); end if;
    if new.response_deadline is distinct from old.response_deadline then v_changes := array_append(v_changes, 'date limite de réponse'); end if;
    if new.message is distinct from old.message then v_changes := array_append(v_changes, 'message'); end if;
    if new.target_type is distinct from old.target_type or new.target_name is distinct from old.target_name or new.target_pole_id is distinct from old.target_pole_id or new.requested_pole_id is distinct from old.requested_pole_id then
      v_changes := array_append(v_changes, 'destinataires');
    end if;
    if new.offered_slot_ids is distinct from old.offered_slot_ids or new.slot_selection_mode is distinct from old.slot_selection_mode then
      v_changes := array_append(v_changes, 'créneaux proposés');
    end if;
    if new.status is distinct from old.status then v_changes := array_append(v_changes, 'statut'); end if;
    if new.decision is distinct from old.decision then v_changes := array_append(v_changes, 'décision'); end if;

    v_title := 'Sollicitation mise à jour — ' || v_event;
    if cardinality(v_changes) > 0 then
      v_body := 'Modification : ' || array_to_string(v_changes, ', ') || '.';
    else
      v_body := 'Les informations de cette sollicitation ont été mises à jour.';
    end if;
    if new.event_date is not null then
      v_body := v_body || ' Date concernée : ' || to_char(new.event_date, 'DD/MM/YYYY') || '.';
    end if;
  end if;

  update public.notifications
     set title = v_title,
         body = v_body,
         updated_at = now()
   where idempotency_key = v_key;

  return new;
end;
$function$;

drop trigger if exists zz_refine_solicitation_update_notification on public.solicitations;
create trigger zz_refine_solicitation_update_notification
after update on public.solicitations
for each row execute function icc_private.refine_solicitation_update_notification();
