import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../common/api-error.js';
import { ServicesService } from '../services/services.service.js';
import type { Settings } from '../settings/settings.schema.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  AddressNotFoundError,
  DISTANCE_PROVIDER,
  type DistanceProvider,
} from './distance-provider.js';
import {
  calculateTravelFee,
  depositBreakdown,
  type DepositBreakdown,
  type TravelFee,
} from './travel-fee.js';

export interface TravelQuote {
  travel: TravelFee & { freeKm: number; chargeReturn: boolean };
  price: string;
  deposit: DepositBreakdown;
}

// Works out the travel fee for an address (#115). Used to show the client the
// fee before they book, and again by the booking itself, because the figure
// the page showed is never trusted.
@Injectable()
export class TravelService {
  constructor(
    private readonly settings: SettingsService,
    private readonly services: ServicesService,
    @Inject(DISTANCE_PROVIDER) private readonly distance: DistanceProvider,
  ) {}

  // The fee for travelling to `address`, by the rules in Settings
  async feeFor(address: string, settings?: Settings): Promise<TravelFee> {
    const current = settings ?? (await this.settings.get());
    if (!current.homeAddress) throw unavailable();

    let meters: number;
    try {
      meters = await this.distance.roadDistanceMeters(
        current.homeAddress,
        address,
      );
    } catch (error) {
      if (error instanceof AddressNotFoundError) {
        // The owner's own address not being found is hers to fix, not the
        // client's: they are told to try again or choose her place
        if (error.which === 'home') throw unavailable();
        throw new ApiException(
          400,
          'ADDRESS_NOT_FOUND',
          "We couldn't find that address. Please check it, and include the suburb and town.",
          [
            {
              field: 'appointmentAddress',
              message: 'Check the address.',
            },
          ],
        );
      }
      throw unavailable();
    }

    const fee = calculateTravelFee(meters, {
      callOutFee: current.travelCallOutFee,
      ratePerKm: current.travelRatePerKm,
      freeKm: current.travelFreeKm,
      maxKm: current.travelMaxKm,
      chargeReturn: current.travelChargeReturn,
    });
    if (!fee) {
      throw new ApiException(
        400,
        'TOO_FAR',
        `That address is further than we travel (${current.travelMaxKm} km). Please choose our place instead.`,
        [{ field: 'appointmentAddress', message: 'Too far to travel.' }],
      );
    }
    return fee;
  }

  // POST /api/travel/quote: the fee and the new deposit for a service
  async quote(serviceId: string, address: string): Promise<TravelQuote> {
    const service = await this.services.findActive(serviceId);
    if (!service) {
      throw new ApiException(
        400,
        'SERVICE_UNAVAILABLE',
        "That service isn't available.",
      );
    }
    if (!service.availableForTravel) {
      throw new ApiException(
        400,
        'TRAVEL_NOT_OFFERED',
        "That service isn't offered at the client's place.",
      );
    }
    const settings = await this.settings.get();
    const travel = await this.feeFor(address, settings);
    const price = await this.services.priceOf(service.id);
    return {
      travel: {
        ...travel,
        freeKm: settings.travelFreeKm,
        chargeReturn: settings.travelChargeReturn,
      },
      price,
      deposit: depositBreakdown(
        price,
        settings.depositPercent,
        travel.travelFee,
      ),
    };
  }
}

function unavailable(): ApiException {
  return new ApiException(
    503,
    'TRAVEL_UNAVAILABLE',
    "We can't work out the travel fee right now. Please try again in a moment, or choose our place.",
  );
}
