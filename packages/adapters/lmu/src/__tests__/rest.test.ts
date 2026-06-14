import { describe, expect, it } from 'vitest';
import { LmuRestClient, type FetchLike } from '../rest/client';

interface Call {
  url: string;
  method: string;
}

/** A mock fetch that records calls and delegates the response to a handler. */
const mockFetch = (
  handler: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>,
): { fetch: FetchLike; calls: Call[] } => {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    return handler(url);
  };
  return { fetch, calls };
};

const ok = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const refused = (): Promise<never> => Promise.reject(new Error('ECONNREFUSED'));

describe('LmuRestClient', () => {
  it('detects the IPv4 base and issues only GET requests', async () => {
    const { fetch, calls } = mockFetch(() => ok({}));
    const client = new LmuRestClient({ fetch, now: () => 0 });

    expect(await client.detectBase()).toBe('http://localhost:6397');
    expect(client.available()).toBe(true);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('falls back to IPv6 when IPv4 is refused', async () => {
    const { fetch } = mockFetch((url) => (url.includes('localhost') ? refused() : ok({})));
    const client = new LmuRestClient({ fetch, now: () => 0 });
    expect(await client.detectBase()).toBe('http://[::1]:6397');
  });

  it('caches a response within the TTL and refetches after it expires', async () => {
    let t = 0;
    const { fetch, calls } = mockFetch(() => ok({ ts: t }));
    const client = new LmuRestClient({ fetch, cacheTtlMs: 100, now: () => t });

    await client.detectBase(); // probes /rest/sessions
    t = 1000;
    await client.get('weather'); // fetch
    t = 1050;
    await client.get('weather'); // cached (50 < 100)
    t = 2000;
    await client.get('weather'); // expired → fetch

    const weatherCalls = calls.filter((c) => c.url.includes('/weather'));
    expect(weatherCalls).toHaveLength(2);
  });

  it('degrades gracefully when LMU/REST is absent (null, never throws)', async () => {
    const { fetch } = mockFetch(() => refused());
    const client = new LmuRestClient({ fetch, probeIntervalMs: 0, now: () => 0 });

    expect(await client.detectBase()).toBeNull();
    expect(client.available()).toBe(false);
    expect(await client.get('weather')).toBeNull();
  });

  it('throttles re-probing while absent', async () => {
    let t = 0;
    const { fetch, calls } = mockFetch(() => refused());
    const client = new LmuRestClient({ fetch, probeIntervalMs: 2000, now: () => t });

    await client.detectBase(); // probes both bases
    const afterFirst = calls.length;
    await client.detectBase(); // within throttle → no new probe
    expect(calls.length).toBe(afterFirst);
    t = 3000;
    await client.detectBase(); // throttle elapsed → probes again
    expect(calls.length).toBeGreaterThan(afterFirst);
  });

  it('snapshot reads all endpoints (GET-only) and reports the base', async () => {
    const { fetch, calls } = mockFetch((url) => ok({ url }));
    const client = new LmuRestClient({ fetch, now: () => 0, cacheTtlMs: 1000 });

    const snap = await client.snapshot();
    expect(snap.base).toBe('http://localhost:6397');
    expect(snap.weather).toBeTruthy();
    expect(snap.strategyUsage).toBeTruthy();
    expect(snap.repairRefuel).toBeTruthy();
    expect(calls.every((c) => c.method === 'GET')).toBe(true); // never a write
  });
});
