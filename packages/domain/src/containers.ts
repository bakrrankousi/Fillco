/**
 * ISO 6346 container numbers: 3-letter owner code, category letter (U/J/Z), 6 digits, 1 check digit.
 * Example: MSKU1234565.
 */
const CONTAINER_RE = /^[A-Z]{3}[UJZ]\d{7}$/;

function letterValue(ch: string): number {
  // A=10, skipping multiples of 11 (11, 22, 33).
  let value = 10;
  for (let c = 'A'.charCodeAt(0); c < ch.charCodeAt(0); c++) {
    value++;
    if (value % 11 === 0) value++;
  }
  return value;
}

export function containerCheckDigit(first10: string): number {
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const ch = first10[i] as string;
    const v = /\d/.test(ch) ? Number(ch) : letterValue(ch);
    total += v * 2 ** i;
  }
  return (total % 11) % 10;
}

export function normalizeContainerNumber(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidContainerNumber(input: string): boolean {
  const n = normalizeContainerNumber(input);
  if (!CONTAINER_RE.test(n)) return false;
  return containerCheckDigit(n.slice(0, 10)) === Number(n[10]);
}
