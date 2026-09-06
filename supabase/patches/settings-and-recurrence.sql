CREATE OR REPLACE FUNCTION public.can_manage_access_matrix()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT auth.uid() IS NOT NULL AND (
public.has_role(auth.uid(), 'admin_technique'::public.app_role)
OR EXISTS (SELECT 1 FROM public.members m JOIN public.app_settings s ON s.id='main' AND s.supervisor_member_id=m.id WHERE m.auth_user_id=auth.uid() AND m.deleted=false AND m.status='active')
); $$;
REVOKE ALL ON FUNCTION public.can_manage_access_matrix() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_access_matrix() TO authenticated;
ALTER POLICY app_settings_write_admin ON public.app_settings USING (public.can_manage_access_matrix()) WITH CHECK (public.can_manage_access_matrix());
-- Additive configuration; existing programs and models are unchanged.
ALTER TABLE public.program_models ADD COLUMN IF NOT EXISTS schedule jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.programs ADD COLUMN IF NOT EXISTS travel_member_ids text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.generate_program_occurrences(p_program_id text, p_dates date[])
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE src public.programs%rowtype; d date; delta integer; nid text; n integer:=0;
a record; am record; dayrow record; slotrow record; na uuid; nm uuid; nd uuid; ns uuid;
amap jsonb; mmap jsonb; dmap jsonb; smap jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.scope_allows_program(auth.uid(),'programmes','modifier',p_program_id) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
 IF coalesce(cardinality(p_dates),0)>104 THEN RAISE EXCEPTION '104 occurrences maximum'; END IF;
 SELECT * INTO STRICT src FROM public.programs WHERE id=p_program_id FOR UPDATE;
 IF src.start_date IS NULL THEN RAISE EXCEPTION 'Date de début requise'; END IF;
 FOREACH d IN ARRAY coalesce(p_dates,'{}'::date[]) LOOP
  IF d IS NULL OR d<src.start_date THEN RAISE EXCEPTION 'Date invalide'; END IF;
  IF d=src.start_date THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM public.programs WHERE creation_key='occ:'||p_program_id||':'||d::text) THEN CONTINUE; END IF;
  delta:=d-src.start_date; nid:='p_'||gen_random_uuid()::text;
  INSERT INTO public.programs SELECT (jsonb_populate_record(NULL::public.programs,
    to_jsonb(src)||jsonb_build_object('id',nid,'creation_key','occ:'||p_program_id||':'||d::text,
    'start_date',d,'end_date',src.end_date+delta,'response_deadline',src.response_deadline+delta,
    'recurrence_rule',coalesce(src.recurrence_rule,'{}')||jsonb_build_object('source_program_id',p_program_id),
    'created_at',now(),'updated_at',now(),'archived',false,'deleted',false))).*;
  amap:='{}'; mmap:='{}'; dmap:='{}'; smap:='{}';
  FOR a IN SELECT * FROM public.program_assignments WHERE program_id=p_program_id LOOP
   na:=gen_random_uuid(); amap:=amap||jsonb_build_object(a.id::text,na);
   INSERT INTO public.program_assignments(id,program_id,pole_id,tasks,required_count,assignment_rule)
   VALUES(na,nid,a.pole_id,a.tasks,a.required_count,a.assignment_rule);
   FOR am IN SELECT * FROM public.program_assignment_members WHERE assignment_id=a.id LOOP
    nm:=gen_random_uuid(); mmap:=mmap||jsonb_build_object(am.id::text,nm);
    INSERT INTO public.program_assignment_members(id,assignment_id,member_id) VALUES(nm,na,am.member_id);
   END LOOP;
  END LOOP;
  -- Program insert triggers may have created default days.
  DELETE FROM public.program_days WHERE program_id=nid;
  FOR dayrow IN SELECT * FROM public.program_days WHERE program_id=p_program_id LOOP
   nd:=gen_random_uuid(); dmap:=dmap||jsonb_build_object(dayrow.id::text,nd);
   INSERT INTO public.program_days(id,program_id,service_date,start_time,end_time,note)
   VALUES(nd,nid,dayrow.service_date+delta,dayrow.start_time,dayrow.end_time,dayrow.note);
  END LOOP;
  FOR slotrow IN SELECT * FROM public.program_service_slots WHERE program_id=p_program_id LOOP
   ns:=gen_random_uuid(); smap:=smap||jsonb_build_object(slotrow.id::text,ns);
   INSERT INTO public.program_service_slots(id,program_id,program_day_id,assignment_id,label,start_time,end_time,required_count,position)
   VALUES(ns,nid,(dmap->>slotrow.program_day_id::text)::uuid,(amap->>slotrow.assignment_id::text)::uuid,slotrow.label,slotrow.start_time,slotrow.end_time,slotrow.required_count,slotrow.position);
  END LOOP;
  INSERT INTO public.program_assignment_member_slots(assignment_member_id,program_day_id,service_slot_id,start_time,end_time)
  SELECT (mmap->>s.assignment_member_id::text)::uuid,(dmap->>s.program_day_id::text)::uuid,(smap->>s.service_slot_id::text)::uuid,s.start_time,s.end_time
  FROM public.program_assignment_member_slots s WHERE mmap ? s.assignment_member_id::text;
  INSERT INTO public.tasks(title,detail,program_id,pole_id,assignee_member_id,due_date,priority,status,created_by)
  SELECT title,detail,nid,pole_id,assignee_member_id,due_date+delta,priority,'todo',auth.uid() FROM public.tasks WHERE program_id=p_program_id;
  n:=n+1;
 END LOOP;
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.generate_program_occurrences(text,date[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.generate_program_occurrences(text,date[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_model_programs(p_model_id text,p_dates date[])
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m public.program_models%rowtype; nid text; pid text; t jsonb; d date; key text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
 IF coalesce(cardinality(p_dates),0)=0 OR cardinality(p_dates)>104 THEN RAISE EXCEPTION 'Dates requises (104 maximum)'; END IF;
 SELECT * INTO STRICT m FROM public.program_models WHERE id=p_model_id AND NOT archived AND NOT deleted FOR UPDATE;
 d:=p_dates[1]; key:='model:'||m.id||':'||d::text;
 SELECT id INTO nid FROM public.programs WHERE creation_key=key;
 IF nid IS NULL THEN
  nid:='p_'||gen_random_uuid()::text;
  INSERT INTO public.programs(id,creation_key,title,description,program_type,format,audience,status,start_date,end_date,start_time,end_time,recurrence,recurrence_until,recurrence_rule,general_note,response_deadline,response_deadline_offset_days,notification_rules)
  VALUES(nid,key,m.name,m.description,m.program_type,m.format,m.audience,'unconfirmed',d,d,
   nullif(m.schedule->>'start_time',''),nullif(m.schedule->>'end_time',''),coalesce(m.schedule->>'frequency','ponctuel'),
   nullif(m.schedule->>'until','')::date,coalesce(m.schedule->'rule','{}'),m.tasks,
   d-coalesce(m.response_deadline_days,0),m.response_deadline_days,m.notification_rules);
  FOR pid IN SELECT jsonb_array_elements_text(m.poles) LOOP
   INSERT INTO public.program_assignments(program_id,pole_id,tasks,required_count,assignment_rule)
   VALUES(nid,pid::uuid,m.tasks,nullif(m.staffing_requirements->>pid,'')::integer,m.assignment_rules);
  END LOOP;
  FOR t IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_array_length(coalesce(m.task_templates,'[]'))>0 THEN m.task_templates ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('title',value)) FROM jsonb_array_elements_text(m.checklist)), '[]') END) LOOP
   INSERT INTO public.tasks(title,program_id,pole_id,status,priority,due_date,created_by)
   VALUES(t->>'title',nid,nullif(t->>'pole_id','')::uuid,'todo',coalesce(t->>'priority','normale'),
   CASE WHEN t->>'due_offset_days' IS NOT NULL THEN d+(t->>'due_offset_days')::integer ELSE NULL END,auth.uid());
  END LOOP;
 END IF;
 PERFORM public.generate_program_occurrences(nid,p_dates);
 RETURN nid;
END; $$;
REVOKE ALL ON FUNCTION public.generate_model_programs(text,date[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.generate_model_programs(text,date[]) TO authenticated;
UPDATE public.programs p SET travel_member_ids=ARRAY(SELECT DISTINCT r.member_id FROM public.program_member_responses r WHERE r.program_id=p.id AND r.team_location='travel') WHERE cardinality(p.travel_member_ids)=0 AND EXISTS(SELECT 1 FROM public.program_member_responses r WHERE r.program_id=p.id AND r.team_location='travel');
