// Resume (PDF or linked Google Doc), certificates, and the paste box.
// Contact details are read locally with patterns and never sent to the AI.

import { nowIso } from '../ids';
import { proposeProfile } from '../inbox';
import { loadSettings, updateSettings, updateVault } from '../storage';
import { CNIC_RE, EMAIL_RE, redactPersonal } from '../text';
import type { Profile, SourceKind, SourceRef } from '../types';
import { extractToInbox, type ImportProgress } from './extract';
import { openArchive, text as u8text } from './files';
import { importImage } from './image';
import { ocr } from './ocr';

export async function pdfToText(file: Blob): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const it of content.items as any[]) {
      line += it.str;
      if (it.hasEOL) {
        lines.push(line);
        line = '';
      } else if (it.str && !it.str.endsWith(' ')) line += ' ';
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  return pages.join('\n\n').replace(/[ \t]+/g, ' ');
}

/** Pull contact details out with patterns — no AI. */
export function localProfileFields(text: string): Partial<Profile> {
  const p: Partial<Profile> = {};
  p.email = text.match(EMAIL_RE)?.[0];
  const phone = text.match(/(?:\+92|0092|0)?3\d{2}[-\s]?\d{7}\b|\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/);
  if (phone) p.phone = phone[0].trim();
  p.cnic = text.match(CNIC_RE)?.[0];
  const li = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i);
  if (li) p.linkedin = li[0].startsWith('http') ? li[0] : 'https://' + li[0];
  const gh = text.match(/(?:https?:\/\/)?github\.com\/[A-Za-z0-9-]+\/?(?![A-Za-z0-9-]*\/)/i);
  if (gh) p.github = gh[0].startsWith('http') ? gh[0] : 'https://' + gh[0];
  const gpa = text.match(/\bC?GPA\b[^0-9]{0,12}(\d\.\d{1,2})/i);
  if (gpa) p.cgpa = gpa[1];
  const uni = text.split('\n').find((l) => /\b(university|institute of|college|FAST|NUCES|LUMS|NUST)\b/i.test(l) && l.length < 120);
  if (uni) p.university = uni.replace(/\s*[|,–-]\s*\d{4}.*$/, '').trim();
  // The name is usually the first short line
  const first = text.split('\n').map((l) => l.trim()).find((l) => l && l.length < 40);
  if (first && /^[A-Za-z][A-Za-z .'-]+$/.test(first) && first.split(' ').length <= 4) p.name = first;
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Partial<Profile>;
}

export async function importResumeText(text: string, source: SourceRef, onProgress?: ImportProgress) {
  const local = localProfileFields(text);
  await updateVault((v) => {
    proposeProfile(v, local, source);
  });
  const redacted = redactPersonal(text, [local.name ?? ''].filter(Boolean));
  // A resume is all signal — no keyword filter.
  return extractToInbox([redacted], source, onProgress);
}

export async function importResumePdf(file: File, onProgress?: ImportProgress) {
  onProgress?.('Reading the PDF…');
  let text = await pdfToText(file);
  if (text.trim().length < 50) {
    // A scanned resume: read the pages with local OCR instead.
    const pages = await pdfPageImages(file, 4);
    const parts: string[] = [];
    for (const [i, p] of pages.entries()) {
      const r = await ocr(p, (pct) => onProgress?.(`Scanned PDF — reading page ${i + 1}/${pages.length}… ${pct}%`));
      parts.push(r.text);
    }
    text = parts.join('\n\n');
    if (text.trim().length < 50) throw new Error("Couldn't find any text in this PDF, even with OCR. Try a clearer scan.");
  }
  return importResumeText(text, { kind: 'resume', label: `Resume · ${file.name}`, at: nowIso() }, onProgress);
}

/** Render the first pages of a PDF to images (for scanned documents). */
export async function pdfPageImages(file: Blob, maxPages = 3): Promise<Blob[]> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const out: Blob[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 2200 / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport } as any).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (blob) out.push(blob);
  }
  return out;
}

