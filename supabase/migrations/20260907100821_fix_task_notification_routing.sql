do $$
declare ddl text; newddl text;
begin
 select pg_get_functiondef('icc_private.event_notification()'::regprocedure) into ddl;
 newddl := replace(ddl,
 E'WHEN ''tasks'' THEN\n  members:=ARRAY[j->>''assignee_member_id'']||icc_private.managers(pole);\n  IF j->>''assignee_member_id'' IS NULL AND pid IS NOT NULL THEN members:=members||icc_private.program_members(pid); END IF;\n  typ:=''tache'';title:=''Tâche créée ou mise à jour'';link:=''/taches'';',
 E'WHEN ''tasks'' THEN\n  IF nullif(j->>''assignee_member_id'','''') IS NOT NULL THEN members:=ARRAY[j->>''assignee_member_id'']||icc_private.managers(pole); ELSIF pole IS NOT NULL THEN members:=icc_private.managers(pole); ELSE members:=icc_private.managers(); END IF;\n  typ:=''tache'';title:=''Tâche créée ou mise à jour'';link:=''/taches'';');
 if newddl = ddl then raise exception 'tasks block did not match'; end if;
 execute newddl;
end $$;
