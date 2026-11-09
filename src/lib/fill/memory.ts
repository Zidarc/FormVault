// Answer memory: approved answers are reused on questions that mean the same thing,
// even when worded differently. Meaning is compared with embeddings (Gemini/OpenAI free tiers)
// or, without them, a local TF-IDF fallback.

import { embed } from '../ai/providers';
import { cosine, rankBySimilarity, wordCount } from '../text';
import type { AnswerMemory, Settings } from '../types';

export interface MemoryMatch {
  memory: AnswerMemory;
  score: number;
  /** reuse = offer as is; adapt = shorten/extend to the new limit */
  mode: 'reuse' | 'adapt';
}

const EMB_STRONG = 0.83;
const TFIDF_STRONG = 0.5;

export async function questionEmbeddings(settings: Settings, questions: string[]): Promise<number[][] | null> {
  return embed(settings, questions);
}

/** Make sure every memory has an embedding (one batched call for the missing ones). */
export async function ensureMemoryEmbeddings(settings: Settings, memories: AnswerMemory[]): Promise<boolean> {
  const missing = memories.filter((m) => !m.embedding);
  if (!missing.length) return true;
  const vecs = await embed(settings, missing.map((m) => m.question));
  if (!vecs) return false;
  missing.forEach((m, i) => (m.embedding = vecs[i]));
  return true;
}

export function decideMode(m: AnswerMemory, wordLimit?: number): 'reuse' | 'adapt' {
  const words = wordCount(m.text);
  if (!wordLimit) return 'reuse';
  if (words > wordLimit) return 'adapt'; // too long now
  if (m.wordLimit && wordLimit >= m.wordLimit * 1.6 && words < wordLimit * 0.5) return 'adapt'; // much more room now
  return 'reuse';
}

export function matchMemory(
  question: string,
  wordLimit: number | undefined,
  memories: AnswerMemory[],
  qVec?: number[] | null,
): MemoryMatch | null {
  if (!memories.length || question.trim().length < 6) return null;
  let best: { m: AnswerMemory; s: number } | null = null;
  if (qVec && memories.every((m) => m.embedding)) {
    for (const m of memories) {
      const s = cosine(qVec, m.embedding!);
      if (!best || s > best.s) best = { m, s };
    }
    if (!best || best.s < EMB_STRONG) return null;
  } else {
    const r = rankBySimilarity(question, memories, (m) => m.question)[0];
    if (!r || r.score < TFIDF_STRONG) return null;
    best = { m: r.item, s: r.score };
  }
  return { memory: best.m, score: best.s, mode: decideMode(best.m, wordLimit) };
}