/** Word documents: the text lives in word/document.xml inside the zip. */
export async function docxToText(file: File): Promise<string> {
  const files = await openArchive(file);
  const xml = files.get('word/document.xml');
  if (!xml) throw new Error("This doesn't look like a Word document.");
  return docxXmlToText(u8text(xml));
}

export function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>|<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function importResumeDocx(file: File, onProgress?: ImportProgress) {
  onProgress?.('Reading the Word document…');
  const text = await docxToText(file);
  if (text.length < 50) throw new Error('This document looks empty.');
  return importResumeText(text, { kind: 'resume', label: `Resume · ${file.name}`, at: nowIso() }, onProgress);
}

export function googleDocId(url: string): string | null {
  return url.match(/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

async function hash(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fetch a Google Doc as text. Works if you're signed in to Google in this browser or the doc is link-shared. */
export async function fetchGoogleDoc(url: string): Promise<string> {
  const id = googleDocId(url);
  if (!id) throw new Error("That doesn't look like a Google Docs link.");
  const res = await fetch(`https://docs.google.com/document/d/${id}/export?format=txt`, { credentials: 'include' });
  const ct = res.headers.get('content-type') ?? '';
  if (!res.ok || ct.includes('text/html'))
    throw new Error('Couldn\'t open the doc. In Google Docs, click Share → "Anyone with the link can view", then try again.');
  return res.text();
}

/** Re-read the linked doc; only extract when it changed. Returns null when unchanged. */
export async function syncResumeDoc(onProgress?: ImportProgress, force = false): Promise<number | null> {
  const s = await loadSettings();
  if (!s.resumeDocUrl) return null;
  const text = await fetchGoogleDoc(s.resumeDocUrl);
  const h = await hash(text);
  if (!force && h === s.resumeDocHash) return null;
  const n = await importResumeText(text, { kind: 'resume', label: 'Resume · Google Doc', url: s.resumeDocUrl, at: nowIso() }, onProgress);
  await updateSettings({ resumeDocHash: h, lastSync: { ...s.lastSync, resumeDoc: nowIso() } });
  return n;
}

/** The paste box: anything (resume, post, notes) → AI sorts it into sections. */
export async function importPasted(text: string, onProgress?: ImportProgress, kind: SourceKind = 'paste', label?: string, url?: string) {
  const local = localProfileFields(text);
  const source: SourceRef = { kind, label: label ?? `Pasted text · ${new Date().toLocaleDateString()}`, url, at: nowIso() };
  // Only propose contact details from the paste box if it looks like a resume (has an email).
  if (kind === 'paste' && local.email) {
    await updateVault((v) => {
      proposeProfile(v, local, source);
    });
  }
  return extractToInbox([text], source, onProgress);
}

/** Certificates: PDFs are read as text; images (and scanned PDFs) go through local OCR first. */
export async function importCertificates(files: File[], onProgress?: ImportProgress): Promise<number> {
  const settings = await loadSettings();
  const hint =
    'This is a certificate or award. Extract it as an achievement (and a hackathon if it is a hackathon certificate). Ignore personal ID numbers.';
  let n = 0;
  for (const [i, f] of files.entries()) {
    const step = (m: string) => onProgress?.(`${files.length > 1 ? `(${i + 1}/${files.length}) ` : ''}${m}`, i, files.length);
    step(`Reading ${f.name}…`);
    const source: SourceRef = { kind: 'certificate', label: `Certificate · ${f.name}`, at: nowIso() };
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      const text = await pdfToText(f);
      if (text.trim().length > 30) {
        n += await extractToInbox([`Certificate document:\n${redactPersonal(text)}`], source, undefined, settings);
        continue;
      }
      // A scanned certificate: OCR the first page.
      const [page] = await pdfPageImages(f, 1);
      if (page) n += (await importImage(page, step, { name: f.name, kind: 'certificate', label: source.label, hint })).found;
      continue;
    }
    if (!f.type.startsWith('image/')) continue;
    n += (await importImage(f, step, { name: f.name, kind: 'certificate', label: source.label, hint })).found;
  }
  return n;
}
