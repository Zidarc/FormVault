// "Which project are you proudest of?" → cards from the vault, best match first.
// "List your past hackathons" → a checklist of all of them, already ticked.

import { normalize, rankBySimilarity } from '../text';
import type { Vault } from '../types';

export type PickSection = 'projects' | 'hackathons' | 'achievements' | 'experience';

export interface PickCandidate {
  id: string;
  title: string;
  sub?: string;
  score: number;
}

const SECTION_WORDS: [PickSection, RegExp][] = [
  ['hackathons', /\b(hackathons?|competitions?|contests?|game ?jams?)\b/],
  ['achievements', /\b(achievements?|awards?|honou?rs?|certifications?|certificates?|accomplishments?)\b/],
  ['experience', /\b(experiences?|internships?|jobs?|work|positions?|roles?)\b/],
  ['projects', /\b(projects?|ideas?|products?|apps?|things? you(?:'ve| have)? built)\b/],
];

const LIST_RE = /\b(list|mention|name|enumerate|all (of )?(your|the)|previous|past|prior|other)\b/;
const PICK_RE =
  /\b(best|proudest|proud|favou?rite|most (impressive|challenging|significant|interesting|complex|innovative)|describe (a|one|your)|tell us about (a|one|your)|which (project|idea)|your (best )?idea|a (project|time) (you|when|that)|walk us through)\b/;

export function detectPick(question: string, vault: Vault): { mode: 'list' | 'pick'; section: PickSection } | null {
  const q = normalize(question);
  const sec = SECTION_WORDS.find(([, re]) => re.test(q))?.[0];
  if (!sec) return null;
  if (!(vault[sec] as unknown[]).length) return null;
  const plural = new RegExp(`\\b${sec.replace(/s$/, '')}s\\b`).test(q) || (sec === 'experience' && /experiences|internships/.test(q));
  if (LIST_RE.test(q) && plural) return { mode: 'list', section: sec };
  if (PICK_RE.test(q) && sec !== 'achievements') return { mode: 'pick', section: sec };
  return null;
}

export function entryText(vault: Vault, section: PickSection, e: any): { title: string; sub: string; text: string } {
  switch (section) {
    case 'projects':
      return {
        title: e.title,
        sub: [e.startDate?.slice(0, 4), e.result, (e.tech ?? []).slice(0, 3).join(', ')].filter(Boolean).join(' · '),
        text: [e.title, e.summary, e.problem, e.built, e.result, (e.tech ?? []).join(' '), e.description].filter(Boolean).join(' '),
      };
    case 'hackathons': {
      const p = vault.projects.find((x) => x.id === e.projectId)?.title ?? e.projectTitle;
      return {
        title: e.name,
        sub: [e.date, e.result, p].filter(Boolean).join(' · '),
        text: [e.name, e.organiser, e.result, p].filter(Boolean).join(' '),
      };
    }
    case 'achievements':
      return { title: e.title, sub: [e.issuer, e.date].filter(Boolean).join(' · '), text: [e.title, e.issuer, e.description].filter(Boolean).join(' ') };
    case 'experience':
      return {
        title: [e.role, e.organisation].filter(Boolean).join(' at '),
        sub: [e.startDate, e.endDate].filter(Boolean).join(' – '),
        text: [e.role, e.organisation, e.description].filter(Boolean).join(' '),
      };
  }
}

export function candidates(vault: Vault, section: PickSection, question: string): PickCandidate[] {
  const list = vault[section] as any[];
  return rankBySimilarity(question, list, (e) => entryText(vault, section, e).text).map(({ item, score }) => {
    const t = entryText(vault, section, item);
    // Winners and recent entries float up a little
    const bonus = (/(won|winner|1st|first|2nd|second|3rd|prize|finalist)/i.test(t.sub) ? 0.05 : 0) + (item.updatedAt ? 0 : 0);
    return { id: item.id, title: t.title, sub: t.sub, score: score + bonus };
  }).sort((a, b) => b.score - a.score);
}

/** Text for a ticked checklist, one line per entry. */
export function checklistText(vault: Vault, section: PickSection, ids: string[]): string {
  const list = vault[section] as any[];
  return ids
    .map((id) => list.find((e) => e.id === id))
    .filter(Boolean)
    .map((e) => {
      const t = entryText(vault, section, e);
      return `• ${t.title}${t.sub ? ` (${t.sub})` : ''}`;
    })
    .join('\n');
}
