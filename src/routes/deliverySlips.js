const express = require("express");
const db = require("../db");
const { slipOut } = require("../serialize");
const { wrap, notFound, badRequest } = require("../util/http");

const router = express.Router();

// Claims the next sequential delivery-slip number from settings.next_slip_seq
// and advances it, inside one SQLite transaction started with BEGIN
// IMMEDIATE — this is the real-relational-database replacement for the
// original Artifact's cooperative acquire()-lease workaround (its own db
// capability had no transactions at all). BEGIN IMMEDIATE takes the SQLite
// write lock for the whole read-increment-write, so two requests claiming a
// number at the same moment are serialized and can never land on the same
// value.
const claimSeqTxn = db.transaction(() => {
  const row = db.prepare("SELECT next_slip_seq FROM settings WHERE id = 1").get();
  const cur = Math.max(1, Number(row && row.next_slip_seq) || 1);
  db.prepare("UPDATE settings SET next_slip_seq = ? WHERE id = 1").run(cur + 1);
  return cur;
});

function claimNextSlipSeq() {
  return claimSeqTxn.immediate();
}

// Dedicated endpoint for claiming a slip number, in case the next frontend
// phase wants to show it before the slip is actually saved, and so this can
// be exercised directly (see README / manual test sequence).
router.post(
  "/claim-slip-number",
  wrap(async (req, res) => {
    const slipSeq = claimNextSlipSeq();
    res.json({ slipSeq });
  })
);

