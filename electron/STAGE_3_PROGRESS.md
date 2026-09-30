# Stage 3 — Rewiring progress: 12 of 15 files done

## Fully rewired (Supabase → local API, tested logic against repository.ts)

1. `src/lib/auth.ts` — reads the local session instead of Supabase Auth
2. `src/routes/__root.tsx` — removed the Supabase auth-state listener (no
   longer needed; login/logout now explicitly manage query cache)
3. `src/routes/auth.tsx` — rewritten with a **first-run admin setup flow**.
   Judgment call made here: self-serve signup is gone. Offline, there's no
   email verification to gate it, so anyone typing in a signup form could
   make themselves an account. Now: first launch ever creates the admin
   account via a setup screen; every account after that is created
   deliberately by an admin from Manage Users.
4. `src/routes/_authenticated/route.tsx` — guard now checks the local
   session via IPC instead of `supabase.auth.getUser()`
5. `src/components/AppShell.tsx` — sign out calls `window.api.auth.logout()`
6. `src/components/ProductImage.tsx` — simplified significantly. Since
   product photos are now stored as data URLs directly in SQLite (see #11),
   there's no more async signed-URL lookup — just render the string.
7. `src/routes/_authenticated/dashboard.tsx` — now calls
   `window.api.dashboard.summary()`. I extended the backend's summary
   function (in `repository.ts`) to include recent sales and best-sellers,
   which weren't in Stage 1's version — the dashboard UI needed them and
   Stage 1 hadn't seen this file yet.
8. `src/routes/_authenticated/customers.tsx`
9. `src/routes/_authenticated/users.tsx` — reworked to match: staff accounts
   are now created directly by an admin (name, email, starting password)
   rather than the old "self-signup then admin promotes" flow, consistent
   with #3 above.
10. `src/routes/_authenticated/categories.tsx` — both the bulk "create
    category with fields" flow and the "add one field to an existing
    category" flow needed new repository functions
    (`addCategoryAttribute`/`removeCategoryAttribute`), which I added.
11. `src/routes/_authenticated/products.tsx` — image upload now converts the
    selected file to a data URL in the browser (`FileReader`) and stores
    that string directly, no upload step. Also needed a new
    `updateProduct`/`deactivateProduct` pair in the repository — Stage 1
    only had `createProduct`.
12. `src/routes/_authenticated/purchases.tsx` — needed `listSuppliers`,
    `createSupplier`, `deleteSupplier`, `listPurchases` added to the
    repository, none of which existed before this file was read.

## Backend additions made along the way (not in the original Stage 1/2 scope)

`electron/db/repository.ts` gained: `updateProduct`, `deactivateProduct`,
`listSuppliers`, `createSupplier`, `deleteSupplier`, `listPurchases`,
`addCategoryAttribute`, `removeCategoryAttribute`, and an extended
`getDashboardSummary` (recent sales, best sellers, today's profit for
admins). `electron/ipc/handlers.ts` and `electron/preload.ts` were updated to
expose all of these the same way as everything else — session-checked,
never trusting renderer-claimed roles.

## Deliberately left for the very next pass — not rushed

**`sales.new.tsx`, `sales.index.tsx`, `reports.tsx`** — these three are where
actual money changes hands (creating sales, voiding them, processing
returns, and the profit/revenue reports). They're also your three largest
remaining files (278, 420, and 379 lines) with the most business logic
per line. I'd rather get these exactly right in a focused pass than rush
them at the tail end of this one and risk a subtle bug in stock deduction or
refund math. Coming immediately next.

## A note on `src/integrations/supabase/` and `src/lib/auth.ts`'s old shape

Nothing in `src/integrations/supabase/` has been deleted yet — it's just
unused by the 12 files above now. I'd suggest leaving it in place until all
15 files are rewired and you've test-run the whole app once, then we delete
the Supabase integration folder and the `@supabase/supabase-js` dependency
entirely in a cleanup pass. No point removing it mid-stage in case something
needs a quick reference back.
