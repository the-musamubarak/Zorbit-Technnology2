import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { getDb } from "./connection";

export type Role = "admin" | "staff";

export class AuthError extends Error {}
export class ForbiddenError extends Error {}
export class ValidationError extends Error {}

function requireAdmin(role: Role) {
  if (role !== "admin") throw new ForbiddenError("Admin access required for this action");
}

// ---------- AUTH ----------
// Replaces Supabase Auth entirely. Passwords are hashed with bcrypt (10 rounds)
// before ever touching the disk — never store plain text, even offline.

export function createUser(input: {
  fullName: string;
  email: string;
  password: string;
  role?: Role; // only ever pass 'admin' from a flow the caller has already gated
}) {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(input.email);
  if (existing) throw new ValidationError("An account with this email already exists");

  const id = randomUUID();
  const passwordHash = bcrypt.hashSync(input.password, 10);
  db.prepare(
    `INSERT INTO users (id, full_name, email, password_hash, role, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(id, input.fullName, input.email, passwordHash, input.role ?? "staff");

  return { id, fullName: input.fullName, email: input.email, role: input.role ?? "staff" };
}

export function login(email: string, password: string) {
  const db = getDb();
  const user = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as
    | { id: string; full_name: string; email: string; password_hash: string; role: Role; is_active: number }
    | undefined;

  if (!user) throw new AuthError("Invalid email or password");
  if (!user.is_active) throw new AuthError("This account has been deactivated. Contact an admin.");

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) throw new AuthError("Invalid email or password");

  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
  };
}

// First-run bootstrap: if there are zero users, the very first account created
// through the setup screen becomes admin automatically. Every account after
// that defaults to 'staff' — matching your Supabase trigger behavior, where
// only an existing admin can promote someone.
export function hasAnyUsers(): boolean {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
  return row.c > 0;
}

export function listUsers() {
  const db = getDb();
  return db
    .prepare("SELECT id, full_name, email, role, is_active, created_at FROM users ORDER BY created_at")
    .all();
}

export function setUserRole(actingRole: Role, userId: string, role: Role) {
  requireAdmin(actingRole);
  getDb().prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
}

export function setUserActive(actingRole: Role, userId: string, isActive: boolean) {
  requireAdmin(actingRole);
  getDb().prepare("UPDATE users SET is_active = ? WHERE id = ?").run(isActive ? 1 : 0, userId);
}

// ---------- CATEGORIES ----------

export function listCategories() {
  const db = getDb();
  const categories = db.prepare("SELECT * FROM categories ORDER BY name").all() as any[];
  const attrs = db.prepare("SELECT * FROM category_attributes ORDER BY display_order").all() as any[];
  return categories.map((c) => ({
    ...c,
    attributes: attrs
      .filter((a) => a.category_id === c.id)
      .map((a) => ({ ...a, options: a.options ? JSON.parse(a.options) : null, is_required: !!a.is_required })),
  }));
}

export function createCategory(
  actingRole: Role,
  input: {
    name: string;
    attributes: Array<{
      attrName: string;
      attrLabel: string;
      inputType: "text" | "dropdown" | "number";
      options?: string[];
      isRequired?: boolean;
      displayOrder?: number;
    }>;
  },
) {
  requireAdmin(actingRole);
  const db = getDb();
  const id = randomUUID();

  const insertCategory = db.prepare("INSERT INTO categories (id, name) VALUES (?, ?)");
  const insertAttr = db.prepare(
    `INSERT INTO category_attributes
      (id, category_id, attr_name, attr_label, input_type, options, is_required, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    insertCategory.run(id, input.name);
    input.attributes.forEach((a, i) => {
      insertAttr.run(
        randomUUID(),
        id,
        a.attrName,
        a.attrLabel,
        a.inputType,
        a.options ? JSON.stringify(a.options) : null,
        a.isRequired ? 1 : 0,
        a.displayOrder ?? i,
      );
    });
  });
  tx();

  return { id, name: input.name };
}

export function deleteCategory(actingRole: Role, categoryId: string) {
  requireAdmin(actingRole);
  const db = getDb();
  const inUse = db.prepare("SELECT COUNT(*) as c FROM products WHERE category_id = ?").get(categoryId) as {
    c: number;
  };
  if (inUse.c > 0) {
    throw new ValidationError(
      `Cannot delete this category — ${inUse.c} product(s) still belong to it. Reassign or remove them first.`,
    );
  }
  db.prepare("DELETE FROM categories WHERE id = ?").run(categoryId);
}

// ---------- PRODUCTS ----------

export function listProducts(role: Role) {
  const db = getDb();
  const products = db
    .prepare(
      `SELECT p.*, i.quantity, i.reorder_level
       FROM products p
       LEFT JOIN inventory i ON i.product_id = p.id
       WHERE p.is_active = 1
       ORDER BY p.name`,
    )
    .all() as any[];

  const attrs = db.prepare("SELECT * FROM product_attributes").all() as any[];

  return products.map((p) => ({
    ...p,
    // cost_price and profit-relevant data are stripped for non-admins, same
    // as the app previously hiding them client-side — except here it's
    // enforced at the data layer, not just a hidden form field.
    cost_price: role === "admin" ? p.cost_price : undefined,
    attributes: attrs.filter((a) => a.product_id === p.id),
  }));
}

