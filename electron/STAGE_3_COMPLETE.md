# Stage 3 — COMPLETE: all 15 files rewired

The remaining three — the highest-stakes ones — are done:

## `sales.new.tsx`
Straightforward swap. One meaningful change: `sold_by` is no longer read
from the client and sent up — it's attached server-side from the session
(see `electron/ipc/handlers.ts`), so there's no path for the renderer to
claim a sale was made by someone else.

## `sales.index.tsx`
This one needed a backend change: the Supabase version pulled each sale
with its items and returns nested in one query (Postgres does this
natively). SQLite doesn't do nested joins like that, so I extended
`listSales()` in the repository to batch-fetch items and returns
separately (2 extra queries total, not per-sale) and stitch them onto each
sale in the same shape the UI already expected
(`sale_items`, `sale_returns`, `sale_return_items`) — so the page's
`returnableRows()` calculation, which decides which items can still be
returned, needed almost no logic changes, just the data source swapped.

The client-side "can't return more than remaining" check in this file is
just for a fast error message — the actual enforcement happens again,
independently, inside `createReturn`'s database transaction. Two layers,
same pattern as everywhere else in this build.

## `reports.tsx`
The biggest backend extension. The Supabase version did nearly all its
number-crunching in the browser, after pulling every sale/return row for
the period. That doesn't work well against SQLite over IPC (shipping
thousands of raw rows across the process boundary just to sum them in JS
is wasteful) — so I moved the aggregation into `getReportsData()` in the
repository: sales/void counts, gross/net revenue, gross/net profit, top
sellers **net of returns** (a product returned partially still shows its
real remaining revenue, not the gross figure), low stock, stock value, and
the CSV export rows are all computed in SQL/JS on the backend now and
handed to the UI as finished numbers. The trend chart's day-vs-month
bucketing decision still happens in the component (same >62-day threshold
as before) since it's a pure UI concern, but the actual bucketed sums come
from the backend.

---

# Everything is now wired. What's left is Stage 4: packaging.

Before that, I'd genuinely recommend actually running it, since this was a
large rewrite across 15 files + significant backend additions, and the
fastest way to catch anything I got wrong is to click through it once
rather than have me guess at more edge cases from here:

```bash
bun install
bun run electron:build-main
bun run electron:dev
```

First launch will show the "Create admin account" setup screen (no users
exist yet in the fresh SQLite file). From there: create a category, add a
product, record a sale, try a return, check the dashboard and reports.

**If anything breaks or looks wrong, tell me exactly what you did and what
happened** — I'll fix it directly rather than guessing. Once you've run
through it and it holds up, we move to Stage 4: resolving the
node-server-vs-static-build decision flagged back in Stage 2, then building
the actual Windows installer.
