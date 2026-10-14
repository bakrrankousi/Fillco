const express = require("express");
const db = require("../db");
const { logOut, rollOut } = require("../serialize");
const { wrap, notFound, badRequest } = require("../util/http");

const router = express.Router();

function toRow(body, existing) {
  const b = body || {};
  return {
    date: b.date !== undefined ? String(b.date) : existing ? existing.date : "",
    line: b.line !== undefined ? String(b.line) : existing ? existing.line : "",
    shift: b.shift !== undefined ? String(b.shift) : existing ? existing.shift : "",
    schedule_id: b.scheduleId !== undefined ? (b.scheduleId === null || b.scheduleId === "" ? null : Number(b.scheduleId)) : existing ? existing.schedule_id : null,
    so: b.so !== undefined ? String(b.so) : existing ? existing.so : "",
    product_type: b.productType !== undefined ? String(b.productType) : existing ? existing.product_type : "",
    gsm: b.gsm !== undefined ? Number(b.gsm) || 0 : existing ? existing.gsm : 0,
    width: b.width !== undefined ? (b.width === null || b.width === "" ? null : Number(b.width)) : existing ? existing.width : null,
    actual_qty_kg: b.actualQtyKg !== undefined ? Number(b.actualQtyKg) || 0 : existing ? existing.actual_qty_kg : 0,
    actual_hours: b.actualHours !== undefined ? Number(b.actualHours) || 0 : existing ? existing.actual_hours : 0,
    start_time: b.startTime !== undefined ? String(b.startTime) : existing ? existing.start_time : "",
    end_time: b.endTime !== undefined ? String(b.endTime) : existing ? existing.end_time : "",
    stoppage_minutes: b.stoppageMinutes !== undefined ? Number(b.stoppageMinutes) || 0 : existing ? existing.stoppage_minutes : 0,
    stoppage_category: b.stoppageCategory !== undefined ? String(b.stoppageCategory) : existing ? existing.stoppage_category : "",
    operator: b.operator !== undefined ? String(b.operator) : existing ? existing.operator : "",
    notes: b.notes !== undefined ? String(b.notes) : existing ? existing.notes : "",
    quality_json: b.quality !== undefined ? (b.quality ? JSON.stringify(b.quality) : null) : existing ? existing.quality_json : null,
  };
}

const insertRollStmt = db.prepare(
  `INSERT INTO rolls (log_id, seq, weight_kg, checked, checked_at, checked_by, note, loaded, loaded_at, driver, delivery_date, slip_id, weight_edited_by, weight_edited_at)
   VALUES (@log_id, @seq, @weight_kg, @checked, @checked_at, @checked_by, @note, @loaded, @loaded_at, @driver, @delivery_date, @slip_id, @weight_edited_by, @weight_edited_at)`
);
const updateRollStmt = db.prepare(
  `UPDATE rolls SET seq=@seq, weight_kg=@weight_kg, checked=@checked, checked_at=@checked_at, checked_by=@checked_by,
     note=@note, loaded=@loaded, loaded_at=@loaded_at, driver=@driver, delivery_date=@delivery_date,
     slip_id=@slip_id, weight_edited_by=@weight_edited_by, weight_edited_at=@weight_edited_at
   WHERE id=@id AND log_id=@log_id`
);

function rollRowFromInput(r, logId, index) {
  return {
    log_id: logId,
    seq: r.seq !== undefined && r.seq !== null ? Number(r.seq) : index + 1,
    weight_kg: Number(r.weightKg) || 0,
    checked: r.checked ? 1 : 0,
    checked_at: r.checkedAt || null,
    checked_by: r.checkedBy || "",
    note: r.note || "",
    loaded: r.loaded ? 1 : 0,
    loaded_at: r.loadedAt || null,
    driver: r.driver || null,
    delivery_date: r.deliveryDate || null,
    slip_id: r.slipId || null,
    weight_edited_by: r.weightEditedBy || null,
    weight_edited_at: r.weightEditedAt || null,
  };
}

