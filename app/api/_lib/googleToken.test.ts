import { describe, expect, it } from 'vitest';
import { exchangeGoogleToken } from './googleToken';

const env = { clientId: 'cid', clientSecret: 'secret' };
const post = (body: unknown, site = 'same-origin') =>
  new Request('https://finora.vercel.app/api/google/token', { method: 'POST', headers: { 'Sec-Fetch-Site': site, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function google(response: unknown, status = 200) {
  const sent: URLSearchParams[] = [];
  const fetcher = async (_url: string, init?: RequestInit) => {
    sent.push(new URLSearchParams(String(init?.body)));
    return new Response(JSON.stringify(response), { status });
  };
  return { sent, fetcher };
}

describe('exchangeGoogleToken', () => {
  it('exchanges a code with the server-held secret and returns only the token fields', async () => {
    const g = google({ access_token: 'a', expires_in: 3599, refresh_token: 'r', id_token: 'i', scope: 'x' });
    const res = await exchangeGoogleToken(post({ code: 'c', codeVerifier: 'v', redirectUri: 'https://finora.vercel.app/' }), env, g.fetcher);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: 'a', expires_in: 3599, refresh_token: 'r', id_token: 'i' });
    expect(Object.fromEntries(g.sent[0])).toMatchObject({ grant_type: 'authorization_code', code: 'c', code_verifier: 'v', client_secret: 'secret' });
  });

  it('refreshes with a refresh token', async () => {
    const g = google({ access_token: 'a2', expires_in: 3599 });
    const res = await exchangeGoogleToken(post({ refreshToken: 'r' }), env, g.fetcher);
    expect(await res.json()).toEqual({ access_token: 'a2', expires_in: 3599 });
    expect(g.sent[0].get('grant_type')).toBe('refresh_token');
  });

  it('refuses other sites, foreign redirect URIs, bad bodies and missing configuration', async () => {
    const g = google({});
    expect((await exchangeGoogleToken(post({ refreshToken: 'r' }, 'cross-site'), env, g.fetcher)).status).toBe(403);
    expect((await exchangeGoogleToken(post({ code: 'c', codeVerifier: 'v', redirectUri: 'https://evil.example/' }), env, g.fetcher)).status).toBe(400);
    expect((await exchangeGoogleToken(post({ nope: 1 }), env, g.fetcher)).status).toBe(400);
    expect((await exchangeGoogleToken(post({ refreshToken: 'r' }), {}, g.fetcher)).status).toBe(501);
    expect(g.sent).toHaveLength(0);
  });

  it('maps Google errors without leaking details', async () => {
    const res = await exchangeGoogleToken(post({ refreshToken: 'r' }), env, google({ error: 'invalid_grant', error_description: 'x' }, 400).fetcher);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });
});
