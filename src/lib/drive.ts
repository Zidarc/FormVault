// Sync the vault to the user's own Google Drive, in the hidden app-data folder.
// Still no FormVault server: the browser talks to Google directly with a token only it holds.
//
// Needs a Google OAuth client ID (free) whose redirect URI is browser.identity.getRedirectURL().
// Set it at build time with WXT_GOOGLE_CLIENT_ID, or paste one in Settings.

import { mergeVaults, parseVaultFile, serialiseVault } from './backup';
import { loadSettings, loadVault, saveVault, updateSettings } from './storage';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE = 'formvault-vault.json';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export const DRIVE_ORIGINS = ['https://www.googleapis.com/*'];

export async function clientId(): Promise<string | undefined> {
  const built = import.meta.env.WXT_GOOGLE_CLIENT_ID as string | undefined;
  return (await loadSettings()).driveClientId || built || undefined;
}

export const redirectUrl = () => browser.identity.getRedirectURL();

async function getToken(interactive: boolean): Promise<string> {
  const cached = (await browser.storage.session.get('driveToken')).driveToken as { token: string; exp: number } | undefined;
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const id = await clientId();
  if (!id) throw new Error('Google Drive sync needs a Google OAuth client ID (see Settings → Drive sync).');
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({ client_id: id, response_type: 'token', redirect_uri: redirectUrl(), scope: SCOPE, prompt: interactive ? 'consent' : 'none' });
  let redirect: string;
  try {
    redirect = (await browser.identity.launchWebAuthFlow({ url, interactive })) ?? '';
  } catch {
    throw new Error(interactive ? 'Google sign-in was cancelled.' : 'Google Drive needs you to sign in again (Settings → Drive sync).');
  }
  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  const token = params.get('access_token');
  if (!token) throw new Error(params.get('error') ?? 'Google sign-in failed.');
  const exp = Date.now() + Number(params.get('expires_in') ?? 3600) * 1000;
  await browser.storage.session.set({ driveToken: { token, exp } });
  return token;
}

async function api(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    await browser.storage.session.remove('driveToken');
    throw new Error('Google Drive sign-in expired. Click Sync now to sign in again.');
  }
  if (!res.ok) throw new Error(`Google Drive error ${res.status}`);
  return res;
}

export async function connectDrive(): Promise<void> {
  await getToken(true);
  await updateSettings({ driveConnected: true });
  await syncDrive(false);
}

export async function disconnectDrive(): Promise<void> {
  await browser.storage.session.remove('driveToken');
  await updateSettings({ driveConnected: false });
}

/** Pull, merge (newer entry wins), push. */
export async function syncDrive(interactive = false): Promise<string> {
  const token = await getToken(interactive);
  const list = await (
    await api(token, `${API}/files?` + new URLSearchParams({ spaces: 'appDataFolder', q: `name='${FILE}'`, fields: 'files(id,modifiedTime)' }))
  ).json();
  const remoteId: string | undefined = list.files?.[0]?.id;

  let merged = await loadVault();
  if (remoteId) {
    const text = await (await api(token, `${API}/files/${remoteId}?alt=media`)).text();
    try {
      merged = mergeVaults(merged, await parseVaultFile(text));
      await saveVault(merged);
    } catch (e) {
      console.warn('[FormVault] remote vault unreadable, overwriting', e);
    }
  }

  const body = await serialiseVault(merged);
  if (remoteId) {
    await api(token, `${UPLOAD}/files/${remoteId}?uploadType=media`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body });
  } else {
    const boundary = 'fv' + Math.random().toString(36).slice(2);
    const multipart =
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name: FILE, parents: ['appDataFolder'] }) +
      `\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    await api(token, `${UPLOAD}/files?uploadType=multipart`, {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
  }
  const at = new Date().toISOString();
  await updateSettings({ driveLastSync: at });
  return at;
}
