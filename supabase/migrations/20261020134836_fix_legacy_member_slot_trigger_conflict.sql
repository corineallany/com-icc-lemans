-- Fix the legacy day-level slot restoration trigger.
-- The unique index is partial because detailed service slots (service_slot_id IS NOT NULL)
-- can have multiple slots on the same day for one member.
CREATE OR REPLACE FUNCTION public.restore_program_member_slots_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_program text;
  v_pole uuid;
BEGIN
  SELECT program_id, pole_id
    INTO v_program, v_pole
  FROM public.program_assignments
  WHERE id = NEW.assignment_id;

  INSERT INTO public.program_assignment_member_slots(
    assignment_member_id, program_day_id, start_time, end_time
  )
  SELECT
    NEW.id,
    pd.id,
    COALESCE(s.start_time, pd.start_time),
    COALESCE(s.end_time, pd.end_time)
  FROM public.program_days pd
  LEFT JOIN public.program_member_slot_snapshots s
    ON s.program_id = v_program
   AND s.pole_id = v_pole
   AND s.member_id = NEW.member_id
   AND s.service_date = pd.service_date
  WHERE pd.program_id = v_program
    AND (
      s.service_date IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.program_member_slot_snapshots sx
        WHERE sx.program_id = v_program
          AND sx.pole_id = v_pole
          AND sx.member_id = NEW.member_id
      )
    )
  ON CONFLICT (assignment_member_id, program_day_id)
    WHERE service_slot_id IS NULL
    DO NOTHING;

  RETURN NEW;
END;
$function$;
