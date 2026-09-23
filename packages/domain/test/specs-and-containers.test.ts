import { describe, expect, it } from 'vitest';
import {
  AttributeDefinition,
  canonicalSpec,
  CategoryAttributeRule,
  containerCheckDigit,
  describeVariant,
  isValidContainerNumber,
  validateSpec,
} from '../src';

const defs: AttributeDefinition[] = [
  { code: 'denier', label: 'Denier', dataType: 'NUMBER', unit: 'D', minValue: 0.5, maxValue: 100 },
  { code: 'cut_length_mm', label: 'Cut length', dataType: 'NUMBER', unit: 'mm' },
  {
    code: 'siliconized',
    label: 'Siliconized',
    dataType: 'BOOLEAN',
    trueLabel: 'Siliconized',
    falseLabel: 'Non-siliconized',
  },
  {
    code: 'color',
    label: 'Color',
    dataType: 'ENUM',
    enumOptions: [
      { value: 'RAW_WHITE', label: 'Raw White' },
      { value: 'OPTICAL_WHITE', label: 'Optical White' },
    ],
  },
  { code: 'remarks', label: 'Remarks', dataType: 'TEXT' },
];
const rules: CategoryAttributeRule[] = [
  { code: 'denier', required: true, variantDefining: true, sortOrder: 1 },
  { code: 'cut_length_mm', required: true, variantDefining: true, sortOrder: 2 },
  { code: 'siliconized', required: false, variantDefining: true, sortOrder: 3 },
  { code: 'color', required: true, variantDefining: true, sortOrder: 4 },
  { code: 'remarks', required: false, variantDefining: false, sortOrder: 5 },
];

describe('flexible product specifications', () => {
  it('coerces and validates values', () => {
    const r = validateSpec(defs, rules, {
      denier: '7',
      cut_length_mm: 64,
      color: 'OPTICAL_WHITE',
      siliconized: 'yes',
    });
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ denier: 7, cut_length_mm: 64, siliconized: true, color: 'OPTICAL_WHITE' });
  });
  it('reports required, range, enum and unknown attribute errors', () => {
    const r = validateSpec(defs, rules, { denier: 500, color: 'PINK', tenacity: 5 });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['color', 'cut_length_mm', 'denier', 'tenacity']);
  });
  it('enforces fixed product attributes', () => {
    const fixed = { siliconized: true };
    const ok = validateSpec(defs, rules, { denier: 7, cut_length_mm: 64, color: 'RAW_WHITE' }, fixed);
    expect(ok.values.siliconized).toBe(true);
    const bad = validateSpec(
      defs,
      rules,
      { denier: 7, cut_length_mm: 64, color: 'RAW_WHITE', siliconized: false },
      fixed,
    );
    expect(bad.errors.siliconized).toMatch(/fixed/);
  });
  it('produces a canonical key independent of input order and non-defining fields', () => {
    const a = canonicalSpec({ color: 'RAW_WHITE', denier: 7, cut_length_mm: 64, remarks: 'x' }, rules);
    const b = canonicalSpec({ cut_length_mm: 64, denier: 7, color: 'RAW_WHITE' }, rules);
    expect(a).toBe(b);
  });
  it('builds trade-style variant names', () => {
    const name = describeVariant(
      'PSF HCS',
      defs,
      rules,
      { denier: 7, cut_length_mm: 64, siliconized: true, color: 'OPTICAL_WHITE' },
      ['siliconized'],
    );
    expect(name).toBe('PSF HCS 7D x 64mm Optical White');
  });
});

describe('ISO 6346 container numbers', () => {
  it('computes the check digit of the standard example', () => {
    expect(containerCheckDigit('CSQU305438')).toBe(3);
    expect(isValidContainerNumber('CSQU3054383')).toBe(true);
    expect(isValidContainerNumber('csqu 305438-3')).toBe(true);
  });
  it('rejects wrong check digits and formats', () => {
    expect(isValidContainerNumber('CSQU3054384')).toBe(false);
    expect(isValidContainerNumber('CSQ3054383')).toBe(false);
  });
});