export function listStockMovements(productId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT sm.id, sm.product_id, sm.change_type, sm.quantity_change, sm.note, sm.created_at,
              u.full_name as created_by_name, p.name as product_name
       FROM stock_movements sm
       LEFT JOIN users u ON u.id = sm.created_by
       JOIN products p ON p.id = sm.product_id
       WHERE sm.product_id = ?
       ORDER BY sm.created_at DESC, sm.id DESC`,
    )
    .all(productId) as Array<{
      id: string;
      product_id: string;
      change_type: string;
      quantity_change: number;
      note: string | null;
      created_at: string;
      created_by_name: string | null;
      product_name: string;
    }>;
}

export function createProduct(
  actingRole: Role,
  input: {
    categoryId: string;
    name: string;
    brand?: string;
    sku?: string;
    costPrice?: number;
    sellingPrice: number;
    imageUrl?: string;
    attributes: Array<{ attrName: string; attrValue: string }>;
    initialQuantity?: number;
    reorderLevel?: number;
  },
) {
  requireAdmin(actingRole);
  const db = getDb();
  const id = randomUUID();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO products (id, category_id, name, brand, sku, cost_price, selling_price, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.categoryId, input.name, input.brand ?? null, input.sku ?? null, input.costPrice ?? null, input.sellingPrice, input.imageUrl ?? null);

    const insertAttr = db.prepare(
      "INSERT INTO product_attributes (id, product_id, attr_name, attr_value) VALUES (?, ?, ?, ?)",
    );
    for (const a of input.attributes) {
      insertAttr.run(randomUUID(), id, a.attrName, a.attrValue);
    }

    // mirrors the Postgres `products_inventory_row` trigger: every new
    // product automatically gets an inventory row.
    db.prepare("INSERT INTO inventory (product_id, quantity, reorder_level) VALUES (?, ?, ?)").run(
      id,
      input.initialQuantity ?? 0,
      input.reorderLevel ?? 5,
    );

    if ((input.initialQuantity ?? 0) !== 0) {
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, change_type, quantity_change, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), id, "adjustment", input.initialQuantity ?? 0, "Initial stock", null);
    }
  });
  tx();

  return { id };
}

// ---------- PURCHASES (admin only — stock coming IN) ----------

export function createPurchase(
  actingRole: Role,
  actingUserId: string,
  input: {
    supplierId?: string;
    items: Array<{ productId: string; quantity: number; unitCost: number }>;
  },
) {
  requireAdmin(actingRole);
  if (input.items.length === 0) throw new ValidationError("A purchase needs at least one item");

  const db = getDb();
  const purchaseId = randomUUID();
  const totalCost = input.items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO purchases (id, supplier_id, total_cost, created_by) VALUES (?, ?, ?, ?)`,
    ).run(purchaseId, input.supplierId ?? null, totalCost, actingUserId);

    const insertItem = db.prepare(
      "INSERT INTO purchase_items (id, purchase_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?, ?)",
    );
    const bumpInventory = db.prepare(
      `INSERT INTO inventory (product_id, quantity) VALUES (?, ?)
       ON CONFLICT(product_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = datetime('now')`,
    );
    const logMovement = db.prepare(
      `INSERT INTO stock_movements (id, product_id, change_type, quantity_change, note, created_by)
       VALUES (?, ?, 'purchase', ?, ?, ?)`,
    );

    for (const item of input.items) {
      insertItem.run(randomUUID(), purchaseId, item.productId, item.quantity, item.unitCost);
      bumpInventory.run(item.productId, item.quantity);
      logMovement.run(randomUUID(), item.productId, item.quantity, `Purchase ${purchaseId}`, actingUserId);
    }
  });
  tx();

  return { id: purchaseId, totalCost };
}

// ---------- SALES (stock going OUT) ----------

export function createSale(
  actingUserId: string,
  input: {
    customerId?: string;
    paymentMethod: "cash" | "transfer" | "pos";
    amountPaid?: number;
    items: Array<{ productId: string; quantity: number; unitPrice: number }>;
  },
) {
  if (input.items.length === 0) throw new ValidationError("A sale needs at least one item");

  const db = getDb();
  const saleId = randomUUID();
  const totalAmount = input.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  const getStock = db.prepare("SELECT quantity FROM inventory WHERE product_id = ?");
  const decrementStock = db.prepare(
    "UPDATE inventory SET quantity = quantity - ?, updated_at = datetime('now') WHERE product_id = ?",
  );
  const insertItem = db.prepare(
    "INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)",
  );
  const logMovement = db.prepare(
    `INSERT INTO stock_movements (id, product_id, change_type, quantity_change, note, created_by)
     VALUES (?, ?, 'sale', ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    // stock check happens inside the same transaction as the deduction —
    // mirrors the `for update` row lock in the Postgres trigger, so two
    // sales can't both read "1 left" and both succeed.
    for (const item of input.items) {
      const row = getStock.get(item.productId) as { quantity: number } | undefined;
      const current = row?.quantity ?? 0;
      if (current < item.quantity) {
        throw new ValidationError(`Insufficient stock for product ${item.productId}`);
      }
    }

    const paidAmount = Number(input.amountPaid ?? 0);
    const balance = Math.max(0, totalAmount - paidAmount);
    const paymentStatus = balance <= 0 ? "paid" : paidAmount > 0 ? "partly_paid" : "unpaid";

    db.prepare(
      `INSERT INTO sales (id, customer_id, sold_by, total_amount, amount_paid, balance_due, payment_method, payment_status, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
    ).run(saleId, input.customerId ?? null, actingUserId, totalAmount, paidAmount, balance, input.paymentMethod, paymentStatus);

    for (const item of input.items) {
      insertItem.run(randomUUID(), saleId, item.productId, item.quantity, item.unitPrice);
      decrementStock.run(item.quantity, item.productId);
      logMovement.run(randomUUID(), item.productId, -item.quantity, `Sale ${saleId}`, actingUserId);
    }
  });
  tx();

  return { id: saleId, totalAmount };
}

export type DateRange = { from: string; to: string }; // ISO date strings, e.g. '2026-07-01'

