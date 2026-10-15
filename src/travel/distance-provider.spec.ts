import {
  AddressNotFoundError,
  DistanceUnavailableError,
  NoDistanceProvider,
  OpenRouteServiceProvider,
} from './distance-provider.js';

// The OpenRouteService provider (#115) against a faked network: it finds both
// addresses, asks for the driving route, remembers answers, and turns every
// kind of failure into one of two errors the rest of the app understands.

const point = (lon: number, lat: number, confidence = 0.9) => ({
  features: [
    {
      geometry: { coordinates: [lon, lat] },
      properties: { confidence },
    },
  ],
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

// A fetch that answers by the address in the request
function network(
  over: {
    geocode?: (text: string) => Response;
    route?: () => Response;
  } = {},
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const parsed = new URL(url);
    if (parsed.pathname === '/geocode/search') {
      const text = parsed.searchParams.get('text') ?? '';
      return Promise.resolve(
        over.geocode
          ? over.geocode(text)
          : json(
              text.toLowerCase().includes('home')
                ? point(28.0, -26.0)
                : point(28.1, -26.1),
            ),
      );
    }
    return Promise.resolve(
      over.route?.() ?? json({ routes: [{ summary: { distance: 12345.6 } }] }),
    );
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('OpenRouteServiceProvider', () => {
  it('geocodes both addresses in South Africa and returns the driving distance', async () => {
    const { fetchFn, calls } = network();
    const provider = new OpenRouteServiceProvider('KEY', fetchFn);
    expect(await provider.roadDistanceMeters('1 Home St', '9 Client Rd')).toBe(
      12345.6,
    );
    const geocodes = calls.filter((c) => c.url.includes('/geocode/search'));
    expect(geocodes).toHaveLength(2);
    expect(geocodes[0].url).toContain('boundary.country=ZA');
    const route = calls.find((c) => c.url.includes('/v2/directions'));
    expect(JSON.parse(route!.init!.body as string)).toEqual({
      coordinates: [
        [28.0, -26.0],
        [28.1, -26.1],
      ],
    });
  });

  it('sends the key in a header, never in the address', async () => {
    const { fetchFn, calls } = network();
    await new OpenRouteServiceProvider(
      'SECRET-KEY',
      fetchFn,
    ).roadDistanceMeters('a', 'b');
    for (const call of calls) {
      expect(call.url).not.toContain('SECRET-KEY');
      expect((call.init!.headers as Record<string, string>).Authorization).toBe(
        'SECRET-KEY',
      );
    }
  });

  it('remembers an answer, so a repeat costs nothing', async () => {
    const { fetchFn, calls } = network();
    const provider = new OpenRouteServiceProvider('KEY', fetchFn);
    await provider.roadDistanceMeters('1 Home St', '9 Client Rd');
    const before = calls.length;
    await provider.roadDistanceMeters('  1 HOME st ', '9 client   rd');
    expect(calls.length).toBe(before);
  });

  it('remembers a place for a new destination, and forgets after a day', async () => {
    let now = 1_000_000;
    const { fetchFn, calls } = network();
    const provider = new OpenRouteServiceProvider('KEY', fetchFn, () => now);
    await provider.roadDistanceMeters('1 Home St', '9 Client Rd');
    calls.length = 0;
    // The home address is known; only the new address and the route are asked
    await provider.roadDistanceMeters('1 Home St', '5 Other Rd');
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/geocode/search',
      '/v2/directions/driving-car',
    ]);
    now += 25 * 3_600_000;
    calls.length = 0;
    await provider.roadDistanceMeters('1 Home St', '9 Client Rd');
    expect(calls.length).toBe(3);
  });

  it('says the client address was not found when the geocoder finds nothing', async () => {
    const { fetchFn } = network({
      geocode: (text) =>
        text.includes('Nowhere')
          ? json({ features: [] })
          : json(point(28, -26)),
    });
    const error = await new OpenRouteServiceProvider('KEY', fetchFn)
      .roadDistanceMeters('1 Home St', 'Nowhere Lane')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AddressNotFoundError);
    expect((error as AddressNotFoundError).which).toBe('client');
  });

  it('says the home address was not found when it is the one that fails', async () => {
    const { fetchFn } = network({ geocode: () => json({ features: [] }) });
    const error = await new OpenRouteServiceProvider('KEY', fetchFn)
      .roadDistanceMeters('1 Home St', '9 Client Rd')
      .catch((e: unknown) => e);
    expect((error as AddressNotFoundError).which).toBe('home');
  });

  it('treats a vague match as not found', async () => {
    const { fetchFn } = network({ geocode: () => json(point(28, -26, 0.1)) });
    await expect(
      new OpenRouteServiceProvider('KEY', fetchFn).roadDistanceMeters('a', 'b'),
    ).rejects.toBeInstanceOf(AddressNotFoundError);
  });

  it('treats “no route” as an address problem', async () => {
    const { fetchFn } = network({ route: () => json({}, 404) });
    await expect(
      new OpenRouteServiceProvider('KEY', fetchFn).roadDistanceMeters('a', 'b'),
    ).rejects.toBeInstanceOf(AddressNotFoundError);
    const empty = network({ route: () => json({ routes: [] }) });
    await expect(
      new OpenRouteServiceProvider('KEY', empty.fetchFn).roadDistanceMeters(
        'a',
        'b',
      ),
    ).rejects.toBeInstanceOf(AddressNotFoundError);
  });

  it.each([401, 403, 429, 500, 503])(
    'is unavailable when the maps service answers %i',
    async (status) => {
      const { fetchFn } = network({ geocode: () => json({}, status) });
      await expect(
        new OpenRouteServiceProvider('KEY', fetchFn).roadDistanceMeters(
          'a',
          'b',
        ),
      ).rejects.toBeInstanceOf(DistanceUnavailableError);
    },
  );

  it('is unavailable when the network fails or the answer is not JSON', async () => {
    const down = (() =>
      Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    await expect(
      new OpenRouteServiceProvider('KEY', down).roadDistanceMeters('a', 'b'),
    ).rejects.toBeInstanceOf(DistanceUnavailableError);
    const junk = (() =>
      Promise.resolve(new Response('<html>', { status: 200 }))) as typeof fetch;
    await expect(
      new OpenRouteServiceProvider('KEY', junk).roadDistanceMeters('a', 'b'),
    ).rejects.toBeInstanceOf(DistanceUnavailableError);
  });
});

describe('NoDistanceProvider', () => {
  it('is unavailable, with a reason', async () => {
    await expect(new NoDistanceProvider().roadDistanceMeters()).rejects.toThrow(
      /OPENROUTESERVICE_API_KEY/,
    );
  });
});
