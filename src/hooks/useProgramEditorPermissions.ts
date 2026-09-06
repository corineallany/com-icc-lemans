import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export function useProgramEditorPermissions() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["program-editor-permissions", user?.id], enabled: !!user, staleTime: 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("program_editor_permissions");
      if (error) throw error;
      return data as { create_scope: string; model_scope: string; assignment_poles: string[]; model_poles: string[] };
    },
  });
}
