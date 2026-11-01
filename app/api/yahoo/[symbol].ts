import { routePriceRequest } from '../_lib/priceProxy';

/** GET /api/yahoo/:symbol — one Yahoo Finance quote for the PWA. */
export function GET(request: Request): Promise<Response> {
  return routePriceRequest(request);
}
