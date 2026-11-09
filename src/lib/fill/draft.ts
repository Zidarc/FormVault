// Filling a form: instant fills → answer memory → vault picks → ONE AI call for everything else.

import { FILL_SYSTEM, REWRITE_SYSTEM, WRITE_FROM_ENTRY_SYSTEM } from '../ai/prompts';
import { generateJson } from '../ai/providers';
import { rankBySimilarity } from '../text';
import type { Settings, Vault } from '../types';
import { ensureMemoryEmbeddings, matchMemory, questionEmbeddings, type MemoryMatch } from './memory';
import { candidates, checklistText, detectPick, entryText, type PickCandidate, type PickSection } from './pick';
import { instantFill } from './profileMatch';
import type { ScannedField, ScanResult } from './types';

export type Origin = 'profile' | 'memory' | 'adapted' | 'ai' | 'pick' | 'checklist' | 'none' | 'skip';

export interface Draft {
  field: ScannedField;
  origin: Origin;
  label: string;
  answer: string | string[];
  /** As first drafted — to measure how much the user edited */
  original: string | string[];
  sources: string[];
  approved: boolean;
  notInVault?: boolean;
  profileKey?: string;
  memoryId?: string;
  pick?: { section: PickSection; candidates: PickCandidate[]; chosen?: string };
  checklist?: { section: PickSection; items: { id: string; label: string; checked: boolean }[] };
}

const TEXTY = new Set(['text', 'textarea', 'contenteditable', 'url', 'number', 'date']);
const isLong = (f: ScannedField) => f.kind === 'textarea' || f.kind === 'contenteditable' || !!f.wordLimit;

export function siteOf(scan: Pick<ScanResult, 'url' | 'title'>): string {
  try {
    const u = new URL(scan.url);
    if (u.hostname === 'docs.google.com' && scan.title) return scan.title.replace(/\s*-\s*Google Forms$/, '');
    return scan.title ? `${scan.title} (${u.hostname})` : u.hostname;
  } catch {
    return scan.title || 'a form';
  }
}

/** Compact vault context for the AI — never includes the Profile. */
export function vaultContext(vault: Vault, questions: string[], max = 18) {
  const cut = (s?: string, n = 500) => (s && s.length > n ? s.slice(0, n) + '…' : s);
  const pick = <T,>(list: T[], text: (x: T) => string) =>
    list.length <= max ? list : rankBySimilarity(questions.join(' '), list, text).slice(0, max).map((r) => r.item);
  const projects = pick(vault.projects, (p) => [p.title, p.summary, p.built, p.description, p.tech.join(' ')].join(' ')).map((p) => ({
    id: p.id, title: p.title, dates: [p.startDate, p.endDate].filter(Boolean).join('–') || undefined, role: p.role,
    tech: p.tech.length ? p.tech : undefined, problem: cut(p.problem), built: cut(p.built), result: cut(p.result),
    summary: cut(p.summary, 300), description: cut(p.description, 700), links: p.links.length ? p.links : undefined,
  }));
  const hackathons = pick(vault.hackathons, (h) => [h.name, h.result, h.organiser].join(' ')).map((h) => ({
    id: h.id, name: h.name, organiser: h.organiser, date: h.date, teamSize: h.team.length || undefined,
    project: vault.projects.find((p) => p.id === h.projectId)?.title ?? h.projectTitle, result: h.result,
  }));
  const experience = pick(vault.experience, (e) => [e.organisation, e.role, e.description].join(' ')).map((e) => ({
    id: e.id, organisation: e.organisation, role: e.role, dates: [e.startDate, e.endDate].filter(Boolean).join('–') || undefined,
    description: cut(e.description),
  }));
  const achievements = pick(vault.achievements, (a) => [a.title, a.issuer, a.description].join(' ')).map((a) => ({
    id: a.id, title: a.title, issuer: a.issuer, date: a.date, description: cut(a.description, 200),
  }));
  return { projects, hackathons, experience, achievements, skills: vault.skills, education: { degree: vault.profile.degree, graduationYear: vault.profile.graduationYear } };
}

const styleBlock = (vault: Vault) =>
  vault.style.length ? `Writing style rules:\n${vault.style.map((r) => `- ${r.rule}`).join('\n')}` : 'Writing style rules: (none yet)';

