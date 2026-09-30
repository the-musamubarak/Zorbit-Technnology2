import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Truck,
  Layers,
  BarChart3,
  UserCog,
  LogOut,
  Receipt,
  Menu,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useCurrentUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";

type NavItem = { to: string; label: string; icon: typeof Package; adminOnly?: boolean };

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/sales/new", label: "New Sale", icon: ShoppingCart },
  { to: "/sales", label: "Sales", icon: Receipt },
  { to: "/products", label: "Products", icon: Package },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/purchases", label: "Purchases", icon: Truck, adminOnly: true },
  { to: "/categories", label: "Categories", icon: Layers, adminOnly: true },
  { to: "/reports", label: "Reports", icon: BarChart3, adminOnly: true },
  { to: "/users", label: "Manage Users", icon: UserCog, adminOnly: true },
];

const MOBILE_NAV = ["/dashboard", "/sales/new", "/sales", "/products", "/customers"];

function Wordmark() {
  return (
    <Link to="/dashboard" className="flex items-center gap-3 px-2">
      <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-base font-bold text-primary-foreground">
        Z
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-tight">Zorbit</span>
        <span className="block text-xs text-muted-foreground">Ledger</span>
      </span>
    </Link>
  );
}

function NavLinks({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex flex-col gap-1">
      {NAV.filter((i) => !i.adminOnly || isAdmin).map((item) => {
        const active = pathname === item.to || pathname.startsWith(item.to + "/");
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-soft"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: user } = useCurrentUser();
  const isAdmin = user?.role === "admin";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    queryClient.setQueryData(["current-user"], null);
    await window.api.auth.logout();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 lg:flex">
        <Wordmark />
        <div className="mt-7 flex-1">
          <NavLinks isAdmin={isAdmin} />
        </div>
        <div className="border-t border-sidebar-border pt-3">
          <div className="px-3 pb-2">
            <p className="truncate text-sm font-medium">{user?.fullName}</p>
            <p className="text-xs capitalize text-muted-foreground">{user?.role}</p>
          </div>
          <Button variant="ghost" className="w-full justify-start gap-3" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-4">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Wordmark />
            <div className="mt-6">
              <NavLinks isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
            </div>
            <Button variant="ghost" className="mt-4 w-full justify-start gap-3" onClick={signOut}>
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </SheetContent>
        </Sheet>
        <Wordmark />
        <span className="w-9" />
      </header>

      <main className="pb-24 lg:ml-64 lg:pb-10">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-background lg:hidden">
        {NAV.filter((i) => MOBILE_NAV.includes(i.to)).map((item) => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
