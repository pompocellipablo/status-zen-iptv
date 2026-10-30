import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { isPanelOwner } from "@/lib/panel-access";
import { supabase } from "@/integrations/supabase/client";
import { MaxFlixAppShell } from "@/components/MaxFlixAppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user || !isPanelOwner(data.user.id)) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => <MaxFlixAppShell><Outlet /></MaxFlixAppShell>,
});