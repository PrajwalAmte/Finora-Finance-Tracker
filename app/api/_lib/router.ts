import { routePriceRequest } from './priceProxy';
import { exchangeGoogleToken, googleEnv } from './googleToken';

/** Same routing Vercel does from the api/ folder, for the Vite dev and preview servers. */
export function routeApi(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/api/google/token') return exchangeGoogleToken(request, googleEnv());
  return routePriceRequest(request);
}
