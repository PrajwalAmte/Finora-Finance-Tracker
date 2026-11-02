import { routePriceRequest } from './_lib/priceProxy.js';

/** GET /api/amfi — AMFI's daily NAV file for the PWA. */
export function GET(request: Request): Promise<Response> {
  return routePriceRequest(request);
}
