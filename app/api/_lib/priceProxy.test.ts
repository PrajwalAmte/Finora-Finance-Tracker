import { describe, expect, it } from 'vitest';
import { routePriceRequest } from './priceProxy';

const req = (path: string, init: { site?: string | null; method?: string } = {}) => {
  const headers: Record<string, string> = {};
  if (init.site !== null) headers['Sec-Fetch-Site'] = init.site ?? 'same-origin';
  return new Request(`https://finora.vercel.app${path}`, { method: init.method ?? 'GET', headers });
};

function upstream(body = 'ok', status = 200) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    return new Response(body, { status });
  };
  return { calls, fetcher };
}

describe('routePriceRequest', () => {
  it('relays the AMFI file with CDN caching', async () => {
    const u = upstream('Scheme Code;...');
    const res = await routePriceRequest(req('/api/amfi'), u.fetcher);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Scheme Code;...');
    expect(u.calls).toEqual(['https://portal.amfiindia.com/spages/NAVAll.txt']);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=21600');
  });

  it('relays a Yahoo chart for a valid symbol only', async () => {
    const u = upstream('{"chart":{}}');
    expect((await routePriceRequest(req('/api/yahoo/m%26m.ns'), u.fetcher)).status).toBe(200);
    expect(u.calls).toEqual(['https://query1.finance.yahoo.com/v8/finance/chart/M%26M.NS?interval=1d&range=5d']);
    expect((await routePriceRequest(req('/api/yahoo/'), u.fetcher)).status).toBe(404);
    for (const bad of ['/api/yahoo/..%2F..%2Fadmin', '/api/yahoo/https%3A%2F%2Fevil.com', '/api/yahoo/%E0%A4%A', `/api/yahoo/${'A'.repeat(30)}`]) {
      expect((await routePriceRequest(req(bad), u.fetcher)).status, bad).toBe(400);
    }
    expect(u.calls).toHaveLength(1);
  });

  it('refuses requests from other websites, other paths and other methods', async () => {
    const u = upstream();
    expect((await routePriceRequest(req('/api/amfi', { site: 'cross-site' }), u.fetcher)).status).toBe(403);
    expect((await routePriceRequest(req('/api/amfi', { site: 'same-site' }), u.fetcher)).status).toBe(403);
    expect((await routePriceRequest(req('/api/other'), u.fetcher)).status).toBe(404);
    expect((await routePriceRequest(req('/api/amfi', { method: 'POST' }), u.fetcher)).status).toBe(405);
    expect(u.calls).toHaveLength(0);
    // Older browsers without Fetch Metadata still work.
    expect((await routePriceRequest(req('/api/amfi', { site: null }), u.fetcher)).status).toBe(200);
  });

  it('reports upstream failures as 502', async () => {
    expect((await routePriceRequest(req('/api/amfi'), upstream('', 503).fetcher)).status).toBe(502);
    expect((await routePriceRequest(req('/api/amfi'), async () => { throw new Error('down'); })).status).toBe(502);
  });
});
