import {
  calculateTravelFee,
  depositBreakdown,
  type TravelRules,
} from './travel-fee.js';

// The travel fee (#115): call-out fee + chargeable km × rate, worked out in
// cents and tenths of a kilometre.

const rules: TravelRules = {
  callOutFee: '50.00',
  ratePerKm: '4.95',
  freeKm: 0,
  maxKm: 30,
  chargeReturn: true,
};
const fee = (meters: number, over: Partial<TravelRules> = {}) =>
  calculateTravelFee(meters, { ...rules, ...over });

describe('calculateTravelFee', () => {
  it('charges the call-out fee plus the rate for the return trip', () => {
    // 10 km each way = 20 km × R4.95 = R99.00, plus R50.00
    expect(fee(10_000)).toEqual({
      distanceKm: '10.0',
      billedKm: '20.0',
      chargeableKm: '20.0',
      callOutFee: '50.00',
      ratePerKm: '4.95',
      kmFee: '99.00',
      travelFee: '149.00',
    });
  });

  it('charges one way only when the return trip is not charged', () => {
    expect(fee(10_000, { chargeReturn: false })).toMatchObject({
      billedKm: '10.0',
      kmFee: '49.50',
      travelFee: '99.50',
    });
  });

  it('does not charge for the free kilometres', () => {
    // 20 km billed, 5 free: 15 km × 4.95 = 74.25
    expect(fee(10_000, { freeKm: 5 })).toMatchObject({
      chargeableKm: '15.0',
      kmFee: '74.25',
      travelFee: '124.25',
    });
  });

  it('charges only the call-out fee inside the free distance', () => {
    expect(fee(2_000, { freeKm: 10 })).toMatchObject({
      chargeableKm: '0.0',
      kmFee: '0.00',
      travelFee: '50.00',
    });
  });

  it('is free when there is no call-out fee and no rate', () => {
    expect(
      fee(10_000, { callOutFee: '0.00', ratePerKm: '0.00' })?.travelFee,
    ).toBe('0.00');
  });

  it('rounds the distance to a tenth of a kilometre and the fee half-up to the cent', () => {
    // 1.04 km -> 1.0 km; 1.05 km -> 1.1 km
    expect(fee(1_049)?.distanceKm).toBe('1.0');
    expect(fee(1_050)?.distanceKm).toBe('1.1');
    // 0.3 km one way, 0.6 km billed × R4.95 = R2.97
    expect(fee(300, { callOutFee: '0.00' })?.kmFee).toBe('2.97');
    // 0.1 km × R0.05 = 0.5 cent -> rounds up to 1 cent
    expect(
      fee(100, { callOutFee: '0.00', ratePerKm: '0.05', chargeReturn: false })
        ?.kmFee,
    ).toBe('0.01');
  });

  it('refuses an address further than the maximum, but not exactly at it', () => {
    expect(fee(30_000)).not.toBeNull();
    expect(fee(30_049)).not.toBeNull(); // rounds to 30.0 km
    expect(fee(30_100)).toBeNull();
    expect(fee(500_000)).toBeNull();
  });

  it('measures the maximum one way, whether or not the return is charged', () => {
    expect(fee(30_000, { chargeReturn: true })).not.toBeNull();
    expect(fee(30_000, { chargeReturn: false })).not.toBeNull();
  });
});

describe('depositBreakdown', () => {
  it('adds the whole travel fee to the deposit and leaves the balance alone', () => {
    // 50% of R650.00 = R325.00; plus R149.00 travel
    expect(depositBreakdown('650.00', '50.00', '149.00')).toEqual({
      servicePart: '325.00',
      travelFee: '149.00',
      deposit: '474.00',
      balance: '325.00',
    });
  });

  it('is the ordinary deposit when there is no travel fee', () => {
    expect(depositBreakdown('650.00', '50.00', '0.00')).toMatchObject({
      deposit: '325.00',
      balance: '325.00',
    });
  });

  it('can owe only the travel fee when the deposit percentage is 0', () => {
    expect(depositBreakdown('650.00', '0.00', '99.50')).toMatchObject({
      deposit: '99.50',
      balance: '650.00',
    });
  });
});
