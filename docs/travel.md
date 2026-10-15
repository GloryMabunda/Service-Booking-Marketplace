# Travel fees and the maps service

Decided in #115 (October 2026). The rules are BR-17 and C-10 in the [specification](specification.md); the API is [4.8](api.md#48-post-apitravelquote) and the settings are [7.15](api.md#715-settings).

## What the client sees

1. On the date and time step, for a service that can be done at the client's place, they choose **At our place** or **At your place**, with a plain explanation of the fee.
2. On the details step they type the address and press **Work out the travel fee**. They see the distance, the breakdown (call-out + kilometres × rate) and the new deposit. The Book button stays off until the fee has been worked out for exactly that address.
3. The server works the fee out again when the booking is made. The page's figure is never trusted.

## How the fee is worked out

```
billed km     = one-way road km, doubled when the trip back is charged
chargeable km = billed km − free km   (never below 0)
travel fee    = call-out fee + chargeable km × rate per km   (half-up to the cent)
deposit       = deposit % of the service price + the whole travel fee
balance       = service price − the deposit % part
```

Distances are worked out in tenths of a kilometre and fees in cents. Example (call-out R50, R4.95/km, return charged, 10 km each way): 20 km × R4.95 = R99.00, plus R50.00 = **R149.00**; for a R650 service at 50%, the deposit is R325 + R149 = **R474** and the balance R325. The code is `src/travel/travel-fee.ts`.

An address further than the maximum distance (one way) is refused. Extra travel time (default 30 minutes) is kept free before and after a travel appointment, on top of the normal buffer.

## Which maps service, and why

**OpenRouteService (ORS)** by HeiGIT, at <https://openrouteservice.org>.

| | OpenRouteService | Google Maps (Distance Matrix) |
| --- | --- | --- |
| Cost | Free plan, no card needed: published daily limits of about 2,000 routes and 1,000 address look-ups (check the current plan when you sign up) | A Google Cloud account with a billing card; a monthly free credit, then per-request charges |
| Fit for v1 | A one-person business makes a handful of quotes a day | Far more than needed |
| Risk | Free-plan limits and fair use; the service is run by a research institute | Surprise bills if a script or bot calls it a lot |
| Data | Addresses go to a German service. No names, emails or phones are sent | Addresses go to Google |

ORS was chosen because it costs nothing, needs no billing card, and is enough for this volume. The code only knows the `DistanceProvider` interface (`src/travel/distance-provider.ts`), so Google, or a paid ORS plan, can be added without touching the booking code.

**How the key is stored.** The key is a secret: it lives only in the environment variable `OPENROUTESERVICE_API_KEY` (your local `.env`, or the hosting provider's secret settings). It is never committed, never sent to the browser, and sent to ORS in a request header, not in the address. Without it, travel bookings say they are unavailable and nothing else is affected.

**Protecting the allowance.** Each call to `POST /api/travel/quote` may use a look-up, so it is limited to 15 a minute per visitor, and the provider remembers each address and route for a day (up to 500). A booking asks again, but usually hits that memory.

**What the code asks ORS:**

1. `GET /geocode/search` for each address, limited to South Africa, taking the best match. A match with confidence under 0.4 counts as "not found".
2. `POST /v2/directions/driving-car` between the two points, taking the route's distance in metres.

Failures become two cases the app understands: an address that can't be found (`ADDRESS_NOT_FOUND`, "check the address") and the service being unavailable (`TRAVEL_UNAVAILABLE`, "try again or choose our place", nothing saved). The reason is logged without the address.

## Getting a key (for the owner)

1. Create a free account at <https://openrouteservice.org/dev/#/signup>.
2. Create a token ("Request a token", type Free) and copy it.
3. Put it in `.env` as `OPENROUTESERVICE_API_KEY=` (and in the hosting provider's secrets later), then restart the app.
4. In **Settings → Travel to clients**, enter your home address and fees, and switch on **Can be done at the client's place** for the services that allow it.

Until step 3 is done, clients can't choose "At your place" successfully: they are told travel isn't available and offered your place.

## Trying it without a key

`OPENROUTESERVICE_URL` can point the app at a stand-in service while you develop; leave it empty in real use. The automated tests never call the real service: they use a fake provider.
