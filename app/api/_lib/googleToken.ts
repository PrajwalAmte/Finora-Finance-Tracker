/**
 * Google OAuth token exchange for the PWA's "Save vault to Google Drive" option.
 *
 * Google only issues refresh tokens to clients that hold a client secret, and a secret cannot live
 * in a web page, so this one step runs on the server. It forwards a code or refresh token to Google
 * and returns Google's answer. It never sees vault data, and it stores and logs nothing.
 *
 *   POST /api/google/token  { code, codeVerifier, redirectUri }  → { access_token, expires_in, refresh_token, id_token }
 *   POST /api/google/token  { refreshToken }                      → { access_token, expires_in }
 */

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface GoogleEnv {
  clientId?: string;
  clientSecret?: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function exchangeGoogleToken(request: Request, env: GoogleEnv, fetcher: Fetcher = fetch): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return json(403, { error: 'forbidden' });
  if (!env.clientId || !env.clientSecret) return json(501, { error: 'not_configured' });

  let body: { code?: unknown; codeVerifier?: unknown; redirectUri?: unknown; refreshToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'bad_json' });
  }

  const form = new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret });
  if (typeof body.refreshToken === 'string' && body.refreshToken) {
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', body.refreshToken);
  } else if (typeof body.code === 'string' && typeof body.codeVerifier === 'string' && typeof body.redirectUri === 'string') {
    // The redirect URI must be this site's own address; Google also checks it against the client.
    const origin = new URL(request.url).origin;
    if (new URL(body.redirectUri).origin !== origin) return json(400, { error: 'bad_redirect' });
    form.set('grant_type', 'authorization_code');
    form.set('code', body.code);
    form.set('code_verifier', body.codeVerifier);
    form.set('redirect_uri', body.redirectUri);
  } else {
    return json(400, { error: 'bad_request' });
  }

  let res: Response;
  try {
    res = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  } catch {
    return json(502, { error: 'upstream_unreachable' });
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return json(res.status === 400 || res.status === 401 ? 400 : 502, { error: data.error ?? 'upstream_error' });
  // Pass through only what the app needs.
  const out: Record<string, unknown> = { access_token: data.access_token, expires_in: data.expires_in };
  if (data.refresh_token) out.refresh_token = data.refresh_token;
  if (data.id_token) out.id_token = data.id_token;
  return json(200, out);
}

export function googleEnv(): GoogleEnv {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return { clientId: env.GOOGLE_CLIENT_ID ?? env.VITE_GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}
