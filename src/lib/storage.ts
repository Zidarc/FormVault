import { defaultSettings, emptyVault, type Settings, type Vault } from './types';

const VAULT_KEY = 'vault';
const SETTINGS_KEY = 'settings';

export async function loadVault(): Promise<Vault> {
  const r = await browser.storage.local.get(VAULT_KEY);
  return { ...emptyVault(), ...((r[VAULT_KEY] as Partial<Vault>) ?? {}) };
}

export async function saveVault(v: Vault): Promise<void> {
  await browser.storage.local.set({ [VAULT_KEY]: v });
}

/** Read-modify-write. Serialised so concurrent updates don't clobber each other. */
let queue: Promise<unknown> = Promise.resolve();
export function updateVault(fn: (v: Vault) => void | Vault | Promise<void | Vault>): Promise<Vault> {
  const run = queue.then(async () => {
    const v = await loadVault();
    const out = (await fn(v)) ?? v;
    await saveVault(out);
    return out;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function loadSettings(): Promise<Settings> {
  const r = await browser.storage.local.get(SETTINGS_KEY);
  return { ...defaultSettings(), ...((r[SETTINGS_KEY] as Partial<Settings>) ?? {}) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const s = { ...(await loadSettings()), ...patch };
  await browser.storage.local.set({ [SETTINGS_KEY]: s });
  return s;
}

export function onStorageChange(cb: (key: 'vault' | 'settings') => void): () => void {
  const l = (changes: Record<string, unknown>, area: string) => {
    if (area !== 'local') return;
    if (VAULT_KEY in changes) cb('vault');
    if (SETTINGS_KEY in changes) cb('settings');
  };
  browser.storage.onChanged.addListener(l);
  return () => browser.storage.onChanged.removeListener(l);
}
