import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { unwrap } from "@/lib/local-api";
import { PageHeader } from "@/components/AdminOnly";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { naira, shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({
    meta: [
      { title: "Customers — Zorbit Ledger" },
      { name: "description", content: "Customer directory with contact details and purchases." },
      { property: "og:title", content: "Customers — Zorbit Ledger" },
      { property: "og:description", content: "Customer directory for the store." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomersPage,
});

const empty = { full_name: "", phone: "", email: "", address: "" };

// Debt aging buckets — the whole point of this report: 3 days owed is a
// non-issue, 90 days owed is a problem to chase today. Ordered oldest-risk
// last so the bar chart reads left-to-right as "fresh -> stale."
const AGING_BUCKETS = [
  { key: "0-30", label: "0-30 days", max: 30, color: "#10B981" },
  { key: "31-60", label: "31-60 days", max: 60, color: "#F5A623" },
  { key: "61-90", label: "61-90 days", max: 90, color: "#E8571A" },
  { key: "90+", label: "90+ days", max: Infinity, color: "#DC2626" },
] as const;

function daysSince(dateStr: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000));
}

function bucketFor(days: number): (typeof AGING_BUCKETS)[number] {
  return AGING_BUCKETS.find((b) => days <= b.max) ?? AGING_BUCKETS[AGING_BUCKETS.length - 1];
}

function CustomersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [search, setSearch] = useState("");

  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["customers-list"],
    queryFn: () => unwrap(window.api.customers.list()),
  });

  const { data: debtors = [] } = useQuery<any[]>({
    queryKey: ["debtors"],
    queryFn: () => unwrap(window.api.customers.debtors()),
  });

  const markPayment = useMutation({
    mutationFn: async ({ saleId, amountPaid }: { saleId: string; amountPaid: number }) =>
      unwrap(window.api.customers.markPayment(saleId, amountPaid)),
    onSuccess: () => {
      toast.success("Payment marked as received");
      queryClient.invalidateQueries({ queryKey: ["debtors"] });
      queryClient.invalidateQueries({ queryKey: ["customers-list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.full_name.trim()) throw new Error("Name is required");
      return unwrap(
        window.api.customers.create({
          fullName: form.full_name.trim(),
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.address.trim() || undefined,
        }),
      );
    },
    onSuccess: () => {
      toast.success("Customer added");
      queryClient.invalidateQueries({ queryKey: ["customers-list"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setOpen(false);
      setForm(empty);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const q = search.trim().toLowerCase();
  const rows = q
    ? customers.filter((c: any) =>
        `${c.full_name} ${c.phone ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q),
      )
    : customers;

  const debtSummary = useMemo(() => {
    const total = debtors.reduce((sum: number, d: any) => sum + Number(d.balance_due ?? 0), 0);
    return {
      total,
      count: debtors.length,
    };
  }, [debtors]);

  // Debt aging: bucket every outstanding balance by how long it's been
  // owed, sum the naira value per bucket. This is computed client-side
  // from `created_at`, which listDebtors() already returns — no backend
  // change needed.
  const debtAging = useMemo(() => {
    const totals = new Map<string, number>(AGING_BUCKETS.map((b) => [b.key, 0]));
    for (const d of debtors as any[]) {
      const bucket = bucketFor(daysSince(d.created_at));
      totals.set(bucket.key, (totals.get(bucket.key) ?? 0) + Number(d.balance_due ?? 0));
    }
    return AGING_BUCKETS.map((b) => ({ bucket: b.label, amount: totals.get(b.key) ?? 0, color: b.color }));
  }, [debtors]);

  // Most-overdue first — the actual point of an aging view: surface who to
  // chase today, not just who happens to be first in the raw query order.
  const debtorsSortedByAge = useMemo(
    () => [...(debtors as any[])].sort((a, b) => daysSince(b.created_at) - daysSince(a.created_at)),
    [debtors],
  );

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Keep track of the people buying from the store."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add Customer
          </Button>
        }
      />

      <Input
        className="mb-4"
        placeholder="Search by name, phone or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as const }}
        className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Debtors</p>
            <p className="text-xs text-muted-foreground">{debtSummary.count} unpaid balance(s)</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold">
              <AnimatedNumber value={debtSummary.total} format={naira} />
            </p>
            <p className="text-xs text-muted-foreground">Total outstanding</p>
          </div>
        </div>
      </motion.div>

      {debtSummary.count > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.06, ease: [0.16, 1, 0.3, 1] as const }}
          className="surface-card mb-4 p-4"
        >
          <h2 className="mb-1 font-semibold">Debt aging</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            How long money has been outstanding — the older the bar, the more worth chasing today.
          </p>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={debtAging} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => naira(v).replace(/\u00a0/g, " ")}
                />
                <Tooltip
                  formatter={(v: number) => [naira(v), "Outstanding"]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="amount" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={800} animationEasing="ease-out">
                  {debtAging.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      ) : null}

      <div className="space-y-3">
        {rows.map((c: any, i: number) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i, 8) * 0.03 }}
            className="surface-card p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{c.full_name}</p>
                <p className="text-sm text-muted-foreground">
                  {[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}
                </p>
                {c.address ? <p className="text-sm text-muted-foreground">{c.address}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">Added {shortDate(c.created_at)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{naira(Number(c.outstanding_balance ?? 0))}</p>
                <p className="text-xs text-muted-foreground">Outstanding</p>
              </div>
            </div>
          </motion.div>
        ))}
        {!rows.length ? <p className="text-sm text-muted-foreground">No customers yet.</p> : null}
      </div>

      <div className="mt-6 space-y-3">
        <h2 className="text-sm font-semibold">Unpaid balances · most overdue first</h2>
        {debtorsSortedByAge.map((d: any, i: number) => {
          const age = daysSince(d.created_at);
          const bucket = bucketFor(age);
          return (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i, 8) * 0.03 }}
              className="surface-card p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{d.customer_name ?? "Walk-in customer"}</p>
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
                      style={{ background: bucket.color }}
                    >
                      {age}d overdue
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {d.phone ? `${d.phone} · ` : ""}
                    {d.email ? `${d.email}` : "No contact info"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Sold by {d.sold_by_name ?? "Unknown"} · {shortDate(d.created_at)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Paid {naira(Number(d.amount_paid ?? 0))} / {naira(Number(d.total_amount ?? 0))}
                  </p>
                  <p className="text-xs font-semibold text-amber-600">
                    {d.payment_status === "partly_paid" ? "Partly paid" : d.payment_status === "unpaid" ? "Unpaid" : "Paid"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{naira(Number(d.balance_due ?? 0))}</p>
                  <p className="text-xs text-muted-foreground">Outstanding</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => markPayment.mutate({ saleId: d.id, amountPaid: Number(d.balance_due ?? 0) })}
                  disabled={markPayment.isPending}
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Mark fully paid
                </Button>
              </div>
            </motion.div>
          );
        })}
        {!debtors.length ? <p className="text-sm text-muted-foreground">No unpaid balances yet.</p> : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add customer</DialogTitle>
            <DialogDescription>Only the name is required.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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
              <Label>Address</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={create.isPending} onClick={() => create.mutate()}>
              Save customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
