// One drop zone for everything: work out what a file is and send it to the right importer,
// so nobody has to know which card a LinkedIn zip or a certificate photo belongs in.

import { nowIso } from '../ids';
import { detectChats, importChats } from './chats';
import { extractToInbox, type ImportProgress } from './extract';
import { findFile, openArchive } from './files';
import { importImage } from './image';
import { importLinkedIn } from './linkedin';
import { ocr } from './ocr';
import { docxToText, importCertificates, importPasted, importResumeText, pdfPageImages, pdfToText } from './resume';

export type DropKind = 'image' | 'pdf' | 'docx' | 'archive' | 'text' | 'unsupported';
export type DocKind = 'resume' | 'certificate' | 'document';

export interface RouteResult {
  /** What FormVault decided the file was, in plain words */
  what: string;
  found: number;
  note?: string;
}

const ext = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

/** First guess from the name and type alone. */
export function kindFromName(name: string, mime = ''): DropKind {
  const e = ext(name);
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(e)) return 'image';
  if (mime === 'application/pdf' || e === 'pdf') return 'pdf';
  if (e === 'docx') return 'docx';
  if (['zip', 'json', 'csv', 'html', 'htm'].includes(e) || /zip|json|csv|html/.test(mime)) return 'archive';
  if (['txt', 'md', 'markdown', 'rtf'].includes(e) || mime.startsWith('text/')) return 'text';
  return 'unsupported';
}

/** Resume, certificate, or some other document (report, pitch, notes)? */
export function classifyDocText(text: string): DocKind {
  const t = text.slice(0, 6000);
  const headings = ['education', 'experience', 'skills', 'projects', 'work history', 'achievements', 'certifications', 'summary', 'objective'];
  const headingHits = headings.filter((h) => new RegExp(`(^|\\n)\\s*${h}\\b`, 'i').test(t)).length;
  if (headingHits >= 2) return 'resume';
  if (
    text.length < 3000 &&
    /\b(certificate|certify|certifies|awarded|in recognition|participation|completion|credential|has successfully)\b/i.test(t)
  )
    return 'certificate';
  return 'document';
}

async function importDocumentText(text: string, file: File, onProgress?: ImportProgress, scanned = false): Promise<RouteResult> {
  const kind = classifyDocText(text);
  if (kind === 'resume') {
    const found = await importResumeText(text, { kind: 'resume', label: `Resume · ${file.name}`, at: nowIso() }, onProgress);
    return { what: scanned ? 'Resume (scanned)' : 'Resume', found };
  }
  if (kind === 'certificate') {
    const found = await extractToInbox(
      [`Certificate document:\n${text}`],
      { kind: 'certificate', label: `Certificate · ${file.name}`, at: nowIso() },
      onProgress,
    );
    return { what: 'Certificate', found };
  }
  const found = await importPasted(text, onProgress, 'paste', `Document · ${file.name}`);
  return { what: 'Document', found };
}

/** Import any file. */
export async function importAny(file: File, onProgress?: ImportProgress): Promise<RouteResult> {
  const kind = kindFromName(file.name, file.type);

  if (kind === 'image') {
    const r = await importImage(file, onProgress);
    return { what: 'Image', found: r.found, note: r.via === 'vision' ? 'The text was hard to read, so the AI looked at the image.' : 'Text read on your computer.' };
  }

  if (kind === 'pdf') {
    onProgress?.(`Reading ${file.name}…`);
    let text = await pdfToText(file);
    let scanned = false;
    if (text.trim().length < 50) {
      scanned = true;
      const pages = await pdfPageImages(file, 3);
      const parts: string[] = [];
      for (const [i, p] of pages.entries())
        parts.push((await ocr(p, (pct) => onProgress?.(`Scanned PDF — reading page ${i + 1}/${pages.length}… ${pct}%`))).text);
      text = parts.join('\n\n');
    }
    if (text.trim().length < 50) {
      // Nothing readable even with OCR — a stylised certificate, most likely. Let the image path try the AI.
      if (scanned) return { what: 'Certificate', found: await importCertificates([file], onProgress) };
      throw new Error(`Couldn't find any text in ${file.name}.`);
    }
    return importDocumentText(text, file, onProgress, scanned);
  }

  if (kind === 'docx') {
    const text = await docxToText(file);
    if (text.length < 50) throw new Error(`${file.name} looks empty.`);
    return importDocumentText(text, file, onProgress);
  }

  if (kind === 'archive') {
    onProgress?.(`Opening ${file.name}…`);
    const files = await openArchive(file);
    if (detectChats(files)) {
      const r = await importChats(file, onProgress);
      return { what: 'AI chat export', found: r.found, note: `${r.convos} chats, ${r.relevant} about your work.` };
    }
    if (findFile(files, 'profile.csv', 'positions.csv', 'shares.csv', 'education.csv', 'skills.csv', 'projects.csv')) {
      const r = await importLinkedIn(file, onProgress);
      return { what: 'LinkedIn export', found: r.structured + r.fromPosts, note: r.postsSent ? `${r.postsSent} posts read by AI.` : undefined };
    }
    const doc = files.get('word/document.xml');
    if (doc) return importAny(new File([file], file.name.replace(/\.\w+$/, '') + '.docx'), onProgress);
    // A loose HTML page or text-like JSON: just read its words.
    if (files.size === 1) {
      const raw = new TextDecoder().decode([...files.values()][0]);
      const text = /\.html?$/i.test(file.name) ? htmlToText(raw) : raw;
      if (text.trim().length > 50) return { what: 'Text', found: await importPasted(text.slice(0, 200_000), onProgress, 'paste', `File · ${file.name}`) };
    }
    throw new Error(`FormVault doesn't recognise ${file.name}. Try a LinkedIn or AI-chat export, a resume, or an image.`);
  }

  if (kind === 'text') {
    const text = await file.text();
    if (text.trim().length < 20) throw new Error(`${file.name} is empty.`);
    return { what: 'Text', found: await importPasted(text.slice(0, 200_000), onProgress, 'paste', `File · ${file.name}`) };
  }

  throw new Error(`FormVault can't read ${ext(file.name) ? `.${ext(file.name)} files` : file.name} yet. Try a PDF, Word file, image, zip or text file.`);
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,svg,nav,footer,header,form,iframe').forEach((n) => n.remove());
  // A parsed document has no layout, so put the line breaks back by hand.
  doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,section,article,blockquote,pre').forEach((n) => n.append('\n'));
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  return (doc.body?.textContent ?? '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