// Full upsert of a log's rolls from a client-supplied array — mirrors the
// original app's behaviour of rewriting the whole `rolls` array on the log
// doc. A roll object carrying an `id` that still exists on this log is
// updated in place (preserving that id, which delivery slips may reference
// by rollId); anything else is inserted new; any existing roll row not
// present in the incoming array is removed (the "✕ remove roll" action).
function replaceRolls(logId, rollsInput) {
  const existingIds = new Set(db.prepare("SELECT id FROM rolls WHERE log_id = ?").all(logId).map((r) => r.id));
  const keepIds = new Set();
  (rollsInput || []).forEach((r, i) => {
    const row = rollRowFromInput(r, logId, i);
    if (r.id != null && existingIds.has(Number(r.id))) {
      updateRollStmt.run({ ...row, id: Number(r.id) });
      keepIds.add(Number(r.id));
    } else {
      const info = insertRollStmt.run(row);
      keepIds.add(info.lastInsertRowid);
    }
  });
  const toRemove = [...existingIds].filter((id) => !keepIds.has(id));
  if (toRemove.length) {
    const stmt = db.prepare(`DELETE FROM rolls WHERE id = ?`);
    toRemove.forEach((id) => stmt.run(id));
  }
}

// GET /api/logs?date=&dateFrom=&dateTo=&line=&shift=&so=&scheduleId=&limit=
router.get(
  "/",
  wrap(async (req, res) => {
    const { date, dateFrom, dateTo, line, shift, so, scheduleId } = req.query;
    const limit = Math.min(Number(req.query.limit) || 300, 5000);
    const clauses = [];
    const params = [];
    if (date) { clauses.push("date = ?"); params.push(date); }
    if (dateFrom) { clauses.push("date >= ?"); params.push(dateFrom); }
    if (dateTo) { clauses.push("date <= ?"); params.push(dateTo); }
    if (line) { clauses.push("line = ?"); params.push(line); }
    if (shift) { clauses.push("shift = ?"); params.push(shift); }
    if (so) { clauses.push("so = ?"); params.push(String(so)); }
    if (scheduleId) { clauses.push("schedule_id = ?"); params.push(Number(scheduleId)); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM logs ${where} ORDER BY date DESC, id DESC LIMIT ?`)
      .all(...params, limit);
    res.json(rows.map(logOut));
  })
);

router.get(
  "/:id",
  wrap(async (req, res) => {
    const row = db.prepare("SELECT * FROM logs WHERE id = ?").get(req.params.id);
    if (!row) throw notFound("Log entry not found.");
    res.json(logOut(row));
  })
);

router.post(
  "/",
  wrap(async (req, res) => {
    const data = toRow(req.body, null);
    const loggedAt = req.body && req.body.loggedAt ? String(req.body.loggedAt) : new Date().toISOString();
    const rolls = (req.body && req.body.rolls) || [];
    const id = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO logs (date, line, shift, schedule_id, so, product_type, gsm, width, actual_qty_kg, actual_hours,
             start_time, end_time, stoppage_minutes, stoppage_category, operator, notes, logged_at, quality_json)
           VALUES (@date, @line, @shift, @schedule_id, @so, @product_type, @gsm, @width, @actual_qty_kg, @actual_hours,
             @start_time, @end_time, @stoppage_minutes, @stoppage_category, @operator, @notes, @logged_at, @quality_json)`
        )
        .run({ ...data, logged_at: loggedAt });
      replaceRolls(info.lastInsertRowid, rolls);
      return info.lastInsertRowid;
    })();
    const row = db.prepare("SELECT * FROM logs WHERE id = ?").get(id);
    res.status(201).json(logOut(row));
  })
);

