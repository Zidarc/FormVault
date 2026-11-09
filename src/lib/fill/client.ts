// Talks to the form reader inside the page, across all frames (forms embedded in iframes too).

import type { FillCommand, FillOutcome, ScanResult, ScannedField } from './types';

type Cmd = 'scan' | 'fill' | 'read' | 'focus';

export async function injectReader(tabId: number) {
  await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['/formreader.js'] });
}

async function call<T>(tabId: number, cmd: Cmd, arg: unknown, frameIds?: number[]): Promise<{ frameId: number; result: T }[]> {
  const res = await browser.scripting.executeScript({
    target: frameIds ? { tabId, frameIds } : { tabId, allFrames: true },
    func: (c: string, a: unknown) => (window as any).__formvault?.[c]?.(a) ?? null,
    args: [cmd, arg as any],
  });
  return res.filter((r) => r.result != null).map((r) => ({ frameId: r.frameId ?? 0, result: r.result as T }));
}

export class NoAccessError extends Error {}

export async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function scanTab(tabId: number): Promise<ScanResult> {
  try {
    await injectReader(tabId);
  } catch (e) {
    throw new NoAccessError(
      'FormVault needs your OK to read this page. Click the FormVault icon in the toolbar (or press Alt+Shift+F) while on the form.',
    );
  }
  const results = await call<Omit<ScanResult, 'fields'> & { fields: ScannedField[] }>(tabId, 'scan', null);
  const top = results.find((r) => r.frameId === 0)?.result ?? results[0]?.result;
  const fields = results.flatMap((r) => r.result.fields.map((f) => ({ ...f, frameId: r.frameId })));
  return {
    url: top?.url ?? '',
    title: top?.title ?? '',
    isGoogleForm: results.some((r) => r.result.isGoogleForm),
    fields,
  };
}

export async function fillTab(tabId: number, cmds: (FillCommand & { frameId: number })[]): Promise<FillOutcome[]> {
  const byFrame = new Map<number, FillCommand[]>();
  for (const c of cmds) {
    const list = byFrame.get(c.frameId) ?? [];
    list.push({ id: c.id, value: c.value });
    byFrame.set(c.frameId, list);
  }
  const out: FillOutcome[] = [];
  for (const [frameId, list] of byFrame) {
    const r = await call<FillOutcome[]>(tabId, 'fill', list, [frameId]);
    out.push(...(r[0]?.result ?? list.map((c) => ({ id: c.id, ok: false, reason: 'Frame not reachable' }))));
  }
  return out;
}

export async function readTab(tabId: number, fields: { id: string; frameId: number }[]) {
  const out: Record<string, string | string[]> = {};
  const frames = [...new Set(fields.map((f) => f.frameId))];
  for (const frameId of frames) {
    const r = await call<Record<string, string | string[]>>(
      tabId,
      'read',
      fields.filter((f) => f.frameId === frameId).map((f) => f.id),
      [frameId],
    );
    for (const [k, v] of Object.entries(r[0]?.result ?? {})) out[`${frameId}:${k}`] = v;
  }
  return out;
}

export async function focusField(tabId: number, f: { id: string; frameId: number }) {
  await call(tabId, 'focus', f.id, [f.frameId]).catch(() => {});
}
