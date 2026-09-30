import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { unwrap } from "@/lib/local-api";
import { AdminOnly, PageHeader } from "@/components/AdminOnly";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/_authenticated/categories")({
  head: () => ({
    meta: [
      { title: "Manage Categories — Zorbit Ledger" },
      { name: "description", content: "Define product categories and their custom fields." },
      { property: "og:title", content: "Manage Categories — Zorbit Ledger" },
      { property: "og:description", content: "Define categories and their custom fields." },
    ],
  }),
  component: () => (
    <AdminOnly>
      <CategoriesPage />
    </AdminOnly>
  ),
});

type Draft = {
  attr_label: string;
  input_type: "text" | "dropdown" | "number";
  options: string;
  is_required: boolean;
};

const emptyDraft: Draft = { attr_label: "", input_type: "text", options: "", is_required: false };
const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field";

function CategoriesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([{ ...emptyDraft }]);
  const [addFieldFor, setAddFieldFor] = useState<string | null>(null);
  const [newField, setNewField] = useState<Draft>({ ...emptyDraft });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories-full"],
    queryFn: () => unwrap(window.api.categories.list()),
  });

  const createCategory = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Category name is required");
      const attributes = drafts
        .filter((d) => d.attr_label.trim())
        .map((d, i) => ({
          attrName: slug(d.attr_label),
          attrLabel: d.attr_label.trim(),
          inputType: d.input_type,
          options:
            d.input_type === "dropdown"
              ? d.options.split(",").map((o) => o.trim()).filter(Boolean)
              : undefined,
          isRequired: d.is_required,
          displayOrder: i + 1,
        }));
      return unwrap(window.api.categories.create({ name: name.trim(), attributes }));
    },
    onSuccess: () => {
      toast.success("Category created");
      queryClient.invalidateQueries({ queryKey: ["categories-full"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setOpen(false);
      setName("");
      setDrafts([{ ...emptyDraft }]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addField = useMutation({
    mutationFn: ({ categoryId, order }: { categoryId: string; order: number }) => {
      if (!newField.attr_label.trim()) throw new Error("Field label is required");
      return unwrap(
        window.api.categories.addAttribute({
          categoryId,
          attrName: slug(newField.attr_label),
          attrLabel: newField.attr_label.trim(),
          inputType: newField.input_type,
          options:
            newField.input_type === "dropdown"
              ? newField.options.split(",").map((o) => o.trim()).filter(Boolean)
              : undefined,
          isRequired: newField.is_required,
          displayOrder: order,
        }),
      );
    },
    onSuccess: () => {
      toast.success("Field added");
      queryClient.invalidateQueries({ queryKey: ["categories-full"] });
      setAddFieldFor(null);
      setNewField({ ...emptyDraft });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeField = useMutation({
    mutationFn: (id: string) => unwrap(window.api.categories.removeAttribute(id)),
    onSuccess: () => {
      toast.success("Field removed");
      queryClient.invalidateQueries({ queryKey: ["categories-full"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => unwrap(window.api.categories.delete(id)),
    onSuccess: () => {
      toast.success("Category deleted");
      queryClient.invalidateQueries({ queryKey: ["categories-full"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function DraftFields({ value, onChange }: { value: Draft; onChange: (d: Draft) => void }) {
    return (
      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="space-y-2">
          <Label>Field label</Label>
          <Input
            value={value.attr_label}
            placeholder="e.g. Compatible Model"
            onChange={(e) => onChange({ ...value, attr_label: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Input type</Label>
          <Select
            value={value.input_type}
            onValueChange={(v) => onChange({ ...value, input_type: v as Draft["input_type"] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="dropdown">Dropdown</SelectItem>
              <SelectItem value="number">Number</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {value.input_type === "dropdown" ? (
          <div className="space-y-2">
            <Label>Options (comma separated)</Label>
            <Input
              value={value.options}
              placeholder="iPhone X, iPhone 11, iPhone 12"
              onChange={(e) => onChange({ ...value, options: e.target.value })}
            />
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.is_required}
            onChange={(e) => onChange({ ...value, is_required: e.target.checked })}
          />
          Required field
        </label>
      </div>
    );
  }

  const seedDefaults = useMutation({
    mutationFn: () => unwrap(window.api.categories.seedDefaults()),
    onSuccess: (res: any) => {
      if (res.created > 0) toast.success(`Added ${res.created} starter categor${res.created === 1 ? "y" : "ies"}`);
      else toast.info("All starter categories already exist — nothing new added");
      queryClient.invalidateQueries({ queryKey: ["categories-full"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Manage Categories"
        description="Categories and the fields each one collects when adding a product."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => seedDefaults.mutate()} disabled={seedDefaults.isPending}>
              Load starter categories
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add Category
            </Button>
          </div>
        }
      />

      <div className="space-y-3">
        {categories.map((c: any) => {
          const fields = (c.attributes ?? []).sort(
            (a: any, b: any) => a.display_order - b.display_order,
          );
          const isOpen = expanded === c.id;
          return (
            <div key={c.id} className="surface-card p-4">
              <div className="flex items-center justify-between">
                <button
                  className="flex items-center gap-2 text-left"
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{fields.length} field(s)</span>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => deleteCategory.mutate(c.id)}
                  aria-label={`Delete ${c.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {isOpen ? (
                <div className="mt-4 space-y-2">
                  {fields.map((f: any) => (
                    <div key={f.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium">{f.attr_label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {f.input_type}
                          {f.is_required ? " · required" : ""}
                          {f.options?.length ? ` · ${f.options.length} options` : ""}
                        </span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => removeField.mutate(f.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}

                  {addFieldFor === c.id ? (
                    <div className="space-y-3">
                      <DraftFields value={newField} onChange={setNewField} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => addField.mutate({ categoryId: c.id, order: fields.length + 1 })}>
                          Save field
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setAddFieldFor(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setNewField({ ...emptyDraft });
                        setAddFieldFor(c.id);
                      }}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add attribute
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add category</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Category name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </div>
            {drafts.map((d, i) => (
              <DraftFields
                key={i}
                value={d}
                onChange={(nd) => setDrafts((s) => s.map((x, j) => (j === i ? nd : x)))}
              />
            ))}
            <Button variant="outline" size="sm" onClick={() => setDrafts((s) => [...s, { ...emptyDraft }])}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add attribute
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => createCategory.mutate()} disabled={createCategory.isPending}>
              Create category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
