CREATE OR REPLACE FUNCTION icc_private.enrich_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 j jsonb;
 oldj jsonb := '{}'::jsonb;
 pid text;
 eid text;
 actor text;
 program_title text;
 subject text;
 task_title text;
 action_label text;
 impact text;
 new_title text;
 new_body text;
 new_link text;
 status_label text;
 changes text[] := '{}';
BEGIN
 IF TG_OP='DELETE' THEN j:=to_jsonb(OLD); ELSE j:=to_jsonb(NEW); END IF;
 IF TG_OP='UPDATE' THEN oldj:=to_jsonb(OLD); END IF;
 pid:=coalesce(j->>'program_id',oldj->>'program_id');
 IF TG_TABLE_NAME='program_assignment_members' THEN SELECT a.program_id INTO pid FROM public.program_assignments a WHERE a.id=(j->>'assignment_id')::uuid; END IF;
 eid:=coalesce(j->>'id',oldj->>'id',pid);
 SELECT coalesce(nullif(btrim(m.full_name),''),'Un membre') INTO actor
 FROM public.members m WHERE m.auth_user_id=auth.uid() AND NOT m.deleted LIMIT 1;
 actor:=coalesce(actor,'Une action automatique');
 SELECT nullif(btrim(p.title),'') INTO program_title FROM public.programs p WHERE p.id=pid;
 SELECT coalesce(program_title,nullif(j->>'event_name',''),nullif(j->>'title',''),nullif(j->>'item_name',''),nullif(j->>'file_name',''),TG_TABLE_NAME)
 INTO program_title;
 new_link:=NULL;
 new_title:=NULL;
 new_body:=NULL;

 IF TG_TABLE_NAME='program_assignment_members' THEN
   SELECT coalesce(nullif(btrim(m.full_name),''),'le membre concerné') INTO subject FROM public.members m WHERE m.id=j->>'member_id';
   SELECT coalesce(nullif(btrim(a.tasks),''),'mission de mobilisation') INTO task_title FROM public.program_assignments a WHERE a.id=(j->>'assignment_id')::uuid;
   new_title:=CASE WHEN TG_OP='DELETE' THEN 'Affectation retirée — ' ELSE 'Affectation enregistrée — ' END||coalesce(program_title,'programme sans titre');
   IF TG_OP='DELETE' THEN
     new_body:=actor||' a retiré l’affectation de '||coalesce(subject,'la personne concernée')||' pour le programme « '||coalesce(program_title,'sans titre')||' ». Besoin : '||coalesce(task_title,'mission de mobilisation')||'. Conséquence : cette personne n’est plus comptée comme affectée à ce besoin. Vérifie la couverture restante.';
   ELSE
     new_body:=actor||' a enregistré une affectation pour '||coalesce(subject,'un membre')||' sur le programme « '||coalesce(program_title,'sans titre')||' ». Besoin : '||coalesce(task_title,'mission de mobilisation')||'. Conséquence : cette personne est ajoutée au suivi de mobilisation.';
   END IF;
   new_link:='/programme/'||coalesce(pid,'')||'?tab=participation#assignment-'||(j->>'assignment_id');
 ELSIF TG_TABLE_NAME='program_assignments' AND TG_OP='DELETE' THEN
   new_title:='Besoin de mobilisation supprimé — '||coalesce(program_title,'programme');
   new_body:=actor||' a supprimé le besoin « '||coalesce(nullif(j->>'tasks',''),'mission de mobilisation')||' » du programme « '||coalesce(program_title,'sans titre')||' ». Conséquence : ce besoin n’est plus proposé dans les besoins à couvrir ; vérifie les effectifs restants.';
   new_link:='/programme/'||coalesce(pid,'')||'?tab=participation';
 ELSIF TG_TABLE_NAME='programs' AND TG_OP='UPDATE' THEN
   IF j->>'title' IS DISTINCT FROM oldj->>'title' THEN changes:=array_append(changes,'intitulé'); END IF;
   IF j->>'start_date' IS DISTINCT FROM oldj->>'start_date' OR j->>'end_date' IS DISTINCT FROM oldj->>'end_date' THEN changes:=array_append(changes,'dates'); END IF;
   IF j->>'start_time' IS DISTINCT FROM oldj->>'start_time' OR j->>'end_time' IS DISTINCT FROM oldj->>'end_time' THEN changes:=array_append(changes,'horaires'); END IF;
   IF j->>'location' IS DISTINCT FROM oldj->>'location' THEN changes:=array_append(changes,'lieu'); END IF;
   IF j->>'status' IS DISTINCT FROM oldj->>'status' THEN changes:=array_append(changes,'statut'); END IF;
   IF j->>'description' IS DISTINCT FROM oldj->>'description' THEN changes:=array_append(changes,'description'); END IF;
   new_title:='Programme modifié — '||coalesce(program_title,'sans titre');
   new_body:=actor||' a modifié le programme « '||coalesce(program_title,'sans titre')||' ». Éléments modifiés : '||coalesce(array_to_string(changes,', '),'informations générales')||'. Conséquence : les informations de référence ont changé ; consulte la fiche pour voir les valeurs actuelles.';
   new_link:='/programme/'||coalesce(pid,'')||'?tab=infos';
 ELSIF TG_TABLE_NAME='program_member_responses' THEN
   SELECT coalesce(nullif(btrim(m.full_name),''),'Un membre') INTO subject FROM public.members m WHERE m.id=j->>'member_id';
   status_label:=CASE j->>'status' WHEN 'available' THEN 'disponible' WHEN 'partial' THEN 'disponible partiellement' WHEN 'unavailable' THEN 'indisponible' ELSE coalesce(j->>'status','mise à jour') END;
   new_title:='Réponse de '||coalesce(subject,'un membre')||' — '||coalesce(program_title,'programme');
   new_body:=coalesce(subject,'Un membre')||' a indiqué être '||status_label||' pour le programme « '||coalesce(program_title,'sans titre')||' ». Conséquence : les responsables peuvent actualiser la mobilisation et repérer les besoins qui restent à couvrir.';
   new_link:='/programme/'||coalesce(pid,'')||'?tab=participation#program-response';
 ELSIF TG_TABLE_NAME='solicitation_recipients' THEN
   SELECT coalesce(nullif(btrim(s.event_name),''),'sollicitation') INTO subject FROM public.solicitations s WHERE s.id=j->>'solicitation_id';
   IF j->>'response' IS DISTINCT FROM oldj->>'response' OR j->>'reserve' IS DISTINCT FROM oldj->>'reserve' THEN
     new_title:='Réponse reçue — '||coalesce(subject,'sollicitation');
     new_body:=actor||' a enregistré une réponse « '||coalesce(j->>'response','sans réponse')||coalesce(' / '||nullif(j->>'reserve',''),'')||' » à la sollicitation « '||coalesce(subject,'sollicitation')||' ». Conséquence : le demandeur et les responsables peuvent actualiser le suivi.';
   ELSIF TG_OP='INSERT' THEN
     new_title:='Nouvelle sollicitation — '||coalesce(subject,'demande ponctuelle');
     new_body:=actor||' vous a adressé la sollicitation « '||coalesce(subject,'demande ponctuelle')||' ». Conséquence : une réponse est attendue selon le délai indiqué dans la demande.';
   ELSE
     new_title:='Sélection mise à jour — '||coalesce(subject,'sollicitation');
     new_body:=actor||' a mis à jour votre sélection pour « '||coalesce(subject,'sollicitation')||' ». Conséquence : le demandeur voit désormais la sélection actualisée.';
   END IF;
   new_link:='/sollicitations?solicitationId='||coalesce(j->>'solicitation_id','');
 ELSIF TG_TABLE_NAME='solicitations' THEN
   new_title:=CASE WHEN j->>'cancelled_at' IS DISTINCT FROM oldj->>'cancelled_at' AND j->>'cancelled_at' IS NOT NULL THEN 'Sollicitation annulée — ' ELSE 'Sollicitation mise à jour — ' END||coalesce(j->>'event_name','demande');
   new_body:=actor||CASE WHEN j->>'cancelled_at' IS DISTINCT FROM oldj->>'cancelled_at' AND j->>'cancelled_at' IS NOT NULL THEN ' a annulé' ELSE ' a modifié' END||' la sollicitation « '||coalesce(j->>'event_name','sans intitulé')||' ».';
   IF nullif(j->>'event_date','') IS NOT NULL THEN new_body:=new_body||' Date concernée : '||to_char((j->>'event_date')::date,'DD/MM/YYYY')||'.'; END IF;
   IF nullif(j->>'response_deadline','') IS NOT NULL THEN new_body:=new_body||' Réponse attendue avant : '||to_char((j->>'response_deadline')::date,'DD/MM/YYYY')||'.'; END IF;
   IF nullif(j->>'cancellation_note','') IS NOT NULL AND j->>'cancelled_at' IS NOT NULL THEN new_body:=new_body||' Motif : '||left(j->>'cancellation_note',180)||'.'; END IF;
   new_body:=new_body||' Conséquence : les destinataires doivent tenir compte de cet état avant de répondre.';
   new_link:='/sollicitations?solicitationId='||coalesce(j->>'id','');
 ELSIF TG_TABLE_NAME='tasks' THEN
   new_title:=CASE WHEN TG_OP='INSERT' THEN 'Nouvelle tâche — ' ELSE 'Tâche mise à jour — ' END||coalesce(j->>'title','sans titre');
   new_body:=actor||CASE WHEN TG_OP='INSERT' THEN ' a créé' ELSE ' a modifié' END||' la tâche « '||coalesce(j->>'title','sans titre')||' ».';
   IF nullif(j->>'due_date','') IS NOT NULL THEN new_body:=new_body||' Échéance : '||to_char((j->>'due_date')::date,'DD/MM/YYYY')||'.'; END IF;
   IF nullif(j->>'status','') IS NOT NULL THEN new_body:=new_body||' Statut actuel : '||(j->>'status')||'.'; END IF;
   IF pid IS NOT NULL THEN new_body:=new_body||' Programme concerné : « '||coalesce(program_title,'sans titre')||' ». '; END IF;
   new_body:=new_body||' Conséquence : le suivi de la tâche a été actualisé.';
   new_link:='/taches?taskId='||coalesce(j->>'id','');
 ELSIF TG_TABLE_NAME='member_availability' THEN
   SELECT coalesce(nullif(btrim(m.full_name),''),'le membre concerné') INTO subject FROM public.members m WHERE m.id=j->>'member_id';
   new_title:=CASE WHEN TG_OP='INSERT' THEN 'Nouvelle indisponibilité — ' ELSE 'Indisponibilité mise à jour — ' END||coalesce(subject,'membre');
   new_body:=actor||CASE WHEN TG_OP='INSERT' THEN ' a déclaré une indisponibilité pour '||coalesce(subject,'un membre') ELSE ' a mis à jour une indisponibilité concernant '||coalesce(subject,'un membre') END||'. Période : '||coalesce(to_char((j->>'starts_at')::timestamptz,'DD/MM/YYYY HH24:MI'),'à préciser')||' – '||coalesce(to_char((j->>'ends_at')::timestamptz,'DD/MM/YYYY HH24:MI'),'à préciser')||'. Conséquence : cette période doit être prise en compte dans le suivi des disponibilités.';
   new_link:='/disponibilites?availabilityId='||coalesce(j->>'id','');
 ELSIF TG_TABLE_NAME='program_documents' THEN
   new_title:='Document de programme — '||coalesce(j->>'title','document');
   new_body:=actor||' a ajouté ou modifié le document « '||coalesce(j->>'title','sans titre')||' » pour le programme « '||coalesce(program_title,'sans titre')||' ». Conséquence : le document de référence est disponible dans la fiche du programme.';
   new_link:='/programme/'||coalesce(pid,'')||'?tab=documents#document-'||(j->>'id');
 ELSIF TG_TABLE_NAME IN ('evaluations','evaluation_objectives') THEN
   new_title:=CASE WHEN TG_TABLE_NAME='evaluations' THEN 'Évaluation mise à jour' ELSE 'Objectif d’évaluation mis à jour' END;
   new_body:=actor||' a mis à jour un élément du suivi d’évaluation. Conséquence : une action de suivi peut être attendue dans le module Évaluations. Les commentaires et résultats restent visibles uniquement dans l’espace autorisé.';
   new_link:='/evaluations?evaluationId='||coalesce(j->>'id',j->>'evaluation_id','');
 ELSIF TG_TABLE_NAME IN ('team_finance_contributions','team_finance_expenses','team_finance_entries','team_finance_corrections') THEN
   new_title:='Caisse fraternelle — opération mise à jour';
   new_body:=actor||' a créé ou modifié une opération dans la caisse fraternelle. Conséquence : le suivi financier a été actualisé ; consulte le module avec tes droits d’accès. Les montants ne sont pas exposés dans l’aperçu de notification.';
   new_link:='/caisse-fraternelle';
 ELSIF TG_TABLE_NAME IN ('material_needs','material_requests','material_incidents','material_loans','material_documents') THEN
   new_title:=CASE TG_TABLE_NAME WHEN 'material_needs' THEN 'Besoin matériel' WHEN 'material_requests' THEN 'Demande matériel' WHEN 'material_incidents' THEN 'Incident matériel' WHEN 'material_loans' THEN 'Mouvement de matériel' ELSE 'Document matériel' END||' — '||coalesce(j->>'title',j->>'item_name',j->>'file_name','élément');
   new_body:=actor||' a créé ou modifié « '||coalesce(j->>'title',j->>'item_name',j->>'file_name','un élément matériel')||' ».';
   IF nullif(j->>'status','') IS NOT NULL THEN new_body:=new_body||' Statut : '||(j->>'status')||'.'; END IF;
   IF pid IS NOT NULL THEN new_body:=new_body||' Programme concerné : « '||coalesce(program_title,'sans titre')||' ». '; END IF;
   new_body:=new_body||' Conséquence : le suivi matériel a été actualisé ; ouvre le module pour voir le détail et les actions restantes.';
   new_link:='/materiel-com?itemId='||coalesce(j->>'id','');
 ELSE
   new_title:=coalesce((SELECT n.title FROM public.notifications n WHERE n.entity_type=TG_TABLE_NAME AND n.entity_id=eid AND n.created_at=transaction_timestamp() LIMIT 1),replace(TG_TABLE_NAME,'_',' ')||' mis à jour')||CASE WHEN program_title IS NOT NULL AND program_title<>TG_TABLE_NAME THEN ' — '||program_title ELSE '' END;
   new_body:=actor||' a déclenché une mise à jour dans « '||replace(TG_TABLE_NAME,'_',' ')||' ». Élément concerné : « '||coalesce(program_title,'élément sans intitulé')||' ». Conséquence : le suivi de cet élément a été actualisé ; ouvre le module pour vérifier son état actuel.';
 END IF;

 UPDATE public.notifications n
 SET title=left(coalesce(new_title,n.title),180),
     body=left(coalesce(new_body,n.body),1200),
     link=coalesce(new_link,n.link),
     updated_at=now()
 WHERE n.entity_type=TG_TABLE_NAME
   AND n.entity_id=eid
   AND n.created_at=transaction_timestamp();
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$function$


DO $block$
DECLARE t text;
BEGIN
 FOR t IN
  SELECT DISTINCT event_object_table
  FROM information_schema.triggers
  WHERE trigger_schema='public'
    AND action_statement ILIKE '%icc_private.event_notification%'
 LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS zzz_enrich_notification ON public.%I',t);
  EXECUTE format('CREATE TRIGGER zzz_enrich_notification AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION icc_private.enrich_notification()',t);
 END LOOP;
END;
$block$;
