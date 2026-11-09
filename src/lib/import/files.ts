// File helpers: zip archives, CSV, dates, skill classification.

import { strFromU8, unzipSync } from 'fflate';

export type FileMap = Map<string, Uint8Array>;

export async function readAsBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Unzip (or wrap a single file) into path → bytes. Paths are lower-cased for matching. */
export async function openArchive(file: File): Promise<FileMap> {
  const bytes = await readAsBytes(file);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const out: FileMap = new Map();
  if (!isZip) {
    out.set(file.name.toLowerCase(), bytes);
    return out;
  }
  const files = unzipSync(bytes, {
    // skip media to save memory
    filter: (f) => /\.(csv|json|html?|txt|md)$/i.test(f.name),
  });
  for (const [name, data] of Object.entries(files)) out.set(name.toLowerCase(), data);
  return out;
}

export const text = (b: Uint8Array) => strFromU8(b).replace(/^﻿/, '');

export function findFile(files: FileMap, ...suffixes: string[]): string | undefined {
  for (const s of suffixes) {
    for (const [name, data] of files) if (name === s || name.endsWith('/' + s)) return text(data);
  }
  return undefined;
}

/** RFC-4180 CSV → rows */
export function parseCsvRows(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** CSV → objects. LinkedIn sometimes puts "Notes:" lines above the header, so find the header by a known column. */
export function parseCsv(src: string | undefined, mustHave?: string): Record<string, string>[] {
  if (!src) return [];
  const rows = parseCsvRows(src);
  let h = 0;
  if (mustHave) {
    const idx = rows.findIndex((r) => r.some((c) => c.trim().toLowerCase() === mustHave.toLowerCase()));
    if (idx < 0) return [];
    h = idx;
  }
  const head = rows[h]?.map((x) => x.trim()) ?? [];
  return rows.slice(h + 1).map((r) => Object.fromEntries(head.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Mar 2023" | "2023-03-15 10:00:00" | "03/15/23" | "2023" → "2023-03" / "2023" */
export function toYearMonth(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  m = t.match(/^([A-Za-z]{3})[a-z]*\.? (\d{4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    if (mi >= 0) return `${m[2]}-${String(mi + 1).padStart(2, '0')}`;
  }
  m = t.match(/^(\d{1,2})\/\d{1,2}\/(\d{2,4})/);
  if (m) return `${m[2].length === 2 ? '20' + m[2] : m[2]}-${m[1].padStart(2, '0')}`;
  m = t.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : undefined;
}

const LANGS = new Set(
  'python java javascript typescript c c++ c# go golang rust kotlin swift sql r dart php ruby matlab html css scala julia bash shell perl lua haskell assembly solidity verilog vhdl'.split(' '),
);
const FRAMEWORKS = new Set(
  'react react.js reactjs next.js nextjs node.js nodejs express django flask fastapi spring spring boot flutter react native tensorflow pytorch keras scikit-learn angular vue vue.js svelte laravel .net asp.net tailwind tailwindcss bootstrap pandas numpy opencv langchain huggingface transformers jquery redux nestjs electron unity'.split(
    ' ',
  ),
);

export function classifySkills(list: string[]) {
  const out = { languages: [] as string[], frameworks: [] as string[], tools: [] as string[] };
  for (const raw of list) {
    const s = raw.trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (LANGS.has(k)) out.languages.push(s);
    else if (FRAMEWORKS.has(k) || FRAMEWORKS.has(k.replace(/\s+/g, ''))) out.frameworks.push(s);
    else out.tools.push(s);
  }
  return out;
}
