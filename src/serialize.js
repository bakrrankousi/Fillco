// Converts SQLite rows (snake_case columns) to the camelCase, embedded-array
// JSON shape the original Artifact app's `state.orders` / `state.schedule` /
// `state.logs` / `state.deliverySlips` used — so porting the frontend in a
// later phase is mostly a find/replace of window.claude.use("db") calls for
// fetch() calls, not a data-model rewrite.
const db = require("./db");
const { effectiveAllowedTabs } = require("./tabs");

function orderOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    legacyId: row.legacy_id || undefined,
    so: row.so,
    customer: row.customer,
    productType: row.product_type,
    gsm: row.gsm,
    width: row.width,
    qtyKg: row.qty_kg,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function scheduleOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    legacyId: row.legacy_id || undefined,
    date: row.date,
    line: row.line,
    shift: row.shift,
    orderId: row.order_id,
    so: row.so,
    customer: row.customer,
    productType: row.product_type,
    gsm: row.gsm,
    width: row.width,
    plannedQtyKg: row.planned_qty_kg,
    rateKgH: row.rate_kg_h,
    plannedHours: row.planned_hours,
    operator: row.operator,
    status: row.status,
    notes: row.notes,
    seq: row.seq,
  };
}

function rollOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    legacyId: row.legacy_id || undefined,
    logId: row.log_id,
    seq: row.seq,
    weightKg: row.weight_kg,
    checked: !!row.checked,
    checkedAt: row.checked_at,
    checkedBy: row.checked_by,
    note: row.note,
    loaded: !!row.loaded,
    loadedAt: row.loaded_at,
    driver: row.driver,
    deliveryDate: row.delivery_date,
    slipId: row.slip_id,
    weightEditedBy: row.weight_edited_by,
    weightEditedAt: row.weight_edited_at,
  };
}

const rollsByLogStmt = db.prepare("SELECT * FROM rolls WHERE log_id = ? ORDER BY seq ASC, id ASC");

function logOut(row) {
  if (!row) return null;
  const rolls = rollsByLogStmt.all(row.id).map(rollOut);
  return {
    id: row.id,
    legacyId: row.legacy_id || undefined,
    date: row.date,
    line: row.line,
    shift: row.shift,
    scheduleId: row.schedule_id,
    so: row.so,
    productType: row.product_type,
    gsm: row.gsm,
    width: row.width,
    actualQtyKg: row.actual_qty_kg,
    actualHours: row.actual_hours,
    startTime: row.start_time,
    endTime: row.end_time,
    stoppageMinutes: row.stoppage_minutes,
    stoppageCategory: row.stoppage_category,
    operator: row.operator,
    notes: row.notes,
    loggedAt: row.logged_at,
    quality: row.quality_json ? JSON.parse(row.quality_json) : null,
    rolls,
  };
}

function slipOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    legacyId: row.legacy_id || undefined,
    so: row.so,
    customer: row.customer,
    slipSeq: row.slip_seq,
    driver: row.driver,
    deliveryDate: row.delivery_date,
    rolls: JSON.parse(row.rolls_json || "[]"),
    rollCount: row.roll_count,
    totalWeightLoaded: row.total_weight_loaded,
    originalWeightLoaded: row.original_weight_loaded,
    checked: !!row.checked,
    checkedWeight: row.checked_weight,
    checkedBy: row.checked_by,
    checkedAt: row.checked_at,
    weightDiff: row.weight_diff,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function userOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: !!row.active,
    createdAt: row.created_at,
    // null = every tab (always the case for admins); otherwise the tab ids
    // this member may open. "settings" is implicit and never listed.
    allowedTabs: effectiveAllowedTabs(row.role, row.allowed_tabs),
  };
}

function settingsOut(row) {
  return {
    rates: JSON.parse(row.rates_json),
    changeoverMin: row.changeover_min,
    lines: JSON.parse(row.lines_json),
    restrictedViewers: JSON.parse(row.restricted_viewers_json || "[]"),
    nextSlipSeq: row.next_slip_seq,
  };
}

module.exports = { orderOut, scheduleOut, logOut, rollOut, slipOut, userOut, settingsOut };
