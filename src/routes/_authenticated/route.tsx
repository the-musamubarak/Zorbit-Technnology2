import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const res = await window.api.auth.currentSession();
    if (!res.ok || !res.data) throw redirect({ to: "/auth" });
    return { user: res.data };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
