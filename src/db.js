// SQLite storage, via node:sqlite — Node's own built-in SQLite binding
// (single file, zero external services, and critically: zero native
// compilation step on install, since it ships inside Node itself instead of
// being a native addon node-gyp has to build from source). This project
// used to run on better-sqlite3; that required a working Python +
// C++-build-tools setup on every machine it was installed on (common to
// fail on a non-technical end user's Windows PC), so it was swapped out for
// node:sqlite, which needs nothing beyond Node.js itself. See README for the
// minimum Node version this requires.
//
// Table shapes mirror the collections found in the live claude.ai Artifact
// version of the Production Planner (orders / schedule / logs / deliverySlips /
// settings-config), plus a new `users` table that replaces Claude's org
// identity, and `sessions` for the signed-cookie login system. See the
// project README for the full field-by-field mapping and any deliberate
// differences from the original Artifact's data model.
const { DatabaseSync } = require("node:sqlite");
const config = require("./config");

const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// --- better-sqlite3-API compatibility shims -------------------------------
// The route/script code below was written against better-sqlite3's API and
// is kept as-is; these two shims make node:sqlite's (slightly stricter/
// leaner) API a drop-in match for the two behaviours it relies on:
//
// 1. Named-parameter objects with unused extra keys. better-sqlite3 silently
//    ignores any object property that isn't referenced in the SQL (e.g.
//    passing a whole row object — `{ ...existingRow, someField: x }` — to an
//    UPDATE that only names some of its columns). node:sqlite's prepared
//    statements throw "Unknown named parameter" on those by default,
//    so every statement this module hands out has that check relaxed.
const originalPrepare = db.prepare.bind(db);
db.prepare = function prepare(sql) {
  const stmt = originalPrepare(sql);
  stmt.setAllowUnknownNamedParameters(true);
  return stmt;
};

// 2. db.transaction(fn) — better-sqlite3's helper that runs fn() inside
//    BEGIN/COMMIT (rolling back on a thrown error), returns a callable
//    wrapper with .deferred()/.immediate()/.exclusive() variants picking the
//    BEGIN mode, and — the part that matters here — transparently nests:
//    calling one of these transactions while already inside another just
//    opens a SAVEPOINT instead of a new top-level transaction, so the
//    slip-numbering transaction (started with BEGIN IMMEDIATE to take the
//    write lock up front) can be — and is, in routes/deliverySlips.js —
//    invoked from inside an outer transaction without SQLite rejecting a
//    "transaction within a transaction". node:sqlite has no such helper at
//    all, so it's reimplemented here on top of plain exec() calls.
let txnDepth = 0;
let savepointCounter = 0;
function makeTransactionRunner(fn, mode) {
  return function runTransaction(...args) {
    const isNested = txnDepth > 0;
    const savepointName = `sp_${++savepointCounter}`;
    if (isNested) {
      db.exec(`SAVEPOINT ${savepointName}`);
    } else {
      db.exec(`BEGIN ${mode}`);
    }
    txnDepth++;
    try {
      const result = fn.apply(null, args);
      txnDepth--;
      if (isNested) {
        db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      } else {
        db.exec("COMMIT");
      }
      return result;
    } catch (err) {
      txnDepth--;
      try {
        if (isNested) {
          db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
          db.exec(`RELEASE SAVEPOINT ${savepointName}`);
        } else {
          db.exec("ROLLBACK");
        }
      } catch (rollbackErr) {
        // The DB connection is in a bad state if even rollback fails —
        // surface the original error, which is what callers care about.
      }
      throw err;
    }
  };
}
db.transaction = function transaction(fn) {
  const wrapper = makeTransactionRunner(fn, "DEFERRED");
  wrapper.deferred = makeTransactionRunner(fn, "DEFERRED");
  wrapper.immediate = makeTransactionRunner(fn, "IMMEDIATE");
  wrapper.exclusive = makeTransactionRunner(fn, "EXCLUSIVE");
  return wrapper;
};
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    allowed_tabs TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_id TEXT UNIQUE,
    so TEXT NOT NULL DEFAULT '',
    customer TEXT NOT NULL DEFAULT '',
    product_type TEXT NOT NULL DEFAULT '',
    gsm REAL NOT NULL DEFAULT 0,
    width REAL,
    qty_kg REAL NOT NULL DEFAULT 0,
    due_date TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'Normal',
    status TEXT NOT NULL DEFAULT 'Open',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_due ON orders(due_date);
  CREATE INDEX IF NOT EXISTS idx_orders_so ON orders(so);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

  CREATE TABLE IF NOT EXISTS schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_id TEXT UNIQUE,
    date TEXT NOT NULL DEFAULT '',
    line TEXT NOT NULL DEFAULT '',
    shift TEXT NOT NULL DEFAULT '',
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    so TEXT NOT NULL DEFAULT '',
    customer TEXT NOT NULL DEFAULT '',
    product_type TEXT NOT NULL DEFAULT '',
    gsm REAL NOT NULL DEFAULT 0,
    width REAL,
    planned_qty_kg REAL NOT NULL DEFAULT 0,
    rate_kg_h REAL NOT NULL DEFAULT 0,
    planned_hours REAL NOT NULL DEFAULT 0,
    operator TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Planned',
    notes TEXT NOT NULL DEFAULT '',
    seq INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date);
  CREATE INDEX IF NOT EXISTS idx_schedule_so ON schedule(so);
  CREATE INDEX IF NOT EXISTS idx_schedule_group ON schedule(date, line, shift);

  CREATE TABLE IF NOT EXISTS delivery_slips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_id TEXT UNIQUE,
    so TEXT NOT NULL DEFAULT '',
    customer TEXT NOT NULL DEFAULT '',
    slip_seq INTEGER,
    driver TEXT NOT NULL DEFAULT '',
    delivery_date TEXT NOT NULL DEFAULT '',
    rolls_json TEXT NOT NULL DEFAULT '[]',
    roll_count INTEGER NOT NULL DEFAULT 0,
    total_weight_loaded REAL NOT NULL DEFAULT 0,
    original_weight_loaded REAL NOT NULL DEFAULT 0,
    checked INTEGER NOT NULL DEFAULT 0,
    checked_weight REAL,
    checked_by TEXT NOT NULL DEFAULT '',
    checked_at TEXT,
    weight_diff REAL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_slips_so ON delivery_slips(so);
  CREATE INDEX IF NOT EXISTS idx_slips_date ON delivery_slips(delivery_date);

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_id TEXT UNIQUE,
    date TEXT NOT NULL DEFAULT '',
    line TEXT NOT NULL DEFAULT '',
    shift TEXT NOT NULL DEFAULT '',
    schedule_id INTEGER REFERENCES schedule(id) ON DELETE SET NULL,
    so TEXT NOT NULL DEFAULT '',
    product_type TEXT NOT NULL DEFAULT '',
    gsm REAL NOT NULL DEFAULT 0,
    width REAL,
    actual_qty_kg REAL NOT NULL DEFAULT 0,
    actual_hours REAL NOT NULL DEFAULT 0,
    start_time TEXT NOT NULL DEFAULT '',
    end_time TEXT NOT NULL DEFAULT '',
    stoppage_minutes REAL NOT NULL DEFAULT 0,
    stoppage_category TEXT NOT NULL DEFAULT '',
    operator TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    logged_at TEXT NOT NULL,
    quality_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(date);
  CREATE INDEX IF NOT EXISTS idx_logs_so ON logs(so);
  CREATE INDEX IF NOT EXISTS idx_logs_schedule ON logs(schedule_id);
  CREATE INDEX IF NOT EXISTS idx_logs_group ON logs(date, line, shift);

  CREATE TABLE IF NOT EXISTS rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_id TEXT UNIQUE,
    log_id INTEGER NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL DEFAULT 0,
    weight_kg REAL NOT NULL DEFAULT 0,
    checked INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT,
    checked_by TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    loaded INTEGER NOT NULL DEFAULT 0,
    loaded_at TEXT,
    driver TEXT,
    delivery_date TEXT,
    slip_id INTEGER REFERENCES delivery_slips(id) ON DELETE SET NULL,
    weight_edited_by TEXT,
    weight_edited_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_rolls_log ON rolls(log_id);
  CREATE INDEX IF NOT EXISTS idx_rolls_slip ON rolls(slip_id);

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    rates_json TEXT NOT NULL,
    changeover_min INTEGER NOT NULL DEFAULT 45,
    lines_json TEXT NOT NULL,
    restricted_viewers_json TEXT NOT NULL DEFAULT '[]',
    next_slip_seq INTEGER NOT NULL DEFAULT 1
  );
