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
    await browser.contextMenus.removeAll(); // updates keep old menus around
    browser.contextMenus.create({ id: 'fv-add', title: 'Add to FormVault', contexts: ['selection'] });
    browser.contextMenus.create({ id: 'fv-add-image', title: 'Add image to FormVault', contexts: ['image'] });
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

  function openPanel(tabId?: number) {
    if (isFirefox) (browser as any).sidebarAction.open();
    else if (tabId != null) (browser as any).sidePanel?.open({ tabId });
  }

  // Right-click an image → "Add image to FormVault". Instead of asking for access to the image's site,
  // grab what's on screen (allowed by the click) and crop to the image. The panel then OCRs it.
  async function captureImage(info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) {
    const src = info.srcUrl ?? '';
    const name = decodeURIComponent(src.split(/[?#]/)[0].split('/').pop() || '') || 'image';
    const base = { name: /.w{3,4}$/.test(name) ? name : name + '.png', pageUrl: tab?.url, pageTitle: tab?.title, at: Date.now() };
    try {
      if (src.startsWith('data:image/')) return void (await browser.storage.session.set({ pendingImage: { ...base, dataUrl: src } }));
      let rect = null;
      if (tab?.id != null && !info.frameId) {
        const [res] = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: (s: string) => {
            const img = [...document.images].find((i) => i.currentSrc === s || i.src === s);
            if (!img) return null;
            const r = img.getBoundingClientRect();
            return { x: r.left, y: r.top, w: r.width, h: r.height, dpr: devicePixelRatio };
          },
          args: [src],
        });
        rect = res?.result ?? null;
      }
      const dataUrl = await browser.tabs.captureVisibleTab(tab!.windowId!, { format: 'png' });
      await browser.storage.session.set({ pendingImage: { ...base, dataUrl, rect } });
    } catch (e) {
      console.warn('[FormVault] image capture failed', e);
      await notify("Couldn't grab that image. Right-click → Save image, then drop it into Import → Quick add.");
    }
  }

  // Right-click → "Add to FormVault"
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'fv-add-image') {
      openPanel(tab?.id); // must stay synchronous inside the click
      return captureImage(info, tab);
    }
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
