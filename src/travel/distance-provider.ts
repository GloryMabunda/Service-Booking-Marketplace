import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

// How the road distance between two addresses is found. The travel service only
// knows this interface, so tests use a fake and production uses OpenRouteService
// (#115, docs/travel.md).

// An address the maps service can't find
export class AddressNotFoundError extends Error {
  constructor(readonly which: 'home' | 'client') {
    super(`The ${which} address could not be found`);
  }
}

// The maps service is not set up, is down, or is refusing requests
export class DistanceUnavailableError extends Error {}

export interface DistanceProvider {
  // The driving distance in metres from `from` to `to`
  roadDistanceMeters(from: string, to: string): Promise<number>;
}

export const DISTANCE_PROVIDER = Symbol('DISTANCE_PROVIDER');

// Used when no OPENROUTESERVICE_API_KEY is set: travel bookings say honestly
// that they are not available
export class NoDistanceProvider implements DistanceProvider {
  roadDistanceMeters(): Promise<number> {
    return Promise.reject(
      new DistanceUnavailableError(
        'No maps service is set up (OPENROUTESERVICE_API_KEY is empty)',
      ),
    );
  }
}

const DEFAULT_BASE = 'https://api.openrouteservice.org';
const DAY_MS = 24 * 3_600_000;
const MAX_CACHED = 500;

interface Cached<T> {
  value: T;
  expires: number;
}

// OpenRouteService (https://openrouteservice.org): the address is turned into
// a point (geocoding), then the driving route between the two points gives the
// distance. Results are remembered for a day so the free daily allowance isn't
// spent on repeat questions, and so a visitor retyping an address costs nothing.
@Injectable()
export class OpenRouteServiceProvider implements DistanceProvider {
  private readonly logger = new Logger(OpenRouteServiceProvider.name);
  private readonly points = new Map<string, Cached<[number, number]>>();
  private readonly routes = new Map<string, Cached<number>>();

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
    private readonly base: string = DEFAULT_BASE,
  ) {}

  async roadDistanceMeters(from: string, to: string): Promise<number> {
    const key = `${normalise(from)}|${normalise(to)}`;
    const known = this.recall(this.routes, key);
    if (known !== undefined) return known;

    const start = await this.locate(from, 'home');
    const end = await this.locate(to, 'client');
    const body = await this.call(`${this.base}/v2/directions/driving-car`, {
      method: 'POST',
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ coordinates: [start, end] }),
    });
    const meters = (body as { routes?: { summary?: { distance?: unknown } }[] })
      .routes?.[0]?.summary?.distance;
    if (typeof meters !== 'number' || !Number.isFinite(meters)) {
      // Two points the roads don't connect (an island, a river, a bad pin)
      throw new AddressNotFoundError('client');
    }
    this.remember(this.routes, key, meters);
    return meters;
  }

  private async locate(
    address: string,
    which: 'home' | 'client',
  ): Promise<[number, number]> {
    const key = normalise(address);
    const known = this.recall(this.points, key);
    if (known) return known;

    const url = new URL(`${this.base}/geocode/search`);
    url.searchParams.set('text', address);
    url.searchParams.set('boundary.country', 'ZA');
    url.searchParams.set('size', '1');
    const body = await this.call(url.toString(), {
      headers: { Authorization: this.apiKey },
    });
    const feature = (
      body as {
        features?: {
          geometry?: { coordinates?: unknown };
          properties?: { confidence?: unknown };
        }[];
      }
    ).features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    const confidence = feature?.properties?.confidence;
    if (
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      typeof coordinates[0] !== 'number' ||
      typeof coordinates[1] !== 'number' ||
      (typeof confidence === 'number' && confidence < 0.4)
    ) {
      throw new AddressNotFoundError(which);
    }
    const point: [number, number] = [coordinates[0], coordinates[1]];
    this.remember(this.points, key, point);
    return point;
  }

  // One request, with a time limit. An address is personal information, so
  // only the kind of failure is logged, never the address.
  private async call(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        ...init,
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      this.logger.error(
        `The maps service could not be reached: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      throw new DistanceUnavailableError(
        'The maps service could not be reached',
      );
    }
    // 404 from the router means "no route between these points"
    if (response.status === 404) throw new AddressNotFoundError('client');
    if (!response.ok) {
      this.logger.error(`The maps service answered ${response.status}`);
      throw new DistanceUnavailableError(
        `The maps service answered ${response.status}`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new DistanceUnavailableError('The maps service sent nonsense');
    }
  }

  private recall<T>(cache: Map<string, Cached<T>>, key: string): T | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expires < this.clock()) {
      cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  private remember<T>(cache: Map<string, Cached<T>>, key: string, value: T) {
    if (cache.size >= MAX_CACHED) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { value, expires: this.clock() + DAY_MS });
  }
}

function normalise(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function createDistanceProvider(
  config: ConfigService<Env, true>,
): DistanceProvider {
  const key = config.get('OPENROUTESERVICE_API_KEY', { infer: true });
  const base = config.get('OPENROUTESERVICE_URL', { infer: true });
  return key
    ? new OpenRouteServiceProvider(key, fetch, Date.now, base)
    : new NoDistanceProvider();
}
