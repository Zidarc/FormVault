// Everything added through Quick add goes through one queue, one item at a time (the free AI tier
// dislikes bursts). It lives outside React so imports keep going while you switch tabs.

import { useSyncExternalStore } from 'react';
import { onRateLimitWait } from '@/lib/ai/providers';
import { importAny } from '@/lib/import/route';
import { importPasted } from '@/lib/import/resume';
import { importUrl } from '@/lib/import/url';

export interface Job {
  id: number;
  name: string;
  /** Object URL for image thumbnails */
  thumb?: string;
  status: 'waiting' | 'working' | 'done' | 'error';
  progress?: string;
  result?: string;
  found?: number;
  /** Skipped because the same file was imported before */
  skipped?: boolean;
}

type Work = (p: (msg: string) => void, force: boolean) => Promise<{ text: string; found: number; skipped?: boolean }>;

let jobs: Job[] = [];
const work = new Map<number, Work>();
const forced = new Set<number>();
const listeners = new Set<() => void>();
let nextId = 1;
let running = false;

const emit = () => {
  jobs = [...jobs];
  listeners.forEach((l) => l());
};
const patch = (id: number, p: Partial<Job>) => {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...p } : j));
  emit();
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const foundText = (n: number) => (n ? `found ${plural(n, 'thing')}` : 'nothing new');

async function pump() {
  if (running) return;
  running = true;
  try {
    for (let job = jobs.find((j) => j.status === 'waiting'); job; job = jobs.find((j) => j.status === 'waiting')) {
      const id = job.id;
      const force = forced.delete(id);
      patch(id, { status: 'working', progress: 'Starting…', skipped: false });
      onRateLimitWait((s) => patch(id, { progress: `The free AI tier is busy — trying again in ${s}s…` }));
      try {
        const r = await work.get(id)!((m) => patch(id, { progress: m }), force);
        patch(id, { status: 'done', result: r.text, found: r.found, skipped: r.skipped, progress: undefined });
        if (!r.skipped) work.delete(id); // a skipped file can still be imported anyway
      } catch (e) {
        // Keep the work so "Try again" can rerun it.
        patch(id, { status: 'error', result: e instanceof Error ? e.message : String(e), progress: undefined });
      }
    }
  } finally {
    running = false;
  }
}

function add(name: string, fn: Work, thumb?: string) {
  const id = nextId++;
  work.set(id, fn);
  jobs = [...jobs, { id, name, thumb, status: 'waiting' }];
  emit();
  void pump();
}

// Remember what was imported so dropping the same export twice doesn't spend AI quota again.
const SEEN_KEY = 'importedFiles';
type Seen = Record<string, { name: string; at: string }>;

async function fileHash(f: Blob) {
  const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function seenFiles(): Promise<Seen> {
  return ((await browser.storage.local.get(SEEN_KEY))[SEEN_KEY] as Seen) ?? {};
}

async function markSeen(hash: string, name: string) {
  const seen = await seenFiles();
  seen[hash] = { name, at: new Date().toISOString() };
  const keep = Object.entries(seen).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 500);
  await browser.storage.local.set({ [SEEN_KEY]: Object.fromEntries(keep) });
}

export function enqueueFiles(files: File[]) {
  for (const f of files) {
    const thumb = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
    add(f.name || 'Pasted image', async (p, force) => {
      const hash = await fileHash(f);
      const before = (await seenFiles())[hash];
      if (before && !force)
        return { text: `Already imported on ${new Date(before.at).toLocaleDateString()} — skipped.`, found: 0, skipped: true };
      const r = await importAny(f, p);
      await markSeen(hash, f.name);
      return { text: `${r.what} — ${foundText(r.found)}.${r.note ? ' ' + r.note : ''}`, found: r.found };
    }, thumb);
  }
}

/** A pasted link. Ask for any site permission in the click, before calling this. */
export function enqueueUrl(u: URL) {
  add(u.hostname + u.pathname.replace(/\/$/, ''), async (p) => {
    const r = await importUrl(u, p);
    return { text: `${r.what} — ${foundText(r.found)}.${r.note ? ' ' + r.note : ''}`, found: r.found };
  });
}

/** Import a skipped duplicate anyway. */
export function importAnyway(id: number) {
  if (!work.has(id)) return;
  forced.add(id);
  patch(id, { status: 'waiting', result: undefined, skipped: false });
  void pump();
}

export function enqueueText(text: string) {
  const first = text.trim().split('\n')[0].slice(0, 48);
  add(`“${first}${first.length === 48 ? '…' : ''}”`, async (p) => {
    const n = await importPasted(text, p);
    return { text: `Text — ${foundText(n)}.`, found: n };
  });
}

export function clearFinished() {
  for (const j of jobs)
    if (j.status === 'done' || j.status === 'error') {
      if (j.thumb) URL.revokeObjectURL(j.thumb);
      work.delete(j.id);
    }
  jobs = jobs.filter((j) => j.status === 'waiting' || j.status === 'working');
  emit();
}

export function retry(id: number) {
  if (!work.has(id)) return;
  patch(id, { status: 'waiting', result: undefined });
  void pump();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useJobs = () => useSyncExternalStore(subscribe, () => jobs);

/** Files pulled out of a paste or drop event (screenshots, copied files). */
export function filesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out = [...dt.files];
  if (!out.length)
    for (const it of dt.items) if (it.kind === 'file') {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  // Clipboard screenshots are all called "image.png" — give them a readable name.
  return out.map((f, i) =>
    f.name && f.name !== 'image.png' ? f : new File([f], `Screenshot ${new Date().toLocaleTimeString()}${i ? ` (${i + 1})` : ''}.png`, { type: f.type || 'image/png' }),
  );
}