router.put(
  "/:id",
  wrap(async (req, res) => {
    const existing = db.prepare("SELECT * FROM logs WHERE id = ?").get(req.params.id);
    if (!existing) throw notFound("Log entry not found.");
    const data = toRow(req.body, existing);
    const hasRolls = req.body && Object.prototype.hasOwnProperty.call(req.body, "rolls");
    db.transaction(() => {
      db.prepare(
        `UPDATE logs SET date=@date, line=@line, shift=@shift, schedule_id=@schedule_id, so=@so, product_type=@product_type,
           gsm=@gsm, width=@width, actual_qty_kg=@actual_qty_kg, actual_hours=@actual_hours, start_time=@start_time,
           end_time=@end_time, stoppage_minutes=@stoppage_minutes, stoppage_category=@stoppage_category,
           operator=@operator, notes=@notes, quality_json=@quality_json
         WHERE id=@id`
      ).run({ ...data, id: existing.id });
      if (hasRolls) replaceRolls(existing.id, req.body.rolls);
    })();
    const row = db.prepare("SELECT * FROM logs WHERE id = ?").get(existing.id);
    res.json(logOut(row));
  })
);

router.delete(
  "/:id",
  wrap(async (req, res) => {
    const info = db.prepare("DELETE FROM logs WHERE id = ?").run(req.params.id);
    if (!info.changes) throw notFound("Log entry not found.");
    res.status(204).end();
  })
);

// PATCH /api/logs/:logId/rolls/:rollId — update one roll in place (the
// Loading tab's per-roll checkbox/weight/note edits), without resending the
// whole log. Mirrors the original app's persistRoll()/weight-edit flow,
// including propagating a weight correction to the delivery slip that
// already carries this roll, if any and if that slip isn't checked yet.
router.patch(
  "/:logId/rolls/:rollId",
  wrap(async (req, res) => {
    const roll = db.prepare("SELECT * FROM rolls WHERE id = ? AND log_id = ?").get(req.params.rollId, req.params.logId);
    if (!roll) throw notFound("Roll not found.");
    const b = req.body || {};
    const patch = { ...roll };
    if (b.checked !== undefined) {
      patch.checked = b.checked ? 1 : 0;
      patch.checked_at = b.checked ? new Date().toISOString() : null;
      patch.checked_by = b.checked ? (b.checkedBy || "") : "";
    }
    if (b.note !== undefined) patch.note = String(b.note);
    let weightChanged = false;
    if (b.weightKg !== undefined) {
      const newW = Math.round((Number(b.weightKg) || 0) * 100) / 100;
      weightChanged = newW !== roll.weight_kg;
      patch.weight_kg = newW;
      if (weightChanged) {
        patch.weight_edited_by = b.weightEditedBy || "";
        patch.weight_edited_at = new Date().toISOString();
      }
    }
    db.transaction(() => {
      updateRollStmt.run(patch);
      if (weightChanged) {
        // keep the log's own actualQtyKg equal to the sum of its rolls
        const total = db
          .prepare("SELECT COALESCE(SUM(weight_kg),0) as total FROM rolls WHERE log_id = ?")
          .get(roll.log_id).total;
        db.prepare("UPDATE logs SET actual_qty_kg = ? WHERE id = ?").run(Math.round(total * 100) / 100, roll.log_id);
        // and, if this roll is already on an un-checked delivery slip, correct
        // that slip's stored snapshot + total too
        if (roll.slip_id) {
          const slip = db.prepare("SELECT * FROM delivery_slips WHERE id = ?").get(roll.slip_id);
          if (slip && !slip.checked) {
            const slipRolls = JSON.parse(slip.rolls_json || "[]").map((r) =>
              r.rollId === roll.id && r.logId === roll.log_id ? { ...r, weightKg: patch.weight_kg } : r
            );
            const slipTotal = Math.round(slipRolls.reduce((a, r) => a + (Number(r.weightKg) || 0), 0) * 100) / 100;
            db.prepare(
              "UPDATE delivery_slips SET rolls_json = ?, total_weight_loaded = ?, original_weight_loaded = ? WHERE id = ?"
            ).run(JSON.stringify(slipRolls), slipTotal, slipTotal, slip.id);
          }
        }
      }
    })();
    const updated = db.prepare("SELECT * FROM rolls WHERE id = ?").get(roll.id);
    res.json(rollOut(updated));
  })
);

module.exports = router;
