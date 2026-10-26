-- Notifications explicites pour le cycle de vie des pôles et liens valides vers les archives des programmes.
CREATE OR REPLACE FUNCTION icc_private.notify_pole_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor text;
  v_members text[];
  v_type text;
  v_title text;
  v_body text;
  v_link text;
  v_key text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.archived IS NOT DISTINCT FROM OLD.archived AND NEW.deleted IS NOT DISTINCT FROM OLD.deleted THEN RETURN NEW; END IF;
  SELECT coalesce(nullif(btrim(m.full_name),''),'Un responsable')
    INTO v_actor
    FROM public.members m
   WHERE m.auth_user_id = auth.uid() AND NOT m.deleted
   LIMIT 1;
  v_actor := coalesce(v_actor,'Un responsable');
  v_members := icc_private.managers();
  IF NEW.deleted IS DISTINCT FROM OLD.deleted AND coalesce(NEW.deleted,false) THEN
    v_type := 'pole_corbeille';
    v_title := 'Pôle supprimé';
    v_body := v_actor || ' a supprimé le pôle « ' || NEW.name || ' ». Il se trouve maintenant dans la corbeille des Archives & corbeille.';
    v_link := '/archives?view=deleted&entity=poles&id=' || NEW.id::text;
  ELSIF NEW.archived IS DISTINCT FROM OLD.archived AND coalesce(NEW.archived,false) THEN
    v_type := 'pole_archive';
    v_title := 'Pôle archivé';
    v_body := v_actor || ' a archivé le pôle « ' || NEW.name || ' ». Il est retiré des fiches membres et des choix de pôles actifs ; tu peux le retrouver dans les Archives.';
    v_link := '/archives?view=archived&entity=poles&id=' || NEW.id::text;
  ELSE
    v_type := 'pole_restaure';
    v_title := 'Pôle restauré';
    v_body := v_actor || ' a restauré le pôle « ' || NEW.name || ' ». Il redevient disponible dans l’organisation active.';
    v_link := '/poles';
  END IF;
  v_key := 'pole_lifecycle:' || NEW.id::text || ':' || v_type || ':' || txid_current()::text;
  PERFORM icc_private.emit(v_members,v_type,v_title,left(v_body,1200),v_link,'poles',NEW.id::text,v_key);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_pole_lifecycle ON public.poles;
CREATE TRIGGER trg_notify_pole_lifecycle
AFTER UPDATE OF archived, deleted ON public.poles
FOR EACH ROW
EXECUTE FUNCTION icc_private.notify_pole_lifecycle();

UPDATE public.notifications n
SET type = CASE WHEN p.deleted THEN 'programme_corbeille' ELSE 'programme_archive' END,
    title = CASE WHEN p.deleted THEN 'Programme supprimé' ELSE 'Programme archivé' END,
    body = coalesce((
      SELECT al.actor_name FROM public.audit_log al
      WHERE al.entity = 'programs' AND al.entity_id = p.id::text
        AND al.action IN ('element_corbeille','element_archive','element_archivee')
      ORDER BY al.occurred_at DESC LIMIT 1
    ), 'Un responsable') ||
    CASE WHEN p.deleted THEN ' a supprimé le programme « ' ELSE ' a archivé le programme « ' END ||
    coalesce(nullif(p.title,''),'sans titre') ||
    CASE WHEN p.deleted THEN ' ». Il est maintenant dans la corbeille des Archives & corbeille.' ELSE ' ». Tu peux le retrouver dans les Archives.' END,
    link = CASE WHEN p.deleted
      THEN '/archives?view=deleted&entity=programs&id=' || p.id::text
      ELSE '/archives?view=archived&entity=programs&id=' || p.id::text END,
    entity_type = 'program', entity_id = p.id::text
FROM public.programs p
WHERE n.entity_id = p.id::text
  AND (coalesce(p.archived,false) OR coalesce(p.deleted,false));
