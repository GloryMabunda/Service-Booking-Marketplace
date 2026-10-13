import { z } from 'zod';
import { normalizeSouthAfricanPhone } from '../common/phone.js';

// The business settings (A-8, #28), as the API and the other modules see
// them. Field rules: docs/api.md section 7.15.

export interface BankingDetails {
  accountName: string;
  bank: string;
  accountNumber: string;
  branchCode: string;
  accountType: string;
}

export interface Settings {
  minNoticeHours: number;
  maxAdvanceDays: number;
  slotIntervalMinutes: number;
  bufferMinutes: number;
  depositPercent: string; // "50.00": money-like values are strings
  depositRefundable: boolean;
  refundCutoffHours: number;
  depositHoldHours: number;
  minPaymentWindowHours: number;
  timeZone: string;
  bankingDetails: BankingDetails;
  businessName: string;
  businessEmail: string;
  businessPhone: string | null;
  updatedAt: string; // ISO 8601 in UTC
}

// The seed_settings migration (#28) fills the banking details with this text
// so real details are never committed to Git. The owner replaces them in the
// portal; a booking that needs a deposit is refused until she has (#45).
export const BANKING_PLACEHOLDER = 'Not set yet';

export function bankingDetailsAreSet(details: BankingDetails): boolean {
  const fields = [
    details.accountName,
    details.bank,
    details.accountNumber,
    details.branchCode,
    details.accountType,
  ];
  return fields.every((value) => {
    const text = value.trim().toLowerCase();
    return text !== '' && text !== BANKING_PLACEHOLDER.toLowerCase();
  });
}

const wholeNumber = (min: number, max: number) =>
  z
    .number({ error: 'Enter a whole number.' })
    .int('Enter a whole number.')
    .min(min, `Must be between ${min} and ${max}.`)
    .max(max, `Must be between ${min} and ${max}.`);

const text = (label: string) =>
  z
    .string({ error: `Enter the ${label}.` })
    .trim()
    .min(1, `Enter the ${label}.`)
    .max(100, `The ${label} must be at most 100 characters.`);

export function isValidTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return name.includes('/') || name === 'UTC';
  } catch {
    return false;
  }
}

// PATCH /api/admin/settings accepts any subset of the fields.
export const settingsPatchSchema = z
  .strictObject({
    minNoticeHours: wholeNumber(0, 720),
    maxAdvanceDays: wholeNumber(1, 365),
    slotIntervalMinutes: wholeNumber(5, 720).refine(
      (n) => n % 5 === 0,
      'Must be a multiple of 5 minutes.',
    ),
    bufferMinutes: wholeNumber(0, 240),
    depositPercent: z
      .string({ error: 'Enter a percentage such as "50.00".' })
      .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a percentage such as "50.00".')
      .refine((s) => Number(s) <= 100, 'Must be between 0 and 100.')
      .transform((s) => Number(s).toFixed(2)),
    depositRefundable: z.boolean({ error: 'Must be true or false.' }),
    refundCutoffHours: wholeNumber(0, 720),
    depositHoldHours: wholeNumber(1, 168),
    minPaymentWindowHours: wholeNumber(1, 72),
    timeZone: z
      .string({ error: 'Enter a time zone such as Africa/Johannesburg.' })
      .refine(
        isValidTimeZone,
        'Enter a time zone such as Africa/Johannesburg.',
      ),
    bankingDetails: z.strictObject(
      {
        accountName: text('account name'),
        bank: text('bank'),
        accountNumber: text('account number'),
        branchCode: text('branch code'),
        accountType: text('account type'),
      },
      { error: 'Enter all five banking details.' },
    ),
    businessName: text('business name'),
    businessEmail: z
      .string({ error: 'Enter a valid email address.' })
      .trim()
      .toLowerCase()
      .pipe(z.email('Enter a valid email address.')),
    businessPhone: z
      .string({ error: 'Enter a South African phone number, or null.' })
      .transform((s, ctx) => {
        const phone = normalizeSouthAfricanPhone(s);
        if (!phone) {
          ctx.addIssue({
            code: 'custom',
            message: 'Enter a South African phone number.',
          });
          return z.NEVER;
        }
        return phone;
      })
      .nullable(),
  })
  .partial();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
