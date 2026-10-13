// South African phone numbers in any common format → E.164 ("+27821234567"),
// or null when it isn't one (docs/api.md: phone numbers are stored in E.164).
// Used for the business phone (#28) and clients' phones (BR-11), so the same
// number can't be written two ways.
//
// A South African number is 0 + 9 digits nationally, or +27 + 9 digits; the
// first of the 9 digits is 1-8 (area codes and mobile prefixes).
export function normalizeSouthAfricanPhone(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;

  if (digits.startsWith('+27')) digits = digits.slice(3);
  else if (digits.startsWith('27') && digits.length === 11) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 10) {
    digits = digits.slice(1);
  } else return null;

  // "+27 (0)82 ..." is a common way of writing it; drop the national 0.
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);

  return /^[1-8]\d{8}$/.test(digits) ? `+27${digits}` : null;
}
