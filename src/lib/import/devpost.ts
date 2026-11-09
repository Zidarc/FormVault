// Devpost: paste your profile link; FormVault re-checks the public profile for new hackathons and projects.
// Parsing is regex-based so it also runs in a background service worker (no DOMParser there).

import { nowIso } from '../ids';
import { propose } from '../inbox';
import { loadSettings, loadVault, updateSettings, updateVault } from '../storage';
import { titleSimilarity } from '../text';
import { toYearMonth } from './files';
import type { ImportProgress } from './extract';

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function devpostUser(input: string): string | null {
  const t = input.trim();
  const m = t.match(/devpost\.com\/([A-Za-z0-9_-]+)/);
  if (m && !['software', 'hackathons', 'settings'].includes(m[1])) return m[1];
  return /^[A-Za-z0-9_-]+$/.test(t) ? t : null;
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'omit' });
  if (res.status === 404) throw new Error("That Devpost profile wasn't found.");
  if (!res.ok) throw new Error(`Devpost error ${res.status}`);
  return res.text();
}

export interface DevpostProject {
  url: string;
  title: string;
  tagline?: string;
  winner: boolean;
}

export function parseProfile(html: string): DevpostProject[] {
  const out: DevpostProject[] = [];
  const re = /<a[^>]+href="(https:\/\/devpost\.com\/software\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const inner = m[2];
    const title = decode(inner.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? '');
    if (!title || out.some((p) => p.url === m[1])) continue;
    out.push({
      url: m[1],
      title,
      tagline: decode(inner.match(/class="[^"]*tagline[^"]*"[^>]*>([\s\S]*?)<\//)?.[1] ?? '') || undefined,
      winner: /winner/i.test(inner),
    });
  }
  return out;
}

export function parseProject(html: string) {
  const builtWith = [...(html.match(/id="built-with"[\s\S]*?<\/div>/)?.[0] ?? '').matchAll(/class="cp-tag[^"]*"[^>]*>([\s\S]*?)<\//g)].map(
    (m) => decode(m[1]),
  );
  const team = [...html.matchAll(/class="user-profile-link"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => decode(m[1]))
    .filter((n, i, a) => n && a.indexOf(n) === i);
  const date = toYearMonth(html.match(/<time[^>]+datetime="([^"]+)"/)?.[1]);
  // "Submitted to" block: hackathon name + any prizes won there
  const submitted = html.match(/class="software-list-content"[\s\S]*?(?=<\/div>\s*<\/div>)/)?.[0] ?? '';
  const hackathon = decode(submitted.match(/<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '') || undefined;
  const hackUrl = submitted.match(/<a[^>]+href="([^"]+)"/)?.[1];
  const prizes = [...submitted.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => decode(m[1])).filter(Boolean);
  const won = /class="[^"]*winner[^"]*"/.test(submitted);
  const story = decode(html.match(/id="app-details-left"[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '').slice(0, 1500);
  const links = [...(html.match(/data-role="software-urls"[\s\S]*?<\/ul>/)?.[0] ?? '').matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  return { builtWith, team, date, hackathon, hackUrl, prizes, won, story, links };
}

export async function syncDevpost(onProgress?: ImportProgress): Promise<number> {
  const s = await loadSettings();
  const user = devpostUser(s.devpostUser ?? '');
  if (!user) throw new Error('Add your Devpost profile link first.');
  onProgress?.('Reading your Devpost profile…');
  const projects = parseProfile(await get(`https://devpost.com/${user}`));
  const vault = await loadVault();
  // Only open project pages we don't know yet (or all on the first sync)
  const known = (title: string) => vault.projects.some((p) => titleSimilarity(p.title, title) > 0.8);
  const todo = s.lastSync?.devpost ? projects.filter((p) => !known(p.title)) : projects;

  const found: { p: DevpostProject; d: ReturnType<typeof parseProject> }[] = [];
  for (const [i, p] of todo.slice(0, 30).entries()) {
    onProgress?.(`Reading ${p.title} (${i + 1}/${Math.min(todo.length, 30)})`, i, todo.length);
    try {
      found.push({ p, d: parseProject(await get(p.url)) });
    } catch {
      found.push({ p, d: parseProject('') });
    }
  }

  let n = 0;
  const source = { kind: 'devpost' as const, label: `Devpost · ${user}`, url: `https://devpost.com/${user}`, at: nowIso() };
  await updateVault((v) => {
    n += propose(
      v,
      'projects',
      found.map(({ p, d }) => ({
        title: p.title,
        summary: p.tagline,
        description: d.story || undefined,
        tech: d.builtWith,
        links: [p.url, ...d.links],
        startDate: d.date,
        result: d.won ? d.prizes.join('; ') || 'Winner' : undefined,
      })),
      source,
    );
    n += propose(
      v,
      'hackathons',
      found
        .filter(({ d }) => d.hackathon)
        .map(({ p, d }) => ({
          name: d.hackathon,
          date: d.date,
          team: d.team,
          projectTitle: p.title,
          result: d.won ? d.prizes.join('; ') || 'Winner' : undefined,
          postUrl: d.hackUrl,
        })),
      source,
    );
  });
  await updateSettings({ devpostUser: user, lastSync: { ...s.lastSync, devpost: nowIso() } });
  return n;
}