export function listSales(role: Role, userId: string, range?: DateRange) {
  const db = getDb();
  const dateClause = range ? "AND date(s.created_at) BETWEEN ? AND ?" : "";
  const roleClause = role === "admin" ? "" : "AND s.sold_by = ?";

  const params: string[] = [];
  if (range) params.push(range.from, range.to);
  if (role !== "admin") params.push(userId);

  const sales = db
    .prepare(
      `SELECT s.*, c.full_name as customer_name, c.phone as customer_phone,
              u.full_name as sold_by_name,
              COALESCE(r.refunded_total, 0) as refunded_total,
              (s.total_amount - COALESCE(r.refunded_total, 0)) as net_amount
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.sold_by
       LEFT JOIN (
         SELECT sale_id, SUM(total_amount) as refunded_total
         FROM sale_returns GROUP BY sale_id
       ) r ON r.sale_id = s.id
       WHERE 1=1 ${dateClause} ${roleClause}
       ORDER BY s.created_at DESC
       LIMIT 500`,
    )
    .all(...params) as any[];

  if (sales.length === 0) return [];

  const saleIds = sales.map((s) => s.id);
  const placeholders = saleIds.map(() => "?").join(",");

  // Nest items + returns per sale in two batch queries instead of N+1 calls
  // per sale — matches the shape the UI previously got from Supabase's
  // nested select, so sales.index.tsx's return-eligibility logic needed
  // almost no changes.
  const items = db
    .prepare(
      `SELECT si.sale_id, si.quantity, si.unit_price, si.product_id, p.name as product_name
       FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id IN (${placeholders})`,
    )
    .all(...saleIds) as any[];

  const returns = db
    .prepare(
      `SELECT id, sale_id, reason, total_amount, created_at
       FROM sale_returns WHERE sale_id IN (${placeholders})`,
    )
    .all(...saleIds) as any[];

  const returnIds = returns.map((r) => r.id);
  const returnItems = returnIds.length
    ? (db
        .prepare(
          `SELECT sri.return_id, sri.quantity, sri.unit_price, sri.product_id, p.name as product_name
           FROM sale_return_items sri JOIN products p ON p.id = sri.product_id
           WHERE sri.return_id IN (${returnIds.map(() => "?").join(",")})`,
        )
        .all(...returnIds) as any[])
    : [];

  return sales.map((s) => ({
    ...s,
    sale_items: items.filter((i) => i.sale_id === s.id),
    sale_returns: returns
      .filter((r) => r.sale_id === s.id)
      .map((r) => ({ ...r, sale_return_items: returnItems.filter((ri) => ri.return_id === r.id) })),
  }));
}

// Full detail for one sale — items sold, items returned, net figures.
// Used by the "Return items" panel to know what's still returnable.
export function getSaleDetail(saleId: string) {
  const db = getDb();
  const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(saleId);
  if (!sale) throw new ValidationError("Sale not found");

  const items = db
    .prepare(
      `SELECT si.*, p.name as product_name,
              COALESCE((
                SELECT SUM(sri.quantity) FROM sale_return_items sri
                JOIN sale_returns sr ON sr.id = sri.return_id
                WHERE sr.sale_id = si.sale_id AND sri.product_id = si.product_id
              ), 0) as already_returned
       FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ?`,
    )
    .all(saleId) as Array<{ product_id: string; quantity: number; already_returned: number }>;

  const returns = db
    .prepare("SELECT * FROM sale_returns WHERE sale_id = ? ORDER BY created_at DESC")
    .all(saleId) as Array<{ id: string }>;

  const returnItems = db.prepare("SELECT * FROM sale_return_items WHERE return_id = ?");
  const returnsWithItems = returns.map((r) => ({ ...r, items: returnItems.all(r.id) }));

  return {
    sale,
    items: items.map((i) => ({ ...i, returnable: i.quantity - i.already_returned })),
    returns: returnsWithItems,
  };
}

export function voidSale(actingRole: Role, saleId: string, reason: string) {
  requireAdmin(actingRole);
  const db = getDb();

  const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(saleId) as
    | { status: string }
    | undefined;
  if (!sale) throw new ValidationError("Sale not found");
  if (sale.status === "voided") throw new ValidationError("A voided sale cannot be voided again");

  const items = db.prepare("SELECT product_id, quantity FROM sale_items WHERE sale_id = ?").all(
    saleId,
  ) as Array<{ product_id: string; quantity: number }>;

  const restoreStock = db.prepare(
    "UPDATE inventory SET quantity = quantity + ?, updated_at = datetime('now') WHERE product_id = ?",
  );
  const logMovement = db.prepare(
    `INSERT INTO stock_movements (id, product_id, change_type, quantity_change, note, created_by)
     VALUES (?, ?, 'void', ?, ?, (SELECT id FROM users WHERE role = 'admin' LIMIT 1))`,
  );

  const tx = db.transaction(() => {
    db.prepare("UPDATE sales SET status = 'voided', void_reason = ? WHERE id = ?").run(reason, saleId);
    for (const item of items) {
      restoreStock.run(item.quantity, item.product_id);
      logMovement.run(randomUUID(), item.product_id, item.quantity, reason || "Sale voided");
    }
  });
  tx();
}

// ---------- RETURNS ----------
// "Return items" on a sale: pick products + quantities + a reason.
// Restocks automatically, shows on the sale record, and the refunded amount
// is deducted from revenue/profit in reports. The DB itself blocks returning
// more than was actually sold (checked inside the same transaction as the
// stock restore, same pattern as the oversell guard in createSale).

