import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

// Where the .db file actually lives on the laptop.
// app.getPath("userData") resolves based on app.setName() (see top of
// electron/main.ts), currently:
//   Windows: C:\Users\<name>\AppData\Roaming\Zorbit Ledger\
// This survives app updates/reinstalls as long as the user doesn't wipe AppData.
function resolveDbPath(): string {
  const dir = app.getPath("userData");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "zorbit-ledger.db");
}

function ensureSalesPaymentColumns(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(sales)").all() as Array<{ name: string }>;
  const existing = new Set(columns.map((c) => c.name));

  const migrations = [
    ["amount_paid", "REAL NOT NULL DEFAULT 0"],
    ["balance_due", "REAL NOT NULL DEFAULT 0"],
    ["payment_status", "TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid','partly_paid','unpaid'))"],
  ] as Array<[string, string]>;

  for (const [name, definition] of migrations) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE sales ADD COLUMN ${name} ${definition}`);
    existing.add(name);
  }
}

let _db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  const isFirstRun = !fs.existsSync(dbPath);

  _db = new Database(dbPath);

  // WAL mode: lets reads happen while a write is in progress — matters once
  // more than one window/process touches the file (e.g. a future second till).
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  if (isFirstRun) {
    // schema.sql lives in electron/db/ (source), but this compiled file runs
    // from electron/dist/db/ — tsc only copies .ts files, so we reach back
    // up to the source location rather than expecting a copy in dist/.
    const schemaPath = path.join(__dirname, "..", "..", "db", "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    _db.exec(schema);
  }

  ensureSalesPaymentColumns(_db);

  return _db;
}

export function closeDb(): void {
  _db?.close();
  _db = undefined;
}
