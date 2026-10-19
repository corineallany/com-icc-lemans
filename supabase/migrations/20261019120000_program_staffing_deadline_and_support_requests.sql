-- Configurable response deadlines for programs and individual service slots.
-- Support requests created from a program keep their source context in Demandes ponctuelles.
alter table public.programs
  add column if not exists response_deadline_offset_value integer,
  add column if not exists response_deadline_offset_unit text,
  add column if not exists response_deadline_anchor text,
  add column if not exists response_deadline_at timestamptz;

alter table public.program_service_slots
  add column if not exists response_deadline_offset_value integer,
  add column if not exists response_deadline_offset_unit text,
  add column if not exists response_deadline_anchor text,
  add column if not exists response_deadline_at timestamptz;

alter table public.solicitations
  add column if not exists response_deadline_at timestamptz,
  add column if not exists request_mission text,
  add column if not exists request_count integer,
  add column if not exists request_slot_id uuid references public.program_service_slots(id) on delete set null;

alter table public.programs
  drop constraint if exists programs_response_deadline_offset_unit_check,
  add constraint programs_response_deadline_offset_unit_check
    check (response_deadline_offset_unit is null or response_deadline_offset_unit in ('hours','days')),
  drop constraint if exists programs_response_deadline_anchor_check,
  add constraint programs_response_deadline_anchor_check
    check (response_deadline_anchor is null or response_deadline_anchor in ('program','slot'));

alter table public.program_service_slots
  drop constraint if exists program_service_slots_response_deadline_offset_unit_check,
  add constraint program_service_slots_response_deadline_offset_unit_check
    check (response_deadline_offset_unit is null or response_deadline_offset_unit in ('hours','days')),
  drop constraint if exists program_service_slots_response_deadline_anchor_check,
  add constraint program_service_slots_response_deadline_anchor_check
    check (response_deadline_anchor is null or response_deadline_anchor in ('program','slot'));

alter table public.solicitations
  drop constraint if exists solicitations_request_count_check,
  add constraint solicitations_request_count_check
    check (request_count is null or request_count >= 1);
