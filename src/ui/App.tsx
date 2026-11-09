import { useEffect, useState } from 'react';
import { useVault } from './hooks';
import { ImportView } from './views/ImportView';

export type Tab = 'import';

const TABS: { id: Tab; label: string }[] = [{ id: 'import', label: 'Import' }];

export function App() {
  const vault = useVault();
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
            </button>
          ))}
        </nav>
      </div>
      <main>{vault && tab === 'import' && <ImportView vault={vault} />}</main>
    </div>
  );
}
