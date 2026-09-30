import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Package, ShoppingCart, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { unwrap } from "@/lib/local-api";
import { useCurrentUser } from "@/lib/auth";
import { naira, dateTime } from "@/lib/format";
import { PageHeader } from "@/components/AdminOnly";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Zorbit Ledger" },
      { name: "description", content: "Daily sales, stock alerts and store performance." },
      { property: "og:title", content: "Dashboard — Zorbit Ledger" },
      { property: "og:description", content: "Daily sales, stock alerts and store performance." },
    ],
  }),
  component: Dashboard,
});

function GradientCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof Package;
}) {
  return (
    <div className="brand-gradient rounded-xl p-5 text-primary-foreground shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-sm/5 opacity-90">{label}</p>
        <Icon className="h-5 w-5 opacity-90" />
      </div>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs opacity-85">{hint}</p> : null}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="surface-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Dashboard() {
  const { data: user } = useCurrentUser();
  const isAdmin = user?.role === "admin";

  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => unwrap(window.api.dashboard.summary()),
  });

  const best: Array<{ name: string; qty: number }> = (data?.bestSellers ?? []).map((b: any) => ({
    name: b.name,
    qty: b.qty,
  }));
  const maxQty = Math.max(1, ...best.map((b) => b.qty));
  const staff: Array<[string, number]> = (data?.salesByStaff ?? []).map((s: any) => [
    s.full_name,
    s.total,
  ]);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.fullName ?? ""}`}
        description="Here is how the store is doing today."
        action={
          <Button asChild>
            <Link to="/sales/new">New sale</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <GradientCard
          label="Today's sales"
          value={naira(data?.todaySalesTotal ?? 0)}
          hint={`${data?.todaySalesCount ?? 0} transaction(s)`}
          icon={ShoppingCart}
        />
        <GradientCard
          label="Outstanding receivables"
          value={naira(data?.outstandingDebtTotal ?? 0)}
          hint={`${data?.outstandingDebtCount ?? 0} unpaid sale(s)`}
          icon={Wallet}
        />
        <GradientCard
          label="Low stock items"
          value={String(data?.lowStock.length ?? 0)}
          hint="At or below reorder level"
          icon={AlertTriangle}
        />
        {isAdmin ? (
          <>
            <GradientCard
              label="Stock value on hand"
              value={naira(data?.stockValue ?? 0)}
              hint="Quantity × cost price"
              icon={Wallet}
            />
            <StatCard
              label="Today's estimated profit"
              value={naira(data?.todayProfit ?? 0)}
              hint="Revenue minus cost of goods sold"
            />
            <StatCard
              label="Today's estimated loss"
              value={naira(data?.todayLoss ?? 0)}
              hint="Amount sold below cost price"
            />
          </>
        ) : null}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="surface-card p-5">
          <h2 className="text-sm font-semibold">Recent sales</h2>
          <div className="mt-3 divide-y divide-border">
            {(data?.recentSales ?? []).map((s: any) => (
              <div key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium">{s.customer_name ?? "Walk-in customer"}</p>
                  <p className="text-xs text-muted-foreground">{dateTime(s.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{naira(Number(s.total_amount))}</p>
                  {s.status === "voided" ? (
                    <span className="text-xs font-medium text-destructive">Voided</span>
                  ) : null}
                </div>
              </div>
            ))}
            {!data?.recentSales?.length ? (
              <p className="py-6 text-sm text-muted-foreground">No sales recorded yet.</p>
            ) : null}
          </div>
        </div>

        <div className="surface-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="h-4 w-4 text-primary" /> Best sellers this week
          </h2>
          <div className="mt-4 space-y-3">
            {best.map((b) => (
              <div key={b.name}>
                <div className="flex justify-between text-sm">
                  <span className="truncate pr-3">{b.name}</span>
                  <span className="font-medium">{b.qty}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-muted">
                  <div
                    className="warm-gradient h-2 rounded-full"
                    style={{ width: `${(b.qty / maxQty) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {!best.length ? (
              <p className="text-sm text-muted-foreground">No sales in the last 7 days.</p>
            ) : null}
          </div>

          {isAdmin && staff.length ? (
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">Sales by staff (today)</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {staff.map(([name, total], i) => (
                  <li key={name} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold text-[11px] font-semibold text-gold-foreground">
                        {i + 1}
                      </span>
                      {name}
                    </span>
                    <span className="font-medium">{naira(total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {data?.lowStock.length ? (
        <div className="surface-card mt-6 border-destructive/30 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" /> Low stock alerts
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {data.lowStock.map((r: any) => (
              <li key={r.id} className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                <span className="truncate pr-3">{r.name ?? "Product"}</span>
                <span className="font-medium text-destructive">{r.quantity} left</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
