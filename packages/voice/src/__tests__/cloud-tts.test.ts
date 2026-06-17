import { describe, expect, it } from 'vitest';
import { selectTtsProvider } from '../profile';
import { CloudTtsProvider, openAiTts, type TtsFetchLike } from '../providers/cloud-tts';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A mock binary fetch: records the request, returns the given bytes (or an error status). */
const mockFetch = (
  bytes: Uint8Array,
  opts: { ok?: boolean; status?: number; errorBody?: string } = {},
): { fetch: TtsFetchLike; calls: Call[] } => {
  const calls: Call[] = [];
  const fetch: TtsFetchLike = (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    return Promise.resolve({
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      // Return a fresh ArrayBuffer slice so callers can't mutate the fixture.
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer as ArrayBuffer),
      text: () => Promise.resolve(opts.errorBody ?? ''),
    });
  };
  return { fetch, calls };
};

const AUDIO = new Uint8Array([1, 2, 3, 4, 5]);

const drain = async (it: AsyncIterable<{ data: Uint8Array }>): Promise<Uint8Array[]> => {
  const out: Uint8Array[] = [];
  for await (const c of it) out.push(c.data);
  return out;
};

describe('CloudTtsProvider — OpenAI-compatible request mapping', () => {
  it('POSTs /audio/speech with the model/input/voice/format and the Bearer key', async () => {
    const { fetch, calls } = mockFetch(AUDIO);
    const tts = new CloudTtsProvider({ apiKey: 'sk-test', voice: 'onyx', fetch });

    await drain(tts.synthesizeStream('Box this lap.', 'engineer-1'));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/audio/speech');
    expect(calls[0]!.method).toBe('POST');
    // Auth uses the injected key — never an embedded one (rule 6).
    expect(calls[0]!.headers['authorization']).toBe('Bearer sk-test');
    expect(calls[0]!.body).toEqual({
      model: 'gpt-4o-mini-tts',
      input: 'Box this lap.',
      voice: 'onyx', // the vendor voice from config, not the app VoiceId param
      response_format: 'mp3',
    });
  });

  it('yields the response bytes as one audio chunk', async () => {
    const { fetch } = mockFetch(AUDIO);
    const tts = new CloudTtsProvider({ apiKey: 'sk-test', fetch });
    const chunks = await drain(tts.synthesizeStream('Hello.', 'v1'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(AUDIO);
  });

  it('honours baseUrl (trailing slash trimmed), model, and format overrides', async () => {
    const { fetch, calls } = mockFetch(AUDIO);
    const tts = new CloudTtsProvider({
      apiKey: 'k',
      baseUrl: 'https://proxy.example/v1/',
      model: 'tts-1',
      format: 'wav',
      fetch,
    });
    await drain(tts.synthesizeStream('hi', 'v1'));
    expect(calls[0]!.url).toBe('https://proxy.example/v1/audio/speech');
    expect(calls[0]!.body).toMatchObject({ model: 'tts-1', response_format: 'wav' });
  });

  it('adds a delivery instruction for an expressive tone (urgent), steering voice not words', async () => {
    const { fetch, calls } = mockFetch(AUDIO);
    const tts = new CloudTtsProvider({ apiKey: 'k', fetch });
    await drain(tts.synthesizeStream('Box this lap.', 'v1', { tone: 'urgent' }));
    // The words are untouched; only an `instructions` field is added to steer delivery.
    expect(calls[0]!.body).toMatchObject({ input: 'Box this lap.' });
    expect((calls[0]!.body as { instructions?: string }).instructions).toMatch(/urgenc/i);
  });

  it('omits the instruction for the neutral default tone (calm)', async () => {
    const { fetch, calls } = mockFetch(AUDIO);
    const tts = new CloudTtsProvider({ apiKey: 'k', fetch });
    await drain(tts.synthesizeStream('Fuel is fine.', 'v1', { tone: 'calm' }));
    expect(calls[0]!.body).not.toHaveProperty('instructions');
  });

  it('throws on a non-OK status, including the error body for diagnosis', async () => {
    const { fetch } = mockFetch(AUDIO, { ok: false, status: 401, errorBody: 'invalid key' });
    const tts = new CloudTtsProvider({ apiKey: 'bad', fetch });
    await expect(drain(tts.synthesizeStream('hi', 'v1'))).rejects.toThrow(/401.*invalid key/);
  });
});

describe('CloudTtsProvider — prerender retains bytes + MIME (audible clips)', () => {
  it('returns a clip per phrase carrying the synthesized bytes and the format MIME type', async () => {
    const { fetch } = mockFetch(AUDIO, {});
    const tts = new CloudTtsProvider({ apiKey: 'k', format: 'wav', fetch });
    const clips = await tts.prerender(['Box, box.', 'Pit confirm.'], 'v1');

    expect([...clips.keys()]).toEqual(['Box, box.', 'Pit confirm.']);
    const clip = clips.get('Box, box.')!;
    expect(clip.audio?.data).toEqual(AUDIO);
    expect(clip.audio?.mimeType).toBe('audio/wav');
    expect(clip.label).toBe('Box, box.');
  });
});

describe('CloudTtsProvider — readiness (BYO-key gating)', () => {
  it('is available only with a key, so a profile falls back rather than calling with no auth', () => {
    const { fetch } = mockFetch(AUDIO);
    expect(new CloudTtsProvider({ apiKey: 'k', fetch }).available).toBe(true);
    expect(new CloudTtsProvider({ apiKey: '', fetch }).available).toBe(false);
  });

  it('openAiTts preset builds a CloudTtsProvider', () => {
    const { fetch } = mockFetch(AUDIO);
    expect(openAiTts({ apiKey: 'k', fetch })).toBeInstanceOf(CloudTtsProvider);
  });
});

describe('selectTtsProvider — config-only swap to the cloud engine', () => {
  it("builds the cloud TTS for tts:'openai' from cloudTtsConfig", async () => {
    const { fetch, calls } = mockFetch(AUDIO);
    const tts = selectTtsProvider({
      tts: 'openai',
      stt: 'fake',
      cloudTtsConfig: { apiKey: 'sk-x', fetch },
    });
    expect(tts).toBeInstanceOf(CloudTtsProvider);
    expect(tts.available).toBe(true);
    await drain(tts.synthesizeStream('hi', 'v1'));
    expect(calls[0]!.headers['authorization']).toBe('Bearer sk-x');
  });

  it('a missing cloudTtsConfig yields a not-ready cloud provider (no key) so the caller falls back', () => {
    const tts = selectTtsProvider({ tts: 'openai', stt: 'fake' });
    expect(tts).toBeInstanceOf(CloudTtsProvider);
    expect(tts.available).toBe(false);
  });
});
