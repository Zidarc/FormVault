// The Inbox: nothing enters the vault without the user's OK.
// Every find becomes a proposal — a new entry, or an update to an existing one.
// Duplicates are merged, so three chats about one hackathon become one entry.

import { nowIso, uid } from './ids';
import { titleSimilarity } from './text';
import type {
  AnyEntry,
  InboxItem,
  Profile,
  SectionKey,
  Skills,
  SourceRef,
  Vault,
} from './types';

export const SECTION_LABELS: Record<InboxItem['section'], string> = {
  projects: 'Project',
  hackathons: 'Hackathon',
  experience: 'Experience',
  achievements: 'Achievement',
  profile: 'Profile',
  skills: 'Skills',
};

const ARRAY_FIELDS = new Set(['tech', 'links', 'team']);
const MATCH_THRESHOLD = 0.72;

export function titleOf(section: SectionKey, d: Record<string, any>): string {
  switch (section) {
    case 'projects':
    case 'achievements':
      return d.title ?? '';
    case 'hackathons':
      return d.name ?? '';
    case 'experience':
      return [d.role, d.organisation].filter(Boolean).join(' at ');
  }
}

function matchKey(section: SectionKey, d: Record<string, any>): string {
  return section === 'experience' ? `${d.organisation ?? ''} ${d.role ?? ''}` : titleOf(section, d);
}

/** Trim strings, coerce arrays, drop empties. */
export function cleanData(section: SectionKey, raw: Record<string, unknown>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (v == null) continue;
    if (ARRAY_FIELDS.has(k)) {
      const arr = (Array.isArray(v) ? v : String(v).split(/,|;|\n/))
        .map((x) => String(x).trim())
        .filter(Boolean);
      if (arr.length) out[k] = [...new Set(arr)];
    } else if (typeof v === 'string') {
      const t = v.trim();
      if (t && !/^(n\/a|none|unknown|null|-)$/i.test(t)) out[k] = t;
    } else if (typeof v === 'number') {
      out[k] = String(v);
    }
  }
  if (section === 'projects') {
    out.tech ??= [];
    out.links ??= [];
  }
  if (section === 'hackathons') out.team ??= [];
  return out;
}

function hasTitle(section: SectionKey, d: Record<string, any>) {
  return section === 'experience' ? !!d.organisation : !!titleOf(section, d);
}

/** Fields in `incoming` that would add to or change `existing`. */
function diff(existing: Record<string, any>, incoming: Record<string, any>) {
  const data: Record<string, any> = {};
  const before: Record<string, any> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (k === 'id' || k === 'sources' || k === 'updatedAt') continue;
    const old = existing[k];
    if (Array.isArray(v)) {
      const have = new Set(((old as string[]) ?? []).map((x) => x.toLowerCase()));
      const add = v.filter((x: string) => !have.has(x.toLowerCase()));
      if (add.length) data[k] = add;
    } else if (v && (!old || String(old).trim().toLowerCase() !== String(v).trim().toLowerCase())) {
      // Don't propose replacing a long description with a shorter one.
      if (old && typeof old === 'string' && old.length > 2 * String(v).length && /description|summary|built|problem/.test(k))
        continue;
      data[k] = v;
      if (old) before[k] = old;
    }
  }
  return { data, before };
}

function mergeInto(target: Record<string, any>, incoming: Record<string, any>) {
  for (const [k, v] of Object.entries(incoming)) {
    if (Array.isArray(v)) {
      const cur: string[] = target[k] ?? [];
      const have = new Set(cur.map((x) => x.toLowerCase()));
      target[k] = [...cur, ...v.filter((x: string) => !have.has(x.toLowerCase()))];
    } else if (v && (!target[k] || String(v).length > String(target[k]).length)) {
      target[k] = v;
    }
  }
}

const sameSource = (a: SourceRef, b: SourceRef) => a.kind === b.kind && a.url === b.url && a.label === b.label;
function addSources(list: SourceRef[], more: SourceRef[]) {
  for (const s of more) if (!list.some((x) => sameSource(x, s))) list.push(s);
}

/**
 * Turn found items into Inbox proposals. Mutates the vault's inbox.
 * Returns how many proposals were created or grew.
 */
export function propose(
  vault: Vault,
  section: SectionKey,
  items: Record<string, unknown>[],
  source: SourceRef,
): number {
  let touched = 0;
  for (const raw of items) {
    const d = cleanData(section, raw);
    if (!hasTitle(section, d)) continue;
    const key = matchKey(section, d);

    // 1. Already in the vault? → an update proposal (if anything is new)
    const list = vault[section] as AnyEntry[];
    const existing = list
      .map((e) => ({ e, s: titleSimilarity(matchKey(section, e as any), key) }))
      .sort((a, b) => b.s - a.s)[0];
    if (existing && existing.s >= MATCH_THRESHOLD) {
      const { data, before } = diff(existing.e as any, d);
      if (!Object.keys(data).length) continue;
      const pending = vault.inbox.find((i) => i.op === 'update' && i.targetId === existing.e.id);
      if (pending) {
        mergeInto(pending.data, data);
        Object.assign(pending.before ?? (pending.before = {}), before);
        addSources(pending.sources, [source]);
      } else {
        vault.inbox.push({
          id: uid('in_'),
          createdAt: nowIso(),
          op: 'update',
          section,
          targetId: existing.e.id,
          data,
          before,
          sources: [source],
        });
      }
      touched++;
      continue;
    }

    // 2. Already proposed? → merge into that proposal
    const pendingNew = vault.inbox.find(
      (i) => i.op === 'new' && i.section === section && titleSimilarity(matchKey(section, i.data as any), key) >= MATCH_THRESHOLD,
    );
    if (pendingNew) {
      mergeInto(pendingNew.data, d);
      addSources(pendingNew.sources, [source]);
      touched++;
      continue;
    }

    // 3. Brand new
    vault.inbox.push({ id: uid('in_'), createdAt: nowIso(), op: 'new', section, data: d, sources: [source] });
    touched++;
  }
  return touched;
}