`);

// --- In-place migrations for databases created by an older version --------
// CREATE TABLE IF NOT EXISTS above never alters a table that already exists,
// so any column added after the first release has to be added here, by
// checking what the existing table actually has. Each step is idempotent
// (safe to run on every startup) and only ever ADDs a nullable column, so
// existing rows and data are left exactly as they were.
function columnNames(table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
}
function addColumnIfMissing(table, column, definition) {
  if (columnNames(table).has(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[db] Migrated: added ${table}.${column}`);
  return true;
}

// users.allowed_tabs — per-user tab access set by an admin (JSON text array
// of tab ids). NULL = every tab, which is what all pre-existing accounts get,
// so nobody's access changes on upgrade. See src/tabs.js.
addColumnIfMissing("users", "allowed_tabs", "TEXT");
// ---------------------------------------------------------------------------

// Seed the single settings row, matching the original app's DEFAULT_RATES /
// changeoverMin(45) / LINES(["Line 1","Line 2"]) fallbacks, if it doesn't exist yet.
const DEFAULT_RATES = {
  "R|100|200": 180, "R|100|210": 187, "R|100|220": 192, "R|100|250": 199,
  "R|200|150": 327, "R|200|200": 349, "R|200|210": 374,
  "R|250|215": 326, "R|300|210": 366,
  "R|100": 185, "R|200": 355, "R|250": 326, "R|300": 366,
  "RS|150": 150, "RS|200": 260,
  "HS|300|245": 335, "HS|300|250": 300, "HS|300": 330, "HS|250": 300,
  "VS|400|210": 319, "VS|400|250": 329, "VS|400|260": 321, "VS|400": 325,
  "VS|600|215": 328, "VS|600": 328, "VS|800|215": 280, "VS|800": 300,
  "M|150": 140, "MX|150": 150, "MV|200": 220,
  "F|150": 120, "RP|350|210": 333, "RP|350": 333, "V|150": 85, "SOLID|300": 110,
};
const DEFAULT_LINES = ["Line 1", "Line 2"];

const settingsExists = db.prepare("SELECT 1 FROM settings WHERE id = 1").get();
if (!settingsExists) {
  db.prepare(
    `INSERT INTO settings (id, rates_json, changeover_min, lines_json, restricted_viewers_json, next_slip_seq)
     VALUES (1, ?, 45, ?, '[]', 1)`
  ).run(JSON.stringify(DEFAULT_RATES), JSON.stringify(DEFAULT_LINES));
}

module.exports = db;
