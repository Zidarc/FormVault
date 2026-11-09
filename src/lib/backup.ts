// Export the vault as a file (optionally locked with a password) and import it on another browser.
// AES-GCM with a PBKDF2-derived key, all via WebCrypto.

import { emptyVault, type Vault } from './types';

interface Locked {
  formvault: 1;
  encrypted: true;
  salt: string;
  iv: string;
  data: string;
}
interface Plain {
  formvault: 1;
  encrypted: false;
  exportedAt: string;
  vault: Vault;
}

const b64 = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 310_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function serialiseVault(vault: Vault, password?: string): Promise<string> {
  // Embeddings are bulky and can be recomputed.
  const slim: Vault = { ...vault, answers: vault.answers.map(({ embedding: _e, ...a }) => a) };
  if (!password) {
    const out: Plain = { formvault: 1, encrypted: false, exportedAt: new Date().toISOString(), vault: slim };
    return JSON.stringify(out, null, 1);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify({ exportedAt: new Date().toISOString(), vault: slim })),
  );
  const out: Locked = { formvault: 1, encrypted: true, salt: b64(salt), iv: b64(iv), data: b64(ct) };
  return JSON.stringify(out);
}

export function isLocked(text: string): boolean {
  try {
    return JSON.parse(text).encrypted === true;
  } catch {
    return false;
  }
}

export async function parseVaultFile(text: string, password?: string): Promise<Vault> {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("This isn't a FormVault file.");
  }
  if (obj?.formvault !== 1) throw new Error("This isn't a FormVault file.");
  let vault: Vault;
  if (obj.encrypted) {
    if (!password) throw new Error('This vault is locked. Enter its password.');
    try {
      const key = await deriveKey(password, unb64(obj.salt));
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) as BufferSource }, key, unb64(obj.data) as BufferSource);
      vault = JSON.parse(new TextDecoder().decode(pt)).vault;
    } catch {
      throw new Error('Wrong password.');
    }
  } else vault = obj.vault;
  return { ...emptyVault(), ...vault };
}

/** Merge an imported vault into the current one: entries by id, newer wins. */
export function mergeVaults(cur: Vault, inc: Vault): Vault {
  const byId = <T extends { id: string; updatedAt?: string; createdAt?: string }>(a: T[], b: T[]) => {
    const m = new Map(a.map((x) => [x.id, x]));
    for (const x of b) {
      const old = m.get(x.id);
      const t = (y: T) => y.updatedAt ?? y.createdAt ?? '';
      if (!old || t(x) > t(old)) m.set(x.id, x);
    }
    return [...m.values()];
  };
  const uniq = (a: string[], b: string[]) => [...new Map([...a, ...b].map((x) => [x.toLowerCase(), x])).values()];
  return {
    ...cur,
    profile: { ...inc.profile, ...Object.fromEntries(Object.entries(cur.profile).filter(([, v]) => v)) },
    projects: byId(cur.projects, inc.projects),
    hackathons: byId(cur.hackathons, inc.hackathons),
    experience: byId(cur.experience, inc.experience),
    achievements: byId(cur.achievements, inc.achievements),
    skills: {
      languages: uniq(cur.skills.languages, inc.skills.languages),
      frameworks: uniq(cur.skills.frameworks, inc.skills.frameworks),
      tools: uniq(cur.skills.tools, inc.skills.tools),
    },
    answers: byId(cur.answers, inc.answers),
    style: byId(cur.style, inc.style),
    inbox: byId(cur.inbox, inc.inbox),
    stats: {
      draftsShown: Math.max(cur.stats.draftsShown, inc.stats.draftsShown),
      draftsAcceptedUnedited: Math.max(cur.stats.draftsAcceptedUnedited, inc.stats.draftsAcceptedUnedited),
    },
  };
}

export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
