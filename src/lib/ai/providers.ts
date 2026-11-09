// Bring-your-own-key AI: Gemini (default, free tier), OpenAI, Claude, or the browser's on-device model.
// Every call goes straight from the browser to the provider — FormVault has no server.

import type { ProviderId, Settings } from '../types';

export class AiError extends Error {
  constructor(
    message: string,
    public kind: 'key' | 'quota' | 'region' | 'network' | 'format' | 'other' = 'other',
    /** For quota errors: seconds the provider asked us to wait, when it said */
    public retryAfter?: number,
  ) {
    super(message);
  }
}

/** How long a 429 says to wait: Gemini puts it in RetryInfo, OpenAI/Anthropic in a header. */
export function retryAfterSeconds(body: any, header: string | null): number | undefined {
  const info = (body?.error?.details ?? []).find((d: any) => String(d?.['@type'] ?? '').includes('RetryInfo'));
  const fromBody = parseFloat(String(info?.retryDelay ?? ''));
  if (Number.isFinite(fromBody)) return fromBody;
  const fromHeader = parseFloat(header ?? '');
  return Number.isFinite(fromHeader) ? fromHeader : undefined;
}

// Free tiers allow only a few requests a minute. A short wait beats an error.
const MAX_AUTO_WAIT = 40;
let waitNotice: ((seconds: number) => void) | undefined;
/** Let the UI show "waiting for the free tier…" while a retry is pending. */
export const onRateLimitWait = (cb?: (seconds: number) => void) => (waitNotice = cb);

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof AiError) || e.kind !== 'quota' || e.retryAfter == null || e.retryAfter > MAX_AUTO_WAIT) throw e;
    const s = Math.ceil(e.retryAfter) + 1;
    waitNotice?.(s);
    await new Promise((r) => setTimeout(r, s * 1000));
    return fn();
  }
}

export interface GenerateOpts {
  system: string;
  prompt: string;
  /** Ask for JSON back */
  json?: boolean;
  temperature?: number;
  /** Images (e.g. certificates) as base64 */
  images?: { mime: string; data: string }[];
}

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Google Gemini (free tier)',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  builtin: 'On-device (Chrome built-in AI)',
};

export const KEY_PAGES: Record<ProviderId, string> = {
  gemini: 'https://aistudio.google.com/app/apikey',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  builtin: 'https://developer.chrome.com/docs/ai/built-in',
};

// ── key sanity check before any network call ──
export function checkKeyShape(provider: ProviderId, key: string): string | null {
  const k = key.trim();
  if (provider === 'builtin') return null;
  if (!k) return 'Paste your key first.';
  if (/\s/.test(k)) return 'The key has spaces in it — try copying it again.';
  if (provider === 'gemini' && (!k.startsWith('AIza') || k.length < 39))
    return 'This key was copied incompletely — try copying again. Gemini keys start with "AIza" and are 39 characters long.';
  if (provider === 'openai' && !k.startsWith('sk-')) return 'OpenAI keys start with "sk-". Try copying it again.';
  if (provider === 'anthropic' && !k.startsWith('sk-ant-'))
    return 'Claude keys start with "sk-ant-". Try copying it again.';
  return null;
}

const http = (url: string, init: RequestInit, provider: ProviderId) => withRateLimitRetry(() => httpOnce(url, init, provider));

async function httpOnce(url: string, init: RequestInit, provider: ProviderId): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new AiError(`Couldn't reach ${PROVIDER_LABELS[provider]}. Check your internet connection.`, 'network');
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not json */
  }
  if (res.ok) return body;
  const msg: string = body?.error?.message ?? text.slice(0, 200);
  if (res.status === 400 && /api key|API_KEY/i.test(msg))
    throw new AiError("This key doesn't work. It may have been copied incompletely — try copying again.", 'key');
  if (res.status === 401 || res.status === 403) {
    if (/location|region|country/i.test(msg))
      throw new AiError(
        "The free tier isn't available in your region (EU, UK and Switzerland need a paid key).",
        'region',
      );
    throw new AiError("This key was rejected. Make sure you copied the whole key and that it's active.", 'key');
  }
  if (res.status === 429) {
    // A daily limit won't clear in seconds — don't wait for it, fall back to another model instead.
    const daily = /PerDay/i.test(JSON.stringify(body?.error?.details ?? ''));
    throw new AiError(
      'Free limit reached for now. Try again later, or pick a different model in Settings.',
      'quota',
      daily ? undefined : retryAfterSeconds(body, res.headers.get('retry-after')),
    );
  }
  throw new AiError(`${PROVIDER_LABELS[provider]} error (${res.status}): ${msg}`);
}

