import { AttributeDataType } from './statuses';

/**
 * Product specifications are data, not code: each category declares which attributes apply
 * (denier, cut length, siliconized, …). A concrete combination becomes a product variant.
 */
export interface EnumOption {
  value: string;
  label: string;
}

export interface AttributeDefinition {
  code: string;
  label: string;
  dataType: AttributeDataType;
  /** Display suffix, e.g. "D" (denier), "mm", "%", "°C". */
  unit?: string | null;
  /** ENUM: allowed values. */
  enumOptions?: readonly EnumOption[] | null;
  /** BOOLEAN: labels used in names, e.g. "Siliconized" / "Non-siliconized". */
  trueLabel?: string | null;
  falseLabel?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
}

export interface CategoryAttributeRule {
  code: string;
  required: boolean;
  /** Part of what makes a variant unique (and appears in its name). */
  variantDefining: boolean;
  sortOrder: number;
}

export type SpecValue = string | number | boolean;
export type SpecValues = Record<string, SpecValue>;

export interface SpecValidationResult {
  ok: boolean;
  values: SpecValues;
  errors: Record<string, string>;
}

function coerce(def: AttributeDefinition, raw: unknown): { value?: SpecValue; error?: string } {
  switch (def.dataType) {
    case 'NUMBER': {
      const n =
        typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return { error: `${def.label} must be a number` };
      if (def.minValue != null && n < def.minValue)
        return { error: `${def.label} must be ≥ ${def.minValue}` };
      if (def.maxValue != null && n > def.maxValue)
        return { error: `${def.label} must be ≤ ${def.maxValue}` };
      return { value: n };
    }
    case 'BOOLEAN': {
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true' || raw === 'yes' || raw === '1') return { value: true };
      if (raw === 'false' || raw === 'no' || raw === '0') return { value: false };
      return { error: `${def.label} must be yes or no` };
    }
    case 'ENUM': {
      const v = String(raw);
      const options = def.enumOptions ?? [];
      if (!options.some((o) => o.value === v))
        return { error: `${def.label} must be one of: ${options.map((o) => o.label).join(', ')}` };
      return { value: v };
    }
    case 'TEXT': {
      const v = String(raw).trim();
      if (v.length > 200) return { error: `${def.label} is too long` };
      return { value: v };
    }
  }
}

function isBlank(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
}

/**
 * Validates spec input against a category's attribute rules. Unknown attributes are rejected,
 * required ones enforced, values coerced to their type. Fixed product attributes are merged in
 * (they cannot be overridden per line).
 */
export function validateSpec(
  definitions: readonly AttributeDefinition[],
  rules: readonly CategoryAttributeRule[],
  input: Record<string, unknown>,
  fixed: SpecValues = {},
): SpecValidationResult {
  const byCode = new Map(definitions.map((d) => [d.code, d]));
  const ruleByCode = new Map(rules.map((r) => [r.code, r]));
  const errors: Record<string, string> = {};
  const values: SpecValues = {};

  for (const key of Object.keys(input)) {
    if (!ruleByCode.has(key) && !(key in fixed))
      errors[key] = `Attribute "${key}" does not apply to this product`;
  }
  for (const rule of [...rules].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const def = byCode.get(rule.code);
    if (!def) {
      errors[rule.code] = `Attribute "${rule.code}" is not defined`;
      continue;
    }
    if (rule.code in fixed) {
      values[rule.code] = fixed[rule.code] as SpecValue;
      if (!isBlank(input[rule.code]) && coerce(def, input[rule.code]).value !== fixed[rule.code])
        errors[rule.code] = `${def.label} is fixed for this product`;
      continue;
    }
    const raw = input[rule.code];
    if (isBlank(raw)) {
      if (rule.required) errors[rule.code] = `${def.label} is required`;
      continue;
    }
    const { value, error } = coerce(def, raw);
    if (error) errors[rule.code] = error;
    else if (value !== undefined) values[rule.code] = value;
  }
  return { ok: Object.keys(errors).length === 0, values, errors };
}

/** Stable text of the variant-defining values: sorted keys, typed values. Hash this for uniqueness. */
export function canonicalSpec(values: SpecValues, rules: readonly CategoryAttributeRule[]): string {
  const defining = new Set(rules.filter((r) => r.variantDefining).map((r) => r.code));
  const entries = Object.keys(values)
    .filter((k) => defining.has(k))
    .sort()
    .map((k) => [k, values[k]] as const);
  return JSON.stringify(Object.fromEntries(entries));
}

export function formatSpecValue(def: AttributeDefinition, value: SpecValue): string {
  switch (def.dataType) {
    case 'NUMBER':
      return `${value}${def.unit ?? ''}`;
    case 'BOOLEAN':
      return value ? (def.trueLabel ?? def.label) : (def.falseLabel ?? `Non-${def.label.toLowerCase()}`);
    case 'ENUM':
      return def.enumOptions?.find((o) => o.value === value)?.label ?? String(value);
    case 'TEXT':
      return String(value);
  }
}

/**
 * Variant display name, e.g. "PSF HCS 7D x 64mm Optical White".
 * Consecutive numeric attributes are joined with " x " as in trade usage (denier x cut length).
 */
export function describeVariant(
  productName: string,
  definitions: readonly AttributeDefinition[],
  rules: readonly CategoryAttributeRule[],
  values: SpecValues,
  fixedCodes: readonly string[] = [],
): string {
  const byCode = new Map(definitions.map((d) => [d.code, d]));
  const parts: { text: string; numeric: boolean }[] = [];
  for (const rule of [...rules].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!rule.variantDefining || fixedCodes.includes(rule.code)) continue;
    const def = byCode.get(rule.code);
    const value = values[rule.code];
    if (!def || value === undefined) continue;
    parts.push({ text: formatSpecValue(def, value), numeric: def.dataType === 'NUMBER' });
  }
  let out = productName;
  parts.forEach((p, i) => {
    const prev = parts[i - 1];
    out += prev && prev.numeric && p.numeric ? ` x ${p.text}` : ` ${p.text}`;
  });
  return out;
}
