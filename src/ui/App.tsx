import { useEffect, useState } from 'react';
import { useSettings, useVault } from './hooks';
import { ImportView } from './views/ImportView';
import { InboxView } from './views/InboxView';
import { SettingsView } from './views/SettingsView';
import { VaultView } from './views/VaultView';

export type Tab = 'inbox' | 'vault' | 'import' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'vault', label: 'Vault' },
  { id: 'import', label: 'Import' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const vault = useVault();
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('import');

  useEffect(() => {
    const t = new URLSearchParams(location.search).get('tab') as Tab | null;
    if (t && TABS.some((x) => x.id === t)) setTab(t);
  }, []);

  return (
    <div className="app">
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
        {vault && tab === 'inbox' && <InboxView vault={vault} onImport={() => setTab('import')} />}
        {vault && tab === 'vault' && <VaultView vault={vault} />}
        {vault && tab === 'import' && <ImportView vault={vault} onOpenInbox={() => setTab('inbox')} />}
        {vault && settings && tab === 'settings' && <SettingsView vault={vault} settings={settings} />}
      </main>
    </div>
  );
}
