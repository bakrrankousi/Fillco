const express = require("express");
const db = require("../db");
const { orderOut } = require("../serialize");
const { wrap, badRequest, notFound } = require("../util/http");

const router = express.Router();

function toRow(body, existing) {
  const b = body || {};
  return {
    so: b.so !== undefined ? String(b.so) : existing ? existing.so : "",
    customer: b.customer !== undefined ? String(b.customer) : existing ? existing.customer : "",
    product_type: b.productType !== undefined ? String(b.productType) : existing ? existing.product_type : "",
    gsm: b.gsm !== undefined ? Number(b.gsm) || 0 : existing ? existing.gsm : 0,
    width: b.width !== undefined ? (b.width === null || b.width === "" ? null : Number(b.width)) : existing ? existing.width : null,
    qty_kg: b.qtyKg !== undefined ? Number(b.qtyKg) || 0 : existing ? existing.qty_kg : 0,
    due_date: b.dueDate !== undefined ? String(b.dueDate) : existing ? existing.due_date : "",
    priority: b.priority !== undefined ? String(b.priority) : existing ? existing.priority : "Normal",
    status: b.status !== undefined ? String(b.status) : existing ? existing.status : "Open",
    notes: b.notes !== undefined ? String(b.notes) : existing ? existing.notes : "",
  };
}

// GET /api/orders?status=&so=&dueFrom=&dueTo=&limit=
router.get(
  "/",
  wrap(async (req, res) => {
    const { status, so, dueFrom, dueTo } = req.query;
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const clauses = [];
    const params = [];
    if (status) { clauses.push("status = ?"); params.push(status); }
    if (so) { clauses.push("so = ?"); params.push(String(so)); }
    if (dueFrom) { clauses.push("due_date >= ?"); params.push(dueFrom); }
    if (dueTo) { clauses.push("due_date <= ?"); params.push(dueTo); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM orders ${where} ORDER BY due_date ASC LIMIT ?`)
      .all(...params, limit);
    res.json(rows.map(orderOut));
  })
);

router.get(
  "/:id",
  wrap(async (req, res) => {
    const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!row) throw notFound("Order not found.");
    res.json(orderOut(row));
  })
);

router.post(
  "/",
  wrap(async (req, res) => {
    const data = toRow(req.body, null);
    const createdAt = new Date().toISOString(); // start of the 3-day on-time window
    const info = db
      .prepare(
        `INSERT INTO orders (so, customer, product_type, gsm, width, qty_kg, due_date, priority, status, notes, created_at)
         VALUES (@so, @customer, @product_type, @gsm, @width, @qty_kg, @due_date, @priority, @status, @notes, @created_at)`
      )
      .run({ ...data, created_at: createdAt });
    const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(orderOut(row));
  })
);

router.put(
  "/:id",
  wrap(async (req, res) => {
    const existing = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!existing) throw notFound("Order not found.");
    const data = toRow(req.body, existing);
    db.prepare(
      `UPDATE orders SET so=@so, customer=@customer, product_type=@product_type, gsm=@gsm, width=@width,
         qty_kg=@qty_kg, due_date=@due_date, priority=@priority, status=@status, notes=@notes
       WHERE id=@id`
    ).run({ ...data, id: existing.id });
    const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(existing.id);
    res.json(orderOut(row));
  })
);

router.delete(
  "/:id",
  wrap(async (req, res) => {
    const info = db.prepare("DELETE FROM orders WHERE id = ?").run(req.params.id);
    if (!info.changes) throw notFound("Order not found.");
    res.status(204).end();
  })
);

module.exports = router;
