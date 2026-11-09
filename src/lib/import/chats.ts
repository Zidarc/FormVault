// AI-chat exports: ChatGPT (conversations.json), Claude (conversations.json), Gemini (Google Takeout "My Activity").
// Only conversations where YOU talk about your own work are kept, and only the relevant paragraphs.

import { nowIso } from '../ids';
import type { SourceKind } from '../types';
import { extractToInbox, type ImportProgress } from './extract';
import { findFile, openArchive, text, toYearMonth, type FileMap } from './files';

interface Msg {
  me: boolean;
  text: string;
}
interface Convo {
  title: string;
  date?: string;
  messages: Msg[];
}

// Stronger than the general keyword list: coding chats mention "project" and "build" constantly.
const OWN_WORK =
  /\b(hackathon|won|winner|prize|finalist|runner[- ]up|i built|we built|i made|we made|i created|we created|my project|our project|my app|our app|my team|our team|submitted|deployed|launched|internship|intern at|competition|award|certificate|selected for|my fyp|final year project|my startup|devpost)\b/i;

function parseChatGPT(json: any[]): Convo[] {
  return json.map((c) => {
    const nodes = Object.values(c.mapping ?? {}) as any[];
    const messages: Msg[] = nodes
      .map((n) => n?.message)
      .filter((m) => m && (m.author?.role === 'user' || m.author?.role === 'assistant'))
      .sort((a, b) => (a.create_time ?? 0) - (b.create_time ?? 0))
      .map((m) => ({
        me: m.author.role === 'user',
        text: (m.content?.parts ?? []).filter((p: unknown) => typeof p === 'string').join('\n'),
      }))
      .filter((m) => m.text.trim());
    return {
      title: c.title ?? 'Untitled chat',
      date: c.create_time ? new Date(c.create_time * 1000).toISOString().slice(0, 7) : undefined,
      messages,
    };
  });
}

function parseClaude(json: any[]): Convo[] {
  return json.map((c) => ({
    title: c.name || 'Untitled chat',
    date: toYearMonth(c.created_at),
    messages: (c.chat_messages ?? [])
      .map((m: any) => ({
        me: m.sender === 'human',
        text:
          m.text ||
          (m.content ?? [])
            .filter((x: any) => x.type === 'text')
            .map((x: any) => x.text)
            .join('\n'),
      }))
      .filter((m: Msg) => m.text?.trim()),
  }));
}

const stripHtml = (h: string) =>
  h
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ');

/** Takeout: each activity is one prompt + response. */
function parseGeminiActivity(json: any[]): Convo[] {
  return json
    .filter((a) => /gemini|bard/i.test(a.header ?? a.products?.join(' ') ?? 'gemini'))
    .map((a) => ({
      title: String(a.title ?? '').replace(/^Prompted\s*/i, '').slice(0, 80) || 'Gemini prompt',
      date: toYearMonth(a.time),
      messages: [
        { me: true, text: String(a.title ?? '').replace(/^Prompted\s*/i, '') },
        ...((a.safeHtmlItem ?? []) as any[]).map((x) => ({ me: false, text: stripHtml(x.html ?? '') })),
      ].filter((m) => m.text.trim()),
    }));
}

function parseGeminiHtml(html: string): Convo[] {
  // Each activity is in an "outer-cell" block.
  return html
    .split(/class="outer-cell/)
    .slice(1)
    .map((block) => {
      const t = stripHtml(block).replace(/\n{2,}/g, '\n').trim();
      const promptMatch = t.match(/Prompted\s*([\s\S]*?)(\n|$)/);
      return {
        title: promptMatch?.[1]?.slice(0, 80) ?? 'Gemini prompt',
        messages: [{ me: true, text: t.slice(0, 6000) }],
      };
    });
}

export function detectChats(files: FileMap): { kind: SourceKind; convos: Convo[] } | null {
  const convJson = findFile(files, 'conversations.json');
  if (convJson) {
    const data = JSON.parse(convJson);
    const arr: any[] = Array.isArray(data) ? data : data.conversations ?? [];
    if (arr.length && arr[0].mapping) return { kind: 'chatgpt', convos: parseChatGPT(arr) };
    if (arr.length && arr[0].chat_messages) return { kind: 'claude', convos: parseClaude(arr) };
  }
  const gJson = findFile(files, 'myactivity.json');
  if (gJson) return { kind: 'gemini', convos: parseGeminiActivity(JSON.parse(gJson)) };
  const gHtml = findFile(files, 'myactivity.html');
  if (gHtml) return { kind: 'gemini', convos: parseGeminiHtml(gHtml) };
  // A single loose JSON file
  for (const [name, bytes] of files) {
    if (!name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(text(bytes));
      if (Array.isArray(data) && data[0]?.mapping) return { kind: 'chatgpt', convos: parseChatGPT(data) };
      if (Array.isArray(data) && data[0]?.chat_messages) return { kind: 'claude', convos: parseClaude(data) };
      if (Array.isArray(data) && data[0]?.safeHtmlItem) return { kind: 'gemini', convos: parseGeminiActivity(data) };
    } catch {
      /* not this one */
    }
  }
  return null;
}

/** Keep conversations where you describe your own work; within them keep relevant paragraphs. */
export function chatPieces(convos: Convo[], maxChars = 360_000): string[] {
  const out: string[] = [];
  let size = 0;
  for (const c of convos) {
    const mine = c.messages.filter((m) => m.me);
    if (!mine.some((m) => OWN_WORK.test(m.text)) && !OWN_WORK.test(c.title)) continue;
    const lines: string[] = [];
    for (let i = 0; i < c.messages.length; i++) {
      const m = c.messages[i];
      if (m.me) {
        const paras = m.text.split(/\n\s*\n/).filter((p) => OWN_WORK.test(p) || p.length < 400);
        if (paras.length) lines.push('Me: ' + paras.join('\n').slice(0, 2500));
      } else if (i > 0 && c.messages[i - 1].me && OWN_WORK.test(c.messages[i - 1].text)) {
        // brief context from the reply right after a relevant message
        lines.push('AI: ' + m.text.slice(0, 500));
      }
    }
    if (!lines.length) continue;
    const piece = `Chat "${c.title}"${c.date ? ` (${c.date})` : ''}:\n${lines.join('\n')}`.slice(0, 8000);
    out.push(piece);
    size += piece.length;
    if (size > maxChars) break;
  }
  return out;
}

const LABEL: Partial<Record<SourceKind, string>> = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' };

export async function importChats(
  file: File,
  onProgress?: ImportProgress,
): Promise<{ kind: SourceKind; convos: number; relevant: number; found: number }> {
  onProgress?.('Opening your chat export…');
  const files = await openArchive(file);
  const det = detectChats(files);
  if (!det) throw new Error("This doesn't look like a ChatGPT, Claude or Gemini export. Upload the .zip you downloaded.");
  const pieces = chatPieces(det.convos);
  onProgress?.(`${det.convos.length} chats, ${pieces.length} about your work.`);
  const found = pieces.length
    ? await extractToInbox(
        pieces,
        { kind: det.kind, label: `${LABEL[det.kind]} export · ${pieces.length} chats`, at: nowIso() },
        onProgress,
      )
    : 0;
  return { kind: det.kind, convos: det.convos.length, relevant: pieces.length, found };
}
