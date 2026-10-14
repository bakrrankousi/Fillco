// Central config loader.
//
// Settings (port, dbPath) come from config.json at the repo root, with
// sane defaults so the app runs with zero configuration. Either value can
// be overridden with environment variables (PORT, DB_PATH) for people who
// prefer that to editing a file.
//
// The session-signing secret is NOT part of config.json (that file is meant
// to be readable/committable). It is generated once on first run with a
// cryptographically random value and persisted to data/session-secret.key,
// which is gitignored (see .gitignore -> data/). Every later run reads the
// same file so existing login sessions keep working across restarts.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

function loadFileConfig() {
  const configPath = path.join(ROOT, "config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

const fileConfig = loadFileConfig();

const port = Number(process.env.PORT || fileConfig.port || 3000);
const dbPathRaw = process.env.DB_PATH || fileConfig.dbPath || "./data/fillco.db";
const dbPath = path.isAbsolute(dbPathRaw) ? dbPathRaw : path.join(ROOT, dbPathRaw);

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function loadOrCreateSessionSecret() {
  const secretPath = path.join(ROOT, "data", "session-secret.key");
  ensureDir(secretPath);
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing) return existing;
  } catch (e) {
    // file doesn't exist yet — fall through and create it
  }
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

ensureDir(dbPath);

module.exports = {
  root: ROOT,
  port,
  dbPath,
  sessionSecret: loadOrCreateSessionSecret(),
  publicDir: path.join(ROOT, "public"),
  // 30 days, in milliseconds — matches the README's "trusted LAN app" expiry.
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
};
