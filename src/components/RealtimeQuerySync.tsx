import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Invalidate only the cached data that depends on the changed table. The former
// global invalidation made every active screen refetch after every database event.
const TABLE_QUERY_KEYS: Record<string, QueryKey[]> = {
  app_settings: [["app-settings"], ["current-role"], ["team-finance-summary"]],
  user_roles: [["current-role"]],
  role_permissions: [["current-role"]],
  members: [
    ["members"], ["current-role"], ["home-my-training"], ["home-my-objectives"],
    ["org-training"], ["home-birthday-summary"],
  ],
  member_poles: [["members"], ["poles"], ["programs"], ["current-role"], ["org-dashboard-scope"]],
  poles: [["poles"], ["members"], ["programs"]],
  programs: [["programs"], ["program-debriefs"], ["program-attendance"], ["program-documents"]],
  program_assignments: [["programs"]],
  program_assignment_members: [["programs"]],
  program_assignment_audit: [["programs"]],
  program_assignment_member_slots: [["programs"]],
  program_assignment_slot_needs: [["programs"]],
  program_assignment_withdrawal_requests: [["programs"]],
  program_member_slot_choices: [["programs"]],
  program_response_history: [["programs"]],
  program_service_slots: [["programs"]],
  program_days: [["programs"]],
  program_proposals: [["programs"]],
  program_member_responses: [["programs"]],
  tasks: [["tasks"]],
  program_models: [["program-models"]],
  solicitations: [["solicitations"]],
  solicitation_recipients: [["home-solicitation-recipients"], ["solicitations"]],
  solicitation_decision_history: [["solicitations"]],
  solicitation_recipient_slot_choices: [["solicitations"]],
  solicitation_response_history: [["solicitations"]],
  evaluations: [["evaluations"]],
  evaluation_objectives: [["home-my-objectives"]],
  training_paths: [["home-training-paths"], ["org-training-paths"]],
  member_training_paths: [["home-my-training"], ["org-training"]],
  member_availability: [["member-availability"]],
  program_debriefs: [["program-debriefs"]],
  program_debrief_contributions: [["program-debriefs"]],
  material_items: [["org-material-items"]],
  material_needs: [["org-material-needs"]],
  notifications: [["notifications"], ["notification-center"]],
  team_finance_entries: [["team-finance-summary"]],
  team_finance_contributions: [["team-finance-summary"]],
  team_finance_expenses: [["team-finance-summary"]],
  team_finance_adjustments: [["team-finance-summary"]],
  team_finance_corrections: [["team-finance-summary"]],
  team_finance_managers: [["team-finance-summary"]],
  team_life_events: [["ve-events"], ["home-team-life-events"], ["ve-history"]],
  team_life_event_history: [["ve-history"]],
  team_life_polls: [["ve-polls"], ["home-team-life-polls"]],
  team_life_poll_options: [["ve-options"]],
  team_life_poll_votes: [["ve-votes"]],
  team_life_participations: [["ve-parts"]],
  prayer_subjects: [["prayer-subjects"], ["archives"]],
  prayer_programs: [["prayer-programs"], ["archives"]],
  prayer_program_slots: [["prayer-program-slots"]],
  prayer_program_attendance: [["prayer-attendance"]],
};

export function RealtimeQuerySync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const changedTables = new Set<string>();

    const flush = () => {
      timer = null;
      const keys = new Map<string, QueryKey>();
      for (const table of changedTables) {
        for (const queryKey of TABLE_QUERY_KEYS[table] ?? []) {
          keys.set(JSON.stringify(queryKey), queryKey);
        }
      }
      changedTables.clear();
      for (const queryKey of keys.values()) {
        void queryClient.invalidateQueries({ queryKey, refetchType: "active" });
      }
    };

    const onChange = (payload: { table?: string }) => {
      if (!payload.table || !TABLE_QUERY_KEYS[payload.table]) return;
      changedTables.add(payload.table);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 300);
    };

    const channel = supabase
      .channel("icc-operational-realtime")
      .on("postgres_changes", { event: "*", schema: "public" }, onChange)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return null;
}
