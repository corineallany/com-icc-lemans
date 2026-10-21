-- Enable change events only for active operational tables that the app must refresh live.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'role_permissions',
    'prayer_subjects','prayer_programs','prayer_program_slots','prayer_program_attendance',
    'team_life_event_history',
    'program_assignment_audit','program_assignment_member_slots','program_assignment_slot_needs',
    'program_assignment_withdrawal_requests','program_member_slot_choices','program_response_history',
    'program_service_slots','program_days','program_proposals','program_debrief_contributions',
    'solicitation_decision_history','solicitation_recipient_slot_choices','solicitation_response_history'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
         WHERE pubname='supabase_realtime'
           AND schemaname='public'
           AND tablename=t
       ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;