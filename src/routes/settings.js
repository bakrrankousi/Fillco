const express = require("express");
const db = require("../db");
const { settingsOut } = require("../serialize");
const { wrap } = require("../util/http");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/settings — readable by any signed-in user (needed to render
// rate benchmarks, lines, changeover minutes everywhere in the app).
router.get(
  "/",
  wrap(async (req, res) => {
    const row = db.prepare("SELECT * FROM settings WHERE id = 1").get();
    res.json(settingsOut(row));
  })
);

// PUT /api/settings — admin-only. Accepts a partial patch of
// { rates, changeoverMin, lines, restrictedViewers }; nextSlipSeq is
// deliberately not settable here (it only ever changes through
// claimNextSlipSeq, same reasoning as the original app kept it out of
// state.settings: a settings save must never clobber a concurrent slip
// number claim with a stale cached value).
router.put(
  "/",
  requireAdmin,
  wrap(async (req, res) => {
    const existing = db.prepare("SELECT * FROM settings WHERE id = 1").get();
    const b = req.body || {};
    const rates = b.rates !== undefined ? b.rates : JSON.parse(existing.rates_json);
    const lines = b.lines !== undefined && Array.isArray(b.lines) && b.lines.length ? b.lines : JSON.parse(existing.lines_json);
    const changeoverMin = b.changeoverMin !== undefined ? Number(b.changeoverMin) || 45 : existing.changeover_min;
    const restrictedViewers = b.restrictedViewers !== undefined ? b.restrictedViewers : JSON.parse(existing.restricted_viewers_json || "[]");
    db.prepare(
      "UPDATE settings SET rates_json=?, changeover_min=?, lines_json=?, restricted_viewers_json=? WHERE id=1"
    ).run(JSON.stringify(rates), changeoverMin, JSON.stringify(lines), JSON.stringify(restrictedViewers));
    const row = db.prepare("SELECT * FROM settings WHERE id = 1").get();
    res.json(settingsOut(row));
  })
);

module.exports = router;
