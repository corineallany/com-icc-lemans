-- Fix UUID primary-key inserts in program member responses.
-- PostgreSQL generates the UUID; (program_id, member_id) remains the conflict key.
CREATE OR REPLACE FUNCTION public.respond_to_program_solicitation(p_program_id text, p_status public.response_status, p_note text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE mid text; clean text;
BEGIN
  SELECT id INTO mid FROM public.members WHERE auth_user_id=auth.uid() AND status='active' AND coalesce(deleted,false)=false LIMIT 1;
  IF mid IS NULL THEN RAISE EXCEPTION 'Compte non lié à un membre actif.'; END IF;
  IF p_status NOT IN ('available','partial','unavailable') THEN RAISE EXCEPTION 'Réponse invalide.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.program_assignment_members pam JOIN public.program_assignments pa ON pa.id=pam.assignment_id WHERE pa.program_id=p_program_id AND pam.member_id=mid AND pam.assignment_mode='solicited' AND pam.process_status='active') THEN
    RAISE EXCEPTION 'Aucune sollicitation active ne nécessite votre réponse pour ce programme.';
  END IF;
  clean:=nullif(btrim(coalesce(p_note,'')),'');
  INSERT INTO public.program_member_responses(program_id,member_id,status,reserve,reason,updated_at)
  VALUES(p_program_id,mid,p_status,CASE WHEN p_status='partial' THEN clean ELSE NULL END,CASE WHEN p_status='unavailable' THEN clean ELSE NULL END,now())
  ON CONFLICT(program_id,member_id) DO UPDATE SET status=excluded.status,reserve=excluded.reserve,reason=excluded.reason,updated_at=now();
END $function$;

CREATE OR REPLACE FUNCTION public.solicit_program_member(p_assignment_id uuid, p_member_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pid text; pol uuid; ttl text; uid uuid; existing_mode text;
BEGIN
  SELECT program_id,pole_id INTO pid,pol FROM public.program_assignments WHERE id=p_assignment_id;
  IF pid IS NULL THEN RAISE EXCEPTION 'Besoin introuvable.'; END IF;
  IF NOT public.scope_allows_pole(auth.uid(),'programmes','affecter',pol) THEN RAISE EXCEPTION 'Vous ne pouvez pas solliciter pour ce pôle.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.members WHERE id=p_member_id AND status='active' AND coalesce(deleted,false)=false) THEN RAISE EXCEPTION 'Ce membre est inactif ou introuvable.'; END IF;
  SELECT assignment_mode INTO existing_mode FROM public.program_assignment_members WHERE assignment_id=p_assignment_id AND member_id=p_member_id;
  IF existing_mode IN ('direct','proposal') THEN RAISE EXCEPTION 'Cette personne est déjà affectée à ce pôle.'; END IF;
  INSERT INTO public.program_assignment_members(assignment_id,member_id,assignment_mode,assigned_at,assigned_by,process_status,process_closed_at,process_closed_reason)
  VALUES(p_assignment_id,p_member_id,'solicited',NULL,NULL,'active',NULL,NULL)
  ON CONFLICT(assignment_id,member_id) DO UPDATE SET assignment_mode='solicited',assigned_at=NULL,assigned_by=NULL,process_status='active',process_closed_at=NULL,process_closed_reason=NULL;
  INSERT INTO public.program_member_responses(program_id,member_id,status,reason,reserve,updated_at)
  VALUES(pid,p_member_id,'pending',NULL,NULL,now())
  ON CONFLICT(program_id,member_id) DO UPDATE SET status='pending',reason=NULL,reserve=NULL,updated_at=now();
  SELECT title INTO ttl FROM public.programs WHERE id=pid;
  SELECT auth_user_id INTO uid FROM public.members WHERE id=p_member_id;
  IF uid IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,member_id,type,title,body,link,read,entity_type,entity_id,idempotency_key)
    VALUES(uid,p_member_id,'reponse_attendue','Réponse attendue — '||coalesce(ttl,'Programme'),
      'Vous êtes sollicité(e) pour participer au programme « '||coalesce(ttl,'Programme')||' ». Merci d’accepter, d’accepter partiellement ou de refuser.',
      '/programme/'||pid,false,'program',pid,
      'program-solicit:'||pid||':'||p_assignment_id::text||':'||p_member_id||':'||extract(epoch from clock_timestamp())::text);
  END IF;
END $function$;
