import { nowIso } from '@/lib/ids';
import { syncDrive } from '@/lib/drive';
import { injectReader } from '@/lib/fill/client';
import { syncDevpost } from '@/lib/import/devpost';
import { syncGitHub } from '@/lib/import/github';
import { importPasted, syncResumeDoc } from '@/lib/import/resume';
import { loadSettings } from '@/lib/storage';

const SYNC_ALARM = 'formvault-daily-sync';

export default defineBackground(() => {
  const isFirefox = typeof (browser as any).sidebarAction !== 'undefined';

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install') await browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
    browser.contextMenus.create({ id: 'fv-add', title: 'Add to FormVault', contexts: ['selection'] });
    browser.alarms.create(SYNC_ALARM, { periodInMinutes: 24 * 60, delayInMinutes: 5 });
  });

  // Icon click (or Alt+Shift+F): open the panel and read the form — only now, only this tab.
  browser.action.onClicked.addListener((tab) => {
    // Opening the panel must happen synchronously inside the click.
    if (isFirefox) (browser as any).sidebarAction.open();
    else (browser as any).sidePanel?.open({ tabId: tab.id });
    if (tab.id == null) return;
    injectReader(tab.id)
      .then(() => browser.storage.session.set({ scanRequest: { tabId: tab.id, at: Date.now() } }))
      .catch(() => browser.storage.session.set({ scanRequest: { tabId: tab.id, at: Date.now(), blocked: true } }));
  });

  // Right-click → "Add to FormVault"
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'fv-add' || !info.selectionText) return;
    try {
      const n = await importPasted(info.selectionText, undefined, 'page', `Selected on ${tab?.title ?? 'a page'}`, tab?.url);
      await notify(n ? `Added ${n} item${n === 1 ? '' : 's'} to your Inbox.` : 'Nothing new found in that text.');
    } catch (e) {
      await notify(e instanceof Error ? e.message : String(e));
    }
  });

  // Chips on LinkedIn / chats / email send captured text here.
  browser.runtime.onMessage.addListener((msg: any, sender) => {
    if (msg?.type === 'fv:capture') {
      return importPasted(String(msg.text).slice(0, 30000), undefined, msg.kind ?? 'page', msg.label, msg.url ?? sender.tab?.url)
        .then((n) => ({ ok: true, n }))
        .catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    }
    if (msg?.type === 'fv:openPanel') {
      if (isFirefox) (browser as any).sidebarAction.open();
      else if (sender.tab?.id != null) (browser as any).sidePanel?.open({ tabId: sender.tab.id });
    }
    return undefined;
  });

  // Daily: GitHub, Devpost, linked Google Doc resume → Inbox
  browser.alarms.onAlarm.addListener(async (a) => {
    if (a.name !== SYNC_ALARM) return;
    const s = await loadSettings();
    const jobs: Promise<unknown>[] = [];
    if (s.githubUser) jobs.push(syncGitHub());
    if (s.devpostUser) jobs.push(syncDevpost());
    if (s.resumeDocUrl) jobs.push(syncResumeDoc());
    await Promise.allSettled(jobs);
    // Drive last, so today's finds sync too
    if (s.driveConnected) jobs.push(syncDrive(false));
    const results = await Promise.allSettled(jobs);
    for (const r of results) if (r.status === 'rejected') console.warn('[FormVault] sync failed', r.reason);
    await browser.storage.local.set({ lastAutoSync: nowIso() });
  });

  async function notify(text: string) {
    await browser.storage.session.set({ toast: { text, at: Date.now() } });
    browser.action.setBadgeText({ text: '•' });
    setTimeout(() => browser.action.setBadgeText({ text: '' }), 4000);
  }
});