function sourceLabel(vault: Vault, ids: string[]): string {
  const names = ids
    .map((id) => {
      const p = vault.projects.find((x) => x.id === id);
      if (p) return `Project ${p.title}`;
      const h = vault.hackathons.find((x) => x.id === id);
      if (h) return h.name;
      const e = vault.experience.find((x) => x.id === id);
      if (e) return e.organisation;
      const a = vault.achievements.find((x) => x.id === id);
      return a?.title;
    })
    .filter(Boolean);
  return names.length ? `From vault: ${names.slice(0, 3).join(', ')}` : 'From your vault';
}

export interface DraftProgress {
  (msg: string): void;
}

export async function draftForm(scan: ScanResult, vault: Vault, settings: Settings, onProgress?: DraftProgress): Promise<Draft[]> {
  const drafts: Draft[] = [];
  const mk = (field: ScannedField, d: Partial<Draft>): Draft => {
    const answer = d.answer ?? (field.kind === 'checkbox' ? [] : '');
    return { field, origin: 'none', label: '', sources: [], approved: false, ...d, answer, original: answer };
  };

  // 1. Instant fills, files, picks
  const forMemory: ScannedField[] = [];
  for (const f of scan.fields) {
    if (f.kind === 'file') {
      drafts.push(mk(f, { origin: 'skip', label: 'Upload this file yourself' }));
      continue;
    }
    if (f.kind === 'checkbox-single') {
      drafts.push(mk(f, { origin: 'skip', label: 'Tick this yourself if it applies' }));
      continue;
    }
    const pf = instantFill(f, vault.profile);
    if (pf) {
      drafts.push(
        mk(f, {
          origin: pf.value ? 'profile' : 'none',
          label: pf.value ? 'From your profile' : `Not in your profile — add your ${pf.key === 'extra' ? 'answer' : pf.key}`,
          answer: pf.value,
          profileKey: pf.key,
          approved: !!pf.value,
          notInVault: !pf.value,
        }),
      );
      continue;
    }
    if (TEXTY.has(f.kind) && isLong(f)) {
      const pick = detectPick(f.question + ' ' + (f.description ?? ''), vault);
      if (pick?.mode === 'list') {
        const items = (vault[pick.section] as any[]).map((e) => ({ id: e.id, label: entryText(vault, pick.section, e).title, checked: true }));
        drafts.push(
          mk(f, {
            origin: 'checklist',
            label: 'From your vault — untick any to leave out',
            checklist: { section: pick.section, items },
            answer: checklistText(vault, pick.section, items.map((i) => i.id)),
            sources: items.map((i) => i.id),
          }),
        );
        continue;
      }
      if (pick?.mode === 'pick') {
        drafts.push(
          mk(f, {
            origin: 'pick',
            label: 'Pick one from your vault',
            pick: { section: pick.section, candidates: candidates(vault, pick.section, f.question).slice(0, 6) },
          }),
        );
        continue;
      }
    }
    forMemory.push(f);
  }

  // 2. Answer memory
  const toAi: { f: ScannedField; reuse?: MemoryMatch }[] = [];
  const memQs = forMemory.filter((f) => TEXTY.has(f.kind) && isLong(f));
  let qVecs: number[][] | null = null;
  if (memQs.length && vault.answers.length) {
    onProgress?.('Checking your saved answers…');
    const ok = await ensureMemoryEmbeddings(settings, vault.answers);
    if (ok) qVecs = await questionEmbeddings(settings, memQs.map((f) => f.question + ' ' + (f.description ?? '')));
  }
  for (const f of forMemory) {
    const qi = memQs.indexOf(f);
    const m = qi >= 0 ? matchMemory(f.question, f.wordLimit, vault.answers, qVecs?.[qi]) : null;
    if (m?.mode === 'reuse') {
      drafts.push(
        mk(f, {
          origin: 'memory',
          label: `Your approved answer from ${m.memory.site}`,
          answer: m.memory.text,
          sources: m.memory.usedEntryIds,
          memoryId: m.memory.id,
        }),
      );
    } else toAi.push({ f, reuse: m ?? undefined });
  }

  // 3. One AI call for everything else
  if (toAi.length) {
    onProgress?.(`Drafting ${toAi.length} answer${toAi.length === 1 ? '' : 's'} (one AI call)…`);
    const questions = toAi.map(({ f, reuse }) => ({
      id: f.id + '@' + f.frameId,
      question: f.question,
      description: f.description,
      type: f.kind,
      options: f.options,
      wordLimit: f.wordLimit,
      charLimit: f.charLimit,
      required: f.required,
      ...(reuse ? { reuse: { previousAnswer: reuse.memory.text, previousWordLimit: reuse.memory.wordLimit } } : {}),
    }));
    const ctx = vaultContext(vault, toAi.map((x) => x.f.question));
    const out = await generateJson<{ answers: { id: string; answer: string | string[]; sources?: string[]; notInVault?: boolean }[] }>(settings, {
      system: FILL_SYSTEM,
      prompt: `Form: ${siteOf(scan)}\n\nVault:\n${JSON.stringify(ctx)}\n\n${styleBlock(vault)}\n\nQuestions:\n${JSON.stringify(questions)}`,
      temperature: 0.5,
    });
    const byId = new Map((out.answers ?? []).map((a) => [String(a.id), a]));
    for (const { f, reuse } of toAi) {
      const a = byId.get(f.id + '@' + f.frameId);
      let answer: string | string[] = a?.answer ?? (f.kind === 'checkbox' ? [] : '');
      if (f.kind === 'checkbox' && typeof answer === 'string') answer = answer ? answer.split(/\s*[,;\n]\s*/) : [];
      if (f.kind !== 'checkbox' && Array.isArray(answer)) answer = answer.join(', ');
      const notIn = !!a?.notInVault || !a;
      const sources = (a?.sources ?? []).filter((id) => typeof id === 'string');
      drafts.push(
        mk(f, {
          origin: notIn ? 'none' : reuse ? 'adapted' : 'ai',
          label: notIn ? 'Not in your vault' : reuse ? `Adapted from your answer on ${reuse.memory.site}` : sourceLabel(vault, sources),
          answer,
          sources: reuse ? [...new Set([...sources, ...reuse.memory.usedEntryIds])] : sources,
          notInVault: notIn,
          memoryId: reuse?.memory.id,
        }),
      );
    }
  }

  // Keep page order
  const order = new Map(scan.fields.map((f, i) => [f.frameId + ':' + f.id, i]));
  return drafts.sort((a, b) => order.get(a.field.frameId + ':' + a.field.id)! - order.get(b.field.frameId + ':' + b.field.id)!);
}