export function createReturn(
  actingUserId: string,
  input: {
    saleId: string;
    reason: string;
    items: Array<{ productId: string; quantity: number }>;
  },
) {
  if (input.items.length === 0) throw new ValidationError("A return needs at least one item");

  const db = getDb();
  const returnId = randomUUID();

  const getSoldQty = db.prepare(
    "SELECT COALESCE(SUM(quantity),0) as qty, COALESCE(AVG(unit_price),0) as unit_price FROM sale_items WHERE sale_id = ? AND product_id = ?",
  );
  const getReturnedQty = db.prepare(
    `SELECT COALESCE(SUM(sri.quantity),0) as qty
     FROM sale_return_items sri JOIN sale_returns sr ON sr.id = sri.return_id
     WHERE sr.sale_id = ? AND sri.product_id = ?`,
  );
  const restoreStock = db.prepare(
    "UPDATE inventory SET quantity = quantity + ?, updated_at = datetime('now') WHERE product_id = ?",
  );
  const insertReturnItem = db.prepare(
    "INSERT INTO sale_return_items (id, return_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)",
  );
  const logMovement = db.prepare(
    `INSERT INTO stock_movements (id, product_id, change_type, quantity_change, note, created_by)
     VALUES (?, ?, 'return', ?, ?, ?)`,
  );

  let totalAmount = 0;

  const tx = db.transaction(() => {
    const sale = db.prepare("SELECT id FROM sales WHERE id = ?").get(input.saleId);
    if (!sale) throw new ValidationError("Sale not found");

    db.prepare(
      "INSERT INTO sale_returns (id, sale_id, reason, total_amount, created_by) VALUES (?, ?, ?, ?, ?)",
    ).run(returnId, input.saleId, input.reason, 0, actingUserId);

    for (const item of input.items) {
      const sold = getSoldQty.get(input.saleId, item.productId) as { qty: number; unit_price: number };
      const alreadyReturned = getReturnedQty.get(input.saleId, item.productId) as { qty: number };
      const returnable = sold.qty - alreadyReturned.qty;

      if (sold.qty === 0) throw new ValidationError("That product was not part of this sale");
      if (item.quantity > returnable) {
        throw new ValidationError(
          `Cannot return ${item.quantity} — only ${returnable} unit(s) remain returnable for this item`,
        );
      }

      const lineTotal = item.quantity * sold.unit_price;
      totalAmount += lineTotal;

      insertReturnItem.run(randomUUID(), returnId, item.productId, item.quantity, sold.unit_price);
      restoreStock.run(item.quantity, item.productId);
      logMovement.run(randomUUID(), item.productId, item.quantity, input.reason || "Item returned", actingUserId);
    }

    db.prepare("UPDATE sale_returns SET total_amount = ? WHERE id = ?").run(totalAmount, returnId);
  });
  tx();

  return { id: returnId, totalAmount };
}