// ── model discovery (free — doesn't use generation quota) ──

type ModelCache = { at: number; gen: string[]; embed: string[] };
const modelCache = new Map<string, ModelCache>();

async function listGeminiModels(key: string): Promise<ModelCache> {
  const hit = modelCache.get('g' + key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit;
  const body = await http(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }, 'gemini');
  const models: any[] = body?.models ?? [];
  const names = (m: any) => String(m.name).replace(/^models\//, '');
  const gen = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map(names)
    .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(image|tts|audio|live|thinking|exp|vision)/.test(n));
  const embed = models.filter((m) => m.supportedGenerationMethods?.includes('embedContent')).map(names);
  const out = { at: Date.now(), gen, embed };
  modelCache.set('g' + key, out);
  return out;
}

const versionOf = (n: string) => parseFloat(n.match(/(\d+(?:\.\d+)?)/)?.[1] ?? '0');
const stableFirst = (a: string, b: string) =>
  Number(/preview/.test(a)) - Number(/preview/.test(b)) || versionOf(b) - versionOf(a);

/** Flash-Lite has the most free daily requests; Flash is the fallback. */
export async function geminiModels(key: string, preferred?: string): Promise<string[]> {
  if (preferred) return [preferred];
  let gen: string[] = [];
  try {
    gen = (await listGeminiModels(key)).gen;
  } catch (e) {
    if (e instanceof AiError && e.kind === 'key') throw e;
  }
  const lite = gen.filter((n) => n.includes('flash-lite')).sort(stableFirst);
  const flash = gen.filter((n) => !n.includes('lite')).sort(stableFirst);
  const picked = [lite[0], flash[0]].filter(Boolean) as string[];
  return picked.length ? picked : ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
}

export async function availableModels(settings: Settings): Promise<string[]> {
  const key = settings.keys[settings.provider]?.trim();
  if (!key) return [];
  if (settings.provider === 'gemini') return (await listGeminiModels(key)).gen.sort(stableFirst);
  return [];
}

// ── generation ──

