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
  program_assignments: [["programs"], ["program-staffing-needs"], ["solicitations"]],
  program_assignment_members: [["programs"], ["program-sheet-participation-modes"], ["program-assignment-modes"], ["program-staffing-needs"]],
  program_assignment_audit: [["programs"]],
  program_assignment_member_slots: [["programs"], ["program-assignment-member-slots-sheet"]],
  program_assignment_slot_needs: [["programs"], ["program-staffing-needs"]],
  program_assignment_withdrawal_requests: [["programs"]],
  program_member_slot_choices: [["programs"]],
  program_response_history: [["programs"]],
  program_service_slots: [["programs"], ["program-service-slots"]],
  program_days: [["programs"], ["program-days-sheet"], ["program-service-slots"]],
  program_proposals: [["programs"]],
  program_member_responses: [["programs"], ["program-responses"], ["solicitations"]],
  tasks: [["tasks"]],
  program_models: [["program-models"]],
  solicitations: [["solicitations"]],
  solicitation_recipients: [["home-solicitation-recipients"], ["solicitations"], ["solicitation-recipients"]],
  solicitation_targets: [["solicitations"], ["solicitation-targets"]],
  solicitation_recipient_targets: [["solicitations"], ["solicitation-recipient-targets"]],
  solicitation_responses: [["solicitations"], ["solicitation-recipients"]],
  solicitation_decision_history: [["solicitations"]],
  solicitation_recipient_slot_choices: [["solicitations"], ["solicitation-slot-choices"]],
  solicitation_response_history: [["solicitations"]],
  evaluations: [["evaluations"]],
  evaluation_objectives: [["home-my-objectives"]],
  training_paths: [["home-training-paths"], ["org-training-paths"]],
  member_training_paths: [["home-my-training"], ["org-training"]],
  member_availability: [["member-availability"]],
  program_debriefs: [["program-debriefs"]],
  program_debrief_contributions: [["program-debriefs"]],
  // Material module: use the exact React Query keys used by its screens.
  material_items: [["material-items"], ["org-material-items"]],
  material_item_poles: [["material-item-poles"], ["material-items"]],
  material_needs: [["material-needs"], ["org-material-needs"], ["material-receivable-needs"]],
  material_need_links: [["material-links"], ["material-needs"]],
  material_requests: [["material-requests"]],
  material_request_needs: [["material-request-needs"], ["material-requests"]],
  material_incidents: [["material-incidents"]],
  material_loans: [["material-loans"]],
  material_documents: [["material-docs"]],
  material_managers: [["material-managers"], ["material-managers-settings"]],
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