export function updateProduct(
  actingRole: Role,
  productId: string,
  input: {
    categoryId: string;
    name: string;
    brand?: string;
    sku?: string;
    costPrice?: number;
    sellingPrice: number;
    imageUrl?: string;
    attributes: Array<{ attrName: string; attrValue: string }>;
    quantity: number;
    reorderLevel: number;
  },
) {
  requireAdmin(actingRole);
  const db = getDb();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE products SET category_id=?, name=?, brand=?, sku=?, cost_price=?, selling_price=?
       ${input.imageUrl !== undefined ? ", image_url=?" : ""} WHERE id=?`,
    ).run(
      ...([
        input.categoryId,
        input.name,
        input.brand ?? null,
        input.sku ?? null,
        input.costPrice ?? null,
        input.sellingPrice,
        ...(input.imageUrl !== undefined ? [input.imageUrl] : []),
        productId,
      ] as any[]),
    );

    db.prepare("DELETE FROM product_attributes WHERE product_id = ?").run(productId);
    const insertAttr = db.prepare(
      "INSERT INTO product_attributes (id, product_id, attr_name, attr_value) VALUES (?, ?, ?, ?)",
    );
    for (const a of input.attributes) {
      insertAttr.run(randomUUID(), productId, a.attrName, a.attrValue);
    }

    const previousStock = db.prepare("SELECT quantity FROM inventory WHERE product_id = ?").get(productId) as
      | { quantity: number }
      | undefined;
    const previousQuantity = previousStock?.quantity ?? 0;
    const quantityDelta = input.quantity - previousQuantity;

    db.prepare(
      `INSERT INTO inventory (product_id, quantity, reorder_level) VALUES (?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET quantity=excluded.quantity, reorder_level=excluded.reorder_level, updated_at=datetime('now')`,
    ).run(productId, input.quantity, input.reorderLevel);

    if (quantityDelta !== 0) {
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, change_type, quantity_change, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), productId, "adjustment", quantityDelta, `Inventory adjusted to ${input.quantity}`, null);
    }
  });
  tx();

  return { id: productId };
}

export function deactivateProduct(actingRole: Role, productId: string) {
  requireAdmin(actingRole);
  getDb().prepare("UPDATE products SET is_active = 0 WHERE id = ?").run(productId);
}

// ---------- SUPPLIERS ----------

export function listSuppliers() {
  return getDb().prepare("SELECT * FROM suppliers ORDER BY name").all();
}

export function createSupplier(
  actingRole: Role,
  input: { name: string; phone?: string; address?: string },
) {
  requireAdmin(actingRole);
  const db = getDb();
  const id = randomUUID();
  db.prepare("INSERT INTO suppliers (id, name, phone, address) VALUES (?, ?, ?, ?)").run(
    id,
    input.name,
    input.phone ?? null,
    input.address ?? null,
  );
  return { id };
}

export function deleteSupplier(actingRole: Role, id: string) {
  requireAdmin(actingRole);
  getDb().prepare("DELETE FROM suppliers WHERE id = ?").run(id);
}

export function listPurchases(actingRole: Role) {
  requireAdmin(actingRole);
  const db = getDb();
  const purchases = db
    .prepare(
      `SELECT p.*, s.name as supplier_name
       FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
       ORDER BY p.purchase_date DESC, p.created_at DESC`,
    )
    .all() as any[];
  const items = db
    .prepare(
      `SELECT pi.*, pr.name as product_name FROM purchase_items pi
       JOIN products pr ON pr.id = pi.product_id`,
    )
    .all() as any[];
  return purchases.map((p) => ({ ...p, items: items.filter((i) => i.purchase_id === p.id) }));
}

// ---------- CATEGORY ATTRIBUTES (add/remove single field on an existing category) ----------

export function addCategoryAttribute(
  actingRole: Role,
  input: {
    categoryId: string;
    attrName: string;
    attrLabel: string;
    inputType: "text" | "dropdown" | "number";
    options?: string[];
    isRequired?: boolean;
    displayOrder?: number;
  },
) {
  requireAdmin(actingRole);
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO category_attributes
      (id, category_id, attr_name, attr_label, input_type, options, is_required, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.categoryId,
    input.attrName,
    input.attrLabel,
    input.inputType,
    input.options ? JSON.stringify(input.options) : null,
    input.isRequired ? 1 : 0,
    input.displayOrder ?? 0,
  );
  return { id };
}

export function removeCategoryAttribute(actingRole: Role, attributeId: string) {
  requireAdmin(actingRole);
  getDb().prepare("DELETE FROM category_attributes WHERE id = ?").run(attributeId);
}

// ---------- CUSTOMERS ----------

// One-click starter data for "Manage Categories" — inserts the 8 categories
// Musa specified with their attribute fields. Safe to call more than once:
// any category whose name already exists is skipped entirely (not merged,
// not duplicated), so clicking this after manually adding some categories
// won't create doubles.
const IPHONE_MODELS = [
  "iPhone X","iPhone XR","iPhone XS","iPhone XS Max","iPhone 11","iPhone 11 Pro",
  "iPhone 11 Pro Max","iPhone 12","iPhone 12 Mini","iPhone 12 Pro","iPhone 12 Pro Max",
  "iPhone 13","iPhone 13 Mini","iPhone 13 Pro","iPhone 13 Pro Max","iPhone 14",
  "iPhone 14 Plus","iPhone 14 Pro","iPhone 14 Pro Max","iPhone 15","iPhone 15 Plus",
  "iPhone 15 Pro","iPhone 15 Pro Max","iPhone 16","iPhone 16 Plus","iPhone 16 Pro",
  "iPhone 16 Pro Max","iPhone 17","iPhone 17 Pro","iPhone 17 Pro Max",
];

const STARTER_CATEGORIES: Array<{
  name: string;
  attributes: Array<{ attrLabel: string; inputType: "text" | "dropdown" | "number"; options?: string[] }>;
}> = [
  {
    name: "Phones",
    attributes: [
      { attrLabel: "Brand", inputType: "dropdown", options: ["Apple", "Samsung", "Tecno", "Infinix", "Itel", "Xiaomi"] },
      { attrLabel: "Model", inputType: "text" },
      { attrLabel: "Storage", inputType: "dropdown", options: ["64GB", "128GB", "256GB", "512GB", "1TB"] },
      { attrLabel: "Color", inputType: "text" },
      { attrLabel: "Condition", inputType: "dropdown", options: ["New", "UK Used", "Refurbished"] },
    ],
  },
  {
    name: "Back Case",
    attributes: [
      { attrLabel: "Compatible Model", inputType: "dropdown", options: IPHONE_MODELS },
      { attrLabel: "Color/Finish", inputType: "text" },
    ],
  },
  {
    name: "Screen Guard",
    attributes: [
      { attrLabel: "Compatible Model", inputType: "dropdown", options: IPHONE_MODELS },
      { attrLabel: "Material", inputType: "dropdown", options: ["Tempered Glass", "Hydrogel", "Privacy Glass"] },
    ],
  },
  {
    name: "Chargers",
    attributes: [
      { attrLabel: "Brand", inputType: "dropdown", options: ["Samsung", "Apple", "Anker", "Baseus", "Oraimo"] },
      { attrLabel: "Wattage", inputType: "dropdown", options: ["20W", "30W", "45W", "65W"] },
      { attrLabel: "Connector Type", inputType: "dropdown", options: ["USB-C", "Lightning", "Dual Port"] },
    ],
  },
  {
    name: "Power Banks",
    attributes: [
      { attrLabel: "Brand", inputType: "dropdown", options: ["Itel", "Oraimo", "Anker", "Baseus", "Romoss", "Xiaomi", "Infinix XPower"] },
      { attrLabel: "Capacity", inputType: "dropdown", options: ["10000mAh", "20000mAh", "30000mAh"] },
      { attrLabel: "Output Wattage", inputType: "dropdown", options: ["10W", "22.5W", "33W", "65W"] },
    ],
  },
  {
    name: "Cables",
    attributes: [
      {
        attrLabel: "Type",
        inputType: "dropdown",
        options: ["USB-C to USB-C", "USB-C to Lightning", "USB-A to Lightning", "USB-A to USB-C", "USB-A to Micro-USB"],
      },
      { attrLabel: "Wattage", inputType: "dropdown", options: ["20W", "30W", "60W", "100W"] },
      { attrLabel: "Length", inputType: "dropdown", options: ["1m", "2m"] },
    ],
  },
  {
    name: "Earpiece",
    attributes: [
      { attrLabel: "Type", inputType: "dropdown", options: ["Wired", "Wireless", "Earbuds"] },
      { attrLabel: "Brand", inputType: "text" },
    ],
  },
  {
    name: "Pouches",
    attributes: [
      { attrLabel: "Compatible Model", inputType: "dropdown", options: IPHONE_MODELS },
      { attrLabel: "Material", inputType: "text" },
      { attrLabel: "Color", inputType: "text" },
    ],
  },
];

export function seedDefaultCategories(actingRole: Role) {
  requireAdmin(actingRole);
  const db = getDb();
  const existing = new Set((db.prepare("SELECT name FROM categories").all() as Array<{ name: string }>).map((c) => c.name));

  let created = 0;
  for (const cat of STARTER_CATEGORIES) {
    if (existing.has(cat.name)) continue;
    createCategory(actingRole, {
      name: cat.name,
      attributes: cat.attributes.map((a, i) => ({
        attrName: a.attrLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        attrLabel: a.attrLabel,
        inputType: a.inputType,
        options: a.options,
        displayOrder: i + 1,
      })),
    });
    created++;
  }
  return { created, skipped: STARTER_CATEGORIES.length - created };
}

// ---------- CUSTOMERS ----------

export function listCustomers() {
  const db = getDb();
  const customers = db.prepare("SELECT * FROM customers ORDER BY full_name").all() as any[];
  const balances = db
    .prepare(
      `SELECT customer_id, SUM(balance_due) as outstanding_balance
       FROM sales
       WHERE status = 'completed' AND balance_due > 0
       GROUP BY customer_id`,
    )
    .all() as Array<{ customer_id: string | null; outstanding_balance: number }>;

  const balanceMap = new Map<string, number>();
  for (const row of balances) if (row.customer_id) balanceMap.set(row.customer_id, Number(row.outstanding_balance));

  return customers.map((customer) => ({
    ...customer,
    outstanding_balance: balanceMap.get(customer.id) ?? 0,
  }));
}

export function createCustomer(input: { fullName: string; phone?: string; email?: string; address?: string }) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO customers (id, full_name, phone, email, address) VALUES (?, ?, ?, ?, ?)",
  ).run(id, input.fullName, input.phone ?? null, input.email ?? null, input.address ?? null);
  return { id };
}

export function listDebtors() {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.id, s.total_amount, s.amount_paid, s.balance_due, s.payment_status, s.payment_method, s.created_at,
              c.id as customer_id, c.full_name as customer_name, c.phone, c.email,
              u.full_name as sold_by_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.sold_by
       WHERE s.status = 'completed' AND s.balance_due > 0
       ORDER BY s.created_at DESC`,
    )
    .all() as Array<{
      id: string;
      total_amount: number;
      amount_paid: number;
      balance_due: number;
      payment_status: string;
      payment_method: string;
      created_at: string;
      customer_id: string | null;
      customer_name: string | null;
      phone: string | null;
      email: string | null;
      sold_by_name: string | null;
    }>;
}