export async function generate(settings: Settings, opts: GenerateOpts): Promise<string> {
  const p = settings.provider;
  const key = settings.keys[p]?.trim() ?? '';
  if (p !== 'builtin' && !key) throw new AiError('Add an AI key in Settings first.', 'key');

  if (p === 'gemini') {
    const models = await geminiModels(key, settings.models.gemini);
    let lastErr: unknown;
    for (const model of models) {
      try {
        const body = await http(
          `${GEMINI}/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: opts.system }] },
              contents: [
                {
                  role: 'user',
                  parts: [
                    ...(opts.images ?? []).map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } })),
                    { text: opts.prompt },
                  ],
                },
              ],
              generationConfig: {
                temperature: opts.temperature ?? 0.4,
                ...(opts.json ? { responseMimeType: 'application/json' } : {}),
              },
            }),
          },
          'gemini',
        );
        const text = (body?.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? '').join('');
        if (!text) throw new AiError('Gemini returned an empty answer (it may have been blocked).', 'format');
        return text;
      } catch (e) {
        lastErr = e;
        if (!(e instanceof AiError) || e.kind !== 'quota') throw e; // only fall back on quota
      }
    }
    throw lastErr;
  }

  if (p === 'openai') {
    const model = settings.models.openai || 'gpt-4o-mini';
    const body = await http(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: opts.system },
            {
              role: 'user',
              content: opts.images?.length
                ? [
                    ...opts.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } })),
                    { type: 'text', text: opts.prompt },
                  ]
                : opts.prompt,
            },
          ],
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      },
      'openai',
    );
    return body?.choices?.[0]?.message?.content ?? '';
  }

  if (p === 'anthropic') {
    const model = settings.models.anthropic || 'claude-haiku-5-5';
    const body = await http(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 8000,
          system: opts.system + (opts.json ? '\nRespond with a single JSON object and nothing else.' : ''),
          messages: [
            {
              role: 'user',
              content: [
                ...(opts.images ?? []).map((i) => ({
                  type: 'image',
                  source: { type: 'base64', media_type: i.mime, data: i.data },
                })),
                { type: 'text', text: opts.prompt },
              ],
            },
          ],
        }),
      },
      'anthropic',
    );
    return (body?.content ?? []).map((c: any) => c.text ?? '').join('');
  }

  return builtinGenerate(opts);
}

// Chrome's on-device model (Prompt API). Not available in Firefox.
async function builtinGenerate(opts: GenerateOpts): Promise<string> {
  const LM = (globalThis as any).LanguageModel;
  if (!LM) throw new AiError("This browser doesn't have a built-in AI model. Add a free Gemini key instead.");
  const avail = await LM.availability();
  if (avail === 'unavailable')
    throw new AiError("This computer can't run the built-in model. Add a free Gemini key instead.");
  const session = await LM.create({ initialPrompts: [{ role: 'system', content: opts.system }] });
  try {
    return await session.prompt(opts.prompt + (opts.json ? '\n\nReply with JSON only.' : ''));
  } finally {
    session.destroy?.();
  }
}

export const builtinAvailable = () => typeof (globalThis as any).LanguageModel !== 'undefined';

/** Pull the first JSON object/array out of a model reply. */
export function parseJson<T = any>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[{[]/);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    throw new AiError("The AI's answer wasn't in the expected format. Try again.", 'format');
  }
}

export async function generateJson<T = any>(settings: Settings, opts: Omit<GenerateOpts, 'json'>): Promise<T> {
  return parseJson<T>(await generate(settings, { ...opts, json: true }));
}

// ── embeddings (meaning-based matching). Gemini & OpenAI only; others fall back to local TF-IDF. ──

export async function embed(settings: Settings, texts: string[]): Promise<number[][] | null> {
  if (!texts.length) return [];
  const p = settings.provider;
  const key = settings.keys[p]?.trim();
  if (!key) return null;
  try {
    if (p === 'gemini') {
      const { embed: models } = await listGeminiModels(key);
      const model = models.find((m) => m.startsWith('gemini-embedding')) ?? models[0] ?? 'gemini-embedding-001';
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 100) {
        const body = await http(
          `${GEMINI}/models/${model}:batchEmbedContents`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({
              requests: texts.slice(i, i + 100).map((t) => ({
                model: `models/${model}`,
                content: { parts: [{ text: t.slice(0, 2000) }] },
                taskType: 'SEMANTIC_SIMILARITY',
                outputDimensionality: 256,
              })),
            }),
          },
          'gemini',
        );
        out.push(...(body.embeddings ?? []).map((e: any) => e.values as number[]));
      }
      return out;
    }
    if (p === 'openai') {
      const body = await http(
        'https://api.openai.com/v1/embeddings',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: texts.map((t) => t.slice(0, 2000)),
            dimensions: 256,
          }),
        },
        'openai',
      );
      return (body.data ?? []).map((d: any) => d.embedding as number[]);
    }
  } catch (e) {
    console.warn('[FormVault] embeddings unavailable, using local matching', e);
  }
  return null;
}

/** Test a key without spending generation quota where possible. Returns null on success or a friendly message. */
export async function testKey(provider: ProviderId, key: string): Promise<string | null> {
  const shape = checkKeyShape(provider, key);
  if (shape) return shape;
  try {
    if (provider === 'gemini') {
      modelCache.delete('g' + key.trim());
      await listGeminiModels(key.trim());
    } else if (provider === 'openai') {
      await http('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key.trim()}` } }, 'openai');
    } else if (provider === 'anthropic') {
      await http(
        'https://api.anthropic.com/v1/models',
        {
          headers: {
            'x-api-key': key.trim(),
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
        },
        'anthropic',
      );
    } else if (!builtinAvailable()) {
      return "This browser doesn't have a built-in AI model.";
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
