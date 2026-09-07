import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export const ROLE_LABEL: Record<AppRole, string> = {
  responsable: "Responsable",
  adjoint: "Adjoint",
  admin_technique: "Administrateur technique",
  referent: "Référent",
  equipier: "Équipier",
};

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setUser(next?.user ?? null);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user, loading };
}

/**
 * Rôle applicatif dérivé de la structure réelle :
 * - Équipier par défaut ;
 * - Référent si le membre est référent d'au moins un pôle ;
 * - Responsable / Adjoint selon Paramètres > Direction ;
 * - admin_technique reste un accès transversal et ne remplace pas le rôle hiérarchique.
 *
 * La synchronisation Realtime est centralisée dans RealtimeQuerySync afin d'éviter
 * de créer plusieurs canaux identiques lorsque useCurrentRole est utilisé par
 * plusieurs composants de la même page.
 */
export function useCurrentRole() {
  const { user, loading } = useAuth();

  const query = useQuery({
    queryKey: ["current-role", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [rolesRes, permsRes, memberRes, settingsRes] = await Promise.all([
        supabase.from("user_roles").select("role, active").eq("user_id", user!.id).eq("active", true),
        supabase.from("role_permissions").select("role, permission"),
        supabase.from("members").select("id, full_name, photo_url").eq("auth_user_id", user!.id).maybeSingle(),
        supabase.from("app_settings").select("supervisor_member_id, adjoint_member_id").eq("id", "main").maybeSingle(),
      ]);

      const roles = (rolesRes.data ?? []).map((r) => r.role as AppRole);
      const memberId = memberRes.data?.id ?? null;
      const configuredRole: AppRole | null = memberId && settingsRes.data?.supervisor_member_id === memberId
        ? "responsable"
        : memberId && settingsRes.data?.adjoint_member_id === memberId
          ? "adjoint"
          : null;
      if (configuredRole && !roles.includes(configuredRole)) roles.push(configuredRole);

      const order: AppRole[] = ["responsable", "adjoint", "referent", "equipier"];
      const role = order.find((r) => roles.includes(r)) ?? (roles[0] ?? "equipier");
      const permissions = new Set(
        (permsRes.data ?? []).filter((p) => roles.includes(p.role as AppRole)).map((p) => p.permission),
      );

      return { role, roles, permissions, member: memberRes.data ?? null };
    },
  });

  const role = query.data?.role ?? null;
  const roles = query.data?.roles ?? [];
  const isTechAdmin = roles.includes("admin_technique");

  return {
    loading: loading || query.isLoading,
    userId: user?.id,
    role,
    roles,
    isTechAdmin,
    member: query.data?.member ?? null,
    isAdmin: role === "responsable" || role === "adjoint" || isTechAdmin,
    isStaff:
      role === "responsable" || role === "adjoint" || role === "referent" || isTechAdmin,
    can: (permission: string) =>
      role === "responsable" || isTechAdmin || (query.data?.permissions.has(permission) ?? false),
  };
}