export function markSalePayment(actingRole: Role, saleId: string, amountPaid: number) {
  requireAdmin(actingRole);
  const db = getDb();
  const sale = db.prepare("SELECT total_amount, amount_paid, balance_due FROM sales WHERE id = ?").get(saleId) as
    | { total_amount: number; amount_paid: number; balance_due: number }
    | undefined;
  if (!sale) throw new ValidationError("Sale not found");
  if (sale.balance_due <= 0) throw new ValidationError("This sale has no outstanding balance");

  const nextPaid = Math.min(sale.total_amount, sale.amount_paid + Number(amountPaid));
  const nextBalance = Math.max(0, sale.total_amount - nextPaid);
  const nextStatus = nextBalance <= 0 ? "paid" : nextPaid > 0 ? "partly_paid" : "unpaid";

  db.prepare("UPDATE sales SET amount_paid = ?, balance_due = ?, payment_status = ? WHERE id = ?").run(
    nextPaid,
    nextBalance,
    nextStatus,
    saleId,
  );

  return { amountPaid: nextPaid, balanceDue: nextBalance, paymentStatus: nextStatus };
}

// ---------- REPORTS (admin-only financials enforced here) ----------

// Reports page: revenue/profit trend + most-returned + refund breakdown,
// all scoped to a date range. groupBy is chosen by the caller based on the
// range length (day for short ranges, month for 3mo/6mo) — matches how the
// UI switches the chart granularity.
export function getReportsData(
  actingRole: Role,
  range: DateRange,
  groupBy: "day" | "month",
) {
  requireAdmin(actingRole); // financial data — admin only, same as before

  const db = getDb();
  const bucket = groupBy === "day" ? "date(s.created_at)" : "strftime('%Y-%m', s.created_at)";

  // Revenue: sum of completed sale line items in range, grouped by bucket.
  // Profit: revenue minus cost_price for the same lines.
  const revenueTrend = db
    .prepare(
      `SELECT ${bucket} as bucket,
              COALESCE(SUM(si.quantity * si.unit_price), 0) as revenue,
              COALESCE(SUM(si.quantity * (si.unit_price - COALESCE(p.cost_price,0))), 0) as gross_profit
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.status = 'completed' AND date(s.created_at) BETWEEN ? AND ?
       GROUP BY bucket ORDER BY bucket`,
    )
    .all(range.from, range.to) as Array<{ bucket: string; revenue: number; gross_profit: number }>;

  // Refunds in the same range, same bucketing, to net against revenue/profit.
  const bucketReturn = groupBy === "day" ? "date(sr.created_at)" : "strftime('%Y-%m', sr.created_at)";
  const refundTrend = db
    .prepare(
      `SELECT ${bucketReturn} as bucket,
              COALESCE(SUM(sri.quantity * sri.unit_price), 0) as refunded,
              COALESCE(SUM(sri.quantity * (sri.unit_price - COALESCE(p.cost_price,0))), 0) as profit_reversed
       FROM sale_return_items sri
       JOIN sale_returns sr ON sr.id = sri.return_id
       JOIN products p ON p.id = sri.product_id
       WHERE date(sr.created_at) BETWEEN ? AND ?
       GROUP BY bucket ORDER BY bucket`,
    )
    .all(range.from, range.to) as Array<{ bucket: string; refunded: number; profit_reversed: number }>;

  const refundByBucket = new Map(refundTrend.map((r) => [r.bucket, r]));
  const trend = revenueTrend.map((r) => {
    const refund = refundByBucket.get(r.bucket);
    return {
      bucket: r.bucket,
      netRevenue: r.revenue - (refund?.refunded ?? 0),
      netProfit: r.gross_profit - (refund?.profit_reversed ?? 0),
      refunded: refund?.refunded ?? 0,
    };
  });

  // Most-returned products in range
  const mostReturned = db
    .prepare(
      `SELECT p.id, p.name, SUM(sri.quantity) as total_returned, COUNT(DISTINCT sr.id) as return_count
       FROM sale_return_items sri
       JOIN sale_returns sr ON sr.id = sri.return_id
       JOIN products p ON p.id = sri.product_id
       WHERE date(sr.created_at) BETWEEN ? AND ?
       GROUP BY p.id ORDER BY total_returned DESC LIMIT 10`,
    )
    .all(range.from, range.to);

  // Refund breakdown by reason.
  // The "Reason" field on the return dialog is free text (max 200 chars),
  // so grouping by exact string would produce one row per unique phrase
  // typed ("Wrong item" vs "wrong item" vs "customer got wrong item" would
  // all be separate rows). Instead: pull the raw reason strings for returns
  // in range, and bucket them into a small fixed set of categories using
  // keyword matching. The original free-text reason is never lost — it's
  // still stored as-is on the return record and shown when you open a
  // specific return; this categorization only affects the aggregate report.
  const rawReturns = db
    .prepare(
      `SELECT reason, total_amount FROM sale_returns WHERE date(created_at) BETWEEN ? AND ?`,
    )
    .all(range.from, range.to) as Array<{ reason: string; total_amount: number }>;

  const REASON_CATEGORIES: Array<{ label: string; keywords: string[] }> = [
    { label: "Faulty / Damaged", keywords: ["fault", "damag", "broken", "defect", "not working"] },
    { label: "Wrong item", keywords: ["wrong item", "wrong product", "wrong model", "wrong order"] },
    { label: "Changed mind", keywords: ["change", "changed mind", "no longer need", "decided against"] },
    { label: "Size / fit issue", keywords: ["size", "fit", "too big", "too small"] },
  ];

  function categorize(reason: string): string {
    const normalized = reason.trim().toLowerCase();
    if (!normalized) return "Not specified";
    for (const cat of REASON_CATEGORIES) {
      if (cat.keywords.some((k) => normalized.includes(k))) return cat.label;
    }
    return "Other";
  }

  const categoryTotals = new Map<string, { count: number; total: number }>();
  for (const r of rawReturns) {
    const cat = categorize(r.reason ?? "");
    const existing = categoryTotals.get(cat) ?? { count: 0, total: 0 };
    existing.count += 1;
    existing.total += r.total_amount;
    categoryTotals.set(cat, existing);
  }
  const refundReasons = [...categoryTotals.entries()]
    .map(([reason, v]) => ({ reason, ...v }))
    .sort((a, b) => b.total - a.total);

  const totalRefunds = db
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount),0) as total
       FROM sale_returns WHERE date(created_at) BETWEEN ? AND ?`,
    )
    .get(range.from, range.to) as { count: number; total: number };

  // ---- Everything below extends the original trend/returns data with what
  // the Reports page needs: summary stats, top sellers (net of returns),
  // low stock, stock value, and CSV export rows.

  const salesAgg = db
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount),0) as gross
       FROM sales WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ?`,
    )
    .get(range.from, range.to) as { count: number; gross: number };

  const voidedCount = (
    db
      .prepare(`SELECT COUNT(*) as count FROM sales WHERE status = 'voided' AND date(created_at) BETWEEN ? AND ?`)
      .get(range.from, range.to) as { count: number }
  ).count;

  const grossCost = (
    db
      .prepare(
        `SELECT COALESCE(SUM(si.quantity * COALESCE(p.cost_price,0)),0) as cost
         FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
         WHERE s.status = 'completed' AND date(s.created_at) BETWEEN ? AND ?`,
      )
      .get(range.from, range.to) as { cost: number }
  ).cost;

  const refundCost = (
    db
      .prepare(
        `SELECT COALESCE(SUM(sri.quantity * COALESCE(p.cost_price,0)),0) as cost
         FROM sale_return_items sri JOIN sale_returns sr ON sr.id = sri.return_id JOIN products p ON p.id = sri.product_id
         WHERE date(sr.created_at) BETWEEN ? AND ?`,
      )
      .get(range.from, range.to) as { cost: number }
  ).cost;

  const netRevenue = salesAgg.gross - totalRefunds.total;
  const netProfit = salesAgg.gross - grossCost - (totalRefunds.total - refundCost);

  // Top sellers: sold quantity/revenue per product, minus whatever was
  // returned for that product in the same range — a product returned more
  // than it was sold (rare, cross-range return) is floored at 0 rather than
  // shown negative.
  const soldByProduct = db
    .prepare(
      `SELECT p.id, p.name, SUM(si.quantity) as qty, SUM(si.quantity * si.unit_price) as revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
       WHERE s.status = 'completed' AND date(s.created_at) BETWEEN ? AND ?
       GROUP BY p.id`,
    )
    .all(range.from, range.to) as Array<{ id: string; name: string; qty: number; revenue: number }>;

  const returnedByProduct = db
    .prepare(
      `SELECT p.id, SUM(sri.quantity) as qty, SUM(sri.quantity * sri.unit_price) as revenue
       FROM sale_return_items sri JOIN sale_returns sr ON sr.id = sri.return_id JOIN products p ON p.id = sri.product_id
       WHERE date(sr.created_at) BETWEEN ? AND ?
       GROUP BY p.id`,
    )
    .all(range.from, range.to) as Array<{ id: string; qty: number; revenue: number }>;

  const returnedMap = new Map(returnedByProduct.map((r) => [r.id, r]));
  const topSellers = soldByProduct
    .map((p) => {
      const ret = returnedMap.get(p.id);
      return {
        name: p.name,
        qty: Math.max(0, p.qty - (ret?.qty ?? 0)),
        revenue: Math.max(0, p.revenue - (ret?.revenue ?? 0)),
      };
    })
    .filter((p) => p.qty > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const lowStock = db
    .prepare(
      `SELECT p.name, i.quantity FROM inventory i JOIN products p ON p.id = i.product_id
       WHERE i.quantity <= i.reorder_level AND p.is_active = 1 ORDER BY i.quantity ASC`,
    )
    .all();

  // Category breakdown: revenue by product category in range, net of
  // returns for products in that category. Uncategorized products (no
  // category_id set) are grouped under "Uncategorized" rather than dropped,
  // so the totals here always reconcile with topSellers/revenue above.
  const categorySales = db
    .prepare(
      `SELECT COALESCE(c.name, 'Uncategorized') as category,
              SUM(si.quantity * si.unit_price) as revenue
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE s.status = 'completed' AND date(s.created_at) BETWEEN ? AND ?
       GROUP BY category`,
    )
    .all(range.from, range.to) as Array<{ category: string; revenue: number }>;

  const categoryReturns = db
    .prepare(
      `SELECT COALESCE(c.name, 'Uncategorized') as category,
              SUM(sri.quantity * sri.unit_price) as refunded
       FROM sale_return_items sri
       JOIN sale_returns sr ON sr.id = sri.return_id
       JOIN products p ON p.id = sri.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE date(sr.created_at) BETWEEN ? AND ?
       GROUP BY category`,
    )
    .all(range.from, range.to) as Array<{ category: string; refunded: number }>;

  const categoryRefundMap = new Map(categoryReturns.map((r) => [r.category, r.refunded]));
  const categoryBreakdown = categorySales
    .map((c) => ({
      category: c.category,
      revenue: Math.max(0, c.revenue - (categoryRefundMap.get(c.category) ?? 0)),
    }))
    .filter((c) => c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);

  const stockValue = (
    db
      .prepare(
        `SELECT COALESCE(SUM(i.quantity * COALESCE(p.cost_price,0)),0) as value
         FROM inventory i JOIN products p ON p.id = i.product_id
         WHERE p.is_active = 1`,
      )
      .get() as { value: number }
  ).value;

  const rows = db
    .prepare(
      `SELECT s.created_at as date, s.total_amount as total, COALESCE(r.refunded,0) as refunded
       FROM sales s
       LEFT JOIN (SELECT sale_id, SUM(total_amount) as refunded FROM sale_returns GROUP BY sale_id) r ON r.sale_id = s.id
       WHERE s.status = 'completed' AND date(s.created_at) BETWEEN ? AND ?
       ORDER BY s.created_at DESC`,
    )
    .all(range.from, range.to);

  return {
    trend,
    mostReturned: mostReturned.slice(0, 5),
    refundBreakdown: { byReason: refundReasons, ...totalRefunds },
    salesCount: salesAgg.count,
    voided: voidedCount,
    grossRevenue: salesAgg.gross,
    refunds: totalRefunds.total,
    returnCount: totalRefunds.count,
    revenue: netRevenue,
    profit: netProfit,
    top: topSellers,
    lowStock,
    categoryBreakdown,
    stockValue,
    rows,
  };
}

