import { describe, expect, it } from 'vitest';
import { selectSttProvider } from '../profile';
import { CloudSttProvider, openAiStt, type SttFetchLike } from '../providers/cloud-stt';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  model: unknown;
  responseFormat: unknown;
  hasFile: boolean;
}

/** A mock multipart fetch: records the request (incl. form fields) and returns a transcript. */
const mockFetch = (
  text: string,
  opts: { ok?: boolean; status?: number; errorBody?: string } = {},
): { fetch: SttFetchLike; calls: Call[] } => {
  const calls: Call[] = [];
  const fetch: SttFetchLike = (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      model: init.body.get('model'),
      responseFormat: init.body.get('response_format'),
      hasFile: init.body.get('file') !== null,
    });
    return Promise.resolve({
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: () => Promise.resolve({ text }),
      text: () => Promise.resolve(opts.errorBody ?? ''),
    });
  };
  return { fetch, calls };
};

const frame = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Push the words of an utterance as audio frames, then finalize. */
const transcribe = async (provider: CloudSttProvider, words: string[]): Promise<string> => {
  const stream = provider.startStream();
  for (const w of words) stream.pushAudio(frame(w));
  return (await stream.finish()).transcript;
};

describe('CloudSttProvider — OpenAI-compatible transcription', () => {
  it('uploads the buffered audio to /audio/transcriptions with the model + Bearer key', async () => {
    const { fetch, calls } = mockFetch('Box this lap.');
    const stt = new CloudSttProvider({ apiKey: 'sk-test', fetch });

    const transcript = await transcribe(stt, ['box', 'this', 'lap']);

    expect(transcript).toBe('Box this lap.');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['authorization']).toBe('Bearer sk-test'); // injected key, never embedded
    // No content-type header — fetch sets the multipart boundary itself.
    expect(calls[0]!.headers['content-type']).toBeUndefined();
    expect(calls[0]!.model).toBe('gpt-4o-mini-transcribe');
    expect(calls[0]!.responseFormat).toBe('json');
    expect(calls[0]!.hasFile).toBe(true);
  });

  it('honours baseUrl (trailing slash trimmed) + model overrides', async () => {
    const { fetch, calls } = mockFetch('hi');
    const stt = new CloudSttProvider({
      apiKey: 'k',
      baseUrl: 'https://proxy.example/v1/',
      model: 'whisper-1',
      fetch,
    });
    await transcribe(stt, ['hi']);
    expect(calls[0]!.url).toBe('https://proxy.example/v1/audio/transcriptions');
    expect(calls[0]!.model).toBe('whisper-1');
  });

  it('makes no request and returns an empty transcript when nothing was captured (PTT tap)', async () => {
    const { fetch, calls } = mockFetch('unused');
    const stt = new CloudSttProvider({ apiKey: 'k', fetch });
    const stream = stt.startStream();
    expect((await stream.finish()).transcript).toBe('');
    expect(calls).toHaveLength(0);
  });

  it('cancel() drops the buffered audio — a cancelled capture transcribes to nothing', async () => {
    const { fetch, calls } = mockFetch('should not happen');
    const stt = new CloudSttProvider({ apiKey: 'k', fetch });
    const stream = stt.startStream();
    stream.pushAudio(frame('hello'));
    stream.cancel();
    expect((await stream.finish()).transcript).toBe('');
    expect(calls).toHaveLength(0);
  });

  it('throws on a non-OK status, including the error body', async () => {
    const { fetch } = mockFetch('', { ok: false, status: 401, errorBody: 'invalid key' });
    const stt = new CloudSttProvider({ apiKey: 'bad', fetch });
    await expect(transcribe(stt, ['hi'])).rejects.toThrow(/401.*invalid key/);
  });
});

describe('CloudSttProvider — readiness + selector swap', () => {
  it('is available only with a key', () => {
    const { fetch } = mockFetch('x');
    expect(new CloudSttProvider({ apiKey: 'k', fetch }).available).toBe(true);
    expect(new CloudSttProvider({ apiKey: '', fetch }).available).toBe(false);
    expect(openAiStt({ apiKey: 'k', fetch })).toBeInstanceOf(CloudSttProvider);
  });

  it("selectSttProvider builds the cloud STT for stt:'openai' from cloudSttConfig", async () => {
    const { fetch, calls } = mockFetch('hello engineer');
    const stt = selectSttProvider({
      tts: 'fake',
      stt: 'openai',
      cloudSttConfig: { apiKey: 'sk-x', fetch },
    });
    expect(stt).toBeInstanceOf(CloudSttProvider);
    expect(stt.available).toBe(true);
    await transcribe(stt as CloudSttProvider, ['x']);
    expect(calls[0]!.headers['authorization']).toBe('Bearer sk-x');
  });

  it('a missing cloudSttConfig yields a not-ready cloud STT (no key) so the caller falls back', () => {
    const stt = selectSttProvider({ tts: 'fake', stt: 'openai' });
    expect(stt).toBeInstanceOf(CloudSttProvider);
    expect(stt.available).toBe(false);
  });
});
