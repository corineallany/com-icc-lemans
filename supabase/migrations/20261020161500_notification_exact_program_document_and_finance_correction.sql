-- Route programme documents and finance corrections to their affected record.
CREATE OR REPLACE FUNCTION icc_private.event_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE j jsonb; prev jsonb:='{}'; members text[]:='{}'; typ text; title text; link text; pid text; pole uuid; mid text; sid uuid; eventrow public.team_life_events%rowtype; key text; v_actor text; v_program_title text; v_body text;
BEGIN
 IF TG_OP='DELETE' THEN j:=to_jsonb(OLD); ELSE j:=to_jsonb(NEW); END IF;
 IF TG_OP='UPDATE' THEN
  prev:=to_jsonb(OLD);
  IF (j-ARRAY['updated_at','seen']) IS NOT DISTINCT FROM (prev-ARRAY['updated_at','seen']) THEN RETURN NEW; END IF;
 END IF;
 pid:=j->>'program_id'; pole:=nullif(j->>'pole_id','')::uuid;
 key:=TG_TABLE_NAME||':'||coalesce(j->>'id','')||':'||TG_OP||':'||txid_current()::text;
 CASE TG_TABLE_NAME
 WHEN 'program_assignment_members' THEN
  SELECT a.program_id,a.pole_id INTO pid,pole FROM public.program_assignments a WHERE a.id=(j->>'assignment_id')::uuid;
  IF pid IS NULL THEN RETURN NULL; END IF;
  members:=ARRAY[j->>'member_id'];
  typ:=CASE WHEN TG_OP='DELETE' THEN 'programme_retrait' ELSE 'programme_affectation' END;
  title:=CASE WHEN TG_OP='DELETE' THEN 'Affectation retirée' ELSE 'Nouvelle affectation à un programme' END;link:='/programme/'||pid;
  key:=typ||':'||pid||':'||(j->>'member_id')||':'||txid_current()::text;
 WHEN 'program_assignments' THEN
  IF TG_OP<>'DELETE' THEN RETURN NULL; END IF;
  SELECT array_agg(member_id) INTO members FROM public.program_assignment_members WHERE assignment_id=(j->>'id')::uuid;
  typ:='programme_retrait';title:='Affectation retirée';link:='/programme/'||pid;
 WHEN 'programs' THEN
  IF TG_OP='INSERT' THEN RETURN NEW; END IF;
  pid:=j->>'id'; members:=icc_private.program_members(pid); SELECT coalesce(array_agg(DISTINCT x),'{}') INTO members FROM (SELECT unnest(coalesce(members,'{}')) x UNION SELECT unnest(icc_private.managers(a.pole_id)) x FROM public.program_assignments a WHERE a.program_id=pid) q WHERE x IS NOT NULL; typ:='programme_modification';title:='Programme modifié';link:='/programme/'||pid;
 WHEN 'program_member_responses' THEN
  SELECT array_agg(DISTINCT x) INTO members FROM public.program_assignments a CROSS JOIN LATERAL unnest(icc_private.managers(a.pole_id)) x WHERE a.program_id=pid;
  typ:='reponse_recue';title:='Réponse reçue pour un programme';link:='/programme/'||pid;
 WHEN 'solicitation_recipients' THEN
  IF TG_OP='INSERT' THEN members:=ARRAY[j->>'member_id'];typ:='sollicitation';title:='Nouvelle sollicitation ponctuelle';
  ELSIF j->>'selected' IS DISTINCT FROM prev->>'selected' THEN members:=ARRAY[j->>'member_id'];typ:='sollicitation_retenue';title:='Votre sélection a été mise à jour';
  ELSIF j->>'response' IS DISTINCT FROM prev->>'response' OR j->>'reserve' IS DISTINCT FROM prev->>'reserve' THEN
   SELECT ARRAY[requester_member_id]||icc_private.managers(requested_pole_id) INTO members FROM public.solicitations WHERE id=j->>'solicitation_id';typ:='sollicitation_reponse';title:='Réponse reçue à une sollicitation';
  ELSE RETURN NEW; END IF;
  link:='/sollicitations';
 WHEN 'solicitations' THEN
  IF TG_OP='INSERT' THEN RETURN NEW; END IF;
  SELECT array_agg(member_id) INTO members FROM public.solicitation_recipients WHERE solicitation_id=j->>'id';
  typ:='sollicitation_modification';title:='Sollicitation modifiée';link:='/sollicitations';
 WHEN 'member_availability' THEN
  IF TG_OP='INSERT' THEN
   SELECT array_agg(DISTINCT x) INTO members FROM public.member_poles p CROSS JOIN LATERAL unnest(icc_private.managers(p.pole_id)) x WHERE p.member_id=j->>'member_id';
   members:=coalesce(members,'{}')||icc_private.managers();title:='Nouvelle demande d’indisponibilité';
  ELSE members:=ARRAY[j->>'member_id'];title:='Votre indisponibilité a été mise à jour'; END IF;
  typ:='indisponibilite';link:='/disponibilites';
 WHEN 'member_training_paths' THEN
  members:=ARRAY[j->>'member_id'];typ:=CASE WHEN j->>'status'='completed' THEN 'formation_terminee' ELSE 'formation_affectation' END;title:='Votre parcours de formation a été mis à jour';link:='/formations';
 WHEN 'member_training_steps' THEN
  SELECT ARRAY[member_id,assigned_by_member_id] INTO members FROM public.member_training_paths WHERE id=(j->>'member_training_path_id')::uuid AND deleted_at IS NULL;
  IF TG_OP='INSERT' AND coalesce(j->>'custom_step','false')='false' THEN RETURN NEW; END IF;
  typ:='formation_progression';title:='Progression de formation mise à jour';link:='/formations';
 WHEN 'member_training_sessions' THEN
  IF TG_OP='INSERT' AND j->>'planned_date' IS NULL THEN RETURN NEW; END IF;
  SELECT ARRAY[p.member_id,j->>'trainer_member_id'] INTO members FROM public.member_training_steps s JOIN public.member_training_paths p ON p.id=s.member_training_path_id WHERE s.id=(j->>'member_training_step_id')::uuid AND p.deleted_at IS NULL;
  typ:='formation_session';title:='Séance de formation mise à jour';link:='/formations';
 WHEN 'evaluations' THEN
  typ:='evaluation';title:='Évaluation : une action vous concerne';link:='/evaluations';
  IF j->>'status'='validated' THEN members:=ARRAY[j->>'subject_member_id',j->>'evaluator_member_id'];
  ELSIF j->>'status'='submitted' THEN members:=icc_private.managers();
  ELSE members:=ARRAY[j->>'evaluator_member_id']; END IF;
 WHEN 'evaluation_objectives' THEN
  IF NOT EXISTS(SELECT 1 FROM public.evaluations WHERE id=(j->>'evaluation_id')::uuid AND status='validated') THEN RETURN NEW; END IF;
  members:=ARRAY[j->>'subject_member_id',j->>'coach_member_id'];typ:='objectif_evaluation';title:='Objectif d’évaluation mis à jour';link:='/evaluations';
 WHEN 'tasks' THEN
  IF nullif(j->>'assignee_member_id','') IS NOT NULL THEN members:=ARRAY[j->>'assignee_member_id']||icc_private.managers(pole); ELSIF pole IS NOT NULL THEN members:=icc_private.managers(pole); ELSE members:=icc_private.managers(); END IF;
  typ:='tache';title:='Tâche créée ou mise à jour';link:='/taches';
 WHEN 'program_debriefs' THEN
  members:=icc_private.managers();typ:='post_service';title:='Post-service mis à jour';link:='/post-service';
 WHEN 'program_debrief_contributions' THEN
  members:=icc_private.managers(pole);typ:='debrief_contribution';title:='Contribution post-service reçue';link:='/post-service';
 WHEN 'team_life_events','team_life_polls' THEN
  IF TG_TABLE_NAME='team_life_events' THEN SELECT * INTO eventrow FROM public.team_life_events WHERE id=(j->>'id')::uuid;typ:='vie_equipe';
  ELSE SELECT * INTO eventrow FROM public.team_life_events WHERE id=(j->>'event_id')::uuid;typ:='sondage'; END IF;
  IF eventrow.status IN ('idea','draft','proposed') THEN members:=icc_private.managers();
  ELSE SELECT array_agg(m.id) INTO members FROM public.members m WHERE NOT m.deleted AND m.status='active' AND (coalesce(cardinality(eventrow.audience_pole_ids),0)=0 OR EXISTS(SELECT 1 FROM public.member_poles mp WHERE mp.member_id=m.id AND mp.pole_id=ANY(eventrow.audience_pole_ids))); END IF;
  title:=CASE WHEN typ='sondage' THEN 'Sondage disponible ou modifié' ELSE 'Événement de vie d’équipe mis à jour' END;link:='/vie-equipe';
 WHEN 'material_needs','material_requests','material_incidents','material_loans','material_documents' THEN
  SELECT array_agg(member_id) INTO members FROM public.material_managers WHERE active;
  members:=coalesce(members,'{}')||icc_private.managers(pole)||ARRAY[j->>'created_by_member_id',j->>'borrower_member_id',j->>'assigned_to_member_id'];
  typ:='materiel';title:='Matériel : une action vous concerne';link:='/materiel-com';
 WHEN 'team_finance_contributions','team_finance_expenses','team_finance_entries','team_finance_corrections' THEN
  SELECT array_agg(member_id) INTO members FROM public.team_finance_managers WHERE active;
  members:=coalesce(members,'{}')||icc_private.managers()||ARRAY[j->>'member_id'];
  typ:='finance';title:='Caisse fraternelle : une opération a été mise à jour';link:='/caisse-fraternelle';
 WHEN 'program_documents' THEN members:=icc_private.program_members(pid);typ:='document';title:='Document de programme disponible';link:='/programme/'||pid;
 WHEN 'member_poles' THEN members:=ARRAY[j->>'member_id'];typ:='administration';title:='Votre rattachement à un pôle a été mis à jour';link:='/mon-profil';
 WHEN 'user_roles' THEN SELECT array_agg(id) INTO members FROM public.members WHERE auth_user_id=(j->>'user_id')::uuid;typ:='administration';title:='Vos habilitations ont été mises à jour';link:='/mon-profil';
 ELSE RETURN NULL;
 END CASE;
 -- Never place confidential contents, financial amounts or evaluation scores in push previews.
 SELECT coalesce(nullif(btrim(m.full_name),''),'Un membre') INTO v_actor FROM public.members m WHERE m.auth_user_id=auth.uid() AND NOT m.deleted LIMIT 1;
 v_actor:=coalesce(v_actor,'Une action automatique');
 SELECT nullif(btrim(p.title),'') INTO v_program_title FROM public.programs p WHERE p.id=pid;
 v_program_title:=coalesce(v_program_title,nullif(j->>'event_name',''),nullif(j->>'title',''),nullif(j->>'item_name',''),nullif(j->>'file_name',''),replace(TG_TABLE_NAME,'_',' '));
 v_body:=v_actor||' a effectué une action : '||coalesce(title,replace(TG_TABLE_NAME,'_',' '))||'. Élément concerné : « '||v_program_title||' ».';
 IF TG_TABLE_NAME='program_assignment_members' THEN
   v_body:=v_actor||CASE WHEN TG_OP='DELETE' THEN ' a retiré une affectation' ELSE ' a enregistré une affectation' END||' pour « '||coalesce(v_program_title,'programme sans titre')||' ». Conséquence : le suivi des personnes affectées au programme a été actualisé.';
   link:='/programme/'||pid||'?tab=participation#assignment-'||(j->>'assignment_id');
 ELSIF TG_TABLE_NAME='program_member_responses' THEN
   v_body:=v_actor||' a enregistré une réponse de participation pour le programme « '||coalesce(v_program_title,'sans titre')||' ». Statut : '||coalesce(j->>'status','mis à jour')||'. Conséquence : les responsables peuvent ajuster la mobilisation.';
   link:='/programme/'||pid||'?tab=participation#program-response';
 ELSIF TG_TABLE_NAME='programs' THEN
   v_body:=v_actor||' a modifié le programme « '||coalesce(v_program_title,'sans titre')||' ». Conséquence : les informations de référence du programme ont changé ; consulte la fiche pour voir les valeurs actuelles.';
   link:='/programme/'||pid||'?tab=infos';
 ELSIF TG_TABLE_NAME='tasks' THEN
   v_body:=v_actor||CASE WHEN TG_OP='INSERT' THEN ' a créé la tâche' ELSE ' a modifié la tâche' END||' « '||coalesce(j->>'title','sans titre')||' ». Statut : '||coalesce(j->>'status','mis à jour')||'. Conséquence : le suivi de la tâche a été actualisé.';
   link:='/taches?taskId='||(j->>'id');
 ELSIF TG_TABLE_NAME IN ('solicitations','solicitation_recipients') THEN
   v_body:=v_actor||' a modifié la sollicitation « '||coalesce(v_program_title,'sans titre')||' ». Conséquence : le suivi de la demande et des réponses a été actualisé.';
   link:='/sollicitations?solicitationId='||CASE WHEN TG_TABLE_NAME='solicitation_recipients' THEN coalesce(j->>'solicitation_id','') ELSE coalesce(j->>'id','') END;
 ELSIF TG_TABLE_NAME IN ('team_finance_contributions','team_finance_expenses','team_finance_entries','team_finance_corrections') THEN
   IF TG_TABLE_NAME='team_finance_corrections' THEN v_body:=v_actor||' a enregistré une correction ou une annulation d’écriture dans la caisse fraternelle. Conséquence : une contre-écriture est ajoutée au suivi ; l’écriture d’origine est conservée.';link:='/caisse-fraternelle?financeId='||coalesce(j->>'target_id',j->>'id'); ELSE v_body:=v_actor||' a créé ou modifié une opération dans la caisse fraternelle. Conséquence : le suivi financier a été actualisé. Les montants ne sont pas exposés dans l’aperçu.';link:='/caisse-fraternelle?financeId='||(j->>'id'); END IF;
 ELSIF TG_TABLE_NAME IN ('evaluations','evaluation_objectives') THEN
   v_body:=v_actor||' a mis à jour un élément du suivi d’évaluation. Conséquence : une action de suivi peut être attendue dans le module Évaluations. Les résultats restent dans l’espace autorisé.';
   link:='/evaluations?evaluationId='||CASE WHEN TG_TABLE_NAME='evaluation_objectives' THEN coalesce(j->>'evaluation_id','') ELSE coalesce(j->>'id','') END;
 ELSIF TG_TABLE_NAME IN ('team_life_events','team_life_polls') THEN
   v_body:=v_actor||CASE WHEN TG_OP='INSERT' THEN ' a créé' ELSE ' a modifié' END||' un élément de vie d’équipe : « '||coalesce(j->>'title',j->>'question','sans titre')||' ». Conséquence : consulte l’événement ou le sondage pour connaître les dates, modalités et réponses attendues.';
   link:='/vie-equipe?eventId='||CASE WHEN TG_TABLE_NAME='team_life_polls' THEN coalesce(j->>'event_id','') ELSE coalesce(j->>'id','') END;
 ELSIF TG_TABLE_NAME IN ('material_needs','material_requests','material_incidents','material_loans','material_documents') THEN
   v_body:=v_actor||' a créé ou modifié un élément matériel « '||coalesce(j->>'title',j->>'item_name',j->>'file_name','sans titre')||' ». Statut : '||coalesce(j->>'status','mis à jour')||'. Conséquence : le suivi matériel a changé ; consulte le détail pour voir les actions restantes.';
   IF TG_TABLE_NAME='material_loans' THEN link:='/materiel-mouvements?loanId='||(j->>'id');
   ELSIF TG_TABLE_NAME='material_documents' THEN link:=CASE WHEN j->>'entity_type'='need' THEN '/materiel-com?materialType=material_needs&itemId='||coalesce(j->>'entity_id','') WHEN j->>'entity_type'='request' THEN '/materiel-com?materialType=material_requests&itemId='||coalesce(j->>'entity_id','') ELSE '/materiel-com?materialType=inventory&itemId='||coalesce(j->>'entity_id','') END;
   ELSE link:='/materiel-com?materialType='||TG_TABLE_NAME||'&itemId='||coalesce(j->>'id',''); END IF;
 ELSIF TG_TABLE_NAME='program_documents' THEN
   v_body:=v_actor||' a ajouté ou modifié le document « '||coalesce(j->>'title',j->>'file_name','document sans titre')||' » dans le programme « '||coalesce(v_program_title,'sans titre')||' ». Conséquence : le document est disponible dans l’onglet Documents & notes de la fiche programme.';
   link:='/programme/'||coalesce(pid,'')||'?tab=documents#program-document-'||(j->>'id');
 ELSIF TG_TABLE_NAME IN ('program_debriefs','program_debrief_contributions') THEN
   v_body:=v_actor||CASE WHEN TG_OP='INSERT' THEN ' a ajouté' ELSE ' a modifié' END||CASE WHEN TG_TABLE_NAME='program_debriefs' THEN ' la synthèse post-service' ELSE ' un retour post-service' END||' du programme « '||coalesce(v_program_title,'sans titre')||' ». Conséquence : le retour d’expérience et les suites à donner ont été actualisés.';
   link:='/post-service?programId='||coalesce(pid,'');
 ELSIF TG_TABLE_NAME='member_availability' THEN
   v_body:=v_actor||' a créé ou modifié une indisponibilité. Période : '||coalesce(j->>'starts_at','à préciser')||' à '||coalesce(j->>'ends_at','à préciser')||'. Conséquence : cette période doit être prise en compte dans le suivi des disponibilités.';
   link:='/disponibilites?availabilityId='||(j->>'id');
 ELSIF TG_TABLE_NAME IN ('member_training_paths','member_training_steps','member_training_sessions') THEN
   v_body:=v_actor||' a mis à jour un parcours de formation ou une séance. Élément : « '||coalesce(j->>'title',j->>'label',j->>'name','formation')||' ». Conséquence : le parcours et sa progression ont été actualisés.';
   link:='/formations?trainingId='||coalesce(j->>'id',j->>'member_training_path_id',j->>'member_training_step_id','');
 END IF;
 PERFORM icc_private.emit(members,typ,title,left(coalesce(v_body,'Une action a été effectuée. Ouvre l’élément concerné pour consulter son état.'),1200),link,TG_TABLE_NAME,coalesce(j->>'id',pid),key);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $function$
;
