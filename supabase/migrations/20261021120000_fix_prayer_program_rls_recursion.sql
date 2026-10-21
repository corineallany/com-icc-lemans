-- Break the prayer_programs <-> prayer_program_slots RLS cycle without widening access.
CREATE OR REPLACE FUNCTION public.can_manage_prayer_program(p_program_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND (
      public.can_manage_access_matrix()
      OR EXISTS (
        SELECT 1
        FROM public.prayer_program_slots AS s
        JOIN public.members AS m
          ON m.id = ANY (s.attendance_manager_member_ids)
        WHERE s.program_id = p_program_id
          AND m.auth_user_id = (SELECT auth.uid())
          AND COALESCE(m.deleted, false) = false
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.can_manage_prayer_program(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_prayer_program(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_manage_prayer_program(uuid) TO authenticated;

DROP POLICY IF EXISTS prayer_programs_managers ON public.prayer_programs;
CREATE POLICY prayer_programs_managers
  ON public.prayer_programs
  FOR ALL
  TO authenticated
  USING ((SELECT public.can_manage_prayer_program(id)))
  WITH CHECK ((SELECT public.can_manage_access_matrix()));