export function proposeProfile(vault: Vault, patch: Partial<Profile>, source: SourceRef): number {
  const data: Record<string, any> = {};
  const before: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'extra' || typeof v !== 'string' || !v.trim()) continue;
    const old = (vault.profile as any)[k];
    if (old && String(old).trim().toLowerCase() === v.trim().toLowerCase()) continue;
    data[k] = v.trim();
    if (old) before[k] = old;
  }
  if (!Object.keys(data).length) return 0;
  const pending = vault.inbox.find((i) => i.section === 'profile');
  if (pending) {
    Object.assign(pending.data, data);
    Object.assign(pending.before ?? (pending.before = {}), before);
    addSources(pending.sources, [source]);
  } else {
    vault.inbox.push({ id: uid('in_'), createdAt: nowIso(), op: 'update', section: 'profile', data, before, sources: [source] });
  }
  return 1;
}

export function proposeSkills(vault: Vault, skills: Partial<Skills>, source: SourceRef): number {
  const data: Record<string, string[]> = {};
  for (const k of ['languages', 'frameworks', 'tools'] as const) {
    const have = new Set([...vault.skills[k]].map((x) => x.toLowerCase()));
    const add = [...new Set((skills[k] ?? []).map((x) => String(x).trim()).filter(Boolean))].filter(
      (x) => !have.has(x.toLowerCase()),
    );
    if (add.length) data[k] = add;
  }
  if (!Object.keys(data).length) return 0;
  const pending = vault.inbox.find((i) => i.section === 'skills');
  if (pending) {
    mergeInto(pending.data, data);
    addSources(pending.sources, [source]);
  } else {
    vault.inbox.push({ id: uid('in_'), createdAt: nowIso(), op: 'new', section: 'skills', data, sources: [source] });
  }
  return 1;
}

/** Accept a proposal (optionally with the user's edits to its data). */
export function applyInboxItem(vault: Vault, itemId: string, edited?: Record<string, any>): void {
  const idx = vault.inbox.findIndex((i) => i.id === itemId);
  if (idx < 0) return;
  const item = vault.inbox[idx];
  const data = edited ?? item.data;
  vault.inbox.splice(idx, 1);

  if (item.section === 'profile') {
    Object.assign(vault.profile, data);
    return;
  }
  if (item.section === 'skills') {
    for (const k of ['languages', 'frameworks', 'tools'] as const) {
      const have = new Set(vault.skills[k].map((x) => x.toLowerCase()));
      for (const s of (data[k] as string[]) ?? []) if (!have.has(s.toLowerCase())) vault.skills[k].push(s);
    }
    return;
  }

  const section = item.section;
  const list = vault[section] as AnyEntry[];
  if (item.op === 'update' && item.targetId) {
    const target = list.find((e) => e.id === item.targetId) as any;
    if (target) {
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) mergeInto(target, { [k]: v });
        else target[k] = v;
      }
      target.updatedAt = nowIso();
      addSources(target.sources, item.sources);
      relink(vault);
      return;
    }
  }
  list.push({ ...(cleanData(section, data) as any), id: uid(section.slice(0, 2) + '_'), updatedAt: nowIso(), sources: item.sources });
  relink(vault);
}

export function dismissInboxItem(vault: Vault, itemId: string): void {
  vault.inbox = vault.inbox.filter((i) => i.id !== itemId);
}

/** A hackathon links to its project instead of repeating it. */
export function relink(vault: Vault): void {
  for (const h of vault.hackathons) {
    if (h.projectId && vault.projects.some((p) => p.id === h.projectId)) continue;
    if (!h.projectTitle) continue;
    const best = vault.projects
      .map((p) => ({ p, s: titleSimilarity(p.title, h.projectTitle!) }))
      .sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= MATCH_THRESHOLD) h.projectId = best.p.id;
  }
}

export function inboxSummary(vault: Vault): string {
  const counts: Record<string, number> = {};
  for (const i of vault.inbox) if (i.op === 'new') counts[i.section] = (counts[i.section] ?? 0) + 1;
  const parts = Object.entries(counts).map(([s, n]) => {
    const label = SECTION_LABELS[s as InboxItem['section']].toLowerCase();
    return `${n} ${label}${n === 1 || label === 'skills' ? '' : 's'}`;
  });
  const updates = vault.inbox.filter((i) => i.op === 'update').length;
  if (updates) parts.push(`${updates} update${updates === 1 ? '' : 's'}`);
  return parts.join(', ');
}
