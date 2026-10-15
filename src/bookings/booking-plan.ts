import { formatCents, toCents } from '../common/money.js';
import type { Settings } from '../settings/settings.schema.js';
import { depositBreakdown, type TravelFee } from '../travel/travel-fee.js';

// What a new booking will look like (BR-3, BR-4, BR-7, BR-9, #42, #46, #115),
// worked out from the service, the settings and the chosen start time. Pure:
// the caller saves the result. Everything here is a snapshot, so later edits
// to the service or the settings never change an existing booking (BR-4).

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export interface BookingPlan {
  startAt: Date;
  endAt: Date; // the appointment's end, without the buffer
  // What the booking blocks: from occupiedFrom (travel time before) to
  // occupiedUntil (the buffer and travel time after)
  occupiedFrom: Date;
  occupiedUntil: Date;
  priceAtBooking: string; // "650.00"
  depositAmount: string; // "325.00", or more with a travel fee
  // Where the appointment is: the owner's place, or the client's (#115)
  location: 'studio' | 'client';
  appointmentAddress: string | null;
  travelDistanceKm: string | null; // one way, "12.3"
  travelCallOutFee: string | null;
  travelRatePerKm: string | null;
  travelFee: string; // "0.00" at the owner's place
  // Pending while a deposit is due; Confirmed straight away when there is none
  status: 'pending' | 'confirmed';
  depositDueAt: Date | null; // null when Confirmed
}

type PlanSettings = Pick<
  Settings,
  'depositPercent' | 'depositHoldHours' | 'minNoticeHours' | 'bufferMinutes'
>;

// An appointment at the client's place (#115)
export interface TravelPlan {
  address: string;
  fee: TravelFee;
  extraMinutes: number; // travel time blocked before and after
}

export function planBooking(input: {
  service: { price: string; durationMinutes: number };
  settings: PlanSettings;
  startAt: Date;
  now: Date;
  travel?: TravelPlan;
}): BookingPlan {
  const { service, settings, startAt, now, travel } = input;

  const endAt = new Date(
    startAt.getTime() + service.durationMinutes * MINUTE_MS,
  );
  const extra = (travel?.extraMinutes ?? 0) * MINUTE_MS;
  const occupiedFrom = new Date(startAt.getTime() - extra);
  const occupiedUntil = new Date(
    endAt.getTime() + settings.bufferMinutes * MINUTE_MS + extra,
  );

  // BR-7: the deposit is the global percentage of the service price, rounded
  // half-up to the cent, and stored on the booking. A travel fee is added to
  // it in full (#115), so a wasted trip is never unpaid.
  const priceAtBooking = formatCents(toCents(service.price));
  const travelFee = travel?.fee.travelFee ?? '0.00';
  const depositAmount = depositBreakdown(
    priceAtBooking,
    settings.depositPercent,
    travelFee,
  ).deposit;
  const common = {
    startAt,
    endAt,
    occupiedFrom,
    occupiedUntil,
    priceAtBooking,
    depositAmount,
    location: travel ? ('client' as const) : ('studio' as const),
    appointmentAddress: travel?.address ?? null,
    travelDistanceKm: travel?.fee.distanceKm ?? null,
    travelCallOutFee: travel?.fee.callOutFee ?? null,
    travelRatePerKm: travel?.fee.ratePerKm ?? null,
    travelFee,
  };

  // BR-3: no deposit, no Pending stage. A deposit "applies" when it comes to
  // more than R0.00, so a free service, or a percentage that rounds down to
  // nothing, is Confirmed at once: there is nothing for the client to pay.
  if (toCents(depositAmount) === 0) {
    return { ...common, status: 'confirmed', depositDueAt: null };
  }

  // BR-9: the deadline is the earlier of the hold duration after booking and
  // the minimum-notice cutoff before the appointment. A booking offered by the
  // slot rules always leaves at least the minimum payment window before it.
  const holdEnds = now.getTime() + settings.depositHoldHours * HOUR_MS;
  const cutoff = startAt.getTime() - settings.minNoticeHours * HOUR_MS;
  return {
    ...common,
    status: 'pending',
    depositDueAt: new Date(Math.min(holdEnds, cutoff)),
  };
}
