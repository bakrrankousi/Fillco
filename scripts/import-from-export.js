#!/usr/bin/env node
// One-time (but safe to re-run) migration from the old Artifact app's data.
//
// Usage: node scripts/import-from-export.js <path-to-export.json>
//
// Expects a JSON file shaped like:
//   { orders: [...], schedule: [...], logs: [...], deliverySlips: [...], settings: {...} }
// where each record may carry a `legacyId` field holding the old Artifact
// doc id (a companion effort is adding an "export all data as JSON" button
// to the live Artifact that produces this). Any field this script doesn't
// recognize is ignored; any optional field that's missing just falls back
// to a sane default — this is deliberately tolerant of minor shape
// variations, since the export script and this importer were built in
// parallel against the same spec rather than against each other directly.
//
// Id-based references (schedule.orderId, log.scheduleId, roll.slipId,
// deliverySlip.rolls[].logId/rollId) are remapped from the old Artifact doc
// ids to the new SQLite row ids as they're created.
//
// Re-running this script on the same (or a growing) export file does not
// duplicate rows: every table keyed on `legacy_id` is upserted — a record
// whose legacyId has already been imported is updated in place rather than
// inserted again. Records with no legacyId at all can't be deduplicated
// this way and are always inserted fresh; that's fine for a one-off import
// but means re-running with such a file would duplicate those particular
// rows (worth noting if the export script omits legacyId on some records).
const fs = require("fs");
const path = require("path");
const db = require("../src/db");