// GET /api/delivery-slips?so=&date=&checked=
router.get(
  "/",
  wrap(async (req, res) => {
    const { so, date, checked } = req.query;
    const limit = Math.min(Number(req.query.limit) || 200, 2000);
    const clauses = [];
    const params = [];
    if (so) { clauses.push("so = ?"); params.push(String(so)); }
    if (date) { clauses.push("delivery_date = ?"); params.push(date); }
    if (checked !== undefined) { clauses.push("checked = ?"); params.push(checked === "true" || checked === "1" ? 1 : 0); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM delivery_slips ${where} ORDER BY delivery_date DESC, id DESC LIMIT ?`)
      .all(...params, limit);
    res.json(rows.map(slipOut));
  })
);

router.get(
  "/:id",
  wrap(async (req, res) => {
    const row = db.prepare("SELECT * FROM delivery_slips WHERE id = ?").get(req.params.id);
    if (!row) throw notFound("Delivery slip not found.");
    res.json(slipOut(row));
  })
);

// POST /api/delivery-slips
// body: { so, customer, driver, deliveryDate, rolls: [{ logId, rollId }, ...] }
// Looks up each named roll (must be checked and not already loaded),
// denormalizes product/GSM/width onto the slip's roll snapshot (same as the
// original app, so the slip keeps showing the right item even if the
// source log later changes), claims the next sequential slip number, and
// marks the source rolls loaded — all in one transaction.
router.post(
  "/",
  wrap(async (req, res) => {
    const b = req.body || {};
    const wanted = Array.isArray(b.rolls) ? b.rolls : [];
    if (!wanted.length) throw badRequest("At least one roll is required to generate a delivery slip.");

    const result = db.transaction(() => {
      const rollRows = wanted.map((w) => {
        const roll = db.prepare("SELECT * FROM rolls WHERE id = ? AND log_id = ?").get(w.rollId, w.logId);
        if (!roll) throw badRequest(`Roll ${w.rollId} on log ${w.logId} not found.`);
        if (roll.loaded) throw badRequest(`Roll ${roll.id} has already been loaded on another slip.`);
        return roll;
      });
      const logCache = new Map();
      function getLog(logId) {
        if (!logCache.has(logId)) logCache.set(logId, db.prepare("SELECT * FROM logs WHERE id = ?").get(logId));
        return logCache.get(logId);
      }

      const slipSeq = claimNextSlipSeq();
      const now = new Date().toISOString();
      const snapshotRolls = rollRows.map((roll) => {
        const log = getLog(roll.log_id);
        return {
          logId: roll.log_id,
          rollId: roll.id,
          seq: roll.seq,
          weightKg: roll.weight_kg,
          productType: (log && log.product_type) || "",
          gsm: (log && log.gsm) || null,
          width: (log && log.width) || null,
        };
      });
      const totalWeight = snapshotRolls.reduce((a, r) => a + (Number(r.weightKg) || 0), 0);

      const info = db
        .prepare(
          `INSERT INTO delivery_slips
             (so, customer, slip_seq, driver, delivery_date, rolls_json, roll_count, total_weight_loaded,
              original_weight_loaded, checked, checked_weight, checked_by, checked_at, weight_diff, created_at, created_by)
           VALUES (@so, @customer, @slip_seq, @driver, @delivery_date, @rolls_json, @roll_count, @total_weight_loaded,
              @original_weight_loaded, 0, NULL, '', NULL, NULL, @created_at, @created_by)`
        )
        .run({
          so: String(b.so || ""),
          customer: String(b.customer || ""),
          slip_seq: slipSeq,
          driver: String(b.driver || "—"),
          delivery_date: String(b.deliveryDate || ""),
          rolls_json: JSON.stringify(snapshotRolls),
          roll_count: snapshotRolls.length,
          total_weight_loaded: totalWeight,
          original_weight_loaded: totalWeight,
          created_at: now,
          created_by: String(b.createdBy || ""),
        });
      const slipId = info.lastInsertRowid;

      const markLoaded = db.prepare(
        "UPDATE rolls SET loaded = 1, loaded_at = ?, driver = ?, delivery_date = ?, slip_id = ? WHERE id = ?"
      );
      rollRows.forEach((roll) => {
        markLoaded.run(now, String(b.driver || "—"), String(b.deliveryDate || ""), slipId, roll.id);
      });

      return db.prepare("SELECT * FROM delivery_slips WHERE id = ?").get(slipId);
    })();

    res.status(201).json(slipOut(result));
  })
);

// PUT /api/delivery-slips/:id — edit driver/date, or run the "check" review
// (checked / checkedWeight), which redistributes any weight correction
// across the slip's own roll snapshot and the underlying roll rows
// proportionally, same as the original app's distributeWeightCorrection.
router.put(
  "/:id",
  wrap(async (req, res) => {
    const existing = db.prepare("SELECT * FROM delivery_slips WHERE id = ?").get(req.params.id);
    if (!existing) throw notFound("Delivery slip not found.");
    const b = req.body || {};

    db.transaction(() => {
      let rollsJson = existing.rolls_json;
      let totalWeightLoaded = existing.total_weight_loaded;
      let originalWeightLoaded = existing.original_weight_loaded;
      let checkedWeight = existing.checked_weight;
      let checked = existing.checked;
      let checkedBy = existing.checked_by;
      let checkedAt = existing.checked_at;
      let weightDiff = existing.weight_diff;

      if (b.checked === true) {
        const newCheckedWeight = Number(b.checkedWeight) || 0;
        const diff = Math.round((newCheckedWeight - existing.original_weight_loaded) * 100) / 100;
        const rolls = JSON.parse(existing.rolls_json || "[]");
        const currentSum = rolls.reduce((a, r) => a + (Number(r.weightKg) || 0), 0);
        let updatedRolls = rolls;
        if (Math.abs(newCheckedWeight - currentSum) > 0.005 && rolls.length) {
          const factor = currentSum > 0 ? newCheckedWeight / currentSum : 0;
          let running = 0;
          updatedRolls = rolls.map((r, i) => {
            if (i === rolls.length - 1) {
              // last roll absorbs the rounding remainder so the sum matches exactly
              const w = Math.round((newCheckedWeight - running) * 100) / 100;
              return { ...r, weightKg: w };
            }
            const w = Math.round((Number(r.weightKg) || 0) * factor * 100) / 100;
            running += w;
            return { ...r, weightKg: w };
          });
        }
        rollsJson = JSON.stringify(updatedRolls);
        totalWeightLoaded = newCheckedWeight;
        checkedWeight = newCheckedWeight;
        checked = 1;
        checkedBy = String(b.checkedBy || "");
        checkedAt = new Date().toISOString();
        weightDiff = diff;

        // propagate corrected per-roll weights back onto the underlying roll rows
        const updateRollWeight = db.prepare("UPDATE rolls SET weight_kg = ? WHERE id = ?");
        updatedRolls.forEach((r) => updateRollWeight.run(r.weightKg, r.rollId));
      }

      const driver = b.driver !== undefined ? String(b.driver) : existing.driver;
      const deliveryDate = b.deliveryDate !== undefined ? String(b.deliveryDate) : existing.delivery_date;

      if (b.driver !== undefined || b.deliveryDate !== undefined) {
        db.prepare("UPDATE rolls SET driver = ?, delivery_date = ? WHERE slip_id = ?").run(driver, deliveryDate, existing.id);
      }

      db.prepare(
        `UPDATE delivery_slips SET driver=?, delivery_date=?, rolls_json=?, total_weight_loaded=?, original_weight_loaded=?,
           checked=?, checked_weight=?, checked_by=?, checked_at=?, weight_diff=?
         WHERE id=?`
      ).run(driver, deliveryDate, rollsJson, totalWeightLoaded, originalWeightLoaded, checked, checkedWeight, checkedBy, checkedAt, weightDiff, existing.id);
    })();

    const row = db.prepare("SELECT * FROM delivery_slips WHERE id = ?").get(existing.id);
    res.json(slipOut(row));
  })
);

// DELETE /api/delivery-slips/:id — frees up its rolls so they can be loaded
// again / put on a new slip (clears loaded/driver/date/slip on each one).
router.delete(
  "/:id",
  wrap(async (req, res) => {
    const existing = db.prepare("SELECT * FROM delivery_slips WHERE id = ?").get(req.params.id);
    if (!existing) throw notFound("Delivery slip not found.");
    db.transaction(() => {
      db.prepare(
        "UPDATE rolls SET loaded = 0, loaded_at = NULL, driver = NULL, delivery_date = NULL, slip_id = NULL WHERE slip_id = ?"
      ).run(existing.id);
      db.prepare("DELETE FROM delivery_slips WHERE id = ?").run(existing.id);
    })();
    res.status(204).end();
  })
);

module.exports = router;