export type RewriteKind = 'shorter' | 'longer' | 'formal' | 'numbers';
const REWRITE_ASK: Record<RewriteKind, string> = {
  shorter: 'Make it about 30% shorter.',
  longer: 'Make it about 40% longer, adding detail only from the vault entries given.',
  formal: 'Make it more formal and polished.',
  numbers: 'Add concrete numbers (team size, users, results, dates) wherever the vault entries give them. Do not invent numbers.',
};

export async function rewrite(d: Draft, kind: RewriteKind, vault: Vault, settings: Settings): Promise<string> {
  const entries = vaultContext(vault, [d.field.question]);
  const used = d.sources.length
    ? Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, Array.isArray(v) ? v.filter((x: any) => d.sources.includes(x.id)) : v]))
    : entries;
  const out = await generateJson<{ answer: string }>(settings, {
    system: REWRITE_SYSTEM,
    prompt: `${REWRITE_ASK[kind]}${d.field.wordLimit ? ` Stay under ${d.field.wordLimit} words.` : ''}\n\nQuestion: ${d.field.question}\n\nCurrent answer:\n${String(d.answer)}\n\nVault entries:\n${JSON.stringify(used)}\n\n${styleBlock(vault)}`,
  });
  return out.answer ?? String(d.answer);
}

export async function writeFromEntry(d: Draft, entryId: string, vault: Vault, settings: Settings): Promise<string> {
  const ctx = vaultContext(vault, [d.field.question], 1000);
  const all = [...ctx.projects, ...ctx.hackathons, ...ctx.experience, ...ctx.achievements] as any[];
  const entry = all.find((e) => e.id === entryId);
  const out = await generateJson<{ answer: string }>(settings, {
    system: WRITE_FROM_ENTRY_SYSTEM,
    prompt: `Question: ${d.field.question}\n${d.field.description ?? ''}\n${d.field.wordLimit ? `Word limit: ${d.field.wordLimit}` : ''}\n\nEntry:\n${JSON.stringify(entry)}\n\n${styleBlock(vault)}`,
  });
  return out.answer ?? '';
}