function usageAndExit() {
  console.error("Usage: node scripts/import-from-export.js <path-to-export.json>");
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) usageAndExit();
const resolved = path.resolve(filePath);
if (!fs.existsSync(resolved)) {
  console.error(`File not found: ${resolved}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(resolved, "utf8"));
} catch (e) {
  console.error(`Couldn't parse ${resolved} as JSON: ${e.message}`);
  process.exit(1);
}

const orders = Array.isArray(data.orders) ? data.orders : [];
const schedule = Array.isArray(data.schedule) ? data.schedule : [];
const logs = Array.isArray(data.logs) ? data.logs : [];
const deliverySlips = Array.isArray(data.deliverySlips) ? data.deliverySlips : [];
const settings = data.settings && typeof data.settings === "object" ? data.settings : null;

const num = (v, fallback = 0) => (v === undefined || v === null || v === "" ? fallback : Number(v) || fallback);
const numOrNull = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
const str = (v, fallback = "") => (v === undefined || v === null ? fallback : String(v));

function upsert(table, legacyId, insertSql, insertParams, updateSql, updateParams) {
  if (legacyId != null) {
    const existing = db.prepare(`SELECT id FROM ${table} WHERE legacy_id = ?`).get(String(legacyId));
    if (existing) {
      db.prepare(updateSql).run({ ...updateParams, id: existing.id });
      return existing.id;
    }
  }
  const info = db.prepare(insertSql).run(insertParams);
  return info.lastInsertRowid;
}

const stats = { orders: 0, schedule: 0, logs: 0, rolls: 0, deliverySlips: 0 };

const runImport = db.transaction(() => {
  // ---- orders ----
  const orderIdMap = new Map(); // legacyId -> new id
  for (const o of orders) {
    const legacyId = o.legacyId != null ? String(o.legacyId) : o.id != null ? String(o.id) : null;
    const createdAt = str(o.createdAt, new Date().toISOString());
    const params = {
      legacy_id: legacyId,
      so: str(o.so),
      customer: str(o.customer),
      product_type: str(o.productType),
      gsm: num(o.gsm),
      width: numOrNull(o.width),
      qty_kg: num(o.qtyKg),
      due_date: str(o.dueDate),
      priority: str(o.priority, "Normal"),
      status: str(o.status, "Open"),
      notes: str(o.notes),
      created_at: createdAt,
    };
    const newId = upsert(
      "orders",
      legacyId,
      `INSERT INTO orders (legacy_id, so, customer, product_type, gsm, width, qty_kg, due_date, priority, status, notes, created_at)
       VALUES (@legacy_id, @so, @customer, @product_type, @gsm, @width, @qty_kg, @due_date, @priority, @status, @notes, @created_at)`,
      params,
      `UPDATE orders SET so=@so, customer=@customer, product_type=@product_type, gsm=@gsm, width=@width, qty_kg=@qty_kg,
         due_date=@due_date, priority=@priority, status=@status, notes=@notes, created_at=@created_at WHERE id=@id`,
      params
    );
    if (legacyId != null) orderIdMap.set(legacyId, newId);
    stats.orders++;
  }

  // ---- schedule ----
  const scheduleIdMap = new Map();
  for (const s of schedule) {
    const legacyId = s.legacyId != null ? String(s.legacyId) : s.id != null ? String(s.id) : null;
    const oldOrderId = s.orderId != null ? String(s.orderId) : null;
    const params = {
      legacy_id: legacyId,
      date: str(s.date),
      line: str(s.line),
      shift: str(s.shift),
      order_id: oldOrderId != null ? orderIdMap.get(oldOrderId) || null : null,
      so: str(s.so),
      customer: str(s.customer),
      product_type: str(s.productType),
      gsm: num(s.gsm),
      width: numOrNull(s.width),
      planned_qty_kg: num(s.plannedQtyKg),
      rate_kg_h: num(s.rateKgH),
      planned_hours: num(s.plannedHours),
      operator: str(s.operator),
      status: str(s.status, "Planned"),
      notes: str(s.notes),
      seq: num(s.seq, 0),
    };
    const newId = upsert(
      "schedule",
      legacyId,
      `INSERT INTO schedule (legacy_id, date, line, shift, order_id, so, customer, product_type, gsm, width,
         planned_qty_kg, rate_kg_h, planned_hours, operator, status, notes, seq)
       VALUES (@legacy_id, @date, @line, @shift, @order_id, @so, @customer, @product_type, @gsm, @width,
         @planned_qty_kg, @rate_kg_h, @planned_hours, @operator, @status, @notes, @seq)`,
      params,
      `UPDATE schedule SET date=@date, line=@line, shift=@shift, order_id=@order_id, so=@so, customer=@customer,
         product_type=@product_type, gsm=@gsm, width=@width, planned_qty_kg=@planned_qty_kg, rate_kg_h=@rate_kg_h,
         planned_hours=@planned_hours, operator=@operator, status=@status, notes=@notes, seq=@seq WHERE id=@id`,
      params
    );
    if (legacyId != null) scheduleIdMap.set(legacyId, newId);
    stats.schedule++;
  }

  // ---- logs (+ rolls) ----
  const logIdMap = new Map();
  // rolls whose original `slipId` points at a delivery slip we haven't
  // imported yet get fixed up in a second pass, below.
  const pendingRollSlipFixups = []; // { newRollId, oldSlipId }
  const insertRoll = db.prepare(
    `INSERT INTO rolls (legacy_id, log_id, seq, weight_kg, checked, checked_at, checked_by, note, loaded, loaded_at, driver, delivery_date, slip_id, weight_edited_by, weight_edited_at)
     VALUES (@legacy_id, @log_id, @seq, @weight_kg, @checked, @checked_at, @checked_by, @note, @loaded, @loaded_at, @driver, @delivery_date, NULL, @weight_edited_by, @weight_edited_at)`
  );
  const updateRoll = db.prepare(
    `UPDATE rolls SET log_id=@log_id, seq=@seq, weight_kg=@weight_kg, checked=@checked, checked_at=@checked_at,
       checked_by=@checked_by, note=@note, loaded=@loaded, loaded_at=@loaded_at, driver=@driver, delivery_date=@delivery_date,
       weight_edited_by=@weight_edited_by, weight_edited_at=@weight_edited_at WHERE id=@id`
  );
  const rollIdMap = new Map(); // "oldLogId::oldRollId" -> new roll id

  for (const l of logs) {
    const legacyId = l.legacyId != null ? String(l.legacyId) : l.id != null ? String(l.id) : null;
    const oldScheduleId = l.scheduleId != null ? String(l.scheduleId) : null;
    const quality = l.quality && typeof l.quality === "object" ? JSON.stringify(l.quality) : null;
    const params = {
      legacy_id: legacyId,
      date: str(l.date),
      line: str(l.line),
      shift: str(l.shift),
      schedule_id: oldScheduleId != null ? scheduleIdMap.get(oldScheduleId) || null : null,
      so: str(l.so),
      product_type: str(l.productType),
      gsm: num(l.gsm),
      width: numOrNull(l.width),
      actual_qty_kg: num(l.actualQtyKg),
      actual_hours: num(l.actualHours),
      start_time: str(l.startTime),
      end_time: str(l.endTime),
      stoppage_minutes: num(l.stoppageMinutes),
      stoppage_category: str(l.stoppageCategory),
      operator: str(l.operator),
      notes: str(l.notes),
      logged_at: str(l.loggedAt, new Date().toISOString()),
      quality_json: quality,
    };
    const newLogId = upsert(
      "logs",
      legacyId,
      `INSERT INTO logs (legacy_id, date, line, shift, schedule_id, so, product_type, gsm, width, actual_qty_kg, actual_hours,
         start_time, end_time, stoppage_minutes, stoppage_category, operator, notes, logged_at, quality_json)
       VALUES (@legacy_id, @date, @line, @shift, @schedule_id, @so, @product_type, @gsm, @width, @actual_qty_kg, @actual_hours,
         @start_time, @end_time, @stoppage_minutes, @stoppage_category, @operator, @notes, @logged_at, @quality_json)`,
      params,
      `UPDATE logs SET date=@date, line=@line, shift=@shift, schedule_id=@schedule_id, so=@so, product_type=@product_type,
         gsm=@gsm, width=@width, actual_qty_kg=@actual_qty_kg, actual_hours=@actual_hours, start_time=@start_time,
         end_time=@end_time, stoppage_minutes=@stoppage_minutes, stoppage_category=@stoppage_category, operator=@operator,
         notes=@notes, logged_at=@logged_at, quality_json=@quality_json WHERE id=@id`,
      params
    );
    if (legacyId != null) logIdMap.set(legacyId, newLogId);
    stats.logs++;

    const rolls = Array.isArray(l.rolls) ? l.rolls : [];
    for (const r of rolls) {
      const rollLegacyId = r.id != null ? String(r.id) : null;
      const oldSlipId = r.slipId != null ? String(r.slipId) : null;
      const rparams = {
        legacy_id: rollLegacyId,
        log_id: newLogId,
        seq: num(r.seq, 0),
        weight_kg: num(r.weightKg),
        checked: r.checked ? 1 : 0,
        checked_at: r.checkedAt || null,
        checked_by: str(r.checkedBy),
        note: str(r.note),
        loaded: r.loaded ? 1 : 0,
        loaded_at: r.loadedAt || null,
        driver: r.driver || null,
        delivery_date: r.deliveryDate || null,
        weight_edited_by: r.weightEditedBy || null,
        weight_edited_at: r.weightEditedAt || null,
      };
      let newRollId;
      if (rollLegacyId != null) {
        const existingRoll = db.prepare("SELECT id FROM rolls WHERE legacy_id = ?").get(rollLegacyId);
        if (existingRoll) {
          updateRoll.run({ ...rparams, id: existingRoll.id });
          newRollId = existingRoll.id;
        } else {
          newRollId = insertRoll.run(rparams).lastInsertRowid;
        }
      } else {
        newRollId = insertRoll.run(rparams).lastInsertRowid;
      }
      if (oldSlipId != null && rollLegacyId != null) {
        rollIdMap.set(`${legacyId}::${rollLegacyId}`, newRollId);
        pendingRollSlipFixups.push({ newRollId, oldSlipId });
      } else if (rollLegacyId != null) {
        rollIdMap.set(`${legacyId}::${rollLegacyId}`, newRollId);
      }
      stats.rolls++;
    }
  }

  // ---- delivery slips ----
  const slipIdMap = new Map(); // oldSlipId -> new id
  for (const slip of deliverySlips) {
    const legacyId = slip.legacyId != null ? String(slip.legacyId) : slip.id != null ? String(slip.id) : null;
    const rolls = Array.isArray(slip.rolls) ? slip.rolls : [];
    const remappedRolls = rolls.map((r) => {
      const oldLogId = r.logId != null ? String(r.logId) : null;
      const oldRollId = r.rollId != null ? String(r.rollId) : null;
      const newLogId = oldLogId != null ? logIdMap.get(oldLogId) || null : null;
      const newRollId = oldLogId != null && oldRollId != null ? rollIdMap.get(`${oldLogId}::${oldRollId}`) || null : null;
      return {
        logId: newLogId,
        rollId: newRollId,
        seq: num(r.seq, 0),
        weightKg: num(r.weightKg),
        productType: str(r.productType),
        gsm: numOrNull(r.gsm),
        width: numOrNull(r.width),
      };
    });
    const rollsJson = JSON.stringify(remappedRolls);
    const totalWeight = remappedRolls.reduce((a, r) => a + (Number(r.weightKg) || 0), 0);
    const params = {
      legacy_id: legacyId,
      so: str(slip.so),
      customer: str(slip.customer),
      slip_seq: slip.slipSeq != null ? Number(slip.slipSeq) : null,
      driver: str(slip.driver),
      delivery_date: str(slip.deliveryDate),
      rolls_json: rollsJson,
      roll_count: slip.rollCount != null ? Number(slip.rollCount) : remappedRolls.length,
      total_weight_loaded: slip.totalWeightLoaded != null ? num(slip.totalWeightLoaded) : totalWeight,
      original_weight_loaded: slip.originalWeightLoaded != null ? num(slip.originalWeightLoaded) : totalWeight,
      checked: slip.checked ? 1 : 0,
      checked_weight: numOrNull(slip.checkedWeight),
      checked_by: str(slip.checkedBy),
      checked_at: slip.checkedAt || null,
      weight_diff: numOrNull(slip.weightDiff),
      created_at: str(slip.createdAt, new Date().toISOString()),
      created_by: str(slip.createdBy),
    };
    const newSlipId = upsert(
      "delivery_slips",
      legacyId,
      `INSERT INTO delivery_slips (legacy_id, so, customer, slip_seq, driver, delivery_date, rolls_json, roll_count,
         total_weight_loaded, original_weight_loaded, checked, checked_weight, checked_by, checked_at, weight_diff, created_at, created_by)
       VALUES (@legacy_id, @so, @customer, @slip_seq, @driver, @delivery_date, @rolls_json, @roll_count,
         @total_weight_loaded, @original_weight_loaded, @checked, @checked_weight, @checked_by, @checked_at, @weight_diff, @created_at, @created_by)`,
      params,
      `UPDATE delivery_slips SET so=@so, customer=@customer, slip_seq=@slip_seq, driver=@driver, delivery_date=@delivery_date,
         rolls_json=@rolls_json, roll_count=@roll_count, total_weight_loaded=@total_weight_loaded,
         original_weight_loaded=@original_weight_loaded, checked=@checked, checked_weight=@checked_weight,
         checked_by=@checked_by, checked_at=@checked_at, weight_diff=@weight_diff, created_at=@created_at, created_by=@created_by
       WHERE id=@id`,
      params
    );
    if (legacyId != null) slipIdMap.set(legacyId, newSlipId);

    // keep the slip's own highest slipSeq reflected in settings.next_slip_seq
    // so newly-claimed numbers after an import never collide with imported ones.
    if (params.slip_seq != null) {
      const row = db.prepare("SELECT next_slip_seq FROM settings WHERE id = 1").get();
      if (params.slip_seq >= row.next_slip_seq) {
        db.prepare("UPDATE settings SET next_slip_seq = ? WHERE id = 1").run(params.slip_seq + 1);
      }
    }
    stats.deliverySlips++;
  }

  // ---- fix up rolls.slip_id now that delivery_slips have real new ids ----
  const setRollSlip = db.prepare("UPDATE rolls SET slip_id = ? WHERE id = ?");
  for (const { newRollId, oldSlipId } of pendingRollSlipFixups) {
    const newSlipId = slipIdMap.get(oldSlipId);
    if (newSlipId != null) setRollSlip.run(newSlipId, newRollId);
  }

  // ---- settings/config ----
  if (settings) {
    const existing = db.prepare("SELECT * FROM settings WHERE id = 1").get();
    const rates = settings.rates && typeof settings.rates === "object" ? settings.rates : JSON.parse(existing.rates_json);
    const lines = Array.isArray(settings.lines) && settings.lines.length ? settings.lines : JSON.parse(existing.lines_json);
    const changeoverMin = settings.changeoverMin != null ? Number(settings.changeoverMin) || 45 : existing.changeover_min;
    const restrictedViewers = Array.isArray(settings.restrictedViewers) ? settings.restrictedViewers : JSON.parse(existing.restricted_viewers_json || "[]");
    const nextSlipSeq = settings.nextSlipSeq != null ? Math.max(Number(settings.nextSlipSeq) || 1, existing.next_slip_seq) : existing.next_slip_seq;
    db.prepare(
      "UPDATE settings SET rates_json=?, changeover_min=?, lines_json=?, restricted_viewers_json=?, next_slip_seq=? WHERE id=1"
    ).run(JSON.stringify(rates), changeoverMin, JSON.stringify(lines), JSON.stringify(restrictedViewers), nextSlipSeq);
  }
});

try {
  runImport();
  console.log("Import complete:");
  console.log(`  orders:         ${stats.orders}`);
  console.log(`  schedule:       ${stats.schedule}`);
  console.log(`  logs:           ${stats.logs}`);
  console.log(`  rolls:          ${stats.rolls}`);
  console.log(`  delivery slips: ${stats.deliverySlips}`);
  console.log(settings ? "  settings:       updated" : "  settings:       (none in file, left as-is)");
} catch (e) {
  console.error("Import failed, nothing was written (the whole import runs in one transaction):");
  console.error(e);
  process.exit(1);
}
