import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Attribution is authoritative: an unchecked completion flag does not mean
// that a member has a training assignment.
export function MyTrainingStatus({ memberId }: { memberId: string }) {
  const training = useQuery({
    queryKey: ["member-training-paths", memberId],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("member_training_paths")
        .select("id,status").eq("member_id", memberId).is("deleted_at", null);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; status: string }>;
    },
  });
  if (training.isError) return <p role="alert">Impossible de charger vos formations. <button className="underline" onClick={() => training.refetch()}>Réessayer</button></p>;
  if (!training.data) return <p>Chargement de vos formations…</p>;
  const active = training.data.filter(p => !["cancelled", "abandoned"].includes(p.status));
  const current = active.filter(p => p.status !== "completed");
  return <>
    <p><b>Statut :</b> {current.length ? "En formation" : active.length ? "Formation terminée" : "Aucune formation attribuée"}</p>
    {current.length > 0 ? <p>{current.length} parcours en cours.</p> : null}
    {active.length > 0 ? <Link to="/formations" className="inline-block font-semibold text-icc-violet">Consulter mes formations →</Link> : null}
  </>;
}
