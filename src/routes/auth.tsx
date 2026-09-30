import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { unwrap } from "@/lib/local-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Zorbit Ledger" },
      { name: "description", content: "Staff sign in for the Zorbit Ledger system." },
      { property: "og:title", content: "Sign in — Zorbit Ledger" },
      { property: "og:description", content: "Staff sign in for Zorbit Ledger." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  // First-run detection: an empty database means nobody has set up the
  // first admin account yet. Once any account exists, self-serve signup is
  // gone entirely — offline, there's no email verification to fall back on,
  // so every account after the first must be created deliberately by an
  // admin from Manage Users, not typed in at this screen.
  const { data: hasUsers, isLoading: checkingSetup } = useQuery({
    queryKey: ["has-any-users"],
    queryFn: () => unwrap(window.api.auth.hasAnyUsers()),
  });

  useEffect(() => {
    window.api.auth.currentSession().then((res) => {
      if (res.ok && res.data) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await unwrap(window.api.auth.login(email, password));
      queryClient.removeQueries({ queryKey: ["current-user"] });
      queryClient.setQueryData(["current-user"], null);
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  async function createFirstAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return toast.error("Please enter your full name");
    setLoading(true);
    try {
      await unwrap(window.api.auth.bootstrapFirstAdmin({ fullName: fullName.trim(), email, password }));
      queryClient.removeQueries({ queryKey: ["current-user"] });
      queryClient.setQueryData(["current-user"], null);
      toast.success("Admin account created");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  if (checkingSetup) {
    return <div className="brand-gradient min-h-screen" />;
  }

  const isFirstRun = hasUsers === false;

  return (
    <div className="brand-gradient flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-card p-7 shadow-card">
        <div className="mb-6 text-center">
          <span className="brand-gradient mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-bold text-primary-foreground">
            Z
          </span>
          <h1 className="mt-4">
            <span className="warm-gradient bg-clip-text text-3xl font-extrabold uppercase tracking-tight text-transparent">
              Zorbit
            </span>
            <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-[0.35em] text-primary">
              Ledger
            </span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Inventory & sales management</p>
        </div>

        {isFirstRun ? (
          <form className="space-y-4" onSubmit={createFirstAdmin}>
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              First time setup — create the admin account for this laptop.
            </p>
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@shop.local"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Setting up…" : "Create admin account"}
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={signIn}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@store.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign In"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Need an account? Ask an admin to create one from Manage Users.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
