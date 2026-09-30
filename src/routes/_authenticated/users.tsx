import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { unwrap } from "@/lib/local-api";
import { AdminOnly, PageHeader } from "@/components/AdminOnly";
import { shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({
    meta: [
      { title: "Manage Users — Zorbit Ledger" },
      { name: "description", content: "Grant admin access and deactivate staff accounts." },
      { property: "og:title", content: "Manage Users — Zorbit Ledger" },
      { property: "og:description", content: "Staff and admin account management." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AdminOnly>
      <UsersPage />
    </AdminOnly>
  ),
});

const empty = { fullName: "", email: "", password: "" };

function UsersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["staff-users"],
    queryFn: () => unwrap(window.api.users.list()),
  });

  // Offline change: since there's no email verification, new staff accounts
  // are created directly by an admin here (name + email + a starting
  // password they hand to the staff member), rather than the old self-serve
  // signup flow. Prevents anyone from registering their own account and
  // walking in unvetted.
  const createUser = useMutation({
    mutationFn: async () => {
      if (!form.fullName.trim()) throw new Error("Full name is required");
      if (!form.email.trim()) throw new Error("Email is required");
      if (form.password.length < 6) throw new Error("Password must be at least 6 characters");
      return unwrap(
        window.api.users.create({
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          password: form.password,
          role: "staff",
        }),
      );
    },
    onSuccess: () => {
      toast.success("Staff account created");
      queryClient.invalidateQueries({ queryKey: ["staff-users"] });
      setOpen(false);
      setForm(empty);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "admin" | "staff" }) =>
      unwrap(window.api.users.setRole(userId, role)),
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["staff-users"] });
      queryClient.invalidateQueries({ queryKey: ["current-user"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setActive = useMutation({
    mutationFn: ({ userId, active }: { userId: string; active: boolean }) =>
      unwrap(window.api.users.setActive(userId, active)),
    onSuccess: () => {
      toast.success("Account updated");
      queryClient.invalidateQueries({ queryKey: ["staff-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Manage Users"
        description="Control who can administer the store."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add Staff Account
          </Button>
        }
      />

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      <div className="space-y-3">
        {users.map((u: any) => (
          <div key={u.id} className="surface-card flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{u.full_name || u.email}</p>
              <p className="truncate text-sm text-muted-foreground">{u.email}</p>
              <p className="text-xs text-muted-foreground">Joined {shortDate(u.created_at)}</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={u.role === "admin"}
                onCheckedChange={(v) => setRole.mutate({ userId: u.id, role: v ? "admin" : "staff" })}
              />
              Admin
            </label>
            <Button
              size="sm"
              variant={u.is_active ? "outline" : "default"}
              onClick={() => setActive.mutate({ userId: u.id, active: !u.is_active })}
            >
              {u.is_active ? "Deactivate" : "Activate"}
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add staff account</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Starting password</Label>
              <Input
                type="text"
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Share this with the staff member directly"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={createUser.isPending} onClick={() => createUser.mutate()}>
              Create account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