export function getDashboardSummary(role: Role, userId: string) {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();

  const todaySales = db
    .prepare(
      `SELECT COUNT(*) as count,
              COALESCE(SUM(s.amount_paid - COALESCE(r.refunded_total, 0)), 0) as total
       FROM sales s
       LEFT JOIN (
         SELECT sale_id, SUM(total_amount) as refunded_total
         FROM sale_returns
         GROUP BY sale_id
       ) r ON r.sale_id = s.id
       WHERE s.status = 'completed' AND date(s.created_at) = ?
       ${role === "admin" ? "" : "AND s.sold_by = ?"}`,
    )
    .get(...(role === "admin" ? [today] : [today, userId])) as { count: number; total: number };

  const outstandingDebt = db
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(balance_due),0) as total
       FROM sales
       WHERE status = 'completed' AND balance_due > 0
       ${role === "admin" ? "" : "AND sold_by = ?"}`,
    )
    .get(...(role === "admin" ? [] : [userId])) as { count: number; total: number };

  const lowStock = db
    .prepare(
      `SELECT p.id, p.name, i.quantity, i.reorder_level
       FROM inventory i JOIN products p ON p.id = i.product_id
       WHERE i.quantity <= i.reorder_level AND p.is_active = 1
       ORDER BY i.quantity ASC`,
    )
    .all();

  const recentSales = db
    .prepare(
      `SELECT s.id, s.total_amount, s.status, s.created_at, c.full_name as customer_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       ${role === "admin" ? "" : "WHERE s.sold_by = ?"}
       ORDER BY s.created_at DESC LIMIT 10`,
    )
    .all(...(role === "admin" ? [] : [userId]));

  const bestSellers = db
    .prepare(
      `SELECT p.name, SUM(si.quantity) as qty
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.status = 'completed' AND s.created_at >= ?
       GROUP BY p.id ORDER BY qty DESC LIMIT 5`,
    )
    .all(weekAgo);

  const base = {
    todaySalesCount: todaySales.count,
    todaySalesTotal: todaySales.total,
    outstandingDebtCount: outstandingDebt.count,
    outstandingDebtTotal: outstandingDebt.total,
    lowStock,
    recentSales,
    bestSellers,
  };

  if (role !== "admin") return base;

  const stockValue = db
    .prepare(
      `SELECT COALESCE(SUM(i.quantity * COALESCE(p.cost_price,0)),0) as value
       FROM inventory i JOIN products p ON p.id = i.product_id
       WHERE p.is_active = 1`,
    )
    .get() as { value: number };

  const salesByStaff = db
    .prepare(
      `SELECT u.full_name, COUNT(*) as sale_count, COALESCE(SUM(s.total_amount),0) as total
       FROM sales s JOIN users u ON u.id = s.sold_by
       WHERE s.status = 'completed' AND date(s.created_at) = ?
       GROUP BY u.id ORDER BY total DESC`,
    )
    .all(today);

  const todayProfit = db
    .prepare(
      `SELECT COALESCE(SUM(si.quantity * (si.unit_price - COALESCE(p.cost_price,0))),0) as profit
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.status = 'completed' AND date(s.created_at) = ?`,
    )
    .get(today) as { profit: number };

  const todayLoss = db
    .prepare(
      `SELECT COALESCE(SUM(CASE
         WHEN si.unit_price < COALESCE(p.cost_price,0)
           THEN (COALESCE(p.cost_price,0) - si.unit_price) * si.quantity
         ELSE 0
       END),0) as loss
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.status = 'completed' AND date(s.created_at) = ?`,
    )
    .get(today) as { loss: number };

  return { ...base, stockValue: stockValue.value, salesByStaff, todayProfit: todayProfit.profit, todayLoss: todayLoss.loss };
}
