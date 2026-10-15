import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import { isoUtc } from '../availability/time-zone.js';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import type {
  BankingDetails,
  Settings,
  SettingsPatch,
} from './settings.schema.js';

// Reads and changes the single settings row (#28). Other modules (slots,
// bookings, emails, the home page) get their rules from get().
@Injectable()
export class SettingsService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async get(): Promise<Settings> {
    const row = await this.db
      .selectFrom('settings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirst();
    // The seed_settings migration creates the row, so this means the
    // database hasn't been migrated.
    if (!row)
      throw new Error('The settings row is missing: run the migrations.');
    return toSettings(row);
  }

  // Applies a validated patch and returns the full settings. Changes affect
  // new bookings only: each booking keeps its own copy of the rules it used.
  async update(patch: SettingsPatch, userId: string): Promise<Settings> {
    return this.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('settings')
        .select(['deposit_hold_hours', 'min_payment_window_hours'])
        .where('id', '=', 1)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // BR-9: the minimum payment window can't be longer than the hold.
      const hold = patch.depositHoldHours ?? current.deposit_hold_hours;
      const window =
        patch.minPaymentWindowHours ?? current.min_payment_window_hours;
      if (window > hold) {
        throw new ApiException(
          400,
          'VALIDATION_FAILED',
          'Some details are missing or invalid.',
          [
            {
              field:
                patch.minPaymentWindowHours !== undefined
                  ? 'minPaymentWindowHours'
                  : 'depositHoldHours',
              message: `The minimum payment window (${window} h) can't be longer than the deposit hold (${hold} h).`,
            },
          ],
        );
      }

      await trx
        .updateTable('settings')
        .set({
          min_notice_hours: patch.minNoticeHours,
          max_advance_days: patch.maxAdvanceDays,
          slot_interval_minutes: patch.slotIntervalMinutes,
          buffer_minutes: patch.bufferMinutes,
          deposit_percent: patch.depositPercent,
          deposit_refundable: patch.depositRefundable,
          refund_cutoff_hours: patch.refundCutoffHours,
          deposit_hold_hours: patch.depositHoldHours,
          min_payment_window_hours: patch.minPaymentWindowHours,
          time_zone: patch.timeZone,
          banking_details:
            patch.bankingDetails && JSON.stringify(patch.bankingDetails),
          business_name: patch.businessName,
          business_email: patch.businessEmail,
          business_phone: patch.businessPhone,
          home_address: patch.homeAddress,
          travel_call_out_fee: patch.travelCallOutFee,
          travel_rate_per_km: patch.travelRatePerKm,
          travel_free_km: patch.travelFreeKm,
          travel_max_km: patch.travelMaxKm,
          travel_charge_return: patch.travelChargeReturn,
          travel_extra_minutes: patch.travelExtraMinutes,
          updated_at: new Date(),
          updated_by: userId,
        })
        .where('id', '=', 1)
        .execute();

      const row = await trx
        .selectFrom('settings')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      return toSettings(row);
    });
  }
}

function toSettings(row: Selectable<DB['settings']>): Settings {
  return {
    minNoticeHours: row.min_notice_hours,
    maxAdvanceDays: row.max_advance_days,
    slotIntervalMinutes: row.slot_interval_minutes,
    bufferMinutes: row.buffer_minutes,
    depositPercent: row.deposit_percent,
    depositRefundable: row.deposit_refundable,
    refundCutoffHours: row.refund_cutoff_hours,
    depositHoldHours: row.deposit_hold_hours,
    minPaymentWindowHours: row.min_payment_window_hours,
    timeZone: row.time_zone,
    bankingDetails: row.banking_details as unknown as BankingDetails,
    businessName: row.business_name,
    businessEmail: row.business_email,
    businessPhone: row.business_phone,
    homeAddress: row.home_address,
    travelCallOutFee: row.travel_call_out_fee,
    travelRatePerKm: row.travel_rate_per_km,
    travelFreeKm: row.travel_free_km,
    travelMaxKm: row.travel_max_km,
    travelChargeReturn: row.travel_charge_return,
    travelExtraMinutes: row.travel_extra_minutes,
    updatedAt: isoUtc(new Date(row.updated_at)),
  };
}
