import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { unwrap } from "@/lib/local-api";
import { AdminOnly, PageHeader } from "@/components/AdminOnly";
import { naira, shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/purchases")({
  head: () => ({
    meta: [
      { title: "Purchases — Zorbit Ledger" },
      { name: "description", content: "Record stock purchases and manage suppliers." },
      { property: "og:title", content: "Purchases — Zorbit Ledger" },
      { property: "og:description", content: "Record stock purchases and manage suppliers." },
    ],
  }),
  component: () => (
    <AdminOnly>
      <PurchasesPage />
    </AdminOnly>
  ),
});

type Line = { product_id: string; quantity: string; unit_cost: string };

function PurchasesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ product_id: "", quantity: "1", unit_cost: "" }]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [supplierForm, setSupplierForm] = useState({ name: "", phone: "", address: "" });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => unwrap(window.api.suppliers.list()),
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products-simple"],
    queryFn: () => unwrap(window.api.products.list()),
  });

  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: () => unwrap(window.api.purchases.list()),
  });

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);

  const savePurchase = useMutation({
    mutationFn: async () => {
      const valid = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
      if (!valid.length) throw new Error("Add at least one line item");
      return unwrap(
        window.api.purchases.create({
          supplierId: supplierId || undefined,
          items: valid.map((l) => ({
            productId: l.product_id,
            quantity: Number(l.quantity),
            unitCost: Number(l.unit_cost) || 0,
          })),
        }),
      );
    },
    onSuccess: () => {
      toast.success("Purchase recorded and stock updated");
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["products-simple"] });
      setOpen(false);
      setLines([{ product_id: "", quantity: "1", unit_cost: "" }]);
      setSupplierId("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveSupplier = useMutation({
    mutationFn: () => {
      if (!supplierForm.name.trim()) throw new Error("Supplier name is required");
      return unwrap(
        window.api.suppliers.create({
          name: supplierForm.name.trim(),
          phone: supplierForm.phone.trim() || undefined,
          address: supplierForm.address.trim() || undefined,
        }),
      );
    },
    onSuccess: () => {
      toast.success("Supplier saved");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setSupplierForm({ name: "", phone: "", address: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteSupplier = useMutation({
    mutationFn: (id: string) => unwrap(window.api.suppliers.delete(id)),
    onSuccess: () => {
      toast.success("Supplier removed");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Stock coming in from suppliers. Recording a purchase updates inventory automatically."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Record Purchase
          </Button>
        }
      />

      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">Purchase history</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="mt-4 space-y-3">
          {purchases.map((p: any) => {
            const isOpen = expanded === p.id;
            return (
              <div key={p.id} className="surface-card p-4">
                <button className="flex w-full items-center justify-between text-left" onClick={() => setExpanded(isOpen ? null : p.id)}>
                  <div className="flex items-center gap-2">
                    <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    <div>
                      <p className="font-medium">{p.supplier_name ?? "Unknown supplier"}</p>
                      <p className="text-xs text-muted-foreground">
                        {shortDate(p.purchase_date)} · {p.items.length} item(s)
                      </p>
                    </div>
                  </div>
                  <span className="font-medium">{naira(Number(p.total_cost))}</span>
                </button>
                {isOpen ? (
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {p.items.map((it: any) => (
                      <li key={it.id} className="flex justify-between rounded-md bg-muted px-3 py-2">
                        <span>{it.product_name ?? "Product"} × {it.quantity}</span>
                        <span>{naira(it.quantity * Number(it.unit_cost))}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
          {!purchases.length ? <p className="text-sm text-muted-foreground">No purchases recorded yet.</p> : null}
        </TabsContent>

        <TabsContent value="suppliers" className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="surface-card p-5">
            <h2 className="text-sm font-semibold">Add supplier</h2>
            <div className="mt-3 space-y-3">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={supplierForm.name} onChange={(e) => setSupplierForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={supplierForm.phone} onChange={(e) => setSupplierForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input value={supplierForm.address} onChange={(e) => setSupplierForm((f) => ({ ...f, address: e.target.value }))} />
              </div>
              <Button onClick={() => saveSupplier.mutate()} disabled={saveSupplier.isPending}>
                Save supplier
              </Button>
            </div>
          </div>

          <div className="surface-card p-5">
            <h2 className="text-sm font-semibold">Supplier list</h2>
            <ul className="mt-3 divide-y divide-border">
              {suppliers.map((s: any) => (
                <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[s.phone, s.address].filter(Boolean).join(" · ") || "No contact details"}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => deleteSupplier.mutate(s.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
              {!suppliers.length ? <p className="py-4 text-sm text-muted-foreground">No suppliers yet.</p> : null}
            </ul>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record purchase</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 items-end gap-2">
                  <div className="col-span-6 space-y-2">
                    <Label className="text-xs">Product</Label>
                    <Select
                      value={l.product_id}
                      onValueChange={(v) => {
                        const p = products.find((x: any) => x.id === v);
                        setLines((s) =>
                          s.map((x, j) => (j === i ? { ...x, product_id: v, unit_cost: x.unit_cost || String(p?.cost_price ?? "") } : x)),
                        );
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select product" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label className="text-xs">Qty</Label>
                    <Input
                      type="number"
                      min="1"
                      value={l.quantity}
                      onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                    />
                  </div>
                  <div className="col-span-3 space-y-2">
                    <Label className="text-xs">Unit cost</Label>
                    <Input
                      type="number"
                      min="0"
                      value={l.unit_cost}
                      onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, unit_cost: e.target.value } : x)))}
                    />
                  </div>
                  <div className="col-span-1">
                    <Button variant="ghost" size="icon" onClick={() => setLines((s) => s.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setLines((s) => [...s, { product_id: "", quantity: "1", unit_cost: "" }])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add line item
              </Button>
            </div>

            <div className="flex justify-between rounded-lg bg-muted px-4 py-3 font-medium">
              <span>Total cost</span>
              <span>{naira(total)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => savePurchase.mutate()} disabled={savePurchase.isPending}>
              Save purchase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
