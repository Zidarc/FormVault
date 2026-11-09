import { useCallback, useEffect, useState } from 'react';
import { loadSettings, loadVault, onStorageChange } from '@/lib/storage';
import type { Settings, Vault } from '@/lib/types';

export function useVault(): Vault | null {
  const [v, setV] = useState<Vault | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => loadVault().then((x) => alive && setV(x));
    load();
    const off = onStorageChange((k) => k === 'vault' && load());
    return () => {
      alive = false;
      off();
    };
  }, []);
  return v;
}

export function useSettings(): Settings | null {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => loadSettings().then((x) => alive && setS(x));
    load();
    const off = onStorageChange((k) => k === 'settings' && load());
    return () => {
      alive = false;
      off();
    };
  }, []);
  return s;
}

/** Run an async task with busy/progress/error state. */
export function useTask() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const run = useCallback(async (fn: (p: (msg: string) => void) => Promise<string | void>) => {
    setBusy(true);
    setError('');
    setDone('');
    setProgress('');
    try {
      const msg = await fn((m) => setProgress(m));
      if (msg) setDone(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }, []);
  return { busy, progress, error, done, run, setError, setDone };
}
