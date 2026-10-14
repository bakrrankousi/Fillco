// Auth: bcrypt password hashing + session-cookie helpers.
//
// Sessions are stored server-side (a `sessions` row per login) so that
// logging out, or an admin deactivating a user, actually revokes access
// instead of relying only on a client-side cookie expiring on its own. The
// cookie itself just holds that session's random id, signed (HMAC, via
// cookie-parser's `signed` cookies) with the secret generated in config.js —
// so it can't be forged, but it carries no sensitive data of its own. This
// works fine from a plain HTTP-only cookie inside both an Electron webview
// and a Capacitor (Android) webview — no client-side token handling needed.
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const db = require("./db");
const config = require("./config");
const { effectiveAllowedTabs } = require("./tabs");

const COOKIE_NAME = "fillco_session";
const BCRYPT_ROUNDS = 12;

function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function createSession(userId) {
  const id = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionTtlMs);
  db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(id, userId, now.toISOString(), expires.toISOString());
  return { id, expiresAt: expires };
}

function destroySession(sessionId) {
  if (!sessionId) return;
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

// Deletes every expired session row. Cheap enough to run on each login;
// keeps the sessions table from growing forever on a server nobody reboots.
function sweepExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
}

function getUserBySession(sessionId) {
  if (!sessionId) return null;
  const row = db
    .prepare(
      `SELECT s.id as session_id, s.expires_at, u.id, u.username, u.display_name, u.role, u.active, u.allowed_tabs
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .get(sessionId);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    destroySession(sessionId);
    return null;
  }
  if (!row.active) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    allowedTabs: effectiveAllowedTabs(row.role, row.allowed_tabs),
  };
}

function setSessionCookie(res, sessionId) {
  res.cookie(COOKIE_NAME, sessionId, {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    maxAge: config.sessionTtlMs,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

function getSessionIdFromRequest(req) {
  return (req.signedCookies && req.signedCookies[COOKIE_NAME]) || null;
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  sweepExpiredSessions,
  getUserBySession,
  setSessionCookie,
  clearSessionCookie,
  getSessionIdFromRequest,
};
