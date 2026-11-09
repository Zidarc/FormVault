// GitHub: type a username, public repos sync automatically.
// Unauthenticated API allows 60 requests/hour, so READMEs are only fetched for repos that changed.

import { nowIso } from '../ids';
import { generateJson } from '../ai/providers';
import { propose, proposeProfile, proposeSkills } from '../inbox';
import { loadSettings, updateSettings, updateVault } from '../storage';
import type { Settings } from '../types';
import { classifySkills, toYearMonth } from './files';
import type { ImportProgress } from './extract';

interface Repo {
  name: string;
  full_name: string;
  html_url: string;
  homepage: string | null;
  description: string | null;
  fork: boolean;
  archived: boolean;
  language: string | null;
  topics?: string[];
  created_at: string;
  pushed_at: string;
  stargazers_count: number;
  size: number;
}

const README_SYSTEM = `You summarise GitHub READMEs of a student's own projects for their portfolio vault.
For each repo return: {"name","summary" (1–2 lines),"problem","built" (what they built, concretely),"result" (only if stated: users, awards, metrics),"tech":[]}.
Never invent. Omit unknown fields. Return JSON: {"repos":[...]}`;

async function gh(path: string, s: Settings, accept = 'application/vnd.github+json') {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept, ...(s.githubToken ? { authorization: `Bearer ${s.githubToken}` } : {}) },
  });
  if (res.status === 404) throw new Error(`GitHub user "${s.githubUser}" wasn't found.`);
  if (res.status === 403 || res.status === 429)
    throw new Error('GitHub rate limit reached (60 per hour without a token). Try again in an hour, or add a free token in Settings.');
  if (!res.ok) throw new Error(`GitHub error ${res.status}`);
  return accept.includes('raw') ? res.text() : res.json();
}

export function cleanReadme(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/<img[^>]*>/gi, '')
    .replace(/\[!\[[^\]]*\][^\]]*\]\([^)]*\)/g, '') // badges
    .replace(/```[\s\S]*?```/g, '') // code blocks (install steps etc.)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function syncGitHub(onProgress?: ImportProgress, full = false): Promise<number> {
  const s = await loadSettings();
  const user = s.githubUser?.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//, '').replace(/\/.*$/, '');
  if (!user) throw new Error('Add your GitHub username first.');
  onProgress?.(`Fetching ${user}'s public repos…`);
  const repos = ((await gh(`/users/${user}/repos?per_page=100&sort=pushed&type=owner`, { ...s, githubUser: user })) as Repo[]).filter(
    (r) => !r.fork && r.size > 0 && r.name.toLowerCase() !== user.toLowerCase(),
  );
  const since = full ? '' : s.lastSync?.github ?? '';
  const changed = repos.filter((r) => r.pushed_at > since);

  // READMEs for changed repos only (max 25 per sync to stay under the rate limit)
  const readmes = new Map<string, string>();
  for (const [i, r] of changed.slice(0, 25).entries()) {
    onProgress?.(`Reading README ${i + 1}/${Math.min(changed.length, 25)}: ${r.name}`, i, changed.length);
    try {
      const md = (await gh(`/repos/${r.full_name}/readme`, s, 'application/vnd.github.raw+json')) as string;
      readmes.set(r.full_name, cleanReadme(md).slice(0, 2500));
    } catch (e) {
      if (e instanceof Error && /rate limit/.test(e.message)) throw e;
    }
  }

  // One AI call to summarise all changed READMEs (optional — skipped if no key)
  const ai = new Map<string, Record<string, any>>();
  const withReadme = changed.filter((r) => (readmes.get(r.full_name) ?? '').length > 80);
  if (withReadme.length && (s.keys[s.provider] || s.provider === 'builtin')) {
    onProgress?.('Summarising READMEs with AI…');
    try {
      const out = await generateJson<{ repos: Record<string, any>[] }>(s, {
        system: README_SYSTEM,
        prompt: withReadme
          .map((r) => `## ${r.name}\nDescription: ${r.description ?? ''}\n${readmes.get(r.full_name)}`)
          .join('\n\n---\n\n'),
        temperature: 0.1,
      });
      for (const x of out.repos ?? []) if (x?.name) ai.set(String(x.name).toLowerCase(), x);
    } catch (e) {
      console.warn('[FormVault] README summary failed; importing without it', e);
    }
  }

  let n = 0;
  const source = { kind: 'github' as const, label: `GitHub · ${user}`, url: `https://github.com/${user}`, at: nowIso() };
  await updateVault((v) => {
    n += propose(
      v,
      'projects',
      changed.map((r) => {
        const x = ai.get(r.name.toLowerCase()) ?? {};
        const readme = readmes.get(r.full_name);
        return {
          title: prettyName(r.name),
          startDate: toYearMonth(r.created_at),
          endDate: toYearMonth(r.pushed_at),
          tech: [...new Set([r.language, ...(r.topics ?? []), ...((x.tech as string[]) ?? [])].filter(Boolean) as string[])],
          links: [r.html_url, r.homepage].filter(Boolean) as string[],
          summary: x.summary ?? r.description ?? undefined,
          problem: x.problem,
          built: x.built,
          result: x.result,
          description: readme ? readme.split('\n\n').slice(0, 3).join('\n\n').slice(0, 800) : undefined,
        };
      }),
      source,
    );
    n += proposeProfile(v, { github: `https://github.com/${user}` }, source);
    n += proposeSkills(v, classifySkills(repos.map((r) => r.language).filter(Boolean) as string[]), source);
  });
  await updateSettings({ githubUser: user, lastSync: { ...s.lastSync, github: nowIso() } });
  return n;
}

/** "my-cool_app" → "My Cool App" */
export const prettyName = (n: string) =>
  n
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
