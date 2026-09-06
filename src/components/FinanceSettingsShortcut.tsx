import { Link } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsAccess } from "@/hooks/useSettingsAccess";

export function FinanceSettingsShortcut() {
  const canManageSettings = useSettingsAccess();
  if (!canManageSettings) return null;
  return <Button asChild size="sm" variant="outline">
    <Link to="/parametres-finances"><Settings2 className="size-4" />Paramètres Finances</Link>
  </Button>;
}
