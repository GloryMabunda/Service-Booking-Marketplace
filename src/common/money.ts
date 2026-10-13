// Money is kept as strings with two decimals ("650.00") and calculated in
// whole cents, never with floating-point numbers, so there are no rounding
// surprises (docs/api.md section 1).

// "650.00" → 65000. Accepts "650" and "650.5" too; throws for anything else.
export function toCents(amount: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) throw new Error(`Not a money amount: ${amount}`);
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

// 65000 → "650.00"
export function formatCents(cents: number): string {
  const rand = Math.floor(cents / 100);
  return `${rand}.${String(cents % 100).padStart(2, '0')}`;
}

// A percentage of an amount, rounded half-up to the cent (BR-7: the deposit
// is depositPercent × price). `percent` is a string like "50.00".
export function percentOf(percent: string, amount: string): string {
  const hundredthsOfPercent = toCents(percent); // "50.00" → 5000
  const cents = toCents(amount);
  return formatCents(Math.floor((cents * hundredthsOfPercent + 5000) / 10000));
}
