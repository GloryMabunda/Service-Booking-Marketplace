// South African phone numbers in any common format → E.164 ("+27821234567"),
// or null when it isn't one (#51). The booking form uses it to check a number
// before anything is sent, with exactly the rules the server applies.
//
// This mirrors src/common/phone.ts; a unit test (src/common/browser-phone.spec.ts)
// checks the two agree on a long list of numbers.
export function normalizeSouthAfricanPhone(input) {
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
