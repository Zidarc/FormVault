// Images (screenshots, certificates, posters, ID cards, photos of notes):
// 1. read the text locally with OCR — free, private, no AI quota used;
// 2. strip personal details and let the AI sort the text into the vault (one call);
// 3. only if OCR finds almost nothing (stylised certificates, handwriting) is the image itself sent to the AI.

import { EXTRACT_SYSTEM } from '../ai/prompts';
import { generateJson } from '../ai/providers';
import { nowIso } from '../ids';
import { proposeProfile } from '../inbox';
import { loadSettings, updateVault } from '../storage';
import type { SourceKind, SourceRef } from '../types';
import { extractToInbox, proposeExtracted, type Extracted, type ImportProgress } from './extract';
import { ocr, ocrUsable, resizeImage } from './ocr';
import { localProfileFields } from './resume';

export interface ImageImportResult {
  found: number;
  via: 'ocr' | 'vision';
  /** The text OCR read, so the UI can show it */
  text?: string;
}

export const IMAGE_HINT =
  'The text below was read from an image by OCR, so it may have recognition mistakes — fix obvious ones and ignore stray characters.';

const toB64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export async function importImage(
  file: Blob,
  onProgress?: ImportProgress,
  opts: { name?: string; kind?: SourceKind; label?: string; url?: string; hint?: string } = {},
): Promise<ImageImportResult> {
  const name = opts.name ?? (file as File).name ?? 'image';
  const source: SourceRef = { kind: opts.kind ?? 'image', label: opts.label ?? `Image · ${name}`, url: opts.url, at: nowIso() };
  if (file.size > 25_000_000) throw new Error(`${name} is too large (max 25 MB).`);

  onProgress?.(`Reading the text in ${name}…`);
  let text = '';
  try {
    const r = await ocr(file, (pct) => onProgress?.(`Reading the text in ${name}… ${pct}%`));
    if (ocrUsable(r)) text = r.text;
  } catch (e) {
    console.warn('[FormVault] OCR failed, falling back to the AI', e);
  }

  if (text) {
    // Contact details found in the image are proposed locally and never sent to the AI.
    const local = localProfileFields(text);
    delete local.name; // the first line of a screenshot is rarely a name
    if (local.email || local.cnic || local.phone) await updateVault((v) => void proposeProfile(v, local, source));
    const found = await extractToInbox([`${opts.hint ? opts.hint + '\n' : ''}${IMAGE_HINT}\n\n${text}`], source, onProgress);
    return { found, via: 'ocr', text };
  }

  const settings = await loadSettings();
  if (settings.provider === 'builtin')
    throw new Error(`Couldn't find readable text in ${name}. Try a sharper photo or a screenshot.`);
  onProgress?.(`The text in ${name} is hard to read — asking the AI to look at it…`);
  const small = await resizeImage(file, { max: 1600, type: 'image/jpeg', quality: 0.85 });
  const x = await generateJson<Extracted>(settings, {
    system: EXTRACT_SYSTEM,
    prompt: `${opts.hint ?? 'This image is from a student\'s history (a certificate, award, post, poster or notes).'} Extract what it shows. Ignore personal ID numbers, phone numbers and emails.`,
    images: [{ mime: 'image/jpeg', data: await toB64(small) }],
    temperature: 0.1,
  });
  let found = 0;
  await updateVault((v) => {
    found = proposeExtracted(v, x, source);
  });
  return { found, via: 'vision' };
}
