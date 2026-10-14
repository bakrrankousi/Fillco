const express = require("express");
const db = require("../db");
const auth = require("../auth");
const { wrap, badRequest, unauthorized } = require("../util/http");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /api/login — the only endpoint that doesn't require a session.
router.post(
  "/login",
  wrap(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) throw badRequest("username and password are required.");
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!user || !user.active) throw unauthorized("Invalid username or password.");
    const ok = await auth.verifyPassword(password, user.password_hash);
    if (!ok) throw unauthorized("Invalid username or password.");
    auth.sweepExpiredSessions();
    const session = auth.createSession(user.id);
    auth.setSessionCookie(res, session.id);
    res.json({ id: user.id, username: user.username, displayName: user.display_name, role: user.role });
  })
);

router.post(
  "/logout",
  requireAuth,
  wrap(async (req, res) => {
    auth.destroySession(req.sessionId);
    auth.clearSessionCookie(res);
    res.status(204).end();
  })
);

router.get(
  "/me",
  requireAuth,
  wrap(async (req, res) => {
    if (!req.user) throw unauthorized();
    res.json(req.user);
  })
);

module.exports = router;
