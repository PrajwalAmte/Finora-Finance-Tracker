/**
 * Price relay for the PWA, served as Vercel Functions on the app's own domain:
 *
 *   GET /api/amfi            → AMFI's daily NAV file (identical for everyone; CDN-cached 6 h)
 *   GET /api/yahoo/:symbol   → Yahoo Finance chart JSON for one listed symbol (CDN-cached 5 min)
 *
 * Browsers cannot call AMFI or Yahoo directly (no CORS headers); the native apps do. Nothing else
 * is relayed: no arbitrary URLs, no request headers or cookies forwarded, and nothing is stored.
 * Files under api/_lib are not exposed as functions by Vercel.
 */

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const YAHOO_URL = (symbol: string) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
/** NSE/BSE tickers and indices: INFY.NS, NIFTYBEES.NS, 500325.BO, ^NSEI, M&M.NS, BAJAJ-AUTO.NS */
const SYMBOL = /^[A-Z0-9^][A-Z0-9.&^-]{0,24}$/;

function plain(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
}

/**
 * Route one request. Browsers tag every request with Sec-Fetch-Site; anything a page on another
 * site sends is refused, so other websites cannot use this as their price feed. (Older browsers
 * omit the header and are allowed.)
 */
export async function routePriceRequest(request: Request, fetcher: Fetcher = fetch): Promise<Response> {
  if (request.method !== 'GET') return plain(405, 'Method not allowed');
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return plain(403, 'Forbidden');

  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  let upstream: string;
  let ttl: number;
  let type: string;
  if (path === '/api/amfi') {
    upstream = AMFI_URL;
    ttl = 6 * 3600;
    type = 'text/plain; charset=utf-8';
  } else if (path.startsWith('/api/yahoo/')) {
    let symbol: string;
    try {
      symbol = decodeURIComponent(path.slice('/api/yahoo/'.length)).toUpperCase();
    } catch {
      return plain(400, 'Bad symbol');
    }
    if (!SYMBOL.test(symbol)) return plain(400, 'Bad symbol');
    upstream = YAHOO_URL(symbol);
    ttl = 300;
    type = 'application/json; charset=utf-8';
  } else {
    return plain(404, 'Not found');
  }

  let res: Response;
  try {
    res = await fetcher(upstream, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FinoraPrices/1.0)', Accept: '*/*' } });
  } catch {
    return plain(502, 'Upstream unreachable');
  }
  if (!res.ok) return plain(502, `Upstream returned ${res.status}`);

  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': type,
      // s-maxage: Vercel's CDN answers repeat requests itself, so the function and AMFI are hit rarely.
      'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=${ttl}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
