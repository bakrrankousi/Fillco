const express = require("express");
const db = require("../db");
const { scheduleOut } = require("../serialize");
const { wrap, notFound } = require("../util/http");

const router = express.Router();

function toRow(body, existing) {
  const b = body || {};
  return {
    date: b.date !== undefined ? String(b.date) : existing ? existing.date : "",
    line: b.line !== undefined ? String(b.line) : existing ? existing.line : "",
    shift: b.shift !== undefined ? String(b.shift) : existing ? existing.shift : "",
    order_id: b.orderId !== undefined ? (b.orderId === null || b.orderId === "" ? null : Number(b.orderId)) : existing ? existing.order_id : null,
    so: b.so !== undefined ? String(b.so) : existing ? existing.so : "",
    customer: b.customer !== undefined ? String(b.customer) : existing ? existing.customer : "",
    product_type: b.productType !== undefined ? String(b.productType) : existing ? existing.product_type : "",
    gsm: b.gsm !== undefined ? Number(b.gsm) || 0 : existing ? existing.gsm : 0,
    width: b.width !== undefined ? (b.width === null || b.width === "" ? null : Number(b.width)) : existing ? existing.width : null,
    planned_qty_kg: b.plannedQtyKg !== undefined ? Number(b.plannedQtyKg) || 0 : existing ? existing.planned_qty_kg : 0,
    rate_kg_h: b.rateKgH !== undefined ? Number(b.rateKgH) || 0 : existing ? existing.rate_kg_h : 0,
    planned_hours: b.plannedHours !== undefined ? Number(b.plannedHours) || 0 : existing ? existing.planned_hours : 0,
    operator: b.operator !== undefined ? String(b.operator) : existing ? existing.operator : "",
    status: b.status !== undefined ? String(b.status) : existing ? existing.status : "Planned",
    notes: b.notes !== undefined ? String(b.notes) : existing ? existing.notes : "",
    seq: b.seq !== undefined ? Number(b.seq) || 0 : existing ? existing.seq : 0,
  };
}

// GET /api/schedule?date=&dateFrom=&dateTo=&line=&shift=&so=&status=&limit=
router.get(
  "/",
  wrap(async (req, res) => {
    const { date, dateFrom, dateTo, line, shift, so, status } = req.query;
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const clauses = [];
    const params = [];
    if (date) { clauses.push("date = ?"); params.push(date); }
    if (dateFrom) { clauses.push("date >= ?"); params.push(dateFrom); }
    if (dateTo) { clauses.push("date <= ?"); params.push(dateTo); }
    if (line) { clauses.push("line = ?"); params.push(line); }
    if (shift) { clauses.push("shift = ?"); params.push(shift); }
    if (so) { clauses.push("so = ?"); params.push(String(so)); }
    if (status) { clauses.push("status = ?"); params.push(status); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM schedule ${where} ORDER BY date ASC, seq ASC LIMIT ?`)
      .all(...params, limit);
    res.json(rows.map(scheduleOut));
  })
);

router.get(
  "/:id",
  wrap(async (req, res) => {
    const row = db.prepare("SELECT * FROM schedule WHERE id = ?").get(req.params.id);
    if (!row) throw notFound("Scheduled run not found.");
    res.json(scheduleOut(row));
  })
);

router.post(
  "/",
  wrap(async (req, res) => {
    const data = toRow(req.body, null);
    const info = db
      .prepare(
        `INSERT INTO schedule (date, line, shift, order_id, so, customer, product_type, gsm, width,
           planned_qty_kg, rate_kg_h, planned_hours, operator, status, notes, seq)
         VALUES (@date, @line, @shift, @order_id, @so, @customer, @product_type, @gsm, @width,
           @planned_qty_kg, @rate_kg_h, @planned_hours, @operator, @status, @notes, @seq)`
      )
      .run(data);
    const row = db.prepare("SELECT * FROM schedule WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(scheduleOut(row));
  })
);

router.put(
  "/:id",
  wrap(async (req, res) => {
    const existing = db.prepare("SELECT * FROM schedule WHERE id = ?").get(req.params.id);
    if (!existing) throw notFound("Scheduled run not found.");
    const data = toRow(req.body, existing);
    db.prepare(
      `UPDATE schedule SET date=@date, line=@line, shift=@shift, order_id=@order_id, so=@so, customer=@customer,
         product_type=@product_type, gsm=@gsm, width=@width, planned_qty_kg=@planned_qty_kg, rate_kg_h=@rate_kg_h,
         planned_hours=@planned_hours, operator=@operator, status=@status, notes=@notes, seq=@seq
       WHERE id=@id`
    ).run({ ...data, id: existing.id });
    const row = db.prepare("SELECT * FROM schedule WHERE id = ?").get(existing.id);
    res.json(scheduleOut(row));
  })
);

router.delete(
  "/:id",
  wrap(async (req, res) => {
    const info = db.prepare("DELETE FROM schedule WHERE id = ?").run(req.params.id);
    if (!info.changes) throw notFound("Scheduled run not found.");
    res.status(204).end();
  })
);

module.exports = router;
