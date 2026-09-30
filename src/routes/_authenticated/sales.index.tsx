import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { unwrap } from "@/lib/local-api";
import { PageHeader } from "@/components/AdminOnly";
import { useIsAdmin } from "@/lib/auth";
import { dateTime, downloadCsv, naira, shortDate } from "@/lib/format";
import { DateRangeFilter, PRESETS } from "@/components/DateRangeFilter";
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

export const Route = createFileRoute("/_authenticated/sales/")({
  head: () => ({
    meta: [
      { title: "Sales History — Zorbit Ledger" },
      { name: "description", content: "Review recorded sales, returns and voided transactions." },
      { property: "og:title", content: "Sales History — Zorbit Ledger" },
      { property: "og:description", content: "Review recorded sales, returns and receipts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SalesPage,
});

function returnableRows(sale: any) {
  const sold = new Map<string, { name: string; qty: number; price: number }>();
  for (const it of sale.sale_items ?? []) {
    const cur = sold.get(it.product_id) ?? { name: it.product_name ?? "Product", qty: 0, price: Number(it.unit_price) };
    cur.qty += it.quantity;
    sold.set(it.product_id, cur);
  }
  const returned = new Map<string, number>();
  for (const r of sale.sale_returns ?? [])
    for (const ri of r.sale_return_items ?? [])
      returned.set(ri.product_id, (returned.get(ri.product_id) ?? 0) + ri.quantity);

  return [...sold.entries()].map(([productId, v]) => ({
    productId,
    name: v.name,
    price: v.price,
    sold: v.qty,
    returned: returned.get(productId) ?? 0,
    remaining: v.qty - (returned.get(productId) ?? 0),
  }));
}

function SalesPage() {
  const { isAdmin } = useIsAdmin();
  const queryClient = useQueryClient();
  const [voidId, setVoidId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [range, setRange] = useState(() => PRESETS[4].range());
  const [returnSale, setReturnSale] = useState<any | null>(null);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState("");

  const { data: sales = [] as any[], isLoading } = useQuery<any[]>({
    queryKey: ["sales", range.from, range.to],
    queryFn: () => unwrap<any[]>(window.api.sales.list(range)),
  });

  const summary = useMemo(() => {
    const valid = sales.filter((s: any) => s.status !== "voided");
    const gross = valid.reduce((sum: number, s: any) => sum + Number(s.total_amount ?? 0), 0);
    const refunds = valid.reduce((sum: number, s: any) => sum + Number(s.refunded_total ?? 0), 0);
    return { count: valid.length, gross, refunds, net: gross - refunds };
  }, [sales]);

  const voidSale = useMutation({
    mutationFn: () => {
      if (!voidId) return Promise.resolve();
      return unwrap(window.api.sales.void(voidId, reason || "Voided by admin"));
    },
    onSuccess: () => {
      toast.success("Sale voided and stock restored");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setVoidId(null);
      setReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createReturn = useMutation({
    mutationFn: () => {
      if (!returnSale) return Promise.resolve();
      const rows = returnableRows(returnSale).filter((r) => (returnQty[r.productId] ?? 0) > 0);
      if (!rows.length) throw new Error("Select at least one item to return");
      for (const r of rows)
        if (returnQty[r.productId] > r.remaining) throw new Error(`You can only return ${r.remaining} × ${r.name}`);

      // The backend re-validates this same "not more than remaining" rule
      // independently inside createReturn's transaction — this client check
      // is just for a fast error message, not the actual guard.
      return unwrap(
        window.api.returns.create({
          saleId: returnSale.id,
          reason: returnReason || "Customer return",
          items: rows.map((r) => ({ productId: r.productId, quantity: returnQty[r.productId] })),
        }),
      );
    },
    onSuccess: () => {
      toast.success("Return recorded and stock restored");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setReturnSale(null);
      setReturnQty({});
      setReturnReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const returnRows = returnSale ? returnableRows(returnSale) : [];
  const refundTotal = returnRows.reduce((sum, r) => sum + (returnQty[r.productId] ?? 0) * r.price, 0);

  return (
    <div>
      <PageHeader
        title="Sales"
        description={isAdmin ? "All recorded sales." : "Sales you recorded."}
        action={
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                `sales-${range.from}-to-${range.to}.csv`,
                sales.map((s: any) => ({
                  date: dateTime(s.created_at),
                  customer: s.customer_name ?? "Walk-in",
                  customer_phone: s.customer_phone ?? "",
                  sold_by: s.sold_by_name ?? "",
                  payment_method: s.payment_method,
                  payment_status: s.payment_status,
                  amount_paid: s.amount_paid ?? 0,
                  balance_due: s.balance_due ?? 0,
                  total: s.total_amount,
                  refunded: s.refunded_total ?? 0,
                  status: s.status,
                })),
              )
            }
          >
            <Download className="mr-1 h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <DateRangeFilter from={range.from} to={range.to} onChange={setRange} className="mb-5" />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Sales", value: String(summary.count) },
          { label: "Gross", value: naira(summary.gross) },
          { label: "Refunds", value: naira(summary.refunds) },
          { label: "Net", value: naira(summary.net) },
        ].map((s) => (
          <div key={s.label} className="surface-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-5 rounded-lg border border-border/60 bg-muted p-4 text-sm text-muted-foreground">
        <p className="font-medium">Reconciliation note</p>
        <p>Outstanding debt is the unpaid portion of a sale (balance_due). Selling at a loss is a separate profit/loss issue and does not change receivable tracking.</p>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      <div className="space-y-3">
        {sales.map((s: any) => {
          const items = s.sale_items ?? [];
          const returns = s.sale_returns ?? [];
          const refunded = s.refunded_total ?? 0;
          const canReturn = s.status !== "voided" && returnableRows(s).some((r) => r.remaining > 0);
          return (
            <div key={s.id} className="surface-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{s.customer_name ?? "Walk-in customer"}</p>
                  <p className="text-xs text-muted-foreground">
                    {dateTime(s.created_at)} · {s.payment_method ?? "—"}
                  </p>
                  {s.customer_phone ? (
                    <p className="text-xs text-muted-foreground">Phone: {s.customer_phone}</p>
                  ) : null}
                  {s.sold_by_name ? (
                    <p className="text-xs text-muted-foreground">Sold by: {s.sold_by_name}</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="font-semibold">{naira(Number(s.total_amount))}</p>
                  <p className="text-xs text-muted-foreground">
                    Paid {naira(Number(s.amount_paid ?? 0))} · Due {naira(Number(s.balance_due ?? 0))}
                  </p>
                  <p className={`text-xs ${s.status === "voided" ? "text-destructive" : "text-muted-foreground"}`}>
                    {s.payment_status ? `${s.payment_status.replace(/_/g, " ")}` : s.status}
                    {refunded ? ` · refunded ${naira(refunded)}` : ""}
                  </p>
                </div>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {items.map((it: any, i: number) => (
                  <li key={i}>
                    {it.quantity} × {it.product_name ?? "Product"} — {naira(it.quantity * Number(it.unit_price))}
                  </li>
                ))}
              </ul>

              {returns.length ? (
                <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-xs font-semibold text-destructive">Returns</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                    {returns.map((r: any) => (
                      <li key={r.id}>
                        {shortDate(r.created_at)} ·{" "}
                        {(r.sale_return_items ?? [])
                          .map((ri: any) => `${ri.quantity} × ${ri.product_name ?? "Product"}`)
                          .join(", ")}{" "}
                        · {naira(Number(r.total_amount))}
                        {r.reason ? ` · ${r.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {s.void_reason ? <p className="mt-2 text-xs text-destructive">Reason: {s.void_reason}</p> : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {canReturn ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReturnSale(s);
                      setReturnQty({});
                      setReturnReason("");
                    }}
                  >
                    <Undo2 className="mr-1 h-4 w-4" /> Return items
                  </Button>
                ) : null}
                {isAdmin && s.status !== "voided" ? (
                  <Button size="sm" variant="outline" onClick={() => setVoidId(s.id)}>
                    Void sale
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
        {!isLoading && !sales.length ? <p className="text-sm text-muted-foreground">No sales in this period.</p> : null}
      </div>

      <Dialog open={!!returnSale} onOpenChange={(o) => !o && setReturnSale(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Return items</DialogTitle>
            <DialogDescription>Returned items go back into stock and are deducted from revenue.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {returnRows.map((r) => (
              <div key={r.productId} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {naira(r.price)} · sold {r.sold}
                    {r.returned ? ` · returned ${r.returned}` : ""}
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={r.remaining}
                  disabled={r.remaining <= 0}
                  value={returnQty[r.productId] ?? ""}
                  placeholder="0"
                  onChange={(e) =>
                    setReturnQty((q) => ({ ...q, [r.productId]: Math.max(0, Math.min(r.remaining, Number(e.target.value) || 0)) }))
                  }
                  className="w-24"
                />
              </div>
            ))}
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                maxLength={200}
                placeholder="Faulty, wrong item, customer changed mind…"
              />
            </div>
            <p className="text-sm">
              Refund total: <span className="font-semibold">{naira(refundTotal)}</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnSale(null)}>
              Cancel
            </Button>
            <Button disabled={createReturn.isPending || refundTotal <= 0} onClick={() => createReturn.mutate()}>
              Record return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!voidId} onOpenChange={(o) => !o && setVoidId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void sale</DialogTitle>
            <DialogDescription>Voiding returns the items to stock. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={voidSale.isPending} onClick={() => voidSale.mutate()}>
              Void sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
