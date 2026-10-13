import { formatCents, percentOf, toCents } from '../common/money.js';
import type { Settings } from '../settings/settings.schema.js';

// What a new booking will look like (BR-3, BR-4, BR-7, BR-9, #42, #46),
// worked out from the service, the settings and the chosen start time. Pure:
// the caller saves the result. Everything here is a snapshot, so later edits
// to the service or the settings never change an existing booking (BR-4).

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export interface BookingPlan {
  startAt: Date;
  endAt: Date; // the appointment's end, without the buffer
  occupiedUntil: Date; // endAt plus the buffer: what the booking blocks
  priceAtBooking: string; // "650.00"
  depositAmount: string; // "325.00"
  // Pending while a deposit is due; Confirmed straight away when there is none
  status: 'pending' | 'confirmed';
  depositDueAt: Date | null; // null when Confirmed
}

type PlanSettings = Pick<
  Settings,
  'depositPercent' | 'depositHoldHours' | 'minNoticeHours' | 'bufferMinutes'
>;

export function planBooking(input: {
  service: { price: string; durationMinutes: number };
  settings: PlanSettings;
  startAt: Date;
  now: Date;
}): BookingPlan {
  const { service, settings, startAt, now } = input;

  const endAt = new Date(
    startAt.getTime() + service.durationMinutes * MINUTE_MS,
  );
  const occupiedUntil = new Date(
    endAt.getTime() + settings.bufferMinutes * MINUTE_MS,
  );

  // BR-7: the deposit is the global percentage of the service price, rounded
  // half-up to the cent, and stored on the booking.
  const priceAtBooking = formatCents(toCents(service.price));
  const depositAmount = percentOf(settings.depositPercent, priceAtBooking);

  // BR-3: no deposit, no Pending stage. A deposit "applies" when it comes to
  // more than R0.00, so a free service, or a percentage that rounds down to
  // nothing, is Confirmed at once: there is nothing for the client to pay.
  if (toCents(depositAmount) === 0) {
    return {
      startAt,
      endAt,
      occupiedUntil,
      priceAtBooking,
      depositAmount,
      status: 'confirmed',
      depositDueAt: null,
    };
  }

  // BR-9: the deadline is the earlier of the hold duration after booking and
  // the minimum-notice cutoff before the appointment. A booking offered by the
  // slot rules always leaves at least the minimum payment window before it.
  const holdEnds = now.getTime() + settings.depositHoldHours * HOUR_MS;
  const cutoff = startAt.getTime() - settings.minNoticeHours * HOUR_MS;
  return {
    startAt,
    endAt,
    occupiedUntil,
    priceAtBooking,
    depositAmount,
    status: 'pending',
    depositDueAt: new Date(Math.min(holdEnds, cutoff)),
  };
}
