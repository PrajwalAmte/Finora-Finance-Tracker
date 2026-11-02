import { exchangeGoogleToken, googleEnv } from '../_lib/googleToken.js';

/** POST /api/google/token — see api/_lib/googleToken.ts. */
export function POST(request: Request): Promise<Response> {
  return exchangeGoogleToken(request, googleEnv());
}
