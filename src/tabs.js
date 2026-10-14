// Per-user tab access (users.allowed_tabs).
//
// An admin can limit a member account to a subset of the app's tabs. The
// value is stored as a JSON text array of tab ids, or NULL meaning "every
// tab" (which is also what every account that existed before this column
// was added gets, so nobody's access changes on upgrade). "settings" is never
// stored: it is always available, so nobody can be locked out of their own
// language / password / per-device options. Admins always get every tab,
// whatever is stored.
//
// This only controls which tabs the frontend shows; it is a convenience
// for keeping each person's screen focused, not a data-access boundary.

// Must match HIDEABLE_TABS in public/index.html (same ids, same order).
const ASSIGNABLE_TABS = ["dashboard", "log", "loading", "schedule", "history", "capacity", "orders"];

// Turns client input into what gets stored: null (all tabs) or a de-duplicated
// array of known tab ids in canonical order. Unknown ids and "settings" are
// dropped. An array naming every assignable tab collapses to null, so "all
// ticked" and "never restricted" are the same thing. Throws a plain Error
// with .badInput for a value that isn't null/undefined/an array.
function normalizeAllowedTabs(input) {
  if (input === null || input === undefined) return null;
  if (!Array.isArray(input)) {
    const err = new Error("allowedTabs must be an array of tab ids, or null for all tabs.");
    err.badInput = true;
    throw err;
  }
  const wanted = new Set(input.filter((v) => typeof v === "string"));
  const list = ASSIGNABLE_TABS.filter((id) => wanted.has(id));
  if (list.length === ASSIGNABLE_TABS.length) return null;
  return list;
}

// Stored text -> array | null. Defensive against hand-edited/garbled values:
// anything that isn't a JSON array is treated as "all tabs".
function parseAllowedTabs(text) {
  if (text === null || text === undefined || text === "") return null;
  let arr;
  try {
    arr = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  return normalizeAllowedTabs(arr);
}

// What the API reports for a user row: admins always get null (all tabs).
function effectiveAllowedTabs(role, storedText) {
  if (role === "admin") return null;
  return parseAllowedTabs(storedText);
}

function serializeAllowedTabs(list) {
  return list === null ? null : JSON.stringify(list);
}

module.exports = {
  ASSIGNABLE_TABS,
  normalizeAllowedTabs,
  parseAllowedTabs,
  effectiveAllowedTabs,
  serializeAllowedTabs,
};
