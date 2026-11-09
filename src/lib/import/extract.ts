// Send filtered text to the AI in a few large batches and turn the reply into Inbox proposals.

import { EXTRACT_SYSTEM, extractPrompt } from '../ai/prompts';
import { generateJson } from '../ai/providers';
import { propose, proposeSkills } from '../inbox';
import { loadSettings, loadVault, updateVault } from '../storage';
import { batchTexts, redactPersonal } from '../text';
import type { SectionKey, Settings, SourceRef, Vault } from '../types';

export interface Extracted {
  projects?: Record<string, unknown>[];
  hackathons?: Record<string, unknown>[];
  experience?: Record<string, unknown>[];
  achievements?: Record<string, unknown>[];
  skills?: { languages?: string[]; frameworks?: string[]; tools?: string[] };
}

export interface ImportProgress {
  (msg: string, done?: number, total?: number): void;
}

const SECTIONS: SectionKey[] = ['projects', 'hackathons', 'experience', 'achievements'];

/** Put an extraction result into the Inbox. Returns number of proposals touched. */
export function proposeExtracted(vault: Vault, x: Extracted, source: SourceRef): number {
  let n = 0;
  for (const s of SECTIONS) n += propose(vault, s, (x[s] ?? []) as Record<string, unknown>[], source);
  if (x.skills) n += proposeSkills(vault, x.skills, source);
  return n;
}

/**
 * Extract from one or more text pieces (already filtered for signal).
 * Personal details are redacted before anything leaves the browser.
 */
export async function extractToInbox(
  pieces: string[],
  source: SourceRef,
  onProgress?: ImportProgress,
  settings?: Settings,
): Promise<number> {
  const s = settings ?? (await loadSettings());
  const vaultNow = await loadVault();
  const me = [vaultNow.profile.name, vaultNow.profile.email, vaultNow.profile.phone].filter(Boolean) as string[];
  const batches = batchTexts(pieces.map((p) => redactPersonal(p, me)));
  let total = 0;
  for (let i = 0; i < batches.length; i++) {
    onProgress?.(`Reading ${source.label ?? source.kind} with AI (${i + 1}/${batches.length})…`, i, batches.length);
    const x = await generateJson<Extracted>(s, {
      system: EXTRACT_SYSTEM,
      prompt: extractPrompt(source.label ?? source.kind, batches[i]),
      temperature: 0.1,
    });
    await updateVault((v) => {
      total += proposeExtracted(v, x, source);
    });
  }
  onProgress?.('Done', batches.length, batches.length);
  return total;
}
