const express = require("express");
const db = require("../db");
const auth = require("../auth");
const { userOut } = require("../serialize");
const { wrap, badRequest, notFound } = require("../util/http");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// Everything here is admin-only: onboarding the rest of the team (creating
// accounts) and managing them (role, active/deactivated) is an admin
// action. The very first admin account is created out-of-band by
// scripts/create-admin.js, since there is no existing identity to
// bootstrap from (see README).
router.use(requireAdmin);

router.get(
  "/",
  wrap(async (req, res) => {
    const rows = db.prepare("SELECT * FROM users ORDER BY id ASC").all();
    res.json(rows.map(userOut));
  })
);

router.post(
  "/",
  wrap(async (req, res) => {
    const { username, password, displayName, role } = req.body || {};
    if (!username || !password) throw badRequest("username and password are required.");
    if (role && !["admin", "member"].includes(role)) throw badRequest("role must be 'admin' or 'member'.");
    const existing = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    if (existing) throw badRequest("That username is already taken.");
    const passwordHash = await auth.hashPassword(password);
    const info = db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)"
      )
      .run(username, passwordHash, displayName || username, role || "member", new Date().toISOString());
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(userOut(row));
  })
);

// PATCH /api/users/:id — update role / displayName / active, and/or reset
// the password. Deactivating a user (active:false) also revokes every
// session they currently hold, so it takes effect immediately rather than
// waiting for their cookie to expire.
router.patch(
  "/:id",
  wrap(async (req, res) => {
    const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!existing) throw notFound("User not found.");
    const b = req.body || {};
    if (b.role && !["admin", "member"].includes(b.role)) throw badRequest("role must be 'admin' or 'member'.");

    const displayName = b.displayName !== undefined ? String(b.displayName) : existing.display_name;
    const role = b.role !== undefined ? b.role : existing.role;
    const active = b.active !== undefined ? (b.active ? 1 : 0) : existing.active;
    let passwordHash = existing.password_hash;
    if (b.password) passwordHash = await auth.hashPassword(b.password);

    db.prepare(
      "UPDATE users SET display_name=?, role=?, active=?, password_hash=? WHERE id=?"
    ).run(displayName, role, active, passwordHash, existing.id);

    if (!active) {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
    }

    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(existing.id);
    res.json(userOut(row));
  })
);

module.exports = router;
