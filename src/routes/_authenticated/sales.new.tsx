import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { unwrap } from "@/lib/local-api";
import { PageHeader } from "@/components/AdminOnly";
import { naira } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/sales/new")({
  head: () => ({
    meta: [
      { title: "New Sale — Zorbit Ledger" },
      { name: "description", content: "Record a new counter sale and update stock instantly." },
      { property: "og:title", content: "New Sale — Zorbit Ledger" },
      { property: "og:description", content: "Record a new counter sale." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewSalePage,
});

type Line = { productId: string; name: string; price: number; qty: number; stock: number };

function NewSalePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [customerId, setCustomerId] = useState<string>("walk-in");
  const [payment, setPayment] = useState("cash");
  const [amountPaid, setAmountPaid] = useState<number>(0);

  // products.list() already returns quantity/reorder_level joined in
  // (see repository.listProducts) — no separate inventory query needed.
  const { data: products = [] as any[] } = useQuery<any[]>({
    queryKey: ["products"],
    queryFn: () => unwrap<any[]>(window.api.products.list()),
  });

  const { data: customers = [] as any[] } = useQuery<any[]>({
    queryKey: ["customers"],
    queryFn: () => unwrap<any[]>(window.api.customers.list()),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const active = products.filter((p: any) => p.is_active);
    if (!q) return active.slice(0, 12);
    return active
      .filter((p: any) => `${p.name} ${p.brand ?? ""}`.toLowerCase().includes(q))
      .slice(0, 20);
  }, [products, search]);

  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const due = Math.max(0, total - amountPaid);

  function addLine(p: any) {
    const qtyAvail = p.quantity ?? 0;
    setLines((cur) => {
      const found = cur.find((l) => l.productId === p.id);
      if (found) {
        if (found.qty + 1 > qtyAvail) {
          toast.error("Not enough stock");
          return cur;
        }
        return cur.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
      }
      if (qtyAvail < 1) {
        toast.error("Out of stock");
        return cur;
      }
      return [...cur, { productId: p.id, name: p.name, price: Number(p.selling_price), qty: 1, stock: qtyAvail }];
    });
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error("Add at least one product");
      // sold_by is no longer passed from here — the main process attaches
      // it from the server-side session (see electron/ipc/handlers.ts),
      // so the renderer can't claim to be a different staff member.
      return unwrap(
        window.api.sales.create({
          customerId: customerId === "walk-in" ? undefined : customerId,
          paymentMethod: payment,
          amountPaid,
          items: lines.map((l) => ({ productId: l.productId, quantity: l.qty, unitPrice: l.price })),
        }),
      );
    },
    onSuccess: () => {
      toast.success("Sale recorded");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setLines([]);
      navigate({ to: "/sales" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader title="New Sale" description="Search products, build the cart, and check out." />

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="surface-card p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {filtered.map((p: any) => (
              <button
                key={p.id}
                onClick={() => addLine(p)}
                className="rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
              >
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {naira(Number(p.selling_price))} · {p.quantity ?? 0} in stock
                </p>
              </button>
            ))}
            {!filtered.length ? <p className="text-sm text-muted-foreground">No products found.</p> : null}
          </div>
        </div>

        <div className="surface-card space-y-4 p-4">
          <h2 className="font-semibold">Cart</h2>
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.productId} className="rounded-lg bg-muted p-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="text-xs text-muted-foreground">{naira(l.price * l.qty)}</p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setLines((c) => c.map((x) => (x.productId === l.productId ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))
                    }
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-6 text-center text-sm">{l.qty}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setLines((c) => c.map((x) => (x.productId === l.productId ? { ...x, qty: Math.min(x.stock, x.qty + 1) } : x)))
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setLines((c) => c.filter((x) => x.productId !== l.productId))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Label className="text-xs">Unit price</Label>
                  <Input
                    type="number"
                    min="0"
                    value={l.price}
                    onChange={(e) =>
                      setLines((c) => c.map((x) => (x.productId === l.productId ? { ...x, price: Number(e.target.value || 0) } : x)))
                    }
                    className="h-8 w-24"
                  />
                </div>
              </div>
            ))}
            {!lines.length ? <p className="text-sm text-muted-foreground">Cart is empty.</p> : null}
          </div>

          <div className="space-y-2">
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="walk-in">Walk-in customer</SelectItem>
                {customers.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Payment method</Label>
            <Select value={payment} onValueChange={setPayment}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="transfer">Bank transfer</SelectItem>
                <SelectItem value="pos">POS / Card</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Amount paid now</Label>
            <Input
              type="number"
              min="0"
              max={total}
              value={amountPaid}
              onChange={(e) => setAmountPaid(Math.max(0, Math.min(total, Number(e.target.value || 0))))}
            />
            <p className="text-xs text-muted-foreground">Remaining due: {naira(due)}</p>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-xl font-semibold">{naira(total)}</span>
          </div>
          <Button className="w-full" disabled={submit.isPending || !lines.length} onClick={() => submit.mutate()}>
            Complete sale
          </Button>
        </div>
      </div>
    </div>
  );
}
