import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

// The database is authoritative; never infer configuration access from isStaff.
export function useSettingsAccess() {
  const { user } = useAuth();
  const result = useQuery({
    queryKey: ["settings-write-access", user?.id],
    enabled: !!user,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("can_manage_access_matrix");
      if (error) throw error;
      return data === true;
    },
  });
  return !!user && result.data === true && !result.isError;
}
