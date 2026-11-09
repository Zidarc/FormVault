import { useEffect, useState } from 'react';
import { AccessBanner } from './AccessBanner';
import { useSettings, useVault } from './hooks';
import { enqueueFiles, filesFrom } from './queue';
import { FillView } from './views/FillView';
import { ImportView } from './views/ImportView';
import { InboxView } from './views/InboxView';
import { SettingsView } from './views/SettingsView';
import { VaultView } from './views/VaultView';

export type Tab = 'fill' | 'inbox' | 'vault' | 'import' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'fill', label: 'Fill' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'vault', label: 'Vault' },
  { id: 'import', label: 'Import' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const vault = useVault();
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('fill');
  const [toast, setToast] = useState('');

  // Results of right-click captures arrive from the background.
  useEffect(() => {
    const show = async () => {
      const { toast: t } = (await browser.storage.session.get('toast')) as { toast?: { text: string; at: number } };
      if (t && Date.now() - t.at < 15_000) {
        setToast(t.text);
        setTimeout(() => setToast(''), 6000);
      }
    };
    const l = (c: Record<string, unknown>, area: string) => area === 'session' && 'toast' in c && show();
    browser.storage.onChanged.addListener(l);
    return () => browser.storage.onChanged.removeListener(l);
  }, []);

  // Drop a file anywhere in the panel, or paste a screenshot outside a text box, and it goes to Quick add.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, [contenteditable]')) return;
      const files = filesFrom(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      enqueueFiles(files);
      setTab('import');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    const t = new URLSearchParams(location.search).get('tab') as Tab | null;
    if (t && TABS.some((x) => x.id === t)) setTab(t);
  }, []);

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        const files = filesFrom(e.dataTransfer);
        if (!files.length) return;
        e.preventDefault();
        enqueueFiles(files);
        setTab('import');
      }}
    >
      <div className="top">
        <div className="brand">
          <img src="/icon/32.png" alt="" />
          <b>FormVault</b>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'inbox' && !!vault?.inbox.length && <span className="badge">{vault.inbox.length}</span>}
            </button>
          ))}
        </nav>
      </div>
      <main>
        <AccessBanner />
        {toast && (
          <p className="msg ok" role="status" onClick={() => setTab('inbox')} style={{ cursor: 'pointer' }}>
            {toast}
          </p>
        )}
        {vault && settings && tab === 'fill' && <FillView vault={vault} settings={settings} onOpenSettings={() => setTab('settings')} />}
        {vault && tab === 'inbox' && <InboxView vault={vault} onImport={() => setTab('import')} />}
        {vault && tab === 'vault' && <VaultView vault={vault} />}
        {vault && tab === 'import' && <ImportView vault={vault} onOpenInbox={() => setTab('inbox')} />}
        {vault && settings && tab === 'settings' && <SettingsView vault={vault} settings={settings} />}
      </main>
    </div>
  );
}
