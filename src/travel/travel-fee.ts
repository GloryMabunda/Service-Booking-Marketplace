import { formatCents, percentOf, toCents } from '../common/money.js';

// The travel fee (#115): a call-out fee plus a rate per kilometre, worked out
// in whole cents and tenths of a kilometre so there are no rounding surprises.
//
//   billed km     = one-way km, or twice that when the return trip is charged
//   chargeable km = billed km minus the free km, never below 0
//   travel fee    = call-out fee + chargeable km × rate per km (half-up to the cent)

export interface TravelRules {
  callOutFee: string; // "50.00"
  ratePerKm: string; // "4.95"
  freeKm: number;
  maxKm: number; // the furthest the owner travels, one way
  chargeReturn: boolean;
}

export interface TravelFee {
  distanceKm: string; // one way, one decimal: "12.3"
  billedKm: string;
  chargeableKm: string;
  callOutFee: string;
  ratePerKm: string;
  kmFee: string;
  travelFee: string;
}

const tenths = (value: number) => (value / 10).toFixed(1);

// Returns null when the address is further than the maximum distance
export function calculateTravelFee(
  roadDistanceMeters: number,
  rules: TravelRules,
): TravelFee | null {
  const oneWay = Math.round(roadDistanceMeters / 100); // tenths of a km
  if (oneWay > rules.maxKm * 10) return null;

  const billed = rules.chargeReturn ? oneWay * 2 : oneWay;
  const chargeable = Math.max(0, billed - rules.freeKm * 10);
  const callOut = toCents(rules.callOutFee);
  const kmFee = Math.floor(
    (chargeable * toCents(rules.ratePerKm) + 5) / 10, // tenths of a km × cents per km
  );
  return {
    distanceKm: tenths(oneWay),
    billedKm: tenths(billed),
    chargeableKm: tenths(chargeable),
    callOutFee: formatCents(callOut),
    ratePerKm: formatCents(toCents(rules.ratePerKm)),
    kmFee: formatCents(kmFee),
    travelFee: formatCents(callOut + kmFee),
  };
}

// What the client pays now and on the day (#115): the deposit is the deposit
// percentage of the service price plus the whole travel fee, so a wasted trip
// is never unpaid. The balance is what is left of the service price.
export interface DepositBreakdown {
  servicePart: string; // deposit % of the price
  travelFee: string;
  deposit: string; // servicePart + travelFee, paid upfront
  balance: string; // price minus servicePart, paid on the day
}

export function depositBreakdown(
  price: string,
  depositPercent: string,
  travelFee: string,
): DepositBreakdown {
  const servicePart = percentOf(depositPercent, price);
  return {
    servicePart,
    travelFee,
    deposit: formatCents(toCents(servicePart) + toCents(travelFee)),
    balance: formatCents(toCents(price) - toCents(servicePart)),
  };
}
