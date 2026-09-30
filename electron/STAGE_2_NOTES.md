# Stage 2 — Electron shell + secure IPC bridge (DONE)

## What was added

- `electron/session.ts` — tracks the logged-in user **in the main process**,
  not the renderer. This is the core of "secure" here: your React UI never
  gets to declare its own role. It calls `api.auth.login(...)`, and from
  then on every permission check happens against this server-side session,
  not anything the page sends.
- `electron/preload.ts` — the *only* thing the renderer can touch. Uses
  `contextBridge` to expose a narrow `window.api.*` surface (auth, products,
  sales, etc.) — no raw `ipcRenderer`, no `require`, no filesystem access
  reaches the page itself.
- `electron/ipc/handlers.ts` — every IPC channel your UI will call, each one
  pulling the acting user from the session (never from renderer input) before
  calling into `repository.ts`. Two layers check permissions independently
  (session here + `requireAdmin` in repository.ts) so one bug doesn't become
  a bypass.
- `electron/main.ts` — creates the window with:
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` —
    standard Electron hardening, closes the most common "renderer executes
    arbitrary Node code" attack path
  - a network lockdown: `session.defaultSession.webRequest.onBeforeRequest`
    blocks anything that isn't `file://`, `localhost`, or `data:` — since
    this app should never need the internet, if something tries to reach out
    it's worth blocking outright rather than silently allowing
  - single-instance lock, so the app can't accidentally get opened twice and
    have two processes fighting over the same SQLite file

## The one open decision (flagged, not yet resolved)

Your project builds via TanStack Start's Nitro bundler, currently targeting
**Cloudflare** (see the comment at the top of `vite.config.ts`). That's not
directly loadable by Electron as a static file or a simple local server.

There are two ways this resolves, and I don't want to guess which one fits
better until Stage 3 is further along:

1. **Add a "node-server" Nitro build target** just for the offline build,
   spawn it as a local background process on `localhost`, and have Electron
   load that URL — keeps SSR working if any page actually depends on it.
2. **Switch to a plain static SPA build** for the offline version — simpler,
   loads via `file://` directly, no local server process needed at all. This
   only works if none of your routes actually depend on server-side
   rendering/loaders for correctness (and from what I've seen so far, most of
   your data comes from direct client-side Supabase calls, which suggests
   this is likely fine — but I want to confirm once Stage 3 replaces those
   calls with `window.api.*` calls).

**For now**, `main.ts` has a placeholder for production loading — it is not
functional yet, and that's expected at this stage. Dev mode works today,
see below.

## How to actually run this right now

This stage is testable on its own, before Stage 3 touches your UI:

```bash
bun install
bun run electron:build-main   # compiles electron/*.ts -> electron/dist/*.js
bun run electron:dev          # starts Vite dev server + opens the Electron window pointed at it
```

At this point, the Electron window will open and load your existing app
(still talking to Supabase, since Stage 3 hasn't rewired anything yet) — but
`window.api` will be available in the browser devtools console inside that
window, so you can sanity-check it directly, e.g.:

```js
await window.api.auth.hasAnyUsers()
// -> { ok: true, data: false }   (first run, no users yet)

await window.api.auth.bootstrapFirstAdmin({
  fullName: "Muhammad",
  email: "admin@shop.local",
  password: "<your-admin-password>"
})
// -> { ok: true, data: { id, fullName, email, role: 'admin' } }

await window.api.products.list()
// -> { ok: true, data: [] }   (empty SQLite db, separate from your Supabase data)
```

This is a good way to confirm the whole IPC → repository → SQLite chain
works before Stage 3 rewires 15 files to actually depend on it.

---

# What's next — Stage 3

Replace every `supabase.from(...)` / `supabase.auth...` call across the 15
files with the matching `window.api.*` call. I'll go file by file — auth
first (since everything else depends on knowing who's logged in), then
products/categories, then purchases/sales/returns, then customers/reports.

Want me to start with `src/lib/auth.ts` and the login route now, or do you
want to test the Stage 2 IPC bridge yourself first with the console commands
above before I keep building on top of it?
