-- Use the existing role matrix as the authoritative model setting.
CREATE OR REPLACE FUNCTION public.can_manage_program_model(p_poles jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND (
 public.access_scope_for_user(auth.uid(),'modeles','gerer') IN ('tous','all')
 OR (jsonb_array_length(coalesce(p_poles,'[]'))>0 AND NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements_text(coalesce(p_poles,'[]')) p
 WHERE NOT public.scope_allows_pole(auth.uid(),'modeles','gerer',p::uuid))));
$$;
REVOKE ALL ON FUNCTION public.can_manage_program_model(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_program_model(jsonb) TO authenticated;
ALTER POLICY program_models_write_staff ON public.program_models
 USING(public.can_manage_program_model(poles)) WITH CHECK(public.can_manage_program_model(poles));

CREATE OR REPLACE FUNCTION public.check_program_write_access(p_program_id text,p_poles uuid[],p_task_poles uuid[] DEFAULT '{}',p_generate boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE pid uuid; sc text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Votre session a expiré. Reconnectez-vous.'; END IF;
 sc:=public.access_scope_for_user(auth.uid(),'programmes','creer');
 IF (p_program_id IS NULL OR p_generate) AND sc NOT IN ('tous','all','mon_pole','mon_groupe') THEN
 RAISE EXCEPTION 'Vous ne disposez pas du droit de créer des programmes. Contactez la responsable.'; END IF;
 IF p_program_id IS NOT NULL AND NOT public.scope_allows_program(auth.uid(),'programmes','modifier',p_program_id) THEN
 RAISE EXCEPTION 'Vous ne pouvez pas modifier ce programme avec vos droits actuels. Contactez la responsable.'; END IF;
 IF coalesce(cardinality(p_poles),0)=0 AND public.access_scope_for_user(auth.uid(),'programmes','modifier') NOT IN ('tous','all') THEN
 RAISE EXCEPTION 'Sélectionnez au moins un pôle dont vous êtes référent.'; END IF;
 FOREACH pid IN ARRAY coalesce(p_poles,'{}') LOOP
 IF NOT public.scope_allows_pole(auth.uid(),'programmes','affecter',pid) THEN
 RAISE EXCEPTION 'Un pôle sélectionné est hors de votre périmètre. Choisissez vos pôles ou contactez la responsable.'; END IF;
 END LOOP;
 IF p_program_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.program_assignments a WHERE a.program_id=p_program_id AND NOT public.scope_allows_pole(auth.uid(),'programmes','affecter',a.pole_id)) THEN
 RAISE EXCEPTION 'Ce programme concerne aussi des pôles hors de votre périmètre. Sa modification complète nécessite la responsable.'; END IF;
 IF p_generate AND p_program_id IS NOT NULL THEN
 SELECT array_agg(coalesce(pole_id,CASE WHEN cardinality(p_poles)=1 THEN p_poles[1] END)) INTO p_task_poles FROM public.tasks WHERE program_id=p_program_id;
 END IF;
 FOREACH pid IN ARRAY coalesce(p_task_poles,'{}') LOOP
 IF NOT public.scope_allows_pole(auth.uid(),'taches','creer',pid) THEN
 IF pid IS NULL THEN RAISE EXCEPTION 'Précisez le pôle de chaque tâche avant de générer le planning.'; END IF;
 RAISE EXCEPTION 'Vous ne pouvez pas créer les tâches de ce pôle. Contactez la responsable.'; END IF;
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.check_program_write_access(text,uuid[],uuid[],boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.check_program_write_access(text,uuid[],uuid[],boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.program_editor_permissions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
SELECT jsonb_build_object(
 'create_scope',public.access_scope_for_user(auth.uid(),'programmes','creer'),
 'model_scope',public.access_scope_for_user(auth.uid(),'modeles','gerer'),
 'assignment_poles',coalesce((SELECT jsonb_agg(id) FROM public.poles WHERE public.scope_allows_pole(auth.uid(),'programmes','affecter',id)),'[]'),
 'model_poles',coalesce((SELECT jsonb_agg(id) FROM public.poles WHERE public.scope_allows_pole(auth.uid(),'modeles','gerer',id)),'[]'));
$$;
REVOKE ALL ON FUNCTION public.program_editor_permissions() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.program_editor_permissions() TO authenticated;

-- Self editing is restricted to a fixed list of personal fields.
CREATE OR REPLACE FUNCTION public.guard_member_self_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE editable text[]:=ARRAY['first_name','last_name','full_name','photo_url','photo_crop','arrival_year','arrival_month','birthday_day','birthday_month','affiliations','is_ejp','is_icc','updated_at'];
BEGIN
 IF OLD.auth_user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.app_settings WHERE id='main' AND birthday_hide_allowed) THEN editable:=editable||ARRAY['birthday_hidden']; END IF;
 IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) AND
 (to_jsonb(NEW)-editable) IS DISTINCT FROM (to_jsonb(OLD)-editable) THEN
 RAISE EXCEPTION 'L’adresse e-mail, les rôles, les habilitations et le suivi administratif ne sont pas modifiables depuis votre fiche.';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_member_self_edit() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_member_self_edit ON public.members;
CREATE TRIGGER guard_member_self_edit BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.guard_member_self_edit();
DROP POLICY IF EXISTS members_update_own_personal ON public.members;
CREATE POLICY members_update_own_personal ON public.members FOR UPDATE TO authenticated
 USING(auth_user_id=(SELECT auth.uid()) AND deleted=false)
 WITH CHECK(auth_user_id=(SELECT auth.uid()) AND deleted=false);

CREATE OR REPLACE FUNCTION public.update_my_member_profile(p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE keys text[]:=ARRAY['first_name','last_name','photo_url','arrival_year','arrival_month','birthday_day','birthday_month','affiliations','is_ejp','is_icc']; d integer; m integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Reconnectez-vous pour modifier votre fiche.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT k=ANY(keys)) THEN RAISE EXCEPTION 'Ce champ ne peut pas être modifié dans votre fiche personnelle.'; END IF;
 IF btrim(coalesce(p_data->>'first_name','')||' '||coalesce(p_data->>'last_name',''))='' THEN RAISE EXCEPTION 'Le nom est obligatoire.'; END IF;
 d:=nullif(p_data->>'birthday_day','')::integer;m:=nullif(p_data->>'birthday_month','')::integer;
 IF (d IS NULL)<>(m IS NULL) THEN RAISE EXCEPTION 'Renseignez le jour et le mois de naissance ensemble.'; END IF;
 IF d IS NOT NULL THEN PERFORM make_date(2000,m,d); END IF;
 IF nullif(p_data->>'arrival_month','')::integer NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Mois d’arrivée invalide.'; END IF;
 UPDATE public.members SET first_name=btrim(p_data->>'first_name'),last_name=btrim(p_data->>'last_name'),
 full_name=btrim(coalesce(p_data->>'first_name','')||' '||coalesce(p_data->>'last_name','')),
 photo_url=nullif(p_data->>'photo_url',''),arrival_year=nullif(p_data->>'arrival_year','')::integer,
 arrival_month=nullif(p_data->>'arrival_month','')::integer,birthday_day=d,birthday_month=m,
 affiliations=nullif(p_data->>'affiliations',''),is_ejp=coalesce((p_data->>'is_ejp')::boolean,false),
 is_icc=coalesce((p_data->>'is_icc')::boolean,false),updated_at=now()
 WHERE auth_user_id=auth.uid() AND deleted=false;
 IF NOT FOUND THEN RAISE EXCEPTION 'Votre compte n’est pas relié à une fiche membre active.'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.update_my_member_profile(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_my_member_profile(jsonb) TO authenticated;

DROP POLICY IF EXISTS member_photos_insert_own ON storage.objects;
CREATE POLICY member_photos_insert_own ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='member-photos' AND (storage.foldername(name))[1]='self' AND (storage.foldername(name))[2]=(SELECT auth.uid())::text);
