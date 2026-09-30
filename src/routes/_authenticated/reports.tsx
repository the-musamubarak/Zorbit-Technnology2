import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { unwrap } from "@/lib/local-api";
import { AdminOnly, PageHeader } from "@/components/AdminOnly";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { downloadCsv, naira, shortDate } from "@/lib/format";
import { DateRangeFilter, PRESETS } from "@/components/DateRangeFilter";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Zorbit Ledger" },
      { name: "description", content: "Sales, profit, returns and stock reports for any date range." },
      { property: "og:title", content: "Reports — Zorbit Ledger" },
      { property: "og:description", content: "Sales, returns and stock reporting." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AdminOnly>
      <ReportsPage />
    </AdminOnly>
  ),
});

function bucketLabel(key: string, byMonth: boolean) {
  return byMonth
    ? new Date(`${key}-01T00:00:00`).toLocaleDateString("en-NG", { month: "short", year: "2-digit" })
    : new Date(`${key}T00:00:00`).toLocaleDateString("en-NG", { day: "2-digit", month: "short" });
}

const CATEGORY_COLORS = ["#E8571A", "#F5A623", "#3B82F6", "#10B981", "#8B5CF6", "#EC4899", "#64748B"];

const sectionMotion = (index: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] as const },
});

function ReportsPage() {
  const [range, setRange] = useState(() => PRESETS[3].range());
  const { from, to } = range;

  const byMonth = useMemo(() => {
    const spanDays = Math.max(
      1,
      Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 864e5),
    );
    return spanDays > 62;
  }, [from, to]);

  const { data, isLoading } = useQuery<ReportsData>({
    queryKey: ["reports", from, to, byMonth],
    queryFn: () => unwrap(window.api.reports.data(range, byMonth ? "month" : "day")),
  });

  const trend = (data?.trend ?? []).map((t: any) => ({
    label: bucketLabel(t.bucket, byMonth),
    revenue: t.netRevenue,
    profit: t.netProfit,
    margin: t.netRevenue > 0 ? Math.round((t.netProfit / t.netRevenue) * 100) : 0,
  }));

  const rows = (data?.rows ?? []).map((r: any) => ({
    date: shortDate(r.date),
    total: r.total,
    refunded: r.refunded,
  }));

  const categoryBreakdown = (data?.categoryBreakdown ?? []) as Array<{ category: string; revenue: number }>;
  const categoryTotal = categoryBreakdown.reduce((sum, c) => sum + c.revenue, 0);

  const stats = [
    { label: "Net revenue", value: data?.revenue ?? 0, format: naira },
    { label: "Gross profit", value: data?.profit ?? 0, format: naira },
    { label: "Sales", value: data?.salesCount ?? 0, format: (n: number) => String(Math.round(n)) },
    {
      label: "Returns",
      value: data?.returnCount ?? 0,
      format: (n: number) => `${Math.round(n)} · ${naira(data?.refunds ?? 0)}`,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Performance for the selected period."
        action={
          <Button
            variant="outline"
            disabled={!rows.length}
            onClick={() => downloadCsv(`sales-${from}-to-${to}.csv`, rows)}
          >
            <Download className="mr-1 h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <DateRangeFilter from={from} to={to} onChange={setRange} className="mb-5" />

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} {...sectionMotion(i)} className="surface-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-xl font-semibold">
              <AnimatedNumber value={s.value} format={s.format} />
            </p>
          </motion.div>
        ))}
      </div>

      <motion.div {...sectionMotion(1)} className="surface-card mt-5 p-4">
        <h2 className="mb-1 font-semibold">Trend {byMonth ? "(by month)" : "(by day)"}</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Net revenue and profit after returns. Pick a 3 or 6 month range to see monthly trends.
        </p>
        <div className="h-64 w-full">
          {trend.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v: number) => naira(v).replace(/\u00a0/g, " ")}
                />
                <Tooltip
                  formatter={(v: number, name) => [naira(v), name === "revenue" ? "Revenue" : "Profit"]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--primary)"
                  fill="url(#rev)"
                  strokeWidth={2}
                  isAnimationActive
                  animationDuration={900}
                  animationEasing="ease-out"
                />
                <Area
                  type="monotone"
                  dataKey="profit"
                  stroke="var(--gold)"
                  fill="none"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  isAnimationActive
                  animationDuration={900}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : trend.length === 1 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <p className="text-2xl font-semibold">{naira(trend[0].revenue)}</p>
              <p className="text-xs text-muted-foreground">
                Today's revenue — a trend line needs at least 2 days of activity to draw. Check back tomorrow.
              </p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">No activity in this period.</p>
            </div>
          )}
        </div>
      </motion.div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <motion.div {...sectionMotion(2)} className="surface-card p-4">
          <h2 className="mb-1 font-semibold">Profit margin</h2>
          <p className="mb-4 text-xs text-muted-foreground">Net profit as a share of net revenue, per period.</p>
          <div className="h-48 w-full">
            {trend.length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    domain={[0, "dataMax"]}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    formatter={(v: number) => [`${v}%`, "Margin"]}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="margin"
                    stroke="var(--gold)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                    animationDuration={900}
                    animationEasing="ease-out"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : trend.length === 1 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                <p className="text-2xl font-semibold">{trend[0].margin}%</p>
                <p className="text-xs text-muted-foreground">Today's margin — needs 2+ days to plot a trend.</p>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">No activity in this period.</p>
              </div>
            )}
          </div>
        </motion.div>

        <motion.div {...sectionMotion(3)} className="surface-card p-4">
          <h2 className="mb-1 font-semibold">Sales by category</h2>
          <p className="mb-4 text-xs text-muted-foreground">Revenue share by product category, net of returns.</p>
          {categoryBreakdown.length ? (
            <div className="flex items-center gap-4">
              <div className="h-40 w-40 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryBreakdown}
                      dataKey="revenue"
                      nameKey="category"
                      innerRadius={42}
                      outerRadius={68}
                      paddingAngle={2}
                      isAnimationActive
                      animationDuration={800}
                      animationEasing="ease-out"
                    >
                      {categoryBreakdown.map((_, i) => (
                        <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, _name, entry: any) => [naira(v), entry.payload.category]}
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {categoryBreakdown.slice(0, 6).map((c, i) => (
                  <div key={c.category} className="flex items-center justify-between text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                      />
                      <span className="truncate">{c.category}</span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {categoryTotal > 0 ? Math.round((c.revenue / categoryTotal) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No categorized sales in this period.</p>
          )}
        </motion.div>

        <motion.div {...sectionMotion(4)} className="surface-card p-4">
          <h2 className="mb-3 font-semibold">Best sellers</h2>
          <div className="space-y-2">
            {(data?.top ?? []).map((t: any, i: number) => (
              <motion.div
                key={t.name}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                className="flex items-center justify-between text-sm"
              >
                <span className="truncate pr-3">{t.name}</span>
                <span className="text-muted-foreground">
                  {t.qty} sold · {naira(t.revenue)}
                </span>
              </motion.div>
            ))}
            {!data?.top?.length ? <p className="text-sm text-muted-foreground">No sales in this period.</p> : null}
          </div>
        </motion.div>

        <motion.div {...sectionMotion(5)} className="surface-card p-4">
          <h2 className="mb-3 font-semibold">Most returned</h2>
          <div className="space-y-2">
            {(data?.mostReturned ?? []).map((t: any, i: number) => (
              <motion.div
                key={t.name}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                className="flex items-center justify-between text-sm"
              >
                <span className="truncate pr-3">{t.name}</span>
                <span className="text-destructive">{t.total_returned} returned</span>
              </motion.div>
            ))}
            {!data?.mostReturned?.length ? (
              <p className="text-sm text-muted-foreground">No returns in this period.</p>
            ) : null}
          </div>
        </motion.div>

        <motion.div {...sectionMotion(6)} className="surface-card p-4">
          <h2 className="mb-3 font-semibold">Low stock</h2>
          <div className="space-y-2">
            {(data?.lowStock ?? []).map((s: any, i: number) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                className="flex items-center justify-between text-sm"
              >
                <span className="truncate pr-3">{s.name ?? "Product"}</span>
                <span className="text-destructive">{s.quantity} left</span>
              </motion.div>
            ))}
            {!data?.lowStock?.length ? (
              <p className="text-sm text-muted-foreground">Everything is above reorder level.</p>
            ) : null}
          </div>
        </motion.div>

        <motion.div {...sectionMotion(7)} className="surface-card p-4">
          <h2 className="mb-3 font-semibold">Period summary</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-muted-foreground">Gross revenue</span>
              <span>{naira(data?.grossRevenue ?? 0)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Refunds</span>
              <span className="text-destructive">-{naira(data?.refunds ?? 0)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Voided sales</span>
              <span>{data?.voided ?? 0}</span>
            </li>
            <li className="flex justify-between border-t border-border pt-2 font-medium">
              <span>Stock value on hand</span>
              <span>{naira(data?.stockValue ?? 0)}</span>
            </li>
          </ul>
        </motion.div>
      </div>
    </div>
  );
}
