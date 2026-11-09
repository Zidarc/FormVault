import { useEffect, useRef, useState } from 'react';
import { KEY_PAGES, PROVIDER_LABELS, builtinAvailable, testKey } from '@/lib/ai/providers';
import { updateSettings } from '@/lib/storage';
import type { ProviderId, Settings } from '@/lib/types';

/** One paste box, no Save button: the key is tested the moment it's pasted. */
export function KeySetup({ settings, big }: { settings: Settings; big?: boolean }) {
  const [provider, setProvider] = useState<ProviderId>(settings.provider);
  const [key, setKey] = useState(settings.keys[settings.provider] ?? '');
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'err'>(settings.keys[settings.provider] ? 'ok' : 'idle');
  const [msg, setMsg] = useState('');
  const timer = useRef<number>(0);

  useEffect(() => {
    setKey(settings.keys[provider] ?? '');
    setState(settings.keys[provider] || provider === 'builtin' ? 'ok' : 'idle');
    setMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const check = async (k: string, p = provider) => {
    setState('testing');
    const err = await testKey(p, k);
    if (err) {
      setState('err');
      setMsg(err);
      return;
    }
    setState('ok');
    setMsg('');
    await updateSettings({ provider: p, keys: { ...settings.keys, [p]: k.trim() } });
  };

  const onChange = (k: string) => {
    setKey(k);
    window.clearTimeout(timer.current);
    if (!k.trim()) return setState('idle');
    timer.current = window.setTimeout(() => check(k), 400);
  };

  const providers: ProviderId[] = ['gemini', 'openai', 'anthropic', ...(builtinAvailable() ? (['builtin'] as const) : [])];

  return (
    <div className="stack">
      <div className="seg" role="group" aria-label="AI provider">
        {providers.map((p) => (
          <button key={p} aria-pressed={provider === p} onClick={() => setProvider(p)}>
            {p === 'gemini' ? 'Gemini (free)' : p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Claude' : 'On-device'}
          </button>
        ))}
      </div>

      {provider === 'builtin' ? (
        <div className="stack">
          <p className="sub">Runs on this computer — nothing leaves it. Needs a newer, stronger machine.</p>
          <button className="btn primary" onClick={() => check('', 'builtin')}>Use on-device AI</button>
        </div>
      ) : (
        <>
          <div className="row">
            <a className={`btn ${big ? 'big primary' : ''}`} href={KEY_PAGES[provider]} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              {provider === 'gemini' ? 'Get my free key' : `Get a ${PROVIDER_LABELS[provider]} key`}
            </a>
          </div>
          {provider === 'gemini' && (
            <ol className="sub" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Sign in with Google</li>
              <li>Click <b>Create API key</b></li>
              <li>Click <b>Copy</b>, then paste it below</li>
            </ol>
          )}
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your key here"
            value={key}
            onChange={(e) => onChange(e.target.value)}
            style={big ? { fontSize: 16, padding: 12 } : undefined}
          />
        </>
      )}
      {state === 'testing' && <p className="msg busy"><span className="spinner" /> Checking your key…</p>}
      {state === 'ok' && settings.provider === provider && <p className="msg ok">✓ Connected to {PROVIDER_LABELS[provider]}</p>}
      {state === 'err' && <p className="msg err">{msg}</p>}
      <p className="hint">Your key stays in this browser and is only sent to {provider === 'builtin' ? 'nobody' : PROVIDER_LABELS[provider].replace(/ \(.*/, '')}.</p>
    </div>
  );
}
