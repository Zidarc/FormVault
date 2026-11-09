// "Add to vault?" chips. They appear next to posts, chat messages and emails that look like they're about
// your projects, hackathons or results. The check is a local keyword match; nothing is sent anywhere
// until you tap a chip, and then only that one block of text goes to your AI key → your Inbox.

import { loadSettings } from '@/lib/storage';
import type { SourceKind } from '@/lib/types';

interface Site {
  kind: SourceKind;
  name: string;
  /** Blocks of text that can get a chip */
  blocks: string;
  /** Only on these paths (optional) */
  path?: RegExp;
  signal: RegExp;
}

const OWN_WORK =
  /\b(hackathon|we won|i won|won (the|first|second|third|1st|2nd|3rd)|winner|runner[- ]up|finalist|prize|i built|we built|i made|we made|i created|we created|my project|our project|our team|my team|submitted|deployed|launched|shipped|excited to (share|announce)|happy to (share|announce)|proud to|internship|intern at|certified|certificate|competition|selected (for|as)|award)\b/i;
const EMAIL_RESULT =
  /\b(congratulations|you('| ha)ve been (selected|shortlisted|accepted)|shortlisted|selected for|results? (are|is) (out|announced)|winner|finalist|certificate of|offer letter|acceptance)\b/i;

const SITES: Record<string, Site> = {
  'www.linkedin.com': {
    kind: 'linkedin',
    name: 'LinkedIn',
    blocks: '.feed-shared-update-v2, [data-urn^="urn:li:activity"], .update-components-text',
    path: /\/(in\/[^/]+\/recent-activity|feed\/update|posts)\//,
    signal: OWN_WORK,
  },
  'chatgpt.com': { kind: 'chatgpt', name: 'ChatGPT', blocks: '[data-message-author-role="user"]', signal: OWN_WORK },
  'chat.openai.com': { kind: 'chatgpt', name: 'ChatGPT', blocks: '[data-message-author-role="user"]', signal: OWN_WORK },
  'claude.ai': { kind: 'claude', name: 'Claude', blocks: '[data-testid="user-message"]', signal: OWN_WORK },
  'gemini.google.com': { kind: 'gemini', name: 'Gemini', blocks: 'user-query, .user-query-container', signal: OWN_WORK },
  'mail.google.com': { kind: 'email', name: 'Gmail', blocks: '.a3s.aiL, .a3s', signal: EMAIL_RESULT },
  'outlook.live.com': { kind: 'email', name: 'Outlook', blocks: '[aria-label="Message body"], div[role="document"]', signal: EMAIL_RESULT },
  'outlook.office.com': { kind: 'email', name: 'Outlook', blocks: '[aria-label="Message body"], div[role="document"]', signal: EMAIL_RESULT },
  'www.credly.com': { kind: 'certificate', name: 'Credly', blocks: 'main', path: /\/badges\//, signal: /./ },
  'www.coursera.org': { kind: 'certificate', name: 'Coursera', blocks: 'main', path: /\/(account\/accomplishments|verify)\//, signal: /./ },
};

export default defineContentScript({
  matches: [
    'https://www.linkedin.com/*',
    'https://chatgpt.com/*',
    'https://chat.openai.com/*',
    'https://claude.ai/*',
    'https://gemini.google.com/*',
    'https://mail.google.com/*',
    'https://outlook.live.com/*',
    'https://outlook.office.com/*',
    'https://www.credly.com/*',
    'https://www.coursera.org/*',
  ],
  runAt: 'document_idle',
  async main(ctx) {
    const site = SITES[location.hostname];
    if (!site) return;
    if (!(await loadSettings()).chipsEnabled) return;

    const seen = new WeakSet<Element>();
    const dismissed = new Set<string>();
    const keyOf = (t: string) => t.slice(0, 120);

    function chip(block: HTMLElement) {
      const host = document.createElement('span');
      host.setAttribute('data-formvault-ui', '');
      host.style.cssText = 'display:block;margin:6px 0;';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>
          .c{display:inline-flex;align-items:center;gap:6px;font:600 12.5px system-ui,sans-serif;border-radius:999px;
             border:1px solid #c9c6fb;background:#eeedfd;color:#3730a3;padding:4px 6px 4px 10px;cursor:pointer}
          .c:hover{background:#e0defc}
          .x{border:0;background:none;color:#6b6b8a;cursor:pointer;font-size:14px;padding:0 4px}
          .ok{background:#e6f6ee;border-color:#b6e3cb;color:#0f7b4a;cursor:default}
          .err{background:#fdecea;border-color:#f5c2bd;color:#b42318}
        </style>
        <span class="c" role="button" tabindex="0"><span class="t">＋ Add to vault?</span><button class="x" title="Hide" aria-label="Hide">×</button></span>`;
      const c = root.querySelector<HTMLElement>('.c')!;
      const t = root.querySelector<HTMLElement>('.t')!;
      const text = (block.innerText || '').trim();
      root.querySelector('.x')!.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissed.add(keyOf(text));
        host.remove();
      });
      const go = async () => {
        if (c.dataset.state) return;
        c.dataset.state = 'busy';
        t.textContent = 'Reading…';
        try {
          const res = (await browser.runtime.sendMessage({
            type: 'fv:capture',
            kind: site.kind,
            label: `${site.name} · ${document.title.slice(0, 60)}`,
            url: location.href,
            text,
          })) as { ok: boolean; n?: number; error?: string };
          if (!res?.ok) throw new Error(res?.error ?? 'Something went wrong');
          c.className = 'c ok';
          t.textContent = res.n ? `✓ ${res.n} in your Inbox` : '✓ Nothing new';
        } catch (e) {
          c.className = 'c err';
          t.textContent = e instanceof Error ? e.message.slice(0, 80) : 'Failed';
          delete c.dataset.state;
        }
      };
      c.addEventListener('click', go);
      c.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && go());
      return host;
    }

    function pass() {
      if (site.path && !site.path.test(location.pathname)) return;
      const blocks = [...document.querySelectorAll<HTMLElement>(site.blocks)];
      for (const b of blocks) {
        if (seen.has(b)) continue;
        // Skip nested matches (a post's text inside the post)
        if (blocks.some((o) => o !== b && o.contains(b) && seen.has(o))) continue;
        const text = (b.innerText || '').trim();
        if (text.length < 40 || !site.signal.test(text) || dismissed.has(keyOf(text))) continue;
        seen.add(b);
        b.appendChild(chip(b));
      }
    }

    let timer = 0;
    const schedule = () => {
      clearTimeout(timer);
      timer = window.setTimeout(pass, 700);
    };
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => mo.disconnect());
  },
});
