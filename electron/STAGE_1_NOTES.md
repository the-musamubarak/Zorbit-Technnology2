# Stage 1 — Offline database + core logic (DONE)

## What was added

- `electron/db/schema.sql` — full SQLite schema, translated from your Supabase
  migrations. Same tables, same relationships, same constraints.
- `electron/db/connection.ts` — opens (and auto-creates on first run) the
  SQLite file at a safe per-user location on the laptop
  (`app.getPath("userData")` → on Windows this is under `AppData\Roaming`).
- `electron/db/repository.ts` — this is the important one. It replicates
  **every rule your Postgres RLS policies and triggers enforced**, as plain
  functions:
  - `login()` / `createUser()` — replaces Supabase Auth entirely, with
    bcrypt-hashed passwords (never stored as plain text)
  - `createProduct()`, `createPurchase()` — admin-only, throws `ForbiddenError`
    if a staff account calls them
  - `createSale()` — checks stock and decrements it inside one atomic
    transaction (same purpose as the `FOR UPDATE` row lock your Postgres
    trigger used, just SQLite's equivalent)
  - `voidSale()` — admin-only, restores stock, logs to `stock_movements`
  - Every stock change (`purchase`, `sale`, `void`) writes an audit row,
    matching your original design exactly
  - `listProducts(role)` — strips `cost_price` for non-admins **at the data
    layer**, not just hidden in the UI — this is the important upgrade from
    "hidden button" to "actually can't get the data"

## What was intentionally left out of Stage 1

- Sale **returns** (`sale_returns`/`sale_return_items`) — the schema table
  exists, but I haven't ported the return logic yet since I hadn't seen that
  module's rules before reading your repo. Tell me the return flow you built
  (partial returns? full refund only? does it restore stock immediately?) and
  I'll port it in the next pass.
- Wiring this into the actual Electron app window and IPC bridge (Stage 2)
- Replacing the 15 files that currently call `supabase.from(...)` with calls
  into this new local repository (Stage 3)
- Packaging into a real Windows installer (Stage 4)

## What changed in your project

- `package.json` — added `better-sqlite3`, `bcryptjs`, `electron`,
  `electron-builder` as dependencies. **Run `bun install` after pulling this
  down** so these actually get installed.
- New folder: `electron/db/` (three files above)

## Nothing else was touched

Your existing `src/` folder, routes, components, and Supabase integration are
completely untouched in this stage — the app still runs exactly as it did
before if you `bun run dev`. Stage 1 only adds the new offline engine
alongside it; nothing is wired together yet. That's Stage 2 and 3.
