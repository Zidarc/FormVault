// After filling: save approved answers, learn writing style from edits, and offer new facts to the Inbox.

import { STYLE_SYSTEM } from '../ai/prompts';
import { embed, generateJson } from '../ai/providers';
import { nowIso, uid } from '../ids';
import { proposeProfile } from '../inbox';
import { extractToInbox } from '../import/extract';
import { updateVault } from '../storage';
import { editRatio, normalize } from '../text';
import type { AnswerMemory, Profile, Settings, Vault } from '../types';
import type { Draft } from './draft';

const str = (x: string | string[]) => (Array.isArray(x) ? x.join(', ') : x);

export interface LearnResult {
  saved: number;
  newRules: string[];
  profileUpdates: number;
  inboxFinds: number;
}

/**
 * @param drafts approved drafts as filled
 * @param typed values read back from the page after filling (user may have typed more), keyed "frameId:fieldId"
 */
export async function learnFromForm(drafts: Draft[], site: string, settings: Settings, typed: Record<string, string | string[]> = {}): Promise<LearnResult> {
  const res: LearnResult = { saved: 0, newRules: [], profileUpdates: 0, inboxFinds: 0 };
  const finalOf = (d: Draft) => {
    const t = typed[`${d.field.frameId}:${d.field.id}`];
    return t != null && str(t).trim() ? t : d.answer;
  };

  const written = drafts.filter(
    (d) => d.approved && ['ai', 'adapted', 'memory', 'pick', 'checklist'].includes(d.origin) && (d.field.kind === 'textarea' || d.field.kind === 'contenteditable' || d.field.wordLimit || str(d.answer).length > 60),
  );
  const pairs: { draft: string; final: string }[] = [];
  const newMemories: AnswerMemory[] = [];
  let shown = 0;
  let unedited = 0;

  for (const d of written) {
    const final = str(finalOf(d)).trim();
    if (!final || /^\[.*\]$/.test(final)) continue;
    const ratio = editRatio(str(d.original), final);
    shown++;
    if (ratio < 0.03) unedited++;
    if (ratio >= 0.05 && ratio < 0.9 && d.origin !== 'memory') pairs.push({ draft: str(d.original), final });
    newMemories.push({
      id: uid('am_'),
      question: [d.field.question, d.field.description].filter(Boolean).join(' — '),
      site,
      wordLimit: d.field.wordLimit,
      text: final,
      usedEntryIds: d.sources,
      editRatio: ratio,
      createdAt: nowIso(),
    });
  }

  // Embeddings for the new memories (one call; fine if unavailable)
  const vecs = newMemories.length ? await embed(settings, newMemories.map((m) => m.question)) : null;
  if (vecs) newMemories.forEach((m, i) => (m.embedding = vecs[i]));

  // Writing style from edits (one call, only when there were real edits)
  if (pairs.length) {
    try {
      let existing: string[] = [];
      await updateVault((v) => void (existing = v.style.map((r) => r.rule)));
      const out = await generateJson<{ rules: string[] }>(settings, {
        system: STYLE_SYSTEM,
        prompt: `Existing rules:\n${existing.map((r) => `- ${r}`).join('\n') || '(none)'}\n\nEdits:\n${JSON.stringify(pairs.slice(0, 8))}`,
        temperature: 0.2,
      });
      res.newRules = (out.rules ?? []).filter((r) => typeof r === 'string' && r.trim() && !existing.some((e) => normalize(e) === normalize(r))).slice(0, 3);
    } catch (e) {
      console.warn('[FormVault] style learning skipped', e);
    }
  }

  // Profile updates: "Update CGPA from 3.4 to 3.5?"
  const profilePatch: Partial<Profile> = {};
  for (const d of drafts) {
    if (!d.profileKey || d.profileKey === 'extra' || d.profileKey === 'firstName' || d.profileKey === 'lastName') continue;
    const final = str(finalOf(d)).trim();
    if (final && final !== str(d.original).trim() && !d.field.options?.length) (profilePatch as any)[d.profileKey] = final;
  }

  await updateVault((v: Vault) => {
    for (const m of newMemories) {
      // Same question on the same site → replace instead of duplicating
      const i = v.answers.findIndex((a) => a.site === m.site && normalize(a.question) === normalize(m.question));
      if (i >= 0) v.answers[i] = m;
      else v.answers.push(m);
    }
    res.saved = newMemories.length;
    v.stats.draftsShown += shown;
    v.stats.draftsAcceptedUnedited += unedited;
    for (const r of res.newRules) v.style.push({ id: uid('st_'), rule: r.trim(), createdAt: nowIso() });
    res.profileUpdates = proposeProfile(v, profilePatch, { kind: 'form', label: `Form · ${site}`, at: nowIso() });
  });

  // New facts typed into answers the vault didn't have → Inbox
  const newFacts = drafts
    .filter((d) => d.approved && d.notInVault && !d.profileKey)
    .map((d) => ({ q: d.field.question, a: str(finalOf(d)).trim() }))
    .filter((x) => x.a.length > 40 && !/^\[.*\]$/.test(x.a));
  if (newFacts.length) {
    try {
      res.inboxFinds = await extractToInbox(
        [newFacts.map((x) => `Q: ${x.q}\nA: ${x.a}`).join('\n\n')],
        { kind: 'form', label: `Form · ${site}`, at: nowIso() },
        undefined,
        settings,
      );
    } catch (e) {
      console.warn('[FormVault] could not read new facts', e);
    }
  }
  return res;
}
