// Paste a link into Quick add and FormVault does the sensible thing with it:
// a GitHub or Devpost profile starts syncing, a Google Doc is linked as your resume,
// and any other public page is read like pasted text.

import { updateSettings, loadSettings } from '../storage';
import { syncDevpost } from './devpost';
import { syncGitHub } from './github';
import type { ImportProgress } from './extract';
import { googleDocId, importPasted, syncResumeDoc } from './resume';
import { htmlToText } from './route';

export type UrlKind = 'github' | 'devpost' | 'gdoc' | 'linkedin' | 'page';

const GH_RESERVED = new Set(['orgs', 'settings', 'topics', 'explore', 'marketplace', 'features', 'about', 'login', 'sponsors']);

/** Is this paste just a link? */
export function asUrl(text: string): URL | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  try {
    return new URL(t);
  } catch {
    return null;
  }
}

export function classifyUrl(u: URL): { kind: UrlKind; user?: string } {
  const host = u.hostname.replace(/^www\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  if (host === 'github.com' && seg[0] && !GH_RESERVED.has(seg[0])) return { kind: 'github', user: seg[0] };
  if (host === 'devpost.com' && seg[0] && seg[0] !== 'software') return { kind: 'devpost', user: seg[0] };
  if (host === 'docs.google.com' && googleDocId(u.href)) return { kind: 'gdoc' };
  if (host.endsWith('linkedin.com')) return { kind: 'linkedin' };
  return { kind: 'page' };
}

/** Origins to ask for before the import (must be requested inside the click). */
export function originsFor(u: URL): string[] {
  const { kind } = classifyUrl(u);
  if (kind === 'gdoc') return ['https://docs.google.com/*'];
  if (kind === 'page') return [`${u.origin}/*`];
  return [];
}

export async function importUrl(u: URL, onProgress?: ImportProgress): Promise<{ what: string; found: number; note?: string }> {
  const { kind, user } = classifyUrl(u);
  if (kind === 'github') {
    const first = (await loadSettings()).githubUser !== user;
    await updateSettings({ githubUser: user });
    return { what: `GitHub · ${user}`, found: await syncGitHub(onProgress, first), note: 'Syncs daily from now on.' };
  }
  if (kind === 'devpost') {
    await updateSettings({ devpostUser: user });
    return { what: `Devpost · ${user}`, found: await syncDevpost(onProgress), note: 'Syncs daily from now on.' };
  }
  if (kind === 'gdoc') {
    await updateSettings({ resumeDocUrl: u.href, resumeDocHash: undefined });
    return { what: 'Google Doc resume', found: (await syncResumeDoc(onProgress, true)) ?? 0, note: 'Re-read whenever it changes.' };
  }
  if (kind === 'linkedin')
    throw new Error(
      'LinkedIn pages need you to be signed in, so FormVault can\'t open them. Use the "Add to vault?" chip on the post, or upload your LinkedIn export.',
    );

  onProgress?.(`Opening ${u.hostname}…`);
  let res: Response;
  try {
    res = await fetch(u.href, { credentials: 'omit' });
  } catch {
    throw new Error(`Couldn't open ${u.hostname}. Check the link, or copy the page text and paste that instead.`);
  }
  if (!res.ok) throw new Error(`${u.hostname} answered with an error (${res.status}). Copy the page text and paste that instead.`);
  const text = htmlToText(await res.text());
  if (text.length < 80) throw new Error(`Couldn't find readable text on that page. Copy the text and paste it instead.`);
  const title = text.split('\n')[0].slice(0, 60);
  return { what: `Page · ${u.hostname}`, found: await importPasted(text.slice(0, 120_000), onProgress, 'page', `${title} (${u.hostname})`, u.href) };
}
