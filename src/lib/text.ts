// Small, dependency-free text helpers: similarity, keyword filtering, redaction.

const STOP = new Set(
  'a an and are as at be by for from has have i in is it its me my of on or our so that the this to was we were what which who will with you your us do did does how why when where tell describe please'.split(
    ' ',
  ),
);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

/** Very light stemmer — enough to match "projects"/"project", "built"/"building". */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

export function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Title similarity used for duplicate merging ("NASA Space Apps 2025" ≈ "Space Apps Challenge 2025"). */
export function titleSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length > 4 && nb.length > 4 && (na.includes(nb) || nb.includes(na))) return 0.9;
  return jaccard(a, b);
}

/** TF-IDF cosine similarity of a query against a set of documents. Used when no embeddings are available. */
export function rankBySimilarity<T>(query: string, docs: T[], text: (d: T) => string): { item: T; score: number }[] {
  const docTokens = docs.map((d) => tokens(text(d)));
  const q = tokens(query);
  const df = new Map<string, number>();
  for (const ts of docTokens) for (const t of new Set(ts)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length + 1;
  const vec = (ts: string[]) => {
    const tf = new Map<string, number>();
    for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v = new Map<string, number>();
    for (const [t, c] of tf) v.set(t, (1 + Math.log(c)) * Math.log(1 + N / (1 + (df.get(t) ?? 0))));
    return v;
  };
  const qv = vec(q);
  const qn = Math.sqrt([...qv.values()].reduce((s, x) => s + x * x, 0)) || 1;
  return docs
    .map((item, i) => {
      const dv = vec(docTokens[i]);
      let dot = 0;
      for (const [t, w] of qv) dot += w * (dv.get(t) ?? 0);
      const dn = Math.sqrt([...dv.values()].reduce((s, x) => s + x * x, 0)) || 1;
      return { item, score: dot / (qn * dn) };
    })
    .sort((a, b) => b.score - a.score);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** Share of words changed between the draft and the final text (0 = same, 1 = completely different). */
export function editRatio(draft: string, final: string): number {
  const a = draft.trim().split(/\s+/).filter(Boolean);
  const b = final.trim().split(/\s+/).filter(Boolean);
  if (!a.length && !b.length) return 0;
  // LCS on words
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  const lcs = dp[b.length];
  return 1 - (2 * lcs) / (a.length + b.length);
}

// ── Cost control: keep only text that talks about projects/hackathons ──

export const SIGNAL_WORDS = [
  'hackathon', 'project', 'built', 'build', 'building', 'won', 'winner', 'prize', 'finalist', 'runner',
  'deployed', 'launched', 'shipped', 'competition', 'award', 'certificate', 'certified', 'internship',
  'intern', 'selected', 'devpost', 'github', 'team', 'mvp', 'startup', 'app', 'website', 'model',
  'placed', 'position', 'challenge', 'demo', 'pitch', 'research', 'paper', 'published', 'scholarship',
  'fellowship', 'volunteer', 'lead', 'organized', 'organised', 'mentor',
];
const SIGNAL_RE = new RegExp(`\b(${SIGNAL_WORDS.join('|')})`, 'i');

export const hasSignal = (s: string) => SIGNAL_RE.test(s);

/** Split text into paragraphs and keep those with signal words, plus a little context. */
export function filterSignal(text: string, maxChars = 200_000): string {
  const paras = text.split(/\n\s*\n|\r\n\s*\r\n/).map((p) => p.trim()).filter(Boolean);
  const keep: string[] = [];
  let size = 0;
  for (const p of paras) {
    if (!hasSignal(p)) continue;
    const clipped = p.length > 3000 ? p.slice(0, 3000) + '…' : p;
    keep.push(clipped);
    size += clipped.length;
    if (size > maxChars) break;
  }
  return keep.join('\n\n');
}

/** Pack items into batches of at most `budget` characters. */
export function batchTexts(items: string[], budget = 60_000): string[] {
  const out: string[] = [];
  let cur = '';
  for (const it of items) {
    if (cur && cur.length + it.length + 8 > budget) {
      out.push(cur);
      cur = '';
    }
    cur += (cur ? '\n\n---\n\n' : '') + it.slice(0, budget);
  }
  if (cur) out.push(cur);
  return out;
}

// ── Personal details never go to the AI ──

export const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
export const PHONE_RE = /(?:\+?\d[\d\s-]{8,}\d)/g;
export const CNIC_RE = /\b\d{5}-?\d{7}-?\d\b/g;

export function redactPersonal(text: string, extra: string[] = []): string {
  let t = text.replace(EMAIL_RE, '[email]').replace(CNIC_RE, '[id]').replace(PHONE_RE, (m) =>
    m.replace(/\D/g, '').length >= 10 ? '[phone]' : m,
  );
  for (const e of extra) {
    if (e && e.trim().length > 2) t = t.split(e.trim()).join('[me]');
  }
  return t;
}
