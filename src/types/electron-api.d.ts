export {};

import type { ApiResult } from "@/lib/local-api";

declare global {
  interface ReportsTrendPoint {
    bucket: string;
    netRevenue: number;
    netProfit: number;
  }

  interface ReportsData {
    trend: ReportsTrendPoint[];
    rows: any[];
    mostReturned: any[];
    refundBreakdown: { byReason: any[]; total: number; count: number };
    salesCount: number;
    voided: number;
    grossRevenue: number;
    refunds: number;
    returnCount: number;
    revenue: number;
    profit: number;
    top: any[];
    lowStock: any[];
    // Added alongside the reports "Sales by category" chart — see
    // electron/db/repository.ts getReportsData().
    categoryBreakdown: Array<{ category: string; revenue: number }>;
    stockValue: number;
  }

  interface Window {
    api: {
      auth: {
        login: (email: string, password: string) => Promise<any>;
        logout: () => Promise<any>;
        currentSession: () => Promise<any>;
        hasAnyUsers: () => Promise<any>;
        bootstrapFirstAdmin: (input: { fullName: string; email: string; password: string }) => Promise<any>;
      };
      users: {
        list: () => Promise<any>;
        create: (input: any) => Promise<any>;
        setRole: (userId: string, role: "admin" | "staff") => Promise<any>;
        setActive: (userId: string, isActive: boolean) => Promise<any>;
      };
      categories: {
        list: () => Promise<any>;
        create: (input: any) => Promise<any>;
        delete: (categoryId: string) => Promise<any>;
        addAttribute: (input: any) => Promise<any>;
        removeAttribute: (attributeId: string) => Promise<any>;
        seedDefaults: () => Promise<any>;
      };
      products: {
        list: () => Promise<any>;
        create: (input: any) => Promise<any>;
        update: (productId: string, input: any) => Promise<any>;
        deactivate: (productId: string) => Promise<any>;
        movements: (productId: string) => Promise<any>;
      };
      suppliers: {
        list: () => Promise<any>;
        create: (input: any) => Promise<any>;
        delete: (id: string) => Promise<any>;
      };
      purchases: {
        create: (input: any) => Promise<any>;
        list: () => Promise<any>;
      };
      sales: {
        create: (input: any) => Promise<any>;
        list: (range?: { from: string; to: string }) => Promise<any>;
        detail: (saleId: string) => Promise<any>;
        void: (saleId: string, reason: string) => Promise<any>;
      };
      returns: {
        create: (input: any) => Promise<any>;
      };
      customers: {
        list: () => Promise<any>;
        create: (input: any) => Promise<any>;
        debtors: () => Promise<any>;
        markPayment: (saleId: string, amountPaid: number) => Promise<any>;
      };
      dashboard: {
        summary: () => Promise<any>;
      };
      reports: {
        data: (range: { from: string; to: string }, groupBy: "day" | "month") => Promise<ApiResult<ReportsData>>;
      };
    };
  }
}
