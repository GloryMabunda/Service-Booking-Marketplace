import type { Settings } from '../settings/settings.schema.js';

// The travel rules clients may see before they book (GET /api/services). The
// owner's home address is deliberately not part of it.
export interface TravelTerms {
  callOutFee: string;
  ratePerKm: string;
  freeKm: number;
  maxKm: number;
  chargeReturn: boolean;
}

// Travel is offered once the owner has entered her home address (#115)
export function travelTerms(
  settings: Pick<
    Settings,
    | 'homeAddress'
    | 'travelCallOutFee'
    | 'travelRatePerKm'
    | 'travelFreeKm'
    | 'travelMaxKm'
    | 'travelChargeReturn'
  >,
): TravelTerms | null {
  if (!settings.homeAddress) return null;
  return {
    callOutFee: settings.travelCallOutFee,
    ratePerKm: settings.travelRatePerKm,
    freeKm: settings.travelFreeKm,
    maxKm: settings.travelMaxKm,
    chargeReturn: settings.travelChargeReturn,
  };
}
