import { ipcMain } from "electron";
import * as repo from "../db/repository";
import { getSession, requireSession, setSession } from "../session";

// Every handler below follows the same pattern:
//   1. pull the acting user from the SERVER-SIDE session (never from renderer input)
//   2. call into repository.ts, which does its own role checks as a second layer
//   3. catch repo errors and turn them into a plain { ok, error } shape the
//      renderer can display, instead of leaking stack traces to the UI
//
// This double-check (session here + requireAdmin in repository.ts) means a
// bug in one layer doesn't silently become a security hole — both have to
// agree an action is allowed.

function wrap<T>(fn: () => T): { ok: true; data: T } | { ok: false; error: string } {
  try {
    return { ok: true, data: fn() };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return { ok: false, error: message };
  }
}

export function registerIpcHandlers(): void {
  // ---------- AUTH ----------
  ipcMain.handle("auth:login", (_e, { email, password }: { email: string; password: string }) =>
    wrap(() => {
      const user = repo.login(email, password);
      setSession(null);
      setSession({ userId: user.id, fullName: user.fullName, email: user.email, role: user.role });
      return user;
    }),
  );

  ipcMain.handle("auth:logout", () =>
    wrap(() => {
      setSession(null);
      return { loggedOut: true };
    }),
  );

  ipcMain.handle("auth:currentSession", () => wrap(() => getSession()));

  ipcMain.handle("auth:hasAnyUsers", () => wrap(() => repo.hasAnyUsers()));

  // First-run only: creates the very first account and makes it admin.
  // Blocked once any user already exists — after that, only an existing
  // admin (via users:create) can add more accounts.
  ipcMain.handle(
    "auth:bootstrapFirstAdmin",
    (_e, input: { fullName: string; email: string; password: string }) =>
      wrap(() => {
        if (repo.hasAnyUsers()) throw new Error("Setup already completed — log in instead");
        const user = repo.createUser({ ...input, role: "admin" });
        setSession({ userId: user.id, fullName: user.fullName, email: user.email, role: "admin" });
        return user;
      }),
  );

  // ---------- USERS (admin only) ----------
  ipcMain.handle("users:list", () =>
    wrap(() => {
      requireSession(); // must be logged in; repo doesn't gate reads further here
      return repo.listUsers();
    }),
  );

  ipcMain.handle(
    "users:create",
    (_e, input: { fullName: string; email: string; password: string; role: repo.Role }) =>
      wrap(() => {
        const session = requireSession();
        if (session.role !== "admin") throw new Error("Admin access required");
        return repo.createUser(input);
      }),
  );

  ipcMain.handle("users:setRole", (_e, { userId, role }: { userId: string; role: repo.Role }) =>
    wrap(() => {
      const session = requireSession();
      repo.setUserRole(session.role, userId, role);
      return { ok: true };
    }),
  );

  ipcMain.handle("users:setActive", (_e, { userId, isActive }: { userId: string; isActive: boolean }) =>
    wrap(() => {
      const session = requireSession();
      repo.setUserActive(session.role, userId, isActive);
      return { ok: true };
    }),
  );

  // ---------- CATEGORIES ----------
  ipcMain.handle("categories:list", () =>
    wrap(() => {
      requireSession();
      return repo.listCategories();
    }),
  );

  ipcMain.handle("categories:create", (_e, input: Parameters<typeof repo.createCategory>[1]) =>
    wrap(() => {
      const session = requireSession();
      return repo.createCategory(session.role, input);
    }),
  );

  ipcMain.handle("categories:delete", (_e, { categoryId }: { categoryId: string }) =>
    wrap(() => {
      const session = requireSession();
      repo.deleteCategory(session.role, categoryId);
      return { ok: true };
    }),
  );

  ipcMain.handle("categories:seedDefaults", () =>
    wrap(() => {
      const session = requireSession();
      return repo.seedDefaultCategories(session.role);
    }),
  );

  // ---------- PRODUCTS ----------
  ipcMain.handle("products:list", () =>
    wrap(() => {
      const session = requireSession();
      return repo.listProducts(session.role); // cost_price stripped inside for staff
    }),
  );

  ipcMain.handle("products:create", (_e, input: Parameters<typeof repo.createProduct>[1]) =>
    wrap(() => {
      const session = requireSession();
      return repo.createProduct(session.role, input);
    }),
  );

  ipcMain.handle(
    "products:update",
    (_e, { productId, input }: { productId: string; input: Parameters<typeof repo.updateProduct>[2] }) =>
      wrap(() => {
        const session = requireSession();
        return repo.updateProduct(session.role, productId, input);
      }),
  );

  ipcMain.handle("products:deactivate", (_e, { productId }: { productId: string }) =>
    wrap(() => {
      const session = requireSession();
      repo.deactivateProduct(session.role, productId);
      return { ok: true };
    }),
  );

  ipcMain.handle("products:movements", (_e, { productId }: { productId: string }) =>
    wrap(() => {
      requireSession();
      return repo.listStockMovements(productId);
    }),
  );

  // ---------- SUPPLIERS ----------
  ipcMain.handle("suppliers:list", () =>
    wrap(() => {
      requireSession();
      return repo.listSuppliers();
    }),
  );

  ipcMain.handle("suppliers:create", (_e, input: Parameters<typeof repo.createSupplier>[1]) =>
    wrap(() => {
      const session = requireSession();
      return repo.createSupplier(session.role, input);
    }),
  );

  ipcMain.handle("suppliers:delete", (_e, { id }: { id: string }) =>
    wrap(() => {
      const session = requireSession();
      repo.deleteSupplier(session.role, id);
      return { ok: true };
    }),
  );

  ipcMain.handle("purchases:list", () =>
    wrap(() => {
      const session = requireSession();
      return repo.listPurchases(session.role);
    }),
  );

  ipcMain.handle("categories:addAttribute", (_e, input: Parameters<typeof repo.addCategoryAttribute>[1]) =>
    wrap(() => {
      const session = requireSession();
      return repo.addCategoryAttribute(session.role, input);
    }),
  );

  ipcMain.handle("categories:removeAttribute", (_e, { attributeId }: { attributeId: string }) =>
    wrap(() => {
      const session = requireSession();
      repo.removeCategoryAttribute(session.role, attributeId);
      return { ok: true };
    }),
  );

  // ---------- PURCHASES (admin only) ----------
  ipcMain.handle("purchases:create", (_e, input: Parameters<typeof repo.createPurchase>[2]) =>
    wrap(() => {
      const session = requireSession();
      return repo.createPurchase(session.role, session.userId, input);
    }),
  );

  // ---------- SALES ----------
  ipcMain.handle("sales:create", (_e, input: Parameters<typeof repo.createSale>[1]) =>
    wrap(() => {
      const session = requireSession();
      return repo.createSale(session.userId, input);
    }),
  );

  ipcMain.handle("sales:list", (_e, range?: repo.DateRange) =>
    wrap(() => {
      const session = requireSession();
      return repo.listSales(session.role, session.userId, range);
    }),
  );

  ipcMain.handle("sales:detail", (_e, { saleId }: { saleId: string }) =>
    wrap(() => {
      requireSession();
      return repo.getSaleDetail(saleId);
    }),
  );

  ipcMain.handle("sales:void", (_e, { saleId, reason }: { saleId: string; reason: string }) =>
    wrap(() => {
      const session = requireSession();
      repo.voidSale(session.role, saleId, reason);
      return { ok: true };
    }),
  );

  // ---------- RETURNS ----------
  ipcMain.handle("returns:create", (_e, input: Parameters<typeof repo.createReturn>[1]) =>
    wrap(() => {
      const session = requireSession();
      return repo.createReturn(session.userId, input);
    }),
  );

  // ---------- CUSTOMERS ----------
  ipcMain.handle("customers:list", () =>
    wrap(() => {
      requireSession();
      return repo.listCustomers();
    }),
  );

  ipcMain.handle("customers:create", (_e, input: Parameters<typeof repo.createCustomer>[0]) =>
    wrap(() => {
      requireSession();
      return repo.createCustomer(input);
    }),
  );

  ipcMain.handle("customers:debtors", () =>
    wrap(() => {
      requireSession();
      return repo.listDebtors();
    }),
  );

  ipcMain.handle("customers:markPayment", (_e, { saleId, amountPaid }: { saleId: string; amountPaid: number }) =>
    wrap(() => {
      const session = requireSession();
      return repo.markSalePayment(session.role, saleId, amountPaid);
    }),
  );

  // ---------- DASHBOARD / REPORTS ----------
  ipcMain.handle("dashboard:summary", () =>
    wrap(() => {
      const session = requireSession();
      return repo.getDashboardSummary(session.role, session.userId);
    }),
  );

  ipcMain.handle(
    "reports:data",
    (_e, { range, groupBy }: { range: repo.DateRange; groupBy: "day" | "month" }) =>
      wrap(() => {
        const session = requireSession();
        return repo.getReportsData(session.role, range, groupBy);
      }),
  );
}
