/**
 * LMU local REST client (build-plan T2.2, docs/03 §S2). **Read-only / GET-only** — LMU's web
 * UI backend also exposes *write* operations on the garage tree (the CrewChief pit-menu path);
 * this client never issues anything but GET, matching the no-write mandate (CLAUDE.md rule 5).
 *
 * Transport facts confirmed from public sources (docs/03 §S2): base `http://localhost:6397`
 * (no plugin needed), with an IPv4→IPv6 (`http://[::1]:6397`) fallback because some builds only
 * answer on one; endpoints may only populate in-session. The client feature-detects a
 * responsive base and degrades gracefully (returns null, never throws) when LMU/REST is absent.
 *
 * Payloads are returned **raw** (`unknown`) on purpose: the exact JSON field shapes are
 * LIVE-VERIFY (only the running game's Swagger is authoritative). Mapping the raw snapshot into
 * the canonical `RaceState` — Virtual Energy (`/rest/strategy/usage`) and the pit/refuel/garage
 * state, which are *not* in shared memory — lands in the Normalizer once a live capture pins the
 * field names (T2.3 follow-up; see the rig probe block in docs/03 §S2).
 */

/** Minimal `fetch` shape — injectable so the client is unit-testable without a live endpoint. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const DEFAULT_BASES: readonly string[] = ['http://localhost:6397', 'http://[::1]:6397'];

/** Read-only LMU REST endpoints, confirmed to exist from community tools (docs/03 §S2). */
export const LMU_REST_ENDPOINTS = {
  sessions: '/rest/sessions',
  vehicles: '/rest/sessions/getAllVehicles',
  weather: '/rest/sessions/weather',
  strategyUsage: '/rest/strategy/usage', // Virtual Energy — not in shared memory
  garage: '/rest/garage/getPlayerGarageData',
  repairRefuel: '/rest/garage/UIScreen/RepairAndRefuel',
} as const;
export type LmuRestEndpoint = keyof typeof LMU_REST_ENDPOINTS;

export interface RestClientOptions {
  /** Candidate base URLs, tried in order (default IPv4 then IPv6). */
  baseUrls?: readonly string[];
  fetch?: FetchLike;
  /** Response cache TTL in ms (default 500 ≈ 2 Hz). */
  cacheTtlMs?: number;
  /** Minimum gap between connectivity probes while absent, ms (default 2000). */
  probeIntervalMs?: number;
  now?: () => number;
}

/** Raw (unmapped) snapshot of the known endpoints; any absent endpoint is null. */
export interface RestSnapshot {
  base: string | null;
  sessions: unknown;
  vehicles: unknown;
  weather: unknown;
  strategyUsage: unknown;
  garage: unknown;
  repairRefuel: unknown;
}

interface CacheEntry {
  value: unknown;
  atMs: number;
}

export class LmuRestClient {
  readonly #bases: readonly string[];
  readonly #fetch: FetchLike;
  readonly #ttl: number;
  readonly #probeIntervalMs: number;
  readonly #now: () => number;
  readonly #cache = new Map<string, CacheEntry>();
  #base: string | null = null;
  #lastProbeMs = Number.NEGATIVE_INFINITY;
  #detecting: Promise<string | null> | null = null;

  constructor(options: RestClientOptions = {}) {
    this.#bases = options.baseUrls ?? DEFAULT_BASES;
    const f = options.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!f) throw new Error('LmuRestClient: no fetch on this runtime; pass options.fetch');
    this.#fetch = f;
    this.#ttl = options.cacheTtlMs ?? 500;
    this.#probeIntervalMs = options.probeIntervalMs ?? 2000;
    this.#now = options.now ?? ((): number => Date.now());
  }

  /** Whether a responsive base URL has been found. */
  available(): boolean {
    return this.#base !== null;
  }

  get baseUrl(): string | null {
    return this.#base;
  }

  /**
   * Find a responsive base (IPv4 then IPv6), cached after the first success. While absent,
   * re-probing is throttled to `probeIntervalMs` so a closed port isn't hammered each poll.
   */
  async detectBase(): Promise<string | null> {
    if (this.#base) return this.#base;
    if (this.#detecting) return this.#detecting; // share an in-flight probe (parallel callers)
    if (this.#now() - this.#lastProbeMs < this.#probeIntervalMs) return null;
    this.#lastProbeMs = this.#now();
    this.#detecting = (async (): Promise<string | null> => {
      for (const base of this.#bases) {
        if ((await this.#tryGet(`${base}${LMU_REST_ENDPOINTS.sessions}`)) !== null) {
          this.#base = base;
          return base;
        }
      }
      return null;
    })();
    try {
      return await this.#detecting;
    } finally {
      this.#detecting = null;
    }
  }

  /** GET an endpoint (cached, GET-only). Returns null when LMU/REST is unavailable. */
  async get(endpoint: LmuRestEndpoint): Promise<unknown> {
    const base = await this.detectBase();
    if (!base) return null;
    const path = LMU_REST_ENDPOINTS[endpoint];
    const cached = this.#cache.get(path);
    if (cached && this.#now() - cached.atMs < this.#ttl) return cached.value;
    const value = await this.#tryGet(`${base}${path}`);
    if (value !== null) this.#cache.set(path, { value, atMs: this.#now() });
    return value;
  }

  /** Read all known endpoints (cached); absent ones are null. Raw payloads (mapping = T2.3). */
  async snapshot(): Promise<RestSnapshot> {
    const [sessions, vehicles, weather, strategyUsage, garage, repairRefuel] = await Promise.all([
      this.get('sessions'),
      this.get('vehicles'),
      this.get('weather'),
      this.get('strategyUsage'),
      this.get('garage'),
      this.get('repairRefuel'),
    ]);
    return { base: this.#base, sessions, vehicles, weather, strategyUsage, garage, repairRefuel };
  }

  /** GET a URL → parsed JSON, or null on any failure/non-OK. Never throws. GET-only. */
  async #tryGet(url: string): Promise<unknown> {
    try {
      const res = await this.#fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
}
