// Basic fields (name, email, phone, university…) are filled from the Profile locally — no AI call,
// and personal details never leave the browser. They still appear in the review list.

import { normalize, jaccard, titleSimilarity } from '../text';
import type { Profile } from '../types';
import type { ScannedField } from './types';

type Key = Exclude<keyof Profile, 'extra'> | 'firstName' | 'lastName';

const NOT_ME = /(team|project|idea|startup|company|organi[sz]ation|university|institute|school|college|member|mate|leader|lead|mentor|reference|referee|product|app|parent|father|mother|guardian|emergency|supervisor|advisor|hackathon|event)/;

const RULES: [Key, RegExp][] = [
  ['email', /\be-?mail\b/],
  ['linkedin', /linked\s*in/],
  ['github', /\bgit\s*hub\b/],
  ['cnic', /\b(cnic|nic|national id|id card|identity card)\b/],
  ['phone', /\b(phone|mobile|cell|whats\s*app|contact (no|number|#))\b/],
  ['portfolio', /\b(portfolio|personal (website|site|url)|website)\b/],
  ['rollNo', /\b(roll\s*(no|number|#)?|student id|registration (no|number)|enrol?lment (no|number|id)?)\b/],
  ['cgpa', /\b(c?gpa|grade point)\b/],
  ['graduationYear', /\b(graduation|graduating|batch|passing out|expected to graduate)\b/],
  ['degree', /\b(degree|program(me)?|major|field of study|discipline)\b/],
  ['university', /\b(university|institute|institution|college|school|campus)\b/],
  ['city', /\b(city|town|based in|where are you (based|from)|current location|location)\b/],
  ['country', /\b(country|nationality)\b/],
  ['firstName', /\b(first|given)\s*name\b/],
  ['lastName', /\b(last|family)\s*name|surname\b/],
  ['name', /\b(full\s*name|your name|name)\b/],
];

const AUTOCOMPLETE: Record<string, Key> = {
  email: 'email', tel: 'phone', 'tel-national': 'phone', name: 'name', 'given-name': 'firstName',
  'family-name': 'lastName', 'address-level2': 'city', 'country-name': 'country', country: 'country', url: 'portfolio',
};

export function profileKeyFor(f: ScannedField): Key | null {
  const ac = f.hint?.split(' ')[0]?.toLowerCase();
  if (ac && AUTOCOMPLETE[ac]) return AUTOCOMPLETE[ac];
  if (f.kind === 'email') return 'email';
  if (f.kind === 'tel') return 'phone';
  const q = normalize(f.question);
  if (!q || q.split(' ').length > 14) return null; // long questions aren't contact fields
  for (const [key, re] of RULES) {
    if (!re.test(q)) continue;
    // "Team name", "University of your teammate" etc. aren't about you.
    if ((key === 'name' || key === 'firstName' || key === 'lastName') && NOT_ME.test(q)) return null;
    if ((key === 'university' || key === 'degree') && /\b(team|member|mate)\b/.test(q)) return null;
    if (key === 'name' && /\bname of\b/.test(q)) return null;
    return key;
  }
  return null;
}

export function profileValue(p: Profile, key: Key): string | undefined {
  if (key === 'firstName') return p.name?.split(' ')[0];
  if (key === 'lastName') return p.name?.split(' ').slice(1).join(' ') || undefined;
  return p[key] as string | undefined;
}

/** Match "T-shirt size" style custom profile fields. */
function extraFor(p: Profile, q: string): string | undefined {
  let best: [number, string] | null = null;
  for (const [k, v] of Object.entries(p.extra ?? {})) {
    const s = Math.max(jaccard(k, q), normalize(q).includes(normalize(k)) ? 0.8 : 0);
    if (s >= 0.5 && (!best || s > best[0])) best = [s, v];
  }
  return best?.[1];
}

/** Pick the option that best matches a profile value (e.g. university dropdown). */
export function bestOption(options: string[], value: string): string | undefined {
  let best: [number, string] | null = null;
  for (const o of options) {
    const s = titleSimilarity(o, value);
    if (!best || s > best[0]) best = [s, o];
  }
  return best && best[0] >= 0.5 ? best[1] : undefined;
}

export interface ProfileFill {
  key: string;
  value: string;
}

export function instantFill(f: ScannedField, p: Profile): ProfileFill | null {
  const key = profileKeyFor(f);
  let value = key ? profileValue(p, key) : undefined;
  let k: string | undefined = key ?? undefined;
  if (!value) {
    const ex = extraFor(p, f.question);
    if (ex) {
      value = ex;
      k = 'extra';
    }
  }
  if (!value || !k) return key ? { key, value: '' } : null;
  if (f.options?.length) {
    const o = bestOption(f.options, value);
    if (!o) return null;
    value = o;
  }
  return { key: k, value };
}
