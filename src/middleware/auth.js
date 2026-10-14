const auth = require("../auth");
const { unauthorized, forbidden } = require("../util/http");

// Populates req.user from the session cookie, if any. Never blocks the
// request — used ahead of both public and protected routes so /api/me and
// the error branch of requireAuth can tell "no session" apart from "bad
// session" cleanly.
function attachUser(req, res, next) {
  const sessionId = auth.getSessionIdFromRequest(req);
  req.sessionId = sessionId;
  req.user = auth.getUserBySession(sessionId);
  next();
}

// All endpoints except POST /api/login require a valid session cookie.
function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== "admin") return next(forbidden("Admin access required."));
  next();
}

module.exports = { attachUser, requireAuth, requireAdmin };
