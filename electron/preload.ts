import { contextBridge, ipcRenderer } from "electron";

// This file runs in a privileged context but exposes only what's listed
// below to the renderer (your React app). The renderer itself runs with
// contextIsolation + sandbox on and nodeIntegration off (see main.ts), so it
// has zero direct access to Node, the filesystem, or ipcRenderer — it can
// ONLY call window.api.* as defined here. That's the actual security
// boundary: even if a malicious script somehow ran inside the page, it
// cannot reach the database directly, only through these specific channels.

function invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>;
}

const api = {
  auth: {
    login: (email: string, password: string) => invoke("auth:login", { email, password }),
    logout: () => invoke("auth:logout"),
    currentSession: () => invoke("auth:currentSession"),
    hasAnyUsers: () => invoke("auth:hasAnyUsers"),
    bootstrapFirstAdmin: (input: { fullName: string; email: string; password: string }) =>
      invoke("auth:bootstrapFirstAdmin", input),
  },
  users: {
    list: () => invoke("users:list"),
    create: (input: { fullName: string; email: string; password: string; role: "admin" | "staff" }) =>
      invoke("users:create", input),
    setRole: (userId: string, role: "admin" | "staff") => invoke("users:setRole", { userId, role }),
    setActive: (userId: string, isActive: boolean) => invoke("users:setActive", { userId, isActive }),
  },
  categories: {
    list: () => invoke("categories:list"),
    create: (input: unknown) => invoke("categories:create", input),
    delete: (categoryId: string) => invoke("categories:delete", { categoryId }),
    addAttribute: (input: unknown) => invoke("categories:addAttribute", input),
    removeAttribute: (attributeId: string) => invoke("categories:removeAttribute", { attributeId }),
    seedDefaults: () => invoke("categories:seedDefaults"),
  },
  products: {
    list: () => invoke("products:list"),
    create: (input: unknown) => invoke("products:create", input),
    update: (productId: string, input: unknown) => invoke("products:update", { productId, input }),
    deactivate: (productId: string) => invoke("products:deactivate", { productId }),
    movements: (productId: string) => invoke("products:movements", { productId }),
  },
  suppliers: {
    list: () => invoke("suppliers:list"),
    create: (input: unknown) => invoke("suppliers:create", input),
    delete: (id: string) => invoke("suppliers:delete", { id }),
  },
  purchases: {
    create: (input: unknown) => invoke("purchases:create", input),
    list: () => invoke("purchases:list"),
  },
  sales: {
    create: (input: unknown) => invoke("sales:create", input),
    list: (range?: { from: string; to: string }) => invoke("sales:list", range),
    detail: (saleId: string) => invoke("sales:detail", { saleId }),
    void: (saleId: string, reason: string) => invoke("sales:void", { saleId, reason }),
  },
  returns: {
    create: (input: unknown) => invoke("returns:create", input),
  },
  customers: {
    list: () => invoke("customers:list"),
    create: (input: unknown) => invoke("customers:create", input),
    debtors: () => invoke("customers:debtors"),
    markPayment: (saleId: string, amountPaid: number) => invoke("customers:markPayment", { saleId, amountPaid }),
  },
  dashboard: {
    summary: () => invoke("dashboard:summary"),
  },
  reports: {
    data: (range: { from: string; to: string }, groupBy: "day" | "month") =>
      invoke("reports:data", { range, groupBy }),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type ElectronApi = typeof api;
