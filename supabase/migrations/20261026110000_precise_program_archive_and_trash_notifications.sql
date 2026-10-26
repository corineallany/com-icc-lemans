-- Notifications explicitement contextualisées pour l’archivage, la corbeille et la restauration des programmes.
DO $migration$
DECLARE ddl text; old_case text; new_case text; old_body text; new_body text;
BEGIN
 SELECT pg_get_functiondef('icc_private.event_notification()'::regprocedure) INTO ddl;
 old_case := $old$pid:=j->>'id'; members:=icc_private.program_members(pid); SELECT coalesce(array_agg(DISTINCT x),'{}') INTO members FROM (SELECT unnest(coalesce(members,'{}')) x UNION SELECT unnest(icc_private.managers(a.pole_id)) x FROM public.program_assignments a WHERE a.program_id=pid) q WHERE x IS NOT NULL; typ:='programme_modification';title:='Programme modifié';link:='/programme/'||pid;$old$;
 new_case := $new$pid:=j->>'id'; members:=icc_private.program_members(pid); SELECT coalesce(array_agg(DISTINCT x),'{}') INTO members FROM (SELECT unnest(coalesce(members,'{}')) x UNION SELECT unnest(icc_private.managers(a.pole_id)) x FROM public.program_assignments a WHERE a.program_id=pid) q WHERE x IS NOT NULL;
  IF TG_OP='UPDATE' AND j->>'deleted' IS DISTINCT FROM prev->>'deleted' AND coalesce((j->>'deleted')::boolean,false) THEN
    typ:='programme_corbeille'; title:='Programme supprimé'; link:='/archives?view=deleted&entity=programs&id='||pid;
  ELSIF TG_OP='UPDATE' AND j->>'archived' IS DISTINCT FROM prev->>'archived' AND coalesce((j->>'archived')::boolean,false) THEN
    typ:='programme_archive'; title:='Programme archivé'; link:='/archives?view=archived&entity=programs&id='||pid;
  ELSIF TG_OP='UPDATE' AND j->>'deleted' IS DISTINCT FROM prev->>'deleted' AND NOT coalesce((j->>'deleted')::boolean,false) THEN
    typ:='programme_restaure'; title:='Programme restauré'; link:='/programme/'||pid;
  ELSIF TG_OP='UPDATE' AND j->>'archived' IS DISTINCT FROM prev->>'archived' AND NOT coalesce((j->>'archived')::boolean,false) THEN
    typ:='programme_restaure'; title:='Programme désarchivé'; link:='/programme/'||pid;
  ELSE
    typ:='programme_modification'; title:='Programme modifié'; link:='/programme/'||pid;
  END IF;$new$;
 IF position(old_case in ddl)=0 THEN RAISE EXCEPTION 'program notification branch did not match current function'; END IF;
 ddl:=replace(ddl,old_case,new_case);
 old_body := $old$ELSIF TG_TABLE_NAME='programs' THEN
   v_body:=v_actor||' a modifié le programme « '||coalesce(v_program_title,'sans titre')||' ». Conséquence : les informations de référence du programme ont changé ; consulte la fiche pour voir les valeurs actuelles.';
   link:='/programme/'||pid||'?tab=infos';$old$;
 new_body := $new$ELSIF TG_TABLE_NAME='programs' THEN
   IF typ='programme_corbeille' THEN
     v_body:=v_actor||' a supprimé le programme « '||coalesce(v_program_title,'sans titre')||' ». Le programme est maintenant dans la corbeille des Archives & corbeille.';
     link:='/archives?view=deleted&entity=programs&id='||pid;
   ELSIF typ='programme_archive' THEN
     v_body:=v_actor||' a archivé le programme « '||coalesce(v_program_title,'sans titre')||' ». Tu peux le retrouver dans les Archives.';
     link:='/archives?view=archived&entity=programs&id='||pid;
   ELSIF typ='programme_restaure' THEN
     v_body:=v_actor||' a restauré ou désarchivé le programme « '||coalesce(v_program_title,'sans titre')||' ». Le programme a retrouvé son état actif.';
     link:='/programme/'||pid;
   ELSE
     v_body:=v_actor||' a modifié le programme « '||coalesce(v_program_title,'sans titre')||' ». Conséquence : les informations du programme ont changé ; consulte la fiche pour voir les valeurs actuelles.';
     link:='/programme/'||pid||'?tab=infos';
   END IF;$new$;
 IF position(old_body in ddl)=0 THEN RAISE EXCEPTION 'program notification body did not match current function'; END IF;
 ddl:=replace(ddl,old_body,new_body);
 EXECUTE ddl;
END
$migration$;
