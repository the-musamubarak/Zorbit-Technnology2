import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Search, Pencil, Trash2, History } from "lucide-react";
import { toast } from "sonner";
import { unwrap } from "@/lib/local-api";
import { useCurrentUser } from "@/lib/auth";
import { dateTime, naira } from "@/lib/format";
import { PageHeader } from "@/components/AdminOnly";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProductImage } from "@/components/ProductImage";

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({
    meta: [
      { title: "Products — Zorbit Ledger" },
      { name: "description", content: "Browse and manage phone accessories stock and pricing." },
      { property: "og:title", content: "Products — Zorbit Ledger" },
      { property: "og:description", content: "Browse and manage stock and pricing." },
    ],
  }),
  component: ProductsPage,
});

type AttrDef = {
  id: string;
  attr_name: string;
  attr_label: string;
  input_type: string;
  options: string[] | null;
  is_required: boolean;
  display_order: number;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read image file"));
    reader.readAsDataURL(file);
  });
}

function ProductsPage() {
  const { data: user } = useCurrentUser();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    category_id: "",
    name: "",
    brand: "",
    sku: "",
    cost_price: "",
    selling_price: "",
    reorder_level: "5",
    quantity: "0",
  });
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [existingImage, setExistingImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => unwrap(window.api.categories.list()),
  });

  // Attribute definitions come nested on each category already (see
  // repository.listCategories) — no separate lookup needed, just filter by
  // whichever category is currently selected in the form.
  const catAttrs: AttrDef[] = useMemo(() => {
    const cat = categories.find((c: any) => c.id === form.category_id);
    return (cat?.attributes ?? []) as AttrDef[];
  }, [categories, form.category_id]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: () => unwrap(window.api.products.list()),
  });

  const { data: movements = [], isLoading: movementsLoading } = useQuery({
    queryKey: ["product-movements", selectedProduct?.id],
    queryFn: () => unwrap(window.api.products.movements(selectedProduct.id)),
    enabled: !!selectedProduct?.id,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p: any) => {
      const low = p.quantity != null && p.quantity <= p.reorder_level;
      if (categoryFilter !== "all" && p.category_id !== categoryFilter) return false;
      if (lowOnly && !low) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.brand ?? "").toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, search, categoryFilter, lowOnly]);

  function resetForm() {
    setForm({
      category_id: "",
      name: "",
      brand: "",
      sku: "",
      cost_price: "",
      selling_price: "",
      reorder_level: "5",
      quantity: "0",
    });
    setAttrs({});
    setFile(null);
    setExistingImage(null);
    setEditingId(null);
  }

  function startEdit(p: any) {
    setEditingId(p.id);
    setForm({
      category_id: p.category_id ?? "",
      name: p.name,
      brand: p.brand ?? "",
      sku: p.sku ?? "",
      cost_price: p.cost_price != null ? String(p.cost_price) : "",
      selling_price: String(p.selling_price),
      reorder_level: String(p.reorder_level ?? 5),
      quantity: String(p.quantity ?? 0),
    });
    const existing: Record<string, string> = {};
    for (const a of p.attributes ?? []) existing[a.attr_name] = a.attr_value;
    setAttrs(existing);
    setFile(null);
    setExistingImage(p.image_url ?? null);
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Product name is required");
      if (!form.selling_price) throw new Error("Selling price is required");
      for (const a of catAttrs) {
        if (a.is_required && !attrs[a.attr_name]) throw new Error(`${a.attr_label} is required`);
      }

      // Offline: images are stored as data URLs directly in SQLite instead
      // of uploading to Supabase Storage. Fine for product photo volumes;
      // if the catalogue grows into thousands of large images later, this
      // is worth revisiting (e.g. saving files to disk + a custom protocol).
      let imageUrl: string | undefined;
      if (file) imageUrl = await fileToDataUrl(file);

      const attributes = Object.entries(attrs)
        .filter(([, v]) => v)
        .map(([attrName, attrValue]) => ({ attrName, attrValue }));

      const payload = {
        categoryId: form.category_id,
        name: form.name.trim(),
        brand: form.brand.trim() || undefined,
        sku: form.sku.trim() || undefined,
        costPrice: form.cost_price ? Number(form.cost_price) : undefined,
        sellingPrice: Number(form.selling_price),
        imageUrl,
        attributes,
        quantity: Number(form.quantity || 0),
        reorderLevel: Number(form.reorder_level || 5),
      };

      if (editingId) {
        return unwrap(window.api.products.update(editingId, payload));
      }

      return unwrap(
        window.api.products.create({
          ...payload,
          initialQuantity: Number(form.quantity || 0),
        }),
      );
    },
    onSuccess: () => {
      toast.success(editingId ? "Product updated" : "Product added");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => unwrap(window.api.products.deactivate(id)),
    onSuccess: () => {
      toast.success("Product deactivated");
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Products"
        description={isAdmin ? "Full catalogue with stock levels." : "Catalogue and live stock levels."}
        action={
          isAdmin ? (
            <Button onClick={() => { resetForm(); setOpen(true); }}>
              <Plus className="mr-1 h-4 w-4" /> Add Product
            </Button>
          ) : null
        }
      />

      <div className="surface-card mb-5 flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, brand or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c: any) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant={lowOnly ? "default" : "outline"} onClick={() => setLowOnly((v) => !v)}>
          Low stock only
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading products…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p: any) => {
            const low = p.quantity != null && p.quantity <= p.reorder_level;
            const category = categories.find((c: any) => c.id === p.category_id);
            return (
              <div key={p.id} className="surface-card overflow-hidden">
                <ProductImage path={p.image_url} alt={p.name} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-medium leading-tight">{p.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {category?.name ?? "Uncategorised"}
                        {p.brand ? ` · ${p.brand}` : ""}
                      </p>
                    </div>
                    {low ? <Badge variant="destructive">Low stock</Badge> : null}
                  </div>

                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <p className="text-lg font-semibold">{naira(Number(p.selling_price))}</p>
                      {isAdmin && p.cost_price != null ? (
                        <p className="text-xs text-muted-foreground">Cost {naira(Number(p.cost_price))}</p>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">{p.quantity ?? 0} in stock</p>
                  </div>

                  {(p.attributes ?? []).length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {p.attributes.slice(0, 4).map((a: any) => (
                        <span key={a.attr_name} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {a.attr_value}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {isAdmin ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                        <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedProduct(p);
                          setHistoryOpen(true);
                        }}
                      >
                        <History className="mr-1 h-3.5 w-3.5" /> History
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(p.id)}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> Deactivate
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          {!filtered.length ? <p className="text-sm text-muted-foreground">No products match your filters.</p> : null}
        </div>
      )}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Stock movement history</DialogTitle>
          </DialogHeader>

          {!selectedProduct ? (
            <p className="text-sm text-muted-foreground">Select a product to view its stock history.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">{selectedProduct.name}</p>
                <p className="text-xs text-muted-foreground">Current stock: {selectedProduct.quantity ?? 0}</p>
              </div>

              {movementsLoading ? (
                <p className="text-sm text-muted-foreground">Loading history…</p>
              ) : !movements.length ? (
                <p className="text-sm text-muted-foreground">No stock movements recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {movements.map((m: any) => {
                    const label =
                      m.change_type === "purchase"
                        ? "Purchase"
                        : m.change_type === "sale"
                          ? "Sale"
                          : m.change_type === "return"
                            ? "Return"
                            : m.change_type === "void"
                              ? "Voided sale"
                              : "Adjustment";
                    const prefix = Number(m.quantity_change) >= 0 ? "+" : "";
                    return (
                      <div key={m.id} className="rounded-lg border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{label}</p>
                          <p className={`text-sm font-semibold ${Number(m.quantity_change) >= 0 ? "text-green-600" : "text-destructive"}`}>
                            {prefix}{m.quantity_change}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{m.note ?? "No note"}</p>
                        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{m.created_by_name ?? "System"}</span>
                          <span>{dateTime(m.created_at)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit product" : "Add product"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={form.category_id}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, category_id: v }));
                  setAttrs({});
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Product name</Label>
              <Input value={form.name} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Brand</Label>
                <Input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Cost price</Label>
                <Input type="number" min="0" value={form.cost_price} onChange={(e) => setForm((f) => ({ ...f, cost_price: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Selling price</Label>
                <Input type="number" min="0" value={form.selling_price} onChange={(e) => setForm((f) => ({ ...f, selling_price: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Quantity in stock</Label>
                <Input type="number" min="0" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Reorder level</Label>
                <Input type="number" min="0" value={form.reorder_level} onChange={(e) => setForm((f) => ({ ...f, reorder_level: e.target.value }))} />
              </div>
            </div>

            {catAttrs.length ? (
              <div className="space-y-3 rounded-lg bg-muted/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category details</p>
                {catAttrs.map((a) => (
                  <div key={a.id} className="space-y-2">
                    <Label>
                      {a.attr_label}
                      {a.is_required ? <span className="text-destructive"> *</span> : null}
                    </Label>
                    {a.input_type === "dropdown" ? (
                      <Select value={attrs[a.attr_name] ?? ""} onValueChange={(v) => setAttrs((s) => ({ ...s, [a.attr_name]: v }))}>
                        <SelectTrigger>
                          <SelectValue placeholder={`Select ${a.attr_label.toLowerCase()}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {(a.options ?? []).map((o) => (
                            <SelectItem key={o} value={o}>
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={a.input_type === "number" ? "number" : "text"}
                        value={attrs[a.attr_name] ?? ""}
                        onChange={(e) => setAttrs((s) => ({ ...s, [a.attr_name]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Product image</Label>
              {existingImage && !file ? (
                <img src={existingImage} alt="Current" className="h-24 w-24 rounded-md object-cover" />
              ) : null}
              <Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={saving || save.isPending}
              onClick={() => {
                setSaving(true);
                save.mutate(undefined, { onSettled: () => setSaving(false) });
              }}
            >
              {save.isPending ? "Saving…" : "Save product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
